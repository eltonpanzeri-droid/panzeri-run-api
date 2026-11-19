import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CONFIRMED_STATUSES, COURTESY_STATUS, STUDENT_METRICS_POPULATION } from '../coach/subscription-groups.util';
import { NotificationOrchestratorService } from './notification-orchestrator.service';
import { categoriesForDay, LIBRARY_REPEAT_DAYS, libraryRuleId, nextTipFor } from './notification-library';
import { DEFAULT_TZ_OFFSET_MINUTES, NOTIFICATION_CATEGORIES } from './notification-policy';

// Avisos proativos diarios (19/11/2026, ordem de Elton, Lotes 2 a 4): todo dia as 10h (Sao Paulo) cada aluna ativa recebe, no maximo, dois avisos da biblioteca (rodizio de temas) e, na segunda-feira, o aviso
// semanal de relatorio. Tudo passa pelo orquestrador: respeita tema ligado, faixa por dia, horario e teto da aluna, e registra cada tentativa. DESLIGADO por padrao: so' envia com PROACTIVE_NOTIFICATIONS_ENABLED=true
// (revisar os textos da biblioteca antes). Trava contra execucao sobreposta; o mesmo aviso nunca repete para a mesma aluna dentro da janela (externalRef + registro).
const shifted = (now: Date) => new Date(now.getTime() + DEFAULT_TZ_OFFSET_MINUTES * 60_000);
const dayIndexOf = (now: Date) => Math.floor(shifted(now).getTime() / 86_400_000);
const localWeekday = (now: Date) => shifted(now).getUTCDay();
const localDateKey = (now: Date) => shifted(now).toISOString().slice(0, 10);

@Injectable()
export class ProactiveNotificationsService {
  private readonly logger = new Logger(ProactiveNotificationsService.name);
  private isRunning = false;

  constructor(private readonly prisma: PrismaService, private readonly orchestrator: NotificationOrchestratorService, private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.config.get<string>('PROACTIVE_NOTIFICATIONS_ENABLED')?.trim().toLowerCase() === 'true';
  }

  @Cron('0 10 * * *', { timeZone: 'America/Sao_Paulo' })
  async dailyRun() {
    if (!this.isEnabled() || this.isRunning) return;
    this.isRunning = true;
    try {
      const result = await this.run(new Date());
      this.logger.log(`Avisos proativos: ${result.students} aluna(s), ${result.sent} enviado(s), ${result.blocked} barrado(s).`);
    } catch (error) {
      this.logger.warn(`Falha nos avisos proativos: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  async run(now: Date): Promise<{ students: number; sent: number; blocked: number }> {
    const students = await this.prisma.user.findMany({
      where: { ...STUDENT_METRICS_POPULATION, subscriptionStatus: { in: [...CONFIRMED_STATUSES, COURTESY_STATUS] } },
      select: { id: true },
    });
    const todaysCategories = categoriesForDay(NOTIFICATION_CATEGORIES.map((item) => item.id), dayIndexOf(now));
    const since = new Date(now.getTime() - LIBRARY_REPEAT_DAYS * 86_400_000);
    let sent = 0;
    let blocked = 0;
    const count = (outcome: { sent: boolean }) => { if (outcome.sent) sent += 1; else blocked += 1; };
    for (const student of students) {
      try {
        const rows = await this.prisma.notificationSendLog.findMany({ where: { userId: student.id, status: 'sent', ruleId: { startsWith: 'tip:' }, createdAt: { gte: since } }, select: { ruleId: true } });
        const used = new Set(rows.map((row) => row.ruleId));
        for (const category of todaysCategories) {
          const tip = nextTipFor(category, used);
          if (!tip) continue;
          const ruleId = libraryRuleId(tip);
          count(await this.orchestrator.dispatch(student.id, { ruleId, category: tip.category, title: tip.title, message: tip.message, externalRef: `${ruleId}:${localDateKey(now)}`, now }));
        }
        // Relatorios: toda segunda-feira, um aviso por semana (a chave da semana impede repetir).
        if (localWeekday(now) === 1) {
          count(await this.orchestrator.dispatch(student.id, { ruleId: 'report:weekly', category: 'relatorios', title: 'Sua semana está pronta', message: 'Veja como foi a sua última semana em Seu resumo, na tela inicial do Panzeri Run.', externalRef: `report:weekly:${localDateKey(now)}`, now }));
        }
      } catch (error) {
        this.logger.warn(`Avisos proativos: falha numa aluna (${error instanceof Error ? error.message.slice(0, 100) : 'erro'}); seguindo para a proxima.`);
      }
    }
    return { students: students.length, sent, blocked };
  }

  // Painel do treinador (Lote 5): o que foi enviado e barrado nos ultimos dias, por tema, mais os registros recentes.
  async summary(days = 7) {
    const span = Math.min(Math.max(Number.isFinite(days) ? days : 7, 1), 60);
    const since = new Date(Date.now() - span * 86_400_000);
    const [groups, recent] = await Promise.all([
      this.prisma.notificationSendLog.groupBy({ by: ['category', 'status', 'reason'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.notificationSendLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(recent.map((row) => row.userId))] } }, select: { id: true, name: true, studentCode: true } });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      enabled: this.isEnabled(),
      days: span,
      totals: groups.map((group) => ({ category: group.category, status: group.status, reason: group.reason, count: group._count._all })),
      recent: recent.map((row) => ({ at: row.createdAt.toISOString(), category: row.category, ruleId: row.ruleId, status: row.status, reason: row.reason, studentName: byId.get(row.userId)?.name ?? null, studentCode: byId.get(row.userId)?.studentCode ?? null })),
    };
  }
}
