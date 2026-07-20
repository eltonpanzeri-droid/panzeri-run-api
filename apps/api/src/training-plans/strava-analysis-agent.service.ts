import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const StravaAnalysisSchema = z.object({
  summary: z.string().min(1).max(800),
  flags: z.array(z.string().min(1).max(300)).max(6),
  crossTrainingNote: z.string().min(1).max(300).nullable(),
});

export interface StravaActivityForAnalysis {
  startDate: Date;
  type: string | null;
  name: string | null;
  distanceKm: number | null;
  movingTimeSec: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  cadence: number | null;
}

export interface StravaAnalysisReport {
  summary: string;
  flags: string[];
  crossTrainingNote: string | null;
}

@Injectable()
export class StravaAnalysisAgentService {
  private readonly logger = new Logger(StravaAnalysisAgentService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async analyze(activities: StravaActivityForAnalysis[]): Promise<StravaAnalysisReport | null> {
    if (!this.client || activities.length < 3) return null;

    try {
      const response = await this.client.messages.parse({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(StravaAnalysisSchema),
        },
        system: this.buildSystemPrompt(),
        messages: [{ role: 'user', content: this.buildUserPrompt(activities) }],
      });

      return response.parsed_output ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar analise do Strava: ${(error as Error).message}`);
      return null;
    }
  }

  private buildSystemPrompt() {
    return [
      'Voce e um agente de apoio que analisa o historico recente de atividades do Strava de um aluno de corrida, para dar contexto extra a outro agente que monta o treino da semana.',
      'Sua tarefa NAO e decidir o treino. Sua tarefa e interpretar os dados brutos (cadencia, frequencia cardiaca media e maxima, pace, distancias, tipos de atividade) e "mastigar" isso em um resumo curto e util, como um treinador humano leria uma planilha de dados.',
      'Preste atencao especial a: tendencias de cadencia (cadencia muito baixa para corrida pode indicar passada overstriding ou fadiga acumulada), relacao entre frequencia cardiaca e pace ao longo do tempo (FC subindo para o mesmo pace pode indicar fadiga acumulada, destreino ou calor), presenca de outras modalidades alem de corrida (bike, natacao, musculacao registrada no proprio Strava, yoga etc.) que competem ou complementam o volume de corrida, e qualquer padrao relevante de consistencia, volume ou risco.',
      'Responda em portugues. Seja direto e especifico com os numeros observados no historico fornecido, sem inventar dados que nao estao la. Se os dados forem insuficientes para alguma conclusao, diga isso em vez de especular.',
      'O campo flags deve conter no maximo 6 observacoes curtas e acionaveis (uma frase cada). O campo crossTrainingNote deve ser null se o aluno so faz corrida, ou uma frase curta descrevendo o padrao de outras modalidades quando houver.',
    ].join('\n\n');
  }

  private buildUserPrompt(activities: StravaActivityForAnalysis[]) {
    return JSON.stringify(
      {
        atividadesRecentes: activities.map((activity) => ({
          data: activity.startDate.toISOString().slice(0, 10),
          tipo: activity.type,
          nome: activity.name,
          distanciaKm: activity.distanceKm,
          duracaoMin: activity.movingTimeSec ? Math.round(activity.movingTimeSec / 60) : null,
          paceSegundosPorKm: activity.avgPaceSecKm,
          cadencia: activity.cadence,
          fcMedia: activity.avgHeartRate,
          fcMaxima: activity.maxHeartRate,
        })),
      },
      null,
      2,
    );
  }
}
