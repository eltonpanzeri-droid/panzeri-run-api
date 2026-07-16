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
    effectivePaceSecondsPerKm: z.number().int().min(150).max(900),
    rationale: z.string().min(1).max(400),
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

      const sessions = this.validateSessions(parsed.sessions, runSlots, safetyAdjustment, novice);
      if (!sessions) {
        this.logger.warn('Decisao do agente de IA rejeitada na validacao (fora dos limites de seguranca/disponibilidade/experiencia).');
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
    novice: boolean,
  ): RunSessionDecision[] | null {
    if (sessions.length !== runSlots.length) return null;
    const slotByWeekday = new Map(runSlots.map((slot) => [slot.weekday, slot]));
    const usedWeekdays = new Set<number>();
    const result: RunSessionDecision[] = [];

    for (const session of sessions) {
      const slot = slotByWeekday.get(session.weekday);
      if (!slot || usedWeekdays.has(session.weekday)) return null;
      if (session.durationMin < 10 || session.durationMin > slot.durationMin) return null;
      if (safetyAdjustment && (session.sessionType === 'quality_run' || session.zone === 'Z4')) return null;
      if (!novice && session.sessionType === 'walk_run') return null;

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
      safetyAdjustment
        ? '- Este aluno tem um sinal de seguranca ativo (dor ou limitacao relatada): NUNCA use sessionType "quality_run" nem zone "Z4" nesta semana. Toda sessao deve ser leve (Z2, easy_run, walk_run ou long_run leve).'
        : '- Sem sinal de seguranca ativo relatado no momento, mas priorize seguranca e progressao conservadora sempre que os dados sugerirem cautela.',
      novice
        ? '- Este aluno FOI CLASSIFICADO COMO INICIANTE com base na experiencia e nas respostas da entrevista: sessionType "walk_run" e apropriado quando fizer sentido.'
        : '- Este aluno NAO e iniciante (ja corre distancias reais e/ou relata condicionamento razoavel a bom): NUNCA use sessionType "walk_run" para ele. Use easy_run, quality_run ou long_run. Isso vale mesmo que a rotina disponivel seja curta ou pouco frequente — pouca disponibilidade nao torna alguem iniciante.',
      'Sobre o pace do aluno — ISSO E O PONTO MAIS IMPORTANTE DESTA TAREFA:',
      'Voce recebe ate tres evidencias separadas de pace no contexto (testeOficial, autoRelatoRecente, mediaStravaRecente), cada uma com sua origem e idade. NAO existe uma regra fixa de qual delas "vale mais" — voce precisa RACIOCINAR sobre qual reflete melhor a capacidade REAL e ATUAL do aluno, da mesma forma que um treinador humano faria. Exemplos de raciocinio esperado:',
      '- Um teste oficial antigo que contradiz um desempenho recente real e mais forte (ex: aluno correu uma distancia longa de verdade num pace bem mais rapido do que o teste sugere) deve pesar MENOS que a evidencia recente e mais forte. Nunca prescreva treinos baseados cegamente no dado mais antigo ou no primeiro dado disponivel so porque "e o teste oficial".',
      '- Uma unica corrida curta recente nao tem o mesmo peso que uma distancia longa e consistente com boa sensacao relatada.',
      '- Quando os dados conflitam, prefira a evidencia mais recente E mais consistente com o volume/objetivo do aluno, e explique isso no rationale do paceAssessment.',
      '- Voce DEVE retornar um campo paceAssessment com sua propria conclusao (effectivePaceSecondsPerKm) e a justificativa (rationale) de por que chegou nesse numero, considerando todas as evidencias.',
      '- O erro mais grave possivel nesta tarefa e prescrever um treino "leve" com pace tao lento que fica igual a uma caminhada para um aluno que claramente corre mais rapido que isso. Isso e burrice, nao inteligencia. Pense de verdade sobre o que os dados dizem sobre esse aluno especifico.',
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
        diasDisponiveisParaCorrida: runSlots,
        historicoSemanal: input.history,
        minutosCorridosStravaRecente: input.stravaRunMinutes,
        maiorCorridaStravaRecenteMin: input.stravaLongestRunMinutes,
        analiseExecucao: input.executionInsight,
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
