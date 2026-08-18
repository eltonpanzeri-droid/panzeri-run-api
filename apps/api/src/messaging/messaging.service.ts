import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async sendEmail(userId: string, params: { subject: string; content: string; trigger: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new NotFoundException('Aluno nao encontrado.');

    const result = await this.emailService.send(user.email, params.subject, params.content);

    await this.prisma.messageLog.create({
      data: {
        userId,
        channel: 'email',
        trigger: params.trigger,
        subject: params.subject,
        content: params.content,
        status: result.ok ? 'sent' : 'failed',
        errorDetail: result.error,
      },
    });

    return result;
  }

  async hasRecentTriggerMessage(userId: string, trigger: string, withinDays: number) {
    const since = new Date(Date.now() - withinDays * 86400000);
    const existing = await (this.prisma as any).messageLog.findFirst({
      where: { userId, trigger, createdAt: { gte: since } },
    });
    return Boolean(existing);
  }

  // Usado pelos degraus da jornada de aquecimento de prospectos (8h/24h/7d/30d) — cada degrau
  // dispara UMA vez na vida do cadastro, nao com janela/cooldown como os avisos de cobranca
  // recorrentes. "Ja foi enviado alguma vez" (sucesso ou falha, mesma convencao de
  // hasRecentTriggerMessage) e' o suficiente pra nunca repetir o mesmo degrau.
  async hasEverSentTrigger(userId: string, trigger: string) {
    const existing = await this.prisma.messageLog.findFirst({ where: { userId, trigger } });
    return Boolean(existing);
  }
}
