import type { PrismaClient } from '@prisma/client';
import { aiActivityWhere, aiBlockedProviders } from '../ai-governance/ai-scope';
import { neutralizeSessionsForAi } from '../ai-governance/ai-session-filter';
import { TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../common/training-history-policy';
import { weekStartOf } from '../common/weekly-volume';
import { pickCanonicalPerEvent } from './canonical-observation';
import { buildWeeklyRealizedTotals, TotalsActivityInput, TotalsSessionInput, TotalsSessionStatus, WeeklyRealizedTotals } from './weekly-realized-totals';

// Adaptador de banco dos totais realizados da semana (lote 2). Le sessoes e atividades e entrega ao modulo puro; nenhuma regra de contagem mora aqui.
// Mesma fonte de eventos fisicos da Evolucao: ActivityLog desde o corte da Training Intelligence, UMA observacao canonica por evento (pickCanonicalPerEvent).

const EXTRA_ORIGINS = ['device_extra', 'student_extra'];

// Sessao sintetica do aparelho (materializeExtraActivity): NAO tem SessionExecutionLink; o elo e' structure.activityLogId (+ structure.provider).
function materializedOf(row: { origin: string | null; structure: unknown }): { activityLogId: string | null; provider: string | null } {
  if (row.origin !== 'device_extra' || !row.structure || typeof row.structure !== 'object' || Array.isArray(row.structure)) return { activityLogId: null, provider: null };
  const structure = row.structure as { activityLogId?: unknown; provider?: unknown };
  return { activityLogId: typeof structure.activityLogId === 'string' ? structure.activityLogId : null, provider: typeof structure.provider === 'string' ? structure.provider : null };
}
const DAY_MS = 86_400_000;

type TotalsPrisma = Pick<PrismaClient, 'trainingSession' | 'activityLog'>;

// Mesmo criterio do relatorio por sessao (analyzeSession): 'nao feita' so' quando o aluno marcou assim; sem conclusao e sem atividade vinculada = sem registro.
function statusOf(session: { completion: { status: string } | null; executionLinks: unknown[] }): TotalsSessionStatus {
  if (session.completion?.status === 'missed') return 'not_performed';
  if (!session.completion && session.executionLinks.length === 0) return 'no_record';
  return 'performed';
}

function pendingOrClassified(classification: string | null, identity: string | null): TotalsActivityInput['classification'] {
  if (classification === 'ambiguous') return identity === 'unique' || identity === 'matched' ? 'ambiguous' : null;
  return (classification as TotalsActivityInput['classification']) ?? null;
}

export async function loadWeeklyRealizedTotals(
  prisma: TotalsPrisma,
  userId: string,
  weekStart: Date | string,
  prescribedSessionIds: string[],
  // forAi: VISAO DE IA — como se os dados dos provedores bloqueados no escopo atual nao existissem (mesma regra do restante do contexto: atividades filtradas, vinculos e
  // copias do aparelho no feedback neutralizados, sessao sintetica do aparelho descartada). Sem escopo/sem provedor bloqueado e' identica a visao completa.
  options: { forAi?: boolean } = {},
): Promise<WeeklyRealizedTotals> {
  const forAi = options.forAi === true && aiBlockedProviders().length > 0;
  const activityFilter = forAi ? aiActivityWhere() : {};
  const weekStartDate = weekStartOf(typeof weekStart === 'string' ? weekStart : weekStart.toISOString().slice(0, 10));
  const weekStartUtc = new Date(`${weekStartDate}T00:00:00.000Z`);
  const weekEndUtc = new Date(weekStartUtc.getTime() + 6 * DAY_MS);

  const sessionInclude = { completion: true, executionLinks: { where: { status: 'active' }, include: { activityLog: true } } } as const;
  const [prescribedRows, extraRows] = await Promise.all([
    prescribedSessionIds.length === 0 ? Promise.resolve([]) : prisma.trainingSession.findMany({ where: { userId, id: { in: prescribedSessionIds } }, include: sessionInclude }),
    prisma.trainingSession.findMany({ where: { userId, origin: { in: EXTRA_ORIGINS }, scheduledDate: { gte: weekStartUtc, lte: weekEndUtc } }, include: sessionInclude }),
  ]);
  const allSessionRows = [...new Map([...prescribedRows, ...extraRows].map((row) => [row.id, row])).values()];
  const sessionRows = forAi ? neutralizeSessionsForAi(allSessionRows) : allSessionRows;

  // janela UTC ampliada em +-1 dia (offsets de ate' +-14h); o dia LOCAL de cada atividade e' decidido pelo modulo
  const from = new Date(Math.max(weekStartUtc.getTime() - DAY_MS, TRAINING_INTELLIGENCE_DATA_CUTOFF.getTime()));
  const to = new Date(weekEndUtc.getTime() + 2 * DAY_MS);
  const windowRows = await prisma.activityLog.findMany({ where: { userId, startedAt: { gte: from, lt: to }, ...activityFilter } });
  // atividades vinculadas a sessoes desta semana que ficaram fora da janela (execucao em outra semana): entram para o modulo saber que o evento pertence a outra semana
  const loadedIds = new Set(windowRows.map((row) => row.id));
  const linkedOutside = [...new Set(sessionRows.flatMap((row) => [...row.executionLinks.map((link) => link.activityLogId), ...(materializedOf(row).activityLogId ? [materializedOf(row).activityLogId as string] : [])]).filter((id) => !loadedIds.has(id)))];
  const outsideRows = linkedOutside.length === 0 ? [] : await prisma.activityLog.findMany({ where: { userId, id: { in: linkedOutside }, ...activityFilter } });
  const rows = [...windowRows, ...outsideRows];
  // Visao de IA (falha FECHADO): sessao sintetica do aparelho cuja atividade nao esta na visao (provedor bloqueado) ou cujo elo nao e' comprovavel nao pode existir — a conclusao dela e' COPIA da atividade.
  const visibleIds = new Set(rows.map((row) => row.id));
  const visibleSessionRows = forAi ? sessionRows.filter((row) => { const linked = materializedOf(row).activityLogId; return row.origin !== 'device_extra' || (linked != null && visibleIds.has(linked)); }) : sessionRows;

  const picks = await pickCanonicalPerEvent(rows, (ids) => prisma.activityLog.findMany({ where: { userId, id: { in: ids }, ...activityFilter } }));
  const activities: TotalsActivityInput[] = picks.map(({ row, representedBy, members }) => ({
    activityLogId: row.id,
    memberIds: members.map((member) => member.id),
    physicalEventId: row.physicalIdentityStatus === 'matched' ? row.physicalEventId : null,
    startedAt: row.startedAt,
    utcOffsetMinutes: row.utcOffsetMinutes,
    sport: row.sport,
    distanceKm: row.distanceMeters != null ? row.distanceMeters / 1000 : null,
    durationMin: row.durationSec != null ? row.durationSec / 60 : null,
    // 'ambiguous' so' e' PENDENTE de confirmacao (conta no total) quando a identidade fisica esta resolvida; identidade ambigua (possivel duplicidade) continua fora.
    classification: pendingOrClassified(representedBy.executionClassification, representedBy.physicalIdentityStatus),
    provider: row.provider,
    avgHeartRateBpm: row.avgHeartRateBpm,
    maxHeartRateBpm: row.maxHeartRateBpm,
    powerAvgWatts: row.powerAvgWatts,
    elevationGainMeters: row.elevationGainMeters,
    caloriesKcal: row.caloriesKcal,
    cadenceAvg: row.cadenceAvg,
  }));

  const sessions: TotalsSessionInput[] = visibleSessionRows.map((row) => ({
    sessionId: row.id,
    scheduledDate: row.scheduledDate.toISOString().slice(0, 10),
    modality: row.modality,
    origin: row.origin,
    status: statusOf(row),
    plannedDistanceKm: row.distanceKm,
    completionDistanceKm: row.completion?.distanceKm ?? null,
    completionDurationMin: row.completion?.durationMin ?? null,
    perceivedEffort: row.completion?.perceivedEffort ?? null,
    completionAvgHeartRate: row.completion?.avgHeartRate ?? null,
    completionMaxHeartRate: row.completion?.maxHeartRate ?? null,
    linkedActivityLogIds: row.executionLinks.map((link) => link.activityLogId),
    materializedActivityLogId: materializedOf(row).activityLogId,
    materializedProvider: materializedOf(row).provider,
    linkOrigins: Object.fromEntries(row.executionLinks.map((link) => [link.activityLogId, link.origin])),
  }));

  return buildWeeklyRealizedTotals({ weekStartDate, sessions, activities });
}
