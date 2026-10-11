// Pendencias de identidade fisica (confirmacao pelo aluno/treinador) — modelo de leitura PURO, derivado das observacoes 'ambiguous' ja' existentes.
// Nao ha estado novo: "responder depois" nao grava nada; a pendencia some sozinha quando a identidade deixa de ser ambigua (nova evidencia ou decisao).
//
// Conjunto = componente conexo de observacoes ligadas por veredito de ambiguidade na evidencia de identidade (UMA pendencia por conjunto, nunca uma por
// par). Pode ser MISTO: uma observacao ambigua frente a um evento ja' confirmado (as fontes que concordam entram juntas). O aluno so' e' perguntado quando
// a pergunta binaria e' SEGURA: conjunto de exatamente DUAS observacoes ambiguas e recente. Conjuntos maiores/mistos (mesma execucao x execucoes
// distintas nao se reduz a sim/nao) e historico antigo ficam para o treinador.

import { canonicalModality } from './canonical-modality';
import { ecosystemKeyOf } from './physical-canonical';
import { decisionForPair, decisionsOfEvidence, HumanIdentityDecision } from './physical-identity-decisions';

// So' perguntamos ao aluno sobre atividades recentes (nao reabrir historico antigo com perguntas).
export const PENDING_STUDENT_MAX_AGE_DAYS = 60;

export interface PendingRow {
  id: string;
  userId: string;
  provider: string;
  sport: string | null;
  startedAt: Date;
  utcOffsetMinutes: number | null;
  durationSec: number | null;
  distanceMeters: number | null;
  providerMetrics: unknown;
  physicalEventId?: string | null;
  physicalIdentityStatus: string | null;
  physicalIdentityEvidence: unknown;
}

export interface PendingSet {
  key: string;
  members: PendingRow[];
  reasons: string[];
  studentActionable: boolean;
  // Por que o aluno NAO e' perguntado (null se acionavel).
  coachOnlyReason: 'more_than_two' | 'too_old' | null;
}

type Comparison = { activityLogId?: unknown; verdict?: unknown; reason?: unknown };
function comparisonsOf(row: PendingRow): Comparison[] {
  const list = (row.physicalIdentityEvidence as { comparisons?: unknown } | null | undefined)?.comparisons;
  return Array.isArray(list) ? (list as Comparison[]) : [];
}

// rows = observacoes ambiguas + as ligadas a elas por ambiguidade + os membros dos eventos dessas ligadas (o servico carrega). Linhas sem relacao
// com alguma observacao ambigua nunca formam conjunto.
export function buildPendingSets(rows: PendingRow[], now: Date): PendingSet[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const isAmbiguous = (r: PendingRow) => r.physicalIdentityStatus === 'ambiguous';
  const eligible = (r: PendingRow) => r.physicalIdentityStatus === 'ambiguous' || r.physicalIdentityStatus === 'matched';
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; return root; };
  const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
  const edgeReasons: Array<{ a: string; reason: string }> = [];
  for (const row of rows) {
    for (const c of comparisonsOf(row)) {
      const other = typeof c.activityLogId === 'string' ? byId.get(c.activityLogId) : undefined;
      if (!other || c.verdict === 'distinct') continue;
      if (!isAmbiguous(row) && !isAmbiguous(other)) continue; // a aresta precisa envolver ao menos uma observacao ambigua
      if (!eligible(row) || !eligible(other)) continue; // 'unique' so' aparece aqui por evidencia defasada: nao e' ambiguidade real
      // entre duas ambiguas vale qualquer veredito nao-distinto; frente a uma observacao ja' em evento so' o veredito 'ambiguous'
      if (!(isAmbiguous(row) && isAmbiguous(other)) && c.verdict !== 'ambiguous') continue;
      union(row.id, other.id);
      edgeReasons.push({ a: row.id, reason: typeof c.reason === 'string' ? c.reason : 'unknown' });
    }
  }
  // As fontes de um mesmo evento confirmado entram juntas no conjunto.
  const firstOfEvent = new Map<string, string>();
  for (const row of rows) {
    if (!row.physicalEventId) continue;
    const first = firstOfEvent.get(row.physicalEventId);
    if (first) union(first, row.id); else firstOfEvent.set(row.physicalEventId, row.id);
  }
  const groups = new Map<string, PendingRow[]>();
  for (const row of rows) groups.set(find(row.id), [...(groups.get(find(row.id)) ?? []), row]);
  const reasonsByRoot = new Map<string, Set<string>>();
  for (const edge of edgeReasons) reasonsByRoot.set(find(edge.a), (reasonsByRoot.get(find(edge.a)) ?? new Set()).add(edge.reason));

  const decisions: HumanIdentityDecision[] = [];
  for (const row of rows) for (const d of decisionsOfEvidence(row.physicalIdentityEvidence)) if (!decisions.some((x) => x.id === d.id)) decisions.push(d);
  const oldest = now.getTime() - PENDING_STUDENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  const sets: PendingSet[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2 || !members.some(isAmbiguous)) continue; // ambigua sem par registrado (legado) ou grupo sem ambiguidade: nada a perguntar
    const sorted = [...members].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : 1));
    // Ja' existe decisao humana ativa cobrindo algum par do conjunto: nao perguntar de novo enquanto a identidade nao for reavaliada.
    let covered = false;
    for (let i = 0; i < sorted.length && !covered; i++) for (let j = i + 1; j < sorted.length; j++) if (decisionForPair(decisions, sorted[i].id, sorted[j].id)) { covered = true; break; }
    if (covered) continue;
    const tooOld = sorted.some((m) => m.startedAt.getTime() < oldest);
    const coachOnlyReason = sorted.length > 2 ? 'more_than_two' : tooOld ? 'too_old' : null;
    sets.push({
      key: sorted.map((m) => m.id).sort().join('|'),
      members: sorted,
      reasons: [...(reasonsByRoot.get(root) ?? [])].sort(),
      studentActionable: coachOnlyReason === null && sorted.every(isAmbiguous),
      coachOnlyReason,
    });
  }
  return sets.sort((a, b) => b.members[0].startedAt.getTime() - a.members[0].startedAt.getTime() || (a.key < b.key ? -1 : 1));
}

export function pendingSetKey(ids: string[]): string {
  return [...new Set(ids)].sort().join('|');
}

// ---- Apresentacao ao aluno (so' o que o dado informa; nunca inventa origem, fabricante ou dispositivo) ----------------------------------------

const MODALITY_LABEL: Record<string, string> = {
  corrida: 'Corrida', esteira: 'Corrida na esteira', forca: 'Musculação', funcional: 'Treino funcional', bike: 'Bike', natacao: 'Natação', caminhada: 'Caminhada', outra: 'Outra atividade',
};

const ECOSYSTEM_APP_LABEL: Record<string, string> = { polar: 'Polar Flow', garmin: 'Garmin Connect', strava: 'Strava', samsung: 'Samsung Health', apple_health: 'Apple Saúde' };
const DIRECT_PROVIDER_LABEL: Record<string, string> = { polar: 'Polar', wahoo: 'Wahoo', garmin: 'Garmin', coros: 'COROS', strava: 'Strava' };

function looksLikePackageId(value: string): boolean {
  return /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(value);
}

export interface PendingObservationView {
  activityLogId: string;
  // Aplicativo/fonte de origem (ex.: "Polar", "Strava"). Nunca o canal como se fosse o dispositivo.
  sourceLabel: string;
  // Canal pelo qual o registro chegou, quando houver (ex.: "via Health Connect"); null para integracao direta.
  channelLabel: string | null;
  startedAt: string;
  // "AAAA-MM-DDTHH:mm" no horario LOCAL da atividade, se o fuso foi informado; senao null (o app formata o instante).
  startedAtLocal: string | null;
  modality: string;
  modalityLabel: string;
  distanceMeters: number | null;
  durationSec: number | null;
}

export interface PendingIdentityView {
  key: string;
  // 'pending' = aguardando a resposta do aluno; 'processing' = resposta JA' registrada, efeito (identidade + contabilizacao) ainda sendo concluido —
  // o app NAO oferece botoes nesse estado e nao diz que as estatisticas ja' foram atualizadas.
  status: 'pending' | 'processing';
  observations: PendingObservationView[];
}

function observationView(row: PendingRow): PendingObservationView {
  const source = (row.providerMetrics as { source?: { name?: unknown; bundleId?: unknown; packageName?: unknown } } | null)?.source;
  const name = typeof source?.name === 'string' && source.name.trim() && !looksLikePackageId(source.name.trim()) ? source.name.trim() : null;
  let sourceLabel: string;
  let channelLabel: string | null = null;
  if (row.provider === 'apple_health' || row.provider === 'health_connect') {
    const ecosystem = ecosystemKeyOf(row.provider, row.providerMetrics);
    sourceLabel = name ?? (ecosystem ? ECOSYSTEM_APP_LABEL[ecosystem] : null) ?? 'Aplicativo não identificado';
    channelLabel = row.provider === 'apple_health' ? 'via Apple Saúde' : 'via Health Connect';
  } else {
    sourceLabel = DIRECT_PROVIDER_LABEL[row.provider] ?? (row.provider ? row.provider.charAt(0).toUpperCase() + row.provider.slice(1) : 'Origem não informada');
  }
  const modality = canonicalModality(row.sport) ?? 'outra';
  const local = row.utcOffsetMinutes == null ? null : new Date(row.startedAt.getTime() + row.utcOffsetMinutes * 60000).toISOString().slice(0, 16);
  return {
    activityLogId: row.id, sourceLabel, channelLabel, startedAt: row.startedAt.toISOString(), startedAtLocal: local,
    modality, modalityLabel: MODALITY_LABEL[modality] ?? MODALITY_LABEL.outra, distanceMeters: row.distanceMeters, durationSec: row.durationSec,
  };
}

export function toPendingView(set: PendingSet): PendingIdentityView {
  return { key: set.key, status: 'pending', observations: set.members.map(observationView) };
}

// Resposta ja' registrada cujo efeito ainda nao foi concluido: mostra os registros envolvidos, sem acao.
export function toProcessingView(observationIds: string[], rows: PendingRow[]): PendingIdentityView | null {
  const members = rows.filter((r) => observationIds.includes(r.id)).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : 1));
  if (members.length < 2) return null;
  return { key: members.map((m) => m.id).sort().join('|'), status: 'processing', observations: members.map(observationView) };
}

