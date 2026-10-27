import { pickCanonicalPerEvent } from '../src/activity-execution/canonical-observation';
import {
  activityLocalDate,
  buildWeeklyRealizedTotals,
  totalsInvariantViolations,
  TotalsActivityInput,
  TotalsSessionInput,
} from '../src/activity-execution/weekly-realized-totals';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';

// Totais realizados da semana (lote 1, 26/10/2026): prescricao x extras x total, deduplicado por evento fisico. Funcao pura — nenhum banco.
// Semana de referencia: segunda 19/10/2026 a domingo 25/10/2026 (a do caso real: 3 corridas prescritas + 1 extra de 5 km).

const WEEK = '2026-10-19';

const session = (over: Partial<TotalsSessionInput> & { sessionId: string }): TotalsSessionInput => ({
  scheduledDate: '2026-10-20', modality: 'corrida', origin: 'agent', status: 'performed', plannedDistanceKm: null, ...over,
});
const activity = (over: Partial<TotalsActivityInput> & { activityLogId: string }): TotalsActivityInput => ({
  startedAt: new Date('2026-10-20T10:00:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceKm: 10, durationMin: 60, classification: 'corresponding', provider: 'polar', ...over,
});

// Caso real: 3 prescritas (35 km previstos, 36,6 executados) + 1 extra de 5 km.
function threePrescribedPlusOneExtra(extra: { materialized?: boolean; manual?: boolean } = {}) {
  const sessions: TotalsSessionInput[] = [
    session({ sessionId: 's1', scheduledDate: '2026-10-20', plannedDistanceKm: 10, linkedActivityLogIds: ['a1'] }),
    session({ sessionId: 's2', scheduledDate: '2026-10-22', plannedDistanceKm: 10, linkedActivityLogIds: ['a2'] }),
    session({ sessionId: 's3', scheduledDate: '2026-10-25', plannedDistanceKm: 15, linkedActivityLogIds: ['a3'] }),
  ];
  const activities: TotalsActivityInput[] = [
    activity({ activityLogId: 'a1', startedAt: new Date('2026-10-20T10:00:00Z'), distanceKm: 10.2, durationMin: 62 }),
    activity({ activityLogId: 'a2', startedAt: new Date('2026-10-22T10:00:00Z'), distanceKm: 10.4, durationMin: 64 }),
    activity({ activityLogId: 'a3', startedAt: new Date('2026-10-25T10:00:00Z'), distanceKm: 16, durationMin: 100 }),
  ];
  if (extra.manual) {
    sessions.push(session({ sessionId: 'x1', scheduledDate: '2026-10-24', origin: 'student_extra', completionDistanceKm: 5, completionDurationMin: 30, perceivedEffort: 6 }));
  } else {
    activities.push(activity({ activityLogId: 'a4', startedAt: new Date('2026-10-24T10:00:00Z'), distanceKm: 5, durationMin: 30, classification: 'alternative' }));
    if (extra.materialized) sessions.push(session({ sessionId: 'x1', scheduledDate: '2026-10-24', origin: 'device_extra', linkedActivityLogIds: ['a4'] }));
  }
  return { sessions, activities };
}

// Corte do fuso no passado: estes testes exercitam a regra de Sao Paulo (sem configuracao a regra antiga, UTC, vale; ver local-date-unification.spec.ts).
const SAVED_CUTOVER = process.env.LOCAL_DATE_CUTOVER_AT;
beforeAll(() => { process.env.LOCAL_DATE_CUTOVER_AT = '2000-01-01T00:00:00Z'; });
afterAll(() => { if (SAVED_CUTOVER === undefined) delete process.env.LOCAL_DATE_CUTOVER_AT; else process.env.LOCAL_DATE_CUTOVER_AT = SAVED_CUTOVER; });

describe('totais realizados da semana — dominio', () => {
  it('caso real: 3 de 3 prescritas (36,6 km) + 1 extra de 5 km = 4 corridas e 41,6 km, so atividade importada', () => {
    const totals = buildWeeklyRealizedTotals({ weekStartDate: WEEK, ...threePrescribedPlusOneExtra() });
    expect(totals.prescription).toMatchObject({ prescribedSessions: 3, performedSessions: 3, plannedRunKm: 35, executedRunKm: 36.6 });
    expect(totals.extras.events).toHaveLength(1);
    expect(totals.extras.events[0]).toMatchObject({ origin: 'somente_atividade', modality: 'corrida', distanceKm: 5, durationMin: 30, activityLogId: 'a4', date: '2026-10-24' });
    expect(totals.extras.byModality.corrida).toEqual({ events: 1, minutes: 30, km: 5 });
    expect(totals.total.events).toBe(4);
    expect(totals.total.run).toEqual({ events: 4, km: 41.6, minutes: 256 });
    expect(totalsInvariantViolations(totals)).toEqual([]);
  });

  it('o cumprimento da prescricao NAO muda com ou sem extras (extra nunca vira sessao prevista)', () => {
    const withExtra = buildWeeklyRealizedTotals({ weekStartDate: WEEK, ...threePrescribedPlusOneExtra() });
    const base = threePrescribedPlusOneExtra();
    const without = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: base.sessions, activities: base.activities.filter((a) => a.activityLogId !== 'a4') });
    expect(withExtra.prescription).toEqual(without.prescription);
    expect(withExtra.prescription.prescribedSessions).toBe(3);
    expect(without.total.run.km).toBe(36.6);
  });

  it('a mesma extra materializada no calendario (device_extra com vinculo) conta UMA vez, com os mesmos totais', () => {
    const plain = buildWeeklyRealizedTotals({ weekStartDate: WEEK, ...threePrescribedPlusOneExtra() });
    const materialized = buildWeeklyRealizedTotals({ weekStartDate: WEEK, ...threePrescribedPlusOneExtra({ materialized: true }) });
    expect(materialized.total).toEqual(plain.total);
    expect(materialized.extras.events[0]).toMatchObject({ origin: 'device_extra', sessionId: 'x1', activityLogId: 'a4' });
    expect(materialized.prescription.prescribedSessions).toBe(3);
    expect(totalsInvariantViolations(materialized)).toEqual([]);
  });

  it('extra manual do aluno (sem atividade) conta pelo registro, com esforco percebido, sem virar prescrita', () => {
    const totals = buildWeeklyRealizedTotals({ weekStartDate: WEEK, ...threePrescribedPlusOneExtra({ manual: true }) });
    expect(totals.extras.events).toEqual([expect.objectContaining({ origin: 'student_extra', distanceKm: 5, durationMin: 30, perceivedEffort: 6, activityLogId: null, sessionId: 'x1' })]);
    expect(totals.total.run.km).toBe(41.6);
    expect(totals.prescription.prescribedSessions).toBe(3);
  });

  it('varios dispositivos: observacoes do mesmo evento fisico contam uma vez e o vinculo feito a uma observacao nao-canonica e reconhecido', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [session({ sessionId: 's1', linkedActivityLogIds: ['apple-1'] })],
      activities: [activity({ activityLogId: 'polar-1', memberIds: ['polar-1', 'apple-1'], physicalEventId: 'ev-1', distanceKm: 10.1 })],
    });
    expect(totals.total.events).toBe(1);
    expect(totals.prescription.executedEvents).toHaveLength(1);
    expect(totals.prescription.executedEvents[0]).toMatchObject({ eventKey: 'event:ev-1', sessionId: 's1', distanceKm: 10.1 });
    expect(totals.extras.events).toHaveLength(0);
    // duas leituras do mesmo evento chegando ao modulo tambem nao duplicam
    const dup = buildWeeklyRealizedTotals({
      weekStartDate: WEEK, sessions: [],
      activities: [
        activity({ activityLogId: 'polar-1', physicalEventId: 'ev-1', classification: 'alternative' }),
        activity({ activityLogId: 'apple-1', physicalEventId: 'ev-1', classification: 'alternative' }),
      ],
    });
    expect(dup.total.events).toBe(1);
  });

  it('vinculo posterior: a atividade que era extra passa para a prescricao e o total NAO muda', () => {
    const before = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [session({ sessionId: 's1', status: 'no_record', plannedDistanceKm: 10 })],
      activities: [activity({ activityLogId: 'a1', classification: 'alternative', distanceKm: 10 })],
    });
    expect(before.prescription).toMatchObject({ prescribedSessions: 1, performedSessions: 0, noRecordSessions: 1 });
    expect(before.extras.events).toHaveLength(1);
    const after = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [session({ sessionId: 's1', status: 'performed', plannedDistanceKm: 10, linkedActivityLogIds: ['a1'] })],
      activities: [activity({ activityLogId: 'a1', classification: 'corresponding', distanceKm: 10 })],
    });
    expect(after.prescription).toMatchObject({ performedSessions: 1, executedRunKm: 10 });
    expect(after.extras.events).toHaveLength(0);
    expect(after.total.events).toBe(before.total.events);
    expect(after.total.run.km).toBe(before.total.run.km);
  });

  it('importacao tardia: o total acompanha os dados disponiveis, sem alterar a prescricao', () => {
    const base = threePrescribedPlusOneExtra();
    const early = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: base.sessions, activities: base.activities.filter((a) => a.activityLogId !== 'a4') });
    const late = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: base.sessions, activities: base.activities });
    expect(early.total.run.km).toBe(36.6);
    expect(late.total.run.km).toBe(41.6);
    expect(early.prescription).toEqual(late.prescription);
  });

  it('modalidades diferentes: forca, natacao e esteira entram no total; so corrida e esteira somam km; esteira soma na corrida', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [session({ sessionId: 'f1', modality: 'forca', scheduledDate: '2026-10-21', completionDurationMin: 50 })],
      activities: [
        activity({ activityLogId: 'n1', sport: 'natacao', distanceKm: 1.5, durationMin: 40, classification: 'alternative' }),
        activity({ activityLogId: 'e1', sport: 'esteira', distanceKm: 6, durationMin: 36, classification: 'alternative' }),
        activity({ activityLogId: 'r1', sport: 'RUNNING', distanceKm: 8, durationMin: 50, classification: 'alternative' }),
      ],
    });
    expect(totals.total.byModality.forca).toEqual({ events: 1, minutes: 50, km: null });
    expect(totals.total.byModality.natacao).toEqual({ events: 1, minutes: 40, km: null });
    expect(totals.total.byModality.esteira).toMatchObject({ events: 1, km: 6 });
    expect(totals.total.byModality.corrida).toMatchObject({ events: 1, km: 8 });
    expect(totals.total.run).toEqual({ events: 2, km: 14, minutes: 86 });
    expect(totals.total.events).toBe(4);
    expect(totalsInvariantViolations(totals)).toEqual([]);
  });

  it('fronteira de semana e meia-noite: dia local manda; sem offset usa America/Sao_Paulo (nunca UTC)', () => {
    // domingo 25/10 23:30 em Sao Paulo = segunda 26/10 02:30 UTC -> pertence a semana que termina em 25/10
    expect(activityLocalDate(new Date('2026-10-26T02:30:00Z'), -180)).toBe('2026-10-25');
    expect(activityLocalDate(new Date('2026-10-26T02:30:00Z'), null)).toBe('2026-10-25');
    expect(activityLocalDate(new Date('2026-10-26T02:30:00Z'), undefined)).toBe('2026-10-25');
    // segunda 26/10 00:10 em Sao Paulo = 03:10 UTC -> semana seguinte
    expect(activityLocalDate(new Date('2026-10-26T03:10:00Z'), null)).toBe('2026-10-26');
    const sundayNight = activity({ activityLogId: 'dom', startedAt: new Date('2026-10-26T02:30:00Z'), utcOffsetMinutes: null, classification: 'alternative', distanceKm: 7 });
    const mondayEarly = activity({ activityLogId: 'seg', startedAt: new Date('2026-10-26T03:10:00Z'), utcOffsetMinutes: null, classification: 'alternative', distanceKm: 3 });
    const thisWeek = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [], activities: [sundayNight, mondayEarly] });
    const nextWeek = buildWeeklyRealizedTotals({ weekStartDate: '2026-10-26', sessions: [], activities: [sundayNight, mondayEarly] });
    expect(thisWeek.total.activityLogIds).toEqual(['dom']);
    expect(nextWeek.total.activityLogIds).toEqual(['seg']);
    // atividade que cruza a meia-noite pertence ao dia de inicio inteira (nao e dividida)
    const crossing = activity({ activityLogId: 'cruza', startedAt: new Date('2026-10-26T01:50:00Z'), durationMin: 120, classification: 'alternative' });
    expect(buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [], activities: [crossing] }).total.run.minutes).toBe(120);
    expect(buildWeeklyRealizedTotals({ weekStartDate: '2026-10-26', sessions: [], activities: [crossing] }).total.events).toBe(0);
  });

  it('um evento que cai em outra semana nao e contado de novo pela conclusao manual da sessao desta semana', () => {
    // sessao de domingo vinculada a atividade que o relogio registrou na segunda local: o km vale na semana da execucao
    const monday = activity({ activityLogId: 'a1', startedAt: new Date('2026-10-26T12:00:00Z'), distanceKm: 10 });
    const s = session({ sessionId: 's1', scheduledDate: '2026-10-25', completionDistanceKm: 10, linkedActivityLogIds: ['a1'] });
    const thisWeek = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [s], activities: [monday] });
    const nextWeek = buildWeeklyRealizedTotals({ weekStartDate: '2026-10-26', sessions: [], activities: [monday] });
    expect(thisWeek.total.events).toBe(0);
    expect(nextWeek.total.events).toBe(1);
  });

  it('atividade ainda sem classificacao fica fora, com aviso; ambigua resolvida e pendente de confirmacao e conta no total; corrida sem distancia conta como evento sem somar km', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK, sessions: [],
      activities: [
        activity({ activityLogId: 'amb', classification: 'ambiguous' }),
        activity({ activityLogId: 'nul', classification: null }),
        activity({ activityLogId: 'semdist', classification: 'alternative', distanceKm: null, durationMin: null }),
      ],
    });
    // 'ambiguous' resolvida = PENDENTE de confirmacao: conta no total (nem cumprimento, nem extra); so' a sem classificacao fica fora
    expect(totals.total.events).toBe(2);
    expect(totals.pendingConfirmation.events).toHaveLength(1);
    expect(totals.extras.events).toHaveLength(1);
    expect(totals.prescription.executedEvents).toHaveLength(0);
    expect(totals.total.run.km).toBe(10);
    expect(totals.completeness).toMatchObject({ excludedUnclassified: 1, runEventsWithoutDistance: 1, eventsWithoutDuration: 1 });
    expect(totals.completeness.notes).toHaveLength(2);
  });

  it('sessao prescrita feita so por registro manual conta pela conclusao; se a atividade vinculada nao traz distancia, usa a da conclusao', () => {
    const manual = buildWeeklyRealizedTotals({ weekStartDate: WEEK, activities: [], sessions: [session({ sessionId: 's1', completionDistanceKm: 8, completionDurationMin: 55, plannedDistanceKm: 8 })] });
    expect(manual.prescription).toMatchObject({ performedSessions: 1, executedRunKm: 8 });
    const noDistance = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [session({ sessionId: 's1', completionDistanceKm: 8, linkedActivityLogIds: ['a1'] })],
      activities: [activity({ activityLogId: 'a1', distanceKm: null, durationMin: 50 })],
    });
    expect(noDistance.prescription.executedEvents[0]).toMatchObject({ distanceKm: 8, durationMin: 50 });
    expect(noDistance.total.events).toBe(1);
  });

  it('sessao extra nao realizada (nao feita/sem registro) nunca entra', () => {
    const totals = buildWeeklyRealizedTotals({ weekStartDate: WEEK, activities: [], sessions: [session({ sessionId: 'x', origin: 'student_extra', status: 'no_record' })] });
    expect(totals.total.events).toBe(0);
    expect(totals.prescription.prescribedSessions).toBe(0);
  });

  it('resultado independe da ordem de entrada e as invariantes valem em cenarios variados', () => {
    const base = threePrescribedPlusOneExtra({ materialized: true });
    const reference = buildWeeklyRealizedTotals({ weekStartDate: WEEK, ...base });
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const shuffle = <T,>(items: T[]) => items.map((item) => ({ item, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.item);
    for (let i = 0; i < 25; i += 1) {
      const shuffled = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: shuffle(base.sessions), activities: shuffle(base.activities) });
      expect(shuffled).toEqual(reference);
      expect(totalsInvariantViolations(shuffled)).toEqual([]);
    }
  });

  it('atividade importada ligada pelo motor a um registro EXTRA do aluno (classificada corresponding) e o mesmo evento: conta uma vez, como extra', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [session({ sessionId: 'x1', scheduledDate: '2026-10-24', origin: 'student_extra', completionDistanceKm: 5, completionDurationMin: 31, linkedActivityLogIds: ['a4'], linkOrigins: { a4: 'automatic' } })],
      activities: [activity({ activityLogId: 'a4', startedAt: new Date('2026-10-24T10:00:00Z'), distanceKm: 5.02, durationMin: 30, classification: 'corresponding' })],
    });
    expect(totals.total.events).toBe(1);
    expect(totals.prescription.executedEvents).toHaveLength(0);
    expect(totals.extras.events).toEqual([expect.objectContaining({ origin: 'student_extra', activityLogId: 'a4', sessionId: 'x1', distanceKm: 5.02 })]);
    expect(totals.prescription.prescribedSessions).toBe(0);
  });

  it('proveniencia da correspondencia: vinculo automatico (algoritmo) nao e tratado como confirmacao humana', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [
        session({ sessionId: 's1', scheduledDate: '2026-10-20', linkedActivityLogIds: ['a1'], linkOrigins: { a1: 'automatic' } }),
        session({ sessionId: 's2', scheduledDate: '2026-10-22', linkedActivityLogIds: ['a2'], linkOrigins: { a2: 'student' } }),
        session({ sessionId: 's3', scheduledDate: '2026-10-24', completionDistanceKm: 6 }),
      ],
      activities: [
        activity({ activityLogId: 'a1', startedAt: new Date('2026-10-20T10:00:00Z') }),
        activity({ activityLogId: 'a2', startedAt: new Date('2026-10-22T10:00:00Z') }),
      ],
    });
    expect(totals.prescription.provenance).toEqual({ automaticLink: 1, humanConfirmedLink: 1, manualRecord: 1, classifiedWithoutLoadedSession: 0 });
    expect(totals.prescription.executedEvents.map((e) => [e.sessionId, e.linkOrigin])).toEqual([['s1', 'automatic'], ['s2', 'student'], ['s3', null]]);
  });

  it('LIMITACAO CONHECIDA (duplicidade manual x importada): registro manual extra e atividade importada do mesmo treino, SEM vinculo entre si, contam duas vezes; nada e deduplicado por aproximacao', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK,
      sessions: [session({ sessionId: 'x1', scheduledDate: '2026-10-24', origin: 'student_extra', completionDistanceKm: 5, completionDurationMin: 30 })],
      activities: [activity({ activityLogId: 'a4', startedAt: new Date('2026-10-24T10:00:00Z'), distanceKm: 5.02, durationMin: 30, classification: 'alternative' })],
    });
    expect(totals.extras.events).toHaveLength(2);
    expect(totals.total.run.km).toBe(10);
  });

  it('sessao sintetica do aparelho (device_extra, sem vinculo, elo so em structure.activityLogId) conta UMA vez, pela atividade, e em outra semana nao conta de novo', () => {
    const synthetic = session({ sessionId: 'x1', scheduledDate: '2026-10-24', origin: 'device_extra', completionDistanceKm: 5, completionDurationMin: 30, materializedActivityLogId: 'a4', materializedProvider: 'wahoo', perceivedEffort: 6 });
    const extra = activity({ activityLogId: 'a4', provider: 'wahoo', startedAt: new Date('2026-10-24T10:00:00Z'), distanceKm: 5, durationMin: 30, classification: 'alternative' });
    const totals = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [synthetic], activities: [extra] });
    expect(totals.total.events).toBe(1);
    expect(totals.extras.events).toEqual([expect.objectContaining({ origin: 'device_extra', activityLogId: 'a4', sessionId: 'x1', perceivedEffort: 6 })]);
    // a sessao cai em outra semana que a atividade (dia UTC x dia local): na semana da sessao nao conta de novo
    const crossing = session({ sessionId: 'x2', scheduledDate: '2026-10-26', origin: 'device_extra', completionDistanceKm: 8, materializedActivityLogId: 'a5' });
    const sundayNight = activity({ activityLogId: 'a5', startedAt: new Date('2026-10-26T01:00:00Z'), utcOffsetMinutes: null, classification: 'alternative', distanceKm: 8 });
    expect(buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [crossing], activities: [sundayNight] }).total.events).toBe(1);
    expect(buildWeeklyRealizedTotals({ weekStartDate: '2026-10-26', sessions: [crossing], activities: [sundayNight] }).total.events).toBe(0);
    // sem a atividade no conjunto (so' a sessao): conta pela conclusao e declara o provedor da sessao
    const only = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [synthetic], activities: [] });
    expect(only.total.events).toBe(1);
    expect(only.total.providers).toEqual(['wahoo']);
  });

  it('weekStartDate em qualquer dia da semana resolve para a segunda-feira', () => {
    expect(buildWeeklyRealizedTotals({ weekStartDate: '2026-10-23', sessions: [], activities: [] })).toMatchObject({ weekStartDate: '2026-10-19', weekEndDate: '2026-10-25' });
  });
});

// Consistencia com a Evolucao (cuidado adicional de Elton): os EVENTOS FISICOS considerados sao os mesmos, nao so a soma de km.
// FUSO UNIFICADO (lote 4, 26/10/2026): a divergencia registrada no lote 2 (modulo novo em Sao Paulo x Evolucao em UTC, sem offset do aparelho) foi RESOLVIDA com a regra unica de
// common/local-date.ts. O teste agora fixa o resultado igual nos dois (a cobertura completa de todos os consumidores esta em local-date-unification.spec.ts).
describe('fuso unificado entre o modulo novo e a Evolucao (sem offset do aparelho)', () => {
  it('atividade de domingo 23:30 em Sao Paulo, sem offset: modulo e Evolucao concordam (domingo, semana que terminou)', async () => {
    const row = { id: 'sem-offset', provider: 'polar', startedAt: new Date('2026-10-26T02:30:00Z'), utcOffsetMinutes: null, distanceMeters: 7000, durationSec: 2400, sport: 'corrida', executionClassification: 'alternative', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null };
    const prisma = { activityLog: { findMany: jest.fn().mockResolvedValue([row]) }, trainingSession: { findMany: jest.fn().mockResolvedValue([]) } };
    const evolution = new EvolutionMetricService(prisma as never);
    const [fromEvolution] = await (evolution as unknown as { fetchRealizedActivities(userId: string): Promise<Array<{ isoDate: string }>> }).fetchRealizedActivities('u1');
    expect(fromEvolution.isoDate).toBe('2026-10-25');
    expect(activityLocalDate(row.startedAt, row.utcOffsetMinutes)).toBe('2026-10-25');
    expect(fromEvolution.isoDate).toBe(activityLocalDate(row.startedAt, row.utcOffsetMinutes));
  });

  it('com offset informado os dois concordam (a divergencia so existe sem offset)', async () => {
    const row = { id: 'com-offset', provider: 'polar', startedAt: new Date('2026-10-26T02:30:00Z'), utcOffsetMinutes: -180, distanceMeters: 7000, durationSec: 2400, sport: 'corrida', executionClassification: 'alternative', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null };
    const prisma = { activityLog: { findMany: jest.fn().mockResolvedValue([row]) }, trainingSession: { findMany: jest.fn().mockResolvedValue([]) } };
    const [fromEvolution] = await (new EvolutionMetricService(prisma as never) as unknown as { fetchRealizedActivities(userId: string): Promise<Array<{ isoDate: string }>> }).fetchRealizedActivities('u1');
    expect(fromEvolution.isoDate).toBe(activityLocalDate(row.startedAt, row.utcOffsetMinutes));
  });
});

describe('totais realizados x Evolucao — mesmos eventos fisicos', () => {
  const rows = [
    // evento 1: Polar (canonica) + Apple do mesmo evento, lida a nao-canonica
    { id: 'polar-1', provider: 'polar', startedAt: new Date('2026-10-20T10:00:00Z'), utcOffsetMinutes: -180, distanceMeters: 10200, durationSec: 3720, sport: 'corrida', executionClassification: 'corresponding', physicalIdentityStatus: 'matched', physicalEventId: 'ev-1', physicalCanonicalActivityLogId: 'polar-1' },
    { id: 'apple-1', provider: 'apple_health', startedAt: new Date('2026-10-20T10:00:05Z'), utcOffsetMinutes: -180, distanceMeters: 10190, durationSec: 3718, sport: 'RUNNING', executionClassification: 'corresponding', physicalIdentityStatus: 'matched', physicalEventId: 'ev-1', physicalCanonicalActivityLogId: 'polar-1' },
    // evento 2: corrida extra so em ActivityLog
    { id: 'wahoo-2', provider: 'wahoo', startedAt: new Date('2026-10-24T10:00:00Z'), utcOffsetMinutes: -180, distanceMeters: 5000, durationSec: 1800, sport: 'corrida', executionClassification: 'alternative', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null },
    // evento 3: esteira (familia corrida)
    { id: 'zepp-3', provider: 'zepp', startedAt: new Date('2026-10-22T09:00:00Z'), utcOffsetMinutes: -180, distanceMeters: 6000, durationSec: 2200, sport: 'esteira', executionClassification: 'corresponding', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null },
    // natacao: fora do km de corrida
    { id: 'swim-4', provider: 'apple_health', startedAt: new Date('2026-10-23T09:00:00Z'), utcOffsetMinutes: -180, distanceMeters: 1500, durationSec: 2400, sport: 'natacao', executionClassification: 'alternative', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null },
    // nao classificada: fora dos dois
    { id: 'amb-5', provider: 'polar', startedAt: new Date('2026-10-21T09:00:00Z'), utcOffsetMinutes: -180, distanceMeters: 4000, durationSec: 1500, sport: 'corrida', executionClassification: 'ambiguous', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null },
  ];

  it('os ids dos eventos de corrida/esteira do total sao exatamente os da Evolucao, e o km tambem', async () => {
    const prisma = { activityLog: { findMany: jest.fn().mockResolvedValue(rows) }, trainingSession: { findMany: jest.fn().mockResolvedValue([]) } };
    const evolution = new EvolutionMetricService(prisma as never);
    // Evolucao so le corresponding/alternative (o filtro e do banco: o stub aplica o mesmo)
    prisma.activityLog.findMany.mockResolvedValue(rows.filter((r) => ['corresponding', 'alternative', 'ambiguous'].includes(r.executionClassification as string)));
    const evolutionRows = await (evolution as unknown as { fetchRealizedActivities(userId: string): Promise<Array<{ id: string; distanceKm: number | null }>> }).fetchRealizedActivities('u1');

    const readRows = rows; // o modulo recebe todas as leituras e exclui as nao classificadas sozinho
    const picks = await pickCanonicalPerEvent(readRows, async () => readRows);
    const activities: TotalsActivityInput[] = picks.map(({ row, representedBy, members }) => ({
      activityLogId: row.id, memberIds: members.map((m) => m.id), physicalEventId: row.physicalEventId, startedAt: row.startedAt, utcOffsetMinutes: row.utcOffsetMinutes, sport: row.sport,
      distanceKm: row.distanceMeters != null ? row.distanceMeters / 1000 : null, durationMin: row.durationSec != null ? row.durationSec / 60 : null,
      classification: representedBy.executionClassification as TotalsActivityInput['classification'], provider: row.provider,
    }));
    const totals = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [], activities });

    const totalsRunIds = [...totals.prescription.executedEvents, ...totals.extras.events, ...totals.pendingConfirmation.events]
      .filter((e) => e.modality === 'corrida' || e.modality === 'esteira').map((e) => e.activityLogId as string).sort();
    expect(totalsRunIds).toEqual(evolutionRows.map((r) => r.id).sort());
    expect(totalsRunIds).toEqual(['amb-5', 'polar-1', 'wahoo-2', 'zepp-3']); // amb-5 = pendente de confirmacao: entra nos dois
    const evolutionKm = evolutionRows.reduce((acc, r) => acc + (r.distanceKm ?? 0), 0);
    expect(totals.total.run.km).toBeCloseTo(evolutionKm, 1);
    expect(totals.total.run.km).toBe(25.2);
    expect(totals.total.activityLogIds).toContain('swim-4');
    expect(totalsInvariantViolations(totals)).toEqual([]);
  });
});
