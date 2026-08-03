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

const AiIntervalStructureSchema = z.object({
  repeatCount: z.number().int().min(2).max(20),
  fastStepKm: z.number().min(0.1).max(5),
  // Pace do trecho forte decidido aqui, pra ESTE dia especifico — nunca mais um valor unico da
  // semana toda aplicado por codigo (ver historico de paceAssessment removido).
  fastPaceSecondsPerKm: z.number().int().min(120).max(700),
  recoveryStepKm: z.number().min(0.05).max(3),
  recoveryPaceSecondsPerKm: z.number().int().min(200).max(1200),
  easyVolumeKm: z.number().min(0).max(60),
});

const AiWalkRunStructureSchema = z.object({
  repeatCount: z.number().int().min(2).max(40),
  walkStepKm: z.number().min(0.05).max(2),
  runStepKm: z.number().min(0.05).max(2),
  walkPaceSecondsPerKm: z.number().int().min(400).max(1200),
  runPaceSecondsPerKm: z.number().int().min(200).max(900),
});

const AiSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  title: z.string().min(1).max(120),
  durationMin: z.number().int().min(10).max(240),
  // Nao existe categoria pre-definida pra escolher antes (nada de "sessionType") — preencha
  // exatamente UMA das tres formas abaixo, a que fizer sentido pra este dia especifico:
  // (1) distanceKm + paceSecondsPerKm diretamente (corrida continua), deixando intervalStructure e
  // walkRunStructure null; (2) intervalStructure preenchido (serie com trecho forte e recuperacao),
  // deixando walkRunStructure null e distanceKm null (paceSecondsPerKm so entra se houver volume
  // leve adicional, ver campo easyVolumeKm dentro da estrutura); (3) walkRunStructure preenchido
  // (alternancia caminhada/corrida), deixando intervalStructure e distanceKm/paceSecondsPerKm null.
  distanceKm: z.number().min(1).max(60).nullable(),
  paceSecondsPerKm: z.number().int().min(150).max(900).nullable(),
  notes: z.string().min(1),
  recommendations: z.string().min(1),
  // Preenchido quando durationMin ultrapassa o tempo normal disponivel para este weekday
  // especifico — cite a diretriz que autoriza isso para ESTE dia. Null/vazio quando a duracao
  // esta dentro do normal do dia.
  durationJustification: z.string().max(300).nullable(),
  intervalStructure: AiIntervalStructureSchema.nullable(),
  walkRunStructure: AiWalkRunStructureSchema.nullable(),
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
  }): Promise<{
    distanceKm: number | null;
    paceSecondsPerKm: number | null;
    intervalStructure: z.infer<typeof AiIntervalStructureSchema> | null;
    walkRunStructure: z.infer<typeof AiWalkRunStructureSchema> | null;
  } | null> {
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
  }): Promise<{
    distanceKm: number | null;
    paceSecondsPerKm: number | null;
    intervalStructure: z.infer<typeof AiIntervalStructureSchema> | null;
    walkRunStructure: z.infer<typeof AiWalkRunStructureSchema> | null;
  } | null> {
    const client = this.client;
    if (!client) return null;
    const schema = z.object({
      distanceKm: z.number().min(1).max(60).nullable(),
      paceSecondsPerKm: z.number().int().min(150).max(900).nullable(),
      intervalStructure: AiIntervalStructureSchema.nullable(),
      walkRunStructure: AiWalkRunStructureSchema.nullable(),
    });
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
      const shape = this.validateSessionShape(parsed, 'treino avulso');
      if (!shape.ok) return null;
      return shape;
    } catch (error) {
      this.logger.warn(`Falha ao gerar treino avulso com o agente de IA: ${describeAiError(error)}`);
      return null;
    }
  }

  // Confere so a consistencia interna dos campos que a IA escolheu pra um dia (continua /
  // intervalado / caminhada-corrida) — nao existe mais nenhuma categoria (sessionType) ditando
  // qual forma e obrigatoria, e NAO existe piso de pace em codigo (removido a pedido explicito do
  // treinador em 02/08: o pace lento e so uma recomendacao no prompt pra IA evitar, nunca uma
  // regra que rejeita a resposta — a IA decide livremente, o codigo so confere forma/consistencia).
  // Reaproveitado tanto na geracao da semana inteira quanto no treino avulso/reparo de um dia.
  private validateSessionShape(
    session: {
      distanceKm: number | null;
      paceSecondsPerKm: number | null;
      intervalStructure: z.infer<typeof AiIntervalStructureSchema> | null;
      walkRunStructure: z.infer<typeof AiWalkRunStructureSchema> | null;
    },
    context: string,
  ):
    | {
        ok: true;
        distanceKm: number | null;
        paceSecondsPerKm: number | null;
        intervalStructure: z.infer<typeof AiIntervalStructureSchema> | null;
        walkRunStructure: z.infer<typeof AiWalkRunStructureSchema> | null;
      }
    | { ok: false; reason: string } {
    const reject = (reason: string) => {
      this.logger.warn(`Rejeitado (${context}): ${reason}`);
      return { ok: false as const, reason };
    };

    if (session.intervalStructure && session.walkRunStructure) {
      return reject('intervalStructure e walkRunStructure preenchidos ao mesmo tempo — so uma forma por dia.');
    }

    if (session.intervalStructure) {
      // easyVolumeKm (dentro de intervalStructure) e paceSecondsPerKm (fora, no nivel da sessao)
      // sao dois campos separados em partes diferentes da resposta — na pratica a IA preenche um
      // e esquece o outro com frequencia (incidente real 02/08: essa foi a causa da maioria das
      // rejeicoes de um dia inteiro). Em vez de descartar o dia todo por causa desse adendo, so
      // ignoramos o volume leve incompleto e mantemos o bloco intervalado principal (que
      // normalmente esta correto) — mesma filosofia de "corrigir, nao rejeitar" ja usada pros
      // campos de texto livre acima.
      const hasEasyVolume = session.intervalStructure.easyVolumeKm > 0 && session.paceSecondsPerKm != null
        && session.intervalStructure.fastPaceSecondsPerKm < session.paceSecondsPerKm;
      if (session.intervalStructure.easyVolumeKm > 0 && !hasEasyVolume) {
        this.logger.warn(`Ignorado volume leve incompleto/inconsistente em intervalStructure (${context}) — mantendo so o bloco intervalado principal.`);
      }
      return { ok: true, distanceKm: null, paceSecondsPerKm: hasEasyVolume ? session.paceSecondsPerKm : null, intervalStructure: session.intervalStructure, walkRunStructure: null };
    }

    if (session.walkRunStructure) {
      return { ok: true, distanceKm: null, paceSecondsPerKm: null, intervalStructure: null, walkRunStructure: session.walkRunStructure };
    }

    if (session.distanceKm == null || session.paceSecondsPerKm == null) {
      return reject('sem distanceKm/paceSecondsPerKm nem nenhuma estrutura preenchidos.');
    }
    return { ok: true, distanceKm: session.distanceKm, paceSecondsPerKm: session.paceSecondsPerKm, intervalStructure: null, walkRunStructure: null };
  }

  private buildRunSessionSystemPrompt() {
    return [
      'Voce e o agente que decide UM treino de corrida isolado, para um unico dia — o treinador esta regenerando so este dia (ou reparando so este dia dentro de uma geracao maior), sem mexer no resto da semana do aluno. A duracao (durationMinDisponivel) ja esta decidida e nao pode mudar; sua tarefa e decidir tudo o resto pensando no contexto real deste aluno (evidencias de pace, diretivas do treinador, observacoes do aluno, sinal de dor) — nunca uma formula ou proporcao fixa.',
      'Nao existe uma categoria pra escolher antes ("tipo de sessao") — voce descreve o treino livremente, preenchendo so os campos que fizerem sentido pra este dia: (1) distanceKm + paceSecondsPerKm diretamente, se for uma corrida continua; (2) intervalStructure (repeatCount, fastStepKm, fastPaceSecondsPerKm, recoveryStepKm, recoveryPaceSecondsPerKm, easyVolumeKm), se fizer sentido um estimulo em series com recuperacao — nesse caso deixe walkRunStructure null, e so preencha paceSecondsPerKm se easyVolumeKm for maior que zero (senao deixe null); (3) walkRunStructure (repeatCount, walkStepKm, runStepKm, walkPaceSecondsPerKm, runPaceSecondsPerKm), se fizer sentido alternar caminhada de verdade com corrida — nesse caso deixe intervalStructure e distanceKm/paceSecondsPerKm null.',
      'NAO EXISTE NENHUMA TABELA OU FORMULA CALCULANDO DISTANCIA A PARTIR DE DURACAO/PACE — voce decide a distancia e o pace diretamente, pensando no que faz sentido pra este aluno neste dia. Voce sabe matematica: se decidir uma estrutura com series/recuperacao, calcule voce mesmo se ela cabe dentro de durationMinDisponivel — nao existe checagem de conta em codigo depois, a responsabilidade e inteiramente sua.',
      'Voce recebe ate tres evidencias de pace (testeOficial, autoRelatoRecente, mediaStravaRecente) — use a mais recente e mais confiavel, nunca uma proporcao fixa entre elas (tipo "pace_teste vezes 0.95").',
      'Se diretrizesEspecificasDoTreinadorParaEsteAluno mencionar algo que se aplique a este dia especifico, aplique literalmente (prioridade quase absoluta). observacoesRegistradasPeloProprioAluno sao informais, considere quando fizer sentido sem sacrificar seguranca. sinalDeSeguranca e motivoDoSinalDeSeguranca sao so informacao de contexto (o aluno relatou dor) — use seu julgamento sobre o que isso muda no treino de hoje, nao existe uma trava automatica aqui.',
      `Recomendacao (nao e uma regra rigida): evite prescrever pace de corrida mais lento que 8:30/km (${MAX_EASY_PACE_SECONDS_PER_KM} segundos por km) quando puder, porque abaixo disso a mecanica da corrida tende a piorar e se aproximar de uma caminhada. Se o ritmo confortavel real deste aluno estiver nessa faixa, considere usar walkRunStructure alternando corrida de verdade com caminhada de verdade — mas a decisao final e sempre sua, pensando no aluno real.`,
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

      const validated = this.validateSessions(parsed.sessions, runSlots);
      // NAO existe mais rejeicao por pace lento (piso de 8:30/km): removido em 02/08 a pedido
      // explicito do treinador — pace lento e so uma recomendacao no prompt pra IA evitar, nunca
      // um motivo pra descartar a resposta (ver validateSessionShape). "failures" aqui so pode
      // vir de inconsistencia estrutural de verdade (ex: campos obrigatorios faltando, duas
      // estruturas preenchidas ao mesmo tempo) — isso continua sendo rejeitado, porque e resposta
      // malformada, nao uma escolha de pace da IA.
      if (validated.failures.length) {
        this.logger.warn(`Rejeitado (semana): ${validated.failures.length} dia(s) com resposta malformada: ${validated.failures.map((f) => `weekday ${f.weekday} (${f.reason})`).join('; ')}`);
        return null;
      }
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

  // "failures" carrega os dias com resposta estruturalmente malformada (campo obrigatorio
  // faltando, duas estruturas preenchidas ao mesmo tempo) — pace lento NAO entra mais aqui desde
  // 02/08 (ver validateSessionShape), pace e sempre aceito como a IA decidiu.
  private validateSessions(
    sessions: z.infer<typeof AiSessionSchema>[],
    runSlots: RunSlot[],
  ): {
    sessions: RunSessionDecision[];
    failures: Array<{ weekday: number; title: string; durationMin: number; notes: string; recommendations: string; reason: string }>;
    routineMismatch: string | null;
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
    const failures: Array<{ weekday: number; title: string; durationMin: number; notes: string; recommendations: string; reason: string }> = [];
    const durationMismatches: string[] = [];

    for (const session of sessions) {
      const slot = slotByWeekday.get(session.weekday);
      // Um weekday fora da disponibilidade normal, ou repetido (mais de uma sessao no mesmo dia),
      // so faz sentido quando uma diretriz individual do treinador pediu isso explicitamente —
      // essas diretrizes tem prioridade quase absoluta (ver buildSystemPromptStable). O codigo nao
      // tenta provar que existe mesmo uma diretriz dizendo isso (isso seria so mais uma regra
      // fixa por cima do raciocinio da IA); se nao houver slot correspondente, so seguimos sem a
      // referencia de duracao normal do dia.
      // ATE 02/08 isso rejeitava a semana INTEIRA quando um dia excedia a duracao normal sem
      // "durationJustification" preenchido — na pratica virou uma trava de codigo em cima da
      // decisao da IA (ela decide a duracao, o codigo nao deveria poder vetar isso so por causa de
      // um campo de texto opcional que ela pode legitimamente ter deixado vazio mesmo tendo um
      // motivo real). Ordem explicita do treinador: quem decide e sempre a IA — o codigo so avisa
      // (log + routineMismatch, ver acima) pra o treinador acompanhar, nunca descarta a resposta.
      if (slot && session.durationMin !== slot.durationMin && !session.durationJustification?.trim()) {
        durationMismatches.push(`weekday ${session.weekday}: ${session.durationMin}min (combinado ${slot.durationMin}min)`);
      }

      const shape = this.validateSessionShape(session, `semana, weekday ${session.weekday}`);
      if (!shape.ok) {
        failures.push({
          weekday: session.weekday,
          title: session.title,
          durationMin: session.durationMin,
          notes: session.notes,
          recommendations: session.recommendations,
          reason: shape.reason,
        });
        continue;
      }

      result.push({
        weekday: session.weekday,
        title: session.title,
        durationMin: session.durationMin,
        distanceKm: shape.distanceKm,
        paceSecondsPerKm: shape.paceSecondsPerKm,
        notes: truncateText(session.notes, 800),
        recommendations: truncateText(session.recommendations, 350),
        intervalStructure: shape.intervalStructure,
        walkRunStructure: shape.walkRunStructure,
      });
    }

    if (durationMismatches.length) {
      const durationNote = `Duracao diferente do combinado sem justificativa: ${durationMismatches.join('; ')}.`;
      this.logger.log(`Aviso (nao bloqueia): ${durationNote}`);
      routineMismatch = routineMismatch ? `${routineMismatch} ${durationNote}` : durationNote;
    }

    return { sessions: result, failures, routineMismatch };
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
  ): { sessions: StrengthSessionDecision[]; missingSlots: StrengthSlot[] } {
    const slotByKey = new Map(strengthSlots.map((slot) => [`${slot.weekday}:${slot.modality}`, slot]));
    const usedKeys = new Set<string>();
    const result: StrengthSessionDecision[] = [];

    for (const session of sessions) {
      const key = `${session.weekday}:${session.modality}`;
      if (usedKeys.has(key)) {
        this.logger.warn(`Ignorada sessao de forca duplicada (weekday ${session.weekday}, modalidade ${session.modality}) — mantida so a primeira.`);
        continue;
      }
      if (!slotByKey.has(key)) {
        this.logger.log(`Sessao de forca fora da rotina cadastrada (weekday ${session.weekday}, modalidade ${session.modality}) — aceita como decisao da IA/diretriz individual.`);
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
    return { sessions: result, missingSlots };
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
      'Nao existe nenhum limite fixo nesta tarefa, nem fisico nem de qualquer outro tipo — tudo (duracao, distancia, pace, volume da semana, quando usar cada forma de treino, o que fazer com um sinal de dor) e julgamento seu, olhando o aluno real. Uma recomendacao, nao uma regra: evite prescrever pace de corrida mais lento que 8:30/km (510 segundos por km) quando puder, porque abaixo disso a mecanica da corrida tende a piorar e se aproximar de uma caminhada. Se o ritmo confortavel real de um aluno estiver nessa faixa, considere alternar corrida de verdade com caminhada de verdade (walkRunStructure) — mas a decisao final e sempre sua, pensando no aluno real; nao existe nenhuma checagem de codigo rejeitando isso.',
      'Se diretrizesEspecificasDoTreinadorParaEsteAluno nao estiver vazio, essas sao intervencoes que o treinador Elton Panzeri pediu PESSOALMENTE para ESTE aluno especifico, normalmente acordadas com o gerente tecnico — ele decidiu isso deliberadamente, com base em algo que so ele sabe sobre esse aluno naquele momento. A diretriz individual e SOBERANA: prioridade absoluta sobre qualquer recomendacao geral de metodologia, incluindo a recomendacao de pace acima. Aplique-as literalmente, sem suavizar ou reinterpretar — inclusive quando pedirem algo fora do padrao normal do aluno (um dia extra de treino, duas sessoes no mesmo dia, uma duracao maior que o normal, um pace fora da faixa recomendada, ou um exercicio de forca especifico que nao esta no catalogo aprovado). O codigo nao trava nada disso; a responsabilidade de aplicar a diretriz certo e sua. Qualquer coisa que parecer estranha, o gerente tecnico conversa com o treinador depois — nao e papel do codigo policiar isso.',
      '- Se observacoesRegistradasPeloProprioAluno nao estiver vazio: isso e MUITO DIFERENTE de diretrizesEspecificasDoTreinadorParaEsteAluno. Sao anotacoes que o proprio ALUNO escreveu livremente sobre circunstancias pessoais (ex: "vou viajar semana que vem e nao sei se terei onde treinar"). Isso NAO e uma ordem, NAO foi confirmado/revisado pelo treinador. Leve em consideracao quando fizer sentido, sem sacrificar principios da metodologia so por causa de uma observacao informal.',
      '- prontuarioDoAluno e um resumo curto e cumulativo, escrito por outro agente, do historico deste aluno (perfil, diretrizes ja aplicadas, observacoes antigas, dores anteriores, padroes de consistencia). Use-o como memoria de fundo — o mesmo tipo de coisa que um treinador humano ja saberia de cor sobre esse aluno sem precisar reler tudo. historicoSemanal, diretrizesEspecificasDoTreinadorParaEsteAluno e observacoesRegistradasPeloProprioAluno continuam sendo as fontes mais recentes e especificas: se algo no prontuario parecer desatualizado ou contradizer esses campos mais atuais, confie nos campos mais atuais.',
      '- Diretrizes frequentemente citam datas de calendario (ex: "longao de 16 km em 25/07"), mas voce so retorna numeros de weekday (0=domingo...6=sabado). Use dataDeCadaDiaDaSemanaSendoGerada + hoje pra achar o weekday certo daquela data. Se a data nao for desta semana, essa parte da diretriz nao se aplica agora — mas aplique o resto da diretriz que nao depender de data.',
      '- Quando uma diretriz da um numero explicito para um dia especifico (distancia, pace, estrutura do tiro/recuperacao, modalidade de caminhada vs trote), use esse numero EXATAMENTE, mesmo que seja diferente do que voce concluiria sozinho. Dias sem diretriz especifica continuam sendo decisao inteiramente sua.',
      '- Se metaDeProva estiver preenchida, use-a como norte GERAL de periodizacao somente nos dias/semanas em que a diretriz nao disser nada especifico — a diretriz especifica sempre vence a sua propria logica de periodizacao rumo a meta. Se os dados reais do aluno indicarem que a meta e pouco realista, ajuste e explique no rationale por que.',
      '- Cubra pelo menos um dia por cada item de diasDisponiveisParaCorrida, usando o weekday certo. durationMin de cada sessao normalmente nao excede o tempo disponivel informado para aquele dia — a excecao e quando diretrizesEspecificasDoTreinadorParaEsteAluno pedir explicitamente algo diferente para aquele dia especifico (mais tempo, um dia extra, ou duas sessoes no mesmo dia): nesse caso preencha durationJustification citando resumidamente a diretriz que autoriza isso. Sem essa diretriz, nao invente dia nem duracao fora do combinado.',
      '- A entrevista inicial (respostasEntrevista) pode estar desatualizada. Se reavaliacaoMaisRecente estiver preenchida, ela e a fonte mais atual sobre o aluno — quando as duas contradizerem, confie na reavaliacaoMaisRecente.',
      'SOBRE DISTANCIA E PACE: nao existe uma unica avaliacao de pace pra semana inteira nem uma categoria de sessao pra escolher antes — cada sessao (cada dia) e descrita livremente, do jeito que fizer sentido pra ela: (1) distanceKm + paceSecondsPerKm diretamente, pra corrida continua; (2) intervalStructure, pra um estimulo em series com recuperacao (paceSecondsPerKm so entra se houver volume leve adicional, ver easyVolumeKm); (3) walkRunStructure, pra alternar caminhada de verdade com corrida de verdade. Nao existe tabela ou formula calculando isso — pense como um treinador real pensaria pra ESTE dia: a condicao do aluno, o que ele fez essa semana, se esse estimulo vem logo apos um esforco forte, a proximidade de uma prova. Voce sabe matematica: se decidir uma estrutura em series, calcule voce mesmo se ela cabe dentro do durationMin disponivel — nao existe checagem de conta em codigo depois.',
      'Voce recebe ate tres evidencias de pace no contexto (testeOficial, autoRelatoRecente, mediaStravaRecente), cada uma com sua origem e idade — use-as como ponto de partida do que este aluno e capaz de sustentar, mas a decisao final de cada dia e sua, olhando o dia especifico (sequencia da semana, fadiga acumulada, fase da periodizacao, proximidade de prova). Nao existe uma regra fixa de qual evidencia vale mais — RACIOCINE, do jeito que um treinador humano faria. Exemplo real de raciocinio esperado, dado pelo proprio treinador Elton: "o teste de 3 km deu 6:30/km, mas a aluna correu 18 km reais a um pace de 6:45/km — ou seja, ela SUSTENTA um pace proximo do teste numa distancia longa de verdade. Isso significa que ela tem mais capacidade do que o teste isolado sugeriria."',
      'Outros pontos de raciocinio: um teste antigo que contradiz um desempenho recente mais forte deve pesar MENOS. Uma unica corrida curta recente pesa menos que uma distancia longa e consistente com boa sensacao relatada. Quando os dados conflitam, prefira a evidencia mais recente E mais consistente com o volume/objetivo do aluno. mediaSemanalKmAtualRelatada e o volume real recente no Strava sao mais uma evidencia desse tipo — informacao pra voce pesar, nao um piso que a soma da semana tem que respeitar.',
      'Se analiseAprofundadaStrava estiver preenchida (vem de outro agente que ja mastigou cadencia, frequencia cardiaca, padroes e outras modalidades do Strava para voce), use o campo "summary" e as "flags" como evidencia adicional real de como o aluno esta respondendo ao treino agora — nao ignore isso, mas tambem nao superestime; combine com o resto das evidencias.',
      'Cuidado ao interpretar texto livre escrito pelo proprio aluno (respostas de entrevista/reavaliacao, comentarios): muitos alunos escrevem de forma informal, como numa conversa entre pessoas, com ironia, hiperbole ou exagero comico (ex: "corri e quase morri" ou "foi moleza" nao sao relatos medicos literais). Nunca leve essas frases ao pe da letra como se fossem um dado objetivo.',
      'VARIEDADE: nao repita o mesmo padrao de estimulo semana apos semana pro mesmo aluno so por inercia (mesmo volume, mesma estrutura, mesmo ritmo de progressao) — pense em como um treinador real varia o treino ao longo do tempo pra continuar desafiando e evoluindo o aluno. Isso vale pro treino em si, nao so pra redacao do titulo/notes.',
      'O campo notes e a sua voz de treinador falando diretamente com o aluno sobre o treino daquele dia especifico. Pense em como um treinador humano de verdade entrega uma prescricao: ele passa os numeros — distancia, pace, series, tempo — mas tambem conversa com o aluno sobre isso. Ele descreve com as proprias palavras o que prescreveu, da dicas de como executar (por onde comecar, como distribuir o esforco ao longo do treino, o que sentir em cada trecho), avisa cuidados especificos daquele treino (nao acelerar demais no inicio, atencao redobrada num trecho mais dificil, sinal de alerta pra ajustar ou parar), e ajuda o aluno a saber lidar na pratica com o que foi prescrito (o que fazer se sentir mais cansado que o esperado, como se comportar num dia mais quente, o que priorizar se precisar encurtar algo). E esse acompanhamento humano e real que faz o aluno confiar e seguir o treino direito — nao e um campo burocratico de preenchimento. NAO fale de aquecimento/resfriamento em notes — isso ja aparece pro aluno como uma instrucao padrao fixa, fora do que voce escreve.',
      'notes e exatamente essa conversa, escrita. distanceKm, paceSecondsPerKm, intervalStructure e walkRunStructure sao os numeros que voce, como treinador, ja decidiu para esse aluno nesse dia — a mesma decisao que voce tomaria escrevendo numa ficha de treino. Quando voce fala sobre o treino em notes, voce esta narrando essa MESMA prescricao que ja escreveu nos numeros, do mesmo jeito que um treinador real nao diria uma coisa na conversa e escreveria outra na ficha — isso deixaria o aluno sem saber o que fazer de verdade. Antes de finalizar, se pergunte: se eu fosse o aluno, lendo isso e olhando os numeros do meu treino ao mesmo tempo, faria sentido? Estou descrevendo exatamente a mesma prescricao, ou inventando uma segunda sem perceber?',
      'O campo recommendations e diferente de notes: e um recado curto, de poucas linhas, um unico ponto pratico que vale a pena o aluno guardar sobre ESTE treino especifico (ex: um cuidado principal, uma dica de execucao, um sinal de alerta) — nao repita o que ja foi dito em notes nem tente cobrir tudo de novo. Pense nisso como o que um treinador real diria em uma frase rapida ao lado da ficha, nao como uma segunda explicacao completa.',
      'CONSISTENCIA INTERNA E OBRIGATORIA: o nivel/condicionamento do aluno que voce concluir tem que ser o MESMO em toda a resposta — rationale geral e notes/recommendations de cada sessao contando a mesma historia sobre este aluno.',
      'PRIMEIRA SEMANA SEM NENHUM HISTORICO (historicoSemanal vazio, sem reavaliacao, sem analiseExecucao, sem analiseAprofundadaStrava): trate como calibragem inicial. Para um aluno com pouco tempo de corrida ou volume baixo/recente-comeco, prefira comecar com rodagens leves e um longao moderado, guardando um estimulo mais forte pra depois de ver a resposta real dele aos primeiros treinos — a nao ser que a evidencia de pace ja seja claramente forte e consistente.',
      'ORCAMENTO DE TEXTO DA RESPOSTA (importante, incidente real 02/08): sua resposta inteira — todos os dias de corrida e de forca de uma vez — tem um limite de tamanho. Se voce escrever textos longos demais nos primeiros dias, pode faltar espaco pra terminar os ultimos, e a resposta e cortada no meio (fica invalida, o aluno nao recebe treino nenhum naquela semana). Terminar a resposta INTEIRA e sempre mais importante do que cada campo de texto ser longo. Regra pratica: notes de cada dia de corrida/forca em torno de 3 a 5 frases (nao um paragrafo extenso), recommendations em 1 a 2 frases curtas, rationale como bullets curtos. Se em algum momento perceber que esta gastando texto demais, prefira DIMINUIR o que ainda vai escrever (textos mais diretos e objetivos) — nunca "force" continuar no mesmo nivel de detalhe e arriscar nao terminar. Uma resposta completa com texto mais enxuto e sempre melhor que uma resposta rica mas cortada.',
      'Responda em portugues nos campos de texto (title, notes, recommendations, recommendation, rationale, durationJustification).',
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
          testeOficial: evidence.testPace
            ? { paceSegundosPorKm: evidence.testPace.secondsPerKm, paceLegivel: formatSecondsPerKm(evidence.testPace.secondsPerKm), idadeEmDias: evidence.testPace.daysAgo }
            : null,
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
      '- weekday e modality da resposta devem ser exatamente os informados em diaDeForcaParaRegenerar — a modalidade e FIXA (vem da rotina real do aluno) e nunca pode ser trocada, nem mesmo por uma diretriz que mencione "musculacao" ou "fortalecimento": diretriz so muda foco/exercicios, nunca a modalidade em si.',
      'Responda em portugues nos campos de texto (title, notes).',
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
