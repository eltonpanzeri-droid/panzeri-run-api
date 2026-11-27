import { buildPhasedCycles } from '../src/menstrual-cycle/cycle-phases';
import { DISTANCE_BANDS, classify, painLevelMetrics } from '../src/observatory/observatory-core';
import { computeObservatory } from '../src/observatory/observatory-engine';
import { buildFactsFromRows, type RawActivity, type RawCompletion, type RawRows } from '../src/observatory/observatory-facts';
import type { ObsFacts, ObsFilters, ObsPainReport, ObsParticipant, ObsRunEvent, ObsTraining } from '../src/observatory/observatory.types';

// 26/11/2026 — analise ampliada do Observatorio (ordem de Elton): dor em todas as modalidades por 100 treinos, corridas por faixa de distancia, "Relatar dor" ANALISADO A PARTE e fases do ciclo.

const act = (id: string, userId: string, startedAt: string, km: number | null, over: Partial<RawActivity> = {}): RawActivity => ({
  id, userId, provider: 'polar', startedAt: new Date(startedAt), utcOffsetMinutes: -180, durationSec: km ? Math.round(km * 330) : null, distanceMeters: km ? km * 1000 : null, sport: 'corrida',
  providerMetrics: {}, physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null, ...over,
});
const comp = (id: string, userId: string, over: Partial<RawCompletion> = {}): RawCompletion => ({
  id, userId, sessionId: null, status: 'done', completedAt: new Date('2026-10-06T15:00:00Z'), distanceKm: null, durationMin: null, painFlag: null, perceivedEffort: null,
  session: { modality: 'corrida', origin: null, structure: {} }, ...over,
});
const rows = (over: Partial<RawRows> = {}): RawRows => ({ users: [{ id: 'u1', birthDate: new Date('1980-05-01'), sex: 'F' }], activities: [], completions: [], links: [], pains: [], ...over });
const win = { since: '2026-09-01', to: '2026-10-31' };
const build = (r: RawRows) => buildFactsFromRows(r, async () => [], win);

describe('dor por treino em TODAS as modalidades (feedback do treino)', () => {
  it('forca e outras modalidades viram treinos, com a dor marcada no feedback; corrida segue como antes', async () => {
    const facts = await build(rows({
      activities: [act('r1', 'u1', '2026-10-06T10:00:00Z', 8), act('f1', 'u1', '2026-10-07T10:00:00Z', null, { sport: 'forca' }), act('n1', 'u1', '2026-10-08T10:00:00Z', 2, { sport: 'natacao' })],
      completions: [
        comp('c1', 'u1', { sessionId: 's1', painFlag: 'forte', painTiming: 'so_depois' }),
        comp('c2', 'u1', { sessionId: 's2', painFlag: 'leve', session: { modality: 'forca', origin: null, structure: {} } }),
      ],
      links: [{ trainingSessionId: 's1', activityLogId: 'r1' }, { trainingSessionId: 's2', activityLogId: 'f1' }],
    }));
    const by = (g: string) => facts.trainings!.filter((t) => t.group === g);
    expect(by('corrida')).toHaveLength(1);
    expect(by('forca')).toHaveLength(1);
    expect(by('outras')).toHaveLength(1);
    expect(by('corrida')[0].pain).toEqual({ origin: 'reported_pain', level: 'forte', timing: 'so_depois' });
    expect(by('forca')[0].pain.level).toBe('leve');
    expect(by('outras')[0].pain.origin).toBe('no_pain_report'); // registrado sem feedback: zero assumido
  });
  it('treino manual de forca/outra que repete a atividade importada do mesmo dia nao conta em dobro (o feedback passa para ela)', async () => {
    const facts = await build(rows({
      activities: [act('f1', 'u1', '2026-10-06T10:00:00Z', null, { sport: 'forca' })],
      completions: [comp('c1', 'u1', { painFlag: 'moderado', completedAt: new Date('2026-10-06T21:00:00Z'), session: { modality: 'forca', origin: null, structure: {} } })],
    }));
    const forca = facts.trainings!.filter((t) => t.group === 'forca');
    expect(forca).toHaveLength(1);
    expect(forca[0].pain.level).toBe('moderado');
    expect(forca[0].feedbackAnswered).toBe(true);
    expect(facts.quality.duplicateManualEvents).toBe(1);
  });
  it('painLevelMetrics: por 100 treinos, por nivel e por 1.000 km (so treinos com distancia); zero assumido entra no denominador', () => {
    const t = (km: number | null, origin: 'explicit_no_pain' | 'no_pain_report' | 'reported_pain', level: 'leve' | 'moderado' | 'forte' | null, answered = true) => ({ km, feedbackAnswered: answered, pain: { origin, level, timing: null } });
    const m = painLevelMetrics([t(10, 'reported_pain', 'leve'), t(10, 'reported_pain', 'forte'), t(10, 'explicit_no_pain', null), t(10, 'no_pain_report', null, false), t(null, 'reported_pain', 'moderado')]);
    expect(m.trainings).toBe(5);
    expect(m.painTrainings).toBe(3);
    expect(m.painPer100Trainings).toBe(60);
    expect(m.levels).toEqual({ leve: 1, moderado: 1, forte: 1, semNivel: 0 });
    expect(m.km).toBe(40);
    expect(m.painPer1000Km).toBe(50); // 2 treinos com dor E distancia valida / 40 km
    expect(m.painPer100Answered).toBe(75); // 3 de 4 que responderam
    expect(painLevelMetrics([]).painPer100Trainings).toBeNull();
  });
});

describe('faixas de distancia da corrida', () => {
  it('limite superior pertence a faixa de baixo (5,0 km = ate 5 km; 5,1 km = 5 a 10 km; 21,1 = meia)', () => {
    const band = (km: number) => DISTANCE_BANDS.find((b) => classify(km, [b]) !== null)?.id;
    expect([band(5), band(5.1), band(10), band(15), band(21.1), band(21.2), band(0.5)]).toEqual(['d1', 'd2', 'd2', 'd3', 'd4', 'd5', 'd1']);
  });
});

const filters = (over: Partial<ObsFilters> = {}): ObsFilters => ({ from: '2026-08-03', to: '2026-10-25', today: '2026-10-26', volumeBands: [], ageBands: [], strengthBands: [], sexes: [], mode: 'cross', groupBy: 'volume', includeZeroWeeks: false, minParticipants: 1, ...over });
const personRuns = (key: string, weeks: number, km: number): ObsRunEvent[] => Array.from({ length: weeks }, (_, w) => {
  const d = new Date(Date.UTC(2026, 7, 3 + w * 7)).toISOString().slice(0, 10);
  return { participant: key, eventKey: `${key}-${w}`, day: d, km, seconds: km * 330, source: 'activity' as const, isExtra: false, feedbackAnswered: true, pain: { origin: 'explicit_no_pain' as const, intensity: 0 } };
});
const asTraining = (e: ObsRunEvent): ObsTraining => ({ participant: e.participant, eventKey: e.eventKey, day: e.day, group: 'corrida', km: e.km, seconds: e.seconds, feedbackAnswered: e.feedbackAnswered, pain: { origin: e.pain.origin, level: null, timing: null } });
const quality = { stravaExcludedEvents: 0, ambiguousIdentityEvents: 0, unevaluatedIdentityEvents: 0, invalidDistanceEvents: 0, duplicateManualEvents: 0, painConflicts: 0 };

describe('"Relatar dor" a parte e fases do ciclo', () => {
  const runs = [...personRuns('a', 10, 8), ...personRuns('b', 10, 12)];
  const cycle = (start: string) => ({ cycles: buildPhasedCycles([{ start: new Date(`${start}T00:00:00Z`), end: new Date('2026-08-07T00:00:00Z') }, { start: new Date('2026-08-31T00:00:00Z'), end: null }], null), hormonal: false });
  const participants: ObsParticipant[] = [{ key: 'a', birthDate: '1985-01-01', sex: 'F', cycle: cycle('2026-08-03') }, { key: 'b', birthDate: '1985-01-01', sex: 'M' }];
  const painReports: ObsPainReport[] = [
    { participant: 'a', day: '2026-08-05', intensity: 7, regions: ['joelho'] }, // dia 2 do ciclo: menstrual
    { participant: 'b', day: '2026-09-10', intensity: 3, regions: ['joelho', 'panturrilha'] },
  ];
  const facts: ObsFacts = { dataset: 'synthetic', dataAsOf: new Date().toISOString(), participants, runEvents: runs, strengthEvents: [], trainings: runs.map(asTraining), painReports, quality };
  const r = computeObservatory(facts, filters());

  it('"Relatar dor" nao entra no treino: a dor por 1.000 km dos treinos nao muda com os relatos avulsos', () => {
    const semRelatos = computeObservatory({ ...facts, painReports: [] }, filters());
    expect(r.pain.overall).toEqual(semRelatos.pain.overall);
    expect(r.insights!.byModality.rows.find((x) => x.key === 'corrida')!.data!.painTrainings).toBe(0);
  });
  it('relatos avulsos: nota media, faixas, regiao e taxa GERAL por 1.000 km', () => {
    const s = r.insights!.standaloneReports;
    expect(s.overall).toMatchObject({ reports: 2, participants: 2, meanIntensity: 5 });
    expect(s.overall!.bins.reduce((n, b) => n + b.count, 0)).toBe(2);
    expect(s.regions.map((x) => [x.key, x.data!.reports])).toEqual([['joelho', 2], ['panturrilha', 1]]);
    expect(s.runKm).toBe(200);
    expect(s.reportsPer1000RunKm).toBe(10);
  });
  it('corridas por faixa de distancia com pace agregado', () => {
    const d = r.insights!.runsByDistance.rows;
    expect(d.find((x) => x.key === 'd2')!.data).toMatchObject({ runs: 10, km: 80 });
    expect(d.find((x) => x.key === 'd3')!.data).toMatchObject({ runs: 10, km: 120 });
    expect(d.find((x) => x.key === 'd2')!.data!.pace!.label).toBe('5:30/km');
  });
  it('ciclo: so entra quem registrou; o relato do dia 2 cai na fase menstrual; sem dado do ciclo nao ha fase', () => {
    const c = r.insights!.cycle;
    expect(c.participantsWithCycle).toBe(1);
    const menstrual = c.natural.find((x) => x.phase === 'menstruacao')!.row.data!;
    expect(menstrual.reports).toBe(1);
    expect(menstrual.meanReportIntensity).toBe(7);
    expect(menstrual.participantDays).toBeGreaterThan(0);
    expect(c.natural.reduce((n, x) => n + (x.row.data?.reports ?? 0), 0)).toBe(1); // o relato do aluno SEM ciclo nao aparece em fase nenhuma
    expect(c.hormonal.every((x) => (x.row.data?.reports ?? 0) === 0)).toBe(true);
    expect(c.participantsWithEstimatedPhases).toBe(1); // so ha 1 ciclo fechado e o aberto usa a mediana/padrao
  });
  it('quem usa anticoncepcional hormonal fica em grupo separado (fase so estimada)', () => {
    const hormonal = computeObservatory({ ...facts, participants: [{ ...participants[0], cycle: { ...participants[0].cycle!, hormonal: true } }, participants[1]] }, filters());
    expect(hormonal.insights!.cycle.natural.reduce((n, x) => n + (x.row.data?.reports ?? 0), 0)).toBe(0);
    expect(hormonal.insights!.cycle.hormonal.reduce((n, x) => n + (x.row.data?.reports ?? 0), 0)).toBe(1);
  });
  it('privacidade: a resposta nao carrega ciclos, chaves de participante nem datas de ciclo', () => {
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/"participant"|userId|birthDate|"cycles"|cycleStart|"start"/);
  });
  it('abaixo do piso de participantes nada da analise ampliada e divulgado', () => {
    const small = computeObservatory(facts, filters({ minParticipants: 5 }));
    expect(small.insights).toBeNull();
  });
});
