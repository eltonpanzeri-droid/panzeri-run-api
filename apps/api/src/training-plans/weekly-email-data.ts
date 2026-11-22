import type { PrismaService } from '../prisma/prisma.service';
import { shortObjective, type WeeklyEmailData, type WeeklyEmailLastWeek } from './weekly-email';

// Numeros do e-mail do programa da semana (22/11/2026). So' SOMAS e comparacoes dos registros da propria aluna, para o e-mail DELA: nada disto vai para a IA e nada aqui escolhe treino.
// ai-scope: nao-ia (e-mail enviado a propria aluna; as leituras abaixo nao alimentam nenhum agente).

const DAY_MS = 86_400_000;
const EXTRA_ORIGINS = ['device_extra', 'student_extra'];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const pad = (n: number) => String(n).padStart(2, '0');
const dm = (date: Date) => `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;

export interface PlannedSessionForEmail { scheduledDate: Date; weekday: number; title: string; durationMin?: number | null; distanceKm?: number | null; intensityZone?: string | null; notes?: string | null }

async function weekTotals(prisma: PrismaService, userId: string, start: Date): Promise<(Omit<WeeklyEmailLastWeek, 'previousKm' | 'medals'>) | null> {
  const end = new Date(start.getTime() + 7 * DAY_MS);
  const sessions = await prisma.trainingSession.findMany({
    where: { userId, scheduledDate: { gte: start, lt: end }, OR: [{ plan: { status: 'active' } }, { completion: { isNot: null } }] },
    select: { id: true, origin: true, weekday: true, completion: { select: { status: true, distanceKm: true, durationMin: true } } },
  });
  if (sessions.length === 0) return null;
  const links = await prisma.sessionExecutionLink.findMany({
    where: { userId, status: 'active', trainingSessionId: { in: sessions.map((s) => s.id) } },
    select: { trainingSessionId: true, activityLog: { select: { distanceMeters: true, durationSec: true } } },
  });
  const linkedBySession = new Map<string, Array<{ km: number; min: number }>>();
  for (const link of links) {
    const list = linkedBySession.get(link.trainingSessionId) ?? [];
    list.push({ km: (link.activityLog.distanceMeters ?? 0) / 1000, min: (link.activityLog.durationSec ?? 0) / 60 });
    linkedBySession.set(link.trainingSessionId, list);
  }
  const kmByWeekday = [0, 0, 0, 0, 0, 0, 0];
  let prescribed = 0; let done = 0; let unregistered = 0; let km = 0; let minutes = 0; let longest = 0;
  for (const session of sessions) {
    const isExtra = EXTRA_ORIGINS.includes(session.origin ?? '');
    const linked = linkedBySession.get(session.id) ?? [];
    const completed = session.completion != null && ['done', 'adjusted'].includes(session.completion.status);
    const isDone = linked.length > 0 || completed;
    if (!isExtra) { prescribed += 1; if (isDone) done += 1; else if (session.completion == null) unregistered += 1; }
    if (!isDone) continue;
    const sessionKm = linked.length > 0 ? linked.reduce((sum, l) => sum + l.km, 0) : (session.completion?.distanceKm ?? 0);
    const sessionMin = linked.length > 0 ? linked.reduce((sum, l) => sum + l.min, 0) : (session.completion?.durationMin ?? 0);
    km += sessionKm; minutes += sessionMin; longest = Math.max(longest, sessionKm);
    if (session.weekday >= 0 && session.weekday <= 6) kmByWeekday[session.weekday] += sessionKm;
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return { prescribed, done, km: round(km), minutes: Math.round(minutes), longestKm: longest > 0 ? round(longest) : null, kmByWeekday: kmByWeekday.map(round), unregistered };
}

// Nunca lanca: qualquer falha devolve null e o e-mail sai no formato simples (a geracao do programa nao depende disto).
export async function collectWeeklyEmailData(prisma: PrismaService, input: { userId: string; weekStart: Date; sessions: PlannedSessionForEmail[]; goal: string | null; appUrl: string }): Promise<WeeklyEmailData | null> {
  try {
    const { userId, weekStart } = input;
    const prevStart = new Date(weekStart.getTime() - 7 * DAY_MS);
    const [prev, prev2, medals] = await Promise.all([
      weekTotals(prisma, userId, prevStart),
      weekTotals(prisma, userId, new Date(weekStart.getTime() - 14 * DAY_MS)),
      prisma.userAchievement.findMany({ where: { userId, status: 'active', unlockedAt: { gte: prevStart, lt: weekStart } }, include: { achievement: { select: { name: true } } }, take: 3, orderBy: { unlockedAt: 'desc' } }),
    ]);
    const lastWeek: WeeklyEmailLastWeek | null = prev ? { ...prev, previousKm: prev2 && prev2.km > 0 ? prev2.km : null, medals: medals.map((m) => m.achievement.name) } : null;
    const days = [...input.sessions].sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime()).map((session) => ({
      weekdayLabel: WEEKDAYS[session.weekday] ?? '', dateLabel: dm(session.scheduledDate), title: session.title,
      durationMin: session.durationMin ?? null, distanceKm: session.distanceKm ?? null, zone: session.intensityZone ?? null, objective: shortObjective(session.notes),
    }));
    return { goal: input.goal, weekLabel: `${dm(weekStart)} a ${dm(new Date(weekStart.getTime() + 6 * DAY_MS))}`, lastWeek, days, appUrl: input.appUrl };
  } catch {
    return null;
  }
}
