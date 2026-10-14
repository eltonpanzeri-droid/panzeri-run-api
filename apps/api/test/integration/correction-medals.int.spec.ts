import { PrismaClient } from '@prisma/client';
import { SessionExecutionLinkService } from '../../src/activity-execution/session-execution-link.service';
import { correctionHooks } from '../../src/activity-execution/correction-hooks';
import { markPending, processDueReevaluations, processPendingReevaluation, readPending, registerMedalProcessor } from '../../src/activity-execution/pending-reevaluation';
import { EvolutionMetricService } from '../../src/evolution/evolution-metric.service';
import { MedalEvaluationService } from '../../src/medals/medal-evaluation.service';
import { MedalsService } from '../../src/medals/medals.service';
import { applyAwardActions } from '../../src/medals/medal-award-persistence';
import { StudentProfileService } from '../../src/training-plans/student-profile.service';
import { createTestPrisma, testDatabaseUrl } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Correcao de atividade x indicadores x medalhas x pendencia duravel, em PostgreSQL REAL de teste (dados sinteticos). Verificacao final enxuta: concessao/revogacao/
// reativacao com historico, atualizacao sem gerar treino, pendencia que sobrevive a "reinicio" (outro cliente de banco) e concorrencia sem perda.

describe('correcao de atividade, medalhas e pendencia (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];

  beforeAll(async () => {
    // catalogo minimo (codigo e' unico no banco; upsert)
    for (const [code, category, threshold] of [['treinos_concluidos_10', 'treinos_concluidos', 10], ['volume_semanal_corrida_30km', 'volume_semanal', 30]] as const) {
      await prisma.achievement.upsert({ where: { code }, create: { code, category, name: code, description: 'sintetica', threshold, criteria: {} }, update: {} });
    }
  });
  afterEach(() => { correctionHooks.clear(); registerMedalProcessor(null); });
  afterAll(async () => {
    const where = { userId: { in: userIds } };
    await prisma.userAchievementTransition.deleteMany({ where });
    await prisma.userAchievement.deleteMany({ where });
    await prisma.correctionReevaluation.deleteMany({ where });
    await cleanupStudents(prisma, userIds);
    await prisma.$disconnect();
  });

  async function student(label: string) {
    const s = await seedStudent(prisma, label, { startDate: new Date('2026-10-12T00:00:00.000Z') });
    userIds.push(s.userId);
    await prisma.workoutCompletion.deleteMany({ where: { userId: s.userId } });
    await prisma.trainingSession.deleteMany({ where: { userId: s.userId } });
    return s;
  }
  const wire = (db: PrismaClient) => {
    const medals = new MedalEvaluationService(db as never, new EvolutionMetricService(db as never));
    const profile = new StudentProfileService(db as never, {} as never);
    medals.onModuleInit();
    profile.onModuleInit();
    return { medals, profile };
  };

  it('correcao de vinculo: feedback movido nao tira a medalha; remocao de feedback REVOGA; novo treino REATIVA; historico preservado; Prontuario atualizado; nenhum treino gerado', async () => {
    const s = await student('medalha');
    const link = new SessionExecutionLinkService(prisma as never);
    const { medals } = wire(prisma);

    // 9 treinos concluidos de verdade
    for (let i = 1; i <= 9; i++) {
      const session = await prisma.trainingSession.create({ data: { planId: s.planId, userId: s.userId, scheduledDate: new Date(`2026-10-0${i}T00:00:00.000Z`), weekday: 1, modality: 'forca', title: 'Forca', structure: { type: 'strength' }, origin: 'agent' } as never });
      await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: session.id, status: 'done' } });
    }
    // atividade externa de corrida (sem prescrito no dia => extra) materializada como sessao sintetica concluida: e' o 10o treino
    const raw = await prisma.rawExternalActivity.create({ data: { userId: s.userId, provider: 'polar', externalId: `ext-${s.userId}`, payload: { origem: 'sintetico' } } });
    const activity = await prisma.activityLog.create({ data: { userId: s.userId, provider: 'polar', externalId: `ext-${s.userId}`, rawActivityId: raw.id, startedAt: new Date('2026-10-12T09:00:00Z'), utcOffsetMinutes: -180, sport: 'corrida', durationSec: 2400, distanceMeters: 6000, avgHeartRateBpm: 130 } as never });
    expect(await link.classify(activity.id)).toBe('alternative');
    await link.materializeExtraActivity(activity.id);
    // treino prescrito no mesmo dia (ainda sem registro)
    const prescribed = await prisma.trainingSession.create({ data: { planId: s.planId, userId: s.userId, scheduledDate: new Date('2026-10-12T00:00:00.000Z'), weekday: 1, modality: 'corrida', title: 'Corrida', durationMin: 40, distanceKm: 6, structure: { type: 'run' }, origin: 'agent' } as never });

    // concessao pelo gatilho comum (10 concluidos)
    expect(await medals.evaluateForUser(s.userId, 'workout_completed')).toContain('treinos_concluidos_10');
    const award = await prisma.userAchievement.findFirstOrThrow({ where: { userId: s.userId } });
    expect(award.status).toBe('active');
    const plansBefore = await prisma.trainingPlan.count({ where: { userId: s.userId } });
    const sessionsBefore = await prisma.trainingSession.count({ where: { userId: s.userId } });

    // CORRECAO 1 (real): o aluno vincula a atividade ao treino prescrito. O feedback da sessao extra e' MOVIDO (nao perdido): continuam 10 concluidos, entao a medalha
    // NAO e' perdida — correcao nao significa perda. Nenhuma transicao nova; Prontuario e pendencia tratados.
    const since = new Date();
    const linked = await link.linkActivityToSessionAsStudent(s.userId, activity.id, prescribed.id);
    expect(linked).toMatchObject({ feedbackMovedFromExtraSession: true, syntheticRemoved: true });
    expect((await prisma.userAchievement.findUniqueOrThrow({ where: { id: award.id } })).status).toBe('active');
    expect(await prisma.userAchievementTransition.count({ where: { userAchievementId: award.id } })).toBe(1); // so' o 'granted'
    expect(await readPending(prisma as never, s.userId)).toBeNull();
    const events = await prisma.studentProfileEvent.findMany({ where: { userId: s.userId, code: 'EXECUTION_LINK_CORRECTED' } });
    expect(events).toHaveLength(1);
    expect(events[0].content).toContain('agora cumpre o treino prescrito');
    expect(await prisma.trainingPlan.count({ where: { userId: s.userId } })).toBe(plansBefore); // nenhum programa gerado
    expect(await prisma.trainingSession.count({ where: { userId: s.userId } })).toBe(sessionsBefore - 1); // so' a sessao sintetica saiu; nenhum treino novo

    // CORRECAO 2 (real no banco): o feedback desse treino e' removido (conclusoes = 9) e a correcao passa pelo MESMO ponto central -> criterio deixa de ser atendido
    await prisma.workoutCompletion.delete({ where: { sessionId: prescribed.id } });
    await link.recomputeAfterCorrection(s.userId, since, { origin: 'student', actorId: s.userId, kind: 'link_correction', completionsChanged: true });
    const revoked = await prisma.userAchievement.findUniqueOrThrow({ where: { id: award.id } });
    expect(revoked).toMatchObject({ status: 'revoked', revokedReason: 'criterio_nao_atendido' });
    expect(revoked.revokedAt).not.toBeNull();
    expect(await prisma.userAchievement.count({ where: { userId: s.userId } })).toBe(1); // registro preservado
    expect(await readPending(prisma as never, s.userId)).toBeNull(); // pendencia concluida
    expect(await prisma.trainingPlan.count({ where: { userId: s.userId } })).toBe(plansBefore);

    // leitura do aluno: revogada com motivo; nao esta em "conquistadas"
    const view = new MedalsService(prisma as never, new EvolutionMetricService(prisma as never), medals);
    const summary = await view.getSummary(s.userId);
    expect(summary.unlocked.map((m) => m.code)).not.toContain('treinos_concluidos_10');
    expect(summary.revoked.map((m) => m.code)).toEqual(['treinos_concluidos_10']);
    expect(summary.pending.updating).toBe(false);

    // o aluno registra mais um treino: o criterio volta -> REATIVADA (mesma linha, unlockedAt preservado)
    const extra = await prisma.trainingSession.create({ data: { planId: s.planId, userId: s.userId, scheduledDate: new Date('2026-10-10T00:00:00.000Z'), weekday: 5, modality: 'forca', title: 'Forca', structure: { type: 'strength' }, origin: 'agent' } as never });
    await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: extra.id, status: 'done' } });
    expect(await medals.evaluateForUser(s.userId, 'workout_completed')).toContain('treinos_concluidos_10');
    const back = await prisma.userAchievement.findUniqueOrThrow({ where: { id: award.id } });
    expect(back).toMatchObject({ status: 'active', revokedAt: null, revokedReason: null });
    expect(back.unlockedAt).toEqual(award.unlockedAt);
    const transitions = await prisma.userAchievementTransition.findMany({ where: { userAchievementId: award.id }, orderBy: { at: 'asc' } });
    expect(transitions.map((t) => t.type)).toEqual(['granted', 'revoked', 'reactivated']);
    expect(transitions.every((t) => t.ruleVersion === 1)).toBe(true);
  });

  it('pendencia SOBREVIVE a reinicio (outro cliente de banco) e e retomada pelo varredor; correcoes concorrentes sao todas preservadas', async () => {
    const s = await student('pendencia');
    // concorrencia: 8 marcacoes simultaneas — nenhuma sobrescreve outra
    await Promise.all(Array.from({ length: 8 }, (_, i) => markPending(prisma as never, s.userId, { analysisSessionIds: [`sess-${i}`], medals: { categories: ['treinos_concluidos'], weeks: [`2026-10-0${i + 1}`], months: ['2026-10'], countsChanged: true, causes: [{ kind: 'link_correction', i }] } })));
    const marked = await readPending(prisma as never, s.userId);
    expect(marked?.analysisSessionIds.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `sess-${i}`).sort());
    expect(marked?.version).toBe(8);
    expect(marked?.medalScope?.weeks).toHaveLength(8);

    // "reinicio": cliente novo, servicos novos, nada em memoria
    await prisma.$disconnect();
    const restarted = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
    try {
      let calls = 0;
      registerMedalProcessor(async () => { calls += 1; await new Promise((r) => setTimeout(r, 150)); return { complete: true }; });
      // dois processadores ao mesmo tempo: so' um trabalha (lease), o outro encontra "busy"
      const [a, b] = await Promise.all([processPendingReevaluation(restarted as never, s.userId), processPendingReevaluation(restarted as never, s.userId)]);
      expect([a.status, b.status].sort()).toEqual(['busy', 'done']);
      expect(calls).toBe(1);
      expect(await readPending(restarted as never, s.userId)).toBeNull();

      // e o varredor retoma uma pendencia deixada para tras
      await markPending(restarted as never, s.userId, { medals: { categories: ['feedbacks'], countsChanged: true, causes: [] } });
      const sweep = await processDueReevaluations(restarted as never);
      expect(sweep.processed).toBeGreaterThanOrEqual(1);
      expect(calls).toBe(2);
      expect(await readPending(restarted as never, s.userId)).toBeNull();
    } finally {
      await restarted.$disconnect();
      Object.assign(prisma, new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } }));
    }
  });
});

describe('concorrencia de escrita de medalhas (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  afterAll(async () => {
    const where = { userId: { in: userIds } };
    await prisma.userAchievementTransition.deleteMany({ where });
    await prisma.userAchievement.deleteMany({ where });
    await cleanupStudents(prisma, userIds);
    await prisma.$disconnect();
  });

  it('duas revogacoes simultaneas da mesma concessao: uma aplica, a outra e conflito; exatamente 1 transicao', async () => {
    const s = await seedStudent(prisma, 'concorrencia');
    userIds.push(s.userId);
    const achievement = await prisma.achievement.findUniqueOrThrow({ where: { code: 'treinos_concluidos_10' } });
    const row = await prisma.userAchievement.create({ data: { userId: s.userId, achievementId: achievement.id, value: 12, evidence: { totalAtUnlock: 12 } } });
    const existing = { id: row.id, code: achievement.code, category: 'treinos_concluidos', threshold: 10, criteria: {}, catalogVersion: 1, awardedVersion: 1, value: 12, periodStart: null, periodEnd: null, evidence: row.evidence, status: 'active' };
    const revoke = () => applyAwardActions(prisma as never, s.userId, [{ kind: 'revoke', code: achievement.code, reason: 'criterio_nao_atendido', existing }], [{ id: achievement.id, code: achievement.code, ruleVersion: 1 }], { trigger: 'link_correction', cause: null });
    const [a, b] = await Promise.all([revoke(), revoke()]);
    expect(a.revoked.length + b.revoked.length).toBe(1);
    expect(a.conflicts.length + b.conflicts.length).toBe(1);
    expect(await prisma.userAchievementTransition.count({ where: { userAchievementId: row.id } })).toBe(1);
  });
});
