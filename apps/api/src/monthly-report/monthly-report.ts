import { createHmac, timingSafeEqual } from 'crypto';

// Relatorio mensal por e-mail (09/11/2026, ordem do Elton), inspirado no relatorio semanal da adidas Running: resumo do mes, corrida, outras modalidades, cada numero com a variacao contra o mes
// anterior, e as novas melhores marcas do mes. Modulo PURO (sem banco, sem e-mail): recebe atividades ja' filtradas (uma observacao por evento, sem excluidas) e devolve dados e textos.
// So' dado de TREINO: nada de sono, dor, ciclo ou outros dados de saude (e-mail nao e' canal seguro para isso). Sem texto de IA e sem recomendacao: so' fatos e comparacoes.

export interface ReportActivity { localDate: string; isRun: boolean; distanceMeters: number | null; durationSec: number | null; caloriesKcal: number | null }

export interface Totals { activities: number; durationSec: number; caloriesKcal: number }
export interface RunTotals extends Totals { distanceMeters: number; paceSecondsKm: number | null }
export interface ReportMark { label: string; seconds: number; paceSecondsKm: number; localDate: string }

export interface MonthlyReportData {
  monthKey: string;
  monthLabel: string;
  previousMonthLabel: string;
  firstName: string;
  overall: { current: Totals; previous: Totals };
  running: { current: RunTotals; previous: RunTotals };
  other: { current: Totals; previous: Totals };
  newMarks: ReportMark[];
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthLabelOf(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTHS[month - 1]} de ${year}`;
}

export function addMonths(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// Mes anterior ao instante informado, no calendario de Sao Paulo (UTC-3, sem horario de verao).
export function previousMonthKey(now: Date): string {
  const local = new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 7);
  return addMonths(local, -1);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export const monthOf = (localDate: string) => localDate.slice(0, 7);

function totalsOf(rows: ReportActivity[]): Totals {
  return {
    activities: rows.length,
    durationSec: rows.reduce((sum, row) => sum + (row.durationSec ?? 0), 0),
    caloriesKcal: rows.reduce((sum, row) => sum + (row.caloriesKcal ?? 0), 0),
  };
}

function runTotalsOf(rows: ReportActivity[]): RunTotals {
  const base = totalsOf(rows);
  const distanceMeters = rows.reduce((sum, row) => sum + (row.distanceMeters ?? 0), 0);
  return { ...base, distanceMeters, paceSecondsKm: distanceMeters > 0 && base.durationSec > 0 ? Math.round(base.durationSec / (distanceMeters / 1000)) : null };
}

export function buildMonthlyReport(activities: ReportActivity[], monthKey: string, firstName: string, newMarks: ReportMark[]): MonthlyReportData {
  const previousKey = addMonths(monthKey, -1);
  const inMonth = (key: string) => activities.filter((row) => monthOf(row.localDate) === key);
  const current = inMonth(monthKey);
  const previous = inMonth(previousKey);
  return {
    monthKey,
    monthLabel: monthLabelOf(monthKey),
    previousMonthLabel: monthLabelOf(previousKey),
    firstName,
    overall: { current: totalsOf(current), previous: totalsOf(previous) },
    running: { current: runTotalsOf(current.filter((row) => row.isRun)), previous: runTotalsOf(previous.filter((row) => row.isRun)) },
    other: { current: totalsOf(current.filter((row) => !row.isRun)), previous: totalsOf(previous.filter((row) => !row.isRun)) },
    newMarks: newMarks.filter((mark) => monthOf(mark.localDate) === monthKey),
  };
}

// Regra de Elton: quem nao treinou nada no mes nao recebe nada.
export const hasAnyActivity = (data: MonthlyReportData) => data.overall.current.activities > 0;

// ---- formatacao (pt-BR)
const two = (n: number) => String(n).padStart(2, '0');
export function fmtDuration(totalSec: number): string {
  const s = Math.round(totalSec);
  return `${Math.floor(s / 3600)}h${two(Math.floor((s % 3600) / 60))}`;
}
export const fmtKm = (meters: number) => `${(Math.round(meters / 10) / 100).toFixed(2).replace('.', ',')} km`;
export const fmtPace = (secondsKm: number) => `${Math.floor(secondsKm / 60)}:${two(Math.round(secondsKm) % 60)} /km`;
export const fmtKcal = (kcal: number) => `${Math.round(kcal).toLocaleString('pt-BR')} kcal`;
export function fmtMarkTime(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}
const dayBr = (localDate: string) => `${localDate.slice(8, 10)}/${localDate.slice(5, 7)}/${localDate.slice(0, 4)}`;

// Variacao contra o mes anterior, em texto neutro ("mais"/"menos": sem julgar). Sem dado no mes anterior = sem comparacao.
export function deltaText(current: number, previous: number, format: (value: number) => string, hadPrevious: boolean): string {
  if (!hadPrevious) return 'sem comparação com o mês anterior';
  const diff = current - previous;
  if (Math.round(diff * 100) === 0) return 'igual ao mês anterior';
  return `${diff > 0 ? '▲' : '▼'} ${format(Math.abs(diff))} ${diff > 0 ? 'a mais' : 'a menos'} que no mês anterior`;
}

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface ReportLinks { appUrl: string; unsubscribeUrl: string }

export function reportSubject(data: MonthlyReportData): string {
  return `Seu mês no Panzeri Run: ${data.monthLabel}`;
}

function statRows(data: MonthlyReportData) {
  const o = data.overall;
  const r = data.running;
  const x = data.other;
  const hadO = o.previous.activities > 0;
  const hadR = r.previous.activities > 0;
  const hadX = x.previous.activities > 0;
  return {
    overall: [
      { label: 'Treinos', value: String(o.current.activities), delta: deltaText(o.current.activities, o.previous.activities, (v) => String(Math.round(v)), hadO) },
      { label: 'Tempo', value: fmtDuration(o.current.durationSec), delta: deltaText(o.current.durationSec, o.previous.durationSec, fmtDuration, hadO) },
      ...(o.current.caloriesKcal > 0 ? [{ label: 'Calorias', value: fmtKcal(o.current.caloriesKcal), delta: deltaText(o.current.caloriesKcal, o.previous.caloriesKcal, fmtKcal, hadO && o.previous.caloriesKcal > 0) }] : []),
    ],
    running: r.current.activities > 0 ? [
      { label: 'Corridas', value: String(r.current.activities), delta: deltaText(r.current.activities, r.previous.activities, (v) => String(Math.round(v)), hadR) },
      { label: 'Distância', value: fmtKm(r.current.distanceMeters), delta: deltaText(r.current.distanceMeters, r.previous.distanceMeters, fmtKm, hadR) },
      { label: 'Tempo', value: fmtDuration(r.current.durationSec), delta: deltaText(r.current.durationSec, r.previous.durationSec, fmtDuration, hadR) },
      ...(r.current.paceSecondsKm !== null ? [{ label: 'Pace médio', value: fmtPace(r.current.paceSecondsKm), delta: r.previous.paceSecondsKm !== null && hadR ? deltaText(r.current.paceSecondsKm, r.previous.paceSecondsKm, (v) => `${Math.round(v)}s`, true).replace('a mais', 'por km a mais').replace('a menos', 'por km a menos') : 'sem comparação com o mês anterior' }] : []),
    ] : [],
    other: x.current.activities > 0 ? [
      { label: 'Treinos', value: String(x.current.activities), delta: deltaText(x.current.activities, x.previous.activities, (v) => String(Math.round(v)), hadX) },
      { label: 'Tempo', value: fmtDuration(x.current.durationSec), delta: deltaText(x.current.durationSec, x.previous.durationSec, fmtDuration, hadX) },
    ] : [],
  };
}

export function renderMonthlyReportText(data: MonthlyReportData, links: ReportLinks): string {
  const rows = statRows(data);
  const block = (title: string, list: Array<{ label: string; value: string; delta: string }>) => (list.length === 0 ? [] : ['', title.toUpperCase(), ...list.map((row) => `${row.label}: ${row.value} (${row.delta})`)]);
  return [
    `Oi, ${data.firstName}!`,
    `Este é o seu relatório do Panzeri Run de ${data.monthLabel}, comparado com ${data.previousMonthLabel}. Dados até o momento do envio.`,
    ...block('Resumo do mês', rows.overall),
    ...block('Corrida', rows.running),
    ...block('Outras modalidades', rows.other),
    ...(data.newMarks.length > 0 ? ['', 'NOVAS MELHORES MARCAS', ...data.newMarks.map((mark) => `${mark.label}: ${fmtMarkTime(mark.seconds)} em ${dayBr(mark.localDate)}`)] : []),
    '',
    `Abrir o Panzeri Run: ${links.appUrl}`,
    '',
    `Não quero mais receber este relatório: ${links.unsubscribeUrl}`,
    'Panzeri Run',
  ].join('\n');
}

export function renderMonthlyReportHtml(data: MonthlyReportData, links: ReportLinks): string {
  const rows = statRows(data);
  const NAVY = '#123B67';
  const BLUE = '#1769AA';
  const card = (title: string, list: Array<{ label: string; value: string; delta: string }>) => (list.length === 0 ? '' : `
    <tr><td style="padding:20px 24px 4px 24px;font:700 13px Arial,sans-serif;letter-spacing:.6px;color:${BLUE};text-transform:uppercase">${esc(title)}</td></tr>
    <tr><td style="padding:0 24px 8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map((row) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid #E5EAF0">
        <div style="font:400 13px Arial,sans-serif;color:#5F6B7A">${esc(row.label)}</div>
        <div style="font:700 26px Arial,sans-serif;color:${NAVY}">${esc(row.value)}</div>
        <div style="font:400 12px Arial,sans-serif;color:#8B96A5">${esc(row.delta)}</div>
      </td></tr>`).join('')}</table></td></tr>`);
  const marks = data.newMarks.length === 0 ? '' : `
    <tr><td style="padding:20px 24px 4px 24px;font:700 13px Arial,sans-serif;letter-spacing:.6px;color:${BLUE};text-transform:uppercase">Novas melhores marcas</td></tr>
    <tr><td style="padding:0 24px 8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${data.newMarks.map((mark) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid #E5EAF0;font:400 15px Arial,sans-serif;color:#152033"><strong>${esc(mark.label)}</strong> &middot; ${esc(fmtMarkTime(mark.seconds))} <span style="color:#8B96A5">&middot; ${esc(dayBr(mark.localDate))}</span></td></tr>`).join('')}</table></td></tr>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(reportSubject(data))}</title></head>
<body style="margin:0;padding:0;background:#F5F7FA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA"><tr><td align="center" style="padding:16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden">
    <tr><td style="background:${NAVY};padding:28px 24px">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:1px;color:#9FC3E6">PANZERI RUN</div>
      <div style="font:700 26px Arial,sans-serif;color:#FFFFFF;margin-top:6px">Seu mês de ${esc(data.monthLabel)}</div>
    </td></tr>
    <tr><td style="padding:24px 24px 0 24px;font:400 16px/1.5 Arial,sans-serif;color:#152033">Oi, ${esc(data.firstName)}! Este é o seu relatório do Panzeri Run, comparado com ${esc(data.previousMonthLabel)}. Dados até o momento do envio.</td></tr>
    ${card('Resumo do mês', rows.overall)}
    ${card('Corrida', rows.running)}
    ${card('Outras modalidades', rows.other)}
    ${marks}
    <tr><td align="center" style="padding:28px 24px"><a href="${esc(links.appUrl)}" style="display:inline-block;background:${BLUE};color:#FFFFFF;font:700 15px Arial,sans-serif;text-decoration:none;padding:14px 28px;border-radius:12px">Abrir o Panzeri Run</a></td></tr>
    <tr><td style="padding:0 24px 24px 24px;font:400 12px/1.5 Arial,sans-serif;color:#8B96A5;text-align:center">Você recebe este e-mail todo mês porque treinou com o Panzeri Run. <a href="${esc(links.unsubscribeUrl)}" style="color:#8B96A5">Não quero mais receber</a>.</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// ---- link de descadastro (sem login): HMAC do id da aluna com separacao de dominio.
export function optOutToken(secret: string, userId: string): string {
  return createHmac('sha256', secret).update(`monthly-report-optout:${userId}`).digest('hex');
}

export function verifyOptOutToken(secret: string, userId: string, token: string): boolean {
  const expected = Buffer.from(optOutToken(secret, userId), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(token, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
