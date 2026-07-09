import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type EfiResponse<T> = { code: number; data: T };
type EfiPlan = { plan_id: number };
type EfiCheckout = {
  subscription_id: number;
  status: string;
  charge: { id: number; status: string };
  payment_url: string;
};
type EfiSubscriptionDetails = {
  subscription_id: number;
  status: string;
  next_execution?: string | null;
  history?: Array<{ status?: string }>;
};
type EfiEvent = {
  identifiers?: { charge_id?: number; subscription_id?: number };
  status?: { current?: string };
};

const ACTIVE_STATUSES = new Set(['active', 'paid', 'approved', 'settled']);
const OVERDUE_STATUSES = new Set(['unpaid', 'overdue', 'refunded', 'chargeback']);
const CANCELED_STATUSES = new Set(['canceled', 'cancelled', 'expired']);

@Injectable()
export class BillingService {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async getMine(userId: string) {
    const efiConfigured = this.isConfigured();
    const manualUrl = this.manualPaymentUrl();
    const [user, billing] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { subscriptionStatus: true, subscriptionUpdatedAt: true },
      }),
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
    ]);

    let appStatus = user.subscriptionStatus;
    let providerStatus = billing?.providerStatus ?? null;
    let nextChargeAt = billing?.nextChargeAt ?? null;
    let syncError = false;

    if (billing?.externalSubscriptionId && efiConfigured) {
      try {
        const refreshed = await this.refreshFromEfi(billing.id, userId, billing.externalSubscriptionId);
        appStatus = refreshed.appStatus;
        providerStatus = refreshed.providerStatus;
        nextChargeAt = refreshed.nextChargeAt;
      } catch {
        syncError = true;
      }
    }

    return {
      provider: efiConfigured ? 'efi' : 'manual',
      planName: 'Panzeri Run - Plano mensal',
      priceLabel: 'R$ 19,90 por mes',
      status: appStatus,
      providerStatus,
      checkoutUrl: billing?.checkoutUrl ?? manualUrl,
      nextChargeAt,
      updatedAt: user.subscriptionUpdatedAt,
      canCancel: Boolean(['active', 'manual_active', 'grace', 'pending'].includes(appStatus)),
      syncError,
    };
  }

  async createCheckout(userId: string) {
    if (!this.isConfigured()) {
      return this.createManualCheckout(userId);
    }
    const [existing, user] = await Promise.all([
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { subscriptionStatus: true } }),
    ]);
    if (existing?.checkoutUrl && ['new', 'link', 'waiting'].includes(existing.providerStatus)) {
      return { checkoutUrl: existing.checkoutUrl };
    }

    const planId = await this.ensurePlan();
    const publicUrl = this.config.get<string>('APP_PUBLIC_URL')?.replace(/\/$/, '');
    if (!publicUrl) throw new BadRequestException('APP_PUBLIC_URL nao configurada.');

    const response = await this.efiRequest<EfiResponse<EfiCheckout>>('/v1/plan/' + planId + '/subscription/one-step/link', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ name: 'Panzeri Run - Plano mensal', value: 1990, amount: 1 }],
        metadata: {
          custom_id: 'panzeri-run:' + userId,
          notification_url: publicUrl + '/billing/efi/notification',
        },
        settings: {
          payment_method: 'credit_card',
          request_delivery_address: false,
        },
      }),
    });

    const data = response.data;
    await this.prisma.$transaction([
      this.prisma.billingSubscription.upsert({
        where: { userId },
        create: {
          userId,
          externalSubscriptionId: String(data.subscription_id),
          externalChargeId: String(data.charge.id),
          checkoutUrl: data.payment_url,
          providerStatus: data.status || data.charge.status,
        },
        update: {
          externalSubscriptionId: String(data.subscription_id),
          externalChargeId: String(data.charge.id),
          checkoutUrl: data.payment_url,
          providerStatus: data.status || data.charge.status,
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

    return { checkoutUrl: data.payment_url };
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

    await this.efiRequest('/v1/subscription/' + billing.externalSubscriptionId + '/cancel', {
      method: 'PUT',
      body: JSON.stringify({ description: 'Cancelamento solicitado pelo aluno no Panzeri Run.' }),
    });
    await this.updateStatus(userId, 'canceled', 'canceled');
    return { status: 'canceled', message: 'Assinatura cancelada.' };
  }

  async processNotification(notification: string) {
    this.assertConfigured();
    const response = await this.efiRequest<EfiResponse<EfiEvent[]>>('/v1/notification/' + encodeURIComponent(notification));
    const events = Array.isArray(response.data) ? response.data : [];
    const identifiers = [...events].reverse().find((event) => event.identifiers)?.identifiers;
    const billing = identifiers?.subscription_id
      ? await this.prisma.billingSubscription.findUnique({ where: { externalSubscriptionId: String(identifiers.subscription_id) } })
      : identifiers?.charge_id
        ? await this.prisma.billingSubscription.findUnique({ where: { externalChargeId: String(identifiers.charge_id) } })
        : null;

    if (!billing) return { received: true };

    const current = [...events].reverse().map((event) => event.status?.current?.toLowerCase()).find(Boolean) ?? 'unknown';
    const appStatus = ACTIVE_STATUSES.has(current)
      ? 'active'
      : OVERDUE_STATUSES.has(current)
        ? 'overdue'
        : CANCELED_STATUSES.has(current)
          ? 'canceled'
          : 'pending';

    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({
        where: { id: billing.id },
        data: { providerStatus: current, lastNotificationToken: notification },
      }),
      this.prisma.user.update({
        where: { id: billing.userId },
        data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() },
      }),
    ]);
    return { received: true };
  }

  private async refreshFromEfi(billingId: string, userId: string, subscriptionId: string) {
    const response = await this.efiRequest<EfiResponse<EfiSubscriptionDetails>>('/v1/subscription/' + subscriptionId);
    const providerStatus = response.data.status?.toLowerCase() ?? 'unknown';
    const latestChargeStatus = response.data.history?.at(-1)?.status?.toLowerCase();
    const appStatus = CANCELED_STATUSES.has(providerStatus)
      ? 'canceled'
      : latestChargeStatus && OVERDUE_STATUSES.has(latestChargeStatus)
        ? 'overdue'
        : ACTIVE_STATUSES.has(providerStatus)
          ? 'active'
          : 'pending';
    const nextChargeAt = response.data.next_execution ? new Date(response.data.next_execution + 'T12:00:00.000Z') : null;

    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({
        where: { id: billingId },
        data: { providerStatus, nextChargeAt },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() },
      }),
    ]);

    return { providerStatus, appStatus, nextChargeAt };
  }
  private async updateStatus(userId: string, providerStatus: string, appStatus: string) {
    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({ where: { userId }, data: { providerStatus } }),
      this.prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() } }),
    ]);
  }

  private async createManualCheckout(userId: string) {
    const checkoutUrl = this.manualPaymentUrl();
    if (!checkoutUrl) throw new BadRequestException('Link de pagamento ainda nao configurado.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { subscriptionStatus: true } });

    await this.prisma.$transaction([
      this.prisma.billingSubscription.upsert({
        where: { userId },
        create: {
          userId,
          provider: 'manual',
          providerStatus: 'waiting_payment',
          checkoutUrl,
        },
        update: {
          provider: 'manual',
          providerStatus: 'waiting_payment',
          checkoutUrl,
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

    return { checkoutUrl, mode: 'manual' };
  }
  private async ensurePlan() {
    const saved = await this.prisma.billingProviderConfig.findUnique({ where: { provider: 'efi' } });
    if (saved) return saved.externalPlanId;

    const response = await this.efiRequest<EfiResponse<EfiPlan>>('/v1/plan', {
      method: 'POST',
      body: JSON.stringify({ name: 'Panzeri Run - Plano mensal', interval: 1, repeats: null }),
    });
    const planId = String(response.data.plan_id);
    await this.prisma.billingProviderConfig.upsert({
      where: { provider: 'efi' },
      create: { provider: 'efi', externalPlanId: planId },
      update: { externalPlanId: planId },
    });
    return planId;
  }

  private async efiRequest<T>(path: string, init: RequestInit = {}) {
    const token = await this.accessToken();
    const response = await fetch(this.baseUrl() + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BadGatewayException(payload?.error_description ?? payload?.error ?? 'A Efi nao conseguiu processar a solicitacao.');
    }
    return payload as T;
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 30000) return this.token.value;
    this.assertConfigured();
    const clientId = this.config.get<string>('EFI_CLIENT_ID')!;
    const clientSecret = this.config.get<string>('EFI_CLIENT_SECRET')!;
    const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const response = await fetch(this.baseUrl() + '/v1/authorize', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new BadGatewayException('Credenciais da Efi recusadas.');
    this.token = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in ?? 600) * 1000 };
    return this.token.value;
  }

  private baseUrl() {
    return this.config.get<string>('EFI_SANDBOX') === 'false'
      ? 'https://cobrancas.api.efipay.com.br'
      : 'https://cobrancas-h.api.efipay.com.br';
  }

  private isConfigured() {
    return Boolean(this.config.get<string>('EFI_CLIENT_ID') && this.config.get<string>('EFI_CLIENT_SECRET'));
  }

  private manualPaymentUrl() {
    return this.config.get<string>('MANUAL_PAYMENT_URL') || 'https://mpago.la/23YBr2R';
  }

  private assertConfigured() {
    if (!this.config.get<string>('EFI_CLIENT_ID') || !this.config.get<string>('EFI_CLIENT_SECRET')) {
      throw new BadRequestException('Integracao Efi ainda nao configurada.');
    }
  }
}