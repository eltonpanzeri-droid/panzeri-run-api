import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/common/roles.guard';
import { ObservatoryController } from '../src/observatory/observatory.controller';
import { ObservatoryService } from '../src/observatory/observatory.service';
import { AGE_BANDS, INTENSITY_BINS, STRENGTH_BANDS, VOLUME_BANDS, classify, painMetrics, pooledPaceOf, protect, weekStartOf } from '../src/observatory/observatory-core';
import { computeObservatory } from '../src/observatory/observatory-engine';
import { buildFactsFromRows, isStravaProvenance, type RawActivity, type RawCompletion, type RawRows } from '../src/observatory/observatory-facts';
import { parseObservatoryFilters } from '../src/observatory/observatory-filters';
import { buildSyntheticFacts } from '../src/observatory/observatory-synthetic';
import type { ObsFacts, ObsFilters, ObsRunEvent } from '../src/observatory/observatory.types';

// 24/10/2026 — Observatorio Panzeri Run: base canonica (A), dor (B), pace e grupos (C), API/privacidade (D). Dados sinteticos.

const act = (id: string, userId: string, startedAt: string, km: number | null, over: Partial<RawActivity> = {}): RawActivity => ({
  id, userId, provider: 'polar', startedAt: new Date(startedAt), utcOffsetMinutes: -180, durationSec: km ? Math.round(km * 330) : null, distanceMeters: km ? km * 1000 : null, sport: 'corrida',
  providerMetrics: {}, physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null, ...over,
});
const comp = (id: string, userId: string, over: Partial<RawCompletion> = {}): RawCompletion => ({
  id, userId, sessionId: null, status: 'done', completedAt: new Date('2026-10-06T15:00:00Z'), distanceKm: null, durationMin: null, painFlag: null, perceivedEffort: null,
  session: { modality: 'corrida', origin: null, structure: {} }, ...over,
});
const rows = (over: Partial<RawRows> = {}): RawRows => ({ users: [{ id: 'u1', birthDate: new Date('1980-05-01'), sex: 'F' }], activities: [], completions: [], links: [], pains: [], ...over });
const window = { since: '2026-09-01', to: '2026-10-31' };
const build = (r: RawRows, extra: RawActivity[] = []) => buildFactsFromRows(r, async (ids) => extra.filter((a) => ids.includes(a.id)), window);

describe('Bloco A — base canonica de treinos', () => {
  it('deduplica a atividade canonica: Polar + Health Connect do mesmo evento = UM treino, com os dados da canonica', async () => {
    const polar = act('p1', 'u1', '2026-10-06T10:00:00Z', 10, { physicalIdentityStatus: 'matched', physicalEventId: 'ev', physicalCanonicalActivityLogId: 'p1' });
    const hc = act('h1', 'u1', '2026-10-06T10:01:00Z', 10.3, { provider: 'health_connect', physicalIdentityStatus: 'matched', physicalEventId: 'ev', physicalCanonicalActivityLogId: 'p1' });
    const facts = await build(rows({ activities: [polar, hc] }));
    expect(facts.runEvents).toHaveLength(1);
    expect(facts.runEvents[0].km).toBe(10);
  });
  it('identidade fisica AMBIGUA fica fora dos totais e e contada na qualidade; nao avaliada entra, sinalizada', async () => {
    const result = await build(rows({ activities: [act('x', 'u1', '2026-10-06T10:00:00Z', 8, { physicalIdentityStatus: 'ambiguous' }), act('y', 'u1', '2026-10-07T10:00:00Z', 6, { physicalIdentityStatus: null })] }));
    expect(result.runEvents.map((e) => e.km)).toEqual([6]);
    expect(result.quality).toMatchObject({ ambiguousIdentityEvents: 1, unevaluatedIdentityEvents: 1 });
  });
  it('treino extra manual que repete a corrida ja importada NAO soma duas vezes (e o feedback dele passa para o evento importado); extra distinto soma uma vez', async () => {
    const r = rows({
      activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 5.02)],
      completions: [
        comp('c-dup', 'u1', { distanceKm: 5, painFlag: 'none', completedAt: new Date('2026-10-06T21:00:00Z'), session: { modality: 'corrida', origin: null, structure: { type: 'extra', source: 'student' } } }),
        comp('c-real-extra', 'u1', { distanceKm: 12, completedAt: new Date('2026-10-08T21:00:00Z'), session: { modality: 'corrida', origin: null, structure: { type: 'extra', source: 'student' } } }),
        comp('c-device', 'u1', { distanceKm: 5.02, completedAt: new Date('2026-10-06T21:00:00Z'), session: { modality: 'corrida', origin: 'device_extra', structure: {} } }),
      ],
    });
    const facts = await build(r);
    expect(facts.runEvents.map((e) => [e.eventKey, e.km])).toEqual([['a:a', 5.02], ['m:c-real-extra', 12]]);
    expect(facts.quality.duplicateManualEvents).toBe(1);
    expect(facts.runEvents[0].feedbackAnswered).toBe(true);
    expect(facts.runEvents[0].pain.origin).toBe('explicit_no_pain');
  });
  it('a semana vem da data EXECUTADA (dia local da atividade), nao da programada: domingo programado, feito na segunda', async () => {
    const facts = await build(rows({ activities: [act('a', 'u1', '2026-10-12T11:00:00Z', 10)], completions: [comp('c', 'u1', { sessionId: 's1', completedAt: new Date('2026-10-11T12:00:00Z') })], links: [{ trainingSessionId: 's1', activityLogId: 'a' }] }));
    expect(facts.runEvents[0].day).toBe('2026-10-12');
    expect(weekStartOf(facts.runEvents[0].day)).toBe('2026-10-12'); // semana da segunda, nao a do domingo programado (2026-10-05)
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
  });
  it('dia local respeita o offset da atividade (23h30 de domingo local nao vira segunda)', async () => {
    const facts = await build(rows({ activities: [act('a', 'u1', '2026-10-12T02:30:00Z', 5, { utcOffsetMinutes: -180 })] }));
    expect(facts.runEvents[0].day).toBe('2026-10-11');
  });
  it('origem Strava nunca entra: direta, indireta (canal de saude) e canonica Strava buscada fora da leitura', async () => {
    expect(isStravaProvenance('strava', {})).toBe(true);
    expect(isStravaProvenance('health_connect', { source: { packageName: 'com.strava' } })).toBe(true);
    expect(isStravaProvenance('apple_health', { source: { bundleId: 'com.strava.stravaride' } })).toBe(true);
    expect(isStravaProvenance('apple_health', { source: { name: 'Strava' } })).toBe(true);
    expect(isStravaProvenance('health_connect', { source: { packageName: 'com.sec.android.app.shealth' } })).toBe(false);
    const viaHc = act('hc', 'u1', '2026-10-06T10:00:00Z', 10, { provider: 'health_connect', providerMetrics: { source: { packageName: 'com.strava' } } });
    const polar = act('po', 'u1', '2026-10-06T10:00:00Z', 10.1, { physicalIdentityStatus: 'matched', physicalEventId: 'e', physicalCanonicalActivityLogId: 'strava-canon' });
    const stravaCanon = act('strava-canon', 'u1', '2026-10-06T10:00:00Z', 10.2, { provider: 'health_connect', providerMetrics: { source: { packageName: 'com.strava' } }, physicalIdentityStatus: 'matched', physicalEventId: 'e', physicalCanonicalActivityLogId: 'strava-canon' });
    const onlyStrava = await build(rows({ activities: [viaHc] }));
    expect(onlyStrava.runEvents).toHaveLength(0);
    expect(onlyStrava.quality.stravaExcludedEvents).toBe(1);
    const mixed = await build(rows({ activities: [polar] }), [stravaCanon]);
    expect(mixed.runEvents).toHaveLength(1);
    expect(mixed.runEvents[0].km).toBe(10.1); // usa o membro permitido, nunca o dado Strava
  });
  it('limites exatos das faixas de volume semanal (limite superior pertence a faixa de baixo; zero cai na primeira)', () => {
    const id = (km: number) => classify(km, VOLUME_BANDS)?.id;
    expect([0, 20, 20.01, 40, 40.01, 60, 60.01, 90, 90.01, 120, 120.01, 160, 160.01, 200, 200.01, 400].map(id)).toEqual(['v1', 'v1', 'v2', 'v2', 'v3', 'v3', 'v4', 'v4', 'v5', 'v5', 'v6', 'v6', 'v7', 'v7', 'v8', 'v8']);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => classify(n, INTENSITY_BINS)?.id)).toEqual(['i1_2', 'i1_2', 'i3_4', 'i3_4', 'i5_6', 'i5_6', 'i7_8', 'i7_8', 'i9_10', 'i9_10']);
    expect([29, 30, 39, 40, 69, 70].map((n) => classify(n, AGE_BANDS)?.id)).toEqual(['lt30', '30_39', '30_39', '40_49', '60_69', '70p']);
    expect([0, 1, 2, 3].map((n) => classify(n, STRENGTH_BANDS)?.id)).toEqual(['s0', 's1', 's2p', 's2p']);
  });
});

const ev = (km: number | null, origin: ObsRunEvent['pain']['origin'], intensity: number | null, over: Partial<ObsRunEvent> = {}): ObsRunEvent => ({
  participant: 'p', eventKey: 'e' + Math.random(), day: '2026-10-06', km, seconds: km ? km * 330 : null, source: 'activity', isExtra: false, feedbackAnswered: origin !== 'no_pain_report', pain: { origin, intensity }, ...over,
});

describe('Bloco B — dor (zero operacional, por 1.000 km, faixas exclusivas)', () => {
  const set = [ev(10, 'no_pain_report', 0), ev(10, 'explicit_no_pain', 0), ev(10, 'reported_pain', 4), ev(20, 'reported_pain', 8), ev(20, 'no_pain_report', 0)];
  it('calculo conjunto: relatos, por 1.000 km, medias (sem zero x com zero), pontos e faixas', () => {
    const m = painMetrics(set);
    expect(m).toMatchObject({ trainings: 5, km: 70, reports: 2, reportsWithIntensity: 2, reportsWithoutIntensity: 0, reportsPer1000Km: 28.57, meanIntensityReports: 6, meanIntensityAll: 2.4, painPointsPer1000Km: 171.43 });
    expect(m.intensityBins.map((b) => [b.key, b.count, b.per1000Km])).toEqual([['i1_2', 0, 0], ['i3_4', 1, 14.29], ['i5_6', 0, 0], ['i7_8', 1, 14.29], ['i9_10', 0, 0]]);
    expect(m.intensityBins.reduce((s, b) => s + b.count, 0)).toBe(m.reportsWithIntensity); // cada relato em UMA faixa so'
    expect(m.zeroOrigins).toEqual({ explicitNoPain: 1, noPainReport: 2 });
  });
  it('treino sem feedback entra no denominador (km) e tem zero operacional; cobertura aparece a parte', () => {
    const m = painMetrics(set);
    expect(m.coverage).toMatchObject({ trainings: 5, withFeedback: 3, withoutFeedback: 2, numericIntensityTrainings: 5, intensityCoveragePct: 100 });
  });
  it('relato categorico sem nota numerica: conta como relato, NAO inventa nota e fica fora das medias; cobertura da intensidade cai', () => {
    const m = painMetrics([...set, ev(10, 'reported_pain', null)]);
    expect(m.reports).toBe(3);
    expect(m.reportsWithoutIntensity).toBe(1);
    expect(m.meanIntensityReports).toBe(6); // sem o relato sem nota
    expect(m.meanIntensityAll).toBe(2.4);
    expect(m.coverage.numericIntensityTrainings).toBe(5);
    expect(m.coverage.intensityCoveragePct).toBeCloseTo(83.33, 1);
    expect(m.intensityBins.reduce((s, b) => s + b.count, 0)).toBe(2);
  });
  it('relatos por 1.000 km e media vazias nao viram zero quando nao ha km/relato', () => {
    const none = painMetrics([ev(null, 'no_pain_report', 0)]);
    expect(none.reportsPer1000Km).toBeNull();
    expect(none.meanIntensityReports).toBeNull();
    expect(painMetrics([]).meanIntensityAll).toBeNull();
  });
  it('mesma dor em dois instrumentos (marcacao categorica + relato numerico no mesmo dia) = UMA ocorrencia, com a nota numerica', async () => {
    const r = rows({
      activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 10)],
      completions: [comp('c', 'u1', { sessionId: 's', painFlag: 'moderado', perceivedEffort: 6 })],
      links: [{ trainingSessionId: 's', activityLogId: 'a' }],
      pains: [{ id: 'pr', userId: 'u1', createdAt: new Date('2026-10-06T22:00:00Z'), intensity: 6 }],
    });
    const facts = await build(r);
    expect(facts.runEvents).toHaveLength(1);
    expect(facts.runEvents[0].pain).toEqual({ origin: 'reported_pain', intensity: 6 });
    expect(painMetrics(facts.runEvents).reports).toBe(1);
    // so a marcacao categorica: relato SEM nota; "sem dor" explicito: zero; sem nada: zero operacional
    const cat = await build(rows({ activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 10)], completions: [comp('c', 'u1', { sessionId: 's', painFlag: 'leve' })], links: [{ trainingSessionId: 's', activityLogId: 'a' }] }));
    expect(cat.runEvents[0].pain).toEqual({ origin: 'reported_pain', intensity: null });
    const none = await build(rows({ activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 10)] }));
    expect(none.runEvents[0].pain).toEqual({ origin: 'no_pain_report', intensity: 0 });
  });
  it('relato de dor sem treino elegivel no dia nao gera observacao nem km; conflito com "sem dor" fica contado', async () => {
    const orphan = await build(rows({ activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 10)], pains: [{ id: 'p', userId: 'u1', createdAt: new Date('2026-10-20T12:00:00Z'), intensity: 7 }] }));
    expect(orphan.quality.painReportsWithoutTraining).toBe(1);
    expect(painMetrics(orphan.runEvents).reports).toBe(0);
    const conflict = await build(rows({ activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 10)], completions: [comp('c', 'u1', { sessionId: 's', painFlag: 'none' })], links: [{ trainingSessionId: 's', activityLogId: 'a' }], pains: [{ id: 'p', userId: 'u1', createdAt: new Date('2026-10-06T20:00:00Z'), intensity: 3 }] }));
    expect(conflict.quality.painConflicts).toBe(1);
    expect(conflict.runEvents[0].pain.origin).toBe('reported_pain');
  });
});

const today = '2026-10-24';
const baseFilters = (over: Partial<ObsFilters> = {}): ObsFilters => ({ from: '2026-04-27', to: today, today, volumeBands: [], ageBands: [], strengthBands: [], sexes: [], mode: 'cross', groupBy: 'volume', includeZeroWeeks: false, minParticipants: 5, ...over });
const factsOf = (events: ObsRunEvent[], participants = new Set(events.map((e) => e.participant))): ObsFacts => ({
  dataset: 'synthetic', dataAsOf: new Date().toISOString(), participants: [...participants].map((key) => ({ key, birthDate: '1985-01-01', sex: 'F' })), runEvents: events, strengthEvents: [],
  quality: { stravaExcludedEvents: 0, ambiguousIdentityEvents: 0, unevaluatedIdentityEvents: 0, invalidDistanceEvents: 0, duplicateManualEvents: 0, painReportsWithoutTraining: 0, painConflicts: 0 },
});

describe('Bloco C — pace e grupos', () => {
  it('pace agregado = tempo total / distancia total (5 km em 25 min + 10 km em 60 min = 5:40/km), nunca a media dos paces', () => {
    const pace = pooledPaceOf([{ km: 5, seconds: 25 * 60 }, { km: 10, seconds: 60 * 60 }]);
    expect(pace).toMatchObject({ secondsPerKm: 340, label: '5:40/km' });
    expect(pooledPaceOf([{ km: 10, seconds: null }, { km: null, seconds: 600 }])).toBeNull();
  });
  it('grupos transversais usam a faixa da PROPRIA semana; semana incompleta e semana sem dados ficam fora e contadas', () => {
    const events: ObsRunEvent[] = [];
    for (let p = 0; p < 6; p += 1) {
      for (let w = 0; w < 3; w += 1) events.push(ev(15, 'no_pain_report', 0, { participant: 'p' + p, day: `2026-09-${String(7 + w * 7).padStart(2, '0')}` })); // 15 km por semana: faixa v1
      events.push(ev(8, 'no_pain_report', 0, { participant: 'p' + p, day: '2026-10-22' })); // semana ainda em andamento
    }
    const r = computeObservatory(factsOf(events), baseFilters());
    const v1 = r.volume.rows.find((row) => row.key === 'v1')!;
    expect(v1.data).toMatchObject({ participantWeeks: 18, km: 270 });
    expect(r.overview.weeks.incomplete).toBeGreaterThan(0);
    expect(r.pace.cross.find((row) => row.key === 'v1')!.data?.pace?.secondsPerKm).toBe(330);
  });
  it('grupo fixo: classificado pelas 8 primeiras semanas; dados posteriores nunca reclassificam o participante', () => {
    const make = (laterKm: number) => {
      const events: ObsRunEvent[] = [];
      for (let p = 0; p < 6; p += 1) {
        for (let w = 0; w < 12; w += 1) {
          const day = new Date(Date.UTC(2026, 4, 4 + w * 7)).toISOString().slice(0, 10); // segundas a partir de 04/05
          events.push(ev(w < 8 ? 30 : laterKm, 'no_pain_report', 0, { participant: 'p' + p, day, seconds: (w < 8 ? 30 : laterKm) * 330 }));
        }
      }
      return computeObservatory(factsOf(events), baseFilters({ mode: 'cohort' }));
    };
    const low = make(5); const high = make(150);
    const group = (r: ReturnType<typeof make>) => r.pace.cohort.groups.filter((g) => (g.participants ?? 0) > 0).map((g) => [g.key, g.participants]);
    expect(group(low)).toEqual([['v2', 6]]); // 30 km/sem na linha de base => 20–40, independente do que veio depois
    expect(group(high)).toEqual([['v2', 6]]);
    const series = low.pace.cohort.groups.find((g) => g.key === 'v2')!.data!.series;
    expect(series[0].relativeWeek).toBe(1);
    expect(series[0].avgKm).toBe(5);
  });
  it('cobertura insuficiente: participante com menos de 8 semanas completas fica fora do grupo fixo', () => {
    const events: ObsRunEvent[] = [];
    for (let p = 0; p < 6; p += 1) for (let w = 0; w < 5; w += 1) events.push(ev(20, 'no_pain_report', 0, { participant: 'p' + p, day: new Date(Date.UTC(2026, 4, 4 + w * 7)).toISOString().slice(0, 10) }));
    const r = computeObservatory(factsOf(events), baseFilters({ mode: 'cohort' }));
    expect(r.pace.cohort.eligibleParticipants).toBeNull(); // 0 elegiveis (< piso): nao divulgado
    expect(r.pace.cohort.groups.every((g) => g.participants === 0)).toBe(true);
  });
  it('exposicao anterior usa so dados anteriores ao treino: acrescentar corridas FUTURAS nao muda o grupo do treino anterior', () => {
    const base: ObsRunEvent[] = [];
    for (let p = 0; p < 6; p += 1) {
      for (let w = 0; w < 6; w += 1) base.push(ev(25, 'no_pain_report', 0, { participant: 'p' + p, day: new Date(Date.UTC(2026, 7, 3 + w * 7)).toISOString().slice(0, 10) }));
      base.push(ev(10, 'reported_pain', 5, { participant: 'p' + p, day: '2026-09-15' }));
    }
    const before = computeObservatory(factsOf(base), baseFilters({ groupBy: 'priorVolume' }));
    const future = [...base]; for (let p = 0; p < 6; p += 1) future.push(ev(300, 'no_pain_report', 0, { participant: 'p' + p, day: '2026-09-16' }));
    const after = computeObservatory(factsOf(future), baseFilters({ groupBy: 'priorVolume' }));
    const pick = (r: ReturnType<typeof computeObservatory>) => r.pain.rows.filter((row) => row.data && (row.data.reports > 0)).map((row) => [row.key, row.data!.reports]);
    expect(pick(before)).toEqual(pick(after));
    expect(pick(before)).toEqual([['v1', 6]]); // 25 km em 1 semana de 4 = ~6 km/sem => faixa v1
  });
});

describe('Bloco D — API, acesso e privacidade', () => {
  const ctx = (role: string | undefined, handler: (...args: never[]) => unknown) => ({ getHandler: () => handler, getClass: () => ObservatoryController, switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }) }) as unknown as ExecutionContext;
  const guard = new RolesGuard(new Reflector());
  it('so administrador acessa: treinador, aluno e anonimo sao barrados', () => {
    const handler = ObservatoryController.prototype.analysis;
    expect(guard.canActivate(ctx('admin', handler))).toBe(true);
    for (const role of ['coach', 'student', undefined]) expect(() => guard.canActivate(ctx(role, handler))).toThrow(ForbiddenException);
  });
  it('sem a chave de dados reais a tela funciona SEMPRE, so com dados sinteticos; so OBSERVATORY_REAL_DATA libera dados reais', async () => {
    const config = (values: Record<string, string>) => ({ get: (k: string) => values[k] });
    const on = new ObservatoryService({} as never, config({}) as never);
    expect(on.status()).toEqual({ enabled: true, dataset: 'synthetic' });
    expect(new ObservatoryService({} as never, config({ OBSERVATORY_ENABLED: 'true' }) as never).status()).toEqual({ enabled: true, dataset: 'synthetic' });
    expect(new ObservatoryService({} as never, config({ OBSERVATORY_REAL_DATA: 'true' }) as never).status()).toEqual({ enabled: true, dataset: 'real' });
    const result = await on.analysis({});
    expect(result.dataset).toBe('synthetic');
    expect(result.overview.participants).toBeGreaterThan(0);
  });
  it('piso de 5 participantes: celula pequena suprimida; supressao COMPLEMENTAR impede reconstruir pela diferenca; total some', () => {
    const rowsIn = [{ key: 'a', label: 'A', participants: 40, data: 1 }, { key: 'b', label: 'B', participants: 7, data: 2 }, { key: 'c', label: 'C', participants: 3, data: 3 }, { key: 'd', label: 'D', participants: 0, data: 4 }];
    const out = protect(rowsIn, 5);
    expect(out.rows.map((r) => [r.key, r.suppressed, r.complementary])).toEqual([['a', false, false], ['b', true, true], ['c', true, false], ['d', false, false]]);
    expect(out.rows.filter((r) => r.suppressed).every((r) => r.data === null)).toBe(true);
    expect(out.totalAllowed).toBe(false);
    const clean = protect([{ key: 'a', label: 'A', participants: 9, data: 1 }, { key: 'b', label: 'B', participants: 8, data: 2 }], 5);
    expect(clean.totalAllowed).toBe(true);
  });
  it('resultado inteiro com menos de 5 participantes: nada e divulgado (contagens e metricas nulas)', () => {
    const events = [1, 2, 3].flatMap((p) => [ev(10, 'reported_pain', 5, { participant: 'p' + p, day: '2026-09-07' })]);
    const r = computeObservatory(factsOf(events), baseFilters());
    expect(r.overview).toMatchObject({ belowMinimum: true, participants: null, trainings: null, km: null });
    expect(r.pain.overall).toBeNull();
    expect(r.volume.total).toBeNull();
  });
  it('o piso nao pode ser reduzido pelo cliente; filtros invalidos viram erro', () => {
    expect(parseObservatoryFilters({ minParticipants: '1' }, today).minParticipants).toBe(5);
    expect(parseObservatoryFilters({ minParticipants: '12' }, today).minParticipants).toBe(12);
    expect(() => parseObservatoryFilters({ volumeBands: 'v99' }, today)).toThrow();
    expect(() => parseObservatoryFilters({ from: 'ontem' }, today)).toThrow();
    expect(() => parseObservatoryFilters({ groupBy: 'nome' }, today)).toThrow();
  });
  it('a resposta nao contem identificadores nem chaves internas de participantes', () => {
    const r = computeObservatory(buildSyntheticFacts(today), baseFilters());
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/synthetic-\d|userId|email|"participant"|birthDate|nome/i);
  });
  it('concordancia entre graficos e tabelas e filtros: a mesma resposta fecha as contas e filtrar reduz de forma consistente', () => {
    const facts = buildSyntheticFacts(today);
    const all = computeObservatory(facts, baseFilters());
    const volWeeks = all.volume.rows.reduce((s, r) => s + (r.data?.participantWeeks ?? 0), 0);
    // sem supressao a soma das linhas fecha o total; com supressao o total some e a soma das linhas visiveis e' MENOR (nunca maior)
    if (all.volume.total) expect(volWeeks).toBe(all.overview.participantWeeks);
    else expect(volWeeks).toBeLessThan(all.overview.participantWeeks!);
    const painTrainings = all.pain.rows.reduce((s, r) => s + (r.data?.trainings ?? 0), 0);
    expect(all.pain.overall!.trainings).toBeGreaterThanOrEqual(painTrainings); // linhas suprimidas nao somam
    const narrowed = computeObservatory(facts, baseFilters({ volumeBands: ['v2'] }));
    expect(narrowed.overview.trainings!).toBeLessThan(all.overview.trainings!);
    expect(narrowed.volume.rows.filter((r) => r.key !== 'v2').every((r) => (r.data?.participantWeeks ?? 0) === 0)).toBe(true);
    const strength = computeObservatory(facts, baseFilters({ groupBy: 'strength' }));
    expect(strength.pain.rows.map((r) => r.key)).toEqual(['s0', 's1', 's2p']);
  });
  it('o modulo e isolado: nao importa prescricao, cobranca nem telas das alunas', () => {
    const read = (f: string) => readFileSync(join(__dirname, '..', 'src', 'observatory', f), 'utf8');
    for (const file of ['observatory.service.ts', 'observatory-engine.ts', 'observatory-facts.ts', 'observatory-core.ts']) expect(read(file)).not.toMatch(/training-plans|billing|prescription|anthropic|openai/i);
    expect(read('observatory.service.ts')).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany)\(/);
  });
});

describe('Correções da revisão independente', () => {
  it('completion vinculada a atividade Strava ou ambígua NUNCA vira treino manual (a execução foi excluída, não recontada)', async () => {
    const strava = act('st', 'u1', '2026-10-06T10:00:00Z', 10, { provider: 'health_connect', providerMetrics: { source: { packageName: 'com.strava' } } });
    const ambiguous = act('am', 'u1', '2026-10-07T10:00:00Z', 8, { physicalIdentityStatus: 'ambiguous' });
    const facts = await build(rows({
      activities: [strava, ambiguous],
      completions: [comp('c1', 'u1', { sessionId: 's1', distanceKm: 10, durationMin: 55 }), comp('c2', 'u1', { sessionId: 's2', distanceKm: 8, durationMin: 45 }), comp('c3', 'u1', { sessionId: 's3', distanceKm: 6 })],
      links: [{ trainingSessionId: 's1', activityLogId: 'st' }, { trainingSessionId: 's2', activityLogId: 'am' }, { trainingSessionId: 's3', activityLogId: 'fora-da-janela' }],
    }));
    expect(facts.runEvents).toHaveLength(0);
    expect(facts.quality).toMatchObject({ stravaExcludedEvents: 1, ambiguousIdentityEvents: 1 });
  });
  it('manual x manual repetido no mesmo dia conta uma vez; manual sem distância no dia de outro treino não é treino a mais', async () => {
    const mk = (id: string, km: number | null) => comp(id, 'u1', { distanceKm: km, completedAt: new Date('2026-10-08T15:00:00Z') });
    const facts = await build(rows({ completions: [mk('m1', 10), mk('m2', 10.2), mk('m3', null)] }));
    expect(facts.runEvents.map((e) => e.eventKey)).toEqual(['m:m1']);
    expect(facts.quality.duplicateManualEvents).toBe(2);
  });
  it('duas completions no mesmo treino, uma "sem dor" e outra com dor: prevalece o relato e o conflito é contado', async () => {
    const facts = await build(rows({
      activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 10)],
      completions: [comp('c1', 'u1', { sessionId: 's1', painFlag: 'none' }), comp('c2', 'u1', { sessionId: 's2', painFlag: 'moderado' })],
      links: [{ trainingSessionId: 's1', activityLogId: 'a' }, { trainingSessionId: 's2', activityLogId: 'a' }],
    }));
    expect(facts.runEvents[0].pain.origin).toBe('reported_pain');
    expect(facts.quality.painConflicts).toBe(1);
  });
  it('nota fora de 1–10 é limitada (as faixas sempre somam os relatos com nota)', async () => {
    const facts = await build(rows({ activities: [act('a', 'u1', '2026-10-06T10:00:00Z', 10)], pains: [{ id: 'p', userId: 'u1', createdAt: new Date('2026-10-06T20:00:00Z'), intensity: 14 }] }));
    expect(facts.runEvents[0].pain.intensity).toBe(10);
    const m = painMetrics(facts.runEvents);
    expect(m.intensityBins.reduce((s, b) => s + b.count, 0)).toBe(m.reportsWithIntensity);
  });
  it('linhas suprimidas NÃO devolvem o tamanho exato do grupo pequeno (participants = null)', () => {
    const out = protect([{ key: 'a', label: 'A', participants: 40, data: 1 }, { key: 'b', label: 'B', participants: 3, data: 2 }, { key: 'c', label: 'C', participants: 9, data: 3 }], 5);
    expect(out.rows.filter((r) => r.suppressed).every((r) => r.participants === null && r.data === null)).toBe(true);
    const few = [1, 2, 3].map((p) => ev(10, 'no_pain_report', 0, { participant: 'p' + p, day: '2026-09-14' }));
    const many = Array.from({ length: 7 }, (_, p) => ev(30, 'no_pain_report', 0, { participant: 'q' + p, day: '2026-09-07' }));
    const r = computeObservatory(factsOf([...few, ...many]), baseFilters());
    expect(JSON.stringify(r)).not.toMatch(/"participants":[1-4][,}]/); // nenhum tamanho exato de 1 a 4 pessoas sai no JSON
  });
  it('agrupamento de células pequenas: as faixas pequenas viram "Demais grupos" (>= 5 pessoas distintas) e os totais continuam fechando', () => {
    const events: ObsRunEvent[] = [];
    for (let p = 0; p < 20; p += 1) events.push(ev(30, 'no_pain_report', 0, { participant: 'a' + p, day: '2026-09-07' })); // v2 (20–40): 20 pessoas
    for (let p = 0; p < 3; p += 1) events.push(ev(70, 'no_pain_report', 0, { participant: 'b' + p, day: '2026-09-07' })); // v4: 3
    for (let p = 0; p < 3; p += 1) events.push(ev(100, 'no_pain_report', 0, { participant: 'c' + p, day: '2026-09-07' })); // v5: 3
    const r = computeObservatory(factsOf(events), baseFilters());
    const byKey = Object.fromEntries(r.volume.rows.map((row) => [row.key, row]));
    expect(byKey.v4.suppressed).toBe(true);
    expect(byKey.v5.suppressed).toBe(true);
    expect(byKey.others.data).toMatchObject({ participantWeeks: 6 });
    expect(byKey.others.participants).toBe(6);
    const visible = r.volume.rows.filter((row) => !row.suppressed).reduce((s, row) => s + (row.data?.participantWeeks ?? 0), 0);
    expect(visible).toBe(r.overview.participantWeeks); // o total fecha sem esconder nada por diferenca
    expect(r.volume.total).not.toBeNull();
  });
  it('pace só aparece com >= 5 pessoas COM pace; uma pessoa com tempo entre cinco sem tempo não expõe o dela', () => {
    const events: ObsRunEvent[] = [];
    for (let p = 0; p < 6; p += 1) events.push(ev(30, 'no_pain_report', 0, { participant: 'p' + p, day: '2026-09-07', seconds: p === 0 ? 30 * 330 : null }));
    const r = computeObservatory(factsOf(events), baseFilters());
    const cell = r.pace.cross.find((row) => row.key === 'v2')!.data!;
    expect(cell.pace).toBeNull();
    expect(cell.participantPace).toEqual({ p25: null, median: null, p75: null });
    expect(cell.participantsWithPace).toBeNull();
  });
  it('treino sem distância válida fica fora das taxas por 1.000 km (numerador e denominador do mesmo conjunto)', () => {
    const events: ObsRunEvent[] = [];
    for (let p = 0; p < 6; p += 1) events.push(ev(20, 'no_pain_report', 0, { participant: 'p' + p, day: '2026-09-07' }));
    events.push(ev(null, 'reported_pain', 9, { participant: 'p0', day: '2026-09-08', eventKey: 'sem-km' }));
    const r = computeObservatory(factsOf(events), baseFilters());
    expect(r.pain.overall!.reports).toBe(0); // o relato do treino sem km nao infla a taxa
    expect(r.quality.trainingsWithoutDistance).toBe(1);
  });
  it('o pace dos quantis nunca vira "5:60/km" e a soma de floats não empurra a semana para a faixa errada', () => {
    const events: ObsRunEvent[] = [];
    for (let p = 0; p < 6; p += 1) events.push(ev(20, 'no_pain_report', 0, { participant: 'p' + p, day: '2026-09-07', seconds: 20 * 359.6 }));
    const r = computeObservatory(factsOf(events), baseFilters());
    expect(JSON.stringify(r.pace.cross)).not.toMatch(/:60\/km/);
    const four: ObsRunEvent[] = [];
    for (let p = 0; p < 6; p += 1) for (const km of [13.3, 13.3, 13.4]) four.push(ev(km, 'no_pain_report', 0, { participant: 'p' + p, day: '2026-09-07' })); // soma 40.00000000000001
    expect(computeObservatory(factsOf(four), baseFilters()).volume.rows.find((row) => row.key === 'v2')!.participants).toBe(6);
  });
  it('filtros repetidos na query e período máximo de 2 anos', () => {
    expect(parseObservatoryFilters({ volumeBands: ['v1', 'v2'] as unknown as string }, today).volumeBands).toEqual(['v1', 'v2']);
    expect(() => parseObservatoryFilters({ from: '2023-01-01', to: '2026-10-01' }, today)).toThrow();
  });
});
