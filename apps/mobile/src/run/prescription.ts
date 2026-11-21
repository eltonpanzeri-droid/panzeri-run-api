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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Treino da SEMANA como o Panzeri Run o recebe (session.structure, ja' montado pelo servidor a partir das partes da IA): blocos com distancia em km e a faixa de ritmo escrita como "5:30 a 6:00".
// O que a aluna le na prescricao e' exatamente o que o Iniciar treino guia: este leitor so' converte esse texto em etapas (sem calcular nada). Qualquer bloco que nao seja de distancia, sem unidade
// conhecida ou com formato inesperado torna o treino "nao guiado" (null): ele continua podendo ser gravado como treino livre vinculado a esta sessao, sem etapas.
export type StoredRunStep = { label?: string; distanceValue?: string | number; distanceUnit?: string; paceRange?: string | null; durationType?: string };
export type StoredRunBlock = StoredRunStep & { repeatCount?: number; steps?: StoredRunStep[] };
export type StoredRunStructure = { type?: string; blocks?: StoredRunBlock[] } | null | undefined;

const PACE_RANGE = /^\s*(\d{1,2}):([0-5]\d)(?:\s*\/\s*km)?\s*(?:a|–|-|—)\s*(\d{1,2}):([0-5]\d)/i;

// "5:30 a 6:00" -> { minSecPerKm: 330, maxSecPerKm: 360 }; qualquer outra coisa (ou faixa invertida) -> null.
export function parsePaceRange(text: unknown): { minSecPerKm: number; maxSecPerKm: number } | null {
  if (typeof text !== 'string') return null;
  const match = PACE_RANGE.exec(text);
  if (!match) return null;
  const min = Number(match[1]) * 60 + Number(match[2]);
  const max = Number(match[3]) * 60 + Number(match[4]);
  return min > 0 && min <= max ? { minSecPerKm: min, maxSecPerKm: max } : null;
}

function distanceMetersOf(step: StoredRunStep): number | null {
  if (step.durationType !== undefined && step.durationType !== 'distance') return null;
  const value = typeof step.distanceValue === 'string' ? Number(step.distanceValue.replace(',', '.')) : step.distanceValue;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (step.distanceUnit === 'km') return Math.round(value * 1000);
  if (step.distanceUnit === 'm') return Math.round(value);
  return null;
}

const pace = (step: StoredRunStep): Target[] => {
  const range = parsePaceRange(step.paceRange);
  return range ? [{ metric: 'pace', ...range }] : [];
};

export function structureToWorkout(input: { id: string; title: string; revision?: number; structure: StoredRunStructure }): WorkoutDefinition | null {
  const blocks = input.structure?.blocks;
  if (input.structure?.type !== 'run' || !Array.isArray(blocks) || blocks.length === 0) return null;
  const nodes: WorkoutNode[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block || typeof block !== 'object') return null;
    if (block.repeatCount && block.steps) {
      if (block.steps.length !== 2) return null;
      const [work, recovery] = block.steps;
      const workM = distanceMetersOf(work);
      const recoveryM = distanceMetersOf(recovery);
      if (workM === null || recoveryM === null) return null;
      nodes.push({
        kind: 'repeat', id: `b${index + 1}`, name: 'Intervalado', count: block.repeatCount, includeFinalRecovery: true,
        work: { kind: 'step', id: `b${index + 1}-work`, name: work.label || 'Estímulo', phase: 'work', completion: { kind: 'distance', meters: workM }, targets: pace(work) },
        recovery: { kind: 'step', id: `b${index + 1}-rec`, name: recovery.label || 'Recuperação', phase: 'recovery-active', completion: { kind: 'distance', meters: recoveryM }, targets: pace(recovery) },
      });
    } else {
      const meters = distanceMetersOf(block);
      if (meters === null) return null;
      nodes.push({ kind: 'step', id: `b${index + 1}`, name: 'Contínuo', phase: 'continuous', completion: { kind: 'distance', meters }, targets: pace(block) });
    }
  }
  const workout: WorkoutDefinition = { schema: RUN_WORKOUT_SCHEMA, schemaVersion: 1, id: input.id, revision: input.revision ?? 1, title: input.title, nodes };
  return validateWorkout(workout).length === 0 ? workout : null;
}
