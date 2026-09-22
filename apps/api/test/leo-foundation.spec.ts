import { LeoService } from '../src/leo/leo.service';

type Dict = Record<string, jest.Mock>;
const d = (iso: string) => new Date(iso);

function service(prisma: Record<string, unknown>) {
  return new LeoService(prisma as never);
}

describe('/leo/daily-summary — contrato preservado + breakdown por provider', () => {
  it('mantem os 7 campos originais e acrescenta purchasesAsaas/purchasesRevenueCat; revenue nao ganha valor de RevenueCat', async () => {
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([{ count: 312n }])                                   // sessions
      .mockResolvedValueOnce([{ count: 289n }])                                   // uniqueVisitors
      .mockResolvedValueOnce([{ count: 8n }])                                     // checkouts (payment_started)
      .mockResolvedValueOnce([{ origin: 'asaas', count: 2n }, { origin: 'revenuecat', count: 1n }])
      .mockResolvedValueOnce([{ total: '39.80' }]);                               // revenue (so' payment_confirmed)
    const prisma = {
      $queryRaw: queryRaw,
      user: { count: jest.fn().mockResolvedValue(27) },
      billingSubscription: { count: jest.fn().mockResolvedValue(3) },
    };
    const r = await service(prisma).getDailySummary('2026-09-17');
    expect(r).toEqual({
      date: '2026-09-17', revenue: 39.8, purchases: 3, purchasesAsaas: 2, purchasesRevenueCat: 1,
      registrations: 27, checkouts: 8, sessions: 312, uniqueVisitors: 289,
    });
  });

  it('purchases vem de BillingSubscription.firstPaidAt — nunca de payment_started (checkouts)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ count: 999n }]).mockResolvedValueOnce([{ count: 0n }]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = { $queryRaw: queryRaw, user: { count: jest.fn().mockResolvedValue(0) }, billingSubscription: { count } };
    const r = await service(prisma).getDailySummary('2026-09-17');
    expect(count).toHaveBeenCalledWith({ where: { firstPaidAt: { gte: expect.any(Date), lte: expect.any(Date) } } });
    expect(r.purchases).toBe(1); // independe do 999 devolvido para os eventos de funil
  });

  it('dia sem dados retorna zeros (200), nao erro', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: null }]),
      user: { count: jest.fn().mockResolvedValue(0) },
      billingSubscription: { count: jest.fn().mockResolvedValue(0) },
    };
    expect(await service(prisma).getDailySummary('2030-01-01')).toMatchObject({ revenue: 0, purchases: 0, purchasesAsaas: 0, purchasesRevenueCat: 0, sessions: 0 });
  });
});

describe('/leo/attribution (CI-002)', () => {
  const users = (attrs: Array<Record<string, unknown> | null>) => ({ user: { findMany: jest.fn().mockResolvedValue(attrs.map((a) => ({ acquisitionAttribution: a }))) } });

  it('withAttribution + withoutAttribution === totalStudents; atribuicao parcial e ausente tratadas explicitamente', async () => {
    const prisma = users([
      { source: 'instagram', medium: 'social', campaign: 'c1' },   // completa
      { source: 'instagram', medium: 'social' },                    // parcial (campaign ausente)
      { source: 'instagram' },                                      // so' source
      { sessionId: 'abc', _fbp: 'fb.1.2.3' },                       // so' identificadores tecnicos = SEM origem
      null,                                                         // sem atribuicao
    ]);
    const r = await service(prisma).getAttribution();
    expect(r.totalStudents).toBe(5);
    expect(r.withAttribution).toBe(3);
    expect(r.withoutAttribution).toBe(2);
    expect(r.withAttribution + r.withoutAttribution).toBe(r.totalStudents);
    expect(r.bySource).toContainEqual({ source: 'instagram', medium: 'social', campaign: null, registrations: 1 });
    expect(r.bySource).toContainEqual({ source: 'instagram', medium: null, campaign: null, registrations: 1 });
    expect(r.bySource.reduce((s, b) => s + b.registrations, 0)).toBe(r.withAttribution);
  });

  it('periodo sem cadastros: zeros e lista vazia', async () => {
    const r = await service(users([])).getAttribution('2030-01-01', '2030-01-31');
    expect(r).toMatchObject({ totalStudents: 0, withAttribution: 0, withoutAttribution: 0, bySource: [] });
  });

  it('fronteiras from/to usam o dia de Brasilia (UTC-3), nao UTC', async () => {
    const prisma = users([]);
    await service(prisma).getAttribution('2026-09-17', '2026-09-17');
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.role).toBe('student');
    expect(where.createdAt.gte).toEqual(d('2026-09-17T03:00:00.000Z'));       // 00:00 BRT
    expect(where.createdAt.lte).toEqual(d('2026-09-18T02:59:59.999Z'));       // 23:59:59.999 BRT
  });

  it('nao expoe identificadores tecnicos nem dado individual', async () => {
    const r = await service(users([{ source: 'x', fbclid: 'SECRET', gclid: 'G', _fbp: 'P', sessionId: 'S' }])).getAttribution();
    expect(JSON.stringify(r)).not.toMatch(/SECRET|fb\.1|"S"|fbclid|gclid|_fbp|sessionId/);
  });
});

describe('/leo/journey-events — identidade, tempo e estado comercial historico', () => {
  const T = (s: string) => d(`${s}T15:00:00.000Z`);
  // Pessoa cadastrada em 20/09, ativou em 25/09. Jornada J1 comecou anonima em 19/09.
  const events = [
    { id: 'e1', createdAt: T('2026-09-19'), event: 'landing_view', journeyId: 'J1', sessionId: 'L1', userId: null, metadata: { source: 'instagram', medium: 'story', campaign: 'c', content: 'x', fbclid: 'SEGREDO', _fbp: 'P' } },
    { id: 'e2', createdAt: T('2026-09-19'), event: 'landing_cta_click', journeyId: 'J1', sessionId: 'L1', userId: null, metadata: { source: 'instagram' } },
    { id: 'e3', createdAt: T('2026-09-20'), event: 'journey_linked', journeyId: 'J1', sessionId: 'P1', userId: 'U1', metadata: { via: 'signup' } },
    { id: 'e4', createdAt: T('2026-09-26'), event: 'app_opened', journeyId: 'J1', sessionId: 'P1', userId: null, metadata: {} }, // anonimo, mas jornada vinculada
    { id: 'e5', createdAt: T('2026-09-19'), event: 'landing_view', journeyId: 'J2', sessionId: 'L2', userId: null, metadata: {} },  // jornada nunca vinculada
  ];
  const prismaFor = () => ({
    funnelEvent: {
      findMany: jest.fn()
        .mockResolvedValueOnce(events)                                             // pagina de eventos
        .mockResolvedValueOnce([{ journeyId: 'J1', userId: 'U1' }]),               // vinculos
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'U1', name: 'Ana Aluna', createdAt: T('2026-09-20'), subscriptionStatus: 'active', subscriptionUpdatedAt: T('2026-09-25'), studentCode: 1, billingSubscription: { firstPaidAt: T('2026-09-25'), firstPaidPaymentId: 'pay_1' } }]) },
    billingEvent: {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'U1', event: 'baseline_snapshot', prevStatus: null, nextStatus: 'pending', timestamp: T('2026-09-19'), externalRef: 'baseline:no_access' },
        { userId: 'U1', event: 'status_changed', prevStatus: 'pending', nextStatus: 'active', timestamp: T('2026-09-25'), externalRef: 'asaas:webhook:PAYMENT_CONFIRMED:pay_1' },
      ]),
      aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: T('2026-09-19') } }),
    },
  });

  it('K — eventos em ordem, cada um com a identidade disponivel NAQUELE instante; anonimo continua anonimo', async () => {
    const r = await service(prismaFor()).getJourneyEvents({});
    const byId = Object.fromEntries(r.events.map((e) => [e.id, e]));
    expect(byId.e1.userId).toBeNull();                 // o evento anonimo NAO foi reescrito com o userId
    expect(byId.e5.identity).toBe('anonymous');        // jornada sem vinculo: ninguem inventado
    expect(byId.e5.commercialState).toBeNull();
  });

  it('I/J/L/N — jornada vinculada: antes do cadastro = prospect; depois de ativar = active (estado NO instante, nao o de hoje)', async () => {
    const r = await service(prismaFor()).getJourneyEvents({});
    const byId = Object.fromEntries(r.events.map((e) => [e.id, e]));
    expect(byId.e1.identity).toBe('identified');
    expect(byId.e1.personId).toBe('U1');
    expect(byId.e1.commercialState).toBe('prospect');        // 19/09: antes de existir a conta
    expect(byId.e1.commercialBasis).toBe('no_account_yet');
    expect(byId.e4.commercialState).toBe('active');          // 26/09: ja assinante
    expect(byId.e4.subscriptionStatus).toBe('active');
  });

  it('privacidade: so' + ' source/medium/campaign/content/term/referrer saem do metadata (fbclid/_fbp nunca)', async () => {
    const r = await service(prismaFor()).getJourneyEvents({});
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/SEGREDO|fbclid|_fbp|"P"/);
    expect(r.events[0]).toMatchObject({ source: 'instagram', medium: 'story', campaign: 'c', content: 'x', term: null, referrer: null });
  });

  // 22/09: pedido explicito e confirmado com o treinador — reverte a regra original de "so agregado,
  // sem PII" so' para o campo name. fbclid/_fbp continuam nunca expostos (teste acima).
  it('name: preenchido quando a pessoa e identificada, null quando anonima/ambigua — nunca um palpite', async () => {
    const r = await service(prismaFor()).getJourneyEvents({});
    const byId = Object.fromEntries(r.events.map((e) => [e.id, e]));
    expect(byId.e1.name).toBe('Ana Aluna');   // identified (U1, via vinculo de jornada)
    expect(byId.e5.name).toBeNull();          // anonymous (jornada J2 nunca vinculada)
  });

  it('O — origem ausente permanece null (nada inventado)', async () => {
    const r = await service(prismaFor()).getJourneyEvents({});
    const e5 = r.events.find((e) => e.id === 'e5')!;
    expect([e5.source, e5.medium, e5.campaign, e5.content]).toEqual([null, null, null, null]);
  });

  it('paginacao por cursor: limit+1 sinaliza nextCursor', async () => {
    const prisma = prismaFor();
    prisma.funnelEvent.findMany.mockReset()
      .mockResolvedValueOnce(events.slice(0, 3)) // limit 2 -> pediu 3
      .mockResolvedValueOnce([]);
    prisma.user.findMany.mockResolvedValue([]);
    const r = await service(prisma).getJourneyEvents({ limit: 2 });
    expect(r.count).toBe(2);
    expect(r.nextCursor).toBe('e2');
    expect(prisma.funnelEvent.findMany.mock.calls[0][0].take).toBe(3);
  });
});

describe('/leo/commercial-events — fatos comerciais', () => {
  it('traz valor so no payment_confirmed, origem por evento, estado depois do evento e primeiras compras de Asaas E RevenueCat (esta sem valor)', async () => {
    const T = (s: string) => d(`${s}T15:00:00.000Z`);
    const prisma = {
      billingEvent: {
        findMany: jest.fn()
          .mockResolvedValueOnce([
            { id: 'b1', userId: 'U1', event: 'status_changed', prevStatus: 'pending', nextStatus: 'active', value: null, timestamp: T('2026-09-25'), externalRef: 'asaas:webhook:PAYMENT_CONFIRMED:pay_1' },
            { id: 'b2', userId: 'U1', event: 'payment_confirmed', prevStatus: null, nextStatus: 'active', value: { toString: () => '19.9' }, timestamp: T('2026-09-25'), externalRef: 'pay_1' },
          ])
          .mockResolvedValueOnce([ // contexto (baseline/transicoes) dos usuarios
            { userId: 'U1', event: 'baseline_snapshot', prevStatus: null, nextStatus: 'pending', timestamp: T('2026-09-19'), externalRef: 'baseline:no_access' },
            { userId: 'U1', event: 'status_changed', prevStatus: 'pending', nextStatus: 'active', timestamp: T('2026-09-25'), externalRef: 'x' },
          ]),
        aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: T('2026-09-19') } }),
      },
      billingSubscription: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'U1', firstPaidAt: T('2026-09-25'), firstPaidPaymentId: 'pay_1', provider: 'asaas' },
          { userId: 'U2', firstPaidAt: T('2026-09-26'), firstPaidPaymentId: 'revenuecat:tx9', provider: 'asaas' }, // provider foi sobrescrito depois
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'U1', createdAt: T('2026-09-19'), subscriptionStatus: 'active', subscriptionUpdatedAt: T('2026-09-25'), studentCode: 1, billingSubscription: { firstPaidAt: T('2026-09-25'), firstPaidPaymentId: 'pay_1' } },
          { id: 'U2', createdAt: T('2026-09-19'), subscriptionStatus: 'active', subscriptionUpdatedAt: T('2026-09-26'), studentCode: 2, billingSubscription: { firstPaidAt: T('2026-09-26'), firstPaidPaymentId: 'revenuecat:tx9' } },
        ]),
      },
      funnelEvent: { findMany: jest.fn().mockResolvedValue([{ journeyId: 'J1', userId: 'U1' }]) },
    };
    const r = await service(prisma).getCommercialEvents({});
    const pay = r.events.find((e) => e.id === 'b2')!;
    expect(pay.value).toBe(19.9);
    expect(pay.origin).toBe('asaas');
    expect(pay.isFirstPurchase).toBe(true);
    expect(pay.journeyIds).toEqual(['J1']);
    expect(pay.stateAfter?.state).toBe('active');
    expect(r.events.find((e) => e.id === 'b1')!.value).toBeNull();
    // provider sobrescrito para 'asaas' NAO muda a origem da 1a compra: vem do firstPaidPaymentId
    expect(r.firstPurchases).toEqual([
      expect.objectContaining({ userId: 'U1', origin: 'asaas' }),
      expect.objectContaining({ userId: 'U2', origin: 'revenuecat' }),
    ]);
  });
});

describe('/leo/landing-summary — coorte com vinculo real', () => {
  it('conta etapas por jornada distinta da coorte; visita anterior a coorte nao entra; sem taxas calculadas', async () => {
    const T = (s: string) => d(`${s}T15:00:00.000Z`);
    const prisma = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ views: 5n, journeys: 3n, sessions: 4n }])
        .mockResolvedValueOnce([{ source: 'instagram', medium: 'story', campaign: 'c', content: 'x', views: 3n, journeys: 2n }])
        .mockResolvedValueOnce([
          { journeyId: 'J1', firstAt: T('2026-09-19') },
          { journeyId: 'J2', firstAt: T('2026-09-19') },
          { journeyId: 'J3', firstAt: T('2026-09-19') },
        ]),
      funnelEvent: {
        findMany: jest.fn().mockResolvedValue([
          { journeyId: 'J1', event: 'landing_cta_click', createdAt: T('2026-09-19'), userId: null, metadata: {} },
          { journeyId: 'J1', event: 'app_opened', createdAt: T('2026-09-19'), userId: null, metadata: {} },
          { journeyId: 'J1', event: 'journey_linked', createdAt: T('2026-09-20'), userId: 'U1', metadata: { via: 'signup' } },
          { journeyId: 'J2', event: 'landing_cta_click', createdAt: T('2026-09-19'), userId: null, metadata: {} },
          { journeyId: 'J3', event: 'app_opened', createdAt: T('2026-09-10'), userId: null, metadata: {} }, // ANTES da 1a visita da coorte: ignorado
        ]),
      },
      billingSubscription: { findMany: jest.fn().mockResolvedValue([{ userId: 'U1', firstPaidAt: T('2026-09-25') }]) },
    };
    const r = await service(prisma).getLandingSummary('2026-09-19', '2026-09-19');
    expect(r.views).toBe(5);
    expect(r.cohort.stages).toEqual({ landingViewed: 3, ctaClicked: 2, appOpened: 1, signedUp: 1, firstPurchase: 1 });
    expect(JSON.stringify(r)).not.toMatch(/rate|percent|conversion|taxa/i);
  });
});
