import type { ISODate, RawRealizedActivity, RawSessionData } from './evolution.types';
import { weekStartOf } from '../common/weekly-volume';
import { canonicalModality } from '../activity-execution/canonical-modality';

// Painel de resumo da TELA INICIAL (14/11/2026, lista de Elton). Funções puras. Mesmas regras de "feita" e de km do restante da Evolução (uma matemática só):
//  - treino FEITO = vínculo ativo com atividade do relógio OU feedback done/adjusted (inclui extras); futuro e sem registro não contam;
//  - km realizado = atividades do relógio (corrida/esteira) + feedback manual sem atividade vinculada (o mesmo de buildWeeklyVolumes); nunca soma extras por cima;
//  - esteira = corrida (modalidade canônica).
// Itens COM período: treinos feitos, treinos por modalidade, km percorridos, média de km por semana. Itens SEM período (sempre desde o início): semanas desde que entrou, semana com mais km,
// recorde de semanas ativas seguidas (cada semana com pelo menos um treino feito).
export interface PanelPeriod { from: ISODate | null; to: ISODate | null }

export interface SummaryPanel {
  period: { from: ISODate | null; to: ISODate; isAll: boolean };
  /** Com período. */
  treinosFeitos: number;
  porModalidade: Array<{ modality: string; count: number }>;
  kmPercorridos: number;
  /** Km total do período ÷ semanas do período que tiveram km. */
  mediaKmPorSemana: number | null;
  semanasComKm: number;
  /** Sem período (sempre desde o início). */
  semanasDesdeQueEntrou: number;
  semanaComMaisKm: { km: number; weekStart: ISODate } | null;
  recordeSemanasAtivas: number;
}

export type SessionStatus = 'feita' | 'nao_feita' | 'sem_registro' | 'futura';

const round1 = (v: number) => Math.round(v * 10) / 10;
const addDays = (iso: ISODate, days: number): ISODate => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const inRange = (date: ISODate, period: PanelPeriod) => (!period.from || date >= period.from) && (!period.to || date <= period.to);

/** Dia a dia: km de cada data (atividades + feedback manual sem vínculo), mesma regra de buildWeeklyVolumes. */
export function kmByDate(sessions: RawSessionData[], activities: RawRealizedActivity[], statusOf: (s: RawSessionData) => SessionStatus): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  const add = (date: ISODate, km: number) => out.set(date, (out.get(date) ?? 0) + km);
  for (const s of sessions) {
    if (statusOf(s) === 'feita' && !s.hasActiveLink && s.origin !== 'device_extra' && s.distanceKm != null) add(s.scheduledDate, s.distanceKm);
  }
  for (const a of activities) if (a.distanceKm != null) add(a.isoDate, a.distanceKm);
  return out;
}

export function longestActiveWeekStreak(activeWeeks: Set<ISODate>): number {
  let best = 0;
  for (const week of activeWeeks) {
    if (activeWeeks.has(addDays(week, -7))) continue; // só começa a contar no início de uma sequência
    let length = 1;
    while (activeWeeks.has(addDays(week, length * 7))) length += 1;
    if (length > best) best = length;
  }
  return best;
}

export function buildSummaryPanel(sessions: RawSessionData[], activities: RawRealizedActivity[], todayBR: ISODate, period: PanelPeriod, statusOf: (s: RawSessionData) => SessionStatus): SummaryPanel {
  const effective: PanelPeriod = { from: period.from, to: period.to && period.to < todayBR ? period.to : todayBR };
  const done = sessions.filter((s) => statusOf(s) === 'feita' && s.scheduledDate <= todayBR);

  // ---- com período
  const doneInPeriod = done.filter((s) => inRange(s.scheduledDate, effective));
  const byModality = new Map<string, number>();
  for (const s of doneInPeriod) {
    const raw = canonicalModality(s.modality) ?? s.modality;
    const modality = raw === 'esteira' ? 'corrida' : raw;
    byModality.set(modality, (byModality.get(modality) ?? 0) + 1);
  }
  const km = kmByDate(sessions, activities, statusOf);
  let kmTotal = 0;
  const weeksWithKm = new Set<ISODate>();
  for (const [date, value] of km) {
    if (!inRange(date, effective) || date > todayBR) continue;
    kmTotal += value;
    if (value > 0) weeksWithKm.add(weekStartOf(date));
  }

  // ---- sem período (desde o início)
  const weekKm = new Map<ISODate, number>();
  for (const [date, value] of km) if (date <= todayBR) weekKm.set(weekStartOf(date), (weekKm.get(weekStartOf(date)) ?? 0) + value);
  let best: SummaryPanel['semanaComMaisKm'] = null;
  for (const [weekStart, value] of weekKm) if (value > 0 && (!best || value > best.km)) best = { km: round1(value), weekStart };

  const activeWeeks = new Set<ISODate>();
  for (const s of done) activeWeeks.add(weekStartOf(s.scheduledDate));
  for (const [date, value] of km) if (value > 0 && date <= todayBR) activeWeeks.add(weekStartOf(date));

  const allDates = [...sessions.map((s) => s.scheduledDate), ...activities.map((a) => a.isoDate)].filter((d) => d <= todayBR).sort();
  let weeksSince = 0;
  if (allDates.length > 0) {
    const first = new Date(weekStartOf(allDates[0]) + 'T12:00:00Z').getTime();
    const current = new Date(weekStartOf(todayBR) + 'T12:00:00Z').getTime();
    weeksSince = Math.round((current - first) / (7 * 86_400_000)) + 1;
  }

  return {
    period: { from: effective.from, to: effective.to as ISODate, isAll: !period.from && !period.to },
    treinosFeitos: doneInPeriod.length,
    porModalidade: [...byModality.entries()].map(([modality, count]) => ({ modality, count })).sort((a, b) => b.count - a.count),
    kmPercorridos: round1(kmTotal),
    mediaKmPorSemana: weeksWithKm.size > 0 ? round1(kmTotal / weeksWithKm.size) : null,
    semanasComKm: weeksWithKm.size,
    semanasDesdeQueEntrou: weeksSince,
    semanaComMaisKm: best,
    recordeSemanasAtivas: longestActiveWeekStreak(activeWeeks),
  };
}
