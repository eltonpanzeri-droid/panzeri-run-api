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
const AiSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  title: z.string().min(1).max(120),
  sessionType: z.enum(['easy_run', 'quality_run', 'long_run', 'walk_run']),
  zone: z.enum(['Z2', 'Z4']),
  durationMin: z.number().int().min(10).max(240),
  notes: z.string().min(1),
  recommendations: z.string().min(1),
});

// Exercicios de forca/fortalecimento tambem sao decisao real da IA, nunca de uma rotina fixa
// escondida — exerciseIds sao validados contra o catalogo aprovado (ver validateStrengthSessions)
// antes de qualquer sessao ser aceita. "notes" e texto explicativo livre, sem limite maximo aqui
// pelo mesmo motivo do AiSessionSchema acima (truncado em codigo, nunca rejeita a resposta toda).
const AiStrengthSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  modality: z.enum(['forca', 'fortalecimento_corredores']),
  title: z.string().min(1).max(120),
  exerciseIds: z.array(z.string().min(1).max(60)).min(3).max(10),
  sets: z.number().int().min(2).max(5),
  reps: z.string().min(1).max(40),
  restSeconds: z.number().int().min(20).max(150),
  intensity: z.enum(['Leve', 'Moderada', 'Forte']),
  notes: z.string().min(1),
});

const AiWeeklyDecisionSchema = z.object({
  sessions: z.array(AiSessionSchema).min(1).max(7),
  strengthSessions: z.array(AiStrengthSessionSchema).max(7),
  recommendation: z.string().min(1),
  // Sem .min(1)/.max() por item: ja aconteceu na pratica a IA devolver um item vazio dentro da
  // lista (ex: rationale[0] = "") e tambem um item longo demais — e a resposta inteira ser
  // rejeitada por causa de UM bullet, desperdicando a chamada cara de IA por um detalhe cosmetico.
  // Itens vazios sao filtrados e itens longos sao truncados depois de parsear (ver attemptDecision).
  rationale: z.array(z.string()).min(1).max(8),
  paceAssessment: z.object({
    easyPaceSecondsPerKm: z.number().int().min(150).max(900),
    intensePaceSecondsPerKm: z.number().int().min(120).max(700),
    rationale: z.string().min(1),
  }),
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

    // Nao ha mais um motor de regras fixas para cair como fallback: o treinador foi explicito
    // que a prescricao TEM que vir de raciocinio real da IA, nunca de regra estatica. Por isso
    // tentamos duas vezes antes de desistir — falhas de IA costumam ser transitorias (formato de
    // saida um pouco fora do schema, rede) e nao devem custar a semana inteira do aluno.
    const attempt = () => this.attemptDecision(input, evidence);
    return (await attempt()) ?? (await attempt());
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
          system: this.buildSingleStrengthSystemPrompt(),
          messages: [{ role: 'user', content: this.buildSingleStrengthUserPrompt(input, slot) }],
        }),
      );
      const parsed = response.parsed_output;
      if (!parsed) return null;
      const validated = this.validateStrengthSessions([parsed], [slot]);
      return validated?.[0] ?? null;
    } catch (error) {
      this.logger.warn(`Falha ao gerar decisao de forca avulsa com o agente de IA: ${describeAiError(error)}`);
      return null;
    }
  }

  private async attemptDecision(input: MethodologyInput, evidence: PaceEvidence): Promise<(WeeklyMethodologyDecision & { source: 'ai' }) | null> {
    const client = this.client;
    if (!client) return null;
    const runSlots = computeRunSlots(input.availability);
    const strengthSlots = computeStrengthSlots(input.availability);

    const painTier = input.painTier ?? (hasSafetyConcern(input.answers) ? 'reduced' : 'normal');
    const safetyAdjustment = painTier !== 'normal';
    const removeRunning = painTier === 'remove_running';
    const novice = isNovice(input.experience, input.answers);

    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-sonnet-5',
          // Aumentado de 8000 depois que strengthSessions foi adicionado a mesma resposta: um
          // aluno com varios dias de forca/fortalecimento (cada um com titulo/notes/exercicios)
          // soma bastante texto em cima do que a corrida ja usava, e o mesmo tipo de falha
          // silenciosa ja documentada (resposta cortada por estourar o limite, rejeitada pelo
          // Zod, indistinguivel de uma falha de rede) reapareceu na pratica com alunos com rotina
          // de forca mais cheia (varios dias de musculacao/fortalecimento).
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'high',
            format: zodOutputFormat(AiWeeklyDecisionSchema),
          },
          system: this.buildSystemPrompt(safetyAdjustment, removeRunning, novice),
          messages: [{ role: 'user', content: this.buildUserPrompt(input, runSlots, strengthSlots, safetyAdjustment, novice, evidence, input.painReason ?? null) }],
        }),
      );

      const parsed = response.parsed_output;
      if (!parsed) return null;

      if (parsed.paceAssessment.intensePaceSecondsPerKm >= parsed.paceAssessment.easyPaceSecondsPerKm) {
        this.logger.warn('Decisao do agente de IA rejeitada: pace intenso nao e mais rapido que o pace facil.');
        return null;
      }

      const hasActiveDirectives = (input.studentDirectives?.length ?? 0) > 0;
      const sessions = this.validateSessions(parsed.sessions, runSlots, safetyAdjustment, parsed.paceAssessment.easyPaceSecondsPerKm, hasActiveDirectives);
      if (!sessions) {
        this.logger.warn('Decisao do agente de IA rejeitada na validacao (fora dos limites de seguranca/disponibilidade/mecanica de corrida).');
        return null;
      }

      const strengthSessions = this.validateStrengthSessions(parsed.strengthSessions, strengthSlots);
      if (!strengthSessions) {
        this.logger.warn('Decisao do agente de IA rejeitada na validacao dos dias de forca/fortalecimento (dia/modalidade nao bate com a disponibilidade, ou exercicio fora do catalogo aprovado).');
        return null;
      }

      const rationale = parsed.rationale
        .map((item) => truncateText(item.trim(), 500))
        .filter((item) => item.length > 0);

      return {
        sessions,
        strengthSessions,
        recommendation: truncateText(parsed.recommendation, 1200),
        rationale: rationale.length > 0 ? rationale : ['Decisao gerada pelo agente de IA.'],
        safetyAdjustment,
        targetLowIntensityShare: 0.8,
        paceAssessment: {
          ...parsed.paceAssessment,
          rationale: truncateText(parsed.paceAssessment.rationale, 900),
        },
        source: 'ai',
      };
    } catch (error) {
      this.logger.warn(`Falha ao gerar decisao com o agente de IA: ${describeAiError(error)}`);
      return null;
    }
  }

  private validateSessions(
    sessions: z.infer<typeof AiSessionSchema>[],
    runSlots: RunSlot[],
    safetyAdjustment: boolean,
    easyPaceSecondsPerKm: number,
    hasActiveDirectives: boolean,
  ): RunSessionDecision[] | null {
    // Log detalhado do motivo da rejeicao: sem isso, toda rejeicao vira um fallback silencioso
    // para o motor deterministico (que ignora diretivas e pace especifico), e ninguem consegue
    // saber pelo EasyPanel por que a IA "nao esta sendo ouvida" numa semana especifica.
    if (sessions.length !== runSlots.length) {
      this.logger.warn(
        `Rejeitado: numero de sessoes da IA (${sessions.length}) diferente do numero de dias disponiveis (${runSlots.length}). Weekdays da IA: [${sessions.map((s) => s.weekday).join(',')}], weekdays esperados: [${runSlots.map((s) => s.weekday).join(',')}].`,
      );
      return null;
    }
    const slotByWeekday = new Map(runSlots.map((slot) => [slot.weekday, slot]));
    const usedWeekdays = new Set<number>();
    const result: RunSessionDecision[] = [];
    // Se o proprio pace facil que o agente concluiu ja e nitidamente rapido (aluno claramente
    // corre bem), walk_run nao faz sentido — mas a decisao vem do pace real, nao de um rotulo
    // de "iniciante" na entrevista.
    const clearlyCapableOfContinuousRunning = easyPaceSecondsPerKm < 420;
    // Diretriz ativa e uma instrucao pontual e confirmada pelo treinador com o aluno fora do app
    // (ex: liberar mais tempo para um longao antes de uma prova) — nesse caso o tempo disponivel
    // registrado na disponibilidade semanal normal deixa de ser um teto absoluto, dentro de um
    // limite de seguranca razoavel.
    const directiveDurationCeiling = 180;

    for (const session of sessions) {
      const slot = slotByWeekday.get(session.weekday);
      if (!slot) {
        this.logger.warn(`Rejeitado: IA retornou weekday ${session.weekday}, que nao esta entre os dias disponiveis [${runSlots.map((s) => s.weekday).join(',')}].`);
        return null;
      }
      if (usedWeekdays.has(session.weekday)) {
        this.logger.warn(`Rejeitado: IA retornou o weekday ${session.weekday} mais de uma vez.`);
        return null;
      }
      const maxDurationForDay = hasActiveDirectives ? Math.max(slot.durationMin, directiveDurationCeiling) : slot.durationMin;
      if (session.durationMin < 10 || session.durationMin > maxDurationForDay) {
        this.logger.warn(
          `Rejeitado: durationMin ${session.durationMin} fora do limite para weekday ${session.weekday} (min 10, max ${maxDurationForDay}, hasActiveDirectives=${hasActiveDirectives}).`,
        );
        return null;
      }
      if (safetyAdjustment && (session.sessionType === 'quality_run' || session.zone === 'Z4')) {
        this.logger.warn(`Rejeitado: sessionType/zone intenso (${session.sessionType}/${session.zone}) proibido no weekday ${session.weekday} por sinal de seguranca ativo.`);
        return null;
      }
      if (clearlyCapableOfContinuousRunning && session.sessionType === 'walk_run') {
        this.logger.warn(`Rejeitado: IA escolheu walk_run no weekday ${session.weekday} para aluno com pace facil claramente de corredor (${easyPaceSecondsPerKm}s/km).`);
        return null;
      }

      usedWeekdays.add(session.weekday);
      result.push({
        weekday: session.weekday,
        title: session.title,
        sessionType: session.sessionType,
        zone: session.zone,
        durationMin: session.durationMin,
        notes: truncateText(session.notes, 800),
        recommendations: truncateText(session.recommendations, 600),
      });
    }

    return result;
  }

  // Garante que a IA so use exercicios reais do catalogo aprovado (nomes/descricoes/videos ja
  // curados) e so decida dias/modalidades que o aluno realmente tem disponiveis — nunca inventa
  // um exercicio nem escolhe um catalogo que nao bate com a modalidade do dia. Fora isso (quais
  // exercicios, quantos, foco muscular do dia, sets/reps/descanso), a decisao e inteiramente da IA.
  //
  // Chave composta (weekday+modality), nao so weekday: a rotina de um aluno pode legitimamente ter
  // MAIS DE UMA modalidade de forca no mesmo dia (ex: forca e fortalecimento_corredores na mesma
  // quarta-feira — o app permite marcar as duas). Um Map indexado so por weekday guardava apenas a
  // ULTIMA modalidade daquele dia (a outra era sobrescrita silenciosamente), entao quando a IA
  // corretamente devolvia uma sessao para a modalidade "esquecida", o codigo rejeitava como se a IA
  // tivesse errado — o erro sempre foi nosso, nunca da IA. Isso nao e especifico de um aluno: afeta
  // qualquer aluno com mais de uma modalidade de forca marcada no mesmo dia.
  private validateStrengthSessions(
    sessions: z.infer<typeof AiStrengthSessionSchema>[],
    strengthSlots: StrengthSlot[],
  ): StrengthSessionDecision[] | null {
    if (sessions.length !== strengthSlots.length) {
      this.logger.warn(
        `Rejeitado (forca): numero de sessoes da IA (${sessions.length}) diferente do numero de dias/modalidades de forca disponiveis (${strengthSlots.length}) [${strengthSlots.map((s) => `${s.weekday}:${s.modality}`).join(',')}].`,
      );
      return null;
    }
    const slotByKey = new Map(strengthSlots.map((slot) => [`${slot.weekday}:${slot.modality}`, slot]));
    const usedKeys = new Set<string>();
    const result: StrengthSessionDecision[] = [];

    for (const session of sessions) {
      const key = `${session.weekday}:${session.modality}`;
      const slot = slotByKey.get(key);
      if (!slot) {
        this.logger.warn(`Rejeitado (forca): IA retornou weekday ${session.weekday} com modalidade ${session.modality}, combinacao que nao esta entre as disponiveis [${strengthSlots.map((s) => `${s.weekday}:${s.modality}`).join(',')}].`);
        return null;
      }
      if (usedKeys.has(key)) {
        this.logger.warn(`Rejeitado (forca): IA retornou o weekday ${session.weekday} com modalidade ${session.modality} mais de uma vez.`);
        return null;
      }
      usedKeys.add(key);
      const catalog = session.modality === 'forca' ? gymExerciseLibrary : runnerStrengthExercises;
      const catalogIds = new Set(catalog.map((exercise) => exercise.id));
      const invalidIds = session.exerciseIds.filter((id) => !catalogIds.has(id));
      if (invalidIds.length) {
        this.logger.warn(`Rejeitado (forca): IA escolheu exercicio(s) fora do catalogo aprovado para ${session.modality} no weekday ${session.weekday}: [${invalidIds.join(',')}].`);
        return null;
      }

      result.push({
        weekday: session.weekday,
        modality: session.modality,
        title: session.title,
        exerciseIds: session.exerciseIds,
        sets: session.sets,
        reps: session.reps,
        restSeconds: session.restSeconds,
        intensity: session.intensity,
        notes: truncateText(session.notes, 900),
      });
    }

    return result;
  }

  private buildSystemPrompt(safetyAdjustment: boolean, removeRunning: boolean, novice: boolean) {
    return [
      'Voce e o agente de prescricao de treinos de corrida da Panzeri Run.',
      'Sua unica funcao e decidir a estrutura da semana de treinos de corrida de UM aluno, aplicando o julgamento real do treinador Elton Panzeri descrito abaixo — nunca conhecimento generico de blogs ou regras fixas de treinamento de corrida.',
      PANZERI_METHODOLOGY_KNOWLEDGE,
      'Regras obrigatorias, nao negociaveis (sobrepoe qualquer outra decisao):',
      '- Se diretrizesEspecificasDoTreinadorParaEsteAluno nao estiver vazio, essas sao intervencoes que o treinador Elton Panzeri pediu PESSOALMENTE para ESTE aluno especifico (nao uma recomendacao generica de metodologia) — ele decidiu isso deliberadamente, com base em algo que so ele sabe sobre esse aluno naquele momento. Por isso, essas diretrizes tem prioridade quase absoluta: sobrepoe qualquer recomendacao geral de metodologia abaixo, e so perdem para as regras de seguranca obrigatorias desta lista. Aplique-as literalmente, sem suavizar ou reinterpretar.',
      '- Se observacoesRegistradasPeloProprioAluno nao estiver vazio: isso e MUITO DIFERENTE de diretrizesEspecificasDoTreinadorParaEsteAluno. Sao anotacoes que o proprio ALUNO escreveu livremente sobre circunstancias pessoais (ex: "vou viajar semana que vem e nao sei se terei onde treinar", "essa semana vou ter uma prova na faculdade e menos tempo"). Isso NAO e uma ordem, NAO foi confirmado/revisado pelo treinador, e voce NAO e obrigado a agir sobre isso. Leve em consideracao quando fizer sentido e for possivel ajustar (ex: reduzir expectativa de volume numa semana que o aluno avisou que vai viajar), mas nunca sacrifique seguranca ou principios da metodologia so por causa de uma observacao informal. Se a observacao mencionar uma data especifica, use hoje/dataDeCadaDiaDaSemanaSendoGerada para julgar se ela e relevante para a semana que voce esta gerando agora.',
      '- ATENCAO ESPECIAL A DATAS: diretrizes frequentemente citam datas de calendario especificas (ex: "longao de 16 km em 25/07", "taper de 03/08 a 09/08"), mas voce so pode retornar numeros de weekday (0=domingo...6=sabado), nao datas. Use o campo dataDeCadaDiaDaSemanaSendoGerada (mapa weekday -> data desta semana especifica) e o campo hoje (data de hoje) para descobrir exatamente qual weekday corresponde a cada data mencionada na diretriz, e aplique a instrucao (distancia/duracao/pace) NAQUELE weekday especifico. Se uma data da diretriz nao aparecer em dataDeCadaDiaDaSemanaSendoGerada, ela e de uma semana diferente da que voce esta gerando agora — nesse caso ignore essa parte da diretriz (nao aplique fora da semana certa), mas ainda assim aplique instrucoes de pace/regra geral que nao sejam amarradas a uma data especifica. Nunca ignore uma diretriz so porque voce nao tem certeza da data — raciocine com cuidado antes de descartar.',
      '- ERRO GRAVE JA OBSERVADO NA PRATICA, NAO REPITA: quando uma diretriz da uma distancia-alvo explicita para um dia especifico (ex: "16 km no sabado"), voce NAO PODE simplesmente manter o durationMin normal daquele dia (o tempo disponivel de sempre) e deixar a distancia emergir sozinha do calculo duration/pace — isso produz uma distancia bem menor que o pedido e e exatamente o erro que ja aconteceu. O procedimento correto e o INVERSO: primeiro decida o pace real que vale para aquele treino (use o pace que a propria diretriz especificou, se ela der um pace; senao use seu paceAssessment), DEPOIS calcule durationMin = distanciaAlvoKm * paceSegundosPorKm / 60 (arredondado), e retorne ESSE durationMin calculado para aquele dia — mesmo que fique bem maior que o tempo disponivel normal (a excecao de tempo abaixo permite isso). Exemplo numerico: diretriz pede 16 km no sabado com pace de longao de 6:20-7:00/km (~400s/km); durationMin correto e aproximadamente 16 * 400 / 60 = 107 minutos — nunca 70 minutos (que so daria uns 10-11 km nesse pace, nao os 16 km pedidos).',
      '- Se metaDeProva estiver preenchida, use-a como norte para a periodizacao (volume, foco da fase, urgencia conforme a proximidade da data), mas voce PODE e DEVE ajustar a interpretacao dessa meta se os dados reais do aluno (pace, volume sustentado, experiencia, tempo ate a prova) indicarem que ela e pouco realista — nesse caso, prescreva o que voce julgar seguro e adequado para a capacidade real do aluno, e explique claramente no rationale que a meta informada parece ambiciosa/pouco realista e por que voce ajustou a abordagem. Nunca sacrifique seguranca ou progressao responsavel para tentar alcancar uma meta.',
      '- Retorne exatamente uma sessao de corrida para cada dia disponivel informado, usando o mesmo numero de weekday (0=domingo...6=sabado).',
      '- durationMin de cada sessao normalmente nao pode exceder o tempo disponivel informado para aquele dia. EXCECAO: se diretrizesEspecificasDoTreinadorParaEsteAluno pedir explicitamente uma sessao mais longa num dia especifico (ex: um longao maior antes de uma prova, combinado entre o treinador e o aluno fora do app), voce PODE exceder o tempo disponivel normal daquele dia para cumprir a diretriz literalmente — o treinador ja confirmou isso com o aluno. Mesmo assim, nunca prescreva mais de 180 minutos numa unica sessao.',
      '- Se o aluno relatou uma media semanal de quilometragem atual (mediaSemanalKmAtualRelatada) e/ou volume real recente no Strava, a soma aproximada da distancia de todas as sessoes da semana que voce prescrever NUNCA deve ficar muito abaixo desse volume que ele ja sustenta na pratica, a nao ser que haja um motivo real de seguranca, deload ou retorno de pausa. O erro classico a evitar: um aluno que corre 19 km por semana recebendo uma sessao "leve" de 4 km (dos quais 1,1 km e so aquecimento/desaquecimento) — isso e um treino curto e ruim demais para a capacidade real dele, e deve ser tratado como falha grave.',
      '- A entrevista inicial (respostasEntrevista) pode estar desatualizada — a realidade do aluno muda com o tempo (rotina, condicionamento, dor, objetivo, peso). Se reavaliacaoMaisRecente estiver preenchida, ela e a fonte mais atual que voce tem sobre o aluno: leia as respostas dela, o resumo de evolucao e os pontos positivos/de atencao, e use isso para entender o que mudou desde a entrevista inicial. Quando as duas fontes contradizerem, confie na reavaliacaoMaisRecente. Se reavaliacaoMaisRecente for null, o aluno ainda nao fez nenhuma reavaliacao — use so a entrevista inicial mesmo.',
      removeRunning
        ? '- Este aluno relatou dor intensa recentemente (relato estruturado de dor, nao a entrevista de onboarding). A corrida ja foi removida desta semana pelo sistema antes de voce ser chamado — se ainda assim voce receber dias de corrida no contexto, trate-os como sessoes leves de transicao apenas, nunca quality_run/Z4.'
        : safetyAdjustment
          ? '- Este aluno tem um relato de dor RECENTE (moderada ou recorrente, calculado a partir dos ultimos relatos de dor, nao de uma resposta antiga e permanente da entrevista): NUNCA use sessionType "quality_run" nem zone "Z4" nesta semana, mas a corrida continua acontecendo normalmente com volume/intensidade reduzidos. Um relato de dor leve e isolado (uma unica vez, intensidade baixa) NAO deveria ter chegado aqui como sinal ativo — dor pontual e leve nao e motivo para tirar treino intervalado.'
          : '- Sem sinal de dor recente relatado no momento, mas priorize seguranca e progressao conservadora sempre que os dados sugerirem cautela.',
      '- Classificacao de experiencia/entrevista (classificadoComoIniciante no contexto) e so um dado informativo a mais — a decisao de usar sessionType "walk_run" deve vir do PACE REAL que voce concluir (paceAssessment), nao do rotulo de iniciante. Um aluno pode ter experiencia registrada mas ainda assim ter um pace facil proximo do ritmo de caminhada (destreinado, retorno de pausa, sobrepeso recente); e alguem classificado como iniciante pode ja ter um pace facil claramente de corredor. Se o easyPaceSecondsPerKm que voce concluir for claramente rapido (aluno corre bem de verdade), NUNCA use "walk_run" mesmo que a entrevista sugira pouca experiencia.',
      '- Zonas (Z1-Z5) sao uma ferramenta OBRIGATORIA de classificacao/raciocinio do esforco, mas NAO existe obrigacao de que o pace numerico siga uma formula fixa de zona — o pace vem do seu raciocinio sobre a evidencia real (ver paceAssessment abaixo). A proporcao 80/20 de baixa/alta intensidade e RECOMENDADA como referencia geral (um NORTE), nao e obrigatoria — varie livremente quando a disponibilidade, o limiar do aluno ou o objetivo pedirem algo diferente.',
      '- Entenda isto como obrigatorio: um aluno cujo pace facil real esta proximo do ritmo de caminhada vai precisar passar MAIS tempo em intensidade alta, nao menos — porque abaixo de aproximadamente 8:30/km a mecanica da corrida piora (fica parecido com andar rapido). Para esse aluno, prefira treinos intervalados com a parte de corrida mais forte (mesmo parecendo intenso pro nivel dele) alternada com CAMINHADA de verdade como recuperacao (pace de caminhada bem mais lento), em vez de forcar uma corrida continua lenta com mecanica ruim.',
      'SOBRE O PACE — ISTO E O PONTO MAIS IMPORTANTE DE TODA A TAREFA. NAO EXISTE NENHUMA TABELA OU FORMULA FIXA DE ZONA PARA CALCULAR PACE. Voce mesmo precisa PENSAR e decidir dois numeros, com base em evidencia real, nao em regra:',
      '- easyPaceSecondsPerKm: o pace confortavel/leve REAL desse aluno agora (usado nas sessoes leves, longao, aquecimento e desaquecimento).',
      '- intensePaceSecondsPerKm: o pace de esforco forte REAL desse aluno agora (usado nas sessoes de qualidade/intervalado).',
      'Voce recebe ate tres evidencias de pace no contexto (testeOficial, autoRelatoRecente, mediaStravaRecente), cada uma com sua origem e idade. Nao existe uma regra fixa de qual vale mais — RACIOCINE, do jeito que um treinador humano faria. Exemplo real de raciocinio esperado, dado pelo proprio treinador Elton: "o teste de 3 km deu 6:30/km, mas a aluna correu 18 km reais a um pace de 6:45/km — ou seja, ela SUSTENTA um pace proximo do teste numa distancia longa de verdade. Isso significa que ela tem mais capacidade do que o teste isolado sugeriria, entao para treinos intervalados o pace intenso deve ser mais forte do que o teste indicaria sozinho, e o pace facil dela e claramente mais rapido do que uma formula de zona genérica calcularia."',
      'Outros pontos de raciocinio: um teste antigo que contradiz um desempenho recente mais forte deve pesar MENOS. Uma unica corrida curta recente pesa menos que uma distancia longa e consistente com boa sensacao relatada. Quando os dados conflitam, prefira a evidencia mais recente E mais consistente com o volume/objetivo do aluno.',
      'O erro mais grave possivel nesta tarefa e prescrever um treino "leve" com pace tao lento que fica parecido com uma caminhada para um aluno que claramente corre mais rapido que isso. Isso e burrice, nao inteligencia — pense de verdade sobre o que os dados dizem sobre ESTE aluno especifico, nao aplique uma conta generica.',
      'Voce DEVE retornar paceAssessment com os dois numeros e uma justificativa (rationale) explicando como voce chegou neles a partir das evidencias.',
      'Se analiseAprofundadaStrava estiver preenchida (vem de outro agente que ja mastigou cadencia, frequencia cardiaca, padroes e outras modalidades do Strava para voce), use o campo "summary" e as "flags" como evidencia adicional real de como o aluno esta respondendo ao treino agora — nao ignore isso, mas tambem nao superestime; combine com o resto das evidencias.',
      'Cuidado ao interpretar texto livre escrito pelo proprio aluno (respostas de entrevista/reavaliacao, comentarios): muitos alunos escrevem de forma informal, como numa conversa entre pessoas, com ironia, hiperbole ou exagero comico (ex: "corri e quase morri" ou "foi moleza" nao sao relatos medicos literais). Nunca leve essas frases ao pe da letra como se fossem um dado objetivo — interprete o tom real antes de decidir algo com base nelas, e prefira sempre dados estruturados/numericos (pace, testes, aderencia) quando o texto livre parecer contraditorio ou exagerado.',
      'VARIEDADE: evite repetir literalmente o mesmo titulo e a mesma frase de notes toda semana para o mesmo tipo de sessao (ex: sempre "Corrida leve" com a mesma nota) — isso ja foi apontado pelo treinador como preguica de quem monta o treino. Varie a redacao do titulo e das notes de forma natural semana a semana, mantendo o mesmo padrao metodologico (nao mude o proposito da sessao so por variar, mude a forma como ela e descrita e pequenos detalhes de enfase).',
      'PROIBIDO citar numeros especificos de repeticoes, distancia por tiro/trecho ou pace/velocidade exatos dentro do campo notes (ex: "5x 1000m", "tiros de 6:05 a 6:20/km", "400m de recuperacao"). Esses numeros (quantidade de repeticoes, distancia de cada trecho, pace de cada bloco) sao SEMPRE calculados depois, por uma formula separada, a partir do seu durationMin/zone/paceAssessment — voce nao tem acesso a esse calculo e qualquer numero especifico que voce escrever em notes quase certamente vai bater errado com o que realmente aparece no treino estruturado do aluno (ja aconteceu na pratica: notes dizia "5x 1000m" enquanto o treino real gerado era "4x 0,7km"). Em notes, descreva so a ESTRATEGIA e a SENSACAO do treino em palavras (ex: "comece controlado e mantenha o mesmo ritmo forte do primeiro ao ultimo tiro, sem estourar no inicio" ou "use as recuperacoes para respirar antes do proximo tiro"), nunca numeros de distancia/repeticao/pace — esses numeros o aluno ja ve corretos, calculados a parte, no proprio treino estruturado.',
      'SOBRE O CAMPO recommendations (novo, um por sessao): aquecimento e desaquecimento NAO fazem mais parte do treino prescrito nem da distancia/duracao total — eles viram uma RECOMENDACAO em texto, separada, mostrada ao aluno depois do treino principal. Voce e responsavel por escrever essa recomendacao PENSANDO no aluno especifico, nao aplicando uma regra fixa. Diretriz do treinador, dada literalmente: para a maioria dos alunos, recomende aquecer de 5 a 10 minutos (caminhando ou trote bem leve, a escolha do aluno) e desaquecer com uns 5 minutos de caminhada leve. Para um aluno que voce concluiu (pelo paceAssessment e pelas evidencias de pace) ser um corredor amador com bom condicionamento e que sustenta ritmo por mais tempo, pode fazer mais sentido recomendar um trote leve de 1 a 3 km como aquecimento/desaquecimento em vez de so caminhar — mas essa decisao e SUA, baseada no pace/nivel real do aluno, nao existe um numero de corte fixo pra isso. NUNCA use essa recomendacao de trote de aquecimento/desaquecimento (nem frases como "voce ja corre bem") para um aluno que voce mesmo classificou como iniciante/pouco condicionado em qualquer outro campo desta mesma resposta (rationale, notes, paceAssessment.rationale) — isso ja aconteceu na pratica (recomendacao de trote de aquecimento escrita para uma aluna que a propria IA descreveu, no rationale, como iniciante com menos de 1 ano de corrida e maior distancia de 6 km) e e uma contradicao grave dentro da mesma resposta. Alem do aquecimento/desaquecimento, inclua neste campo outras recomendacoes praticas quando fizerem sentido para aquele treino especifico (ex: cuidado ao correr na rua — atencao ao transito e piso irregular —, ajustar inclinacao/passada se for na esteira, se hidratar bem principalmente em treinos mais longos ou dias quentes, levar gel/agua em longoes). Nao repita o mesmo texto generico sempre — adapte ao contexto da sessao (dia, duracao, se e longao ou intervalado, se e rua ou esteira segundo a modalidade informada).',
      'CONSISTENCIA INTERNA E OBRIGATORIA: o nivel/condicionamento do aluno que voce concluir (a partir do pace real, historicoSemanal, respostasEntrevista e reavaliacaoMaisRecente) tem que ser o MESMO em toda a resposta — no rationale geral, no notes e recommendations de cada sessao, e no paceAssessment.rationale. Nunca descreva o aluno como iniciante/pouco condicionado num campo e depois escreva, em outro campo da mesma resposta, um elogio ou recomendacao que so faria sentido para um corredor experiente (ou vice-versa). Antes de finalizar a resposta, revise mentalmente se todos os campos de texto contam a MESMA historia sobre este aluno.',
      'PRIMEIRA SEMANA SEM NENHUM HISTORICO (historicoSemanal vazio, sem reavaliacao, sem analiseExecucao, sem analiseAprofundadaStrava): nesse cenario voce ainda nao tem nenhuma resposta real de treino deste aluno especifico — trate a semana como uma calibragem inicial. Para um aluno com pouco tempo de corrida ou volume semanal baixo/recente-comeco (mesmo que os dados nao configurem safetyAdjustment), prefira NAO incluir quality_run/Z4 logo na primeira semana gerada — comece com rodagens leves e um longao moderado, e deixe o estimulo de qualidade para depois de ver a resposta real dele aos primeiros treinos. So inclua qualidade ja na primeira semana se a evidencia de pace for claramente forte e consistente o suficiente para justificar (ex: teste oficial recente e robusto), nunca so por completude do calendario.',
      'Responda em portugues nos campos de texto (title, notes, recommendations, recommendation, rationale, paceAssessment.rationale).',
      'SOBRE OS DIAS DE FORCA/FORTALECIMENTO (campo strengthSessions): voce tambem decide os exercicios de musculacao e fortalecimento para corredores, com o mesmo julgamento real que aplica a corrida — nao existe mais nenhuma rotina fixa de exercicios escondida de voce para esses dias.',
      '- Retorne exatamente uma sessao em strengthSessions para CADA ITEM listado em diasDisponiveisParaForca, usando o mesmo weekday e a mesma modalidade daquele item especifico (modality "forca" = musculacao geral, "fortalecimento_corredores" = circuito especifico para corredores). ATENCAO: o mesmo weekday pode aparecer MAIS DE UMA VEZ na lista, uma para cada modalidade — isso significa que aquele aluno legitimamente faz as duas coisas naquele dia (ex: forca e fortalecimento_corredores na mesma quarta-feira). Nesse caso, retorne uma sessao PARA CADA item (duas sessoes diferentes, mesma weekday, modalidades diferentes) — isso nao e um erro nem duplicidade, e o dado real da rotina do aluno.',
      '- A modalidade de cada ITEM (nao de cada weekday) em diasDisponiveisParaForca e FIXA — vem da rotina semanal real do aluno, cadastrada fora do seu alcance, e NUNCA pode ser trocada por voce, nem mesmo se uma diretriz do treinador falar sobre "musculacao" ou "fortalecimento" para aquele dia. Copie o campo modality de cada item de diasDisponiveisParaForca literalmente, sempre. Uma diretriz sobre forca/fortalecimento so pode mudar o FOCO/exercicios/intensidade daquele dia (ver regra abaixo), nunca a modalidade em si — isso ja causou rejeicao e falha total da geracao na pratica (IA tentou responder "forca" para um weekday cuja modalidade real era "fortalecimento_corredores").',
      '- exerciseIds SO PODE conter ids que existem literalmente em catalogoExerciciosMusculacao (para modality "forca") ou catalogoExerciciosFortalecimentoCorredores (para modality "fortalecimento_corredores") — nunca invente um exercicio ou nome que nao esteja no catalogo informado. Escolha entre 3 e 10 exercicios conforme o tempo disponivel do dia (mais tempo, mais exercicios).',
      '- Se diretrizesEspecificasDoTreinadorParaEsteAluno pedir um FOCO especifico para um dia de forca (ex: "segunda e dia de perna, sem corrida" ou uma lista explicita de exercicios), aplique isso literalmente: escolha exerciseIds cujo campo "group" (catalogoExerciciosMusculacao) ou "focus" (catalogoExerciciosFortalecimentoCorredores) correspondam ao foco pedido (ex: foco em perna = grupos quadriceps/posterior/gluteos/panturrilha/quadril; foco em superior = peito/costas/ombros/biceps/triceps), ou os exercicios especificos citados pelo nome, se existirem no catalogo. Isso e igual em prioridade as diretrizes de corrida — sao ordens pessoais do treinador para este aluno, nao uma sugestao.',
      '- Sem diretriz especifica sobre o foco do dia, monte uma sessao equilibrada e variada (pernas + core + upper body de forma proporcional), a nao ser que o proprio catalogo/nivel do aluno sugira outra coisa.',
      '- Nivel dos exercicios (campo "level" no catalogo): prefira "base" para alunos iniciantes ou com sinalDeSeguranca ativo; "intermediate"/"advanced" para alunos com mais experiencia e sem sinal de seguranca ativo. Isso e julgamento seu, nao uma tabela fixa.',
      '- sets, reps, restSeconds e intensity sao decisao sua por sessao (nao precisa variar por exercicio individual): valores tipicos giram em torno de 3 series de 8 a 12 repeticoes com 60 a 90s de descanso para musculacao, e series mais curtas/tempo (ex: "30 a 45s") com descanso um pouco menor para exercicios de core ou fortalecimento para corredores — mas ajuste livremente conforme a duracao do dia, o nivel do aluno e sinal de seguranca.',
      '- VARIEDADE tambem vale aqui: evite repetir a mesma lista exata de exercicios toda semana para o mesmo aluno/dia — alterne exercicios equivalentes do catalogo quando fizer sentido, mantendo a logica de foco/objetivo do dia.',
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
      '- exerciseIds SO PODE conter ids que existem literalmente no catalogo informado (catalogoExerciciosMusculacao para modality "forca", catalogoExerciciosFortalecimentoCorredores para "fortalecimento_corredores") — nunca invente um exercicio. Escolha entre 3 e 10 exercicios conforme a duracao do dia.',
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
