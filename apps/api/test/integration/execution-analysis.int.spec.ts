import { PrismaClient } from '@prisma/client';
import { ProviderDataDeletionService } from '../../src/activity-execution/provider-data-deletion.service';
import { ExecutionAnalysisService } from '../../src/activity-execution/execution-analysis.service';
import { PrescriptionAgentService, PaceEvidence } from '../../src/training-plans/prescription-agent.service';
import { AgentCallTrace, EvidenceItem, recordAgentCall } from '../../src/training-plans/prescription-trace';
import { PrescriptionTraceService } from '../../src/training-plans/prescription-trace.service';
import { StudentProfileService } from '../../src/training-plans/student-profile.service';
import { computeRunSlots, computeStrengthSlots, MethodologyInput, WeeklyMethodologyDecision } from '../../src/training-plans/training-methodology';
import { TrainingPlansService } from '../../src/training-plans/training-plans.service';
import { ObservationReaderService } from '../../src/training-intelligence/observation-reader.service';
import { NORMALIZATION_VERSION } from '../../src/activity-timeseries/activity-timeseries.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Etapa 2.1 — analise de execucao, relatorios e integracao com a nova semana em PostgreSQL 17 real (dados sinteticos). Sem chamada de IA: o Prescritor e'
// simulado, mas monta o prompt com o codigo REAL (buildUserPrompt), entao a presenca do relatorio no que seria enviado a IA e' verificada de verdade.

class FakeAgent extends PrescriptionAgentService {
  lastInput: MethodologyInput | null = null;
  constructor() { super({ get: () => undefined } as never, {} as never); }
  async proposeWeeklyDecision(input: MethodologyInput, evidence: PaceEvidence, trace?: AgentCallTrace[]): Promise<WeeklyMethodologyDecision | null> {
    this.lastInput = input;
    const self = this as unknown as { buildUserPrompt: (...args: unknown[]) => string; buildSystemPromptStable: () => string; buildSafetyGuidance: (a: boolean, b: boolean) => string };
    const runSlots = computeRunSlots(input.availability);
    const userPrompt = self.buildUserPrompt(input, runSlots, computeStrengthSlots(input.availability), false, false, evidence, input.painReason ?? null);
    recordAgentCall(trace, { purpose: 'semana', model: 'claude-sonnet-5', system: `${self.buildSystemPromptStable()}\n${self.buildSafetyGuidance(false, false)}`, userPrompt });
    return {
      sessions: runSlots.map((slot) => ({ weekday: slot.weekday, title: 'Corrida', durationMin: slot.durationMin, notes: 'n', parts: [{ kind: 'continua' as const, distanceKm: 5, paceSecondsPerKmMin: 480, paceSecondsPerKmMax: 480 }] })),
      strengthSessions: [], recommendation: 'Semana de teste sintetico.', rationale: ['Decisao sintetica.'], safetyAdjustment: false,
    } as unknown as WeeklyMethodologyDecision;
  }
}

const block = (label: string, km: number, range: string) => ({ label, distanceValue: km, distanceUnit: 'km', paceRange: range });
const intervalStructure = {
  blocks: [
    block('Aquecimento', 1, '6:30/km a 7:00/km'),
    { label: 'Tiros', repeatCount: 6, steps: [block('Forte', 0.4, '4:00/km a 4:20/km'), block('Leve', 0.2, '6:00/km a 6:30/km')] },
    block('Desaquecimento', 1, '6:30/km a 7:00/km'),
  ],
};
// serie por segundo: aquecimento 1 km @6:45, 6 x (400 m @4:10 / 200 m @6:15), desaquecimento 1 km @6:45
function series(forte = 250, leve = 375) {
  const legs = [{ km: 1, pace: 405 }, ...Array.from({ length: 6 }, () => [{ km: 0.4, pace: forte }, { km: 0.2, pace: leve }]).flat(), { km: 1, pace: 405 }];
  const points: Array<{ offsetSec: number; distanceMeters: number; heartRateBpm: number; cadenceSpm: number }> = [{ offsetSec: 0, distanceMeters: 0, heartRateBpm: 140, cadenceSpm: 170 }];
  let t = 0; let d = 0;
  for (const leg of legs) { const end = d + leg.km * 1000; while (d < end - 1e-6) { t += 1; d = Math.min(end, d + 1000 / leg.pace); points.push({ offsetSec: t, distanceMeters: d, heartRateBpm: 150, cadenceSpm: 170 }); } }
  return points;
}

describe('analise de execucao: persistencia, relatorios e nova semana (PostgreSQL 17 real, dados sinteticos)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const agent = new FakeAgent();
  const trace = new PrescriptionTraceService(prisma as never, { get: () => undefined } as never);
  const analysis = new ExecutionAnalysisService(prisma as never);
  const deletion = new ProviderDataDeletionService(prisma as never);

  function plansService() {
    const studentProfile = new StudentProfileService(prisma as never, { condenseProfile: async () => null } as never);
    return new TrainingPlansService(
      prisma as never, agent as never, { computeSafetyTier: async () => ({ tier: 'normal', reason: null }) } as never, { activeGoals: async () => [] } as never,
      { notifyCoach: jest.fn().mockResolvedValue(undefined) } as never, studentProfile as never, { notifyUser: async () => undefined } as never, {} as never,
      { getAgentContext: async () => null } as never, { getSnapshot: async () => { throw new Error('snapshot indisponivel no teste'); } } as never,
      { isReassessmentDue: async () => false, getLatestValidEvolutionReport: async () => null } as never,
      { retryStalledAnalyses: async () => ({ attempted: 0, resolved: 0, stillPending: 0 }) } as never, {} as never, {} as never, trace, analysis,
    );
  }

  // Semana ANTERIOR (05/10): s0 = corrida intervalada vinculada a uma atividade Polar com serie completa; s1 = musculacao (47 de 50 min, esforco 8).
  async function seedPreviousWeek(label: string, options: { withSeries?: boolean } = {}) {
    const student = await seedStudent(prisma, label, { startDate: new Date('2026-10-05T00:00:00.000Z') });
    userIds.push(student.userId);
    await prisma.onboardingInterview.create({ data: { userId: student.userId, answers: { weekly_running_km: '10-20' }, completedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.weeklyAvailability.createMany({ data: [{ userId: student.userId, weekday: 2, modalities: ['corrida'], availableMin: 40 }, { userId: student.userId, weekday: 4, modalities: ['corrida'], availableMin: 45 }] });
    await prisma.userPreferences.create({ data: { userId: student.userId, mainGoal: 'Correr 10km', preferredModalities: ['corrida'], otherModalities: [], trainingLocations: [] } });
    await prisma.trainingSession.update({ where: { id: student.sessionIds[0] }, data: { structure: intervalStructure, distanceKm: 5.6, durationMin: 40 } });
    await prisma.trainingSession.update({ where: { id: student.sessionIds[1] }, data: { modality: 'forca', durationMin: 50, distanceKm: null, structure: { type: 'strength' } } });
    await prisma.workoutCompletion.create({ data: { userId: student.userId, sessionId: student.sessionIds[1], status: 'done', durationMin: 47, perceivedEffort: 8, painFlag: 'none' } });
    const points = options.withSeries === false ? [] : series();
    const last = points[points.length - 1];
    const raw = await prisma.rawExternalActivity.create({ data: { userId: student.userId, provider: 'polar', externalId: `polar-${label}`, payload: { origem: 'sintetico' } } });
    const activity = await prisma.activityLog.create({
      data: { userId: student.userId, provider: 'polar', externalId: `polar-${label}`, rawActivityId: raw.id, startedAt: new Date('2026-10-06T08:00:00Z'), durationSec: last?.offsetSec ?? 2000, distanceMeters: last?.distanceMeters ?? 5600, avgHeartRateBpm: 150, cadenceAvg: 170, sport: 'running' },
    });
    if (points.length > 0) await prisma.activityTimeSeriesPoint.createMany({ data: points.map((p) => ({ activityLogId: activity.id, provider: 'polar', normalizationVersion: NORMALIZATION_VERSION, ...p })) });
    await prisma.sessionExecutionLink.create({ data: { userId: student.userId, trainingSessionId: student.sessionIds[0], activityLogId: activity.id, status: 'active', origin: 'automatic' } });
    return { ...student, activityId: activity.id };
  }

  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-10-12T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
  afterAll(async () => { jest.useRealTimers(); await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  describe('fluxo completo de uma aluna (ordenado)', () => {
    let ana: Awaited<ReturnType<typeof seedPreviousWeek>>;
    let newPlanId: string;
    let reportSnapshot: string;

    beforeAll(async () => { ana = await seedPreviousWeek('ana-exec'); });

    it('1) analise por treino: persiste so indicadores, reconhece o intervalado (cenario E) e e idempotente', async () => {
      const result = await analysis.analyzeSession(ana.userId, ana.sessionIds[0]);
      expect(result!.analysis).toMatchObject({ kind: 'run', dataLevel: 'series', structure: { prescribed: 'intervalado', executed: 'intervalado', scenario: 'E' }, intensity: { status: 'dentro' } });
      const rows = await prisma.sessionExecutionAnalysis.findMany({ where: { trainingSessionId: ana.sessionIds[0] } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'analyzed', provider: 'polar', activityLogId: ana.activityId, algorithmVersion: 1 });
      // sem duplicar atividade nem serie: so' indicadores (JSON pequeno, sem a lista de pontos)
      expect(JSON.stringify(rows[0].indicators).length).toBeLessThan(20_000);
      expect(JSON.stringify(rows[0].indicators)).not.toContain('offsetSec');
      const computedAt = rows[0].computedAt.getTime();
      await analysis.analyzeSession(ana.userId, ana.sessionIds[0]); // mesma fonte: nao recalcula
      const again = await prisma.sessionExecutionAnalysis.findMany({ where: { trainingSessionId: ana.sessionIds[0] } });
      expect(again).toHaveLength(1);
      expect(again[0].computedAt.getTime()).toBe(computedAt);
      // o vinculo automatico existente segue ativo e intocado
      expect(await prisma.sessionExecutionLink.count({ where: { trainingSessionId: ana.sessionIds[0], status: 'active' } })).toBe(1);
    });

    it('2) relatorio da sessao para o aluno (texto condicionado aos indicadores) e musculacao sem inferir series/repeticoes', async () => {
      const view = await analysis.presentationFor(ana.userId, ana.planId, ana.sessionIds, ana.sessionIds);
      const run = view.sessionReports[ana.sessionIds[0]];
      expect(run.scenario).toBe('E');
      expect(run.lines.join(' ')).toMatch(/Você percorreu 5,6 dos 5,6 km previstos/);
      expect(run.lines.join(' ')).toMatch(/dentro da faixa prescrita/);
      const strength = view.sessionReports[ana.sessionIds[1]];
      expect(strength.lines.join(' ')).toMatch(/Duração registrada: 47 min, mais curta que a prevista \(50 min; tolerância de 5%\)/);
      expect(strength.lines.join(' ')).toMatch(/Esforço percebido informado: 8\/10/);
      expect(strength.lines.join(' ')).not.toMatch(/série|repetiç/i);
    });

    it('3) nova semana: o Prescritor recebe a consolidacao ANTES de gerar, o retrato e gravado com o programa e a aluna o recebe junto', async () => {
      const plan = await (plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(ana.userId);
      newPlanId = plan.id;
      // 1) o que o Prescritor recebeu (mesmo objeto que vira o prompt)
      const sent = agent.lastInput!.weeklyExecutionReport as { sessoes: Record<string, number>; corrida: { realizadas: number; kmRealizados: number; kmPrevistosNaSemana: number; estruturaIntervalados: { cenarios: Record<string, number> } }; musculacao: { maisCurtas: number; esforcoPercebidoMedio: number } };
      expect(sent.sessoes).toMatchObject({ prescritas: 2, realizadas: 2, frequenciaPct: 100 });
      expect(sent.corrida).toMatchObject({ realizadas: 1, kmRealizados: 5.6, kmPrevistosNaSemana: 5.6 });
      expect(sent.corrida.estruturaIntervalados.cenarios).toEqual({ E: 1 });
      expect(sent.musculacao).toMatchObject({ maisCurtas: 1, esforcoPercebidoMedio: 8 });
      // 2) no pacote de evidencias (retrato daquele momento): texto enviado a IA + item do indice com a proveniencia de dispositivo
      const pkg = await prisma.prescriptionEvidencePackage.findFirstOrThrow({ where: { planId: plan.id, kind: 'weekly' } });
      const prompt = JSON.parse((pkg.agentInput as unknown as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt);
      expect(prompt.relatorioDeExecucaoDaSemanaAnterior.sessoes.realizadas).toBe(2);
      const item = (pkg.evidence as unknown as EvidenceItem[]).find((e) => e.ref === 'weekly_execution_report')!;
      expect(item).toMatchObject({ kind: 'weekly_execution_report', providers: ['polar'] });
      expect(pkg.sourceProviders).toEqual(expect.arrayContaining(['polar']));
      // 3) entregue com a nova semana (mesma transacao do programa)
      const stored = await prisma.weeklyExecutionReport.findFirstOrThrow({ where: { deliveredWithPlanId: plan.id } });
      expect(stored).toMatchObject({ userId: ana.userId, analyzedPlanId: ana.planId, status: 'active', algorithmVersion: 1 });
      expect((stored.sources as { providers: string[]; activityLogIds: string[] })).toMatchObject({ providers: ['polar'], activityLogIds: [ana.activityId] });
      const view = await analysis.presentationFor(ana.userId, plan.id, []);
      expect(view.weeklyReport!.lines.join(' ')).toMatch(/Você realizou os 2 treinos previstos/);
      expect(view.weeklyReport!.lines.join(' ')).toMatch(/Percorreu 5,6 dos 5,6 km previstos/);
      reportSnapshot = JSON.stringify([stored.indicators, stored.textLines, pkg.agentInput]);
    });

    it('4) sincronizacao tardia: indicadores vivos sao atualizados; o retrato entregue e o contexto original da decisao NAO mudam; nenhuma regeneracao automatica', async () => {
      const plansBefore = await prisma.trainingPlan.count({ where: { userId: ana.userId } });
      await prisma.activityLog.update({ where: { id: ana.activityId }, data: { avgHeartRateBpm: 171 } }); // dado corrigido/sincronizado depois
      await prisma.workoutCompletion.update({ where: { sessionId: ana.sessionIds[1] }, data: { perceivedEffort: 5 } }); // feedback corrigido
      await analysis.analyzeSession(ana.userId, ana.sessionIds[0]);
      await analysis.analyzeSession(ana.userId, ana.sessionIds[1]);
      const live = await prisma.sessionExecutionAnalysis.findMany({ where: { userId: ana.userId }, orderBy: { modality: 'asc' } });
      expect(live).toHaveLength(2); // uma linha por sessao (sem duplicar)
      expect((live.find((r) => r.modality === 'corrida')!.indicators as { totals: { avgHeartRateBpm: number } }).totals.avgHeartRateBpm).toBe(171);
      expect((live.find((r) => r.modality === 'forca')!.indicators as { perceivedEffort: number }).perceivedEffort).toBe(5);
      // retrato: inalterado
      const stored = await prisma.weeklyExecutionReport.findFirstOrThrow({ where: { deliveredWithPlanId: newPlanId } });
      const pkg = await prisma.prescriptionEvidencePackage.findFirstOrThrow({ where: { planId: newPlanId, kind: 'weekly' } });
      expect(JSON.stringify([stored.indicators, stored.textLines, pkg.agentInput])).toBe(reportSnapshot);
      expect(await prisma.trainingPlan.count({ where: { userId: ana.userId } })).toBe(plansBefore);
    });

    it('5) indicadores disponiveis para o historico longitudinal (21/60/200 dias) com rastro ate a sessao e a atividade', async () => {
      const reader = new ObservationReaderService(prisma as never, {} as never, {} as never);
      const ratio = await reader.getObservations(ana.userId, 'execution.distanceCompletionRatio');
      expect(ratio).toHaveLength(1);
      expect(ratio[0]).toMatchObject({ value: 1, source: 'session_execution_analysis', context: { sessionId: ana.sessionIds[0], activityLogId: ana.activityId, provider: 'polar', modality: 'corrida' } });
      expect((await reader.getObservations(ana.userId, 'execution.intervalStructureMatch'))[0].value).toBe(1);
      expect((await reader.getObservations(ana.userId, 'execution.timeInBandPct'))[0].value as number).toBeGreaterThanOrEqual(60);
      expect((await reader.getObservations(ana.userId, 'execution.avgHeartRateInBandBpm'))[0].value).toBe(150);
    });

    it('6) exclusao de dados do provedor: indicadores derivados saem, o relatorio entregue e invalidado e o texto guardado da decisao perde a consolidacao', async () => {
      const result = await deletion.executeProviderDataDeletion(ana.userId, 'polar');
      expect(result).toMatchObject({ executionAnalyses: 1, weeklyReportsInvalidated: 1 });
      expect(await prisma.sessionExecutionAnalysis.count({ where: { userId: ana.userId, provider: 'polar' } })).toBe(0);
      // o registro do proprio aluno (musculacao sem atividade) permanece
      expect(await prisma.sessionExecutionAnalysis.count({ where: { userId: ana.userId, modality: 'forca' } })).toBe(1);
      const stored = await prisma.weeklyExecutionReport.findFirstOrThrow({ where: { deliveredWithPlanId: newPlanId } });
      expect(stored).toMatchObject({ status: 'invalidated', indicators: {}, textLines: [], invalidatedProviders: ['polar'] });
      expect((await analysis.presentationFor(ana.userId, newPlanId, [])).weeklyReport).toBeNull();
      const pkg = await prisma.prescriptionEvidencePackage.findFirstOrThrow({ where: { planId: newPlanId, kind: 'weekly' } });
      const prompt = JSON.parse((pkg.agentInput as unknown as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt);
      expect(prompt.relatorioDeExecucaoDaSemanaAnterior).toBeNull();
      expect(prompt.objetivo).toBe('Correr 10km');
      expect((pkg.evidence as unknown as EvidenceItem[]).find((e) => e.kind === 'weekly_execution_report')).toMatchObject({ providers: [], invalidatedProviders: ['polar'] });
      const reader = new ObservationReaderService(prisma as never, {} as never, {} as never);
      expect(await reader.getObservations(ana.userId, 'execution.timeInBandPct')).toHaveLength(0);
    });
  });

  it('relogio que mandou so o resumo (sem serie): distancia e FC, sem percentuais; o relatorio diz isso', async () => {
    const bia = await seedPreviousWeek('bia-exec', { withSeries: false });
    const result = await analysis.analyzeSession(bia.userId, bia.sessionIds[0]);
    expect(result!.analysis).toMatchObject({ kind: 'run', dataLevel: 'summary_only', intensity: { status: 'indeterminado' } });
    expect(await prisma.sessionExecutionAnalysis.findFirstOrThrow({ where: { trainingSessionId: bia.sessionIds[0] } })).toMatchObject({ status: 'summary_only' });
    const lines = (await analysis.presentationFor(bia.userId, bia.planId, bia.sessionIds)).sessionReports[bia.sessionIds[0]].lines.join(' ');
    expect(lines).toMatch(/apenas o resumo/);
    expect(lines).not.toMatch(/dentro da faixa/);
  });

  it('semana anterior sem treino analisavel / sem semana anterior: a geracao segue normalmente e sem o relatorio', async () => {
    const cris = await seedStudent(prisma, 'cris-exec'); // semana de 28/09 (nao e' a imediatamente anterior)
    userIds.push(cris.userId);
    await prisma.onboardingInterview.create({ data: { userId: cris.userId, answers: { weekly_running_km: '10-20' }, completedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.weeklyAvailability.createMany({ data: [{ userId: cris.userId, weekday: 2, modalities: ['corrida'], availableMin: 40 }] });
    await prisma.userPreferences.create({ data: { userId: cris.userId, mainGoal: 'Correr 10km', preferredModalities: ['corrida'], otherModalities: [], trainingLocations: [] } });
    const plan = await (plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(cris.userId);
    expect(plan.id).toBeTruthy();
    expect(agent.lastInput!.weeklyExecutionReport).toBeNull();
    expect(await prisma.weeklyExecutionReport.count({ where: { userId: cris.userId } })).toBe(0);
  });
});
