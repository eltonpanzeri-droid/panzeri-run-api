import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { AccountDeletionService } from '../../src/account-deletion/account-deletion.service';
import { SelfAccountDeletionService, SELF_DELETE_PHRASE } from '../../src/account-deletion/self-account-deletion.service';
import { BillingService } from '../../src/billing/billing.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Exclusao de conta pelo aluno em PostgreSQL REAL (dados sinteticos): assinaturas ativa/cancelada/em atraso, isolamento entre alunos e treinador,
// dados importados de saude apagados e webhooks DEPOIS da exclusao sem ressuscitar nada. O Asaas e' simulado (nenhuma chamada externa).

describe('exclusao de conta pelo aluno (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const ledger = { record: jest.fn(async () => 'tombstone-key'), alert: jest.fn(async () => undefined) };
  const telegram = { notifyCoach: jest.fn(async () => undefined) };
  const asaas = { calls: [] as Array<{ path: string; method: string }>, liveBySub: new Map<string, boolean>(), pendingBySub: new Map<string, number>(), notFound: new Set<string>(), failPayments: false, failDelete: false, failGet: false, ambiguousDelete: false, notFoundAfterAmbiguous: false };
  const trainingPlans = { generateFirstWeekIfNeeded: jest.fn(async () => undefined) };
  const notifications = { notifyUserIfNotRecent: jest.fn(async () => undefined), notifyUser: jest.fn(async () => undefined) };
  const messaging = { sendEmail: jest.fn(async () => undefined) };
  const metaCapi = { sendEvent: jest.fn() };
  const config = { get: jest.fn((key: string) => (key === 'ASAAS_WEBHOOK_TOKEN' ? 'tok' : undefined)) };
  const billing = new BillingService(prisma as never, config as never, telegram as never, messaging as never, trainingPlans as never, notifications as never, metaCapi as never, { record: jest.fn() } as never);
  jest.spyOn(billing as never, 'assertConfigured' as never).mockReturnValue(undefined as never);
  jest.spyOn(billing as never, 'asaasRequest' as never).mockImplementation((async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    asaas.calls.push({ path, method });
    // Cobrancas ja emitidas da assinatura (PENDING/OVERDUE), como a listagem do Asaas (totalCount).
    if (path.startsWith('/payments?subscription=')) {
      if (asaas.failPayments) throw new Error('asaas fora do ar');
      const sub = path.split('subscription=')[1].split('&')[0];
      return { data: [], totalCount: path.includes('status=PENDING') ? asaas.pendingBySub.get(sub) ?? 0 : 0 };
    }
    const id = path.split('/subscriptions/')[1];
    if (method === 'GET' && asaas.notFound.has(id)) throw Object.assign(new Error('nao encontrada'), { asaasStatus: 404 });
    if (method === 'DELETE') {
      if (asaas.failDelete) throw new Error('asaas fora do ar');
      // ambiguousDelete: 2xx SEM confirmar e a assinatura continua ativa (nao pode ser tratado como cancelada)
      if (asaas.ambiguousDelete) { if (asaas.notFoundAfterAmbiguous) asaas.notFound.add(id); return {}; }
      asaas.liveBySub.set(id, false);
      asaas.pendingBySub.set(id, 0); // segundo o Asaas, remover a assinatura exclui as cobrancas pendentes/vencidas
      return { deleted: true, id };
    }
    if (asaas.failGet) throw new Error('asaas fora do ar');
    return { id, status: asaas.liveBySub.get(id) ? 'ACTIVE' : 'INACTIVE' };
  }) as never);
  const service = new SelfAccountDeletionService(prisma as never, new AccountDeletionService(prisma as never, ledger as never), billing, telegram as never);
  let seq = 0;

  afterAll(async () => {
    await prisma.billingEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.billingSubscription.deleteMany({ where: { userId: { in: userIds } } });
    await cleanupStudents(prisma, userIds);
    await prisma.$disconnect();
  });
  beforeEach(() => { asaas.calls.length = 0; asaas.failDelete = false; asaas.failGet = false; asaas.failPayments = false; asaas.ambiguousDelete = false; asaas.notFoundAfterAmbiguous = false; asaas.notFound.clear(); ledger.record.mockImplementation(async () => 'tombstone-key'); jest.clearAllMocks(); });

  async function student(label: string, sub: { status: string; live: boolean } | null) {
    seq += 1;
    const s = await seedStudent(prisma, `${label}-${seq}`);
    userIds.push(s.userId);
    await prisma.user.update({ where: { id: s.userId }, data: { passwordHash: await bcrypt.hash('senha-teste', 4), subscriptionStatus: sub?.status ?? 'canceled', studentCode: 9_000_000 + seq, cpf: `000${seq}`.padStart(11, '0'), phone: '31999990000' } });
    let subscriptionId: string | null = null;
    if (sub) {
      subscriptionId = `sub-int-${label}-${seq}-${Math.random().toString(36).slice(2, 7)}`;
      asaas.liveBySub.set(subscriptionId, sub.live);
      await prisma.billingSubscription.create({ data: { userId: s.userId, provider: 'asaas', externalCustomerId: 'cus_x', externalSubscriptionId: subscriptionId, providerStatus: sub.live ? 'active' : 'canceled' } });
      await prisma.billingEvent.create({ data: { userId: s.userId, event: 'payment_confirmed', nextStatus: 'active', value: 24.9, externalRef: `pay-int-${subscriptionId}`, timestamp: new Date() } });
    }
    // dados importados de saude (Apple Saude e Health Connect) + atividade
    for (const provider of ['apple_health', 'health_connect']) {
      const raw = await prisma.rawExternalActivity.create({ data: { userId: s.userId, provider, externalId: `${provider}-${seq}`, payload: { origem: 'sintetico' } } });
      await prisma.activityLog.create({ data: { userId: s.userId, provider, externalId: `${provider}-${seq}`, rawActivityId: raw.id, startedAt: new Date(), sport: 'corrida', durationSec: 1800, distanceMeters: 5000 } as never });
    }
    return { ...s, subscriptionId };
  }
  const rowsOf = async (userId: string) => ({
    plans: await prisma.trainingPlan.count({ where: { userId } }),
    sessions: await prisma.trainingSession.count({ where: { userId } }),
    logs: await prisma.activityLog.count({ where: { userId } }),
    raws: await prisma.rawExternalActivity.count({ where: { userId } }),
    completions: await prisma.workoutCompletion.count({ where: { userId } }),
    reports: await prisma.studentReportEntry.count({ where: { userId } }),
    notifications: await prisma.userNotification.count({ where: { userId } }),
  });
  const body = (extra: Record<string, unknown> = {}) => ({ password: 'senha-teste', confirmText: SELF_DELETE_PHRASE, ...extra });
  const user = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

  it('assinatura ATIVA no Asaas + "cancelar": cancela no Asaas, anonimiza, apaga tudo (incl. Apple Saude/Health Connect) e preserva so o financeiro anonimo', async () => {
    const a = await student('ativa', { status: 'active', live: true });
    expect((await rowsOf(a.userId)).logs).toBe(2);
    await expect(service.deleteOwnAccount(a.userId, body())).rejects.toMatchObject({ response: { code: 'external_charges_choice_required' } });
    expect((await user(a.userId)).accountStatus).toBe('active'); // sem escolha, nada foi feito
    const result = await service.deleteOwnAccount(a.userId, body({ externalCharges: 'cancel' }));
    expect(result).toMatchObject({ status: 'deleted', externalCharges: { channel: 'asaas', action: 'cancelled' } });
    expect(asaas.calls.filter((c) => c.method === 'DELETE')).toEqual([{ path: `/subscriptions/${a.subscriptionId}`, method: 'DELETE' }]);
    expect(ledger.record).toHaveBeenCalledWith({ type: 'account_deleted', userId: a.userId });
    const after = await user(a.userId);
    expect(after).toMatchObject({ accountStatus: 'deleted', name: 'Conta excluida', cpf: null, phone: null, studentCode: null, subscriptionStatus: 'canceled' });
    expect(after.email).toMatch(/@deleted\.invalid$/);
    expect(await rowsOf(a.userId)).toEqual({ plans: 0, sessions: 0, logs: 0, raws: 0, completions: 0, reports: 0, notifications: 0 });
    // financeiro preservado, sem identificacao direta
    expect(await prisma.billingEvent.count({ where: { userId: a.userId, event: 'payment_confirmed' } })).toBe(1);
    // a exclusao tira a conta da lista de assinantes e registra a transicao (sem tocar em nada fora do Panzeri Run)
    expect(await prisma.billingEvent.findFirst({ where: { userId: a.userId, externalRef: 'account:deleted' } })).toBeNull();// ja estava cancelada pelo Asaas: sem transicao extra
    const billingRow = await prisma.billingSubscription.findUniqueOrThrow({ where: { userId: a.userId } });
    expect(billingRow).toMatchObject({ externalSubscriptionId: a.subscriptionId, externalCustomerId: null, checkoutUrl: null });
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('assinatura ATIVA no Asaas + "cancelar" com o Asaas FORA DO AR: 502 e a conta continua intacta', async () => {
    const a = await student('asaas-falha', { status: 'active', live: true });
    asaas.failDelete = true;
    await expect(service.deleteOwnAccount(a.userId, body({ externalCharges: 'cancel' }))).rejects.toMatchObject({ response: { code: 'asaas_cancel_failed' } });
    expect((await user(a.userId)).accountStatus).toBe('active');
    expect((await rowsOf(a.userId)).logs).toBe(2);
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('CONFIRMACAO EFETIVA: o Asaas responde 2xx sem confirmar e a assinatura segue ATIVA => 502, conta intacta, nada tratado como cancelado', async () => {
    const a = await student('ambiguo', { status: 'active', live: true });
    asaas.ambiguousDelete = true;
    await expect(service.deleteOwnAccount(a.userId, body({ externalCharges: 'cancel' }))).rejects.toMatchObject({ response: { code: 'asaas_cancel_failed' } });
    expect((await user(a.userId)).accountStatus).toBe('active');
    expect((await user(a.userId)).subscriptionStatus).toBe('active');
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('Asaas INDISPONIVEL (nem a consulta responde): trata como possivelmente ativa; "cancelar" falha (502, intacta); "seguir" exige aceite e exclui avisando o treinador', async () => {
    const a = await student('asaas-off', { status: 'active', live: true });
    asaas.failGet = true;
    asaas.failDelete = true;
    expect(await service.info(a.userId)).toMatchObject({ requiresChargesChoice: true, subscription: { channel: 'asaas', live: 'unknown' } });
    await expect(service.deleteOwnAccount(a.userId, body())).rejects.toMatchObject({ response: { code: 'external_charges_choice_required' } });
    await expect(service.deleteOwnAccount(a.userId, body({ externalCharges: 'cancel' }))).rejects.toMatchObject({ response: { code: 'asaas_cancel_failed' } });
    expect((await user(a.userId)).accountStatus).toBe('active');
    await expect(service.deleteOwnAccount(a.userId, body({ externalCharges: 'keep' }))).rejects.toMatchObject({ response: { code: 'charges_acknowledgement_required' } });
    expect((await user(a.userId)).accountStatus).toBe('active');
    await service.deleteOwnAccount(a.userId, body({ externalCharges: 'keep', chargesAcknowledged: true }));
    expect((await user(a.userId)).accountStatus).toBe('deleted');
    expect(telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(String((telegram.notifyCoach.mock.calls[0] as unknown[])[0])).toContain('nao confirmada');
  });

  it('FALHA PARCIAL: cancelou no Asaas, mas o tombstone falhou (R2 fora): conta intacta; na nova tentativa a assinatura ja esta cancelada e nao ha mais escolha', async () => {
    const a = await student('parcial', { status: 'active', live: true });
    ledger.record.mockRejectedValueOnce(new Error('R2 indisponivel'));
    await expect(service.deleteOwnAccount(a.userId, body({ externalCharges: 'cancel' }))).rejects.toThrow();
    expect((await user(a.userId)).accountStatus).toBe('active');
    expect((await rowsOf(a.userId)).logs).toBe(2); // nada apagado
    expect(asaas.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(await service.info(a.userId)).toMatchObject({ requiresChargesChoice: false });
    await service.deleteOwnAccount(a.userId, body());
    expect((await user(a.userId)).accountStatus).toBe('deleted');
    expect(asaas.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1); // nao cancela duas vezes
  });

  it('seguir SEM cancelar exige o aceite especifico: sem ele a conta fica intacta e o treinador nao e avisado', async () => {
    const a = await student('sem-aceite', { status: 'active', live: true });
    await expect(service.deleteOwnAccount(a.userId, body({ externalCharges: 'keep' }))).rejects.toMatchObject({ response: { code: 'charges_acknowledgement_required' } });
    expect((await user(a.userId)).accountStatus).toBe('active');
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('assinatura SUSPENSA (INACTIVE) no Asaas mas com COBRANCA JA EMITIDA pendente: NAO e "sem cobranca" — exige escolha; "cancelar" remove a assinatura e as cobrancas pendentes', async () => {
    const a = await student('suspensa', { status: 'canceled', live: false });
    asaas.pendingBySub.set(a.subscriptionId as string, 1);
    expect(await service.info(a.userId)).toMatchObject({ requiresChargesChoice: true, subscription: { channel: 'asaas', live: 'no', pendingCharges: 'yes' } });
    await expect(service.deleteOwnAccount(a.userId, body())).rejects.toMatchObject({ response: { code: 'external_charges_choice_required' } });
    await expect(service.deleteOwnAccount(a.userId, body({ externalCharges: 'keep' }))).rejects.toMatchObject({ response: { code: 'charges_acknowledgement_required' } });
    expect((await user(a.userId)).accountStatus).toBe('active');
    const result = await service.deleteOwnAccount(a.userId, body({ externalCharges: 'cancel' }));
    expect(result.externalCharges).toEqual({ channel: 'asaas', action: 'cancelled' });
    expect(asaas.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(asaas.pendingBySub.get(a.subscriptionId as string)).toBe(0);
  });

  it('cobrancas pendentes que NAO conseguimos consultar: tratadas como possivelmente existentes (nunca como "nao ha")', async () => {
    const a = await student('pend-incerta', { status: 'canceled', live: false });
    asaas.failPayments = true;
    expect(await service.info(a.userId)).toMatchObject({ requiresChargesChoice: true, subscription: { live: 'no', pendingCharges: 'unknown' } });
  });

  it('assinatura REMOVIDA no Asaas (404): sem recorrencia e sem cobrancas pendentes — exclui direto, sem escolha', async () => {
    const a = await student('removida', { status: 'canceled', live: false });
    asaas.notFound.add(a.subscriptionId as string);
    expect(await service.info(a.userId)).toMatchObject({ requiresChargesChoice: false, subscription: { live: 'no', pendingCharges: 'no' } });
    await expect(service.deleteOwnAccount(a.userId, body())).resolves.toMatchObject({ status: 'deleted' });
  });

  it('cancelamento confirmado por 404 na reconsulta (Asaas sem corpo "deleted"): aceito como cancelado', async () => {
    const a = await student('confirma-404', { status: 'active', live: true });
    asaas.ambiguousDelete = true; // DELETE 2xx sem "deleted"
    asaas.notFoundAfterAmbiguous = true; // e a reconsulta diz que a assinatura nao existe mais
    const result = await service.deleteOwnAccount(a.userId, body({ externalCharges: 'cancel' }));
    expect(result.externalCharges).toEqual({ channel: 'asaas', action: 'cancelled' });
    expect((await user(a.userId)).accountStatus).toBe('deleted');
  });

  it('assinatura CANCELADA: exclui direto, sem escolha e sem chamar DELETE no Asaas', async () => {
    const a = await student('cancelada', { status: 'canceled', live: false });
    const result = await service.deleteOwnAccount(a.userId, body());
    expect(result).toMatchObject({ status: 'deleted', externalCharges: { action: 'not_applicable' } });
    expect(asaas.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect((await user(a.userId)).accountStatus).toBe('deleted');
  });

  it('EM ATRASO no app mas assinatura ainda ATIVA no Asaas: exige escolha; "seguir sem cancelar" exclui E avisa o treinador, sem cancelar nada', async () => {
    const a = await student('atraso', { status: 'overdue', live: true });
    await expect(service.deleteOwnAccount(a.userId, body())).rejects.toMatchObject({ response: { code: 'external_charges_choice_required' } });
    const result = await service.deleteOwnAccount(a.userId, body({ externalCharges: 'keep', chargesAcknowledged: true }));
    expect(result).toMatchObject({ status: 'deleted', externalCharges: { channel: 'asaas', action: 'kept' } });
    expect(asaas.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(String((telegram.notifyCoach.mock.calls[0] as unknown[])[0])).toContain(a.subscriptionId as string);
    // conta excluida deixa de contar como assinante (estado local) e a transicao fica registrada; a cobranca externa NAO foi tocada
    expect((await user(a.userId)).subscriptionStatus).toBe('canceled');
    expect(await prisma.billingEvent.findFirst({ where: { userId: a.userId, externalRef: 'account:deleted', prevStatus: 'overdue', nextStatus: 'canceled' } })).not.toBeNull();
  });

  it('senha errada: 403, nada excluido e nenhum tombstone', async () => {
    const a = await student('senha', null);
    await expect(service.deleteOwnAccount(a.userId, body({ password: 'errada' }))).rejects.toMatchObject({ status: 403 });
    expect((await user(a.userId)).accountStatus).toBe('active');
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('ISOLAMENTO: excluir um aluno nao toca em outro aluno nem no treinador (dados, assinatura e dados importados intactos)', async () => {
    const a = await student('isola-a', null);
    const bystander = await student('isola-b', { status: 'active', live: true });
    const coach = await prisma.user.create({ data: { email: `coach-${Date.now()}@sintetico.invalid`, passwordHash: 'x', name: 'Treinador Sintetico', role: 'admin', accountStatus: 'active', subscriptionStatus: 'manual_active' } });
    userIds.push(coach.id);
    const bystanderBefore = { rows: await rowsOf(bystander.userId), user: await user(bystander.userId), billing: await prisma.billingSubscription.findUnique({ where: { userId: bystander.userId } }) };
    const coachBefore = await user(coach.id);
    await service.deleteOwnAccount(a.userId, body());
    expect(await rowsOf(bystander.userId)).toEqual(bystanderBefore.rows);
    expect(await user(bystander.userId)).toEqual(bystanderBefore.user);
    expect(await prisma.billingSubscription.findUnique({ where: { userId: bystander.userId } })).toEqual(bystanderBefore.billing);
    expect(await user(coach.id)).toEqual(coachBefore);
    expect(asaas.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('WEBHOOKS DEPOIS DA EXCLUSAO: cobranca confirmada nao reativa a conta, nao gera treino/notificacao/e-mail, registra so o financeiro e avisa o treinador uma vez', async () => {
    const a = await student('webhook', { status: 'active', live: true });
    await service.deleteOwnAccount(a.userId, body({ externalCharges: 'keep', chargesAcknowledged: true }));
    jest.clearAllMocks();
    const event = { event: 'PAYMENT_CONFIRMED', payment: { id: `pay-late-${a.subscriptionId}`, subscription: a.subscriptionId, status: 'CONFIRMED', value: 24.9 } };
    await billing.processAsaasWebhook('tok', event as never);
    await billing.processAsaasWebhook('tok', event as never); // reenvio do Asaas
    const after = await user(a.userId);
    expect(after).toMatchObject({ accountStatus: 'deleted', subscriptionStatus: 'canceled', studentCode: null, name: 'Conta excluida' });
    expect(await rowsOf(a.userId)).toEqual({ plans: 0, sessions: 0, logs: 0, raws: 0, completions: 0, reports: 0, notifications: 0 });
    expect(await prisma.billingEvent.count({ where: { userId: a.userId, externalRef: event.payment.id } })).toBe(1);
    expect(trainingPlans.generateFirstWeekIfNeeded).not.toHaveBeenCalled();
    expect(notifications.notifyUser).not.toHaveBeenCalled();
    expect(notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    expect(messaging.sendEmail).not.toHaveBeenCalled();
    expect(metaCapi.sendEvent).not.toHaveBeenCalled();
    expect(telegram.notifyCoach).toHaveBeenCalledTimes(1);
    // evento de atraso e de cancelamento tambem nao mexem na conta excluida
    await billing.processAsaasWebhook('tok', { event: 'PAYMENT_OVERDUE', payment: { id: 'late-2', subscription: a.subscriptionId, status: 'OVERDUE' } } as never);
    expect((await user(a.userId)).subscriptionStatus).toBe('canceled');
  });

  it('o cron diario de pagamentos nao reprocessa conta excluida', async () => {
    const a = await student('cron', { status: 'active', live: true });
    await service.deleteOwnAccount(a.userId, body({ externalCharges: 'keep', chargesAcknowledged: true }));
    const refresh = jest.spyOn(billing as never, 'refreshFromAsaas' as never).mockResolvedValue({ appStatus: 'active' } as never);
    await billing.refreshAllPendingStudents();
    expect(refresh.mock.calls.map((c) => (c as unknown[])[1])).not.toContain(a.userId);
    refresh.mockRestore();
  });
});
