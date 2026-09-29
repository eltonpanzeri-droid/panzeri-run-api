import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionAgentService } from '../reassessment/evolution-agent.service';

// Codigos de evento do prontuario. Cada gravacao e feita por codigo puro (zero custo de IA) nos
// pontos reais do sistema onde algo acontece com o aluno — o agente de condensacao (EvolutionAgentService.
// condenseProfile) e o unico lugar que gasta tokens, e so quando ha eventos novos acumulados.
export const ProfileEventCode = {
  ONBOARDING_COMPLETED: 'ONBOARDING_COMPLETED',
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
} as const;

// Limite defensivo (nunca rejeita a resposta, so trunca depois de parsear — mesmo padrao ja usado
// no agente de prescricao para nao descartar uma resposta boa por causa de um campo de texto).
const PROFILE_SUMMARY_HARD_LIMIT = 6000;

@Injectable()
export class StudentProfileService {
  private readonly logger = new Logger(StudentProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionAgent: EvolutionAgentService,
  ) {}

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
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    const pendingEvents = await this.prisma.studentProfileEvent.findMany({
      where: { userId, summarizedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingEvents.length === 0) {
      return existing?.summary ?? '';
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
        this.logger.warn(`Prontuario: condensacao indisponivel (IA nao configurada ou falhou) para userId=${userId}`);
        return existing?.summary ?? '';
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

      return trimmedSummary;
    } catch (error) {
      this.logger.warn(`Falha ao atualizar prontuario do userId=${userId}: ${(error as Error).message}`);
      return existing?.summary ?? '';
    }
  }
}
