import { extractPrescribedSegments, PrescribedSegment } from './prescribed-segments';

// ANALISE DETERMINISTICA DA EXECUCAO (Etapa 2.1, 11/10/2026). Funcoes PURAS, sem banco, sem IA. Compara a prescricao (blocos por distancia, faixas de
// pace) com a serie temporal COMPLETA do relogio e devolve: (1) a modalidade/atividade associada (nao decidida aqui), (2) a ESTRUTURA executada e (3) a
// ADERENCIA A INTENSIDADE — tres informacoes distintas. Nao atribui intencao ao aluno: o relogio mostra o que aconteceu, nunca o porque.
//
// CRITERIOS (definidos ANTES da implementacao; todos configuraveis em EXECUTION_THRESHOLDS):
//  Tempo observavel: a serie e' percorrida por INTERVALOS entre amostras consecutivas. Um intervalo e' valido se 0 < dt <= maxGap (max(30 s, 3x o dt
//   mediano)) e a distancia nao diminuiu. Pausa, buraco de GPS ou distancia regressiva => intervalo NAO confiavel: fica fora de todo percentual (nunca
//   e' classificado como acima/abaixo da faixa) e entra so' na cobertura. Intervalo valido com velocidade < 0,5 m/s = parado (tambem fora do denominador).
//  Percentuais: pelo TEMPO dos intervalos validos em movimento (soma de dt), nao pela contagem de pontos, nem por medias de km inteiros.
//  Suavizacao: o pace de cada intervalo usa a janela deslizante de 15 s anterior (distancia/tempo acumulados), para que uma oscilacao isolada de GPS
//   nao mude a classificacao. Bordas da faixa tem tolerancia de 3 s/km.
//  Estrutura: por repeticao, compara-se o pace do bloco de estimulo com o da recuperacao (pace de bloco inteiro, nao amostra isolada). A repeticao e'
//   RECONHECIDA se o contraste realizado >= max(15 s/km, 50% do contraste prescrito). >=75% das avaliaveis reconhecidas => intervalado; <=25% => continuo;
//   entre os dois => parcial. Menos de 2 repeticoes avaliaveis, cobertura < 60% ou ausencia de bloco por distancia => indeterminado.
//  Aceleracao final: ultimos max(0,5 km; 10%) (no maximo 25%) com pace >= 6% mais rapido que o corpo do treino (15% a ultimo trecho), sustentada em >= 70%
//   do tempo desse trecho.

export const EXECUTION_ANALYSIS_VERSION = 1;

export const EXECUTION_THRESHOLDS = {
  minGapSec: 30,
  gapFactor: 3,
  minMovingMs: 0.5,
  smoothSec: 15,
  paceToleranceSec: 3,
  minSegmentObservedSec: 15,
  minCoverageForPercent: 0.5,
  minCoverageForStructure: 0.6,
  altMinSecKm: 15,
  altRatio: 0.5,
  recognizedHigh: 0.75,
  recognizedLow: 0.25,
  intensityOkPct: 60,
  accelRatio: 0.06,
  accelMinKm: 0.5,
  accelMaxFraction: 0.25,
  accelSustainedFraction: 0.7,
  strengthDurationTolerance: 0.05,
} as const;

export interface SeriesSample {
  offsetSec: number;
  distanceMeters: number | null;
  heartRateBpm: number | null;
  cadenceSpm: number | null;
}

export type SegmentRole = 'estimulo' | 'recuperacao' | 'continuo';
type Validity = 'valid' | 'gap' | 'invalid';

interface Interval {
  t0: number; t1: number; d0: number; d1: number; dt: number; dd: number;
  validity: Validity; moving: boolean;
  pace: number | null; // suavizado
  hr: number | null; cad: number | null;
}

const round = (value: number, places = 1) => { const f = 10 ** places; return Math.round(value * f) / f; };
const pctOf = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100) : null);

// ── intervalos validos e pace suavizado ──────────────────────────────────────────────────────────────────────────

export function buildIntervals(points: SeriesSample[]): Interval[] {
  const withDistance = points.filter((p) => p.distanceMeters != null).sort((a, b) => a.offsetSec - b.offsetSec);
  if (withDistance.length < 2) return [];
  const dts = withDistance.slice(1).map((p, i) => p.offsetSec - withDistance[i].offsetSec).filter((dt) => dt > 0).sort((a, b) => a - b);
  const median = dts.length > 0 ? dts[Math.floor(dts.length / 2)] : 1;
  const maxGap = Math.max(EXECUTION_THRESHOLDS.minGapSec, EXECUTION_THRESHOLDS.gapFactor * median);
  const out: Interval[] = [];
  for (let i = 1; i < withDistance.length; i++) {
    const a = withDistance[i - 1];
    const b = withDistance[i];
    const dt = b.offsetSec - a.offsetSec;
    const dd = (b.distanceMeters as number) - (a.distanceMeters as number);
    const validity: Validity = dt <= 0 || dd < 0 ? 'invalid' : dt > maxGap ? 'gap' : 'valid';
    out.push({
      t0: a.offsetSec, t1: b.offsetSec, d0: a.distanceMeters as number, d1: b.distanceMeters as number, dt: Math.max(dt, 0), dd,
      validity, moving: validity === 'valid' && dd / dt >= EXECUTION_THRESHOLDS.minMovingMs, pace: null,
      hr: b.heartRateBpm, cad: b.cadenceSpm != null && b.cadenceSpm > 0 ? b.cadenceSpm : null,
    });
  }
  // pace suavizado: janela deslizante anterior de smoothSec sobre intervalos validos CONSECUTIVOS (uma pausa zera a janela)
  for (let i = 0; i < out.length; i++) {
    if (!out[i].moving) continue;
    let sumDt = 0; let sumDd = 0;
    for (let j = i; j >= 0 && out[j].validity === 'valid'; j--) {
      sumDt += out[j].dt; sumDd += out[j].dd;
      if (sumDt >= EXECUTION_THRESHOLDS.smoothSec) break;
    }
    out[i].pace = sumDd > 0 ? sumDt / (sumDd / 1000) : null;
  }
  return out;
}

// ── estrutura prescrita (grupos de repeticao) ────────────────────────────────────────────────────────────────────

export interface PrescribedBlock extends PrescribedSegment {
  role: SegmentRole;
  group: number | null;
  rep: number | null;
  reps: number | null;
  step: number | null;
}

// Mesma geometria de extractPrescribedSegments (nao altera aquele modulo); acrescenta grupo/repeticao/papel. Estimulo = etapa de menor pace (mais rapida)
// dentro do grupo repetido.
export function extractPrescribedBlocks(structure: unknown): PrescribedBlock[] | null {
  const segments = extractPrescribedSegments(structure);
  if (!segments) return null;
  const blocks = (structure as { blocks: Array<{ steps?: unknown[]; repeatCount?: number }> }).blocks;
  const meta: Array<{ group: number | null; rep: number | null; reps: number | null; step: number | null }> = [];
  let group = -1;
  for (const block of blocks) {
    if (Array.isArray(block.steps) && typeof block.repeatCount === 'number' && block.repeatCount > 0) {
      group++;
      for (let rep = 1; rep <= block.repeatCount; rep++) block.steps.forEach((_, step) => meta.push({ group, rep, reps: block.repeatCount as number, step }));
    } else meta.push({ group: null, rep: null, reps: null, step: null });
  }
  if (meta.length !== segments.length) return null;
  const roleOf = new Map<number, SegmentRole>();
  for (const g of new Set(meta.map((m) => m.group).filter((v): v is number => v != null))) {
    const members = segments.filter((_, i) => meta[i].group === g);
    const stepFast = new Map<number, number>();
    members.forEach((s) => { const step = meta[s.index].step as number; if (s.paceFastSecondsKm != null && !stepFast.has(step)) stepFast.set(step, s.paceFastSecondsKm); });
    const stimulusStep = [...stepFast.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
    members.forEach((s) => roleOf.set(s.index, stimulusStep == null ? 'continuo' : meta[s.index].step === stimulusStep ? 'estimulo' : 'recuperacao'));
  }
  return segments.map((s, i) => ({ ...s, role: roleOf.get(i) ?? 'continuo', ...meta[i] }));
}

// ── resultados ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface TimeInBand { classifiedSec: number; inSec: number; fastSec: number; slowSec: number; inPct: number | null; fastPct: number | null; slowPct: number | null }

export interface BlockAnalysis {
  index: number; label: string; role: SegmentRole; rep: number | null; reps: number | null;
  prescribedKm: number; realizedKm: number | null; paceFastSecondsKm: number | null; paceSlowSecondsKm: number | null; realizedPaceSecondsKm: number | null;
  elapsedSec: number; observedSec: number; coveragePct: number | null; timeInBand: TimeInBand | null; avgHeartRateBpm: number | null; avgCadenceSpm: number | null;
}

export type IntensityStatus = 'dentro' | 'mais_rapido' | 'mais_lento' | 'misto' | 'indeterminado';
export type StructureExecuted = 'intervalado' | 'continuo' | 'continuo_com_aceleracao_final' | 'parcial' | 'indeterminado';
export type Scenario = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface StructureResult {
  prescribed: 'intervalado' | 'continuo' | null;
  executed: StructureExecuted;
  scenario: Scenario | null;
  confidence: 'alta' | 'media' | 'baixa' | null;
  evidence: { repsPrescribed: number; repsEvaluated: number; repsRecognized: number; recognizedFirstHalf: number | null; recognizedSecondHalf: number | null; finalAcceleration: { detected: boolean; tailKm: number; bodyPaceSecondsKm: number; tailPaceSecondsKm: number } | null } | null;
  reason: string | null;
}

export interface RunExecutionAnalysis {
  kind: 'run';
  version: number;
  dataLevel: 'series' | 'summary_only' | 'manual_only' | 'none';
  totals: { prescribedKm: number | null; realizedKm: number | null; deltaKm: number | null; completionRatio: number | null; prescribedDurationSec: number | null; realizedDurationSec: number | null; avgPaceSecondsKm: number | null; avgHeartRateBpm: number | null; avgCadenceSpm: number | null; perceivedEffort: number | null };
  coverage: { elapsedSec: number; validSec: number; coveragePct: number | null; stoppedSec: number; unreliableSec: number; samples: number } | null;
  blocks: BlockAnalysis[] | null;
  blocksLimitation: 'prescricao_sem_blocos_por_distancia' | 'sem_serie_temporal' | null;
  intensity: { status: IntensityStatus; overall: TimeInBand | null; byRole: Partial<Record<SegmentRole, TimeInBand>> };
  structure: StructureResult;
  avgHeartRateInBandBpm: number | null;
  limitations: string[];
}

export interface StrengthExecutionAnalysis {
  kind: 'strength';
  version: number;
  dataLevel: 'device_and_manual' | 'manual_only' | 'none';
  prescribedDurationMin: number | null;
  realizedDurationMin: number | null;
  durationRatio: number | null;
  durationClass: 'proxima' | 'mais_curta' | 'mais_longa' | null;
  tolerance: number;
  perceivedEffort: number | null;
  avgHeartRateBpm: number | null;
  caloriesKcal: number | null;
  exerciseFeedbackCount: number | null;
  limitations: string[];
}

export interface NotDoneAnalysis { kind: 'not_done'; version: number; modality: string; reason: 'marcada_como_nao_feita' | 'sem_registro'; prescribedKm: number | null; prescribedDurationMin: number | null }

export type SessionAnalysis = RunExecutionAnalysis | StrengthExecutionAnalysis | NotDoneAnalysis;

// ── percentuais ─────────────────────────────────────────────────────────────────────────────────────────────────

function timeInBand(intervals: Interval[], fast: number | null, slow: number | null): TimeInBand | null {
  if (fast == null || slow == null) return null;
  let inSec = 0; let fastSec = 0; let slowSec = 0;
  for (const interval of intervals) {
    if (!interval.moving || interval.pace == null) continue;
    if (interval.pace < fast - EXECUTION_THRESHOLDS.paceToleranceSec) fastSec += interval.dt;
    else if (interval.pace > slow + EXECUTION_THRESHOLDS.paceToleranceSec) slowSec += interval.dt;
    else inSec += interval.dt;
  }
  const classifiedSec = inSec + fastSec + slowSec;
  return { classifiedSec: round(classifiedSec), inSec: round(inSec), fastSec: round(fastSec), slowSec: round(slowSec), inPct: pctOf(inSec, classifiedSec), fastPct: pctOf(fastSec, classifiedSec), slowPct: pctOf(slowSec, classifiedSec) };
}

export function mergeTimeInBand(parts: Array<TimeInBand | null | undefined>): TimeInBand | null {
  const real = parts.filter((p): p is TimeInBand => !!p && p.classifiedSec > 0);
  if (real.length === 0) return null;
  const inSec = real.reduce((s, p) => s + p.inSec, 0); const fastSec = real.reduce((s, p) => s + p.fastSec, 0); const slowSec = real.reduce((s, p) => s + p.slowSec, 0);
  const classifiedSec = inSec + fastSec + slowSec;
  return { classifiedSec: round(classifiedSec), inSec: round(inSec), fastSec: round(fastSec), slowSec: round(slowSec), inPct: pctOf(inSec, classifiedSec), fastPct: pctOf(fastSec, classifiedSec), slowPct: pctOf(slowSec, classifiedSec) };
}

// Base da aderencia a intensidade: estimulo + recuperacao quando o treino tem esses blocos (aquecimento longo nao mascara tiros fora da faixa); senao, o total.
export function intensityBasisOf(run: RunExecutionAnalysis): TimeInBand | null {
  const key = (run.blocks ?? []).filter((b) => b.role === 'estimulo' || b.role === 'recuperacao');
  return key.some((b) => b.timeInBand) ? mergeTimeInBand(key.map((b) => b.timeInBand)) : run.intensity.overall;
}

function intensityStatusOf(overall: TimeInBand | null): IntensityStatus {
  if (!overall || overall.inPct == null) return 'indeterminado';
  if (overall.inPct >= EXECUTION_THRESHOLDS.intensityOkPct) return 'dentro';
  if ((overall.slowPct ?? 0) >= 50) return 'mais_lento';
  if ((overall.fastPct ?? 0) >= 50) return 'mais_rapido';
  return 'misto';
}

function weightedAvg(intervals: Interval[], pick: (i: Interval) => number | null): number | null {
  let sum = 0; let weight = 0;
  for (const interval of intervals) {
    if (interval.validity !== 'valid') continue;
    const value = pick(interval);
    if (value == null) continue;
    sum += value * interval.dt; weight += interval.dt;
  }
  return weight > 0 ? Math.round(sum / weight) : null;
}

// ── analise por bloco ───────────────────────────────────────────────────────────────────────────────────────────

function analyzeBlocks(intervals: Interval[], blocks: PrescribedBlock[]): BlockAnalysis[] {
  const bucket = new Map<number, Interval[]>();
  for (const interval of intervals) {
    const mid = (interval.d0 + interval.d1) / 2;
    const block = blocks.find((b) => mid >= b.startKm * 1000 && mid < b.endKm * 1000);
    if (!block) continue;
    bucket.set(block.index, [...(bucket.get(block.index) ?? []), interval]);
  }
  return blocks.map((block) => {
    const members = bucket.get(block.index) ?? [];
    const elapsed = members.reduce((s, i) => s + i.dt, 0);
    const valid = members.filter((i) => i.validity === 'valid');
    const observed = valid.reduce((s, i) => s + i.dt, 0);
    const coverage = elapsed > 0 ? observed / elapsed : null;
    const moving = valid.filter((i) => i.moving);
    const distM = moving.reduce((s, i) => s + i.dd, 0);
    const movingSec = moving.reduce((s, i) => s + i.dt, 0);
    const enough = observed >= EXECUTION_THRESHOLDS.minSegmentObservedSec && coverage != null && coverage >= EXECUTION_THRESHOLDS.minCoverageForPercent;
    return {
      index: block.index, label: block.label, role: block.role, rep: block.rep, reps: block.reps,
      prescribedKm: round(block.endKm - block.startKm, 3), realizedKm: valid.length > 0 ? round(valid.reduce((s, i) => s + i.dd, 0) / 1000, 3) : null,
      paceFastSecondsKm: block.paceFastSecondsKm, paceSlowSecondsKm: block.paceSlowSecondsKm,
      realizedPaceSecondsKm: enough && distM > 0 ? Math.round(movingSec / (distM / 1000)) : null,
      elapsedSec: round(elapsed), observedSec: round(observed), coveragePct: coverage != null ? round(coverage * 100) : null,
      timeInBand: enough ? timeInBand(members, block.paceFastSecondsKm, block.paceSlowSecondsKm) : null,
      avgHeartRateBpm: enough ? weightedAvg(members, (i) => i.hr) : null, avgCadenceSpm: enough ? weightedAvg(members, (i) => i.cad) : null,
    };
  });
}

// ── estrutura ───────────────────────────────────────────────────────────────────────────────────────────────────

function detectFinalAcceleration(intervals: Interval[], totalKm: number) {
  const moving = intervals.filter((i) => i.moving && i.pace != null);
  if (totalKm <= 1 || moving.length < 10) return null;
  const tailKm = Math.min(Math.max(EXECUTION_THRESHOLDS.accelMinKm, totalKm * 0.1), totalKm * EXECUTION_THRESHOLDS.accelMaxFraction);
  const tailStart = (totalKm - tailKm) * 1000;
  const bodyStart = totalKm * 0.15 * 1000;
  const tail = moving.filter((i) => i.d0 >= tailStart);
  const body = moving.filter((i) => i.d0 >= bodyStart && i.d1 <= tailStart);
  const paceOf = (list: Interval[]) => { const dt = list.reduce((s, i) => s + i.dt, 0); const dd = list.reduce((s, i) => s + i.dd, 0); return dd > 0 ? dt / (dd / 1000) : null; };
  const tailPace = paceOf(tail); const bodyPace = paceOf(body);
  if (tailPace == null || bodyPace == null || tail.length < 5 || body.length < 5) return null;
  const tailSec = tail.reduce((s, i) => s + i.dt, 0);
  const fasterSec = tail.filter((i) => (i.pace as number) <= bodyPace * 0.97).reduce((s, i) => s + i.dt, 0);
  const detected = bodyPace / tailPace - 1 >= EXECUTION_THRESHOLDS.accelRatio && fasterSec / tailSec >= EXECUTION_THRESHOLDS.accelSustainedFraction;
  return { detected, tailKm: round(tailKm, 2), bodyPaceSecondsKm: Math.round(bodyPace), tailPaceSecondsKm: Math.round(tailPace) };
}

function classifyStructure(blocks: PrescribedBlock[] | null, analyzed: BlockAnalysis[] | null, coveragePct: number | null, intervals: Interval[], realizedKm: number | null, intensity: IntensityStatus): StructureResult {
  const none = (reason: string, prescribed: StructureResult['prescribed'] = null): StructureResult => ({ prescribed, executed: 'indeterminado', scenario: prescribed === 'intervalado' ? 'F' : null, confidence: null, evidence: null, reason });
  if (!blocks || !analyzed) return none('prescricao_sem_blocos_por_distancia');
  const groups = [...new Set(blocks.map((b) => b.group).filter((g): g is number => g != null))];
  const intervalGroups = groups.filter((g) => blocks.filter((b) => b.group === g && b.step === 0).length >= 2);
  const prescribed: 'intervalado' | 'continuo' = intervalGroups.length > 0 ? 'intervalado' : 'continuo';
  const coverage = coveragePct != null ? coveragePct / 100 : 0;
  if (coverage < EXECUTION_THRESHOLDS.minCoverageForStructure) return none('cobertura_insuficiente', prescribed);

  const accel = detectFinalAcceleration(intervals, realizedKm ?? 0);
  const confidenceOf = (evalFrac: number): StructureResult['confidence'] => (coverage >= 0.9 && evalFrac >= 0.75 ? 'alta' : coverage >= 0.75 ? 'media' : 'baixa');

  if (prescribed === 'continuo') {
    const executed: StructureExecuted = accel?.detected ? 'continuo_com_aceleracao_final' : 'continuo';
    return { prescribed, executed, scenario: !accel?.detected && intensity === 'dentro' ? 'E' : null, confidence: confidenceOf(1), evidence: { repsPrescribed: 0, repsEvaluated: 0, repsRecognized: 0, recognizedFirstHalf: null, recognizedSecondHalf: null, finalAcceleration: accel }, reason: null };
  }

  // intervalado: repeticoes = (grupo, rep)
  const reps: Array<{ recognized: boolean | null }> = [];
  for (const g of intervalGroups) {
    const total = blocks.find((b) => b.group === g)?.reps ?? 0;
    for (let rep = 1; rep <= total; rep++) {
      const members = analyzed.filter((a, i) => blocks[i].group === g && blocks[i].rep === rep);
      const stim = members.filter((m) => m.role === 'estimulo'); const rec = members.filter((m) => m.role === 'recuperacao');
      const paceOf = (list: BlockAnalysis[]) => { const usable = list.filter((m) => m.realizedPaceSecondsKm != null && m.observedSec >= EXECUTION_THRESHOLDS.minSegmentObservedSec); if (usable.length === 0) return null; const w = usable.reduce((s, m) => s + m.observedSec, 0); return usable.reduce((s, m) => s + (m.realizedPaceSecondsKm as number) * m.observedSec, 0) / w; };
      const stimPace = paceOf(stim); const recPace = paceOf(rec);
      if (stimPace == null || recPace == null) { reps.push({ recognized: null }); continue; }
      const mid = (m: BlockAnalysis) => (m.paceFastSecondsKm != null && m.paceSlowSecondsKm != null ? (m.paceFastSecondsKm + m.paceSlowSecondsKm) / 2 : null);
      const sMid = stim.map(mid).filter((v): v is number => v != null)[0]; const rMid = rec.map(mid).filter((v): v is number => v != null)[0];
      const prescribedContrast = sMid != null && rMid != null ? rMid - sMid : 0;
      const needed = Math.max(EXECUTION_THRESHOLDS.altMinSecKm, EXECUTION_THRESHOLDS.altRatio * prescribedContrast);
      reps.push({ recognized: recPace - stimPace >= needed });
    }
  }
  const evaluated = reps.filter((r) => r.recognized !== null);
  const recognized = evaluated.filter((r) => r.recognized).length;
  const evalFrac = reps.length > 0 ? evaluated.length / reps.length : 0;
  const half = Math.ceil(reps.length / 2);
  const countRec = (slice: typeof reps) => slice.filter((r) => r.recognized).length;
  const evidence = { repsPrescribed: reps.length, repsEvaluated: evaluated.length, repsRecognized: recognized, recognizedFirstHalf: countRec(reps.slice(0, half)), recognizedSecondHalf: countRec(reps.slice(half)), finalAcceleration: accel };
  if (evaluated.length < 2) return { prescribed, executed: 'indeterminado', scenario: 'F', confidence: null, evidence, reason: 'repeticoes_avaliaveis_insuficientes' };

  const recFrac = recognized / evaluated.length;
  const confidence = confidenceOf(evalFrac);
  if (recFrac >= EXECUTION_THRESHOLDS.recognizedHigh) {
    if (evalFrac >= EXECUTION_THRESHOLDS.recognizedHigh) return { prescribed, executed: 'intervalado', scenario: intensity === 'dentro' ? 'E' : 'A', confidence, evidence, reason: null };
    return { prescribed, executed: 'parcial', scenario: 'C', confidence, evidence, reason: 'repeticoes_nao_alcancadas' };
  }
  if (recFrac <= EXECUTION_THRESHOLDS.recognizedLow) {
    return { prescribed, executed: accel?.detected ? 'continuo_com_aceleracao_final' : 'continuo', scenario: accel?.detected ? 'D' : 'B', confidence, evidence, reason: null };
  }
  return { prescribed, executed: 'parcial', scenario: 'C', confidence, evidence, reason: 'estrutura_mudou_durante_o_treino' };
}

// ── corrida ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RunInputs {
  structure: unknown;
  prescribedDistanceKm: number | null;
  prescribedDurationMin: number | null;
  points: SeriesSample[];
  activity: { distanceMeters: number | null; durationSec: number | null; avgHeartRateBpm: number | null; cadenceAvg: number | null } | null;
  completion: { status: string; distanceKm: number | null; durationMin: number | null; avgHeartRate: number | null; perceivedEffort: number | null } | null;
}

export function analyzeRunExecution(input: RunInputs): RunExecutionAnalysis {
  const { activity, completion } = input;
  const realizedKm = activity?.distanceMeters != null ? round(activity.distanceMeters / 1000, 2) : completion?.distanceKm != null ? round(completion.distanceKm, 2) : null;
  const realizedDurationSec = activity?.durationSec ?? (completion?.durationMin != null ? Math.round(completion.durationMin * 60) : null);
  const avgPace = realizedKm && realizedKm > 0 && realizedDurationSec ? Math.round(realizedDurationSec / realizedKm) : null;
  const intervals = buildIntervals(input.points);
  const hasSeries = intervals.some((i) => i.validity === 'valid');
  const dataLevel: RunExecutionAnalysis['dataLevel'] = hasSeries ? 'series' : activity ? 'summary_only' : completion ? 'manual_only' : 'none';
  const limitations: string[] = [];

  const totals: RunExecutionAnalysis['totals'] = {
    prescribedKm: input.prescribedDistanceKm, realizedKm,
    deltaKm: realizedKm != null && input.prescribedDistanceKm != null ? round(realizedKm - input.prescribedDistanceKm, 2) : null,
    completionRatio: realizedKm != null && input.prescribedDistanceKm ? round(realizedKm / input.prescribedDistanceKm, 3) : null,
    prescribedDurationSec: input.prescribedDurationMin != null ? Math.round(input.prescribedDurationMin * 60) : null, realizedDurationSec, avgPaceSecondsKm: avgPace,
    avgHeartRateBpm: activity?.avgHeartRateBpm ?? completion?.avgHeartRate ?? null, avgCadenceSpm: activity?.cadenceAvg ?? null, perceivedEffort: completion?.perceivedEffort ?? null,
  };

  if (!hasSeries) {
    limitations.push(dataLevel === 'summary_only' ? 'Sem serie temporal: so ha o resumo do relogio (sem percentuais por faixa nem estrutura).' : dataLevel === 'manual_only' ? 'Sem atividade do relogio: so ha o registro manual.' : 'Sem dados de execucao.');
    return { kind: 'run', version: EXECUTION_ANALYSIS_VERSION, dataLevel, totals, coverage: null, blocks: null, blocksLimitation: 'sem_serie_temporal', intensity: { status: 'indeterminado', overall: null, byRole: {} }, structure: { prescribed: null, executed: 'indeterminado', scenario: null, confidence: null, evidence: null, reason: 'sem_serie_temporal' }, avgHeartRateInBandBpm: null, limitations };
  }

  const elapsed = intervals.reduce((s, i) => s + i.dt, 0);
  const valid = intervals.filter((i) => i.validity === 'valid');
  const validSec = valid.reduce((s, i) => s + i.dt, 0);
  const stoppedSec = valid.filter((i) => !i.moving).reduce((s, i) => s + i.dt, 0);
  const coverage = { elapsedSec: round(elapsed), validSec: round(validSec), coveragePct: elapsed > 0 ? round((validSec / elapsed) * 100) : null, stoppedSec: round(stoppedSec), unreliableSec: round(elapsed - validSec), samples: input.points.length };

  const blocks = extractPrescribedBlocks(input.structure);
  if (!blocks) limitations.push('Prescricao sem blocos por distancia (ex.: por tempo): nao ha alinhamento confiavel para comparar por bloco.');
  const analyzed = blocks ? analyzeBlocks(intervals, blocks) : null;
  const byRole: Partial<Record<SegmentRole, TimeInBand>> = {};
  for (const role of ['estimulo', 'recuperacao', 'continuo'] as SegmentRole[]) {
    const merged = mergeTimeInBand((analyzed ?? []).filter((b) => b.role === role).map((b) => b.timeInBand));
    if (merged) byRole[role] = merged;
  }
  const overall = mergeTimeInBand((analyzed ?? []).map((b) => b.timeInBand));
  // Aderencia a intensidade: em treino intervalado vale o tempo dos blocos de estimulo + recuperacao (aquecimento/desaquecimento longos nao podem
  // mascarar tiros fora da faixa); nos demais, o total dos blocos com faixa.
  const keyBlocks = (analyzed ?? []).filter((b) => b.role === 'estimulo' || b.role === 'recuperacao');
  const basis = keyBlocks.some((b) => b.timeInBand) ? mergeTimeInBand(keyBlocks.map((b) => b.timeInBand)) : overall;
  const status = basis && coverage.coveragePct != null && coverage.coveragePct / 100 >= EXECUTION_THRESHOLDS.minCoverageForPercent ? intensityStatusOf(basis) : 'indeterminado';
  if (coverage.coveragePct != null && coverage.coveragePct < 80) limitations.push('Parte do tempo sem informacao confiavel (pausa ou falha de GPS) ficou fora dos percentuais.');
  const hrInBand = (() => {
    if (!blocks || !analyzed) return null;
    const inBand: Interval[] = [];
    for (const interval of valid) {
      if (!interval.moving || interval.pace == null) continue;
      const mid = (interval.d0 + interval.d1) / 2;
      const b = blocks.find((x) => mid >= x.startKm * 1000 && mid < x.endKm * 1000);
      if (!b || b.paceFastSecondsKm == null || b.paceSlowSecondsKm == null) continue;
      if (interval.pace >= b.paceFastSecondsKm - EXECUTION_THRESHOLDS.paceToleranceSec && interval.pace <= b.paceSlowSecondsKm + EXECUTION_THRESHOLDS.paceToleranceSec) inBand.push(interval);
    }
    const total = inBand.reduce((s, i) => s + i.dt, 0);
    return total >= 60 ? weightedAvg(inBand, (i) => i.hr) : null; // exige >= 60 s dentro da faixa para ser comparavel
  })();
  const structure = classifyStructure(blocks, analyzed, coverage.coveragePct, intervals, realizedKm, status);
  return { kind: 'run', version: EXECUTION_ANALYSIS_VERSION, dataLevel, totals, coverage, blocks: analyzed, blocksLimitation: blocks ? null : 'prescricao_sem_blocos_por_distancia', intensity: { status, overall, byRole }, structure, avgHeartRateInBandBpm: hrInBand, limitations };
}

// ── musculacao ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface StrengthInputs {
  prescribedDurationMin: number | null;
  completion: { status: string; durationMin: number | null; avgHeartRate: number | null; perceivedEffort: number | null; details?: unknown } | null;
  activity: { durationSec: number | null; avgHeartRateBpm: number | null; caloriesKcal: number | null } | null;
  tolerance?: number;
}

export function analyzeStrengthExecution(input: StrengthInputs): StrengthExecutionAnalysis {
  const tolerance = input.tolerance ?? EXECUTION_THRESHOLDS.strengthDurationTolerance;
  const realized = input.completion?.durationMin ?? (input.activity?.durationSec != null ? round(input.activity.durationSec / 60, 1) : null);
  const ratio = realized != null && input.prescribedDurationMin ? round(realized / input.prescribedDurationMin, 3) : null;
  const durationClass = ratio == null ? null : Math.abs(ratio - 1) <= tolerance + 1e-9 ? 'proxima' : ratio < 1 ? 'mais_curta' : 'mais_longa';
  const details = (input.completion?.details ?? null) as { exerciseFeedback?: unknown } | null;
  const feedback = details && typeof details === 'object' ? details.exerciseFeedback : null;
  return {
    kind: 'strength', version: EXECUTION_ANALYSIS_VERSION, dataLevel: input.activity ? 'device_and_manual' : input.completion ? 'manual_only' : 'none',
    prescribedDurationMin: input.prescribedDurationMin, realizedDurationMin: realized, durationRatio: ratio, durationClass, tolerance,
    perceivedEffort: input.completion?.perceivedEffort ?? null, avgHeartRateBpm: input.activity?.avgHeartRateBpm ?? input.completion?.avgHeartRate ?? null,
    caloriesKcal: input.activity?.caloriesKcal ?? null, exerciseFeedbackCount: Array.isArray(feedback) ? feedback.length : feedback && typeof feedback === 'object' ? Object.keys(feedback).length : null,
    // Sem inferir series, repeticoes ou exercicios a partir de duracao ou frequencia cardiaca.
    limitations: ['Series, repeticoes e exercicios realizados nao sao inferidos a partir da duracao nem da frequencia cardiaca do relogio.'],
  };
}
