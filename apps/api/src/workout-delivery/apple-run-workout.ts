import { canonicalModality } from '../activity-execution/canonical-modality';

// Apple Watch via WorkoutKit — PRIMEIRO envio real (escopo minimo): SOMENTE corrida continua externa com distancia definida. Funcao pura que
// decide se uma TrainingSession pode ser representada com seguranca pelo formato simples do WorkoutKit (SingleGoalWorkout de distancia).
// Qualquer coisa fora disso (intervalado, varias partes, caminhada/corrida mista, por tempo, esteira, forca, outras modalidades) e'
// INELEGIVEL: o envio nao e' oferecido. O pace prescrito nao e' enviado (nao ha faixa de pace nesta etapa); so' distancia e data.

export const APPLE_RUN_MAX_DISTANCE_KM = 100;

export interface AppleRunSessionInput {
  id: string;
  modality: string;
  origin: string | null;
  scheduledDate: Date;
  distanceKm: number | null;
  structure: unknown;
  completionStatus?: string | null;
}

export interface AppleRunCanonicalWorkout {
  version: 1;
  kind: 'run';
  modality: 'corrida';
  pacing: 'continuous';
  location: 'outdoor';
  goal: { type: 'distance'; distanceKm: number };
  scheduledDate: string; // YYYY-MM-DD (dia da sessao)
  trainingSessionId: string;
}

export type AppleRunEligibility =
  | { eligible: true; distanceKm: number; scheduledDate: string; canonicalWorkout: AppleRunCanonicalWorkout }
  | { eligible: false; reason: AppleRunIneligibleReason };

export type AppleRunIneligibleReason =
  | 'sessao_extra'
  | 'modalidade_nao_suportada'
  | 'estrutura_nao_suportada'
  | 'varias_partes'
  | 'intervalado'
  | 'por_tempo'
  | 'distancia_invalida'
  | 'distancia_inconsistente'
  | 'data_passada'
  | 'sessao_ja_registrada';

interface RunBlockLike {
  repeatCount?: unknown;
  steps?: unknown;
  durationType?: unknown;
  distanceValue?: unknown;
  distanceUnit?: unknown;
}

export function appleRunEligibility(session: AppleRunSessionInput, todayIso: string): AppleRunEligibility {
  const no = (reason: AppleRunIneligibleReason): AppleRunEligibility => ({ eligible: false, reason });
  const structure = (session.structure && typeof session.structure === 'object' ? session.structure : {}) as { type?: unknown; blocks?: unknown; distanceKm?: unknown };

  if (session.origin === 'device_extra' || structure.type === 'extra') return no('sessao_extra');
  // Modalidade pela representacao canonica; 'esteira' (indoor) fica fora desta etapa.
  if (canonicalModality(session.modality) !== 'corrida') return no('modalidade_nao_suportada');
  if (structure.type !== 'run') return no('estrutura_nao_suportada');
  if (session.completionStatus) return no('sessao_ja_registrada');

  let distanceKm: number | null = null;
  const blocks = Array.isArray(structure.blocks) ? (structure.blocks as RunBlockLike[]) : [];
  if (blocks.length > 1) return no('varias_partes');
  if (blocks.length === 1) {
    const block = blocks[0];
    if (block.repeatCount || block.steps) return no('intervalado');
    if (block.durationType !== 'distance') return no('por_tempo');
    const value = Number(block.distanceValue);
    if (!Number.isFinite(value) || value <= 0) return no('distancia_invalida');
    distanceKm = block.distanceUnit === 'm' ? value / 1000 : value;
  } else {
    const fallback = Number(structure.distanceKm ?? session.distanceKm);
    distanceKm = Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  }

  if (distanceKm === null || distanceKm <= 0 || distanceKm > APPLE_RUN_MAX_DISTANCE_KM) return no('distancia_invalida');
  // A distancia da estrutura e a distancia gravada da sessao precisam concordar (senao nao ha "distancia real prescrita" inequivoca).
  if (session.distanceKm != null && Math.abs(session.distanceKm - distanceKm) > 0.05) return no('distancia_inconsistente');

  const scheduledDate = session.scheduledDate.toISOString().slice(0, 10);
  if (scheduledDate < todayIso) return no('data_passada');

  const rounded = Math.round(distanceKm * 1000) / 1000;
  return {
    eligible: true,
    distanceKm: rounded,
    scheduledDate,
    canonicalWorkout: {
      version: 1,
      kind: 'run',
      modality: 'corrida',
      pacing: 'continuous',
      location: 'outdoor',
      goal: { type: 'distance', distanceKm: rounded },
      scheduledDate,
      trainingSessionId: session.id,
    },
  };
}
