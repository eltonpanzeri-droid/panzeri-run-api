import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { addDays } from './observatory-core';
import { computeObservatory, type ObservatoryResult } from './observatory-engine';
import { buildFactsFromRows, type RawActivity, type RawCompletion } from './observatory-facts';
import { parseObservatoryFilters } from './observatory-filters';
import { buildSyntheticFacts } from './observatory-synthetic';
import type { ObsFacts } from './observatory.types';

// Observatorio Panzeri Run (24/10/2026) — SOMENTE ADMIN. A tela e' SEMPRE visivel (decisao do Elton, 25/10: precisa ver tudo) mas, sem OBSERVATORY_REAL_DATA=true, atende SO' com dados
// sinteticos (estrutura em teste, com faixa de aviso). Dados de saude sao sensiveis: a habilitacao sobre dados reais exige validacao previa de base legal, finalidade, transparencia e contratos dos provedores.
// Somente leitura; resposta so' com agregados protegidos (nunca nome, e-mail ou id de aluna).

const spToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const HIDDEN_PROVIDERS = ['strava'];
const ACTIVITY_SELECT = {
  id: true, userId: true, provider: true, startedAt: true, utcOffsetMinutes: true, durationSec: true, distanceMeters: true, sport: true, providerMetrics: true,
  physicalIdentityStatus: true, physicalEventId: true, physicalCanonicalActivityLogId: true,
} as const;
const shiftDate = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

@Injectable()
export class ObservatoryService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private flag(name: string): boolean {
    return String(this.config.get<string>(name) ?? process.env[name] ?? '').toLowerCase() === 'true';
  }

  status() {
    return { enabled: true, dataset: this.flag('OBSERVATORY_REAL_DATA') ? ('real' as const) : ('synthetic' as const) };
  }

  async analysis(query: Record<string, string | undefined>): Promise<ObservatoryResult> {
    const status = this.status();
    if (!status.enabled) throw new ForbiddenException('Observatório desativado.');
    const today = spToday();
    const filters = parseObservatoryFilters(query, today);
    const facts = status.dataset === 'real' ? await this.loadRealFacts(filters.from, filters.to) : buildSyntheticFacts(today);
    return computeObservatory(facts, filters);
  }

  // Leitura em LOTE (sem consulta por aluna). Janela: do periodo menos 35 dias (exposicao anterior) ate o fim do periodo.
  private async loadRealFacts(from: string, to: string): Promise<ObsFacts> {
    const since = addDays(from, -35);
    const start = new Date(`${since}T00:00:00Z`);
    const end = new Date(`${addDays(to, 1)}T23:59:59Z`);
    const [users, activities, completions, pains] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'student', accountStatus: 'active' }, select: { id: true, birthDate: true, sex: true } }),
      this.prisma.activityLog.findMany({ where: { provider: { notIn: HIDDEN_PROVIDERS }, startedAt: { gte: shiftDate(start, -1), lte: end } }, select: ACTIVITY_SELECT }),
      this.prisma.workoutCompletion.findMany({
        where: { status: { in: ['done', 'adjusted'] }, OR: [{ completedAt: { gte: start, lte: end } }, { session: { scheduledDate: { gte: start, lte: end } } }] },
        select: { id: true, userId: true, sessionId: true, status: true, completedAt: true, distanceKm: true, durationMin: true, painFlag: true, perceivedEffort: true, session: { select: { modality: true, origin: true, structure: true } } },
      }),
      this.prisma.painReport.findMany({ where: { createdAt: { gte: start, lte: end } }, select: { id: true, userId: true, createdAt: true, intensity: true } }),
    ]);
    const sessionIds = [...new Set(completions.map((c) => c.sessionId).filter((id): id is string => Boolean(id)))];
    const links = sessionIds.length > 0
      ? await this.prisma.sessionExecutionLink.findMany({ where: { status: 'active', trainingSessionId: { in: sessionIds } }, orderBy: { createdAt: 'asc' }, select: { trainingSessionId: true, activityLogId: true } })
      : [];
    return buildFactsFromRows(
      { users, activities: activities as RawActivity[], completions: completions as RawCompletion[], links, pains },
      (ids) => this.prisma.activityLog.findMany({ where: { id: { in: ids } }, select: ACTIVITY_SELECT }) as Promise<RawActivity[]>,
      { since, to },
    );
  }
}
