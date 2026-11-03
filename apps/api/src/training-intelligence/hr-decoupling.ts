// Desacoplamento da frequencia cardiaca (03/11/2026, ordem de Elton). Matematica PURA (sem banco, sem relogio): recebe os pontos da serie temporal canonica de UMA corrida e devolve o valor
// ou o motivo da exclusao, sempre com a cobertura e as amostras descartadas. Nao classifica o valor como bom ou ruim e nao interpreta (quem descreve e' o texto da Evolucao e o contexto da IA).
//
// Formula: o trecho valido e' dividido em duas metades de IGUAL DURACAO; R = velocidade media da metade / FC media da metade;
//   desacoplamento (%) = 100 × (1 − R2 / R1). Positivo, negativo e zero sao preservados.
// Elegibilidade (dois criterios independentes, ambos obrigatorios, limites INCLUSIVOS): (A) CV da velocidade = 100 × desvio-padrao / media <= 10%;
//   (B) diferenca entre as metades = 100 × |V2 − V1| / V1 <= 5%. Sem filtro por zona de intensidade.
// Tratamento dos dados: sem interpolacao; cada canal (velocidade, FC) usa so' as suas amostras validas; lacuna maior que MAX_GAP_SEC nao conta como coberta.

export const HR_DECOUPLING_ALGORITHM_VERSION = 1;

export const MIN_VALID_HR_BPM = 30;
export const MAX_VALID_HR_BPM = 230;
export const MAX_GAP_SEC = 10;
export const MIN_HALF_COVERAGE = 0.8;
export const MAX_SPEED_CV_PCT = 10;
export const MAX_HALF_DIFF_PCT = 5;

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
  | 'cv_e_diferenca_acima_do_limite';

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
}

interface Sample { t: number; v: number }

function emptyResult(pointCount: number): HrDecouplingResult {
  return {
    eligible: false, exclusionReason: null, category: null, analyzedStartSec: null, analyzedEndSec: null, movingSec: null,
    meanSpeed1: null, meanSpeed2: null, meanHr1: null, meanHr2: null, r1: null, r2: null, decouplingPct: null, speedCvPct: null, halfDiffPct: null,
    coverageHr1: null, coverageHr2: null, coverageSpeed1: null, coverageSpeed2: null,
    validHrSamples: 0, validSpeedSamples: 0, discardedHrSamples: 0, discardedSpeedSamples: 0, gapCount: 0, pointCount,
  };
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

export function computeHrDecoupling(points: SeriesPointInput[]): HrDecouplingResult {
  const result = emptyResult(points.length);
  if (points.length === 0) return { ...result, exclusionReason: 'sem_serie_temporal' };

  const sorted = [...points].sort((a, b) => a.offsetSec - b.offsetSec);
  const speed: Sample[] = [];
  const hr: Sample[] = [];
  for (const p of sorted) {
    if (p.speedKmh != null) {
      if (Number.isFinite(p.speedKmh) && p.speedKmh > 0) speed.push({ t: p.offsetSec, v: p.speedKmh }); else result.discardedSpeedSamples += 1;
    }
    if (p.heartRateBpm != null) {
      if (Number.isFinite(p.heartRateBpm) && p.heartRateBpm >= MIN_VALID_HR_BPM && p.heartRateBpm <= MAX_VALID_HR_BPM) hr.push({ t: p.offsetSec, v: p.heartRateBpm }); else result.discardedHrSamples += 1;
    }
  }
  result.validSpeedSamples = speed.length;
  result.validHrSamples = hr.length;
  result.gapCount = coverageWeights(speed).gaps + coverageWeights(hr).gaps;
  if (speed.length < 2 || hr.length < 2) return { ...result, exclusionReason: 'sem_amostras_validas' };

  // O trecho valido e' a interseccao dos dois canais: so' onde ha' velocidade E FC faz sentido comparar.
  const start = Math.max(speed[0].t, hr[0].t);
  const end = Math.min(speed[speed.length - 1].t, hr[hr.length - 1].t);
  if (!(end > start)) return { ...result, exclusionReason: 'sem_amostras_validas' };
  result.analyzedStartSec = start;
  result.analyzedEndSec = end;
  const middle = start + (end - start) / 2;

  const speedInside = speed.filter((s) => s.t >= start && s.t <= end);
  const movingSec = coverageWeights(speedInside).weights.reduce((a, b) => a + b, 0);
  result.movingSec = movingSec;
  if (end - start < 60) return { ...result, exclusionReason: 'trecho_curto' };

  const category = hrDecouplingCategoryOf(movingSec / 60);
  result.category = category;

  const s1 = halfStats(speed, start, middle, false);
  const s2 = halfStats(speed, middle, end, true);
  const h1 = halfStats(hr, start, middle, false);
  const h2 = halfStats(hr, middle, end, true);
  result.coverageSpeed1 = s1.coverage; result.coverageSpeed2 = s2.coverage; result.coverageHr1 = h1.coverage; result.coverageHr2 = h2.coverage;
  result.meanSpeed1 = s1.mean; result.meanSpeed2 = s2.mean; result.meanHr1 = h1.mean; result.meanHr2 = h2.mean;

  if (category == null) return { ...result, exclusionReason: 'duracao_fora_das_faixas' };
  if ([s1.coverage, s2.coverage, h1.coverage, h2.coverage].some((c) => c < MIN_HALF_COVERAGE) || s1.mean == null || s2.mean == null || h1.mean == null || h2.mean == null) {
    return { ...result, exclusionReason: 'cobertura_insuficiente' };
  }

  // R1/R2 e o desacoplamento sao sempre guardados (rastreio), mesmo quando a corrida nao e' elegivel.
  const r1 = s1.mean / h1.mean;
  const r2 = s2.mean / h2.mean;
  result.r1 = r1;
  result.r2 = r2;
  result.decouplingPct = 100 * (1 - r2 / r1);

  // CV da velocidade (populacional, ponderado pelo tempo coberto) sobre todo o trecho analisado.
  const { weights } = coverageWeights(speedInside);
  const total = weights.reduce((a, b) => a + b, 0);
  const mean = speedInside.reduce((acc, s, i) => acc + s.v * weights[i], 0) / total;
  const variance = speedInside.reduce((acc, s, i) => acc + weights[i] * (s.v - mean) ** 2, 0) / total;
  result.speedCvPct = (100 * Math.sqrt(variance)) / mean;
  result.halfDiffPct = (100 * Math.abs(s2.mean - s1.mean)) / s1.mean;

  const cvFails = result.speedCvPct > MAX_SPEED_CV_PCT;
  const diffFails = result.halfDiffPct > MAX_HALF_DIFF_PCT;
  if (cvFails || diffFails) {
    return { ...result, exclusionReason: cvFails && diffFails ? 'cv_e_diferenca_acima_do_limite' : cvFails ? 'cv_velocidade_acima_do_limite' : 'diferenca_entre_metades_acima_do_limite' };
  }
  return { ...result, eligible: true };
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
};
