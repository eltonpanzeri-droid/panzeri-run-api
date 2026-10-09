import { PrismaClient } from '@prisma/client';
import { ProviderDataDeletionService } from '../../src/activity-execution/provider-data-deletion.service';
import { ExecutionAnalysisService } from '../../src/activity-execution/execution-analysis.service';
import { PrescriptionAgentService, PaceEvidence } from '../../src/training-plans/prescription-agent.service';
import { AgentCallTrace, EvidenceItem, recordAgentCall } from '../../src/training-plans/prescription-trace';
import { PrescriptionTraceService } from '../../src/training-plans/prescription-trace.service';
import { StudentProfileService } from '../../src/training-plans/student-profile.service';
import { TrainingAnalystService } from '../../src/training-plans/training-analyst.service';
import { AnalysisContract } from '../../src/training-plans/training-analyst';
import { computeRunSlots, computeStrengthSlots, MethodologyInput, WeeklyMethodologyDecision } from '../../src/training-plans/training-methodology';
import { TrainingPlansService } from '../../src/training-plans/training-plans.service';
import { NORMALIZATION_VERSION } from '../../src/activity-timeseries/activity-timeseries.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Etapa 2.2 — Analista de Treinos em PostgreSQL 17 real (dados sinteticos). O Prescritor e' simulado e CONTA suas chamadas: o Analista nao pode adicionar nenhuma.

class FakeAgent extends PrescriptionAgentService {
  weeklyCalls = 0;
  lastInput: MethodologyInput | null = null;
  constructor() { super({ get: () => undefined } as never, {} as never); }
  async proposeWeeklyDecision(input: MethodologyInput, evidence: PaceEvidence, trace?: AgentCallTrace[]): Promise<WeeklyMethodologyDecision | null> {
    this.weeklyCalls++;
    this.lastInput = input;
    const self = this as unknown as { buildUserPrompt: (...args: unknown[]) => string; buildSystemPromptStable: () => string; buildSafetyGuidance: (a: boolean, b: boolean) => string };
    const runSlots = computeRunSlots(input.availability);
    const userPrompt = self.buildUserPrompt(input, runSlots, computeStrengthSlots(input.availability), false, false, evidence, input.painReason ?? null);
    recordAgentCall(trace, { purpose: 'semana', model: 'claude-sonnet-5', system: `${self.buildSystemPromptStable()}\n${self.buildSafetyGuidance(false, false)}`, userPrompt });
    return { sessions: runSlots.map((slot) => ({ weekday: slot.weekday, title: 'Corrida', durationMin: slot.durationMin, notes: 'n', parts: [{ kind: 'continua' as const, distanceKm: 5, paceSecondsPerKmMin: 480, paceSecondsPerKmMax: 480 }] })), strengthSessions: [], recommendation: 'r', rationale: ['d'], safetyAdjustment: false } as unknown as WeeklyMethodologyDecision;
  }
}

type Leg = { km: number; pace: number };
const block = (label: string, km: number, range: string) => ({ label, distanceValue: km, distanceUnit: 'km', paceRange: range });
const intervalStructure = { blocks: [block('Aquecimento', 1, '6:30/km a 7:00/km'), { label: 'Tiros', repeatCount: 6, steps: [block('Forte', 0.4, '4:00/km a 4:20/km'), block('Leve', 0.2, '6:00/km a 6:30/km')] }, block('Desaquecimento', 1, '6:30/km a 7:00/km')] };
function series(legs: Leg[]) {
  const points: Array<{ offsetSec: number; distanceMeters: number; heartRateBpm: number; cadenceSpm: number }> = [{ offsetSec: 0, distanceMeters: 0, heartRateBpm: 140, cadenceSpm: 170 }];
  let t = 0; let d = 0;
  for (const leg of legs) { const end = d + leg.km * 1000; while (d < end - 1e-6) { t += 1; d = Math.min(end, d + 1000 / leg.pace); points.push({ offsetSec: t, distanceMeters: d, heartRateBpm: 150, cadenceSpm: 170 }); } }
  return points;
}
const reps = (n: number, fast: number, easy: number): Leg[] => Array.from({ length: n }, () => [{ km: 0.4, pace: fast }, { km: 0.2, pace: easy }]).flat();
const properInterval = () => series([{ km: 1, pace: 405 }, ...reps(6, 250, 375), { km: 1, pace: 405 }]);
const continuousAccel = () => series([{ km: 1, pace: 405 }, { km: 3.4, pace: 330 }, { km: 1.1, pace: 262 }]);

describe('Analista de Treinos (PostgreSQL 17 real, dados sinteticos)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const agent = new FakeAgent();
  const trace = new PrescriptionTraceService(prisma as never, { get: () => undefined } as never);
  const execution = new ExecutionAnalysisService(prisma as never);
  // O motor matematico REAL (getVariableSnapshot) so' precisa do banco; aqui devolvemos snapshots minimos para nao montar o modulo inteiro.
  const intelligence = { getVariableSnapshot: async () => { throw new Error('janelas indisponiveis no teste'); } };
  const analyst = new TrainingAnalystService(prisma as never, execution, intelligence as never);
  const deletion = new ProviderDataDeletionService(prisma as never);

  function plansService() {
    const studentProfile = new StudentProfileService(prisma as never, { condenseProfile: async () => null } as never);
    return new TrainingPlansService(
      prisma as never, agent as never, { computeSafetyTier: async () => ({ tier: 'normal', reason: null }) } as never, { activeGoals: async () => [] } as never,
      { notifyCoach: jest.fn().mockResolvedValue(undefined) } as never, studentProfile as never, { notifyUser: async () => undefined } as never, {} as never,
      { getAgentContext: async () => null } as never, { getSnapshot: async () => { throw new Error('snapshot indisponivel no teste'); } } as never,
      { isReassessmentDue: async () => false, getLatestValidEvolutionReport: async () => null } as never,
      { retryStalledAnalyses: async () => ({ attempted: 0, resolved: 0, stillPending: 0 }) } as never, {} as never, {} as never, trace, execution, analyst,
    );
  }
  const generate = (userId: string) => (plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(userId);

  async function addExecuted(student: Awaited<ReturnType<typeof seedStudent>>, label: string, date: string, points: ReturnType<typeof series>, options: { structure?: unknown; extra?: boolean; rpe?: number; behavior?: string } = {}) {
    const session = await prisma.trainingSession.create({
      data: {
        planId: student.planId, userId: student.userId, scheduledDate: new Date(`${date}T00:00:00Z`), weekday: 3, modality: 'corrida', title: 'Corrida', origin: options.extra ? 'device_extra' : 'agent',
        structure: (options.structure ?? { type: 'run' }) as never, distanceKm: options.extra ? null : 5.6, durationMin: options.extra ? null : 40,
      },
    });
    const last = points[points.length - 1];
    const raw = await prisma.rawExternalActivity.create({ data: { userId: student.userId, provider: 'polar', externalId: `polar-${label}-${date}`, payload: { origem: 'sintetico' } } });
    const activity = await prisma.activityLog.create({ data: { userId: student.userId, provider: 'polar', externalId: `polar-${label}-${date}`, rawActivityId: raw.id, startedAt: new Date(`${date}T08:00:00Z`), durationSec: last.offsetSec, distanceMeters: last.distanceMeters, avgHeartRateBpm: 150, cadenceAvg: 170, sport: 'running' } });
    await prisma.activityTimeSeriesPoint.createMany({ data: points.map((p) => ({ activityLogId: activity.id, provider: 'polar', normalizationVersion: NORMALIZATION_VERSION, ...p })) });
    await prisma.sessionExecutionLink.create({ data: { userId: student.userId, trainingSessionId: session.id, activityLogId: activity.id, status: 'active', origin: 'automatic' } });
    if (!options.extra || options.rpe) await prisma.workoutCompletion.create({ data: { userId: student.userId, sessionId: session.id, status: 'done', distanceKm: last.distanceMeters / 1000, durationMin: last.offsetSec / 60, perceivedEffort: options.rpe ?? null, executionBehavior: options.behavior ?? null, painFlag: 'none' } });
    return { session, activity };
  }

  async function seedStudentWithHistory(label: string, options: { previousWeekExecuted: 'continuo' | 'intervalado' | 'nenhum'; priorIntervals: number }) {
    const student = await seedStudent(prisma, label, { startDate: new Date('2026-10-05T00:00:00.000Z') });
    userIds.push(student.userId);
    await prisma.onboardingInterview.create({ data: { userId: student.userId, answers: { weekly_running_km: '10-20' }, completedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.weeklyAvailability.createMany({ data: [{ userId: student.userId, weekday: 2, modality: undefined as never, modalities: ['corrida'], availableMin: 40 } as never, { userId: student.userId, weekday: 4, modalities: ['corrida'], availableMin: 45 }] });
    await prisma.userPreferences.create({ data: { userId: student.userId, mainGoal: 'Correr 10km', preferredModalities: ['corrida'], otherModalities: [], trainingLocations: [] } });
    // semana anterior (05/10): s0 prescrita como intervalado
    await prisma.trainingSession.update({ where: { id: student.sessionIds[0] }, data: { structure: intervalStructure, distanceKm: 5.6, durationMin: 40 } });
    await prisma.workoutCompletion.deleteMany({ where: { sessionId: student.sessionIds[0] } });
    if (options.previousWeekExecuted !== 'nenhum') {
      const points = options.previousWeekExecuted === 'continuo' ? continuousAccel() : properInterval();
      const last = points[points.length - 1];
      const raw = await prisma.rawExternalActivity.create({ data: { userId: student.userId, provider: 'polar', externalId: `polar-${label}-prev`, payload: { origem: 'sintetico' } } });
      const activity = await prisma.activityLog.create({ data: { userId: student.userId, provider: 'polar', externalId: `polar-${label}-prev`, rawActivityId: raw.id, startedAt: new Date('2026-10-06T08:00:00Z'), durationSec: last.offsetSec, distanceMeters: last.distanceMeters, avgHeartRateBpm: 150, cadenceAvg: 170, sport: 'running' } });
      await prisma.activityTimeSeriesPoint.createMany({ data: points.map((p) => ({ activityLogId: activity.id, provider: 'polar', normalizationVersion: NORMALIZATION_VERSION, ...p })) });
      await prisma.sessionExecutionLink.create({ data: { userId: student.userId, trainingSessionId: student.sessionIds[0], activityLogId: activity.id, status: 'active', origin: 'automatic' } });
      await prisma.workoutCompletion.create({ data: { userId: student.userId, sessionId: student.sessionIds[0], status: 'done', distanceKm: last.distanceMeters / 1000, durationMin: last.offsetSec / 60, perceivedEffort: 6, painFlag: 'none' } });
    }
    for (let i = 0; i < options.priorIntervals; i++) {
      const date = new Date(Date.parse('2026-10-01T00:00:00Z') - (i + 1) * 9 * 86_400_000).toISOString().slice(0, 10);
      await addExecuted(student, label, date, properInterval(), { structure: intervalStructure, rpe: 6 });
    }
    return student;
  }

  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-10-12T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
  afterAll(async () => { jest.useRealTimers(); await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  describe('aluna com historico: intervalado prescrito e CONTINUO executado na semana anterior', () => {
    let ana: Awaited<ReturnType<typeof seedStudentWithHistory>>;
    let planId: string;
    let snapshot: string;

    beforeAll(async () => { ana = await seedStudentWithHistory('ana-analista', { previousWeekExecuted: 'continuo', priorIntervals: 5 }); });

    it('1) a geracao semanal usa o Analista SEM nenhuma chamada de IA adicional e entrega os achados ao Prescritor', async () => {
      const callsBefore = agent.weeklyCalls;
      const plan = await generate(ana.userId);
      planId = plan.id;
      expect(agent.weeklyCalls - callsBefore).toBe(1); // a unica chamada de IA continua sendo a do Prescritor
      const evidence = agent.lastInput!.trainingAnalysis as { natureza: string; semana: { achados: Array<{ codigo: string }> } | null; treinosDaSemana: Array<{ codigo: string; texto: string }>; evolucao: { capacidades: Array<{ texto: string }> } };
      expect(evidence.natureza).toMatch(/Nao sao prescricao nem prova de causa/);
      const divergence = evidence.treinosDaSemana.find((f) => f.codigo === 'estrutura_executada_difere_da_prescrita')!;
      expect(divergence.texto).toMatch(/previa 6 alternâncias/);
      expect(divergence.texto).toMatch(/contínuo com aceleração final/);
      expect(divergence.texto).toMatch(/ocorreu 0 vez\(es\)|última sessão com esforços intervalados reconhecidos foi há/);
      expect(evidence.evolucao.capacidades.some((c) => /Formato recorrente/.test(c.texto))).toBe(true);
      // o texto enviado a IA contem os achados (e nenhuma ordem de prescricao)
      const pkg = await prisma.prescriptionEvidencePackage.findFirstOrThrow({ where: { planId: plan.id, kind: 'weekly' } });
      const prompt = JSON.parse((pkg.agentInput as unknown as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt);
      expect(prompt.analiseTecnicaDoAnalistaDeTreinos.evolucao.capacidades.length).toBeGreaterThan(0);
      expect(JSON.stringify(prompt.analiseTecnicaDoAnalistaDeTreinos)).not.toMatch(/prescrev|na próxima semana/i);
      // tamanho do que foi acrescentado ao prompt: poucos milhares de caracteres (~1 mil tokens no maximo)
      expect(JSON.stringify(prompt.analiseTecnicaDoAnalistaDeTreinos).length).toBeLessThan(6000);
      // rastreabilidade: item do indice com proveniencia de dispositivo
      expect((pkg.evidence as unknown as EvidenceItem[]).find((e) => e.ref === 'training_analysis')).toMatchObject({ kind: 'training_analysis', providers: ['polar'] });
    });

    it('2) contrato persistido: sessao (viva), semana e evolucao (retratos entregues com o programa), com fontes e sem duplicar series', async () => {
      const rows = await prisma.trainingAnalysis.findMany({ where: { userId: ana.userId } });
      const byScope = (scope: string) => rows.filter((r) => r.scope === scope);
      expect(byScope('longitudinal')).toHaveLength(1);
      expect(byScope('week')).toHaveLength(1);
      expect(byScope('longitudinal')[0].deliveredWithPlanId).toBe(planId);
      expect(byScope('week')[0]).toMatchObject({ deliveredWithPlanId: planId, status: 'active', refKey: '2026-10-05' });
      expect(byScope('session').every((r) => r.deliveredWithPlanId === null)).toBe(true);
      const contract = byScope('week')[0].contract as unknown as AnalysisContract;
      expect(contract).toMatchObject({ schema: 'training-analysis/1', scope: 'week', evidence: { madeWithoutAI: true, providers: ['polar'] } });
      for (const group of ['facts', 'reported', 'findings', 'gaps', 'capabilities', 'changes']) expect(Array.isArray((contract as unknown as Record<string, unknown>)[group])).toBe(true);
      expect(contract.findings.every((f) => f.id && f.code && f.statement)).toBe(true);
      expect(JSON.stringify(rows.map((r) => r.contract))).not.toContain('offsetSec');
      // o contrato da sessao divergente separa MEDIDO / RELATADO / INTERPRETACAO / LACUNA
      const session = byScope('session').find((r) => r.refKey === ana.sessionIds[0])!.contract as unknown as AnalysisContract;
      expect(session.facts.map((f) => f.code)).toContain('estimulo_executado');
      expect(session.reported.map((f) => f.code)).toContain('esforco_percebido');
      expect(session.findings.map((f) => f.code)).toContain('estrutura_executada_difere_da_prescrita');
      expect(session.gaps.map((f) => f.code)).toEqual(expect.arrayContaining(['motivo_da_diferenca_nao_informado', 'intencao_da_prescricao_indisponivel']));
      snapshot = JSON.stringify(byScope('week')[0].contract) + JSON.stringify(byScope('longitudinal')[0].contract);
    });

    it('3) feedback que explica a alteracao entra como relato e a analise viva muda; o retrato entregue NAO muda e nenhum treino e regenerado', async () => {
      const plansBefore = await prisma.trainingPlan.count({ where: { userId: ana.userId } });
      await prisma.workoutCompletion.update({ where: { sessionId: ana.sessionIds[0] }, data: { executionBehavior: 'different_workout', adjustmentReasons: ['preferi fazer outro treino'] } });
      await execution.analyzeSession(ana.userId, ana.sessionIds[0], { force: true });
      await analyst.buildForGeneration(ana.userId, new Date('2026-10-12T00:00:00Z'), { startDate: new Date('2026-10-05T00:00:00Z'), sessionIds: ana.sessionIds, indicators: null });
      const live = (await prisma.trainingAnalysis.findFirstOrThrow({ where: { userId: ana.userId, scope: 'session', refKey: ana.sessionIds[0] } })).contract as unknown as AnalysisContract;
      expect(live.reported.map((f) => f.code)).toEqual(expect.arrayContaining(['comportamento_declarado', 'motivos_de_ajuste_declarados']));
      expect(live.gaps.map((f) => f.code)).not.toContain('motivo_da_diferenca_nao_informado');
      expect(live.findings.map((f) => f.code)).toContain('diferenca_com_declaracao_do_aluno');
      const frozenWeek = (await prisma.trainingAnalysis.findFirstOrThrow({ where: { userId: ana.userId, scope: 'week', deliveredWithPlanId: planId } })).contract;
      const frozenLong = (await prisma.trainingAnalysis.findFirstOrThrow({ where: { userId: ana.userId, scope: 'longitudinal', deliveredWithPlanId: planId } })).contract;
      expect(JSON.stringify(frozenWeek) + JSON.stringify(frozenLong)).toBe(snapshot);
      expect(await prisma.trainingAnalysis.count({ where: { userId: ana.userId, scope: 'session', refKey: ana.sessionIds[0] } })).toBe(1); // sem duplicar
      expect(await prisma.trainingPlan.count({ where: { userId: ana.userId } })).toBe(plansBefore);
    });

    it('4) leitura para o treinador/Prontuario (por escopo) e exclusao de dados do provedor: vivos apagados, retratos invalidados, texto guardado da decisao sem os achados', async () => {
      expect((await analyst.read(ana.userId, { scope: 'week', planId })).length).toBe(1);
      const result = await deletion.executeProviderDataDeletion(ana.userId, 'polar');
      expect(result.analystContracts).toBeGreaterThanOrEqual(3);
      const remaining = await prisma.trainingAnalysis.findMany({ where: { userId: ana.userId, scope: 'session', status: 'active' } });
      expect(remaining.every((r) => ((r.sources as { providers?: string[] }).providers ?? []).length === 0)).toBe(true); // so sobram sessoes sem dado de dispositivo
      const week = await prisma.trainingAnalysis.findFirstOrThrow({ where: { userId: ana.userId, scope: 'week', deliveredWithPlanId: planId } });
      expect(week).toMatchObject({ status: 'invalidated', contract: {}, invalidatedProviders: ['polar'] });
      const pkg = await prisma.prescriptionEvidencePackage.findFirstOrThrow({ where: { planId, kind: 'weekly' } });
      const prompt = JSON.parse((pkg.agentInput as unknown as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt);
      expect(prompt.analiseTecnicaDoAnalistaDeTreinos).toBeNull();
      expect(prompt.objetivo).toBe('Correr 10km');
      expect((pkg.evidence as unknown as EvidenceItem[]).find((e) => e.kind === 'training_analysis')).toMatchObject({ providers: [], invalidatedProviders: ['polar'] });
    });
  });

  it('intervalados repetidos acima das faixas + atividade por iniciativa do aluno + formato recorrente: aparecem como achados, sem recomendacao', async () => {
    const bia = await seedStudentWithHistory('bia-analista', { previousWeekExecuted: 'intervalado', priorIntervals: 0 });
    const fast = () => series([{ km: 1, pace: 405 }, ...reps(6, 215, 375), { km: 1, pace: 405 }]);
    for (const date of ['2026-08-20', '2026-09-03', '2026-09-17', '2026-09-27', '2026-10-01']) await addExecuted(bia, 'bia', date, fast(), { structure: intervalStructure, rpe: 8 });
    await addExecuted(bia, 'bia-extra', '2026-10-08', series([{ km: 1, pace: 400 }, ...Array.from({ length: 5 }, () => [{ km: 1, pace: 240 }, { km: 0.4, pace: 400 }]).flat(), { km: 1, pace: 400 }]), { extra: true, rpe: 7 });
    await generate(bia.userId);
    const evidence = agent.lastInput!.trainingAnalysis as { semana: { achados: Array<{ codigo: string }> }; evolucao: { achados: Array<{ codigo: string; texto: string }> } };
    expect(evidence.evolucao.achados.map((a) => a.codigo)).toContain('intensidade_acima_da_faixa_recorrente');
    expect(evidence.semana.achados.map((a) => a.codigo)).toContain('atividades_sem_prescricao');
    const week = (await prisma.trainingAnalysis.findFirstOrThrow({ where: { userId: bia.userId, scope: 'week' } })).contract as unknown as AnalysisContract;
    expect(week.findings.find((f) => f.code === 'atividades_sem_prescricao')!.statement).toMatch(/1 atividade\(s\) por iniciativa do aluno/);
    expect(JSON.stringify(evidence)).not.toMatch(/prescrev|aumentar|reduzir|próxima semana/i);
  });

  it('historico insuficiente e dados ausentes: lacunas explicitas, sem conclusao, e a geracao segue (contrato valido mesmo sem achados)', async () => {
    const cris = await seedStudentWithHistory('cris-analista', { previousWeekExecuted: 'intervalado', priorIntervals: 0 });
    const callsBefore = agent.weeklyCalls;
    const plan = await generate(cris.userId);
    expect(plan.id).toBeTruthy();
    expect(agent.weeklyCalls - callsBefore).toBe(1);
    const session = (await prisma.trainingAnalysis.findFirstOrThrow({ where: { userId: cris.userId, scope: 'session', refKey: cris.sessionIds[0] } })).contract as unknown as AnalysisContract;
    expect(session.gaps.map((g) => g.code)).toContain('historico_insuficiente');
    const longitudinal = (await prisma.trainingAnalysis.findFirstOrThrow({ where: { userId: cris.userId, scope: 'longitudinal' } })).contract as unknown as AnalysisContract;
    expect(longitudinal.capabilities.some((c) => /Formato recorrente/.test(c.statement))).toBe(false); // 1 sessao nao e recorrencia
    const dani = await seedStudentWithHistory('dani-analista', { previousWeekExecuted: 'nenhum', priorIntervals: 0 });
    await generate(dani.userId);
    const none = agent.lastInput!.trainingAnalysis as { evolucao: { achados: unknown[]; capacidades: unknown[]; lacunas: string[] } } | null; // sem execucao: so lacunas, nada inventado
    if (none) { expect(none.evolucao.achados).toHaveLength(0); expect(none.evolucao.capacidades).toHaveLength(0); expect(none.evolucao.lacunas.length).toBeGreaterThan(0); }
  });
});
