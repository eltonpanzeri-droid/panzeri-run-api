import { sourceKeyOf } from '../training-intelligence/wearable-source';

// "Minha recuperação" (30/10/2026): o ALUNO vê os próprios dados de recuperação, saúde e rotina que autorizou compartilhar (Health Connect, Apple Saúde e demais fontes), de onde vêm e por que o Panzeri
// Run os usa. Função PURA (sem banco). Nada é estimado: sem dado, o indicador não aparece (e a tela diz isso); zero informado continua zero; fontes diferentes nunca são misturadas (mostra-se a mais
// recente) e HRV SDNN e RMSSD ficam identificadas.

export interface SleepRowLite { provider: string; providerSummaryId: string | null; calendarDate: string; durationSec: number | null }
export interface HrvRowLite { provider: string; providerSummaryId: string | null; calendarDate: string; lastNightAvg: number; hrvValues?: unknown }
export interface DailyRowLite { provider: string; providerSummaryId: string | null; calendarDate: string; steps: number | null; activeKilocalories: number | null; restingHeartRateBpm: number | null }
export interface MetricRowLite { provider: string; providerSummaryId: string | null; metricKind: string; calendarDate: string | null; startTimeSec: number; values: unknown }

export interface RecoveryPoint { date: string; value: number }
export interface RecoveryIndicator {
  id: string; label: string; unit: string; why: string; source: string; sourceKey: string; note: string | null;
  days: number; lastDate: string; last: number; avg7: number | null; avg30: number; points: RecoveryPoint[];
}
export interface RecoverySummary { generatedAt: string; periodDays: number; indicators: RecoveryIndicator[]; empty: boolean }

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dateOf = (row: MetricRowLite) => row.calendarDate ?? new Date(row.startTimeSec * 1000).toISOString().slice(0, 10);

const WHY: Record<string, string> = {
  sleep: 'Mostra se você está dormindo o suficiente para absorver os treinos. Usamos o sono para decidir se a carga da semana pode subir, ser mantida ou aliviada.',
  hrv: 'Indica como seu corpo está se recuperando do esforço. Comparamos com o seu próprio histórico (nunca com outras pessoas) para ajustar a intensidade dos treinos.',
  restingHr: 'Uma frequência cardíaca de repouso mais alta que a sua média pode indicar cansaço acumulado. Usamos a tendência para calibrar a carga.',
  steps: 'Mostra o quanto você se movimenta fora dos treinos, o que também pesa na sua carga total do dia.',
  activeKcal: 'Soma o gasto de energia do dia fora do repouso, e ajuda a enxergar a carga total que seu corpo recebe.',
  vo2: 'Estimativa da sua capacidade aeróbica. Acompanhar a evolução ao longo dos meses mostra se o treinamento está funcionando.',
  spo2: 'Mostra como está a oxigenação do sangue. Acompanhamos como o treinamento afeta o seu sistema cardiorrespiratório; não é um diagnóstico.',
  resp: 'A frequência respiratória em repouso acompanha a sua recuperação e a adaptação cardiorrespiratória ao treino.',
  nutrition: 'A energia que você consome influencia diretamente quanto de carga você suporta e como recupera. Usamos para entender a resposta ao treino.',
  hydration: 'A hidratação influencia desempenho e recuperação. Usamos para entender como você responde à carga de treino.',
};
const NOTE_HRV: Record<string, string> = {
  rmssd: 'HRV medida como RMSSD (milissegundos). Não é comparável à HRV de outras marcas ou do Apple Saúde (SDNN).',
  sdnn: 'HRV medida como SDNN (milissegundos), padrão do Apple Saúde. Não é comparável à HRV de outras fontes (RMSSD).',
};

interface Raw { id: string; label: string; unit: string; why: string; note: string | null; sourceKey: string; byDate: Map<string, number> }

function put(raws: Map<string, Raw>, spec: { id: string; label: string; unit: string; note?: string | null }, sourceKey: string, date: string, value: number, mode: 'last' | 'sum') {
  const key = `${spec.id}|${sourceKey}`;
  const raw = raws.get(key) ?? { id: spec.id, label: spec.label, unit: spec.unit, why: WHY[spec.id.split('.')[0]] ?? '', note: spec.note ?? null, sourceKey, byDate: new Map<string, number>() };
  raw.byDate.set(date, mode === 'sum' ? (raw.byDate.get(date) ?? 0) + value : value);
  raws.set(key, raw);
}

export function buildRecoverySummary(input: { sleep: SleepRowLite[]; hrv: HrvRowLite[]; daily: DailyRowLite[]; metrics: MetricRowLite[]; now: Date; days?: number; sourceName: (key: string) => string }): RecoverySummary {
  const raws = new Map<string, Raw>();
  const spec = {
    sleep: { id: 'sleep', label: 'Sono', unit: 'min' }, restingHr: { id: 'restingHr', label: 'Frequência cardíaca de repouso', unit: 'bpm' }, steps: { id: 'steps', label: 'Passos', unit: 'passos' },
    activeKcal: { id: 'activeKcal', label: 'Calorias ativas do dia', unit: 'kcal' }, vo2: { id: 'vo2', label: 'VO₂ máximo', unit: 'mL/(kg·min)' }, spo2: { id: 'spo2', label: 'Saturação de oxigênio', unit: '%' },
    resp: { id: 'resp', label: 'Frequência respiratória', unit: 'respirações/min' }, nutrition: { id: 'nutrition', label: 'Energia consumida', unit: 'kcal' }, hydration: { id: 'hydration', label: 'Hidratação', unit: 'L' },
  };
  for (const r of input.sleep) if (r.durationSec != null && r.durationSec > 0) put(raws, spec.sleep, sourceKeyOf(r.provider, r.providerSummaryId), r.calendarDate, r.durationSec / 60, 'sum');
  for (const r of input.hrv) {
    const metric = r.provider === 'apple_health' || (r.hrvValues && typeof r.hrvValues === 'object' && (r.hrvValues as { metric?: unknown }).metric === 'sdnn_ms') ? 'sdnn' : 'rmssd';
    put(raws, { id: `hrv.${metric}`, label: 'Variabilidade da frequência cardíaca (HRV)', unit: 'ms', note: NOTE_HRV[metric] }, sourceKeyOf(r.provider, r.providerSummaryId), r.calendarDate, r.lastNightAvg, 'last');
  }
  for (const r of input.daily) {
    const key = sourceKeyOf(r.provider, r.providerSummaryId);
    if (r.restingHeartRateBpm != null) put(raws, spec.restingHr, key, r.calendarDate, r.restingHeartRateBpm, 'last');
    if (r.steps != null) put(raws, spec.steps, key, r.calendarDate, r.steps, 'last');
    if (r.activeKilocalories != null) put(raws, spec.activeKcal, key, r.calendarDate, r.activeKilocalories, 'last');
  }
  for (const r of input.metrics) {
    const v = (r.values && typeof r.values === 'object' ? r.values : {}) as Record<string, unknown>;
    const key = sourceKeyOf(r.provider, r.providerSummaryId);
    const date = dateOf(r);
    const pick = (...names: string[]) => names.map((n) => num(v[n])).find((x) => x !== null) ?? null;
    if (r.metricKind === 'vo2_max') { const x = pick('vo2MillilitersPerMinuteKilogram', 'vo2MaxMlKgMin'); if (x !== null) put(raws, spec.vo2, key, date, x, 'last'); }
    else if (r.metricKind === 'pulse_ox') { const pct = num(v.percentage); const frac = num(v.oxygenSaturationFractionAvg); const x = pct ?? (frac !== null ? frac * 100 : null); if (x !== null) put(raws, spec.spo2, key, date, x, 'last'); }
    else if (r.metricKind === 'respiratory_rate') { const x = pick('ratePerMinute', 'respiratoryRateBrpmAvg'); if (x !== null) put(raws, spec.resp, key, date, x, 'last'); }
    else if (r.metricKind === 'nutrition') { const x = pick('energyKcal', 'dietaryEnergyKcal'); if (x !== null) put(raws, spec.nutrition, key, date, x, 'sum'); }
    else if (r.metricKind === 'hydration') { const liters = num(v.volumeLiters); const ml = num(v.waterMl); const x = liters ?? (ml !== null ? ml / 1000 : null); if (x !== null) put(raws, spec.hydration, key, date, x, 'sum'); }
  }

  const days = input.days ?? 30;
  const cutoff = new Date(input.now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const byId = new Map<string, Raw[]>();
  for (const raw of raws.values()) byId.set(raw.id, [...(byId.get(raw.id) ?? []), raw]);
  const indicators: RecoveryIndicator[] = [];
  for (const [, candidates] of byId) {
    const prepared = candidates.map((raw) => ({ raw, points: [...raw.byDate.entries()].filter(([date]) => date >= cutoff).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value })) })).filter((c) => c.points.length > 0);
    if (prepared.length === 0) continue;
    // fontes diferentes nao se misturam: fica a que tem o dado mais recente (empate: a com mais dias)
    prepared.sort((a, b) => (b.points[b.points.length - 1].date < a.points[a.points.length - 1].date ? -1 : b.points[b.points.length - 1].date > a.points[a.points.length - 1].date ? 1 : b.points.length - a.points.length));
    const { raw, points } = prepared[0];
    const values = points.map((p) => p.value);
    const last = points[points.length - 1];
    const recent = points.filter((p) => p.date > new Date(input.now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10));
    const others = prepared.slice(1).map((c) => input.sourceName(c.raw.sourceKey));
    indicators.push({
      id: raw.id, label: raw.label, unit: raw.unit, why: raw.why, source: input.sourceName(raw.sourceKey), sourceKey: raw.sourceKey,
      note: [raw.note, others.length > 0 ? `Há dados de outras fontes (${others.join(', ')}); mostramos só a mais recente, porque fontes diferentes medem de formas diferentes.` : null].filter(Boolean).join(' ') || null,
      days: points.length, lastDate: last.date, last: round(last.value), avg7: recent.length > 0 ? round(recent.reduce((s, p) => s + p.value, 0) / recent.length) : null,
      avg30: round(values.reduce((s, n) => s + n, 0) / values.length), points: points.map((p) => ({ date: p.date, value: round(p.value) })),
    });
  }
  const order = ['sleep', 'hrv.rmssd', 'hrv.sdnn', 'restingHr', 'steps', 'activeKcal', 'vo2', 'spo2', 'resp', 'nutrition', 'hydration'];
  indicators.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { generatedAt: input.now.toISOString(), periodDays: days, indicators, empty: indicators.length === 0 };
}
