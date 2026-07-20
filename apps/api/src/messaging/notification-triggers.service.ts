import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from './messaging.service';

const REMINDER_COOLDOWN_DAYS = 3;
const TEST_STALE_AFTER_DAYS = 90;
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
        tests: { where: { testType: '3km' }, orderBy: { createdAt: 'desc' }, take: 1 },
        reassessments: { where: { completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, take: 1 },
      },
    });

    for (const student of students) {
      try {
        await this.checkPaymentPending(student);
        await this.checkInterviewIncomplete(student);
        await this.checkTestMissingOrStale(student);
        await this.checkReassessmentDue(student);
      } catch (error) {
        this.logger.warn(`Falha ao checar avisos automaticos para ${student.id}: ${(error as Error).message}`);
      }
    }
  }

  private async checkPaymentPending(student: { id: string; name: string; subscriptionStatus: string }) {
    if (student.subscriptionStatus !== 'pending' && student.subscriptionStatus !== 'overdue') return;
    if (await this.messaging.hasRecentTriggerMessage(student.id, 'payment_pending', REMINDER_COOLDOWN_DAYS)) return;

    await this.messaging.sendEmail(student.id, {
      trigger: 'payment_pending',
      subject: 'Seu pagamento esta pendente - Panzeri Run',
      content: `Ola ${student.name},\n\nNotamos que seu pagamento ainda esta pendente. Efetue o pagamento para liberar seus treinos.\n\nPanzeri Run`,
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

  private async checkTestMissingOrStale(student: {
    id: string;
    name: string;
    subscriptionStatus: string;
    onboardingInterview?: { completedAt: Date | null } | null;
    tests: Array<{ createdAt: Date }>;
  }) {
    if (!student.onboardingInterview?.completedAt) return;
    if (student.subscriptionStatus === 'pending') return;

    const latestTest = student.tests[0];
    if (!latestTest) {
      if (await this.messaging.hasRecentTriggerMessage(student.id, 'test_missing', REMINDER_COOLDOWN_DAYS)) return;
      await this.messaging.sendEmail(student.id, {
        trigger: 'test_missing',
        subject: 'Seu teste de 3 km ainda nao foi preenchido - Panzeri Run',
        content: `Ola ${student.name},\n\nVoce ainda nao registrou seu teste de 3 km. Isso ajuda a calibrar seus treinos com muito mais precisao.\n\nPanzeri Run`,
      });
      return;
    }

    const daysSinceTest = (Date.now() - latestTest.createdAt.getTime()) / 86400000;
    if (daysSinceTest < TEST_STALE_AFTER_DAYS) return;
    if (await this.messaging.hasRecentTriggerMessage(student.id, 'test_stale', TEST_STALE_AFTER_DAYS)) return;

    await this.messaging.sendEmail(student.id, {
      trigger: 'test_stale',
      subject: 'Hora de atualizar seu teste de 3 km - Panzeri Run',
      content: `Ola ${student.name},\n\nSeu ultimo teste de 3 km foi feito ha mais de 3 meses. Atualize-o para deixarmos seus treinos ainda mais precisos.\n\nPanzeri Run`,
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
      content: `Ola ${student.name},\n\nJa faz mais de 3 meses desde sua ultima avaliacao. Responda a reavaliacao rapida no aplicativo para atualizarmos seu treino e acompanharmos sua evolucao.\n\nPanzeri Run`,
    });
  }
}
