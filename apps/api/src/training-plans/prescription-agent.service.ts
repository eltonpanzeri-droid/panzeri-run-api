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
  numericAnswer,
} from './training-methodology';
import { PANZERI_METHODOLOGY_KNOWLEDGE } from './panzeri-methodology-knowledge';

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

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async proposeWeeklyDecision(input: MethodologyInput, evidence: PaceEvidence): Promise<(WeeklyMethodologyDecision & { source: 'ai' }) | null> {
    if (!this.client) return null;

    const runSlots = computeRunSlots(input.availability);
    if (!runSlots.length) return null;

    const safetyAdjustment = hasSafetyConcern(input.answers);
    const novice = isNovice(input.experience, input.answers);

    try {
      const response = await this.client.messages.parse({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
          format: zodOutputFormat(AiWeeklyDecisionSchema),
        },
        system: this.buildSystemPrompt(safetyAdjustment, novice),
        messages: [{ role: 'user', content: this.buildUserPrompt(input, runSlots, safetyAdjustment, novice, evidence) }],
      });

      const parsed = response.parsed_output;
      if (!parsed) return null;

      if (parsed.paceAssessment.intensePaceSecondsPerKm >= parsed.paceAssessment.easyPaceSecondsPerKm) {
        this.logger.warn('Decisao do agente de IA rejeitada: pace intenso nao e mais rapido que o pace facil.');
        return null;
      }

      const sessions = this.validateSessions(parsed.sessions, runSlots, safetyAdjustment, parsed.paceAssessment.easyPaceSecondsPerKm);
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
  ): RunSessionDecision[] | null {
    if (sessions.length !== runSlots.length) return null;
    const slotByWeekday = new Map(runSlots.map((slot) => [slot.weekday, slot]));
    const usedWeekdays = new Set<number>();
    const result: RunSessionDecision[] = [];
    // Se o proprio pace facil que o agente concluiu ja e nitidamente rapido (aluno claramente
    // corre bem), walk_run nao faz sentido — mas a decisao vem do pace real, nao de um rotulo
    // de "iniciante" na entrevista.
    const clearlyCapableOfContinuousRunning = easyPaceSecondsPerKm < 420;

    for (const session of sessions) {
      const slot = slotByWeekday.get(session.weekday);
      if (!slot || usedWeekdays.has(session.weekday)) return null;
      if (session.durationMin < 10 || session.durationMin > slot.durationMin) return null;
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

  private buildSystemPrompt(safetyAdjustment: boolean, novice: boolean) {
    return [
      'Voce e o agente de prescricao de treinos de corrida da Panzeri Run.',
      'Sua unica funcao e decidir a estrutura da semana de treinos de corrida de UM aluno, aplicando o julgamento real do treinador Elton Panzeri descrito abaixo — nunca conhecimento generico de blogs ou regras fixas de treinamento de corrida.',
      PANZERI_METHODOLOGY_KNOWLEDGE,
      'Regras obrigatorias, nao negociaveis (sobrepoe qualquer outra decisao):',
      '- Retorne exatamente uma sessao de corrida para cada dia disponivel informado, usando o mesmo numero de weekday (0=domingo...6=sabado).',
      '- durationMin de cada sessao nunca pode exceder o tempo disponivel informado para aquele dia.',
      '- Se o aluno relatou uma media semanal de quilometragem atual (mediaSemanalKmAtualRelatada) e/ou volume real recente no Strava, a soma aproximada da distancia de todas as sessoes da semana que voce prescrever NUNCA deve ficar muito abaixo desse volume que ele ja sustenta na pratica, a nao ser que haja um motivo real de seguranca, deload ou retorno de pausa. O erro classico a evitar: um aluno que corre 19 km por semana recebendo uma sessao "leve" de 4 km (dos quais 1,1 km e so aquecimento/desaquecimento) — isso e um treino curto e ruim demais para a capacidade real dele, e deve ser tratado como falha grave.',
      safetyAdjustment
        ? '- Este aluno tem um sinal de seguranca ativo (dor ou limitacao relatada): NUNCA use sessionType "quality_run" nem zone "Z4" nesta semana. Toda sessao deve ser leve (Z2, easy_run, walk_run ou long_run leve).'
        : '- Sem sinal de seguranca ativo relatado no momento, mas priorize seguranca e progressao conservadora sempre que os dados sugerirem cautela.',
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

  private buildUserPrompt(input: MethodologyInput, runSlots: RunSlot[], safetyAdjustment: boolean, novice: boolean, evidence: PaceEvidence) {
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
        mediaSemanalKmAtualRelatada: numericAnswer(input.answers.weekly_running_km),
        diasDisponiveisParaCorrida: runSlots,
        historicoSemanal: input.history,
        minutosCorridosStravaRecente: input.stravaRunMinutes,
        maiorCorridaStravaRecenteMin: input.stravaLongestRunMinutes,
        analiseExecucao: input.executionInsight,
        analiseAprofundadaStrava: input.stravaAnalysis ?? null,
        sinalDeSeguranca: safetyAdjustment,
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
