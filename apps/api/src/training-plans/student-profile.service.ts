import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AiQueueService } from '../common/ai-queue.service';

// Codigos de evento do prontuario. Cada gravacao e feita por codigo puro (zero custo de IA) nos
// pontos reais do sistema onde algo acontece com o aluno — o agente de resumo (abaixo) e o unico
// lugar que gasta tokens, e so quando ha eventos novos acumulados.
export const ProfileEventCode = {
  ONBOARDING_COMPLETED: 'ONBOARDING_COMPLETED',
  WEEK_GENERATED: 'WEEK_GENERATED',
  WORKOUT_COMPLETED: 'WORKOUT_COMPLETED',
  DIRECTIVE_ADDED: 'DIRECTIVE_ADDED',
  STUDENT_OBSERVATION: 'STUDENT_OBSERVATION',
  PAIN_REPORT: 'PAIN_REPORT',
  REASSESSMENT_COMPLETED: 'REASSESSMENT_COMPLETED',
} as const;

const RefreshedProfileSchema = z.object({
  summary: z.string(),
});

// Limite defensivo (nunca rejeita a resposta, so trunca depois de parsear — mesmo padrao ja usado
// no agente de prescricao para nao descartar uma resposta boa por causa de um campo de texto).
const PROFILE_SUMMARY_HARD_LIMIT = 6000;

@Injectable()
export class StudentProfileService {
  private readonly logger = new Logger(StudentProfileService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiQueue: AiQueueService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
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
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    const pendingEvents = await this.prisma.studentProfileEvent.findMany({
      where: { userId, summarizedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingEvents.length === 0) {
      return existing?.summary ?? '';
    }

    if (!this.client) {
      return existing?.summary ?? '';
    }
    const client = this.client;

    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-sonnet-5',
          max_tokens: 1800,
          thinking: { type: 'disabled' },
          output_config: {
            effort: 'medium',
            format: zodOutputFormat(RefreshedProfileSchema),
          },
          system: [{ type: 'text', text: this.buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: this.buildUserPrompt(existing?.summary ?? '', pendingEvents) }],
        }),
      );

      const parsed = response.parsed_output;
      if (!parsed) {
        this.logger.warn(`Prontuario: resposta sem parsed_output para userId=${userId}`);
        return existing?.summary ?? '';
      }

      const summary = parsed.summary.trim().slice(0, PROFILE_SUMMARY_HARD_LIMIT);
      const now = new Date();

      await this.prisma.$transaction([
        this.prisma.studentProfile.upsert({
          where: { userId },
          create: { userId, summary },
          update: { summary },
        }),
        this.prisma.studentProfileEvent.updateMany({
          where: { id: { in: pendingEvents.map((event) => event.id) } },
          data: { summarizedAt: now },
        }),
      ]);

      return summary;
    } catch (error) {
      this.logger.warn(`Falha ao atualizar prontuario do userId=${userId}: ${(error as Error).message}`);
      return existing?.summary ?? '';
    }
  }

  private buildSystemPrompt() {
    return [
      'Voce mantem o prontuario de um aluno de corrida: um resumo curto e cumulativo que outro agente (o que monta o treino da semana) le em vez de reler o historico bruto inteiro toda vez.',
      'Sua unica tarefa e pegar o resumo atual (pode estar vazio, se for o primeiro uso) e as novas linhas de evento registradas desde a ultima atualizacao, e devolver um resumo atualizado. Nao pense demais nisso, nao tente analisar profundamente ou tirar conclusoes elaboradas — sua funcao e condensar e organizar, nao interpretar como um treinador faria.',
      'Escreva em portugues, em prosa corrida ou topicos curtos, o que for mais compacto. Mantenha o resumo enxuto — na pratica, poucos paragrafos curtos cobrindo: perfil basico e historico relevante do aluno, diretrizes ativas do gerente tecnico, observacoes recentes do aluno, dores relatadas relevantes, e padroes de consistencia/evolucao que valham a pena o proximo agente saber.',
      'Excecao importante: quando uma linha de evento vier de uma observacao do proprio aluno (codigo STUDENT_OBSERVATION) ou de uma diretriz do gerente tecnico (codigo DIRECTIVE_ADDED), preserve o conteudo quase literalmente no resumo, mesmo que isso deixe essa parte mais longa que o restante — essas duas fontes tem prioridade quase absoluta para o agente de treino, e parafrasear demais pode perder um detalhe que muda a prescricao.',
      'Para feedback de treino (codigo WORKOUT_COMPLETED): se o feedback registrado for curto, mantenha como esta; se for longo, condense na frase que capture o essencial (ex: incomodo relatado, dificuldade, sensacao geral), sem preservar o texto inteiro.',
      'Eventos antigos que ja estavam refletidos no resumo atual nao precisam ser citados de novo com os mesmos detalhes — atualize/substitua a informacao antiga quando um evento novo a superar (ex: uma nova diretriz substitui a anterior sobre o mesmo assunto), em vez de empilhar tudo.',
    ].join('\n\n');
  }

  private buildUserPrompt(currentSummary: string, events: { code: string; content: string; createdAt: Date }[]) {
    return JSON.stringify(
      {
        resumoAtual: currentSummary || '(vazio — primeira atualizacao deste aluno)',
        eventosNovos: events.map((event) => ({
          data: event.createdAt.toISOString().slice(0, 10),
          codigo: event.code,
          conteudo: event.content,
        })),
      },
      null,
      2,
    );
  }
}
