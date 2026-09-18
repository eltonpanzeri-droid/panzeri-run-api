import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Brasil = UTC-3, sem horário de verão. Dia local começa às 03:00 UTC.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function dayBoundaries(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setTime(start.getTime() + BRT_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

@Injectable()
export class LeoService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailySummary(date: string) {
    const { start, end } = dayBoundaries(date);

    const [sessionsResult, visitorsResult, registrations, checkoutsResult, purchases, revenueResult] =
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
        this.prisma.$queryRaw<[{ total: string | null }]>`
          SELECT SUM(value) AS total
          FROM "BillingEvent"
          WHERE event = 'payment_confirmed'
            AND "timestamp" >= ${start}
            AND "timestamp" <= ${end}
        `,
      ]);

    return {
      date,
      revenue: parseFloat(revenueResult[0]?.total ?? '0') || 0,
      purchases,
      registrations,
      checkouts: Number(checkoutsResult[0]?.count ?? 0),
      sessions: Number(sessionsResult[0]?.count ?? 0),
      uniqueVisitors: Number(visitorsResult[0]?.count ?? 0),
    };
  }
}
