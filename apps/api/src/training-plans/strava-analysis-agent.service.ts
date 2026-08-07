import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiQueueService } from '../common/ai-queue.service';

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
  elapsedTimeSec: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  cadence: number | null;
  elevationGainM: number | null;
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

  constructor(
    private readonly config: ConfigService,
    private readonly aiQueue: AiQueueService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async analyze(activities: StravaActivityForAnalysis[]): Promise<StravaAnalysisReport | null> {
    if (!this.client || activities.length < 3) return null;
    const client = this.client;

    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-sonnet-5',
          max_tokens: 2000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'medium',
            format: zodOutputFormat(StravaAnalysisSchema),
          },
          system: [{ type: 'text', text: this.buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: this.buildUserPrompt(activities) }],
        }),
      );

      return response.parsed_output ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar analise do Strava: ${(error as Error).message}`);
      return null;
    }
  }

  private buildSystemPrompt() {
    return [
      'Voce e um agente de apoio que analisa o historico recente de atividades do Strava de um aluno de corrida, para dar contexto extra a outro agente que monta o treino da semana.',
      'Sua tarefa NAO e decidir o treino. Sua tarefa e interpretar os dados brutos (cadencia, frequencia cardiaca media e maxima, pace, distancias, elevacao, tipos de atividade) e "mastigar" isso em um resumo curto e util, como um treinador humano leria uma planilha de dados.',
      'Preste atencao especial a: tendencias de cadencia (cadencia muito baixa para corrida pode indicar passada overstriding ou fadiga acumulada), relacao entre frequencia cardiaca e pace ao longo do tempo (FC subindo para o mesmo pace pode indicar fadiga acumulada, destreino ou calor), presenca de outras modalidades alem de corrida (bike, natacao, musculacao registrada no proprio Strava, yoga etc.) que competem ou complementam o volume de corrida, e qualquer padrao relevante de consistencia, volume ou risco.',
      'CORRER A DISTANCIA E DIFERENTE DE COMPLETAR A DISTANCIA: muita gente confunde as duas coisas, e o proprio Strava nao distingue — "correr 21km" (todo o percurso corrido) e "completar 21km" (parte caminhada, parte corrida, ou com paradas) sao capacidades bem diferentes, especialmente relevante quando o aluno esta evoluindo em direcao a uma distancia de prova. Cruze cadencia, pace, elevacao e ganhoElevacaoM pra formar essa leitura — nao olhe cadencia isolada como "sinal de fadiga" sem checar se o resto do quadro bate: uma cadencia mais baixa e um pace mais lento JUNTOS, numa atividade com ganhoElevacaoM alto (subida forte), normalmente sao so o efeito natural do terreno, nao um problema. Ja uma cadencia bem abaixo do padrao habitual do aluno, com pace tambem bem mais lento, SEM elevacao que explique isso, e o padrao mais consistente com trechos caminhados dentro do treino — se ver esse padrao, diga isso claramente numa flag (algo como "o pace/cadencia dessa atividade sugerem que parte do percurso pode ter sido caminhada, nao so corrida"), pra quem decide o proximo treino nao tratar a distancia toda como corrida continua comprovada.',
      'CUIDADO COM FALHA DE GPS: o Strava depende do GPS do celular/relogio, que as vezes perde sinal por alguns segundos (predio alto, mata fechada, tunel) — isso pode gerar um pico ou queda pontual e artificial de pace/distancia numa atividade, sem relacao nenhuma com o esforco real do aluno. Antes de apontar uma variacao branda e isolada como um padrao relevante, considere se pode ser so ruido de GPS breve — de por medias e tendencias ao longo de VARIAS atividades, nao a uma oscilacao unica e pequena numa atividade so.',
      'Responda em portugues. Seja direto e especifico com os numeros observados no historico fornecido, sem inventar dados que nao estao la. Se os dados forem insuficientes para alguma conclusao, diga isso em vez de especular.',
      'O campo flags deve conter no maximo 6 observacoes curtas e acionaveis (uma frase cada). O campo crossTrainingNote deve ser null se o aluno so faz corrida, ou uma frase curta descrevendo o padrao de outras modalidades quando houver.',
      'Cuidado com o campo "name" das atividades: e um titulo que o proprio aluno escreve no Strava, muitas vezes de forma informal, com ironia, exagero comico ou brincadeira (ex: "corrida da morte", "quase desisti" numa corrida que na verdade foi tranquila). Nunca trate esse texto como um relato literal e objetivo — use apenas os dados numericos (pace, FC, cadencia, distancia, elevacao) como evidencia real; o titulo e no maximo um contexto de tom, nunca uma fonte de fato.',
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
          duracaoMinMovimento: activity.movingTimeSec ? Math.round(activity.movingTimeSec / 60) : null,
          // Diferenca entre tempo decorrido e tempo em movimento — gap grande indica paradas reais
          // (semaforo, alongamento no meio, agua parada), nao caminhada (que conta como "em
          // movimento" nos dois campos).
          duracaoMinDecorrida: activity.elapsedTimeSec ? Math.round(activity.elapsedTimeSec / 60) : null,
          paceSegundosPorKm: activity.avgPaceSecKm,
          cadencia: activity.cadence,
          ganhoElevacaoM: activity.elevationGainM,
          fcMedia: activity.avgHeartRate,
          fcMaxima: activity.maxHeartRate,
        })),
      },
      null,
      2,
    );
  }
}
