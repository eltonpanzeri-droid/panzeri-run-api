import { formatPace, round2 } from '../equipment/equipment-core';
import type { ObsRow, ObsRunEvent, PainMetrics } from './observatory.types';

// Observatorio Panzeri Run (24/10/2026) — NUCLEO PURO: classificacao por faixas, semanas, dor por 1.000 km, pace por tempo total / distancia total, grupo fixo e protecao de celulas
// pequenas. Sem banco, sem Nest. Estatistica DESCRITIVA: associacao nao e' causa. Nada devolvido carrega nome, e-mail ou id de aluno.

// ───────────────────────── faixas (reutilizaveis para qualquer variavel) ─────────────────────────
export interface Band { id: string; label: string; lo: number; hi: number } // (lo, hi] — o limite superior pertence a faixa de baixo
export function classify(value: number | null | undefined, bands: Band[]): Band | null {
  if (value == null || !Number.isFinite(value)) return null;
  return bands.find((band) => value > band.lo && value <= band.hi) ?? null;
}

// Volume semanal de corrida (km). A primeira faixa inclui o zero.
export const VOLUME_BANDS: Band[] = [
  { id: 'v1', label: 'Até 20 km', lo: -1, hi: 20 }, { id: 'v2', label: '20 a 40 km', lo: 20, hi: 40 }, { id: 'v3', label: '40 a 60 km', lo: 40, hi: 60 },
  { id: 'v4', label: '60 a 90 km', lo: 60, hi: 90 }, { id: 'v5', label: '90 a 120 km', lo: 90, hi: 120 }, { id: 'v6', label: '120 a 160 km', lo: 120, hi: 160 },
  { id: 'v7', label: '160 a 200 km', lo: 160, hi: 200 }, { id: 'v8', label: 'Acima de 200 km', lo: 200, hi: Infinity },
];
// Intensidade de dor relatada (1–10): faixas EXCLUSIVAS.
export const INTENSITY_BINS: Band[] = [
  { id: 'i1_2', label: 'Intensidade 1–2', lo: 0, hi: 2 }, { id: 'i3_4', label: 'Intensidade 3–4', lo: 2, hi: 4 }, { id: 'i5_6', label: 'Intensidade 5–6', lo: 4, hi: 6 },
  { id: 'i7_8', label: 'Intensidade 7–8', lo: 6, hi: 8 }, { id: 'i9_10', label: 'Intensidade 9–10', lo: 8, hi: 10 },
];
export const AGE_BANDS: Band[] = [
  { id: 'lt30', label: 'Menos de 30', lo: -1, hi: 29 }, { id: '30_39', label: '30 a 39', lo: 29, hi: 39 }, { id: '40_49', label: '40 a 49', lo: 39, hi: 49 },
  { id: '50_59', label: '50 a 59', lo: 49, hi: 59 }, { id: '60_69', label: '60 a 69', lo: 59, hi: 69 }, { id: '70p', label: '70 ou mais', lo: 69, hi: Infinity },
];
export const STRENGTH_BANDS: Band[] = [
  { id: 's0', label: 'Nenhuma sessão de força', lo: -1, hi: 0 }, { id: 's1', label: '1 sessão de força', lo: 0, hi: 1 }, { id: 's2p', label: '2 ou mais sessões de força', lo: 1, hi: Infinity },
];
export const UNKNOWN = { id: 'unk', label: 'Não informado' };
export const MAX_COHORT_WEEKS = 26;
export const BASELINE_WEEKS = 8;
export const PRIOR_DAYS = 28;

// ───────────────────────── datas ─────────────────────────
export const addDays = (day: string, days: number) => new Date(new Date(day + 'T12:00:00.000Z').getTime() + days * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86_400_000);
// Segunda-feira da semana de um dia local 'YYYY-MM-DD' (semana segunda a domingo).
export function weekStartOf(day: string): string {
  const d = new Date(day + 'T12:00:00.000Z');
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}
export function ageAt(birthDate: string | null, day: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const b = new Date(birthDate + 'T12:00:00Z');
  const t = new Date(day + 'T12:00:00Z');
  if (Number.isNaN(b.getTime()) || b > t) return null;
  let age = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) age -= 1;
  return age >= 0 && age < 110 ? age : null;
}
export function normalizeSex(value: string | null | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  if (['f', 'fem', 'feminino', 'female', 'mulher'].includes(v)) return 'F';
  if (['m', 'masc', 'masculino', 'male', 'homem'].includes(v)) return 'M';
  return v ? 'other' : 'unknown';
}
export const SEX_LABEL: Record<string, string> = { F: 'Feminino', M: 'Masculino', other: 'Outro', unknown: UNKNOWN.label };

// ───────────────────────── estatisticas ─────────────────────────
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q; // tipo 7
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
// Pace agregado: tempo total / distancia total (nunca a media dos paces). So' eventos com os dois dados validos.
export function pooledPaceOf(events: Array<{ km: number | null; seconds: number | null }>): { secondsPerKm: number; label: string; events: number; km: number } | null {
  let km = 0; let sec = 0; let n = 0;
  for (const e of events) { if (e.km != null && e.seconds != null && e.km > 0 && e.seconds > 0) { km += e.km; sec += e.seconds; n += 1; } }
  if (n === 0 || km <= 0) return null;
  const secondsPerKm = Math.round(sec / km);
  return { secondsPerKm, label: formatPace(secondsPerKm), events: n, km: round2(km) };
}

// ───────────────────────── dor ─────────────────────────
// Operacional: treino sem relato = 0; resposta explicita "sem dor" = 0; relato com nota = nota; relato sem nota = intensidade DESCONHECIDA (nunca 0 nem nota inventada).
export function painMetrics(events: ObsRunEvent[]): PainMetrics {
  let km = 0; let reports = 0; let withInt = 0; let sumReported = 0; let sumAll = 0; let numericTrainings = 0; let withFeedback = 0; let explicit = 0; let none = 0;
  const bins = INTENSITY_BINS.map((band) => ({ band, count: 0 }));
  for (const e of events) {
    if (e.km != null && e.km > 0) km += e.km;
    if (e.feedbackAnswered) withFeedback += 1;
    if (e.pain.origin === 'reported_pain') {
      reports += 1;
      if (e.pain.intensity != null && e.pain.intensity >= 1) {
        withInt += 1; sumReported += e.pain.intensity; sumAll += e.pain.intensity; numericTrainings += 1;
        const bin = bins.find((b) => classify(e.pain.intensity, [b.band]) !== null);
        if (bin) bin.count += 1;
      }
    } else {
      numericTrainings += 1; // zero operacional
      if (e.pain.origin === 'explicit_no_pain') explicit += 1; else none += 1;
    }
  }
  const per1000 = (count: number) => (km > 0 ? round2((count / km) * 1000) : null);
  return {
    trainings: events.length,
    km: round2(km),
    reports,
    reportsWithIntensity: withInt,
    reportsWithoutIntensity: reports - withInt,
    reportsPer1000Km: per1000(reports),
    meanIntensityReports: withInt > 0 ? round2(sumReported / withInt) : null,
    meanIntensityAll: numericTrainings > 0 ? round2(sumAll / numericTrainings) : null,
    painPointsPer1000Km: per1000(sumReported),
    intensityBins: bins.map(({ band, count }) => ({ key: band.id, label: band.label, count, pctOfKnown: withInt > 0 ? round2((count / withInt) * 100) : null, per1000Km: per1000(count) })),
    coverage: {
      trainings: events.length, withFeedback, withoutFeedback: events.length - withFeedback, numericIntensityTrainings: numericTrainings,
      intensityCoveragePct: events.length > 0 ? round2((numericTrainings / events.length) * 100) : null,
    },
    zeroOrigins: { explicitNoPain: explicit, noPainReport: none },
  };
}

// ───────────────────────── protecao de celulas pequenas ─────────────────────────
// Agrupamento de celulas pequenas (preferido a esconder): linhas com 1 a (min-1) participantes sao JUNTAS numa linha "Demais grupos" calculada sobre a UNIAO dos dados delas, e os totais
// continuam fechando (nada fica escondido por diferenca). Se a uniao ainda tiver menos que `min` participantes distintos, as menores linhas visiveis entram no agrupamento ate' alcanca-lo.
// Se mesmo todas juntas nao alcancam o piso, tudo e' ocultado.
export const OTHERS_KEY = 'others';
export interface Cell<I> { key: string; label: string; people: Set<string>; items: I[] }
export function collapseSmall<I, T>(cells: Array<Cell<I>>, build: (items: I[]) => T, min: number): { rows: Array<ObsRow<T>>; totalAllowed: boolean } {
  const small = cells.filter((c) => c.people.size > 0 && c.people.size < min);
  const rows: Array<ObsRow<T>> = cells.map((c) => ({ key: c.key, label: c.label, participants: c.people.size, suppressed: false, complementary: false, data: build(c.items) }));
  if (small.length === 0) return { rows, totalAllowed: true };
  const merged = new Set(small.map((c) => c.key));
  const union = new Set<string>(small.flatMap((c) => [...c.people]));
  const visible = cells.filter((c) => c.people.size >= min).sort((a, b) => a.people.size - b.people.size);
  for (const c of visible) { if (union.size >= min) break; merged.add(c.key); for (const p of c.people) union.add(p); }
  const mergedCells = cells.filter((c) => merged.has(c.key));
  const out = rows.map((r) => (merged.has(r.key) ? { ...r, participants: null, suppressed: true, complementary: !small.some((c) => c.key === r.key), data: null } : r));
  if (union.size < min) return { rows: out.map((r) => ({ ...r, participants: null, suppressed: true, data: null })), totalAllowed: false };
  out.push({ key: OTHERS_KEY, label: 'Demais grupos (agrupados por segurança)', participants: union.size, suppressed: false, complementary: false, data: build(mergedCells.flatMap((c) => c.items)) });
  return { rows: out, totalAllowed: true };
}

// Linha com 1 a (min-1) participantes distintos e' suprimida (linha vazia, com zero, nao tem o que proteger). Supressao COMPLEMENTAR: se so' uma linha ficou suprimida, a menor das demais tambem e' ocultada, para a
// soma/total nao permitir reconstruir a oculta por diferenca. O total da tabela so' e' devolvido quando nada foi suprimido.
export function protect<T>(rows: Array<{ key: string; label: string; participants: number; data: T }>, min: number): { rows: Array<ObsRow<T>>; totalAllowed: boolean } {
  const out: Array<ObsRow<T>> = rows.map((row) => { const small = row.participants > 0 && row.participants < min; return { key: row.key, label: row.label, participants: small ? null : row.participants, suppressed: small, complementary: false, data: small ? null : row.data }; });
  const hidden = out.filter((row) => row.suppressed).length;
  if (hidden === 1) {
    const candidates = out.filter((row) => !row.suppressed && (row.participants ?? 0) > 0).sort((a, b) => (a.participants ?? 0) - (b.participants ?? 0));
    const victim = candidates[0];
    if (victim) { victim.suppressed = true; victim.complementary = true; victim.participants = null; victim.data = null; }
  }
  return { rows: out, totalAllowed: out.every((row) => !row.suppressed) };
}
