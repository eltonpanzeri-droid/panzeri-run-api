import { BadRequestException } from '@nestjs/common';
import { canonicalModality } from '../activity-execution/canonical-modality';
import { TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../common/training-history-policy';
import { HistoryPlanLike, selectHistoryWeeks } from '../training-plans/student-information-context';
import { mapHistorySession } from './history-session';

// Calendario do aluno no painel (aba "Semanas anteriores"): so' LEITURA e montagem. Nenhuma regra de treino nova — as semanas seguem a MESMA regra do historico que a IA
// usa (selectHistoryWeeks: o plano mais recente da semana e' o vigente; planos anteriores da mesma semana so' contribuem com sessoes COM registro do aluno), o status
// segue a mesma ordem de precedencia da serie longitudinal (execucao objetiva comprova "feito"; "nao feito" so' vale sem atividade; futuro; sem registro) e os
// resumos por semana usam o mesmo sumario do historico (nada recalculado aqui).

export const CALENDAR_MAX_RANGE_DAYS = 70;
export const CALENDAR_CUTOFF_ISO = TRAINING_INTELLIGENCE_DATA_CUTOFF.toISOString().slice(0, 10);

export type CalendarStatus = 'feito' | 'ajustado' | 'nao_feito' | 'sem_registro' | 'futuro';
export type CalendarSessionKind = 'prescrito' | 'extra_relogio' | 'extra_aluno';

export interface CalendarLinkedActivity {
  id: string;
  provider: string;
  startedAt?: Date;
  distanceMeters: number | null;
  durationSec: number | null;
  avgHeartRateBpm: number | null;
}

export interface CalendarExecution {
  activityLogId: string;
  provider: string;
  distanceKm: number | null;
  durationMin: number | null;
  avgPaceSecondsKm: number | null;
  avgHeartRateBpm: number | null;
}

export type CalendarSession = ReturnType<typeof mapHistorySession> & {
  planId: string;
  dateIso: string;
  origin: string | null;
  kind: CalendarSessionKind;
  status: CalendarStatus;
  // Atividade do relogio vinculada (execucao objetiva) e se o aluno respondeu o feedback: duas coisas diferentes, nunca confundidas.
  executedByDevice: boolean;
  hasFeedback: boolean;
  execution: CalendarExecution | null;
};

export interface CalendarActivityRow {
  id: string;
  provider: string;
  startedAt: Date;
  utcOffsetMinutes: number | null;
  sport: string | null;
  durationSec: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  executionClassification: string | null;
}

export interface CalendarActivity {
  id: string;
  provider: string;
  dateIso: string;
  modality: string;
  durationMin: number | null;
  distanceKm: number | null;
  avgHeartRateBpm: number | null;
  // 'alternative' = atividade fora do programa; 'ambiguous'/null = ainda sem decisao (o painel avisa "a confirmar").
  classification: 'alternative' | 'ambiguous' | null;
}

export interface CalendarWeek<Summary> {
  weekStart: string;
  planId: string;
  summary: Summary;
}

interface SessionLike {
  id: string;
  scheduledDate: Date;
  origin?: string | null;
  structure?: unknown;
  completion: { status?: string | null; perceivedEffort?: number | null } | null;
  executionLinks?: Array<{ activityLog: CalendarLinkedActivity }>;
  // o resto do registro e' consumido por mapHistorySession
  [key: string]: unknown;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return isoDay(date);
}

// Valida o periodo pedido. O calendario nunca mostra nada antes do corte do historico esportivo valido (01/08/2026) e nao aceita periodos longos (limite de carga).
export function normalizeCalendarRange(fromRaw: unknown, toRaw: unknown): { from: string; to: string; empty: boolean } {
  const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && isoDay(new Date(`${value}T00:00:00Z`)) === value;
  if (!valid(fromRaw) || !valid(toRaw)) throw new BadRequestException('Informe from e to no formato AAAA-MM-DD.');
  if (fromRaw > toRaw) throw new BadRequestException('from nao pode ser depois de to.');
  const spanDays = (Date.parse(`${toRaw}T00:00:00Z`) - Date.parse(`${fromRaw}T00:00:00Z`)) / 86_400_000;
  if (spanDays > CALENDAR_MAX_RANGE_DAYS) throw new BadRequestException(`O periodo pode ter no maximo ${CALENDAR_MAX_RANGE_DAYS} dias.`);
  if (toRaw < CALENDAR_CUTOFF_ISO) return { from: CALENDAR_CUTOFF_ISO, to: CALENDAR_CUTOFF_ISO, empty: true };
  return { from: fromRaw < CALENDAR_CUTOFF_ISO ? CALENDAR_CUTOFF_ISO : fromRaw, to: toRaw, empty: false };
}

function executionOf(links: Array<{ activityLog: CalendarLinkedActivity }>, canonicalById: Map<string, CalendarLinkedActivity>): CalendarExecution | null {
  const rows = links.map((link) => canonicalById.get(link.activityLog.id) ?? link.activityLog);
  if (rows.length === 0) return null;
  const row = [...rows].sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0))[0];
  const distanceKm = row.distanceMeters != null ? row.distanceMeters / 1000 : null;
  const durationMin = row.durationSec != null ? row.durationSec / 60 : null;
  // Pace e' derivado de distancia e duracao na leitura (nunca persistido), como no resto do sistema.
  const avgPaceSecondsKm = row.distanceMeters != null && row.distanceMeters > 0 && row.durationSec != null && row.durationSec > 0 ? Math.round(row.durationSec / (row.distanceMeters / 1000)) : null;
  return { activityLogId: row.id, provider: row.provider, distanceKm, durationMin, avgPaceSecondsKm, avgHeartRateBpm: row.avgHeartRateBpm };
}

function kindOf(session: SessionLike): CalendarSessionKind {
  if (session.origin === 'device_extra') return 'extra_relogio';
  const structure = typeof session.structure === 'object' && session.structure !== null ? (session.structure as { source?: unknown; type?: unknown }) : {};
  return structure.source === 'student' && structure.type === 'extra' ? 'extra_aluno' : 'prescrito';
}

export function statusOf(session: { completion: { status?: string | null } | null }, hasActiveLink: boolean, dateIso: string, todayIso: string): CalendarStatus {
  // Mesma precedencia de EvolutionMetricService.classifySession: execucao objetiva correspondente basta para "feito"; "nao feito" so' vale sem atividade.
  if (hasActiveLink) return 'feito';
  const status = session.completion?.status;
  if (status === 'done') return 'feito';
  if (status === 'adjusted') return 'ajustado';
  if (status === 'missed') return 'nao_feito';
  return dateIso >= todayIso ? 'futuro' : 'sem_registro';
}

export function buildStudentCalendar<Summary>(input: {
  plans: Array<HistoryPlanLike<SessionLike>>;
  from: string;
  to: string;
  today: string;
  canonicalById: Map<string, CalendarLinkedActivity>;
  activities: CalendarActivityRow[];
  summarize: (sessions: SessionLike[]) => Summary;
}): { sessions: CalendarSession[]; activities: CalendarActivity[]; weeks: Array<CalendarWeek<Summary>> } {
  const { from, to, today, canonicalById } = input;
  const firstWeek = mondayOf(from);
  const weeks = selectHistoryWeeks(input.plans, Number.MAX_SAFE_INTEGER)
    .filter((week) => isoDay(week.startDate) >= firstWeek && isoDay(week.startDate) <= to)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const sessions: CalendarSession[] = [];
  const usedActivityIds = new Set<string>();
  for (const week of weeks) {
    for (const session of week.sessions) {
      const dateIso = isoDay(session.scheduledDate);
      const links = session.executionLinks ?? [];
      // Atividades ligadas a sessoes (e a sintetica do relogio) nao reaparecem como atividade solta.
      for (const link of links) {
        usedActivityIds.add(link.activityLog.id);
        const canonical = canonicalById.get(link.activityLog.id);
        if (canonical) usedActivityIds.add(canonical.id);
      }
      const extraActivityId = (session.structure as { activityLogId?: unknown } | null)?.activityLogId;
      if (session.origin === 'device_extra' && typeof extraActivityId === 'string') usedActivityIds.add(extraActivityId);
      if (dateIso < from || dateIso > to) continue;
      const mapped = mapHistorySession(session);
      const hasActiveLink = links.length > 0;
      sessions.push({
        ...mapped,
        planId: week.planId,
        dateIso,
        origin: session.origin ?? null,
        kind: kindOf(session),
        status: statusOf(session, hasActiveLink, dateIso, today),
        executedByDevice: hasActiveLink,
        hasFeedback: session.completion != null,
        execution: executionOf(links, canonicalById),
      });
    }
  }
  sessions.sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : a.modality.localeCompare(b.modality)));

  const activities: CalendarActivity[] = input.activities
    .filter((row) => row.executionClassification !== 'corresponding' && !usedActivityIds.has(row.id))
    .map((row): CalendarActivity => ({
      id: row.id,
      provider: row.provider,
      dateIso: new Date(row.startedAt.getTime() + (row.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10),
      modality: canonicalModality(row.sport) ?? row.sport ?? 'outra',
      durationMin: row.durationSec != null ? row.durationSec / 60 : null,
      distanceKm: row.distanceMeters != null ? row.distanceMeters / 1000 : null,
      avgHeartRateBpm: row.avgHeartRateBpm,
      classification: row.executionClassification === 'alternative' ? 'alternative' : row.executionClassification === 'ambiguous' ? 'ambiguous' : null,
    }))
    .filter((activity) => activity.dateIso >= from && activity.dateIso <= to)
    .sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : 0));

  return {
    sessions,
    activities,
    weeks: weeks.map((week) => ({ weekStart: isoDay(week.startDate), planId: week.planId, summary: input.summarize(week.sessions) })),
  };
}
