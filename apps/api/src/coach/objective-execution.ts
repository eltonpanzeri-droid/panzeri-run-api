// Execucao OBJETIVA (relogio/provedor) de uma sessao no painel do treinador. Mesma regra de EvolutionMetricService.classifySession e do app da aluna: um vinculo ativo
// com atividade basta para "feito" (o feedback nao confirma nem nega a execucao) e o volume vem da atividade, nao do que foi digitado. Sem isto, treino feito e vinculado
// mas sem feedback aparecia como "sem registro" e com 0 km nos graficos do painel (bug real 20/10/2026: 10,15 km de terca nao entravam na semana).

export interface LinkedActivityLike {
  activityLog: { id?: string; distanceMeters: number | null; durationSec: number | null };
}

export interface ObjectiveExecution {
  linked: boolean;
  distanceKm: number | null;
  durationMin: number | null;
  paceSecondsKm: number | null;
}

export function objectiveExecutionOf(session: { executionLinks?: LinkedActivityLike[] | null }): ObjectiveExecution {
  const links = session.executionLinks ?? [];
  if (links.length === 0) return { linked: false, distanceKm: null, durationMin: null, paceSecondsKm: null };
  const seen = new Set<string>();
  let meters = 0;
  let seconds = 0;
  let hasMeters = false;
  let hasSeconds = false;
  for (const link of links) {
    const id = link.activityLog.id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    if (link.activityLog.distanceMeters != null) { meters += link.activityLog.distanceMeters; hasMeters = true; }
    if (link.activityLog.durationSec != null) { seconds += link.activityLog.durationSec; hasSeconds = true; }
  }
  const distanceKm = hasMeters ? meters / 1000 : null;
  const durationMin = hasSeconds ? seconds / 60 : null;
  const paceSecondsKm = hasMeters && hasSeconds && meters > 0 && seconds > 0 ? Math.round(seconds / (meters / 1000)) : null;
  return { linked: true, distanceKm, durationMin, paceSecondsKm };
}
