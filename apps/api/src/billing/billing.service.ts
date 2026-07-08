import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const [user, billing] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { subscriptionStatus: true, subscriptionUpdatedAt: true },
      }),
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
    ]);

    return {
      provider: 'efi',
      planName: 'Panzeri Run - Plano mensal',
      priceLabel: 'R$ 19,90 por mes',
      status: user.subscriptionStatus,
      providerStatus: billing?.providerStatus ?? null,
      checkoutUrl: billing?.checkoutUrl ?? null,
      nextChargeAt: billing?.nextChargeAt ?? null,
      updatedAt: user.subscriptionUpdatedAt,
      canCancel: Boolean(billing?.externalSubscriptionId && ['active', 'manual_active', 'grace'].includes(user.subscriptionStatus)),
    };
  }

  async createCheckout(userId: string) {
    this.assertConfigured();
    const existing = await this.prisma.billingSubscription.findUnique({ where: { userId } });
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
        data: { subscriptionStatus: 'pending', subscriptionUpdatedAt: new Date() },
      }),
    ]);

    return { checkoutUrl: data.payment_url };
  }

  async cancel(userId: string) {
    const billing = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (!billing?.externalSubscriptionId) throw new NotFoundException('Assinatura Efi nao encontrada.');

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

  private async updateStatus(userId: string, providerStatus: string, appStatus: string) {
    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({ where: { userId }, data: { providerStatus } }),
      this.prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() } }),
    ]);
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

  private assertConfigured() {
    if (!this.config.get<string>('EFI_CLIENT_ID') || !this.config.get<string>('EFI_CLIENT_SECRET')) {
      throw new BadRequestException('Integracao Efi ainda nao configurada.');
    }
  }
}