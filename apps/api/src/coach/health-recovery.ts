// Saude e Recuperacao (painel do treinador, 23/10/2026). Funcoes PURAS: nenhuma conhece banco ou Nest. Leem as mesmas linhas Wearable* que o Atlas usa, mas para MOSTRAR ao
// treinador (nao para decidir treino). Nada aqui estima, interpola ou completa valor ausente; sono sem total seguro e' mostrado so' como registrado, com a limitacao dita.
import type { MathLayerService, SeriesPoint } from '../training-intelligence/math-layer.service';

export type SleepSessionRole = 'principal' | 'adicional' | 'cochilo';

export interface SleepRow {
  id: string;
  calendarDate: string;
  startTimeSec: number;
  startOffsetSec: number;
  endTimeSec: number | null;
  durationSec: number | null;
  deepSleepSec: number | null;
  lightSleepSec: number | null;
  remSleepSec: number | null;
  awakeSec: number | null;
  napTotalSec: number | null;
  scoreValue: number | null;
}

export interface SleepSessionView {
  id: string;
  role: SleepSessionRole;
  /** Horario local (yyyy-MM-ddTHH:mm) = epoch + deslocamento do fuso informado pela propria fonte. */
  start: string;
  end: string | null;
  endIsEstimated: boolean;
  durationMin: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  scoreValue: number | null;
  /** true quando esta sessao entra no total da noite. */
  counted: boolean;
  note: string | null;
}

export type SleepTotalBasis = 'sessao_unica' | 'soma_sem_sobreposicao' | 'indeterminado';

export interface SleepNightView {
  date: string;
  sessions: SleepSessionView[];
  /** Total da noite SEM contar periodos sobrepostos duas vezes; null quando nao da' para determinar com seguranca. */
  totalMin: number | null;
  totalBasis: SleepTotalBasis;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  napMin: number | null;
  limitations: string[];
}

// Cochilo: sessao ADICIONAL (nao e' a maior do dia) que comeca entre 9h e 19h no horario local da fonte. Regra de EXIBICAO, estrutural (nao e' diagnostico), sempre dita na tela;
// a Zepp traz o cochilo em campo proprio (napTotalSec), que tem prioridade.
export const NAP_START_HOUR = 9;
export const NAP_END_HOUR = 19;

const min = (seconds: number | null | undefined): number | null => (seconds == null ? null : Math.round((seconds / 60) * 10) / 10);
const localIso = (epochSec: number, offsetSec: number) => new Date((epochSec + offsetSec) * 1000).toISOString().slice(0, 16);
const localHour = (epochSec: number, offsetSec: number) => new Date((epochSec + offsetSec) * 1000).getUTCHours();

interface Interval { start: number; end: number; estimated: boolean }

function intervalOf(row: SleepRow): Interval | null {
  if (row.endTimeSec != null && row.endTimeSec > row.startTimeSec) return { start: row.startTimeSec, end: row.endTimeSec, estimated: false };
  if (row.durationSec != null && row.durationSec > 0) return { start: row.startTimeSec, end: row.startTimeSec + row.durationSec, estimated: true };
  return null;
}

/**
 * Noites de UMA fonte. Sessoes da mesma data viram: principal (a maior), adicionais (divisao da noite) e cochilos (adicionais diurnas). Registro nenhum e' descartado — todas as sessoes
 * aparecem. O total da noite so' existe quando e' seguro:
 *  - uma sessao: o total e' a dela;
 *  - varias sem sobreposicao: soma;
 *  - uma contida inteira em outra: a contida e' mostrada mas NAO somada (seria contar o mesmo periodo duas vezes);
 *  - sobreposicao parcial, ou sessao sem duracao: total indeterminado (null) e a limitacao e' dita.
 */
export function buildSleepNights(rows: SleepRow[]): SleepNightView[] {
  const byDate = new Map<string, SleepRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.calendarDate);
    if (list) list.push(row);
    else byDate.set(row.calendarDate, [row]);
  }
  const nights: SleepNightView[] = [];
  for (const [date, list] of [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const ordered = [...list].sort((a, b) => (b.durationSec ?? -1) - (a.durationSec ?? -1) || a.startTimeSec - b.startTimeSec || (a.id < b.id ? -1 : 1));
    const principal = ordered[0];
    const limitations: string[] = [];
    const sessions: SleepSessionView[] = ordered.map((row, index) => {
      const interval = intervalOf(row);
      const hour = localHour(row.startTimeSec, row.startOffsetSec);
      const daytime = hour >= NAP_START_HOUR && hour < NAP_END_HOUR;
      const role: SleepSessionRole = index === 0 ? 'principal' : daytime ? 'cochilo' : 'adicional';
      return {
        id: row.id, role,
        start: localIso(row.startTimeSec, row.startOffsetSec),
        end: interval ? localIso(interval.end, row.startOffsetSec) : null,
        endIsEstimated: interval?.estimated ?? false,
        durationMin: min(row.durationSec), deepMin: min(row.deepSleepSec), lightMin: min(row.lightSleepSec), remMin: min(row.remSleepSec), awakeMin: min(row.awakeSec),
        scoreValue: row.scoreValue, counted: role !== 'cochilo', note: null,
      };
    });

    const counted = sessions.filter((s) => s.counted);
    const rowOf = new Map(ordered.map((row) => [row.id, row]));
    let totalMin: number | null = null;
    let basis: SleepTotalBasis = 'indeterminado';
    const dropped = new Set<string>();

    if (counted.length === 1) {
      totalMin = counted[0].durationMin;
      basis = totalMin == null ? 'indeterminado' : 'sessao_unica';
      if (totalMin == null) limitations.push('A sessão de sono não informou a duração: o total da noite não pôde ser determinado.');
    } else {
      const intervals = counted.map((s) => ({ s, interval: intervalOf(rowOf.get(s.id)!) }));
      const missing = intervals.filter((x) => !x.interval || x.s.durationMin == null);
      if (missing.length > 0) {
        limitations.push('Há sessões de sono sem horário ou duração: o total da noite não pôde ser determinado com segurança.');
      } else {
        const sorted = [...intervals].sort((a, b) => a.interval!.start - b.interval!.start || b.interval!.end - a.interval!.end);
        let partial = false;
        const kept: typeof sorted = [];
        for (const item of sorted) {
          const overlapped = kept.find((k) => item.interval!.start < k.interval!.end && k.interval!.start < item.interval!.end);
          if (!overlapped) { kept.push(item); continue; }
          const contained = item.interval!.start >= overlapped.interval!.start && item.interval!.end <= overlapped.interval!.end;
          if (contained) { dropped.add(item.s.id); item.s.note = 'Período já contido em outra sessão: mostrado, mas não somado.'; }
          else partial = true;
        }
        if (partial) {
          limitations.push('Sessões de sono se sobrepõem só em parte: o total da noite não pôde ser determinado com segurança.');
        } else {
          totalMin = Math.round(kept.reduce((sum, x) => sum + (x.s.durationMin ?? 0), 0) * 10) / 10;
          basis = 'soma_sem_sobreposicao';
          if (dropped.size > 0) limitations.push('Uma ou mais sessões estão contidas em outra e não foram somadas.');
          if (kept.some((x) => x.interval!.estimated)) limitations.push('O fim de alguma sessão foi estimado pela duração informada.');
        }
      }
      if (basis === 'indeterminado') for (const s of counted) s.counted = false; // nada entra num total que nao existe; as sessoes seguem listadas
    }
    for (const id of dropped) { const s = sessions.find((x) => x.id === id); if (s) s.counted = false; }

    // Etapas: somente das sessoes que entram no total (e so' quando o total existe), para nunca somar etapas de um periodo contado duas vezes.
    const used = basis === 'indeterminado' ? [] : sessions.filter((s) => s.counted);
    const sum = (pick: (s: SleepSessionView) => number | null) => {
      const values = used.map(pick).filter((v): v is number => v != null);
      return values.length === used.length && values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10 : null;
    };
    const classifiedNapMin = sessions.filter((s) => s.role === 'cochilo').reduce((acc, s) => acc + (s.durationMin ?? 0), 0);
    const napFromField = min(principal.napTotalSec);
    const napMin = napFromField != null && napFromField > 0 ? napFromField : classifiedNapMin > 0 ? Math.round(classifiedNapMin * 10) / 10 : null;
    const principalHour = localHour(principal.startTimeSec, principal.startOffsetSec);
    if (principalHour >= NAP_START_HOUR && principalHour < NAP_END_HOUR) limitations.push(`A sessão principal começa entre ${NAP_START_HOUR}h e ${NAP_END_HOUR}h: pode ser um cochilo, e não a noite de sono.`);
    if (sessions.some((s) => s.role === 'cochilo')) limitations.push(`Sessões adicionais que começam entre ${NAP_START_HOUR}h e ${NAP_END_HOUR}h foram classificadas como cochilo (regra de exibição).`);

    nights.push({
      date, sessions, totalMin, totalBasis: basis,
      deepMin: sum((s) => s.deepMin), lightMin: sum((s) => s.lightMin), remMin: sum((s) => s.remMin), awakeMin: sum((s) => s.awakeMin),
      napMin, limitations,
    });
  }
  return nights;
}

// ── Resumo de um periodo (sempre com a quantidade de observacoes) ────────────────────────────────────────────────────────

export interface DayValue { date: string; value: number }
export interface Period { from: string; to: string }

export interface PeriodSummary {
  n: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  first: DayValue | null;
  last: DayValue | null;
  trend: { direction: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data'; slopePerDay: number | null; n: number; minObservations: number };
}

// Abaixo disto a tela NAO diz que algo "sobe" ou "cai": poucos registros nao sustentam uma tendencia (revisao independente, 23/10/2026).
export const MIN_TREND_OBSERVATIONS = 5;

const noon = (date: string) => new Date(`${date}T12:00:00.000Z`);
export const dayDiff = (a: string, b: string) => Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000);
export const inPeriod = (date: string, period: Period) => date >= period.from && date <= period.to;
const round = (value: number | null, decimals = 2) => (value == null ? null : Math.round(value * 10 ** decimals) / 10 ** decimals);

export function summarize(points: DayValue[], period: Period, math: MathLayerService): PeriodSummary {
  const inside = points.filter((p) => inPeriod(p.date, period)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const series: SeriesPoint[] = inside.map((p) => ({ value: p.value, timestamp: noon(p.date) }));
  const mean = math.periodMean(series);
  const span = Math.max(2, dayDiff(period.from, period.to) + 1);
  const trend = math.trend(series, { kind: 'calendar_days', size: span }, new Date(`${period.to}T23:59:59.000Z`));
  return {
    n: inside.length,
    mean: round(mean.value),
    min: inside.length ? Math.min(...inside.map((p) => p.value)) : null,
    max: inside.length ? Math.max(...inside.map((p) => p.value)) : null,
    first: inside[0] ?? null,
    last: inside[inside.length - 1] ?? null,
    trend: inside.length < MIN_TREND_OBSERVATIONS
      ? { direction: 'insufficient_data', slopePerDay: null, n: trend.n, minObservations: MIN_TREND_OBSERVATIONS }
      : { direction: trend.direction, slopePerDay: round(trend.slopePerDay, 4), n: trend.n, minObservations: MIN_TREND_OBSERVATIONS },
  };
}

export interface PeriodDelta { mean: number | null; meanPercent: number | null }

/** Diferenca B - A entre as medias de dois periodos. Nunca presume: se algum periodo nao tem media, a diferenca e' null. */
export function compareSummaries(a: PeriodSummary, b: PeriodSummary): PeriodDelta {
  if (a.mean == null || b.mean == null) return { mean: null, meanPercent: null };
  return { mean: round(b.mean - a.mean), meanPercent: a.mean !== 0 ? round(((b.mean - a.mean) / a.mean) * 100, 1) : null };
}

// ── Datas ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_PERIOD_DAYS = 3660;

export function parseDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

export function validatePeriod(from: string, to: string): string | null {
  if (from > to) return 'A data inicial não pode ser depois da data final.';
  if (dayDiff(from, to) > MAX_PERIOD_DAYS) return 'O período escolhido é longo demais.';
  return null;
}
