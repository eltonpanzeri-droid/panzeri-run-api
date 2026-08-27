import { BadGatewayException, BadRequestException, forwardRef, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, formatStudentCode } from './telegram.service';
import { MessagingService } from '../messaging/messaging.service';
import { TrainingPlansService } from '../training-plans/training-plans.service';
import { NotificationsService } from '../notifications/notifications.service';

type AsaasCustomer = { id: string };
type AsaasCustomerList = { data: AsaasCustomer[] };
type AsaasSubscription = { id: string; status: string; nextDueDate?: string | null };
type AsaasSubscriptionList = { data: AsaasSubscription[] };
type AsaasPayment = {
  id: string;
  status: string;
  invoiceUrl?: string | null;
  dateCreated?: string;
  dueDate?: string;
  value?: number;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
};
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
// 26/08: assinatura comprada dentro do app nativo (Apple IAP / Google Play Billing), sempre
// R$24,90 pra cobrir a comissao de 15-30% que a loja retem — preco diferente do Asaas (R$19,90)
// de proposito, ver decisao do treinador em PRONTUARIO.md.
const APP_STORE_PLAN_PRICE = 24.9;
// Eventos do RevenueCat que dao acesso (compra inicial, renovacao, religou o auto-renew, trocou
// de produto ainda dentro da mesma assinatura ativa). CANCELLATION nao entra aqui de proposito:
// a aluna desligou o auto-renew mas continua com acesso ate o fim do periodo ja pago — so
// EXPIRATION (quando esse periodo realmente acaba) e que deve cortar o acesso.
const REVENUECAT_ACTIVE_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE']);
const REVENUECAT_OVERDUE_EVENTS = new Set(['BILLING_ISSUE']);
const REVENUECAT_CANCELED_EVENTS = new Set(['EXPIRATION', 'REFUND']);

// Bug real corrigido 27/08: as comparacoes de vencimento abaixo usavam `new Date(payment.dueDate)`
// direto contra `new Date()` — como dueDate vem do Asaas so como "AAAA-MM-DD" (sem hora), o
// JavaScript interpreta isso como meia-noite UTC, que em Brasilia (UTC-3) ja e' 21h do dia
// ANTERIOR. Resultado: uma cobranca com vencimento HOJE virava "vencida"/"pendente critica" a
// partir da noite anterior, derrubando o status da aluna (ex: Duane, vencimento 27/08) pra
// 'pending' e sumindo ela da lista de alunos (que exclui subscriptionStatus='pending', ver
// coach.service.ts). A comparacao certa e' por DIA de calendario em Brasilia, nao por timestamp.
function saoPauloDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

function resolveAppStatusFromRevenueCatEvent(eventType?: string): 'active' | 'overdue' | 'canceled' | null {
  if (!eventType) return null;
  if (REVENUECAT_ACTIVE_EVENTS.has(eventType)) return 'active';
  if (REVENUECAT_OVERDUE_EVENTS.has(eventType)) return 'overdue';
  if (REVENUECAT_CANCELED_EVENTS.has(eventType)) return 'canceled';
  return null;
}
const WELCOME_NOTIFICATION_TYPE = 'subscription_welcome';
const WELCOME_NOTIFICATION_TITLE = 'Bem-vindo ao Panzeri Run';
// 18/08 (Bloco 2 de onboarding): antes essa mensagem mandava direto pra "Rotina de treinos",
// porque a entrevista completa acontecia ANTES do pagamento. Agora a entrevista completa roda
// DEPOIS de pagar — o app ja direciona a aluna pra la sozinho ao abrir (ver rotina de
// redirecionamento em App.tsx), entao a mensagem so precisa confirmar isso, sem pedir pra
// procurar nada no menu.
const WELCOME_NOTIFICATION_MESSAGE = 'Pagamento confirmado! Estou muito feliz em poder conduzir você em sua jornada de treinos. Agora abra o aplicativo — vamos te guiar por uma entrevista completa para montar seu programa personalizado.';
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
    private readonly notifications: NotificationsService,
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

  // Historico de faturas (pedido do treinador 16/08, apos o caso da Eduarda — algo tipo a tela
  // de "Historico de contas" da Cemig: mes, valor, status). Usado tanto pelo proprio aluno
  // quanto pelo treinador no painel — mesma lista, dois lugares. So leitura, nunca cria/altera
  // nada no Asaas.
  async paymentHistory(userId: string) {
    this.assertConfigured();
    const billing = await this.prisma.billingSubscription.findUnique({ where: { userId } });
    if (!billing?.externalSubscriptionId) return { payments: [] };

    const payments = await this.asaasRequest<AsaasPaymentList>(`/payments?subscription=${billing.externalSubscriptionId}`);
    const now = new Date();

    return {
      payments: (payments.data ?? [])
        .map((payment) => {
          const status = (payment.status ?? '').toLowerCase();
          const isOverdue = status === 'overdue' || (status === 'pending' && Boolean(payment.dueDate) && payment.dueDate! < saoPauloDateString(now));
          const statusLabel = ACTIVE_STATUSES.has(status)
            ? 'Pago'
            : isOverdue
              ? 'Vencido'
              : status === 'pending'
                ? 'Pendente'
                : OVERDUE_STATUSES.has(status)
                  ? 'Estornado'
                  : 'Outro';
          return {
            id: payment.id,
            dueDate: payment.dueDate ?? null,
            value: payment.value ?? null,
            paidAt: payment.paymentDate ?? payment.clientPaymentDate ?? null,
            status: statusLabel,
            invoiceUrl: payment.invoiceUrl ?? null,
          };
        })
        .sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? '')),
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

    // BUG REAL CORRIGIDO (16/08 — caso da aluna Eduarda): antes pegava so payments.data?.[0], a
    // "primeira" fatura que o Asaas devolvesse pra essa assinatura, sem checar se era a que
    // realmente precisa ser paga. Pra assinatura nova isso nunca dava problema (so existe uma
    // fatura). Mas pra reativacao de quem ja e assinante ha meses (varias faturas no historico —
    // algumas pagas, uma vencida, uma futura), o link gerado podia apontar pra fatura ERRADA (ja
    // paga, por exemplo), deixando o aluno sem conseguir pagar o que realmente deve. Agora busca
    // explicitamente a fatura pendente/vencida mais proxima (a que realmente precisa de acao),
    // so cai pra "primeira da lista" se por algum motivo nao achar nenhuma pendente.
    const payments = await this.asaasRequest<AsaasPaymentList>(`/payments?subscription=${subscriptionId}`);
    const pendingPayments = (payments.data ?? [])
      .filter((payment) => (payment.status ?? '').toLowerCase() === 'pending' || (payment.status ?? '').toLowerCase() === 'overdue')
      .sort((a, b) => (a.dueDate ?? a.dateCreated ?? '').localeCompare(b.dueDate ?? b.dateCreated ?? ''));
    const relevantPayment = pendingPayments[0] ?? payments.data?.[0] ?? null;
    const checkoutUrl = relevantPayment?.invoiceUrl ?? null;
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

  // 18/08: studentCode agora so e atribuido aqui, na hora em que a pessoa realmente vira aluna de
  // verdade (pagou ou recebeu cortesia manual) — nunca mais no cadastro puro (ver comentario no
  // schema.prisma). Idempotente: se ja tem codigo, nao faz nada. Usa a MESMA sequence do banco que
  // antes era o DEFAULT da coluna, entao continua sem colisao mesmo com dois pagamentos
  // simultaneos (nextval() e atomico).
  async assignStudentCodeIfNeeded(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { studentCode: true } });
    if (user?.studentCode != null) return;
    const rows = await this.prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('"User_studentCode_seq"') AS nextval`;
    const code = Number(rows[0].nextval);
    await this.prisma.user.update({ where: { id: userId }, data: { studentCode: code } });
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
    await this.assignStudentCodeIfNeeded(userId);
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
        await this.assignStudentCodeIfNeeded(billing.userId);
        const updatedUser = await this.prisma.user.findUniqueOrThrow({ where: { id: billing.userId }, select: { studentCode: true } });
        this.triggerFirstWeekGeneration(billing.userId);
        await this.telegram.notifyCoach(`Pagamento recebido no Panzeri Run!\n\nAluno: ${user.name} (Cod. ${formatStudentCode(updatedUser.studentCode)})\nE-mail: ${user.email}\nValor: R$ 19,90 via Asaas`);
        await this.messaging.sendEmail(billing.userId, {
          trigger: 'payment_confirmed',
          subject: 'Pagamento confirmado - monte sua rotina de treinos!',
          content: `Ola ${user.name},\n\nSeu pagamento foi confirmado! Agora abra o aplicativo — vamos te guiar por uma entrevista completa para montar seu programa personalizado.\n\nPanzeri Run`,
        });
      }
    }

    return { received: true };
  }

  // Assinatura comprada dentro do app nativo (Apple IAP / Google Play Billing), 26/08. O
  // RevenueCat cuida da validacao de recibo e da renovacao/cancelamento de verdade nas duas
  // lojas, e so nos avisa aqui quando algo muda — igual ao webhook do Asaas acima, so que pra
  // quem assina pela loja em vez do site. O app_user_id enviado pelo RevenueCat E o nosso userId
  // (o app mobile configura o SDK assim no login, ver App.tsx) — nao existe tabela de mapeamento
  // separada.
  async processRevenueCatWebhook(authHeader: string | undefined, payload: { event?: { type?: string; app_user_id?: string; product_id?: string } }) {
    const expectedSecret = this.config.get<string>('REVENUECAT_WEBHOOK_SECRET');
    const providedSecret = authHeader?.replace(/^Bearer\s+/i, '');
    if (!expectedSecret || providedSecret !== expectedSecret) {
      throw new UnauthorizedException('Token de webhook invalido.');
    }

    const event = payload.event;
    const userId = event?.app_user_id;
    if (!userId) return { received: true };

    const appStatus = resolveAppStatusFromRevenueCatEvent(event?.type);
    if (!appStatus) return { received: true };

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, subscriptionStatus: true, studentCode: true } });
    if (!user) return { received: true };
    const wasAlreadyActive = user.subscriptionStatus === 'active';

    await this.prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: appStatus, subscriptionProvider: 'revenuecat', subscriptionUpdatedAt: new Date() },
    });

    if (appStatus === 'active') {
      await this.createWelcomeNotificationOnce(userId);
      if (!wasAlreadyActive) {
        await this.assignStudentCodeIfNeeded(userId);
        const updatedUser = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { studentCode: true } });
        this.triggerFirstWeekGeneration(userId);
        await this.telegram.notifyCoach(`Pagamento recebido no Panzeri Run (loja)!\n\nAluno: ${user.name} (Cod. ${formatStudentCode(updatedUser.studentCode)})\nE-mail: ${user.email}\nValor: R$ ${APP_STORE_PLAN_PRICE.toFixed(2).replace('.', ',')} via App Store / Google Play`);
        await this.messaging.sendEmail(userId, {
          trigger: 'payment_confirmed',
          subject: 'Pagamento confirmado - monte sua rotina de treinos!',
          content: `Ola ${user.name},\n\nSeu pagamento foi confirmado! Agora abra o aplicativo — vamos te guiar por uma entrevista completa para montar seu programa personalizado.\n\nPanzeri Run`,
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
        // 26/08: quem assinou pela loja (Apple/Google) e controlada pelo webhook do RevenueCat,
        // nunca por essa varredura do Asaas — os dois nunca devem decidir o status da mesma aluna.
        subscriptionProvider: 'asaas',
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
    const todaySP = saoPauloDateString(new Date());
    const relevantPayments = (payments.data ?? []).filter((payment) => {
      const status = (payment.status ?? '').toLowerCase();
      // >= hoje (nao so "> hoje"): vencimento e' HOJE ainda nao conta como atrasado/critico, so
      // a partir de amanha. Ver comentario da saoPauloDateString acima.
      const isFuturePending = status === 'pending' && payment.dueDate ? payment.dueDate >= todaySP : false;
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
        await this.assignStudentCodeIfNeeded(userId);
        const updatedUser = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { studentCode: true } });
        this.triggerFirstWeekGeneration(userId);
        await this.telegram.notifyCoach(`Pagamento recebido no Panzeri Run!\n\nAluno: ${user.name} (Cod. ${formatStudentCode(updatedUser.studentCode)})\nE-mail: ${user.email}\nValor: R$ 19,90 via Asaas`);
        await this.messaging.sendEmail(userId, {
          trigger: 'payment_confirmed',
          subject: 'Pagamento confirmado - monte sua rotina de treinos!',
          content: `Ola ${user.name},\n\nSeu pagamento foi confirmado! Agora abra o aplicativo — vamos te guiar por uma entrevista completa para montar seu programa personalizado.\n\nPanzeri Run`,
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

    await this.notifications.notifyUser(userId, {
      title: WELCOME_NOTIFICATION_TITLE,
      message: WELCOME_NOTIFICATION_MESSAGE,
      type: WELCOME_NOTIFICATION_TYPE,
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
