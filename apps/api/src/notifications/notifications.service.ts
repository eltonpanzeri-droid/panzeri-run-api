import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hasSubscriptionAccess } from '../training-plans/training-plans.service';
import { PushNotificationService } from './push-notification.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationService,
  ) {}

  // Pedido do treinador 16/08 ("passo 1" da lista de comunicacao com o aluno) — todo aviso
  // criado pra um aluno passa a existir tambem como push notification no celular dele, nao so
  // como item silencioso na tela de notificacoes que ele so ve se abrir o app. Chame este metodo
  // (nunca prisma.userNotification.create direto) em qualquer lugar que avisa um ALUNO — os
  // avisos que existem hoje pra COACH (ex: workout-completions.service.ts) continuam usando
  // prisma direto, o treinador nao tem token de push (usa o painel web + Telegram).
  async notifyUser(userId: string, params: { title: string; message: string; type?: string }) {
    const [notification, user] = await Promise.all([
      this.prisma.userNotification.create({
        data: { userId, title: params.title, message: params.message, type: params.type ?? 'info' },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } }),
    ]);
    await this.push.send(user?.expoPushToken, params.title, params.message).catch(() => undefined);
    return notification;
  }

  async registerPushToken(userId: string, token: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { expoPushToken: token } });
    return { registered: true };
  }

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
      // Desde que a geracao virou sob demanda (botao "Gerar treino da semana", 07/08), ficar
      // sem programa ativo por alguns dias e normal pra quem ja tem historico — nao tem nada a
      // ver com anamnese pendente. A mensagem generica antiga ficava enganosa nesse caso; agora
      // distingue os 3 motivos reais de nao ter programa ativo.
      const [onboarding, user, anyPlanEver] = await Promise.all([
        this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
        this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } }),
        this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } }),
      ]);
      const message = !onboarding?.completedAt
        ? 'Complete a entrevista inicial para montarmos seu programa de treino.'
        : !hasSubscriptionAccess(user?.subscriptionStatus ?? 'pending')
          ? 'Finalize seu pagamento para liberar seu programa de treino.'
          : anyPlanEver
            ? 'Toque em "Gerar treino da semana" para receber seu programa desta semana.'
            : 'Estamos preparando seu programa inicial.';
      return [
        {
          id: 'auto-no-plan',
          title: 'Programa pendente',
          message,
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
