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
import { DEVICE_CADENCE, DEVICE_PACE, LOAD, OTHER_EFFORT } from './fixtures/realistic-athlete-context';
import { createHash } from 'crypto';
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
  // Etapa 1.2b: quando ligado, o Prescritor simulado devolve o raciocinio declarado (primeira sessao: historico + estado do atleta + relato; demais: so relato).
  declare = false;
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
        ...(this.declare ? {
          declared: {
            intent: `Objetivo do dia ${slot.weekday}`, expected: `Esperado do dia ${slot.weekday}`,
            basis: index === 0
              ? [{ source: 'historicoSemanal' as const, note: 'ritmo recente 7:15/km' }, { source: 'athleteStateContext' as const, note: 'cadencia 171.6 estavel' }, { source: 'relatosEstruturadosDoAluno' as const, note: 'esteira limitada' }]
              : [{ source: 'relatosEstruturadosDoAluno' as const, note: 'esteira limitada' }],
          },
        } : {}),
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
    return {
      parts: [{ kind: 'continua' as const, distanceKm: 7, paceSecondsPerKmMin: 450, paceSecondsPerKmMax: 450 }],
      ...(this.declare ? { declared: { intent: 'Reforcar a base apos a troca de dia', expected: 'Concluir 7 km sem dor', basis: [{ source: 'diretrizesEspecificasDoTreinadorParaEsteAluno' as const, note: 'evitar quarta' }] } } : {}),
    };
  }
}

describe('endurecimento da rastreabilidade (PostgreSQL 17 real, dados sinteticos)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const config = { get: () => undefined };
  const trace = new PrescriptionTraceService(prisma as never, config as never);
  const trace_ = trace;
  const agent = new FakeAgent();
  const deletion = new ProviderDataDeletionService(prisma as never);

  function plansService(opts: { snapshotFails?: boolean } = {}) {
    const studentProfile = new StudentProfileService(prisma as never, { condenseProfile: async () => null } as never);
    return new TrainingPlansService(
      prisma as never, agent as never,
      { computeSafetyTier: async () => ({ tier: 'normal', reason: null }) } as never,
      { activeGoals: async () => [] } as never,
      { notifyCoach: jest.fn().mockResolvedValue(undefined) } as never, studentProfile as never,
      { notifyUser: async () => undefined } as never, {} as never,
      { getAgentContext: async () => null } as never,
      { getSnapshot: async () => { if (opts.snapshotFails) throw new Error('snapshot indisponivel no teste'); return {}; } } as never, // o contexto compacto realista vem do jest.mock acima
      { isReassessmentDue: async () => false, getLatestValidEvolutionReport: async () => null } as never,
      { retryStalledAnalyses: async () => ({ attempted: 0, resolved: 0, stillPending: 0 }) } as never,
      {} as never, {} as never,
      trace,
    );
  }
  const generate = (userId: string, opts: { snapshotFails?: boolean } = {}) => (plansService(opts) as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(userId);

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
      // proveniencia desconhecida: as 2 variaveis de atividade + as 7 de carga derivaveis de dispositivo; o volume prescrito e as outras fontes ficam
      const items = b.evidence as unknown as EvidenceItem[];
      expect(items.filter((e) => e.redacted)).toHaveLength(9);
      expect(items.some((e) => e.ref === 'variable:training.volumePrescribedKm')).toBe(true);
      expect(promptOf(b.agentInput)).toContain(String(LOAD.prescribed));
      expect(promptOf(b.agentInput)).not.toContain(String(LOAD.acwr));
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

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('5) Etapa 1.2b: raciocinio declarado pela IA (intent / expected / basis) na trilha', () => {
    afterEach(() => { agent.declare = false; });
    const decisionsOf = async (userId: string) => (await packageOf(userId)).decisions.filter((d) => d.kind === 'session').sort((a, b) => (a.weekday ?? 0) - (b.weekday ?? 0));

    it('persiste objetivo, esperado e fundamentos por sessao, ligados pelo codigo as evidencias; rotulado como declaracao (nao prova)', async () => {
      agent.declare = true;
      const rita = await seedRoutineStudent('rita-12b');
      await seedActivity(rita.userId, 'polar', '2026-10-06T08:00:00Z', 'polar-rita');
      await generate(rita.userId);
      const [first, second] = await decisionsOf(rita.userId);
      expect(first).toMatchObject({ intent: `Objetivo do dia ${first.weekday}`, expected: { text: `Esperado do dia ${first.weekday}` }, traceStatus: 'complete' });
      expect(second).toMatchObject({ intent: `Objetivo do dia ${second.weekday}`, traceStatus: 'complete' }); // cada rascunho ligado a SUA sessao
      const basis = first.basis as unknown as { declared: boolean; nature: string; providers: string[]; entries: Array<{ source: string; note: string; evidenceRefs: string[]; delivered: boolean; providers: string[] }> };
      expect(basis).toMatchObject({ declared: true, nature: 'declared_by_ai_not_proof_of_influence', providers: ['polar'] });
      const byRef = (source: string) => basis.entries.find((entry) => entry.source === source)!;
      expect(byRef('historicoSemanal')).toMatchObject({ delivered: true, evidenceRefs: expect.arrayContaining([expect.stringMatching(/^history_week:/)]) });
      expect(byRef('relatosEstruturadosDoAluno')).toMatchObject({ delivered: true, evidenceRefs: [expect.stringMatching(/^report:/)], providers: [] });
      expect(byRef('athleteStateContext')).toMatchObject({ delivered: true, providers: ['polar'] });
      expect((second.basis as unknown as typeof basis).entries).toHaveLength(1);
      // tamanho controlado e prescricao intacta: o raciocinio nao vaza para o treino do aluno
      expect(JSON.stringify(first.basis).length).toBeLessThan(1500);
      const sessions = await prisma.trainingSession.findMany({ where: { planId: first.planId } });
      expect(JSON.stringify(sessions)).not.toContain('Objetivo do dia');
      // a decisao da SEMANA segue sem declaracao propria (usa recommendation/rationale ja existentes)
      expect((await packageOf(rita.userId)).decisions.find((d) => d.kind === 'week')).toMatchObject({ intent: null, basis: null, traceStatus: 'absent' });
    });

    it('registros SEM os campos (resposta sem reasoning / registros antigos) continuam validos: traceStatus absent e reconstrucao normal', async () => {
      agent.declare = false;
      const paulo = await seedRoutineStudent('paulo-12b');
      await generate(paulo.userId);
      const decisions = await decisionsOf(paulo.userId);
      expect(decisions.every((d) => d.intent === null && d.expected === null && d.basis === null && d.traceStatus === 'absent')).toBe(true);
      const trace = await trace_.getTrace(paulo.userId, { planId: decisions[0].planId });
      expect(trace.sessions.every((s) => s.versions.every((v) => v.reasoning?.traceStatus === 'absent' && v.reasoning.basis === null))).toBe(true);
      // linha antiga (1.2a) sem nenhuma das colunas novas preenchidas: continua legivel
      const legacy = await prisma.prescriptionDecision.findFirstOrThrow({ where: { id: decisions[0].id } });
      expect(legacy.traceStatus).toBe('absent');
    });

    it('regeneracao de um dia (corrida): o raciocinio da nova versao e registrado; a versao anterior mantem o seu; reconstrucao por versao', async () => {
      agent.declare = true;
      const vera = await seedRoutineStudent('vera-12b');
      const plan = await generate(vera.userId);
      const session = (await prisma.trainingSession.findMany({ where: { planId: plan.id }, orderBy: { weekday: 'asc' } }))[0];
      await plansService().regenerateSession(vera.userId, session.id);
      const { sessions } = await trace_.getTrace(vera.userId, { sessionId: session.id });
      const [v1, v2] = sessions[0].versions;
      expect(v1.reasoning).toMatchObject({ intent: `Objetivo do dia ${session.weekday}`, traceStatus: 'complete' });
      expect(v2.reasoning).toMatchObject({ intent: 'Reforcar a base apos a troca de dia', traceStatus: 'complete' });
      expect((v2.reasoning!.basis as { entries: Array<{ source: string; evidenceRefs: string[] }> }).entries[0]).toMatchObject({ source: 'diretrizesEspecificasDoTreinadorParaEsteAluno', evidenceRefs: [expect.stringMatching(/^directive:/)] });
      expect(v2.reasoning!.expected).toEqual({ text: 'Concluir 7 km sem dor' });
    });

    it('exclusao de dados de provedor: o raciocinio apoiado em evidencia dele e invalidado; o apoiado so em fontes independentes fica', async () => {
      agent.declare = true;
      const nina = await seedRoutineStudent('nina-12b');
      await seedActivity(nina.userId, 'polar', '2026-10-06T08:00:00Z', 'polar-nina');
      await generate(nina.userId);
      const before = await decisionsOf(nina.userId);
      const result = await deletion.executeProviderDataDeletion(nina.userId, 'polar');
      expect(result.declaredReasoningInvalidated).toBe(1);
      const [first, second] = await decisionsOf(nina.userId);
      expect(first).toMatchObject({ intent: null, expected: null, traceStatus: 'partial' });
      const basis = first.basis as unknown as { providers: string[]; invalidatedProviders: string[]; entries: Array<{ source: string; note: string | null; removed?: boolean; evidenceRefs: string[] }> };
      expect(basis).toMatchObject({ providers: [], invalidatedProviders: ['polar'] });
      expect(basis.entries.find((e) => e.source === 'athleteStateContext')).toMatchObject({ note: null, removed: true, evidenceRefs: [] });
      expect(basis.entries.find((e) => e.source === 'relatosEstruturadosDoAluno')!.note).toBe('esteira limitada'); // independente: fica
      // o historico desta aluna nao deriva de dispositivo (nenhuma sessao extra/copia): essa entrada fica, mesmo na decisao invalidada
      expect(basis.entries.find((e) => e.source === 'historicoSemanal')!.note).toBe('ritmo recente 7:15/km');
      expect(JSON.stringify(first)).not.toMatch(/171\.6|Objetivo do dia/);
      // a decisao sem apoio em dispositivo permanece integra
      expect(second).toMatchObject({ intent: before[1].intent, traceStatus: 'complete' });
      // idempotente
      expect((await deletion.executeProviderDataDeletion(nina.userId, 'polar')).declaredReasoningInvalidated).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('4) valores de execucao no texto enviado a IA (historicoSemanal, recorde, prontuario): a classe inteira, nao so athleteStateContext', () => {
    const SENT_SUMMARY = 'SENTINELA_PRONTUARIO';
    const SENT_EVENT = 'SENTINELA_EVOLUCAO';
    const REMOVED = '[registro removido: dado derivado de servico excluido pelo aluno]';
    const week = (pkg: { agentInput: unknown }) => JSON.parse(promptOf(pkg.agentInput)).historicoSemanal[0] as Record<string, unknown> & { recordedSessions: string[] };
    const parsed = (pkg: { agentInput: unknown }) => JSON.parse(promptOf(pkg.agentInput)) as Record<string, any>;

    // Aluno com: (0) sessao prescrita cujo registro e COPIA exata da atividade da Wahoo; (1) sessao EXTRA do relogio da Polar; (2) sessao prescrita
    // cujo registro o aluno informou DIFERENTE da atividade da Garmin (independente); prontuario com resumo e eventos (um deles e a reavaliacao).
    async function seedExecutionStudent(label: string, options: { independentCompletion?: boolean } = {}) {
      const s = await seedRoutineStudent(label);
      const wahoo = await seedActivity(s.userId, 'wahoo', '2026-09-29T08:00:00Z', `wahoo-${label}`);
      await prisma.activityLog.update({ where: { id: wahoo.id }, data: { distanceMeters: 5100, durationSec: 2460 } });
      await prisma.sessionExecutionLink.create({ data: { userId: s.userId, trainingSessionId: s.sessionIds[0], activityLogId: wahoo.id, status: 'active', origin: 'automatic' } });
      const polar = await seedActivity(s.userId, 'polar', '2026-09-30T08:00:00Z', `polar-${label}`);
      const extra = await prisma.trainingSession.create({
        data: { planId: s.planId, userId: s.userId, scheduledDate: new Date('2026-09-30T00:00:00Z'), weekday: 2, modality: 'corrida', title: 'corrida (extra)', durationMin: 40, distanceKm: 5, structure: { type: 'extra', source: 'device', provider: 'polar', activityLogId: polar.id }, origin: 'device_extra' },
      });
      await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: extra.id, status: 'done', durationMin: 40, distanceKm: 5 } });
      if (options.independentCompletion !== false) {
        const garmin = await seedActivity(s.userId, 'garmin', '2026-10-01T08:00:00Z', `garmin-${label}`);
        await prisma.sessionExecutionLink.create({ data: { userId: s.userId, trainingSessionId: s.sessionIds[1], activityLogId: garmin.id, status: 'active', origin: 'automatic' } });
        await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: s.sessionIds[1], status: 'done', distanceKm: 10, durationMin: 70, painFlag: 'none' } });
      }
      await prisma.studentProfile.create({ data: { userId: s.userId, summary: `Prontuario com ${SENT_SUMMARY}` } });
      await prisma.studentProfileEvent.create({ data: { userId: s.userId, code: 'WORKOUT_COMPLETED', content: 'Feedback independente do aluno', createdAt: new Date('2026-10-02T10:00:00Z') } });
      await prisma.studentProfileEvent.create({ data: { userId: s.userId, code: 'REASSESSMENT_COMPLETED', content: `Reavaliacao periodica concluida. Resumo de evolucao: ${SENT_EVENT}`, createdAt: new Date('2026-10-03T10:00:00Z') } });
      return s;
    }
    const prescribedSnapshot = async (planId: string) => JSON.stringify(await prisma.trainingSession.findMany({ where: { planId, origin: { not: 'device_extra' } }, orderBy: { id: 'asc' }, select: { id: true, structure: true, durationMin: true, distanceKm: true, paceMinSec: true, weekday: true } }));

    it('historico derivado de provedor: exclusoes SUCESSIVAS alcançam so o que cada provedor contamina; registro independente e prescricoes originais ficam', async () => {
      const helena = await seedExecutionStudent('helena-exec');
      await generate(helena.userId);
      const before = await packageOf(helena.userId);
      const original = week(before);
      const text0 = promptOf(before.agentInput);
      expect(text0).toContain(SENT_SUMMARY);
      expect(text0).toContain(SENT_EVENT);
      expect(original.recordedSessions).toHaveLength(3);
      // indice: derivacao por campo e por linha, so nomes e posicoes
      const item = (before.evidence as unknown as EvidenceItem[]).find((e) => e.ref === 'history_week:2026-09-28')!;
      expect(item.derivation?.fields).toMatchObject({ prescribedSessions: ['polar'], runMinutes: ['polar'], completedSessions: ['polar', 'wahoo'], longestRunDate: ['polar', 'wahoo'] });
      expect(item.derivation?.entries).toEqual([{ index: 0, providers: ['wahoo'] }, { index: 1, providers: ['polar'] }]);
      expect(JSON.stringify(item.derivation)).not.toMatch(/km|min\b/);
      expect(before.sourceProviders).toEqual(['garmin', 'polar', 'wahoo']);
      expect(before.schemaVersion).toBe(2);
      const prescribedBefore = await prescribedSnapshot(helena.planId);

      // 1) WAHOO
      const r1 = await deletion.executeProviderDataDeletion(helena.userId, 'wahoo');
      expect(r1.agentInputsRedacted).toBe(1);
      let pkg = await packageOf(helena.userId);
      let w = week(pkg);
      for (const field of ['completedSessions', 'completedRunMinutes', 'longestRunMinutes', 'longestRunDate']) expect(w).not.toHaveProperty(field);
      expect(w.prescribedSessions).toBe(original.prescribedSessions); // so da Polar
      expect(w.runMinutes).toBe(original.runMinutes);
      expect(w.unregisteredSessions).toBe(original.unregisteredSessions);
      expect(w.weekStartDate).toBe('2026-09-28');
      expect(w.recordedSessions).toEqual([REMOVED, original.recordedSessions[1], original.recordedSessions[2]]);
      expect(parsed(pkg).prontuarioDoAluno).toBeNull(); // narrativa que pode ter absorvido o relatorio de evolucao
      const events = parsed(pkg).eventosDoProntuarioAindaNaoCondensados as string[];
      expect(events[0]).toContain('Feedback independente do aluno');
      expect(events[1]).toBe(REMOVED);
      expect(promptOf(pkg.agentInput)).not.toContain(SENT_SUMMARY);
      expect(promptOf(pkg.agentInput)).not.toContain(SENT_EVENT);
      // o indice nao guarda mais o trecho da narrativa; a derivacao da Polar continua registrada
      const afterItem = (pkg.evidence as unknown as EvidenceItem[]).find((e) => e.ref === 'history_week:2026-09-28')!;
      expect(afterItem.derivation?.fields).toEqual({ prescribedSessions: ['polar'], runMinutes: ['polar'] });
      expect(afterItem.invalidatedProviders).toEqual(['wahoo']);
      expect(JSON.stringify(pkg.evidence)).not.toContain(SENT_EVENT);

      // 2) POLAR
      const r2 = await deletion.executeProviderDataDeletion(helena.userId, 'polar');
      expect(r2.agentInputsRedacted).toBe(1);
      pkg = await packageOf(helena.userId);
      w = week(pkg);
      expect(w).not.toHaveProperty('prescribedSessions');
      expect(w).not.toHaveProperty('runMinutes');
      expect(w.recordedSessions).toEqual([REMOVED, REMOVED, original.recordedSessions[2]]); // o registro independente (Garmin, valor diferente) permanece
      expect(w.unregisteredSessions).toBe(original.unregisteredSessions);

      // 3) GARMIN: nada de execucao dependia dela; sem novo marcador de execucao
      const markersBefore = (pkg.agentInputRedactions as unknown[]).length;
      await deletion.executeProviderDataDeletion(helena.userId, 'garmin');
      pkg = await packageOf(helena.userId);
      expect(week(pkg).recordedSessions[2]).toBe(original.recordedSessions[2]);
      expect((pkg.agentInputRedactions as unknown[]).length).toBeGreaterThanOrEqual(markersBefore);
      expect(parsed(pkg).objetivo).toBe('Correr 10km');
      expect(promptOf(pkg.agentInput)).toContain('Evitar corrida na quarta');
      expect(promptOf(pkg.agentInput)).toContain('A esteira do aluno vai so ate 12 km/h');

      // marcadores: nomes de campo e indices, nunca valores
      const markers = JSON.stringify(pkg.agentInputRedactions);
      expect(markers).toContain('historicoSemanal[2026-09-28].completedRunMinutes');
      expect(markers).toContain('historicoSemanal[2026-09-28].recordedSessions[0]');
      for (const leaked of [SENT_SUMMARY, SENT_EVENT, '10km', '5.1km']) expect(markers).not.toContain(leaked);

      // prescricoes originais intocadas
      expect(await prescribedSnapshot(helena.planId)).toBe(prescribedBefore);
      expect(await prisma.workoutCompletion.count({ where: { sessionId: helena.sessionIds[1] } })).toBe(1); // registro independente segue no dominio vivo
    });

    it('pacote SEM athleteStateContext: o historico derivado e as narrativas tambem sao alcancados', async () => {
      const kauan = await seedExecutionStudent('kauan-exec');
      await generate(kauan.userId, { snapshotFails: true });
      const before = await packageOf(kauan.userId);
      expect(parsed(before).athleteStateContext).toBeNull();
      expect(before.sourceProviders).toEqual(['garmin', 'polar', 'wahoo']); // sem agregados de atividade; a Garmin entra pela narrativa (prontuario/eventos)
      expect(promptOf(before.agentInput)).toContain(SENT_EVENT);

      const result = await deletion.executeProviderDataDeletion(kauan.userId, 'polar');
      expect(result.agentInputsRedacted).toBe(1);
      const pkg = await packageOf(kauan.userId);
      const w = week(pkg);
      expect(w).not.toHaveProperty('prescribedSessions');
      expect(w.recordedSessions[1]).toBe(REMOVED);
      expect(w.recordedSessions[2]).toBe(week(before).recordedSessions[2]);
      expect(parsed(pkg).prontuarioDoAluno).toBeNull();
      expect(promptOf(pkg.agentInput)).not.toContain(SENT_EVENT);
      expect(parsed(pkg).athleteStateContext).toBeNull();
    });

    it('recorde (maiorLongaoJaRegistrado) e treinos perto do recorde: derivados saem por posicao; independentes ficam; exclusoes sucessivas', async () => {
      const joana = await seedRoutineStudent('joana-exec');
      const mk = async (km: number, min: number, date: string, weekday: number, provider: string | null) => {
        const session = await prisma.trainingSession.create({ data: { planId: joana.planId, userId: joana.userId, scheduledDate: new Date(date), weekday, modality: 'corrida', title: 'Corrida', structure: { type: 'run' }, origin: 'agent', durationMin: min, distanceKm: km } });
        await prisma.workoutCompletion.create({ data: { userId: joana.userId, sessionId: session.id, status: 'done', distanceKm: km, durationMin: min, painFlag: 'none' } });
        if (provider) {
          const activity = await seedActivity(joana.userId, provider, `${date.slice(0, 10)}T08:00:00Z`, `${provider}-joana-${km}`);
          await prisma.activityLog.update({ where: { id: activity.id }, data: { distanceMeters: km * 1000, durationSec: min * 60 } });
          await prisma.sessionExecutionLink.create({ data: { userId: joana.userId, trainingSessionId: session.id, activityLogId: activity.id, status: 'active', origin: 'automatic' } });
        }
      };
      await mk(9, 60, '2026-09-22T00:00:00Z', 1, 'wahoo'); // recorde, copia da Wahoo
      await mk(8.5, 55, '2026-09-23T00:00:00Z', 2, 'polar'); // perto do recorde, copia da Polar
      await mk(6, 40, '2026-09-24T00:00:00Z', 3, null); // independente
      await generate(joana.userId);
      const before = parsed(await packageOf(joana.userId));
      expect(before.maiorLongaoJaRegistrado.distanciaKm).toBe(9);
      expect(before.sessoesRecentesPertoDoRecorde.map((s: { distanciaKm: number }) => s.distanciaKm)).toEqual([9, 8.5, 6, 5.1]);

      await deletion.executeProviderDataDeletion(joana.userId, 'wahoo');
      let after = parsed(await packageOf(joana.userId));
      expect(after.maiorLongaoJaRegistrado).toBeNull();
      expect(after.sessoesRecentesPertoDoRecorde).toEqual([{ removido: true }, before.sessoesRecentesPertoDoRecorde[1], before.sessoesRecentesPertoDoRecorde[2], before.sessoesRecentesPertoDoRecorde[3]]);

      await deletion.executeProviderDataDeletion(joana.userId, 'polar');
      after = parsed(await packageOf(joana.userId));
      expect(after.sessoesRecentesPertoDoRecorde).toEqual([{ removido: true }, { removido: true }, before.sessoesRecentesPertoDoRecorde[2], before.sessoesRecentesPertoDoRecorde[3]]);
      const item = ((await packageOf(joana.userId)).evidence as unknown as EvidenceItem[]).find((e) => e.ref === 'record:longest_run')!;
      expect(item).toMatchObject({ providers: [], invalidatedProviders: ['wahoo'] });
    });

    it('regeneracao de UM dia: prontuario e eventos derivados tambem saem do texto guardado do dia', async () => {
      const mira = await seedExecutionStudent('mira-exec', { independentCompletion: false });
      await prisma.trainingSession.update({ where: { id: mira.sessionIds[1] }, data: { scheduledDate: new Date('2026-10-14T00:00:00Z'), weekday: 3 } });
      await plansService().regenerateSession(mira.userId, mira.sessionIds[1]);
      const day = await packageOf(mira.userId, 'day_regeneration');
      expect(day.schemaVersion).toBe(2);
      expect(day.sourceProviders).toEqual(['polar', 'wahoo']);
      expect(promptOf(day.agentInput)).toContain(SENT_SUMMARY);
      const result = await deletion.executeProviderDataDeletion(mira.userId, 'wahoo');
      expect(result.agentInputsRedacted).toBe(1);
      const after = await packageOf(mira.userId, 'day_regeneration');
      expect(parsed(after).prontuarioDoAluno).toBeNull();
      expect(parsed(after).eventosDoProntuarioAindaNaoCondensados[0]).toContain('Feedback independente do aluno');
      expect(promptOf(after.agentInput)).not.toContain(SENT_EVENT);
      expect(promptOf(after.agentInput)).toContain('A esteira do aluno vai so ate 12 km/h'); // relato do aluno permanece
    });

    it('pacote de versao anterior (sem derivacao registrada): todo valor de execucao derivavel e invalidado; o que e do aluno por natureza fica', async () => {
      const lia = await seedExecutionStudent('lia-exec');
      await generate(lia.userId);
      await prisma.$executeRaw`UPDATE "PrescriptionEvidencePackage" SET "schemaVersion" = 1 WHERE "userId" = ${lia.userId}`;
      const before = week(await packageOf(lia.userId));
      await deletion.executeProviderDataDeletion(lia.userId, 'qualquer');
      const pkg = await packageOf(lia.userId);
      const w = week(pkg);
      expect(w.recordedSessions).toEqual([REMOVED, REMOVED, REMOVED]);
      expect(w).not.toHaveProperty('completedRunMinutes');
      expect(w.weekStartDate).toBe('2026-09-28');
      expect(w.unregisteredSessions).toBe(before.unregisteredSessions);
      expect(parsed(pkg).prontuarioDoAluno).toBeNull();
      expect(parsed(pkg).objetivo).toBe('Correr 10km');
      expect(promptOf(pkg.agentInput)).toContain('Evitar corrida na quarta');
      const item = (pkg.evidence as unknown as EvidenceItem[]).find((e) => e.ref === 'history_week:2026-09-28')!;
      expect(item.excerpt).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('3) carga semanal (weekly_training_load): D1-D4 de Elton', () => {
    const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const textOf = (agentInput: unknown) => promptOf(agentInput);
    const idsOf = (pkg: { evidence: unknown }) => (pkg.evidence as unknown as EvidenceItem[]).filter((e) => e.ref.startsWith('variable:')).map((e) => e.ref.slice('variable:'.length));
    let frida: Awaited<ReturnType<typeof seedRoutineStudent>>;

    beforeAll(async () => {
      frida = await seedRoutineStudent('frida-carga');
      const polar = await seedActivity(frida.userId, 'polar', '2026-10-06T08:00:00Z', 'polar-f-0');
      const wahoo = await seedActivity(frida.userId, 'wahoo', '2026-09-29T08:00:00Z', 'wahoo-f-0');
      const garmin = await seedActivity(frida.userId, 'garmin', '2026-10-01T08:00:00Z', 'garmin-f-0');
      // (a) sessao EXTRA criada a partir da atividade da Polar
      await prisma.trainingSession.create({
        data: { planId: frida.planId, userId: frida.userId, scheduledDate: new Date('2026-10-06T00:00:00Z'), weekday: 2, modality: 'corrida', title: 'corrida (extra)', structure: { type: 'extra', source: 'device', provider: 'polar', activityLogId: polar.id }, origin: 'device_extra' },
      });
      // (b) sessao PRESCRITA cujo registro e COPIA exata da atividade da Wahoo (5,1 km em 41 min) — derivado, mesmo sem edicao (D2)
      await prisma.activityLog.update({ where: { id: wahoo.id }, data: { distanceMeters: 5100, durationSec: 2460 } });
      await prisma.sessionExecutionLink.create({ data: { userId: frida.userId, trainingSessionId: frida.sessionIds[0], activityLogId: wahoo.id, status: 'active', origin: 'automatic' } });
      // (c) sessao PRESCRITA cujo registro o aluno informou DIFERENTE da atividade da Garmin — independente
      await prisma.workoutCompletion.create({ data: { userId: frida.userId, sessionId: frida.sessionIds[1], status: 'done', distanceKm: 10, durationMin: 70, painFlag: 'none' } });
      await prisma.sessionExecutionLink.create({ data: { userId: frida.userId, trainingSessionId: frida.sessionIds[1], activityLogId: garmin.id, status: 'active', origin: 'automatic' } });
      await generate(frida.userId);
    });

    it('a geracao registra a proveniencia por variavel: prescrito sem provedor; extras da Polar; copia da Wahoo; Garmin so em atividade', async () => {
      const pkg = await packageOf(frida.userId);
      const providers = (id: string) => (pkg.evidence as unknown as EvidenceItem[]).find((e) => e.ref === `variable:${id}`)?.providers;
      expect(providers('training.volumePrescribedKm')).toBeUndefined();
      expect(providers('training.volumeExtraKm')).toEqual(['polar']);
      expect(providers('training.volumeCompletedPrescribedOnlyKm')).toEqual(['wahoo']);
      expect(providers('training.adherencePercent')).toEqual(['wahoo']);
      for (const id of ['training.volumeCompletedTotalKm', 'training.volumeDiffAbsoluteKm', 'training.volumeRatioCompletedPrescribed', 'training.acwr']) expect(providers(id)).toEqual(['polar', 'wahoo']);
      expect(providers('activity.avgPaceSecondsKm')).toEqual(['garmin', 'polar', 'wahoo']);
      expect(providers('workout.perceivedEffort')).toBeUndefined();
      expect(pkg.sourceProviders).toEqual(['garmin', 'polar', 'wahoo']); // garmin so por atividade; NAO por carga (registro independente)
      const text = textOf(pkg.agentInput);
      for (const value of Object.values(LOAD)) expect(text).toContain(String(value));
    });

    it('excluir a POLAR invalida extra, agregados mistos e ACWR (D1/D3); preserva prescrito, aderencia/registro da Wahoo e outras fontes; nao toca os treinos prescritos', async () => {
      const prescribedBefore = await prisma.trainingSession.findMany({ where: { planId: frida.planId, origin: { not: 'device_extra' } }, orderBy: { id: 'asc' }, select: { id: true, structure: true, durationMin: true, distanceKm: true, paceMinSec: true, weekday: true } });
      const decisionsBefore = await prisma.prescriptionDecision.findMany({ where: { userId: frida.userId, kind: 'session' }, orderBy: { id: 'asc' }, select: { id: true, sessionSnapshot: true, sessionSnapshotSha256: true } });

      const result = await deletion.executeProviderDataDeletion(frida.userId, 'polar');
      expect(result.agentInputsRedacted).toBe(1);
      const pkg = await packageOf(frida.userId);
      const text = textOf(pkg.agentInput);
      const gone = [LOAD.extra, LOAD.total, LOAD.diff, LOAD.ratio, LOAD.acwr, DEVICE_PACE, DEVICE_CADENCE];
      const kept = [LOAD.prescribed, LOAD.prescribedOnly, LOAD.adherence, OTHER_EFFORT];
      for (const value of gone) expect(text).not.toContain(String(value));
      for (const value of kept) expect(text).toContain(String(value));
      expect(text).toContain('Evitar corrida na quarta');
      expect(text).toContain('A esteira do aluno vai so ate 12 km/h');
      expect(pkg.agentInputRedactions).toEqual([expect.objectContaining({
        provider: 'polar', reason: 'provider_data_deleted', callsChanged: 1,
        removedVariableIds: ['activity.avgPaceSecondsKm', 'activity.cadenceAvg', 'training.acwr', 'training.volumeCompletedTotalKm', 'training.volumeDiffAbsoluteKm', 'training.volumeExtraKm', 'training.volumeRatioCompletedPrescribed'],
      })]);
      // marcador sem nenhum valor; indice sem datas nem referencias dos itens invalidados
      for (const value of gone) expect(JSON.stringify(pkg.agentInputRedactions)).not.toContain(String(value));
      expect(idsOf(pkg).sort()).toEqual(['training.adherencePercent', 'training.volumeCompletedPrescribedOnlyKm', 'training.volumePrescribedKm', 'workout.perceivedEffort']);
      expect((pkg.evidence as unknown as EvidenceItem[]).filter((e) => e.redacted)).toHaveLength(7);

      // D4/regra 4: treinos prescritos e suas decisoes/versoes NAO mudam
      const prescribedAfter = await prisma.trainingSession.findMany({ where: { planId: frida.planId, origin: { not: 'device_extra' } }, orderBy: { id: 'asc' }, select: { id: true, structure: true, durationMin: true, distanceKm: true, paceMinSec: true, weekday: true } });
      expect(sha(prescribedAfter)).toBe(sha(prescribedBefore));
      const decisionsAfter = await prisma.prescriptionDecision.findMany({ where: { userId: frida.userId, kind: 'session' }, orderBy: { id: 'asc' }, select: { id: true, sessionSnapshot: true, sessionSnapshotSha256: true } });
      expect(sha(decisionsAfter)).toBe(sha(decisionsBefore));
    });

    it('excluir a WAHOO invalida o que dependia da copia do relogio (aderencia e realizado das prescritas — D2); o volume prescrito segue intacto', async () => {
      const result = await deletion.executeProviderDataDeletion(frida.userId, 'wahoo');
      expect(result.agentInputsRedacted).toBe(1);
      const pkg = await packageOf(frida.userId);
      const text = textOf(pkg.agentInput);
      expect(text).not.toContain(String(LOAD.adherence));
      expect(text).not.toContain(String(LOAD.prescribedOnly));
      expect(text).toContain(String(LOAD.prescribed));
      expect(text).toContain(String(OTHER_EFFORT));
      expect(idsOf(pkg).sort()).toEqual(['training.volumePrescribedKm', 'workout.perceivedEffort']);
      expect(pkg.agentInputRedactions).toHaveLength(2);
    });

    it('excluir a GARMIN (so atividade; registro do aluno independente) nao invalida nada de carga e e idempotente', async () => {
      const before = await packageOf(frida.userId);
      const result = await deletion.executeProviderDataDeletion(frida.userId, 'garmin');
      expect(result).toMatchObject({ evidenceRedacted: 0, agentInputsRedacted: 0 });
      const after = await packageOf(frida.userId);
      expect(after.agentInput).toEqual(before.agentInput);
      expect(after.evidence).toEqual(before.evidence);
      expect(textOf(after.agentInput)).toContain(String(LOAD.prescribed));
      // o registro independente do aluno segue la
      expect(await prisma.workoutCompletion.count({ where: { sessionId: frida.sessionIds[1] } })).toBe(1);
    });

    it('pacote sem proveniencia registrada: todas as derivaveis de dispositivo saem, o volume prescrito nunca', async () => {
      const gil = await seedRoutineStudent('gil-carga');
      await generate(gil.userId);
      await prisma.$executeRaw`UPDATE "PrescriptionEvidencePackage" SET "sourceProviders" = NULL WHERE "userId" = ${gil.userId}`;
      await deletion.executeProviderDataDeletion(gil.userId, 'qualquer');
      const text = textOf((await packageOf(gil.userId)).agentInput);
      for (const value of [LOAD.extra, LOAD.total, LOAD.diff, LOAD.ratio, LOAD.acwr, LOAD.adherence, LOAD.prescribedOnly]) expect(text).not.toContain(String(value));
      expect(text).toContain(String(LOAD.prescribed));
    });
  });
});
