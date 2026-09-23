import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingLogEvent, CommercialUserFacts, deriveCommercialState } from '../leo/commercial-state';
import { paymentGroupOf, PaymentGroup } from './subscription-groups.util';

type Ctx = { facts: CommercialUserFacts; events: BillingLogEvent[] };

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function weekKey(d: Date): string {
  // Segunda-feira da semana (UTC), mesmo criterio de coachWeekStart usado no resto do sistema.
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday));
  return monday.toISOString().slice(0, 10);
}

// 23/09: Business Intelligence do painel do treinador (evolucao mensal de alunos/receita, evolucao
// semanal de treino). Reaproveita deliberadamente o MESMO motor deterministico de reconstrucao de
// estado comercial que ja existe em leo/commercial-state.ts (Fundacao Longitudinal, 19/09) — nao foi
// criada uma segunda logica paralela de "estado no passado". A diferenca desta classe pro LeoService
// e' so' de CAMADA/AUDIENCIA: LeoService serve fatos brutos pra Intelligence externa (auth por token
// interno); esta classe serve agregados prontos pro painel operacional do treinador (auth JWT coach).
@Injectable()
export class BusinessIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  private async logStartedAt(): Promise<Date | null> {
    const agg = await this.prisma.billingEvent.aggregate({ where: { event: 'baseline_snapshot' }, _min: { timestamp: true } });
    return agg._min.timestamp ?? null;
  }

  private async loadContexts(): Promise<Map<string, Ctx>> {
    const [users, events] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'student' },
        select: {
          id: true,
          createdAt: true,
          subscriptionStatus: true,
          subscriptionUpdatedAt: true,
          studentCode: true,
          billingSubscription: { select: { firstPaidAt: true } },
        },
      }),
      this.prisma.billingEvent.findMany({
        where: { event: { in: ['baseline_snapshot', 'status_changed'] } },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        select: { userId: true, event: true, prevStatus: true, nextStatus: true, timestamp: true, externalRef: true },
      }),
    ]);
    const byUser = new Map<string, BillingLogEvent[]>();
    for (const e of events) {
      const list = byUser.get(e.userId) ?? [];
      list.push({ event: e.event, at: e.timestamp, prevStatus: e.prevStatus, nextStatus: e.nextStatus, ref: e.externalRef });
      byUser.set(e.userId, list);
    }
    const contexts = new Map<string, Ctx>();
    for (const u of users) {
      contexts.set(u.id, {
        facts: {
          createdAt: u.createdAt,
          currentStatus: u.subscriptionStatus,
          statusUpdatedAt: u.subscriptionUpdatedAt,
          firstPaidAt: u.billingSubscription?.firstPaidAt ?? null,
          hasStudentCode: u.studentCode != null,
        },
        events: byUser.get(u.id) ?? [],
      });
    }
    return contexts;
  }

  // Evolucao mensal: quantos alunos em cada grupo de pagamento no FIM de cada mes + receita recebida
  // naquele mes (soma de BillingEvent.payment_confirmed.value, so' Asaas — RevenueCat nao tem valor
  // confiavel, nunca inventado). Meses anteriores ao inicio do log de eventos (baseline_snapshot) que
  // nao puderem ser resolvidos com seguranca aparecem com coverage 'partial'/'insufficient' em vez de
  // um numero fabricado — "sem dado" precisa continuar significando "sem dado", nao zero.
  async getMonthlyEvolution(months: number) {
    const clampedMonths = Math.min(Math.max(Math.trunc(months) || 12, 1), 24);
    const [contexts, logStart, paymentEvents] = await Promise.all([
      this.loadContexts(),
      this.logStartedAt(),
      this.prisma.billingEvent.findMany({
        where: { event: 'payment_confirmed' },
        select: { timestamp: true, value: true },
      }),
    ]);

    const now = new Date();
    const monthEnds: Date[] = [];
    for (let i = clampedMonths - 1; i >= 0; i--) {
      monthEnds.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59, 999)));
    }

    const revenueByMonth = new Map<string, number>();
    for (const p of paymentEvents) {
      if (p.value == null) continue;
      const key = monthKey(p.timestamp);
      revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + Number(p.value));
    }

    const emptyGroups = (): Record<PaymentGroup, number> => ({
      confirmed: 0, courtesy: 0, overdue: 0, pending: 0, canceled: 0, desconhecido: 0,
    });

    return monthEnds.map((monthEnd) => {
      const key = monthKey(monthEnd);
      const groups = emptyGroups();
      let resolvedCount = 0;
      let totalCount = 0;
      for (const ctx of contexts.values()) {
        if (ctx.facts.createdAt.getTime() > monthEnd.getTime()) continue; // aluno ainda nao existia neste mes
        totalCount += 1;
        const result = deriveCommercialState(ctx.events, ctx.facts, monthEnd, logStart);
        const group = result.basis === 'insufficient_history' ? 'desconhecido' : paymentGroupOf(result.subscriptionStatus);
        groups[group] += 1;
        if (result.basis !== 'insufficient_history') resolvedCount += 1;
      }
      const coverage = totalCount === 0 ? 'empty' : resolvedCount === totalCount ? 'full' : resolvedCount > 0 ? 'partial' : 'insufficient';
      return {
        month: key,
        totalStudentsThatExisted: totalCount,
        coverage,
        groups,
        revenueReceivedCents: Math.round((revenueByMonth.get(key) ?? 0) * 100),
      };
    });
  }

  // Evolucao semanal de treino: prescritos/realizados/ajustados/extras/nao-realizados + aderencia,
  // por semana (segunda a segunda), nas ultimas N semanas.
  //
  // Duas regras reaproveitadas de outra parte ja existente do sistema (evolution-metric.service.ts,
  // evolucao POR ALUNO) em vez de reinventadas aqui:
  //  1. "Extra" nao e' um WorkoutCompletion.status — nao existe essa coluna. E' inferido do JSON
  //     TrainingSession.structure: { source: 'student', type: 'extra' } (sessao que o proprio aluno
  //     criou, fora da prescricao da IA).
  //  2. Sessao de plano ja arquivado SEM completion e' "fantasma de regeneracao" (toda vez que
  //     generateWeek roda de novo, o plano antigo vira archived; sessoes prescritas nele que nunca
  //     foram de fato mostradas/feitas nao devem inflar "prescritos"). So' conta sessao de plano
  //     archived quando ela TEM completion (foi de fato registrada em algum momento).
  // "Nao realizado" so' conta sessao cuja data ja passou — sessao futura nao e' "perdida", ainda nao
  // chegou.
  async getTrainingEvolution(weeks: number) {
    const clampedWeeks = Math.min(Math.max(Math.trunc(weeks) || 12, 1), 26);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - clampedWeeks * 7);
    const now = new Date();

    const rawSessions = await this.prisma.trainingSession.findMany({
      where: { scheduledDate: { gte: since } },
      select: {
        id: true,
        scheduledDate: true,
        structure: true,
        plan: { select: { status: true } },
        completion: { select: { status: true } },
      },
    });
    const sessions = rawSessions.filter((s) => s.plan.status === 'active' || s.completion !== null);

    type Bucket = { prescribed: number; completed: number; adjusted: number; extra: number; missed: number; eligible: number };
    const buckets = new Map<string, Bucket>();
    const bucketFor = (date: Date) => {
      const key = weekKey(date);
      const existing = buckets.get(key);
      if (existing) return existing;
      const fresh: Bucket = { prescribed: 0, completed: 0, adjusted: 0, extra: 0, missed: 0, eligible: 0 };
      buckets.set(key, fresh);
      return fresh;
    };

    for (const session of sessions) {
      const bucket = bucketFor(session.scheduledDate);
      const structureObj = typeof session.structure === 'object' && session.structure !== null ? session.structure as Record<string, unknown> : {};
      const isExtra = structureObj['source'] === 'student' && structureObj['type'] === 'extra';
      if (isExtra) {
        // Sessao extra e' fora da prescricao — nao entra em prescrito/elegivel/nao-realizado.
        if (session.completion) bucket.extra += 1;
        continue;
      }
      bucket.prescribed += 1;
      const isPast = session.scheduledDate.getTime() <= now.getTime();
      if (isPast) bucket.eligible += 1;
      if (session.completion?.status === 'done') bucket.completed += 1;
      else if (session.completion?.status === 'adjusted') { bucket.completed += 1; bucket.adjusted += 1; }
      else if (isPast) bucket.missed += 1;
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([week, bucket]) => ({
        week,
        ...bucket,
        adherencePercent: bucket.eligible > 0 ? Math.round((bucket.completed / bucket.eligible) * 100) : null,
      }));
  }
}
