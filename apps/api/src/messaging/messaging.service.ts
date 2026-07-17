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
}
