// Decisoes HUMANAS sobre a identidade fisica (aluno ou treinador) — nucleo puro, sem banco.
//
// Onde ficam: dentro de ActivityLog.physicalIdentityEvidence.humanDecisions (JSON ja' existente, escrito so' pela camada de identidade e por
// IdentityConfirmationService). Cada decisao e' copiada nas observacoes que ela envolve, com autoria, horario e estado — rastreabilidade sem
// tabela nova. Reverter NUNCA apaga: marca status 'reverted' (quem/quando) e preserva o registro.
//
// Semantica: a decisao humana e' sobre a IDENTIDADE (mesma execucao x execucoes distintas), nunca sobre os dados objetivos do dispositivo.
//  - 'same': os pares listados representam a mesma execucao fisica. NAO e' aplicada quando a evidencia objetiva e' DECISIVAMENTE contraria
//    (outro atleta, modalidade incompativel, horarios sem sobreposicao): nesse caso fica 'suspended' e visivel para o treinador — nunca
//    sobrescreve a evidencia em silencio, nem e' descartada em silencio.
//  - 'distinct': os pares listados sao execucoes diferentes (nunca agrupadas).

import type { IdentityComparison } from './physical-activity-identity';

export type HumanDecisionKind = 'same' | 'distinct';
export type HumanDecisionActorRole = 'student' | 'coach';
export type HumanDecisionStatus = 'active' | 'reverted';
export type HumanDecisionState = 'applied' | 'suspended';

export interface HumanIdentityDecision {
  id: string;
  kind: HumanDecisionKind;
  // Pares de observacoes (ids ordenados) a que a decisao se aplica.
  pairs: Array<[string, string]>;
  // Uniao dos ids dos pares (ordenada) — indice de busca.
  observationIds: string[];
  actorRole: HumanDecisionActorRole;
  actorId: string;
  decidedAt: string;
  note?: string | null;
  status: HumanDecisionStatus;
  revertedAt?: string | null;
  revertedBy?: { role: HumanDecisionActorRole; id: string } | null;
  // Preenchido pela avaliacao de identidade (deterministico, sem horario): 'applied' | 'suspended' (+ motivo objetivo).
  state?: HumanDecisionState;
  stateReason?: string | null;
  // Carimbo de "efeito concluido": gravado SO' depois de a identidade ser reavaliada E a reconciliacao concluida (criacao ou reversao). Sem ele a decisao
  // esta' EM PROCESSAMENTO e e' reprocessada sozinha (idempotente) na proxima leitura das pendencias ou pelo treinador.
  processedAt?: string | null;
}

// Motivos em que a evidencia objetiva e' decisiva contra "mesma execucao" (o humano nao fez o dado mudar).
export const DECISIVE_DISTINCT_REASONS: ReadonlySet<string> = new Set(['different_athlete', 'incompatible_modality', 'different_time', 'no_time_overlap']);

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function allPairs(ids: string[]): Array<[string, string]> {
  const sorted = [...new Set(ids)].sort();
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) pairs.push([sorted[i], sorted[j]]);
  return pairs;
}

export function decisionOf(pairs: Array<[string, string]>, base: Omit<HumanIdentityDecision, 'pairs' | 'observationIds' | 'status'>): HumanIdentityDecision {
  const normalized = pairs.map(([a, b]) => sortedPair(a, b));
  return { ...base, pairs: normalized, observationIds: [...new Set(normalized.flat())].sort(), status: 'active' };
}

// Le as decisoes de um JSON de evidencia (tolerante: evidencia ausente/legada = nenhuma decisao).
export function decisionsOfEvidence(evidence: unknown): HumanIdentityDecision[] {
  const list = (evidence as { humanDecisions?: unknown } | null | undefined)?.humanDecisions;
  if (!Array.isArray(list)) return [];
  return list.filter((d): d is HumanIdentityDecision => {
    const x = d as Partial<HumanIdentityDecision> | null;
    return Boolean(x && typeof x.id === 'string' && (x.kind === 'same' || x.kind === 'distinct') && Array.isArray(x.pairs) && Array.isArray(x.observationIds));
  });
}

// Decisao (de qualquer status) cujo efeito ainda nao foi concluido — a ser reprocessada.
export function isUnprocessed(decision: HumanIdentityDecision): boolean {
  return !decision.processedAt;
}

export function activeDecisions(decisions: HumanIdentityDecision[]): HumanIdentityDecision[] {
  return decisions.filter((d) => d.status === 'active');
}

// Decisao ativa que cobre o par (a mais recente, em caso de duas). Null se nenhuma.
export function decisionForPair(decisions: HumanIdentityDecision[], a: string, b: string): HumanIdentityDecision | null {
  const key = pairKey(a, b);
  const covering = activeDecisions(decisions).filter((d) => d.pairs.some(([x, y]) => pairKey(x, y) === key));
  if (covering.length === 0) return null;
  return covering.sort((x, y) => (x.decidedAt < y.decidedAt ? 1 : x.decidedAt > y.decidedAt ? -1 : x.id < y.id ? 1 : -1))[0];
}

export interface HumanAdjustedComparison {
  comparison: IdentityComparison;
  decision: HumanIdentityDecision | null;
  state: HumanDecisionState | null;
  stateReason: string | null;
}

// Aplica (ou suspende) a decisao humana sobre o veredito objetivo de um par. Funcao pura.
export function applyHumanDecision(raw: IdentityComparison, decision: HumanIdentityDecision | null): HumanAdjustedComparison {
  if (!decision) return { comparison: raw, decision: null, state: null, stateReason: null };
  if (decision.kind === 'distinct') {
    return {
      comparison: { verdict: 'distinct', reason: 'human_decision_distinct', evidence: [...raw.evidence, { criterion: 'human_decision', matched: false, detail: { decisionId: decision.id, kind: 'distinct', actor: decision.actorRole } }] },
      decision, state: 'applied', stateReason: null,
    };
  }
  if (raw.verdict === 'distinct' && DECISIVE_DISTINCT_REASONS.has(raw.reason)) {
    // Evidencia objetiva decisivamente contraria: a decisao nao e' aplicada nem apagada — fica suspensa e visivel.
    return { comparison: raw, decision, state: 'suspended', stateReason: raw.reason };
  }
  return {
    comparison: { verdict: 'same', reason: 'human_decision_same', evidence: [...raw.evidence, { criterion: 'human_decision', matched: true, detail: { decisionId: decision.id, kind: 'same', actor: decision.actorRole } }] },
    decision, state: 'applied', stateReason: null,
  };
}
