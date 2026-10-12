import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SelfAccountDeletionService, SELF_DELETE_PHRASE } from '../src/account-deletion/self-account-deletion.service';
import { SelfAccountDeletionController } from '../src/account-deletion/self-account-deletion.controller';
import { BillingService } from '../src/billing/billing.service';

// Exclusao de conta pelo proprio aluno: regras (senha, frase, escolha sobre cobranca externa) com servicos simulados.

type Exposure = { channel: 'asaas' | 'store' | 'none'; live: 'yes' | 'no' | 'unknown'; pendingCharges?: 'yes' | 'no' | 'unknown'; asaasSubscriptionId: string | null };

async function build(exposure: Exposure, opts: { role?: string; deleted?: boolean; cancelFails?: boolean } = {}) {
  const passwordHash = await bcrypt.hash('senha-certa', 4);
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: opts.role ?? 'student', accountStatus: opts.deleted ? 'deleted' : 'active', passwordHash, studentCode: 42 }) } };
  const accountDeletion = { deleteAccount: jest.fn().mockResolvedValue({ status: 'deleted', deleted: { activityLog: 3 } }) };
  const billing = {
    getSubscriptionExposure: jest.fn().mockResolvedValue({ pendingCharges: 'no', ...exposure }),
    cancelAsaasSubscriptionForAccountDeletion: jest.fn(opts.cancelFails ? async () => { throw new Error('asaas fora do ar'); } : async () => undefined),
  };
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
  const service = new SelfAccountDeletionService(prisma as never, accountDeletion as never, billing as never, telegram as never);
  return { service, prisma, accountDeletion, billing, telegram };
}
const ok = { password: 'senha-certa', confirmText: SELF_DELETE_PHRASE };
const asaasLive: Exposure = { channel: 'asaas', live: 'yes', asaasSubscriptionId: 'sub_1' };

describe('exclusao de conta pelo aluno — confirmacao', () => {
  it('senha incorreta: 403 (nao 401, para o app nao deslogar) e NADA e excluido', async () => {
    const s = await build({ channel: 'none', live: 'no', asaasSubscriptionId: null });
    await expect(s.service.deleteOwnAccount('u1', { ...ok, password: 'errada' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.service.deleteOwnAccount('u1', { confirmText: SELF_DELETE_PHRASE })).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.accountDeletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('frase errada, minuscula ou vazia: 400 e NADA e excluido', async () => {
    const s = await build({ channel: 'none', live: 'no', asaasSubscriptionId: null });
    for (const confirmText of ['excluir conta', 'EXCLUIR', '', undefined]) {
      await expect(s.service.deleteOwnAccount('u1', { password: 'senha-certa', confirmText })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(s.accountDeletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('so aluno: treinador/admin recebem 400', async () => {
    const s = await build({ channel: 'none', live: 'no', asaasSubscriptionId: null }, { role: 'admin' });
    await expect(s.service.deleteOwnAccount('u1', ok)).rejects.toBeInstanceOf(BadRequestException);
    expect(s.accountDeletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('conta ja excluida: resposta idempotente, sem nova exclusao', async () => {
    const s = await build({ channel: 'none', live: 'no', asaasSubscriptionId: null }, { deleted: true });
    expect(await s.service.deleteOwnAccount('u1', ok)).toMatchObject({ status: 'already_deleted' });
    expect(s.accountDeletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('usa a exclusao existente com o id do TOKEN, a frase fixa e sem a trava de assinatura (o direito de excluir nao depende de cobranca)', async () => {
    const s = await build({ channel: 'none', live: 'no', asaasSubscriptionId: null });
    await s.service.deleteOwnAccount('u1', { ...ok, externalCharges: undefined, userId: 'outro-aluno' } as never);
    expect(s.accountDeletion.deleteAccount).toHaveBeenCalledWith('u1', { confirmUserId: 'u1', confirmText: SELF_DELETE_PHRASE }, { id: 'u1', role: 'student' }, { skipSubscriptionGuard: true });
  });
});

describe('exclusao de conta pelo aluno — assinaturas', () => {
  it('assinatura Asaas ATIVA sem escolha: 409 pedindo a escolha (nao exclui, nao cancela)', async () => {
    const s = await build(asaasLive);
    await expect(s.service.deleteOwnAccount('u1', ok)).rejects.toBeInstanceOf(ConflictException);
    expect(s.billing.cancelAsaasSubscriptionForAccountDeletion).not.toHaveBeenCalled();
    expect(s.accountDeletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('ATIVA + "cancelar": cancela no Asaas ANTES de excluir; nenhum aviso ao treinador (nao ha cobranca orfa)', async () => {
    const s = await build(asaasLive);
    const order: string[] = [];
    s.billing.cancelAsaasSubscriptionForAccountDeletion.mockImplementation(async () => { order.push('cancel'); });
    s.accountDeletion.deleteAccount.mockImplementation(async () => { order.push('delete'); return { status: 'deleted', deleted: {} }; });
    const result = await s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'cancel' });
    expect(order).toEqual(['cancel', 'delete']);
    expect(result.externalCharges).toEqual({ channel: 'asaas', action: 'cancelled' });
    expect(s.telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('ATIVA + "cancelar" mas o Asaas falha: 502, a conta NAO e excluida (aluno tenta de novo ou escolhe seguir sem cancelar)', async () => {
    const s = await build(asaasLive, { cancelFails: true });
    await expect(s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'cancel' })).rejects.toBeInstanceOf(BadGatewayException);
    expect(s.accountDeletion.deleteAccount).not.toHaveBeenCalled();
  });

  it('ATIVA + "seguir sem cancelar": exclui E avisa o treinador (sem nome/e-mail) para nao deixar cobranca orfa; nenhum cancelamento automatico', async () => {
    const s = await build(asaasLive);
    const result = await s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'keep', chargesAcknowledged: true });
    expect(result.externalCharges).toEqual({ channel: 'asaas', action: 'kept' });
    expect(s.billing.cancelAsaasSubscriptionForAccountDeletion).not.toHaveBeenCalled();
    expect(s.accountDeletion.deleteAccount).toHaveBeenCalledTimes(1);
    const message = s.telegram.notifyCoach.mock.calls[0][0] as string;
    expect(message).toContain('42');
    expect(message).toContain('sub_1');
    expect(message).not.toMatch(/@|CPF|Conta excluida/i);
  });

  it('seguir SEM cancelar exige ACEITE ESPECIFICO (alem da escolha): sem ele, 409 e nada e excluido nem avisado', async () => {
    for (const exposure of [asaasLive, { channel: 'store', live: 'yes', asaasSubscriptionId: null } as Exposure, { channel: 'asaas', live: 'unknown', asaasSubscriptionId: 'sub_1' } as Exposure]) {
      const s = await build(exposure);
      await expect(s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'keep' })).rejects.toMatchObject({ response: { code: 'charges_acknowledgement_required' } });
      await expect(s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'keep', chargesAcknowledged: false })).rejects.toBeInstanceOf(ConflictException);
      await expect(s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'keep', chargesAcknowledged: 'true' as never })).rejects.toBeInstanceOf(ConflictException);
      expect(s.accountDeletion.deleteAccount).not.toHaveBeenCalled();
      expect(s.telegram.notifyCoach).not.toHaveBeenCalled();
    }
  });

  it('o aceite NAO e necessario ao escolher cancelar (so ao seguir sem cancelar)', async () => {
    const s = await build(asaasLive);
    await expect(s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'cancel' })).resolves.toMatchObject({ externalCharges: { action: 'cancelled' } });
  });

  it('assinatura Asaas CANCELADA/inativa: exclui direto, sem pedir escolha nem avisar', async () => {
    const s = await build({ channel: 'asaas', live: 'no', asaasSubscriptionId: 'sub_1' });
    const result = await s.service.deleteOwnAccount('u1', ok);
    expect(result.status).toBe('deleted');
    expect(result.externalCharges.action).toBe('not_applicable');
    expect(s.telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('EM ATRASO no app mas ainda ativa no Asaas (live=yes): exige escolha — o status interno nao decide', async () => {
    const s = await build(asaasLive); // o status interno nao entra na decisao: so' a situacao real no Asaas
    await expect(s.service.deleteOwnAccount('u1', ok)).rejects.toBeInstanceOf(ConflictException);
  });

  it('Asaas fora do ar (situacao desconhecida): tratado como possivel cobranca viva, exige escolha; nunca como "sem cobranca"', async () => {
    const s = await build({ channel: 'asaas', live: 'unknown', asaasSubscriptionId: 'sub_1' });
    await expect(s.service.deleteOwnAccount('u1', ok)).rejects.toBeInstanceOf(ConflictException);
    const kept = await s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'keep', chargesAcknowledged: true });
    expect(kept.externalCharges.action).toBe('kept');
    expect(s.telegram.notifyCoach).toHaveBeenCalledTimes(1);
  });

  it('assinatura da LOJA (Google Play): exige ciencia, deixa prosseguir, nunca tenta cancelar e nao alerta (o aluno gere na loja)', async () => {
    const s = await build({ channel: 'store', live: 'yes', asaasSubscriptionId: null });
    await expect(s.service.deleteOwnAccount('u1', ok)).rejects.toBeInstanceOf(ConflictException);
    await expect(s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'cancel' })).rejects.toMatchObject({ response: { code: 'charges_acknowledgement_required' } });
    const result = await s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'cancel', chargesAcknowledged: true });
    expect(result.externalCharges).toEqual({ channel: 'store', action: 'kept' });
    expect(s.billing.cancelAsaasSubscriptionForAccountDeletion).not.toHaveBeenCalled();
    expect(s.telegram.notifyCoach).not.toHaveBeenCalled();
    expect(s.accountDeletion.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('assinatura Asaas NAO ativa (suspensa) mas com COBRANCAS JA EMITIDAS em aberto: exige escolha; "cancelar" remove-as; sem cobrancas em aberto, nao exige', async () => {
    const suspended: Exposure = { channel: 'asaas', live: 'no', pendingCharges: 'yes', asaasSubscriptionId: 'sub_1' };
    const s = await build(suspended);
    await expect(s.service.deleteOwnAccount('u1', ok)).rejects.toMatchObject({ response: { code: 'external_charges_choice_required', subscription: { pendingCharges: 'yes' } } });
    await expect(s.service.deleteOwnAccount('u1', { ...ok, externalCharges: 'cancel' })).resolves.toMatchObject({ externalCharges: { action: 'cancelled' } });
    expect(s.billing.cancelAsaasSubscriptionForAccountDeletion).toHaveBeenCalledTimes(1);
    const none = await build({ channel: 'asaas', live: 'no', pendingCharges: 'no', asaasSubscriptionId: 'sub_1' });
    await expect(none.service.deleteOwnAccount('u1', ok)).resolves.toMatchObject({ status: 'deleted' });
    const unknown = await build({ channel: 'asaas', live: 'no', pendingCharges: 'unknown', asaasSubscriptionId: 'sub_1' });
    await expect(unknown.service.deleteOwnAccount('u1', ok)).rejects.toBeInstanceOf(ConflictException);
  });

  it('info: diz quando ha escolha a fazer', async () => {
    expect(await (await build(asaasLive)).service.info('u1')).toMatchObject({ phrase: SELF_DELETE_PHRASE, requiresChargesChoice: true });
    expect(await (await build({ channel: 'none', live: 'no', asaasSubscriptionId: null })).service.info('u1')).toMatchObject({ requiresChargesChoice: false });
  });
});

describe('endpoint', () => {
  it('exige JWT, tem limite de tentativas e usa SEMPRE o usuario do token (userId no corpo e ignorado)', async () => {
    const guards = Reflect.getMetadata('__guards__', SelfAccountDeletionController) as unknown[];
    expect(guards).toHaveLength(1);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', SelfAccountDeletionController.prototype.delete)).toBe(5);
    const deleteOwnAccount = jest.fn(async () => ({}));
    const controller = new SelfAccountDeletionController({ deleteOwnAccount, info: jest.fn() } as never);
    await controller.delete({ sub: 'user-do-token' } as never, { userId: 'outro', password: 'x', confirmText: SELF_DELETE_PHRASE } as never);
    expect(deleteOwnAccount).toHaveBeenCalledWith('user-do-token', expect.anything());
  });
});

describe('webhooks e rotinas depois da exclusao (BillingService)', () => {
  function billingWith(accountStatus: string) {
    const billingRow = { id: 'b1', userId: 'u1', externalSubscriptionId: 'sub_1' };
    const prisma = {
      billingSubscription: { findUnique: jest.fn().mockResolvedValue(billingRow), update: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ accountStatus }), updateMany: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      billingEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    const config = { get: jest.fn((key: string) => (key === 'ASAAS_WEBHOOK_TOKEN' ? 'tok' : key === 'REVENUECAT_WEBHOOK_SECRET' ? 'rc' : undefined)) };
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const messaging = { sendEmail: jest.fn() };
    const trainingPlans = { generateFirstWeekIfNeeded: jest.fn() };
    const notifications = { notifyUserIfNotRecent: jest.fn(), notifyUser: jest.fn() };
    const metaCapi = { sendEvent: jest.fn() };
    const service = new BillingService(prisma as never, config as never, telegram as never, messaging as never, trainingPlans as never, notifications as never, metaCapi as never, { record: jest.fn() } as never);
    return { service, prisma, telegram, messaging, trainingPlans, notifications, metaCapi };
  }

  it('pagamento Asaas CONFIRMADO para conta excluida: registra so o financeiro, avisa o treinador UMA vez e NAO reativa nada do usuario', async () => {
    const b = billingWith('deleted');
    const event = { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_9', subscription: 'sub_1', status: 'CONFIRMED', value: 24.9 } };
    await b.service.processAsaasWebhook('tok', event as never);
    expect(b.prisma.billingEvent.create).toHaveBeenCalledTimes(1);
    expect(b.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(b.prisma.user.update).not.toHaveBeenCalled();
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
    expect(b.notifications.notifyUser).not.toHaveBeenCalled();
    expect(b.notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    expect(b.trainingPlans.generateFirstWeekIfNeeded).not.toHaveBeenCalled();
    expect(b.messaging.sendEmail).not.toHaveBeenCalled();
    expect(b.metaCapi.sendEvent).not.toHaveBeenCalled();
    expect(b.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(String(b.telegram.notifyCoach.mock.calls[0][0])).toContain('JA EXCLUIDA');
    // mesmo evento reenviado pelo Asaas: ja registrado, sem novo alerta
    b.prisma.billingEvent.findFirst.mockResolvedValue({ id: 'ja' });
    await b.service.processAsaasWebhook('tok', event as never);
    expect(b.telegram.notifyCoach).toHaveBeenCalledTimes(1);
  });

  it('pagamento em ATRASO / cancelamento para conta excluida: nada e notificado nem alterado no usuario', async () => {
    const b = billingWith('deleted');
    for (const name of ['PAYMENT_OVERDUE', 'SUBSCRIPTION_DELETED']) {
      await b.service.processAsaasWebhook('tok', { event: name, payment: { id: 'p', subscription: 'sub_1', status: 'OVERDUE' } } as never);
    }
    expect(b.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(b.notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    expect(b.telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('conta NAO excluida segue o fluxo normal (a protecao nao muda o comportamento dos alunos)', async () => {
    const b = billingWith('active');
    b.prisma.user.findUniqueOrThrow.mockResolvedValue({ name: 'Ana', email: 'a@x.com', subscriptionStatus: 'active', studentCode: 1, acquisitionAttribution: null });
    b.prisma.$transaction.mockResolvedValue([{}, { count: 0 }]);
    jest.spyOn(b.service as never, 'createWelcomeNotificationOnce' as never).mockResolvedValue(undefined as never);
    jest.spyOn(b.service as never, 'assignStudentCodeIfNeeded' as never).mockResolvedValue(undefined as never);
    await b.service.processAsaasWebhook('tok', { event: 'PAYMENT_CONFIRMED', payment: { id: 'p1', subscription: 'sub_1', status: 'CONFIRMED', value: 24.9 } } as never);
    expect(b.prisma.$transaction).toHaveBeenCalled();
  });

  it('RevenueCat para conta excluida: ignorado sem alteracao', async () => {
    const b = billingWith('deleted');
    await b.service.processRevenueCatWebhook('Bearer rc', { event: { type: 'RENEWAL', app_user_id: 'u1', product_id: 'p', transaction_id: 't' } });
    expect(b.prisma.user.update).not.toHaveBeenCalled();
    expect(b.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(b.notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    await b.service.processRevenueCatWebhook('Bearer rc', { event: { type: 'CANCELLATION', app_user_id: 'u1', product_id: 'p' } });
    expect(b.prisma.user.update).not.toHaveBeenCalled();
  });

  it('o cron diario de pagamentos nao verifica contas excluidas', async () => {
    const b = billingWith('active');
    jest.spyOn(b.service as never, 'assertConfigured' as never).mockReturnValue(undefined as never);
    await b.service.refreshAllPendingStudents();
    expect(b.prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ accountStatus: { not: 'deleted' } });
  });
});
