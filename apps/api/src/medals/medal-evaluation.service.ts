import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionMetricService } from '../evolution/evolution-metric.service';
import { TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../common/training-history-policy';
import { GAP_RETURN_THRESHOLD_DAYS } from '../context-events/context-event-types';
import { getMedalCategoryCatalog, MedalCategory, MedalDefinition } from './medal-catalog';
import {
  isoDate,
  mondayOf,
  buildCompleteWeekList,
  isWeekClosed,
  isMonthClosed,
  firstTimeStreakReached,
  firstTimeValueReached,
  firstTimeCumulativeReached,
  detectGapEpisodes,
  consecutiveWeeksFromReturn,
} from './medal-evaluation.helpers';

// Sistema de Medalhas (30/09/2026) — MedalEvaluationService NUNCA recalcula matemática que já
// existe: lê `EvolutionMetricService` (volume/aderência) e faz queries mínimas e diretas só pro
// que ainda não tinha um cálculo canônico pronto (distância por sessão, acumulado, streak de
// constância/retomada — ver checagem em SISTEMA_DE_MEDALHAS.md). REGRA CENTRAL preservada: medalha
// de realização usa EXECUTADO; aderência (não avaliada aqui ainda, ver etapa 6) compara
// executado×prescrito pela fórmula canônica.
//
// Gatilhos disparam categorias específicas (ver MEDAL_TRIGGER_CATEGORIES) — nunca um cron novo e
// solto: os pontos de chamada reaproveitam eventos que já existem (upsert de treino, fechamento
// semanal, submit de check-in, conclusão de reavaliação).

export type MedalTrigger = 'workout_completed' | 'week_closed' | 'weekly_checkin_submitted' | 'reassessment_completed';

const MEDAL_TRIGGER_CATEGORIES: Record<MedalTrigger, MedalCategory[]> = {
  workout_completed: ['treinos_concluidos', 'distancia_unica', 'acumulado', 'feedbacks', 'retomada'],
  // Etapa 6 (30/09/2026): 'aderencia' ativada aqui, junto do fechamento semanal — só depois da
  // correção de divergência canônica (extra fora do denominador, ver evolution-metric.service.ts)
  // ter sido validada pelos testes específicos dessa correção.
  week_closed: ['constancia', 'aderencia', 'volume_semanal', 'sustentacao_volume', 'volume_mensal', 'retomada'],
  weekly_checkin_submitted: ['checkins'],
  reassessment_completed: ['reavaliacoes'],
  // 'provas' fica de fora enquanto inativa (ver medal-catalog.ts).
};

interface UnlockCandidate {
  code: string;
  value: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  modality: string | null;
  evidence: Record<string, unknown>;
}

const RUN_MODALITIES = ['corrida', 'esteira'];

@Injectable()
export class MedalEvaluationService {
  private readonly logger = new Logger(MedalEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionMetric: EvolutionMetricService,
  ) {}

  /**
   * Ponto de entrada único. Nunca lança — falha aqui jamais pode derrubar a ação real a que está
   * associada (salvar treino, check-in, reavaliação). Retorna os codes efetivamente desbloqueados
   * NESTA chamada (nunca inclui os que já existiam antes).
   */
  async evaluateForUser(userId: string, trigger: MedalTrigger): Promise<string[]> {
    try {
      const categories = MEDAL_TRIGGER_CATEGORIES[trigger];
      const candidates: UnlockCandidate[] = [];
      for (const category of categories) {
        candidates.push(...(await this.evaluateCategory(userId, category)));
      }
      return await this.persistUnlocks(userId, candidates);
    } catch (error) {
      this.logger.error(`Falha ao avaliar medalhas (trigger=${trigger}) para ${userId}: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  private async evaluateCategory(userId: string, category: MedalCategory): Promise<UnlockCandidate[]> {
    switch (category) {
      case 'constancia': return this.evaluateConstancia(userId);
      case 'aderencia': return this.evaluateAderencia(userId);
      case 'treinos_concluidos': return this.evaluateTreinosConcluidos(userId);
      case 'volume_semanal': return this.evaluateVolumeSemanal(userId);
      case 'sustentacao_volume': return this.evaluateSustentacaoVolume(userId);
      case 'volume_mensal': return this.evaluateVolumeMensal(userId);
      case 'distancia_unica': return this.evaluateDistanciaUnica(userId);
      case 'acumulado': return this.evaluateAcumulado(userId);
      case 'feedbacks': return this.evaluateFeedbacks(userId);
      case 'checkins': return this.evaluateCheckins(userId);
      case 'reavaliacoes': return this.evaluateReavaliacoes(userId);
      case 'retomada': return this.evaluateRetomada(userId);
      // 'aderencia' e 'provas': sem avaliação nesta etapa (ver comentário no topo do arquivo).
      default: return [];
    }
  }

  // -----------------------------------------------------------------------------------------
  // Fontes brutas compartilhadas (uma query cada, reaproveitadas por mais de uma categoria)
  // -----------------------------------------------------------------------------------------

  /** TODA sessão de QUALQUER modalidade efetivamente concluída (done/adjusted) — usado por constância/retomada. */
  private async getAllCompletedSessionDates(userId: string): Promise<Date[]> {
    const rows = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF }, completion: { status: { in: ['done', 'adjusted'] } } },
      select: { scheduledDate: true },
      orderBy: { scheduledDate: 'asc' },
    });
    return rows.map((r) => r.scheduledDate);
  }

  /** Sessões de corrida/esteira concluídas com distância registrada, ordenadas — extra INCLUÍDO (execução real). */
  private async getRunSessionRows(userId: string): Promise<Array<{ scheduledDate: Date; distanceKm: number; sessionId: string; completionId: string }>> {
    const sessions = await this.prisma.trainingSession.findMany({
      where: {
        userId,
        scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF },
        modality: { in: RUN_MODALITIES },
        completion: { status: { in: ['done', 'adjusted'] }, distanceKm: { not: null } },
      },
      orderBy: { scheduledDate: 'asc' },
      select: { id: true, scheduledDate: true, completion: { select: { id: true, distanceKm: true } } },
    });
    return sessions.map((s) => ({ scheduledDate: s.scheduledDate, distanceKm: s.completion!.distanceKm!, sessionId: s.id, completionId: s.completion!.id }));
  }

  /** Km REALIZADO por semana, corrida+esteira somadas (EvolutionMetricService já filtra por modalidade e já exclui extra da ADERÊNCIA mas inclui no volume — ver evolution-metric.service.ts). */
  private async getCombinedRunWeeklyKm(userId: string): Promise<Map<string, number>> {
    const [corrida, esteira] = await Promise.all([
      this.evolutionMetric.getSeriesByModality(userId, 'corrida'),
      this.evolutionMetric.getSeriesByModality(userId, 'esteira'),
    ]);
    const combined = new Map<string, number>();
    for (const week of [...corrida.weeks, ...esteira.weeks]) {
      if (week.kmPercorridos == null) continue;
      combined.set(week.weekStart, (combined.get(week.weekStart) ?? 0) + week.kmPercorridos);
    }
    return combined;
  }

  /** Mesma ideia, por mês-calendário. */
  private async getCombinedRunMonthlyKm(userId: string): Promise<Map<string, number>> {
    const [corrida, esteira] = await Promise.all([
      this.evolutionMetric.getSeriesByModality(userId, 'corrida'),
      this.evolutionMetric.getSeriesByModality(userId, 'esteira'),
    ]);
    const combined = new Map<string, number>();
    for (const month of [...corrida.months, ...esteira.months]) {
      if (month.kmPercorridos == null) continue;
      combined.set(month.month, (combined.get(month.month) ?? 0) + month.kmPercorridos);
    }
    return combined;
  }

  // -----------------------------------------------------------------------------------------
  // 1. Constância — semana válida = ≥1 sessão EFETIVAMENTE CONCLUÍDA (qualquer modalidade, extra inclusive)
  // -----------------------------------------------------------------------------------------
  private async evaluateConstancia(userId: string): Promise<UnlockCandidate[]> {
    const dates = await this.getAllCompletedSessionDates(userId);
    if (dates.length === 0) return [];
    const today = new Date();
    const presentWeeks = new Set(dates.map((d) => isoDate(mondayOf(d))));
    const allWeeks = buildCompleteWeekList(dates[0], today)
      .filter((w) => isWeekClosed(w, today))
      .map(isoDate);
    if (allWeeks.length === 0) return [];

    const thresholds = getMedalCategoryCatalog('constancia').map((m) => m.threshold!);
    const reached = firstTimeStreakReached(allWeeks, presentWeeks, thresholds);

    return getMedalCategoryCatalog('constancia')
      .filter((m) => reached.has(m.threshold!))
      .map((m) => {
        const endWeek = reached.get(m.threshold!)!;
        return {
          code: m.code,
          value: m.threshold,
          periodStart: null,
          periodEnd: new Date(endWeek + 'T00:00:00.000Z'),
          modality: null,
          evidence: { consecutiveWeeks: m.threshold, endWeek },
        };
      });
  }

  // -----------------------------------------------------------------------------------------
  // 2. Aderência — realizado ÷ elegível (extra fora do denominador, ver correção em
  // evolution-metric.service.ts). Usa `getSeries()` (TODAS as modalidades — aderência é ao PLANO
  // inteiro, não só corrida) e a MESMA `firstTimeStreakReached` de constância/sustentação: streak
  // de semanas fechadas com adherencePercent >= 90. "Semana perfeita" é um caso à parte (não é
  // streak, é uma única semana com 100% E pelo menos 2 sessões prescritas).
  // -----------------------------------------------------------------------------------------
  private async evaluateAderencia(userId: string): Promise<UnlockCandidate[]> {
    const series = await this.evolutionMetric.getSeries(userId);
    const today = new Date();
    const closedWeeks = series.weeks.filter((w) => isWeekClosed(new Date(w.weekStart + 'T00:00:00.000Z'), today));
    if (closedWeeks.length === 0) return [];

    const firstWeek = new Date([...closedWeeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0].weekStart + 'T00:00:00.000Z');
    const allWeeks = buildCompleteWeekList(firstWeek, today).filter((w) => isWeekClosed(w, today)).map(isoDate);
    const byWeek = new Map(closedWeeks.map((w) => [w.weekStart, w]));

    const streakMedals = getMedalCategoryCatalog('aderencia').filter((m) => m.code !== 'aderencia_semana_perfeita');
    const presentWeeks = new Set(allWeeks.filter((w) => (byWeek.get(w)?.adherencePercent ?? -1) >= 90));
    const thresholds = streakMedals.map((m) => m.threshold!);
    const reached = firstTimeStreakReached(allWeeks, presentWeeks, thresholds);

    const candidates: UnlockCandidate[] = streakMedals
      .filter((m) => reached.has(m.threshold!))
      .map((m) => {
        const endWeek = reached.get(m.threshold!)!;
        return {
          code: m.code,
          value: byWeek.get(endWeek)?.adherencePercent ?? null,
          periodStart: null,
          periodEnd: new Date(endWeek + 'T00:00:00.000Z'),
          modality: null,
          evidence: { consecutiveWeeks: m.threshold, endWeek },
        };
      });

    // Semana perfeita: primeira semana (cronológica) com adherencePercent===100 E pelo menos 2
    // sessões prescritas (elegíveis, extra já fora da contagem — ver correção canônica).
    const perfectWeek = [...closedWeeks]
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .find((w) => w.adherencePercent === 100 && w.sessoesPrescritas >= 2);
    if (perfectWeek) {
      candidates.push({
        code: 'aderencia_semana_perfeita',
        value: 100,
        periodStart: null,
        periodEnd: new Date(perfectWeek.weekStart + 'T00:00:00.000Z'),
        modality: null,
        evidence: { weekStart: perfectWeek.weekStart, sessoesPrescritas: perfectWeek.sessoesPrescritas },
      });
    }

    return candidates;
  }

  // -----------------------------------------------------------------------------------------
  // 3. Treinos concluídos — acumulativo, all-time, status done/adjusted (qualquer modalidade)
  // -----------------------------------------------------------------------------------------
  private async evaluateTreinosConcluidos(userId: string): Promise<UnlockCandidate[]> {
    const total = await this.prisma.workoutCompletion.count({
      where: { userId, status: { in: ['done', 'adjusted'] }, session: { scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF } } },
    });
    return getMedalCategoryCatalog('treinos_concluidos')
      .filter((m) => total >= m.threshold!)
      .map((m) => ({ code: m.code, value: total, periodStart: null, periodEnd: null, modality: null, evidence: { totalAtUnlock: total } }));
  }

  // -----------------------------------------------------------------------------------------
  // 4. Volume semanal de corrida — primeira semana ENCERRADA que atingiu cada limiar (km realizado)
  // -----------------------------------------------------------------------------------------
  private async evaluateVolumeSemanal(userId: string): Promise<UnlockCandidate[]> {
    const weeklyKm = await this.getCombinedRunWeeklyKm(userId);
    const today = new Date();
    const points = [...weeklyKm.entries()]
      .filter(([weekStart]) => isWeekClosed(new Date(weekStart + 'T00:00:00.000Z'), today))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, value]) => ({ date: new Date(weekStart + 'T00:00:00.000Z'), value, weekStart }));

    const thresholds = getMedalCategoryCatalog('volume_semanal').map((m) => m.threshold!);
    const reached = firstTimeValueReached(points, thresholds);

    return getMedalCategoryCatalog('volume_semanal')
      .filter((m) => reached.has(m.threshold!))
      .map((m) => {
        const point = reached.get(m.threshold!)!;
        return {
          code: m.code,
          value: point.value,
          periodStart: point.date,
          periodEnd: point.date,
          modality: 'corrida',
          evidence: { weekStart: (point as { weekStart: string }).weekStart },
        };
      });
  }

  // -----------------------------------------------------------------------------------------
  // 5. Sustentação de volume — patamar × nº de semanas CONSECUTIVAS com km realizado ≥ patamar.
  // Uma semana pode contar simultaneamente pra vários patamares (43km conta pra 20/30/40, não 50).
  // -----------------------------------------------------------------------------------------
  private async evaluateSustentacaoVolume(userId: string): Promise<UnlockCandidate[]> {
    const weeklyKm = await this.getCombinedRunWeeklyKm(userId);
    if (weeklyKm.size === 0) return [];
    const today = new Date();
    const closedWeekEntries = [...weeklyKm.entries()].filter(([weekStart]) => isWeekClosed(new Date(weekStart + 'T00:00:00.000Z'), today));
    if (closedWeekEntries.length === 0) return [];

    const firstWeek = new Date(closedWeekEntries.map(([w]) => w).sort()[0] + 'T00:00:00.000Z');
    const allWeeks = buildCompleteWeekList(firstWeek, today).filter((w) => isWeekClosed(w, today)).map(isoDate);
    const kmByWeek = new Map(closedWeekEntries);

    const catalog = getMedalCategoryCatalog('sustentacao_volume');
    const patamares = [...new Set(catalog.map((m) => (m.criteria as { weeklyKmThreshold: number }).weeklyKmThreshold))];

    const candidates: UnlockCandidate[] = [];
    for (const patamar of patamares) {
      const presentWeeks = new Set(allWeeks.filter((w) => (kmByWeek.get(w) ?? 0) >= patamar));
      const medalsForPatamar = catalog.filter((m) => (m.criteria as { weeklyKmThreshold: number }).weeklyKmThreshold === patamar);
      const thresholds = medalsForPatamar.map((m) => m.threshold!);
      const reached = firstTimeStreakReached(allWeeks, presentWeeks, thresholds);
      for (const medal of medalsForPatamar) {
        if (!reached.has(medal.threshold!)) continue;
        const endWeek = reached.get(medal.threshold!)!;
        candidates.push({
          code: medal.code,
          value: medal.threshold,
          periodStart: null,
          periodEnd: new Date(endWeek + 'T00:00:00.000Z'),
          modality: 'corrida',
          evidence: { weeklyKmThreshold: patamar, consecutiveWeeks: medal.threshold, endWeek },
        });
      }
    }
    return candidates;
  }

  // -----------------------------------------------------------------------------------------
  // 6. Volume mensal de corrida — primeiro mês-calendário ENCERRADO que atingiu cada limiar.
  // -----------------------------------------------------------------------------------------
  private async evaluateVolumeMensal(userId: string): Promise<UnlockCandidate[]> {
    const monthlyKm = await this.getCombinedRunMonthlyKm(userId);
    const today = new Date();
    const points = [...monthlyKm.entries()]
      .filter(([month]) => isMonthClosed(month, today))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ date: new Date(`${month}-01T00:00:00.000Z`), value, month }));

    const thresholds = getMedalCategoryCatalog('volume_mensal').map((m) => m.threshold!);
    const reached = firstTimeValueReached(points, thresholds);

    return getMedalCategoryCatalog('volume_mensal')
      .filter((m) => reached.has(m.threshold!))
      .map((m) => {
        const point = reached.get(m.threshold!)!;
        return {
          code: m.code,
          value: point.value,
          periodStart: point.date,
          periodEnd: point.date,
          modality: 'corrida',
          evidence: { month: (point as { month: string }).month },
        };
      });
  }

  // -----------------------------------------------------------------------------------------
  // 7. Distância em uma única corrida — distância EFETIVAMENTE REALIZADA naquela sessão.
  // -----------------------------------------------------------------------------------------
  private async evaluateDistanciaUnica(userId: string): Promise<UnlockCandidate[]> {
    const rows = await this.getRunSessionRows(userId);
    if (rows.length === 0) return [];
    const points = rows.map((r) => ({ date: r.scheduledDate, value: r.distanceKm, row: r }));
    const thresholds = getMedalCategoryCatalog('distancia_unica').map((m) => m.threshold!);
    const reached = firstTimeValueReached(points, thresholds);

    return getMedalCategoryCatalog('distancia_unica')
      .filter((m) => reached.has(m.threshold!))
      .map((m) => {
        const point = reached.get(m.threshold!)!;
        const row = (point as { row: typeof rows[number] }).row;
        return {
          code: m.code,
          value: point.value,
          periodStart: point.date,
          periodEnd: point.date,
          modality: 'corrida',
          evidence: { sessionId: row.sessionId, completionId: row.completionId },
        };
      });
  }

  // -----------------------------------------------------------------------------------------
  // 8. Quilometragem acumulada — soma de tudo que foi efetivamente realizado, all-time.
  // -----------------------------------------------------------------------------------------
  private async evaluateAcumulado(userId: string): Promise<UnlockCandidate[]> {
    const rows = await this.getRunSessionRows(userId);
    if (rows.length === 0) return [];
    const points = rows.map((r) => ({ date: r.scheduledDate, value: r.distanceKm, row: r }));
    const thresholds = getMedalCategoryCatalog('acumulado').map((m) => m.threshold!);
    const reached = firstTimeCumulativeReached(points, thresholds);

    return getMedalCategoryCatalog('acumulado')
      .filter((m) => reached.has(m.threshold!))
      .map((m) => {
        const hit = reached.get(m.threshold!)!;
        const row = (hit.at as { row: typeof rows[number] }).row;
        return {
          code: m.code,
          value: Math.round(hit.cumulative * 10) / 10,
          periodStart: null,
          periodEnd: hit.at.date,
          modality: 'corrida',
          evidence: { reachedAtSessionId: row.sessionId },
        };
      });
  }

  // -----------------------------------------------------------------------------------------
  // 9. Feedbacks pós-treino — premia FORNECER a resposta (qualquer registro de WorkoutCompletion,
  // incluindo "não fiz" com motivo — isso também é informação fornecida, nunca silêncio).
  // -----------------------------------------------------------------------------------------
  private async evaluateFeedbacks(userId: string): Promise<UnlockCandidate[]> {
    const total = await this.prisma.workoutCompletion.count({
      where: { userId, session: { scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF } } },
    });
    return getMedalCategoryCatalog('feedbacks')
      .filter((m) => total >= m.threshold!)
      .map((m) => ({ code: m.code, value: total, periodStart: null, periodEnd: null, modality: null, evidence: { totalAtUnlock: total } }));
  }

  // -----------------------------------------------------------------------------------------
  // 10. Check-ins semanais — não pulados, tratando o sentinel de "pulou" de v1 e v2.
  // -----------------------------------------------------------------------------------------
  private async evaluateCheckins(userId: string): Promise<UnlockCandidate[]> {
    const rows = await this.prisma.weeklyCheckIn.findMany({
      where: { userId },
      select: { checkinVersion: true, checkinSkipped: true, elaborationSatisfaction: true },
    });
    const real = rows.filter((r) =>
      r.checkinVersion === 1 ? r.elaborationSatisfaction != null && r.elaborationSatisfaction !== 0 : !r.checkinSkipped,
    ).length;
    return getMedalCategoryCatalog('checkins')
      .filter((m) => real >= m.threshold!)
      .map((m) => ({ code: m.code, value: real, periodStart: null, periodEnd: null, modality: null, evidence: { totalAtUnlock: real } }));
  }

  // -----------------------------------------------------------------------------------------
  // 11. Reavaliações — só Reassessment.completedAt != null (reabertura zera até reconcluir).
  // -----------------------------------------------------------------------------------------
  private async evaluateReavaliacoes(userId: string): Promise<UnlockCandidate[]> {
    const total = await this.prisma.reassessment.count({ where: { userId, completedAt: { not: null } } });
    return getMedalCategoryCatalog('reavaliacoes')
      .filter((m) => total >= m.threshold!)
      .map((m) => ({ code: m.code, value: total, periodStart: null, periodEnd: null, modality: null, evidence: { totalAtUnlock: total } }));
  }

  // -----------------------------------------------------------------------------------------
  // 13. Retomada — gap ≥14 dias (GAP_RETURN_THRESHOLD_DAYS) seguido de retorno. Leitura pura do
  // histórico de execuções — independente do questionário de retorno de context-events (aquilo é
  // coleta de contexto, isto é gamificação; não precisam concordar em timing).
  // -----------------------------------------------------------------------------------------
  private async evaluateRetomada(userId: string): Promise<UnlockCandidate[]> {
    const dates = await this.getAllCompletedSessionDates(userId);
    if (dates.length < 2) return [];
    const episodes = detectGapEpisodes(dates, GAP_RETURN_THRESHOLD_DAYS);
    if (episodes.length === 0) return [];

    const today = new Date();
    const presentWeeks = new Set(dates.map((d) => isoDate(mondayOf(d))));
    const allWeeks = buildCompleteWeekList(dates[0], today).filter((w) => isWeekClosed(w, today)).map(isoDate);

    let best2 = 0;
    let best4 = 0;
    const firstEpisode = episodes[0];
    for (const episode of episodes) {
      const returnWeek = isoDate(mondayOf(episode.returnDate));
      const streak = consecutiveWeeksFromReturn(returnWeek, allWeeks, presentWeeks, 4);
      if (streak >= 2) best2 = Math.max(best2, streak);
      if (streak >= 4) best4 = Math.max(best4, streak);
    }

    const candidates: UnlockCandidate[] = [
      {
        code: 'retomada_voltei',
        value: firstEpisode.gapDays,
        periodStart: null,
        periodEnd: firstEpisode.returnDate,
        modality: null,
        evidence: { gapDays: firstEpisode.gapDays },
      },
    ];
    if (best2 >= 2) {
      candidates.push({ code: 'retomada_2_semanas', value: 2, periodStart: null, periodEnd: null, modality: null, evidence: { consecutiveWeeksAfterReturn: best2 } });
    }
    if (best4 >= 4) {
      candidates.push({ code: 'retomada_4_semanas', value: 4, periodStart: null, periodEnd: null, modality: null, evidence: { consecutiveWeeksAfterReturn: best4 } });
    }
    return candidates;
  }

  // -----------------------------------------------------------------------------------------
  // Persistência idempotente — nunca duplica (unique userId+achievementId), nunca falha o
  // chamador por causa de uma corrida de concorrência (P2002 é esperado e silencioso aqui).
  // -----------------------------------------------------------------------------------------
  private async persistUnlocks(userId: string, candidates: UnlockCandidate[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const codes = [...new Set(candidates.map((c) => c.code))];
    const achievements = await this.prisma.achievement.findMany({ where: { code: { in: codes }, active: true } });
    const byCode = new Map(achievements.map((a) => [a.code, a]));

    const alreadyUnlocked = await this.prisma.userAchievement.findMany({
      where: { userId, achievementId: { in: achievements.map((a) => a.id) } },
      select: { achievementId: true },
    });
    const unlockedIds = new Set(alreadyUnlocked.map((u) => u.achievementId));

    const newlyUnlocked: string[] = [];
    for (const candidate of candidates) {
      const achievement = byCode.get(candidate.code);
      if (!achievement || unlockedIds.has(achievement.id)) continue;
      try {
        await this.prisma.userAchievement.create({
          data: {
            userId,
            achievementId: achievement.id,
            value: candidate.value,
            periodStart: candidate.periodStart,
            periodEnd: candidate.periodEnd,
            modality: candidate.modality,
            evidence: candidate.evidence as Prisma.InputJsonValue,
            ruleVersionAtUnlock: achievement.ruleVersion,
          },
        });
        unlockedIds.add(achievement.id); // evita segunda tentativa no mesmo lote
        newlyUnlocked.push(candidate.code);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue; // já conquistada em corrida concorrente
        throw error;
      }
    }
    return newlyUnlocked;
  }
}
