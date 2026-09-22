import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingLogEvent, CommercialStateResult, CommercialUserFacts, deriveCommercialState, providerFromRef } from './commercial-state';

// Eventos de jornada de aquisicao/comercial expostos ao Panzeri Intelligence (ALLOWLIST). Ficam de fora,
// de proposito, eventos de entrevista/perguntas/erros — podem carregar dado de saude ou texto livre.
export const LEO_JOURNEY_EVENTS = [
  'landing_view',
  'landing_cta_click',
  'app_opened',
  'signup_form_viewed',
  'signup_started',
  'signup_completed',
  'journey_linked',
  'payment_started',
  'payment_completed',
  // 22/09: fecha o funil pos-pagamento — entrevista, rotina e primeira semana gerada.
  // interview_completed ja existia como FunnelEvent (disparado pelo app desde antes desta fundacao),
  // so' nao estava nesta allowlist — nada mudou em como/quando ele e' gravado.
  'interview_completed',
  'routine_configured',
  'first_plan_generated',
] as const;

// Somente estes campos de origem saem do metadata. fbclid/gclid/_fbp/_fbc/sessionId sao identificadores
// tecnicos de plataformas externas e nao sao necessarios a analise comercial: nunca sao expostos.
const ORIGIN_KEYS = ['source', 'medium', 'campaign', 'content', 'term', 'referrer'] as const;
type Origin = Record<(typeof ORIGIN_KEYS)[number], string | null>;

function originOf(metadata: unknown): Origin {
  const meta = (metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}) as Record<string, unknown>;
  const out = {} as Origin;
  for (const key of ORIGIN_KEYS) {
    const value = meta[key];
    out[key] = typeof value === 'string' && value.trim() ? value.trim() : null;
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

type CommercialContext = { facts: CommercialUserFacts; events: BillingLogEvent[]; firstPaidPaymentId: string | null; name: string };

// Brasil = UTC-3, sem horário de verão. Dia local começa às 03:00 UTC.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function dayBoundaries(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setTime(start.getTime() + BRT_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

// 18/09 (CI-002): mesmo raciocínio de fronteira BRT do dayBoundaries acima, generalizado para um
// intervalo [from, to] opcional. from ausente = sem piso (todo o histórico); to ausente = até agora.
function rangeBoundariesBRT(from?: string, to?: string): { start?: Date; end?: Date } {
  const result: { start?: Date; end?: Date } = {};
  if (from) result.start = dayBoundaries(from).start;
  if (to) result.end = dayBoundaries(to).end;
  return result;
}

@Injectable()
export class LeoService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailySummary(date: string) {
    const { start, end } = dayBoundaries(date);

    const [sessionsResult, visitorsResult, registrations, checkoutsResult, purchases, purchasesByProvider, revenueResult] =
      await Promise.all([
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(DISTINCT "sessionId") AS count
          FROM "FunnelEvent"
          WHERE event = 'app_opened'
            AND "createdAt" >= ${start}
            AND "createdAt" <= ${end}
        `,
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(DISTINCT "userId") AS count
          FROM "FunnelEvent"
          WHERE event = 'app_opened'
            AND "userId" IS NOT NULL
            AND "createdAt" >= ${start}
            AND "createdAt" <= ${end}
        `,
        this.prisma.user.count({
          where: { role: 'student', createdAt: { gte: start, lte: end } },
        }),
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(DISTINCT "sessionId") AS count
          FROM "FunnelEvent"
          WHERE event = 'payment_started'
            AND "createdAt" >= ${start}
            AND "createdAt" <= ${end}
        `,
        this.prisma.billingSubscription.count({
          where: { firstPaidAt: { gte: start, lte: end } },
        }),
        // 18/09 (CI-001): breakdown por provider — "purchases" acima continua contando qualquer
        // provider (inclusive cupom/manual, por design), este groupBy so' detalha asaas/revenuecat
        // especificamente, sem forcar os dois a somarem exatamente o total.
        // 19/09: o provider da PRIMEIRA compra vem do firstPaidPaymentId (imutavel, gravado junto com
        // firstPaidAt e com namespace: 'revenuecat:<transacao>' vs 'pay_...' do Asaas), NAO de
        // BillingSubscription.provider — esse e' sobrescrito por createCheckout/cupom depois da compra.
        // provider so' e' usado como fallback quando firstPaidPaymentId e' nulo (RevenueCat sem id).
        this.prisma.$queryRaw<Array<{ origin: string; count: bigint }>>`
          SELECT CASE
                   WHEN "firstPaidPaymentId" LIKE 'revenuecat:%' THEN 'revenuecat'
                   WHEN "firstPaidPaymentId" IS NOT NULL THEN 'asaas'
                   ELSE "provider"
                 END AS origin,
                 COUNT(*) AS count
          FROM "BillingSubscription"
          WHERE "firstPaidAt" >= ${start} AND "firstPaidAt" <= ${end}
          GROUP BY 1
        `,
        this.prisma.$queryRaw<[{ total: string | null }]>`
          SELECT SUM(value) AS total
          FROM "BillingEvent"
          WHERE event = 'payment_confirmed'
            AND "timestamp" >= ${start}
            AND "timestamp" <= ${end}
        `,
      ]);

    const purchasesAsaas = Number(purchasesByProvider.find((p) => p.origin === 'asaas')?.count ?? 0);
    const purchasesRevenueCat = Number(purchasesByProvider.find((p) => p.origin === 'revenuecat')?.count ?? 0);

    return {
      date,
      // revenue continua refletindo SOMENTE pagamentos confirmados via Asaas (BillingEvent) — o
      // RevenueCat nao fornece aqui um valor financeiro equivalente/confiavel, entao nao inventamos
      // receita pra ele. Ver comentario em billing.service.ts:processRevenueCatWebhook.
      revenue: parseFloat(revenueResult[0]?.total ?? '0') || 0,
      purchases,
      purchasesAsaas,
      purchasesRevenueCat,
      registrations,
      checkouts: Number(checkoutsResult[0]?.count ?? 0),
      sessions: Number(sessionsResult[0]?.count ?? 0),
      uniqueVisitors: Number(visitorsResult[0]?.count ?? 0),
    };
  }

  // 18/09 (CI-002): agregado comercial de atribuição de aquisição — nunca expõe dado individual,
  // saúde, treino ou entrevista, só o agregado de source/medium/campaign de quem se cadastrou no
  // período. Implementado direto aqui (sem depender de CoachService) para não acoplar o LeoModule
  // a um serviço que existe pro propósito diferente do admin/coach.
  async getAttribution(from?: string, to?: string) {
    const { start, end } = rangeBoundariesBRT(from, to);

    const where: { role: string; createdAt?: { gte?: Date; lte?: Date } } = { role: 'student' };
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = start;
      if (end) where.createdAt.lte = end;
    }

    const users = await this.prisma.user.findMany({
      where,
      select: { acquisitionAttribution: true },
    });

    const totalStudents = users.length;
    let withAttribution = 0;
    let withoutAttribution = 0;
    const bucket = new Map<string, { source: string | null; medium: string | null; campaign: string | null; registrations: number }>();

    for (const u of users) {
      const attr = u.acquisitionAttribution as Record<string, string | null | undefined> | null;
      // 19/09: "com atribuicao" = existe pelo menos um SINAL de origem (source/medium/campaign/content/
      // term/referrer/fbclid/gclid). Identificadores tecnicos (sessionId, _fbp, _fbc) NAO sao origem —
      // antes, quem chegava direto mas tinha so' um cookie da Meta contava como "com atribuicao".
      const hasOriginSignal = !!attr && ['source', 'medium', 'campaign', 'content', 'term', 'referrer', 'fbclid', 'gclid'].some((k) => !!attr[k]);
      if (!attr || !hasOriginSignal) {
        withoutAttribution += 1;
        continue;
      }
      withAttribution += 1;
      const source = attr.source ?? null;
      const medium = attr.medium ?? null;
      const campaign = attr.campaign ?? null;
      const key = JSON.stringify([source, medium, campaign]);
      const entry = bucket.get(key) ?? { source, medium, campaign, registrations: 0 };
      entry.registrations += 1;
      bucket.set(key, entry);
    }

    return {
      from: from ?? null,
      to: to ?? null,
      totalStudents,
      withAttribution,
      withoutAttribution,
      bySource: [...bucket.values()].sort((a, b) => b.registrations - a.registrations),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Fundacao longitudinal (19/09). O Panzeri Run entrega FATOS; nenhuma conclusao/taxa e' calculada aqui.
  // ---------------------------------------------------------------------------------------------

  // Instante em que o historico comercial passou a existir (menor baseline_snapshot). Nulo = migration
  // ainda nao rodou.
  private async logStartedAt(): Promise<Date | null> {
    const agg = await this.prisma.billingEvent.aggregate({ where: { event: 'baseline_snapshot' }, _min: { timestamp: true } });
    return agg._min.timestamp ?? null;
  }

  // Carrega, em lote, tudo o que e' preciso para derivar o estado comercial de um conjunto de pessoas.
  private async loadCommercialContexts(userIds: string[]): Promise<Map<string, CommercialContext>> {
    const contexts = new Map<string, CommercialContext>();
    for (const ids of chunk([...new Set(userIds)], 1000)) {
      const [users, events] = await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            createdAt: true,
            subscriptionStatus: true,
            subscriptionUpdatedAt: true,
            studentCode: true,
            billingSubscription: { select: { firstPaidAt: true, firstPaidPaymentId: true } },
          },
        }),
        this.prisma.billingEvent.findMany({
          where: { userId: { in: ids }, event: { in: ['baseline_snapshot', 'status_changed'] } },
          orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
          select: { userId: true, event: true, prevStatus: true, nextStatus: true, timestamp: true, externalRef: true },
        }),
      ]);
      const eventsByUser = new Map<string, BillingLogEvent[]>();
      for (const e of events) {
        const list = eventsByUser.get(e.userId) ?? [];
        list.push({ event: e.event, at: e.timestamp, prevStatus: e.prevStatus, nextStatus: e.nextStatus, ref: e.externalRef });
        eventsByUser.set(e.userId, list);
      }
      for (const u of users) {
        contexts.set(u.id, {
          facts: {
            createdAt: u.createdAt,
            currentStatus: u.subscriptionStatus,
            statusUpdatedAt: u.subscriptionUpdatedAt,
            firstPaidAt: u.billingSubscription?.firstPaidAt ?? null,
            hasStudentCode: u.studentCode != null,
          },
          events: eventsByUser.get(u.id) ?? [],
          firstPaidPaymentId: u.billingSubscription?.firstPaidPaymentId ?? null,
          name: u.name,
        });
      }
    }
    return contexts;
  }

  // Vinculos deterministicos journeyId <-> userId (eventos 'journey_linked', userId vindo do JWT).
  private async loadJourneyLinks(journeyIds: string[]): Promise<Map<string, string[]>> {
    const byJourney = new Map<string, string[]>();
    for (const ids of chunk([...new Set(journeyIds)], 1000)) {
      const links = await this.prisma.funnelEvent.findMany({
        where: { event: 'journey_linked', journeyId: { in: ids }, userId: { not: null } },
        select: { journeyId: true, userId: true },
      });
      for (const l of links) {
        if (!l.journeyId || !l.userId) continue;
        const list = byJourney.get(l.journeyId) ?? [];
        if (!list.includes(l.userId)) list.push(l.userId);
        byJourney.set(l.journeyId, list);
      }
    }
    return byJourney;
  }

  // Stream cronologico de eventos de jornada (Landing, PWA, cadastro, pagamento iniciado), cada um com
  // a identidade disponivel NAQUELE instante e, quando a pessoa e' identificavel de forma deterministica,
  // o estado comercial dela NAQUELE instante (nunca o de hoje). Nada anonimo e' reescrito.
  async getJourneyEvents(params: { from?: string; to?: string; event?: string; limit?: number; after?: string }) {
    const limit = Math.min(Math.max(params.limit ?? 500, 1), 2000);
    const { start, end } = rangeBoundariesBRT(params.from, params.to);
    const where: Prisma.FunnelEventWhereInput = {
      event: params.event ? params.event : { in: [...LEO_JOURNEY_EVENTS] },
      ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    };
    const rows = await this.prisma.funnelEvent.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(params.after ? { cursor: { id: params.after }, skip: 1 } : {}),
      select: { id: true, createdAt: true, event: true, journeyId: true, sessionId: true, userId: true, metadata: true },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const links = await this.loadJourneyLinks(page.map((r) => r.journeyId).filter((j): j is string => !!j));
    const userIds = new Set<string>();
    for (const r of page) {
      if (r.userId) userIds.add(r.userId);
      for (const u of links.get(r.journeyId ?? '') ?? []) userIds.add(u);
    }
    const [contexts, logStart] = await Promise.all([this.loadCommercialContexts([...userIds]), this.logStartedAt()]);

    const events = page.map((r) => {
      const linkedUserIds = links.get(r.journeyId ?? '') ?? [];
      const people = r.userId ? [r.userId] : linkedUserIds;
      // identity: 'anonymous' = ninguem identificavel; 'identified' = exatamente 1 pessoa; 'ambiguous' =
      // mais de uma pessoa usou este navegador/jornada (nao chutamos qual).
      const identity = people.length === 0 ? 'anonymous' : people.length === 1 ? 'identified' : 'ambiguous';
      let commercial: CommercialStateResult | null = null;
      let personContext: CommercialContext | undefined;
      if (identity === 'identified') {
        personContext = contexts.get(people[0]);
        if (personContext) commercial = deriveCommercialState(personContext.events, personContext.facts, r.createdAt, logStart);
      }
      const meta = (r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? r.metadata : {}) as Record<string, unknown>;
      return {
        id: r.id,
        at: r.createdAt,
        event: r.event,
        journeyId: r.journeyId,
        sessionId: r.sessionId,
        userId: r.userId,
        identity,
        personId: identity === 'identified' ? people[0] : null,
        // 22/09: nome do aluno, pedido explicito confirmado com o treinador — reverte a regra original
        // de "so agregado, sem PII" deste endpoint. So preenchido quando identity==='identified' (nunca
        // um palpite sobre qual pessoa, em jornada ambigua).
        name: personContext?.name ?? null,
        ...originOf(r.metadata),
        // Elo deterministico entre dois navegadores/jornadas (URL da Landing trouxe outra jornada).
        linkedFromJourneyId: typeof meta.linkedFromJourneyId === 'string' ? meta.linkedFromJourneyId : null,
        // journey_linked: 'signup' = jornada que originou a conta; 'login' = jornada usada depois.
        via: r.event === 'journey_linked' && typeof meta.via === 'string' ? meta.via : null,
        commercialState: commercial?.state ?? null,
        subscriptionStatus: commercial?.subscriptionStatus ?? null,
        commercialBasis: commercial?.basis ?? null,
      };
    });

    return {
      from: params.from ?? null,
      to: params.to ?? null,
      count: events.length,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      events,
    };
  }

  // Fatos comerciais: transicoes de status, pagamentos confirmados (valor real, so' Asaas) e primeiras
  // compras (Asaas + RevenueCat, esta sem valor). Cada linha traz o estado comercial DEPOIS do evento.
  async getCommercialEvents(params: { from?: string; to?: string; limit?: number; after?: string; includeBaseline?: boolean }) {
    const limit = Math.min(Math.max(params.limit ?? 500, 1), 2000);
    const { start, end } = rangeBoundariesBRT(params.from, params.to);
    const rangeFilter = start || end ? { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } : undefined;
    const kinds = ['status_changed', 'payment_confirmed', ...(params.includeBaseline ? ['baseline_snapshot'] : [])];

    const rows = await this.prisma.billingEvent.findMany({
      where: { event: { in: kinds }, ...(rangeFilter ? { timestamp: rangeFilter } : {}) },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(params.after ? { cursor: { id: params.after }, skip: 1 } : {}),
      select: { id: true, userId: true, event: true, prevStatus: true, nextStatus: true, value: true, timestamp: true, externalRef: true },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // Primeiras compras do periodo (fonte: BillingSubscription.firstPaidAt).
    const firstPaid = await this.prisma.billingSubscription.findMany({
      where: { firstPaidAt: rangeFilter ? rangeFilter : { not: null } },
      select: { userId: true, firstPaidAt: true, firstPaidPaymentId: true, provider: true },
      orderBy: { firstPaidAt: 'asc' },
    });

    const userIds = [...page.map((r) => r.userId), ...firstPaid.map((f) => f.userId)];
    const [contexts, logStart] = await Promise.all([this.loadCommercialContexts(userIds), this.logStartedAt()]);
    const journeysByUser = new Map<string, string[]>();
    for (const ids of chunk([...new Set(userIds)], 1000)) {
      const links = await this.prisma.funnelEvent.findMany({
        where: { event: 'journey_linked', userId: { in: ids }, journeyId: { not: null } },
        select: { journeyId: true, userId: true },
      });
      for (const l of links) {
        if (!l.journeyId || !l.userId) continue;
        const list = journeysByUser.get(l.userId) ?? [];
        if (!list.includes(l.journeyId)) list.push(l.journeyId);
        journeysByUser.set(l.userId, list);
      }
    }

    const originOfFirstPaid = (f: { firstPaidPaymentId: string | null; provider: string }) =>
      f.firstPaidPaymentId?.startsWith('revenuecat:') ? 'revenuecat' : f.firstPaidPaymentId ? 'asaas' : f.provider;

    return {
      from: params.from ?? null,
      to: params.to ?? null,
      count: page.length,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      events: page.map((r) => {
        const ctx = contexts.get(r.userId);
        return {
          id: r.id,
          at: r.timestamp,
          event: r.event,
          userId: r.userId,
          prevStatus: r.prevStatus,
          nextStatus: r.nextStatus,
          // Valor so' existe em payment_confirmed (Asaas). RevenueCat nao tem valor confiavel: nunca inventado.
          value: r.value != null ? Number(r.value) : null,
          origin: r.event === 'baseline_snapshot' ? 'baseline' : providerFromRef(r.externalRef),
          isFirstPurchase: r.event === 'payment_confirmed' && !!ctx?.firstPaidPaymentId && ctx.firstPaidPaymentId === r.externalRef,
          stateAfter: ctx ? deriveCommercialState(ctx.events, ctx.facts, r.timestamp, logStart) : null,
          journeyIds: journeysByUser.get(r.userId) ?? [],
        };
      }),
      firstPurchases: firstPaid.map((f) => ({
        userId: f.userId,
        at: f.firstPaidAt,
        origin: originOfFirstPaid(f),
        journeyIds: journeysByUser.get(f.userId) ?? [],
      })),
    };
  }

  // Landing: volume e origem das visitas + coorte de jornadas NOVAS (primeira landing_view da jornada cai
  // no periodo) acompanhada ate hoje. Todas as etapas exigem vinculo real por journeyId — nenhuma taxa
  // mistura populacoes diferentes; quem calcula percentuais e' o consumidor, sobre a mesma coorte.
  async getLandingSummary(from?: string, to?: string) {
    const { start, end } = rangeBoundariesBRT(from, to);
    const s = start ?? new Date(0);
    const e = end ?? new Date('2100-01-01T00:00:00.000Z');

    const [totals, bySource, newJourneys] = await Promise.all([
      this.prisma.$queryRaw<Array<{ views: bigint; journeys: bigint; sessions: bigint }>>`
        SELECT COUNT(*) AS views, COUNT(DISTINCT "journeyId") AS journeys, COUNT(DISTINCT "sessionId") AS sessions
        FROM "FunnelEvent"
        WHERE event = 'landing_view' AND "createdAt" >= ${s} AND "createdAt" <= ${e}
      `,
      this.prisma.$queryRaw<Array<{ source: string | null; medium: string | null; campaign: string | null; content: string | null; views: bigint; journeys: bigint }>>`
        SELECT metadata->>'source' AS source, metadata->>'medium' AS medium,
               metadata->>'campaign' AS campaign, metadata->>'content' AS content,
               COUNT(*) AS views, COUNT(DISTINCT "journeyId") AS journeys
        FROM "FunnelEvent"
        WHERE event = 'landing_view' AND "createdAt" >= ${s} AND "createdAt" <= ${e}
        GROUP BY 1, 2, 3, 4
        ORDER BY views DESC
      `,
      this.prisma.$queryRaw<Array<{ journeyId: string; firstAt: Date }>>`
        SELECT "journeyId", MIN("createdAt") AS "firstAt"
        FROM "FunnelEvent"
        WHERE event = 'landing_view' AND "journeyId" IS NOT NULL
        GROUP BY "journeyId"
        HAVING MIN("createdAt") >= ${s} AND MIN("createdAt") <= ${e}
      `,
    ]);

    const firstAtByJourney = new Map(newJourneys.map((j) => [j.journeyId, j.firstAt]));
    const ctaClicked = new Set<string>();
    const appOpened = new Set<string>();
    const signedUp = new Set<string>();
    const linkedUsers = new Map<string, Set<string>>();

    for (const ids of chunk([...firstAtByJourney.keys()], 1000)) {
      const follow = await this.prisma.funnelEvent.findMany({
        where: { journeyId: { in: ids }, event: { in: ['landing_cta_click', 'app_opened', 'signup_completed', 'journey_linked'] } },
        select: { journeyId: true, event: true, createdAt: true, userId: true, metadata: true },
      });
      for (const f of follow) {
        if (!f.journeyId) continue;
        const first = firstAtByJourney.get(f.journeyId);
        if (!first || f.createdAt < first) continue; // so' o que aconteceu NA/DEPOIS da 1a visita da coorte
        if (f.event === 'landing_cta_click') ctaClicked.add(f.journeyId);
        else if (f.event === 'app_opened') appOpened.add(f.journeyId);
        else if (f.event === 'signup_completed') signedUp.add(f.journeyId);
        else if (f.event === 'journey_linked' && f.userId) {
          const meta = (f.metadata && typeof f.metadata === 'object' && !Array.isArray(f.metadata) ? f.metadata : {}) as Record<string, unknown>;
          if (meta.via === 'signup') signedUp.add(f.journeyId);
          const set = linkedUsers.get(f.journeyId) ?? new Set<string>();
          set.add(f.userId);
          linkedUsers.set(f.journeyId, set);
        }
      }
    }

    // Primeira compra: alguma pessoa vinculada a jornada teve firstPaidAt na/depois da 1a visita.
    const firstPurchase = new Set<string>();
    const allLinkedUsers = [...new Set([...linkedUsers.values()].flatMap((set) => [...set]))];
    const paid = new Map<string, Date>();
    for (const ids of chunk(allLinkedUsers, 1000)) {
      const subs = await this.prisma.billingSubscription.findMany({
        where: { userId: { in: ids }, firstPaidAt: { not: null } },
        select: { userId: true, firstPaidAt: true },
      });
      for (const sub of subs) if (sub.firstPaidAt) paid.set(sub.userId, sub.firstPaidAt);
    }
    for (const [journeyId, users] of linkedUsers) {
      const first = firstAtByJourney.get(journeyId);
      if (!first) continue;
      if ([...users].some((u) => { const at = paid.get(u); return !!at && at >= first; })) firstPurchase.add(journeyId);
    }

    return {
      from: from ?? null,
      to: to ?? null,
      views: Number(totals[0]?.views ?? 0),
      journeys: Number(totals[0]?.journeys ?? 0),
      sessions: Number(totals[0]?.sessions ?? 0),
      bySource: bySource.map((r) => ({
        source: r.source, medium: r.medium, campaign: r.campaign, content: r.content,
        views: Number(r.views), journeys: Number(r.journeys),
      })),
      cohort: {
        definition: 'Jornadas cuja PRIMEIRA landing_view (de sempre) ocorreu no periodo, acompanhadas ate agora. Cada etapa conta jornadas distintas, vinculadas por journeyId.',
        newJourneys: firstAtByJourney.size,
        stages: {
          landingViewed: firstAtByJourney.size,
          ctaClicked: ctaClicked.size,
          appOpened: appOpened.size,
          signedUp: signedUp.size,
          firstPurchase: firstPurchase.size,
        },
      },
    };
  }
}
