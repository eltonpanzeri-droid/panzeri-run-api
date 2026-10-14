import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionAgentService } from '../reassessment/evolution-agent.service';
import { correctionHooks, CorrectionContext } from '../activity-execution/correction-hooks';
import { buildCorrectionEvents, CorrectionEventData, idsNeeded } from './correction-event';

// Codigos de evento do prontuario. Cada gravacao e feita por codigo puro (zero custo de IA) nos
// pontos reais do sistema onde algo acontece com o aluno — o agente de condensacao (EvolutionAgentService.
// condenseProfile) e o unico lugar que gasta tokens, e so quando ha eventos novos acumulados.
export const ProfileEventCode = {
  ONBOARDING_COMPLETED: 'ONBOARDING_COMPLETED',
  // 14/10/2026: toda meta de prova cadastrada pela aluna e' registrada aqui (fato estruturado, gravado por codigo, sem IA).
  TARGET_RACE_REGISTERED: 'TARGET_RACE_REGISTERED',
  // Alteracao (dados ou status) e exclusao de uma meta de prova: tambem viram linhas do Prontuario.
  TARGET_RACE_CHANGED: 'TARGET_RACE_CHANGED',
  TARGET_RACE_REMOVED: 'TARGET_RACE_REMOVED',
  WEEK_GENERATED: 'WEEK_GENERATED',
  WORKOUT_COMPLETED: 'WORKOUT_COMPLETED',
  DIRECTIVE_ADDED: 'DIRECTIVE_ADDED',
  STUDENT_OBSERVATION: 'STUDENT_OBSERVATION',
  PAIN_REPORT: 'PAIN_REPORT',
  REASSESSMENT_COMPLETED: 'REASSESSMENT_COMPLETED',
  // 28/09/2026 (fechamento Relator -> Prontuario -> Treinador): relato de texto livre do aluno JA
  // interpretado pelo Agente Relator (StudentReporterAgentService), so' registrado aqui quando
  // relevance != 'PONTUAL' (ver ReportTimelineService.analyzeEntry) — um comentario isolado sem
  // relevancia longitudinal fica so' na Linha do Tempo de Relatos, nunca infla o prontuario.
  STUDENT_REPORT_ANALYZED: 'STUDENT_REPORT_ANALYZED',
  // Etapa 3 (10/2026): poucas linhas deterministicas do Analista de Treinos (capacidades demonstradas, mudancas entre sessoes semelhantes, padroes). Sem IA para gravar.
  TRAINING_ANALYSIS_FINDINGS: 'TRAINING_ANALYSIS_FINDINGS',
  // 15/10/2026: correcao de vinculo atividade<->treino (aluno ou treinador) e edicao de treino pelo treinador em sessao com feedback/execucao. Texto deterministico
  // (sem IA), sempre ACRESCENTADO: o registro anterior permanece como historico; a informacao corrigida prevalece (ver Condensador e Prescritor).
  EXECUTION_LINK_CORRECTED: 'EXECUTION_LINK_CORRECTED',
} as const;

// Janela em que o mesmo evento (mesmo corpo) nao e' gravado de novo: protege contra o mesmo processamento acionado duas vezes (ex.: decisao de identidade).
const CORRECTION_DEDUPE_WINDOW_MS = 10 * 60_000;

// Limite defensivo (nunca rejeita a resposta, so trunca depois de parsear — mesmo padrao ja usado
// no agente de prescricao para nao descartar uma resposta boa por causa de um campo de texto).
const PROFILE_SUMMARY_HARD_LIMIT = 6000;

@Injectable()
export class StudentProfileService implements OnModuleInit {
  private readonly logger = new Logger(StudentProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionAgent: EvolutionAgentService,
  ) {}

  // Registra o gancho que acrescenta o evento corretivo ao Prontuario depois de uma correcao (idempotente, pelo nome).
  onModuleInit(): void {
    correctionHooks.register('prontuario', async (context) => { await this.recordCorrectionEvents(context); });
  }

  /**
   * Evento EXECUTION_LINK_CORRECTED: so' quando algo mudou de FATO (estado final diferente do inicial) e nunca para exclusao de dados do provedor (ausencia de dado nao
   * e' correcao). Operacao em massa gera UM evento resumido. Nunca apaga nem reescreve evento anterior. Medalhas nao entram aqui.
   */
  async recordCorrectionEvents(context: CorrectionContext): Promise<number> {
    if (context.kind === 'provider_data_deleted') return 0;
    const needed = idsNeeded(context);
    if (needed.sessionIds.length === 0 && needed.activityIds.length === 0) return 0;
    const [sessions, activities] = await Promise.all([
      needed.sessionIds.length > 0 ? this.prisma.trainingSession.findMany({ where: { id: { in: needed.sessionIds }, userId: context.userId }, select: { id: true, title: true, scheduledDate: true, modality: true } }) : [],
      needed.activityIds.length > 0 ? this.prisma.activityLog.findMany({ where: { id: { in: needed.activityIds }, userId: context.userId }, select: { id: true, startedAt: true, utcOffsetMinutes: true, sport: true, distanceMeters: true, durationSec: true } }) : [],
    ]);
    const data: CorrectionEventData = {
      sessions: new Map(sessions.map((s) => [s.id, { title: s.title, scheduledDate: s.scheduledDate, modality: s.modality }])),
      activities: new Map(activities.map((a) => [a.id, { startedAt: a.startedAt, utcOffsetMinutes: a.utcOffsetMinutes, sport: a.sport, distanceMeters: a.distanceMeters, durationSec: a.durationSec }])),
    };
    const events = buildCorrectionEvents(context, data);
    if (events.length === 0) return 0;
    const recent = await this.prisma.studentProfileEvent.findMany({
      where: { userId: context.userId, code: ProfileEventCode.EXECUTION_LINK_CORRECTED, createdAt: { gte: new Date(context.at.getTime() - CORRECTION_DEDUPE_WINDOW_MS) } },
      select: { content: true },
    });
    const bodies = new Set(recent.map((e) => e.content.split('\n').slice(1).join('\n')));
    let written = 0;
    for (const event of events) {
      if (bodies.has(event.body)) continue;
      await this.recordEvent(context.userId, ProfileEventCode.EXECUTION_LINK_CORRECTED, `${event.header}\n${event.body}`);
      written++;
    }
    return written;
  }

  // Grava uma linha no prontuario. Puro codigo, sem chamada de IA — zero custo.
  async recordEvent(userId: string, code: string, content: string): Promise<void> {
    await this.prisma.studentProfileEvent.create({
      data: { userId, code, content },
    });
  }

  async getSummary(userId: string): Promise<string> {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId } });
    return profile?.summary ?? '';
  }

  // Condensa (resumo atual + eventos novos desde a ultima atualizacao) num resumo curto. So chama
  // a IA se houver evento novo acumulado — senao retorna sem gastar nada. Pensado para rodar logo
  // antes da geracao da proxima semana, nunca em toda gravacao de evento.
  async refreshProfile(userId: string): Promise<string> {
    return (await this.refreshProfileDetailed(userId)).summary;
  }

  // Leitura SEM IA (usada na regeneracao de um unico dia): resumo atual + eventos ainda nao condensados.
  async loadProfileContext(userId: string): Promise<ProfileRefreshResult> {
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    const pendingEvents = await this.prisma.studentProfileEvent.findMany({
      where: { userId, summarizedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { summary: existing?.summary ?? '', pendingEvents: pendingEvents.map(toPendingEvent), status: pendingEvents.length === 0 ? 'nothing_pending' : 'not_attempted' };
  }

  // Mesmo comportamento de refreshProfile, mas DEVOLVE o que ficou sem condensar. Antes, uma falha da condensacao
  // devolvia o resumo antigo e os eventos novos (relatos persistentes, restricoes, observacoes) sumiam da prescricao
  // ate a proxima condensacao bem-sucedida. Agora o chamador recebe os eventos pendentes e o status, e os entrega ao
  // Prescritor em texto bruto.
  async refreshProfileDetailed(userId: string): Promise<ProfileRefreshResult> {
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    const pendingEvents = await this.prisma.studentProfileEvent.findMany({
      where: { userId, summarizedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingEvents.length === 0) {
      return { summary: existing?.summary ?? '', pendingEvents: [], status: 'nothing_pending' };
    }

    try {
      const summary = await this.evolutionAgent.condenseProfile({
        currentSummary: existing?.summary ?? '',
        newEvents: pendingEvents.map((event) => ({
          code: event.code,
          content: event.content,
          createdAt: event.createdAt.toISOString(),
        })),
      });

      if (!summary) {
        this.logger.warn(`Prontuario: condensacao indisponivel (IA nao configurada ou falhou) para userId=${userId}; ${pendingEvents.length} evento(s) seguem sem condensar e serao entregues em texto bruto ao Prescritor.`);
        return { summary: existing?.summary ?? '', pendingEvents: pendingEvents.map(toPendingEvent), status: 'failed' };
      }

      const trimmedSummary = summary.trim().slice(0, PROFILE_SUMMARY_HARD_LIMIT);
      const now = new Date();

      await this.prisma.$transaction([
        this.prisma.studentProfile.upsert({
          where: { userId },
          create: { userId, summary: trimmedSummary },
          update: { summary: trimmedSummary },
        }),
        this.prisma.studentProfileEvent.updateMany({
          where: { id: { in: pendingEvents.map((event) => event.id) } },
          data: { summarizedAt: now },
        }),
      ]);

      return { summary: trimmedSummary, pendingEvents: [], status: 'ok' };
    } catch (error) {
      this.logger.warn(`Falha ao atualizar prontuario do userId=${userId}: ${(error as Error).message}; ${pendingEvents.length} evento(s) seguem sem condensar e serao entregues em texto bruto ao Prescritor.`);
      return { summary: existing?.summary ?? '', pendingEvents: pendingEvents.map(toPendingEvent), status: 'failed' };
    }
  }
}

export interface PendingProfileEvent {
  id: string;
  code: string;
  content: string;
  createdAt: Date;
}

export interface ProfileRefreshResult {
  summary: string;
  // Eventos que NAO entraram no resumo (falha da condensacao ou leitura sem IA).
  pendingEvents: PendingProfileEvent[];
  status: 'ok' | 'nothing_pending' | 'failed' | 'not_attempted';
}

function toPendingEvent(event: { id: string; code: string; content: string; createdAt: Date }): PendingProfileEvent {
  return { id: event.id, code: event.code, content: event.content, createdAt: event.createdAt };
}
