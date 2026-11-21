// Prescricao da IA -> treino executavel (21/11/2026). Le a mesma estrutura de partes que a IA gera (sessao.parts: 'continua' e 'intervalada', ver training-methodology.ts) e devolve etapas para o Iniciar treino.
// REGRAS: (1) so' converte e copia: km -> metros, faixa de ritmo da IA -> meta de ritmo; nao calcula, nao completa e nao corrige a prescricao (sem matematica de prescricao); (2) faixa ausente ou invalida = etapa SEM
// meta de ritmo (o app so' guia pela distancia); (3) cada repeticao tem estimulo + recuperacao, inclusive a ultima, como a prescricao soma o total do treino e como o relogio recebe (includeFinalRecovery).
import { RUN_WORKOUT_SCHEMA, StepNode, Target, WorkoutDefinition, WorkoutNode, validateWorkout } from './workout';

export type PrescribedContinuousPart = { kind: 'continua'; distanceKm: number; paceSecondsPerKmMin: number; paceSecondsPerKmMax: number };
export type PrescribedIntervalPart = {
  kind: 'intervalada'; repeatCount: number;
  stimulusLabel: string; stimulusStepKm: number; stimulusPaceSecondsPerKmMin?: number; stimulusPaceSecondsPerKmMax?: number;
  recoveryLabel: string; recoveryStepKm: number; recoveryPaceSecondsPerKmMin?: number; recoveryPaceSecondsPerKmMax?: number;
};
export type PrescribedPart = PrescribedContinuousPart | PrescribedIntervalPart;

type LoosePart = { kind?: string } & Partial<Omit<PrescribedContinuousPart, 'kind'>> & Partial<Omit<PrescribedIntervalPart, 'kind'>>;

const rangeTarget = (min: unknown, max: unknown): Target[] =>
  typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max) && min > 0 && min <= max ? [{ metric: 'pace', minSecPerKm: min, maxSecPerKm: max }] : [];

const meters = (km: number) => Math.round(km * 1000);

export function prescriptionToWorkout(input: { id: string; title: string; revision?: number; parts: unknown }): WorkoutDefinition | null {
  if (!Array.isArray(input.parts) || input.parts.length === 0) return null;
  const nodes: WorkoutNode[] = [];
  for (let index = 0; index < input.parts.length; index++) {
    const part = input.parts[index] as LoosePart | null;
    if (!part || typeof part !== 'object') return null;
    if (part.kind === 'continua') {
      if (typeof part.distanceKm !== 'number') return null;
      const step: StepNode = { kind: 'step', id: `p${index + 1}`, name: 'Contínuo', phase: 'continuous', completion: { kind: 'distance', meters: meters(part.distanceKm) }, targets: rangeTarget(part.paceSecondsPerKmMin, part.paceSecondsPerKmMax) };
      nodes.push(step);
    } else if (part.kind === 'intervalada') {
      if (typeof part.repeatCount !== 'number' || typeof part.stimulusStepKm !== 'number' || typeof part.recoveryStepKm !== 'number') return null;
      nodes.push({
        kind: 'repeat', id: `p${index + 1}`, name: 'Intervalado', count: part.repeatCount, includeFinalRecovery: true,
        work: { kind: 'step', id: `p${index + 1}-work`, name: part.stimulusLabel || 'Estímulo', phase: 'work', completion: { kind: 'distance', meters: meters(part.stimulusStepKm) }, targets: rangeTarget(part.stimulusPaceSecondsPerKmMin, part.stimulusPaceSecondsPerKmMax) },
        recovery: { kind: 'step', id: `p${index + 1}-rec`, name: part.recoveryLabel || 'Recuperação', phase: 'recovery-active', completion: { kind: 'distance', meters: meters(part.recoveryStepKm) }, targets: rangeTarget(part.recoveryPaceSecondsPerKmMin, part.recoveryPaceSecondsPerKmMax) },
      });
    } else return null;
  }
  const workout: WorkoutDefinition = { schema: RUN_WORKOUT_SCHEMA, schemaVersion: 1, id: input.id, revision: input.revision ?? 1, title: input.title, nodes };
  // Prescricao fora do que o executor suporta (distancia zero, serie 0...) = nao executavel: o Panzeri Run mostra o treino normalmente, sem o botao Iniciar guiado (nunca "conserta" a prescricao).
  return validateWorkout(workout).length === 0 ? workout : null;
}
