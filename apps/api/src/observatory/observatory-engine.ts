import { formatPace, round2 } from '../equipment/equipment-core';
import {
  AGE_BANDS, BASELINE_WEEKS, MAX_COHORT_WEEKS, PRIOR_DAYS, SEX_LABEL, STRENGTH_BANDS, UNKNOWN, VOLUME_BANDS,
  addDays, ageAt, classify, collapseSmall, daysBetween, normalizeSex, painMetrics, pooledPaceOf, protect, quantile, weekStartOf, type Band, type Cell,
} from './observatory-core';
import type { ObsFacts, ObsFilters, ObsGroupBy, ObsRow, ObsRunEvent, PainMetrics } from './observatory.types';

// Observatorio Panzeri Run (24/10/2026) — MOTOR DESCRITIVO sobre fatos ja deduplicados. Tudo em memoria, sobre lotes; nenhuma consulta por aluno. Devolve so' agregados protegidos.
// Unidades: participante-semana (volume), treino (dor), evento (pace). Cada tabela diz o seu denominador. Celulas pequenas sao AGRUPADAS ("Demais grupos") em vez de apenas escondidas.

interface PW {
  p: string; week: string; km: number; events: ObsRunEvent[]; strength: number;
  complete: boolean; noData: boolean; vol: Band | null; age: string; sex: string; strengthBand: string;
}

export const PENDING_DIMENSIONS = [
  { id: 'sleep', label: 'Sono', reason: 'Fonte e cobertura ainda não integradas ao Observatório (dados de sono ficam por instrumento e origem).' },
  { id: 'stress', label: 'Estresse', reason: 'Check-in diário disponível, mas ainda sem integração ao Observatório.' },
  { id: 'fatigue', label: 'Fadiga', reason: 'Escalas por instrumento a harmonizar antes de agregar.' },
  { id: 'recovery', label: 'Percepção de recuperação', reason: 'Sem escala única diária; depende de definição por instrumento.' },
  { id: 'effort', label: 'Esforço percebido', reason: 'Disponível por treino, ainda sem integração ao Observatório.' },
  { id: 'experience', label: 'Experiência na corrida', reason: 'Categorias atuais são grossas demais para faixas por anos; precisa de nova coleta.' },
  { id: 'otherModalities', label: 'Outras modalidades (ciclismo, CrossFit)', reason: 'Taxonomia de modalidades ainda não ampliada; hoje só corrida e força.' },
];

type PaceCell = { pace: { secondsPerKm: number; label: string } | null; paceEvents: number; km: number; participantsWithPace: number | null; participantPace: { p25: string | null; median: string | null; p75: string | null } };

export interface ObservatoryResult {
  dataset: 'real' | 'synthetic';
  dataAsOf: string;
  period: { from: string; to: string };
  mode: 'cross' | 'cohort';
  minParticipants: number;
  overview: {
    participants: number | null; participantWeeks: number | null; trainings: number | null; km: number | null; belowMinimum: boolean;
    weeks: { complete: number; incomplete: number; noData: number };
  };
  volume: { rows: Array<ObsRow<{ participantWeeks: number; km: number; pctOfWeeks: number; avgKmPerWeek: number | null }>>; total: { participantWeeks: number; participants: number; km: number } | null };
  pace: {
    cross: Array<ObsRow<PaceCell>>;
    cohort: {
      baselineWeeks: number; maxWeeks: number; eligibleParticipants: number | null; note: string;
      groups: Array<ObsRow<{
        baselinePace: { secondsPerKm: number; label: string } | null; baselineAvgKm: number | null;
        series: Array<{ relativeWeek: number; participants: number | null; avgKm: number | null; paceSecondsPerKm: number | null; paceLabel: string | null; suppressed: boolean }>;
        paceChange: { participants: number | null; medianDeltaSecPerKm: number | null; p25: number | null; p75: number | null } | null;
      }>>;
    };
  };
  pain: {
    overall: PainMetrics | null;
    groupBy: ObsGroupBy;
    groupLabel: string;
    rows: Array<ObsRow<PainMetrics>>;
    prior: { volume: Array<ObsRow<PainMetrics>>; strength: Array<ObsRow<PainMetrics>> };
    pendingDimensions: typeof PENDING_DIMENSIONS;
  };
  quality: ObsFacts['quality'] & {
    eligibleTrainings: number; trainingsWithoutDistance: number; manualTrainings: number; activityTrainings: number;
    participantWeeksIncomplete: number; participantWeeksNoData: number; participantsExcludedByFilters: number | null;
    note: string;
  };
}

const cellsOf = <I extends { p?: string; participant?: string }>(groups: Array<{ key: string; label: string }>, bucket: (id: string) => I[]): Array<Cell<I>> =>
  groups.map((g) => { const items = bucket(g.key); return { key: g.key, label: g.label, people: new Set(items.map((i) => (i.p ?? i.participant) as string)), items }; });

export function computeObservatory(facts: ObsFacts, f: ObsFilters): ObservatoryResult {
  const min = f.minParticipants;
  const participants = new Map(facts.participants.map((p) => [p.key, p]));
  const runsBy = new Map<string, ObsRunEvent[]>();
  for (const e of facts.runEvents) { const list = runsBy.get(e.participant) ?? []; list.push(e); runsBy.set(e.participant, list); }
  for (const list of runsBy.values()) list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const strengthBy = new Map<string, string[]>();
  for (const s of facts.strengthEvents) { const list = strengthBy.get(s.participant) ?? []; list.push(s.day); strengthBy.set(s.participant, list); }

  // ── participante-semana (semanas segunda a domingo; so' semanas inteiras dentro do periodo e ja' encerradas contam como completas) ──
  const yesterday = addDays(f.today, -1);
  const pws: PW[] = [];
  for (const [key, events] of runsBy) {
    const person = participants.get(key);
    if (!person) continue;
    const weeks = new Map<string, ObsRunEvent[]>();
    for (const e of events) { if (e.day < f.from || e.day > f.to) continue; const w = weekStartOf(e.day); const list = weeks.get(w) ?? []; list.push(e); weeks.set(w, list); }
    const strengthDays = strengthBy.get(key) ?? [];
    const firstWeek = weekStartOf(events[0].day);
    const lastWeek = weekStartOf(events[events.length - 1].day);
    // semanas sem evento entre a primeira e a ultima do participante: "sem dados suficientes" (nao sabemos se foi descanso ou falta de sincronizacao)
    for (let w = weekStartOf(f.from); w <= weekStartOf(f.to); w = addDays(w, 7)) if (w >= firstWeek && w <= lastWeek && !weeks.has(w)) weeks.set(w, []);
    for (const [week, list] of weeks) {
      const weekEnd = addDays(week, 6);
      const complete = week >= f.from && weekEnd <= f.to && weekEnd <= yesterday;
      const km = round2(list.reduce((s, e) => s + (e.km ?? 0), 0)); // arredonda antes de classificar (soma de floats nao pode empurrar para a faixa errada)
      const strength = strengthDays.filter((d) => d >= week && d <= weekEnd && d >= f.from && d <= f.to).length;
      const age = ageAt(person.birthDate, weekEnd);
      pws.push({
        p: key, week, km, events: list, strength, complete, noData: list.length === 0,
        vol: classify(km, VOLUME_BANDS), age: age == null ? UNKNOWN.id : classify(age, AGE_BANDS)?.id ?? UNKNOWN.id, sex: normalizeSex(person.sex),
        strengthBand: classify(strength, STRENGTH_BANDS)?.id ?? 's0',
      });
    }
  }
  const incomplete = pws.filter((w) => !w.complete);
  const noData = pws.filter((w) => w.complete && w.noData);
  const passesFilters = (w: PW) =>
    (f.volumeBands.length === 0 || (w.vol != null && f.volumeBands.includes(w.vol.id))) &&
    (f.ageBands.length === 0 || f.ageBands.includes(w.age)) &&
    (f.strengthBands.length === 0 || f.strengthBands.includes(w.strengthBand)) &&
    (f.sexes.length === 0 || f.sexes.includes(w.sex));
  const included = pws.filter((w) => w.complete && (!w.noData || f.includeZeroWeeks) && passesFilters(w));
  const includedParticipants = new Set(included.map((w) => w.p));
  const belowMinimum = includedParticipants.size < min;
  const allEvents = included.flatMap((w) => w.events);
  // Dor/1.000 km: so' treino com distancia valida (numerador e denominador do mesmo conjunto de treinos).
  const painEvents = (list: ObsRunEvent[]) => list.filter((e) => e.km != null && e.km > 0);

  // ── volume semanal (celulas pequenas agrupadas) ──
  const volume = collapseSmall(
    cellsOf(VOLUME_BANDS.map((b) => ({ key: b.id, label: b.label })), (id) => included.filter((w) => w.vol?.id === id)),
    (items: PW[]) => { const km = items.reduce((s, w) => s + w.km, 0); return { participantWeeks: items.length, km: round2(km), pctOfWeeks: included.length > 0 ? round2((items.length / included.length) * 100) : 0, avgKmPerWeek: items.length > 0 ? round2(km / items.length) : null }; },
    min,
  );

  // ── pace transversal: por faixa de volume da semana (pace so' aparece com >= min participantes COM pace) ──
  const fmt = (v: number | null) => (v == null ? null : formatPace(Math.round(v)));
  const pace = collapseSmall(
    cellsOf(VOLUME_BANDS.map((b) => ({ key: b.id, label: b.label })), (id) => included.filter((w) => w.vol?.id === id)),
    (items: PW[]): PaceCell => {
      const byP = new Map<string, ObsRunEvent[]>();
      for (const w of items) byP.set(w.p, [...(byP.get(w.p) ?? []), ...w.events]);
      const partPaces = [...byP.values()].map((list) => pooledPaceOf(list)?.secondsPerKm).filter((v): v is number => v != null).sort((a, b) => a - b);
      const enough = partPaces.length >= min;
      const pooled = enough ? pooledPaceOf(items.flatMap((w) => w.events)) : null;
      return {
        pace: pooled ? { secondsPerKm: pooled.secondsPerKm, label: pooled.label } : null, paceEvents: pooled?.events ?? 0, km: pooled?.km ?? 0,
        participantsWithPace: enough ? partPaces.length : partPaces.length > 0 ? null : 0,
        participantPace: enough ? { p25: fmt(quantile(partPaces, 0.25)), median: fmt(quantile(partPaces, 0.5)), p75: fmt(quantile(partPaces, 0.75)) } : { p25: null, median: null, p75: null },
      };
    },
    min,
  );

  // ── grupo fixo (coorte): classificada pelas primeiras 8 semanas completas e elegiveis; nunca reclassificada ──
  const cohort = computeCohort(pws, participants, f);

  // ── dor ──
  const priorCtx = new Map<string, { vol: string; strength: string }>();
  const context = (e: ObsRunEvent) => {
    if (!priorCtx.has(e.eventKey)) priorCtx.set(e.eventKey, priorExposure(e, runsBy.get(e.participant) ?? [], strengthBy.get(e.participant) ?? []));
    return priorCtx.get(e.eventKey)!;
  };
  const dim = (by: ObsGroupBy): { groups: Array<{ id: string; label: string }>; pick: (w: PW, e: ObsRunEvent) => string } => {
    switch (by) {
      case 'age': return { groups: [...AGE_BANDS, UNKNOWN].map((b) => ({ id: b.id, label: b.label })), pick: (w) => w.age };
      case 'strength': return { groups: STRENGTH_BANDS.map((b) => ({ id: b.id, label: b.label })), pick: (w) => w.strengthBand };
      case 'sex': return { groups: ['F', 'M', 'other', 'unknown'].map((id) => ({ id, label: SEX_LABEL[id] })), pick: (w) => w.sex };
      case 'priorVolume': return { groups: [...VOLUME_BANDS.map((b) => ({ id: b.id, label: b.label })), { id: 'insufficient', label: 'Histórico anterior insuficiente (< 28 dias)' }], pick: (_w, e) => context(e).vol };
      case 'priorStrength': return { groups: [...STRENGTH_BANDS.map((b) => ({ id: b.id, label: b.label })), { id: 'insufficient', label: 'Histórico anterior insuficiente (< 28 dias)' }], pick: (_w, e) => context(e).strength };
      default: return { groups: VOLUME_BANDS.map((b) => ({ id: b.id, label: b.label })), pick: (w) => w.vol?.id ?? 'none' };
    }
  };
  const painTable = (by: ObsGroupBy) => {
    const d = dim(by);
    const buckets = new Map<string, ObsRunEvent[]>();
    for (const w of included) for (const e of painEvents(w.events)) { const id = d.pick(w, e); const list = buckets.get(id) ?? []; list.push(e); buckets.set(id, list); }
    return collapseSmall(cellsOf(d.groups.map((g) => ({ key: g.id, label: g.label })), (id) => buckets.get(id) ?? []), (items: ObsRunEvent[]) => painMetrics(items), min).rows;
  };
  const groupLabels: Record<ObsGroupBy, string> = { volume: 'Faixa de volume semanal', age: 'Faixa etária', strength: 'Sessões de força na semana', sex: 'Sexo', priorVolume: 'Volume semanal médio dos 28 dias anteriores', priorStrength: 'Força semanal média dos 28 dias anteriores' };

  const totalKm = round2(allEvents.reduce((s, e) => s + (e.km ?? 0), 0));
  const excluded = new Set(pws.filter((w) => w.complete).map((w) => w.p)).size - includedParticipants.size;
  return {
    dataset: facts.dataset,
    dataAsOf: facts.dataAsOf,
    period: { from: f.from, to: f.to },
    mode: f.mode,
    minParticipants: min,
    overview: {
      participants: belowMinimum ? null : includedParticipants.size, participantWeeks: belowMinimum ? null : included.length, trainings: belowMinimum ? null : allEvents.length, km: belowMinimum ? null : totalKm, belowMinimum,
      weeks: { complete: included.length, incomplete: incomplete.length, noData: noData.length },
    },
    volume: { rows: volume.rows, total: volume.totalAllowed && !belowMinimum ? { participantWeeks: included.length, participants: includedParticipants.size, km: totalKm } : null },
    pace: { cross: pace.rows, cohort },
    pain: {
      overall: belowMinimum ? null : painMetrics(painEvents(allEvents)),
      groupBy: f.groupBy,
      groupLabel: groupLabels[f.groupBy],
      rows: painTable(f.groupBy),
      prior: { volume: painTable('priorVolume'), strength: painTable('priorStrength') },
      pendingDimensions: PENDING_DIMENSIONS,
    },
    quality: {
      ...facts.quality,
      eligibleTrainings: facts.runEvents.length,
      trainingsWithoutDistance: facts.runEvents.filter((e) => e.km == null).length,
      manualTrainings: facts.runEvents.filter((e) => e.source === 'manual').length,
      activityTrainings: facts.runEvents.filter((e) => e.source === 'activity').length,
      participantWeeksIncomplete: incomplete.length,
      participantWeeksNoData: noData.length,
      participantsExcludedByFilters: excluded === 0 || excluded >= min ? excluded : null, // complemento de 1 a 4 pessoas nao e' divulgado
      note: 'Semanas sem nenhum treino registrado entre duas semanas com treino ficam fora ("sem dados suficientes"): não dá para saber se foi descanso ou falta de sincronização. Ausência de registro não é ausência de atividade. Treinos manuais usam a data informada no registro. Treino sem distância válida conta como treino, mas fica fora das taxas por 1.000 km.',
    },
  };
}

// Exposicao ANTERIOR ao treino (so' dados anteriores ao dia do treino; nunca informacao posterior): km semanal medio e sessoes de forca por semana nos 28 dias anteriores.
function priorExposure(event: ObsRunEvent, runs: ObsRunEvent[], strengthDays: string[]): { vol: string; strength: string } {
  const start = addDays(event.day, -PRIOR_DAYS);
  const first = runs[0]?.day;
  const strengthFirst = strengthDays.length > 0 ? strengthDays.reduce((a, b) => (a < b ? a : b)) : undefined;
  const earliest = [first, strengthFirst].filter(Boolean).sort()[0];
  if (!earliest || earliest > start) return { vol: 'insufficient', strength: 'insufficient' };
  const km = runs.filter((e) => e.day >= start && e.day < event.day).reduce((s, e) => s + (e.km ?? 0), 0);
  const sessions = strengthDays.filter((d) => d >= start && d < event.day).length;
  return { vol: classify(round2(km / (PRIOR_DAYS / 7)), VOLUME_BANDS)?.id ?? 'v1', strength: classify(sessions / (PRIOR_DAYS / 7), STRENGTH_BANDS)?.id ?? 's0' };
}

function computeCohort(pws: PW[], participants: Map<string, { birthDate: string | null; sex: string | null }>, f: ObsFilters): ObservatoryResult['pace']['cohort'] {
  const min = f.minParticipants;
  const byP = new Map<string, PW[]>();
  for (const w of pws) { if (!w.complete || w.noData) continue; const list = byP.get(w.p) ?? []; list.push(w); byP.set(w.p, list); }
  type Member = { p: string; baselineKm: number; baselineEvents: ObsRunEvent[]; follow: PW[]; baselineEnd: string };
  const groups = new Map<string, Member[]>();
  let eligible = 0;
  for (const [p, list] of byP) {
    list.sort((a, b) => (a.week < b.week ? -1 : 1));
    if (list.length < BASELINE_WEEKS) continue;
    const person = participants.get(p);
    const sample = list[0];
    if (f.ageBands.length > 0 && !f.ageBands.includes(sample.age)) continue;
    if (f.sexes.length > 0 && !f.sexes.includes(normalizeSex(person?.sex))) continue;
    const base = list.slice(0, BASELINE_WEEKS);
    const baselineKm = base.reduce((s, w) => s + w.km, 0) / BASELINE_WEEKS;
    const vb = classify(round2(baselineKm), VOLUME_BANDS);
    if (!vb || (f.volumeBands.length > 0 && !f.volumeBands.includes(vb.id))) continue;
    eligible += 1;
    const g = groups.get(vb.id) ?? [];
    g.push({ p, baselineKm, baselineEvents: base.flatMap((w) => w.events), follow: list.slice(BASELINE_WEEKS), baselineEnd: base[base.length - 1].week });
    groups.set(vb.id, g);
  }
  const rows = VOLUME_BANDS.map((b) => {
    const members = groups.get(b.id) ?? [];
    const withBasePace = members.filter((m) => pooledPaceOf(m.baselineEvents)).length;
    const baselinePace = withBasePace >= min ? pooledPaceOf(members.flatMap((m) => m.baselineEvents)) : null;
    const series: Array<{ relativeWeek: number; participants: number | null; avgKm: number | null; paceSecondsPerKm: number | null; paceLabel: string | null; suppressed: boolean }> = [];
    for (let rel = 1; rel <= MAX_COHORT_WEEKS; rel += 1) {
      const points = members.map((m) => ({ m, w: m.follow.find((x) => daysBetween(m.baselineEnd, x.week) / 7 === rel) })).filter((x) => x.w);
      if (points.length === 0) continue;
      if (points.length < min) { series.push({ relativeWeek: rel, participants: null, avgKm: null, paceSecondsPerKm: null, paceLabel: null, suppressed: true }); continue; }
      const withPace = points.filter((x) => pooledPaceOf(x.w!.events)).length;
      const pace = withPace >= min ? pooledPaceOf(points.flatMap((x) => x.w!.events)) : null; // pace so' com >= min pessoas COM pace no ponto
      series.push({ relativeWeek: rel, participants: points.length, avgKm: round2(points.reduce((s, x) => s + x.w!.km, 0) / points.length), paceSecondsPerKm: pace?.secondsPerKm ?? null, paceLabel: pace?.label ?? null, suppressed: false });
    }
    // variacao individual de pace: pace agregado das primeiras 8 semanas contra as 8 primeiras semanas seguintes (pessoas com as duas medidas)
    const deltas: number[] = [];
    for (const m of members) {
      const bp = pooledPaceOf(m.baselineEvents);
      const fp = pooledPaceOf(m.follow.filter((w) => daysBetween(m.baselineEnd, w.week) / 7 <= BASELINE_WEEKS).flatMap((w) => w.events));
      if (bp && fp) deltas.push(fp.secondsPerKm - bp.secondsPerKm);
    }
    deltas.sort((a, b) => a - b);
    const paceChange = deltas.length === 0 ? null : deltas.length < min ? { participants: null, medianDeltaSecPerKm: null, p25: null, p75: null } : { participants: deltas.length, medianDeltaSecPerKm: Math.round(quantile(deltas, 0.5)!), p25: Math.round(quantile(deltas, 0.25)!), p75: Math.round(quantile(deltas, 0.75)!) };
    return { key: b.id, label: b.label, participants: members.length, data: { baselinePace: baselinePace ? { secondsPerKm: baselinePace.secondsPerKm, label: baselinePace.label } : null, baselineAvgKm: members.length > 0 ? round2(members.reduce((s, m) => s + m.baselineKm, 0) / members.length) : null, series, paceChange } };
  });
  return {
    baselineWeeks: BASELINE_WEEKS,
    maxWeeks: MAX_COHORT_WEEKS,
    eligibleParticipants: eligible >= min ? eligible : null,
    note: 'O grupo fixo é definido DENTRO do período escolhido (as 8 primeiras semanas completas de cada pessoa nesse período) e depois não muda. Mudar a data inicial muda quem entra em cada grupo: para acompanhar a evolução ao longo do tempo, mantenha a data inicial fixa. Semanas sem treino registrado ficam fora da linha de base. O filtro de força não se aplica ao grupo fixo.',
    groups: protect(rows, min).rows,
  };
}
