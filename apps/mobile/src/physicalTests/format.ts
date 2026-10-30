// Testes físicos (Lote 3, 30/10/2026): funções puras de formatação e leitura de campos. Sem React, para serem testáveis.

export type SpeedUnit = 'kmh' | 'pace';

// ---- tempo e pace ----
export function formatMinSec(totalSeconds: number): string {
  const total = Math.round(totalSeconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export const paceSecondsFromKmh = (kmh: number) => 3600 / kmh;
export const paceLabelFromKmh = (kmh: number) => `${formatMinSec(paceSecondsFromKmh(kmh))}/km`;
export function formatSpeed(kmh: number, unit: SpeedUnit): string {
  return unit === 'pace' ? paceLabelFromKmh(kmh) : `${kmh.toFixed(1).replace('.', ',')} km/h`;
}

// "20:35" ou "20.35" ou "20 35" -> 1235 segundos; minutos e segundos separados também aceitos por parseMinSecParts
export function parseMinSec(text: string): number | null {
  const m = /^\s*(\d{1,3})\s*[:.,\s]\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const minutes = Number(m[1]), seconds = Number(m[2]);
  if (seconds > 59) return null;
  return minutes * 60 + seconds;
}
export function parseMinSecParts(minutes: string, seconds: string): number | null {
  const m = minutes.trim() === '' ? 0 : Number(minutes.replace(/\D/g, ''));
  const s = seconds.trim() === '' ? 0 : Number(seconds.replace(/\D/g, ''));
  if (!Number.isFinite(m) || !Number.isFinite(s) || s > 59) return null;
  return m * 60 + s;
}
// Número digitado em português ("17,5") -> 17.5; vazio ou inválido -> null
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---- datas (AAAA-MM-DD é o formato do servidor; o aluno digita DD/MM/AAAA) ----
export function isoFromBrDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}
export const brDateFromIso = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
// Máscara enquanto digita: 30102026 -> 30/10/2026
export function maskBrDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
export function todayBrDate(now: Date = new Date()): string {
  const brt = new Date(now.getTime() - 3 * 3_600_000);
  return brDateFromIso(brt.toISOString().slice(0, 10));
}

// ---- rótulos ----
export const METHOD_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'ergospirometry', label: 'Ergoespirometria' },
  { id: 'cooper_12min', label: 'Teste de Cooper, 12 minutos' },
  { id: 'three_km', label: 'Teste de 3 km' },
  { id: 'five_km', label: 'Teste de 5 km' },
  { id: 'incremental', label: 'Teste incremental' },
  { id: 'lactate', label: 'Teste de lactato' },
  { id: 'other', label: 'Outro método' },
  { id: 'unknown', label: 'Não sei informar' },
];
export const methodLabel = (id: string, custom?: string | null) => (id === 'other' && custom ? custom : METHOD_OPTIONS.find((o) => o.id === id)?.label ?? id);

export const ORIGIN_LABELS: Record<string, string> = { measured: 'Medido', reported: 'Informado', estimated: 'Estimado' };
export const CONFIDENCE_LABELS: Record<string, string> = { alta: 'Confiança alta', moderada: 'Confiança moderada', baixa: 'Confiança baixa' };

export const INDICATOR_LABELS: Record<string, { label: string; kind: 'speed' | 'plain' | 'hr' | 'vo2' }> = {
  vo2max: { label: 'VO₂máx', kind: 'vo2' },
  vvo2max_kmh: { label: 'Velocidade no VO₂máx', kind: 'speed' },
  hrmax_bpm: { label: 'FC máxima', kind: 'hr' },
  l1_speed_kmh: { label: 'L1: velocidade', kind: 'speed' },
  l1_hr_bpm: { label: 'L1: frequência cardíaca', kind: 'hr' },
  l1_vo2: { label: 'L1: VO₂', kind: 'vo2' },
  l2_speed_kmh: { label: 'L2: velocidade', kind: 'speed' },
  l2_hr_bpm: { label: 'L2: frequência cardíaca', kind: 'hr' },
  l2_vo2: { label: 'L2: VO₂', kind: 'vo2' },
};
export function formatIndicatorValue(key: string, value: number, unit: SpeedUnit): string {
  const kind = INDICATOR_LABELS[key]?.kind;
  if (kind === 'speed') return formatSpeed(value, unit);
  if (kind === 'hr') return `${Math.round(value)} bpm`;
  if (kind === 'vo2') return `${value.toFixed(1).replace('.', ',')} ml/kg/min`;
  return String(value);
}
export function formatRange(key: string, low: number | null | undefined, high: number | null | undefined, unit: SpeedUnit): string | null {
  if (low == null || high == null) return null;
  const kind = INDICATOR_LABELS[key]?.kind;
  if (kind === 'speed' && unit === 'pace') return `${paceLabelFromKmh(high)} a ${paceLabelFromKmh(low)}`; // do mais rápido ao mais lento
  const f = (n: number) => (kind === 'speed' ? n.toFixed(1).replace('.', ',') : String(Math.round(n)));
  return `${f(low)} a ${f(high)}${kind === 'speed' ? ' km/h' : kind === 'hr' ? ' bpm' : ''}`;
}

// Resultado original de uma avaliação, em uma linha, como foi informado.
export function describeRawResults(method: string, raw: any): string {
  if (!raw || typeof raw !== 'object') return 'Resultado informado';
  const time = typeof raw.totalSeconds === 'number' ? formatMinSec(raw.totalSeconds) : null;
  const hr = typeof raw.maxHeartRate === 'number' ? `FC máxima ${raw.maxHeartRate} bpm` : null;
  const parts: string[] = [];
  if (method === 'three_km' || method === 'five_km') { if (time) parts.push(`${time} para ${method === 'three_km' ? '3' : '5'} km`); }
  else if (method === 'cooper_12min') { if (typeof raw.distanceMeters === 'number') parts.push(`${raw.distanceMeters} m em 12 min`); }
  if (hr) parts.push(hr);
  const reported = ['vo2max', 'vvo2max_kmh', 'hrmax_bpm', 'l1_speed_kmh', 'l2_speed_kmh'].filter((k) => typeof raw[k] === 'number').length;
  if (parts.length === 0 && reported > 0) parts.push(`${reported} ${reported === 1 ? 'resultado informado' : 'resultados informados'}`);
  return parts.length ? parts.join(' | ') : 'Resultado informado';
}

// ---- série do gráfico: só pontos que existem (sem ponto artificial quando o indicador falta) ----
export interface HistoryRow { assessmentId: string; performedAt: string; method: string; methodLabel: string; rawResults: any; isReference: boolean; indicators: Array<{ key: string; value: number; unit: string; origin: string; confidence: string }> }
export interface ChartPoint { assessmentId: string; date: string; value: number; method: string; origin: string; isReference: boolean }

export const RAW_THREE_KM_TIME = 'raw_three_km_time';
export function buildSeries(rows: HistoryRow[], method: string, indicator: string): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const row of rows) {
    if (method !== 'all' && row.method !== method) continue;
    if (indicator === RAW_THREE_KM_TIME) {
      if (row.method === 'three_km' && typeof row.rawResults?.totalSeconds === 'number') out.push({ assessmentId: row.assessmentId, date: row.performedAt, value: row.rawResults.totalSeconds, method: row.method, origin: 'reported', isReference: row.isReference });
      continue;
    }
    const found = row.indicators.find((i) => i.key === indicator);
    if (found) out.push({ assessmentId: row.assessmentId, date: row.performedAt, value: found.value, method: row.method, origin: found.origin, isReference: row.isReference });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Posição horizontal proporcional ao tempo real (não ao número de pontos).
export function xPositions(dates: string[], width: number): number[] {
  if (dates.length === 0) return [];
  const t = dates.map((d) => Date.parse(`${d}T00:00:00Z`));
  const min = Math.min(...t), max = Math.max(...t);
  if (max === min) return t.map(() => width / 2);
  return t.map((v) => ((v - min) / (max - min)) * width);
}

export const nextDueText = (iso: string | null, today: string): string | null => {
  if (!iso) return null;
  return iso <= today ? 'Já é um bom momento para repetir seus testes.' : `Sugerimos repetir seus testes a partir de ${brDateFromIso(iso)}.`;
};
