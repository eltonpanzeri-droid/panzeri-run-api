import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

// Grupos de modalidade considerados equivalentes pra fins de correspondencia prescricao x
// execucao (mesmo vocabulario canonico usado em TrainingSession.modality/ActivityLog.sport — ver
// strava.service.ts modalityFromActivity). 'outra' nunca e' compativel com nada: se a atividade
// nao foi classificada numa modalidade reconhecida, tratamos como incerta por padrao (vira
// alternative por falta de candidato compativel, nunca por adivinhar compatibilidade).
const MODALITY_COMPATIBILITY: Record<string, string[]> = {
  corrida: ['corrida', 'esteira'],
  esteira: ['corrida', 'esteira'],
  forca: ['forca', 'fortalecimento_corredores'],
  fortalecimento_corredores: ['forca', 'fortalecimento_corredores'],
  bike: ['bike'],
};

function modalitiesCompatible(sessionModality: string, activitySport: string | null): boolean {
  if (!activitySport || activitySport === 'outra') return false;
  const group = MODALITY_COMPATIBILITY[sessionModality];
  return group ? group.includes(activitySport) : sessionModality === activitySport;
}

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
// — logo local = realUTC + offsetMinutes. Sem offset conhecido, usamos o dia UTC puro (nunca
// adivinhamos fuso do aluno).
export function localCalendarDate(startedAt: Date, utcOffsetMinutes: number | null): string {
  const offset = utcOffsetMinutes ?? 0;
  const local = new Date(startedAt.getTime() + offset * 60_000);
  return local.toISOString().slice(0, 10);
}

function startOfLocalDay(startedAt: Date, utcOffsetMinutes: number | null): Date {
  return new Date(`${localCalendarDate(startedAt, utcOffsetMinutes)}T00:00:00.000Z`);
}

@Injectable()
export class SessionExecutionLinkService {
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
        linkedActivityIds.add(link.activityLogId);
        activeLinkBySessionId.set(link.trainingSessionId, {
          activityLog: toActivitySummary(activity),
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

    const alternativeActivities = activities
      .filter(
        (a) =>
          a.executionClassification === 'alternative' &&
          !linkedActivityIds.has(a.id) &&
          !materializedActivityIds.has(a.id),
      )
      .map(toActivitySummary);

    const pendingActivities = [...candidatesByActivityId.entries()]
      .filter(([activityId]) => !linkedActivityIds.has(activityId))
      .map(([activityId, candidates]) => ({
        activityLog: toActivitySummary(activityById.get(activityId)!),
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
  async classify(activityLogId: string): Promise<ExecutionClassification> {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');
    if (activity.executionClassification) {
      return activity.executionClassification as ExecutionClassification;
    }

    const localDay = localCalendarDate(activity.startedAt, activity.utcOffsetMinutes);
    const dayStart = new Date(`${localDay}T00:00:00.000Z`);

    const sameDaySessions = await this.prisma.trainingSession.findMany({
      where: { userId: activity.userId, scheduledDate: dayStart },
      include: { executionLinks: { where: { status: 'active' } } },
    });
    // Compativel em modalidade E ainda sem vinculo ATIVO (uma sessao ja' cumprida por outra
    // atividade nao concorre de novo). 'candidate' nao conta como "ja' vinculada" aqui — so'
    // 'active' representa execucao confirmada (ver comentario do status no schema).
    const modalityCompatible = sameDaySessions.filter((s) => modalitiesCompatible(s.modality, activity.sport));
    const candidates = modalityCompatible.filter((s) => s.executionLinks.length === 0);

    if (candidates.length === 0) {
      if (modalityCompatible.length > 0) {
        // Existe sessao compativel em modalidade, mas TODAS ja' tem vinculo ativo (outra
        // atividade). Incerto se esta e' uma duplicata/continuacao (requisito 4 — pode ser a
        // mesma execucao interrompida/reiniciada) ou uma atividade genuinamente extra — V1
        // deliberadamente NAO assume "extra" aqui, fica ambiguo pra' revisao humana.
        await this.setClassification(activityLogId, 'ambiguous', 'automatic');
        return 'ambiguous';
      }
      // Nenhuma sessao do dia tem modalidade compativel (ex.: corrida prescrita + ciclismo
      // observado) — a(s) sessao(oes) incompativel(is) continuam SEM execucao confirmada (nunca
      // marcadas como cumpridas por esta atividade; nunca se infere "substituicao"), e esta
      // atividade e' uma 'alternative' (atividade realizada sem prescricao aplicavel).
      await this.setClassification(activityLogId, 'alternative', 'automatic');
      return 'alternative';
    }

    if (candidates.length > 1) {
      // Multiplas prescricoes plausiveis (PASSO D) — tenta desambiguar com a evidencia disponivel
      // (distancia/duracao observadas vs cada candidata) ANTES de desistir pra ambiguidade.
      const perCandidateEvidence = candidates.map((candidate) => ({ candidate, evidence: buildEvidence(candidate, activity) }));
      const consistent = perCandidateEvidence.filter((c) => isFullyConsistent(c.evidence));

      if (consistent.length === 1) {
        // Exatamente uma candidata ficou claramente identificavel pela evidencia (PASSO E) —
        // associa direto, sem pedir confirmacao humana pra algo que ja' temos como distinguir.
        const winner = consistent[0];
        await this.linkManually({
          trainingSessionId: winner.candidate.id,
          activityLogId,
          origin: 'automatic',
          matchMethod: 'automatic_multi_candidate_disambiguated',
          evidence: winner.evidence,
        });
        return 'corresponding';
      }

      // Nenhuma evidencia suficiente pra distinguir (0 consistentes) OU mais de uma candidata
      // igualmente consistente — nao escolhe arbitrariamente. Registra uma linha 'candidate' POR
      // sessao plausivel, cada uma com sua propria evidencia, pra' o aluno/treinador confirmarem
      // depois qual e' a certa (ver confirmCandidate).
      for (const { candidate, evidence } of perCandidateEvidence) {
        await this.createCandidateLink(activity, candidate, 'automatic_multi_candidate', evidence);
      }
      await this.setClassification(activityLogId, 'ambiguous', 'automatic');
      return 'ambiguous';
    }

    // Exatamente 1 sessao candidata — ainda falta checar o lado da atividade: existe outra
    // atividade nao-resolvida do mesmo dia tambem compativel com essa mesma sessao? Se sim, nao
    // da' pra saber qual das duas e' a execucao real (PASSO F — pode ser atividade diferente,
    // interrupcao/reinicio, fragmentacao ou duplicacao entre fontes; nao resolvemos aqui).
    const onlyCandidate = candidates[0];
    // Rival = outra atividade ainda NAO resolvida (null = nunca processada, ou 'ambiguous' =
    // processada mas ainda em aberto) disputando a mesma sessao. Deliberadamente NAO filtra so'
    // por "null" — isso faria o resultado depender da ORDEM em que classify() e' chamado pra cada
    // atividade (a primeira "consumiria" a ambiguidade e a segunda seria vinculada sozinha). Uma
    // atividade ja' 'corresponding' (a outra sessao) ou 'alternative' esta' de fato resolvida e
    // nao compete mais.
    const rivalActivities = await this.prisma.activityLog.findMany({
      where: {
        userId: activity.userId,
        id: { not: activity.id },
        OR: [{ executionClassification: null }, { executionClassification: 'ambiguous' }],
      },
    });
    const hasRival = rivalActivities.some(
      (rival) =>
        localCalendarDate(rival.startedAt, rival.utcOffsetMinutes) === localDay &&
        modalitiesCompatible(onlyCandidate.modality, rival.sport),
    );
    if (hasRival) {
      await this.createCandidateLink(activity, onlyCandidate, 'automatic_rival_activity', buildEvidence(onlyCandidate, activity));
      await this.setClassification(activityLogId, 'ambiguous', 'automatic');
      return 'ambiguous';
    }

    // PASSO C: unica prescricao plausivel -> associa SEMPRE, independente de distancia/duracao/
    // pace observados (correspondencia != fidelidade de execucao — ver cabecalho do arquivo). A
    // evidencia e' calculada e preservada so' pra EXPLICAR a decisao (matchMethod/evidence),
    // nunca pra veta-la: ratioCompatible pode voltar false aqui (ex.: treino interrompido, 10km
    // realizados de 12km prescritos) e ainda assim o vinculo e' criado normalmente.
    const evidence = buildEvidence(onlyCandidate, activity);
    await this.linkManually({
      trainingSessionId: onlyCandidate.id,
      activityLogId,
      origin: 'automatic',
      matchMethod: 'automatic_single_candidate',
      evidence,
    });
    return 'corresponding';
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

    return this.linkManually({
      trainingSessionId: candidate.trainingSessionId,
      activityLogId: candidate.activityLogId,
      origin,
      matchMethod: candidate.matchMethod ?? undefined,
      evidence: (candidate.evidence as EvidenceItem[] | null) ?? undefined,
      note: note ?? candidate.note,
    });
  }

  // Wrapper exposto via HTTP (controller) pro ALUNO confirmar uma candidata. Checa posse ANTES de
  // confirmar — confirmCandidate() sozinho nao valida dono nenhum (uso interno/treinador ja'
  // confiava no chamador); exposto ao aluno, precisa impedir que ele confirme um linkId de outro
  // usuario so' adivinhando o id. NotFoundException tanto pra' "nao existe" quanto pra' "nao e'
  // seu" — nunca revela a um aluno que um linkId de outra pessoa existe.
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

    await this.prisma.sessionExecutionLink.update({
      where: { id: linkId },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    const stillActive = await this.hasActiveLinkForActivity(link.activityLogId);
    if (!stillActive) {
      await this.setClassification(link.activityLogId, 'ambiguous', 'automatic');
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

    const activePlan = await this.prisma.trainingPlan.findFirst({
      where: { userId: activity.userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!activePlan) return null;

    const modality = activity.sport ?? 'outra';
    const scheduledDate = startOfLocalDay(activity.startedAt, activity.utcOffsetMinutes);

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
  async materializeExtraActivityAsStudent(userId: string, activityLogId: string) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) {
      throw new NotFoundException('Atividade nao encontrada.');
    }
    return this.materializeExtraActivity(activityLogId);
  }

  private async findMaterializedSession(userId: string, activityLogId: string) {
    const candidates = await this.prisma.trainingSession.findMany({
      where: { userId, origin: 'device_extra' },
      include: { completion: true },
    });
    return candidates.find((s) => (s.structure as { activityLogId?: string } | null)?.activityLogId === activityLogId) ?? null;
  }
}
