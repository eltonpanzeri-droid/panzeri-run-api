import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarRace, CalendarSession, planRaceCalendarChanges } from './target-race-calendar';

// Aplica no banco o que target-race-calendar.ts decide (ver la' as regras). Chamado quando uma meta e' criada/editada/excluida e depois de cada geracao de semana. Idempotente: rodar de novo
// nao muda nada. Nunca chama IA, nunca apaga sessao com execucao, vinculo de atividade ou entrega a relogio. Falha aqui nunca derruba quem chamou.
@Injectable()
export class TargetRaceCalendarService {
  private readonly logger = new Logger(TargetRaceCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncUser(userId: string): Promise<{ created: number; updated: number; removed: number; kept: number }> {
    const summary = { created: 0, updated: 0, removed: 0, kept: 0 };
    try {
      const plans = await this.prisma.trainingPlan.findMany({ where: { userId, status: 'active' }, select: { id: true, startDate: true, endDate: true } });
      if (plans.length === 0) return summary;
      const races = (await this.prisma.targetRace.findMany({ where: { userId, status: 'em_andamento' }, select: { id: true, name: true, raceDate: true, distanceKm: true, targetSeconds: true } })) as CalendarRace[];
      for (const plan of plans) {
        const planEnd = plan.endDate ?? new Date(plan.startDate.getTime() + 6 * 86_400_000);
        const rows = await this.prisma.trainingSession.findMany({
          where: { planId: plan.id },
          select: { id: true, scheduledDate: true, modality: true, origin: true, structure: true, _count: { select: { executionLinks: true, deliveries: true } }, completion: { select: { id: true } } },
        });
        const sessions: CalendarSession[] = rows.map((row) => ({
          id: row.id, scheduledDate: row.scheduledDate, modality: row.modality, origin: row.origin, structure: row.structure,
          hasDependents: row.completion !== null || row._count.executionLinks > 0 || row._count.deliveries > 0,
        }));
        const changes = planRaceCalendarChanges({ planStart: plan.startDate, planEnd, races, sessions });
        if (changes.create.length + changes.update.length + changes.deleteSessionIds.length === 0) { summary.kept += changes.kept.length; continue; }
        await this.prisma.$transaction(async (tx) => {
          if (changes.deleteSessionIds.length > 0) await tx.trainingSession.deleteMany({ where: { id: { in: changes.deleteSessionIds }, planId: plan.id } });
          for (const { sessionId, data } of changes.update) await tx.trainingSession.update({ where: { id: sessionId }, data: this.columns(data) });
          for (const data of changes.create) await tx.trainingSession.create({ data: { planId: plan.id, userId, ...this.columns(data) } });
        });
        summary.created += changes.create.length; summary.updated += changes.update.length; summary.removed += changes.deleteSessionIds.length; summary.kept += changes.kept.length;
      }
    } catch (error) {
      this.logger.warn(`Sincronizacao da prova alvo no calendario falhou para ${userId}: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
    }
    return summary;
  }

  private columns(data: ReturnType<typeof planRaceCalendarChanges>['create'][number]) {
    return {
      scheduledDate: data.scheduledDate, weekday: data.weekday, modality: data.modality, title: data.title, sessionType: data.sessionType, distanceKm: data.distanceKm, durationMin: data.durationMin,
      locationSuggestion: 'Prova', structure: data.structure as unknown as Prisma.InputJsonObject, origin: data.origin,
    };
  }
}
