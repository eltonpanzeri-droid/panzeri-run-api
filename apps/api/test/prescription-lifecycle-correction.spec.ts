import { BadRequestException } from '@nestjs/common';
import { TrainingPlansService, injectTargetRaceDays, todayInSaoPaulo } from '../src/training-plans/training-plans.service';
import { CoachService } from '../src/coach/coach.service';
import { isWithinValidTrainingHistory, TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../src/common/training-history-policy';

// 25/09/2026 — Correcao definitiva do ciclo de vida da prescricao (fechamento do Passo 2). Cobre
// as propriedades pedidas: regra temporal da regeneracao, protecao de execucao ja registrada,
// origem estruturada, prova/evento como excecao a rotina, corte de historico centralizado, e
// snapshot de prescricao quando edicao manual sobrescreve uma sessao ja executada. NENHUM teste
// aqui afirma "estado X -> prescricao Y" — sao propriedades de integridade/ciclo de vida.

function noop() {
  return {} as never;
}

function buildTrainingPlansService(prisma: Record<string, unknown>) {
  return new TrainingPlansService(
    prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(),
  );
}

describe('injectTargetRaceDays — prova/evento como excecao explicita a rotina (secao 5)', () => {
  const weekStart = new Date('2026-09-21T00:00:00.000Z'); // segunda-feira
  const routine = [{ weekday: 1, modalities: ['forca'] }, { weekday: 3, modalities: ['corrida'] }];

  it('G. injeta o domingo quando ha prova cadastrada nesse domingo, mesmo fora da rotina', () => {
    const sunday = new Date('2026-09-27T00:00:00.000Z');
    const result = injectTargetRaceDays(routine, [{ raceDate: sunday }], weekStart);
    expect(result.some((d) => d.weekday === 0)).toBe(true);
    // Rotina original preservada, nada removido.
    expect(result).toHaveLength(3);
  });

  it('H. semana seguinte sem prova: domingo volta a nao ser elegivel (nada fica "lembrado")', () => {
    const nextWeekStart = new Date('2026-09-28T00:00:00.000Z');
    const result = injectTargetRaceDays(routine, [], nextWeekStart);
    expect(result.some((d) => d.weekday === 0)).toBe(false);
    expect(result).toEqual(routine);
  });

  it('nao duplica quando o dia da prova ja esta na rotina', () => {
    const wednesday = new Date('2026-09-23T00:00:00.000Z');
    const result = injectTargetRaceDays(routine, [{ raceDate: wednesday }], weekStart);
    expect(result.filter((d) => d.weekday === 3)).toHaveLength(1);
  });

  it('ignora prova fora da semana sendo gerada', () => {
    const farAway = new Date('2026-11-01T00:00:00.000Z');
    const result = injectTargetRaceDays(routine, [{ raceDate: farAway }], weekStart);
    expect(result).toEqual(routine);
  });

  it('injeta so uma vez mesmo com 2 provas caindo no mesmo weekday', () => {
    const sunday1 = new Date('2026-09-27T00:00:00.000Z');
    const sunday2 = new Date('2026-09-27T00:00:00.000Z');
    const result = injectTargetRaceDays(routine, [{ raceDate: sunday1 }, { raceDate: sunday2 }], weekStart);
    expect(result.filter((d) => d.weekday === 0)).toHaveLength(1);
  });
});

describe('regenerateSession — regra temporal e protecao de execucao (secoes 1, 2, 8)', () => {
  function buildPrisma(session: Record<string, unknown> | null) {
    return { trainingSession: { findFirst: jest.fn().mockResolvedValue(session) } };
  }

  it('J. regeneracao de dia passado e proibida', async () => {
    const past = new Date(Date.now() - 5 * 86400000);
    const prisma = buildPrisma({ id: 's1', scheduledDate: past, completion: null });
    const service = buildTrainingPlansService(prisma);
    await expect(service.regenerateSession('u1', 's1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('K. regeneracao de sessao ja executada e proibida, mesmo sendo hoje ou futuro', async () => {
    const future = new Date(Date.now() + 5 * 86400000);
    const prisma = buildPrisma({ id: 's1', scheduledDate: future, completion: { id: 'c1' } });
    const service = buildTrainingPlansService(prisma);
    await expect(service.regenerateSession('u1', 's1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'session_already_completed' }),
    });
  });

  it('hoje sem execucao exige allowToday explicito', async () => {
    // Usa a MESMA nocao de "hoje" que o codigo (fuso America/Sao_Paulo) — construir com
    // setUTCHours(0,0,0,0) e' incorreto entre 00:00-03:00 UTC (ainda e' "ontem" em SP), o que
    // fazia este teste falhar de forma intermitente dependendo da hora em que rodasse.
    const today = todayInSaoPaulo();
    const prisma = buildPrisma({ id: 's1', scheduledDate: today, completion: null });
    const service = buildTrainingPlansService(prisma);
    await expect(service.regenerateSession('u1', 's1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'today_session_locked' }),
    });
  });

  it('sessao inexistente retorna erro claro (nao undefined)', async () => {
    const prisma = buildPrisma(null);
    const service = buildTrainingPlansService(prisma);
    await expect(service.regenerateSession('u1', 'inexistente')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CoachService.updateTrainingSession — protecao PRESCRICAO -> EXECUCAO (secao 18)', () => {
  function buildCoachService(session: Record<string, unknown>) {
    const prisma = {
      trainingSession: {
        findFirst: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 's1', ...(data as object) })),
      },
      user: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'student-1', role: 'student' }) },
    };
    const service = new CoachService(
      prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(),
    );
    return { service, prisma };
  }

  it('AA. edicao manual MATERIAL de sessao ja executada guarda snapshot da prescricao anterior, nunca perde silenciosamente', async () => {
    const session = { id: 's1', modality: 'corrida', durationMin: 40, distanceKm: 6, structure: { type: 'run' }, prescriptionHistory: null, completion: { id: 'c1' } };
    const { service, prisma } = buildCoachService(session);
    await service.updateTrainingSession('student-1', 's1', { distanceKm: 10 } as never);
    const updateCall = (prisma.trainingSession.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.prescriptionHistory).toEqual([
      expect.objectContaining({ modality: 'corrida', durationMin: 40, distanceKm: 6 }),
    ]);
  });

  it('intervencao manual do treinador continua permitida mesmo com completion (secao 9 — nao bloqueia o passado pra edicao manual)', async () => {
    const session = { id: 's1', modality: 'corrida', durationMin: 40, distanceKm: 6, structure: {}, prescriptionHistory: null, completion: { id: 'c1' } };
    const { service } = buildCoachService(session);
    await expect(service.updateTrainingSession('student-1', 's1', { distanceKm: 10 } as never)).resolves.toBeDefined();
  });

  it('edicao de campo NAO material (notes) em sessao com completion nao gera snapshot desnecessario', async () => {
    const session = { id: 's1', modality: 'corrida', durationMin: 40, distanceKm: 6, structure: {}, prescriptionHistory: null, completion: { id: 'c1' } };
    const { service, prisma } = buildCoachService(session);
    await service.updateTrainingSession('student-1', 's1', { notes: 'so um comentario' } as never);
    const updateCall = (prisma.trainingSession.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.prescriptionHistory).toBeUndefined();
  });

  it('edicao material em sessao SEM completion nao gera snapshot (nada pra proteger ainda)', async () => {
    const session = { id: 's1', modality: 'corrida', durationMin: 40, distanceKm: 6, structure: {}, prescriptionHistory: null, completion: null };
    const { service, prisma } = buildCoachService(session);
    await service.updateTrainingSession('student-1', 's1', { distanceKm: 10 } as never);
    const updateCall = (prisma.trainingSession.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.prescriptionHistory).toBeUndefined();
  });

  it('snapshot e append-only: uma segunda edicao material preserva o snapshot anterior', async () => {
    const session = {
      id: 's1', modality: 'corrida', durationMin: 40, distanceKm: 6, structure: {},
      prescriptionHistory: [{ editedAt: 'a', modality: 'corrida', durationMin: 30, distanceKm: 5, structure: {} }],
      completion: { id: 'c1' },
    };
    const { service, prisma } = buildCoachService(session);
    await service.updateTrainingSession('student-1', 's1', { distanceKm: 12 } as never);
    const updateCall = (prisma.trainingSession.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.prescriptionHistory).toHaveLength(2);
  });
});

describe('TrainingHistoryPolicy — corte de historico contaminado centralizado (secao 20)', () => {
  it('AB/AC: data anterior ao corte nao e considerada historico esportivo real', () => {
    expect(isWithinValidTrainingHistory(new Date('2026-07-15T00:00:00.000Z'))).toBe(false);
    expect(isWithinValidTrainingHistory(new Date('2026-08-01T00:00:00.000Z'))).toBe(true);
    expect(isWithinValidTrainingHistory(new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
  });

  it('corte e uma constante unica compartilhavel (nao redefinida por consumidor)', () => {
    expect(TRAINING_INTELLIGENCE_DATA_CUTOFF.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
