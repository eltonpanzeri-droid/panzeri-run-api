import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiQueueService } from '../common/ai-queue.service';
import { AI_MODELS } from '../common/ai-models.config';
import { logAiUsage } from '../common/ai-usage-logger';
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

// Condensacao incremental do Prontuario (28/09/2026, fechamento Relator -> Prontuario -> Treinador).
// Mesmo agente (EvolutionAgentService), segunda funcao: em vez de interpretar a trajetoria inteira
// de reavaliacoes (analyze() acima), aqui ele condensa o resumo cumulativo — resumo atual + eventos
// novos (incluindo relatos do aluno ja interpretados pelo Agente Relator) — numa versao atualizada.
// Nao substitui o Evolution Report periodico; roda incrementalmente, muito mais barato e frequente.
const ProfileCondensationSchema = z.object({
  summary: z.string().min(1).max(6000),
});

export interface ProfileCondensationInput {
  currentSummary: string;
  newEvents: Array<{ code: string; content: string; createdAt: string }>;
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

    const startedAt = Date.now();
    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: AI_MODELS.SONNET_5,
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
      logAiUsage(this.logger, { agent: 'prontuario', model: AI_MODELS.SONNET_5, usage: response.usage, durationMs: Date.now() - startedAt, ttl: '5m (default)' });

      return response.parsed_output ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar relatorio de evolucao: ${(error as Error).message}`);
      return null;
    }
  }

  async condenseProfile(input: ProfileCondensationInput): Promise<string | null> {
    if (!this.client) return null;
    const client = this.client;

    const startedAt = Date.now();
    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: AI_MODELS.SONNET_5,
          max_tokens: 1800,
          thinking: { type: 'disabled' },
          output_config: {
            effort: 'medium',
            format: zodOutputFormat(ProfileCondensationSchema),
          },
          system: [{ type: 'text', text: this.buildProfileCondensationSystemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: this.buildProfileCondensationUserPrompt(input) }],
        }),
      );
      logAiUsage(this.logger, { agent: 'prontuario_condensacao', model: AI_MODELS.SONNET_5, usage: response.usage, durationMs: Date.now() - startedAt, ttl: '5m (default)' });

      return response.parsed_output?.summary ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao condensar prontuario: ${(error as Error).message}`);
      return null;
    }
  }

  private buildProfileCondensationSystemPrompt() {
    return [
      'Voce mantem o prontuario de um aluno de corrida: um resumo curto e cumulativo que o Agente Treinador le em vez de reler o historico bruto inteiro toda vez que monta o treino da semana.',
      'Sua tarefa e pegar o resumo atual (pode estar vazio, se for o primeiro uso) e as novas linhas de evento registradas desde a ultima atualizacao, e devolver um resumo atualizado — nunca um resumo do zero.',
      'ESTRUTURA OBRIGATORIA — organize o resumo em 5 secoes, sempre nesta ordem, com esses titulos curtos (pode deixar uma secao com "sem informacao relevante ainda" quando nao houver nada real pra colocar nela, nunca invente conteudo pra preencher):',
      '1) QUEM E — caracteristicas relevantes e estaveis deste aluno (perfil, nivel, forma como responde a treino).',
      '2) DE ONDE VEIO — historico relevante, limitacoes, experiencias e antecedentes necessarios pra entender o presente (nunca apagar so porque e antigo — ver regra de compactacao por recencia abaixo).',
      '3) TRAJETORIA/JORNADA — progressoes, regressoes, recorrencias, mudancas importantes, dificuldades e respostas ao longo do tempo (a linha do tempo de topicos recorrentes descrita abaixo vive principalmente aqui).',
      '4) ESTADO ATUAL — o que caracteriza o aluno AGORA. Nunca mantenha aqui algo que ja foi resolvido — informacao resolvida se move pra TRAJETORIA (como historico), nao desaparece do prontuario, so deixa de representar o presente.',
      '5) PARA ONDE ESTA INDO — objetivos atuais, prova/evento quando houver, prioridades e direcao da preparacao.',
      'REGISTRO OBRIGATORIO — ao escrever qualquer frase, deixe claro (pelo proprio texto, sem precisar de tag formal) se aquilo e: um FATO objetivo (aconteceu, é verificavel — ex: completou X km, registrou Y), um RELATO DO ALUNO (o que ele mesmo disse, em suas palavras ou parafraseado, mesmo quando ainda nao confirmado por dado objetivo), um PADRAO OBSERVADO (algo que se repete em mais de uma ocasiao), uma INTERPRETACAO/HIPOTESE (leitura ou suposicao, nunca uma certeza — sempre com linguagem como "parece", "pode indicar", "aluno relata perceber"), ou uma DIRETIVA DO TREINADOR (ordem explicita, tratada como regra ativa, nunca como sugestao). NUNCA promova uma interpretacao/hipotese a fato so porque ela apareceu num evento processado pelo Agente Relator — ela continua sendo interpretacao no prontuario tambem.',
      'EVENTOS DO CODIGO STUDENT_REPORT_ANALYZED vem ja interpretados pelo Agente Relator (outro agente, que le texto livre do aluno). O conteudo desses eventos ja separa FATO de PERCEPCAO/HIPOTESE explicitamente — preserve essa separacao ao incorporar no prontuario, nunca funda os dois numa frase so que pareca um fato unico. O campo de relevancia desses eventos (ACOMPANHAR/LONGITUDINAL/MUDANCA_IMPORTANTE — PONTUAL nunca chega ate aqui, fica so na Linha do Tempo) indica o quanto aquilo deve pesar: MUDANCA_IMPORTANTE normalmente afeta ESTADO ATUAL e/ou PARA ONDE ESTA INDO; LONGITUDINAL normalmente alimenta a linha do tempo em TRAJETORIA; ACOMPANHAR fica registrado mas com peso mais leve ate confirmar se vira padrao.',
      'NUNCA transforme um relato interpretado (dor, desmotivacao, sono ruim, cansaco, mudanca de rotina, etc.) numa regra de treino ou numa recomendacao de ajuste — isso nao e papel do prontuario nem seu, e do Agente Treinador decidir o que fazer com a informacao. Voce so descreve o que e verdade sobre o aluno, nunca prescreve nem sugere reducao/aumento de nada.',
      'REGRA MAIS IMPORTANTE (preservacao historica): nunca apague um fato so porque ele nao foi mencionado de novo. O resumo e cumulativo, nao substitutivo. Se o aluno relatou dor no pe uma vez e depois nao comentou mais nada sobre isso, o resumo continua dizendo que ele relatou dor no pe naquela ocasiao — so que agora sem relatos mais recentes sobre o assunto, e essa informacao migra de ESTADO ATUAL pra TRAJETORIA quando deixar de ser atual. NAO conclua que algo "acabou" nem que "continua" so pela ausencia de relato novo — ausencia de relato NAO e resolucao confirmada. Se precisar ser mais claro, use frases como "sem relatos recentes sobre isso desde [periodo]" em vez de apagar o assunto.',
      'RASTREIE TOPICOS RECORRENTES (dor, satisfacao, aderencia, motivacao, rotina, e qualquer coisa que se repita) como uma linha do tempo curta dentro de TRAJETORIA, nao como itens soltos e desconectados: um segundo relato do mesmo assunto reforca que ele ainda esta presente na vida do aluno; relatos seguidos indicam algo persistente, mesmo que o aluno continue treinando normalmente; e se o aluno relatar melhora ou ausencia do que antes incomodava, isso vira uma CONTINUACAO da mesma linha, nao a substitui — ex: "relatou dificuldade de motivacao entre marco e maio, com melhora relatada desde entao", nunca so "sem problema de motivacao" (isso apagaria que o problema existiu e foi relevante).',
      'Fora esse rastreamento de topicos recorrentes e a organizacao nas 5 secoes, nao pense demais: nao tente analisar profundamente nem tirar conclusoes elaboradas sobre o aluno alem do que os eventos realmente sustentam — sua funcao e condensar e organizar, nao interpretar como um treinador ou psicologo fariam.',
      'Escreva em portugues, em prosa corrida ou topicos curtos por secao, o que for mais compacto. Mantenha o resumo enxuto no total.',
      'Excecao importante: quando uma linha de evento vier de uma observacao do proprio aluno (codigo STUDENT_OBSERVATION), de uma diretriz do gerente tecnico (codigo DIRECTIVE_ADDED), ou de um relato do aluno com relevancia MUDANCA_IMPORTANTE (codigo STUDENT_REPORT_ANALYZED), preserve o conteudo quase literalmente no resumo, mesmo que isso deixe essa parte mais longa que o restante — essas fontes tem prioridade quase absoluta para o Agente Treinador, e parafrasear demais pode perder um detalhe que muda a prescricao.',
      'Para feedback de treino (codigo WORKOUT_COMPLETED): se o feedback registrado for curto, mantenha como esta; se for longo, condense na frase que capture o essencial (ex: incomodo relatado, dificuldade, sensacao geral), sem preservar o texto inteiro.',
      'PESO POR RECENCIA COM O TEMPO: conforme o resumo for crescendo ao longo de meses/anos, e normal que voce precise compactar trechos antigos pra manter o texto gerenciavel — mas so compacte topicos que ja estao claramente resolvidos/inativos ha bastante tempo, nunca os mais recentes (ultimos ~2 meses merecem mais detalhe). Compactar significa resumir em menos palavras, mantendo o fato central (ex: um paragrafo sobre "episodios de dor no joelho entre marco e maio de 2026, resolvidos desde entao" pode, um ano depois, virar so "teve episodio de dor no joelho em 2026, resolvido") — nunca apagar o fato por completo.',
    ].join('\n\n');
  }

  private buildProfileCondensationUserPrompt(input: ProfileCondensationInput) {
    return JSON.stringify(
      {
        resumoAtual: input.currentSummary || '(vazio — primeira atualizacao deste aluno)',
        eventosNovos: input.newEvents.map((event) => ({
          data: event.createdAt.slice(0, 10),
          codigo: event.code,
          conteudo: event.content,
        })),
      },
      null,
      2,
    );
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
