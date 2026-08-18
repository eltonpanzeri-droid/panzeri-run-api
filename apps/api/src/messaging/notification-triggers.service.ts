import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from './messaging.service';

const REMINDER_COOLDOWN_DAYS = 3;
const REASSESSMENT_DUE_AFTER_DAYS = 90;

@Injectable()
export class NotificationTriggersService {
  private readonly logger = new Logger(NotificationTriggersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runDailyChecks() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: { not: 'archived' } },
      include: {
        onboardingInterview: { select: { completedAt: true } },
        billingSubscription: { select: { checkoutUrl: true } },
        reassessments: { where: { completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, take: 1 },
      },
    });

    for (const student of students) {
      try {
        await this.checkPaymentPending(student);
        await this.checkInterviewIncomplete(student);
        await this.checkReassessmentDue(student);
      } catch (error) {
        this.logger.warn(`Falha ao checar avisos automaticos para ${student.id}: ${(error as Error).message}`);
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
      return;
    }

    await this.messaging.sendEmail(student.id, {
      trigger: 'payment_pending',
      subject: 'Falta o pagamento para liberar seus treinos - Panzeri Run',
      content: `Ola ${student.name},\n\nSeu cadastro esta quase pronto — falta so confirmar o pagamento para liberarmos seus treinos.\n\n${linkLine}\n\nQualquer duvida, fale com seu treinador.\n\nPanzeri Run`,
    });
  }

  private async checkInterviewIncomplete(student: { id: string; name: string; onboardingInterview?: { completedAt: Date | null } | null }) {
    if (student.onboardingInterview?.completedAt) return;
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
      content: `Ola ${student.name},\n\nJa faz mais de 3 meses desde sua ultima avaliacao. Responda a reavaliacao rapida no aplicativo para atualizarmos seu treino e acompanharmos sua evolucao.\n\nPanzeri Run`,
    });
  }
}
