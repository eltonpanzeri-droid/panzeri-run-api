import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObservationReaderService } from '../training-intelligence/observation-reader.service';
import { filterByModality, mainSourceOnly } from '../training-intelligence/evolution-summary.service';
import { EVOLUTION_SINCE, READING_CATALOG } from '../training-intelligence/evolution-reading-catalog';
import { getVariableDefinition } from '../training-intelligence/variable-registry';
import { isRunModality } from '../activity-execution/canonical-modality';
import { buildPhasedCycles, cycleLimitations, PHASE_IDS, PHASE_LABEL, type PhaseId } from './cycle-phases';
import { buildOverviewSentences, bucketValuesByPhase, daysPerPhase, FORMAT_PACE, meanOf, statsByPhase, type ComparableMetric, type PhaseStat, type TimedValue } from './cycle-phase-report';
import { WomanAgentService } from './woman-agent.service';
import { AiDataEligibility } from '../ai-governance/ai-data-eligibility.service';
import { runWithAiScope } from '../ai-governance/ai-scope';

// Relatorio mensal do ciclo por fase (19/11/2026, ordem de Elton). So' gerado quando a aluna PEDE, no maximo UM por mes (mes de Sao Paulo; chave unica no banco). Os numeros sao calculados pelo codigo a partir das
// mesmas fontes da Evolucao (leitor de observacoes + feedbacks de treino + relatos de dor); o texto do Agente da Mulher e' opcional (falha dele nao impede o relatorio). SOMENTE LEITURA dos dados da aluna.
const SAO_PAULO_OFFSET_MS = -3 * 3_600_000;
export const reportMonthKey = (now: Date) => new Date(now.getTime() + SAO_PAULO_OFFSET_MS).toISOString().slice(0, 7);
const WINDOW_DAYS = 180;
const PAIN_LEVEL: Record<string, number> = { none: 0, leve: 1, moderado: 2, forte: 3 };

// Indicadores em destaque (os que Elton listou); o restante da Evolucao entra em "outros indicadores".
const HIGHLIGHT_IDS = ['workout.perceivedEffort', 'activity.avgPaceSecondsKm', 'wearable.sleepScore', 'workout.preSleepQuality', 'wearable.sleepDurationMin', 'workout.sleepDurationHoursEstimate', 'wearable.bedtimeDeviationMin', 'workout.sleepScheduleIrregularity', 'wearable.sleepAwakeMin', 'workout.sleepInterruption'];

export interface PhaseMetric { id: string; label: string; unit: string; perPhase: Record<PhaseId, PhaseStat> }
export interface PhaseReportPayload {
  version: 1;
  generatedAt: string;
  window: { from: string; to: string };
  cyclesCount: number;
  limitations: string[];
  phases: Array<{
    id: PhaseId; label: string; daysObserved: number;
    workouts: { done: number; missed: number; adherencePct: number | null; km: number };
    pain: { workoutsWithPain: number; meanLevel: number | null; standaloneReports: number; standaloneMeanIntensity: number | null };
  }>;
  highlights: PhaseMetric[];
  otherIndicators: PhaseMetric[];
  quadroGeral: string[];
}

@Injectable()
export class MenstrualReportService {
  private readonly logger = new Logger(MenstrualReportService.name);

  constructor(private readonly prisma: PrismaService, private readonly reader: ObservationReaderService, @Optional() private readonly agent?: WomanAgentService, @Optional() private readonly aiEligibility?: AiDataEligibility) {}

  async list(userId: string) {
    const rows = await this.prisma.menstrualReport.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, monthKey: true, createdAt: true, agentStatus: true } });
    const now = new Date();
    const thisMonth = rows.find((row) => row.monthKey === reportMonthKey(now));
    return { canRequest: !thisMonth, thisMonthReportId: thisMonth?.id ?? null, reports: rows.map((row) => ({ id: row.id, monthKey: row.monthKey, createdAt: row.createdAt.toISOString() })) };
  }

  async get(userId: string, id: string) {
    const row = await this.prisma.menstrualReport.findFirst({ where: { id, userId } });
    if (!row) return null;
    return { id: row.id, monthKey: row.monthKey, createdAt: row.createdAt.toISOString(), narrative: row.narrative, report: row.payload };
  }

  // Pedido da aluna. Um por mes: se ja existe, devolve o do mes (nunca gera outro nem cobra IA de novo).
  async request(userId: string, now: Date = new Date()) {
    const monthKey = reportMonthKey(now);
    const existing = await this.prisma.menstrualReport.findUnique({ where: { userId_monthKey: { userId, monthKey } } });
    if (existing) return { alreadyGenerated: true, ...(await this.get(userId, existing.id)) };
    const payload = await this.buildPayload(userId, now);
    if (payload.cyclesCount === 0) throw new BadRequestException({ code: 'no_cycles', message: 'Registre pelo menos o início de um ciclo para pedir o relatório.' });
    let narrative: string | null = null;
    let agentStatus = 'skipped';
    if (this.agent) {
      // O que vai a IA e' remontado DENTRO do escopo de IA da aluna (dado de provedor nao autorizado fica de fora); o que ela le na tela e' o relatorio completo dela.
      const aiScope = this.aiEligibility ? await this.aiEligibility.scopeFor(userId, 'external_ai').catch(() => null) : null;
      const aiPayload = aiScope ? await runWithAiScope(aiScope, () => this.buildPayload(userId, now)) : payload;
      const outcome = await this.agent.narrate(userId, aiPayload, monthKey).catch((error) => { this.logger.warn(`Agente da Mulher falhou: ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`); return null; });
      if (outcome) { narrative = outcome.narrative; agentStatus = 'ok'; } else agentStatus = 'failed';
    }
    try {
      const row = await this.prisma.menstrualReport.create({ data: { userId, monthKey, payload: payload as unknown as Prisma.InputJsonObject, narrative, agentStatus } });
      return { alreadyGenerated: false, ...(await this.get(userId, row.id)) };
    } catch (error) {
      // Dois pedidos ao mesmo tempo: a chave unica barra o segundo, que recebe o relatorio do primeiro.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.menstrualReport.findUnique({ where: { userId_monthKey: { userId, monthKey } } });
        if (row) return { alreadyGenerated: true, ...(await this.get(userId, row.id)) };
      }
      throw error;
    }
  }

  async buildPayload(userId: string, now: Date): Promise<PhaseReportPayload> {
    const [profile, logs] = await Promise.all([
      this.prisma.menstrualProfile.findUnique({ where: { userId } }),
      this.prisma.menstrualCycleLog.findMany({ where: { userId }, orderBy: { cycleStartDate: 'asc' }, select: { cycleStartDate: true, cycleEndDate: true } }),
    ]);
    const cycles = buildPhasedCycles(logs.map((log) => ({ start: log.cycleStartDate, end: log.cycleEndDate })), profile);
    const since = new Date(Math.max(EVOLUTION_SINCE.getTime(), now.getTime() - WINDOW_DAYS * 86_400_000));
    const firstCycleStart = cycles[0]?.start ?? since;
    const from = new Date(Math.max(since.getTime(), firstCycleStart.getTime()));

    const [completions, painReports] = await Promise.all([
      this.prisma.workoutCompletion.findMany({ where: { userId, session: { scheduledDate: { gte: since, lte: now } } }, select: { status: true, distanceKm: true, painFlag: true, session: { select: { scheduledDate: true, modality: true } } } }),
      this.prisma.painReport.findMany({ where: { userId, createdAt: { gte: since, lte: now } }, select: { createdAt: true, intensity: true } }),
    ]);

    const ids = [...new Set([...HIGHLIGHT_IDS, ...READING_CATALOG.filter((entry) => !entry.virtual).map((entry) => entry.variableId)])];
    const metrics: PhaseMetric[] = [];
    for (const id of ids) {
      const definition = getVariableDefinition(id);
      if (!definition) continue;
      try {
        const catalog = READING_CATALOG.find((entry) => entry.variableId === id);
        let observations = filterByModality(await this.reader.getObservations(userId, id), null).filter((o): o is typeof o & { value: number } => typeof o.value === 'number' && Number.isFinite(o.value));
        if (catalog?.wearable || id.startsWith('wearable.')) observations = mainSourceOnly(observations);
        const items: TimedValue[] = observations.map((o) => ({ timestamp: o.timestamp, value: id === 'wearable.sleepDurationMin' ? o.value / 60 : o.value }));
        const digits = id === 'activity.avgPaceSecondsKm' ? 0 : 1;
        const perPhase = statsByPhase(items, cycles, since, digits);
        if (PHASE_IDS.every((phase) => perPhase[phase].n === 0)) continue;
        metrics.push({ id, label: id === 'wearable.sleepDurationMin' ? 'horas de sono (relógio)' : (catalog?.name ?? id), unit: id === 'wearable.sleepDurationMin' ? ' h' : id === 'activity.avgPaceSecondsKm' ? ' s/km' : (definition.scale?.unit ? ` ${definition.scale.unit}` : ''), perPhase });
      } catch (error) {
        this.logger.warn(`Relatorio do ciclo: leitura de ${id} falhou (${error instanceof Error ? error.message.slice(0, 80) : 'erro'}); seguindo.`);
      }
    }

    // Treinos feitos, aderencia, km e dor por fase (do que a aluna registrou nos treinos).
    const doneBy = bucketValuesByPhase(completions.filter((c) => c.session && (c.status === 'done' || c.status === 'adjusted')).map((c) => ({ timestamp: c.session!.scheduledDate, value: 1 })), cycles, since);
    const missedBy = bucketValuesByPhase(completions.filter((c) => c.session && c.status === 'missed').map((c) => ({ timestamp: c.session!.scheduledDate, value: 1 })), cycles, since);
    const kmBy = bucketValuesByPhase(completions.filter((c) => c.session && (c.status === 'done' || c.status === 'adjusted') && isRunModality(c.session.modality) && (c.distanceKm ?? 0) > 0).map((c) => ({ timestamp: c.session!.scheduledDate, value: c.distanceKm as number })), cycles, since);
    const painBy = bucketValuesByPhase(completions.filter((c) => c.session && c.painFlag && (PAIN_LEVEL[c.painFlag] ?? 0) > 0).map((c) => ({ timestamp: c.session!.scheduledDate, value: PAIN_LEVEL[c.painFlag as string] })), cycles, since);
    const standaloneBy = bucketValuesByPhase(painReports.map((r) => ({ timestamp: r.createdAt, value: r.intensity })), cycles, since);
    const days = daysPerPhase(cycles, from, now);
    const round1 = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

    const phases = PHASE_IDS.map((phase) => {
      const done = doneBy[phase].length;
      const missed = missedBy[phase].length;
      return {
        id: phase, label: PHASE_LABEL[phase], daysObserved: days[phase],
        workouts: { done, missed, adherencePct: done + missed > 0 ? Math.round((done / (done + missed)) * 100) : null, km: Math.round(kmBy[phase].reduce((sum, km) => sum + km, 0) * 10) / 10 },
        pain: { workoutsWithPain: painBy[phase].length, meanLevel: round1(meanOf(painBy[phase])), standaloneReports: standaloneBy[phase].length, standaloneMeanIntensity: round1(meanOf(standaloneBy[phase])) },
      };
    });

    const highlights = metrics.filter((metric) => HIGHLIGHT_IDS.includes(metric.id));
    const otherIndicators = metrics.filter((metric) => !HIGHLIGHT_IDS.includes(metric.id));
    const comparable: ComparableMetric[] = [...highlights, ...otherIndicators].map((metric) => ({ id: metric.id, label: metric.label, unit: metric.unit, stats: metric.perPhase }));
    const pace = highlights.find((metric) => metric.id === 'activity.avgPaceSecondsKm');
    const quadroGeral = buildOverviewSentences(comparable.filter((metric) => metric.id !== 'activity.avgPaceSecondsKm'));
    if (pace) {
      const usable = PHASE_IDS.filter((phase) => pace.perPhase[phase].n >= 3 && pace.perPhase[phase].mean != null);
      if (usable.length >= 2) {
        const fastest = [...usable].sort((a, b) => (pace.perPhase[a].mean as number) - (pace.perPhase[b].mean as number))[0];
        const slowest = [...usable].sort((a, b) => (pace.perPhase[b].mean as number) - (pace.perPhase[a].mean as number))[0];
        if (fastest !== slowest) quadroGeral.unshift(`Ritmo médio: no que você registrou, o ritmo médio foi mais rápido na ${PHASE_LABEL[fastest].toLowerCase()} (${FORMAT_PACE(pace.perPhase[fastest].mean)}) e mais lento na ${PHASE_LABEL[slowest].toLowerCase()} (${FORMAT_PACE(pace.perPhase[slowest].mean)}).`);
      }
    }
    return {
      version: 1, generatedAt: now.toISOString(), window: { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }, cyclesCount: cycles.length,
      limitations: [...cycleLimitations(cycles, profile), 'Cada fase só aparece com números quando você tem registros suficientes nela. Ausência de registro não significa ausência de sintoma, e os números não indicam causa.'],
      phases, highlights, otherIndicators, quadroGeral: quadroGeral.slice(0, 30),
    };
  }
}
