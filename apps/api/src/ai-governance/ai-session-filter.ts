import { classifyMaterializedCompletion } from '../activity-execution/provider-data-deletion.service';
import { aiBlockedProviders } from './ai-scope';

// Neutraliza, para a IA, sessoes cujo conteudo objetivo veio de um provedor NAO autorizado (ver ai-scope.ts). Mesma semantica da exclusao de dados de um
// provedor (ProviderDataDeletionService): os dados do provedor passam a "nao existir" para a IA, mas o que e' do ALUNO (feedback, esforco percebido, dor,
// observacoes) permanece. Fora de escopo, ou sem provedor bloqueado, devolve a MESMA lista (nenhuma copia, comportamento identico ao anterior).
//
//  - sessao sintetica do relogio (device_extra) de provedor bloqueado: some por inteiro — ela so' existe por causa da atividade;
//  - vinculo ativo com atividade de provedor bloqueado: o vinculo sai da sessao e as colunas do feedback que ainda sao COPIA da atividade (distancia, duracao,
//    FC, ritmo — mesma comparacao tolerante de classifyMaterializedCompletion) viram null; valores digitados/editados pelo aluno ficam.
// Nunca inventa valor: ausencia continua ausencia.

interface LinkedActivityLike {
  provider: string;
  startedAt: Date;
  distanceMeters: number | null;
  durationSec: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
}

export interface SessionForAi {
  origin?: string | null;
  structure?: unknown;
  completion?: unknown;
  executionLinks?: Array<{ activityLog: LinkedActivityLike }>;
}

export function neutralizeSessionsForAi<T extends SessionForAi>(sessions: T[]): T[] {
  const blocked = aiBlockedProviders();
  if (blocked.length === 0) return sessions;
  const result: T[] = [];
  for (const session of sessions) {
    if (session.origin === 'device_extra') {
      const provider = (session.structure as { provider?: unknown } | null)?.provider;
      if (typeof provider === 'string' && blocked.includes(provider)) continue;
    }
    const links = session.executionLinks ?? [];
    const blockedLinks = links.filter((link) => blocked.includes(link.activityLog.provider));
    if (blockedLinks.length === 0) {
      result.push(session);
      continue;
    }
    let completion = session.completion as Record<string, unknown> | null | undefined;
    if (completion) {
      const clear: Record<string, null> = {};
      for (const link of blockedLinks) Object.assign(clear, classifyMaterializedCompletion(completion, link.activityLog).clear);
      if (Object.keys(clear).length > 0) completion = { ...completion, ...clear };
    }
    result.push({ ...session, completion, executionLinks: links.filter((link) => !blocked.includes(link.activityLog.provider)) });
  }
  return result;
}

// Mesma regra aplicada as sessoes de uma lista de planos (historico).
export function neutralizePlansForAi<P extends { sessions: SessionForAi[] }>(plans: P[]): P[] {
  if (aiBlockedProviders().length === 0) return plans;
  return plans.map((plan) => ({ ...plan, sessions: neutralizeSessionsForAi(plan.sessions) }));
}
