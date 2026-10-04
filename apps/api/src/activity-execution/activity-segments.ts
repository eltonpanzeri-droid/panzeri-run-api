import type { PrescribedSegment } from './prescribed-segments';
import type { SeriesPoint, SplitRow } from './activity-splits';

// Cruza parciais/serie canonica com os segmentos prescritos (Bloco 1, 04/10/2026). So' agrega
// valores objetivos — nenhuma nota, percentual ou "dentro/fora da faixa".

export interface SplitWithSegment extends SplitRow {
  startKm: number;
  // Indice do segmento prescrito que contem o INICIO desta parcial; null = fora de qualquer bloco
  // prescrito (ex.: os metros excedentes depois do fim da prescricao).
  segmentIndex: number | null;
  // Melhorias pos-Bloco 1 (04/10/2026): pace prescrito explicito na propria parcial (nao so' no
  // resumo por bloco) — evita o cliente ter que cruzar splits[i].segmentIndex com
  // prescribedSegments[segmentIndex] so' pra mostrar "prescrito" ao lado do "realizado" de cada km.
  // null quando segmentIndex e' null (fora de qualquer bloco prescrito).
  prescribedPaceFastSecondsKm: number | null;
  prescribedPaceSlowSecondsKm: number | null;
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
    const row: SplitWithSegment = {
      ...split,
      startKm: Math.round(startKm * 1000) / 1000,
      segmentIndex: null,
      prescribedPaceFastSecondsKm: null,
      prescribedPaceSlowSecondsKm: null,
    };
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
    return {
      ...row,
      segmentIndex: seg ? seg.index : null,
      prescribedPaceFastSecondsKm: seg?.paceFastSecondsKm ?? null,
      prescribedPaceSlowSecondsKm: seg?.paceSlowSecondsKm ?? null,
    };
  });
}

// Melhorias pos-Bloco 1 (04/10/2026): calculado DIRETO da serie temporal (points), nao mais a
// partir de parciais de 1 km pre-agregadas — um bloco prescrito menor que 1 km (ex.: intervalado
// 400 m / 200 m) nao se encaixa em baldes de km inteiro, e agregar por km ali misturava estimulo e
// recuperacao no mesmo numero. Generico: funciona igual para blocos de 24 km ou de 0,4 km, sem
// hardcode de distancia. Mesma politica de fechamento de buildSplits (primeiro sample >= alvo,
// sem interpolacao) — nunca inventa posicao entre amostras.
export function summarizeSegments(
  points: SeriesPoint[],
  segments: PrescribedSegment[] | null,
): SegmentSummary[] {
  if (!segments) return [];
  const withDistance = points.filter((p) => p.distanceMeters != null).sort((a, b) => a.offsetSec - b.offsetSec);
  if (withDistance.length === 0) return segments.map((s) => ({ ...s, realized: null }));

  const sampleAtOrAfter = (targetMeters: number) => withDistance.find((p) => (p.distanceMeters as number) >= targetMeters) ?? null;

  let cursorOffset = withDistance[0].offsetSec;
  return segments.map((segment) => {
    const endSample = sampleAtOrAfter(segment.endKm * 1000);
    // Atividade terminou antes deste bloco (ou de um bloco anterior) ser alcancado — sem dados
    // reais pra esse trecho, nunca inventa. Mantem cursorOffset parado: blocos seguintes tambem null.
    if (!endSample || endSample.offsetSec <= cursorOffset) {
      return { ...segment, realized: null };
    }
    const fromOffset = cursorOffset;
    const toOffset = endSample.offsetSec;
    const inWindow = points.filter((p) => p.offsetSec > fromOffset && p.offsetSec <= toOffset);
    const hr = inWindow.map((p) => p.heartRateBpm).filter((v): v is number => v != null);
    const cad = inWindow.map((p) => p.cadenceSpm).filter((v): v is number => v != null && v > 0);
    const startDistance = (withDistance.find((p) => p.offsetSec === fromOffset)?.distanceMeters ?? segment.startKm * 1000) as number;
    const distanceKm = Math.round(((endSample.distanceMeters as number) - startDistance) / 10) / 100;
    const durationSec = toOffset - fromOffset;
    cursorOffset = toOffset;
    return {
      ...segment,
      realized: {
        distanceKm,
        durationSec,
        paceSecondsKm: distanceKm > 0 ? Math.round(durationSec / distanceKm) : null,
        avgHeartRateBpm: mean(hr),
        avgCadenceSpm: mean(cad),
      },
    };
  });
}
