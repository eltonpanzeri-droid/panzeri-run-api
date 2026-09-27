// ObservationReaderService — le as tabelas ja existentes (WorkoutCompletion, WeeklyCheckIn) e as
// apresenta como uma representacao UNIFORME de observacao, sem criar tabela nova nem copiar dado
// bruto pra outro lugar (ver auditoria aprovada, itens "NAO FAZER AGORA").
//
// Regras que este arquivo tem que respeitar (ver CAMADA_MATEMATICA_LONGITUDINAL.md e a auditoria):
// - Missing nunca vira zero: um campo null simplesmente nao gera Observation.
// - Sessao-fantasma (sessao de plano arquivado sem completion) e' excluida com a MESMA regra ja
//   usada em evolution/evolution-metric.service.ts — nao inventa uma segunda interpretacao.
// - Sessao extra (criada pelo proprio aluno) so' e' excluida quando VariableDefinition.excludeExtraSessions
//   diz que deve ser (ver variable-registry.ts) — nao exclui por padrao.
// - Nunca mistura silenciosamente duas versoes de instrumento semanticamente diferentes: toda
//   observacao carrega instrumentVersion, e o consumidor (endpoint) decide o que fazer com isso.
// - Sempre e' possivel voltar ao registro original (sessionId/checkinId ficam no context).

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../common/training-history-policy';
import { SATISFACTION_SCORE } from '../workout-completions/workout-completions.service';
import { EvolutionMetricService } from '../evolution/evolution-metric.service';
import type { EvolutionSeries } from '../evolution/evolution.types';
import { MathLayerService, SeriesPoint } from './math-layer.service';
import { getVariableDefinition, InstrumentVersionSpec, VariableDefinition } from './variable-registry';

export interface Observation {
  athleteId: string;
  variableId: string;
  value: number;
  timestamp: Date;
  source: 'student_feedback_per_workout' | 'student_weekly_checkin' | 'student_menstrual_daily_log' | 'student_menstrual_cycle_log' | 'weekly_training_load';
  instrumentVersion: number;
  context: {
    sessionId?: string;
    workoutCompletionId?: string;
    checkinId?: string;
    modality?: string;
    scheduledDate?: string;
    isExtra?: boolean;
    flowIntensity?: string;
    // Volume/Aderência/ACWR (26/09/2026) — rastreabilidade de proporções e razões, nunca uma % ou
    // razão sozinha escondendo o tamanho da amostra por trás (itens 9/18 do pedido).
    numerator?: number;
    denominator?: number;
    coveragePercent?: number;
    isPartialWeek?: boolean;
    acuteValue?: number;
    chronicValue?: number;
    acuteWindowDays?: number;
    chronicWindowDays?: number;
    acuteWeeksUsed?: number;
    chronicWeeksUsed?: number;
  };
}

type StructureShape = { source?: unknown; type?: unknown };

function isExtraSession(structure: unknown): boolean {
  const obj = typeof structure === 'object' && structure !== null ? (structure as StructureShape) : {};
  return obj.source === 'student' && obj.type === 'extra';
}

/** Extrai o valor bruto de uma observacao a partir da spec de uma versao de instrumento. */
function extractRawValue(
  spec: InstrumentVersionSpec,
  completionRow: Record<string, unknown>,
  detailsJson: Record<string, unknown>,
): unknown {
  if (spec.storageLocation === 'details_json' && spec.detailsKey) {
    return detailsJson[spec.detailsKey];
  }
  if (spec.field) {
    return completionRow[spec.field];
  }
  return undefined;
}

/**
 * Semana em andamento (item 27 do pedido de 26/09) — não comparar silenciosamente uma semana
 * completa com uma semana ainda no meio. weekStart é sempre segunda-feira (convenção já usada em
 * EvolutionMetricService); "em andamento" = hoje cai dentro dos 7 dias daquela semana.
 */
function isCurrentPartialWeek(weekStartISO: string): boolean {
  const start = new Date(weekStartISO + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 86400000);
  const now = new Date();
  return now >= start && now < end;
}

function makeTrainingLoadObs(
  athleteId: string,
  variableId: string,
  value: number,
  timestamp: Date,
  context: Observation['context'],
): Observation {
  return { athleteId, variableId, value, timestamp, source: 'weekly_training_load', instrumentVersion: 1, context };
}

/** Converte o valor bruto (numero ou categoria conhecida) num numero, ou undefined se nao aplicavel. */
function toNumericValue(variableId: string, raw: unknown): number | undefined {
  if (raw == null) return undefined; // ausencia — nunca vira zero
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    if (variableId === 'workout.satisfactionElaboracao' && raw in SATISFACTION_SCORE) {
      return SATISFACTION_SCORE[raw];
    }
    const asNumber = Number(raw);
    return Number.isFinite(asNumber) ? asNumber : undefined;
  }
  return undefined;
}

@Injectable()
export class ObservationReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionMetric: EvolutionMetricService,
    private readonly mathLayer: MathLayerService,
  ) {}

  async getObservations(athleteId: string, variableId: string): Promise<Observation[]> {
    const definition = getVariableDefinition(variableId);
    if (!definition) {
      throw new NotFoundException(`Variavel desconhecida no VariableRegistry: ${variableId}`);
    }

    if (definition.source === 'student_feedback_per_workout') {
      return this.readWorkoutVariable(athleteId, definition);
    }
    if (definition.source === 'student_menstrual_daily_log') {
      return this.readMenstrualDailyVariable(athleteId, definition);
    }
    if (definition.source === 'student_menstrual_cycle_log') {
      return this.readMenstrualCycleVariable(athleteId, definition);
    }
    if (definition.source === 'weekly_training_load') {
      return this.readTrainingLoadVariable(athleteId, definition);
    }
    return this.readCheckinVariable(athleteId, definition);
  }

  // -----------------------------------------------------------------------------------------
  // Feedback por treino (WorkoutCompletion)
  // -----------------------------------------------------------------------------------------

  private async readWorkoutVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    // Corte de historico contaminado por teste (25/09/2026, fechamento do Passo 2) — mesma fonte
    // que EvolutionMetricService usa (training-history-policy.ts), nunca uma segunda data
    // definida so' aqui. Nao apaga nada do banco, so' nao alimenta Training Intelligence.
    const sessions = await this.prisma.trainingSession.findMany({
      where: { userId: athleteId, scheduledDate: { gte: TRAINING_INTELLIGENCE_DATA_CUTOFF } },
      include: { completion: true, plan: { select: { status: true } } },
      orderBy: { scheduledDate: 'asc' },
    });

    // Mesma regra de sessao-fantasma de evolution-metric.service.ts: so conta sessao de plano
    // ativo, OU qualquer sessao (mesmo de plano ja arquivado) que tenha completion de verdade.
    const relevant = sessions.filter((s) => s.plan?.status === 'active' || s.completion !== null);

    const observations: Observation[] = [];

    for (const session of relevant) {
      const completion = session.completion;
      if (!completion) continue; // sem feedback registrado — ausencia, nao observacao

      const extra = isExtraSession(session.structure);
      if (definition.excludeExtraSessions && extra) continue;

      const version = completion.feedbackVersion;
      const spec = definition.versions.find((v) => v.version === version);
      if (!spec) continue; // esta variavel nao e' coletada nesta versao de instrumento

      const detailsJson =
        typeof completion.details === 'object' && completion.details !== null
          ? (completion.details as Record<string, unknown>)
          : {};

      const raw = extractRawValue(spec, completion as unknown as Record<string, unknown>, detailsJson);
      const value = toNumericValue(definition.variableId, raw);
      if (value === undefined) continue; // ausencia — nunca vira zero

      observations.push({
        athleteId,
        variableId: definition.variableId,
        value,
        timestamp: completion.completedAt,
        source: 'student_feedback_per_workout',
        instrumentVersion: version,
        context: {
          sessionId: session.id,
          workoutCompletionId: completion.id,
          modality: session.modality,
          scheduledDate: session.scheduledDate.toISOString().slice(0, 10),
          isExtra: extra,
        },
      });
    }

    return observations;
  }

  // -----------------------------------------------------------------------------------------
  // Ciclo menstrual — registro diario (MenstrualDailyLog), 25/09/2026. Sem dimensao de
  // modalidade/sessao (nao vem de treino) — context so carrega flowIntensity, quando presente.
  // -----------------------------------------------------------------------------------------

  private async readMenstrualDailyVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const logs = await this.prisma.menstrualDailyLog.findMany({
      where: { userId: athleteId },
      orderBy: { date: 'asc' },
    });

    const observations: Observation[] = [];
    for (const log of logs) {
      const spec = definition.versions.find((v) => v.version === 1);
      if (!spec) continue;
      const raw = extractRawValue(spec, log as unknown as Record<string, unknown>, {});
      const value = toNumericValue(definition.variableId, raw);
      if (value === undefined) continue; // ausencia — nunca vira zero

      observations.push({
        athleteId,
        variableId: definition.variableId,
        value,
        timestamp: log.date,
        source: 'student_menstrual_daily_log',
        instrumentVersion: 1,
        context: { flowIntensity: log.flowIntensity ?? undefined },
      });
    }
    return observations;
  }

  // -----------------------------------------------------------------------------------------
  // Ciclo menstrual — duração de ciclo/menstruação (MenstrualCycleLog), 26/09/2026 (item 5 do
  // pedido). Cada "observação" descreve um INTERVALO, não um registro isolado — mesma matemática
  // simples já usada em MenstrualCycleService.getCycleOverview (uma subtração de datas), nunca uma
  // segunda fórmula. Sem dimensão de modalidade (não é por treino).
  // -----------------------------------------------------------------------------------------

  private async readMenstrualCycleVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const logs = await this.prisma.menstrualCycleLog.findMany({
      where: { userId: athleteId },
      orderBy: { cycleStartDate: 'asc' },
    });

    const observations: Observation[] = [];

    if (definition.variableId === 'cycle.cycleLengthDays') {
      // Duração de CADA ciclo = intervalo até o início do PRÓXIMO — o último ciclo da lista nunca
      // gera observação porque essa duração ainda não é conhecida (mesma regra de getCycleOverview).
      for (let i = 0; i < logs.length - 1; i++) {
        const days = Math.round((logs[i + 1].cycleStartDate.getTime() - logs[i].cycleStartDate.getTime()) / 86400000);
        observations.push({
          athleteId,
          variableId: definition.variableId,
          value: days,
          timestamp: logs[i + 1].cycleStartDate,
          source: 'student_menstrual_cycle_log',
          instrumentVersion: 1,
          context: {},
        });
      }
    } else if (definition.variableId === 'cycle.periodLengthDays') {
      for (const log of logs) {
        if (!log.cycleEndDate) continue; // fim nao informado — ausencia, nunca inventa
        const days = Math.round((log.cycleEndDate.getTime() - log.cycleStartDate.getTime()) / 86400000) + 1;
        observations.push({
          athleteId,
          variableId: definition.variableId,
          value: days,
          timestamp: log.cycleStartDate,
          source: 'student_menstrual_cycle_log',
          instrumentVersion: 1,
          context: { flowIntensity: log.flowIntensity ?? undefined },
        });
      }
    }

    return observations;
  }

  // -----------------------------------------------------------------------------------------
  // Volume, aderência, carga semanal e ACWR (26/09/2026 — auditoria Volume/Aderência/ACWR).
  // Fonte real: EvolutionMetricService (getSeries/getSeriesByModality/getDistinctModalities) —
  // NENHUM cálculo de aderência/volume/km é refeito aqui, só selecionado e reformatado como
  // Observation. GLOBAL (sem modalidade) + uma série por modalidade REALMENTE existente no
  // histórico do aluno (nunca uma lista fixa hardcoded — ver getDistinctModalities). ACWR é
  // deliberadamente só GLOBAL nesta rodada (carga recente/histórica combinando todas as
  // modalidades é o que faz sentido pra essa razão especificamente).
  // -----------------------------------------------------------------------------------------

  private async readTrainingLoadVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const id = definition.variableId;

    if (id === 'training.acwr') {
      return this.readAcwr(athleteId);
    }

    const modalities = await this.evolutionMetric.getDistinctModalities(athleteId);
    const variants: Array<{ modality?: string; series: EvolutionSeries }> = [
      { modality: undefined, series: await this.evolutionMetric.getSeries(athleteId) },
    ];
    for (const modality of modalities) {
      variants.push({ modality, series: await this.evolutionMetric.getSeriesByModality(athleteId, modality) });
    }

    const observations: Observation[] = [];
    for (const { modality, series } of variants) {
      for (const w of series.weeks) {
        const timestamp = new Date(w.weekStart + 'T12:00:00Z');
        const isPartialWeek = isCurrentPartialWeek(w.weekStart);

        if (id === 'training.volumePrescribedKm' && w.kmPrescritos != null) {
          observations.push(makeTrainingLoadObs(athleteId, id, w.kmPrescritos, timestamp, { modality, isPartialWeek }));
        } else if (id === 'training.volumeCompletedTotalKm' && w.kmPercorridos != null) {
          observations.push(makeTrainingLoadObs(athleteId, id, w.kmPercorridos, timestamp, { modality, isPartialWeek }));
        } else if (id === 'training.volumeExtraKm' && w.kmExtras != null) {
          observations.push(makeTrainingLoadObs(athleteId, id, w.kmExtras, timestamp, { modality, isPartialWeek }));
        } else if (id === 'training.volumeCompletedPrescribedOnlyKm' && w.kmPercorridos != null) {
          observations.push(makeTrainingLoadObs(athleteId, id, w.kmPercorridos - (w.kmExtras ?? 0), timestamp, { modality, isPartialWeek }));
        } else if (id === 'training.volumeDiffAbsoluteKm' && w.kmPercorridos != null && w.kmPrescritos != null) {
          observations.push(makeTrainingLoadObs(athleteId, id, w.kmPercorridos - w.kmPrescritos, timestamp, { modality, isPartialWeek }));
        } else if (id === 'training.volumeRatioCompletedPrescribed' && w.kmPercorridos != null && w.kmPrescritos != null && w.kmPrescritos > 0) {
          observations.push(makeTrainingLoadObs(athleteId, id, w.kmPercorridos / w.kmPrescritos, timestamp, { modality, isPartialWeek }));
        } else if (id === 'training.adherencePercent' && w.adherencePercent != null) {
          observations.push(makeTrainingLoadObs(athleteId, id, w.adherencePercent, timestamp, {
            modality, isPartialWeek,
            numerator: w.sessoesFeitas,
            denominator: w.sessoesFeitas + w.sessoesNaoFeitas,
            coveragePercent: w.coveragePercent,
          }));
        }
      }
    }
    return observations;
  }

  /**
   * ACWR — média móvel de 28 dias (aguda) ÷ 42 dias (crônica) sobre a MESMA série de
   * training.volumeCompletedTotalKm, usando MathLayerService.movingAverage com janela por
   * calendar_days (nunca por índice de array — bug real do gráfico antigo do Admin, que deslizava
   * a janela por posição na lista e quebrava se houvesse semana faltando no meio do histórico).
   * Só GLOBAL nesta rodada.
   */
  private async readAcwr(athleteId: string): Promise<Observation[]> {
    const series = await this.evolutionMetric.getSeries(athleteId);
    const loadPoints: SeriesPoint[] = series.weeks
      .filter((w) => w.kmPercorridos != null)
      .map((w) => ({ value: w.kmPercorridos as number, timestamp: new Date(w.weekStart + 'T12:00:00Z') }));

    const observations: Observation[] = [];
    for (const w of series.weeks) {
      if (w.kmPercorridos == null) continue;
      const asOf = new Date(w.weekStart + 'T12:00:00Z');
      const acute = this.mathLayer.movingAverage(loadPoints, { kind: 'calendar_days', size: 28 }, asOf);
      const chronic = this.mathLayer.movingAverage(loadPoints, { kind: 'calendar_days', size: 42 }, asOf);
      if (acute.value == null || chronic.value == null || chronic.value === 0) continue; // sem referencia historica ainda — nunca inventa uma razao
      observations.push({
        athleteId,
        variableId: 'training.acwr',
        value: acute.value / chronic.value,
        timestamp: asOf,
        source: 'weekly_training_load',
        instrumentVersion: 1,
        context: {
          isPartialWeek: isCurrentPartialWeek(w.weekStart),
          acuteValue: acute.value,
          chronicValue: chronic.value,
          acuteWindowDays: 28,
          chronicWindowDays: 42,
          acuteWeeksUsed: acute.n,
          chronicWeeksUsed: chronic.n,
        },
      });
    }
    return observations;
  }

  // -----------------------------------------------------------------------------------------
  // Check-in semanal (WeeklyCheckIn)
  // -----------------------------------------------------------------------------------------

  private async readCheckinVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const checkins = await this.prisma.weeklyCheckIn.findMany({
      where: { userId: athleteId, checkinSkipped: false },
      orderBy: { weekStartDate: 'asc' },
    });

    const observations: Observation[] = [];

    for (const checkin of checkins) {
      const version = checkin.checkinVersion;
      const spec = definition.versions.find((v) => v.version === version);
      if (!spec) continue;

      const raw = extractRawValue(spec, checkin as unknown as Record<string, unknown>, {});
      const value = toNumericValue(definition.variableId, raw);
      if (value === undefined) continue;

      observations.push({
        athleteId,
        variableId: definition.variableId,
        value,
        timestamp: checkin.weekStartDate,
        source: 'student_weekly_checkin',
        instrumentVersion: version,
        context: { checkinId: checkin.id },
      });
    }

    return observations;
  }
}
