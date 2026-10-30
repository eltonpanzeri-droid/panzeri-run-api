// Modelos de estimativa do perfil aeróbio (Testes físicos, Lote 2, 30/10/2026). Funções PURAS, sem banco.
// Documentação, referências e limitações: TESTES_FISICOS_LOTE1_MODELOS.md (raiz do repositório).
//
// Estas funções PRODUZEM REFERÊNCIAS fisiológicas rotuladas (origem, confiança, faixa). Elas NÃO decidem treino:
// quem prescreve é a IA, que recebe o número junto do rótulo e pode se afastar dele com justificativa.

export const MODEL_VERSION = 'daniels-gilbert-1979+esteve-lanao-2026+tanaka-gulati@1';

// ---- conversões (a velocidade em km/h é a representação canônica; o pace é só exibição) ----
export const kmhToPaceSeconds = (kmh: number) => 3600 / kmh;
export const paceSecondsToKmh = (secondsPerKm: number) => 3600 / secondsPerKm;
export function formatPaceSeconds(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

// ---- Daniels e Gilbert (1979): custo de oxigênio da velocidade e fração do VO2máx sustentável pela duração ----
// v em metros por minuto, t em minutos.
export const danielsOxygenCost = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;
export const danielsSustainedFraction = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
export function danielsSpeedAtVo2(vo2: number): number {
  const a = 0.000104, b = 0.182258, c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}
// Início das tabelas de Daniels (VDOT 30). Abaixo disso o modelo está fora do domínio publicado (fronteira a conferir em fonte primária).
export const DANIELS_MIN_VDOT = 30;

export function danielsFromPerformance(distanceMeters: number, totalSeconds: number) {
  const minutes = totalSeconds / 60;
  const vdot = danielsOxygenCost(distanceMeters / minutes) / danielsSustainedFraction(minutes);
  const vvo2Kmh = (danielsSpeedAtVo2(vdot) * 60) / 1000;
  return { vdot, vvo2Kmh, inDomain: vdot >= DANIELS_MIN_VDOT };
}

// ---- FC máxima por idade (só quando não há FC máxima observada) ----
export type Sex = 'M' | 'F' | null;
export function normalizeSex(value: string | null | undefined): Sex {
  const v = (value ?? '').trim().toLowerCase();
  if (['f', 'fem', 'feminino', 'female', 'mulher'].includes(v)) return 'F';
  if (['m', 'masc', 'masculino', 'male', 'homem'].includes(v)) return 'M';
  return null;
}
export function ageOn(birthDate: Date | null | undefined, on: Date): number | null {
  if (!birthDate) return null;
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday = on.getUTCMonth() < birthDate.getUTCMonth() || (on.getUTCMonth() === birthDate.getUTCMonth() && on.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 10 && age <= 100 ? age : null;
}
// Tanaka et al. (2001): 208 - 0,7 x idade (meta-análise com homens e mulheres; usada para homens e para sexo não informado).
// Gulati et al. (2010): 206 - 0,88 x idade (mulheres assintomáticas).
export const predictedMaxHeartRate = (sex: Sex, age: number) => (sex === 'F' ? 206 - 0.88 * age : 208 - 0.7 * age);

// ---- Esteve-Lanao et al. (2026, Sports 14(1):29): limiares medidos em 1.411 corredores treinados ----
// Percentuais da velocidade no VO2pico e da FCpico, por sexo e nível de VO2pico (média e desvio-padrão).
type Pct = [mean: number, sd: number];
type Level = 'elite' | 'high' | 'moderate' | 'lowModerate' | 'low';
interface LevelRow { hrVt2: Pct; hrVt1: Pct; spVt2: Pct; spVt1: Pct }
const LEVELS: Level[] = ['elite', 'high', 'moderate', 'lowModerate', 'low'];
const rows = (hrVt2: Pct[], hrVt1: Pct[], spVt2: Pct[], spVt1: Pct[]): Record<Level, LevelRow> =>
  Object.fromEntries(LEVELS.map((level, i) => [level, { hrVt2: hrVt2[i], hrVt1: hrVt1[i], spVt2: spVt2[i], spVt1: spVt1[i] }])) as Record<Level, LevelRow>;
export const ESTEVE_LANAO_2026: { M: Record<Level, LevelRow>; F: Record<Level, LevelRow>; all: LevelRow } = {
  M: rows(
    [[90.8, 2.1], [91.9, 2.4], [92.7, 2.5], [93.0, 2.5], [93.4, 2.4]],
    [[80.5, 3.9], [81.8, 4.7], [83.3, 5.2], [84.5, 4.2], [84.8, 4.6]],
    [[86.5, 3.6], [86.7, 3.7], [86.8, 3.9], [86.7, 3.8], [87.1, 4.0]],
    [[72.8, 3.8], [73.5, 3.9], [73.1, 5.0], [73.2, 4.7], [72.9, 5.6]],
  ),
  F: rows(
    [[94.7, 1.9], [93.9, 1.9], [94.9, 2.0], [94.7, 2.2], [94.0, 2.3]],
    [[86.2, 3.6], [85.9, 4.9], [87.4, 3.6], [87.3, 3.6], [86.0, 4.5]],
    [[89.4, 3.7], [87.9, 3.4], [88.9, 3.4], [89.5, 3.2], [88.4, 3.9]],
    [[76.8, 2.9], [75.2, 3.6], [77.5, 3.3], [76.7, 4.9], [74.5, 6.2]],
  ),
  // amostra inteira (sexo não informado)
  all: { hrVt2: [93.5, 2.5], hrVt1: [85.1, 4.6], spVt2: [87.6, 3.9], spVt1: [73.9, 5.5] },
};
// Limites inferiores de VO2pico (ml/kg/min) de cada nível, conforme o artigo.
const LEVEL_FLOORS: Record<'M' | 'F', Array<[Level, number]>> = {
  M: [['elite', 75.4], ['high', 70.8], ['moderate', 62.2], ['lowModerate', 54.2]],
  F: [['elite', 66.2], ['high', 61.7], ['moderate', 55.8], ['lowModerate', 49.7]],
};
export function levelFor(sex: 'M' | 'F', vo2: number): Level {
  for (const [level, floor] of LEVEL_FLOORS[sex]) if (level === 'elite' ? vo2 > floor : vo2 >= floor) return level;
  return 'low';
}

// ---- resultado ----
export type Origin = 'measured' | 'reported' | 'estimated';
export type Confidence = 'alta' | 'moderada' | 'baixa';
export interface Indicator {
  key: string; value: number; unit: string; origin: Origin; confidence: Confidence;
  rangeLow?: number; rangeHigh?: number; basis: Record<string, unknown>;
}
export interface Zone { id: 'Z1' | 'Z2' | 'Z3'; label: string; speedKmh: [number, number]; paceSecondsPerKm: [number, number | null]; heartRate?: [number, number] }
export interface PerformanceEstimate { indicators: Indicator[]; zones: Zone[]; limitations: string[]; modelVersion: string }

// Zonas (modelo de tres zonas): abaixo de L1, entre L1 e L2, acima de L2 ate a velocidade no VO2max. Pace: [mais rapido, mais lento].
export function zonesFrom(p: { l1: number; l2: number; vvo2: number; l1Hr: number | null; l2Hr: number | null; hrMax: number | null }): Zone[] {
  const zone = (id: Zone['id'], label: string, from: number, to: number, hr?: [number, number]): Zone => ({ id, label, speedKmh: [round(from, 2), round(to, 2)], paceSecondsPerKm: [round(kmhToPaceSeconds(to), 0), from > 0 ? round(kmhToPaceSeconds(from), 0) : null], ...(hr ? { heartRate: hr } : {}) });
  return [
    zone('Z1', 'Abaixo de L1', 0, p.l1, p.l1Hr != null ? [0, p.l1Hr] : undefined),
    zone('Z2', 'Entre L1 e L2', p.l1, p.l2, p.l1Hr != null && p.l2Hr != null ? [p.l1Hr, p.l2Hr] : undefined),
    zone('Z3', 'Acima de L2', p.l2, p.vvo2, p.l2Hr != null && p.hrMax != null ? [p.l2Hr, p.hrMax] : undefined),
  ];
}

export const THRESHOLD_LIMITATION = 'L1 e L2 vêm de percentuais medidos em corredores treinados com exames de gases (Esteve-Lanao et al., 2026). Aplicados a uma velocidade estimada, somam a incerteza da estimativa. Para quem caminhou parte do teste ou está muito destreinado, são só uma referência.';

// L1, L2 e zonas a partir da velocidade no VO2máx (medida, informada ou estimada) e da FC máxima.
export function estimateThresholdsAndZones(input: { vvo2: number; vo2: number | null; hrMax: number | null; hrIsReal: boolean; sex: Sex; lowBase: boolean }): { indicators: Indicator[]; zones: Zone[] } {
  const { vvo2, vo2, hrMax } = input;
  const indicators: Indicator[] = [];
  const table = input.sex && vo2 != null ? ESTEVE_LANAO_2026[input.sex][levelFor(input.sex, vo2)] : ESTEVE_LANAO_2026.all;
  const l2Confidence: Confidence = input.lowBase ? 'baixa' : 'moderada';
  const speed = (pct: Pct, key: string, hrPct: Pct, hrKey: string, confidence: Confidence) => {
    const [mean, sd] = pct;
    indicators.push({ key, value: round((vvo2 * mean) / 100, 2), unit: 'km/h', origin: 'estimated', confidence, rangeLow: round((vvo2 * (mean - sd)) / 100, 2), rangeHigh: round((vvo2 * (mean + sd)) / 100, 2), basis: { model: 'esteve-lanao-2026', percentualDaVelocidadeNoVo2: mean, desvioPadrao: sd } });
    if (hrMax != null) {
      const [hMean, hSd] = hrPct;
      indicators.push({ key: hrKey, value: round((hrMax * hMean) / 100, 0), unit: 'bpm', origin: 'estimated', confidence: input.hrIsReal ? confidence : 'baixa', rangeLow: round((hrMax * (hMean - hSd)) / 100, 0), rangeHigh: round((hrMax * (hMean + hSd)) / 100, 0), basis: { model: 'esteve-lanao-2026', percentualDaFcMaxima: hMean, desvioPadrao: hSd } });
    }
  };
  speed(table.spVt1, 'l1_speed_kmh', table.hrVt1, 'l1_hr_bpm', 'baixa'); // L1 é o limiar mais difícil de estimar sem exame
  speed(table.spVt2, 'l2_speed_kmh', table.hrVt2, 'l2_hr_bpm', l2Confidence);

  const value = (key: string) => indicators.find((i) => i.key === key)?.value;
  const zones = zonesFrom({ l1: value('l1_speed_kmh')!, l2: value('l2_speed_kmh')!, vvo2, l1Hr: value('l1_hr_bpm') ?? null, l2Hr: value('l2_hr_bpm') ?? null, hrMax });
  return { indicators, zones };
}

// FC maxima: a informada/observada vale mais; sem ela, a prevista pela idade (confianca baixa); sem idade, nada e presumido.
export function resolveHrMax(p: { provided: number | null; observed: number | null; sex: Sex; age: number | null }): { hrMax: number | null; indicator?: Indicator; limitations: string[] } {
  if (p.provided != null) return { hrMax: p.provided, limitations: [] };
  const predicted = p.age != null ? round(predictedMaxHeartRate(p.sex, p.age), 0) : null;
  if (p.observed != null) {
    return {
      hrMax: p.observed,
      indicator: { key: 'hrmax_bpm', value: p.observed, unit: 'bpm', origin: 'reported', confidence: 'moderada', basis: { kind: 'maior_fc_no_teste', previstaPelaIdade: predicted, diferencaBpm: predicted != null ? p.observed - predicted : null } },
      limitations: ['A maior FC do teste só equivale à FC máxima se o esforço foi realmente máximo. Ela pode ficar abaixo da FC máxima real.'],
    };
  }
  if (predicted != null && p.age != null) {
    return {
      hrMax: predicted,
      indicator: { key: 'hrmax_bpm', value: predicted, unit: 'bpm', origin: 'estimated', confidence: 'baixa', basis: { model: p.sex === 'F' ? 'gulati-2010' : 'tanaka-2001', idade: p.age } },
      limitations: ['Sem FC informada, a FC máxima foi estimada pela idade, com desvio individual grande. As zonas de FC têm confiança baixa.'],
    };
  }
  return { hrMax: null, limitations: ['Sem FC informada e sem data de nascimento, as zonas de frequência cardíaca não foram geradas (nada foi presumido).'] };
}

export interface EstimateInput {
  distanceMeters: number; totalSeconds: number;
  observedMaxHeartRate?: number | null;
  sex: Sex; age: number | null;
  // o que o aluno ou profissional já informou: nunca é sobrescrito por estimativa
  provided?: Partial<Record<'vo2max' | 'vvo2max_kmh' | 'hrmax_bpm', number>>;
}

// Estima o perfil aeróbio a partir de UMA prova de distância conhecida (3 km, 5 km, Cooper 12 min com a distância percorrida).
export function estimateFromPerformance(input: EstimateInput): PerformanceEstimate {
  const { vdot, vvo2Kmh, inDomain } = danielsFromPerformance(input.distanceMeters, input.totalSeconds);
  const limitations: string[] = [
    'O VO₂máx estimado vem do desempenho na prova (modelo de Daniels e Gilbert): mistura capacidade aeróbia e economia de corrida e não equivale a uma medida de laboratório.',
    'O resultado depende de o esforço ter sido realmente máximo e do ritmo bem distribuído. Calor, vento, subidas e percurso mal medido distorcem o tempo.',
  ];
  if (!inDomain) limitations.push('O desempenho está abaixo da faixa em que o modelo de Daniels foi publicado (VDOT 30): valores com confiança baixa, sobretudo se parte do percurso foi caminhada.');
  const modelConfidence: Confidence = inDomain ? 'moderada' : 'baixa';
  const indicators: Indicator[] = [];
  const provided = input.provided ?? {};

  const vo2 = provided.vo2max ?? round(vdot, 1);
  const vvo2 = provided.vvo2max_kmh ?? round(vvo2Kmh, 2);
  if (provided.vo2max == null) indicators.push({ key: 'vo2max', value: vo2, unit: 'ml/kg/min', origin: 'estimated', confidence: modelConfidence, basis: { model: 'daniels-gilbert-1979', vdot: round(vdot, 2), distanceMeters: input.distanceMeters, totalSeconds: input.totalSeconds } });
  if (provided.vvo2max_kmh == null) indicators.push({ key: 'vvo2max_kmh', value: vvo2, unit: 'km/h', origin: 'estimated', confidence: modelConfidence, basis: { model: 'daniels-gilbert-1979', inversaoDoCustoDeOxigenio: true } });

  const hr = resolveHrMax({ provided: provided.hrmax_bpm ?? null, observed: input.observedMaxHeartRate ?? null, sex: input.sex, age: input.age });
  const hrMax = hr.hrMax;
  if (hr.indicator) indicators.push(hr.indicator);
  limitations.push(...hr.limitations);

  const thresholds = estimateThresholdsAndZones({ vvo2, vo2, hrMax, hrIsReal: input.observedMaxHeartRate != null || provided.hrmax_bpm != null, sex: input.sex, lowBase: !inDomain });
  indicators.push(...thresholds.indicators);
  const zones = thresholds.zones;
  limitations.push(THRESHOLD_LIMITATION);
  return { indicators, zones, limitations, modelVersion: MODEL_VERSION };
}

export const THREE_KM = 3000;
export const COOPER_SECONDS = 720;
