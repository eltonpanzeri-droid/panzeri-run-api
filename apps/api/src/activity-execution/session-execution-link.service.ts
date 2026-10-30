import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActivityLog, Prisma } from '@prisma/client';
import { activityLocalDate, activityLocalDayStart } from '../common/local-date';
import { PrismaService } from '../prisma/prisma.service';
import type { PhysicalIdentityResult } from './physical-activity-identity.service';
import { canonicalModality } from './canonical-modality';
import { pickCanonicalPerEvent } from './canonical-observation';
import { FORCE_SESSION_MODALITIES, WEAK_FORCE_ACTIVITY } from './activity-modality-map';
import { RecomputeOptions, RecomputeResult, prepareAnalysisRecompute, toRecomputeResult } from './analysis-recompute';
import { DEFAULT_SYNC_LIMIT, processPendingReevaluation, readPending } from './pending-reevaluation';
import { CorrectionKind, CorrectionOrigin, LinkChange, SessionEditChange, correctionHooks, scheduleWeeklyReportRefresh, weeklyReportRefresh } from './correction-hooks';
import { assessCompatibility, modalitiesCompatible, weakForceCompatible, type CompatibilityAssessment } from './activity-compatibility';

// Opcoes do ponto central pos-correcao: o que o chamador sabe sobre a correcao (quem, de que tipo, o que mais foi afetado).
export interface CorrectionOptions extends RecomputeOptions {
  activityLogIds?: string[];
  kind?: CorrectionKind;
  origin?: CorrectionOrigin;
  actorId?: string | null;
  completionsChanged?: boolean;
  sessionEdit?: SessionEditChange;
  absenceOfData?: boolean;
  provider?: string;
  affectedDates?: string[];
  // Processa mesmo sem sessoes (ex.: exclusao de dados do provedor, que ja removeu os vinculos).
  force?: boolean;
}

// Margem para o relogio entre o instante registrado antes da correcao e createdAt/revokedAt gravados por ela (recalcular a mais e' inofensivo: idempotente).
const RECOMPUTE_CLOCK_MARGIN_MS = 30_000;

// Fundacao Prescricao x Execucao (01/10/2026) + Motor de Reconciliacao V1 (02/10/2026). Fronteira
// ONDE isto se conecta ao resto do sistema: TrainingSession (prescrita OU sintetica/extra) e
// ActivityLog (ja' canonico, agnostico de provedor — ver polar-activity-normalizer.ts). Este
// arquivo NUNCA importa nada especifico de Polar/Garmin/Strava; so' trabalha com os dois lados ja'
// normalizados, e NUNCA le/escreve WorkoutCompletion exceto em materializeExtraActivity (sessao
// sintetica para atividade extra) — evidencia objetiva (ActivityLog) e percepcao subjetiva
// (WorkoutCompletion) permanecem fontes separadas, nunca uma sobrescreve a outra.
//
// classify() NAO e' chamado automaticamente por nenhum adapter de provedor ainda (ex.:
// PolarActivityIngestionService nao invoca isto) — e' uma capacidade testavel e pronta pra' ser
// acionada quando essa decisao de produto for tomada.
//
// Principio do motor V1: reconciliacao trabalha com EVIDENCIAS explicitas, nunca com um score
// numerico fabricado. Toda decisao automatica fica registrada com matchMethod (qual caminho do
// algoritmo decidiu) + evidence (lista de criterios avaliados e seu resultado — true/false/null,
// nunca null tratado como false). Limiares (DISTANCE_TOLERANCE_RATIO/DURATION_TOLERANCE_RATIO) sao
// constantes nomeadas e exportadas — nenhum numero magico escondido.
//
// Quatro perguntas DIFERENTES, nunca misturadas (correcao 02/10/2026 sobre o 959d166):
//   1. Qual atividade prescrita corresponde a esta atividade realizada? -> isto e' reconciliacao/
//      correspondencia, o que este arquivo resolve.
//   2. O aluno realizou a atividade prescrita? -> aderencia. Se uma atividade realizada foi
//      identificada como 'corresponding' a uma prescricao, HOUVE aderencia — mesmo que a execucao
//      tenha sido diferente da prescrita (menos distancia, menos tempo, pace diferente, estrutura
//      parcial). Correspondencia NUNCA exige execucao perfeita.
//   3. Ele fez exatamente como estava prescrito? -> fidelidade/caracteristica da execucao
//      (distancia/duracao/pace/estrutura observados vs prescritos). Isto e' dado para uma camada
//      POSTERIOR (fora de V1) — aqui so' preservamos a evidencia (matchMethod/evidence) que
//      permite calcular isso depois, nunca convertemos divergencia em recusa de correspondencia.
//   4. Apareceu uma atividade que nao corresponde a NENHUMA prescricao aplicavel? -> e' uma
//      atividade 'alternative' (nao e' "substituicao", "erro" nem "nao aderencia intencional" —
//      e' so' uma classificacao objetiva; nunca se infere intencao do aluno).
// Score de aderencia, percentual de aderencia e score de fidelidade sao DELIBERADAMENTE fora de
// V1 — este arquivo so' decide CORRESPONDENCIA, nunca produz um numero resumindo o quanto foi
// cumprido.

export type ExecutionOrigin = 'automatic' | 'student' | 'coach';
// 'corresponding' = atividade correspondente a uma prescricao (aderencia confirmada,
// independente de quao fiel foi a execucao). 'alternative' = atividade realizada que nao
// corresponde a nenhuma prescricao aplicavel (nunca "extra"/"substituicao" — ver correcao acima).
// 'ambiguous' = plausivel mas sem evidencia suficiente pra decidir sozinho.
export type ExecutionClassification = 'corresponding' | 'alternative' | 'ambiguous';
// Plano de reconciliacao (resultado de planClassification, sem escrita).
export type ReconciliationPlan =
  | { kind: 'link'; session: { id: string }; evidence: EvidenceItem[]; matchMethod: string }
  | { kind: 'ambiguous'; matchMethod?: string; candidates: Array<{ session: { id: string }; evidence: EvidenceItem[] }> }
  | { kind: 'alternative' };

function classificationOf(plan: ReconciliationPlan): ExecutionClassification {
  return plan.kind === 'link' ? 'corresponding' : plan.kind;
}

// Observacao que REPRESENTA seu evento fisico: sem evento, 'unique', ou a canonica do evento. Observacoes nao-canonicas nao competem.
function isEventRepresentative(row: { id: string; physicalIdentityStatus?: string | null; physicalEventId?: string | null; physicalCanonicalActivityLogId?: string | null }): boolean {
  if (row.physicalIdentityStatus === 'matched' && row.physicalEventId && row.physicalCanonicalActivityLogId) return row.physicalCanonicalActivityLogId === row.id;
  return true;
}

export type EventReconciliationOutcome =
  | 'unchanged' | 'linked' | 'link_moved' | 'duplicate_links_collapsed' | 'candidates' | 'alternative'
  | 'human_preserved' | 'kept_materialized_alternative' | 'skipped_identity_ambiguous' | 'classified_ambiguous_identity' | 'skipped_no_canonical';

export interface EventReconciliationResult {
  activityLogId: string;
  physicalEventId: string | null;
  canonicalActivityLogId: string | null;
  classification: ExecutionClassification | null;
  outcome: EventReconciliationOutcome;
  changed: boolean;
  conflicts: number;
}

export interface UserReconciliationSummary {
  dryRun: boolean;
  events: number;
  changed: number;
  conflicts: number;
  byOutcome: Record<string, number>;
  results: EventReconciliationResult[];
}

export type LinkStatus = 'active' | 'revoked' | 'candidate';

// Evidencia nunca e' um score: e' a lista dos criterios canonicos avaliados e o resultado de cada
// um. matched:null significa "dado indisponivel pra avaliar este criterio" — NUNCA tratado como
// incompativel (null != false, exatamente como null != zero pro dado numerico em si).
export interface EvidenceItem {
  criterion: 'same_athlete' | 'compatible_modality' | 'same_local_day' | 'distance_compatible' | 'duration_compatible';
  matched: boolean | null;
}

// Tolerancia relativa pra' considerar distancia/duracao observadas "consistentes" com o prescrito.
// Nomeadas e exportadas de proposito (ver pedido: "nenhum limiar arbitrario escondido").
//
// IMPORTANTE (correcao 02/10/2026): estas constantes NUNCA vetam uma correspondencia quando ha'
// um UNICO candidato plausivel — correspondencia nao exige execucao perfeita (12km prescritos e
// 10km realizados ainda E' o mesmo treino, a diferenca e' informacao de EXECUCAO, nao motivo pra
// dizer "nao e' esta prescricao"). A UNICA funcao legitima destas constantes e' DESAMBIGUAR entre
// 2+ prescricoes igualmente plausiveis em modalidade+dia (ver buildEvidence/classify): quando ha'
// multiplos candidatos, distancia/duracao observadas ajudam a identificar qual delas e'
// consistente com o que foi executado.
export const DISTANCE_TOLERANCE_RATIO = 0.25;
export const DURATION_TOLERANCE_RATIO = 0.3;

// null quando qualquer um dos dois lados nao tem o dado — nunca trata ausencia como zero/divergencia.
function ratioCompatible(prescribed: number | null | undefined, observed: number | null | undefined, toleranceRatio: number): boolean | null {
  if (prescribed == null || observed == null) return null;
  const diff = Math.abs(observed - prescribed);
  return diff <= prescribed * toleranceRatio;
}

// Evidencia canonica completa pra' um par (sessao candidata, atividade) — ja' assume que modalidade
// e dia local foram checados na selecao de candidatos (por isso aqui sempre reportam true; sao
// precondicoes de ate' chegar a esta funcao, nao recalculadas). same_athlete tambem e' sempre true
// (a query so' busca sessoes do mesmo userId da atividade) — incluido explicitamente na lista por
// ser um criterio canonico realmente usado, nao decoracao.
function buildEvidence(session: { distanceKm: number | null; durationMin: number | null }, activity: { distanceMeters: number | null; durationSec: number | null }): EvidenceItem[] {
  const observedKm = activity.distanceMeters != null ? activity.distanceMeters / 1000 : null;
  const observedMin = activity.durationSec != null ? activity.durationSec / 60 : null;
  return [
    { criterion: 'same_athlete', matched: true },
    { criterion: 'compatible_modality', matched: true },
    { criterion: 'same_local_day', matched: true },
    { criterion: 'distance_compatible', matched: ratioCompatible(session.distanceKm, observedKm, DISTANCE_TOLERANCE_RATIO) },
    { criterion: 'duration_compatible', matched: ratioCompatible(session.durationMin, observedMin, DURATION_TOLERANCE_RATIO) },
  ];
}

// Usado SOMENTE pra' desambiguar entre 2+ candidatos plausiveis (nunca pra' vetar um candidato
// unico — ver comentario das constantes de tolerancia acima). "Consistente" = nenhum criterio
// AVALIADO (matched != null) deu false; criterios sem dado disponivel (null) sao ignorados.
function isFullyConsistent(evidence: EvidenceItem[]): boolean {
  return evidence.every((item) => item.matched !== false);
}

// Read model de Prescrito x Realizado pro aluno (02/10/2026). Puramente agregacao de dados JA'
// decididos por classify()/linkManually()/confirmCandidate() — nunca redecide correspondencia
// aqui. Consumido pelo TrainingPlansService (presentPlan) pra montar a resposta das telas de
// semana/historico do mobile sem duplicar a logica de reconciliacao no controller/mobile.
export interface ReconciliationActivitySummary {
  id: string;
  provider: string;
  startedAt: Date;
  // Dia local do atleta (YYYY-MM-DD, mesma convencao de TrainingSession.scheduledDate/isoDate no
  // mobile) — calculado aqui com utcOffsetMinutes pra nunca expor o chamador a bug de fuso horario
  // (startedAt sozinho e' um instante UTC real, nao o "dia" que o aluno reconhece).
  isoDate: string;
  distanceMeters: number | null;
  durationSec: number | null;
  avgPaceSecondsKm: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  // Media de cadencia ja' normalizada (ActivityTimeSeriesService, passos/minuto) — null quando a
  // atividade nao tem serie temporal de cadencia processada ainda (nunca inventado como 0).
  cadenceAvg: number | null;
}

// Prefixo do linkId da opcao "nenhum destes — foi um treino extra" (resposta NAO) enviada junto dos candidatos reais; aplicativos antigos a enviam ao mesmo endpoint de confirmacao.
export const EXTRA_ANSWER_LINK_PREFIX = 'extra:';

export interface ReconciliationCandidateOption {
  linkId: string;
  trainingSessionId: string;
  sessionTitle: string;
  sessionModality: string;
  sessionDate: string;
}

export interface WeekReconciliation {
  // Sessoes prescritas com vinculo ATIVO ('corresponding') nesta janela — chave e' o
  // trainingSessionId, pra' o chamador so' fazer .get(session.id) ao montar cada card.
  activeLinkBySessionId: Map<string, { activityLog: ReconciliationActivitySummary; matchMethod: string | null }>;
  // Atividades 'alternative' SEM TrainingSession sintetica materializada nesta janela — aparecem
  // como card independente no read model (nunca escondidas so' por nao terem prescricao).
  alternativeActivities: ReconciliationActivitySummary[];
  // Atividades 'ambiguous' com candidatos pendentes de confirmacao humana nesta janela.
  pendingActivities: Array<{ activityLog: ReconciliationActivitySummary; candidates: ReconciliationCandidateOption[] }>;
}

function toActivitySummary(activity: {
  id: string;
  provider: string;
  startedAt: Date;
  utcOffsetMinutes: number | null;
  distanceMeters: number | null;
  durationSec: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  cadenceAvg: number | null;
}): ReconciliationActivitySummary {
  // Mesma formula ja usada pro Strava (strava.service.ts) — pace nunca persistido, sempre
  // derivado na leitura, pra nunca divergir do par distancia/duracao observado.
  const avgPaceSecondsKm =
    activity.distanceMeters && activity.distanceMeters > 0 && activity.durationSec != null
      ? Math.round(activity.durationSec / (activity.distanceMeters / 1000))
      : null;
  return {
    id: activity.id,
    provider: activity.provider,
    startedAt: activity.startedAt,
    isoDate: localCalendarDate(activity.startedAt, activity.utcOffsetMinutes),
    distanceMeters: activity.distanceMeters,
    durationSec: activity.durationSec,
    avgPaceSecondsKm,
    avgHeartRateBpm: activity.avgHeartRateBpm,
    maxHeartRateBpm: activity.maxHeartRateBpm,
    cadenceAvg: activity.cadenceAvg,
  };
}

// start-time-utc-offset da Polar (e equivalente de outros provedores) segue a convencao
// "realUTC = localAsUtc - offsetMinutes" (ver parseStartedAt em polar-activity-ingestion.service.ts)
// — logo local = realUTC + offsetMinutes. Sem offset informado, America/Sao_Paulo (lote 4, 26/10/2026; antes: UTC puro). REGRA UNICA em common/local-date.ts, compartilhada
// com a Evolucao, o relatorio semanal, o calendario, a carga e os tenis. Vinculos ja' existentes NAO sao refeitos: so' classificacoes novas usam o dia SP.
export function localCalendarDate(startedAt: Date, utcOffsetMinutes: number | null): string {
  return activityLocalDate(startedAt, utcOffsetMinutes);
}

// Campos de WorkoutCompletion que a sessao sintetica (atividade extra materializada) ja' tem por si so'. Qualquer OUTRO campo preenchido e'
// conteudo do aluno (esforco, notas, comportamento, dor, estado pre-treino...) e nunca pode ser descartado.
const SYNTHETIC_COMPLETION_FIELDS = new Set(['id', 'sessionId', 'userId', 'status', 'completedAt', 'distanceKm', 'durationMin', 'avgHeartRate', 'maxHeartRate', 'source', 'createdAt', 'updatedAt']);
function completionHasStudentContent(completion: Record<string, unknown>): boolean {
  return Object.entries(completion).some(([key, value]) => !SYNTHETIC_COMPLETION_FIELDS.has(key) && value != null && value !== '' && value !== false && !(Array.isArray(value) && value.length === 0));
}

// Janela (dias) entre o dia da atividade e o dia da sessao prescrita para o aluno poder vincular manualmente (treino feito em outro dia da semana).
export const STUDENT_LINK_MAX_DAYS = 6;

// Busca manual do aluno (Conciliacao, 30/10/2026): treinos prescritos ate N dias antes/depois da atividade (o aluno pode sincronizar tarde ou vincular semanas anteriores).
export const LINKABLE_WINDOW_DAYS = 60;

export interface LinkOptions {
  // o aluno confirmou o aviso 'nao parece compativel'
  confirmIncompatible?: boolean;
  // 'part' = a atividade e' parte complementar da mesma sessao (varios registros de uma mesma execucao)
  role?: 'primary' | 'part';
  // quando o treino e a atividade ja' tem feedback: qual fica como principal (o outro e' preservado como versao)
  keepFeedback?: 'session' | 'activity';
}

function feedbackSummary(completion: Record<string, unknown>): Record<string, unknown> {
  return { perceivedEffort: completion.perceivedEffort ?? null, painFlag: completion.painFlag ?? null, postWorkoutFeeling: completion.postWorkoutFeeling ?? null, completedAt: completion.completedAt ?? null, status: completion.status ?? null };
}

function startOfLocalDay(startedAt: Date, utcOffsetMinutes: number | null): Date {
  return activityLocalDayStart(startedAt, utcOffsetMinutes);
}

// Janela de busca das observacoes que podem formar um par ambiguo (mesma da avaliacao de identidade, so' performance).
const AMBIGUITY_PEER_WINDOW_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class SessionExecutionLinkService {
  private readonly logger = new Logger(SessionExecutionLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Existencia, nunca contagem — e' assim que "mesma atividade por dois providers" ou "duas
  // atividades candidatas" nunca viram duas execucoes contadas: quem le pergunta "existe vinculo
  // ativo?", nao "quantos vinculos existem?".
  async hasActiveLink(trainingSessionId: string): Promise<boolean> {
    const count = await this.prisma.sessionExecutionLink.count({ where: { trainingSessionId, status: 'active' } });
    return count > 0;
  }

  async getActiveLinkForActivity(activityLogId: string) {
    return this.prisma.sessionExecutionLink.findFirst({ where: { activityLogId, status: 'active' } });
  }

  // Agrega o estado de reconciliacao de um usuario numa janela de datas — pra' o mobile mostrar
  // Prescrito x Realizado sem reproduzir a logica de classify()/linkManually() em outro lugar.
  // rangeEndExclusive e' EXCLUSIVO (ver chamador — tipicamente addDays(weekStart, 7)).
  async getWeekReconciliation(userId: string, rangeStart: Date, rangeEndExclusive: Date): Promise<WeekReconciliation> {
    const activities = await this.prisma.activityLog.findMany({
      where: { userId, startedAt: { gte: rangeStart, lt: rangeEndExclusive } },
    });
    if (activities.length === 0) {
      return { activeLinkBySessionId: new Map(), alternativeActivities: [], pendingActivities: [] };
    }

    const activityIds = activities.map((a) => a.id);
    const activityById = new Map(activities.map((a) => [a.id, a]));
    // 3C.2: uma atividade fisica = um cartao. Cada observacao lida mapeia para o seu evento; quem REPRESENTA o evento na saida e' a
    // observacao canonica (3A). As regras de matching nao mudam — so' a apresentacao das ativas/alternativas/candidatas.
    const eventPicks = await pickCanonicalPerEvent(activities, (ids) => this.prisma.activityLog.findMany({ where: { userId, id: { in: ids } } }));
    const eventByReadId = new Map<string, (typeof eventPicks)[number]>();
    for (const pick of eventPicks) for (const member of pick.members) eventByReadId.set(member.id, pick);

    const links = await this.prisma.sessionExecutionLink.findMany({
      where: { activityLogId: { in: activityIds }, status: { in: ['active', 'candidate'] } },
      include: { trainingSession: { select: { id: true, title: true, modality: true, scheduledDate: true } } },
    });

    const activeLinkBySessionId = new Map<string, { activityLog: ReconciliationActivitySummary; matchMethod: string | null }>();
    const candidatesByActivityId = new Map<string, ReconciliationCandidateOption[]>();
    const linkedActivityIds = new Set<string>();

    for (const link of links) {
      const activity = activityById.get(link.activityLogId);
      if (!activity) continue;
      if (link.status === 'active') {
        const pick = eventByReadId.get(link.activityLogId);
        for (const member of pick?.members ?? [activity]) linkedActivityIds.add(member.id);
        if (pick) linkedActivityIds.add(pick.row.id);
        activeLinkBySessionId.set(link.trainingSessionId, {
          activityLog: toActivitySummary(pick?.row ?? activity),
          matchMethod: link.matchMethod,
        });
      } else {
        const list = candidatesByActivityId.get(link.activityLogId) ?? [];
        list.push({
          linkId: link.id,
          trainingSessionId: link.trainingSessionId,
          sessionTitle: link.trainingSession.title,
          sessionModality: link.trainingSession.modality,
          sessionDate: link.trainingSession.scheduledDate.toISOString().slice(0, 10),
        });
        candidatesByActivityId.set(link.activityLogId, list);
      }
    }

    // Atividades ja' materializadas como TrainingSession sintetica 'device_extra' nesta janela —
    // ja' aparecem no plano via essa sessao (o chamador as apresenta usando os dados da propria
    // sessao/completion sintetica), entao NAO entram de novo aqui pra' evitar duplicidade.
    const materializedSessions = await this.prisma.trainingSession.findMany({
      where: { userId, origin: 'device_extra', scheduledDate: { gte: rangeStart, lt: rangeEndExclusive } },
      select: { structure: true },
    });
    const materializedActivityIds = new Set(
      materializedSessions
        .map((s) => (s.structure as { activityLogId?: string } | null)?.activityLogId)
        .filter((id): id is string => Boolean(id)),
    );

    // Alternativas: um cartao por EVENTO (canonica), nunca um por observacao; fora se qualquer observacao do evento tem vinculo ativo ou
    // sessao sintetica ja' materializada.
    const alternativeActivities = eventPicks
      .filter(
        (pick) =>
          pick.members.some((m) => m.executionClassification === 'alternative') &&
          !pick.members.some((m) => linkedActivityIds.has(m.id) || materializedActivityIds.has(m.id)) &&
          !materializedActivityIds.has(pick.row.id),
      )
      .map((pick) => toActivitySummary(pick.row));

    // Candidatas: um cartao por evento; as opcoes de todas as observacoes do evento sao reunidas (sem repetir a mesma sessao).
    const pendingByEvent = new Map<string, { pick: (typeof eventPicks)[number]; candidates: ReconciliationCandidateOption[] }>();
    for (const [activityId, candidates] of candidatesByActivityId.entries()) {
      const pick = eventByReadId.get(activityId);
      if (!pick || pick.members.some((m) => linkedActivityIds.has(m.id))) continue;
      const entry = pendingByEvent.get(pick.row.id) ?? { pick, candidates: [] };
      for (const candidate of candidates) {
        if (!entry.candidates.some((c) => c.trainingSessionId === candidate.trainingSessionId)) entry.candidates.push(candidate);
      }
      pendingByEvent.set(pick.row.id, entry);
    }
    const pendingActivities = [...pendingByEvent.values()].map(({ pick, candidates }) => ({
      activityLog: toActivitySummary(pick.row),
      candidates,
    }));

    return { activeLinkBySessionId, alternativeActivities, pendingActivities };
  }

  // Motor de Reconciliacao V1. Decide entre 4 situacoes (ver pedido original; PASSO A-F do
  // modelo mental da correcao de 02/10/2026):
  //   A. correspondencia clara -> 'corresponding' (vinculo ATIVO criado). NUNCA exige execucao
  //      perfeita — um unico candidato plausivel (modalidade+dia) e' suficiente pra correspondencia,
  //      mesmo com distancia/duracao/pace diferentes do prescrito (isso e' CARACTERISTICA DA
  //      EXECUCAO, pergunta diferente de CORRESPONDENCIA — ver cabecalho do arquivo).
  //   B. incompatibilidade de modalidade com uma prescricao especifica -> nunca marca aquela sessao
  //      como executada (ela so' nao entra na lista de candidatos; nao ha' um "status B" proprio;
  //      nunca se infere "substituicao").
  //   C. plausivel porem ambiguo -> 'ambiguous' (0 ou mais linhas 'candidate' registradas pra'
  //      confirmacao humana futura, conforme o motivo da ambiguidade). So' acontece quando HA'
  //      multiplos candidatos e a evidencia disponivel NAO consegue distinguir um deles.
  //   D. sem prescricao correspondente -> 'alternative' (nunca "extra"/"substituicao"/"erro" —
  //      classificacao puramente objetiva, sem inferir intencao do aluno).
  // Idempotente: se a atividade ja' foi classificada (por este metodo ou por uma decisao manual),
  // NAO reclassifica sozinho — corrigir uma classificacao existente e' sempre uma acao explicita
  // (linkManually/markExtra/confirmCandidate), nunca um efeito colateral de rodar classify() de novo.
  // Retorna null quando a observacao tem identidade AMBIGUA e uma observacao do mesmo par ja' carrega uma execucao (D1, 10/2026): ela fica
  // preservada e sem classificacao automatica ate a ambiguidade ser resolvida (identidade que se resolve ou confirmacao humana).
  async classify(activityLogId: string): Promise<ExecutionClassification | null> {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');
    // 3B: observacao de um evento fisico com varias observacoes NAO e' reconciliada isoladamente — a unidade e' o PhysicalEvent.
    if (activity.physicalIdentityStatus === 'matched' && activity.physicalEventId) {
      const result = await this.reconcileEvent(activityLogId);
      if (result.classification) return result.classification;
      if (result.outcome === 'skipped_identity_ambiguous') return null; // evento preservado por ambiguidade com outra observacao que ja' conta: nao classifica isoladamente
    }
    if (activity.executionClassification) {
      return activity.executionClassification as ExecutionClassification;
    }
    // D1: identidade ambigua = possivel duplicata da MESMA execucao. Mesma protecao do reconcileEvent, sob a trava por aluno.
    if (activity.physicalIdentityStatus === 'ambiguous') {
      return this.withUserLock(activity.userId, (service) => service.classifyAmbiguousLocked(activityLogId));
    }
    const plan = await this.planClassification(activity, new Set([activity.id]));
    await this.applyPlan(activity, plan);
    return classificationOf(plan);
  }

  private async classifyAmbiguousLocked(activityLogId: string): Promise<ExecutionClassification | null> {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');
    if (activity.physicalIdentityStatus !== 'ambiguous') return this.classify(activityLogId); // a identidade mudou enquanto esperava a trava
    return this.classifyAmbiguousObservation(activity);
  }

  // Observacoes em AMBIGUIDADE com esta: mesmo aluno e veredito registrado na evidencia de identidade de um dos lados (a avaliacao grava os dois
  // lados, mas um lado pode estar defasado — por isso olha-se a mencao em qualquer sentido). Entre duas observacoes 'ambiguous' vale qualquer
  // veredito nao-distinto; frente a uma observacao JA' em evento (matched/unique) so' o veredito 'ambiguous' conta (ex.: uma observacao divergente
  // das duas fontes que concordam entre si). `exclude` = ids a ignorar (ex.: os proprios membros de um evento).
  private async ambiguityPeers(activity: ActivityLog, exclude: Set<string> = new Set()): Promise<ActivityLog[]> {
    type Comparison = { activityLogId?: unknown; verdict?: unknown };
    const comparisonsOf = (row: { physicalIdentityEvidence?: unknown }): Comparison[] => {
      const evidence = row.physicalIdentityEvidence as { comparisons?: unknown } | null | undefined;
      return Array.isArray(evidence?.comparisons) ? (evidence.comparisons as Comparison[]) : [];
    };
    // Uma observacao 'unique' nao tem aresta de ambiguidade real (mencao so' em evidencia defasada de outro lado): nao conta como vizinha.
    const eligible = (row: ActivityLog) => row.physicalIdentityStatus === 'ambiguous' || row.physicalIdentityStatus === 'matched';
    const edge = (from: ActivityLog, to: ActivityLog) => eligible(from) && eligible(to) && comparisonsOf(from).some((c) => c.activityLogId === to.id && (c.verdict === 'ambiguous' || (c.verdict !== 'distinct' && from.physicalIdentityStatus === 'ambiguous' && to.physicalIdentityStatus === 'ambiguous')));
    const candidates = await this.prisma.activityLog.findMany({
      where: {
        userId: activity.userId,
        id: { not: activity.id },
        startedAt: { gte: new Date(activity.startedAt.getTime() - AMBIGUITY_PEER_WINDOW_MS), lte: new Date(activity.startedAt.getTime() + AMBIGUITY_PEER_WINDOW_MS) },
      },
    });
    return candidates.filter((row) => row.userId === activity.userId && !exclude.has(row.id) && (edge(activity, row) || edge(row, activity)));
  }

  // D1 (opcao B): identidade ambigua = possivel duplicata, ainda nao comprovada. Se outra observacao do par JA' carrega uma execucao (vinculo ou
  // atividade adicional, automatica ou humana), esta NAO e' classificada automaticamente como uma segunda execucao (sem dupla contagem); fica
  // preservada e passivel de resolucao. Se nenhuma carrega, UMA observacao e' classificada de forma conservadora, pelas regras atuais, tratando
  // as vizinhas do par como a mesma execucao (nao como rivais). Nunca descarta, apaga nem une registros.
  private async classifyAmbiguousObservation(activity: ActivityLog, options: { dryRun?: boolean } = {}): Promise<ExecutionClassification | null> {
    if (activity.executionClassification) return activity.executionClassification as ExecutionClassification;
    const peers = await this.ambiguityPeers(activity);
    if (peers.some((peer) => peer.executionClassification === 'corresponding' || peer.executionClassification === 'alternative')) return null;
    const plan = await this.planClassification(activity, new Set([activity.id, ...peers.map((peer) => peer.id)]));
    if (!options.dryRun) await this.applyPlan(activity, plan);
    return classificationOf(plan);
  }

  // Observacao PROTEGIDA contra "des-contar": tem decisao humana, sessao sintetica materializada (feedback do aluno) ou vinculo ativo com sessao que ja'
  // tem feedback (WorkoutCompletion). Des-contar uma assim deixaria o feedback contando por outro caminho (volume pela sessao/feedback), entao ela NUNCA e'
  // des-contada em silencio. Nada aqui altera ou apaga sessao prescrita, sessao sintetica ou feedback.
  private async isProtectedFromUncount(row: ActivityLog, activeLinks: Array<{ activityLogId: string; trainingSessionId: string }>): Promise<boolean> {
    if (row.executionClassifiedBy === 'coach' || row.executionClassifiedBy === 'student') return true;
    if (await this.findMaterializedSessionForActivities(row.userId, new Set([row.id]))) return true;
    for (const link of activeLinks.filter((l) => l.activityLogId === row.id)) {
      const session = await this.prisma.trainingSession.findUnique({ where: { id: link.trainingSessionId }, include: { completion: { select: { id: true } } } });
      if (session?.completion) return true;
    }
    return false;
  }

  // SOMENTE LEITURA: se as observacoes (passando a contar como par ambiguo, como apos reverter uma decisao "execucoes distintas") deixariam DUAS ou mais
  // contando sem poder des-contar nenhuma delas (ambas protegidas). Nesse caso a reversao e' bloqueada pelo chamador, antes de alterar qualquer coisa.
  async previewUncount(activityLogIds: string[]): Promise<{ counting: string[]; protectedIds: string[]; conflict: boolean }> {
    const ids = [...new Set(activityLogIds)];
    const rows = (await this.prisma.activityLog.findMany({ where: { id: { in: ids } } })).filter((r) => r.executionClassification === 'corresponding' || r.executionClassification === 'alternative');
    const links = await this.prisma.sessionExecutionLink.findMany({ where: { activityLogId: { in: rows.map((r) => r.id) }, status: 'active' } });
    const protectedIds: string[] = [];
    for (const row of rows) if (await this.isProtectedFromUncount(row, links)) protectedIds.push(row.id);
    return { counting: rows.map((r) => r.id), protectedIds, conflict: protectedIds.length >= 2 };
  }

  // Reversao de uma decisao humana "execucoes distintas" (10/2026): as observacoes voltam a ser um par AMBIGUO; se ambas estiverem contando por
  // classificacao AUTOMATICA, so' uma continua (a protegida, se houver uma; senao a que carrega o vinculo ativo; senao a mais antiga) — a outra volta a
  // ficar preservada, sem contar (invariante da opcao B). Se DUAS ou mais forem protegidas nada e' des-contado (o chamador ja' bloqueou a reversao).
  async normalizeAmbiguousCluster(activityLogIds: string[]): Promise<{ cleared: string[]; conflict: string[] }> {
    const ids = [...new Set(activityLogIds)];
    if (ids.length < 2) return { cleared: [], conflict: [] };
    const first = await this.prisma.activityLog.findFirst({ where: { id: { in: ids } } });
    if (!first) return { cleared: [], conflict: [] };
    return this.withUserLock(first.userId, (service) => service.normalizeAmbiguousClusterLocked(ids, first.userId));
  }

  private async normalizeAmbiguousClusterLocked(ids: string[], userId: string): Promise<{ cleared: string[]; conflict: string[] }> {
    const rows = (await this.prisma.activityLog.findMany({ where: { id: { in: ids } } })).filter((r) => r.userId === userId && r.physicalIdentityStatus === 'ambiguous');
    const counting = rows.filter((r) => r.executionClassification === 'corresponding' || r.executionClassification === 'alternative');
    if (counting.length <= 1) return { cleared: [], conflict: [] };
    const links = await this.prisma.sessionExecutionLink.findMany({ where: { activityLogId: { in: counting.map((r) => r.id) }, status: { in: ['active', 'candidate'] } } });
    const activeLinks = links.filter((l) => l.status === 'active');
    const protectedRows: ActivityLog[] = [];
    for (const row of counting) if (await this.isProtectedFromUncount(row, activeLinks)) protectedRows.push(row);
    if (protectedRows.length >= 2) return { cleared: [], conflict: protectedRows.map((r) => r.id) };
    const hasActiveLink = (r: ActivityLog) => activeLinks.some((l) => l.activityLogId === r.id);
    const isProtected = (r: ActivityLog) => protectedRows.some((p) => p.id === r.id);
    const ordered = [...counting].sort((a, b) => Number(isProtected(b)) - Number(isProtected(a)) || Number(hasActiveLink(b)) - Number(hasActiveLink(a)) || a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : 1));
    const cleared: string[] = [];
    for (const row of ordered.slice(1)) {
      for (const link of links.filter((l) => l.activityLogId === row.id && l.origin === 'automatic')) {
        await this.prisma.sessionExecutionLink.update({ where: { id: link.id }, data: { status: 'revoked', revokedAt: new Date(), note: link.note ?? 'identity_decision_reverted' } });
      }
      await this.prisma.activityLog.update({ where: { id: row.id }, data: { executionClassification: null, executionClassifiedAt: null, executionClassifiedBy: null } });
      cleared.push(row.id);
    }
    return { cleared, conflict: [] };
  }

  // Resolucao HUMANA (aluno ou treinador): confirma que uma observacao de identidade ambigua e' uma execucao DISTINTA da vizinha — passa a contar
  // por decisao humana (prevalece sobre a automacao e e' estavel). A sessao ja' cumprida pela vizinha NAO e' reaproveitada: a atividade confirmada
  // vincula-se a outra sessao compativel do dia ou, sem ela, e' atividade adicional. A identidade (derivada dos dados) nao e' alterada.
  async confirmDistinctActivity(params: { userId: string; activityLogId: string; origin: 'student' | 'coach'; note?: string | null }) {
    const since = new Date();
    const result = await this.withUserLock(params.userId, (service) => service.confirmDistinctLocked(params));
    await this.recomputeAfterCorrection(params.userId, since, { origin: params.origin, actorId: params.origin === 'student' ? params.userId : null, kind: 'link_correction' });
    return result;
  }

  private async confirmDistinctLocked(params: { userId: string; activityLogId: string; origin: 'student' | 'coach'; note?: string | null }) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: params.activityLogId } });
    if (!activity || activity.userId !== params.userId) throw new NotFoundException('Atividade nao encontrada.');
    if (activity.physicalIdentityStatus !== 'ambiguous') throw new BadRequestException('Esta atividade nao esta com identidade ambigua; nao ha o que confirmar.');
    const current = activity.executionClassification;
    if (current === 'corresponding' || current === 'alternative') {
      return { activityLogId: activity.id, classification: current as ExecutionClassification, changed: false }; // ja' conta como execucao
    }
    const plan = await this.planClassification(activity, new Set([activity.id]));
    if (plan.kind === 'link') {
      await this.linkManually({ trainingSessionId: plan.session.id, activityLogId: activity.id, origin: params.origin, matchMethod: `${plan.matchMethod}_confirmed_distinct`, evidence: plan.evidence, note: params.note ?? null });
      return { activityLogId: activity.id, classification: 'corresponding' as ExecutionClassification, changed: true };
    }
    await this.markExtra({ activityLogId: activity.id, origin: params.origin, note: params.note ?? null });
    return { activityLogId: activity.id, classification: 'alternative' as ExecutionClassification, changed: true };
  }

  // D2 (10/2026): quando uma avaliacao de identidade altera o estado de observacoes alem da que chegou (evento desfeito, formado, ambiguo, nova
  // canonica), reconcilia cada membro afetado com os servicos existentes — assim nenhuma execucao legitima fica sem classificacao nem com vinculo
  // defasado. So' o que MUDOU entra (a avaliacao informa os ids): reavaliar sem mudanca nao reprocessa nada. Observacoes do mesmo evento sao
  // reconciliadas uma vez (a reconciliacao e' por evento). Melhor esforco: nunca derruba a ingestao. `handledActivityLogId` ja' foi tratada pelo chamador.
  // Devolve true quando TODAS as observacoes afetadas foram reconciliadas (false se alguma falhou — nunca lanca).
  async reconcileAffectedByIdentity(identity: Pick<PhysicalIdentityResult, 'affectedActivityLogIds'> | null | undefined, handledActivityLogId: string | null): Promise<boolean> {
    const ids = [...new Set((identity?.affectedActivityLogIds ?? []).filter((id) => id !== handledActivityLogId))];
    if (ids.length === 0) return true;
    let allOk = true;
    try {
      const handled = handledActivityLogId ? await this.prisma.activityLog.findUnique({ where: { id: handledActivityLogId } }) : null;
      const doneEvents = new Set<string>();
      if (handled?.physicalIdentityStatus === 'matched' && handled.physicalEventId) doneEvents.add(handled.physicalEventId);
      const rows = (await this.prisma.activityLog.findMany({ where: { id: { in: ids } } })).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : 1));
      for (const row of rows) {
        if (row.physicalIdentityStatus === 'matched' && row.physicalEventId) {
          if (doneEvents.has(row.physicalEventId)) continue;
          doneEvents.add(row.physicalEventId);
        }
        try {
          if (row.physicalIdentityStatus === 'ambiguous') await this.classify(row.id);
          else await this.reconcileEvent(row.id);
        } catch (error) {
          allOk = false;
          this.logger.warn(`Falha ao reconciliar a atividade ${row.id} afetada por mudanca de identidade: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      allOk = false;
      this.logger.warn(`Falha ao reconciliar atividades afetadas por mudanca de identidade: ${error instanceof Error ? error.message : String(error)}`);
    }
    return allOk;
  }

  // Decide (SEM escrever) o que o Motor V1 faria para esta atividade. `memberIds` = ids das observacoes do MESMO evento fisico (so' a
  // propria atividade quando nao ha evento): elas nunca sao rivais entre si, e uma sessao cujo vinculo ativo pertence a elas nao esta
  // "ocupada por outra atividade". Modalidade sempre pela representacao canonica (ActivityLog legado pode guardar o enum bruto do provider).
  private async planClassification(activity: ActivityLog, memberIds: Set<string>): Promise<ReconciliationPlan> {
    const localDay = localCalendarDate(activity.startedAt, activity.utcOffsetMinutes);
    const dayStart = new Date(`${localDay}T00:00:00.000Z`);

    const sameDaySessions = await this.prisma.trainingSession.findMany({
      where: { userId: activity.userId, scheduledDate: dayStart },
      include: { executionLinks: { where: { status: 'active' } }, completion: { select: { status: true } } },
    });
    // Sessao sintetica de atividade alternativa (origin 'device_extra') nunca e' uma prescricao: nao concorre como candidata. Tampouco
    // concorre automaticamente uma sessao que o ALUNO marcou explicitamente como 'nao feito': o registro dele nao e' alterado nem o vinculo presumido; havendo uma
    // atividade compativel do dia, ela vira candidata PENDENTE de confirmacao do aluno (abaixo); se ele disser que nao e' esse treino, e' atividade adicional (alternative).
    const prescribable = sameDaySessions.filter((s) => s.origin !== 'device_extra' && s.completion?.status !== 'missed');
    // Compativel em modalidade E ainda sem vinculo ATIVO de OUTRA atividade (uma sessao ja' cumprida por outra atividade nao concorre de
    // novo). 'candidate' nao conta como "ja' vinculada" — so' 'active' representa execucao confirmada.
    const modalityCompatible = prescribable.filter((s) => modalitiesCompatible(s.modality, activity.sport));
    const candidates = modalityCompatible.filter((s) => s.executionLinks.every((link) => memberIds.has(link.activityLogId)));

    if (candidates.length === 0) {
      // Existe sessao compativel, mas todas ja' tem vinculo ativo de outra atividade (10/2026: atividade ADICIONAL => extra; antes ficava incerta) —
      // nao assume "extra", fica ambiguo. Sem nenhuma sessao compativel: atividade 'alternative' (nunca se infere "substituicao").
      // (10/2026) Outra atividade ja' cumpre aquela prescricao: esta e' atividade ADICIONAL (extra), nunca associada por palpite. O aluno pode
      // corrigir ("Vincular a treino prescrito").
      if (modalityCompatible.length > 0) return { kind: 'alternative' };
      // (26/10/2026, decisao de Elton) Treino prescrito marcado 'nao feito' pelo aluno e depois chega uma atividade compativel do mesmo dia: o sistema NAO presume o vinculo nem
      // a descarta como extra — PERGUNTA ao aluno (mesmo fluxo dos candidatos pendentes). A marcacao anterior so' muda se ele responder SIM (confirmCandidate).
      const missedCandidates = sameDaySessions.filter((s) => s.origin !== 'device_extra' && s.completion?.status === 'missed' && modalitiesCompatible(s.modality, activity.sport) && s.executionLinks.every((link) => memberIds.has(link.activityLogId)));
      if (missedCandidates.length > 0) {
        return { kind: 'ambiguous', matchMethod: 'student_marked_not_done', candidates: missedCandidates.map((session) => ({ session, evidence: buildEvidence(session, activity) })) };
      }
      return this.planWeakForce(activity, prescribable, memberIds);
    }

    if (candidates.length > 1) {
      // Multiplas prescricoes plausiveis — tenta desambiguar com a evidencia (distancia/duracao) ANTES de desistir pra ambiguidade.
      const perCandidateEvidence = candidates.map((candidate) => ({ candidate, evidence: buildEvidence(candidate, activity) }));
      const consistent = perCandidateEvidence.filter((c) => isFullyConsistent(c.evidence));
      if (consistent.length === 1) {
        return { kind: 'link', session: consistent[0].candidate, evidence: consistent[0].evidence, matchMethod: 'automatic_multi_candidate_disambiguated' };
      }
      return { kind: 'ambiguous', matchMethod: 'automatic_multi_candidate', candidates: perCandidateEvidence.map((c) => ({ session: c.candidate, evidence: c.evidence })) };
    }

    // Exatamente 1 sessao candidata — falta checar o lado da atividade: existe OUTRA atividade fisica nao-resolvida do mesmo dia tambem
    // compativel com essa sessao? Rival = outra atividade ainda NAO resolvida (null ou 'ambiguous'). NAO sao rivais: observacoes do mesmo
    // evento fisico, nem observacoes nao-canonicas de outros eventos (quem representa aquele evento e' a canonica dele).
    const onlyCandidate = candidates[0];
    const otherActivities = await this.prisma.activityLog.findMany({
      where: {
        userId: activity.userId,
        id: { not: activity.id },
        OR: [{ executionClassification: null }, { executionClassification: 'ambiguous' }],
      },
    });
    const rivals = otherActivities.filter(
      (rival) =>
        !memberIds.has(rival.id) &&
        isEventRepresentative(rival) &&
        localCalendarDate(rival.startedAt, rival.utcOffsetMinutes) === localDay &&
        modalitiesCompatible(onlyCandidate.modality, rival.sport),
    );
    const evidence = buildEvidence(onlyCandidate, activity);
    if (rivals.length > 0) {
      // Duas (ou mais) atividades compativeis para UMA prescricao: so' uma delas pode cumpri-la. Vincula a que tiver evidencia suficiente
      // (nenhum criterio avaliado divergente) quando for a UNICA; a outra vira atividade extra. Sem uma unica vencedora: ambiguo (humano decide).
      const selfConsistent = isFullyConsistent(evidence);
      const consistentRivals = rivals.filter((rival) => isFullyConsistent(buildEvidence(onlyCandidate, rival)));
      if (selfConsistent && consistentRivals.length === 0) return { kind: 'link', session: onlyCandidate, evidence, matchMethod: 'automatic_best_evidence_of_competing_activities' };
      if (!selfConsistent && consistentRivals.length === 1) return { kind: 'alternative' };
      return { kind: 'ambiguous', matchMethod: 'automatic_rival_activity', candidates: [{ session: onlyCandidate, evidence }] };
    }
    // Unica prescricao plausivel -> associa SEMPRE, independente de distancia/duracao/pace (correspondencia != fidelidade de execucao).
    return { kind: 'link', session: onlyCandidate, evidence, matchMethod: 'automatic_single_candidate' };
  }

  // Atividade 'funcional' sem nenhuma prescricao de modalidade compativel: pode corresponder a UMA musculacao/fortalecimento prescritos do dia, mas so'
  // com duracao compativel (evidencia explicita). Sem isso, ou com mais de uma sessao plausivel, e' atividade extra — nunca associacao arbitraria.
  private planWeakForce(activity: ActivityLog, prescribable: Array<{ id: string; modality: string; distanceKm: number | null; durationMin: number | null; executionLinks: Array<{ activityLogId: string }> }>, memberIds: Set<string>): ReconciliationPlan {
    const options = prescribable
      .filter((s) => weakForceCompatible(s.modality, activity.sport) && s.executionLinks.every((link) => memberIds.has(link.activityLogId)))
      .map((s) => ({ session: s, evidence: buildEvidence(s, activity) }))
      .filter((o) => o.evidence.find((e) => e.criterion === 'duration_compatible')?.matched === true);
    if (options.length === 1) return { kind: 'link', session: options[0].session, evidence: options[0].evidence, matchMethod: 'automatic_weak_modality_with_duration' };
    return { kind: 'alternative' };
  }

  private async applyPlan(activity: ActivityLog, plan: ReconciliationPlan) {
    if (plan.kind === 'link') {
      await this.linkManually({ trainingSessionId: plan.session.id, activityLogId: activity.id, origin: 'automatic', matchMethod: plan.matchMethod, evidence: plan.evidence });
      return;
    }
    if (plan.kind === 'ambiguous') {
      // Uma linha 'candidate' POR sessao plausivel, cada uma com sua propria evidencia, pra confirmacao humana futura.
      for (const { session, evidence } of plan.candidates) await this.createCandidateLink(activity, session, plan.matchMethod ?? 'automatic_multi_candidate', evidence);
      await this.setClassification(activity.id, 'ambiguous', 'automatic');
      return;
    }
    await this.setClassification(activity.id, 'alternative', 'automatic');
  }

  // ---- 3B: reconciliacao por PhysicalEvent --------------------------------------------------------------------------------------
  // Unidade logica = PhysicalEvent <-> TrainingSession. O SessionExecutionLink continua sendo a unica estrutura de vinculo; seu activityLogId
  // aponta para a observacao CANONICA atual do evento (para atividade 'unique', a propria observacao). Observacoes nao-canonicas nunca
  // carregam vinculo nem classificacao automatica (uma atividade fisica conta uma vez).
  //  - decisao HUMANA (coach/student) prevalece sempre; conflito com a automacao vira linha 'revoked' auditavel, nunca sobrescrita;
  //  - vinculo automatico ja' ativo e' ESTAVEL (so' acompanha a canonica, com supersessao); estados automaticos nao-vinculados
  //    ('alternative'/'ambiguous') sao recalculados com a semantica atual (modalidade canonica, sem rivais do mesmo evento);
  //  - idempotente: sem mudanca de evidencia nada e' escrito; dryRun calcula e descreve sem gravar.
  async reconcileEvent(activityLogId: string, options: { dryRun?: boolean } = {}): Promise<EventReconciliationResult> {
    // Trava por aluno (mesma chave da identidade fisica, 3A): reconciliacao nunca concorre com ingestao/avaliacao/outra reconciliacao do
    // mesmo aluno. Simulacao (dryRun) so' le, entao nao precisa da trava.
    if (options.dryRun) return this.reconcileEventUnlocked(activityLogId, options);
    const owner = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!owner) throw new NotFoundException('Atividade nao encontrada.');
    const result = typeof (this.prisma as { $transaction?: unknown }).$transaction !== 'function'
      ? await this.reconcileEventUnlocked(activityLogId, options)
      : await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'physical-identity:' + owner.userId}))`;
          // Mesma logica, com todas as leituras/escritas dentro da transacao que segura a trava.
          return new SessionExecutionLinkService(tx as unknown as PrismaService).reconcileEventUnlocked(activityLogId, options);
        },
        { timeout: 30_000 },
      );
    // Atividade que chega depois (sincronizacao tardia) e muda um vinculo: o relatorio da semana dela e' atualizado (versao nova; a anterior fica guardada).
    if (result.changed) scheduleWeeklyReportRefresh(owner.userId, localCalendarDate(owner.startedAt, owner.utcOffsetMinutes));
    return result;
  }

  private async reconcileEventUnlocked(activityLogId: string, options: { dryRun?: boolean } = {}): Promise<EventReconciliationResult> {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');
    const dryRun = options.dryRun === true;
    const base = { activityLogId, physicalEventId: activity.physicalEventId ?? null };

    // 1) Evento e observacao canonica.
    let members: ActivityLog[] = [activity];
    let canonical: ActivityLog = activity;
    if (activity.physicalIdentityStatus === 'ambiguous') {
      // D1: identidade ambigua nao e' reconciliada como evento. Ja' classificada: nada a fazer. Sem classificacao: so' e' classificada (de forma
      // conservadora, uma unica observacao do par) se nenhuma outra observacao do par ja' carrega a execucao; senao fica preservada, sem contar.
      const current = (activity.executionClassification as ExecutionClassification | null) ?? null;
      if (current) return { ...base, canonicalActivityLogId: null, classification: current, outcome: 'skipped_identity_ambiguous', changed: false, conflicts: 0 };
      const classified = await this.classifyAmbiguousObservation(activity, { dryRun: options.dryRun });
      return { ...base, canonicalActivityLogId: null, classification: classified, outcome: classified ? 'classified_ambiguous_identity' : 'skipped_identity_ambiguous', changed: classified !== null, conflicts: 0 };
    }
    if (activity.physicalIdentityStatus === 'matched' && activity.physicalEventId) {
      const all = await this.prisma.activityLog.findMany({ where: { userId: activity.userId, physicalEventId: activity.physicalEventId } });
      members = all.filter((m) => m.physicalEventId === activity.physicalEventId && m.userId === activity.userId);
      if (!members.some((m) => m.id === activity.id)) members.push(activity);
      const canonicalId = activity.physicalCanonicalActivityLogId ?? members.find((m) => m.physicalCanonicalActivityLogId)?.physicalCanonicalActivityLogId ?? null;
      const found = canonicalId ? members.find((m) => m.id === canonicalId) : undefined;
      if (!found) {
        return { ...base, canonicalActivityLogId: null, classification: null, outcome: 'skipped_no_canonical', changed: false, conflicts: 0 };
      }
      canonical = found;
    }
    const memberIds = new Set(members.map((m) => m.id));
    const others = members.filter((m) => m.id !== canonical.id);

    const links = await this.prisma.sessionExecutionLink.findMany({ where: { activityLogId: { in: [...memberIds] }, status: { in: ['active', 'candidate'] } } });
    const memberLinks = links.filter((l) => memberIds.has(l.activityLogId));
    const activeLinks = memberLinks.filter((l) => l.status === 'active');
    const writes: Array<() => Promise<unknown>> = [];
    const isHumanOrigin = (origin: string | null | undefined) => origin === 'coach' || origin === 'student';
    const humanActive = activeLinks.filter((l) => isHumanOrigin(l.origin));
    // "Nao feito" explicito do aluno x vinculo automatico: o registro do aluno prevalece — o vinculo vira historico revogado e o evento e'
    // recalculado (atividade adicional se nenhuma outra sessao compativel). Decisao humana de vinculo (coach/student) nao e' tocada aqui.
    const explicitNotDoneLinkIds = new Set<string>();
    for (const link of activeLinks.filter((l) => !isHumanOrigin(l.origin))) {
      const linkedSession = await this.prisma.trainingSession.findUnique({ where: { id: link.trainingSessionId }, include: { completion: { select: { status: true } } } });
      if (linkedSession?.completion?.status === 'missed') explicitNotDoneLinkIds.add(link.id);
    }
    const effectiveActiveLinks = activeLinks.filter((l) => !explicitNotDoneLinkIds.has(l.id));
    const humanClassified = members.filter((m) => m.executionClassification && isHumanOrigin(m.executionClassifiedBy));
    for (const link of memberLinks.filter((l) => explicitNotDoneLinkIds.has(l.id))) {
      writes.push(() => this.prisma.sessionExecutionLink.update({ where: { id: link.id }, data: { status: 'revoked', revokedAt: new Date(), note: link.note ?? 'explicit_not_done_by_student' } }));
    }
    const quarantine = () => {
      // Observacoes nao-canonicas nao carregam classificacao AUTOMATICA (a execucao e' contada uma vez, pela canonica). Humana fica.
      for (const m of others) {
        if (m.executionClassification && !isHumanOrigin(m.executionClassifiedBy)) {
          writes.push(() => this.prisma.activityLog.update({ where: { id: m.id }, data: { executionClassification: null, executionClassifiedAt: null, executionClassifiedBy: null } }));
        }
      }
    };
    const revoke = (link: { id: string; note: string | null }, note: string, supersededByLinkId: string | null = null) =>
      writes.push(() => this.prisma.sessionExecutionLink.update({ where: { id: link.id }, data: { status: 'revoked', revokedAt: new Date(), note: link.note ?? note, supersededByLinkId } }));
    let outcome: EventReconciliationOutcome = 'unchanged';
    let conflicts = 0;
    let finalClassification = (canonical.executionClassification as ExecutionClassification | null) ?? null;

    if (humanActive.length > 0 || humanClassified.length > 0) {
      // 2) Decisao humana prevalece: a automacao nunca a substitui. Vinculos automaticos do mesmo evento viram historico revogado
      // (duplicata da decisao humana) e o conflito, se houver, fica auditavel como linha 'revoked' que nenhum consumidor le.
      outcome = 'human_preserved';
      const automaticLinks = memberLinks.filter((l) => !isHumanOrigin(l.origin));
      for (const link of automaticLinks) revoke(link, 'superseded_by_human_decision_in_same_event');
      for (const m of members) {
        const bearsHuman = humanClassified.some((h) => h.id === m.id) || humanActive.some((l) => l.activityLogId === m.id);
        if (!bearsHuman && m.executionClassification && !isHumanOrigin(m.executionClassifiedBy)) {
          writes.push(() => this.prisma.activityLog.update({ where: { id: m.id }, data: { executionClassification: null, executionClassifiedAt: null, executionClassifiedBy: null } }));
        }
      }
      const humanSessionId = humanActive[0]?.trainingSessionId ?? null;
      const wouldBe = await this.planClassification(canonical, memberIds);
      const conflicting = wouldBe.kind === 'link' && (humanSessionId ? wouldBe.session.id !== humanSessionId : humanClassified.some((h) => h.executionClassification === 'alternative'));
      if (conflicting && wouldBe.kind === 'link') {
        conflicts = 1;
        const existingAudit = await this.prisma.sessionExecutionLink.findMany({ where: { activityLogId: canonical.id, trainingSessionId: wouldBe.session.id, status: 'revoked' } });
        if (!existingAudit.some((l) => l.matchMethod === 'automatic_conflict_with_human_decision')) {
          writes.push(() => this.prisma.sessionExecutionLink.create({
            data: {
              userId: canonical.userId, trainingSessionId: wouldBe.session.id, activityLogId: canonical.id, status: 'revoked', origin: 'automatic', revokedAt: new Date(),
              matchMethod: 'automatic_conflict_with_human_decision', evidence: wouldBe.evidence as unknown as Prisma.InputJsonValue,
              note: 'Evidencia automatica divergente de decisao humana ja registrada neste evento; a decisao humana foi preservada.',
            },
          }));
        }
      }
    } else if (effectiveActiveLinks.length > 0) {
      // 3) Vinculo automatico existente e' ESTAVEL: so' acompanha a observacao canonica (e nunca fica duplicado no mesmo evento).
      const onCanonical = effectiveActiveLinks.filter((l) => l.activityLogId === canonical.id);
      const keeper = onCanonical.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? [...effectiveActiveLinks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      const toRetire = effectiveActiveLinks.filter((l) => l.id !== keeper.id);
      if (keeper.activityLogId !== canonical.id) {
        outcome = 'link_moved';
        writes.push(async () => {
          const created = await this.prisma.sessionExecutionLink.create({
            data: {
              userId: canonical.userId, trainingSessionId: keeper.trainingSessionId, activityLogId: canonical.id, status: 'active', origin: 'automatic', confidence: keeper.confidence,
              matchMethod: 'automatic_canonical_follow', evidence: (keeper.evidence as Prisma.InputJsonValue | null) ?? undefined,
              note: `Acompanha a observacao canonica do evento fisico (vinculo anterior em ${keeper.activityLogId}).`,
            },
          });
          await this.prisma.sessionExecutionLink.update({ where: { id: keeper.id }, data: { status: 'revoked', revokedAt: new Date(), supersededByLinkId: created.id } });
          await this.prisma.activityLog.update({ where: { id: canonical.id }, data: { executionClassification: 'corresponding', executionClassifiedAt: new Date(), executionClassifiedBy: 'automatic' } });
        });
        for (const link of toRetire) revoke(link, 'duplicate_of_same_physical_event');
        finalClassification = 'corresponding';
      } else if (toRetire.length > 0) {
        outcome = 'duplicate_links_collapsed';
        for (const link of toRetire) revoke(link, 'duplicate_of_same_physical_event');
      }
      for (const link of memberLinks.filter((l) => l.status === 'candidate')) revoke(link, 'resolved_by_active_link_in_same_event');
      quarantine();
    } else {
      // 4) Sem vinculo ativo. Conjunto MISTO (D1): se uma observacao em ambiguidade com este evento (ex.: a terceira fonte, divergente das duas que
      // concordam) JA' carrega uma execucao, este evento ainda nao classificado fica preservado, sem contar, ate a ambiguidade ser resolvida —
      // senao a mesma execucao contaria duas vezes (a observacao ambigua e o evento).
      if (members.every((m) => !m.executionClassification)) {
        const neighbors: ActivityLog[] = [];
        for (const member of members) neighbors.push(...(await this.ambiguityPeers(member, memberIds)));
        if (neighbors.some((n) => n.executionClassification === 'corresponding' || n.executionClassification === 'alternative')) {
          return { ...base, canonicalActivityLogId: canonical.id, classification: null, outcome: 'skipped_identity_ambiguous', changed: false, conflicts: 0 };
        }
      }
      // Recalcula o estado automatico da canonica com a semantica atual (preservando alternativa ja' materializada).
      const materialized = await this.findMaterializedSessionForActivities(canonical.userId, memberIds);
      const current = (canonical.executionClassification as ExecutionClassification | null) ?? null;
      const alternativeInEvent = members.some((m) => m.executionClassification === 'alternative' && !isHumanOrigin(m.executionClassifiedBy));
      if (materialized && alternativeInEvent) {
        // Atividade alternativa ja' materializada como sessao sintetica: nao e' reinterpretada; a sintetica e a classificacao acompanham a canonica.
        outcome = 'kept_materialized_alternative';
        finalClassification = 'alternative';
        const structure = (materialized.structure ?? {}) as { activityLogId?: string };
        if (structure.activityLogId !== canonical.id) {
          writes.push(() => this.prisma.trainingSession.update({ where: { id: materialized.id }, data: { structure: { ...structure, activityLogId: canonical.id, provider: canonical.provider } as unknown as Prisma.InputJsonValue } }));
          outcome = 'link_moved';
        }
        if (current !== 'alternative') writes.push(() => this.setClassification(canonical.id, 'alternative', 'automatic'));
      } else {
        const plan = await this.planClassification(canonical, memberIds);
        const candidateLinks = memberLinks.filter((l) => l.status === 'candidate');
        const sameCandidates = (sessionIds: string[]) =>
          candidateLinks.length === sessionIds.length && candidateLinks.every((l) => l.activityLogId === canonical.id && sessionIds.includes(l.trainingSessionId));
        if (plan.kind === 'alternative') {
          finalClassification = 'alternative';
          if (current !== 'alternative' || candidateLinks.length > 0) {
            outcome = 'alternative';
            for (const link of candidateLinks) revoke(link, 'recomputed_as_alternative');
            writes.push(() => this.setClassification(canonical.id, 'alternative', 'automatic'));
          }
        } else if (plan.kind === 'ambiguous') {
          finalClassification = 'ambiguous';
          const planned = plan.candidates.map((c) => c.session.id);
          if (current !== 'ambiguous' || !sameCandidates(planned)) {
            outcome = 'candidates';
            for (const link of candidateLinks) revoke(link, 'recomputed');
            writes.push(() => this.applyPlan(canonical, plan));
          }
        } else {
          outcome = 'linked';
          finalClassification = 'corresponding';
          for (const link of candidateLinks) revoke(link, 'resolved_by_automatic_link');
          writes.push(() => this.applyPlan(canonical, plan));
        }
      }
      quarantine();
    }

    const changed = writes.length > 0;
    if (!dryRun) for (const write of writes) await write();
    return { ...base, canonicalActivityLogId: canonical.id, classification: finalClassification, outcome, changed, conflicts };
  }

  // Caminho explicito e idempotente para reconciliar o HISTORICO de um aluno com o conceito de PhysicalEvent. Percorre os eventos em ordem
  // cronologica estavel; nao reescreve resultados estabilizados (vinculos automaticos ativos e decisoes humanas). dryRun descreve sem gravar.
  // Pre-condicao: a identidade fisica do aluno ja' foi avaliada (evaluateUserHistory); linhas nunca avaliadas contam como evento proprio.
  async reconcileUserHistory(userId: string, options: { dryRun?: boolean } = {}): Promise<UserReconciliationSummary> {
    const logs = (await this.prisma.activityLog.findMany({ where: { userId } })).filter((l) => l.userId === userId);
    logs.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : 1));
    const seen = new Set<string>();
    const results: EventReconciliationResult[] = [];
    for (const log of logs) {
      const key = log.physicalIdentityStatus === 'matched' && log.physicalEventId ? `event:${log.physicalEventId}` : `activity:${log.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(await this.reconcileEvent(log.id, options));
    }
    const byOutcome: Record<string, number> = {};
    for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    return { dryRun: options.dryRun === true, events: results.length, changed: results.filter((r) => r.changed).length, conflicts: results.reduce((n, r) => n + r.conflicts, 0), byOutcome, results };
  }

  // Reavalia os eventos fisicos hoje ligados (ativo ou candidato) a uma sessao — chamado quando o aluno registra 'nao feito' (ou altera o
  // status) nessa sessao, para o vinculo automatico nao contradizer o registro explicito dele.
  async reconcileEventsOfSession(trainingSessionId: string): Promise<EventReconciliationResult[]> {
    const links = await this.prisma.sessionExecutionLink.findMany({ where: { trainingSessionId, status: { in: ['active', 'candidate'] } } });
    const activityIds = [...new Set(links.map((l) => l.activityLogId))];
    const results: EventReconciliationResult[] = [];
    for (const id of activityIds) results.push(await this.reconcileEvent(id));
    return results;
  }

  private async findMaterializedSessionForActivities(userId: string, activityLogIds: Set<string>) {
    const sessions = await this.prisma.trainingSession.findMany({ where: { userId, origin: 'device_extra' }, include: { completion: true } });
    return sessions.find((s) => activityLogIds.has((s.structure as { activityLogId?: string } | null)?.activityLogId ?? '')) ?? null;
  }

  // Cria uma linha 'candidate' (nunca 'active') — proposta de correspondencia ainda nao
  // confirmada. Nunca altera ActivityLog.executionClassification sozinha (o chamador decide, ja'
  // que varias candidatas podem ser criadas numa mesma chamada de classify()).
  private async createCandidateLink(
    activity: { id: string; userId: string },
    session: { id: string },
    matchMethod: string,
    evidence: EvidenceItem[],
  ) {
    return this.prisma.sessionExecutionLink.create({
      data: {
        userId: activity.userId,
        trainingSessionId: session.id,
        activityLogId: activity.id,
        status: 'candidate',
        origin: 'automatic',
        matchMethod,
        evidence: evidence as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // Promove um vinculo 'candidate' a 'active' — e' como o aluno/treinador confirma uma proposta de
  // correspondencia (requisito 8: preservar a arquitetura pra' correcao humana futura). Reusa
  // linkManually, que ja' revoga quaisquer outros vinculos (ativos OU candidatos) da MESMA
  // atividade — confirmar uma candidata automaticamente descarta as demais propostas irmas.
  async confirmCandidate(linkId: string, origin: ExecutionOrigin, note?: string | null) {
    const candidate = await this.prisma.sessionExecutionLink.findUnique({ where: { id: linkId } });
    if (!candidate) throw new NotFoundException('Candidato de vinculo nao encontrado.');
    if (candidate.status !== 'candidate') throw new BadRequestException('Este vinculo nao e um candidato pendente.');

    const since = new Date();
    // Vinculo e atualizacao da marcacao na MESMA transacao (com a trava do aluno): ou acontecem os dois, ou nenhum.
    const { link, flipped } = await this.withUserLock(candidate.userId, async (service) => {
      if (origin === 'student') {
        // Duas atividades candidatas ao mesmo treino: a segunda confirmacao nao cria um segundo vinculo ativo; o aluno pode responder NAO a ela (vira extra).
        const activity = await service.prisma.activityLog.findUnique({ where: { id: candidate.activityLogId } });
        const memberIds = activity ? (await service.eventOf(activity)).members.map((m) => m.id) : [candidate.activityLogId];
        const occupied = await service.prisma.sessionExecutionLink.count({ where: { trainingSessionId: candidate.trainingSessionId, status: 'active', activityLogId: { notIn: memberIds } } });
        if (occupied > 0) throw new BadRequestException('Este treino ja esta vinculado a outra atividade. Se esta atividade foi um treino extra, responda que nao foi este treino.');
      }
      const created = await service.linkManually({
        trainingSessionId: candidate.trainingSessionId,
        activityLogId: candidate.activityLogId,
        origin,
        matchMethod: candidate.matchMethod ?? undefined,
        evidence: (candidate.evidence as EvidenceItem[] | null) ?? undefined,
        note: note ?? candidate.note,
      });
      // Resposta SIM do aluno a um treino que ele tinha marcado 'nao feito': a marcacao anterior passa a 'realizado' (so' o status; o resto do feedback e' preservado).
      const done = origin === 'student' ? await service.markDoneAfterStudentConfirmation(candidate.trainingSessionId) : false;
      return { link: created, flipped: done };
    });
    await this.recomputeAfterCorrection(candidate.userId, since, { origin: origin === 'automatic' ? 'system' : origin, actorId: origin === 'student' ? candidate.userId : null, kind: 'link_correction', completionsChanged: flipped });
    return link;
  }

  // 'nao feito' -> 'realizado' quando o aluno confirma que a atividade corresponde ao treino. Devolve se mudou algo. Nunca cria feedback: so' atualiza o status de um que ja' existe.
  private async markDoneAfterStudentConfirmation(trainingSessionId: string): Promise<boolean> {
    const completion = await this.prisma.workoutCompletion.findUnique({ where: { sessionId: trainingSessionId }, select: { id: true, status: true } });
    if (!completion || completion.status !== 'missed') return false;
    await this.prisma.workoutCompletion.update({ where: { id: completion.id }, data: { status: 'done' } });
    return true;
  }

  // Wrapper exposto via HTTP (controller) pro ALUNO confirmar uma candidata. Checa posse ANTES de
  // confirmar — confirmCandidate() sozinho nao valida dono nenhum (uso interno/treinador ja'
  // confiava no chamador); exposto ao aluno, precisa impedir que ele confirme um linkId de outro
  // usuario so' adivinhando o id. NotFoundException tanto pra' "nao existe" quanto pra' "nao e'
  // seu" — nunca revela a um aluno que um linkId de outra pessoa existe.
  // Resposta do aluno a uma pergunta pendente, pelo MESMO endpoint de confirmacao: um linkId real = SIM; "extra:<atividade>" = NAO (compatibilidade com apps antigos, que so'
  // conhecem esse endpoint). NAO: a atividade fica registrada como extra e o treino segue como esta. Idempotente; nunca desfaz um vinculo ATIVO (o aluno usa "Desfazer vinculo").
  async answerPendingActivityAsStudent(userId: string, linkId: string, note?: string | null) {
    if (!linkId.startsWith(EXTRA_ANSWER_LINK_PREFIX)) return this.confirmCandidateAsStudent(userId, linkId, note);
    const activityLogId = linkId.slice(EXTRA_ANSWER_LINK_PREFIX.length);
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) throw new NotFoundException('Atividade nao encontrada.');
    const { members } = await this.eventOf(activity);
    const memberIds = members.map((m) => m.id);
    if ((await this.prisma.sessionExecutionLink.count({ where: { activityLogId: { in: memberIds }, status: 'active' } })) > 0) {
      throw new BadRequestException('Esta atividade ja foi vinculada a um treino prescrito. Para desfazer, use "Desfazer vinculo".');
    }
    if (activity.executionClassification === 'alternative' && activity.executionClassifiedBy === 'student') {
      return { activityLogId, classification: 'alternative' as const, revokedLinkIds: [] as string[] }; // ja respondido (toque duplo / outro aparelho)
    }
    return this.unlinkActivityAsStudent(userId, activityLogId, note ?? null);
  }

  async confirmCandidateAsStudent(userId: string, linkId: string, note?: string | null) {
    const candidate = await this.prisma.sessionExecutionLink.findUnique({ where: { id: linkId } });
    if (!candidate || candidate.userId !== userId) {
      throw new NotFoundException('Candidato de vinculo nao encontrado.');
    }
    return this.confirmCandidate(linkId, 'student', note);
  }

  // Vincula explicitamente uma atividade a uma sessao — usado tanto pela classificacao automatica
  // (caso inequivoco) quanto pela correcao manual do aluno/treinador ("este treino corresponde a
  // uma prescricao") quanto por confirmCandidate (promover uma proposta 'candidate' a 'active').
  // Qualquer vinculo anterior desta MESMA atividade — 'active' OU 'candidate' — e' revogado (nunca
  // apagado) e passa a apontar supersededByLinkId pro vinculo novo: confirmar uma correspondencia
  // automaticamente descarta as propostas candidatas irmas (elas eram alternativas pra' MESMA
  // atividade, agora resolvidas).
  async linkManually(params: {
    trainingSessionId: string;
    activityLogId: string;
    origin: ExecutionOrigin;
    confidence?: string | null;
    matchMethod?: string | null;
    evidence?: EvidenceItem[] | null;
    note?: string | null;
    // 'part' = parte complementar da mesma sessao (Conciliacao, 30/10/2026); omitido = a atividade que cumpre a sessao.
    role?: 'part' | null;
  }) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: params.activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');
    const session = await this.prisma.trainingSession.findUnique({ where: { id: params.trainingSessionId } });
    if (!session) throw new NotFoundException('Sessao de treino nao encontrada.');
    if (session.userId !== activity.userId) {
      throw new BadRequestException('A sessao de treino e a atividade pertencem a alunos diferentes.');
    }

    // Capturado ANTES de criar a linha nova, pra nao revogar a propria linha que estamos criando.
    const previousLinks = await this.prisma.sessionExecutionLink.findMany({
      where: { activityLogId: params.activityLogId, status: { in: ['active', 'candidate'] } },
      orderBy: { createdAt: 'desc' },
    });

    const link = await this.prisma.sessionExecutionLink.create({
      data: {
        userId: activity.userId,
        trainingSessionId: params.trainingSessionId,
        activityLogId: params.activityLogId,
        status: 'active',
        origin: params.origin,
        confidence: params.confidence ?? null,
        matchMethod: params.matchMethod ?? null,
        evidence: (params.evidence as unknown as Prisma.InputJsonValue | undefined) ?? undefined,
        note: params.note ?? null,
        ...(params.role ? { role: params.role } : {}),
      },
    });

    // supersededByLinkId e' @unique: se por algum motivo havia mais de um link anterior pra mesma
    // atividade (ex.: multiplas candidatas de um classify() anterior), so' o mais recente encadeia
    // pro substituto; os demais so' ficam revogados, sem encadeamento duplo no mesmo id.
    for (const [index, old] of previousLinks.entries()) {
      await this.prisma.sessionExecutionLink.update({
        where: { id: old.id },
        data: { status: 'revoked', revokedAt: new Date(), supersededByLinkId: index === 0 ? link.id : null },
      });
    }

    await this.prisma.activityLog.update({
      where: { id: params.activityLogId },
      data: { executionClassification: 'corresponding', executionClassifiedAt: new Date(), executionClassifiedBy: params.origin },
    });

    return link;
  }

  // "Este nao foi o treino prescrito" — revoga qualquer vinculo (ativo OU candidato pendente) e
  // marca explicitamente como extra, com proveniencia de quem decidiu. Tambem e' o caminho que a
  // classificacao automatica usa quando nenhuma sessao compativel existe no dia.
  async markExtra(params: { activityLogId: string; origin: ExecutionOrigin; note?: string | null }) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: params.activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');

    const previousActiveLinks = await this.prisma.sessionExecutionLink.findMany({
      where: { activityLogId: params.activityLogId, status: { in: ['active', 'candidate'] } },
    });
    for (const old of previousActiveLinks) {
      await this.prisma.sessionExecutionLink.update({
        // "note" da correcao fica no proprio link revogado (unico lugar com uma coluna de nota) —
        // quando nao havia link pra revogar, a nota nao tem onde ser persistida nesta fundacao.
        where: { id: old.id },
        data: { status: 'revoked', revokedAt: new Date(), note: params.note ?? old.note },
      });
    }

    await this.setClassification(params.activityLogId, 'alternative', params.origin);
  }

  // Revogacao "pura" (sem decidir o novo estado) — usada quando uma correcao so' remove um vinculo
  // errado sem ja' saber o que colocar no lugar. A atividade volta pra 'ambiguous' (incerta de
  // novo), nunca silenciosamente pra 'alternative' (isso exigiria uma decisao explicita via markExtra).
  async revokeLink(linkId: string) {
    const link = await this.prisma.sessionExecutionLink.findUnique({ where: { id: linkId } });
    if (!link) throw new NotFoundException('Vinculo nao encontrado.');
    if (link.status !== 'active') throw new BadRequestException('Vinculo ja nao esta ativo.');

    const since = new Date();
    await this.prisma.sessionExecutionLink.update({
      where: { id: linkId },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    const stillActive = await this.hasActiveLinkForActivity(link.activityLogId);
    if (!stillActive) {
      await this.setClassification(link.activityLogId, 'ambiguous', 'automatic');
    }
    await this.recomputeAfterCorrection(link.userId, since);
  }

  // Pos-correcao CENTRALIZADO (15/10/2026). Chamado depois de toda correcao feita por pessoa (aluno ou treinador), FORA da transacao e da trava por aluno:
  // o recalculo le series temporais e nao pode segurar a trava nem estourar o tempo da transacao. Sequencia (sem corrida):
  //   1. descobre o que mudou — historico de vinculos (createdAt/revokedAt >= since), sessoes informadas e sessoes ligadas as atividades informadas (e as
  //      outras observacoes do mesmo evento fisico);
  //   2. registra a pendencia DURAVEL das analises (CorrectionReevaluation) e marca o retrato vivo como desatualizado;
  //   3. executa os ganchos (medalhas marcam o que reavaliar; Prontuario recebe o evento corretivo) — sempre ANTES de processar;
  //   4. processa a pendencia (so' as sessoes mais recentes na hora; o resto continua pela linha duravel, pelo segundo plano e pelo varredor).
  // Nao altera vinculos, classificacao, aderencia nem feedback, nao gera treino e nao aciona agentes de prescricao. Falha nunca desfaz a decisao ja gravada e
  // nunca fica silenciosa (log de erro); a leitura descarta linha obsoleta e a pendencia segue registrada.
  async recomputeAfterCorrection(userId: string, since: Date | null, options: CorrectionOptions = {}): Promise<RecomputeResult> {
    const empty: RecomputeResult = { sessionIds: [], recomputedSessionIds: [], failedSessionIds: [], deferredSessionIds: [] };
    try {
      const ids = new Set<string>(options.sessionIds ?? []);
      let changes: LinkChange[] = [];
      if (since) {
        const margin = new Date(since.getTime() - RECOMPUTE_CLOCK_MARGIN_MS);
        changes = await this.prisma.sessionExecutionLink.findMany({
          where: { userId, OR: [{ createdAt: { gte: margin } }, { revokedAt: { gte: margin } }] },
          select: { id: true, trainingSessionId: true, activityLogId: true, status: true, origin: true, note: true, createdAt: true, revokedAt: true },
        }).then((rows) => rows.map((row): LinkChange => ({ linkId: row.id, trainingSessionId: row.trainingSessionId, activityLogId: row.activityLogId, status: row.status, origin: row.origin, note: row.note, createdAt: row.createdAt, revokedAt: row.revokedAt })));
        for (const entry of changes) ids.add(entry.trainingSessionId);
      }
      const activityIds = new Set<string>(changes.map((c) => c.activityLogId));
      if (options.activityLogIds && options.activityLogIds.length > 0) {
        // a observacao informada e as demais do mesmo evento fisico (a canonica pode ter mudado)
        const observations = await this.prisma.activityLog.findMany({ where: { userId, id: { in: options.activityLogIds } }, select: { id: true, physicalEventId: true } });
        const eventIds = [...new Set(observations.map((o) => o.physicalEventId).filter((id): id is string => id != null))];
        const peers = eventIds.length > 0 ? await this.prisma.activityLog.findMany({ where: { userId, physicalEventId: { in: eventIds } }, select: { id: true } }) : [];
        const related = [...new Set([...options.activityLogIds, ...peers.map((p) => p.id)])];
        const linked = await this.prisma.sessionExecutionLink.findMany({ where: { userId, activityLogId: { in: related } }, select: { trainingSessionId: true } });
        for (const entry of linked) ids.add(entry.trainingSessionId);
        for (const id of related) activityIds.add(id);
      }
      if (ids.size === 0 && activityIds.size === 0 && !options.force) return empty;

      const withSource = await prepareAnalysisRecompute(this.prisma, userId, [...ids], { forceSessionIds: options.forceSessionIds });

      // Datas afetadas (escopo de semanas/meses para medalhas): sessoes e atividades.
      const [sessionRows, activityRows] = await Promise.all([
        ids.size > 0 ? this.prisma.trainingSession.findMany({ where: { id: { in: [...ids] }, userId }, select: { scheduledDate: true } }) : [],
        activityIds.size > 0 ? this.prisma.activityLog.findMany({ where: { userId, id: { in: [...activityIds] } }, select: { startedAt: true, utcOffsetMinutes: true } }) : [],
      ]);
      const affectedDates = [
        ...sessionRows.map((s) => s.scheduledDate.toISOString().slice(0, 10)),
        ...activityRows.map((a) => localCalendarDate(a.startedAt, a.utcOffsetMinutes)),
        ...(options.affectedDates ?? []),
      ];

      await weeklyReportRefresh.run(userId, [...new Set(affectedDates)]);
      await correctionHooks.run({
        userId, kind: options.kind ?? 'link_correction', origin: options.origin ?? 'system', actorId: options.actorId ?? null, at: new Date(), since,
        sessionIds: [...ids], activityLogIds: [...activityIds], completionsChanged: options.completionsChanged === true, changes,
        sessionEdit: options.sessionEdit, absenceOfData: options.absenceOfData, provider: options.provider, affectedDates: [...new Set(affectedDates)].sort(),
      });

      if (withSource.length === 0 && !(await readPending(this.prisma, userId))) return { ...empty, sessionIds: [...ids] };
      const process = await processPendingReevaluation(this.prisma, userId, { syncLimit: options.syncLimit ?? DEFAULT_SYNC_LIMIT });
      return toRecomputeResult([...ids], process);
    } catch (error) {
      this.logger.error(`Pos-correcao falhou (aluno ${userId}); a pendencia segue registrada e as leituras protegidas por analysis-validity: ${error instanceof Error ? error.message : String(error)}`);
      return empty;
    }
  }

  private async hasActiveLinkForActivity(activityLogId: string): Promise<boolean> {
    const count = await this.prisma.sessionExecutionLink.count({ where: { activityLogId, status: 'active' } });
    return count > 0;
  }

  private async setClassification(activityLogId: string, classification: ExecutionClassification, origin: ExecutionOrigin) {
    await this.prisma.activityLog.update({
      where: { id: activityLogId },
      data: {
        executionClassification: classification,
        executionClassifiedAt: new Date(),
        executionClassifiedBy: origin,
      },
    });
  }

  // Materializa uma TrainingSession + WorkoutCompletion sinteticas pra uma atividade ja'
  // classificada como 'alternative' — e' o que permite ao aluno dar feedback subjetivo sobre ela
  // mais tarde (reusa o MESMO mecanismo de WorkoutCompletion.sessionId que addStudentExtraSession
  // ja' usa pro registro manual de treino extra — esse mecanismo e' LEGADO, anterior a este motor,
  // e nao e' renomeado aqui; origin='device_extra' em vez de 'student_extra' e' a unica diferenca
  // de proveniencia). Idempotente: chamar duas vezes pra mesma atividade nao duplica a sessao
  // sintetica. Sem plano ativo, nao materializa ainda (retorna null) — a atividade continua
  // 'alternative' no ActivityLog de qualquer forma, so' fica sem um lugar no calendario pra
  // receber feedback ate' existir um plano.
  async materializeExtraActivity(activityLogId: string) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');
    if (activity.executionClassification !== 'alternative') {
      throw new BadRequestException('So e possivel materializar sessao sintetica para atividades classificadas como alternative.');
    }

    const existing = await this.findMaterializedSession(activity.userId, activityLogId);
    if (existing) return { session: existing, completion: existing.completion };

    const modality = activity.sport ?? 'outra';
    const scheduledDate = startOfLocalDay(activity.startedAt, activity.utcOffsetMinutes);
    // Programa da semana em que a atividade aconteceu (uma atividade de 20/10 sincronizada tarde nao entra no programa de 26/10); sem programa daquela semana, o ativo.
    const weekPlan = await this.prisma.trainingPlan.findFirst({ where: { userId: activity.userId, startDate: { lte: scheduledDate } }, orderBy: { startDate: 'desc' } });
    const planCoversDate = weekPlan != null && scheduledDate.getTime() < weekPlan.startDate.getTime() + 7 * 86_400_000;
    const activePlan = planCoversDate ? weekPlan : await this.prisma.trainingPlan.findFirst({ where: { userId: activity.userId, status: 'active' }, orderBy: { createdAt: 'desc' } });
    if (!activePlan) return null;

    const session = await this.prisma.trainingSession.create({
      data: {
        planId: activePlan.id,
        userId: activity.userId,
        scheduledDate,
        weekday: scheduledDate.getUTCDay(),
        modality,
        title: `${modality} (extra · ${activity.provider})`,
        locationSuggestion: 'Livre',
        structure: { type: 'extra', source: 'device', provider: activity.provider, modality, activityLogId: activity.id },
        origin: 'device_extra',
      },
    });

    const completion = await this.prisma.workoutCompletion.create({
      data: {
        sessionId: session.id,
        userId: activity.userId,
        status: 'done',
        completedAt: activity.startedAt,
        distanceKm: activity.distanceMeters != null ? activity.distanceMeters / 1000 : null,
        durationMin: activity.durationSec != null ? activity.durationSec / 60 : null,
        avgHeartRate: activity.avgHeartRateBpm,
        maxHeartRate: activity.maxHeartRateBpm,
        source: 'device_extra',
      },
    });

    return { session, completion };
  }

  // Wrapper exposto via HTTP (controller) pro ALUNO pedir pra' registrar feedback sobre uma
  // atividade 'alternative' — mesmo padrao de confirmCandidateAsStudent: checa posse ANTES de
  // delegar, porque materializeExtraActivity() sozinho nao valida dono nenhum. NotFoundException
  // tanto pra "nao existe" quanto pra "nao e' sua" — nunca revela a um aluno que uma ActivityLog
  // de outra pessoa existe.
  async materializeExtraActivityAsStudent(userId: string, activityLogId: string, options: { force?: boolean } = {}) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) {
      throw new NotFoundException('Atividade nao encontrada.');
    }
    // Evita o feedback duplicado (Conciliacao, 30/10/2026): se ha' treino prescrito plausivel no mesmo dia (modalidade compativel, ainda sem outra atividade), pergunta
    // ANTES de criar um segundo registro de feedback. 'force' = o aluno respondeu que foi um treino diferente (extra). Sem treino plausivel (ex.: caminhada), nao pergunta.
    if (options.force !== true) {
      const { members } = await this.eventOf(activity);
      const memberIds = new Set(members.map((m) => m.id));
      const dayStart = new Date(`${localCalendarDate(activity.startedAt, activity.utcOffsetMinutes)}T00:00:00.000Z`);
      const sameDay = await this.prisma.trainingSession.findMany({ where: { userId, scheduledDate: dayStart }, include: { executionLinks: { where: { status: 'active' } }, completion: { select: { id: true } } } });
      const plausible = sameDay.filter((s) => !['device_extra', 'student_extra'].includes(s.origin ?? '')
        && (modalitiesCompatible(s.modality, activity.sport) || weakForceCompatible(s.modality, activity.sport))
        && s.executionLinks.every((l) => memberIds.has(l.activityLogId)));
      if (plausible.length > 0) {
        return {
          needsLinkQuestion: true as const,
          candidates: plausible.map((s) => ({ id: s.id, title: s.title, modality: s.modality, isoDate: s.scheduledDate.toISOString().slice(0, 10), hasFeedback: s.completion != null })),
        };
      }
    }
    return this.materializeExtraActivity(activityLogId);
  }

  // ── Correcao pelo ALUNO (10/2026) ─────────────────────────────────────────────────────────────────────────────────────────
  // Reaproveita linkManually/markExtra (decisao HUMANA prevalece sobre a automacao no reconciliador) e a trava por aluno da identidade fisica.
  // Nunca cria sessao, nunca soma atividade duas vezes (o vinculo sempre aponta para a observacao CANONICA do evento) e nunca apaga feedback.

  private async withUserLock<T>(userId: string, work: (service: SessionExecutionLinkService) => Promise<T>): Promise<T> {
    if (typeof (this.prisma as { $transaction?: unknown }).$transaction !== 'function') return work(this);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'physical-identity:' + userId}))`;
        return work(new SessionExecutionLinkService(tx as unknown as PrismaService));
      },
      { timeout: 30_000 },
    );
  }

  // Observacao canonica e todas as observacoes (provedores) do mesmo evento fisico da atividade.
  private async eventOf(activity: ActivityLog): Promise<{ canonical: ActivityLog; members: ActivityLog[] }> {
    if (activity.physicalIdentityStatus === 'matched' && activity.physicalEventId) {
      const all = (await this.prisma.activityLog.findMany({ where: { userId: activity.userId, physicalEventId: activity.physicalEventId } })).filter((m) => m.userId === activity.userId && m.physicalEventId === activity.physicalEventId);
      const members = all.some((m) => m.id === activity.id) ? all : [...all, activity];
      const canonicalId = activity.physicalCanonicalActivityLogId ?? members.find((m) => m.physicalCanonicalActivityLogId)?.physicalCanonicalActivityLogId ?? null;
      return { canonical: members.find((m) => m.id === canonicalId) ?? activity, members };
    }
    return { canonical: activity, members: [activity] };
  }

  // "Vincular a treino prescrito" / corrigir o vinculo. Valida posse e tipo da sessao ANTES de gravar.
  // Vinculo manual (Conciliacao, 30/10/2026): QUALQUER treino prescrito, de qualquer semana, pode ser escolhido. Quando os dados nao parecem compativeis
  // (modalidade diferente, duracao ou distancia muito diferentes) a API responde needs_confirmation com os motivos e o aluno confirma; nunca e' um veto.
  async linkActivityToSessionAsStudent(userId: string, activityLogId: string, trainingSessionId: string, options: LinkOptions = {}) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) throw new NotFoundException('Atividade nao encontrada.');
    const session = await this.prisma.trainingSession.findUnique({ where: { id: trainingSessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('Treino nao encontrado.');
    if (['device_extra', 'student_extra'].includes(session.origin ?? '')) throw new BadRequestException('So e possivel vincular a um treino prescrito (nao a outro treino extra).');
    const assessment = assessCompatibility(session, activity);
    if (assessment.needsConfirmation && options.confirmIncompatible !== true) {
      throw new BadRequestException({ code: 'needs_confirmation', message: 'Esta atividade não parece corresponder a este treino. Confirma que é o mesmo treino?', reasons: assessment.reasons });
    }
    const since = new Date();
    // Vinculo e atualizacao da marcacao ('nao feito' -> 'realizado', se for o caso) na MESMA transacao.
    const { flipped, ...result } = await this.withUserLock(userId, async (service) => ({ ...(await service.linkActivityToSessionLocked(activityLogId, trainingSessionId, options)), flipped: await service.markDoneAfterStudentConfirmation(trainingSessionId) }));
    // Atividade que ja tinha treino extra registrado: o registro de feedback dessa sessao foi movido ou preservado (contagens de medalhas podem mudar).
    await this.recomputeAfterCorrection(userId, since, { origin: 'student', actorId: userId, kind: 'link_correction', completionsChanged: result.syntheticRemoved || flipped });
    return { ...result, compatibility: assessment };
  }

  private async linkActivityToSessionLocked(activityLogId: string, trainingSessionId: string, options: LinkOptions = {}) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    const session = await this.prisma.trainingSession.findUnique({ where: { id: trainingSessionId }, include: { completion: true, executionLinks: { where: { status: 'active' } } } });
    if (!activity || !session) throw new NotFoundException('Atividade ou treino nao encontrado.');
    const { canonical, members } = await this.eventOf(activity);
    const memberIds = new Set(members.map((m) => m.id));
    const asPart = options.role === 'part' && session.executionLinks.some((l) => !memberIds.has(l.activityLogId));

    // O treino ja' esta cumprido por OUTRA atividade (outro evento fisico): a escolha do aluno prevalece, a outra vira atividade extra (historico do vinculo preservado).
    // Como PARTE da mesma sessao (varios registros de uma mesma execucao), as atividades ja' vinculadas ficam e o treino soma as partes.
    const replaced: string[] = [];
    if (!asPart) {
      for (const link of session.executionLinks.filter((l) => !memberIds.has(l.activityLogId))) {
        await this.markExtra({ activityLogId: link.activityLogId, origin: 'student', note: 'replaced_by_student_link' });
        replaced.push(link.activityLogId);
      }
    }

    // Atividade extra ja' materializada (sessao sintetica com feedback proprio): NADA e' apagado. O feedback do treino prescrito continua sendo o principal; o da
    // sessao sintetica fica guardado como versao (ou o aluno escolhe qual vale, quando os dois tem conteudo). A sessao sintetica sai do calendario.
    const synthetic = await this.findMaterializedSessionForActivities(activity.userId, memberIds);
    let feedbackMoved = false;
    let syntheticRemoved = false;
    let keptFeedback: 'session' | 'activity' | null = null;
    if (synthetic) {
      if ((await this.prisma.sessionExecutionLink.count({ where: { trainingSessionId: synthetic.id } })) > 0) {
        throw new BadRequestException('Esta atividade ja tem um registro de treino extra com vinculos proprios; peca ao treinador para corrigir.');
      }
      const syntheticCompletion = synthetic.completion as unknown as ({ id: string } & Record<string, unknown>) | null;
      const sessionCompletion = session.completion as unknown as ({ id: string } & Record<string, unknown>) | null;
      const syntheticHasContent = syntheticCompletion ? completionHasStudentContent(syntheticCompletion) : false;
      const sessionHasContent = sessionCompletion ? completionHasStudentContent(sessionCompletion) : false;
      if (syntheticHasContent && sessionHasContent && !options.keepFeedback) {
        throw new BadRequestException({
          code: 'feedback_choice_required', message: 'Os dois registros têm feedback. Qual você quer manter como principal? O outro fica guardado.',
          session: feedbackSummary(sessionCompletion as Record<string, unknown>), activity: feedbackSummary(syntheticCompletion as Record<string, unknown>),
        });
      }
      syntheticRemoved = true;
      const preserve = async (completion: ({ id: string } & Record<string, unknown>) | null, reason: string) => {
        if (!completion) return;
        await this.prisma.workoutFeedbackVersion.create({ data: { userId: activity.userId, sessionId: session.id, payload: JSON.parse(JSON.stringify(completion)) as Prisma.InputJsonValue, reason } });
      };
      if (syntheticCompletion && syntheticHasContent) {
        // o do treino prescrito so' perde o lugar quando o aluno escolheu o da atividade (ou quando nao tem feedback proprio, so' a marcacao automatica)
        if (sessionCompletion && (!sessionHasContent || options.keepFeedback === 'activity')) {
          await preserve(sessionCompletion, sessionHasContent ? 'replaced_by_student_choice' : 'replaced_by_student_choice');
          await this.prisma.workoutCompletion.delete({ where: { id: sessionCompletion.id } });
          await this.prisma.workoutCompletion.update({ where: { id: syntheticCompletion.id }, data: { sessionId: session.id } });
          feedbackMoved = true; keptFeedback = 'activity';
        } else if (sessionCompletion) {
          await preserve(syntheticCompletion, 'merged_from_extra_session');
          await this.prisma.workoutCompletion.delete({ where: { id: syntheticCompletion.id } });
          keptFeedback = 'session';
        } else {
          await this.prisma.workoutCompletion.update({ where: { id: syntheticCompletion.id }, data: { sessionId: session.id } });
          feedbackMoved = true; keptFeedback = 'activity';
        }
      } else if (syntheticCompletion) {
        // sem conteudo do aluno (so' dados automaticos do relogio): nada a preservar
        await this.prisma.workoutCompletion.delete({ where: { id: syntheticCompletion.id } });
      }
      await this.prisma.sessionExecutionAnalysis.deleteMany({ where: { trainingSessionId: synthetic.id } });
      await this.prisma.trainingAnalysis.deleteMany({ where: { userId: activity.userId, scope: 'session', refKey: synthetic.id } });
      await this.prisma.trainingSession.delete({ where: { id: synthetic.id } });
    }

    const link = await this.linkManually({
      trainingSessionId: session.id, activityLogId: canonical.id, origin: 'student', matchMethod: asPart ? 'student_link_part' : 'student_link',
      evidence: buildEvidence(session, canonical), note: asPart ? 'Vinculado pelo aluno como parte da mesma sessao.' : 'Vinculado pelo aluno.', role: asPart ? 'part' : null,
    });
    return { linkId: link.id, activityLogId: canonical.id, trainingSessionId: session.id, replacedActivityLogIds: replaced, feedbackMovedFromExtraSession: feedbackMoved, keptFeedback, syntheticRemoved, role: asPart ? ('part' as const) : ('primary' as const) };
  }

  // Treinos prescritos que o aluno pode escolher para esta atividade. TODOS os treinos prescritos de uma janela larga (qualquer semana), sem filtro de modalidade:
  // cada um traz a avaliacao de compatibilidade (aviso, nao veto) e os compativeis vem primeiro. So' leitura.
  async linkableSessionsAsStudent(userId: string, activityLogId: string) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) throw new NotFoundException('Atividade nao encontrada.');
    const { members } = await this.eventOf(activity);
    const memberIds = new Set(members.map((m) => m.id));
    const day = Date.parse(`${localCalendarDate(activity.startedAt, activity.utcOffsetMinutes)}T00:00:00.000Z`);
    const sessions = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: new Date(day - LINKABLE_WINDOW_DAYS * 86_400_000), lte: new Date(day + LINKABLE_WINDOW_DAYS * 86_400_000) } },
      include: { executionLinks: { where: { status: 'active' } }, completion: { select: { id: true, status: true } } },
    });
    return sessions
      .filter((s) => !['device_extra', 'student_extra'].includes(s.origin ?? ''))
      .map((s) => {
        const compatibility: CompatibilityAssessment = assessCompatibility(s, activity);
        return {
          id: s.id, title: s.title, modality: s.modality, isoDate: s.scheduledDate.toISOString().slice(0, 10),
          durationMin: s.durationMin ?? null, distanceKm: s.distanceKm ?? null, hasFeedback: s.completion != null,
          linkedToThisActivity: s.executionLinks.some((l) => memberIds.has(l.activityLogId)),
          linkedToAnotherActivity: s.executionLinks.some((l) => !memberIds.has(l.activityLogId)),
          compatibility,
        };
      })
      .sort((a, b) => Number(a.compatibility.needsConfirmation) - Number(b.compatibility.needsConfirmation) || Math.abs(Date.parse(a.isoDate) - day) - Math.abs(Date.parse(b.isoDate) - day));
  }

  // Classificacao feita pelo aluno: 'extra' (treino extra) ou 'daily' (rotina cotidiana, ex.: caminhada). Ambas contam como exercicio extra e entram na carga (decisao
  // de Elton); 'daily' so' informa a IA e o treinador. Desfaz o vinculo existente (historico preservado) e NUNCA apaga o feedback.
  async classifyActivityAsStudent(userId: string, activityLogId: string, kind: 'extra' | 'daily') {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) throw new NotFoundException('Atividade nao encontrada.');
    const since = new Date();
    const result = await this.withUserLock(userId, async (service) => {
      const { canonical, members } = await service.eventOf(activity);
      for (const member of members) {
        const active = await service.prisma.sessionExecutionLink.count({ where: { activityLogId: member.id, status: { in: ['active', 'candidate'] } } });
        if (active > 0 || member.id === canonical.id) await service.markExtra({ activityLogId: member.id, origin: 'student', note: kind === 'daily' ? 'student_marked_daily' : 'student_marked_extra' });
      }
      await service.prisma.activityLog.update({ where: { id: canonical.id }, data: { studentLabel: kind === 'daily' ? 'daily' : null } });
      return { activityLogId: canonical.id, classification: 'alternative' as const, label: kind === 'daily' ? ('daily' as const) : null };
    });
    await this.recomputeAfterCorrection(userId, since, { origin: 'student', actorId: userId, kind: 'link_correction' });
    return result;
  }

  // Perguntas pendentes de um treino PRESCRITO: atividades importadas que podem ser este treino e que o aluno ainda nao respondeu (vinculo 'candidate').
  // Enquanto houver, o feedback deste treino fica bloqueado (a API recusa a edicao): primeiro ela diz se a atividade corresponde ao treino.
  async pendingQuestionsForSession(userId: string, trainingSessionId: string): Promise<Array<{ linkId: string; activityLogId: string }>> {
    const links = await this.prisma.sessionExecutionLink.findMany({ where: { userId, trainingSessionId, status: 'candidate' }, select: { id: true, activityLogId: true } });
    return links.map((l) => ({ linkId: l.id, activityLogId: l.activityLogId }));
  }

  // "Desfazer vinculo": a atividade volta a ser extra por decisao do aluno (a automacao nao a reassocia depois); o feedback manual do treino e' mantido.
  async unlinkActivityAsStudent(userId: string, activityLogId: string, note?: string | null) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) throw new NotFoundException('Atividade nao encontrada.');
    const since = new Date();
    const result = await this.withUserLock(userId, async (service) => {
      const { canonical, members } = await service.eventOf(activity);
      const links = await service.prisma.sessionExecutionLink.findMany({ where: { activityLogId: { in: members.map((m) => m.id) }, status: 'active' } });
      if (links.length === 0) {
        // Resposta NAO a uma pergunta pendente (candidatos): o treino segue como esta (ex.: 'nao feito') e a atividade fica registrada como extra, por decisao do aluno.
        const pending = await service.prisma.sessionExecutionLink.count({ where: { activityLogId: { in: members.map((m) => m.id) }, status: 'candidate' } });
        if (pending === 0) throw new BadRequestException('Esta atividade nao esta vinculada a um treino prescrito.');
        await service.markExtra({ activityLogId: canonical.id, origin: 'student', note: note ?? 'student_not_this_workout' });
        return { activityLogId: canonical.id, classification: 'alternative' as const, revokedLinkIds: [] as string[] };
      }
      for (const link of links) await service.markExtra({ activityLogId: link.activityLogId, origin: 'student', note: note ?? 'student_unlinked' });
      if (!links.some((l) => l.activityLogId === canonical.id)) await service.markExtra({ activityLogId: canonical.id, origin: 'student', note: note ?? 'student_unlinked' });
      return { activityLogId: canonical.id, classification: 'alternative' as const, revokedLinkIds: links.map((l) => l.id) };
    });
    await this.recomputeAfterCorrection(userId, since, { origin: 'student', actorId: userId, kind: 'link_correction' });
    return result;
  }

  private async findMaterializedSession(userId: string, activityLogId: string) {
    const candidates = await this.prisma.trainingSession.findMany({
      where: { userId, origin: 'device_extra' },
      include: { completion: true },
    });
    return candidates.find((s) => (s.structure as { activityLogId?: string } | null)?.activityLogId === activityLogId) ?? null;
  }
}
