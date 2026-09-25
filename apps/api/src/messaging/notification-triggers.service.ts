import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingService } from './messaging.service';
import { REASSESSMENT_DUE_AFTER_DAYS, REASSESSMENT_WARNING_AFTER_DAYS } from '../reassessment/reassessment.service';
import { MenstrualCycleService } from '../menstrual-cycle/menstrual-cycle.service';

const REMINDER_COOLDOWN_DAYS = 3;
// 25/09/2026 (Passo 3): fonte unica do ciclo de 105 dias e' ReassessmentService — NAO redefinir
// aqui de novo (era um valor local duplicado ate esta correcao, risco real de divergencia).

@Injectable()
export class NotificationTriggersService {
  private readonly logger = new Logger(NotificationTriggersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly menstrualCycle: MenstrualCycleService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runDailyChecks() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: { not: 'archived' } },
      include: {
        onboardingInterview: { select: { completedAt: true } },
        billingSubscription: { select: { checkoutUrl: true } },
        reassessments: { where: { completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, take: 1 },
        // 21/08: usado so pra checkInterviewIncomplete nao avisar aluna que ja tem rotina real
        // configurada (ver comentario la embaixo — incidente real, aluna Lucelane).
        availability: { select: { id: true }, take: 1 },
      },
    });

    for (const student of students) {
      try {
        await this.checkPaymentPending(student);
        await this.checkInterviewIncomplete(student);
        await this.checkReassessmentWarning(student);
        await this.checkReassessmentDue(student);
      } catch (error) {
        this.logger.warn(`Falha ao checar avisos automaticos para ${student.id}: ${(error as Error).message}`);
      }
    }
    await this.checkMenstrualCycleUpdates();
  }

  // 25/09/2026 (evolução do acompanhamento menstrual, seção 23) — a notificação existe pra AJUDAR
  // a aluna a manter o calendário atualizado, nunca pra afirmar nada como fato ("pode ter
  // terminado" / "já começou?", nunca "sua menstruação terminou"). Reaproveita getCycleOverview()
  // já calculado (mesma fonte canônica que alimenta o calendário e o Admin) — nenhuma lógica nova
  // de "quando perguntar" fora daqui. Dedup permanente por ciclo (externalRef = id do log): cada
  // pergunta só é feita uma vez por ciclo, nunca insiste (seção 29).
  private async checkMenstrualCycleUpdates() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: { not: 'archived' }, menstrualProfile: { hasActiveCycle: true } },
      select: { id: true },
    });

    for (const student of students) {
      try {
        const overview = await this.menstrualCycle.getCycleOverview(student.id);
        const lastCycle = overview.cycles[overview.cycles.length - 1];
        if (!lastCycle) continue;

        if (!lastCycle.endDate) {
          const typicalPeriodLength = overview.periodLengthStats?.median ?? null;
          if (
            typicalPeriodLength != null &&
            overview.currentDayOfCycle != null &&
            overview.currentDayOfCycle >= typicalPeriodLength &&
            overview.currentDayOfCycle <= typicalPeriodLength + 4
          ) {
            await this.notifications.notifyUserIfNotRecent(
              student.id,
              {
                title: 'Atualize seu calendário',
                message: 'Pelos seus registros, ontem pode ter sido o último dia da sua menstruação. Você confirma?',
                type: 'menstrual_period_likely_ended',
                action: 'open_ciclo',
                externalRef: `menstrual_end_${lastCycle.id}`,
                // Privacidade (seção 30): tela bloqueada nunca menciona menstruação — conteúdo completo só dentro do app.
                pushTitle: 'Panzeri Run',
                pushMessage: 'Você tem uma atualização de acompanhamento pendente.',
              },
              24,
            ).catch(() => undefined);
          }
        }

        if (overview.predictedNextPeriod && new Date(overview.predictedNextPeriod.windowEnd + 'T23:59:59Z') < new Date()) {
          await this.notifications.notifyUserIfNotRecent(
            student.id,
            {
              title: 'Seu período estava previsto',
              message: 'Seu período estava estimado para começar nesta janela. Ele já começou?',
              type: 'menstrual_period_expected_overdue',
              action: 'open_ciclo',
              externalRef: `menstrual_overdue_${lastCycle.id}`,
              pushTitle: 'Panzeri Run',
              pushMessage: 'Você tem uma atualização de acompanhamento pendente.',
            },
            24,
          ).catch(() => undefined);
        }
      } catch (error) {
        this.logger.warn(`Falha ao checar ciclo menstrual de ${student.id}: ${(error as Error).message}`);
      }
    }
  }

  // 18/08: e-mail de cobranca reescrito pra respeitar a situacao real do aluno em vez de um texto
  // generico igual pra tudo — "pending" (nunca ativou/aguardando 1o pagamento) e "overdue"
  // (assinatura ja ativa, pagamento falhou) sao situacoes diferentes e merecem tom e orientacao
  // diferentes. Tambem passou a incluir o link de pagamento de verdade quando ja existe um gerado
  // (billingSubscription.checkoutUrl) em vez de só mandar "efetue o pagamento" sem dizer como.
  private async checkPaymentPending(student: {
    id: string;
    name: string;
    subscriptionStatus: string;
    billingSubscription?: { checkoutUrl: string | null } | null;
  }) {
    if (student.subscriptionStatus !== 'pending' && student.subscriptionStatus !== 'overdue') return;
    if (await this.messaging.hasRecentTriggerMessage(student.id, 'payment_pending', REMINDER_COOLDOWN_DAYS)) return;

    const checkoutUrl = student.billingSubscription?.checkoutUrl;
    const linkLine = checkoutUrl
      ? `Finalize por aqui: ${checkoutUrl}`
      : 'Abra o aplicativo, va em "Plano e faturamento" e gere seu link de pagamento por la.';

    if (student.subscriptionStatus === 'overdue') {
      await this.messaging.sendEmail(student.id, {
        trigger: 'payment_pending',
        subject: 'Seu pagamento nao foi processado - Panzeri Run',
        content: `Ola ${student.name},\n\nSeu ultimo pagamento nao foi processado (pode ter sido algum problema no cartao cadastrado). Enquanto isso nao for regularizado, seus treinos ficam bloqueados.\n\n${linkLine}\n\nQualquer duvida, fale com seu treinador.\n\nPanzeri Run`,
      });
      // 05/09: push notification complementar ao e-mail — janela de 72h (= REMINDER_COOLDOWN_DAYS)
      // garante que webhook (primeira detecção) e cron (lembrete recorrente) não se sobreponham.
      await this.notifications.notifyUserIfNotRecent(
        student.id,
        {
          title: 'Pagamento nao processado',
          message: 'Toque aqui para ver sua situacao de pagamento e regularizar.',
          type: 'billing_payment_failed',
          action: 'billing_regularize',
        },
        REMINDER_COOLDOWN_DAYS * 24,
      ).catch(() => undefined);
      return;
    }

    await this.messaging.sendEmail(student.id, {
      trigger: 'payment_pending',
      subject: 'Falta o pagamento para liberar seus treinos - Panzeri Run',
      content: `Ola ${student.name},\n\nSeu cadastro esta quase pronto — falta so confirmar o pagamento para liberarmos seus treinos.\n\n${linkLine}\n\nQualquer duvida, fale com seu treinador.\n\nPanzeri Run`,
    });
  }

  // 18/08 (Bloco 2 de onboarding): a entrevista COMPLETA/detalhada agora so acontece depois do
  // pagamento — entao esse aviso so faz sentido pra quem ja pagou (subscriptionStatus !== 'pending')
  // e ainda nao terminou a entrevista detalhada. Prospecto (nunca pagou) e' avisado por outro
  // caminho, a sequencia de aquecimento (ver ProspectNurtureService), que cobra as 5 perguntas
  // rapidas, nao a entrevista completa que ele nem consegue acessar ainda.
  private async checkInterviewIncomplete(student: { id: string; name: string; subscriptionStatus: string; onboardingInterview?: { completedAt: Date | null } | null; availability?: unknown[] }) {
    if (student.subscriptionStatus === 'pending') return;
    if (student.onboardingInterview?.completedAt) return;
    // 21/08, incidente real (aluna Lucelane): conta antiga com rotina e plano ativo de verdade,
    // mas `completedAt` vazio no banco (provavelmente criada antes desse campo existir). Mandar
    // "sua entrevista esta incompleta" pra quem ja tem rotina configurada e' confuso e errado —
    // ja ter rotina e' sinal forte de que ja foi onboarded de verdade.
    if (student.availability && student.availability.length > 0) return;
    if (await this.messaging.hasRecentTriggerMessage(student.id, 'interview_incomplete', REMINDER_COOLDOWN_DAYS)) return;

    await this.messaging.sendEmail(student.id, {
      trigger: 'interview_incomplete',
      subject: 'Sua entrevista esta incompleta - Panzeri Run',
      content: `Ola ${student.name},\n\nSua entrevista inicial ainda nao foi concluida. Complete-a no aplicativo para liberarmos seu treino personalizado.\n\nPanzeri Run`,
    });
  }

  // 18/08: removido o lembrete de "teste de 3km pendente/desatualizado" — o recurso foi escondido
  // da tela do aluno em 28/07 a pedido do treinador ([[threekm_test_hidden]]). Antes o e-mail
  // nao ia pra frente (Resend sem dominio configurado), entao isso nunca incomodou ninguem; agora
  // que o e-mail funciona de verdade, cobrar um aluno por algo que sumiu do app confundiria e
  // desrespeitaria quem recebesse.

  // 25/09/2026 (Passo 3, secao 4): aviso antecipado na semana 14 do ciclo de 15 semanas (98-104
  // dias desde a ancora). Nao bloqueia nada — so' avisa que a reavaliacao esta chegando. Cooldown
  // de 7 dias e' suficiente pra disparar uma unica vez dentro da janela de 7 dias entre o aviso e
  // o "due" de verdade (98 a 104), sem repetir todo dia.
  private async checkReassessmentWarning(student: {
    id: string;
    name: string;
    subscriptionStatus: string;
    onboardingInterview?: { completedAt: Date | null } | null;
    reassessments: Array<{ completedAt: Date | null }>;
  }) {
    if (!student.onboardingInterview?.completedAt) return;
    if (student.subscriptionStatus === 'pending') return;

    const referenceDate = student.reassessments[0]?.completedAt ?? student.onboardingInterview.completedAt;
    const daysSinceReference = (Date.now() - referenceDate.getTime()) / 86400000;
    if (daysSinceReference < REASSESSMENT_WARNING_AFTER_DAYS || daysSinceReference >= REASSESSMENT_DUE_AFTER_DAYS) return;
    if (await this.messaging.hasRecentTriggerMessage(student.id, 'reassessment_warning', REMINDER_COOLDOWN_DAYS * 2 + 1)) return;

    await this.notifications.notifyUserIfNotRecent(
      student.id,
      {
        title: 'Sua reavaliacao esta chegando',
        message: 'Em breve sera necessario atualizar sua avaliacao para que seus proximos treinos considerem sua evolucao.',
        type: 'reassessment_warning',
        action: 'reassessment_open',
      },
      (REMINDER_COOLDOWN_DAYS * 2 + 1) * 24,
    ).catch(() => undefined);

    await this.messaging.sendEmail(student.id, {
      trigger: 'reassessment_warning',
      subject: 'Sua reavaliacao esta chegando - Panzeri Run',
      content: `Ola ${student.name},\n\nSeu ciclo de 15 semanas esta perto de terminar. Em breve sera necessario responder a reavaliacao periodica no aplicativo para que seus proximos treinos considerem sua evolucao.\n\nPanzeri Run`,
    });
  }

  private async checkReassessmentDue(student: {
    id: string;
    name: string;
    subscriptionStatus: string;
    onboardingInterview?: { completedAt: Date | null } | null;
    reassessments: Array<{ completedAt: Date | null }>;
  }) {
    if (!student.onboardingInterview?.completedAt) return;
    if (student.subscriptionStatus === 'pending') return;

    const referenceDate = student.reassessments[0]?.completedAt ?? student.onboardingInterview.completedAt;
    const daysSinceReference = (Date.now() - referenceDate.getTime()) / 86400000;
    if (daysSinceReference < REASSESSMENT_DUE_AFTER_DAYS) return;
    if (await this.messaging.hasRecentTriggerMessage(student.id, 'reassessment_due', REASSESSMENT_DUE_AFTER_DAYS)) return;

    await this.messaging.sendEmail(student.id, {
      trigger: 'reassessment_due',
      subject: 'Hora da sua reavaliacao periodica - Panzeri Run',
      content: `Ola ${student.name},\n\nJa se passaram 15 semanas desde sua ultima avaliacao. Responda a reavaliacao no aplicativo para atualizarmos seu treino e continuarmos gerando seus proximos treinos.\n\nPanzeri Run`,
    });
  }
}
