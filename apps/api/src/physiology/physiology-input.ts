// Entrada de avaliações externas (Testes físicos, Lote 2, 30/10/2026). Funções PURAS: validam estrutura, faixas e estados impossíveis.
// Não calculam conteúdo de treino e não inventam valores: campo ausente continua ausente.
import { paceSecondsToKmh } from './physiology-models';

export const ASSESSMENT_METHODS = ['ergospirometry', 'cooper_12min', 'three_km', 'five_km', 'incremental', 'lactate', 'other', 'unknown'] as const;
export type AssessmentMethodId = (typeof ASSESSMENT_METHODS)[number];
export const METHOD_LABELS: Record<string, string> = {
  ergospirometry: 'Ergoespirometria', cooper_12min: 'Teste de Cooper, 12 minutos', three_km: 'Teste de 3 km', five_km: 'Teste de 5 km',
  incremental: 'Teste incremental', lactate: 'Teste de lactato', other: 'Outro método', unknown: 'Método não informado',
};

// Resultados que o aluno ou o treinador podem informar. Velocidade em km/h OU pace em segundos por km (a mesma informação).
export interface ExternalResultsInput {
  vo2max?: number | null;
  vvo2max_kmh?: number | null; vvo2max_pace_seconds?: number | null;
  hrmax_bpm?: number | null;
  l1_speed_kmh?: number | null; l1_pace_seconds?: number | null; l1_hr_bpm?: number | null; l1_vo2?: number | null; l1_vo2_pct?: number | null;
  l2_speed_kmh?: number | null; l2_pace_seconds?: number | null; l2_hr_bpm?: number | null; l2_vo2?: number | null; l2_vo2_pct?: number | null;
  // desempenho bruto, quando o método é uma prova (3 km, 5 km, Cooper)
  totalSeconds?: number | null; distanceMeters?: number | null;
}

export type CanonicalKey = 'vo2max' | 'vvo2max_kmh' | 'hrmax_bpm' | 'l1_speed_kmh' | 'l1_hr_bpm' | 'l1_vo2' | 'l2_speed_kmh' | 'l2_hr_bpm' | 'l2_vo2';
export const INDICATOR_UNITS: Record<CanonicalKey, string> = {
  vo2max: 'ml/kg/min', vvo2max_kmh: 'km/h', hrmax_bpm: 'bpm', l1_speed_kmh: 'km/h', l1_hr_bpm: 'bpm', l1_vo2: 'ml/kg/min', l2_speed_kmh: 'km/h', l2_hr_bpm: 'bpm', l2_vo2: 'ml/kg/min',
};

const RANGES: Record<string, [number, number, string]> = {
  vo2max: [10, 100, 'VO₂máx'], l1_vo2: [8, 100, 'VO₂ no L1'], l2_vo2: [8, 100, 'VO₂ no L2'],
  speed: [3, 30, 'velocidade'], pace: [120, 1200, 'pace (segundos por km)'], hr: [30, 230, 'frequência cardíaca'],
  totalSeconds: [60, 21600, 'tempo'], distanceMeters: [500, 60000, 'distância'],
};

export interface NormalizedExternal {
  indicators: Partial<Record<CanonicalKey, number>>;
  performance: { totalSeconds: number; distanceMeters: number } | null;
  errors: string[];
}

const present = (v: unknown): v is number => v !== null && v !== undefined && v !== ('' as unknown);

export function normalizeExternalResults(method: string, input: ExternalResultsInput): NormalizedExternal {
  const errors: string[] = [];
  const indicators: Partial<Record<CanonicalKey, number>> = {};
  const check = (label: string, value: unknown, range: [number, number, string]): number | null => {
    if (!present(value)) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`${label}: valor inválido.`); return null; }
    if (value < range[0] || value > range[1]) { errors.push(`${label}: valor fora do intervalo possível (${range[0]} a ${range[1]}).`); return null; }
    return value;
  };
  const speed = (key: 'vvo2max_kmh' | 'l1_speed_kmh' | 'l2_speed_kmh', label: string, kmh: unknown, pace: unknown) => {
    const s = check(label, kmh, RANGES.speed);
    const p = check(`${label} (pace)`, pace, RANGES.pace);
    if (s !== null && p !== null && Math.abs(paceSecondsToKmh(p) - s) > 0.1) errors.push(`${label}: velocidade e pace informados não correspondem entre si.`);
    const value = s ?? (p !== null ? paceSecondsToKmh(p) : null);
    if (value !== null) indicators[key] = Math.round(value * 100) / 100;
  };
  const plain = (key: CanonicalKey, label: string, value: unknown, range: [number, number, string]) => { const v = check(label, value, range); if (v !== null) indicators[key] = key === 'hrmax_bpm' || key.endsWith('_hr_bpm') ? Math.round(v) : v; };

  plain('vo2max', 'VO₂máx', input.vo2max, RANGES.vo2max);
  speed('vvo2max_kmh', 'Velocidade no VO₂máx', input.vvo2max_kmh, input.vvo2max_pace_seconds);
  plain('hrmax_bpm', 'FC máxima', input.hrmax_bpm, RANGES.hr);
  speed('l1_speed_kmh', 'Velocidade no L1', input.l1_speed_kmh, input.l1_pace_seconds);
  plain('l1_hr_bpm', 'FC no L1', input.l1_hr_bpm, RANGES.hr);
  plain('l1_vo2', 'VO₂ no L1', input.l1_vo2, RANGES.l1_vo2);
  speed('l2_speed_kmh', 'Velocidade no L2', input.l2_speed_kmh, input.l2_pace_seconds);
  plain('l2_hr_bpm', 'FC no L2', input.l2_hr_bpm, RANGES.hr);
  plain('l2_vo2', 'VO₂ no L2', input.l2_vo2, RANGES.l2_vo2);

  // Laudos de ergoespirometria trazem o VO₂ dos limiares em % do máximo: converte para ml/kg/min com o VO₂máx do mesmo exame (o % informado fica no resultado original).
  const pct = (key: 'l1_vo2' | 'l2_vo2', label: string, value: unknown) => {
    if (!present(value)) return;
    if (indicators[key] !== undefined) { errors.push(`${label}: informe em ml/kg/min ou em % do VO₂máx, não os dois.`); return; }
    const v = check(`${label} (% do VO₂máx)`, value, [10, 100, '%']);
    if (v === null) return;
    if (indicators.vo2max === undefined) { errors.push(`${label}: para informar em % do VO₂máx, informe também o VO₂máx do exame.`); return; }
    indicators[key] = Math.round(indicators.vo2max * v) / 100;
  };
  pct('l1_vo2', 'VO₂ no L1', input.l1_vo2_pct);
  pct('l2_vo2', 'VO₂ no L2', input.l2_vo2_pct);

  // Estados impossíveis (estrutura, não prescrição): L1 abaixo de L2 abaixo do VO₂máx, e o mesmo para a FC.
  const ordered = (a: CanonicalKey, b: CanonicalKey, text: string) => { if (indicators[a] !== undefined && indicators[b] !== undefined && indicators[a]! >= indicators[b]!) errors.push(text); };
  ordered('l1_speed_kmh', 'l2_speed_kmh', 'A velocidade no L1 precisa ser menor que a do L2.');
  ordered('l2_speed_kmh', 'vvo2max_kmh', 'A velocidade no L2 precisa ser menor que a do VO₂máx.');
  ordered('l1_speed_kmh', 'vvo2max_kmh', 'A velocidade no L1 precisa ser menor que a do VO₂máx.');
  ordered('l1_hr_bpm', 'l2_hr_bpm', 'A FC no L1 precisa ser menor que a do L2.');
  ordered('l2_hr_bpm', 'hrmax_bpm', 'A FC no L2 precisa ser menor que a FC máxima.');
  ordered('l1_hr_bpm', 'hrmax_bpm', 'A FC no L1 precisa ser menor que a FC máxima.');
  ordered('l1_vo2', 'l2_vo2', 'O VO₂ no L1 precisa ser menor que o do L2.');
  ordered('l2_vo2', 'vo2max', 'O VO₂ no L2 precisa ser menor que o VO₂máx.');

  // Desempenho bruto (provas). Cooper tem tempo fixo de 12 minutos; só a distância é informada.
  let performance: NormalizedExternal['performance'] = null;
  const time = check('Tempo', input.totalSeconds, RANGES.totalSeconds);
  const distance = check('Distância', input.distanceMeters, RANGES.distanceMeters);
  if (method === 'three_km' && time !== null) performance = { totalSeconds: time, distanceMeters: 3000 };
  else if (method === 'five_km' && time !== null) performance = { totalSeconds: time, distanceMeters: 5000 };
  else if (method === 'cooper_12min' && distance !== null) performance = { totalSeconds: 720, distanceMeters: distance };
  if ((method === 'three_km' || method === 'five_km') && distance !== null && distance !== (method === 'three_km' ? 3000 : 5000)) errors.push('A distância desse método é fixa; informe apenas o tempo.');

  if (Object.keys(indicators).length === 0 && performance === null && errors.length === 0) errors.push('Informe ao menos um resultado da avaliação.');
  return { indicators, performance, errors };
}

// Data real do teste: AAAA-MM-DD, existente no calendário, não futura e não anterior a 1990.
export function parsePerformedAt(value: string | null | undefined, today: Date): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() > todayUtc || date.getUTCFullYear() < 1990) return null;
  return date;
}
