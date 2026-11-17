import { isRunModality } from '../activity-execution/canonical-modality';
import { buildCanonicalWorkout, type CanonicalStep, type CanonicalWorkoutItem } from '../training-plans/canonical-workout';

// Treino da semana para o relogio (17/11/2026, fase 1 do Wear OS): so' LEITURA, formato enxuto para a tela pequena e para guardar no relogio (funciona sem internet). Nada de texto livre da aluna,
// historico ou dado de saude: so' o que foi prescrito. Funcao pura sobre a sessao ja' lida.

export interface WearSessionRow {
  id: string;
  scheduledDate: Date;
  weekday: number;
  modality: string;
  title: string;
  durationMin: number | null;
  distanceKm: number | null;
  structure: unknown;
  origin: string | null;
  completionStatus: string | null;
}

export interface WearStep {
  kind: 'step';
  label: string | null;
  role: 'main' | 'work' | 'recovery';
  // meta do passo: distancia (m), tempo (s) ou aberta
  goal: { type: 'distance'; meters: number } | { type: 'time'; seconds: number } | { type: 'open' };
  // faixa de pace prescrita em s/km (rapido..lento); null = sem pace
  pace: { fastSecPerKm: number; slowSecPerKm: number } | null;
}
export interface WearRepeat { kind: 'repeat'; repeatCount: number; steps: WearStep[] }

export interface WearSession {
  id: string;
  date: string; // YYYY-MM-DD (dia local da aluna)
  weekday: number;
  kind: 'corrida' | 'forca' | 'fortalecimento' | 'outra';
  title: string;
  durationMin: number | null;
  distanceKm: number | null;
  done: boolean;
  // so' corrida estruturada; vazio = o relogio mostra titulo, duracao e distancia
  steps: Array<WearStep | WearRepeat>;
}

const toStep = (step: CanonicalStep): WearStep => ({
  kind: 'step', label: step.label, role: step.role, goal: step.goal,
  pace: step.pace ? { fastSecPerKm: step.pace.prescribed.fastSecPerKm, slowSecPerKm: step.pace.prescribed.slowSecPerKm } : null,
});

function toItems(items: CanonicalWorkoutItem[]): Array<WearStep | WearRepeat> {
  return items.map((item) => (item.kind === 'repeat' ? { kind: 'repeat' as const, repeatCount: item.repeatCount, steps: item.steps.map(toStep) } : toStep(item)));
}

export function wearSessionOf(row: WearSessionRow): WearSession {
  const structure = (row.structure && typeof row.structure === 'object' ? row.structure : {}) as { type?: unknown };
  const run = isRunModality(row.modality);
  const kind: WearSession['kind'] = run ? 'corrida' : row.modality === 'forca' ? 'forca' : row.modality === 'fortalecimento_corredores' ? 'fortalecimento' : 'outra';
  const steps = run && structure.type === 'run' && row.origin !== 'device_extra' ? toItems(buildCanonicalWorkout({ id: row.id, modality: row.modality, structure: row.structure }).items) : [];
  return {
    id: row.id, date: row.scheduledDate.toISOString().slice(0, 10), weekday: row.weekday, kind, title: row.title,
    durationMin: row.durationMin, distanceKm: row.distanceKm, done: row.completionStatus !== null, steps,
  };
}

// Treinos "extra" (atividade que o relogio ou a aluna registrou sem prescricao) nao sao treino a seguir: ficam fora da lista do relogio.
export function wearSessionsOf(rows: WearSessionRow[]): WearSession[] {
  return rows
    .filter((row) => row.origin !== 'device_extra' && row.origin !== 'student_extra')
    .map(wearSessionOf)
    .sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? -1 : 1));
}
