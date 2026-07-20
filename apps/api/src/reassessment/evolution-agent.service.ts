import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const EvolutionReportSchema = z.object({
  summary: z.string().min(1).max(1000),
  wins: z.array(z.string().min(1).max(300)).max(6),
  concerns: z.array(z.string().min(1).max(300)).max(6),
});

export interface EvolutionAgentInput {
  studentName: string;
  goal: string;
  firstInterviewAnswers: Record<string, unknown>;
  latestReassessmentAnswers: Record<string, unknown>;
  previousReassessments: Array<{ completedAt: string | null; answers: Record<string, unknown> }>;
  fitnessTests: Array<{ createdAt: string; paceSecondsPerKm: number; totalSeconds: number }>;
  executionHistory: Array<{ weekStart: string; prescribedSessions: number; completedSessions: number; actualKm: number }>;
}

export interface EvolutionReport {
  summary: string;
  wins: string[];
  concerns: string[];
}

@Injectable()
export class EvolutionAgentService {
  private readonly logger = new Logger(EvolutionAgentService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async analyze(input: EvolutionAgentInput): Promise<EvolutionReport | null> {
    if (!this.client) return null;

    try {
      const response = await this.client.messages.parse({
        model: 'claude-opus-4-8',
        max_tokens: 3000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(EvolutionReportSchema),
        },
        system: this.buildSystemPrompt(),
        messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
      });

      return response.parsed_output ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar relatorio de evolucao: ${(error as Error).message}`);
      return null;
    }
  }

  private buildSystemPrompt() {
    return [
      'Voce e o agente de evolucao da Panzeri Run. Sua unica funcao e comparar o ponto de partida de um aluno (entrevista inicial) com o momento atual (reavaliacao mais recente), alem do historico de testes de 3 km e da aderencia real aos treinos prescritos, para produzir um relatorio de evolucao para o treinador.',
      'Voce NAO decide o treino da semana — isso e outro agente. Sua tarefa e interpretar a trajetoria deste aluno especifico ao longo do tempo.',
      'Considere: mudanca de pace/condicionamento entre testes de 3 km ao longo do tempo, mudanca de volume semanal relatado entre a entrevista inicial e a reavaliacao mais recente, consistencia e aderencia real aos treinos prescritos (prescrito x concluido), e o que o proprio aluno relatou sentir na reavaliacao (dor nova, satisfacao, percepcao de evolucao, mudanca de rotina).',
      'Responda em portugues. Seja especifico e baseado apenas nos dados fornecidos, nunca invente numeros ou fatos que nao estao no historico. Se faltar historico para alguma comparacao (por exemplo, so uma reavaliacao ainda, sem nenhuma anterior), diga isso explicitamente em vez de especular.',
      'summary deve ser um paragrafo curto e direto (3 a 6 frases) resumindo a trajetoria deste aluno especifico, para o treinador ler rapido antes de decidir o proximo passo com ele. wins deve listar avancos reais e concretos (maximo 6, pode ser vazio). concerns deve listar pontos de atencao reais (maximo 6, pode ser vazio se nao houver nenhum).',
    ].join('\n\n');
  }
}
