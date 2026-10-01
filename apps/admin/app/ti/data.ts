// Frontend transport types and display adapters. No training statistics are calculated here.
export type Student = { id: string; name: string; studentCode: string | number | null };
export type Variable = { id: string; domain: string; dataType: string; constructLabel?: string; scale?: { min: number; max: number; unit?: string }; direction: string; allowedMathStrategy?: string };
export type Observation = { timestamp: string; value: number | string; instrumentVersion?: number; context?: { modality?: string; isPartialWeek?: boolean; sessionId?: string; workoutCompletionId?: string; checkinId?: string; [key: string]: unknown } };
export type WindowValue = { value: number | null; n?: number; isPartialWindow?: boolean };
export type Snapshot = {
  variable: Variable; mathApplicable: boolean; mathSkippedReason?: string; current: number | null;
  currentWeekContext?: { isPartialWeek: boolean; numerator: number | null; denominator: number | null; coveragePercent: number | null } | null;
  mean: { value: number | null; n: number } | null;
  movingAverages: Record<string, WindowValue> | null;
  movingAverageSeries: Record<string, (WindowValue & { timestamp: string })[]> | null;
  baseline: WindowValue | null;
  deviation?: { absoluteDeviation: number | null; relativeDeviation: number | null } | null;
  trend: Record<string, { direction: string; slopePerDay: number | null; n: number }> | null;
  habitualRange: { lower: number | null; upper: number | null; median: number | null; n: number; isPartialWindow: boolean; semanticCaution: string } | null;
  observations: Observation[]; availableModalities?: string[];
  evidence: { n: number; observedSpan: { from: string | null; to: string | null }; lastObservationAt: string | null; instrumentVersions: number[]; comparabilityWarning: string | null };
};
export type ContextEvent = { id: string; type: string; subtype: string | null; startedAt: string | null; endedAt: string | null; reportedAt: string; status: string; source: string; originalText: string | null };
export type Layers = { raw: boolean; mm21: boolean; mm60: boolean; mm200: boolean; baseline: boolean; habitual: boolean; trend: boolean; events: boolean; prescribed: boolean; completed: boolean };
export type ChartView = 'line' | 'bars' | 'mixed' | 'points';
export type ChartLabels = 'off' | 'raw' | 'average' | 'both';
export type ChartConfig = { view: ChartView; labels: ChartLabels; layers: Layers; expanded: boolean; overlayIds: string[] };
export type Series = { key: string; variableId: string; modality: string; visible: boolean };
export const API_URL = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
export const COLORS = ['#1683ff', '#935be8', '#e7862f', '#0c9e9a', '#de5371', '#6972c3'];
export const DOMAINS: Record<string, string> = { sleep: 'Sono', physical_state: 'Estado físico', psychological_state: 'Estado psicológico', training_response: 'Resposta ao treino', pain_health: 'Dor e saúde', menstrual_cycle: 'Ciclo menstrual', training_load: 'Volume, aderência e carga' };
export const EVENT_TYPES: Record<string, string> = { work: 'Trabalho', routine_change: 'Mudança de rotina', travel: 'Viagem', family_personal: 'Família e vida pessoal', health: 'Saúde', illness: 'Doença', pain_injury: 'Dor / lesão', sleep: 'Sono', other: 'Outro contexto' };
export const SOURCES: Record<string, string> = { student_reported: 'Relato do aluno', coach_reported: 'Registro do treinador', reassessment: 'Reavaliação', return_after_gap: 'Retorno após lacuna', system_detected: 'Detectado pelo sistema' };
export const MODALITIES: Record<string, string> = { corrida: 'Corrida', forca: 'Musculação', fortalecimento_corredores: 'Fortalecimento', global: 'Todas (canônico)' };
export const DEFAULT_LAYERS: Layers = { raw: true, mm21: true, mm60: false, mm200: false, baseline: false, habitual: true, trend: true, events: true, prescribed: false, completed: false };
export const PERIODS = [{ id: '30', label: '30 dias', days: 30 }, { id: '90', label: '90 dias', days: 90 }, { id: '183', label: '6 meses', days: 183 }, { id: '365', label: '1 ano', days: 365 }, { id: 'all', label: 'Tudo', days: 0 }];
export const fmt = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const dateKey = (value: string) => value.slice(0, 10);
export const time = (value: string) => Date.parse(`${dateKey(value)}T00:00:00Z`);
export function dateLabel(value: string | number, full = false) {
  const iso = typeof value === 'number' ? new Date(value).toISOString() : value;
  const [y, m, d] = dateKey(iso).split('-');
  return full ? `${d}/${m}/${y}` : `${d}/${m}`;
}
export function seriesKey(id: string, modality = '') { return `${id}::${modality}`; }
export function seriesName(series: Series, legend: Variable[]) {
  return `${legend.find((v) => v.id === series.variableId)?.constructLabel ?? series.variableId}${series.modality ? ` · ${MODALITIES[series.modality] ?? series.modality}` : ''}`;
}
export function matchingStudents(students: Student[], query: string) {
  const search = query.trim().toLocaleLowerCase('pt-BR');
  return search ? students.filter((s) => s.name.toLocaleLowerCase('pt-BR').includes(search)) : students;
}
export function inWindow(timestamp: string, range: [number, number]) { const at = time(timestamp); return at >= range[0] && at <= range[1]; }
// Axis layout only: registry bounds describe the instrument, not an appropriate
// viewport for continuous measurements. No canonical metric is recalculated.
export function chartAxis(variable: Variable, values: number[], bars: boolean, full = false) {
  const scale = variable.scale;
  if (variable.dataType === 'ordinal_scale' && scale?.min === 1 && scale.max === 5) {
    return { min: 0, max: 5, ticks: Array.from({ length: 11 }, (_, i) => i / 2) };
  }
  if (scale && (full || variable.dataType === 'ordinal_scale')) {
    const step = scale.max <= 10 ? 1 : (scale.max - scale.min) / 20;
    if (step > 0) return { min: scale.min, max: scale.max, ticks: Array.from({ length: Math.round((scale.max - scale.min) / step) + 1 }, (_, i) => Number((scale.min + i * step).toFixed(8))) };
  }
  const finite = values.filter(Number.isFinite);
  let low = finite.length ? Math.min(...finite) : 0;
  let high = finite.length ? Math.max(...finite) : 1;
  const padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.04, 0.1);
  low -= padding; high += padding;
  if (bars) { low = Math.min(0, low); high = Math.max(0, high); }
  if (scale && scale.min >= 0 && finite.every((v) => v >= 0)) low = Math.max(0, low);
  const rough = (high - low) / 16;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(0.1, ([1, 2, 2.5, 5, 10].find((n) => n * magnitude >= rough) ?? 10) * magnitude);
  const min = Number((Math.floor(low / step) * step).toFixed(8));
  const max = Number((Math.ceil(high / step) * step).toFixed(8));
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => Number((min + i * step).toFixed(8)));
  return { min, max, ticks };
}
export function compatibleAxes(a: Variable, b: Variable) {
  // Equal numeric ranges alone do not make different constructs comparable.
  return a.id === b.id || Boolean(a.scale?.unit && a.scale.unit === b.scale?.unit && a.dataType === b.dataType);
}
export function selectableOverlayAxes(a: Variable, b: Variable) {
  // Equal ordinal instruments can share their original axis when the coach
  // explicitly chooses to compare them. No observations are transformed.
  return compatibleAxes(a, b) || Boolean(a.dataType === 'ordinal_scale' && b.dataType === 'ordinal_scale'
    && a.scale && b.scale && a.scale.min === b.scale.min && a.scale.max === b.scale.max);
}
export function chartViews(variable: Variable): ChartView[] {
  if (variable.domain === 'training_load' && variable.scale?.unit === 'km') return ['mixed', 'bars', 'line', 'points'];
  return ['line', 'points'];
}
export function defaultChartConfig(variable: Variable): ChartConfig {
  const volume = chartViews(variable).includes('mixed');
  return { view: volume ? 'mixed' : 'line', labels: volume ? 'raw' : 'off', layers: { ...DEFAULT_LAYERS }, expanded: false, overlayIds: [] };
}
export type CustomPeriod =
  | { mode: 'dates'; start: string; end: string }
  | { mode: 'weeks' | 'months'; count: number }
  | { mode: 'month'; month: string }
  | { mode: 'monthRange'; start: string; end: string };
export function customPeriodRange(selection: CustomPeriod, now = Date.now()): [number, number] | null {
  const today = time(new Date(now).toISOString());
  const parseDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? time(value) : NaN;
  const parseMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? Date.parse(`${value}-01T00:00:00Z`) : NaN;
  let start = NaN, end = NaN;
  if (selection.mode === 'dates') { start = parseDay(selection.start); end = parseDay(selection.end); }
  if (selection.mode === 'weeks' && Number.isInteger(selection.count) && selection.count >= 1 && selection.count <= 520) {
    start = today - (selection.count * 7 - 1) * 86400000; end = today;
  }
  if (selection.mode === 'months' && Number.isInteger(selection.count) && selection.count >= 1 && selection.count <= 120) {
    const t = new Date(today), day = t.getUTCDate();
    t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - selection.count);
    t.setUTCDate(Math.min(day, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
    start = t.getTime(); end = today;
  }
  if (selection.mode === 'month') { start = parseMonth(selection.month); end = Number.isFinite(start) ? Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 0) : NaN; }
  if (selection.mode === 'monthRange') { start = parseMonth(selection.start); const last = parseMonth(selection.end); end = Number.isFinite(last) ? Date.UTC(new Date(last).getUTCFullYear(), new Date(last).getUTCMonth() + 1, 0) : NaN; }
  return Number.isFinite(start) && Number.isFinite(end) && start <= end ? [start, Math.max(end, start + 86400000 - 1)] : null;
}
export function clampWindow(full: [number, number], zoom: [number, number] | null): [number, number] {
  if (!zoom) return full;
  const start = Math.max(full[0], zoom[0]);
  const end = Math.min(full[1], zoom[1]);
  return start < end ? [start, end] : full;
}
export function eventOverlaps(event: ContextEvent, range: [number, number]) {
  const start = time(event.startedAt ?? event.reportedAt);
  const end = event.endedAt ? time(event.endedAt) : event.status === 'active' ? Infinity : start;
  return start <= range[1] && end >= range[0];
}
export function observationsAt(snapshot: Snapshot, day: string) { return snapshot.observations.filter((o) => dateKey(o.timestamp) === day); }
export function snapshotIsValid(data: unknown, variableId: string): data is Snapshot {
  if (!data || typeof data !== 'object') return false;
  const s = data as Snapshot;
  return s.variable?.id === variableId && Array.isArray(s.observations) && typeof s.evidence?.n === 'number' && s.observations.every((o) => typeof o.timestamp === 'string' && Number.isFinite(time(o.timestamp)) && (typeof o.value === 'string' || (typeof o.value === 'number' && Number.isFinite(o.value))));
}
export function windowFor(days: number, snapshots: Snapshot[], events: ContextEvent[], now = Date.now()): [number, number] {
  const today = time(new Date(now).toISOString());
  const observed = snapshots.flatMap((s) => s.observations.map((o) => time(o.timestamp)));
  const eventTimes = events.map((e) => time(e.startedAt ?? e.reportedAt)).filter(Number.isFinite);
  const from = days ? today - (days - 1) * 86400000 : Math.min(today, ...observed, ...eventTimes);
  return [from, Math.max(from + 86400000, today, ...observed.filter((t) => t >= from))];
}
