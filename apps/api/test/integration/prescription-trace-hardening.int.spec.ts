import { PrismaClient } from '@prisma/client';
import { ProviderDataDeletionService } from '../../src/activity-execution/provider-data-deletion.service';
import { PolarService } from '../../src/polar/polar.service';
import { PrescriptionAgentService, PaceEvidence } from '../../src/training-plans/prescription-agent.service';
import { AgentCallTrace, EvidenceItem, recordAgentCall, snapshotOfSession } from '../../src/training-plans/prescription-trace';
import { PrescriptionTraceService } from '../../src/training-plans/prescription-trace.service';
import { StudentProfileService } from '../../src/training-plans/student-profile.service';
import { computeRunSlots, computeStrengthSlots, MethodologyInput, WeeklyMethodologyDecision } from '../../src/training-plans/training-methodology';
import { TrainingPlansService } from '../../src/training-plans/training-plans.service';
import { createTestPrisma } from './pg-guard';
import { DEVICE_CADENCE, DEVICE_PACE, OTHER_EFFORT } from './fixtures/realistic-athlete-context';
import { cleanupStudents, seedStudent } from './synthetic';

// O contexto longitudinal REAL do atleta e' montado a partir de um snapshot do banco; aqui ele e' substituido por um contexto com a forma real
// (agregados de dispositivo + agregados de outras fontes), para provar a exclusao de dados de provedor em pacotes realistas.
jest.mock('../../src/training-intelligence/compact-agent-context', () => ({
  ...jest.requireActual('../../src/training-intelligence/compact-agent-context'),
  buildCompactAgentContext: () => require('./fixtures/realistic-athlete-context').realisticAthleteContext(),
}));

// Correcoes da revisao do Astra (10/10/2026), em PostgreSQL 17 real com dados sinteticos:
//  (1) exclusao explicita de dados de um provedor alcanca agentInput e os derivados na trilha, com marcador auditavel e sem tocar outras fontes;
//  (2) sessoes regeneradas: cada versao preservada, com vigencia e o resultado ocorrido NELA.

class FakeAgent extends PrescriptionAgentService {
  weeklyCalls = 0;
  // Gancho executado durante a "chamada de IA" do dia (simula o aluno registrando o treino enquanto a IA pensa).
  duringRun: (() => Promise<void>) | null = null;
  constructor() { super({ get: () => undefined } as never, {} as never); }

  async proposeWeeklyDecision(input: MethodologyInput, evidence: PaceEvidence, trace?: AgentCallTrace[]): Promise<WeeklyMethodologyDecision | null> {
    this.weeklyCalls++;
    const self = this as unknown as { buildUserPrompt: (...args: unknown[]) => string; buildSystemPromptStable: () => string; buildSafetyGuidance: (a: boolean, b: boolean) => string };
    const runSlots = computeRunSlots(input.availability);
    const strengthSlots = computeStrengthSlots(input.availability);
    const userPrompt = self.buildUserPrompt(input, runSlots, strengthSlots, false, false, evidence, input.painReason ?? null);
    recordAgentCall(trace, { purpose: 'semana', model: 'claude-sonnet-5', system: `${self.buildSystemPromptStable()}\n${self.buildSafetyGuidance(false, false)}`, userPrompt });
    return {
      sessions: runSlots.map((slot, index) => ({
        weekday: slot.weekday, title: 'Corrida', durationMin: slot.durationMin, notes: `Objetivo da sessao ${index + 1}.`,
        parts: [{ kind: 'continua' as const, distanceKm: 5, paceSecondsPerKmMin: 480, paceSecondsPerKmMax: 480 }],
      })),
      strengthSessions: [],
      recommendation: 'Semana de teste sintetico.',
      rationale: ['Decisao sintetica de teste.'],
      safetyAdjustment: false,
    } as unknown as WeeklyMethodologyDecision;
  }

  async proposeRunSession(params: Parameters<PrescriptionAgentService['proposeRunSession']>[0], trace?: AgentCallTrace[]) {
    const self = this as unknown as { buildRunSessionUserPrompt: (p: unknown) => string; buildRunSessionSystemPrompt: () => string };
    recordAgentCall(trace, { purpose: 'dia_corrida', model: 'claude-sonnet-5', system: self.buildRunSessionSystemPrompt(), userPrompt: self.buildRunSessionUserPrompt(params) });
    if (this.duringRun) await this.duringRun();
    return { parts: [{ kind: 'continua' as const, distanceKm: 7, paceSecondsPerKmMin: 450, paceSecondsPerKmMax: 450 }] };
  }
}

describe('endurecimento da rastreabilidade (PostgreSQL 17 real, dados sinteticos)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const config = { get: () => undefined };
  const trace = new PrescriptionTraceService(prisma as never, config as never);
  const agent = new FakeAgent();
  const deletion = new ProviderDataDeletionService(prisma as never);

  function plansService() {
    const studentProfile = new StudentProfileService(prisma as never, { condenseProfile: async () => null } as never);
    return new TrainingPlansService(
      prisma as never, agent as never,
      { computeSafetyTier: async () => ({ tier: 'normal', reason: null }) } as never,
      { activeGoals: async () => [] } as never,
      { notifyCoach: jest.fn().mockResolvedValue(undefined) } as never, studentProfile as never,
      { notifyUser: async () => undefined } as never, {} as never,
      { getAgentContext: async () => null } as never,
      { getSnapshot: async () => ({}) } as never, // o contexto compacto realista vem do jest.mock acima
      { isReassessmentDue: async () => false, getLatestValidEvolutionReport: async () => null } as never,
      { retryStalledAnalyses: async () => ({ attempted: 0, resolved: 0, stillPending: 0 }) } as never,
      {} as never, {} as never,
      trace,
    );
  }
  const generate = (userId: string) => (plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(userId);

  async function seedRoutineStudent(label: string) {
    const student = await seedStudent(prisma, label);
    userIds.push(student.userId);
    await prisma.onboardingInterview.create({ data: { userId: student.userId, answers: { weekly_running_km: '10-20' }, completedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.weeklyAvailability.createMany({ data: [{ userId: student.userId, weekday: 2, modalities: ['corrida'], availableMin: 40 }, { userId: student.userId, weekday: 4, modalities: ['corrida'], availableMin: 45 }] });
    await prisma.userPreferences.create({ data: { userId: student.userId, mainGoal: 'Correr 10km', preferredModalities: ['corrida'], otherModalities: [], trainingLocations: [] } });
    await prisma.studentDirective.create({ data: { userId: student.userId, content: 'Evitar corrida na quarta', active: true } });
    return student;
  }

  async function seedActivity(userId: string, provider: string, startedAt: string, externalId: string) {
    const raw = await prisma.rawExternalActivity.create({ data: { userId, provider, externalId, payload: { origem: 'sintetico' } } });
    return prisma.activityLog.create({ data: { userId, provider, externalId, rawActivityId: raw.id, startedAt: new Date(startedAt), durationSec: 2400, distanceMeters: 5000, sport: 'running' } });
  }

  const packageOf = (userId: string, kind = 'weekly') => prisma.prescriptionEvidencePackage.findFirstOrThrow({ where: { userId, kind }, include: { decisions: true } });
  const promptOf = (agentInput: unknown) => (agentInput as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt;

  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-10-12T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
  afterAll(async () => {
    jest.useRealTimers();
    await cleanupStudents(prisma, userIds);
    await prisma.$disconnect();
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('1) exclusao explicita de dados de um provedor alcanca o texto enviado a IA e os derivados na trilha', () => {
    let alice: Awaited<ReturnType<typeof seedRoutineStudent>>;
    let bruno: Awaited<ReturnType<typeof seedRoutineStudent>>;
    let carla: Awaited<ReturnType<typeof seedRoutineStudent>>;

    beforeAll(async () => {
      alice = await seedRoutineStudent('alice-prov');
      bruno = await seedRoutineStudent('bruno-prov');
      carla = await seedRoutineStudent('carla-prov');
      for (const [index, startedAt] of ['2026-10-05T08:00:00Z', '2026-10-08T08:00:00Z'].entries()) await seedActivity(alice.userId, 'polar', startedAt, `polar-a-${index}`);
      await seedActivity(alice.userId, 'wahoo', '2026-10-09T08:00:00Z', 'wahoo-a-0');
      await seedActivity(bruno.userId, 'polar', '2026-10-07T08:00:00Z', 'polar-b-0');
      await seedActivity(carla.userId, 'wahoo', '2026-10-07T08:00:00Z', 'wahoo-c-0');
      await generate(alice.userId);
      await generate(bruno.userId);
      await generate(carla.userId);
    });

    it('o pacote registra a PROVENIENCIA dos agregados e o texto enviado a IA contem os valores do dispositivo', async () => {
      const a = await packageOf(alice.userId);
      expect(a.sourceProviders).toEqual(['polar', 'wahoo']);
      expect((await packageOf(bruno.userId)).sourceProviders).toEqual(['polar']);
      expect((await packageOf(carla.userId)).sourceProviders).toEqual(['wahoo']);
      const prompt = promptOf(a.agentInput);
      expect(prompt).toContain(String(DEVICE_PACE));
      expect(prompt).toContain(String(DEVICE_CADENCE));
      const evidence = a.evidence as unknown as EvidenceItem[];
      const pace = evidence.find((e) => e.ref === 'variable:activity.avgPaceSecondsKm')!;
      expect(pace).toMatchObject({ source: 'ActivityLog', providers: ['polar', 'wahoo'] });
      expect(evidence.find((e) => e.ref === 'variable:workout.perceivedEffort')!.providers).toBeUndefined(); // agregado de OUTRA fonte
    });

    it('DESCONECTAR a Polar nao toca a trilha', async () => {
      const before = await packageOf(alice.userId);
      await prisma.polarConnection.create({ data: { userId: alice.userId, polarUserId: `p-${alice.userId.slice(0, 8)}`, accessTokenEncrypted: 'v1:sintetico', registeredAt: new Date() } });
      const polar = new PolarService(prisma as never, { get: () => undefined } as never, deletion);
      jest.spyOn(polar as never, 'deregisterAtPolar' as never).mockResolvedValue('revoked' as never);
      expect((await polar.disconnect(alice.userId)).status).toBe('disconnected');
      const after = await packageOf(alice.userId);
      expect(after.agentInput).toEqual(before.agentInput);
      expect(after.evidence).toEqual(before.evidence);
      expect(after.agentInputRedactions).toBeNull();
    });

    it('EXCLUSAO EXPLICITA de dados da Polar: remove agregados do agentInput e do indice; preserva outras fontes; deixa marcador auditavel', async () => {
      const dayBefore = await prisma.prescriptionEvidencePackage.count({ where: { userId: alice.userId } });
      const result = await deletion.executeProviderDataDeletion(alice.userId, 'polar');
      expect(result.evidenceRedacted).toBe(2); // activity.avgPaceSecondsKm + activity.cadenceAvg
      expect(result.agentInputsRedacted).toBe(1);

      const pkg = await packageOf(alice.userId);
      const text = promptOf(pkg.agentInput);
      // nenhum valor, id nem data de agregado de dispositivo sobrou em nenhum lugar do pacote
      const everything = JSON.stringify({ evidence: pkg.evidence, agentInput: pkg.agentInput, contextGaps: pkg.contextGaps, decisions: pkg.decisions });
      for (const leaked of [String(DEVICE_PACE), String(DEVICE_CADENCE), '441.5', '169.2', 'activity.avgPaceSecondsKm', 'activity.cadenceAvg', '2026-10-09T08:00', '2026-10-08T08:00']) expect(everything).not.toContain(leaked);
      // o marcador guarda SO metadados (ids das variaveis removidas): nenhum valor
      for (const leaked of [String(DEVICE_PACE), String(DEVICE_CADENCE), '441.5', '169.2', '2026-10-09', '2026-10-08']) expect(JSON.stringify(pkg.agentInputRedactions)).not.toContain(leaked);
      // fontes de OUTROS tipos permanecem integras no texto enviado a IA
      const parsed = JSON.parse(text);
      expect(parsed.athleteStateContext.variables['workout.perceivedEffort'].current).toBe(OTHER_EFFORT);
      expect(text).toContain('Evitar corrida na quarta');
      expect(text).toContain('A esteira do aluno vai so ate 12 km/h');
      // indice: os itens de dispositivo viraram marcador; o resto permanece
      const evidence = pkg.evidence as unknown as EvidenceItem[];
      expect(evidence.filter((e) => e.redacted).map((e) => e.ref)).toEqual(['redacted:polar', 'redacted:polar']);
      expect(evidence.some((e) => e.ref === 'variable:workout.perceivedEffort')).toBe(true);
      expect(evidence.some((e) => e.kind === 'directive')).toBe(true);
      expect(evidence.some((e) => e.kind === 'report')).toBe(true);
      // marcador auditavel: provedor, instante, ids das variaveis removidas — e nada do conteudo
      expect(pkg.agentInputRedactions).toEqual([expect.objectContaining({ provider: 'polar', reason: 'provider_data_deleted', removedVariableIds: ['activity.avgPaceSecondsKm', 'activity.cadenceAvg'], callsChanged: 1, evidenceItemsRedacted: 2, agentInputAlreadyPurged: false })]);
      // registros e decisoes permanecem; o hash original do que foi enviado fica como prova de existencia
      expect(pkg.decisions.length).toBeGreaterThan(0);
      expect(pkg.agentInputHash).toHaveLength(64);
      expect(await prisma.prescriptionEvidencePackage.count({ where: { userId: alice.userId } })).toBe(dayBefore);
      // auditoria da exclusao
      const event = await prisma.providerConnectionEvent.findFirstOrThrow({ where: { userId: alice.userId, provider: 'polar', type: 'data_deleted' } });
      expect(event.details).toMatchObject({ evidenceRedacted: 2, agentInputsRedacted: 1 });
    });

    it('e IDEMPOTENTE e os agregados ja removidos nao dependem de uma exclusao posterior da Wahoo', async () => {
      const again = await deletion.executeProviderDataDeletion(alice.userId, 'polar');
      expect(again.evidenceRedacted).toBe(0);
      expect(again.agentInputsRedacted).toBe(0);
      const wahoo = await deletion.executeProviderDataDeletion(alice.userId, 'wahoo'); // agregados ja saidos: nada mais a remover
      expect(wahoo.agentInputsRedacted).toBe(0);
      expect((await packageOf(alice.userId)).agentInputRedactions).toHaveLength(1);
    });

    it('nao toca em OUTRO aluno nem em pacote cuja proveniencia nao inclui o provedor', async () => {
      const b = await packageOf(bruno.userId);
      expect(promptOf(b.agentInput)).toContain(String(DEVICE_PACE)); // Bruno tambem usa Polar, mas NAO pediu exclusao
      expect(b.agentInputRedactions).toBeNull();
      // Carla so tem Wahoo: excluir dados da Polar dela nao mexe no pacote
      const result = await deletion.executeProviderDataDeletion(carla.userId, 'polar');
      expect(result.agentInputsRedacted).toBe(0);
      const c = await packageOf(carla.userId);
      expect(promptOf(c.agentInput)).toContain(String(DEVICE_PACE));
      expect(c.agentInputRedactions).toBeNull();
      // ...mas a exclusao dos dados da Wahoo dela alcanca
      const wahoo = await deletion.executeProviderDataDeletion(carla.userId, 'wahoo');
      expect(wahoo.agentInputsRedacted).toBe(1);
      expect(promptOf((await packageOf(carla.userId)).agentInput)).not.toContain(String(DEVICE_PACE));
    });

    it('pacote SEM proveniencia registrada (anterior ao campo) e tratado de forma conservadora', async () => {
      await prisma.$executeRaw`UPDATE "PrescriptionEvidencePackage" SET "sourceProviders" = NULL WHERE "userId" = ${bruno.userId}`;
      const result = await deletion.executeProviderDataDeletion(bruno.userId, 'garmin'); // qualquer provedor: proveniencia desconhecida
      expect(result.agentInputsRedacted).toBe(1);
      const b = await packageOf(bruno.userId);
      expect(promptOf(b.agentInput)).not.toContain(String(DEVICE_PACE));
      expect(promptOf(b.agentInput)).toContain('Evitar corrida na quarta');
      expect((b.evidence as unknown as EvidenceItem[]).filter((e) => e.redacted)).toHaveLength(2);
    });

    it('pacote cuja entrada completa ja expirou (retencao): o indice e redigido e o marcador registra que nao havia texto', async () => {
      const dora = await seedRoutineStudent('dora-prov');
      await seedActivity(dora.userId, 'polar', '2026-10-06T08:00:00Z', 'polar-d-0');
      await generate(dora.userId);
      await prisma.$executeRaw`UPDATE "PrescriptionEvidencePackage" SET "agentInput" = NULL, "agentInputPurgedAt" = now() WHERE "userId" = ${dora.userId}`;
      const result = await deletion.executeProviderDataDeletion(dora.userId, 'polar');
      expect(result).toMatchObject({ evidenceRedacted: 2, agentInputsRedacted: 0 });
      const pkg = await packageOf(dora.userId);
      expect(pkg.agentInput).toBeNull();
      expect(pkg.agentInputRedactions).toEqual([expect.objectContaining({ provider: 'polar', evidenceItemsRedacted: 2, agentInputAlreadyPurged: true })]);
    });

    it('pacote de regeneracao de UM dia (prompt sem agregados de dispositivo) tem proveniencia vazia e nunca e alterado', async () => {
      const eva = await seedRoutineStudent('eva-prov');
      await seedActivity(eva.userId, 'polar', '2026-10-06T08:00:00Z', 'polar-e-0');
      const sessionId = eva.sessionIds[1];
      await prisma.trainingSession.update({ where: { id: sessionId }, data: { scheduledDate: new Date('2026-10-14T00:00:00Z'), weekday: 3 } });
      await plansService().regenerateSession(eva.userId, sessionId);
      const day = await packageOf(eva.userId, 'day_regeneration');
      expect(day.sourceProviders).toEqual([]);
      const result = await deletion.executeProviderDataDeletion(eva.userId, 'polar');
      expect(result).toMatchObject({ evidenceRedacted: 0, agentInputsRedacted: 0 });
      expect((await packageOf(eva.userId, 'day_regeneration')).agentInput).toEqual(day.agentInput);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('2) sessoes regeneradas: cada versao preservada, com vigencia e o resultado ocorrido NELA', () => {
    const BASE = new Date('2026-10-12T10:00:00.000Z');
    const plus = (hours: number) => new Date(BASE.getTime() + hours * 3_600_000);

    async function moveToFuture(sessionId: string) {
      await prisma.trainingSession.update({ where: { id: sessionId }, data: { scheduledDate: new Date('2026-10-14T00:00:00Z'), weekday: 3 } });
    }
    async function pinDecisionTimes(sessionId: string, times: Date[]) {
      const decisions = await prisma.prescriptionDecision.findMany({ where: { sessionId, kind: 'session' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      expect(decisions).toHaveLength(times.length);
      for (const [index, decision] of decisions.entries()) {
        await prisma.prescriptionDecision.update({ where: { id: decision.id }, data: { createdAt: times[index] } });
        await prisma.prescriptionEvidencePackage.update({ where: { id: decision.packageId }, data: { createdAt: times[index] } });
      }
    }
    async function linkActivity(userId: string, sessionId: string, startedAt: Date, externalId: string) {
      const activity = await seedActivity(userId, 'polar', startedAt.toISOString(), externalId);
      await prisma.sessionExecutionLink.create({ data: { userId, trainingSessionId: sessionId, activityLogId: activity.id, status: 'active', origin: 'automatic' } });
      return activity;
    }

    it('regenerada ANTES e DEPOIS de atividades objetivas e antes do registro: v1 preservada por inteiro, cada resultado na sua versao', async () => {
      const student = await seedRoutineStudent('versoes');
      const plan = await generate(student.userId);
      const sessions = await prisma.trainingSession.findMany({ where: { planId: plan.id }, orderBy: { weekday: 'asc' } });
      const session = sessions[0];
      const v1State = await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } });

      await plansService().regenerateSession(student.userId, session.id);
      const v2State = await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(v2State.structure).not.toEqual(v1State.structure); // a regeneracao reescreveu a prescricao

      // tempos controlados: v1 = 10h, v2 = 12h; atividade objetiva 11h (vigencia da v1) e 13h (vigencia da v2); registro do aluno apos a v2
      await pinDecisionTimes(session.id, [BASE, plus(2)]);
      const early = await linkActivity(student.userId, session.id, plus(1), 'polar-v-early');
      const late = await linkActivity(student.userId, session.id, plus(3), 'polar-v-late');
      await prisma.workoutCompletion.create({ data: { userId: student.userId, sessionId: session.id, status: 'done', durationMin: 51, distanceKm: 7.1, avgPaceSecondsKm: 430, perceivedEffort: 6, painFlag: 'none' } });

      const result = await trace.getTrace(student.userId, { sessionId: session.id });
      expect(result.sessions).toHaveLength(1);
      const { versions, outsideVersions } = result.sessions[0];
      expect(versions).toHaveLength(2);

      // v1: a prescricao ANTERIOR por inteiro (estrutura, nao so o resumo), com vigencia ate a regeneracao
      const [one, two] = versions;
      expect(one).toMatchObject({ version: 1, traced: true, packageKind: 'weekly', validFrom: BASE.toISOString(), validUntil: plus(2).toISOString() });
      expect(one.snapshot).toEqual(snapshotOfSession(v1State).snapshot);
      expect(one.snapshotSha256).toBe(snapshotOfSession(v1State).sha256);
      expect((one.snapshot as { structure: unknown }).structure).toEqual(v1State.structure);
      // v2: a nova prescricao
      expect(two).toMatchObject({ version: 2, traced: true, packageKind: 'day_regeneration', validFrom: plus(2).toISOString(), validUntil: null, untracedChangeBefore: false });
      expect(two.snapshotSha256).toBe(snapshotOfSession(v2State).sha256);
      expect((two.snapshot as { structure: unknown }).structure).toEqual(v2State.structure);

      // resultado de cada versao: nada atribuido retroativamente a prescricao errada
      expect(one.outcome.status).toBe('objective_only');
      expect(one.outcome.objectiveActivities.map((a) => a.activityLogId)).toEqual([early.id]);
      expect(one.outcome.completion).toBeNull();
      expect(two.outcome.status).toBe('executed');
      expect(two.outcome.completion).toMatchObject({ status: 'done', distanceKm: 7.1 });
      expect(two.outcome.completionAttribution).toBe('recorded_after_last_regeneration');
      expect(two.outcome.objectiveActivities.map((a) => a.activityLogId)).toEqual([late.id]);
      expect(outsideVersions.completion).toBeNull();
      expect(outsideVersions.objectiveActivities).toEqual([]);

      // a decisao de CADA pacote mostra so o resultado da sua vigencia (antes: o estado atual da sessao, para as duas)
      const packages = (await trace.getTrace(student.userId, { sessionId: session.id })).packages;
      const decisionV1 = packages.flatMap((p) => p.decisions).find((d) => d.sessionId === session.id && d.id === one.decisionId)!;
      const decisionV2 = packages.flatMap((p) => p.decisions).find((d) => d.id === two.decisionId)!;
      expect(decisionV1.outcome?.status).toBe('objective_only');
      expect(decisionV1.outcome?.completion).toBeNull();
      expect(decisionV2.outcome?.status).toBe('executed');

      // encadeamento da regeneracao: aponta a decisao anterior e guarda o estado anterior por inteiro
      const change = decisionV2.changeFromPrevious as { previousDecisionId: string; previousVersionTraced: boolean; previousSnapshotSha256: string; untracedChangeSincePreviousVersion: boolean; previousSnapshot: { structure: unknown } };
      expect(change).toMatchObject({ previousDecisionId: one.decisionId, previousVersionTraced: true, untracedChangeSincePreviousVersion: false, previousSnapshotSha256: one.snapshotSha256 });
      expect(change.previousSnapshot.structure).toEqual(v1State.structure);

      // regenerar DEPOIS da execucao e proibido e nao deixa rastro
      const packagesBefore = await prisma.prescriptionEvidencePackage.count({ where: { userId: student.userId } });
      await expect(plansService().regenerateSession(student.userId, session.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'session_already_completed' }) });
      expect(await prisma.prescriptionEvidencePackage.count({ where: { userId: student.userId } })).toBe(packagesBefore);
      expect((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })).structure).toEqual(v2State.structure);
    });

    it('o aluno registra o treino ENQUANTO a IA gera a nova versao: nada e reescrito e nenhuma trilha e criada (a execucao nao vira da prescricao errada)', async () => {
      const student = await seedRoutineStudent('corrida-registro');
      const plan = await generate(student.userId);
      const session = (await prisma.trainingSession.findMany({ where: { planId: plan.id }, orderBy: { weekday: 'asc' } }))[0];
      const before = await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } });
      const packagesBefore = await prisma.prescriptionEvidencePackage.count({ where: { userId: student.userId } });

      agent.duringRun = async () => { await prisma.workoutCompletion.create({ data: { userId: student.userId, sessionId: session.id, status: 'done', durationMin: 40, distanceKm: 5, painFlag: 'none' } }); };
      try {
        await expect(plansService().regenerateSession(student.userId, session.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'session_already_completed' }) });
      } finally { agent.duringRun = null; }

      expect((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })).structure).toEqual(before.structure);
      expect(await prisma.prescriptionEvidencePackage.count({ where: { userId: student.userId } })).toBe(packagesBefore);
    });

    it('edicao manual do treinador entre versoes: a regeneracao guarda o estado EDITADO como anterior e sinaliza a mudanca fora da trilha', async () => {
      const student = await seedRoutineStudent('edicao-manual');
      const plan = await generate(student.userId);
      const session = (await prisma.trainingSession.findMany({ where: { planId: plan.id }, orderBy: { weekday: 'asc' } }))[0];
      const generated = await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } });
      await prisma.trainingSession.update({ where: { id: session.id }, data: { durationMin: 55 } }); // edicao manual, sem trilha

      await plansService().regenerateSession(student.userId, session.id);
      const { versions } = (await trace.getTrace(student.userId, { sessionId: session.id })).sessions[0];
      expect(versions).toHaveLength(2);
      expect((versions[0].snapshot as { durationMin: number }).durationMin).toBe(generated.durationMin); // o que a IA prescreveu
      expect(versions[1].untracedChangeBefore).toBe(true);
      const change = (await prisma.prescriptionDecision.findFirstOrThrow({ where: { id: versions[1].decisionId! } })).changeFromPrevious as { previousSnapshot: { durationMin: number } };
      expect(change.previousSnapshot.durationMin).toBe(55); // o estado REAL imediatamente antes da regeneracao
    });

    it('sessao anterior a trilha (sem decisao registrada), regenerada: a versao anterior e reconstruida do estado preservado e marcada como nao rastreada', async () => {
      const student = await seedRoutineStudent('legado-versao');
      const sessionId = student.sessionIds[1];
      await moveToFuture(sessionId);
      const seeded = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } });
      await plansService().regenerateSession(student.userId, sessionId);

      const { versions } = (await trace.getTrace(student.userId, { sessionId })).sessions[0];
      expect(versions).toHaveLength(2);
      expect(versions[0]).toMatchObject({ version: 1, traced: false, decisionId: null, packageId: null, validFrom: seeded.createdAt.toISOString() });
      expect(versions[0].snapshotSha256).toBe(snapshotOfSession(seeded).sha256);
      expect((versions[0].snapshot as { structure: unknown }).structure).toEqual(seeded.structure);
      expect(versions[1]).toMatchObject({ version: 2, traced: true, packageKind: 'day_regeneration' });
      expect(versions[0].validUntil).toBe(versions[1].validFrom);
    });
  });
});
