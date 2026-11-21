// Treino executavel do Panzeri Run (Iniciar treino) — NUCLEO PURO, sem React Native, sem rede e sem banco (21/11/2026, ordem de Elton).
// Estrutura copiada do Panz Fit (etapas e series) e adaptada: quem monta o treino e' a IA prescritora, entao o treino chega da prescricao da semana (prescriptionToWorkout) ou, no "treino do zero", das etapas
// que a propria aluna cria. Este arquivo NUNCA decide nem calcula conteudo de treino (regra: sem matematica de prescricao): so' converte o que a IA prescreveu em etapas, converte unidade (km -> m)
// e compara o que foi medido com a faixa prescrita. Meta ausente na prescricao = etapa SEM meta de ritmo (nunca se inventa faixa).

export type StepPhase = 'warmup' | 'work' | 'recovery-active' | 'recovery-passive' | 'continuous' | 'cooldown';
export type Completion = { kind: 'distance'; meters: number } | { kind: 'duration'; seconds: number } | { kind: 'manual' };
export type Target =
  | { metric: 'pace'; minSecPerKm: number; maxSecPerKm: number }
  | { metric: 'heart-rate'; minBpm: number; maxBpm: number };

export type StepNode = { kind: 'step'; id: string; name: string; phase: StepPhase; completion: Completion; targets: Target[] };
export type SeriesOverride = { work?: Partial<Pick<StepNode, 'completion' | 'targets' | 'name'>>; recovery?: Partial<Pick<StepNode, 'completion' | 'targets' | 'name'>>; skipRecovery?: boolean };
// includeFinalRecovery: a prescricao da IA conta a recuperacao de TODAS as repeticoes (inclusive a ultima) no total do treino; o Panz Fit nao tem recuperacao depois da ultima serie.
export type RepeatNode = { kind: 'repeat'; id: string; name: string; count: number; work: StepNode; recovery?: StepNode; overrides?: Record<number, SeriesOverride>; includeFinalRecovery?: boolean };
export type WorkoutNode = StepNode | RepeatNode;
export type WorkoutDefinition = { schema: 'br.panzerirun.run-workout'; schemaVersion: 1; id: string; revision: number; title: string; nodes: WorkoutNode[] };
export type ExecutableStep = StepNode & { executionId: string; ordinal: number; repeat?: { repeatId: string; iteration: number; count: number } };
export type ValidationIssue = { path: string; message: string };

export const RUN_WORKOUT_SCHEMA = 'br.panzerirun.run-workout' as const;

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const validateStep = (step: StepNode, path: string, issues: ValidationIssue[]) => {
  if (!step.id.trim()) issues.push({ path, message: 'Etapa sem identificador.' });
  if (step.completion.kind === 'distance' && (!finitePositive(step.completion.meters) || step.completion.meters > 200_000)) issues.push({ path, message: 'Distância inválida.' });
  if (step.completion.kind === 'duration' && (!finitePositive(step.completion.seconds) || step.completion.seconds > 86_400)) issues.push({ path, message: 'Duração inválida.' });
  if (step.phase === 'recovery-passive' && step.completion.kind === 'distance') issues.push({ path, message: 'Recuperação passiva não pode terminar por distância.' });
  const metrics = new Set<string>();
  step.targets.forEach((target, index) => {
    if (metrics.has(target.metric)) issues.push({ path: `${path}.targets[${index}]`, message: 'Meta duplicada.' });
    metrics.add(target.metric);
    if (target.metric === 'pace' && (!finitePositive(target.minSecPerKm) || target.minSecPerKm > target.maxSecPerKm || target.maxSecPerKm > 3_600)) issues.push({ path: `${path}.targets[${index}]`, message: 'Faixa de pace inválida.' });
    if (target.metric === 'heart-rate' && (target.minBpm < 30 || target.minBpm > target.maxBpm || target.maxBpm > 240)) issues.push({ path: `${path}.targets[${index}]`, message: 'Faixa cardíaca inválida.' });
  });
};

export function validateWorkout(workout: WorkoutDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  if (workout.schema !== RUN_WORKOUT_SCHEMA || workout.schemaVersion !== 1) issues.push({ path: 'schema', message: 'Versão de treino não suportada.' });
  if (!workout.nodes.length) issues.push({ path: 'nodes', message: 'Adicione pelo menos uma etapa.' });
  workout.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (ids.has(node.id)) issues.push({ path, message: 'Identificador duplicado.' });
    ids.add(node.id);
    if (node.kind === 'step') validateStep(node, path, issues);
    else {
      if (!Number.isInteger(node.count) || node.count < 1 || node.count > 100) issues.push({ path, message: 'Número de séries inválido.' });
      [node.work, node.recovery].filter(Boolean).forEach((step) => {
        const child = step!;
        if (ids.has(child.id)) issues.push({ path, message: 'Identificador duplicado.' });
        ids.add(child.id);
        validateStep(child, `${path}.${child.phase}`, issues);
      });
      Object.keys(node.overrides ?? {}).forEach((key) => {
        const iteration = Number(key);
        if (!Number.isInteger(iteration) || iteration < 1 || iteration > node.count) issues.push({ path: `${path}.overrides.${key}`, message: 'Série personalizada fora do limite.' });
      });
    }
  });
  return issues;
}

const mergeStep = (base: StepNode, override?: Partial<Pick<StepNode, 'completion' | 'targets' | 'name'>>): StepNode => ({
  ...base, ...override, completion: override?.completion ?? base.completion, targets: override?.targets ?? base.targets,
});

export function compileWorkout(workout: WorkoutDefinition): ExecutableStep[] {
  const issues = validateWorkout(workout);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  const output: ExecutableStep[] = [];
  const emit = (step: StepNode, repeat?: ExecutableStep['repeat']) =>
    output.push({ ...step, executionId: `${workout.id}:r${workout.revision}:${output.length + 1}${repeat ? `:${repeat.repeatId}:${repeat.iteration}` : ''}`, ordinal: output.length + 1, repeat });
  workout.nodes.forEach((node) => {
    if (node.kind === 'step') emit(node);
    else {
      for (let iteration = 1; iteration <= node.count; iteration++) {
        const override = node.overrides?.[iteration];
        const repeat = { repeatId: node.id, iteration, count: node.count };
        emit(mergeStep(node.work, override?.work), repeat);
        const wantsRecovery = iteration < node.count || node.includeFinalRecovery === true;
        if (node.recovery && !override?.skipRecovery && wantsRecovery) emit(mergeStep(node.recovery, override?.recovery), repeat);
      }
    }
  });
  if (output.length > 1_000) throw new Error('Treino excede o limite de 1.000 etapas executáveis.');
  return output;
}

export function completionReached(step: ExecutableStep, progress: { distanceM: number; elapsedMs: number }) {
  if (step.completion.kind === 'distance') return progress.distanceM >= step.completion.meters;
  if (step.completion.kind === 'duration') return progress.elapsedMs >= step.completion.seconds * 1000;
  return false;
}

// Estado do ritmo medido contra a faixa prescrita (so' comparacao): mais rapido que o minimo = 'too-fast'; mais lento que o maximo = 'too-slow'.
export type PaceZone = 'in-zone' | 'too-fast' | 'too-slow' | 'unavailable';
export function paceZoneFor(step: Pick<ExecutableStep, 'targets'> | null | undefined, currentSecPerKm: number | null): PaceZone {
  const target = step?.targets.find((item) => item.metric === 'pace');
  if (!target || target.metric !== 'pace') return 'unavailable';
  if (currentSecPerKm === null || !Number.isFinite(currentSecPerKm) || currentSecPerKm <= 0) return 'unavailable';
  if (currentSecPerKm < target.minSecPerKm) return 'too-fast';
  if (currentSecPerKm > target.maxSecPerKm) return 'too-slow';
  return 'in-zone';
}

export function formatMinuteSecond(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export function parseMinuteSecond(value: string) {
  const match = value.trim().match(/^(\d{1,3}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return seconds < 60 ? minutes * 60 + seconds : null;
}
