import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

// 22/11/2026 (ordem de Elton): a data em que o treino foi REALIZADO prevalece. Ao vincular uma atividade feita em outro dia a um treino prescrito, o treino passa para o dia da execucao
// (em qualquer semana); o dia que a IA prescreveu fica em `prescribedDate`. Desvincular devolve o treino ao dia prescrito. So' troca data/dia da semana/semana do treino: nenhum conteudo
// prescrito e' recalculado (Principio da prescricao). Funcoes recebem o cliente do Prisma (ou a transacao) para rodarem dentro da mesma trava do vinculo.

type Db = Pick<PrismaService, 'trainingSession' | 'trainingPlan'>;
const DAY_MS = 86_400_000;
const EXTRA_ORIGINS = ['device_extra', 'student_extra'];

export const isoToUtcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const isoOf = (date: Date) => date.toISOString().slice(0, 10);
// Segunda = 0 ... domingo = 6 (mesma convencao de TrainingSession.weekday)
export const weekdayMondayFirst = (date: Date) => (date.getUTCDay() + 6) % 7;
const dmy = (iso: string) => iso.split('-').reverse().join('/');

export interface MoveResult {
  moved: boolean;
  reason: 'moved' | 'same_day' | 'no_plan';
  from?: string; // YYYY-MM-DD
  to?: string;
}

// Programa (semana) que contem o dia: o do proprio treino, se cobrir o dia; senao o ativo da semana; senao o mais recente.
async function planCovering(db: Db, userId: string, day: Date, preferPlanId: string) {
  const candidates = await db.trainingPlan.findMany({
    where: { userId, startDate: { lte: day, gt: new Date(day.getTime() - 7 * DAY_MS) } },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return candidates.find((p) => p.id === preferPlanId) ?? candidates.find((p) => p.status === 'active') ?? candidates[0] ?? null;
}

export async function moveSessionToExecutedDate(db: Db, params: { sessionId: string; executedIso: string; confirmConflict?: boolean }): Promise<MoveResult> {
  const session = await db.trainingSession.findUnique({ where: { id: params.sessionId } });
  if (!session || EXTRA_ORIGINS.includes(session.origin ?? '')) return { moved: false, reason: 'same_day' };
  const from = isoOf(session.scheduledDate);
  if (from === params.executedIso) return { moved: false, reason: 'same_day' };
  const target = isoToUtcDate(params.executedIso);
  const plan = await planCovering(db, session.userId, target, session.planId);
  if (!plan) return { moved: false, reason: 'no_plan', from, to: params.executedIso };
  const weekday = weekdayMondayFirst(target);

  // Ja' existe OUTRO treino prescrito da mesma modalidade nesse dia: a aluna decide (o sistema so' avisa para ela nao se confundir).
  const conflict = await db.trainingSession.findFirst({
    where: { planId: plan.id, weekday, modality: session.modality, id: { not: session.id }, NOT: { origin: { in: EXTRA_ORIGINS } } },
    select: { title: true },
  });
  if (conflict && params.confirmConflict !== true) {
    throw new BadRequestException({
      code: 'date_conflict',
      message: `Em ${dmy(params.executedIso)} já existe o treino "${conflict.title}" da mesma modalidade. Quer mesmo mover este treino para esse dia? Os dois ficarão no mesmo dia.`,
      existingTitle: conflict.title, date: params.executedIso,
    });
  }

  await db.trainingSession.update({
    where: { id: session.id },
    data: { scheduledDate: target, weekday, planId: plan.id, prescribedDate: session.prescribedDate ?? session.scheduledDate },
  });
  return { moved: true, reason: 'moved', from, to: params.executedIso };
}

// Desvincular: se o treino foi movido pelo vinculo, volta ao dia prescrito (o programa daquele dia e' procurado de novo; se nao existir mais, fica onde esta).
export async function restorePrescribedDate(db: Db, sessionId: string): Promise<MoveResult> {
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session || !session.prescribedDate) return { moved: false, reason: 'same_day' };
  const back = session.prescribedDate;
  const plan = await planCovering(db, session.userId, back, session.planId);
  if (!plan) return { moved: false, reason: 'no_plan' };
  const from = isoOf(session.scheduledDate);
  await db.trainingSession.update({ where: { id: session.id }, data: { scheduledDate: back, weekday: weekdayMondayFirst(back), planId: plan.id, prescribedDate: null } });
  return { moved: true, reason: 'moved', from, to: isoOf(back) };
}
