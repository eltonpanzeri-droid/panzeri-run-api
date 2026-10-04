import type { PrescribedSegment } from './prescribed-segments';
import type { SeriesPoint, SplitRow } from './activity-splits';

// Cruza parciais/serie canonica com os segmentos prescritos (Bloco 1, 04/10/2026). So' agrega
// valores objetivos — nenhuma nota, percentual ou "dentro/fora da faixa".

export interface SplitWithSegment extends SplitRow {
  startKm: number;
  // Indice do segmento prescrito que contem o INICIO desta parcial; null = fora de qualquer bloco
  // prescrito (ex.: os metros excedentes depois do fim da prescricao).
  segmentIndex: number | null;
}

export interface SegmentRealized {
  distanceKm: number;
  durationSec: number;
  paceSecondsKm: number | null;
  avgHeartRateBpm: number | null;
  avgCadenceSpm: number | null;
}

export interface SegmentSummary extends PrescribedSegment {
  realized: SegmentRealized | null;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

export function attachSegments(splits: SplitRow[]): SplitWithSegment[] {
  let startKm = 0;
  return splits.map((split) => {
    const row: SplitWithSegment = { ...split, startKm: Math.round(startKm * 1000) / 1000, segmentIndex: null };
    startKm += split.distanceKm;
    return row;
  });
}

export function assignSegments(splits: SplitRow[], segments: PrescribedSegment[] | null): SplitWithSegment[] {
  const withStart = attachSegments(splits);
  if (!segments) return withStart;
  // Tolerancia de 1 m: a parcial n fecha no primeiro sample >= n km, entao o "inicio" acumulado nao
  // e' exato; sem ela o limite de 24 km poderia empurrar a parcial 25 para o bloco anterior.
  const EPS = 0.001;
  return withStart.map((row) => {
    const seg = segments.find((s) => row.startKm >= s.startKm - EPS && row.startKm < s.endKm - EPS);
    return { ...row, segmentIndex: seg ? seg.index : null };
  });
}

export function summarizeSegments(
  splits: SplitWithSegment[],
  points: SeriesPoint[],
  segments: PrescribedSegment[] | null,
): SegmentSummary[] {
  if (!segments) return [];
  return segments.map((segment) => {
    const own = splits.filter((s) => s.segmentIndex === segment.index);
    if (own.length === 0) return { ...segment, realized: null };
    const distanceKm = own.reduce((sum, s) => sum + s.distanceKm, 0);
    const durationSec = own.reduce((sum, s) => sum + s.durationSec, 0);
    // FC/cadencia pela serie, na janela de tempo coberta pelas parciais do segmento.
    const lastOffsetEnd = windowEnd(own, splits, points);
    const firstOffsetStart = windowStart(own, splits, points);
    const inWindow = points.filter((p) => p.offsetSec > firstOffsetStart && p.offsetSec <= lastOffsetEnd);
    const hr = inWindow.map((p) => p.heartRateBpm).filter((v): v is number => v != null);
    const cad = inWindow.map((p) => p.cadenceSpm).filter((v): v is number => v != null && v > 0);
    return {
      ...segment,
      realized: {
        distanceKm: Math.round(distanceKm * 100) / 100,
        durationSec,
        paceSecondsKm: distanceKm > 0 ? Math.round(durationSec / distanceKm) : null,
        avgHeartRateBpm: mean(hr),
        avgCadenceSpm: mean(cad),
      },
    };
  });
}

// Offsets absolutos reconstruidos somando duracoes das parciais (cada uma comeca onde a anterior fechou).
function offsets(all: SplitWithSegment[], points: SeriesPoint[]): number[] {
  const sorted = points.filter((p) => p.distanceMeters != null).sort((a, b) => a.offsetSec - b.offsetSec);
  let t = sorted.length ? sorted[0].offsetSec : 0;
  const out = [t];
  for (const s of all) {
    t += s.durationSec;
    out.push(t);
  }
  return out;
}

function windowStart(own: SplitWithSegment[], all: SplitWithSegment[], points: SeriesPoint[]): number {
  return offsets(all, points)[all.indexOf(own[0])];
}

function windowEnd(own: SplitWithSegment[], all: SplitWithSegment[], points: SeriesPoint[]): number {
  return offsets(all, points)[all.indexOf(own[own.length - 1]) + 1];
}
