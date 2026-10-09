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

import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { canonicalModality } from '../activity-execution/canonical-modality';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TRAINING_INTELLIGENCE_DATA_CUTOFF } from '../common/training-history-policy';
import { SATISFACTION_SCORE } from '../workout-completions/workout-completions.service';
import { EvolutionMetricService } from '../evolution/evolution-metric.service';
import type { EvolutionSeries } from '../evolution/evolution.types';
import { MathLayerService, SeriesPoint } from './math-layer.service';
import { getVariableDefinition, InstrumentVersionSpec, VariableDefinition, VariableSource } from './variable-registry';
import { EXECUTION_ANALYSIS_VERSION, intensityBasisOf, RunExecutionAnalysis } from '../activity-execution/execution-analysis';

export interface Observation {
  athleteId: string;
  variableId: string;
  // Auditoria Astra (29/09/2026), item 17: categorica (ex: workout.painFlag) preserva a categoria
  // como string — nunca inventa um mapeamento categoria->numero. So variaveis ordinal_scale/
  // numeric_continuous chegam aqui como number (ver toObservationValue).
  value: number | string;
  timestamp: Date;
  source: VariableSource;
  instrumentVersion: number;
  context: {
    sessionId?: string;
    workoutCompletionId?: string;
    checkinId?: string;
    // 01/10/2026 — presentes quando a observacao vem de um registro compartilhado entre sessoes
    // (ver VariableDefinition.relatedTable), nao de uma sessao/completion especifica.
    nightlySleepLogId?: string;
    stressCheckinId?: string;
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
    // Metrica objetiva por atividade (04/10/2026) — rastro ate o ActivityLog de origem.
    activityLogId?: string;
    provider?: string;
    acuteValue?: number;
    chronicValue?: number;
    acuteWindowDays?: number;
    chronicWindowDays?: number;
    acuteWeeksUsed?: number;
    chronicWeeksUsed?: number;
  };
}

// 01/10/2026 — versao de instrumento reportada para observacoes lidas de um registro compartilhado
// (NightlySleepLog/StressCheckin), nunca de completion.feedbackVersion (que nao existe nesse
// caminho). Deliberadamente distinta de 1/2 — e' um modelo de coleta diferente (por noite/janela,
// nao por sessao), nao so' uma redacao nova da mesma pergunta.
const SHARED_RECORD_INSTRUMENT_VERSION = 3;

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
 * Modalidade reservada pro total GLOBAL recombinado de training_load (27/09/2026 — ver
 * training-intelligence-query.service.ts, hasExplicitGlobalTag). NUNCA usar como nome de modalidade
 * real em nenhum outro lugar do sistema.
 */
const TRAINING_LOAD_GLOBAL_TAG = 'global';

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

/**
 * Converte o valor bruto pro tipo de Observation.value — nao e' mais so "numerico": variavel
 * categorica (ex: workout.painFlag, dataType==='categorical' no VariableRegistry) preserva a
 * categoria como string, sem tentar Number(raw) nela.
 *
 * Auditoria Astra (29/09/2026), item 17 — CAUSA RAIZ do bug real: antes, toNumericValue() fazia
 * Number(raw) pra QUALQUER string, sem olhar dataType. Number("moderado") = NaN, entao
 * Number.isFinite(NaN) e' false e a funcao retornava undefined pra toda categoria de dor que nao
 * fosse dirigida ao caminho de satisfactionElaboracao — o chamador (readWorkoutVariable) trata
 * undefined como "ausencia" (`if (value === undefined) continue`) e simplesmente NAO CRIA a
 * Observation. Resultado: nenhum relato de dor ("leve"/"moderado"/"forte") jamais chegava na
 * Training Intelligence, silenciosamente, sem erro nenhum — nao era so um valor errado, era o
 * dado inteiro desaparecendo antes de qualquer calculo ou contexto pro Treinador.
 * Correcao: olhar definition.dataType ANTES de tentar converter. Categorica preserva a string
 * (nunca vira 0/1/2/3 — isso seria inventar uma escala que o VariableRegistry explicitamente NAO
 * declara pra esta variavel, violando o mesmo principio de "nao usar formula generica no lugar
 * da semantica real do dado"). O consumidor (training-intelligence-query.service.ts) ja tratava
 * categorica como mathApplicable=false e so' usa o valor pra exibicao/rastreabilidade — nunca
 * pra MathLayer — entao string ali e' seguro.
 */
function toObservationValue(definition: VariableDefinition, raw: unknown): number | string | undefined {
  if (raw == null) return undefined; // ausencia — nunca vira zero
  if (definition.dataType === 'categorical') {
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    if (definition.variableId === 'workout.satisfactionElaboracao' && raw in SATISFACTION_SCORE) {
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

    // student_feedback_shared_record (01/10/2026): sono/estresse, que agora podem viver num registro
    // compartilhado entre sessoes — readWorkoutVariable() trata os dois casos (ver relatedTable).
    if (definition.source === 'student_feedback_per_workout' || definition.source === 'student_feedback_shared_record') {
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
    if (definition.source === 'session_execution_analysis') {
      return this.readExecutionAnalysisVariable(athleteId, definition);
    }
    if (definition.source === 'activity_objective') {
      return this.readActivityObjectiveVariable(athleteId, definition);
    }
    return this.readCheckinVariable(athleteId, definition);
  }

  // -----------------------------------------------------------------------------------------
  // Feedback por treino (WorkoutCompletion)
  // -----------------------------------------------------------------------------------------

  // 01/10/2026: sono (nightly_sleep_log) e estresse (stress_checkin) deixaram de ser "por sessao" —
  // ver VariableDefinition.relatedTable. Quando a variavel tem relatedTable, a fonte de verdade e'
  // essa tabela compartilhada (uma linha = uma observacao, por construcao — nunca duplica entre
  // sessoes do mesmo dia/janela); so' entram observacoes LEGADAS (completions anteriores a essa
  // migration, sem vinculo com a tabela nova) complementando o historico, nunca os dois pra o MESMO
  // completion. Variaveis sem relatedTable continuam 100% no caminho antigo, inalterado.
  private async readWorkoutVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const observations: Observation[] = [];

    if (definition.relatedTable?.table === 'nightly_sleep_log') {
      const nights = await this.prisma.nightlySleepLog.findMany({
        where: { userId: athleteId },
        orderBy: { nightDate: 'asc' },
      });
      for (const night of nights) {
        const raw = (night as unknown as Record<string, unknown>)[definition.relatedTable.field];
        const value = toObservationValue(definition, raw);
        if (value === undefined) continue;
        observations.push({
          athleteId,
          variableId: definition.variableId,
          value,
          timestamp: night.nightDate,
          source: definition.source,
          instrumentVersion: SHARED_RECORD_INSTRUMENT_VERSION,
          context: { scheduledDate: night.nightDate.toISOString().slice(0, 10), nightlySleepLogId: night.id },
        });
      }
    } else if (definition.relatedTable?.table === 'stress_checkin') {
      const checkins = await this.prisma.stressCheckin.findMany({
        where: { userId: athleteId },
        orderBy: { respondedAt: 'asc' },
      });
      for (const checkin of checkins) {
        const raw = (checkin as unknown as Record<string, unknown>)[definition.relatedTable.field];
        const value = toObservationValue(definition, raw);
        if (value === undefined) continue;
        observations.push({
          athleteId,
          variableId: definition.variableId,
          value,
          timestamp: checkin.respondedAt,
          source: definition.source,
          instrumentVersion: SHARED_RECORD_INSTRUMENT_VERSION,
          context: { stressCheckinId: checkin.id },
        });
      }
    }

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

    for (const session of relevant) {
      const completion = session.completion;
      if (!completion) continue; // sem feedback registrado — ausencia, nao observacao

      // Este completion ja esta vinculado a um registro compartilhado (sono/estresse) — a
      // observacao de verdade ja foi emitida acima, uma por noite/checkin. Ler a coluna legada do
      // completion aqui duplicaria a MESMA noite/janela.
      if (definition.relatedTable?.table === 'nightly_sleep_log' && completion.nightlySleepLogId) continue;
      if (definition.relatedTable?.table === 'stress_checkin' && completion.stressCheckinId) continue;

      const extra = isExtraSession(session.structure);
      if (definition.excludeExtraSessions && extra) continue;

      const version = completion.feedbackVersion;
      const spec = definition.versions.find((v) => v.version === version);
      if (!spec) continue; // esta variavel nao e' coletada nesta versao de instrumento (ou nao tem equivalente legado)

      const detailsJson =
        typeof completion.details === 'object' && completion.details !== null
          ? (completion.details as Record<string, unknown>)
          : {};

      const raw = extractRawValue(spec, completion as unknown as Record<string, unknown>, detailsJson);
      const value = toObservationValue(definition, raw);
      if (value === undefined) continue; // ausencia — nunca vira zero

      observations.push({
        athleteId,
        variableId: definition.variableId,
        value,
        // 28/09/2026: era completion.completedAt (o instante real do envio do feedback) — inconsistente
        // com TODAS as outras fontes deste arquivo, que sempre ancoram timestamp no dia de calendario
        // a que o dado se refere (weekStartDate, log.date, weekStart+T12:00Z), nunca no momento em que
        // o formulario foi enviado. Aluno que treina num dia e so registra o feedback horas depois
        // (ou virando a noite) fazia o grafico mostrar o ponto no dia ERRADO — bug real reportado pelo
        // treinador (RPE aparecendo em 27/09 sem nenhum treino registrado naquele dia). scheduledDate
        // e' sempre meia-noite UTC representando o dia do treino, imune a fuso horario.
        timestamp: session.scheduledDate,
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

    return observations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
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
      const value = toObservationValue(definition, raw);
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

  // Metricas objetivas por atividade (04/10/2026). Fonte canonica: ActivityLog ja classificado como
  // corresponding/alternative (ambiguous fica fora ate' decisao humana). Nunca depende de feedback.
  // 3C.1: UMA observacao por PhysicalEvent (a canonica da 3A) — Polar + Apple do mesmo evento geram uma unica observacao, com os valores da
  // canonica (nada das outras observacoes entra). Modalidade pela representacao canonica ('RUNNING' legado == 'corrida').
  // Etapa 2.1: indicadores derivados da analise de execucao (uma linha por sessao com atividade do relogio, versao atual do algoritmo). Pode haver linhas
  // atualizadas depois de uma sincronizacao tardia: a leitura sempre usa a linha mais recente (a mesma por sessao). Sem valor => ausencia, nunca zero.
  private async readExecutionAnalysisVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const rows = await this.prisma.sessionExecutionAnalysis.findMany({
      where: { userId: athleteId, algorithmVersion: EXECUTION_ANALYSIS_VERSION, activityLogId: { not: null }, status: { in: ['analyzed', 'summary_only'] } },
      orderBy: { scheduledDate: 'asc' },
    });
    const observations: Observation[] = [];
    for (const row of rows) {
      const analysis = row.indicators as unknown as RunExecutionAnalysis;
      if (analysis?.kind !== 'run') continue;
      let value: number | null = null;
      switch (definition.variableId) {
        case 'execution.distanceCompletionRatio': value = analysis.totals.completionRatio; break;
        case 'execution.timeInBandPct': value = analysis.dataLevel === 'series' && analysis.intensity.status !== 'indeterminado' ? intensityBasisOf(analysis)?.inPct ?? null : null; break;
        case 'execution.intervalStructureMatch':
          value = analysis.structure.prescribed === 'intervalado' && analysis.structure.scenario && analysis.structure.scenario !== 'F' ? (['A', 'E'].includes(analysis.structure.scenario) ? 1 : 0) : null;
          break;
        case 'execution.avgHeartRateInBandBpm': value = analysis.avgHeartRateInBandBpm; break;
      }
      if (value == null) continue; // ausencia — nunca vira zero
      observations.push({
        athleteId, variableId: definition.variableId, value, timestamp: row.scheduledDate, source: 'session_execution_analysis', instrumentVersion: row.algorithmVersion,
        context: { sessionId: row.trainingSessionId, modality: row.modality, activityLogId: row.activityLogId ?? undefined, provider: row.provider ?? undefined },
      });
    }
    return observations;
  }

  private async readActivityObjectiveVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const rows = await this.prisma.activityLog.findMany({
      where: { userId: athleteId, executionClassification: { in: ['corresponding', 'alternative'] } },
      orderBy: { startedAt: 'asc' },
    });
    const picks = await pickCanonicalPerEvent(rows, (ids) => this.prisma.activityLog.findMany({ where: { userId: athleteId, id: { in: ids } } }));
    const logs = picks.map((pick) => pick.row).filter((log) => canonicalModality(log.sport) === 'corrida').sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const observations: Observation[] = [];
    for (const log of logs) {
      let value: number | null = null;
      if (definition.variableId === 'activity.avgPaceSecondsKm') {
        if (log.distanceMeters != null && log.distanceMeters > 0 && log.durationSec != null && log.durationSec > 0) {
          value = Math.round(log.durationSec / (log.distanceMeters / 1000));
        }
      } else if (definition.variableId === 'activity.cadenceAvg') {
        if (log.cadenceAvg != null && log.cadenceAvg > 0) value = log.cadenceAvg;
      }
      if (value == null) continue; // ausencia — nunca vira zero
      observations.push({
        athleteId,
        variableId: definition.variableId,
        value,
        timestamp: log.startedAt,
        source: 'activity_objective',
        instrumentVersion: 1,
        context: { modality: log.sport ?? undefined, activityLogId: log.id, provider: log.provider },
      });
    }
    return observations;
  }

  private async readTrainingLoadVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const id = definition.variableId;

    if (id === 'training.acwr') {
      return this.readAcwr(athleteId);
    }

    const modalities = await this.evolutionMetric.getDistinctModalities(athleteId);
    // Bug real achado em 27/09/2026 validando com aluna real: a entrada GLOBAL precisa ser um
    // total genuinamente RECOMBINADO (ex: aderência de uma semana somando corrida+força juntas),
    // diferente de qualquer modalidade isolada — não é "a mesma coisa sem filtro". Por isso ela é
    // marcada com a modalidade reservada 'global' (ver TRAINING_LOAD_GLOBAL_TAG), nunca com
    // modality ausente — do contrário training-intelligence-query.service.ts, ao NÃO filtrar por
    // modalidade, devolveria a MISTURA de todas as variantes (global + cada modalidade) no mesmo
    // pool, inflando n e podendo pegar o valor de uma modalidade errada como "atual" do Global.
    const variants: Array<{ modality?: string; series: EvolutionSeries }> = [
      { modality: TRAINING_LOAD_GLOBAL_TAG, series: await this.evolutionMetric.getSeries(athleteId) },
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
      const value = toObservationValue(definition, raw);
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
