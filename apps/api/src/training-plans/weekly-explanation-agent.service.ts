import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiQueueService } from '../common/ai-queue.service';

const WeeklyExplanationSchema = z.object({
  currentWeekExplanation: z.string().min(1).max(1500),
  fourWeekOutlook: z.string().min(1).max(1500),
});

export interface WeeklyExplanationInput {
  studentName: string;
  goal: string;
  firstInterviewAnswers: Record<string, unknown>;
  latestReassessment: {
    completedAt: string;
    answers: Record<string, unknown>;
    evolutionSummary?: string | null;
  } | null;
  recentFeedback: Array<{
    date: string;
    title: string;
    prescribedDistanceKm: number | null;
    prescribedDurationMin: number | null;
    completed: boolean;
    completedDistanceKm: number | null;
    completedDurationMin: number | null;
    satisfaction: string | null;
    perceivedEffort: number | null;
    studentNotes: string | null;
  }>;
  mostConcerningPain: { reason: string; tier: string; lastReportAt: string | null } | null;
  stravaAnalysis: { summary: string; flags: string[] } | null;
  activeDirectives: string[];
  activeObservations: string[];
  targetRace: { name: string; raceDate: string; distanceKm: number } | null;
  thisWeekSessions: Array<{ day: string; title: string; sessionType: string; zone: string; durationMin: number }>;
  aiRecommendation: string;
  aiRationale: string[];
  aiPaceRationale: string;
}

export interface WeeklyExplanationReport {
  currentWeekExplanation: string;
  fourWeekOutlook: string;
}

@Injectable()
export class WeeklyExplanationAgentService {
  private readonly logger = new Logger(WeeklyExplanationAgentService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly config: ConfigService,
    private readonly aiQueue: AiQueueService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async explain(input: WeeklyExplanationInput): Promise<WeeklyExplanationReport | null> {
    if (!this.client) return null;
    const client = this.client;

    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-sonnet-5',
          max_tokens: 3000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'medium',
            format: zodOutputFormat(WeeklyExplanationSchema),
          },
          system: this.buildSystemPrompt(),
          messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
        }),
      );

      return response.parsed_output ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar explicacao semanal (nao bloqueia a geracao do treino): ${(error as Error).message}`);
      return null;
    }
  }

  private buildSystemPrompt() {
    return [
      'Voce e o agente que escreve, para o TREINADOR (nunca para o aluno), uma explicacao em portugues de por que a semana de treino atual foi montada assim, e o que voce pretende fazer nas proximas semanas. Isso e uma ferramenta de acompanhamento/auditoria do treinador sobre o seu proprio raciocinio — seja honesto, especifico e cite os dados reais que voce recebeu, nunca invente numeros ou fatos.',
      'CRITICO — voce NAO decide o treino, apenas explica uma decisao que outro agente ja tomou: os campos aiRecommendation, aiRationale e aiPaceRationale sao a fundamentacao REAL e ja definitiva que o agente de prescricao usou para montar a semana (incluindo como ele avaliou o nivel/capacidade do aluno). Sua explicacao deve ser CONSISTENTE com esses campos — nunca reavalie o nivel do aluno, o pace ou a logica por conta propria a partir dos dados brutos (entrevista, feedback, Strava) de um jeito que contradiga o que esses campos ja dizem. Use os dados brutos so para dar cor/exemplos concretos, nunca para chegar a uma conclusao diferente da que ja foi tomada.',
      'Vinculacao obrigatoria: sua explicacao da semana atual deve citar, quando relevante, a entrevista inicial e reavaliacoes ja feitas, o feedback recente dos treinos (ultimas semanas, incluindo comentarios do proprio aluno — mas cuidado, alunos escrevem de forma informal, com ironia ou exagero, entao interprete o tom antes de tratar como fato literal), o sinal de dor mais preocupante recente (se houver), a comparacao entre o que foi prescrito x o que o aluno realmente fez x o que a analise do Strava encontrou, as diretivas especificas que o treinador deu para este aluno, e as observacoes que o proprio aluno registrou (contexto informal, nao vinculante).',
      'currentWeekExplanation: paragrafo curto e direto (4 a 8 frases) explicando o raciocinio real por tras da semana que acabou de ser gerada (thisWeekSessions), amarrando com os dados acima.',
      'fourWeekOutlook: um paragrafo curto descrevendo, de forma qualitativa (sem prometer numeros exatos como se fossem definitivos), a intencao de progressao para as proximas ~4 semanas — ex: "se a aderencia continuar boa, pretendo aumentar o longao gradualmente nas proximas semanas, culminando num pico antes da prova em [data], seguido de polimento". Deixe claro implicitamente que isso e uma intencao sujeita a mudanca conforme a realidade dos proximos treinos, nao um compromisso fixo.',
      'Se activeObservations tiver algo que pareca ter perdido a validade (ex: um evento que provavelmente ja passou), mencione isso de forma sutil na explicacao, sugerindo ao treinador revisar/arquivar aquela observacao — mas nunca decida sozinho que ela nao vale mais.',
      'Responda em portugues, direto e tecnico, como um profissional explicando seu proprio raciocinio para outro profissional.',
    ].join('\n\n');
  }
}
