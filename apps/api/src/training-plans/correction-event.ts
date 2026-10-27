import { activityLocalDate } from '../common/local-date';
import type { CorrectionContext, LinkChange } from '../activity-execution/correction-hooks';

// Evento corretivo do Prontuario (EXECUTION_LINK_CORRECTED, 15/10/2026). Texto DETERMINISTICO (gravado por codigo, sem IA) que acrescenta ao historico o que mudou,
// quando, quem fez, quais registros foram afetados e qual informacao passa a valer. NUNCA reescreve nem apaga eventos anteriores: o registro antigo continua como
// historico e o Condensador/Prescritor o tratam como crenca anterior, nao como fato atual (ver prompts). So' gera texto quando algo mudou DE FATO (estado final
// diferente do inicial) — correcao que termina igual ao que estava nao gera evento. Medalhas NAO entram aqui.

export interface CorrectionEventData {
  sessions: Map<string, { title: string; scheduledDate: Date; modality: string }>;
  activities: Map<string, { startedAt: Date; utcOffsetMinutes: number | null; sport: string | null; distanceMeters: number | null; durationSec: number | null }>;
}

const MAX_DETAIL_LINES = 5;
const MAX_REFS = 25;

const BR = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const formatMoment = (date: Date) => BR.format(date).replace(',', '');
const formatDay = (date: Date) => date.toISOString().slice(0, 10).split('-').reverse().join('/');
const formatLocalDay = (isoDay: string) => isoDay.split('-').reverse().join('/');

const MODALITY_LABEL: Record<string, string> = { corrida: 'corrida', esteira: 'corrida', forca: 'musculação', fortalecimento_corredores: 'fortalecimento para corredores' };
const modalityLabel = (modality: string | null) => (modality ? MODALITY_LABEL[modality] ?? modality : 'atividade');
const short = (id: string) => id.slice(0, 8);

function activityDescription(change: { activityLogId: string }, data: CorrectionEventData): string {
  const a = data.activities.get(change.activityLogId);
  if (!a) return `atividade ${short(change.activityLogId)}`;
  const parts = [formatLocalDay(activityLocalDate(a.startedAt, a.utcOffsetMinutes)), modalityLabel(a.sport)];
  if (a.distanceMeters != null) parts.push(`${(a.distanceMeters / 1000).toFixed(1).replace('.', ',')} km`);
  if (a.durationSec != null) { const minutes = Math.round(a.durationSec / 60); parts.push(minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}min` : `${minutes}min`); }
  return `a atividade de ${parts.join(', ')}`;
}

// Sintagma SEM artigo ("treino prescrito de 12/10/2026 (Corrida)"); quem usa escolhe "do" ou "o".
function sessionDescription(sessionId: string, data: CorrectionEventData): string {
  const s = data.sessions.get(sessionId);
  return s ? `treino prescrito de ${formatDay(s.scheduledDate)} (${s.title || modalityLabel(s.modality)})` : `treino prescrito ${short(sessionId)}`;
}

export interface NetLinkChange { activityLogId: string; beforeSessionId: string | null; afterSessionId: string | null }

/** Estado antes (vinculo ativo em `since`) x depois (vinculo ativo agora) por atividade; so' o que realmente mudou. */
export function netLinkChanges(changes: LinkChange[], since: Date): NetLinkChange[] {
  const byActivity = new Map<string, LinkChange[]>();
  for (const change of changes) byActivity.set(change.activityLogId, [...(byActivity.get(change.activityLogId) ?? []), change]);
  const out: NetLinkChange[] = [];
  for (const [activityLogId, entries] of byActivity) {
    const latest = (list: LinkChange[]) => [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    const before = latest(entries.filter((e) => e.createdAt < since && (e.revokedAt == null || e.revokedAt >= since)));
    const after = latest(entries.filter((e) => e.status === 'active'));
    const beforeSessionId = before?.trainingSessionId ?? null;
    const afterSessionId = after?.trainingSessionId ?? null;
    if (beforeSessionId !== afterSessionId) out.push({ activityLogId, beforeSessionId, afterSessionId });
  }
  return out.sort((a, b) => a.activityLogId.localeCompare(b.activityLogId));
}

const actorOf = (origin: CorrectionContext['origin']) => (origin === 'student' ? 'pelo aluno' : origin === 'coach' ? 'pelo treinador' : 'pelo sistema');

export interface CorrectionEventText { header: string; body: string }

/** Ids de sessoes/atividades que o texto vai citar (para buscar os dados antes de formatar). */
export function idsNeeded(context: CorrectionContext): { sessionIds: string[]; activityIds: string[] } {
  const sessionIds = new Set<string>();
  const activityIds = new Set<string>();
  if (context.since) {
    for (const net of netLinkChanges(context.changes, context.since)) {
      activityIds.add(net.activityLogId);
      if (net.beforeSessionId) sessionIds.add(net.beforeSessionId);
      if (net.afterSessionId) sessionIds.add(net.afterSessionId);
    }
  }
  if (context.sessionEdit) sessionIds.add(context.sessionEdit.sessionId);
  return { sessionIds: [...sessionIds], activityIds: [...activityIds] };
}

const FIELD_LABEL: Record<string, string> = { modality: 'modalidade', durationMin: 'duração (min)', distanceKm: 'distância (km)', structure: 'estrutura' };
const show = (value: unknown) => (value === null || value === undefined ? 'sem valor' : String(value));

/** Zero ou mais eventos para uma correcao. Vazio = nada mudou de fato. */
export function buildCorrectionEvents(context: CorrectionContext, data: CorrectionEventData): CorrectionEventText[] {
  const events: CorrectionEventText[] = [];
  const when = formatMoment(context.at);
  const by = actorOf(context.origin);

  if (context.sessionEdit) {
    const edit = context.sessionEdit;
    const fieldNames = Object.keys(edit.fields);
    if (fieldNames.length > 0 && (edit.hasFeedback || edit.hasActiveLink)) {
      const session = data.sessions.get(edit.sessionId);
      const label = session ? `o treino de ${formatDay(session.scheduledDate)} (${session.title || modalityLabel(session.modality)})` : `o treino ${short(edit.sessionId)}`;
      const lines = fieldNames.map((name) => `${FIELD_LABEL[name] ?? name}: ${show(edit.fields[name].before)} → ${show(edit.fields[name].after)}`);
      events.push({
        header: `Edição de treino registrada em ${when}, feita pelo treinador.`,
        body: [
          `O treino que já tinha ${edit.hasFeedback ? 'feedback do aluno' : 'execução vinculada'} foi editado: ${label}.`,
          `O que mudou: ${lines.join('; ')}.`,
          'Passa a valer a prescrição editada para a análise desse treino; o feedback e a execução registrados continuam como estavam. O registro anterior permanece como histórico e não deve ser tratado como fato atual.',
          `Ref: treino=${short(edit.sessionId)}.`,
        ].join('\n'),
      });
    }
  }

  if (context.since && context.changes.length > 0) {
    const nets = netLinkChanges(context.changes, context.since);
    if (nets.length > 0) {
      const describe = (net: NetLinkChange) => {
        const activity = activityDescription(net, data);
        if (net.beforeSessionId && !net.afterSessionId) return `${activity} constava como cumprimento do ${sessionDescription(net.beforeSessionId, data)}; agora é atividade extra (não cumpre treino prescrito).`;
        if (!net.beforeSessionId && net.afterSessionId) return `${activity} era atividade extra; agora cumpre o ${sessionDescription(net.afterSessionId, data)}.`;
        return `${activity} constava como cumprimento do ${sessionDescription(net.beforeSessionId as string, data)}; agora cumpre o ${sessionDescription(net.afterSessionId as string, data)}.`;
      };
      const unlinked = nets.filter((n) => n.beforeSessionId && !n.afterSessionId).length;
      const linked = nets.filter((n) => !n.beforeSessionId && n.afterSessionId).length;
      const swapped = nets.length - unlinked - linked;
      const refs = nets.slice(0, MAX_REFS).map((n) => `atividade=${short(n.activityLogId)}${n.beforeSessionId ? ` antes=${short(n.beforeSessionId)}` : ''}${n.afterSessionId ? ` depois=${short(n.afterSessionId)}` : ''}`);
      if (nets.length <= MAX_DETAIL_LINES) {
        events.push({
          header: `Correção de vínculo registrada em ${when}, feita ${by}.`,
          body: [
            ...nets.map((n) => `Antes/agora: ${describe(n)}`),
            'Passa a valer o estado "agora". O registro anterior permanece como histórico e não deve ser tratado como fato atual.',
            `Ref: ${refs.join('; ')}.`,
          ].join('\n'),
        });
      } else {
        // Operacao em massa: evento resumido com rastreabilidade (contagens, amostra e referencias).
        events.push({
          header: `Correção de vínculos em lote registrada em ${when}, feita ${by}.`,
          body: [
            `${nets.length} atividades tiveram o vínculo com treinos prescritos alterado (${linked} vinculada(s), ${unlinked} desvinculada(s), ${swapped} trocada(s)).`,
            ...nets.slice(0, MAX_DETAIL_LINES).map((n) => `Exemplo: ${describe(n)}`),
            nets.length > MAX_DETAIL_LINES ? `... e mais ${nets.length - MAX_DETAIL_LINES}.` : '',
            'Passa a valer o estado atual dos vínculos. O registro anterior permanece como histórico e não deve ser tratado como fato atual.',
            `Ref (até ${MAX_REFS}): ${refs.join('; ')}.`,
          ].filter(Boolean).join('\n'),
        });
      }
    }
  }
  return events;
}
