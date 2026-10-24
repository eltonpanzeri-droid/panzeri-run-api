import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { weekStartOf, weekStartOfDate, executionWeekStart } from '../src/common/weekly-volume';
import { traceStub } from './helpers/trace-stub';

// 24/10/2026 — regra UNICA de semana do volume: o km de um evento executado cai na semana do DIA LOCAL DA EXECUCAO, tanto na Evolucao (grafico/medalhas/IA)
// quanto no total km da grade do Historico. A grade continua mostrando a sessao na semana PROGRAMADA. Treino manual sem atividade fica na semana programada nos dois.

// Mesmos dados nos dois servicos: sessao programada no DOMINGO 02/08 (semana de 27/07), executada na SEGUNDA 03/08 (semana de 03/08), 10,2 km, vinculada.
const SUNDAY = '2026-08-02';
const MONDAY_RUN = { id: 'act-1', startedAt: new Date('2026-08-03T10:00:00Z'), utcOffsetMinutes: 0, distanceMeters: 10200, sport: 'corrida', executionClassification: 'corresponding' };

function evolution(sessions: unknown[], activities: unknown[]) {
  const prisma = { trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) }, activityLog: { findMany: jest.fn().mockResolvedValue(activities) } };
  return new EvolutionMetricService(prisma as never);
}
function history(sessions: unknown[], links: unknown[], alternativeLogs: unknown[] = []) {
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    sessionExecutionLink: { findMany: jest.fn().mockResolvedValue(links) },
    activityLog: { findMany: jest.fn().mockResolvedValue(alternativeLogs) },
  };
  const noop = {} as never;
  return new TrainingPlansService(prisma as never, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, traceStub());
}

const evoSession = (over: Record<string, unknown> = {}) => ({
  id: 's1', userId: 'u1', scheduledDate: new Date(`${SUNDAY}T00:00:00Z`), modality: 'corrida', distanceKm: 10, structure: { source: 'agent', type: 'run' }, origin: 'agent',
  plan: { status: 'active' }, completion: null, executionLinks: [], ...over,
});
const histSession = (over: Record<string, unknown> = {}) => ({
  id: 's1', scheduledDate: new Date(`${SUNDAY}T00:00:00Z`), weekday: 0, modality: 'corrida', title: 'Rodagem', structure: {}, origin: 'agent', completion: null, plan: { status: 'active' }, ...over,
});
const histLink = { trainingSessionId: 's1', activityLogId: 'act-1', activityLog: { id: 'act-1', distanceMeters: 10200, startedAt: MONDAY_RUN.startedAt, utcOffsetMinutes: 0 } };

const evoWeeks = async (service: EvolutionMetricService) => Object.fromEntries((await service.getSeries('u1')).weeks.map((w) => [w.weekStart, w.kmPercorridos]));
const histWeeks = async (service: TrainingPlansService) => Object.fromEntries((await service.getStudentHistory('u1')).map((w) => [w.weekStart, w.totalKmDone]));

describe('helper da semana', () => {
  it('segunda a domingo; domingo pertence a' + ' semana que comecou na segunda anterior', () => {
    expect(weekStartOf('2026-08-03')).toBe('2026-08-03'); // segunda
    expect(weekStartOf('2026-08-09')).toBe('2026-08-03'); // domingo
    expect(weekStartOf('2026-08-02')).toBe('2026-07-27'); // domingo anterior
    expect(weekStartOfDate(new Date('2026-08-05T00:00:00Z'))).toBe('2026-08-03');
  });
  it('com atividade vale o dia local da execucao; sem ela, a data programada', () => {
    expect(executionWeekStart('2026-08-03', '2026-08-02')).toBe('2026-08-03');
    expect(executionWeekStart(null, '2026-08-02')).toBe('2026-07-27');
    expect(executionWeekStart(undefined, '2026-08-02')).toBe('2026-07-27');
  });
});

describe('Evolucao x Historico: o mesmo km na mesma semana', () => {
  it('programada no domingo e executada na segunda: o km cai na semana da segunda nos DOIS (10,2 km), e a semana programada fica sem km', async () => {
    const evo = await evoWeeks(evolution([evoSession({ executionLinks: [{ activityLog: { distanceMeters: 10200 } }] })], [MONDAY_RUN]));
    const hist = await histWeeks(history([histSession()], [histLink]));
    expect(evo['2026-08-03']).toBe(10.2);
    expect(hist['2026-08-03']).toBe(10.2);
    expect(evo['2026-07-27'] ?? null).toBeNull();
    expect(hist['2026-07-27']).toBe(0); // a grade ainda mostra a sessao na semana programada, sem km
  });

  it('a grade continua mostrando a sessao na semana PROGRAMADA', async () => {
    const result = await history([histSession()], [histLink]).getStudentHistory('u1');
    const programmed = result.find((w) => w.weekStart === '2026-07-27')!;
    expect(programmed.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(programmed.sessions[0].completedDistanceKm).toBe(10.2);
  });

  it('extra nao soma duas vezes e os dois concordam (10,2 + 5 extra = 15,2); extras = 5', async () => {
    const extraEvo = evoSession({ id: 'x1', scheduledDate: new Date('2026-08-05T00:00:00Z'), structure: { source: 'student', type: 'extra' }, origin: 'student_extra', distanceKm: null, completion: { status: 'done', distanceKm: 5, perceivedEffort: 6, completedAt: new Date('2026-08-05T12:00:00Z') } });
    const extraHist = histSession({ id: 'x1', scheduledDate: new Date('2026-08-05T00:00:00Z'), weekday: 3, structure: { type: 'extra', source: 'student' }, origin: 'student_extra', completion: { status: 'done', distanceKm: 5, perceivedEffort: 6 } });
    const evoService = evolution([evoSession({ executionLinks: [{ activityLog: { distanceMeters: 10200 } }] }), extraEvo], [MONDAY_RUN]);
    const series = await evoService.getSeries('u1');
    const hist = await histWeeks(history([histSession(), extraHist], [histLink]));
    const week = series.weeks.find((w) => w.weekStart === '2026-08-03')!;
    expect(week.kmPercorridos).toBe(15.2);
    expect(week.kmExtras).toBe(5);
    expect(hist['2026-08-03']).toBe(15.2);
  });

  it('semana sem deslocamento fica igual: programada e executada na mesma semana', async () => {
    const wed = new Date('2026-08-05T09:00:00Z');
    const evoAct = { ...MONDAY_RUN, id: 'act-2', startedAt: wed };
    const evo = await evoWeeks(evolution([evoSession({ id: 's2', scheduledDate: new Date('2026-08-05T00:00:00Z'), executionLinks: [{ activityLog: { distanceMeters: 10200 } }] })], [evoAct]));
    const hist = await histWeeks(history(
      [histSession({ id: 's2', scheduledDate: new Date('2026-08-05T00:00:00Z'), weekday: 3 })],
      [{ trainingSessionId: 's2', activityLogId: 'act-2', activityLog: { id: 'act-2', distanceMeters: 10200, startedAt: wed, utcOffsetMinutes: 0 } }],
    ));
    expect(evo['2026-08-03']).toBe(10.2);
    expect(hist['2026-08-03']).toBe(10.2);
  });

  it('fuso: atividade as 23h30 locais (offset -180) cai no dia local; domingo a noite fica na semana do domingo nos dois', async () => {
    // 2026-08-03T02:30Z com offset -180 = domingo 02/08 23:30 local -> semana de 27/07
    const late = { ...MONDAY_RUN, startedAt: new Date('2026-08-03T02:30:00Z'), utcOffsetMinutes: -180 };
    const evo = await evoWeeks(evolution([evoSession({ executionLinks: [{ activityLog: { distanceMeters: 10200 } }] })], [late]));
    const hist = await histWeeks(history([histSession()], [{ ...histLink, activityLog: { ...histLink.activityLog, startedAt: late.startedAt, utcOffsetMinutes: -180 } }]));
    expect(evo['2026-07-27']).toBe(10.2);
    expect(hist['2026-07-27']).toBe(10.2);
  });

  it('treino manual sem atividade: permanece na semana programada nos dois (comportamento mantido)', async () => {
    const manualEvo = evoSession({ id: 'm1', executionLinks: [], completion: { status: 'done', distanceKm: 8, perceivedEffort: 5, completedAt: new Date('2026-08-03T12:00:00Z') } });
    const manualHist = histSession({ id: 'm1', completion: { status: 'done', distanceKm: 8, perceivedEffort: 5 } });
    const evo = await evoWeeks(evolution([manualEvo], []));
    const hist = await histWeeks(history([manualHist], []));
    expect(evo['2026-07-27']).toBe(8);
    expect(hist['2026-07-27']).toBe(8);
  });
});
