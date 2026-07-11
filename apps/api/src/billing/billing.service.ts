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

type AsaasCustomer = { id: string };
type AsaasSubscription = {
  id: string;
  status?: string;
  nextDueDate?: string | null;
};
type AsaasPayment = {
  id: string;
  status?: string;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  paymentLink?: string | null;
  dueDate?: string | null;
  subscription?: string | null;
};
type AsaasList<T> = { data?: T[] };
type AsaasWebhook = {
  event?: string;
  payment?: AsaasPayment & { customer?: string | null };
  subscription?: AsaasSubscription;
};

const ACTIVE_STATUSES = new Set(['active', 'paid', 'approved', 'settled', 'confirmed', 'received', 'received_in_cash']);
const OVERDUE_STATUSES = new Set(['unpaid', 'overdue', 'refunded', 'chargeback', 'refund_requested', 'refund_in_progress', 'awaiting_risk_analysis']);
const CANCELED_STATUSES = new Set(['canceled', 'cancelled', 'expired', 'deleted']);
const WAITING_STATUSES = new Set(['pending', 'new', 'waiting', 'waiting_payment', 'pending_payment', 'awaiting_payment']);

@Injectable()
export class BillingService {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async getMine(userId: string) {
    const asaasConfigured = this.isAsaasConfigured();
    const efiConfigured = this.isEfiConfigured();
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

    if (billing?.externalSubscriptionId && billing.provider === 'asaas' && asaasConfigured) {
      try {
        const refreshed = await this.refreshFromAsaas(billing.id, userId, billing.externalSubscriptionId);
        appStatus = refreshed.appStatus;
        providerStatus = refreshed.providerStatus;
        nextChargeAt = refreshed.nextChargeAt;
      } catch {
        syncError = true;
      }
    } else if (billing?.externalSubscriptionId && billing.provider === 'efi' && efiConfigured) {
      try {
        const refreshed = await this.refreshFromEfi(billing.id, userId, billing.externalSubscriptionId);
        appStatus = refreshed.appStatus;
        providerStatus = refreshed.providerStatus;
        nextChargeAt = refreshed.nextChargeAt;
      } catch {
        syncError = true;
      }
    }

    const provider = billing?.provider ?? (asaasConfigured ? 'asaas' : efiConfigured ? 'efi' : 'manual');
    return {
      provider,
      planName: 'Panzeri Run - Plano mensal',
      priceLabel: 'R$ 19,90 por mes',
      status: appStatus,
      providerStatus,
      checkoutUrl: appStatus === 'manual_active' ? null : billing?.checkoutUrl ?? (provider === 'manual' ? manualUrl : null),
      nextChargeAt,
      updatedAt: user.subscriptionUpdatedAt,
      canCancel: billing?.provider !== 'coupon' && Boolean(['active', 'manual_active', 'grace', 'pending'].includes(appStatus)),
      syncError,
    };
  }

  async createCheckout(userId: string) {
    if (this.isAsaasConfigured()) return this.createAsaasCheckout(userId);
    if (this.isEfiConfigured()) return this.createEfiCheckout(userId);
    return this.createManualCheckout(userId);
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

    if (billing.provider === 'asaas') {
      await this.asaasRequest('/subscriptions/' + billing.externalSubscriptionId, { method: 'DELETE' });
    } else if (billing.provider === 'efi') {
      await this.efiRequest('/v1/subscription/' + billing.externalSubscriptionId + '/cancel', {
        method: 'PUT',
        body: JSON.stringify({ description: 'Cancelamento solicitado pelo aluno no Panzeri Run.' }),
      });
    }

    await this.updateStatus(userId, 'canceled', 'canceled');
    return { status: 'canceled', message: 'Assinatura cancelada.' };
  }

  async processAsaasWebhook(dto: AsaasWebhook) {
    const payment = dto.payment;
    const subscriptionId = dto.subscription?.id ?? payment?.subscription;
    const chargeId = payment?.id;
    const billing = subscriptionId
      ? await this.prisma.billingSubscription.findUnique({ where: { externalSubscriptionId: String(subscriptionId) } })
      : chargeId
        ? await this.prisma.billingSubscription.findUnique({ where: { externalChargeId: String(chargeId) } })
        : null;

    if (!billing) return { received: true };

    const providerStatus = (payment?.status ?? dto.subscription?.status ?? dto.event ?? 'unknown').toLowerCase();
    const appStatus = this.toAppStatus(providerStatus);
    const nextChargeAt = payment?.dueDate ? this.asDate(payment.dueDate) : undefined;

    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({
        where: { id: billing.id },
        data: {
          providerStatus,
          externalChargeId: chargeId ? String(chargeId) : billing.externalChargeId,
          ...(nextChargeAt ? { nextChargeAt } : {}),
        },
      }),
      this.prisma.user.update({
        where: { id: billing.userId },
        data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() },
      }),
    ]);

    return { received: true };
  }

  async processNotification(notification: string) {
    this.assertEfiConfigured();
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
    const appStatus = this.toAppStatus(current);

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

  private async createAsaasCheckout(userId: string) {
    const [existing, user] = await Promise.all([
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true, email: true, subscriptionStatus: true },
      }),
    ]);

    if (existing?.provider === 'asaas' && existing.checkoutUrl && WAITING_STATUSES.has(existing.providerStatus)) {
      return { checkoutUrl: existing.checkoutUrl, mode: 'asaas' };
    }

    const customer = await this.asaasRequest<AsaasCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify({ name: user.name, email: user.email }),
    });

    const value = Number(this.config.get<string>('ASAAS_PLAN_VALUE') ?? '19.90');
    const billingType = this.config.get<string>('ASAAS_BILLING_TYPE') || 'CREDIT_CARD';
    const subscription = await this.asaasRequest<AsaasSubscription>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: customer.id,
        billingType,
        value,
        nextDueDate: this.nextDueDate(),
        cycle: 'MONTHLY',
        description: 'Panzeri Run - Plano mensal',
        externalReference: 'panzeri-run:' + userId,
      }),
    });

    const payment = await this.firstAsaasPayment(subscription.id);
    const checkoutUrl = payment?.invoiceUrl ?? payment?.bankSlipUrl ?? payment?.paymentLink ?? null;
    if (!checkoutUrl) {
      throw new BadGatewayException('O Asaas criou a assinatura, mas nao retornou um link de pagamento.');
    }

    const providerStatus = (payment?.status ?? subscription.status ?? 'pending_payment').toLowerCase();
    await this.prisma.$transaction([
      this.prisma.billingSubscription.upsert({
        where: { userId },
        create: {
          userId,
          provider: 'asaas',
          externalSubscriptionId: subscription.id,
          externalChargeId: payment?.id ? String(payment.id) : null,
          checkoutUrl,
          providerStatus,
          nextChargeAt: payment?.dueDate ? this.asDate(payment.dueDate) : this.asDate(subscription.nextDueDate),
        },
        update: {
          provider: 'asaas',
          externalSubscriptionId: subscription.id,
          externalChargeId: payment?.id ? String(payment.id) : null,
          checkoutUrl,
          providerStatus,
          nextChargeAt: payment?.dueDate ? this.asDate(payment.dueDate) : this.asDate(subscription.nextDueDate),
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

    return { checkoutUrl, mode: 'asaas' };
  }

  private async createEfiCheckout(userId: string) {
    const [existing, user] = await Promise.all([
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { subscriptionStatus: true } }),
    ]);
    if (existing?.provider === 'efi' && existing.checkoutUrl && ['new', 'link', 'waiting'].includes(existing.providerStatus)) {
      return { checkoutUrl: existing.checkoutUrl, mode: 'efi' };
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
          provider: 'efi',
          externalSubscriptionId: String(data.subscription_id),
          externalChargeId: String(data.charge.id),
          checkoutUrl: data.payment_url,
          providerStatus: data.status || data.charge.status,
        },
        update: {
          provider: 'efi',
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

    return { checkoutUrl: data.payment_url, mode: 'efi' };
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

  private async refreshFromAsaas(billingId: string, userId: string, subscriptionId: string) {
    const subscription = await this.asaasRequest<AsaasSubscription>('/subscriptions/' + subscriptionId);
    const providerStatus = subscription.status?.toLowerCase() ?? 'unknown';
    const appStatus = this.toAppStatus(providerStatus);
    const nextChargeAt = this.asDate(subscription.nextDueDate);

    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({ where: { id: billingId }, data: { providerStatus, nextChargeAt } }),
      this.prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() } }),
    ]);

    return { providerStatus, appStatus, nextChargeAt };
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
      this.prisma.billingSubscription.update({ where: { id: billingId }, data: { providerStatus, nextChargeAt } }),
      this.prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date() } }),
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
        create: { userId, provider: 'manual', providerStatus: 'waiting_payment', checkoutUrl },
        update: { provider: 'manual', providerStatus: 'waiting_payment', checkoutUrl },
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

  private async firstAsaasPayment(subscriptionId: string) {
    const payments = await this.asaasRequest<AsaasList<AsaasPayment>>('/payments?subscription=' + encodeURIComponent(subscriptionId) + '&limit=1');
    return payments.data?.[0] ?? null;
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

  private async asaasRequest<T>(path: string, init: RequestInit = {}) {
    const apiKey = this.config.get<string>('ASAAS_API_KEY');
    if (!apiKey) throw new BadRequestException('ASAAS_API_KEY nao configurada.');
    const response = await fetch(this.asaasBaseUrl() + path, {
      ...init,
      headers: { access_token: apiKey, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BadGatewayException(payload?.errors?.[0]?.description ?? payload?.message ?? 'O Asaas nao conseguiu processar a solicitacao.');
    }
    return payload as T;
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
    this.assertEfiConfigured();
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

  private asaasBaseUrl() {
    return this.config.get<string>('ASAAS_ENV') === 'sandbox' ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3';
  }

  private baseUrl() {
    return this.config.get<string>('EFI_SANDBOX') === 'false'
      ? 'https://cobrancas.api.efipay.com.br'
      : 'https://cobrancas-h.api.efipay.com.br';
  }

  private isAsaasConfigured() {
    return Boolean(this.config.get<string>('ASAAS_API_KEY'));
  }

  private isEfiConfigured() {
    return Boolean(this.config.get<string>('EFI_CLIENT_ID') && this.config.get<string>('EFI_CLIENT_SECRET'));
  }

  private manualPaymentUrl() {
    return this.config.get<string>('MANUAL_PAYMENT_URL') || 'https://mpago.la/23YBr2R';
  }

  private validCouponCodes() {
    const configured = this.config.get<string>('ACCESS_COUPONS') || 'PANZERI100';
    return configured.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
  }

  private assertEfiConfigured() {
    if (!this.config.get<string>('EFI_CLIENT_ID') || !this.config.get<string>('EFI_CLIENT_SECRET')) {
      throw new BadRequestException('Integracao Efi ainda nao configurada.');
    }
  }

  private nextDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  private asDate(value?: string | null) {
    return value ? new Date(value + 'T12:00:00.000Z') : null;
  }

  private toAppStatus(status: string) {
    const normalized = status.toLowerCase();
    if (ACTIVE_STATUSES.has(normalized)) return 'active';
    if (OVERDUE_STATUSES.has(normalized)) return 'overdue';
    if (CANCELED_STATUSES.has(normalized)) return 'canceled';
    return 'pending';
  }
}
