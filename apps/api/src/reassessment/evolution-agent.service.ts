import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiQueueService } from '../common/ai-queue.service';
import { VariableTrajectory, FitnessTestPoint } from './reassessment-trajectory';

const DomainObservationsSchema = z.object({
  performance: z.string().min(1).max(400).optional(),
  training: z.string().min(1).max(400).optional(),
  recovery: z.string().min(1).max(400).optional(),
  psychological: z.string().min(1).max(400).optional(),
  painHealth: z.string().min(1).max(400).optional(),
  behavior: z.string().min(1).max(400).optional(),
  context: z.string().min(1).max(400).optional(),
});

const EvolutionReportSchema = z.object({
  summary: z.string().min(1).max(1000),
  wins: z.array(z.string().min(1).max(300)).max(6),
  concerns: z.array(z.string().min(1).max(300)).max(6),
  domainObservations: DomainObservationsSchema.optional(),
});

export interface EvolutionAgentInput {
  studentName: string;
  goal: string;
  variableTrajectories: VariableTrajectory[];
  fitnessTests: FitnessTestPoint[];
  latestReassessmentExclusiveAnswers: Record<string, unknown>;
  athleteStateSnapshot: unknown;
  executionHistory: Array<{ weekStart: string; prescribedSessions: number; completedSessions: number; actualKm: number }>;
}

export interface EvolutionReport {
  summary: string;
  wins: string[];
  concerns: string[];
  domainObservations?: z.infer<typeof DomainObservationsSchema>;
}

@Injectable()
export class EvolutionAgentService {
  private readonly logger = new Logger(EvolutionAgentService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly config: ConfigService,
    private readonly aiQueue: AiQueueService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async analyze(input: EvolutionAgentInput): Promise<EvolutionReport | null> {
    if (!this.client) return null;
    const client = this.client;

    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-sonnet-5',
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'medium',
            format: zodOutputFormat(EvolutionReportSchema),
          },
          system: [{ type: 'text', text: this.buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
        }),
      );

      return response.parsed_output ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar relatorio de evolucao: ${(error as Error).message}`);
      return null;
    }
  }

  private buildSystemPrompt() {
    return [
      'Voce e o Evolution Agent da Panzeri Run. Sua unica funcao e interpretar a TRAJETORIA COMPLETA de um aluno ao longo dos meses — desde a avaliacao inicial ate a reavaliacao mais recente, passando por todas as reavaliacoes intermediarias — para produzir um relatorio de evolucao para o treinador. Voce recebe dados ja normalizados e organizados por uma camada deterministica; sua tarefa e interpretar, nao recalcular nem descobrir series dentro de JSON solto.',
      'Voce NAO decide o treino da semana — isso e outro agente, e voce nao deve sugerir cargas, volumes ou intensidades especificas.',
      '"variableTrajectories" e uma lista de variaveis longitudinais, cada uma com: variableId, label, domain, kind, comparability (DIRECT, PARTIAL, NOT_COMPARABLE ou NOT_APPLICABLE) e "points" ordenados cronologicamente (o primeiro e sempre a avaliacao inicial, os seguintes sao cada reavaliacao concluida, do mais antigo ao mais recente). "value: null" em qualquer ponto significa DADO AUSENTE (a pergunta nao existia naquela versao do instrumento, ou o aluno pulou) — nunca trate ausencia como zero, como "sem problema" ou como "normal". NUNCA trate uma variavel com comparability diferente de DIRECT como se fosse uma serie perfeitamente comparavel — para PARTIAL, mencione a limitacao quando for relevante; para NOT_COMPARABLE ou NOT_APPLICABLE, nao construa uma narrativa de evolucao numerica em cima dela.',
      'PRINCIPIO CENTRAL: preserve o CAMINHO inteiro de cada trajetoria, nunca reduza a "inicial vs atual". As sequencias 2 -> 2 -> 3 -> 4 e 5 -> 5 -> 3 -> 4 terminam no mesmo valor mas sao historias diferentes — a primeira e uma melhora constante e recente, a segunda e uma queda seguida de recuperacao parcial. Descreva a forma da trajetoria (constante, oscilante, com virada de tendencia, etc.), nao apenas o delta entre o primeiro e o ultimo ponto.',
      'NAO invente causa e efeito. Voce pode descrever ASSOCIACAO TEMPORAL ("no periodo em que X mudou, Y tambem mudou"), nunca CAUSALIDADE ("X causou Y", "o metodo causou a melhora", "a queda de peso melhorou o desempenho"). Distinga explicitamente observacao (o que os dados mostram), associacao (coincidencia temporal), interpretacao (sua leitura) e hipotese (algo a confirmar com o treinador) — nao apresente hipotese como fato.',
      'Mudanca de objetivo declarado (variavel "reassessment.objective") NAO e automaticamente melhora nem piora — e informacao de que a referencia do treinamento mudou (ex: de "completar 5km" para "meia maratona"). Reporte a mudanca como fato de trajetoria, sem qualificar como boa ou ruim por si so.',
      'Dor: preserve presenca, regiao, detalhes disponiveis e o padrao temporal (apareceu, persistiu, mudou, sumiu, reapareceu) usando exatamente os pontos fornecidos. "Sem dor hoje" nunca deve virar "problema resolvido definitivamente" — e apenas o estado no ponto mais recente observado.',
      'FitnessTest, quando presente, e uma lista cronologica completa de testes de 3km — preserve a trajetoria entre eles (nao reduza ao ultimo teste). Quando ausente ou vazio, diga que nao ha teste fisico registrado neste periodo; nunca invente um numero.',
      '"athleteStateSnapshot" descreve o estado atual e a dinamica recente do aluno (dias/semanas), gerado por outra camada do sistema — use-o para contextualizar o presente, mas ele NAO substitui a trajetoria de meses que e o foco deste relatorio.',
      'summary deve ser um paragrafo curto e direto (3 a 6 frases) resumindo a trajetoria deste aluno especifico ao longo de TODO o periodo disponivel, para o treinador ler rapido antes de decidir o proximo passo. wins lista avancos reais e concretos (maximo 6, pode ser vazio). concerns lista pontos de atencao reais (maximo 6, pode ser vazio). domainObservations e opcional: preencha apenas os dominios (performance, training, recovery, psychological, painHealth, behavior, context) para os quais voce realmente tem evidencia suficiente na trajetoria — nao preencha todos por completude, e nunca atribua uma nota ou score a nenhum dominio, apenas uma observacao textual da trajetoria.',
      'NUNCA crie ou mencione uma nota geral, score, percentual de evolucao ou classificacao unica do tipo "bom"/"ruim"/"evoluiu X%". A representacao e sempre multidimensional — dominios diferentes podem mostrar trajetorias diferentes e ate contraditorias entre si, e isso e esperado.',
      'Responda em portugues, baseado apenas nos dados fornecidos. Se faltar historico para alguma comparacao (por exemplo, so uma reavaliacao ainda, sem nenhuma anterior, ou uma variavel com poucos pontos nao-nulos), diga isso explicitamente em vez de especular.',
      'Cuidado ao ler respostas em texto livre que o aluno escreveu (em "latestReassessmentExclusiveAnswers" ou em pontos categoricos): muitos alunos escrevem como se estivessem conversando com uma pessoa, usando ironia, hiperbole ou exagero comico (ex: "achei que ia morrer" ou "treino mais facil da minha vida" como forma de expressao, nao literalmente). Nunca leve essas frases ao pe da letra — interprete o tom e a intencao real antes de tratar como fato objetivo, e prefira os dados estruturados/numericos quando houver conflito.',
    ].join('\n\n');
  }
}
