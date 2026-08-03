import { BadGatewayException, BadRequestException, forwardRef, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, formatStudentCode } from './telegram.service';
import { MessagingService } from '../messaging/messaging.service';
import { TrainingPlansService } from '../training-plans/training-plans.service';

type AsaasCustomer = { id: string };
type AsaasCustomerList = { data: AsaasCustomer[] };
type AsaasSubscription = { id: string; status: string; nextDueDate?: string | null };
type AsaasSubscriptionList = { data: AsaasSubscription[] };
type AsaasPayment = { id: string; status: string; invoiceUrl?: string | null; dateCreated?: string; dueDate?: string };
type AsaasPaymentList = { data: AsaasPayment[] };
type AsaasWebhookPayload = {
  event?: string;
  payment?: { id?: string; subscription?: string; status?: string; value?: number };
};

const ACTIVE_STATUSES = new Set(['received', 'confirmed', 'received_in_cash']);
const OVERDUE_STATUSES = new Set(['overdue', 'refunded', 'refund_requested', 'chargeback_requested', 'chargeback_dispute']);
const ACTIVE_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const OVERDUE_EVENTS = new Set(['PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_REFUND_REQUESTED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE']);
const CANCELED_EVENTS = new Set(['PAYMENT_DELETED', 'SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

function resolveAppStatusFromEvent(event?: string): 'active' | 'overdue' | 'canceled' | null {
  if (!event) return null;
  if (ACTIVE_EVENTS.has(event)) return 'active';
  if (OVERDUE_EVENTS.has(event)) return 'overdue';
  if (CANCELED_EVENTS.has(event)) return 'canceled';
  return null;
}
const PLAN_PRICE = 19.9;
const PLAN_DESCRIPTION = 'Panzeri Run - Plano mensal';
const WELCOME_NOTIFICATION_TYPE = 'subscription_welcome';
const WELCOME_NOTIFICATION_TITLE = 'Bem-vindo ao Panzeri Run';
const WELCOME_NOTIFICATION_MESSAGE = 'Pagamento confirmado! Estou muito feliz em poder conduzir você em sua jornada de treinos. Agora acesse, no menu principal, a opção "Rotina de treinos" e nos conte como será sua semana — assim que você confirmar, já montamos seu primeiro treino.';
// Se o link de pagamento nao abre visivelmente pro aluno (ver correcao do bloqueador de pop-up
// no app), ele tende a clicar em "Ativar assinatura" varias vezes seguidas — sem essa trava,
// cada clique gerava uma chamada nova pro Asaas e um aviso novo no Telegram do treinador (ja
// aconteceu na pratica: dezenas de avisos numa unica tentativa de pagamento). Dentro dessa
// janela, reaproveita o link ja gerado em vez de criar uma cobranca nova.
const CHECKOUT_RETRY_COOLDOWN_MS = 30 * 1000;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly recentCheckouts = new Map<string, { checkoutUrl: string; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
    private readonly messaging: MessagingService,
    // forwardRef: TrainingPlansModule tambem importa BillingModule (por causa do TelegramService)
    // — injecao circular, precisa do forwardRef dos dois lados (ver billing.module.ts).
    @Inject(forwardRef(() => TrainingPlansService))
    private readonly trainingPlans: TrainingPlansService,
  ) {}

  // Dispara a primeira geracao de treino assim que o pagamento e confirmado (generateFirstWeekIfNeeded
  // ja garante que so gera se for realmente a primeira vez) — nao bloqueia quem chamou, so loga se
  // falhar. Ver comentario completo em training-plans.service.ts.
  private triggerFirstWeekGeneration(userId: string) {
    void this.trainingPlans.generateFirstWeekIfNeeded(userId).catch((error) => {
      this.logger.warn(`generateFirstWeekIfNeeded falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
    });
  }

  async getMine(userId: string) {
    const asaasConfigured = this.isConfigured();
    const [user, billing] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { subscriptionStatus: true, subscriptionUpdatedAt: true, cpf: true, subscriptionManualOverride: true },
      }),
      this.prisma.billingSubscription.findUnique({ where: { userId } }),
    ]);

    let appStatus = user.subscriptionStatus;
    let providerStatus = billing?.providerStatus ?? null;
    let nextChargeAt = billing?.nextChargeAt ?? null;
    let syncError = false;

    // Se o treinador liberou o acesso manualmente (ex: aluno pagou por um link avulso e o
    // treinador confirmou no painel), essa decisao nao pode ser desfeita sozinha so porque o
    // aluno abriu a aba de assinatura e o Asaas ainda nao registrou o pagamento daquele link
    // especifico — isso ja aconteceu e derrubou o acesso de uma aluna sem ninguem perceber.
    if (billing?.externalSubscriptionId && asaasConfigured && !user.subscriptionManualOverride) {
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

  async saveCpf(userId: string, cpf: string) {
    const normalized = normalizeCpf(cpf);
    if (!normalized) throw new BadRequestException('Informe um CPF valido (11 numeros).');
    return this.prisma.user.update({ where: { id: userId }, data: { cpf: normalized }, select: { id: true, cpf: true } });
  }

  async createCheckout(userId: string, cpf?: string) {
    this.assertConfigured();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, cpf: true, subscriptionStatus: true, studentCode: true } });

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
    // NUNCA reaproveita um checkoutUrl guardado de uma tentativa anterior — se aquele link
    // expirou, foi cancelado no Asaas ou parou de funcionar por qualquer motivo, o aluno ficava
    // preso clicando em "Ativar assinatura" pra sempre e recebendo o mesmo link quebrado, sem
    // nenhum jeito de sair disso (bug real reportado por uma aluna: "clica e nao avanca"). Agora
    // toda tentativa busca um link de pagamento fresco no Asaas — a checagem de assinatura ACTIVE
    // logo abaixo ja evita criar assinatura duplicada, entao isso nao gera custo extra real.
    //
    // Mas se o link nao chega a abrir de verdade pro aluno (ver bug do bloqueador de pop-up
    // corrigido no app), ele clica de novo repetidamente — sem essa trava de curto prazo, cada
    // clique disparava uma chamada nova pro Asaas e um aviso novo no Telegram do treinador
    // (aconteceu na pratica: dezenas de avisos numa unica tentativa). Dentro da janela, devolve
    // o mesmo link ja gerado agora ha pouco, sem chamar o Asaas nem avisar o treinador de novo.
    const recent = this.recentCheckouts.get(userId);
    if (recent && Date.now() - recent.at < CHECKOUT_RETRY_COOLDOWN_MS) {
      return { checkoutUrl: recent.checkoutUrl };
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

    // So e uma assinatura de verdade NOVA (e so ai que avisa o treinador) quando o subscriptionId
    // muda em relacao ao que ja estava salvo. Clicar de novo no mesmo link pendente (usuario
    // clicando varias vezes, ou reabrindo a tela) reaproveita o MESMO subscriptionId no Asaas —
    // isso nao e uma assinatura nova, e o mesmo aviso repetido nao deveria disparar de novo.
    // Ordem explicita do treinador (02/08): nada de "nova assinatura" pra quem so clicou de novo
    // no botao; e "aluno que ja foi aluno e quer voltar" tambem nao e "nova", e reativacao.
    const isGenuinelyNewSubscription = existing?.externalSubscriptionId !== subscriptionId;
    const isReactivation = isGenuinelyNewSubscription && Boolean(existing);

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

    if (isGenuinelyNewSubscription) {
      const title = isReactivation ? 'Assinatura reativada no Panzeri Run' : 'Nova assinatura gerada no Panzeri Run';
      await this.telegram.notifyCoach(`${title}\n\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nE-mail: ${user.email}\nStatus: aguardando pagamento (R$ 19,90/mes)`);
    }
    this.recentCheckouts.set(userId, { checkoutUrl, at: Date.now() });

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
    this.triggerFirstWeekGeneration(userId);
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

    const appStatus = resolveAppStatusFromEvent(payload.event);
    const current = (payload.payment?.status ?? 'unknown').toLowerCase();
    if (!appStatus) {
      await this.prisma.billingSubscription.update({ where: { id: billing.id }, data: { providerStatus: current } });
      return { received: true };
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: billing.userId }, select: { name: true, email: true, subscriptionStatus: true, studentCode: true } });
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
        this.triggerFirstWeekGeneration(billing.userId);
        await this.telegram.notifyCoach(`Pagamento recebido no Panzeri Run!\n\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nE-mail: ${user.email}\nValor: R$ 19,90 via Asaas`);
        await this.messaging.sendEmail(billing.userId, {
          trigger: 'payment_confirmed',
          subject: 'Pagamento confirmado - monte sua rotina de treinos!',
          content: `Ola ${user.name},\n\nSeu pagamento foi confirmado! Agora acesse o aplicativo, abra o menu e toque em "Rotina de treinos" para nos contar como sera sua semana. Assim que voce confirmar, ja montamos seu primeiro treino.\n\nPanzeri Run`,
        });
      }
    }

    return { received: true };
  }

  // Usado pelo treinador quando um aluno diz que ja pagou mas o app continua mostrando acesso
  // bloqueado — em vez de gerar um novo link (que nao ajuda quem ja pagou), isso consulta o
  // status real da assinatura/pagamentos direto no Asaas e sincroniza a conta agora, sem
  // esperar o proximo webhook ou o proximo acesso do aluno ao app.
  async refreshStatusForStudent(userId: string) {
    this.assertConfigured();
    const billing = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (!billing?.externalSubscriptionId) {
      throw new BadRequestException('Este aluno nao tem uma assinatura Asaas vinculada para verificar. Gere um link de pagamento primeiro.');
    }
    return this.refreshFromAsaas(billing.id, userId, billing.externalSubscriptionId);
  }

  // Incidente real 02/08: a API ficou fora do ar por horas — qualquer confirmacao de pagamento
  // que o Asaas tentou avisar por webhook nesse periodo foi perdida (o Asaas nao fica reenviando
  // pra sempre), entao varios alunos que pagaram durante a queda continuaram presos na tela de
  // assinatura mesmo tendo pago de verdade. Em vez do treinador precisar abrir aluna por aluna e
  // clicar em "Verificar pagamento", isso varre TODAS as assinaturas Asaas vinculadas de uma vez.
  // Pula deliberadamente quem tem subscriptionManualOverride=true (cortesia/liberacao manual) —
  // essas contas nunca tem pagamento real no Asaas, e essa mesma varredura foi o que derrubou por
  // engano o acesso de cortesia do proprio treinador mais cedo hoje quando rodada individualmente.
  async refreshAllPendingStudents() {
    this.assertConfigured();
    const students = await this.prisma.user.findMany({
      where: {
        role: 'student',
        subscriptionManualOverride: false,
        billingSubscription: { externalSubscriptionId: { not: null } },
      },
      select: { id: true, billingSubscription: { select: { id: true, externalSubscriptionId: true } } },
    });

    let changed = 0;
    let failed = 0;
    for (const student of students) {
      if (!student.billingSubscription?.externalSubscriptionId) continue;
      try {
        const before = await this.prisma.user.findUniqueOrThrow({ where: { id: student.id }, select: { subscriptionStatus: true } });
        const result = await this.refreshFromAsaas(student.billingSubscription.id, student.id, student.billingSubscription.externalSubscriptionId);
        if (result.appStatus !== before.subscriptionStatus) changed += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Falha ao sincronizar pagamento do aluno ${student.id}: ${(error as Error).message}`);
      }
    }

    this.logger.log(`Sincronizacao em massa de pagamentos concluida: ${students.length} verificado(s), ${changed} status alterado(s), ${failed} falha(s).`);
    return { checked: students.length, changed, failed };
  }

  private async refreshFromAsaas(billingId: string, userId: string, subscriptionId: string) {
    const [subscription, payments] = await Promise.all([
      this.asaasRequest<AsaasSubscription>(`/subscriptions/${subscriptionId}`),
      this.asaasRequest<AsaasPaymentList>(`/payments?subscription=${subscriptionId}`),
    ]);

    const providerStatus = subscription.status?.toLowerCase() ?? 'unknown';
    const now = new Date();
    const relevantPayments = (payments.data ?? []).filter((payment) => {
      const status = (payment.status ?? '').toLowerCase();
      const isFuturePending = status === 'pending' && payment.dueDate ? new Date(payment.dueDate) > now : false;
      return !isFuturePending;
    });
    const latestPayment = [...relevantPayments].sort((a, b) => (a.dueDate ?? a.dateCreated ?? '').localeCompare(b.dueDate ?? b.dateCreated ?? '')).at(-1);
    const latestPaymentStatus = latestPayment?.status?.toLowerCase();
    const appStatus = providerStatus === 'inactive' || providerStatus === 'deleted'
      ? 'canceled'
      : latestPaymentStatus && ACTIVE_STATUSES.has(latestPaymentStatus)
        ? 'active'
        : latestPaymentStatus && OVERDUE_STATUSES.has(latestPaymentStatus)
          ? 'overdue'
          : 'pending';
    const nextChargeAt = subscription.nextDueDate ? new Date(subscription.nextDueDate + 'T12:00:00.000Z') : null;

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, subscriptionStatus: true, studentCode: true } });
    const wasAlreadyActive = user.subscriptionStatus === 'active';

    await this.prisma.$transaction([
      this.prisma.billingSubscription.update({
        where: { id: billingId },
        data: { providerStatus: latestPaymentStatus ?? providerStatus, nextChargeAt },
      }),
      this.prisma.user.update({
        where: { id: userId },
        // Sempre que este sync realmente roda (seja automatico sem override, seja pedido
        // explicito do treinador), o Asaas volta a ser a fonte da verdade — limpa a trava manual.
        data: { subscriptionStatus: appStatus, subscriptionUpdatedAt: new Date(), subscriptionManualOverride: false },
      }),
    ]);

    if (appStatus === 'active') {
      await this.createWelcomeNotificationOnce(userId);
      if (!wasAlreadyActive) {
        this.triggerFirstWeekGeneration(userId);
        await this.telegram.notifyCoach(`Pagamento recebido no Panzeri Run!\n\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nE-mail: ${user.email}\nValor: R$ 19,90 via Asaas`);
        await this.messaging.sendEmail(userId, {
          trigger: 'payment_confirmed',
          subject: 'Pagamento confirmado - monte sua rotina de treinos!',
          content: `Ola ${user.name},\n\nSeu pagamento foi confirmado! Agora acesse o aplicativo, abra o menu e toque em "Rotina de treinos" para nos contar como sera sua semana. Assim que voce confirmar, ja montamos seu primeiro treino.\n\nPanzeri Run`,
        });
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
    const controller = new AbortController();
    // Sem timeout, uma lentidao do Asaas deixa a requisicao pendurada indefinidamente ate o
    // proxy da hospedagem cortar a conexao por conta propria — o que aparece no celular do
    // aluno como uma falha generica de rede, sem nenhuma mensagem util para diagnosticar.
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(this.baseUrl() + path, {
        ...init,
        headers: { access_token: apiKey ?? '', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadGatewayException('O Asaas demorou para responder. Tente novamente em instantes.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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

export function normalizeCpf(value?: string) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
