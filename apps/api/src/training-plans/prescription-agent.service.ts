import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  MethodologyInput,
  RunSessionDecision,
  WeeklyMethodologyDecision,
  computeRunSlots,
  hasSafetyConcern,
  isNovice,
} from './training-methodology';
import { PANZERI_METHODOLOGY_KNOWLEDGE } from './panzeri-methodology-knowledge';
import { AiQueueService } from '../common/ai-queue.service';

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

const AiSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  title: z.string().min(1).max(120),
  sessionType: z.enum(['easy_run', 'quality_run', 'long_run', 'walk_run']),
  zone: z.enum(['Z2', 'Z4']),
  durationMin: z.number().int().min(10).max(240),
  notes: z.string().min(1).max(400),
});

const AiWeeklyDecisionSchema = z.object({
  sessions: z.array(AiSessionSchema).min(1).max(7),
  recommendation: z.string().min(1).max(600),
  rationale: z.array(z.string().min(1).max(300)).min(1).max(8),
  paceAssessment: z.object({
    easyPaceSecondsPerKm: z.number().int().min(150).max(900),
    intensePaceSecondsPerKm: z.number().int().min(120).max(700),
    rationale: z.string().min(1).max(500),
  }),
});

type RunSlot = ReturnType<typeof computeRunSlots>[number];

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
    if (!this.client) return null;

    const runSlots = computeRunSlots(input.availability);
    if (!runSlots.length) return null;

    const painTier = input.painTier ?? (hasSafetyConcern(input.answers) ? 'reduced' : 'normal');
    const safetyAdjustment = painTier !== 'normal';
    const removeRunning = painTier === 'remove_running';
    const novice = isNovice(input.experience, input.answers);
    const client = this.client;

    try {
      const response = await this.aiQueue.run(() =>
        client.messages.parse({
          model: 'claude-opus-4-8',
          max_tokens: 8000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'high',
            format: zodOutputFormat(AiWeeklyDecisionSchema),
          },
          system: this.buildSystemPrompt(safetyAdjustment, removeRunning, novice),
          messages: [{ role: 'user', content: this.buildUserPrompt(input, runSlots, safetyAdjustment, novice, evidence, input.painReason ?? null) }],
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

      return {
        sessions,
        recommendation: parsed.recommendation,
        rationale: parsed.rationale,
        safetyAdjustment,
        targetLowIntensityShare: 0.8,
        paceAssessment: parsed.paceAssessment,
        source: 'ai',
      };
    } catch (error) {
      this.logger.warn(`Falha ao gerar decisao com o agente de IA: ${(error as Error).message}`);
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
    if (sessions.length !== runSlots.length) return null;
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
      if (!slot || usedWeekdays.has(session.weekday)) return null;
      const maxDurationForDay = hasActiveDirectives ? Math.max(slot.durationMin, directiveDurationCeiling) : slot.durationMin;
      if (session.durationMin < 10 || session.durationMin > maxDurationForDay) return null;
      if (safetyAdjustment && (session.sessionType === 'quality_run' || session.zone === 'Z4')) return null;
      if (clearlyCapableOfContinuousRunning && session.sessionType === 'walk_run') return null;

      usedWeekdays.add(session.weekday);
      result.push({
        weekday: session.weekday,
        title: session.title,
        sessionType: session.sessionType,
        zone: session.zone,
        durationMin: session.durationMin,
        notes: session.notes,
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
      '- ATENCAO ESPECIAL A DATAS: diretrizes frequentemente citam datas de calendario especificas (ex: "longao de 16 km em 25/07", "taper de 03/08 a 09/08"), mas voce so pode retornar numeros de weekday (0=domingo...6=sabado), nao datas. Use o campo dataDeCadaDiaDaSemanaSendoGerada (mapa weekday -> data desta semana especifica) e o campo hoje (data de hoje) para descobrir exatamente qual weekday corresponde a cada data mencionada na diretriz, e aplique a instrucao (distancia/duracao/pace) NAQUELE weekday especifico. Se uma data da diretriz nao aparecer em dataDeCadaDiaDaSemanaSendoGerada, ela e de uma semana diferente da que voce esta gerando agora — nesse caso ignore essa parte da diretriz (nao aplique fora da semana certa), mas ainda assim aplique instrucoes de pace/regra geral que nao sejam amarradas a uma data especifica. Nunca ignore uma diretriz so porque voce nao tem certeza da data — raciocine com cuidado antes de descartar.',
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
      'Responda em portugues nos campos de texto (title, notes, recommendation, rationale, paceAssessment.rationale).',
    ].join('\n\n');
  }

  private buildUserPrompt(input: MethodologyInput, runSlots: RunSlot[], safetyAdjustment: boolean, novice: boolean, evidence: PaceEvidence, painReason: string | null) {
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
        hoje: input.todayDate ?? null,
        dataDeCadaDiaDaSemanaSendoGerada: input.weekDates ?? null,
        diasDisponiveisParaCorrida: runSlots,
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
}

function formatSecondsPerKm(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}/km`;
}
