import { buildPhasedCycles } from '../src/menstrual-cycle/cycle-phases';
import { DISTANCE_BANDS, classify, painLevelMetrics, reportMetrics } from '../src/observatory/observatory-core';
import { computeObservatory } from '../src/observatory/observatory-engine';
import { buildFactsFromRows, regionOf, segmentOf, type RawActivity, type RawCompletion, type RawRows } from '../src/observatory/observatory-facts';
import type { ObsFacts, ObsFilters, ObsPainReport, ObsParticipant, ObsRunEvent, ObsScheduled, ObsTraining, TrainingSegment } from '../src/observatory/observatory.types';

// 26/11/2026 — analise ampliada do Observatorio (ordem de Elton): dor por tipo de treino (corrida, fortalecimento, musculacao, extras), corridas por faixa de distancia, alunas por volume das ultimas 10 semanas,
// "Relatar dor" ANALISADO A PARTE (por local e como taxa de exposicao), fases do ciclo com adesao e km.

const act = (id: string, userId: string, startedAt: string, km: number | null, over: Partial<RawActivity> = {}): RawActivity => ({
  id, userId, provider: 'polar', startedAt: new Date(startedAt), utcOffsetMinutes: -180, durationSec: km ? Math.round(km * 330) : null, distanceMeters: km ? km * 1000 : null, sport: 'corrida',
  providerMetrics: {}, physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null, executionClassification: 'corresponding', ...over,
});
const comp = (id: string, userId: string, over: Partial<RawCompletion> = {}): RawCompletion => ({
  id, userId, sessionId: null, status: 'done', completedAt: new Date('2026-10-06T15:00:00Z'), distanceKm: null, durationMin: null, painFlag: null, perceivedEffort: null,
  session: { modality: 'corrida', origin: null, structure: {} }, ...over,
});
const rows = (over: Partial<RawRows> = {}): RawRows => ({ users: [{ id: 'u1', birthDate: new Date('1980-05-01'), sex: 'F' }], activities: [], completions: [], links: [], pains: [], ...over });
const win = { since: '2026-09-01', to: '2026-10-31' };
const build = (r: RawRows) => buildFactsFromRows(r, async () => [], win);

describe('tipo de treino: prescrito x extra, musculacao x fortalecimento', () => {
  it('segmentOf: corrida/esteira, fortalecimento, musculacao, outras; extra de corrida separado do extra geral (forca extra entra no extra geral)', () => {
    const pairs: Array<[string, boolean, TrainingSegment]> = [
      ['corrida', false, 'corrida'], ['esteira', false, 'corrida'], ['RUNNING', false, 'corrida'], ['fortalecimento_corredores', false, 'fortalecimento'], ['forca', false, 'musculacao'],
      ['natacao', false, 'outras'], ['corrida', true, 'extra_corrida'], ['forca', true, 'extra_geral'], ['natacao', true, 'extra_geral'],
    ];
    for (const [modality, extra, expected] of pairs) expect([modality, segmentOf(modality, extra)]).toEqual([modality, expected]);
  });
  it('atividade classificada como alternativa (extra) e atividade ligada a sessao de origem extra viram extra; a prescrita fica prescrita', async () => {
    const facts = await build(rows({
      activities: [
        act('r1', 'u1', '2026-10-06T10:00:00Z', 8),
        act('r2', 'u1', '2026-10-07T10:00:00Z', 5, { executionClassification: 'alternative' }),
        act('r3', 'u1', '2026-10-08T10:00:00Z', 6),
        act('f1', 'u1', '2026-10-09T10:00:00Z', null, { sport: 'forca' }),
        act('f2', 'u1', '2026-10-10T10:00:00Z', null, { sport: 'fortalecimento_corredores' }),
        act('x1', 'u1', '2026-10-11T10:00:00Z', null, { sport: 'forca', executionClassification: 'alternative' }),
      ],
      completions: [comp('c3', 'u1', { sessionId: 's3', session: { modality: 'corrida', origin: 'device_extra', structure: {} } })],
      links: [{ trainingSessionId: 's3', activityLogId: 'r3' }],
    }));
    const seg = (key: string) => facts.trainings!.find((t) => t.eventKey === `a:${key}`)!.segment;
    expect([seg('r1'), seg('r2'), seg('r3'), seg('f1'), seg('f2'), seg('x1')]).toEqual(['corrida', 'extra_corrida', 'extra_corrida', 'musculacao', 'fortalecimento', 'extra_geral']);
    expect(facts.runEvents.map((e) => e.isExtra)).toEqual([false, true, true]);
  });
  it('treino manual: extra do aluno entra como extra; feedback de fortalecimento entra como fortalecimento', async () => {
    const facts = await build(rows({
      completions: [
        comp('m1', 'u1', { painFlag: 'leve', session: { modality: 'fortalecimento_corredores', origin: null, structure: {} } }),
        comp('m2', 'u1', { completedAt: new Date('2026-10-08T15:00:00Z'), session: { modality: 'natacao', origin: 'student_extra', structure: {} } }),
      ],
    }));
    expect(facts.trainings!.map((t) => t.segment).sort()).toEqual(['extra_geral', 'fortalecimento']);
  });
});

describe('local da dor do "Relatar dor"', () => {
  it('junta os lados e guarda o lado a parte; "nao sei" e desconhecido nao viram local inventado', () => {
    expect(regionOf('Joelho direito')).toEqual({ group: 'joelho', side: 'direito' });
    expect(regionOf('Joelho esquerdo')).toEqual({ group: 'joelho', side: 'esquerdo' });
    expect(regionOf('Pe esquerdo')).toEqual({ group: 'pe', side: 'esquerdo' });
    expect(regionOf('Lombar/coluna')).toEqual({ group: 'lombar_coluna', side: null });
    expect(regionOf('Gluteo direito')).toEqual({ group: 'gluteo', side: 'direito' });
    expect(regionOf('Nao sei responder')).toEqual({ group: 'nao_informado', side: null });
    expect(regionOf('Dedo do pe')).toEqual({ group: 'outros', side: null });
    expect(regionOf('  ')).toBeNull();
  });
  it('o relato guarda grupos (sem lado) e os lados; "outra localizacao" preenchida entra como "outros"', async () => {
    const facts = await build(rows({ pains: [{ id: 'p', userId: 'u1', createdAt: new Date('2026-10-06T20:00:00Z'), intensity: 6, regions: ['Joelho direito', 'Joelho esquerdo', 'Canela direita'], hasOtherLocation: true }] }));
    expect(facts.painReports![0]).toMatchObject({ regions: ['joelho', 'canela', 'outros'], regionSides: ['joelho:direito', 'joelho:esquerdo', 'canela:direita'.replace('direita', 'direito')] });
  });
});

describe('adesao: treinos programados', () => {
  it('extras nao entram; registrado = feedback feito/ajustado ou atividade vinculada; "nao feito" e sem registro nao contam como registrado', async () => {
    const mk = (modality: string, day: string, over: Partial<{ origin: string | null; completionStatus: string | null; linked: boolean }> = {}) => ({ userId: 'u1', scheduledDate: new Date(`${day}T00:00:00Z`), modality, origin: 'agent', completionStatus: null as string | null, linked: false, ...over });
    const facts = await build(rows({ sessions: [
      mk('corrida', '2026-10-06', { completionStatus: 'done' }), mk('forca', '2026-10-07', { completionStatus: 'missed' }), mk('fortalecimento_corredores', '2026-10-08', { linked: true }),
      mk('corrida', '2026-10-09'), mk('corrida', '2026-10-10', { origin: 'student_extra', completionStatus: 'done' }),
    ] }));
    expect(facts.scheduled!.map((s) => [s.segment, s.registered])).toEqual([['corrida', true], ['musculacao', false], ['fortalecimento', true], ['corrida', false]]);
  });
});

describe('dor do treino: escala 0-3 do feedback e taxas', () => {
  const t = (km: number | null, origin: 'explicit_no_pain' | 'no_pain_report' | 'reported_pain', level: 'leve' | 'moderado' | 'forte' | null, answered = true) => ({ km, feedbackAnswered: answered, pain: { origin, level, timing: null } });
  it('por 10 e por 100 treinos, por nivel, pontos 0-3, media entre os com dor e media geral, por 1.000 km so com distancia', () => {
    const m = painLevelMetrics([t(10, 'reported_pain', 'leve'), t(10, 'reported_pain', 'forte'), t(10, 'explicit_no_pain', null), t(10, 'no_pain_report', null, false), t(null, 'reported_pain', 'moderado')]);
    expect(m).toMatchObject({ trainings: 5, painTrainings: 3, painPer100Trainings: 60, painPer10Trainings: 6, levelPoints: 6, levelPointsPer100Trainings: 120, meanLevelAmongPain: 2, meanLevelAll: 1.2, km: 40, painPer1000Km: 50, levelPointsPer1000Km: 100, painPer100Answered: 75 });
    expect(m.levels).toEqual({ leve: 1, moderado: 1, forte: 1, semNivel: 0 });
    const vazio = painLevelMetrics([]);
    expect([vazio.painPer100Trainings, vazio.meanLevelAmongPain, vazio.meanLevelAll, vazio.painPer1000Km]).toEqual([null, null, null, null]);
  });
  it('"Relatar dor": soma das notas e media, nunca misturada com o feedback do treino', () => {
    const m = reportMetrics([{ participant: 'a', intensity: 4 }, { participant: 'b', intensity: 8 }]);
    expect(m).toMatchObject({ reports: 2, participants: 2, meanIntensity: 6, notePoints: 12 });
  });
});

describe('faixas de distancia da corrida (ate 5, 5-10, ... 35-42,195, acima)', () => {
  it('limite superior pertence a faixa de baixo', () => {
    const band = (km: number) => DISTANCE_BANDS.find((b) => classify(km, [b]) !== null)?.id;
    expect([band(0.5), band(5), band(5.1), band(10), band(15), band(20), band(20.1), band(25), band(30), band(35), band(42.195), band(42.2)]).toEqual(['d1', 'd1', 'd2', 'd2', 'd3', 'd4', 'd5', 'd5', 'd6', 'd7', 'd8', 'd9']);
    expect(DISTANCE_BANDS).toHaveLength(9);
  });
});

const filters = (over: Partial<ObsFilters> = {}): ObsFilters => ({ from: '2026-08-03', to: '2026-10-25', today: '2026-10-26', volumeBands: [], ageBands: [], strengthBands: [], sexes: [], mode: 'cross', groupBy: 'volume', includeZeroWeeks: false, minParticipants: 1, ...over });
const MONDAY0 = Date.UTC(2026, 7, 3); // segunda 03/08/2026
const dayOf = (week: number, plus = 0) => new Date(MONDAY0 + (week * 7 + plus) * 86_400_000).toISOString().slice(0, 10);
const runsOf = (key: string, weekList: number[], km: number, extra = false): ObsRunEvent[] => weekList.map((w) => ({
  participant: key, eventKey: `${key}-${w}-${extra ? 'x' : 'p'}`, day: dayOf(w), km, seconds: km * 330, source: 'activity' as const, isExtra: extra, feedbackAnswered: true, pain: { origin: 'explicit_no_pain' as const, intensity: 0 },
}));
const asTraining = (e: ObsRunEvent, over: Partial<ObsTraining> = {}): ObsTraining => ({ participant: e.participant, eventKey: e.eventKey, day: e.day, group: 'corrida', segment: e.isExtra ? 'extra_corrida' : 'corrida', km: e.km, seconds: e.seconds, feedbackAnswered: e.feedbackAnswered, pain: { origin: e.pain.origin, level: null, timing: null }, ...over });
const quality = { stravaExcludedEvents: 0, ambiguousIdentityEvents: 0, unevaluatedIdentityEvents: 0, invalidDistanceEvents: 0, duplicateManualEvents: 0, painConflicts: 0 };
const gym = (participant: string, week: number, segment: TrainingSegment, level: 'leve' | 'moderado' | 'forte' | null = null): ObsTraining => ({
  participant, eventKey: `${participant}-g-${week}-${segment}`, day: dayOf(week, 2), group: segment === 'musculacao' || segment === 'fortalecimento' ? 'forca' : 'outras', segment, km: null, seconds: null, feedbackAnswered: true,
  pain: { origin: level ? 'reported_pain' : 'explicit_no_pain', level, timing: null },
});

describe('tipos de treino, "Relatar dor" a parte e volume das ultimas 10 semanas', () => {
  const allWeeks = Array.from({ length: 12 }, (_, i) => i); // semanas 0..11 (11 = semana de 19/10; a atual e' 26/10 = semana 12)
  const a = runsOf('a', allWeeks, 10);
  const b = [...runsOf('b', allWeeks, 10), ...runsOf('b', [3, 4], 5, true)];
  const runs = [...a, ...b];
  const trainings: ObsTraining[] = [
    ...runs.map((e) => asTraining(e)),
    gym('a', 1, 'musculacao', 'moderado'), gym('a', 2, 'musculacao'), gym('b', 1, 'fortalecimento', 'leve'), gym('b', 2, 'extra_geral', 'forte'),
  ];
  const painReports: ObsPainReport[] = [
    { participant: 'a', day: '2026-08-12', intensity: 6, regions: ['joelho'], regionSides: ['joelho:direito'] },
    { participant: 'b', day: '2026-08-20', intensity: 4, regions: ['joelho', 'canela'], regionSides: [] },
  ];
  const participants: ObsParticipant[] = [{ key: 'a', birthDate: '1985-01-01', sex: 'F' }, { key: 'b', birthDate: '1985-01-01', sex: 'F' }];
  const facts: ObsFacts = { dataset: 'synthetic', dataAsOf: new Date().toISOString(), participants, runEvents: runs, strengthEvents: [], trainings, painReports, quality };
  const r = computeObservatory(facts, filters());
  const ins = r.insights!;

  it('tipos de treino: contagem por segmento, dor por 100 e escala 0-3', () => {
    const seg = (id: string) => ins.segments.rows.find((x) => x.key === id)!.data!;
    expect(seg('corrida').trainings).toBe(24);
    expect(seg('extra_corrida').trainings).toBe(2);
    expect(seg('musculacao')).toMatchObject({ trainings: 2, painTrainings: 1, painPer100Trainings: 50, levelPoints: 2 });
    expect(seg('fortalecimento')).toMatchObject({ trainings: 1, painTrainings: 1, levelPoints: 1 });
    expect(seg('extra_geral')).toMatchObject({ trainings: 1, levelPoints: 3 });
    expect(ins.segments.total!.trainings).toBe(30);
    expect(ins.segments.runsCombined!.trainings).toBe(26);
  });
  it('"Relatar dor" nao entra no treino: a dor da corrida nao muda com ou sem os relatos', () => {
    const sem = computeObservatory({ ...facts, painReports: [] }, filters());
    expect(r.pain.overall).toEqual(sem.pain.overall);
    expect(ins.segments.rows.find((x) => x.key === 'corrida')!.data!.painTrainings).toBe(0);
  });
  it('taxas de exposicao do Relatar dor: por 100 treinos do tipo e por 1.000 km SO de corrida', () => {
    const musc = ins.segments.rows.find((x) => x.key === 'musculacao')!.data!.relatar;
    expect(musc).toMatchObject({ reports: 2, notePoints: 10, reportsPer100Trainings: 100, notePointsPer100Trainings: 500, reportsPer1000Km: null });
    const runsC = ins.segments.runsCombined!.relatar;
    expect(runsC.reportsPer1000Km).toBe(Math.round((2 / 250) * 1000 * 100) / 100); // 24 corridas de 10 km + 2 de 5 km = 250 km
    expect(ins.standalone.runKm).toBe(250);
  });
  it('local da dor: relatos, nota media, taxas e matriz local x tipo de treino', () => {
    const joelho = ins.standalone.locations.find((x) => x.key === 'joelho')!.data!;
    expect(joelho).toMatchObject({ reports: 2, participants: 2, meanNote: 5, notePoints: 10 });
    expect(ins.standalone.locations.find((x) => x.key === 'canela')!.data).toMatchObject({ reports: 1, meanNote: 4 });
    expect(ins.standalone.sides.map((x) => [x.key, x.data!.reports])).toEqual([['joelho:direito', 1]]);
    const cell = ins.standalone.locationBySegment.find((x) => x.key === 'joelho')!.cells.musculacao!;
    expect(cell).toEqual({ reportsPer100: 100, notePointsPer100: 500 });
  });
  it('alunas por volume semanal: maior faixa com >= 7 de 10 semanas, semana atual fora, quem e elegivel a mais nao entra na menor', () => {
    const rowsBy = (rr: typeof r) => Object.fromEntries(rr.insights!.weeklyVolume.rows.map((x) => [x.key, x.data?.students ?? 0]));
    // 'a' e 'b' correm 10 km por semana: ate 20 km
    expect(rowsBy(r)).toMatchObject({ w0: 2, w20: 0 });
    const heavy = [...runsOf('c', allWeeks, 25), ...runsOf('d', allWeeks, 55), ...runsOf('e', [0, 1, 2, 3, 4, 5], 25), ...runsOf('f', [12, 13], 25)];
    const f2: ObsFacts = { ...facts, participants: [...participants, ...['c', 'd', 'e', 'f'].map((key) => ({ key, birthDate: '1985-01-01', sex: 'F' }))], runEvents: [...runs, ...heavy], trainings: [...trainings, ...heavy.map((e) => asTraining(e))] };
    const v = rowsBy(computeObservatory(f2, filters()));
    expect(v.w20).toBe(1); // 'c': 25 km em >= 7 semanas (nao entra em 30 nem 40)
    expect(v.w50).toBe(1); // 'd': 55 km (elegivel a 50; nao entra nas faixas menores)
    expect(v.w0).toBe(3); // 'a', 'b' e 'e' (so 6 semanas com 25 km); 'f' so correu nas semanas atual/futura: fora
    expect(computeObservatory(f2, filters()).insights!.weeklyVolume.studentsWithRuns).toBe(5);
  });
  it('corridas por faixa de distancia: contagem, extras e pace agregado', () => {
    const d = ins.runsByDistance.rows;
    expect(d.find((x) => x.key === 'd2')!.data).toMatchObject({ runs: 24, km: 240 });
    expect(d.find((x) => x.key === 'd1')!.data).toMatchObject({ runs: 2, extraRuns: 2, km: 10 });
    expect(d.find((x) => x.key === 'd2')!.data!.pace!.label).toBe('5:30/km');
  });
  it('privacidade: nenhuma chave de participante no resultado; abaixo do piso nada da analise ampliada e divulgado', () => {
    expect(JSON.stringify(r)).not.toMatch(/"participant"|userId|birthDate|"cycles"/);
    expect(computeObservatory(facts, filters({ minParticipants: 5 })).insights).toBeNull();
  });
});

describe('fases do ciclo: dor, adesao, km e local', () => {
  const cycles = buildPhasedCycles([{ start: new Date('2026-08-03T00:00:00Z'), end: new Date('2026-08-07T00:00:00Z') }, { start: new Date('2026-08-31T00:00:00Z'), end: null }], null);
  const participants: ObsParticipant[] = [{ key: 'a', birthDate: '1985-01-01', sex: 'F', cycle: { cycles, hormonal: false } }, { key: 'b', birthDate: '1985-01-01', sex: 'M' }];
  const weekly = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const runs = [...runsOf('a', weekly, 8), ...runsOf('b', weekly, 12)];
  const sched = (day: string, segment: ObsScheduled['segment'], registered: boolean): ObsScheduled => ({ participant: 'a', day, segment, registered });
  const facts: ObsFacts = {
    dataset: 'synthetic', dataAsOf: new Date().toISOString(), participants, runEvents: runs, strengthEvents: [], quality,
    trainings: [...runs.map((e) => asTraining(e, e.participant === 'a' && e.day === '2026-08-03' ? { pain: { origin: 'reported_pain', level: 'moderado', timing: null } } : {})), gym('a', 0, 'musculacao')],
    painReports: [{ participant: 'a', day: '2026-08-05', intensity: 7, regions: ['joelho'], regionSides: [] }, { participant: 'b', day: '2026-09-10', intensity: 3, regions: ['canela'], regionSides: [] }],
    scheduled: [sched('2026-08-05', 'corrida', true), sched('2026-08-06', 'musculacao', false), sched('2026-08-12', 'corrida', true), sched('2026-10-27', 'corrida', false)],
  };
  const r = computeObservatory(facts, filters());
  const c = r.insights!.cycle;
  const phase = (g: typeof c.natural, id: string) => g.phases.find((x) => x.phase === id)!.row.data!;

  it('so entra quem registrou; o relato do dia 2 cai na fase menstrual e o do aluno SEM ciclo nao aparece em fase nenhuma', () => {
    expect(c.participantsWithCycle).toBe(1);
    const m = phase(c.natural, 'menstruacao');
    expect(m.relatar).toMatchObject({ reports: 1, meanNote: 7, notePoints: 7 });
    expect(c.natural.phases.reduce((n, x) => n + (x.row.data?.relatar.reports ?? 0), 0)).toBe(1);
    expect(c.hormonal.phases.every((x) => (x.row.data?.relatar.reports ?? 0) === 0)).toBe(true);
  });
  it('treinos, dor do feedback, km e km por semana por fase', () => {
    const m = phase(c.natural, 'menstruacao');
    expect(m).toMatchObject({ runs: 2, runKm: 16, avgKmPerRun: 8 }); // 03/08 e 31/08 (dia 0 de cada ciclo)
    expect(m.trainings).toBe(3); // 2 corridas + a musculacao do dia 05/08
    expect(m.pain).toMatchObject({ painTrainings: 1, painPer100Trainings: 33.33, levelPoints: 2 });
    expect(m.kmPerParticipantWeek).toBeGreaterThan(0);
    expect(m.relatar.reportsPer100Km).toBe(6.25); // 1 relato / 16 km x 100
    expect(m.relatar.reportsPer100Trainings).toBe(33.33);
  });
  it('adesao por fase (geral e por tipo); treino programado de hoje em diante nao entra', () => {
    const m = phase(c.natural, 'menstruacao');
    expect(m.adherence.all).toEqual({ scheduled: 2, registered: 1, ratePct: 50 });
    expect(m.adherence.bySegment.corrida).toEqual({ scheduled: 1, registered: 1, ratePct: 100 });
    expect(m.adherence.bySegment.musculacao).toEqual({ scheduled: 1, registered: 0, ratePct: 0 });
    const total = c.natural.phases.reduce((n, x) => n + (x.row.data?.adherence.all.scheduled ?? 0), 0);
    expect(total).toBe(3); // o programado de 27/10 (depois de hoje) ficou fora
  });
  it('local x fase e grupo hormonal separado', () => {
    const joelho = c.natural.locations.find((x) => x.key === 'joelho')!;
    expect(joelho.cells.menstruacao).toMatchObject({ reports: 1, meanNote: 7, reportsPer100Trainings: 33.33 });
    expect(joelho.cells.lutea).toMatchObject({ reports: 0 });
    const h = computeObservatory({ ...facts, participants: [{ ...participants[0], cycle: { cycles, hormonal: true } }, participants[1]] }, filters()).insights!.cycle;
    expect(h.natural.phases.reduce((n, x) => n + (x.row.data?.relatar.reports ?? 0), 0)).toBe(0);
    expect(h.hormonal.phases.reduce((n, x) => n + (x.row.data?.relatar.reports ?? 0), 0)).toBe(1);
  });
  it('privacidade: a resposta nao carrega ciclos nem datas de ciclo', () => {
    expect(JSON.stringify(r)).not.toMatch(/"participant"|userId|birthDate|"cycles"|cycleStart|"start"/);
  });
});
