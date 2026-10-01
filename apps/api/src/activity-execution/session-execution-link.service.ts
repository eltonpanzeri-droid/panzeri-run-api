import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Fundacao Prescricao x Execucao (01/10/2026). Fronteira ONDE isto se conecta ao resto do sistema:
// TrainingSession (prescrita OU sintetica/extra) e ActivityLog (ja' canonico, agnostico de
// provedor — ver polar-activity-normalizer.ts). Este arquivo NUNCA importa nada especifico de
// Polar/Garmin/Strava; so' trabalha com os dois lados ja' normalizados.
//
// Escopo deliberado desta etapa (ver pedido original): a classificacao automatica em classify() e'
// INTENCIONALMENTE simples e conservadora — so' resolve o caso inequivoco (unica sessao
// compativel no mesmo dia local, sem rival) e marca TUDO MAIS como ambiguo em vez de adivinhar.
// Nao ha' tolerancia de horario, nao ha' comparacao de pace/distancia, nao ha' pontuacao de
// confianca calculada — isso e' heuristica de matching mais complexa, explicitamente fora desta
// etapa. classify() tambem NAO e' chamado automaticamente por nenhum adapter de provedor ainda
// (ex.: PolarActivityIngestionService nao invoca isto) — e' uma capacidade testavel e pronta pra'
// ser acionada quando essa decisao de produto for tomada.

export type ExecutionOrigin = 'automatic' | 'student' | 'coach';
export type ExecutionClassification = 'linked' | 'extra' | 'ambiguous';

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

  // Classificacao automatica conservadora. So' decide 'linked' quando ha' EXATAMENTE uma sessao
  // candidata (mesmo dia local do aluno, modalidade compativel, ainda sem vinculo ativo) E
  // nenhuma outra atividade nao-classificada do mesmo dia tambem disputando essa sessao. Qualquer
  // outra situacao vira 'ambiguous' — nunca forca um vinculo sem evidencia inequivoca.
  // Idempotente: se a atividade ja' foi classificada (por este metodo ou por uma decisao manual),
  // NAO reclassifica sozinho — corrigir uma classificacao existente e' sempre uma acao explicita
  // (linkManually/markExtra), nunca um efeito colateral de rodar classify() de novo.
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
    const compatibleSessions = sameDaySessions.filter(
      (s) => s.executionLinks.length === 0 && modalitiesCompatible(s.modality, activity.sport),
    );

    if (compatibleSessions.length === 0) {
      await this.setClassification(activityLogId, 'extra', 'automatic');
      return 'extra';
    }

    if (compatibleSessions.length > 1) {
      await this.setClassification(activityLogId, 'ambiguous', 'automatic');
      return 'ambiguous';
    }

    // Exatamente 1 sessao candidata — ainda falta checar o lado da atividade: existe outra
    // atividade nao-classificada do mesmo dia tambem compativel com essa mesma sessao? Se sim,
    // nao da' pra saber qual das duas e' a execucao real (situacao 10 do pedido original).
    const onlyCandidate = compatibleSessions[0];
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
      await this.setClassification(activityLogId, 'ambiguous', 'automatic');
      return 'ambiguous';
    }

    await this.linkManually({
      trainingSessionId: onlyCandidate.id,
      activityLogId,
      origin: 'automatic',
      confidence: 'same_day_modality_match',
    });
    return 'linked';
  }

  // Vincula explicitamente uma atividade a uma sessao — usado tanto pela classificacao automatica
  // (caso inequivoco) quanto pela correcao manual do aluno/treinador ("este treino corresponde a
  // uma prescricao"). Qualquer vinculo ATIVO anterior desta MESMA atividade e' revogado (nunca
  // apagado) e passa a apontar supersededByLinkId pro vinculo novo — preserva a cadeia
  // classificacao automatica -> corrigida -> vinculo atual.
  async linkManually(params: {
    trainingSessionId: string;
    activityLogId: string;
    origin: ExecutionOrigin;
    confidence?: string | null;
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
    const previousActiveLinks = await this.prisma.sessionExecutionLink.findMany({
      where: { activityLogId: params.activityLogId, status: 'active' },
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
        note: params.note ?? null,
      },
    });

    // supersededByLinkId e' @unique: se por algum motivo havia mais de um link ativo pra mesma
    // atividade (nao e' o caminho normal, mas o schema permite), so' o mais recente encadeia pro
    // substituto; os demais so' ficam revogados, sem encadeamento duplo no mesmo id.
    for (const [index, old] of previousActiveLinks.entries()) {
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

  // "Este nao foi o treino prescrito" — revoga qualquer vinculo ativo e marca explicitamente como
  // extra, com proveniencia de quem decidiu. Tambem e' o caminho que a classificacao automatica
  // usa quando nenhuma sessao compativel existe no dia.
  async markExtra(params: { activityLogId: string; origin: ExecutionOrigin; note?: string | null }) {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: params.activityLogId } });
    if (!activity) throw new NotFoundException('Atividade nao encontrada.');

    const previousActiveLinks = await this.prisma.sessionExecutionLink.findMany({
      where: { activityLogId: params.activityLogId, status: 'active' },
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
