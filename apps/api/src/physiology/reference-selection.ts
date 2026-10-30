// Seleção da avaliação de referência (Testes físicos, Lote 2, 30/10/2026). Função PURA.
//
// Regra aprovada por Elton:
//  - usa a DATA REAL do teste (performedAt), nunca a data do cadastro;
//  - pega a avaliação mais recente e a ergoespirometria mais recente;
//  - se a diferença entre elas for de até 60 dias (inclusive), a ergoespirometria é a referência; acima disso, a mais recente;
//  - sem ergoespirometria, a mais recente.
// Desempate determinístico para avaliações na mesma data: prioridade do método, depois cadastro mais recente, depois id.

export const METHOD_PRIORITY = ['ergospirometry', 'lactate', 'incremental', 'five_km', 'three_km', 'cooper_12min', 'other', 'unknown'] as const;
export type AssessmentMethod = (typeof METHOD_PRIORITY)[number];
export const ERGO_WINDOW_DAYS = 60;

export interface SelectableAssessment { id: string; method: string; performedAt: Date; createdAt: Date }

const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
const priorityOf = (method: string) => { const i = METHOD_PRIORITY.indexOf(method as AssessmentMethod); return i === -1 ? METHOD_PRIORITY.length : i; };

// Ordem total e determinística: mais recente primeiro.
export function compareAssessments(a: SelectableAssessment, b: SelectableAssessment): number {
  const byDate = dayNumber(b.performedAt) - dayNumber(a.performedAt);
  if (byDate !== 0) return byDate;
  const byMethod = priorityOf(a.method) - priorityOf(b.method);
  if (byMethod !== 0) return byMethod;
  const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface ReferenceChoice<T extends SelectableAssessment> { reference: T; latest: T; reason: 'unica' | 'mais_recente' | 'ergoespirometria_ate_60_dias' | 'mais_recente_ergoespirometria_antiga'; gapDays: number | null }

export function selectReference<T extends SelectableAssessment>(assessments: T[]): ReferenceChoice<T> | null {
  if (assessments.length === 0) return null;
  const sorted = [...assessments].sort(compareAssessments);
  const latest = sorted[0];
  if (assessments.length === 1) return { reference: latest, latest, reason: 'unica', gapDays: null };
  const ergo = sorted.find((a) => a.method === 'ergospirometry');
  if (!ergo) return { reference: latest, latest, reason: 'mais_recente', gapDays: null };
  if (ergo.id === latest.id) return { reference: ergo, latest, reason: 'ergoespirometria_ate_60_dias', gapDays: 0 };
  const gapDays = dayNumber(latest.performedAt) - dayNumber(ergo.performedAt);
  if (gapDays <= ERGO_WINDOW_DAYS) return { reference: ergo, latest, reason: 'ergoespirometria_ate_60_dias', gapDays };
  return { reference: latest, latest, reason: 'mais_recente_ergoespirometria_antiga', gapDays };
}

// Complementação de indicadores: um indicador ausente na referência pode vir de outra avaliação, sempre com procedência.
export interface ProvenancedIndicator { key: string; assessmentId: string; method: string; performedAt: Date; origin: string; value: number }

export function composeIndicators<T extends SelectableAssessment>(
  choice: ReferenceChoice<T>,
  assessments: T[],
  indicatorsByAssessment: Map<string, Array<{ key: string; value: number; origin: string }>>,
): Array<ProvenancedIndicator & { fromReference: boolean }> {
  const out = new Map<string, ProvenancedIndicator & { fromReference: boolean }>();
  const take = (assessment: T, fromReference: boolean) => {
    for (const indicator of indicatorsByAssessment.get(assessment.id) ?? []) {
      if (out.has(indicator.key)) continue;
      out.set(indicator.key, { key: indicator.key, value: indicator.value, origin: indicator.origin, assessmentId: assessment.id, method: assessment.method, performedAt: assessment.performedAt, fromReference });
    }
  };
  take(choice.reference, true);
  for (const other of [...assessments].sort(compareAssessments)) if (other.id !== choice.reference.id) take(other, false);
  return [...out.values()];
}

// Lembrete de reavaliação: 4 meses de calendário depois da avaliação aeróbia mais recente (data real do teste).
export function nextReassessmentDue(assessments: SelectableAssessment[]): Date | null {
  if (assessments.length === 0) return null;
  const latest = [...assessments].sort(compareAssessments)[0].performedAt;
  const due = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() + 4, latest.getUTCDate()));
  // 31/out + 4 meses não existe em fevereiro/junho: o JS rola para o mês seguinte; volta para o último dia do mês certo
  if (due.getUTCDate() !== latest.getUTCDate()) due.setUTCDate(0);
  return due;
}
