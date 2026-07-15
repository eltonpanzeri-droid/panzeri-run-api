import { BadGatewayException, BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

type AsaasCustomer = { id: string };
type AsaasCustomerList = { data: AsaasCustomer[] };
type AsaasSubscription = { id: string; status: string; nextDueDate?: string | null };
type AsaasSubscriptionList = { data: AsaasSubscription[] };
type AsaasPayment = { id: string; status: string; invoiceUrl?: string | null; dateCreated?: string };
type AsaasPaymentList = { data: AsaasPayment[] };
type AsaasWebhookPayload = {
  event?: string;
  payment?: { id?: string; subscription?: string; status?: string; value?: number };
};

const ACTIVE_STATUSES = new Set(['received', 'confirmed', 'received_in_cash']);
const OVERDUE_STATUSES = new Set(['overdue', 'refunded', 'refund_requested', 'chargeback_requested', 'chargeback_dispute']);
const PLAN_PRICE = 19.9;
const PLAN_DESCRIPTION = 'Panzeri Run - Plano mensal';
const WELCOME_NOTIFICATION_TYPE = 'subscription_welcome';
const WELCOME_NOTIFICATION_TITLE = 'Bem-vindo ao Panzeri Run';
const WELCOME_NOTIFICATION_MESSAGE = 'Estou muito feliz em poder conduzir você em sua jornada de treinos. Vamos com tudo';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
  ) {}

  async getMine(userId: string) {
    const asaasConfigured = this.isConfigured();
    const [user, billing] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { subscriptionStatus: true, subscriptionUpdatedAt: true, cpf: true },
      }),
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
    ]);

    let appStatus = user.subscriptionStatus;
    let providerStatus = billing?.providerStatus ?? null;
    let nextChargeAt = billing?.nextChargeAt ?? null;
    let syncError = false;

    if (billing?.externalSubscriptionId && asaasConfigured) {
      try {
        const refreshed = await this.refreshFromAsaas(billing.id, userId, billing.externalSubscriptionId);
        appStatus = refreshed.appStatus;
        providerStatus = refreshed.providerStatus;
        nextChargeAt = refreshed.nextChargeAt;
      } catch {
        syncError = true;
      }
    }

    return {
      provider: billing?.provider ?? 'asaas',
      planName: PLAN_DESCRIPTION,
      priceLabel: 'R$ 19,90 por mes',
      status: appStatus,
      providerStatus,
      hasCpf: Boolean(user.cpf),
      checkoutUrl: appStatus === 'manual_active' ? null : billing?.checkoutUrl ?? null,
      nextChargeAt,
      updatedAt: user.subscriptionUpdatedAt,
      canCancel: billing?.provider !== 'coupon' && Boolean(['active', 'manual_active', 'grace', 'pending'].includes(appStatus)),
      syncError,
    };
  }

  async createCheckout(userId: string, cpf?: string) {
    this.assertConfigured();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, cpf: true, subscriptionStatus: true } });

    let savedCpf = user.cpf;
    if (!savedCpf) {
      const normalized = normalizeCpf(cpf);
      if (!normalized) throw new BadRequestException('Informe um CPF valido para continuar.');
      await this.prisma.user.update({ where: { id: userId }, data: { cpf: normalized } });
      savedCpf = normalized;
    }

    const existing = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (existing?.providerStatus && ACTIVE_STATUSES.has(existing.providerStatus)) {
      throw new BadRequestException('A assinatura ja esta ativa.');
    }
    if (existing?.checkoutUrl && existing.providerStatus === 'pending') {
      return { checkoutUrl: existing.checkoutUrl };
    }

    const customerId = existing?.externalCustomerId ?? (await this.ensureCustomer(userId, user.name, user.email, savedCpf));

    const existingSubscriptions = await this.asaasRequest<AsaasSubscriptionList>(`/subscriptions?customer=${customerId}&status=ACTIVE`);
    const reusableSubscription = existingSubscriptions.data?.[0] ?? null;

    let subscriptionId: string;
    if (reusableSubscription) {
      subscriptionId = reusableSubscription.id;
    } else {
      const nextDueDate = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const subscription = await this.asaasRequest<AsaasSubscription>('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customer: customerId,
          billingType: 'CREDIT_CARD',
          value: PLAN_PRICE,
          nextDueDate,
          cycle: 'MONTHLY',
          description: PLAN_DESCRIPTION,
        }),
      });
      subscriptionId = subscription.id;
    }

    const payments = await this.asaasRequest<AsaasPaymentList>(`/payments?subscription=${subscriptionId}`);
    const firstPayment = payments.data?.[0] ?? null;
    const checkoutUrl = firstPayment?.invoiceUrl ?? null;
    if (!checkoutUrl) throw new BadGatewayException('O Asaas nao retornou o link de pagamento.');

    await this.prisma.$transaction([
      this.prisma.billingSubscription.upsert({
        where: { userId },
        create: {
          userId,
          provider: 'asaas',
          externalCustomerId: customerId,
          externalSubscriptionId: subscriptionId,
          checkoutUrl,
          providerStatus: 'pending',
        },
        update: {
          provider: 'asaas',
          externalCustomerId: customerId,
          externalSubscriptionId: subscriptionId,
          checkoutUrl,
          providerStatus: 'pending',
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionStatus: ['active', 'manual_active', 'grace'].includes(user.subscriptionStatus) ? user.subscriptionStatus : 'pending',
          subscriptionUpdatedAt: new Date(),
        },
      }),
    ]);

    await this.telegram.notifyCoach(`Nova assinatura gerada no Panzeri Run\n\nAluno: ${user.name}\nE-mail: ${user.email}\nStatus: aguardando pagamento (R$ 19,90/mes)`);

    return { checkoutUrl };
  }

  async applyCoupon(userId: string, code: string) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) throw new BadRequestException('Informe o cupom.');

    const prisma = this.prisma as any;
    const coupon = await prisma.coupon.findUnique({ where: { code: normalized } });
    if (coupon && !coupon.active) throw new BadRequestException('Cupom inativo.');

    if (coupon) {
      const alreadyUsed = await prisma.couponRedemption.findUnique({
        where: { couponId_userId: { couponId: coupon.id, userId } },
      });

      await this.prisma.$transaction([
        prisma.couponRedemption.upsert({
          where: { couponId_userId: { couponId: coupon.id, userId } },
          create: { couponId: coupon.id, userId },
          update: {},
        }),
        ...(alreadyUsed ? [] : [prisma.coupon.update({ where: { id: coupon.id }, data: { usageCount: { increment: 1 } } })]),
      ]);

      if (coupon.discountPercent >= 100) {
        await this.activateCouponAccess(userId, normalized);
        return { status: 'manual_active', discountPercent: coupon.discountPercent, message: 'Cupom aplicado. Acesso liberado.' };
      }

      return {
        status: 'pending',
        discountPercent: coupon.discountPercent,
        message: `Cupom aplicado: ${coupon.discountPercent}% de desconto. Finalize o pagamento para liberar o acesso.`,
      };
    }

    if (!this.validCouponCodes().includes(normalized)) {
      throw new BadRequestException('Cupom invalido.');
    }

    await this.activateCouponAccess(userId, normalized);
    return { status: 'manual_active', discountPercent: 100, message: 'Cupom aplicado. Acesso liberado.' };
  }

  private async activateCouponAccess(userId: string, normalized: string) {
    await this.prisma.$transaction([
      this.prisma.billingSubscription.upsert({
        where: { userId },
        create: {
          userId,
          provider: 'coupon',
          providerStatus: 'coupon:' + normalized,
          checkoutUrl: null,
        },
        update: {
          provider: 'coupon',
          providerStatus: 'coupon:' + normalized,
          externalSubscriptionId: null,
          externalChargeId: null,
          checkoutUrl: null,
          nextChargeAt: null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionStatus: 'manual_active', subscriptionUpdatedAt: new Date() },
      }),
    ]);
  }

  async cancel(userId: string) {
    const billing = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (!billing?.externalSubscriptionId) {
      await this.prisma.$transaction([
        billing
          ? this.prisma.billingSubscription.update({ where: { userId }, data: { providerStatus: 'cancel_requested' } })
          : this.prisma.billingSubscription.create({ data: { userId, provider: 'manual', providerStatus: 'cancel_requested' } }),
        this.prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: 'canceled', subscriptionUpdatedAt: new Date() } }),
      ]);
      return { status: 'canceled', message: 'Solicitacao de cancelamento registrada.' };
    }

    await this.asaasRequest(`/subscriptions/${billing.externalSubscriptionId}`, { method: 'DELETE' });
    await this.updateStatus(userId, 'canceled', 'canceled');
    return { status: 'canceled', message: 'Assinatura cancelada.' };
  }

  async processAsaasWebhook(accessToken: string | undefined, payload: AsaasWebhookPayload) {
    const expectedToken = this.config.get<string>('ASAAS_WEBHOOK_TOKEN');
    if (!expectedToken || accessToken !== expectedToken) {
      throw new UnauthorizedException('Token de webhook invalido.');
    }

    const subscriptionId = payload.payment?.subscription;
    if (!subscriptionId) return { received: true };

    const billing = await this.prisma.billingSubscription.findUnique({ where: { externalSubscriptionId: subscriptionId } });
    if (!billing) return { received: true };

    const current = (payload.payment?.status ?? 'unknown').toLowerCase();
    const appStatus = ACTIVE_STATUSES.has(current) ? 'active' : OVERDUE_STATUSES.has(current) ? 'overdue' : 'pending';

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: billing.userId }, select: { name: true, email: true, subscriptionStatus: true } });
    const wasAlreadyActive = user.subscriptionStatus === 'active';

    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({
        where: { id: billing.id },
        data: { providerStatus: current },
      }),
      this.prisma.user.update({
        where: { id: billing.userId },
        data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() },
      }),
    ]);

    if (appStatus === 'active') {
      await this.createWelcomeNotificationOnce(billing.userId);
      if (!wasAlreadyActive) {
        await this.telegram.notifyCoach(`Pagamento recebido no Panzeri Run!\n\nAluno: ${user.name}\nE-mail: ${user.email}\nValor: R$ 19,90 via Asaas`);
      }
    }

    return { received: true };
  }

  private async refreshFromAsaas(billingId: string, userId: string, subscriptionId: string) {
    const [subscription, payments] = await Promise.all([
      this.asaasRequest<AsaasSubscription>(`/subscriptions/${subscriptionId}`),
      this.asaasRequest<AsaasPaymentList>(`/payments?subscription=${subscriptionId}`),
    ]);

    const providerStatus = subscription.status?.toLowerCase() ?? 'unknown';
    const latestPayment = [...(payments.data ?? [])].sort((a, b) => (a.dateCreated ?? '').localeCompare(b.dateCreated ?? '')).at(-1);
    const latestPaymentStatus = latestPayment?.status?.toLowerCase();
    const appStatus = providerStatus === 'inactive' || providerStatus === 'deleted'
      ? 'canceled'
      : latestPaymentStatus && ACTIVE_STATUSES.has(latestPaymentStatus)
        ? 'active'
        : latestPaymentStatus && OVERDUE_STATUSES.has(latestPaymentStatus)
          ? 'overdue'
          : 'pending';
    const nextChargeAt = subscription.nextDueDate ? new Date(subscription.nextDueDate + 'T12:00:00.000Z') : null;

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, subscriptionStatus: true } });
    const wasAlreadyActive = user.subscriptionStatus === 'active';

    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({
        where: { id: billingId },
        data: { providerStatus: latestPaymentStatus ?? providerStatus, nextChargeAt },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() },
      }),
    ]);

    if (appStatus === 'active') {
      await this.createWelcomeNotificationOnce(userId);
      if (!wasAlreadyActive) {
        await this.telegram.notifyCoach(`Pagamento recebido no Panzeri Run!\n\nAluno: ${user.name}\nE-mail: ${user.email}\nValor: R$ 19,90 via Asaas`);
      }
    }

    return { providerStatus: latestPaymentStatus ?? providerStatus, appStatus, nextChargeAt };
  }

  private async createWelcomeNotificationOnce(userId: string) {
    const existing = await this.prisma.userNotification.findFirst({
      where: { userId, type: WELCOME_NOTIFICATION_TYPE },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.userNotification.create({
      data: {
        userId,
        title: WELCOME_NOTIFICATION_TITLE,
        message: WELCOME_NOTIFICATION_MESSAGE,
        type: WELCOME_NOTIFICATION_TYPE,
      },
    });
  }

  private async updateStatus(userId: string, providerStatus: string, appStatus: string) {
    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({ where: { userId }, data: { providerStatus } }),
      this.prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() } }),
    ]);
  }

  private async ensureCustomer(userId: string, name: string, email: string, cpf: string) {
    const existing = await this.asaasRequest<AsaasCustomerList>(`/customers?cpfCnpj=${cpf}`);
    if (existing.data?.length) {
      return existing.data[0].id;
    }

    const customer = await this.asaasRequest<AsaasCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify({ name, email, cpfCnpj: cpf, externalReference: userId }),
    });
    return customer.id;
  }

  private async asaasRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const apiKey = this.config.get<string>('ASAAS_API_KEY');
    const response = await fetch(this.baseUrl() + path, {
      ...init,
      headers: { access_token: apiKey ?? '', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.errors?.[0]?.description ?? 'O Asaas nao conseguiu processar a solicitacao.';
      throw new BadGatewayException(message);
    }
    return payload as T;
  }

  private baseUrl() {
    return this.config.get<string>('ASAAS_SANDBOX') === 'false'
      ? 'https://api.asaas.com/v3'
      : 'https://sandbox.asaas.com/api/v3';
  }

  private isConfigured() {
    return Boolean(this.config.get<string>('ASAAS_API_KEY'));
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new BadRequestException('Integracao com o Asaas ainda nao configurada.');
    }
  }

  private validCouponCodes() {
    const configured = this.config.get<string>('ACCESS_COUPONS') || 'PANZERI100';
    return configured
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
  }
}

function normalizeCpf(value?: string) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
