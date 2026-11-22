/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { scopeOfDates } from '../activity-execution/correction-hooks';
import { markPending } from '../activity-execution/pending-reevaluation';
import { isoOf, moveSessionToExecutedDate } from '../activity-execution/executed-date-move';
import { localCalendarDate } from '../activity-execution/session-execution-link.service';

// Reparo pontual (22/11/2026, ordem de Elton): treinos prescritos que a aluna JA vinculou a uma atividade feita em OUTRO dia continuam no dia prescrito. Esta rotina aplica a regra
// nova (a data realizada prevalece) aos vinculos ativos de UMA conta. Nada e' apagado: o dia prescrito fica em `prescribedDate`; o conteudo do treino nao muda.
//   REPAIR_EMAIL=email node dist/maintenance/executed-date-repair.js            (SO' MOSTRA o que mudaria)
//   REPAIR_EMAIL=email node dist/maintenance/executed-date-repair.js --apply    (aplica)
// Conflito (ja existe treino da mesma modalidade no dia) NAO e' resolvido aqui: aparece na lista para a aluna decidir pelo app.
async function main() {
  const email = (process.env.REPAIR_EMAIL ?? '').trim().toLowerCase();
  if (!email) throw new Error('Informe REPAIR_EMAIL.');
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error('Conta nao encontrada.');
    const links = await prisma.sessionExecutionLink.findMany({
      where: { userId: user.id, status: 'active' },
      include: { trainingSession: true, activityLog: true },
      orderBy: { createdAt: 'asc' },
    });
    const sessionIds: string[] = [];
    const dates = new Set<string>();
    let moved = 0;
    for (const link of links) {
      const session = link.trainingSession;
      if (['device_extra', 'student_extra'].includes(session.origin ?? '')) continue;
      const executed = localCalendarDate(link.activityLog.startedAt, link.activityLog.utcOffsetMinutes);
      const planned = isoOf(session.scheduledDate);
      if (executed === planned) continue;
      const label = `"${session.title}" prescrito ${planned} -> feito ${executed}`;
      if (!apply) { console.log(`[so mostra] ${label}`); continue; }
      try {
        const result = await moveSessionToExecutedDate(prisma as never, { sessionId: session.id, executedIso: executed });
        if (result.moved) { moved += 1; sessionIds.push(session.id); dates.add(planned); dates.add(executed); console.log(`[movido] ${label}`); } else console.log(`[nao movido: ${result.reason}] ${label}`);
      } catch (error) {
        console.log(`[pergunta pendente] ${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (apply && sessionIds.length > 0) {
      // marca o que precisa ser refeito (analise de cada treino e medalhas das semanas/meses afetados); o servidor processa sozinho
      await markPending(prisma as never, user.id, {
        analysisSessionIds: sessionIds, forceSessionIds: sessionIds,
        medals: { categories: ['acumulado', 'distancia_unica'], ...scopeOfDates([...dates]), countsChanged: true },
      });
    }
    console.log(apply ? `${moved} treino(s) movido(s).` : 'Nada foi alterado (use --apply para aplicar).');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
