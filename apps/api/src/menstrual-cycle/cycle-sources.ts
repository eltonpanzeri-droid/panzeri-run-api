// Ciclo vindo de OUTRAS fontes (19/11/2026, ordem de Elton: "tem que juntar tudo, dentro das permissoes"). Funcoes PURAS que transformam os registros do Apple Saude (fluxo menstrual por dia) e da Garmin (agenda do ciclo,
// Women's Health API) em ciclos no mesmo formato do registro manual, e juntam as fontes. Quem chama decide QUAIS fontes podem entrar (permissao da aluna, escopo de IA); aqui so' se transforma e se junta.
// Precedencia quando duas fontes descrevem o mesmo inicio (diferenca de ate 3 dias): manual > Garmin > Apple Saude.
export type ExternalCycleSource = 'garmin' | 'apple_health';
export interface ExternalCycleLog { id: string; cycleStartDate: Date; cycleEndDate: Date | null; source: ExternalCycleSource }

const DAY = 86_400_000;
export const MERGE_TOLERANCE_DAYS = 3;
const BLEEDING_CODES = new Set([1, 2, 3, 4]); // HealthKit: 1 nao especificado, 2 leve, 3 medio, 4 intenso (5 = nenhum)
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayNumber = (iso: string) => Math.floor(toDate(iso).getTime() / DAY);

export interface AppleCycleRow { calendarDate: string | null; startTimeSec: number; values: unknown }

// Dias com sangramento viram ciclos: dias seguidos (com falha de ate 3 dias, para o "manchinha") formam um sangramento; o primeiro dia e' o inicio do ciclo, o ultimo o fim.
export function cyclesFromAppleRows(rows: AppleCycleRow[]): ExternalCycleLog[] {
  const days = new Set<string>();
  for (const row of rows) {
    const values = row.values && typeof row.values === 'object' && !Array.isArray(row.values) ? (row.values as Record<string, unknown>) : null;
    const flow = values?.menstrualFlow;
    if (!Array.isArray(flow) || !flow.some((code) => typeof code === 'number' && BLEEDING_CODES.has(code))) continue;
    const date = row.calendarDate && isIso(row.calendarDate) ? row.calendarDate : new Date(row.startTimeSec * 1000).toISOString().slice(0, 10);
    days.add(date);
  }
  const sorted = [...days].sort();
  const runs: string[][] = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last && dayNumber(day) - dayNumber(last[last.length - 1]) <= 3) last.push(day);
    else runs.push([day]);
  }
  return runs.filter((run) => dayNumber(run[run.length - 1]) - dayNumber(run[0]) + 1 <= 14).map((run) => ({ id: `ext:apple_health:${run[0]}`, cycleStartDate: toDate(run[0]), cycleEndDate: toDate(run[run.length - 1]), source: 'apple_health' as const }));
}

export interface GarminCycleRow { values: unknown }

// Cada resumo da Garmin traz o inicio do ciclo (periodStartDate). Ciclo PREVISTO nao conta (so' o que a aluna viveu/registrou). O fim so' entra quando a aluna informou a duracao da menstruacao na Garmin.
export function cyclesFromGarminRows(rows: GarminCycleRow[]): ExternalCycleLog[] {
  const byStart = new Map<string, ExternalCycleLog>();
  for (const row of rows) {
    const values = row.values && typeof row.values === 'object' && !Array.isArray(row.values) ? (row.values as Record<string, unknown>) : null;
    if (!values || values.isPredictedCycle === true || !isIso(values.periodStartDate)) continue;
    const length = typeof values.periodLength === 'number' && values.hasSpecifiedPeriodLength === true && values.periodLength >= 1 && values.periodLength <= 14 ? Math.round(values.periodLength) : null;
    const start = toDate(values.periodStartDate);
    byStart.set(values.periodStartDate, { id: `ext:garmin:${values.periodStartDate}`, cycleStartDate: start, cycleEndDate: length ? new Date(start.getTime() + (length - 1) * DAY) : null, source: 'garmin' });
  }
  return [...byStart.values()];
}

// Junta: o manual sempre fica; externo dentro de 3 dias de um inicio ja existente e' o MESMO ciclo (descartado); entre externos, a Garmin vence a Apple.
export function mergeCycleLogs<T extends { cycleStartDate: Date }>(manual: T[], external: ExternalCycleLog[]): Array<T | ExternalCycleLog> {
  const kept: ExternalCycleLog[] = [];
  const rank = (log: ExternalCycleLog) => (log.source === 'garmin' ? 0 : 1);
  const close = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) <= MERGE_TOLERANCE_DAYS * DAY;
  for (const log of [...external].sort((a, b) => rank(a) - rank(b) || a.cycleStartDate.getTime() - b.cycleStartDate.getTime())) {
    if (manual.some((own) => close(own.cycleStartDate, log.cycleStartDate))) continue;
    if (kept.some((other) => close(other.cycleStartDate, log.cycleStartDate))) continue;
    kept.push(log);
  }
  return [...manual, ...kept].sort((a, b) => a.cycleStartDate.getTime() - b.cycleStartDate.getTime());
}

export const isExternalCycleId = (id: string) => id.startsWith('ext:');
