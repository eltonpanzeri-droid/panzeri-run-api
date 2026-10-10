import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SessionExecutionLinkService } from '../../src/activity-execution/session-execution-link.service';
import { EvolutionMetricService } from '../../src/evolution/evolution-metric.service';
import { normalizePolarModality } from '../../src/polar/polar-activity-normalizer';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Associacao atividade externa x treino prescrito + correcao pelo aluno (10/2026), em PostgreSQL real e dados sinteticos.

describe('atividades externas x treinos prescritos (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const service = new SessionExecutionLinkService(prisma as never);
  const userIds: string[] = [];
  let seq = 0;

  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  async function student(label: string) {
    const s = await seedStudent(prisma, label, { startDate: new Date('2026-09-28T00:00:00.000Z') });
    userIds.push(s.userId);
    // limpa a corrida/intervalado e o feedback padrao do seed: cada teste monta o proprio cenario
    await prisma.workoutCompletion.deleteMany({ where: { userId: s.userId } });
    await prisma.trainingSession.deleteMany({ where: { userId: s.userId } });
    return s;
  }
  const session = (s: { userId: string; planId: string }, date: string, modality: string, durationMin: number | null, extra: Record<string, unknown> = {}) =>
    prisma.trainingSession.create({
      data: {
        planId: s.planId, userId: s.userId, scheduledDate: new Date(`${date}T00:00:00.000Z`), weekday: new Date(`${date}T00:00:00.000Z`).getUTCDay(), modality, title: modality,
        durationMin, distanceKm: modality === 'corrida' ? 6 : null, structure: { type: modality === 'corrida' ? 'run' : 'strength' }, origin: 'agent', ...extra,
      } as never,
    });
  // startLocal: 'AAAA-MM-DDTHH:MM' no fuso -03:00 (offset -180)
  const activity = async (s: { userId: string }, sport: string, startLocal: string, minutes: number, distanceKm: number | null = null, extra: Record<string, unknown> = {}) => {
    seq += 1;
    const startedAt = new Date(Date.parse(`${startLocal}:00Z`) + 3 * 3_600_000);
    const provider = (extra.provider as string | undefined) ?? 'polar';
    const externalId = `ext-${seq}-${Math.random().toString(36).slice(2, 8)}`;
    const raw = await prisma.rawExternalActivity.create({ data: { userId: s.userId, provider, externalId, payload: { origem: 'sintetico' } } });
    return prisma.activityLog.create({ data: { userId: s.userId, provider, externalId, rawActivityId: raw.id, startedAt, utcOffsetMinutes: -180, sport, durationSec: Math.round(minutes * 60), distanceMeters: distanceKm != null ? distanceKm * 1000 : null, avgHeartRateBpm: 120, ...extra } as never });
  };
  const activeLinks = (where: Record<string, unknown>) => prisma.sessionExecutionLink.findMany({ where: { ...where, status: 'active' } });

  it('esteira vincula automaticamente a prescricao de corrida; natacao, bike e caminhada viram atividades extras registradas (nunca km de corrida)', async () => {
    const s = await student('tipos');
    const run = await session(s, '2026-09-29', 'corrida', 40);
    const treadmill = await activity(s, 'esteira', '2026-09-29T06:00', 41, 6.1);
    expect(await service.classify(treadmill.id)).toBe('corresponding');
    expect((await activeLinks({ trainingSessionId: run.id }))).toHaveLength(1);
    for (const [sport, km] of [['natacao', 2], ['bike', 40], ['caminhada', 5]] as const) {
      const a = await activity(s, sport, '2026-09-30T07:00', 50, km);
      expect(await service.classify(a.id)).toBe('alternative');
    }
    expect(await prisma.activityLog.count({ where: { userId: s.userId, executionClassification: 'alternative' } })).toBe(3); // todas registradas
    const series = await new EvolutionMetricService(prisma as never).getSeries(s.userId);
    const km = series.weeks.map((w) => w.kmPercorridos).filter((v) => v != null);
    expect(km).toEqual([6.1]); // so' a esteira; os 47 km de natacao/bike/caminhada nao entram
  });

  it('forca (Polar STRENGTH_TRAINING) vincula a musculacao; funcional so com duracao compativel; funcional sem prescricao de forca vira extra', async () => {
    const s = await student('forca');
    const mus = await session(s, '2026-09-29', 'forca', 45);
    const funcionalOk = await activity(s, 'funcional', '2026-09-29T06:00', 50);
    expect(await service.classify(funcionalOk.id)).toBe('corresponding'); // 50 min vs 45 prescritos
    expect((await activeLinks({ trainingSessionId: mus.id }))[0].matchMethod).toBe('automatic_weak_modality_with_duration');

    const mus2 = await session(s, '2026-09-30', 'forca', 45);
    const funcionalCurto = await activity(s, 'funcional', '2026-09-30T06:00', 15);
    expect(await service.classify(funcionalCurto.id)).toBe('alternative'); // duracao incompativel: nunca associa por nome
    expect(await activeLinks({ trainingSessionId: mus2.id })).toHaveLength(0);

    await session(s, '2026-10-01', 'corrida', 40);
    const funcionalSoCorrida = await activity(s, 'funcional', '2026-10-01T06:00', 45);
    expect(await service.classify(funcionalSoCorrida.id)).toBe('alternative'); // funcional nunca casa com corrida

    const strong = await activity(s, 'forca', '2026-10-02T06:00', 20);
    await session(s, '2026-10-02', 'forca', 45);
    expect(await service.classify(strong.id)).toBe('corresponding'); // musculacao x musculacao: unica prescricao => vincula
  });

  it('duas atividades e UMA prescricao: vincula a que tem evidencia suficiente, a outra fica extra — em qualquer ordem de chegada', async () => {
    const s = await student('duas');
    const mus = await session(s, '2026-09-29', 'forca', 45);
    const curta = await activity(s, 'forca', '2026-09-29T05:00', 10);
    const certa = await activity(s, 'forca', '2026-09-29T06:00', 47);
    expect(await service.classify(curta.id)).toBe('alternative');
    expect(await service.classify(certa.id)).toBe('corresponding');
    expect((await activeLinks({ trainingSessionId: mus.id })).map((l) => l.activityLogId)).toEqual([certa.id]);

    const s2 = await student('duas-b');
    const mus2 = await session(s2, '2026-09-29', 'forca', 45);
    const certa2 = await activity(s2, 'forca', '2026-09-29T06:00', 47);
    const curta2 = await activity(s2, 'forca', '2026-09-29T05:00', 10);
    expect(await service.classify(certa2.id)).toBe('corresponding'); // chega primeiro: unica com evidencia suficiente
    expect(await service.classify(curta2.id)).toBe('alternative');
    expect(await activeLinks({ trainingSessionId: mus2.id })).toHaveLength(1);

    // sem evidencia que diferencie (ambas compativeis): nao associa arbitrariamente
    const s3 = await student('duas-c');
    await session(s3, '2026-09-29', 'forca', 45);
    const x = await activity(s3, 'forca', '2026-09-29T05:00', 44);
    await activity(s3, 'forca', '2026-09-29T06:00', 46);
    expect(await service.classify(x.id)).toBe('ambiguous');
  });

  it('correcao do aluno: vincular, trocar de treino, substituir outro vinculo e desfazer — sem sessoes duplicadas, feedback preservado', async () => {
    const s = await student('aluno');
    const mus = await session(s, '2026-09-29', 'forca', 45);
    const musOutroDia = await session(s, '2026-10-01', 'forca', 45);
    await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: musOutroDia.id, status: 'done', perceivedEffort: 7, notes: 'senti bem', painFlag: 'none' } });
    // atividade de forca feita na quarta, sem treino na quarta: fica extra; o aluno diz que era a musculacao de quinta (mesma semana)
    const extra = await activity(s, 'forca', '2026-09-30T06:00', 50);
    expect(await service.classify(extra.id)).toBe('alternative');

    const linked = await service.linkActivityToSessionAsStudent(s.userId, extra.id, musOutroDia.id);
    expect(linked.activityLogId).toBe(extra.id);
    const afterLink = await prisma.activityLog.findUniqueOrThrow({ where: { id: extra.id } });
    expect([afterLink.executionClassification, afterLink.executionClassifiedBy]).toEqual(['corresponding', 'student']);
    const kept = await prisma.workoutCompletion.findUniqueOrThrow({ where: { sessionId: musOutroDia.id } });
    expect([kept.perceivedEffort, kept.notes]).toEqual([7, 'senti bem']); // feedback manual intacto

    // corrigir: era a musculacao de terca (outro treino da semana) => o vinculo anterior e' revogado (historico), nunca ficam dois ativos
    await service.linkActivityToSessionAsStudent(s.userId, extra.id, mus.id);
    expect(await activeLinks({ activityLogId: extra.id })).toHaveLength(1);
    expect((await activeLinks({ activityLogId: extra.id }))[0].trainingSessionId).toBe(mus.id);
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: extra.id, status: 'revoked' } })).toBe(1);

    // outra atividade assume o mesmo treino: a escolha do aluno prevalece e a primeira volta a ser extra (nunca dois vinculos no mesmo treino)
    const second = await activity(s, 'forca', '2026-09-29T18:00', 46);
    await service.classify(second.id);
    const swapped = await service.linkActivityToSessionAsStudent(s.userId, second.id, mus.id);
    expect(swapped.replacedActivityLogIds).toEqual([extra.id]);
    expect(await activeLinks({ trainingSessionId: mus.id })).toHaveLength(1);
    expect((await prisma.activityLog.findUniqueOrThrow({ where: { id: extra.id } })).executionClassification).toBe('alternative');

    // desfazer: volta a ser extra por decisao do aluno; o reconciliador automatico nao a reassocia
    const undone = await service.unlinkActivityAsStudent(s.userId, second.id);
    expect(undone.classification).toBe('alternative');
    expect(await activeLinks({ trainingSessionId: mus.id })).toHaveLength(0);
    await service.reconcileEvent(second.id);
    expect(await activeLinks({ trainingSessionId: mus.id })).toHaveLength(0);
    expect(await prisma.trainingSession.count({ where: { userId: s.userId, origin: 'device_extra' } })).toBe(0); // nenhuma sessao duplicada
    await expect(service.unlinkActivityAsStudent(s.userId, second.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validacoes: modalidade incompativel, treino extra como alvo, treino de outro aluno e atividade de outro aluno', async () => {
    const s = await student('valida');
    const run = await session(s, '2026-09-29', 'corrida', 40);
    const swim = await activity(s, 'natacao', '2026-09-29T07:00', 40, 1.5);
    await service.classify(swim.id);
    await expect(service.linkActivityToSessionAsStudent(s.userId, swim.id, run.id)).rejects.toBeInstanceOf(BadRequestException); // natacao nao vira corrida
    const dx = await session(s, '2026-09-29', 'forca', 30, { origin: 'device_extra' });
    const gym = await activity(s, 'forca', '2026-09-29T08:00', 30);
    await expect(service.linkActivityToSessionAsStudent(s.userId, gym.id, dx.id)).rejects.toBeInstanceOf(BadRequestException);
    const far = await session(s, '2026-10-20', 'forca', 45);
    await expect(service.linkActivityToSessionAsStudent(s.userId, gym.id, far.id)).rejects.toBeInstanceOf(BadRequestException); // fora da semana
    const other = await student('outro');
    await expect(service.linkActivityToSessionAsStudent(other.userId, gym.id, run.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('atividade extra ja materializada com feedback: o feedback vai para o treino prescrito e a sessao sintetica sai (sem duplicar)', async () => {
    const s = await student('materializada');
    const mus = await session(s, '2026-09-29', 'forca', 45);
    const musOutroDia = await session(s, '2026-10-01', 'forca', 45);
    const gym = await activity(s, 'forca', '2026-09-30T06:00', 50);
    await service.classify(gym.id);
    await prisma.trainingPlan.update({ where: { id: s.planId }, data: { status: 'active' } });
    const materialized = await service.materializeExtraActivity(gym.id);
    await prisma.workoutCompletion.update({ where: { id: materialized!.completion!.id }, data: { perceivedEffort: 8, notes: 'puxado' } });
    expect(await prisma.trainingSession.count({ where: { userId: s.userId, origin: 'device_extra' } })).toBe(1);

    await service.linkActivityToSessionAsStudent(s.userId, gym.id, musOutroDia.id);
    expect(await prisma.trainingSession.count({ where: { userId: s.userId, origin: 'device_extra' } })).toBe(0);
    const completion = await prisma.workoutCompletion.findUniqueOrThrow({ where: { sessionId: musOutroDia.id } });
    expect([completion.perceivedEffort, completion.notes]).toEqual([8, 'puxado']);
    expect(await prisma.workoutCompletion.count({ where: { userId: s.userId } })).toBe(1);
    void mus;
  });

  it('evento fisico Polar + Apple Health: o vinculo do aluno sempre vai para a observacao CANONICA (a atividade conta uma vez)', async () => {
    const s = await student('evento');
    const run = await session(s, '2026-09-29', 'corrida', 40);
    const otherDay = await session(s, '2026-10-01', 'corrida', 40);
    const eventId = `evt-${Math.random().toString(36).slice(2, 8)}`;
    const polar = await activity(s, 'corrida', '2026-09-29T06:00', 41, 6, { physicalEventId: eventId, physicalIdentityStatus: 'matched' });
    const apple = await activity(s, 'corrida', '2026-09-29T06:00', 41, 6, { provider: 'apple_health', physicalEventId: eventId, physicalIdentityStatus: 'matched' });
    await prisma.activityLog.updateMany({ where: { id: { in: [polar.id, apple.id] } }, data: { physicalCanonicalActivityLogId: polar.id } });
    // link pelo id da observacao NAO canonica
    await service.linkActivityToSessionAsStudent(s.userId, apple.id, run.id);
    const links = await activeLinks({ trainingSessionId: run.id });
    expect(links.map((l) => l.activityLogId)).toEqual([polar.id]);
    // corrigir para outro treino: continua um unico vinculo, na canonica
    await service.linkActivityToSessionAsStudent(s.userId, apple.id, otherDay.id);
    expect((await activeLinks({ activityLogId: { in: [polar.id, apple.id] } })).map((l) => l.activityLogId)).toEqual([polar.id]);
  });

  it('os dois registros historicos da Polar (sport OTHER + STRENGTH_TRAINING): com a modalidade corrigida pela regra do normalizador, reconciliam com a musculacao e o feedback manual e preservado', async () => {
    const s = await student('historico');
    const mus30 = await session(s, '2026-09-30', 'forca', 45);
    const mus01 = await session(s, '2026-10-01', 'forca', 45);
    await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: mus30.id, status: 'done', perceivedEffort: 6, painFlag: 'none' } });
    await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: mus01.id, status: 'done', perceivedEffort: 5, painFlag: 'none' } });
    const a30 = await activity(s, 'OTHER', '2026-09-30T05:07', 52, null);
    const a01 = await activity(s, 'OTHER', '2026-10-01T05:04', 57.7, null);
    for (const a of [a30, a01]) expect(await service.classify(a.id)).toBe('alternative'); // estado historico: sport bruto OTHER => atividade alternativa
    // correcao pontual: modalidade pela regra oficial do normalizador + volta ao estado "nao classificado" (so' essas duas) e reconcilia
    const payload = { sport: 'OTHER', 'detailed-sport-info': 'STRENGTH_TRAINING' };
    expect(normalizePolarModality(payload)).toBe('forca');
    await prisma.activityLog.updateMany({ where: { id: { in: [a30.id, a01.id] }, sport: 'OTHER' }, data: { sport: normalizePolarModality(payload) } });
    await prisma.activityLog.updateMany({ where: { id: { in: [a30.id, a01.id] }, executionClassification: 'alternative', executionClassifiedBy: 'automatic' }, data: { executionClassification: null, executionClassifiedAt: null, executionClassifiedBy: null } });
    for (const a of [a30, a01]) expect(await service.classify(a.id)).toBe('corresponding');
    expect((await activeLinks({ trainingSessionId: mus30.id }))[0].activityLogId).toBe(a30.id);
    expect((await activeLinks({ trainingSessionId: mus01.id }))[0].activityLogId).toBe(a01.id);
    expect(await prisma.activityLog.count({ where: { userId: s.userId, executionClassification: 'alternative' } })).toBe(0); // deixam de ser extras (e de contar como "atividade adicional" no check-in)
    expect((await prisma.workoutCompletion.findUniqueOrThrow({ where: { sessionId: mus30.id } })).perceivedEffort).toBe(6); // feedback intacto
    expect(await prisma.trainingSession.count({ where: { userId: s.userId } })).toBe(2); // nenhuma sessao criada
  });
});
