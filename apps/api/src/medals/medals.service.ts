import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionMetricService } from '../evolution/evolution-metric.service';
import { MedalEvaluationService } from './medal-evaluation.service';
import { TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../common/training-history-policy';
import { MedalDefinition, getMedalCategoryCatalog } from './medal-catalog';
import { isoDate, mondayOf, buildCompleteWeekList, isWeekClosed } from './medal-evaluation.helpers';
import { isAwardRevoked } from './volume-reconciliation';
import { transitionReasonText, transitionTypeLabel } from './medal-transition-text';
import { PendingView, settlePendingReevaluation, viewOf } from '../activity-execution/pending-reevaluation';

// Sistema de Medalhas (30/09/2026) — lado de LEITURA da API (etapa 5 do plano de implementação).
// Nunca decide se uma medalha foi conquistada (isso é MedalEvaluationService, já persistido em
// UserAchievement) — só apresenta o que já existe + calcula progresso ATUAL (execução real) pra
// quem ainda não foi conquistado, sem nunca escrever nada aqui.

const RUN_MODALITIES = ['corrida', 'esteira'];

export interface UnlockedMedalView {
  code: string;
  category: string;
  name: string;
  description: string;
  grau: string;
  unit: string | null;
  unlockedAt: Date;
  processedAt: Date;
  value: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  modality: string | null;
  // Conquistada agora ('active'); reativada = voltou depois de uma revogacao (reactivatedAt = quando); provisional = categoria em atualizacao depois de uma
  // correcao (nao e' definitiva ate a reavaliacao terminar).
  status: 'active';
  reactivatedAt: Date | null;
  provisional: boolean;
}

export interface RevokedMedalView {
  code: string;
  category: string;
  name: string;
  description: string;
  grau: string;
  unit: string | null;
  unlockedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  reasonText: string;
  // Categoria ainda em atualizacao: o estado pode mudar.
  provisional: boolean;
}

export interface MedalHistoryEntry {
  id: string;
  code: string;
  name: string;
  grau: string;
  type: string;
  typeLabel: string;
  at: Date;
  reason: string | null;
  reasonText: string;
}

export interface NextUpMedalView {
  code: string;
  category: string;
  name: string;
  description: string;
  grau: string;
  threshold: number | null;
  unit: string | null;
  currentValue: number | null;
  /**
   * false quando o limiar está muito acima da prescrição atual do aluno — existe no catálogo, mas
   * não deve ser empurrado como "próximo objetivo" (ver SISTEMA_DE_MEDALHAS.md seção 16: volume
   * muito acima da prescrição não deve estimular aumento de carga). null quando não há prescrição
   * ativa pra comparar (nunca filtra nesse caso — sem base de comparação, sem suposição).
   */
  recommendedAsNextGoal: boolean | null;
}

@Injectable()
export class MedalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionMetric: EvolutionMetricService,
    private readonly medalEvaluation: MedalEvaluationService,
  ) {}

  /**
   * Ponto de entrada único pro app. Reavalia categorias de fechamento semanal ANTES de ler (nunca
   * existe cron dedicado pra isso — ver medal-evaluation.service.ts — então abrir a tela de
   * medalhas é o outro ponto natural, além de registrar um treino, pra pegar uma semana que acabou
   * de fechar). Reavaliação é best-effort: se falhar, a leitura ainda acontece normalmente.
   */
  async getSummary(userId: string) {
    // Consistencia: antes de ler, tenta concluir a reavaliacao pendente (correcao de atividade) dentro de um orcamento curto. Se nao terminar, o estado devolvido
    // marca as conquistas das categorias afetadas como provisorias (nunca como definitivas).
    const pendingState = await settlePendingReevaluation(this.prisma, userId);
    const pending = viewOf(pendingState);
    await this.medalEvaluation.evaluateForUser(userId, 'week_closed').catch(() => undefined);
    const [unlocked, revoked, progress] = await Promise.all([this.getUnlocked(userId, pending), this.getRevoked(userId, pending), this.getProgress(userId)]);
    return { unlocked, revoked, progress, pending };
  }

  async getUnlocked(userId: string, pending: PendingView = viewOf(null)): Promise<UnlockedMedalView[]> {
    const rows = await this.prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });
    const active = rows.filter((r) => !isAwardRevoked({ evidence: r.evidence, status: r.status }));
    const reactivations = active.length === 0 ? [] : await this.prisma.userAchievementTransition.findMany({
      where: { userId, type: 'reactivated', userAchievementId: { in: active.map((r) => r.id) } },
      orderBy: { at: 'desc' },
    });
    const reactivatedAt = new Map<string, Date>();
    for (const t of reactivations) if (!reactivatedAt.has(t.userAchievementId)) reactivatedAt.set(t.userAchievementId, t.at);
    const updating = new Set(pending.medalCategories);
    return active.map((r) => ({
      code: r.achievement.code,
      category: r.achievement.category,
      name: r.achievement.name,
      description: r.achievement.description,
      grau: r.achievement.grau,
      unit: r.achievement.unit,
      unlockedAt: this.earnedAt(r.achievement.category, r.periodStart, r.periodEnd) ?? r.unlockedAt,
      processedAt: r.unlockedAt,
      value: r.value,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      modality: r.modality,
      status: 'active' as const,
      reactivatedAt: reactivatedAt.get(r.id) ?? null,
      provisional: updating.has(r.achievement.category),
    })).sort((a, b) => b.unlockedAt.getTime() - a.unlockedAt.getTime());
  }

  /** Conquistas revogadas (o registro nunca e' apagado): com o momento e o motivo da revogacao. */
  async getRevoked(userId: string, pending: PendingView = viewOf(null)): Promise<RevokedMedalView[]> {
    const rows = await this.prisma.userAchievement.findMany({ where: { userId }, include: { achievement: true }, orderBy: { unlockedAt: 'desc' } });
    const revoked = rows.filter((r) => isAwardRevoked({ evidence: r.evidence, status: r.status }));
    const updating = new Set(pending.medalCategories);
    return revoked.map((r) => ({
      code: r.achievement.code,
      category: r.achievement.category,
      name: r.achievement.name,
      description: r.achievement.description,
      grau: r.achievement.grau,
      unit: r.achievement.unit,
      unlockedAt: r.unlockedAt,
      revokedAt: r.revokedAt ?? r.statusChangedAt ?? null,
      revokedReason: r.revokedReason ?? null,
      reasonText: transitionReasonText('revoked', r.revokedReason ?? null),
      provisional: updating.has(r.achievement.category),
    }));
  }

  /** Historico de transicoes (concessao, revogacao, reativacao, ajuste), mais recentes primeiro, com o motivo de cada uma. */
  async getHistory(userId: string, limit = 100): Promise<MedalHistoryEntry[]> {
    const rows = await this.prisma.userAchievementTransition.findMany({
      where: { userId },
      orderBy: { at: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { userAchievement: { include: { achievement: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      code: t.userAchievement.achievement.code,
      name: t.userAchievement.achievement.name,
      grau: t.userAchievement.achievement.grau,
      type: t.type,
      typeLabel: transitionTypeLabel(t.type),
      at: t.at,
      reason: t.reason,
      reasonText: transitionReasonText(t.type, t.reason),
    }));
  }

  private earnedAt(category: string, periodStart: Date | null, periodEnd: Date | null): Date | null {
    if (category === 'volume_semanal' && periodStart) return new Date(periodStart.getTime() + 7 * 86_400_000);
    if (category === 'sustentacao_volume' && periodEnd) return new Date(periodEnd.getTime() + 7 * 86_400_000);
    if (category === 'volume_mensal' && periodStart) {
      return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
    }
    return null;
  }

  async getProgress(userId: string): Promise<NextUpMedalView[]> {
    const unlockedCodes = new Set(
      (await this.prisma.userAchievement.findMany({ where: { userId }, include: { achievement: { select: { code: true } } } }))
        .filter((u) => !isAwardRevoked({ evidence: u.evidence, status: u.status }))
        .map((u) => u.achievement.code),
    );

    const [
      totalCompleted,
      totalFeedbacks,
      totalCheckins,
      totalReassessments,
      currentWeekKm,
      currentMonthKm,
      bestSingleDistance,
      accumulatedKm,
      currentConstanciaStreak,
      prescribedWeeklyKm,
    ] = await Promise.all([
      this.countTreinosConcluidos(userId),
      this.countFeedbacks(userId),
      this.countCheckins(userId),
      this.countReassessments(userId),
      this.getCurrentWeekKm(userId),
      this.getCurrentMonthKm(userId),
      this.getBestSingleDistance(userId),
      this.getAccumulatedKm(userId),
      this.getCurrentConstanciaStreak(userId),
      this.getPrescribedWeeklyKm(userId),
    ]);

    const nextUp: NextUpMedalView[] = [];

    nextUp.push(...this.nextInCategory('treinos_concluidos', unlockedCodes, totalCompleted, null));
    nextUp.push(...this.nextInCategory('feedbacks', unlockedCodes, totalFeedbacks, null));
    nextUp.push(...this.nextInCategory('checkins', unlockedCodes, totalCheckins, null));
    nextUp.push(...this.nextInCategory('reavaliacoes', unlockedCodes, totalReassessments, null));
    nextUp.push(...this.nextInCategory('constancia', unlockedCodes, currentConstanciaStreak, null));
    nextUp.push(...this.nextInCategory('volume_semanal', unlockedCodes, currentWeekKm, prescribedWeeklyKm));
    nextUp.push(...this.nextInCategory('volume_mensal', unlockedCodes, currentMonthKm, prescribedWeeklyKm != null ? prescribedWeeklyKm * 4.33 : null));
    nextUp.push(...this.nextInCategory('distancia_unica', unlockedCodes, bestSingleDistance, null));
    nextUp.push(...this.nextInCategory('acumulado', unlockedCodes, accumulatedKm, null));
    nextUp.push(...(await this.nextInSustentacaoVolume(userId, unlockedCodes, prescribedWeeklyKm)));

    return nextUp;
  }

  // -----------------------------------------------------------------------------------------
  // Uma medalha "próxima" por categoria: a de menor limiar ainda NÃO conquistada.
  // -----------------------------------------------------------------------------------------
  private nextInCategory(
    category: Parameters<typeof getMedalCategoryCatalog>[0],
    unlockedCodes: ReadonlySet<string>,
    currentValue: number | null,
    prescribedReference: number | null,
  ): NextUpMedalView[] {
    const next = getMedalCategoryCatalog(category).find((m) => !unlockedCodes.has(m.code));
    if (!next) return [];
    return [this.toNextUpView(next, currentValue, prescribedReference)];
  }

  private toNextUpView(medal: MedalDefinition, currentValue: number | null, prescribedReference: number | null): NextUpMedalView {
    return {
      code: medal.code,
      category: medal.category,
      name: medal.name,
      description: medal.description,
      grau: medal.grau,
      threshold: medal.threshold,
      unit: medal.unit,
      currentValue,
      recommendedAsNextGoal: this.isRecommended(medal, prescribedReference),
    };
  }

  /**
   * Regra de segurança (SISTEMA_DE_MEDALHAS.md seção 16): sem prescrição ativa pra comparar,
   * nunca filtra (retorna null — "não sei dizer", nunca "sim" nem "não" inventado). Com
   * prescrição, uma margem de 50% acima dela ainda é considerada "objetivo razoável de mostrar";
   * acima disso, a medalha continua existindo no catálogo mas não é empurrada como sugestão —
   * puramente um filtro de EXIBIÇÃO, nunca uma decisão de treino.
   */
  private isRecommended(medal: MedalDefinition, prescribedReference: number | null): boolean | null {
    const volumeCategories = ['volume_semanal', 'volume_mensal', 'sustentacao_volume'];
    if (!volumeCategories.includes(medal.category)) return true;
    const explicit = (medal.criteria as { recommendedAsNextGoal?: boolean }).recommendedAsNextGoal;
    if (explicit === false) return false;
    if (prescribedReference == null || medal.threshold == null) return null;
    return medal.threshold <= prescribedReference * 1.5;
  }

  // -----------------------------------------------------------------------------------------
  // Sustentação de volume — "próxima" medalha por PATAMAR (não uma única pra categoria inteira,
  // já que os 6 patamares progridem em paralelo).
  // -----------------------------------------------------------------------------------------
  private async nextInSustentacaoVolume(userId: string, unlockedCodes: ReadonlySet<string>, prescribedWeeklyKm: number | null): Promise<NextUpMedalView[]> {
    const catalog = getMedalCategoryCatalog('sustentacao_volume');
    const patamares = [...new Set(catalog.map((m) => (m.criteria as { weeklyKmThreshold: number }).weeklyKmThreshold))];
    const weeklyKm = await this.getCombinedRunWeeklyKm(userId);
    const today = new Date();
    const closedWeeks = [...weeklyKm.entries()].filter(([w]) => isWeekClosed(new Date(w + 'T00:00:00.000Z'), today));

    const views: NextUpMedalView[] = [];
    for (const patamar of patamares) {
      const medalsForPatamar = catalog.filter((m) => (m.criteria as { weeklyKmThreshold: number }).weeklyKmThreshold === patamar);
      const next = medalsForPatamar.find((m) => !unlockedCodes.has(m.code));
      if (!next) continue;
      // Streak ATUAL (não histórico máximo) terminando na última semana fechada, pra mostrar
      // progresso real de "quantas semanas seguidas estou sustentando esse patamar agora".
      const sortedClosed = closedWeeks.map(([w]) => w).sort();
      let currentStreak = 0;
      for (let i = sortedClosed.length - 1; i >= 0; i--) {
        if ((weeklyKm.get(sortedClosed[i]) ?? 0) >= patamar) currentStreak++;
        else break;
      }
      views.push(this.toNextUpView(next, currentStreak, prescribedWeeklyKm));
    }
    return views;
  }

  // -----------------------------------------------------------------------------------------
  // Fontes de valor atual (mesmo espírito de MedalEvaluationService: nunca recalcula matemática
  // que já existe, só lê EvolutionMetricService/queries mínimas).
  // -----------------------------------------------------------------------------------------

  private async countTreinosConcluidos(userId: string): Promise<number> {
    return this.prisma.workoutCompletion.count({
      where: { userId, status: { in: ['done', 'adjusted'] }, session: { scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF } } },
    });
  }

  private async countFeedbacks(userId: string): Promise<number> {
    return this.prisma.workoutCompletion.count({ where: { userId, session: { scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF } } } });
  }

  private async countCheckins(userId: string): Promise<number> {
    const rows = await this.prisma.weeklyCheckIn.findMany({ where: { userId }, select: { checkinVersion: true, checkinSkipped: true, elaborationSatisfaction: true } });
    return rows.filter((r) => (r.checkinVersion === 1 ? r.elaborationSatisfaction != null && r.elaborationSatisfaction !== 0 : !r.checkinSkipped)).length;
  }

  private async countReassessments(userId: string): Promise<number> {
    return this.prisma.reassessment.count({ where: { userId, completedAt: { not: null } } });
  }

  private async getCombinedRunWeeklyKm(userId: string): Promise<Map<string, number>> {
    const series = await this.evolutionMetric.getRunSeries(userId);
    return new Map(series.weeks.filter((week) => week.kmPercorridos != null).map((week) => [week.weekStart, week.kmPercorridos!]));
  }

  private async getCurrentWeekKm(userId: string): Promise<number | null> {
    const weeklyKm = await this.getCombinedRunWeeklyKm(userId);
    const currentWeek = isoDate(mondayOf(new Date()));
    return weeklyKm.get(currentWeek) ?? 0;
  }

  private async getCurrentMonthKm(userId: string): Promise<number | null> {
    const series = await this.evolutionMetric.getRunSeries(userId);
    const currentMonth = new Date().toISOString().slice(0, 7);
    return series.months.find((month) => month.month === currentMonth)?.kmPercorridos ?? 0;
  }

  private async getBestSingleDistance(userId: string): Promise<number | null> {
    const row = await this.prisma.trainingSession.findFirst({
      where: {
        userId,
        scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF },
        modality: { in: RUN_MODALITIES },
        completion: { status: { in: ['done', 'adjusted'] }, distanceKm: { not: null } },
      },
      orderBy: { completion: { distanceKm: 'desc' } },
      select: { completion: { select: { distanceKm: true } } },
    });
    return row?.completion?.distanceKm ?? null;
  }

  private async getAccumulatedKm(userId: string): Promise<number | null> {
    const rows = await this.prisma.trainingSession.findMany({
      where: {
        userId,
        scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF },
        modality: { in: RUN_MODALITIES },
        completion: { status: { in: ['done', 'adjusted'] }, distanceKm: { not: null } },
      },
      select: { completion: { select: { distanceKm: true } } },
    });
    const total = rows.reduce((sum, r) => sum + (r.completion?.distanceKm ?? 0), 0);
    return Math.round(total * 10) / 10;
  }

  private async getCurrentConstanciaStreak(userId: string): Promise<number | null> {
    const dates = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF }, completion: { status: { in: ['done', 'adjusted'] } } },
      select: { scheduledDate: true },
      orderBy: { scheduledDate: 'asc' },
    });
    if (dates.length === 0) return 0;
    const today = new Date();
    const presentWeeks = new Set(dates.map((d) => isoDate(mondayOf(d.scheduledDate))));
    const allWeeks = buildCompleteWeekList(dates[0].scheduledDate, today).filter((w) => isWeekClosed(w, today)).map(isoDate);
    let streak = 0;
    for (let i = allWeeks.length - 1; i >= 0; i--) {
      if (presentWeeks.has(allWeeks[i])) streak++;
      else break;
    }
    return streak;
  }

  /** Volume semanal PRESCRITO pelo plano ativo (corrida/esteira) — referência pra filtrar "próxima conquista" recomendada. */
  private async getPrescribedWeeklyKm(userId: string): Promise<number | null> {
    const activePlan = await this.prisma.trainingPlan.findFirst({ where: { userId, status: 'active' }, select: { id: true } });
    if (!activePlan) return null;
    const sessions = await this.prisma.trainingSession.findMany({
      where: { planId: activePlan.id, modality: { in: RUN_MODALITIES } },
      select: { distanceKm: true },
    });
    if (sessions.length === 0) return null;
    return sessions.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0);
  }
}
