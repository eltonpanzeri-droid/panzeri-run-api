import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdherencePeriod,
  AdherenceSummary,
  ConsistencyStreak,
  EvolutionOverview,
  EvolutionSeries,
  ISODate,
  ModalityBreakdown,
  MonthlyAggregate,
  RawSessionData,
  WeeklyVolume,
} from './evolution.types';

// ---------------------------------------------------------------------------
// Helpers de data (UTC-3 Brasil)
// ---------------------------------------------------------------------------

/** Retorna 'YYYY-MM-DD' de hoje no fuso UTC-3 (Brasil) */
function getTodayBR(): ISODate {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Retorna a segunda-feira da semana de uma data 'YYYY-MM-DD' */
function getWeekStart(dateStr: ISODate): ISODate {
  const d = new Date(dateStr + 'T12:00:00Z'); // meio-dia evita drift de DST
  const day = d.getUTCDay(); // 0=dom, 1=seg, ..., 6=sab
  const diff = day === 0 ? -6 : 1 - day; // ajuste para segunda-feira
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Retorna 'YYYY-MM' de uma data 'YYYY-MM-DD' */
function getMonth(dateStr: ISODate): string {
  return dateStr.slice(0, 7);
}

/** Subtrai N semanas de hoje (BR) e retorna 'YYYY-MM-DD' */
function subtractWeeks(todayBR: ISODate, n: number): ISODate {
  const d = new Date(todayBR + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n * 7);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Helpers de cálculo
// ---------------------------------------------------------------------------

function calcAdherence(feitas: number, naoFeitas: number): number | null {
  const denom = feitas + naoFeitas;
  return denom > 0 ? Math.round((feitas / denom) * 100) : null;
}

function calcCoverage(feitas: number, naoFeitas: number, prescritas: number): number {
  return prescritas > 0 ? Math.round(((feitas + naoFeitas) / prescritas) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Serviço principal
// ---------------------------------------------------------------------------

@Injectable()
export class EvolutionMetricService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Busca de dados brutos
  // -------------------------------------------------------------------------

  private async fetchRawSessions(userId: string): Promise<RawSessionData[]> {
    const sessions = await this.prisma.trainingSession.findMany({
      where: { userId },
      include: { completion: true },
      orderBy: { scheduledDate: 'asc' },
    });

    return sessions.map((s) => ({
      sessionId: s.id,
      scheduledDate: s.scheduledDate.toISOString().slice(0, 10),
      modality: s.modality,
      completionStatus: (s.completion?.status ?? null) as RawSessionData['completionStatus'],
      completionDate: s.completion?.completedAt?.toISOString().slice(0, 10) ?? null,
      perceivedEffort: s.completion?.perceivedEffort ?? null,
      distanceKm: s.completion?.distanceKm ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Classificação de sessão
  // -------------------------------------------------------------------------

  private classifySession(
    s: RawSessionData,
    todayBR: ISODate,
  ): 'feita' | 'nao_feita' | 'sem_registro' | 'futura' {
    if (s.completionStatus === 'done' || s.completionStatus === 'adjusted') return 'feita';
    if (s.completionStatus === 'missed') return 'nao_feita';
    if (s.scheduledDate >= todayBR) return 'futura';
    return 'sem_registro';
  }

  // -------------------------------------------------------------------------
  // Volume semanal
  // -------------------------------------------------------------------------

  private buildWeeklyVolumes(sessions: RawSessionData[], todayBR: ISODate): WeeklyVolume[] {
    const byWeek = new Map<
      ISODate,
      { prescritas: number; feitas: number; naoFeitas: number; semRegistro: number; kmTotal: number; kmCount: number }
    >();

    for (const s of sessions) {
      const ws = getWeekStart(s.scheduledDate);
      if (!byWeek.has(ws)) byWeek.set(ws, { prescritas: 0, feitas: 0, naoFeitas: 0, semRegistro: 0, kmTotal: 0, kmCount: 0 });
      const bucket = byWeek.get(ws)!;
      const status = this.classifySession(s, todayBR);
      bucket.prescritas++;
      if (status === 'feita') {
        bucket.feitas++;
        if (s.distanceKm != null) {
          bucket.kmTotal += s.distanceKm;
          bucket.kmCount++;
        }
      } else if (status === 'nao_feita') bucket.naoFeitas++;
      else if (status === 'sem_registro') bucket.semRegistro++;
      // futuras não entram em nenhum bucket de execução
    }

    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, b]) => {
        const adherencePercent = calcAdherence(b.feitas, b.naoFeitas);
        const coveragePercent = calcCoverage(b.feitas, b.naoFeitas, b.prescritas);
        // arredonda para 1 casa decimal
        const kmPercorridos = b.kmCount > 0 ? Math.round(b.kmTotal * 10) / 10 : null;
        return {
          weekStart,
          sessoesPrescritas: b.prescritas,
          sessoesFeitas: b.feitas,
          sessoesNaoFeitas: b.naoFeitas,
          sessoesSemRegistro: b.semRegistro,
          adherencePercent,
          coveragePercent,
          lowCoverageWarning: coveragePercent < 30,
          kmPercorridos,
        };
      });
  }

  // -------------------------------------------------------------------------
  // Resumo de aderência por período
  // -------------------------------------------------------------------------

  private buildAdherenceSummary(
    sessions: RawSessionData[],
    todayBR: ISODate,
    period: AdherencePeriod,
  ): AdherenceSummary {
    let filtered = sessions.filter((s) => s.scheduledDate < todayBR); // só passado

    if (period === 'last_4_weeks') {
      const cutoff = subtractWeeks(todayBR, 4);
      filtered = filtered.filter((s) => s.scheduledDate >= cutoff);
    } else if (period === 'last_8_weeks') {
      const cutoff = subtractWeeks(todayBR, 8);
      filtered = filtered.filter((s) => s.scheduledDate >= cutoff);
    }

    let feitas = 0;
    let naoFeitas = 0;
    let semRegistro = 0;

    for (const s of filtered) {
      const status = this.classifySession(s, todayBR);
      if (status === 'feita') feitas++;
      else if (status === 'nao_feita') naoFeitas++;
      else semRegistro++; // sem_registro (futura já foi excluída acima)
    }

    const prescritas = filtered.length;
    const adherencePercent = calcAdherence(feitas, naoFeitas);
    const coveragePercent = calcCoverage(feitas, naoFeitas, prescritas);

    return {
      period,
      sessoesPrescritas: prescritas,
      sessoesFeitas: feitas,
      sessoesNaoFeitas: naoFeitas,
      sessoesSemRegistro: semRegistro,
      adherencePercent,
      coveragePercent,
      lowCoverageWarning: coveragePercent < 30,
    };
  }

  // -------------------------------------------------------------------------
  // Streak de consistência
  // -------------------------------------------------------------------------

  private buildConsistencyStreak(
    weeklyVolumes: WeeklyVolume[],
    sessions: RawSessionData[],
    todayBR: ISODate,
  ): ConsistencyStreak {
    // Semanas passadas (com ao menos 1 sessão prescrita e não toda futura)
    const pastWeeks = weeklyVolumes.filter((w) => w.weekStart < todayBR);

    // Streak atual: conta de trás para frente quantas semanas consecutivas têm
    // ao menos 1 feedback (feita ou naoFeita)
    let currentStreakWeeks = 0;
    for (let i = pastWeeks.length - 1; i >= 0; i--) {
      const w = pastWeeks[i];
      if (w.sessoesFeitas + w.sessoesNaoFeitas >= 1) {
        currentStreakWeeks++;
      } else {
        break;
      }
    }

    // Maior streak histórico: sliding window
    let longestStreakWeeks = 0;
    let runningStreak = 0;
    for (const w of pastWeeks) {
      if (w.sessoesFeitas + w.sessoesNaoFeitas >= 1) {
        runningStreak++;
        if (runningStreak > longestStreakWeeks) longestStreakWeeks = runningStreak;
      } else {
        runningStreak = 0;
      }
    }

    // Última sessão com qualquer registro
    const withCompletion = sessions
      .filter((s) => s.completionStatus !== null)
      .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));

    const lastRegisteredDate = withCompletion[0]?.scheduledDate ?? null;

    // Última sessão feita
    const withDone = sessions
      .filter((s) => s.completionStatus === 'done' || s.completionStatus === 'adjusted')
      .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate));

    const lastCompletedDate = withDone[0]?.scheduledDate ?? null;

    return {
      currentStreakWeeks,
      longestStreakWeeks,
      lastRegisteredDate,
      lastCompletedDate,
    };
  }

  // -------------------------------------------------------------------------
  // Distribuição de modalidade
  // -------------------------------------------------------------------------

  private buildModalityBreakdown(
    sessions: RawSessionData[],
    todayBR: ISODate,
  ): ModalityBreakdown[] {
    const byModality = new Map<string, { prescritas: number; feitas: number; naoFeitas: number }>();
    const totalPrescritas = sessions.length;

    for (const s of sessions) {
      if (!byModality.has(s.modality)) {
        byModality.set(s.modality, { prescritas: 0, feitas: 0, naoFeitas: 0 });
      }
      const b = byModality.get(s.modality)!;
      b.prescritas++;
      const status = this.classifySession(s, todayBR);
      if (status === 'feita') b.feitas++;
      else if (status === 'nao_feita') b.naoFeitas++;
    }

    return [...byModality.entries()]
      .sort(([, a], [, b]) => b.prescritas - a.prescritas)
      .map(([modality, b]) => ({
        modality,
        sessoesPrescritas: b.prescritas,
        sessoesFeitas: b.feitas,
        adherencePercent: calcAdherence(b.feitas, b.naoFeitas),
        coveragePercent: calcCoverage(b.feitas, b.naoFeitas, b.prescritas),
        percentOfTotalPrescribed:
          totalPrescritas > 0 ? Math.round((b.prescritas / totalPrescritas) * 100) : 0,
      }));
  }

  // -------------------------------------------------------------------------
  // Agregados mensais
  // -------------------------------------------------------------------------

  private buildMonthlyAggregates(
    sessions: RawSessionData[],
    todayBR: ISODate,
  ): MonthlyAggregate[] {
    const byMonth = new Map<
      string,
      { prescritas: number; feitas: number; naoFeitas: number; semRegistro: number; kmTotal: number; kmCount: number }
    >();

    for (const s of sessions) {
      const month = getMonth(s.scheduledDate);
      if (!byMonth.has(month)) byMonth.set(month, { prescritas: 0, feitas: 0, naoFeitas: 0, semRegistro: 0, kmTotal: 0, kmCount: 0 });
      const bucket = byMonth.get(month)!;
      const status = this.classifySession(s, todayBR);
      bucket.prescritas++;
      if (status === 'feita') {
        bucket.feitas++;
        if (s.distanceKm != null) {
          bucket.kmTotal += s.distanceKm;
          bucket.kmCount++;
        }
      } else if (status === 'nao_feita') bucket.naoFeitas++;
      else if (status === 'sem_registro') bucket.semRegistro++;
    }

    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        sessoesPrescritas: b.prescritas,
        sessoesFeitas: b.feitas,
        sessoesNaoFeitas: b.naoFeitas,
        sessoesSemRegistro: b.semRegistro,
        adherencePercent: calcAdherence(b.feitas, b.naoFeitas),
        coveragePercent: calcCoverage(b.feitas, b.naoFeitas, b.prescritas),
        kmPercorridos: b.kmCount > 0 ? Math.round(b.kmTotal * 10) / 10 : null,
      }));
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  /** Calcula o overview de evolução de um aluno. Endpoint: GET /me/evolution/overview */
  async getOverview(userId: string, recentWeeks = 12): Promise<EvolutionOverview> {
    const todayBR = getTodayBR();
    const sessions = await this.fetchRawSessions(userId);

    const weeklyVolumes = this.buildWeeklyVolumes(sessions, todayBR);

    // Últimas N semanas para o gráfico
    const cutoffDate = subtractWeeks(todayBR, recentWeeks);
    const recentWeekVolumes = weeklyVolumes.filter((w) => w.weekStart >= cutoffDate);

    const totalSemRegistro = sessions.filter(
      (s) => this.classifySession(s, todayBR) === 'sem_registro',
    ).length;

    // Soma total de km: só sessões feitas com distanceKm preenchido
    const totalKmPercorridos = Math.round(
      sessions
        .filter(
          (s) =>
            (s.completionStatus === 'done' || s.completionStatus === 'adjusted') &&
            s.distanceKm != null,
        )
        .reduce((sum, s) => sum + (s.distanceKm ?? 0), 0) * 10,
    ) / 10;

    const dataAvailableSince =
      sessions.length > 0 ? sessions[0].scheduledDate : null;

    const totalWeeksWithPlan = weeklyVolumes.length;

    return {
      dataAvailableSince,
      totalWeeksWithPlan,
      totalSemRegistro,
      totalKmPercorridos,
      adherence: {
        allTime: this.buildAdherenceSummary(sessions, todayBR, 'all_time'),
        last4Weeks: this.buildAdherenceSummary(sessions, todayBR, 'last_4_weeks'),
        last8Weeks: this.buildAdherenceSummary(sessions, todayBR, 'last_8_weeks'),
      },
      consistency: this.buildConsistencyStreak(weeklyVolumes, sessions, todayBR),
      modalityBreakdown: this.buildModalityBreakdown(sessions, todayBR),
      recentWeeks: recentWeekVolumes,
      calculatedAt: new Date().toISOString(),
    };
  }

  /** Calcula a série temporal completa. Endpoint: GET /me/evolution/series */
  async getSeries(userId: string): Promise<EvolutionSeries> {
    const todayBR = getTodayBR();
    const sessions = await this.fetchRawSessions(userId);

    return {
      weeks: this.buildWeeklyVolumes(sessions, todayBR),
      months: this.buildMonthlyAggregates(sessions, todayBR),
      calculatedAt: new Date().toISOString(),
    };
  }
}
