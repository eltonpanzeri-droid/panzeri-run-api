// Desacoplamento da frequencia cardiaca (03/11/2026, ordem de Elton). Matematica PURA (sem banco, sem relogio): recebe os pontos da serie temporal canonica de UMA corrida e devolve o valor
// ou o motivo da exclusao, sempre com a cobertura e as amostras descartadas. Nao classifica o valor como bom ou ruim e nao interpreta (quem descreve e' o texto da Evolucao e o contexto da IA).
//
// Formula: o trecho valido e' dividido em duas metades de IGUAL DURACAO; R = velocidade media da metade / FC media da metade;
//   desacoplamento (%) = 100 × (1 − R2 / R1). Positivo, negativo e zero sao preservados.
// Elegibilidade (dois criterios independentes, ambos obrigatorios, limites INCLUSIVOS): (A) CV da velocidade = 100 × desvio-padrao / media <= 10%;
//   (B) diferenca entre as metades = 100 × |V2 − V1| / V1 <= 5%. Sem filtro por zona de intensidade.
// Tratamento dos dados: sem interpolacao; cada canal (velocidade, FC) usa so' as suas amostras validas; lacuna maior que MAX_GAP_SEC nao conta como coberta.
//
// VERSAO 2 (08/11/2026, ordem tecnica ELTON²): tolerancia a oscilacoes TRANSITORIAS de velocidade (pico de GPS, travessia de rua, curva fechada). Antes, o CV (e a diferenca entre as metades) era calculado
// sobre todas as amostras: 3 s a 50 km/h de GPS reprovavam uma corrida continua de 1 h; ja' as paradas (velocidade 0) eram descartadas SO' do canal da velocidade, enquanto a FC desses segundos ficava
// na media (distorcia R1/R2 sem aviso). Agora:
//  1. referencia local = MEDIANA da velocidade numa janela de 30 s (tempos reais; amostras de velocidade > 0), que o proprio evento quase nao desloca;
//  2. evento = sequencia de amostras fora da faixa (desvio > limite de estabilidade de 10% da referencia, ou velocidade 0), agrupada pelos timestamps reais (nao assume 1 Hz);
//  3. evento TOLERADO = dura ate 10 s e a velocidade volta a faixa em ate 20 s. Parada (velocidade 0) maior que 10 s = interrupcao relevante: o treino e' INCONCLUSIVO;
//     oscilacao maior que 10 s nao e' transitoria: fica nos dados e e' julgada pelos criterios de sempre (CV e metades);
//  4. evento tolerado NAO entra no calculo fisiologico: velocidade e FC do evento + janela de estabilizacao da FC (hrStabilizationSec) saem dos DOIS canais;
//  5. limites: tempo acumulado dos eventos <= 3% do trecho; frequencia (maximo de eventos e espacamento minimo); cobertura >= 80% em cada metade DEPOIS das exclusoes; exclusoes parecidas nas
//     duas metades (sem vies);
//  6. classificacao: VALIDO / VALIDO COM RESSALVAS (eventos tolerados e excluidos) / INCONCLUSIVO (sem valor confiavel). Dados originais nunca sao alterados; nada e' interpolado.
// Todos os parametros de HR_DECOUPLING_PARAMS sao HIPOTESES de engenharia (experimentais), nao limites fisiologicos validados.

export const HR_DECOUPLING_ALGORITHM_VERSION = 2;

export const MIN_VALID_HR_BPM = 30;
export const MAX_VALID_HR_BPM = 230;
export const MAX_GAP_SEC = 10;
export const MIN_HALF_COVERAGE = 0.8;
export const MAX_SPEED_CV_PCT = 10;
export const MAX_HALF_DIFF_PCT = 5;

export interface HrDecouplingParams {
  /** janela da mediana movel de referencia (s) */
  referenceWindowSec: number;
  /** desvio (%) em relacao a referencia que define um evento; = limite de estabilidade atual (CV 10%) */
  eventDeviationPct: number;
  /** duracao maxima (s) de um evento para ser tolerado */
  maxEventSec: number;
  /** a velocidade precisa voltar a faixa em ate (s) depois do evento */
  recoverySec: number;
  /** trechos fora da faixa separados por menos que isto (s) sao o MESMO evento (nao contar duas vezes na recuperacao) */
  mergeGapSec: number;
  /** tempo acumulado maximo dos eventos, em % do trecho analisado */
  maxEventsTimePct: number;
  /** espacamento minimo (s) entre inicios de eventos; menos que isso = sequencia sistematica */
  minEventSpacingSec: number;
  /** maximo de eventos = max(minimo, minutos do trecho / este divisor) */
  eventsMinCount: number;
  eventsPerMinutesDivisor: number;
  /** janela (s) apos o evento em que a FC ainda responde ao evento e sai do calculo; inicial, a confirmar com literatura e corridas reais */
  hrStabilizationSec: number;
  /** diferenca maxima (pontos percentuais) entre a fracao excluida da 1a e da 2a metade */
  maxExclusionAsymmetryPct: number;
}

export const HR_DECOUPLING_PARAMS: HrDecouplingParams = {
  referenceWindowSec: 30,
  eventDeviationPct: MAX_SPEED_CV_PCT,
  maxEventSec: 10,
  recoverySec: 20,
  mergeGapSec: 5,
  maxEventsTimePct: 3,
  minEventSpacingSec: 120,
  eventsMinCount: 3,
  eventsPerMinutesDivisor: 10,
  hrStabilizationSec: 60,
  maxExclusionAsymmetryPct: 5,
};

export const HR_DECOUPLING_CATEGORIES = ['d30', 'd60', 'd90', 'd120', 'd150'] as const;
export type HrDecouplingCategory = (typeof HR_DECOUPLING_CATEGORIES)[number];

export const HR_DECOUPLING_CATEGORY_LABELS: Record<HrDecouplingCategory, string> = {
  d30: '30 a 60 min',
  d60: '60 a 90 min',
  d90: '90 a 120 min',
  d120: '120 a 150 min',
  d150: 'mais de 150 min',
};

// Faixas de duracao em movimento: 30–<60, 60–<90, 90–<120, 120–150 (150 inclusive), >150. Menos de 30 min nao tem faixa.
export function hrDecouplingCategoryOf(movingMinutes: number): HrDecouplingCategory | null {
  if (!Number.isFinite(movingMinutes) || movingMinutes < 30) return null;
  if (movingMinutes < 60) return 'd30';
  if (movingMinutes < 90) return 'd60';
  if (movingMinutes < 120) return 'd90';
  if (movingMinutes <= 150) return 'd120';
  return 'd150';
}

export function hrDecouplingVariableId(category: HrDecouplingCategory): string {
  return `activity.hrDecoupling.${category}`;
}

export interface SeriesPointInput {
  offsetSec: number;
  heartRateBpm: number | null;
  speedKmh: number | null;
}

export type HrDecouplingExclusionReason =
  | 'sem_serie_temporal'
  | 'sem_amostras_validas'
  | 'trecho_curto'
  | 'duracao_fora_das_faixas'
  | 'cobertura_insuficiente'
  | 'cv_velocidade_acima_do_limite'
  | 'diferenca_entre_metades_acima_do_limite'
  | 'cv_e_diferenca_acima_do_limite'
  | 'interrupcao_acima_da_tolerancia'
  | 'eventos_acima_do_limite_acumulado'
  | 'padrao_sistematico_de_eventos'
  | 'exclusoes_assimetricas';

export type HrDecouplingQuality = 'valid' | 'valid_with_caveats' | 'inconclusive';

export interface HrDecouplingResult {
  eligible: boolean;
  exclusionReason: HrDecouplingExclusionReason | null;
  category: HrDecouplingCategory | null;
  // trecho analisado (segundos desde o inicio da atividade) e duracao em movimento (soma da cobertura das amostras de velocidade > 0)
  analyzedStartSec: number | null;
  analyzedEndSec: number | null;
  movingSec: number | null;
  meanSpeed1: number | null;
  meanSpeed2: number | null;
  meanHr1: number | null;
  meanHr2: number | null;
  r1: number | null;
  r2: number | null;
  decouplingPct: number | null;
  speedCvPct: number | null;
  halfDiffPct: number | null;
  coverageHr1: number | null;
  coverageHr2: number | null;
  coverageSpeed1: number | null;
  coverageSpeed2: number | null;
  validHrSamples: number;
  validSpeedSamples: number;
  discardedHrSamples: number;
  discardedSpeedSamples: number;
  gapCount: number;
  pointCount: number;
  // Qualidade e auditoria (versao 2). eligible = valido OU valido com ressalvas.
  qualityStatus: HrDecouplingQuality | null;
  transientEventCount: number | null; // eventos tolerados e excluidos
  transientEventSec: number | null; // duracao acumulada desses eventos
  excludedSec: number | null; // tempo total excluido (eventos + estabilizacao da FC)
  excludedPct: number | null; // excludedSec em % do trecho analisado
  sustainedEventCount: number | null; // oscilacoes > maxEventSec (nao toleradas; julgadas pelo CV e pelas metades)
}

interface Sample { t: number; v: number }

function emptyResult(pointCount: number): HrDecouplingResult {
  return {
    eligible: false, exclusionReason: null, category: null, analyzedStartSec: null, analyzedEndSec: null, movingSec: null,
    meanSpeed1: null, meanSpeed2: null, meanHr1: null, meanHr2: null, r1: null, r2: null, decouplingPct: null, speedCvPct: null, halfDiffPct: null,
    coverageHr1: null, coverageHr2: null, coverageSpeed1: null, coverageSpeed2: null,
    validHrSamples: 0, validSpeedSamples: 0, discardedHrSamples: 0, discardedSpeedSamples: 0, gapCount: 0, pointCount,
    qualityStatus: null, transientEventCount: null, transientEventSec: null, excludedSec: null, excludedPct: null, sustainedEventCount: null,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface SpeedEvent { startT: number; endT: number; hasStop: boolean; tolerated: boolean }

// Eventos de velocidade dentro de [start, end]. Referencia = mediana das amostras de velocidade > 0 da janela centrada de referenceWindowSec (tempos reais). Amostra sem referencia (menos de
// 3 amostras positivas na janela) nao e' avaliada, a nao ser que seja parada (velocidade 0, sempre fora da faixa).
function detectSpeedEvents(speed: Sample[], start: number, end: number, params: HrDecouplingParams): SpeedEvent[] {
  const half = params.referenceWindowSec / 2;
  const deviating: boolean[] = new Array(speed.length).fill(false);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < speed.length; i++) {
    const s = speed[i];
    if (s.t < start || s.t > end) continue;
    if (s.v === 0) { deviating[i] = true; continue; }
    while (lo < speed.length && speed[lo].t < s.t - half) lo++;
    if (hi < lo) hi = lo;
    while (hi < speed.length && speed[hi].t <= s.t + half) hi++;
    const window: number[] = [];
    for (let j = lo; j < hi; j++) if (speed[j].v > 0) window.push(speed[j].v);
    if (window.length < 3) continue;
    const reference = median(window);
    deviating[i] = (100 * Math.abs(s.v - reference)) / reference > params.eventDeviationPct;
  }

  const runs: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < speed.length; i++) {
    if (!deviating[i]) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1 && speed[i].t - speed[i - 1].t <= MAX_GAP_SEC) last.to = i; else runs.push({ from: i, to: i });
  }
  const spanOf = (run: { from: number; to: number }) => {
    const lastNext = run.to + 1 < speed.length ? speed[run.to + 1].t - speed[run.to].t : null;
    const lastDt = Math.min(lastNext ?? (run.to > 0 ? speed[run.to].t - speed[run.to - 1].t : 1), MAX_GAP_SEC);
    return { startT: speed[run.from].t, endT: speed[run.to].t + lastDt };
  };
  // Mesmo evento: trechos fora da faixa separados por menos de mergeGapSec.
  const merged: Array<{ from: number; to: number }> = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && spanOf(run).startT - spanOf(last).endT <= params.mergeGapSec) last.to = run.to; else merged.push({ ...run });
  }
  return merged.map((run) => {
    const { startT, endT } = spanOf(run);
    let hasStop = false;
    for (let i = run.from; i <= run.to; i++) if (speed[i].v === 0) { hasStop = true; break; }
    const nextOk = run.to + 1 < speed.length ? speed[run.to + 1] : null;
    const recovered = nextOk != null && nextOk.t - speed[run.to].t <= params.recoverySec;
    const tolerated = endT - startT <= params.maxEventSec && recovered;
    return { startT, endT, hasStop, tolerated };
  });
}

// Segundos "cobertos" por cada amostra: ate a proxima amostra valida do MESMO canal, no maximo MAX_GAP_SEC; a ultima usa o intervalo anterior (ou 1 s). Lacunas maiores nao contam.
function coverageWeights(samples: Sample[]): { weights: number[]; gaps: number } {
  const weights: number[] = [];
  let gaps = 0;
  for (let i = 0; i < samples.length; i++) {
    const next = i + 1 < samples.length ? samples[i + 1].t - samples[i].t : null;
    const dt = next ?? (i > 0 ? Math.min(samples[i].t - samples[i - 1].t, MAX_GAP_SEC) : 1);
    if (next != null && next > MAX_GAP_SEC) gaps += 1;
    weights.push(Math.min(dt, MAX_GAP_SEC));
  }
  return { weights, gaps };
}

// Media ponderada pelo tempo coberto de cada amostra; cobertura = tempo coberto / duracao da metade.
function halfStats(samples: Sample[], from: number, to: number, includeEnd: boolean): { mean: number | null; coverage: number; covered: number } {
  const inside = samples.filter((s) => s.t >= from && (includeEnd ? s.t <= to : s.t < to));
  if (inside.length === 0) return { mean: null, coverage: 0, covered: 0 };
  const { weights } = coverageWeights(inside);
  const covered = weights.reduce((a, b) => a + b, 0);
  const mean = inside.reduce((acc, s, i) => acc + s.v * weights[i], 0) / covered;
  return { mean, coverage: Math.min(1, covered / (to - from)), covered };
}

export function computeHrDecoupling(points: SeriesPointInput[], params: HrDecouplingParams = HR_DECOUPLING_PARAMS): HrDecouplingResult {
  const result = emptyResult(points.length);
  const inconclusive = (reason: HrDecouplingExclusionReason): HrDecouplingResult => ({ ...result, exclusionReason: reason, qualityStatus: 'inconclusive' });
  if (points.length === 0) return inconclusive('sem_serie_temporal');

  const sorted = [...points].sort((a, b) => a.offsetSec - b.offsetSec);
  // Velocidade 0 e' parada REAL (evento); so' valor negativo ou nao numerico e' descartado.
  const speedAll: Sample[] = [];
  const hr: Sample[] = [];
  for (const p of sorted) {
    if (p.speedKmh != null) {
      if (Number.isFinite(p.speedKmh) && p.speedKmh >= 0) speedAll.push({ t: p.offsetSec, v: p.speedKmh }); else result.discardedSpeedSamples += 1;
    }
    if (p.heartRateBpm != null) {
      if (Number.isFinite(p.heartRateBpm) && p.heartRateBpm >= MIN_VALID_HR_BPM && p.heartRateBpm <= MAX_VALID_HR_BPM) hr.push({ t: p.offsetSec, v: p.heartRateBpm }); else result.discardedHrSamples += 1;
    }
  }
  result.validSpeedSamples = speedAll.length;
  result.validHrSamples = hr.length;
  result.gapCount = coverageWeights(speedAll).gaps + coverageWeights(hr).gaps;
  if (speedAll.length < 2 || hr.length < 2) return inconclusive('sem_amostras_validas');

  // O trecho valido e' a interseccao dos dois canais: so' onde ha' velocidade E FC faz sentido comparar.
  const start = Math.max(speedAll[0].t, hr[0].t);
  const end = Math.min(speedAll[speedAll.length - 1].t, hr[hr.length - 1].t);
  if (!(end > start)) return inconclusive('sem_amostras_validas');
  result.analyzedStartSec = start;
  result.analyzedEndSec = end;
  const middle = start + (end - start) / 2;
  const analyzedSec = end - start;

  // Duracao em movimento (para a faixa): soma da cobertura das amostras com velocidade > 0, ANTES de qualquer exclusao.
  const movingInside = speedAll.filter((s) => s.v > 0 && s.t >= start && s.t <= end);
  const movingSec = coverageWeights(movingInside).weights.reduce((a, b) => a + b, 0);
  result.movingSec = movingSec;
  if (analyzedSec < 60) return inconclusive('trecho_curto');
  const category = hrDecouplingCategoryOf(movingSec / 60);
  result.category = category;

  // Eventos transitorios.
  const events = detectSpeedEvents(speedAll, start, end, params);
  const tolerated = events.filter((e) => e.tolerated);
  const sustained = events.filter((e) => !e.tolerated);
  const longStop = sustained.some((e) => e.hasStop);
  const toleratedSec = tolerated.reduce((acc, e) => acc + (e.endT - e.startT), 0);
  result.transientEventCount = tolerated.length;
  result.transientEventSec = toleratedSec;
  result.sustainedEventCount = sustained.filter((e) => !e.hasStop).length;

  // Exclusao: evento + estabilizacao da FC, nos DOIS canais (mesmo intervalo), unindo sobreposicoes.
  const intervals: Array<[number, number]> = [];
  for (const e of tolerated) {
    const from = e.startT;
    const to = Math.min(end, e.endT + params.hrStabilizationSec);
    const last = intervals[intervals.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to); else intervals.push([from, to]);
  }
  const isExcluded = (t: number) => intervals.some(([a, b]) => t >= a && t < b);
  const speed = speedAll.filter((s) => !isExcluded(s.t));
  const hrKept = hr.filter((s) => !isExcluded(s.t));
  const excludedWithin = (from: number, to: number) => intervals.reduce((acc, [a, b]) => acc + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
  const excludedSec = excludedWithin(start, end);
  result.excludedSec = excludedSec;
  result.excludedPct = (100 * excludedSec) / analyzedSec;
  const excl1 = (100 * excludedWithin(start, middle)) / (middle - start);
  const excl2 = (100 * excludedWithin(middle, end)) / (end - middle);

  const s1 = halfStats(speed, start, middle, false);
  const s2 = halfStats(speed, middle, end, true);
  const h1 = halfStats(hrKept, start, middle, false);
  const h2 = halfStats(hrKept, middle, end, true);
  result.coverageSpeed1 = s1.coverage; result.coverageSpeed2 = s2.coverage; result.coverageHr1 = h1.coverage; result.coverageHr2 = h2.coverage;
  result.meanSpeed1 = s1.mean; result.meanSpeed2 = s2.mean; result.meanHr1 = h1.mean; result.meanHr2 = h2.mean;

  if (category == null) return inconclusive('duracao_fora_das_faixas');

  // Interrupcoes que nao sao transitorias: parada maior que a tolerancia.
  if (longStop) return inconclusive('interrupcao_acima_da_tolerancia');
  // Frequencia e tempo acumulado dos eventos tolerados.
  const maxEvents = Math.max(params.eventsMinCount, Math.floor(analyzedSec / 60 / params.eventsPerMinutesDivisor));
  const tooClose = tolerated.some((e, i) => i > 0 && e.startT - tolerated[i - 1].startT < params.minEventSpacingSec);
  if ((100 * toleratedSec) / analyzedSec > params.maxEventsTimePct) return inconclusive('eventos_acima_do_limite_acumulado');
  if (tolerated.length > maxEvents || tooClose) return inconclusive('padrao_sistematico_de_eventos');

  if ([s1.coverage, s2.coverage, h1.coverage, h2.coverage].some((c) => c < MIN_HALF_COVERAGE) || s1.mean == null || s2.mean == null || h1.mean == null || h2.mean == null) {
    return inconclusive('cobertura_insuficiente');
  }
  // Vies: se as exclusoes caem quase todas numa metade, o resultado nao e' comparavel.
  if (Math.abs(excl1 - excl2) > params.maxExclusionAsymmetryPct) return inconclusive('exclusoes_assimetricas');

  // R1/R2 e o desacoplamento sao sempre guardados (rastreio), mesmo quando a corrida nao e' elegivel.
  const r1 = s1.mean / h1.mean;
  const r2 = s2.mean / h2.mean;
  result.r1 = r1;
  result.r2 = r2;
  result.decouplingPct = 100 * (1 - r2 / r1);

  // CV da velocidade (populacional, ponderado pelo tempo coberto) sobre o trecho analisado, JA SEM os eventos tolerados.
  const speedInside = speed.filter((s) => s.t >= start && s.t <= end);
  const { weights } = coverageWeights(speedInside);
  const total = weights.reduce((a, b) => a + b, 0);
  const mean = speedInside.reduce((acc, s, i) => acc + s.v * weights[i], 0) / total;
  const variance = speedInside.reduce((acc, s, i) => acc + weights[i] * (s.v - mean) ** 2, 0) / total;
  result.speedCvPct = (100 * Math.sqrt(variance)) / mean;
  result.halfDiffPct = (100 * Math.abs(s2.mean - s1.mean)) / s1.mean;

  const cvFails = result.speedCvPct > MAX_SPEED_CV_PCT;
  const diffFails = result.halfDiffPct > MAX_HALF_DIFF_PCT;
  if (cvFails || diffFails) {
    return { ...result, qualityStatus: 'inconclusive', exclusionReason: cvFails && diffFails ? 'cv_e_diferenca_acima_do_limite' : cvFails ? 'cv_velocidade_acima_do_limite' : 'diferenca_entre_metades_acima_do_limite' };
  }
  return { ...result, eligible: true, qualityStatus: tolerated.length > 0 ? 'valid_with_caveats' : 'valid' };
}

// Texto curto do motivo de exclusao (admin e Evolucao); descreve o criterio, nao julga a corrida.
export const HR_DECOUPLING_REASON_TEXT: Record<HrDecouplingExclusionReason, string> = {
  sem_serie_temporal: 'Sem registro segundo a segundo desta corrida',
  sem_amostras_validas: 'Sem amostras válidas de velocidade e frequência cardíaca ao mesmo tempo',
  trecho_curto: 'Trecho analisável curto demais',
  duracao_fora_das_faixas: 'Duração em movimento menor que 30 minutos',
  cobertura_insuficiente: 'Registros insuficientes em uma das metades (menos de 80% do tempo coberto)',
  cv_velocidade_acima_do_limite: 'Velocidade variou mais de 10% (CV) ao longo da corrida',
  diferenca_entre_metades_acima_do_limite: 'Velocidade média das metades diferiu mais de 5%',
  cv_e_diferenca_acima_do_limite: 'Velocidade variou mais de 10% (CV) e as metades diferiram mais de 5%',
  interrupcao_acima_da_tolerancia: 'Parada de mais de 10 segundos durante a corrida',
  eventos_acima_do_limite_acumulado: 'Oscilações de velocidade somaram mais de 3% do tempo da corrida',
  padrao_sistematico_de_eventos: 'Oscilações de velocidade frequentes ou muito próximas entre si',
  exclusoes_assimetricas: 'Trechos excluídos concentrados em uma das metades da corrida',
};

export const HR_DECOUPLING_QUALITY_TEXT: Record<HrDecouplingQuality, string> = {
  valid: 'Válido',
  valid_with_caveats: 'Válido com ressalvas',
  inconclusive: 'Inconclusivo',
};
