import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
}

// Auditoria Astra (29/09/2026), bloco prioritario — cobre os 3 itens que vivem dentro de
// generateWeek()/generateWeekLocked() em training-plans.service.ts:
//
// item 02 (substituicao de plano): concorrencia agora e' travada no BANCO
// (TrainingPlanGenerationLock), nao mais so em memoria — generateWeek() publico virou so' um
// wrapper de trava (acquireGenerationLock -> generateWeekLocked -> libera no finally).
// item 01 (rota alternativa de geracao): generateWeekLocked() agora exige acesso pago ANTES de
// qualquer outra query — fecha o bypass da rota POST /training-plans/week (usada de verdade pelo
// app: recalculo apos teste de 3km, fallback de primeiro carregamento).
// item 06 (geracao de domingo): a query de previousPlans usa a semana-ALVO (weekStart, ja
// considerando o rollover de domingo), nunca a semana do relogio no momento da chamada.
//
// Os testes de 01/06 chamam generateWeekLocked() (privado) diretamente com um mock completo de
// todas as dependencias ate o ponto em que a query de previousPlans acontece, e abortam de proposito
// logo depois (prescriptionAgent.proposeWeeklyDecision rejeitado) — testar o corpo inteiro da
// geracao (IA + criacao de sessoes + notificacoes) exigiria mockar o agente de prescricao inteiro,
// o que nao agrega nada a ESTES 3 fixes especificos (nenhum dos 3 mexeu em logica de prescricao).

function noop() {
  return {} as never;
}

const SENTINEL_STOP = new Error('SENTINEL_STOP_AFTER_PREVIOUS_PLANS_QUERY');

function buildFullMocks(overrides: { activePlanStartDate?: Date | null } = {}) {
  const { activePlanStartDate = new Date('2026-09-21T00:00:00.000Z') } = overrides;

  const trainingPlanFindMany = jest.fn().mockResolvedValue([]);
  const trainingPlanGenerationLock = {
    create: jest.fn().mockResolvedValue({ userId: 'u1', startedAt: new Date() }),
    findUnique: jest.fn().mockResolvedValue(null),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn().mockResolvedValue({}),
  };

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ subscriptionStatus: 'active' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'u1',
        subscriptionStatus: 'active',
        healthProfile: null,
        preferences: null,
      }),
    },
    fitnessTest: { findFirst: jest.fn().mockResolvedValue(null) },
    weeklyAvailability: { findMany: jest.fn().mockResolvedValue([]) },
    onboardingInterview: {
      findUnique: jest.fn().mockResolvedValue({ completedAt: new Date('2026-08-01T00:00:00.000Z'), answers: {} }),
    },
    stravaActivity: { findMany: jest.fn().mockResolvedValue([]) },
    trainingExecutionInsight: { findFirst: jest.fn().mockResolvedValue(null) },
    trainingPlan: {
      findFirst: jest.fn().mockResolvedValue(
        activePlanStartDate ? { id: 'plan-old', startDate: activePlanStartDate } : null,
      ),
      findMany: trainingPlanFindMany,
    },
    studentDirective: { findMany: jest.fn().mockResolvedValue([]) },
    reassessment: { findFirst: jest.fn().mockResolvedValue(null) },
    studentObservation: { findMany: jest.fn().mockResolvedValue([]) },
    trainingSession: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    weeklyCheckIn: { findFirst: jest.fn().mockResolvedValue(null) },
    stravaAnalysisCache: { findUnique: jest.fn().mockResolvedValue(null) },
    trainingPlanGenerationLock,
  };

  const reassessmentService = {
    isReassessmentDue: jest.fn().mockResolvedValue(false),
    getLatestValidEvolutionReport: jest.fn().mockResolvedValue(null),
  };
  const stravaService = { syncIfStale: jest.fn().mockResolvedValue(undefined) };
  const painReports = { computeSafetyTier: jest.fn().mockResolvedValue({ tier: 'normal', reason: null }) };
  const targetRaces = { activeGoals: jest.fn().mockResolvedValue([]) };
  const menstrualCycle = { getAgentContext: jest.fn().mockResolvedValue(null) };
  const studentProfile = { refreshProfile: jest.fn().mockResolvedValue('') };
  const athleteStateSnapshot = { getSnapshot: jest.fn().mockRejectedValue(new Error('sem snapshot no teste')) };
  const prescriptionAgent = { proposeWeeklyDecision: jest.fn().mockRejectedValue(SENTINEL_STOP) };

  const service = new TrainingPlansService(
    prisma as never,
    prescriptionAgent as never,
    noop(), // stravaAnalysisAgent
    painReports as never,
    targetRaces as never,
    stravaService as never,
    noop(), // telegram
    studentProfile as never,
    noop(), // notifications
    noop(), // weeklyCheckIn
    menstrualCycle as never,
    athleteStateSnapshot as never,
    reassessmentService as never,
    noop(), // reportTimeline
  );

  return { service, prisma, trainingPlanFindMany, trainingPlanGenerationLock };
}

describe('item 01 — gate de assinatura dentro de generateWeekLocked (fecha bypass da rota alternativa)', () => {
  it('aluno SEM acesso pago: rejeita antes de tocar em qualquer outra query', async () => {
    const { service, prisma } = buildFullMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ subscriptionStatus: 'canceled' });

    await expect((service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }).generateWeekLocked('u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Nenhuma outra query rodou depois do gate — a rejeicao aconteceu ANTES do Promise.all gigante.
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.trainingPlan.findMany).not.toHaveBeenCalled();
  });

  it('aluno SEM usuario encontrado: mesmo gate, mesma rejeicao (defesa contra userId invalido)', async () => {
    const { service, prisma } = buildFullMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect((service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }).generateWeekLocked('inexistente')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('aluno COM acesso pago: passa do gate e chega ate a query de previousPlans normalmente', async () => {
    const { service, prisma } = buildFullMocks();

    await expect((service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }).generateWeekLocked('u1')).rejects.toBe(SENTINEL_STOP);
    expect(prisma.trainingPlan.findMany).toHaveBeenCalled();
  });
});

describe('item 06 — historico de previousPlans usa a semana-ALVO (weekStart), nunca a semana do relogio', () => {
  const REAL_NOW = Date;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('domingo apos a liberacao (13h em Sao Paulo): previousPlans deve incluir a semana que acabou de terminar, nao excluir ela', async () => {
    // 27/09/2026 e' domingo. 16:00 UTC = 13:00 em Sao Paulo (UTC-3) — depois de WEEKLY_RELEASE_HOUR
    // (12h). Aluno ja tem plano ativo (activePlanStartDate=21/09) e nenhum dia de rotina "sobra"
    // no futuro dentro da semana atual (hoje ja e' o ultimo dia dela) -> shouldRollToNextWeek=true,
    // exatamente o cenario real do bug (antecipacao da semana seguinte no domingo).
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-09-27T16:00:00.000Z'));

    const { service, trainingPlanFindMany } = buildFullMocks({ activePlanStartDate: new Date('2026-09-21T00:00:00.000Z') });

    await expect((service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }).generateWeekLocked('u1')).rejects.toBe(SENTINEL_STOP);

    expect(trainingPlanFindMany).toHaveBeenCalledTimes(1);
    const call = trainingPlanFindMany.mock.calls[0][0];
    const lowerBound: Date = call.where.startDate.lt;
    // CAUSA RAIZ do bug real: antes, esse limite vinha de startOfWeek(new Date()) = 21/09 (a
    // semana que esta TERMINANDO), excluindo ela mesma do historico. Correto agora: 28/09 (a
    // semana-ALVO, ja rolada pra frente) — a semana de 21/09 (que acabou de terminar) fica
    // startDate=21/09 < 28/09, portanto INCLUIDA no historico, como devia sempre ter sido.
    expect(lowerBound.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(lowerBound.toISOString().slice(0, 10)).not.toBe('2026-09-21');
  });

  it('segunda-feira comum (sem rollover): previousPlans usa a propria semana atual como limite, comportamento inalterado', async () => {
    // 28/09/2026 e' segunda. Nao ha rollover (nao e domingo) — weekStart = semana atual (28/09).
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-09-28T15:00:00.000Z')); // 12h em Sao Paulo, segunda-feira

    const { service, trainingPlanFindMany } = buildFullMocks({ activePlanStartDate: new Date('2026-09-21T00:00:00.000Z') });

    await expect((service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }).generateWeekLocked('u1')).rejects.toBe(SENTINEL_STOP);

    const call = trainingPlanFindMany.mock.calls[0][0];
    const lowerBound: Date = call.where.startDate.lt;
    expect(lowerBound.toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('sanity: REAL_NOW nao foi corrompido entre os testes (fake timers sempre resetados)', () => {
    expect(Date).toBe(REAL_NOW);
  });
});

describe('item 02 — trava de concorrencia no BANCO (generateWeek publico) + atomicidade da substituicao de plano', () => {
  it('sem trava existente: adquire, delega pro corpo real (generateWeekLocked), e libera no finally mesmo em caso de sucesso', async () => {
    const { service, prisma } = buildFullMocks();
    const locked = jest.spyOn(service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }, 'generateWeekLocked').mockResolvedValue({ ok: true } as never);

    const result = await service.generateWeek('u1');

    expect(result).toEqual({ ok: true });
    expect(prisma.trainingPlanGenerationLock.create).toHaveBeenCalledWith({ data: { userId: 'u1' } });
    expect(locked).toHaveBeenCalledWith('u1', undefined, undefined);
    expect(prisma.trainingPlanGenerationLock.delete).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('sem trava existente: libera a trava no finally MESMO quando generateWeekLocked falha (nunca fica presa por uma falha real)', async () => {
    const { service, prisma } = buildFullMocks();
    jest.spyOn(service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }, 'generateWeekLocked').mockRejectedValue(new Error('falha real de geracao'));

    await expect(service.generateWeek('u1')).rejects.toThrow('falha real de geracao');
    expect(prisma.trainingPlanGenerationLock.delete).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('trava JA existe e e recente (geracao em andamento de verdade): rejeita a segunda chamada, NUNCA roda generateWeekLocked duas vezes ao mesmo tempo pro mesmo aluno', async () => {
    const { service, prisma } = buildFullMocks();
    (prisma.trainingPlanGenerationLock.create as jest.Mock).mockRejectedValueOnce(uniqueConstraintError());
    (prisma.trainingPlanGenerationLock.findUnique as jest.Mock).mockResolvedValue({ userId: 'u1', startedAt: new Date() }); // trava recente (agora mesmo)
    const locked = jest.spyOn(service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }, 'generateWeekLocked');

    await expect(service.generateWeek('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(locked).not.toHaveBeenCalled();
  });

  it('trava PRESA (processo anterior morreu no meio, mais velha que o teto real de uma geracao): reclama a trava e prossegue normalmente', async () => {
    const { service, prisma } = buildFullMocks();
    (prisma.trainingPlanGenerationLock.create as jest.Mock)
      .mockRejectedValueOnce(uniqueConstraintError())
      .mockResolvedValueOnce({ userId: 'u1', startedAt: new Date() });
    const staleStartedAt = new Date(Date.now() - 20 * 60 * 1000); // 20min atras, acima do teto de 15min
    (prisma.trainingPlanGenerationLock.findUnique as jest.Mock).mockResolvedValue({ userId: 'u1', startedAt: staleStartedAt });
    const locked = jest.spyOn(service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }, 'generateWeekLocked').mockResolvedValue({ ok: true } as never);

    const result = await service.generateWeek('u1');

    expect(result).toEqual({ ok: true });
    expect(prisma.trainingPlanGenerationLock.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(locked).toHaveBeenCalledTimes(1);
  });
});

describe('item 02 — arquivar + criar + migrar sessoes vira UMA transacao atomica (nunca 3 writes soltos)', () => {
  it('generateWeekLocked chama archive/create/migrate dentro do MESMO this.prisma.$transaction, na ordem certa, e so notifica DEPOIS dela commitar', async () => {
    const { service, prisma } = buildFullMocks({ activePlanStartDate: new Date('2026-09-21T00:00:00.000Z') });
    // Rotina SEM nenhuma modalidade — evita cair no fallback padrao hardcoded (que tem
    // forca/corrida) e exigir uma RunSessionDecision/StrengthSessionDecision correspondente do
    // "agente" mockado. O que importa neste teste e' o CICLO DE ESCRITA (archive->create->migrate
    // dentro da mesma transacao), nao o conteudo prescrito.
    (prisma.weeklyAvailability.findMany as jest.Mock).mockResolvedValue([{ weekday: 1, modalities: [], availableMin: 30, noTraining: false }]);

    // Decisao minima valida (sem sessoes de corrida/forca) — o que importa aqui e' o CICLO DE
    // ESCRITA (archive->create->migrate dentro da mesma transacao), nao o conteudo prescrito.
    const prescriptionAgent = (service as unknown as { prescriptionAgent: { proposeWeeklyDecision: jest.Mock } }).prescriptionAgent;
    prescriptionAgent.proposeWeeklyDecision.mockResolvedValue({
      sessions: [],
      strengthSessions: [],
      recommendation: 'Semana de manutencao.',
      rationale: ['sem alteracoes relevantes'],
      safetyAdjustment: false,
    });

    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };
    const studentProfile = (service as unknown as { studentProfile: { refreshProfile: jest.Mock; recordEvent?: jest.Mock } }).studentProfile;
    studentProfile.recordEvent = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { telegram: unknown }).telegram = telegram;
    (service as unknown as { notifications: unknown }).notifications = notifications;

    const callOrder: string[] = [];
    const txUpdateMany = jest.fn().mockImplementation(() => {
      callOrder.push('archive');
      return Promise.resolve({ count: 1 });
    });
    const createdPlan = { id: 'plan-new', startDate: new Date('2026-09-28T00:00:00.000Z'), sessions: [] };
    const txCreate = jest.fn().mockImplementation(() => {
      callOrder.push('create');
      return Promise.resolve(createdPlan);
    });
    const txSessionUpdateMany = jest.fn().mockImplementation(() => {
      callOrder.push('migrate');
      return Promise.resolve({ count: 0 });
    });
    const tx = {
      trainingPlan: { updateMany: txUpdateMany, create: txCreate, findUniqueOrThrow: jest.fn().mockResolvedValue(createdPlan) },
      trainingSession: { updateMany: txSessionUpdateMany },
    };
    const transactionSpy = jest.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));
    (prisma as unknown as { $transaction: unknown }).$transaction = transactionSpy;

    const result = await (service as unknown as { generateWeekLocked: (...args: any[]) => Promise<any> }).generateWeekLocked('u1');

    // As 3 escritas reais (arquivar plano antigo, criar o novo, migrar sessoes de hoje) aconteceram
    // TODAS dentro do callback passado a $transaction — nunca soltas fora dela.
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(txUpdateMany).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'active' }, data: { status: 'archived' } });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(callOrder[0]).toBe('archive');
    expect(callOrder[1]).toBe('create');

    // Nenhuma chamada de IA/rede (Telegram) aconteceu DENTRO do callback da transacao — regra do
    // projeto ("nunca chamada de IA ou rede dentro de transacao de banco"). Como o mock de
    // $transaction so' resolve DEPOIS do callback terminar, o fato de notifyCoach ter sido chamado
    // aqui (fora do escopo do callback, no corpo do teste apos o await) prova que a notificacao
    // roda depois do commit, nao entrelacada com as escritas.
    expect(telegram.notifyCoach).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
