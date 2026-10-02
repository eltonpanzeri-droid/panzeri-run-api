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
// Duas perguntas que este motor NAO responde (deliberadamente fora de V1): aderencia (quanto da
// prescricao foi cumprido) e carga realizada (quanto o atleta de fato treinou). Isto so' decide
// CORRESPONDENCIA entre uma prescricao e uma atividade observada — as metricas de aderencia/carga
// ficam pra' uma camada posterior que consome esses vinculos.

export type ExecutionOrigin = 'automatic' | 'student' | 'coach';
export type ExecutionClassification = 'linked' | 'extra' | 'ambiguous';
export type LinkStatus = 'active' | 'revoked' | 'candidate';

// Evidencia nunca e' um score: e' a lista dos criterios canonicos avaliados e o resultado de cada
// um. matched:null significa "dado indisponivel pra avaliar este criterio" — NUNCA tratado como
// incompativel (null != false, exatamente como null != zero pro dado numerico em si).
export interface EvidenceItem {
  criterion: 'same_athlete' | 'compatible_modality' | 'same_local_day' | 'distance_compatible' | 'duration_compatible';
  matched: boolean | null;
}

// Tolerancia relativa pra' considerar distancia/duracao observadas compativeis com o prescrito.
// Nomeadas e exportadas de proposito (ver pedido: "nenhum limiar arbitrario escondido") — ajustar
// aqui e' a unica mudanca necessaria se a calibragem precisar mudar no futuro.
export const DISTANCE_TOLERANCE_RATIO = 0.25;
export const DURATION_TOLERANCE_RATIO = 0.3;

// Grupos de modalidade considerados equivalentes pra fins de correspondencia prescricao x
// execucao (mesmo vocabulario canonico usado em TrainingSession.modality/ActivityLog.sport — ver
// strava.service.ts modalityFromActivity). 'outra' nunca e' compativel com nada: se a atividade
// nao foi classificada numa modalidade reconhecida, tratamos como incerta por padrao (vira extra
// por falta de candidato compativel, nunca por adivinhar compatibilidade).
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

// Confianca suficiente pra' vinculo automatico ATIVO (nao so' candidato): nenhum criterio AVALIADO
// (matched != null) pode ter dado false. Criterios sem dado disponivel (null) sao ignorados — um
// unico candidato sem distancia/duracao conhecidas ainda e' um vinculo automatico valido, contanto
// que modalidade+dia batam (o que ja' e' garantido antes de chegar aqui).
function evidenceSufficientForAutoLink(evidence: EvidenceItem[]): boolean {
  return evidence.every((item) => item.matched !== false);
}

// start-time-utc-offset da Polar (e equivalente de outros provedores) segue a convencao
// "realUTC = localAsUtc - offsetMinutes" (ver parseStartedAt em polar-activity-ingestion.service.ts)
// — logo local = realUTC + offsetMinutes. Sem offset conhecido, usamos o dia UTC puro (nunca
// adivinhamos fuso do aluno).
function localCalendarDate(startedAt: Date, utcOffsetMinutes: number | null): string {
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

  // Motor de Reconciliacao V1. Decide entre 4 situacoes (ver pedido original):
  //   A. correspondencia clara -> 'linked' (vinculo ATIVO criado)
  //   B. incompatibilidade com uma prescricao especifica -> nunca marca aquela sessao como
  //      executada (ela so' nao entra na lista de candidatos; nao ha' um "status B" proprio)
  //   C. plausivel porem ambiguo -> 'ambiguous' (0 ou mais linhas 'candidate' registradas pra'
  //      confirmacao humana futura, conforme o motivo da ambiguidade)
  //   D. sem prescricao correspondente -> 'extra'
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
      // marcadas como cumpridas por esta atividade), e esta atividade vira candidata a extra.
      await this.setClassification(activityLogId, 'extra', 'automatic');
      return 'extra';
    }

    if (candidates.length > 1) {
      // Multiplas prescricoes plausiveis — nao escolhe arbitrariamente. Registra uma linha
      // 'candidate' POR sessao plausivel, cada uma com sua propria evidencia, pra' o aluno/
      // treinador confirmarem depois qual e' a certa (ver confirmCandidate).
      for (const candidate of candidates) {
        await this.createCandidateLink(activity, candidate, 'automatic_multi_candidate', buildEvidence(candidate, activity));
      }
      await this.setClassification(activityLogId, 'ambiguous', 'automatic');
      return 'ambiguous';
    }

    // Exatamente 1 sessao candidata — ainda falta checar o lado da atividade: existe outra
    // atividade nao-resolvida do mesmo dia tambem compativel com essa mesma sessao? Se sim, nao
    // da' pra saber qual das duas e' a execucao real (requisito 4).
    const onlyCandidate = candidates[0];
    // Rival = outra atividade ainda NAO resolvida (null = nunca processada, ou 'ambiguous' =
    // processada mas ainda em aberto) disputando a mesma sessao. Deliberadamente NAO filtra so'
    // por "null" — isso faria o resultado depender da ORDEM em que classify() e' chamado pra cada
    // atividade (a primeira "consumiria" a ambiguidade e a segunda seria vinculada sozinha). Uma
    // atividade ja' 'linked' (a outra sessao) ou 'extra' esta' de fato resolvida e nao compete mais.
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

    const evidence = buildEvidence(onlyCandidate, activity);
    if (!evidenceSufficientForAutoLink(evidence)) {
      // Unico candidato, mas distancia/duracao observadas fogem da tolerancia do prescrito
      // (requisitos 9/10 — execucao parcial, valores diferentes). Nao vincula automaticamente com
      // confianca: fica candidato, com a evidencia registrada explicando exatamente o que destoou.
      await this.createCandidateLink(activity, onlyCandidate, 'automatic_single_candidate_weak_evidence', evidence);
      await this.setClassification(activityLogId, 'ambiguous', 'automatic');
      return 'ambiguous';
    }

    await this.linkManually({
      trainingSessionId: onlyCandidate.id,
      activityLogId,
      origin: 'automatic',
      matchMethod: 'automatic_single_candidate',
      evidence,
    });
    return 'linked';
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
      data: { executionClassification: 'linked', executionClassifiedAt: new Date(), executionClassifiedBy: params.origin },
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

    await this.setClassification(params.activityLogId, 'extra', params.origin);
  }

  // Revogacao "pura" (sem decidir o novo estado) — usada quando uma correcao so' remove um vinculo
  // errado sem ja' saber o que colocar no lugar. A atividade volta pra 'ambiguous' (incerta de
  // novo), nunca silenciosamente pra 'extra' (isso exigiria uma decisao explicita via markExtra).
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
  // classificada como 'extra' — e' o que permite ao aluno dar feedback subjetivo sobre ela mais
  // tarde (reusa o MESMO mecanismo de WorkoutCompletion.sessionId que addStudentExtraSession ja'
  // usa pro registro manual de treino extra; origin='device_extra' em vez de 'student_extra' e'
  // a unica diferenca de proveniencia). Idempotente: chamar duas vezes pra mesma atividade nao
  // duplica a sessao sintetica. Sem plano ativo, nao materializa ainda (retorna null) — a
  // atividade continua 'extra' no ActivityLog de qualquer forma, so' fica sem um lugar no
  // calendario pra receber feedback ate' existir um plano.
  async materializeExtraActivity(activityLogId: string) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');
    if (activity.executionClassification !== 'extra') {
      throw new BadRequestException('So e possivel materializar sessao sintetica para atividades classificadas como extra.');
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

  private async findMaterializedSession(userId: string, activityLogId: string) {
    const candidates = await this.prisma.trainingSession.findMany({
      where: { userId, origin: 'device_extra' },
      include: { completion: true },
    });
    return candidates.find((s) => (s.structure as { activityLogId?: string } | null)?.activityLogId === activityLogId) ?? null;
  }
}
