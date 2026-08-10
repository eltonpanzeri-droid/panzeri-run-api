import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  MethodologyInput,
  RunSessionDecision,
  StrengthSessionDecision,
  WeeklyMethodologyDecision,
  computeRunSlots,
  computeStrengthSlots,
  hasSafetyConcern,
  isNovice,
} from './training-methodology';
import { PANZERI_METHODOLOGY_KNOWLEDGE } from './panzeri-methodology-knowledge';
import { AiQueueService } from '../common/ai-queue.service';
import { gymExerciseLibrary } from './gym-exercise-library';
import { runnerStrengthExercises } from './runner-strength-library';

// A entrevista pergunta o km semanal atual em faixas (opcao de marcar), nao em numero digitado.
const WEEKLY_KM_RANGE_LABELS: Record<string, string> = {
  '0_10': 'ate 10 km por semana',
  '10_20': '10 a 20 km por semana',
  '20_30': '20 a 30 km por semana',
  '30_40': '30 a 40 km por semana',
  '40_50': '40 a 50 km por semana',
  '50_75': '50 a 75 km por semana',
  '75_100': '75 a 100 km por semana',
  '100_plus': 'mais de 100 km por semana',
};

// Historico: limites de caracteres nesses campos de texto livre ja causaram varias falhas
// silenciosas na pratica (para alunos com contexto mais complexo — muitas diretivas/observacoes/
// feedback — a IA escreve justificativas mais longas e o campo estoura o limite) — cada vez que um
// campo diferente estourava, a resposta INTEIRA era rejeitada pelo schema e a geracao falhava,
// indistinguivel de uma falha de rede/API. Bumping um limite de cada vez e cacada de gato e rato:
// por isso os campos puramente explicativos (nunca usados por regra de negocio, so exibidos/logados)
// NAO tem mais limite maximo aqui — sao truncados defensivamente em codigo (ver truncateText) depois
// do parse, entao um texto longo nunca mais derruba a geracao inteira. Campos estruturais curtos
// (title, reps) mantem um limite generoso porque sao rotulos, nao paragrafos de raciocinio.
// Estrutura do bloco intervalado/caminhada-corrida — 100% decidida pela IA, sem nenhuma formula
// nem checagem de tempo/conta em codigo (removido em 2026-07-28 a pedido explicito do treinador:
// nenhuma regra matematica calculando ou validando o treino, nem para "so conferir consistencia" —
// a responsabilidade de a estrutura fazer sentido pro tempo disponivel e inteiramente da IA).

// NAO e mais um piso validado em codigo (removido 02/08 a pedido explicito do treinador — "esse
// piso nao deve existir, apenas recomendacao ao agente"). So um numero usado pra redigir a
// recomendacao no prompt (buildSystemPromptStable/buildRunSessionSystemPrompt): abaixo desse
// ritmo a mecanica da corrida tende a piorar e se aproximar de uma caminhada, mas a decisao final
// de cada pace e sempre da IA — nenhuma resposta e rejeitada por causa deste numero.
const MAX_EASY_PACE_SECONDS_PER_KM = 510; // 8:30/km, so recomendacao

// Cada dia de corrida e uma SEQUENCIA ORDENADA de partes (nunca mais uma escolha unica entre
// "corrida continua OU intervalado OU caminhada-corrida") — pedido explicito do treinador
// (10/08): um treino pode ser misto, com varias partes diferentes em sequencia (ex: uma parte de
// caminhada, depois um bloco intervalado, depois mais caminhada). Normalmente 1 parte so (a
// grande maioria dos dias continua sendo simples), mas quantas fizerem sentido pra ESTE dia.
const AiContinuousPartSchema = z.object({
  kind: z.literal('continua'),
  // Corrida OU caminhada continua — o codigo nao distingue os dois, o pace escolhido e que diz o
  // que e. Cobre tanto ritmo constante (paceSecondsPerKmMin igual ao Max) quanto ritmo variado ao
  // longo da parte (os dois diferentes, descrevendo a faixa real).
  distanceKm: z.number().min(0.05).max(60),
  paceSecondsPerKmMin: z.number().int().min(150).max(1200),
  paceSecondsPerKmMax: z.number().int().min(150).max(1200),
});

const AiIntervalPartSchema = z.object({
  kind: z.literal('intervalada'),
  repeatCount: z.number().int().min(2).max(40),
  // Rotulo curto do que esse trecho e de verdade pro aluno (ex: "Correr forte", "Trotar",
  // "Caminhar", "Correr") — cobre tanto um estimulo forte/recuperacao quanto uma alternancia
  // caminhada/corrida, sem precisar de dois tipos de bloco separados.
  stimulusLabel: z.string().min(1).max(40),
  stimulusStepKm: z.number().min(0.02).max(5),
  stimulusPaceSecondsPerKm: z.number().int().min(120).max(1200),
  recoveryLabel: z.string().min(1).max(40),
  recoveryStepKm: z.number().min(0.02).max(3),
  recoveryPaceSecondsPerKm: z.number().int().min(150).max(1200),
});

const AiSessionPartSchema = z.discriminatedUnion('kind', [AiContinuousPartSchema, AiIntervalPartSchema]);
// Reaproveitado tambem no schema do treino avulso (attemptRunSessionDecision) — mesma forma nos
// dois lugares, so muda o que envolve isso (semana inteira vs. um dia so).
const AiSessionPartsSchema = z.array(AiSessionPartSchema).min(1).max(6);

const AiSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  title: z.string().min(1).max(120),
  durationMin: z.number().int().min(10).max(240),
  // A sequencia de partes que forma este treino, na ordem em que acontecem de verdade (ver
  // AiSessionPartSchema acima). A soma de todas as partes e que vira a distancia/duracao total
  // exibida pro aluno — nao existe mais nenhum campo "resumo" separado, o total e sempre a soma
  // real das partes.
  parts: AiSessionPartsSchema,
  // Campo unico de texto explicativo para este treino: a explicacao principal do treino JUNTO
  // com qualquer cuidado/dica pratica que valha a pena o aluno guardar (ex: um sinal de alerta,
  // uma dica de execucao) — tudo em um so lugar, sem repetir o mesmo conteudo de forma diferente
  // (antes existia um segundo campo "recommendations" separado so pra isso; foi removido em
  // 07/08 a pedido do treinador — dois campos nao ajudavam o aluno e so gastavam token/raciocinio
  // da IA sem necessidade real).
  notes: z.string().min(1),
  // Preenchido quando durationMin ultrapassa o tempo normal disponivel para este weekday
  // especifico — cite a diretriz que autoriza isso para ESTE dia. Null/vazio quando a duracao
  // esta dentro do normal do dia.
  durationJustification: z.string().max(300).nullable(),
});

// Exercicios de forca/fortalecimento tambem sao decisao real da IA, nunca de uma rotina fixa
// escondida — exerciseIds sao validados contra o catalogo aprovado (ver validateStrengthSessions)
// antes de qualquer sessao ser aceita. "notes" e texto explicativo livre, sem limite maximo aqui
// pelo mesmo motivo do AiSessionSchema acima (truncado em codigo, nunca rejeita a resposta toda).
// "reps" tambem ficou sem .max() pelo mesmo motivo: incidente real em producao (2026-07-28) — a
// IA escreve instrucoes tipo "12 cada lado, 3x, controle na descida" que passam facil de 40
// caracteres, e nao e um numero curto tipo "4x12" sempre. Truncado em codigo (ver attemptDecision).
const AiStrengthSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  modality: z.enum(['forca', 'fortalecimento_corredores']),
  title: z.string().min(1).max(120),
  exerciseIds: z.array(z.string().min(1).max(60)).min(3).max(10),
  sets: z.number().int().min(2).max(5),
  reps: z.string().min(1),
  restSeconds: z.number().int().min(20).max(150),
  intensity: z.enum(['Leve', 'Moderada', 'Forte']),
  notes: z.string().min(1),
});

const AiWeeklyDecisionSchema = z.object({
  sessions: z.array(AiSessionSchema).min(1).max(7),
  // Max 7 dias * ate 2 modalidades de forca no mesmo dia (forca + fortalecimento_corredores sao
  // multi-select legitimo no app, ver computeStrengthSlots em training-methodology.ts) = 14, nao
  // 7 — um aluno real com varios dias de dupla modalidade estourava o limite antigo e derrubava a
  // semana inteira com "too_big" (incidente 2026-07-28).
  strengthSessions: z.array(AiStrengthSessionSchema).max(14),
  // Sem .min(1): ja aconteceu na pratica a IA devolver esse campo vazio (resposta boa, so essa
  // string vazia) e a resposta inteira ser rejeitada por causa disso — um campo puramente de
  // texto derrubando uma semana inteira valida. Vazio vira um texto padrao depois do parse (ver
  // attemptDecision), nunca rejeita a resposta.
  recommendation: z.string(),
  // Sem .min(1)/.max() por item: ja aconteceu na pratica a IA devolver um item vazio dentro da
  // lista (ex: rationale[0] = "") e tambem um item longo demais — e a resposta inteira ser
  // rejeitada por causa de UM bullet, desperdicando a chamada cara de IA por um detalhe cosmetico.
  // Itens vazios sao filtrados e itens longos sao truncados depois de parsear (ver attemptDecision).
  rationale: z.array(z.string()).min(1).max(8),
});

// Trunca campos de texto livre gerados pela IA em vez de rejeitar a resposta inteira quando um
// unico campo estoura um tamanho razoavel — ver o historico acima sobre por que os limites de
// caracteres nao ficam mais no schema Zod para esses campos.
const FREE_TEXT_DISPLAY_LIMIT = 2000;
function truncateText(text: string, max: number = FREE_TEXT_DISPLAY_LIMIT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type RunSlot = ReturnType<typeof computeRunSlots>[number];
type StrengthSlot = ReturnType<typeof computeStrengthSlots>[number];

export interface PaceEvidence {
  testPace?: { secondsPerKm: number; daysAgo: number } | null;
  selfReportedPace?: { secondsPerKm: number; source: 'self_report_5k' | 'qualitative' } | null;
  stravaAveragePace?: { secondsPerKm: number; sampleRuns: number } | null;
}

@Injectable()
export class PrescriptionAgentService {
  private readonly logger = new Logger(PrescriptionAgentService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly config: ConfigService,
    private readonly aiQueue: AiQueueService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async proposeWeeklyDecision(input: MethodologyInput, evidence: PaceEvidence): Promise<(WeeklyMethodologyDecision & { source: 'ai' }) | null> {
    if (!this.client) {
      this.logger.error('ANTHROPIC_API_KEY nao configurada — o agente de IA nao pode ser chamado. Nenhum treino sera gerado por regra fixa no lugar disso.');
      return null;
    }

    const runSlots = computeRunSlots(input.availability);
    if (!runSlots.length) return null;

    // UMA tentativa so (02/08, ordem explicita do treinador — incidente real de custo: com 2
    // tentativas por aluno multiplicadas por todos os alunos do cron de domingo, uma rejeicao
    // legitima e comum (ex: "easyVolumeKm sem paceSecondsPerKm") virava gasto de IA em dobro sem
    // gerar nada. Se falhar, quem chama (generateWeek) ja avisa o treinador pelo Telegram e para
    // por ali — sem regra fixa no lugar (nao ha motor deterministico de fallback), o proprio
    // treinador decide gerar de novo pelo painel quando quiser.
    return this.attemptDecision(input, evidence, 'medium');
  }

  // Usado quando o treinador regenera UM dia de forca/fortalecimento isolado (sem regenerar a
  // semana inteira) — mesma exigencia de nunca usar rotina fixa, so que numa chamada menor,
  // focada em um unico dia, em vez de reprocessar a semana toda de corrida junto.
  async proposeStrengthSession(input: MethodologyInput, slot: StrengthSlot): Promise<StrengthSessionDecision | null> {
    if (!this.client) {
      this.logger.error('ANTHROPIC_API_KEY nao configurada — o agente de IA nao pode ser chamado para o dia de forca avulso.');
      return null;
    }
    const attempt = () => this.attemptStrengthSessionDecision(input, slot);
    return (await attempt()) ?? (await attempt());
  }

  // Usado quando o treinador regenera UM dia de corrida isolado (sem mexer no resto da semana). A
  // IA decide TUDO deste dia numa unica
  // chamada — distancia, pace e estrutura, na forma que fizer sentido pra ela (ver AiSessionSchema)
  // — com o mesmo contexto (diretivas, observacoes, sinal de dor) que a geracao semanal usa, nunca
  // uma formula ou um numero reaproveitado de outro dia.
  async proposeRunSession(params: {
    durationMin: number;
    evidence: PaceEvidence;
    studentDirectives: string[];
    activeObservations: string[];
    painTier: 'normal' | 'reduced' | 'remove_running';
    painReason: string | null;
  }): Promise<{ parts: z.infer<typeof AiSessionPartsSchema> } | null> {
    if (!this.client) {
      this.logger.error('ANTHROPIC_API_KEY nao configurada — o agente de IA nao pode ser chamado para o treino avulso.');
      return null;
    }
    const attempt = () => this.attemptRunSessionDecision(params);
    return (await attempt()) ?? (await attempt());
  }

  private async attemptRunSessionDecision(params: {
    durationMin: number;
    evidence: PaceEvidence;
    studentDirectives: string[];
    activeObservations: string[];
    painTier: 'normal' | 'reduced' | 'remove_running';
    painReason: string | null;
  }): Promise<{ parts: z.infer<typeof AiSessionPartsSchema> } | null> {
    const client = this.client;
    if (!client) return null;
    const schema = z.object({ parts: AiSessionPartsSchema });
    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-sonnet-5',
          max_tokens: 2000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium', format: zodOutputFormat(schema) },
          // Prompt identico pra qualquer aluno/chamada — cache_control deixa isso barato depois
          // da primeira vez (ver shared/prompt-caching.md do skill claude-api).
          system: [{ type: 'text', text: this.buildRunSessionSystemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: this.buildRunSessionUserPrompt(params) }],
        }),
      );
      const parsed = response.parsed_output;
      if (!parsed) return null;
      return parsed;
    } catch (error) {
      this.logger.warn(`Falha ao gerar treino avulso com o agente de IA: ${describeAiError(error)}`);
      return null;
    }
  }

  private buildRunSessionSystemPrompt() {
    return [
      'Voce e o agente que decide UM treino de corrida isolado, para um unico dia — o treinador esta regenerando so este dia (ou reparando so este dia dentro de uma geracao maior), sem mexer no resto da semana do aluno. A duracao (durationMinDisponivel) ja esta decidida e nao pode mudar; sua tarefa e decidir tudo o resto pensando no contexto real deste aluno (evidencias de pace, diretivas do treinador, observacoes do aluno, sinal de dor) — nunca uma formula ou proporcao fixa.',
      'O treino e uma sequencia ORDENADA de "parts" (normalmente 1 so, mas pode ter varias se fizer sentido pra este dia — ex: um trecho de caminhada, depois um bloco intervalado, depois mais caminhada). Cada parte e uma destas duas formas: (1) kind "continua" (distanceKm + paceSecondsPerKmMin + paceSecondsPerKmMax — use o mesmo numero nos dois quando o ritmo for constante, ou numeros diferentes quando o ritmo variar de proposito ao longo da parte); (2) kind "intervalada" (repeatCount, stimulusLabel/stimulusStepKm/stimulusPaceSecondsPerKm, recoveryLabel/recoveryStepKm/recoveryPaceSecondsPerKm) — cobre tanto um estimulo forte com recuperacao quanto uma alternancia caminhada/corrida; escreva em stimulusLabel/recoveryLabel o que cada trecho e de verdade pro aluno (ex: "Correr forte"/"Trotar", ou "Caminhar"/"Correr").',
      'NAO EXISTE NENHUMA TABELA OU FORMULA CALCULANDO DISTANCIA A PARTIR DE DURACAO/PACE — voce decide a distancia e o pace de cada parte diretamente, pensando no que faz sentido pra este aluno neste dia. Voce sabe matematica: some o tempo de todas as partes e confira que cabe dentro de durationMinDisponivel — nao existe checagem de conta em codigo depois, a responsabilidade e inteiramente sua.',
      'Voce recebe evidencias de pace (autoRelatoRecente, mediaStravaRecente) — use a mais recente e mais confiavel, nunca uma proporcao fixa entre elas (tipo "pace_teste vezes 0.95").',
      'O "teste de 3km" (feature de avaliacao fisica) foi suspenso pelo treinador — voce nunca recebe mais esse dado, e NUNCA deve sugerir, mencionar ou perguntar ao aluno sobre fazer um teste de 3km em nenhum campo de texto (notes, rationale, recommendation). Se precisar de mais evidencia de pace, baseie-se so no que realmente recebeu (autoRelatoRecente, mediaStravaRecente, historico de treinos).',
      'Se diretrizesEspecificasDoTreinadorParaEsteAluno mencionar algo que se aplique a este dia especifico, aplique literalmente (prioridade quase absoluta). observacoesRegistradasPeloProprioAluno sao informais, considere quando fizer sentido sem sacrificar seguranca. sinalDeSeguranca e motivoDoSinalDeSeguranca sao so informacao de contexto (o aluno relatou dor) — use seu julgamento sobre o que isso muda no treino de hoje, nao existe uma trava automatica aqui.',
      `Recomendacao (nao e uma regra rigida): evite prescrever pace de corrida mais lento que 8:30/km (${MAX_EASY_PACE_SECONDS_PER_KM} segundos por km) quando puder, porque abaixo disso a mecanica da corrida tende a piorar e se aproximar de uma caminhada. Se o ritmo confortavel real deste aluno estiver nessa faixa, considere usar uma parte "intervalada" alternando corrida de verdade com caminhada de verdade — mas a decisao final e sempre sua, pensando no aluno real.`,
    ].join('\n\n');
  }

  private buildRunSessionUserPrompt(params: {
    durationMin: number;
    evidence: PaceEvidence;
    studentDirectives: string[];
    activeObservations: string[];
    painTier: string;
    painReason: string | null;
  }) {
    return JSON.stringify(
      {
        durationMinDisponivel: params.durationMin,
        evidenciasDePace: params.evidence,
        diretrizesEspecificasDoTreinadorParaEsteAluno: params.studentDirectives,
        observacoesRegistradasPeloProprioAluno: params.activeObservations,
        sinalDeSeguranca: params.painTier !== 'normal',
        motivoDoSinalDeSeguranca: params.painReason,
      },
      null,
      2,
    );
  }

  private async attemptStrengthSessionDecision(input: MethodologyInput, slot: StrengthSlot): Promise<StrengthSessionDecision | null> {
    const client = this.client;
    if (!client) return null;
    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-sonnet-5',
          max_tokens: 3000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'high',
            format: zodOutputFormat(AiStrengthSessionSchema),
          },
          system: [{ type: 'text', text: this.buildSingleStrengthSystemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: this.buildSingleStrengthUserPrompt(input, slot) }],
        }),
      );
      const parsed = response.parsed_output;
      if (!parsed) return null;
      // Chamada avulsa pra um slot ESPECIFICO (repo de dia faltante ou regenerar-1-dia do
      // treinador) — diferente da validacao da semana inteira, aqui queremos exatamente o dia
      // pedido, entao se a IA devolver weekday/modalidade diferente do slot, e falha mesmo.
      const validated = this.validateStrengthSessions([parsed], [slot]);
      if (validated.missingSlots.length) return null;
      return validated.sessions[0] ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar decisao de forca avulsa com o agente de IA: ${describeAiError(error)}`);
      return null;
    }
  }

  private async attemptDecision(
    input: MethodologyInput,
    evidence: PaceEvidence,
    effort: 'high' | 'medium' = 'high',
  ): Promise<(WeeklyMethodologyDecision & { source: 'ai' }) | null> {
    const client = this.client;
    if (!client) return null;
    const runSlots = computeRunSlots(input.availability);
    const strengthSlots = computeStrengthSlots(input.availability);

    const painTier = input.painTier ?? (hasSafetyConcern(input.answers) ? 'reduced' : 'normal');
    const safetyAdjustment = painTier !== 'normal';
    const removeRunning = painTier === 'remove_running';
    const novice = isNovice(input.experience, input.answers);

    // Capturado durante o streaming pra ter dado real (stop_reason/usage/texto bruto) se o parse
    // do JSON estruturado falhar la embaixo — em vez de adivinhar a causa depois, ver catch.
    let lastSnapshot: Anthropic.Messages.Message | undefined;
    try {
      // Streaming (nao client.messages.parse, que e sempre nao-streaming): com max_tokens alto
      // (24000) + pensamento adaptativo, o proprio SDK recusa a chamada de antemao com "Streaming
      // is required for operations that may take longer than 10 minutes" — nao e um erro da IA,
      // e uma trava do cliente contra chamadas que podem estourar o timeout HTTP. stream() aceita
      // o mesmo output_config.format (zodOutputFormat) e finalMessage() devolve o mesmo
      // parsed_output que .parse() devolvia, entao o resto do codigo abaixo nao muda.
      const response = await this.aiQueue.run(async () => {
        const stream = client.messages.stream({
          model: 'claude-sonnet-5',
          // Aumentado de 8000 depois que strengthSessions foi adicionado a mesma resposta: um
          // aluno com varios dias de forca/fortalecimento (cada um com titulo/notes/exercicios)
          // soma bastante texto em cima do que a corrida ja usava, e o mesmo tipo de falha
          // silenciosa ja documentada (resposta cortada por estourar o limite, rejeitada pelo
          // Zod, indistinguivel de uma falha de rede) reapareceu na pratica com alunos com rotina
          // de forca mais cheia (varios dias de musculacao/fortalecimento).
          // Aumentado de novo (16000 -> 24000 -> 32000 -> 48000) em 29/07: o schema por sessao
          // cresceu nesta mesma data (distanceKm + paceSecondsPerKm em toda sessao, mais
          // fastPaceSecondsPerKm dentro de intervalStructure) — cada dia da semana agora exige
          // mais campos numericos na resposta do que antes, o que empurra o texto gerado pra mais
          // perto do teto antigo de 32000, aumentando o risco real ja documentado de "Unterminated
          // string in JSON" (thinking adaptativo consumindo parte do orcamento antes de sobrar
          // espaco pra terminar o JSON). Ver captura de stop_reason/usage no catch abaixo pra dado
          // real caso isso ainda aconteca mesmo com o teto maior.
          max_tokens: 48000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort,
            format: zodOutputFormat(AiWeeklyDecisionSchema),
          },
          // Prompt cache: o grosso do system prompt (metodologia, regras, formato de resposta) e
          // identico pra qualquer aluno/semana — so a orientacao de seguranca (ultimo paragrafo)
          // muda com safetyAdjustment/removeRunning. Separado num bloco proprio SEM cache_control,
          // depois do bloco grande COM cache_control, pra nao invalidar o prefixo cacheado toda vez
          // que esses dois booleanos mudam (ver shared/prompt-caching.md do skill claude-api).
          system: [
            { type: 'text', text: this.buildSystemPromptStable(), cache_control: { type: 'ephemeral' } },
            { type: 'text', text: this.buildSafetyGuidance(safetyAdjustment, removeRunning) },
          ],
          messages: [{ role: 'user', content: this.buildUserPrompt(input, runSlots, strengthSlots, safetyAdjustment, novice, evidence, input.painReason ?? null) }],
        });
        // snapshot e atualizado a cada evento (inclusive stop_reason/usage, preenchidos pelo
        // evento message_delta antes do message_stop) — se o parse do JSON falhar depois, esse
        // snapshot ainda tem o texto bruto e os numeros reais da chamada, capturados aqui porque
        // finalMessage() joga tudo isso fora e so propaga o erro de parse.
        stream.on('streamEvent', (_event, snapshot) => {
          lastSnapshot = snapshot;
        });
        return stream.finalMessage();
      });

      const parsed = response.parsed_output;
      if (!parsed) return null;

      // Log de custo real (nao logado antes — so em falha). thinking tokens entram dentro de
      // output_tokens (mesma linha de billing da resposta escrita) — sem isso nao da pra saber
      // quanto do gasto e raciocinio vs. texto final, so estimar.
      this.logger.log(
        `Semana gerada com IA (effort=${effort}): input_tokens=${response.usage.input_tokens}, output_tokens=${response.usage.output_tokens}, cache_read_tokens=${response.usage.cache_read_input_tokens ?? 0}, cache_creation_tokens=${response.usage.cache_creation_input_tokens ?? 0}`,
      );

      // NAO existe mais rejeicao por pace lento (piso de 8:30/km): removido em 02/08 a pedido
      // explicito do treinador — pace lento e so uma recomendacao no prompt pra IA evitar, nunca
      // um motivo pra descartar a resposta. Desde a mudanca pra "parts" (10/08), tambem nao existe
      // mais rejeicao por estrutura malformada — o discriminatedUnion do Zod ja garante que cada
      // parte veio numa das duas formas validas (nunca as duas juntas, nunca nenhuma), entao nao
      // ha mais nada pra "sessao inteira mal formada" rejeitar aqui.
      const validated = this.validateSessions(parsed.sessions, runSlots);
      const sessions = validated.sessions;

      const strengthValidation = this.validateStrengthSessions(parsed.strengthSessions, strengthSlots);
      let strengthSessions = strengthValidation.sessions;
      if (strengthValidation.missingSlots.length) {
        // Mesma filosofia do reparo por dia isolado de corrida acima: a IA as vezes devolve os
        // dias de forca vazios ou incompletos (incidente real 2026-07-31: 0 sessoes de forca
        // devolvidas para um aluno com 3 dias esperados, nas duas tentativas, descartando uma
        // resposta boa de corrida junto). Em vez de jogar fora a semana inteira, pede so os dias
        // que realmente faltaram de novo numa chamada avulsa pequena (mesma usada no
        // regenerar-1-dia do treinador) — o que a IA ja acertou (inclusive dias extras por
        // diretriz) fica como esta, nao e descartado.
        this.logger.warn(`${strengthValidation.missingSlots.length} dia(s) de forca da rotina sem sessao correspondente — repondo via chamada avulsa por dia: [${strengthValidation.missingSlots.map((s) => `${s.weekday}:${s.modality}`).join(',')}].`);
        const repaired = await this.repairStrengthSessions(input, strengthValidation.missingSlots);
        if (!repaired) {
          this.logger.warn('Reparo avulso dos dias de forca tambem falhou — descartando esta tentativa.');
          return null;
        }
        strengthSessions = [...strengthSessions, ...repaired];
      }

      const rationale = parsed.rationale
        .map((item) => truncateText(item.trim(), 500))
        .filter((item) => item.length > 0);

      return {
        sessions,
        strengthSessions,
        recommendation: truncateText(parsed.recommendation.trim() || 'Sem observacoes adicionais para esta semana.', 1200),
        rationale: rationale.length > 0 ? rationale : ['Decisao gerada pelo agente de IA.'],
        safetyAdjustment,
        source: 'ai',
        routineMismatch: validated.routineMismatch,
        sessionMismatches: { ...validated.sessionMismatches, ...strengthValidation.sessionMismatches },
      };
    } catch (error) {
      if (lastSnapshot) {
        const rawText = lastSnapshot.content
          .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
          .map((block) => block.text)
          .join('');
        this.logger.warn(
          `Falha ao gerar decisao com o agente de IA: ${describeAiError(error)} | stop_reason=${lastSnapshot.stop_reason} output_tokens=${lastSnapshot.usage?.output_tokens} texto_bruto_chars=${rawText.length} texto_bruto_fim="${rawText.slice(-300)}"`,
        );
      } else {
        this.logger.warn(`Falha ao gerar decisao com o agente de IA: ${describeAiError(error)}`);
      }
      return null;
    }
  }

  private validateSessions(
    sessions: z.infer<typeof AiSessionSchema>[],
    runSlots: RunSlot[],
  ): {
    sessions: RunSessionDecision[];
    routineMismatch: string | null;
    // Mesma informacao de routineMismatch, mas quebrada por sessao especifica (chave
    // "weekday:modality") — usada por generateWeek() pra marcar SO a sessao que realmente saiu do
    // combinado (ver TrainingSession.routineMismatchNote), em vez de tratar a semana inteira como
    // "fora da rotina" so porque um dia especifico teve um desvio (pedido explicito do treinador
    // 03/08). Mesmo formato de chave usado em validateStrengthSessions, pra poder combinar os dois
    // num so objeto em generateWeek.
    sessionMismatches: Record<string, string>;
  } {
    // ATE 02/08 isso rejeitava a semana INTEIRA quando a IA cobria menos dias do que a rotina
    // cadastrada — ordem explicita do treinador: cobertura de dias (e duracao, ver
    // validateSessionShape) nao e mais motivo pra descartar a resposta quando nao ha diretriz
    // individual autorizando o desvio. Em vez disso, gera a semana do jeito que a IA decidiu e
    // devolve routineMismatch pra quem chamar avisar o treinador — nunca joga fora um plano bom
    // por causa disso. generateWeek() decide se avisa (so quando nao ha diretriz ativa; com
    // diretriz, o desvio e esperado e nao precisa de aviso).
    const slotByWeekday = new Map(runSlots.map((slot) => [slot.weekday, slot]));
    const coveredWeekdays = new Set(sessions.map((session) => session.weekday));
    const missingWeekdays = runSlots.filter((slot) => !coveredWeekdays.has(slot.weekday));
    let routineMismatch: string | null = null;
    if (sessions.length < runSlots.length || missingWeekdays.length) {
      routineMismatch = `IA gerou ${sessions.length} dia(s) de corrida em vez dos ${runSlots.length} combinados na rotina${missingWeekdays.length ? ` (faltou weekday ${missingWeekdays.map((slot) => slot.weekday).join(',')})` : ''}.`;
      this.logger.log(`Aviso (nao bloqueia): ${routineMismatch}`);
    }

    const result: RunSessionDecision[] = [];
    const durationMismatches: string[] = [];
    const sessionMismatches: Record<string, string> = {};

    for (const session of sessions) {
      const slot = slotByWeekday.get(session.weekday);
      // Um weekday fora da disponibilidade normal, ou repetido (mais de uma sessao no mesmo dia),
      // so faz sentido quando uma diretriz individual do treinador pediu isso explicitamente —
      // essas diretrizes tem prioridade quase absoluta (ver buildSystemPromptStable). O codigo nao
      // tenta provar que existe mesmo uma diretriz dizendo isso (isso seria so mais uma regra
      // fixa por cima do raciocinio da IA); se nao houver slot correspondente, so seguimos sem a
      // referencia de duracao normal do dia — mas marcamos essa sessao especifica como fora da
      // rotina (ver sessionMismatches acima).
      if (!slot) {
        sessionMismatches[`${session.weekday}:corrida`] = `Este treino de corrida foi gerado num dia que nao estava na sua rotina combinada.`;
      }
      // ATE 02/08 isso rejeitava a semana INTEIRA quando um dia excedia a duracao normal sem
      // "durationJustification" preenchido — na pratica virou uma trava de codigo em cima da
      // decisao da IA (ela decide a duracao, o codigo nao deveria poder vetar isso so por causa de
      // um campo de texto opcional que ela pode legitimamente ter deixado vazio mesmo tendo um
      // motivo real). Ordem explicita do treinador: quem decide e sempre a IA — o codigo so avisa
      // (log + routineMismatch, ver acima) pra o treinador acompanhar, nunca descarta a resposta.
      if (slot && session.durationMin !== slot.durationMin && !session.durationJustification?.trim()) {
        durationMismatches.push(`weekday ${session.weekday}: ${session.durationMin}min (combinado ${slot.durationMin}min)`);
        sessionMismatches[`${session.weekday}:corrida`] = `Este treino foi gerado com ${session.durationMin}min, diferente dos ${slot.durationMin}min combinados na sua rotina.`;
      }

      result.push({
        weekday: session.weekday,
        title: session.title,
        durationMin: session.durationMin,
        notes: truncateText(session.notes, 900),
        parts: session.parts,
      });
    }

    if (durationMismatches.length) {
      const durationNote = `Duracao diferente do combinado sem justificativa: ${durationMismatches.join('; ')}.`;
      this.logger.log(`Aviso (nao bloqueia): ${durationNote}`);
      routineMismatch = routineMismatch ? `${routineMismatch} ${durationNote}` : durationNote;
    }

    return { sessions: result, routineMismatch, sessionMismatches };
  }

  // Chamado so com os slots da rotina que ficaram sem nenhuma sessao correspondente (ver
  // validateStrengthSessions) — pede cada um de novo, isoladamente, pela mesma chamada avulsa
  // usada no "regenerar 1 dia" do treinador, sem mexer no que a IA ja acertou (inclusive dias
  // extras por diretriz individual). Se qualquer dia faltante falhar de novo, desiste (retorna
  // null) e deixa o attemptDecision descartar esta tentativa como antes.
  private async repairStrengthSessions(input: MethodologyInput, missingSlots: StrengthSlot[]): Promise<StrengthSessionDecision[] | null> {
    const repaired = await Promise.all(
      missingSlots.map((slot) => this.attemptStrengthSessionDecision(input, slot)),
    );
    if (repaired.some((decision) => decision === null)) {
      this.logger.warn(`Reparo avulso de forca falhou para ${repaired.filter((decision) => decision === null).length} dia(s).`);
      return null;
    }
    return repaired as StrengthSessionDecision[];
  }

  // Garante que a IA so use exercicios reais do catalogo aprovado (nomes/descricoes/videos ja
  // curados) — nunca inventa um exercicio. Fora isso (quais dias/modalidades, quais exercicios,
  // quantos, foco muscular do dia, sets/reps/descanso), a decisao e inteiramente da IA.
  //
  // ATE 02/08 esta funcao rejeitava a resposta INTEIRA quando o numero de sessoes nao batia
  // exatamente com strengthSlots (a rotina cadastrada), ou quando vinha um weekday/modalidade fora
  // dela — isso derrubava um dia de forca legitimamente adicionado por diretriz individual do
  // treinador. Ordem explicita do treinador: a diretriz individual e SOBERANA, o codigo nao pode
  // vetar um dia extra so por nao estar na rotina original. Agora: sessoes que batem com a rotina
  // sao validadas normalmente (dedupe por weekday+modalidade); sessoes extras/fora da rotina sao
  // aceitas do mesmo jeito (presume-se diretriz — se algo estiver estranho, o gerente tecnico
  // conversa com o treinador depois, isso nao e papel do codigo policiar). So os slots da rotina
  // que ficarem SEM nenhuma sessao correspondente sao sinalizados pra reparo avulso.
  private validateStrengthSessions(
    sessions: z.infer<typeof AiStrengthSessionSchema>[],
    strengthSlots: StrengthSlot[],
  ): { sessions: StrengthSessionDecision[]; missingSlots: StrengthSlot[]; sessionMismatches: Record<string, string> } {
    const slotByKey = new Map(strengthSlots.map((slot) => [`${slot.weekday}:${slot.modality}`, slot]));
    const usedKeys = new Set<string>();
    const result: StrengthSessionDecision[] = [];
    const sessionMismatches: Record<string, string> = {};

    for (const session of sessions) {
      const key = `${session.weekday}:${session.modality}`;
      if (usedKeys.has(key)) {
        this.logger.warn(`Ignorada sessao de forca duplicada (weekday ${session.weekday}, modalidade ${session.modality}) — mantida so a primeira.`);
        continue;
      }
      if (!slotByKey.has(key)) {
        this.logger.log(`Sessao de forca fora da rotina cadastrada (weekday ${session.weekday}, modalidade ${session.modality}) — aceita como decisao da IA/diretriz individual.`);
        sessionMismatches[key] = `Este treino foi gerado num dia/modalidade que nao estava na sua rotina combinada.`;
      }
      usedKeys.add(key);
      // Fora do catalogo aprovado (sem video/descricao curados) so acontece quando uma diretriz
      // individual do treinador citou um exercicio especifico que nao esta la — prioridade quase
      // absoluta da diretriz vale aqui tambem. O codigo nao bloqueia mais isso; a montagem da
      // sessao (strengthPrescription em training-plans.service.ts) exibe o nome literal que a IA
      // escreveu quando o id nao bate com nenhum exercicio catalogado, so sem video/descricao.

      result.push({
        weekday: session.weekday,
        modality: session.modality,
        title: session.title,
        exerciseIds: session.exerciseIds,
        sets: session.sets,
        reps: truncateText(session.reps, 120),
        restSeconds: session.restSeconds,
        intensity: session.intensity,
        notes: truncateText(session.notes, 900),
      });
    }

    const missingSlots = strengthSlots.filter((slot) => !usedKeys.has(`${slot.weekday}:${slot.modality}`));
    return { sessions: result, missingSlots, sessionMismatches };
  }

  private buildSafetyGuidance(safetyAdjustment: boolean, removeRunning: boolean) {
    return removeRunning
      ? '- Este aluno relatou dor intensa recentemente (relato estruturado de dor, nao a entrevista de onboarding). A corrida ja foi removida desta semana pelo sistema antes de voce ser chamado — se ainda assim voce receber dias de corrida no contexto, use seu julgamento sobre o quanto isso pesa (normalmente algo bem leve/transicao).'
      : safetyAdjustment
        ? '- Este aluno tem um relato de dor RECENTE (moderada ou recorrente, calculado a partir dos ultimos relatos de dor, nao de uma resposta antiga e permanente da entrevista). Isso e informacao de contexto, nao uma trava automatica — use seu proprio julgamento sobre o quanto isso muda o volume/intensidade da semana, do mesmo jeito que um treinador real pesaria essa informacao junto com o resto.'
        : '- Sem sinal de dor recente relatado no momento.';
  }

  // Estavel para qualquer aluno/semana (nenhum parametro) — permite cache_control no chamador
  // sem invalidar o prefixo cacheado a cada chamada. A unica parte que varia por aluno
  // (safetyAdjustment/removeRunning) foi extraida para buildSafetyGuidance() e vai depois deste
  // bloco, sem cache_control, no array de system enviado pela API.
  private buildSystemPromptStable() {
    return [
      'Voce e o agente de prescricao de treinos da Panzeri Run — decide numa unica resposta a semana inteira de um aluno, tanto os dias de corrida quanto os dias de forca/fortalecimento, aplicando o julgamento real do treinador Elton Panzeri descrito abaixo. Isto nao e um sistema de regras nem de formulas — e um raciocinio de treinador, dia a dia, olhando o contexto completo deste aluno especifico.',
      PANZERI_METHODOLOGY_KNOWLEDGE,
      'Nao existe nenhum limite fixo nesta tarefa, nem fisico nem de qualquer outro tipo — tudo (duracao, distancia, pace, volume da semana, quando usar cada forma de treino, o que fazer com um sinal de dor) e julgamento seu, olhando o aluno real. Uma recomendacao, nao uma regra: evite prescrever pace de corrida mais lento que 8:30/km (510 segundos por km) quando puder, porque abaixo disso a mecanica da corrida tende a piorar e se aproximar de uma caminhada. Se o ritmo confortavel real de um aluno estiver nessa faixa, considere uma parte "intervalada" alternando corrida de verdade com caminhada de verdade — mas a decisao final e sempre sua, pensando no aluno real; nao existe nenhuma checagem de codigo rejeitando isso.',
      'Se diretrizesEspecificasDoTreinadorParaEsteAluno nao estiver vazio, essas sao intervencoes que o treinador Elton Panzeri pediu PESSOALMENTE para ESTE aluno especifico, normalmente acordadas com o gerente tecnico — ele decidiu isso deliberadamente, com base em algo que so ele sabe sobre esse aluno naquele momento. A diretriz individual e SOBERANA: prioridade absoluta sobre qualquer recomendacao geral de metodologia, incluindo a recomendacao de pace acima. Aplique-as literalmente, sem suavizar ou reinterpretar — inclusive quando pedirem algo fora do padrao normal do aluno (um dia extra de treino, duas sessoes no mesmo dia, uma duracao maior que o normal, um pace fora da faixa recomendada, ou um exercicio de forca especifico que nao esta no catalogo aprovado). O codigo nao trava nada disso; a responsabilidade de aplicar a diretriz certo e sua. Qualquer coisa que parecer estranha, o gerente tecnico conversa com o treinador depois — nao e papel do codigo policiar isso.',
      '- Se observacoesRegistradasPeloProprioAluno nao estiver vazio: isso e MUITO DIFERENTE de diretrizesEspecificasDoTreinadorParaEsteAluno. Sao anotacoes que o proprio ALUNO escreveu livremente sobre circunstancias pessoais (ex: "vou viajar semana que vem e nao sei se terei onde treinar"). Isso NAO e uma ordem, NAO foi confirmado/revisado pelo treinador. Leve em consideracao quando fizer sentido, sem sacrificar principios da metodologia so por causa de uma observacao informal.',
      '- prontuarioDoAluno e um resumo curto e cumulativo, escrito por outro agente, do historico deste aluno (perfil, diretrizes ja aplicadas, observacoes antigas, dores anteriores, padroes de consistencia). Use-o como memoria de fundo — o mesmo tipo de coisa que um treinador humano ja saberia de cor sobre esse aluno sem precisar reler tudo. historicoSemanal, diretrizesEspecificasDoTreinadorParaEsteAluno e observacoesRegistradasPeloProprioAluno continuam sendo as fontes mais recentes e especificas: se algo no prontuario parecer desatualizado ou contradizer esses campos mais atuais, confie nos campos mais atuais.',
      '- Diretrizes frequentemente citam datas de calendario (ex: "longao de 16 km em 25/07"), mas voce so retorna numeros de weekday (0=domingo...6=sabado). Use dataDeCadaDiaDaSemanaSendoGerada + hoje pra achar o weekday certo daquela data. Se a data nao for desta semana, essa parte da diretriz nao se aplica agora — mas aplique o resto da diretriz que nao depender de data.',
      '- Quando uma diretriz da um numero explicito para um dia especifico (distancia, pace, estrutura do tiro/recuperacao, modalidade de caminhada vs trote), use esse numero EXATAMENTE, mesmo que seja diferente do que voce concluiria sozinho. Dias sem diretriz especifica continuam sendo decisao inteiramente sua.',
      '- Se metaDeProva estiver preenchida, use-a como norte GERAL de periodizacao somente nos dias/semanas em que a diretriz nao disser nada especifico — a diretriz especifica sempre vence a sua propria logica de periodizacao rumo a meta. Se os dados reais do aluno indicarem que a meta e pouco realista, ajuste e explique no rationale por que.',
      '- maiorLongaoJaRegistrado e um FATO objetivo calculado direto dos treinos realmente concluidos deste aluno (nao um resumo escrito por outro agente, nao a sua propria memoria da conversa) — a maior distancia de corrida/caminhada que ele ja completou de verdade, quando, e a satisfacao relatada naquela sessao especifica. Use isso como a fonte mais confiavel para qualquer diretriz que dependa de saber "qual e o recorde atual de distancia" (ex: uma escada de progressao de longao que se estende por varias semanas ou meses) — nao tente reconstruir esse numero olhando historicoSemanal ou prontuarioDoAluno, que podem nao cobrir todo o periodo.',
      '- CORRER A DISTANCIA E DIFERENTE DE COMPLETAR A DISTANCIA: muita gente (inclusive alunos e treinadores) confunde as duas coisas. "Correu 21km" (percurso todo corrido) e "completou 21km" (parte caminhada, parte corrida, ou com paradas) sao capacidades bem diferentes — tratar a segunda como se fosse a primeira pode levar a uma progressao arriscada demais, especialmente pra aluno com historico de lesao ou perto de uma prova. O campo comoFoiFeito dentro de maiorLongaoJaRegistrado (quando preenchido) e o autorrelato direto do proprio aluno sobre isso: "correu_tudo" = corrida continua de verdade; "caminhou_pouco"/"caminhou_muito" = parte foi caminhada, entao NAO trate essa distancia como prova de que ele aguenta correr esse tanto continuamente — use como evidencia de resistencia geral/volume, nao de capacidade de corrida continua naquela distancia. Se comoFoiFeito for null (aluno nao respondeu, ou registro antigo de antes dessa pergunta existir), nao assuma nem uma coisa nem outra — trate a distancia com cautela extra antes de usar como base pra um proximo degrau maior.',
      '- Cubra pelo menos um dia por cada item de diasDisponiveisParaCorrida, usando o weekday certo. durationMin de cada sessao normalmente nao excede o tempo disponivel informado para aquele dia — a excecao e quando diretrizesEspecificasDoTreinadorParaEsteAluno pedir explicitamente algo diferente para aquele dia especifico (mais tempo, um dia extra, ou duas sessoes no mesmo dia): nesse caso preencha durationJustification citando resumidamente a diretriz que autoriza isso. Sem essa diretriz, nao invente dia nem duracao fora do combinado.',
      '- A entrevista inicial (respostasEntrevista) pode estar desatualizada. Se reavaliacaoMaisRecente estiver preenchida, ela e a fonte mais atual sobre o aluno — quando as duas contradizerem, confie na reavaliacaoMaisRecente.',
      'SOBRE DISTANCIA E PACE: nao existe uma unica avaliacao de pace pra semana inteira nem uma categoria unica de sessao pra escolher antes — cada dia e descrito como uma SEQUENCIA ORDENADA de "parts" (o campo parts de cada sessao). Um treino pode ser simples (1 parte so, a grande maioria dos dias) ou misto (varias partes diferentes em sequencia — ex: uma parte de caminhada, depois um bloco intervalado, depois mais caminhada — pedido explicito do treinador 10/08: use quantas partes fizerem sentido pra ESTE dia, na ordem real). Cada parte e uma destas duas formas: (1) kind "continua" (distanceKm + paceSecondsPerKmMin/paceSecondsPerKmMax — mesmo numero nos dois quando o ritmo for constante, numeros diferentes quando variar de proposito ao longo da parte); (2) kind "intervalada" (repeatCount + estimulo/recuperacao com seus proprios label/distancia/pace) — cobre tanto um estimulo forte com recuperacao quanto uma alternancia caminhada/corrida, use stimulusLabel/recoveryLabel pra descrever o que cada trecho e de verdade (ex: "Correr forte"/"Trotar", ou "Caminhar"/"Correr"). Nao existe tabela ou formula calculando isso — pense como um treinador real pensaria pra ESTE dia: a condicao do aluno, o que ele fez essa semana, se esse estimulo vem logo apos um esforco forte, a proximidade de uma prova. Voce sabe matematica: some a duracao de todas as partes e confira que cabe dentro do durationMin disponivel — nao existe checagem de conta em codigo depois.',
      'Voce recebe evidencias de pace no contexto (autoRelatoRecente, mediaStravaRecente), cada uma com sua origem e idade — use-as como ponto de partida do que este aluno e capaz de sustentar, mas a decisao final de cada dia e sua, olhando o dia especifico (sequencia da semana, fadiga acumulada, fase da periodizacao, proximidade de prova). Nao existe uma regra fixa de qual evidencia vale mais — RACIOCINE, do jeito que um treinador humano faria. Exemplo real de raciocinio esperado, dado pelo proprio treinador Elton: "a aluna relatou um pace confortavel de 6:45/km numa corrida longa de 18km reais — ou seja, ela SUSTENTA esse pace numa distancia longa de verdade, nao so numa avaliacao curta e isolada."',
      'O "teste de 3km" (feature de avaliacao fisica) foi suspenso pelo treinador — voce nunca recebe mais esse dado, e NUNCA deve sugerir, mencionar ou perguntar ao aluno sobre fazer um teste de 3km em nenhum campo de texto (notes, rationale, recommendation).',
      'Outros pontos de raciocinio: um teste antigo que contradiz um desempenho recente mais forte deve pesar MENOS. Uma unica corrida curta recente pesa menos que uma distancia longa e consistente com boa sensacao relatada. Quando os dados conflitam, prefira a evidencia mais recente E mais consistente com o volume/objetivo do aluno. mediaSemanalKmAtualRelatada e o volume real recente no Strava sao mais uma evidencia desse tipo — informacao pra voce pesar, nao um piso que a soma da semana tem que respeitar.',
      'Se analiseAprofundadaStrava estiver preenchida (vem de outro agente que ja mastigou cadencia, frequencia cardiaca, padroes e outras modalidades do Strava para voce), use o campo "summary" e as "flags" como evidencia adicional real de como o aluno esta respondendo ao treino agora — nao ignore isso, mas tambem nao superestime; combine com o resto das evidencias.',
      'Cuidado ao interpretar texto livre escrito pelo proprio aluno (respostas de entrevista/reavaliacao, comentarios): muitos alunos escrevem de forma informal, como numa conversa entre pessoas, com ironia, hiperbole ou exagero comico (ex: "corri e quase morri" ou "foi moleza" nao sao relatos medicos literais). Nunca leve essas frases ao pe da letra como se fossem um dado objetivo.',
      'VARIEDADE: nao repita o mesmo padrao de estimulo semana apos semana pro mesmo aluno so por inercia (mesmo volume, mesma estrutura, mesmo ritmo de progressao) — pense em como um treinador real varia o treino ao longo do tempo pra continuar desafiando e evoluindo o aluno. Isso vale pro treino em si, nao so pra redacao do titulo/notes.',
      'O campo notes e a sua voz de treinador falando diretamente com o aluno sobre o treino daquele dia especifico. Pense em como um treinador humano de verdade entrega uma prescricao: ele passa os numeros — distancia, pace, series, tempo — mas tambem conversa com o aluno sobre isso. Ele descreve com as proprias palavras o que prescreveu, da dicas de como executar (por onde comecar, como distribuir o esforco ao longo do treino, o que sentir em cada trecho), avisa cuidados especificos daquele treino (nao acelerar demais no inicio, atencao redobrada num trecho mais dificil, sinal de alerta pra ajustar ou parar), e ajuda o aluno a saber lidar na pratica com o que foi prescrito (o que fazer se sentir mais cansado que o esperado, como se comportar num dia mais quente, o que priorizar se precisar encurtar algo). E esse acompanhamento humano e real que faz o aluno confiar e seguir o treino direito — nao e um campo burocratico de preenchimento. Se o treino for so 1 parte, NAO fale de aquecimento/resfriamento em notes — isso ja aparece pro aluno como uma instrucao padrao fixa, fora do que voce escreve. Se o treino tiver 2+ partes E a primeira parte ja for uma caminhada de pelo menos 5 minutos, essa instrucao padrao NAO aparece mais (o sistema detecta isso sozinho) — nesse caso descreva voce mesmo, em notes, o que cada parte significa na pratica.',
      'notes e exatamente essa conversa, escrita — e tambem o unico lugar pra um cuidado/dica pratica especifica daquele treino (ex: um sinal de alerta, uma dica de execucao): nao existe mais um segundo campo separado pra isso, entao inclua tudo nesse mesmo texto, sem repetir a mesma ideia duas vezes. O campo parts (com suas distancias/paces/estruturas) e a decisao que voce, como treinador, ja tomou para esse aluno nesse dia — a mesma decisao que voce tomaria escrevendo numa ficha de treino. Quando voce fala sobre o treino em notes, voce esta narrando essa MESMA prescricao que ja escreveu em parts, do mesmo jeito que um treinador real nao diria uma coisa na conversa e escreveria outra na ficha — isso deixaria o aluno sem saber o que fazer de verdade. Antes de finalizar, se pergunte: se eu fosse o aluno, lendo isso e olhando os numeros do meu treino ao mesmo tempo, faria sentido? Estou descrevendo exatamente a mesma prescricao, ou inventando uma segunda sem perceber?',
      'PROIBIDO INVENTAR FATOS SOBRE O HISTORICO DO ALUNO (incidente real 10/08 — aluna Eduarda leu em notes "sei que voce ja fez 15km recentemente", um numero que nao existe em NENHUM dado real dela; o maior treino dela ate entao era bem menor, e ela mesma estranhou no zap com o treinador, "ainda nao corri nem 8"). Qualquer numero ou fato especifico que voce escrever em notes/rationale/recommendation sobre o PASSADO do aluno (uma distancia que ele ja correu, um pace que ja sustentou, ha quantos dias, um sintoma como "recorrente" ou "das ultimas semanas") TEM que vir literalmente de algum campo do JSON que voce recebeu (maiorLongaoJaRegistrado, historicoSemanal, analiseExecucao, analiseAprofundadaStrava, respostasEntrevista, reavaliacaoMaisRecente, diretrizesEspecificasDoTreinadorParaEsteAluno, observacoesRegistradasPeloProprioAluno, prontuarioDoAluno) — nunca de uma suposicao plausivel ou do padrao generico de como uma fala de treinador "costuma soar" (tipo "voce vinha evoluindo bem, entao vamos recuar um pouco"). Se nao houver dado real pra sustentar a frase, nao escreva ela — fale de forma mais generica, sem inventar o numero (ex: "com o volume que voce vem construindo" em vez de citar uma distancia especifica que nunca aconteceu). Isso vale tambem pro TOM: se uma diretriz descreve um desconforto como ESPERADO/normal durante uma fase (ex: "desconforto muscular em coxa/canela e esperado no retorno, nao confundir com dor articular"), nao reescreva isso como se fosse um problema recorrente e preocupante que exige reduzir o treino — respeite a leitura que a propria diretriz ja deu ao fato, nao invente uma gravidade maior por conta propria.',
      'CONSISTENCIA INTERNA E OBRIGATORIA: o nivel/condicionamento do aluno que voce concluir tem que ser o MESMO em toda a resposta — rationale geral e notes de cada sessao contando a mesma historia sobre este aluno.',
      'PRIMEIRA SEMANA SEM NENHUM HISTORICO (historicoSemanal vazio, sem reavaliacao, sem analiseExecucao, sem analiseAprofundadaStrava): trate como calibragem inicial. Para um aluno com pouco tempo de corrida ou volume baixo/recente-comeco, prefira comecar com rodagens leves e um longao moderado, guardando um estimulo mais forte pra depois de ver a resposta real dele aos primeiros treinos — a nao ser que a evidencia de pace ja seja claramente forte e consistente.',
      'ORCAMENTO DE TEXTO DA RESPOSTA (importante, incidente real 02/08): sua resposta inteira — todos os dias de corrida e de forca de uma vez — tem um limite de tamanho. Se voce escrever textos longos demais nos primeiros dias, pode faltar espaco pra terminar os ultimos, e a resposta e cortada no meio (fica invalida, o aluno nao recebe treino nenhum naquela semana). Terminar a resposta INTEIRA e sempre mais importante do que cada campo de texto ser longo. Regra pratica: notes de cada dia de corrida/forca em torno de 4 a 6 frases (nao um paragrafo extenso), rationale como bullets curtos. Se em algum momento perceber que esta gastando texto demais, prefira DIMINUIR o que ainda vai escrever (textos mais diretos e objetivos) — nunca "force" continuar no mesmo nivel de detalhe e arriscar nao terminar. Uma resposta completa com texto mais enxuto e sempre melhor que uma resposta rica mas cortada.',
      'O campo title de cada sessao NAO e mais exibido ao aluno nem ao treinador — o titulo mostrado e sempre o nome fixo da modalidade (Corrida/Fortalecimento para corredores/Musculacao), decidido em codigo. Preencha title com qualquer texto curto valido, sem gastar esforco pensando nele.',
      'Responda em portugues nos campos de texto (notes, rationale, durationJustification).',
      'SOBRE OS DIAS DE FORCA/FORTALECIMENTO (campo strengthSessions): voce tambem decide os exercicios de musculacao e fortalecimento para corredores, com o mesmo julgamento real que aplica a corrida.',
      '- OBRIGATORIO: retorne EXATAMENTE uma sessao em strengthSessions para CADA item listado em diasDisponiveisParaForca, usando o mesmo weekday e a mesma modalidade daquele item (modality "forca" = musculacao geral, "fortalecimento_corredores" = circuito especifico para corredores). O mesmo weekday pode aparecer mais de uma vez na lista, uma para cada modalidade — retorne uma sessao pra cada item nesse caso, isso e o dado real da rotina do aluno, nao um erro. Se diasDisponiveisParaForca tiver 3 itens, strengthSessions tem que ter 3 sessoes — nunca deixe esse campo vazio ou incompleto quando diasDisponiveisParaForca nao estiver vazio: a resposta inteira e descartada quando isso acontece, desperdicando todo o raciocinio que voce fez pros dias de corrida.',
      '- A modalidade de cada item em diasDisponiveisParaForca vem da rotina real do aluno e normalmente nao muda — copie o campo modality literalmente. Uma diretriz sobre forca/fortalecimento normalmente muda foco/exercicios/intensidade daquele dia, nao a modalidade em si; so mude a modalidade se a diretriz pedir isso explicitamente.',
      '- exerciseIds normalmente vem de catalogoExerciciosMusculacao (modality "forca") ou catalogoExerciciosFortalecimentoCorredores (modality "fortalecimento_corredores") — prefira sempre o catalogo, que ja tem video/descricao prontos pro aluno. Só cite um exercicio fora do catalogo se uma diretriz especifica do treinador pedir aquele exercicio por nome; nesse caso ele aparece pro aluno so como texto, sem video. Escolha entre 3 e 10 exercicios conforme o tempo disponivel do dia.',
      '- Se diretrizesEspecificasDoTreinadorParaEsteAluno pedir um FOCO especifico para um dia de forca (ex: "segunda e dia de perna" ou uma lista de exercicios), aplique literalmente usando o campo "group"/"focus" do catalogo pra filtrar, ou os exercicios citados pelo nome. Sem diretriz, monte uma sessao equilibrada e variada.',
      '- Nivel dos exercicios (campo "level"): prefira "base" para alunos iniciantes ou com sinalDeSeguranca ativo; "intermediate"/"advanced" para alunos com mais experiencia. Julgamento seu.',
      '- sets, reps, restSeconds e intensity sao decisao sua por sessao: valores tipicos giram em torno de 3 series de 8 a 12 repeticoes com 60 a 90s de descanso para musculacao, series mais curtas/tempo com descanso menor para core/fortalecimento — ajuste conforme duracao do dia, nivel do aluno e sinal de seguranca.',
      '- VARIEDADE tambem vale aqui: alterne exercicios equivalentes do catalogo semana a semana, mantendo a logica de foco/objetivo do dia.',
    ].join('\n\n');
  }

  private buildUserPrompt(input: MethodologyInput, runSlots: RunSlot[], strengthSlots: StrengthSlot[], safetyAdjustment: boolean, novice: boolean, evidence: PaceEvidence, painReason: string | null) {
    return JSON.stringify(
      {
        objetivo: input.goal,
        experiencia: input.experience,
        classificadoComoIniciante: novice,
        evidenciasDePace: {
          // "teste oficial" (teste de 3km) foi suspenso pelo treinador (09/08) — nao mande mais
          // esse dado pro agente, pra ele nem saber que essa fonte existe (ver instrucao no
          // system prompt: nunca sugerir/mencionar teste de 3km ao aluno).
          autoRelatoRecente: evidence.selfReportedPace
            ? { paceSegundosPorKm: evidence.selfReportedPace.secondsPerKm, paceLegivel: formatSecondsPerKm(evidence.selfReportedPace.secondsPerKm), origem: evidence.selfReportedPace.source }
            : null,
          mediaStravaRecente: evidence.stravaAveragePace
            ? { paceSegundosPorKm: evidence.stravaAveragePace.secondsPerKm, paceLegivel: formatSecondsPerKm(evidence.stravaAveragePace.secondsPerKm), numeroDeCorridas: evidence.stravaAveragePace.sampleRuns }
            : null,
        },
        respostasEntrevista: input.answers,
        avisoSobreRespostasEntrevista: 'Estas respostas vem da entrevista inicial, que pode ter sido feita ha muito tempo. Se reavaliacaoMaisRecente estiver preenchida abaixo, ela reflete a situacao mais atual do aluno e deve ter prioridade sempre que contradizer a entrevista inicial (ex: quilometragem semanal, sensacao nos treinos, objetivo, dor nova, peso).',
        reavaliacaoMaisRecente: input.recentReassessment ? {
          concluidaEm: input.recentReassessment.completedAt,
          respostas: input.recentReassessment.answers,
          resumoDeEvolucaoGeradoPeloAgenteDeReavaliacao: input.recentReassessment.evolutionSummary ?? null,
          pontosPositivos: input.recentReassessment.evolutionWins ?? [],
          pontosDeAtencao: input.recentReassessment.evolutionConcerns ?? [],
        } : null,
        mediaSemanalKmAtualRelatada: WEEKLY_KM_RANGE_LABELS[String(input.answers.weekly_running_km)] ?? null,
        diretrizesEspecificasDoTreinadorParaEsteAluno: input.studentDirectives ?? [],
        observacoesRegistradasPeloProprioAluno: input.activeObservations ?? [],
        prontuarioDoAluno: input.studentProfileSummary || null,
        hoje: input.todayDate ?? null,
        dataDeCadaDiaDaSemanaSendoGerada: input.weekDates ?? null,
        diasDisponiveisParaCorrida: runSlots,
        diasDisponiveisParaForca: strengthSlots,
        catalogoExerciciosMusculacao: strengthSlots.some((slot) => slot.modality === 'forca')
          ? gymExerciseLibrary.map((exercise) => ({ id: exercise.id, name: exercise.name, group: exercise.group, level: exercise.level }))
          : [],
        catalogoExerciciosFortalecimentoCorredores: strengthSlots.some((slot) => slot.modality === 'fortalecimento_corredores')
          ? runnerStrengthExercises.map((exercise) => ({ id: exercise.id, name: exercise.name, focus: exercise.focus, level: exercise.level }))
          : [],
        historicoSemanal: input.history,
        minutosCorridosStravaRecente: input.stravaRunMinutes,
        maiorCorridaStravaRecenteMin: input.stravaLongestRunMinutes,
        analiseExecucao: input.executionInsight,
        analiseAprofundadaStrava: input.stravaAnalysis ?? null,
        sinalDeSeguranca: safetyAdjustment,
        motivoDoSinalDeSeguranca: painReason,
        maiorLongaoJaRegistrado: input.longestRunEver ? {
          distanciaKm: input.longestRunEver.distanceKm,
          data: input.longestRunEver.date,
          satisfacaoRelatadaNaquelaSessao: input.longestRunEver.satisfaction,
          // Autorrelato do proprio aluno sobre como essa distancia foi feita — ver a instrucao
          // "CORRER VS COMPLETAR" no prompt de sistema antes de usar esse numero como prova de
          // capacidade de corrida continua.
          comoFoiFeito: input.longestRunEver.pacingMode,
        } : null,
        metaDeProva: input.targetRace
          ? {
              nome: input.targetRace.name,
              data: input.targetRace.raceDate,
              distanciaKm: input.targetRace.distanceKm,
              paceAlvoSegundosPorKm: input.targetRace.paceSecondsPerKm,
            }
          : null,
      },
      null,
      2,
    );
  }

  private buildSingleStrengthSystemPrompt() {
    return [
      'Voce e o agente de prescricao de treinos da Panzeri Run, decidindo agora APENAS um unico dia de forca/fortalecimento para corredores que o treinador pediu para regenerar isoladamente (sem mexer no resto da semana do aluno).',
      PANZERI_METHODOLOGY_KNOWLEDGE,
      '- Se diretrizesEspecificasDoTreinadorParaEsteAluno nao estiver vazio, aplique-as literalmente para este dia — sao ordens pessoais do treinador para este aluno, prioridade quase absoluta.',
      '- observacoesRegistradasPeloProprioAluno sao anotacoes informais do proprio aluno, nao uma ordem — considere quando fizer sentido, sem sacrificar seguranca.',
      '- exerciseIds normalmente vem do catalogo informado (catalogoExerciciosMusculacao para modality "forca", catalogoExerciciosFortalecimentoCorredores para "fortalecimento_corredores"), que ja tem video/descricao prontos. So cite um exercicio fora do catalogo se uma diretriz especifica pedir aquele exercicio por nome (aparece pro aluno so como texto, sem video). Escolha entre 3 e 10 exercicios conforme a duracao do dia.',
      '- Se houver diretriz de foco muscular para este dia especifico (ex: "so perna hoje") ou lista explicita de exercicios, aplique literalmente usando o campo "group"/"focus" do catalogo para filtrar. Sem diretriz, monte uma sessao equilibrada e variada.',
      '- Prefira exercicios de nivel "base" para alunos iniciantes ou com sinalDeSeguranca ativo.',
      '- NAO invente fatos/numeros sobre o historico do aluno em notes (uma distancia/peso/repeticao que ele "ja fez antes", um sintoma "recorrente") a nao ser que venha literalmente de um campo do JSON recebido — sem dado real, fale de forma generica.',
      '- weekday e modality da resposta devem ser exatamente os informados em diaDeForcaParaRegenerar — a modalidade e FIXA (vem da rotina real do aluno) e nunca pode ser trocada, nem mesmo por uma diretriz que mencione "musculacao" ou "fortalecimento": diretriz so muda foco/exercicios, nunca a modalidade em si.',
      'O campo title NAO e mais exibido — o titulo mostrado e sempre o nome fixo da modalidade, decidido em codigo. Preencha com qualquer texto curto valido.',
      'Responda em portugues nos campos de texto (notes).',
    ].join('\n\n');
  }

  private buildSingleStrengthUserPrompt(input: MethodologyInput, slot: StrengthSlot) {
    return JSON.stringify(
      {
        objetivo: input.goal,
        experiencia: input.experience,
        respostasEntrevista: input.answers,
        diretrizesEspecificasDoTreinadorParaEsteAluno: input.studentDirectives ?? [],
        observacoesRegistradasPeloProprioAluno: input.activeObservations ?? [],
        hoje: input.todayDate ?? null,
        sinalDeSeguranca: (input.painTier ?? 'normal') !== 'normal',
        motivoDoSinalDeSeguranca: input.painReason ?? null,
        diaDeForcaParaRegenerar: slot,
        catalogoExerciciosMusculacao: slot.modality === 'forca'
          ? gymExerciseLibrary.map((exercise) => ({ id: exercise.id, name: exercise.name, group: exercise.group, level: exercise.level }))
          : [],
        catalogoExerciciosFortalecimentoCorredores: slot.modality === 'fortalecimento_corredores'
          ? runnerStrengthExercises.map((exercise) => ({ id: exercise.id, name: exercise.name, focus: exercise.focus, level: exercise.level }))
          : [],
      },
      null,
      2,
    );
  }
}

function formatSecondsPerKm(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}/km`;
}

// Sem isso, uma resposta da IA rejeitada pelo Zod (schema invalido, resposta cortada por
// estourar max_tokens, etc.) aparece no log identica a uma falha de rede — ja causou um
// incidente real onde ninguem conseguia saber, so pelo log, por que a IA "nao estava sendo
// ouvida" (ver [[ai_only_prescription_engine]]). Esta funcao extrai o maximo de detalhe
// disponivel do erro (issues do Zod, resposta parcial, etc.) para o log ja vir com a causa.
function describeAiError(error: unknown): string {
  if (error instanceof Error) {
    const withIssues = error as Error & { issues?: unknown; errors?: unknown };
    const detail = withIssues.issues ?? withIssues.errors;
    if (detail) {
      try {
        return `${error.message} | detalhes: ${JSON.stringify(detail)}`;
      } catch {
        return error.message;
      }
    }
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
