import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PhysicalActivityIdentityService } from '../../src/activity-execution/physical-activity-identity.service';
import { SessionExecutionLinkService } from '../../src/activity-execution/session-execution-link.service';
import { IdentityConfirmationService } from '../../src/activity-execution/identity-confirmation.service';
import { EvolutionMetricService } from '../../src/evolution/evolution-metric.service';
import { decisionsOfEvidence } from '../../src/activity-execution/physical-identity-decisions';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Confirmacao de atividades ambiguas (aluno/treinador) em PostgreSQL REAL e dados sinteticos: JSON de evidencia, trava por aluno (advisory lock) com
// respostas concorrentes de verdade, reconciliacao, volume e sessoes prescritas intactas.

describe('confirmacao de identidade fisica (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const link = new SessionExecutionLinkService(prisma as never);
  const identity = new PhysicalActivityIdentityService(prisma as never);
  const confirmation = new IdentityConfirmationService(prisma as never, identity, link);
  const userIds: string[] = [];
  let seq = 0;

  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  async function student(label: string) {
    // Data recente (a pendencia do aluno so' considera atividades dos ultimos 60 dias).
    const s = await seedStudent(prisma, label, { startDate: new Date(Date.now() - 3 * 86_400_000) });
    userIds.push(s.userId);
    await prisma.workoutCompletion.deleteMany({ where: { userId: s.userId } });
    return s;
  }
  // startedAt e' o instante UTC; o corpo reproduz o exemplo do pedido (Polar 10,00 km/55 min x Health Connect 10,35 km/58 min, 2 min depois).
  async function activity(userId: string, provider: 'polar' | 'health_connect', startedAt: Date, minutes: number, km: number, pkg = 'fi.polar.polarflow', name = 'Polar Flow') {
    seq += 1;
    const externalId = `int-${seq}-${Math.random().toString(36).slice(2, 8)}`;
    const raw = await prisma.rawExternalActivity.create({ data: { userId, provider, externalId, payload: { origem: 'sintetico' } } });
    const providerMetrics = provider === 'polar'
      ? { endedAt: new Date(startedAt.getTime() + minutes * 60000).toISOString() }
      : { channel: 'health_connect', source: { packageName: pkg, name }, device: null, recordingMethod: 'actively_recorded', endedAt: new Date(startedAt.getTime() + minutes * 60000).toISOString() };
    const log = await prisma.activityLog.create({ data: { userId, provider, externalId, rawActivityId: raw.id, startedAt, utcOffsetMinutes: -180, sport: 'corrida', durationSec: minutes * 60, distanceMeters: km * 1000, providerMetrics } as never });
    const result = await identity.evaluateSafely(log.id);
    await link.classify(log.id);
    await link.reconcileAffectedByIdentity(result, log.id);
    return log;
  }
  const baseStart = () => { const d = new Date(Date.now() - 2 * 86_400_000); d.setUTCHours(10, 0, 0, 0); return d; };
  const ambiguousPair = async (userId: string) => {
    const p = await activity(userId, 'polar', baseStart(), 55, 10.0);
    const h = await activity(userId, 'health_connect', new Date(baseStart().getTime() + 120_000), 58, 10.35);
    return { p, h };
  };
  const fresh = (id: string) => prisma.activityLog.findUniqueOrThrow({ where: { id } });
  const counting = (userId: string) => prisma.activityLog.count({ where: { userId, executionClassification: { in: ['corresponding', 'alternative'] } } });
  const sessionsSnapshot = async (userId: string) => JSON.stringify(await prisma.trainingSession.findMany({ where: { userId }, orderBy: { id: 'asc' } }));
  const km = async (userId: string) => (await new EvolutionMetricService(prisma as never).getSeries(userId)).weeks.reduce((sum, w) => sum + (w.kmPercorridos ?? 0), 0);

  it('o exemplo do pedido fica ambiguo: UMA pendencia ao aluno, uma atividade conta; "mesma atividade" consolida e grava a decisao com autoria no JSON', async () => {
    const s = await student('mesma');
    const { p, h } = await ambiguousPair(s.userId);
    expect((await fresh(p.id)).physicalIdentityStatus).toBe('ambiguous');
    const pending = await confirmation.pendingForStudent(s.userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].observations.map((o) => [o.sourceLabel, o.channelLabel])).toEqual(expect.arrayContaining([['Polar', null], ['Polar Flow', 'via Health Connect']]));
    expect(await counting(s.userId)).toBe(1);
    const before = await sessionsSnapshot(s.userId);

    const result = await confirmation.resolveAsStudent(s.userId, { activityLogIds: [p.id, h.id], decision: 'same' });
    expect(result).toMatchObject({ status: 'resolved', decision: 'same', reevaluated: true });
    const [pAfter, hAfter] = [await fresh(p.id), await fresh(h.id)];
    expect(pAfter.physicalIdentityStatus).toBe('matched');
    expect(pAfter.physicalEventId).toBe(hAfter.physicalEventId);
    expect(hAfter.physicalCanonicalActivityLogId).toBe(p.id);
    expect(pAfter.distanceMeters).toBe(10000); // dado objetivo intacto
    expect(hAfter.distanceMeters).toBe(10350);
    expect(await counting(s.userId)).toBe(1);
    expect(await km(s.userId)).toBe(10);
    const decision = decisionsOfEvidence(hAfter.physicalIdentityEvidence).find((d) => d.id === result.decisionId)!;
    expect(decision).toMatchObject({ kind: 'same', actorRole: 'student', actorId: s.userId, status: 'active', state: 'applied' });
    expect(new Date(decision.decidedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await sessionsSnapshot(s.userId)).toBe(before); // sessoes prescritas intactas
    expect(await confirmation.pendingForStudent(s.userId)).toEqual([]);
  });

  it('"atividades diferentes": cada execucao conta uma vez e a mesma sessao prescrita nao e usada duas vezes; o treinador reverte e volta a uma so', async () => {
    const s = await student('distintas');
    // uma unica corrida prescrita no dia da atividade (o seed cria duas; com duas no mesmo dia a correspondencia seria ambigua por outro motivo)
    await prisma.trainingSession.deleteMany({ where: { id: s.sessionIds[1] } });
    await prisma.trainingSession.update({ where: { id: s.sessionIds[0] }, data: { scheduledDate: new Date(Date.UTC(baseStart().getUTCFullYear(), baseStart().getUTCMonth(), baseStart().getUTCDate())) } });
    const { p, h } = await ambiguousPair(s.userId);
    const before = await sessionsSnapshot(s.userId);
    await confirmation.resolveAsStudent(s.userId, { activityLogIds: [p.id, h.id], decision: 'distinct' });
    expect((await fresh(p.id)).physicalIdentityStatus).toBe('unique');
    expect((await fresh(h.id)).physicalIdentityStatus).toBe('unique');
    expect(await counting(s.userId)).toBe(2);
    const activeLinks = await prisma.sessionExecutionLink.findMany({ where: { userId: s.userId, status: 'active' } });
    expect(new Set(activeLinks.map((l) => l.trainingSessionId)).size).toBe(activeLinks.length); // nenhuma sessao com duas execucoes
    expect(await sessionsSnapshot(s.userId)).toBe(before);

    const reverted = await confirmation.revertAsCoach(s.userId, { id: 'coach-sintetico' }, p.id);
    expect(reverted.status).toBe('reverted');
    expect((await fresh(p.id)).physicalIdentityStatus).toBe('ambiguous');
    expect(await counting(s.userId)).toBe(1);
    const decision = decisionsOfEvidence((await fresh(h.id)).physicalIdentityEvidence)[0];
    expect(decision).toMatchObject({ status: 'reverted', revertedBy: { role: 'coach', id: 'coach-sintetico' } });
    expect(await sessionsSnapshot(s.userId)).toBe(before);
  });

  it('respostas SIMULTANEAS de verdade (trava por aluno): so uma vence, a outra recebe 409; resposta repetida tambem', async () => {
    const s = await student('concorrente');
    const { p, h } = await ambiguousPair(s.userId);
    const body = (decision: 'same' | 'distinct') => ({ activityLogIds: [p.id, h.id], decision });
    const outcomes = await Promise.allSettled([confirmation.resolveAsStudent(s.userId, body('same')), confirmation.resolveAsStudent(s.userId, body('distinct'))]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    const decisions = decisionsOfEvidence((await fresh(p.id)).physicalIdentityEvidence);
    expect(decisions).toHaveLength(1);
    await expect(confirmation.resolveAsStudent(s.userId, body('same'))).rejects.toBeInstanceOf(ConflictException);
    expect(await counting(s.userId)).toBe(decisions[0].kind === 'same' ? 1 : 2);
  });

  it('o aluno nao confirma registros de outro usuario; o treinador so age no aluno da rota; entradas invalidas sao recusadas', async () => {
    const owner = await student('dono');
    const intruder = await student('intruso');
    const { p, h } = await ambiguousPair(owner.userId);
    await expect(confirmation.resolveAsStudent(intruder.userId, { activityLogIds: [p.id, h.id], decision: 'same' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await confirmation.pendingForStudent(intruder.userId)).toEqual([]);
    await expect(confirmation.resolveAsCoach(intruder.userId, { id: 'coach-sintetico' }, h.id, 'same')).rejects.toBeInstanceOf(BadRequestException);
    await expect(confirmation.resolveAsStudent(owner.userId, { activityLogIds: [p.id], decision: 'same' })).rejects.toBeInstanceOf(BadRequestException);
    expect(decisionsOfEvidence((await fresh(p.id)).physicalIdentityEvidence)).toHaveLength(0);
    expect((await fresh(p.id)).physicalIdentityStatus).toBe('ambiguous');
  });

  it('conjunto misto (observacao divergente + duas fontes que concordam): uma conta, uma pendencia so do treinador, e a decisao do treinador resolve', async () => {
    const s = await student('misto');
    const { p, h } = await ambiguousPair(s.userId);
    const h2 = await activity(s.userId, 'health_connect', new Date(baseStart().getTime() + 60_000), 58, 10.34, 'com.strava', 'Strava');
    expect(await counting(s.userId)).toBe(1);
    expect(await confirmation.pendingForStudent(s.userId)).toEqual([]);
    const quality = await confirmation.quality(30);
    expect(quality.ambiguous.coachOnly).toBeGreaterThanOrEqual(1);
    await confirmation.resolveAsCoach(s.userId, { id: 'coach-sintetico' }, p.id, 'same');
    for (const id of [p.id, h.id, h2.id]) expect((await fresh(id)).physicalIdentityStatus).toBe('matched');
    expect(await counting(s.userId)).toBe(1);
    expect(await km(s.userId)).toBe(10);
  });

  // ---- Verificacao final: efeito nao concluido e reversao com feedback/sessao materializada (PostgreSQL real) ----------------------------------
  const completionsSnapshot = async (userId: string) => JSON.stringify(await prisma.workoutCompletion.findMany({ where: { userId }, orderBy: { id: 'asc' } }));
  const decisionsOf = async (id: string) => decisionsOfEvidence((await fresh(id)).physicalIdentityEvidence);

  it('efeito nao concluido (identidade/reconciliacao falham): decisao registrada uma vez, "em atualizacao" para o aluno, e a leitura seguinte reprocessa sozinha (filtro JSON real)', async () => {
    const s = await student('reprocesso');
    const { p, h } = await ambiguousPair(s.userId);
    const spy = jest.spyOn(identity, 'evaluateSafely').mockResolvedValue(null);
    const first = await confirmation.resolveAsStudent(s.userId, { activityLogIds: [p.id, h.id], decision: 'same' });
    expect(first).toMatchObject({ applied: false, retried: false });
    expect((await decisionsOf(p.id))[0].processedAt).toBeUndefined();
    expect((await confirmation.pendingForStudent(s.userId))[0]).toMatchObject({ status: 'processing' });
    const again = await confirmation.resolveAsStudent(s.userId, { activityLogIds: [p.id, h.id], decision: 'same' });
    expect(again).toMatchObject({ retried: true, decisionId: first.decisionId });
    expect(await decisionsOf(p.id)).toHaveLength(1);
    spy.mockRestore();
    expect(await confirmation.pendingForStudent(s.userId)).toEqual([]); // reprocessou sozinho
    expect((await fresh(p.id)).physicalIdentityStatus).toBe('matched');
    expect((await decisionsOf(p.id))[0].processedAt).toBeDefined();
    expect(await counting(s.userId)).toBe(1);
    expect(await km(s.userId)).toBe(10);

    // identidade aplicada, so' a reconciliacao falha: as linhas deixam de ser "ambiguous" e mesmo assim a leitura as encontra e conclui
    const t = await student('reprocesso-reconcilia');
    const pair = await ambiguousPair(t.userId);
    jest.spyOn(link, 'reconcileAffectedByIdentity').mockResolvedValueOnce(false);
    const partial = await confirmation.resolveAsStudent(t.userId, { activityLogIds: [pair.p.id, pair.h.id], decision: 'distinct' });
    expect(partial.applied).toBe(false);
    expect((await fresh(pair.p.id)).physicalIdentityStatus).toBe('unique');
    expect(await counting(t.userId)).toBe(1);
    expect(await confirmation.pendingForStudent(t.userId)).toEqual([]);
    expect((await decisionsOf(pair.p.id))[0].processedAt).toBeDefined();
    expect(await counting(t.userId)).toBe(2);
    expect(await decisionsOf(pair.p.id)).toHaveLength(1);
  });

  // Duas execucoes confirmadas como diferentes: p cumpre a sessao prescrita (com feedback do aluno); h e' a atividade adicional.
  async function distinctWithFeedback(label: string, options: { materializeExtra: boolean }) {
    const s = await student(label);
    await prisma.trainingSession.deleteMany({ where: { id: s.sessionIds[1] } });
    const day = new Date(Date.UTC(baseStart().getUTCFullYear(), baseStart().getUTCMonth(), baseStart().getUTCDate()));
    await prisma.trainingSession.update({ where: { id: s.sessionIds[0] }, data: { scheduledDate: day } });
    await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: s.sessionIds[0], status: 'done', durationMin: 55, distanceKm: 10, perceivedEffort: 6, painFlag: 'none' } });
    const { p, h } = await ambiguousPair(s.userId);
    await confirmation.resolveAsStudent(s.userId, { activityLogIds: [p.id, h.id], decision: 'distinct' });
    expect((await fresh(p.id)).executionClassification).toBe('corresponding');
    expect((await fresh(h.id)).executionClassification).toBe('alternative');
    let synthetic: { id: string } | null = null;
    if (options.materializeExtra) {
      const materialized = await link.materializeExtraActivity(h.id);
      synthetic = materialized!.session;
      await prisma.workoutCompletion.update({ where: { sessionId: synthetic.id }, data: { perceivedEffort: 7 } }); // feedback do aluno na atividade adicional
    }
    return { s, p, h, synthetic };
  }

  it('reversao com as DUAS execucoes registradas pelo aluno (feedback na sessao prescrita + sessao materializada com feedback): bloqueada (409), nada alterado, sem dupla contagem silenciosa', async () => {
    const { s, p, h } = await distinctWithFeedback('rev-bloqueada', { materializeExtra: true });
    const before = { sessions: await sessionsSnapshot(s.userId), completions: await completionsSnapshot(s.userId), km: await km(s.userId), count: await counting(s.userId) };
    const error = await confirmation.revertAsCoach(s.userId, { id: 'coach-sintetico' }, p.id).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'revert_blocked_by_student_records' });
    expect(await sessionsSnapshot(s.userId)).toBe(before.sessions);
    expect(await completionsSnapshot(s.userId)).toBe(before.completions); // feedbacks intactos
    expect(await km(s.userId)).toBe(before.km);
    expect(await counting(s.userId)).toBe(before.count);
    expect((await decisionsOf(h.id))[0]).toMatchObject({ status: 'active' }); // a decisao segue ativa e rastreavel
  });

  it('reversao quando so a execucao vinculada tem feedback: permitida; a adicional volta a ficar preservada sem contar; feedback e sessao prescrita preservados', async () => {
    const { s, p, h } = await distinctWithFeedback('rev-permitida', { materializeExtra: false });
    const before = { sessions: await sessionsSnapshot(s.userId), completions: await completionsSnapshot(s.userId) };
    const result = await confirmation.revertAsCoach(s.userId, { id: 'coach-sintetico' }, p.id);
    expect(result).toMatchObject({ status: 'reverted', applied: true, cleared: [h.id] });
    expect(await counting(s.userId)).toBe(1);
    expect((await fresh(h.id)).executionClassification).toBeNull();
    expect((await fresh(h.id)).physicalIdentityStatus).toBe('ambiguous');
    expect(await km(s.userId)).toBe(10);
    expect(await sessionsSnapshot(s.userId)).toBe(before.sessions);
    expect(await completionsSnapshot(s.userId)).toBe(before.completions);
    const links = await prisma.sessionExecutionLink.findMany({ where: { userId: s.userId, status: 'active' } });
    expect(links).toHaveLength(1);
    expect(links[0].activityLogId).toBe(p.id);
    expect((await decisionsOf(p.id))[0]).toMatchObject({ status: 'reverted', revertedBy: { role: 'coach', id: 'coach-sintetico' } });
  });
});
