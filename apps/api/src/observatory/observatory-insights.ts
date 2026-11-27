import { round2 } from '../equipment/equipment-core';
import { PHASE_IDS, PHASE_LABEL, phaseOfDate, type PhaseId } from '../menstrual-cycle/cycle-phases';
import {
  DISTANCE_BANDS, ELIGIBILITY_MIN_WEEKS, ELIGIBILITY_WEEKS, WEEKLY_ELIGIBILITY_BANDS, addDays, classify, painLevelMetrics, pooledPaceOf, protect, reportMetrics, weekStartOf,
  type PainLevelMetrics, type ReportMetrics,
} from './observatory-core';
import { REGION_GROUP_LABEL } from './observatory-facts';
import type { ObsFacts, ObsFilters, ObsParticipant, ObsPainReport, ObsRow, ObsScheduled, ObsTraining, TrainingSegment } from './observatory.types';

// Observatorio Panzeri Run — ANALISE AMPLIADA (26/11/2026, ordem de Elton). Funcoes puras sobre os fatos ja' deduplicados; so' agregados protegidos, nunca nome, e-mail ou id.
// REGRAS DE LEITURA (valem para tudo aqui):
//  - Dor do TREINO = feedback do treino (sem dor, leve, moderada, forte). A "intensidade" do feedback usa a escala 0-3 da Evolucao (leve 1, moderada 2, forte 3); NUNCA e' nota 1-10.
//  - "Relatar dor" (nota 1-10 + local) e' analisado A PARTE e NUNCA e' ligado a um treino. Quando aparece "por 100 treinos de X" ou "por 1.000 km", e' TAXA DE EXPOSICAO (relatos do periodo
//    divididos pelo volume de X no mesmo periodo): nao diz que o relato veio de X.
//  - Estatistica descritiva: associacao nao e' causa; fase do ciclo e' estimativa a partir do que a aluna registrou.

export const SEGMENT_IDS: TrainingSegment[] = ['corrida', 'extra_corrida', 'fortalecimento', 'musculacao', 'extra_geral', 'outras'];
export const SEGMENT_LABEL: Record<TrainingSegment, string> = {
  corrida: 'Corrida (prescrita)', extra_corrida: 'Corrida extra', fortalecimento: 'Fortalecimento para corredores', musculacao: 'Musculação', extra_geral: 'Extras de outras modalidades', outras: 'Outras modalidades (prescritas)',
};
const RUN_SEGMENTS = new Set<TrainingSegment>(['corrida', 'extra_corrida']);

type Pace = { label: string; secondsPerKm: number; runs: number } | null;
export interface RelatarExposure {
  reports: number; meanNote: number | null; notePoints: number;
  reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null;
  reportsPer1000Km: number | null; notePointsPer1000Km: number | null; // so' faz sentido com km de corrida
}
export interface SegmentRow extends PainLevelMetrics { relatar: RelatarExposure }
export interface DistanceRow { runs: number; extraRuns: number; km: number; participants: number; pace: Pace; participantsWithPace: number | null; pain: PainLevelMetrics }
export interface LocationRow {
  reports: number; participants: number; meanNote: number | null; notePoints: number;
  reportsPer1000RunKm: number | null; notePointsPer1000RunKm: number | null; reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null;
}
export interface AdherenceCell { scheduled: number; registered: number; ratePct: number | null }
export interface CycleRow {
  participants: number; participantDays: number;
  trainings: number; runs: number; runKm: number; avgKmPerRun: number | null; kmPerParticipantWeek: number | null;
  pain: PainLevelMetrics; runPace: Pace; participantsWithPace: number | null;
  relatar: { reports: number; meanNote: number | null; notePoints: number; reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null; reportsPer100Km: number | null; notePointsPer100Km: number | null };
  adherence: { all: AdherenceCell; bySegment: Partial<Record<TrainingSegment, AdherenceCell>> };
}
export interface CycleLocationCell { reports: number; meanNote: number | null; reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null }
export interface CycleGroup {
  phases: Array<{ phase: PhaseId; label: string; row: ObsRow<CycleRow> }>;
  locations: Array<{ key: string; label: string; suppressed: boolean; cells: Record<PhaseId, CycleLocationCell | null> }>;
}

// Evolucao semanal (semanas de segunda a domingo dentro do periodo escolhido). Ponto com menos de `minParticipants` pessoas fica suprimido (lacuna, nunca zero).
export interface WeeklyPoint {
  week: string; weekNumber: number; suppressed: boolean;
  trainings: number | null; painTrainings: number | null; painPer100: number | null; levelPointsPer100: number | null; meanLevelAmongPain: number | null;
  km: number | null; painPer1000Km: number | null; levelPointsPer1000Km: number | null;
}
export interface WeeklyRelatarPoint {
  week: string; weekNumber: number; suppressed: boolean;
  reports: number | null; meanNote: number | null; notePoints: number | null; reportsPer100Trainings: number | null; reportsPer1000Km: number | null; notePointsPer1000Km: number | null;
}
export interface WeeklySeries {
  segments: Array<{ key: string; label: string; points: WeeklyPoint[] }>; // 'total', 'corridas' (prescrita + extra) e cada tipo de treino
  relatar: WeeklyRelatarPoint[];
}

export interface Insights {
  scopeNote: string;
  weekly: WeeklySeries;
  segments: { rows: Array<ObsRow<SegmentRow>>; runsCombined: SegmentRow | null; total: SegmentRow | null };
  runsByDistance: { rows: Array<ObsRow<DistanceRow>>; runsWithoutDistance: number };
  weeklyVolume: { weeks: { from: string; to: string }; minWeeks: number; studentsWithRuns: number | null; rows: Array<ObsRow<{ students: number }>>; note: string };
  standalone: {
    note: string;
    overall: ReportMetrics | null;
    runKm: number;
    reportsPer1000RunKm: number | null;
    notePointsPer1000RunKm: number | null;
    locations: Array<ObsRow<LocationRow>>;
    sides: Array<ObsRow<{ reports: number; meanNote: number | null }>>;
    // local x tipo de treino: taxa de exposicao (relatos do local / 100 treinos do tipo), nao atribuicao.
    locationBySegment: Array<{ key: string; label: string; suppressed: boolean; cells: Partial<Record<TrainingSegment, { reportsPer100: number | null; notePointsPer100: number | null }>> }>;
  };
  cycle: {
    notes: string[];
    participantsWithCycle: number;
    participantsWithEstimatedPhases: number;
    trainingsOutsideCycle: number;
    natural: CycleGroup;
    hormonal: CycleGroup;
  };
}

const people = (items: Array<{ participant: string }>) => new Set(items.map((i) => i.participant)).size;
const per = (count: number, base: number, factor: number) => (base > 0 ? round2((count / base) * factor) : null);
const segmentOf = (t: ObsTraining): TrainingSegment => t.segment ?? (t.group === 'corrida' ? 'corrida' : t.group === 'forca' ? 'musculacao' : 'outras');
const regionLabel = (key: string) => REGION_GROUP_LABEL[key] ?? key;
const sideLabel = (key: string) => { const [g, side] = key.split(':'); return `${regionLabel(g)} · ${side}`; };

function paceOf(items: Array<{ km: number | null; seconds: number | null; participant: string }>, min: number): { pace: Pace; participantsWithPace: number | null } {
  const byP = new Map<string, Array<{ km: number | null; seconds: number | null }>>();
  for (const i of items) byP.set(i.participant, [...(byP.get(i.participant) ?? []), i]);
  const withPace = [...byP.values()].filter((list) => pooledPaceOf(list) != null).length;
  if (withPace < min) return { pace: null, participantsWithPace: withPace > 0 ? null : 0 }; // pace de menos de `min` pessoas nao e' divulgado
  const pooled = pooledPaceOf(items);
  return { pace: pooled ? { label: pooled.label, secondsPerKm: pooled.secondsPerKm, runs: pooled.events } : null, participantsWithPace: withPace };
}
const adherenceOf = (items: ObsScheduled[]): AdherenceCell => {
  const registered = items.filter((s) => s.registered).length;
  return { scheduled: items.length, registered, ratePct: per(registered, items.length, 100) };
};

export function computeInsights(input: { facts: ObsFacts; scope: Set<string>; runKeys: Set<string>; runKm: number; filters: ObsFilters; participants: Map<string, ObsParticipant> }): Insights {
  const { facts, scope, runKeys, filters: f, participants } = input;
  const min = f.minParticipants;
  const inPeriod = (day: string) => day >= f.from && day <= f.to;
  // Corrida (prescrita e extra): exatamente os treinos das semanas incluidas (mesma base do restante da tela). Demais modalidades: participantes do escopo, dentro do periodo.
  const trainings: ObsTraining[] = (facts.trainings ?? []).filter((t) => (t.group === 'corrida' ? runKeys.has(t.eventKey) : scope.has(t.participant) && inPeriod(t.day)));
  const reports: ObsPainReport[] = (facts.painReports ?? []).filter((r) => scope.has(r.participant) && inPeriod(r.day));
  const runKm = round2(input.runKm);
  const reportTotals = reportMetrics(reports);

  // ───────── 1) tipos de treino ─────────
  const relatarFor = (items: ObsTraining[], withKm: boolean): RelatarExposure => {
    const km = painLevelMetrics(items).km;
    return {
      reports: reports.length, meanNote: reportTotals.meanIntensity, notePoints: reportTotals.notePoints,
      reportsPer100Trainings: per(reports.length, items.length, 100), notePointsPer100Trainings: per(reportTotals.notePoints, items.length, 100),
      reportsPer1000Km: withKm ? per(reports.length, km, 1000) : null, notePointsPer1000Km: withKm ? per(reportTotals.notePoints, km, 1000) : null,
    };
  };
  const segmentData = (items: ObsTraining[], withKm: boolean): SegmentRow => ({ ...painLevelMetrics(items), relatar: relatarFor(items, withKm) });
  const segmentRows = protect(
    SEGMENT_IDS.map((id) => { const items = trainings.filter((t) => segmentOf(t) === id); return { key: id, label: SEGMENT_LABEL[id], participants: people(items), data: segmentData(items, RUN_SEGMENTS.has(id)) }; }),
    min,
  );

  // ───────── 2) corridas por faixa de distancia ─────────
  const runs = trainings.filter((t) => RUN_SEGMENTS.has(segmentOf(t)));
  const runsWithKm = runs.filter((t) => t.km != null && t.km > 0);
  const distanceRows = protect(
    DISTANCE_BANDS.map((band) => {
      const items = runsWithKm.filter((t) => classify(t.km, [band]) !== null);
      const { pace, participantsWithPace } = paceOf(items, min);
      return { key: band.id, label: band.label, participants: people(items), data: { runs: items.length, extraRuns: items.filter((t) => segmentOf(t) === 'extra_corrida').length, km: round2(items.reduce((s, t) => s + (t.km ?? 0), 0)), participants: people(items), pace, participantsWithPace, pain: painLevelMetrics(items) } };
    }),
    min,
  );

  // ───────── 3) alunas por volume semanal (ultimas 10 semanas, sem a atual) ─────────
  const currentWeek = weekStartOf(f.today);
  const weeks = Array.from({ length: ELIGIBILITY_WEEKS }, (_, i) => addDays(currentWeek, -7 * (ELIGIBILITY_WEEKS - i)));
  const weekSet = new Set(weeks);
  const kmByPersonWeek = new Map<string, Map<string, number>>();
  for (const e of facts.runEvents) {
    const w = weekStartOf(e.day);
    if (!weekSet.has(w)) continue;
    const m = kmByPersonWeek.get(e.participant) ?? new Map<string, number>();
    m.set(w, (m.get(w) ?? 0) + (e.km ?? 0));
    kmByPersonWeek.set(e.participant, m);
  }
  const bandCount = new Map<string, number>();
  for (const perWeek of kmByPersonWeek.values()) {
    // maior faixa em que correu pelo menos o piso em >= 7 das 10 semanas; quem e' elegivel a uma faixa maior nunca entra na menor
    let chosen = WEEKLY_ELIGIBILITY_BANDS[0];
    for (const band of WEEKLY_ELIGIBILITY_BANDS) {
      if (band.floor === 0) continue;
      const hits = weeks.filter((w) => round2(perWeek.get(w) ?? 0) >= band.floor).length;
      if (hits >= ELIGIBILITY_MIN_WEEKS) chosen = band;
    }
    bandCount.set(chosen.id, (bandCount.get(chosen.id) ?? 0) + 1);
  }
  const volumeRows = protect(WEEKLY_ELIGIBILITY_BANDS.map((band) => ({ key: band.id, label: band.label, participants: bandCount.get(band.id) ?? 0, data: { students: bandCount.get(band.id) ?? 0 } })), min);
  const studentsWithRuns = kmByPersonWeek.size;

  // ───────── 4) "Relatar dor", a parte ─────────
  const byRegion = new Map<string, ObsPainReport[]>();
  const bySide = new Map<string, ObsPainReport[]>();
  for (const r of reports) {
    for (const region of r.regions.length > 0 ? r.regions : ['nao_informado']) byRegion.set(region, [...(byRegion.get(region) ?? []), r]);
    for (const side of r.regionSides ?? []) bySide.set(side, [...(bySide.get(side) ?? []), r]);
  }
  const locRows = [...byRegion.entries()].sort((a, b) => b[1].length - a[1].length);
  const locationRows = protect(
    locRows.map(([key, list]) => {
      const m = reportMetrics(list);
      const data: LocationRow = {
        reports: list.length, participants: m.participants, meanNote: m.meanIntensity, notePoints: m.notePoints,
        reportsPer1000RunKm: per(list.length, runKm, 1000), notePointsPer1000RunKm: per(m.notePoints, runKm, 1000),
        reportsPer100Trainings: per(list.length, trainings.length, 100), notePointsPer100Trainings: per(m.notePoints, trainings.length, 100),
      };
      return { key, label: regionLabel(key), participants: m.participants, data };
    }),
    min,
  );
  const sideRows = protect([...bySide.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => ({ key, label: sideLabel(key), participants: people(list), data: { reports: list.length, meanNote: reportMetrics(list).meanIntensity } })), min);
  const trainingsBySegment = new Map<TrainingSegment, ObsTraining[]>(SEGMENT_IDS.map((id) => [id, trainings.filter((t) => segmentOf(t) === id)]));
  const locationBySegment = locRows.map(([key, list], i) => {
    const suppressed = locationRows.rows[i].suppressed;
    const m = reportMetrics(list);
    const cells: Partial<Record<TrainingSegment, { reportsPer100: number | null; notePointsPer100: number | null }>> = {};
    if (!suppressed) for (const id of SEGMENT_IDS) { const n = trainingsBySegment.get(id)!.length; cells[id] = { reportsPer100: per(list.length, n, 100), notePointsPer100: per(m.notePoints, n, 100) }; }
    return { key, label: regionLabel(key), suppressed, cells };
  });
  const overall = reports.length === 0 || people(reports) >= min ? reportTotals : null;

  // ───────── 5) fases do ciclo ─────────
  const days: string[] = [];
  for (let d = f.from; d <= f.to && d <= f.today; d = addDays(d, 1)) days.push(d);
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  const phaseOf = (participant: string, day: string): PhaseId | null => {
    const cycle = participants.get(participant)?.cycle;
    return cycle ? phaseOfDate(at(day), cycle.cycles)?.phase ?? null : null;
  };
  const withCycle = [...scope].filter((p) => participants.get(p)?.cycle);
  const estimated = withCycle.filter((p) => participants.get(p)!.cycle!.cycles.some((c) => c.lengthSource !== 'observed')).length;
  const phasedTrainings = trainings.map((t) => ({ t, has: Boolean(participants.get(t.participant)?.cycle), phase: phaseOf(t.participant, t.day) }));
  const outside = phasedTrainings.filter((x) => x.has && x.phase == null).length;
  const phasedReports = reports.map((r) => ({ r, phase: phaseOf(r.participant, r.day) }));
  // Adesao: programados ate' ONTEM, dentro do periodo (hoje ainda esta em andamento); registrado = feedback feito/ajustado ou atividade vinculada. Sem registro nao prova que nao fez.
  const phasedScheduled = (facts.scheduled ?? []).filter((s) => scope.has(s.participant) && inPeriod(s.day) && s.day < f.today).map((s) => ({ s, phase: phaseOf(s.participant, s.day) }));
  const exposure = new Map<string, number>(); // `${participant}|${phase}` -> dias
  for (const p of withCycle) for (const day of days) { const ph = phaseOf(p, day); if (ph) exposure.set(`${p}|${ph}`, (exposure.get(`${p}|${ph}`) ?? 0) + 1); }

  const buildGroup = (hormonalGroup: boolean): CycleGroup => {
    const members = withCycle.filter((p) => (participants.get(p)!.cycle!.hormonal === true) === hormonalGroup);
    const memberSet = new Set(members);
    const trainingsIn = (phase: PhaseId) => phasedTrainings.filter((x) => x.phase === phase && memberSet.has(x.t.participant)).map((x) => x.t);
    const reportsIn = (phase: PhaseId) => phasedReports.filter((x) => x.phase === phase && memberSet.has(x.r.participant)).map((x) => x.r);
    const rows = PHASE_IDS.map((phase) => {
      const inPhase = members.filter((p) => (exposure.get(`${p}|${phase}`) ?? 0) > 0);
      const ts = trainingsIn(phase);
      const rs = reportsIn(phase);
      const runItems = ts.filter((t) => RUN_SEGMENTS.has(segmentOf(t)) && t.km != null && t.km > 0);
      const km = round2(runItems.reduce((s, t) => s + (t.km ?? 0), 0));
      const participantDays = inPhase.reduce((s, p) => s + (exposure.get(`${p}|${phase}`) ?? 0), 0);
      const { pace, participantsWithPace } = paceOf(runItems, min);
      const rm = reportMetrics(rs);
      const sched = phasedScheduled.filter((x) => x.phase === phase && memberSet.has(x.s.participant)).map((x) => x.s);
      const bySegment: Partial<Record<TrainingSegment, AdherenceCell>> = {};
      for (const id of ['corrida', 'fortalecimento', 'musculacao', 'outras'] as const) bySegment[id] = adherenceOf(sched.filter((s) => s.segment === id));
      const data: CycleRow = {
        participants: inPhase.length, participantDays, trainings: ts.length, runs: runItems.length, runKm: km,
        avgKmPerRun: runItems.length > 0 ? round2(km / runItems.length) : null, kmPerParticipantWeek: participantDays > 0 ? round2((km / participantDays) * 7) : null,
        pain: painLevelMetrics(ts), runPace: pace, participantsWithPace,
        relatar: {
          reports: rs.length, meanNote: rm.meanIntensity, notePoints: rm.notePoints,
          reportsPer100Trainings: per(rs.length, ts.length, 100), notePointsPer100Trainings: per(rm.notePoints, ts.length, 100), reportsPer100Km: per(rs.length, km, 100), notePointsPer100Km: per(rm.notePoints, km, 100),
        },
        adherence: { all: adherenceOf(sched), bySegment },
      };
      return { key: phase, label: PHASE_LABEL[phase], participants: inPhase.length, data };
    });
    const protectedRows = protect(rows, min).rows;
    // local x fase: relatos do local na fase / 100 treinos da fase (taxa de exposicao), com a nota media
    const regionKeys = [...new Set(phasedReports.filter((x) => x.phase && memberSet.has(x.r.participant)).flatMap((x) => (x.r.regions.length > 0 ? x.r.regions : ['nao_informado'])))];
    const locations = regionKeys.map((key) => {
      const peopleHere = new Set(phasedReports.filter((x) => x.phase && memberSet.has(x.r.participant) && (x.r.regions.length > 0 ? x.r.regions : ['nao_informado']).includes(key)).map((x) => x.r.participant));
      const suppressed = peopleHere.size > 0 && peopleHere.size < min;
      const cells = {} as Record<PhaseId, CycleLocationCell | null>;
      for (const phase of PHASE_IDS) {
        const rs = reportsIn(phase).filter((r) => (r.regions.length > 0 ? r.regions : ['nao_informado']).includes(key));
        const n = trainingsIn(phase).length;
        const rm = reportMetrics(rs);
        const phaseRowSuppressed = protectedRows[PHASE_IDS.indexOf(phase)].suppressed;
        cells[phase] = suppressed || phaseRowSuppressed ? null : { reports: rs.length, meanNote: rm.meanIntensity, reportsPer100Trainings: per(rs.length, n, 100), notePointsPer100Trainings: per(rm.notePoints, n, 100) };
      }
      return { key, label: regionLabel(key), suppressed, cells };
    }).sort((a, b) => (b.cells.menstruacao?.reports ?? 0) + (b.cells.folicular?.reports ?? 0) + (b.cells.ovulatoria?.reports ?? 0) + (b.cells.lutea?.reports ?? 0) - ((a.cells.menstruacao?.reports ?? 0) + (a.cells.folicular?.reports ?? 0) + (a.cells.ovulatoria?.reports ?? 0) + (a.cells.lutea?.reports ?? 0)));
    return { phases: PHASE_IDS.map((phase, i) => ({ phase, label: PHASE_LABEL[phase], row: protectedRows[i] })), locations };
  };

  // ───────── 6) evolucao semanal ─────────
  const weekList: string[] = [];
  for (let w = weekStartOf(f.from); w <= f.to; w = addDays(w, 7)) weekList.push(w);
  const weekIndex = new Map(weekList.map((w, i) => [w, i]));
  const bucket = <T extends { day: string }>(items: T[]): T[][] => { const out: T[][] = weekList.map(() => []); for (const i of items) { const k = weekIndex.get(weekStartOf(i.day)); if (k != null) out[k].push(i); } return out; };
  const tBuckets = bucket(trainings);
  const rBuckets = bucket(reports);
  const seriesDefs: Array<{ key: string; label: string; pick: (t: ObsTraining) => boolean }> = [
    { key: 'total', label: 'Todos os treinos', pick: () => true },
    { key: 'corridas', label: 'Corrida (prescrita + extra)', pick: (t) => RUN_SEGMENTS.has(segmentOf(t)) },
    ...SEGMENT_IDS.map((id) => ({ key: id, label: SEGMENT_LABEL[id], pick: (t: ObsTraining) => segmentOf(t) === id })),
  ];
  const weeklySegments = seriesDefs.map((def) => ({
    key: def.key, label: def.label,
    points: weekList.map((week, i): WeeklyPoint => {
      const items = tBuckets[i].filter(def.pick);
      const base = { week, weekNumber: i + 1 };
      if (items.length === 0 || people(items) < min) return { ...base, suppressed: items.length > 0, trainings: null, painTrainings: null, painPer100: null, levelPointsPer100: null, meanLevelAmongPain: null, km: null, painPer1000Km: null, levelPointsPer1000Km: null };
      const m = painLevelMetrics(items);
      return { ...base, suppressed: false, trainings: m.trainings, painTrainings: m.painTrainings, painPer100: m.painPer100Trainings, levelPointsPer100: m.levelPointsPer100Trainings, meanLevelAmongPain: m.meanLevelAmongPain, km: round2(m.km), painPer1000Km: m.painPer1000Km, levelPointsPer1000Km: m.levelPointsPer1000Km };
    }),
  }));
  const weeklyRelatar = weekList.map((week, i): WeeklyRelatarPoint => {
    const rs = rBuckets[i];
    const base = { week, weekNumber: i + 1 };
    if (rs.length === 0) return { ...base, suppressed: false, reports: 0, meanNote: null, notePoints: 0, reportsPer100Trainings: per(0, tBuckets[i].length, 100), reportsPer1000Km: null, notePointsPer1000Km: null };
    if (people(rs) < min) return { ...base, suppressed: true, reports: null, meanNote: null, notePoints: null, reportsPer100Trainings: null, reportsPer1000Km: null, notePointsPer1000Km: null };
    const rm = reportMetrics(rs);
    const km = painLevelMetrics(tBuckets[i].filter((t) => RUN_SEGMENTS.has(segmentOf(t)))).km;
    return { ...base, suppressed: false, reports: rs.length, meanNote: rm.meanIntensity, notePoints: rm.notePoints, reportsPer100Trainings: per(rs.length, tBuckets[i].length, 100), reportsPer1000Km: per(rs.length, km, 1000), notePointsPer1000Km: per(rm.notePoints, km, 1000) };
  });

  return {
    weekly: { segments: weeklySegments, relatar: weeklyRelatar },
    scopeNote: 'Participantes com corrida nas semanas incluídas pelos filtros; força e outras modalidades dentro do período. A dor do treino vem do feedback do treino (sem dor, leve, moderada ou forte; escala 0 a 3 como na Evolução). Treino registrado sem relato vale zero; a cobertura do feedback aparece à parte.',
    segments: { rows: segmentRows.rows, runsCombined: segmentRows.totalAllowed && runs.length > 0 ? segmentData(runs, true) : null, total: segmentRows.totalAllowed ? segmentData(trainings, false) : null },
    runsByDistance: { rows: distanceRows.rows, runsWithoutDistance: runs.length - runsWithKm.length },
    weeklyVolume: {
      weeks: { from: weeks[0], to: addDays(weeks[weeks.length - 1], 6) }, minWeeks: ELIGIBILITY_MIN_WEEKS,
      studentsWithRuns: volumeRows.totalAllowed ? studentsWithRuns : null, rows: volumeRows.rows,
      note: `Últimas ${ELIGIBILITY_WEEKS} semanas completas, sem a semana atual. A aluna entra na maior faixa em que correu pelo menos o piso em ${ELIGIBILITY_MIN_WEEKS} dessas ${ELIGIBILITY_WEEKS} semanas; quem é elegível a uma faixa maior não entra na menor. Conta toda corrida (prescrita e extra), sem os filtros de faixa da tela. Semana sem corrida conta como 0 km (pode ser falta de sincronização).`,
    },
    standalone: {
      note: 'O “Relatar dor” (nota de 1 a 10 e local) é analisado à parte e não é ligado a nenhum treino. As taxas “por 100 treinos” e “por 1.000 km” são de EXPOSIÇÃO: relatos do período ÷ volume do mesmo período. Não dizem que o relato veio daquele tipo de treino.',
      overall, runKm,
      reportsPer1000RunKm: overall ? per(reports.length, runKm, 1000) : null,
      notePointsPer1000RunKm: overall ? per(reportTotals.notePoints, runKm, 1000) : null,
      locations: locationRows.rows, sides: sideRows.rows, locationBySegment,
    },
    cycle: {
      notes: [
        'Só entram alunas que registraram o ciclo. A fase de cada dia é uma ESTIMATIVA feita a partir do que a aluna registrou (ovulação ≈ 14 dias antes da próxima menstruação); não é exame.',
        'Quem usa anticoncepcional hormonal fica em grupo separado: as fases dela não refletem o ciclo natural.',
        'Adesão = treinos programados até ontem que têm registro (feedback feito/ajustado ou atividade vinculada) ÷ programados. Sem registro não prova que não fez.',
        'Descritivo: diferença entre fases não prova causa. Fases com poucos dias ou poucas alunas têm números pouco firmes.',
      ],
      participantsWithCycle: withCycle.length, participantsWithEstimatedPhases: estimated, trainingsOutsideCycle: outside,
      natural: buildGroup(false), hormonal: buildGroup(true),
    },
  };
}
