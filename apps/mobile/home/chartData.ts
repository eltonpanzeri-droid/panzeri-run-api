import type { SnapshotLite } from './insights';

// Conversao de observacoes do motor longitudinal em pontos de grafico. Eixo X = dias (fracionario)
// desde a epoca Unix, para o DetailChart gerar rotulos de data legiveis. Valores nao numericos
// (categoricos) e ausentes nunca viram ponto — e' ausencia, nunca zero.

const DAY_MS = 86400000;

export function dayFromIso(iso: string): number {
  return new Date(iso).getTime() / DAY_MS;
}

export function formatDayLabel(day: number): string {
  const d = new Date(Math.round(day * DAY_MS));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatDayLong(day: number): string {
  const d = new Date(Math.round(day * DAY_MS));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function observationPoints(snapshot: SnapshotLite): Array<{ x: number; y: number }> {
  return snapshot.observations
    .filter((o): o is typeof o & { value: number } => typeof o.value === 'number' && Number.isFinite(o.value))
    .map((o) => ({ x: dayFromIso(o.timestamp), y: o.value }))
    .sort((a, b) => a.x - b.x);
}

export function movingAveragePoints(snapshot: SnapshotLite, key = 'short_21d'): Array<{ x: number; y: number | null }> {
  const series = snapshot.movingAverageSeries?.[key] ?? [];
  return series.map((p) => ({ x: dayFromIso(p.timestamp), y: p.value })).sort((a, b) => a.x - b.x);
}
