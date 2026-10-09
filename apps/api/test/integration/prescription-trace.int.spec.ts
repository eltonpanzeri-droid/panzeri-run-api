import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AccountDeletionService } from '../../src/account-deletion/account-deletion.service';
import { ProviderDataDeletionService } from '../../src/activity-execution/provider-data-deletion.service';
import { PolarService } from '../../src/polar/polar.service';
import { PrescriptionAgentService, PaceEvidence } from '../../src/training-plans/prescription-agent.service';
import { recordAgentCall, AgentCallTrace, EvidenceItem } from '../../src/training-plans/prescription-trace';
import { PrescriptionTraceService } from '../../src/training-plans/prescription-trace.service';
import { StudentProfileService } from '../../src/training-plans/student-profile.service';
import { computeRunSlots, computeStrengthSlots, MethodologyInput, WeeklyMethodologyDecision } from '../../src/training-plans/training-methodology';
import { TrainingPlansService } from '../../src/training-plans/training-plans.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Etapa 1.2a (09/10/2026) — rastreabilidade das prescricoes em PostgreSQL 17 REAL (dados sinteticos). O Prescritor e' simulado, mas
// monta os prompts com o codigo REAL (buildUserPrompt) e grava o registro do que "enviou a IA" exatamente como o servico real faz.

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

class FakeAgent extends PrescriptionAgentService {
  weeklyCalls = 0;
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
        parts: index === 0
          ? [{ kind: 'continua' as const, distanceKm: 5, paceSecondsPerKmMin: 480, paceSecondsPerKmMax: 480 }]
          : [{ kind: 'intervalada' as const, repeatCount: 6, stimulusLabel: 'Correr forte', stimulusStepKm: 0.4, stimulusPaceSecondsPerKm: 360, recoveryLabel: 'Trotar', recoveryStepKm: 0.2, recoveryPaceSecondsPerKm: 540 }],
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
    return { parts: [{ kind: 'continua' as const, distanceKm: 6, paceSecondsPerKmMin: 450, paceSecondsPerKmMax: 450 }] };
  }
}

describe('rastreabilidade das prescricoes (PostgreSQL 17 real, dados sinteticos)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const config = (overrides: Record<string, string> = {}) => ({ get: (name: string) => overrides[name] });
  const trace = new PrescriptionTraceService(prisma as never, config() as never);
  const agent = new FakeAgent();
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };

  function plansService(opts: { traceService?: PrescriptionTraceService | undefined } = { traceService: trace }) {
    const studentProfile = new StudentProfileService(prisma as never, { condenseProfile: async () => null } as never);
    return new TrainingPlansService(
      prisma as never, agent as never,
      { computeSafetyTier: async () => ({ tier: 'normal', reason: null }) } as never,
      { activeGoals: async () => [] } as never,
      telegram as never, studentProfile as never,
      { notifyUser: async () => undefined } as never, {} as never,
      { getAgentContext: async () => null } as never,
      { getSnapshot: async () => { throw new Error('snapshot indisponivel no teste'); } } as never,
      { isReassessmentDue: async () => false, getLatestValidEvolutionReport: async () => null } as never,
      { retryStalledAnalyses: async () => ({ attempted: 0, resolved: 0, stillPending: 0 }) } as never,
      {} as never, {} as never,
      opts.traceService as never,
    );
  }

  async function seedRoutineStudent(label: string) {
    const student = await seedStudent(prisma, label);
    userIds.push(student.userId);
    await prisma.onboardingInterview.create({ data: { userId: student.userId, answers: { weekly_running_km: '10-20' }, completedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.weeklyAvailability.createMany({ data: [{ userId: student.userId, weekday: 2, modalities: ['corrida'], availableMin: 40 }, { userId: student.userId, weekday: 4, modalities: ['corrida'], availableMin: 45 }] });
    await prisma.userPreferences.create({ data: { userId: student.userId, mainGoal: 'Correr 10km', preferredModalities: ['corrida'], otherModalities: [], trainingLocations: [] } });
    // observacao do aluno + diretriz + relato SEM interpretacao (texto longo, para armazenamento parcial) + relato persistente (ja semeado)
    await prisma.studentObservation.create({ data: { userId: student.userId, content: 'Minha academia nao tem hack squat', active: true } });
    await prisma.studentDirective.create({ data: { userId: student.userId, content: 'Evitar corrida na quarta', active: true } });
    await prisma.studentReportEntry.create({ data: { userId: student.userId, sourceType: 'workout_feedback_notes', originalText: `Nao estou conseguindo correr no pace pedido. ${'x'.repeat(400)}`, occurredAt: new Date(), createdAt: new Date(), analyzedAt: null } });
    return student;
  }

  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-10-12T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
  afterAll(async () => {
    jest.useRealTimers();
    await cleanupStudents(prisma, userIds);
    await prisma.$disconnect();
  });

  it('geracao semanal: pacote + decisoes gravados NA MESMA transacao; reconstrucao completa a partir dos registros', async () => {
    const student = await seedRoutineStudent('trilha');
    const service = plansService();
    const plan = await (service as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(student.userId);

    const result = await trace.getTrace(student.userId, { planId: plan.id, includeAgentInput: true });
    expect(result.packages).toHaveLength(1);
    const pkg = result.packages[0];

    // identificacao e versao
    expect(pkg).toMatchObject({ userId: student.userId, planId: plan.id, kind: 'weekly', schemaVersion: 1 });
    expect(pkg.methodologyVersion).toBeTruthy();
    expect(pkg.modelIds).toEqual(['claude-sonnet-5']);

    // 1) CONTEXTO EFETIVAMENTE ENVIADO: a entrada completa tem o prompt exato (hash confere) e o conteudo real do aluno
    const input = pkg.agentInput as unknown as { calls: Array<{ purpose: string; systemPromptSha256: string; userPromptSha256: string; userPrompt: string; userInput: Record<string, unknown> }> };
    expect(input.calls).toHaveLength(1);
    const sent = input.calls[0].userInput as { relatosEstruturadosDoAluno: Array<{ fatos: string }>; relatosAindaNaoInterpretadosDoAluno: Array<{ situacao: string }>; observacoesRegistradasPeloProprioAluno: string[]; lacunasDeContexto: Array<{ source: string }> };
    expect(sent.relatosEstruturadosDoAluno.map((r) => r.fatos)).toEqual(['A esteira do aluno vai so ate 12 km/h']);
    expect(sent.relatosAindaNaoInterpretadosDoAluno[0].situacao).toBe('em_processamento');
    expect(sent.observacoesRegistradasPeloProprioAluno[0]).toContain('Minha academia nao tem hack squat');
    expect(sent.lacunasDeContexto.map((g) => g.source)).toContain('estado_do_atleta');
    // FIDELIDADE: o texto exato enviado a IA foi guardado e seus hashes conferem (por chamada e do conjunto)
    expect(sha(input.calls[0].userPrompt)).toBe(input.calls[0].userPromptSha256);
    expect(JSON.parse(input.calls[0].userPrompt)).toEqual(sent);
    expect(sha(JSON.stringify([['semana', 'claude-sonnet-5', input.calls[0].systemPromptSha256, input.calls[0].userPrompt]]))).toBe(pkg.agentInputHash);

    // 2) INDICE DE EVIDENCIAS: entregue / entregue sem processar / ausente + como foi guardado (completo / parcial / so referencia)
    const evidence = pkg.evidence as unknown as EvidenceItem[];
    const byKind = (kind: string) => evidence.filter((e) => e.kind === kind);
    expect(byKind('report')[0]).toMatchObject({ ref: `report:${student.reportEntryIds[0]}`, delivery: 'delivered', storage: 'complete', sourceId: student.reportEntryIds[0] });
    expect(byKind('report_pending')[0]).toMatchObject({ delivery: 'delivered_unprocessed', storage: 'partial' }); // texto > 300: trecho no indice, integral em agentInput
    expect(byKind('directive')[0]).toMatchObject({ delivery: 'delivered', storage: 'complete' });
    expect(byKind('observation')[0].excerpt).toContain('hack squat');
    expect(byKind('gap').find((g) => g.ref === 'gap:estado_do_atleta')).toMatchObject({ delivery: 'absent' }); // nao recuperado
    expect(byKind('gap').find((g) => g.ref === 'gap:relatos_do_aluno')).toMatchObject({ delivery: 'delivered' }); // pendente, mas entregue em texto bruto
    expect(byKind('interview')[0].storage).toBe('reference_only');
    expect(byKind('history_week').length).toBeGreaterThanOrEqual(0);
    expect(evidence.some((e) => e.ref.includes('strava'))).toBe(false);

    // 3) DECISOES: uma da semana + uma por sessao criada, com resumo deterministico; resultado ainda sem registro
    const weekDecision = pkg.decisions.find((d) => d.kind === 'week')!;
    expect(weekDecision.summary).toContain('2 sessao(oes)');
    expect(weekDecision.rationale).toMatchObject({ recommendation: 'Semana de teste sintetico.', rationale: ['Decisao sintetica de teste.'] });
    const sessionDecisions = pkg.decisions.filter((d) => d.kind === 'session');
    expect(sessionDecisions).toHaveLength(2);
    expect(sessionDecisions.map((d) => d.summary)).toEqual([expect.stringMatching(/ter \| corrida \| continuo/), expect.stringMatching(/qui \| corrida \| intervalado/)]);
    expect(sessionDecisions.every((d) => d.traceStatus === 'absent' && d.basis === null && d.expected === null && d.intent === null)).toBe(true); // 1.2a: sem declaracao da IA
    expect(sessionDecisions.every((d) => d.outcome?.status === 'no_record')).toBe(true);

    // 4) RESULTADO POSTERIOR por vinculo: o aluno registra a execucao e a trilha passa a mostrar o resultado, sem copia
    const executed = sessionDecisions[0];
    await prisma.workoutCompletion.create({ data: { userId: student.userId, sessionId: executed.sessionId!, status: 'done', durationMin: 42, distanceKm: 5.2, avgPaceSecondsKm: 485, perceivedEffort: 7, painFlag: 'none' } });
    const later = await trace.getTrace(student.userId, { sessionId: executed.sessionId! });
    const outcome = later.packages[0].decisions.find((d) => d.sessionId === executed.sessionId)!.outcome!;
    expect(outcome.status).toBe('executed');
    expect(outcome.completion).toMatchObject({ status: 'done', distanceKm: 5.2, perceivedEffort: 7 });

    // 5) sem includeAgentInput a entrada completa NAO sai (dado pessoal)
    const lean = await trace.getTrace(student.userId, { planId: plan.id });
    expect((lean.packages[0] as Record<string, unknown>).agentInput).toBeUndefined();
    expect(lean.packages[0].agentInputAvailable).toBe(true);
  });

  it('a semana seguinte aponta o que existia no mesmo dia/modalidade na semana anterior (changeFromPrevious) e reconhece planos antigos', async () => {
    const student = await seedRoutineStudent('mudanca');
    const service = plansService() as unknown as { generateWeekLocked: (userId: string, ...rest: unknown[]) => Promise<{ id: string }> };
    const first = await service.generateWeekLocked(student.userId);
    // simula a virada de semana: o plano gerado vira a "semana anterior"
    await prisma.trainingPlan.update({ where: { id: first.id }, data: { startDate: new Date('2026-10-05T00:00:00Z'), endDate: new Date('2026-10-11T00:00:00Z') } });
    await prisma.trainingSession.updateMany({ where: { planId: first.id }, data: { scheduledDate: new Date('2026-10-06T00:00:00Z') } });
    const second = await service.generateWeekLocked(student.userId);
    const result = await trace.getTrace(student.userId, { planId: second.id });
    const decisions = result.packages[0].decisions.filter((d) => d.kind === 'session');
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.some((d) => (d.changeFromPrevious as { previousSessionId?: string } | null)?.previousSessionId)).toBe(true);
    const evidence = result.packages[0].evidence as unknown as EvidenceItem[];
    expect(evidence.some((e) => e.kind === 'history_week')).toBe(true);
  });

  it('regeneracao de UM dia: pacote proprio + decisao com a prescricao anterior, na mesma transacao que reescreve o treino', async () => {
    const student = await seedRoutineStudent('dia');
    const sessionId = student.sessionIds[1];
    await prisma.trainingSession.update({ where: { id: sessionId }, data: { scheduledDate: new Date('2026-10-14T00:00:00Z'), weekday: 3 } });
    const before = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } });
    await plansService().regenerateSession(student.userId, sessionId);

    const result = await trace.getTrace(student.userId, { sessionId });
    expect(result.packages).toHaveLength(1);
    const pkg = result.packages[0];
    expect(pkg.kind).toBe('day_regeneration');
    expect(pkg.sessionId).toBe(sessionId);
    const decision = pkg.decisions[0];
    expect((decision.changeFromPrevious as { previousSummary: string }).previousSummary).toContain('intervalado');
    expect(decision.summary).toContain('corrida');
    // o treino foi realmente reescrito e a trilha corresponde ao que ficou gravado
    const after = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.structure).not.toEqual(before.structure);
    const pkgWithInput = (await trace.getTrace(student.userId, { sessionId, includeAgentInput: true })).packages[0];
    const sent = (pkgWithInput.agentInput as unknown as { calls: Array<{ purpose: string; userInput: { relatosEstruturadosDoAluno: Array<{ fatos: string }> } }> }).calls[0];
    expect(sent.purpose).toBe('dia_corrida');
    expect(sent.userInput.relatosEstruturadosDoAluno[0].fatos).toBe('A esteira do aluno vai so ate 12 km/h');
  });

  it('ATOMICIDADE: se a trilha nao puder ser gravada, o plano novo NAO e criado e o plano ativo anterior permanece (nenhuma prescricao sem trilha)', async () => {
    const student = await seedRoutineStudent('atomico');
    const failing = new PrescriptionTraceService(prisma as never, config() as never);
    jest.spyOn(failing, 'persistWeekly').mockRejectedValueOnce(new Error('falha simulada ao gravar a trilha'));
    const service = plansService({ traceService: failing }) as unknown as { generateWeekLocked: (userId: string) => Promise<unknown> };
    const plansBefore = await prisma.trainingPlan.count({ where: { userId: student.userId } });
    const sessionsBefore = await prisma.trainingSession.count({ where: { userId: student.userId } });
    await expect(service.generateWeekLocked(student.userId)).rejects.toThrow('falha simulada');
    expect(await prisma.trainingPlan.count({ where: { userId: student.userId } })).toBe(plansBefore);
    expect(await prisma.trainingSession.count({ where: { userId: student.userId } })).toBe(sessionsBefore);
    expect(await prisma.trainingPlan.findFirst({ where: { userId: student.userId, status: 'active' } })).not.toBeNull(); // plano anterior segue ativo
    expect(await prisma.prescriptionEvidencePackage.count({ where: { userId: student.userId } })).toBe(0);
  });

  it('RETENCAO configuravel: a entrada completa expira (padrao 12 meses); indice, decisoes e resultado permanecem; "off" desliga', async () => {
    const student = await seedRoutineStudent('retencao');
    const plan = await (plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(student.userId);
    const [pkg] = (await trace.getTrace(student.userId, { planId: plan.id })).packages;
    await prisma.prescriptionEvidencePackage.update({ where: { id: pkg.id }, data: { createdAt: new Date('2025-09-01T00:00:00Z') } }); // ~13 meses antes de "hoje" (12/10/2026)

    expect(trace.retentionMonths()).toBe(12);
    expect(new PrescriptionTraceService(prisma as never, config({ PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS: 'off' }) as never).retentionMonths()).toBeNull();
    expect(await new PrescriptionTraceService(prisma as never, config({ PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS: 'off' }) as never).purgeExpiredAgentInputs()).toBe(0);
    expect((await prisma.prescriptionEvidencePackage.findUniqueOrThrow({ where: { id: pkg.id } })).agentInput).not.toBeNull();

    const purged = await new PrescriptionTraceService(prisma as never, config({ PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS: '6' }) as never).purgeExpiredAgentInputs();
    expect(purged).toBeGreaterThanOrEqual(1);
    const after = await prisma.prescriptionEvidencePackage.findUniqueOrThrow({ where: { id: pkg.id }, include: { decisions: true } });
    expect(after.agentInput).toBeNull();
    expect(after.agentInputPurgedAt).toBeInstanceOf(Date);
    expect((after.evidence as unknown as EvidenceItem[]).length).toBeGreaterThan(3); // indice permanece
    expect(after.decisions.length).toBeGreaterThan(0); // decisoes permanecem
    const view = await trace.getTrace(student.userId, { planId: plan.id, includeAgentInput: true });
    expect(view.packages[0].agentInputAvailable).toBe(false);
    // um pacote recente nao e tocado
    const recent = await seedRoutineStudent('retencao-recente');
    const recentPlan = await (plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(recent.userId);
    await new PrescriptionTraceService(prisma as never, config() as never).purgeExpiredAgentInputs();
    expect((await prisma.prescriptionEvidencePackage.findFirstOrThrow({ where: { planId: recentPlan.id } })).agentInput).not.toBeNull();
  });

  it('DESCONECTAR um provedor NAO mexe na trilha; EXCLUSAO EXPLICITA de dados do provedor remove so os itens derivados dele', async () => {
    const student = await seedRoutineStudent('provedor');
    const plan = await (plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> }).generateWeekLocked(student.userId);
    const [pkg] = (await trace.getTrace(student.userId, { planId: plan.id })).packages;
    // injeta, no indice, itens que derivam diretamente de atividades Polar e Wahoo (hoje o fluxo de dispositivo entra por variaveis agregadas)
    const original = pkg.evidence as unknown as EvidenceItem[];
    const withProviders: EvidenceItem[] = [
      ...original,
      { ref: 'activity:polar-1', kind: 'activity', source: 'ActivityLog', sourceId: 'act-polar-1', provider: 'polar', asOf: '2026-10-01', label: 'Corrida Polar', delivery: 'delivered', storage: 'complete', excerpt: '5.0 km em 40 min' },
      { ref: 'activity:wahoo-1', kind: 'activity', source: 'ActivityLog', sourceId: 'act-wahoo-1', provider: 'wahoo', asOf: '2026-10-02', label: 'Corrida Wahoo', delivery: 'delivered', storage: 'complete', excerpt: '6.0 km em 48 min' },
    ];
    await prisma.prescriptionEvidencePackage.update({ where: { id: pkg.id }, data: { evidence: withProviders as never } });

    // desconectar a Polar (revogacao local + chamada ao provedor simulada) -> trilha INTACTA
    await prisma.polarConnection.create({ data: { userId: student.userId, polarUserId: `p-${student.userId.slice(0, 8)}`, accessTokenEncrypted: 'v1:sintetico', registeredAt: new Date() } });
    const originalFetch = global.fetch;
    global.fetch = (async () => ({ ok: true, status: 204 })) as never;
    try {
      const polar = new PolarService(prisma as never, { get: () => undefined } as never, new ProviderDataDeletionService(prisma as never));
      jest.spyOn(polar as never, 'deregisterAtPolar' as never).mockResolvedValue('revoked' as never);
      expect((await polar.disconnect(student.userId)).status).toBe('disconnected');
    } finally { global.fetch = originalFetch; }
    const afterDisconnect = (await prisma.prescriptionEvidencePackage.findUniqueOrThrow({ where: { id: pkg.id } })).evidence as unknown as EvidenceItem[];
    expect(afterDisconnect.find((e) => e.ref === 'activity:polar-1')).toMatchObject({ excerpt: '5.0 km em 40 min' });
    expect(afterDisconnect.some((e) => e.redacted)).toBe(false);

    // exclusao EXPLICITA de dados da Polar -> so os itens da Polar sao redigidos
    const result = await new ProviderDataDeletionService(prisma as never).executeProviderDataDeletion(student.userId, 'polar');
    expect(result.evidenceRedacted).toBe(1);
    const afterDeletion = (await prisma.prescriptionEvidencePackage.findUniqueOrThrow({ where: { id: pkg.id }, include: { decisions: true } }));
    const items = afterDeletion.evidence as unknown as EvidenceItem[];
    expect(items.find((e) => e.ref === 'redacted:polar')).toMatchObject({ redacted: true, excerpt: null, sourceId: null });
    expect(items.find((e) => e.ref === 'activity:polar-1')).toBeUndefined();
    expect(items.find((e) => e.ref === 'activity:wahoo-1')).toMatchObject({ excerpt: '6.0 km em 48 min' }); // outro provedor intacto
    expect(items.length).toBe(withProviders.length); // nada some, so e' redigido
    expect(afterDeletion.decisions.length).toBeGreaterThan(0);
  });

  it('EXCLUSAO DE CONTA apaga a trilha do aluno (pacotes e decisoes) e preserva a de outro aluno', async () => {
    const gone = await seedRoutineStudent('apagada');
    const kept = await seedRoutineStudent('mantida');
    const service = plansService() as unknown as { generateWeekLocked: (userId: string) => Promise<{ id: string }> };
    await service.generateWeekLocked(gone.userId);
    await service.generateWeekLocked(kept.userId);
    expect(await prisma.prescriptionDecision.count({ where: { userId: gone.userId } })).toBeGreaterThan(0);

    const result = await new AccountDeletionService(prisma as never).executeAccountDeletion(gone.userId);
    expect(result.status).toBe('deleted');
    expect(result.deleted.prescriptionEvidencePackage).toBeGreaterThan(0);
    expect(result.deleted.prescriptionDecision).toBeGreaterThan(0);
    expect(await prisma.prescriptionEvidencePackage.count({ where: { userId: gone.userId } })).toBe(0);
    expect(await prisma.prescriptionDecision.count({ where: { userId: gone.userId } })).toBe(0);
    expect(await prisma.prescriptionEvidencePackage.count({ where: { userId: kept.userId } })).toBe(1);
    // repetir e idempotente
    expect((await new AccountDeletionService(prisma as never).executeAccountDeletion(gone.userId)).status).toBe('already_deleted');
  });

  it('OBRIGATORIEDADE: sem o servico de rastreabilidade nenhuma prescricao e gerada — recusa ANTES de chamar a IA (semana e dia)', async () => {
    const student = await seedRoutineStudent('sem-trilha');
    const callsBefore = agent.weeklyCalls;
    const plansBefore = await prisma.trainingPlan.count({ where: { userId: student.userId } });
    const sessionsBefore = await prisma.trainingSession.count({ where: { userId: student.userId } });
    for (const broken of [undefined, {}, { persistWeekly: () => undefined }]) {
      const service = plansService({ traceService: broken as never });
      await expect((service as unknown as { generateWeekLocked: (userId: string) => Promise<unknown> }).generateWeekLocked(student.userId)).rejects.toThrow(/Rastreabilidade das prescricoes indisponivel/);
    }
    // regeneracao de um dia: mesma recusa (sessao no futuro, sem registro)
    const sessionId = student.sessionIds[1];
    await prisma.trainingSession.update({ where: { id: sessionId }, data: { scheduledDate: new Date('2026-10-14T00:00:00Z'), weekday: 3 } });
    const before = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } });
    const runSpy = jest.spyOn(agent, 'proposeRunSession');
    await expect(plansService({ traceService: undefined as never }).regenerateSession(student.userId, sessionId)).rejects.toThrow(/Rastreabilidade das prescricoes indisponivel/);
    expect(runSpy).not.toHaveBeenCalled();
    runSpy.mockRestore();
    expect(agent.weeklyCalls).toBe(callsBefore); // nenhuma chamada de IA gasta
    expect(await prisma.trainingPlan.count({ where: { userId: student.userId } })).toBe(plansBefore);
    expect(await prisma.trainingSession.count({ where: { userId: student.userId } })).toBe(sessionsBefore);
    expect((await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })).structure).toEqual(before.structure); // treino intocado
    expect(await prisma.prescriptionEvidencePackage.count({ where: { userId: student.userId } })).toBe(0);
  });
});
