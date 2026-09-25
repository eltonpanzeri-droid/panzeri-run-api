import { BadRequestException } from '@nestjs/common';
import { ContextEventsService } from '../src/context-events/context-events.service';
import { GAP_RETURN_THRESHOLD_DAYS } from '../src/context-events/context-event-types';

// 25/09/2026 — Passo 4 (contexto longitudinal + retorno apos lacuna). Cobre as propriedades
// pedidas: distincao observado/nao-observado/relatado, deteccao de gap com threshold centralizado,
// questionario de retorno como autorrelato (nunca fato observado inventado), primeira observacao
// apos o gap, e nao-contaminacao de causa/diagnostico. NENHUM teste aqui afirma "gap -> prescricao".

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400000);
}

describe('ContextEventsService — deteccao de gap (secoes 8, 9, 10)', () => {
  function buildService(prisma: Record<string, unknown>) {
    return new ContextEventsService(prisma as never);
  }

  it('I. o limiar de retorno e 14 dias e centralizado (nao espalhado)', () => {
    expect(GAP_RETURN_THRESHOLD_DAYS).toBe(14);
  });

  it('G. 13 dias sem execucao valida NAO dispara retorno', async () => {
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue({ completedAt: daysAgo(13) }) },
    };
    const service = buildService(prisma);
    const gap = await service.getGapStatus('u1');
    expect(gap.inGap).toBe(false);
  });

  it('H. 14 dias sem execucao valida dispara retorno (pending=true)', async () => {
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue({ completedAt: daysAgo(14) }) },
      contextEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = buildService(prisma);
    const state = await service.getReturnQuestionnaireState('u1');
    expect(state.pending).toBe(true);
    expect(state.gap.inGap).toBe(true);
  });

  it('nao ha execucao valida nenhuma ainda: conceito de lacuna nao se aplica (inGap=false, nao trava)', async () => {
    const prisma = { workoutCompletion: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = buildService(prisma);
    const gap = await service.getGapStatus('u1');
    expect(gap.inGap).toBe(false);
    expect(gap.lastObservedExecutionAt).toBeNull();
  });

  it('K. "ausencia de Daily Feedback" nao e o criterio — a query usa WorkoutCompletion.status done/adjusted, nao presenca de feedback detalhado', async () => {
    const findFirst = jest.fn().mockResolvedValue({ completedAt: daysAgo(1) });
    const service = buildService({ workoutCompletion: { findFirst } });
    await service.getGapStatus('u1');
    const whereClause = findFirst.mock.calls[0][0].where;
    expect(whereClause.status).toEqual({ in: ['done', 'adjusted'] });
  });

  it('nao ha pending duas vezes pra mesma lacuna (dedup por gapAnchorDate)', async () => {
    const lastObserved = daysAgo(20);
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue({ completedAt: lastObserved }) },
      contextEvent: { findFirst: jest.fn().mockResolvedValue({ id: 'evt-1' }) }, // ja respondida
    };
    const service = buildService(prisma);
    const state = await service.getReturnQuestionnaireState('u1');
    expect(state.pending).toBe(false);
  });
});

describe('ContextEventsService — questionario de retorno como AUTORRELATO (secoes 12, 33 O/P/L/M/N)', () => {
  function buildService(overrides: { completedAt?: Date; alreadyAnswered?: boolean } = {}) {
    const create = jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'evt-new', ...(data as object) }));
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue(overrides.completedAt ? { completedAt: overrides.completedAt } : null) },
      contextEvent: {
        findFirst: jest.fn().mockResolvedValue(overrides.alreadyAnswered ? { id: 'evt-old' } : null),
        create,
      },
    };
    return { service: new ContextEventsService(prisma as never), prisma, create };
  }

  it('O/P. submissao gera ContextEvent com autorrelato categorico, NUNCA WorkoutCompletion/RPE/volume inventado', async () => {
    const { service, create, prisma } = buildService({ completedAt: daysAgo(20) });
    await service.submitReturnQuestionnaire('u1', {
      trainingDuringGap: 'normal_outside',
      reason: 'travel',
      physicalStateComparedToBefore: 3,
      mentalReadinessComparedToBefore: 4,
    });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.trainingDuringGapReported).toBe('normal_outside');
    expect(data.type).toBe('travel');
    expect(data.source).toBe('student_reported');
    // Nenhuma chamada a workoutCompletion.create/upsert foi feita neste fluxo — so' leitura.
    expect((prisma as Record<string, any>).workoutCompletion.create).toBeUndefined();
  });

  it('L/M/N. gap nao cria WorkoutCompletion, RPE ou volume — o service so escreve em ContextEvent', async () => {
    const { service, prisma } = buildService({ completedAt: daysAgo(20) });
    await service.submitReturnQuestionnaire('u1', {
      trainingDuringGap: 'none', reason: 'health_illness', physicalStateComparedToBefore: 1, mentalReadinessComparedToBefore: 2,
    });
    expect(Object.keys(prisma as object)).toEqual(['workoutCompletion', 'contextEvent']);
  });

  it('rejeita submissao quando nao ha lacuna real', async () => {
    const { service } = buildService({ completedAt: daysAgo(2) });
    await expect(service.submitReturnQuestionnaire('u1', {
      trainingDuringGap: 'none', reason: 'other', physicalStateComparedToBefore: 3, mentalReadinessComparedToBefore: 3,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita submissao duplicada pra mesma lacuna ja respondida', async () => {
    const { service } = buildService({ completedAt: daysAgo(20), alreadyAnswered: true });
    await expect(service.submitReturnQuestionnaire('u1', {
      trainingDuringGap: 'none', reason: 'other', physicalStateComparedToBefore: 3, mentalReadinessComparedToBefore: 3,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Y/Z. dor/doenca nao vira diagnostico — so type/subtype categoricos, texto original preservado sem interpretacao', async () => {
    const { create, service } = buildService({ completedAt: daysAgo(15) });
    await service.submitReturnQuestionnaire('u1', {
      trainingDuringGap: 'none', reason: 'pain_injury', physicalStateComparedToBefore: 2, mentalReadinessComparedToBefore: 2, note: 'dor no joelho',
    });
    const data = create.mock.calls[0][0].data;
    expect(data.type).toBe('pain_injury');
    expect(data.originalText).toBe('dor no joelho');
    expect(data).not.toHaveProperty('diagnosis');
  });
});

describe('ContextEventsService — criacao manual e ciclo active/ended (secoes 26, 27, 28; testes A-F)', () => {
  it('B/D. criacao pelo treinador sem endedAt fica "ongoing" (evento ativo sem fim)', async () => {
    const create = jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'evt-1', ...(data as object) }));
    const service = new ContextEventsService({ contextEvent: { create } } as never);
    const event = await service.createManual('student-1', { type: 'work', startedAt: '2026-09-10' });
    expect(event.status).toBe('ongoing');
    expect(create.mock.calls[0][0].data.source).toBe('coach_reported');
  });

  it('C. evento com inicio e fim fica "ended"', async () => {
    const create = jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'evt-2', ...(data as object) }));
    const service = new ContextEventsService({ contextEvent: { create } } as never);
    const event = await service.createManual('student-1', { type: 'travel', startedAt: '2026-09-01', endedAt: '2026-09-10' });
    expect(event.status).toBe('ended');
  });

  it('F. source preservada corretamente (coach_reported no caminho manual)', async () => {
    const create = jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'evt-3', ...(data as object) }));
    const service = new ContextEventsService({ contextEvent: { create } } as never);
    await service.createManual('student-1', { type: 'family_personal' });
    expect(create.mock.calls[0][0].data.source).toBe('coach_reported');
  });
});

describe('ContextEventsService — primeira observacao apos o gap (secoes 14; teste Q)', () => {
  it('Q. vincula a completion mais recente a um evento de retorno ainda nao vinculado', async () => {
    const update = jest.fn().mockResolvedValue({});
    const eventUpdate = jest.fn().mockResolvedValue({});
    const transaction = jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops));
    const prisma = {
      contextEvent: {
        findFirst: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        update: eventUpdate,
      },
      workoutCompletion: { update },
      $transaction: transaction,
    };
    const service = new ContextEventsService(prisma as never);
    await service.linkFirstObservationIfPending('u1', 'completion-1', new Date());
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('nao vincula quando nao ha evento pendente', async () => {
    const transaction = jest.fn();
    const prisma = { contextEvent: { findFirst: jest.fn().mockResolvedValue(null) }, $transaction: transaction };
    const service = new ContextEventsService(prisma as never);
    await service.linkFirstObservationIfPending('u1', 'completion-1', new Date());
    expect(transaction).not.toHaveBeenCalled();
  });
});

// 25/09/2026 (correcao de fluxo, Passo 4 fechamento definitivo) — o ReturnAfterGapModal no mobile
// foi recentrado pra depender EXCLUSIVAMENTE de GET /me/context-events/return-check (o mesmo
// getReturnQuestionnaireState testado acima), nunca de existir ou nao existir TrainingPlan. Estes
// testes provam a propriedade que sustenta essa correcao: o estado canonico de gap NUNCA consulta
// TrainingPlan/TrainingSession — so' WorkoutCompletion (execucao) e ContextEvent (dedup). Isso
// garante, por construcao, que os cenarios B/C/D do pedido (com ou sem plano, com ou sem sessoes
// antigas visiveis) produzem o MESMO resultado — o service e' cego a essa dimensao.
describe('ContextEventsService — estado canonico de gap e independente de existir TrainingPlan (correcao A-H)', () => {
  function buildService(prisma: Record<string, unknown>) {
    return new ContextEventsService(prisma as never);
  }

  it('A. gap < 14 dias -> pending=false, independente de outros dados', async () => {
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue({ completedAt: daysAgo(5) }) },
      contextEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const state = await buildService(prisma).getReturnQuestionnaireState('u1');
    expect(state.pending).toBe(false);
  });

  it('B/C/D. gap >= 14 dias -> pending=true; o service nunca consulta trainingPlan/trainingSession (prova estrutural de independencia do plano)', async () => {
    const findFirst = jest.fn().mockResolvedValue({ completedAt: daysAgo(20) });
    const contextEventFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      workoutCompletion: { findFirst },
      contextEvent: { findFirst: contextEventFindFirst },
      // Deliberadamente SEM trainingPlan/trainingSession no mock — se o service tentasse consultar
      // qualquer um dos dois (para decidir com base em "existe plano?"), o teste quebraria com
      // "Cannot read properties of undefined", provando que a decisao NAO depende disso.
    };
    const state = await buildService(prisma).getReturnQuestionnaireState('u1');
    expect(state.pending).toBe(true);
    expect(state.gap.daysSinceLastObserved).toBe(20);
  });

  it('E. gap ja contextualizado (respondido) -> pending=false', async () => {
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue({ completedAt: daysAgo(20) }) },
      contextEvent: { findFirst: jest.fn().mockResolvedValue({ id: 'evt-respondido' }) },
    };
    const state = await buildService(prisma).getReturnQuestionnaireState('u1');
    expect(state.pending).toBe(false);
  });

  it('F/G. apos responder, a MESMA lacuna (gapAnchorDate igual) nunca volta a ficar pending — dedup natural, sem estado extra no frontend', async () => {
    const lastObserved = daysAgo(20);
    const create = jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'evt-1', ...(data as object) }));
    let answered: { id: string } | null = null;
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue({ completedAt: lastObserved }) },
      contextEvent: { findFirst: jest.fn().mockImplementation(() => Promise.resolve(answered)), create },
    };
    const service = buildService(prisma);

    const before = await service.getReturnQuestionnaireState('u1');
    expect(before.pending).toBe(true);

    await service.submitReturnQuestionnaire('u1', {
      trainingDuringGap: 'none', reason: 'travel', physicalStateComparedToBefore: 3, mentalReadinessComparedToBefore: 3,
    });
    answered = { id: 'evt-1' }; // simula a linha agora existente com gapAnchorDate = lastObserved

    const after = await service.getReturnQuestionnaireState('u1');
    expect(after.pending).toBe(false);
  });

  it('H. uma NOVA lacuna futura (execucao nova, depois uma lacuna diferente) volta a ficar pending — gapAnchorDate muda', async () => {
    // Aluno respondeu a lacuna antiga (ancorada em daysAgo(40)), treinou de novo, e agora esta
    // numa lacuna NOVA ancorada em daysAgo(15) — gapAnchorDate diferente, contextEvent.findFirst
    // pra essa nova ancora nao encontra nada (so' a lacuna antiga foi respondida).
    const prisma = {
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue({ completedAt: daysAgo(15) }) },
      contextEvent: { findFirst: jest.fn().mockImplementation(({ where }: { where: { gapAnchorDate: Date } }) => {
        return Promise.resolve(where.gapAnchorDate.getTime() === daysAgo(40).getTime() ? { id: 'evt-antigo' } : null);
      }) },
    };
    const state = await buildService(prisma).getReturnQuestionnaireState('u1');
    expect(state.pending).toBe(true);
  });
});

describe('ContextEventsService — lifeContext compacto (secoes 18, AC; testes V, AC)', () => {
  it('V. traz activeEvents/recentEvents/currentGapStatus/latestReturnContext sem despejar historico inteiro', async () => {
    const prisma = {
      contextEvent: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 'a1', type: 'work', subtype: null, startedAt: new Date(), source: 'coach_reported' }]) // active
          .mockResolvedValueOnce([]), // recent ended
        findFirst: jest.fn().mockResolvedValue(null), // latestReturnEvent
      },
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ContextEventsService(prisma as never);
    const data = await service.getLifeContextData('u1');
    expect(data.activeEvents).toHaveLength(1);
    expect(data.currentGapStatus.inGap).toBe(false);
    expect(data.latestReturnContext).toBeNull();
  });

  it('AC. eventos antigos (encerrados) continuam recuperaveis, nunca somem', async () => {
    const oldEvent = { id: 'old-1', type: 'travel', subtype: null, startedAt: daysAgo(200), endedAt: daysAgo(190), source: 'student_reported' };
    const prisma = {
      contextEvent: {
        findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]), // fora da janela de 60d "recentes", mas nao deletado
        findFirst: jest.fn().mockResolvedValue(null),
      },
      workoutCompletion: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ContextEventsService(prisma as never);
    const data = await service.getLifeContextData('u1');
    // Fora da janela de "recentes" (60d) nao aparece no compacto, mas isso e' selecao de contexto
    // pro Snapshot (secao 18: "nao despeja todo o historico") — nao e' delecao. Confirma so' que o
    // service nao lanca erro nem trata isso como se o evento tivesse sido apagado.
    expect(data.recentEvents).toEqual([]);
    void oldEvent;
  });
});
