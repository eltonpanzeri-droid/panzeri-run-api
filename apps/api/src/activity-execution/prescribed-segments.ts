// Segmentos prescritos por distancia (Bloco 1, 04/10/2026). Le TrainingSession.structure.blocks
// (formato gravado por TrainingPlansService.runPrescription) e devolve a linha do tempo da
// prescricao em km acumulados. Nao ha' numero fixo: serve para qualquer prescricao estruturada por
// distancia. Estrutura sem distancia em km (ex.: por tempo) => null, e quem chama NAO agrupa nada.

export interface PrescribedSegment {
  index: number;
  label: string;
  startKm: number;
  endKm: number;
  // Pace prescrito em segundos/km. fast = menor valor (mais rapido), slow = maior.
  paceFastSecondsKm: number | null;
  paceSlowSecondsKm: number | null;
}

interface StepLike {
  label?: unknown;
  distanceValue?: unknown;
  distanceUnit?: unknown;
  paceRange?: unknown;
}

// Formato real gravado: "5:25/km a 5:40/km".
const PACE_RANGE = /(\d+):(\d{2})\s*\/km\s*a\s*(\d+):(\d{2})\s*\/km/;

function parsePaceRange(value: unknown): { fast: number; slow: number } | null {
  if (typeof value !== 'string') return null;
  const match = PACE_RANGE.exec(value);
  if (!match) return null;
  const a = Number(match[1]) * 60 + Number(match[2]);
  const b = Number(match[3]) * 60 + Number(match[4]);
  return { fast: Math.min(a, b), slow: Math.max(a, b) };
}

function stepDistanceKm(step: StepLike): number | null {
  if (step.distanceUnit !== 'km') return null;
  const d = step.distanceValue;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
}

export function extractPrescribedSegments(structure: unknown): PrescribedSegment[] | null {
  if (!structure || typeof structure !== 'object') return null;
  const blocks = (structure as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  const segments: PrescribedSegment[] = [];
  let cursor = 0;
  const push = (label: string, distanceKm: number, step: StepLike) => {
    const pace = parsePaceRange(step.paceRange);
    segments.push({
      index: segments.length,
      label,
      startKm: round3(cursor),
      endKm: round3(cursor + distanceKm),
      paceFastSecondsKm: pace?.fast ?? null,
      paceSlowSecondsKm: pace?.slow ?? null,
    });
    cursor += distanceKm;
  };

  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') return null;
    const block = raw as StepLike & { repeatCount?: unknown; steps?: unknown };
    const blockLabel = typeof block.label === 'string' ? block.label : 'Bloco';

    if (Array.isArray(block.steps) && typeof block.repeatCount === 'number' && block.repeatCount > 0) {
      for (let rep = 1; rep <= block.repeatCount; rep++) {
        for (const rawStep of block.steps) {
          const step = (rawStep ?? {}) as StepLike;
          const distance = stepDistanceKm(step);
          if (distance == null) return null;
          const stepLabel = typeof step.label === 'string' ? step.label : 'Etapa';
          push(`${blockLabel} · ${stepLabel} ${rep}/${block.repeatCount}`, distance, step);
        }
      }
      continue;
    }

    const distance = stepDistanceKm(block);
    if (distance == null) return null;
    push(blockLabel, distance, block);
  }
  return segments.length > 0 ? segments : null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
