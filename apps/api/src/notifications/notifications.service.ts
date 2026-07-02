import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const stored = await this.prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const automatic = await this.weekAlerts(userId);

    return {
      items: [
        ...automatic,
        ...stored.map((item) => ({
          id: item.id,
          title: item.title,
          message: item.message,
          type: item.type,
          read: Boolean(item.readAt),
          createdAt: item.createdAt,
        })),
      ],
    };
  }

  async markRead(userId: string, notificationId: string) {
    return this.prisma.userNotification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  private async weekAlerts(userId: string) {
    const plan = await this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
    });

    if (!plan) {
      return [
        {
          id: 'auto-no-plan',
          title: 'Plano pendente',
          message: 'Complete anamnese e teste para gerar sua semana de treino.',
          type: 'warning',
          read: false,
          createdAt: new Date(),
        },
      ];
    }

    const today = startOfDay(new Date());
    const overdue = plan.sessions.filter((session) => session.scheduledDate < today && !session.completion).length;
    const todaySessions = plan.sessions.filter((session) => sameDay(session.scheduledDate, today));
    const alerts = [];

    if (todaySessions.length) {
      alerts.push({
        id: 'auto-today',
        title: 'Treino de hoje',
        message: `Voce tem ${todaySessions.length} treino(s) programado(s) hoje.`,
        type: 'info',
        read: false,
        createdAt: new Date(),
      });
    }

    if (overdue > 0) {
      alerts.push({
        id: 'auto-overdue',
        title: 'Registro pendente',
        message: `${overdue} treino(s) anteriores ainda estao sem registro.`,
        type: 'warning',
        read: false,
        createdAt: new Date(),
      });
    }

    const tips = [
      ['Hidratacao', 'Mantenha sua hidratacao ao longo do dia e observe sede e cor da urina.'],
      ['Sono e recuperacao', 'Uma noite de sono adequada ajuda na recuperacao e na qualidade do proximo treino.'],
      ['Preparacao', 'Confira o treino e separe roupa, tenis e hidratacao antes do horario programado.'],
      ['Alimentacao', 'Organize sua alimentacao e siga as orientacoes do profissional que acompanha voce.'],
      ['Escute o corpo', 'Registre no treino qualquer dor, desconforto ou dificuldade fora do habitual.'],
    ];
    const dayIndex = Math.floor(today.getTime() / 86400000) % tips.length;
    alerts.push({
      id: `auto-tip-${dayIndex}`,
      title: tips[dayIndex][0],
      message: tips[dayIndex][1],
      type: 'info',
      read: false,
      createdAt: new Date(),
    });

    return alerts;
  }
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function sameDay(left: Date, right: Date) {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}
