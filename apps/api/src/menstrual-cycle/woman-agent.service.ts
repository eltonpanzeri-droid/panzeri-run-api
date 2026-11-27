import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AiQueueService } from '../common/ai-queue.service';
import { AI_MODELS, cacheControlFor, cacheTtlLabel } from '../common/ai-models.config';
import { logAiUsage } from '../common/ai-usage-logger';
import { isCycleAiConsentCurrent } from './menstrual-ai-consent';
import { cycleSymptomLabel, normalizeSymptoms } from './cycle-symptoms';
import type { PhaseReportPayload } from './menstrual-report.service';

// AGENTE DA MULHER (19/11/2026, ordem de Elton). A coleta e os numeros sao do CODIGO (menstrual-report.service.ts); este agente so' escreve, uma vez por mes e a pedido da aluna, o texto que resume a trajetoria dela no
// ciclo e mantem um historico resumido. Regra dos 6 mil caracteres do prontuario: teto duro de 6000; meta menor; acima de 5000 ha' uma segunda passada so' de reducao. So' roda com o aceite do ciclo para a IA vigente.
// Nunca diagnostica, nunca indica causa, nunca recomenda tratamento nem mudanca de treino. Falha dele nunca derruba o relatorio.
export const WOMAN_HISTORY_MAX_CHARS = 6000;
export const WOMAN_HISTORY_TARGET_CHARS = 4000;
export const WOMAN_HISTORY_SHRINK_ABOVE_CHARS = 5000;
const NOTES_FOR_AGENT = 10;
const NOTE_MAX_CHARS = 200;

const WomanOutputSchema = z.object({
  narrative: z.string().min(1).max(2500),
  history: z.string().min(1).max(WOMAN_HISTORY_MAX_CHARS),
});
const ShrinkSchema = z.object({ history: z.string().min(1).max(WOMAN_HISTORY_MAX_CHARS) });

export interface WomanAgentOutcome { narrative: string; history: string }

// Versao compacta do relatorio para o agente (sem listas enormes): so' medias por fase e quantidade de registros.
export function compactReportForAgent(payload: PhaseReportPayload) {
  const metric = (m: PhaseReportPayload['highlights'][number]) => ({ indicador: m.label, unidade: m.unit.trim() || null, porFase: Object.fromEntries(Object.entries(m.perPhase).filter(([, stat]) => stat.n > 0).map(([phase, stat]) => [phase, { media: stat.mean, registros: stat.n }])) });
  return {
    periodo: payload.window, ciclosRegistrados: payload.cyclesCount, limitacoes: payload.limitations,
    fases: payload.phases.map((phase) => ({ fase: phase.label, diasObservados: phase.daysObserved, treinosFeitos: phase.workouts.done, treinosNaoFeitos: phase.workouts.missed, aderenciaPct: phase.workouts.adherencePct, km: phase.workouts.km, treinosComDor: phase.pain.workoutsWithPain, notaMediaDorNosTreinosDe1a10: phase.pain.meanLevel, relatosAvulsosDeDor: phase.pain.standaloneReports, intensidadeMediaRelatosAvulsos: phase.pain.standaloneMeanIntensity })),
    indicadoresEmDestaque: payload.highlights.map(metric),
    outrosIndicadores: payload.otherIndicators.slice(0, 25).map(metric),
    quadroGeralPorRegra: payload.quadroGeral,
  };
}

@Injectable()
export class WomanAgentService {
  private readonly logger = new Logger(WomanAgentService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService, private readonly aiQueue: AiQueueService, private readonly prisma: PrismaService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  // `aiPayload` JA' foi montado dentro do escopo de IA da aluna (dados de provedores nao autorizados ficam de fora). null = sem texto (o relatorio segue so' com os numeros).
  async narrate(userId: string, aiPayload: PhaseReportPayload, monthKey: string): Promise<WomanAgentOutcome | null> {
    if (!this.client) return null;
    const consent = await this.prisma.menstrualAiConsent.findUnique({ where: { userId } });
    if (!isCycleAiConsentCurrent(consent)) return null; // sem aceite vigente nada vai a IA
    const [history, notes] = await Promise.all([
      this.prisma.menstrualHistorySummary.findUnique({ where: { userId } }),
      this.prisma.menstrualDailyLog.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 40, select: { date: true, notes: true, symptoms: true } }),
    ]);
    const recentNotes = notes.filter((log) => log.notes && log.notes.trim()).slice(0, NOTES_FOR_AGENT).map((log) => ({ data: log.date.toISOString().slice(0, 10), relato: log.notes!.trim().slice(0, NOTE_MAX_CHARS) }));
    const symptomCounts = new Map<string, number>();
    for (const log of notes) for (const id of normalizeSymptoms(log.symptoms)) symptomCounts.set(id, (symptomCounts.get(id) ?? 0) + 1);
    const input = {
      mes: monthKey,
      historicoResumidoAtual: history?.summary ?? '',
      relatorioDoMes: compactReportForAgent(aiPayload),
      sintomasMaisMarcados: [...symptomCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, dias]) => ({ sintoma: cycleSymptomLabel(id), dias })),
      relatosLivresRecentes: recentNotes,
    };
    const result = await this.request(input);
    if (!result) return null;
    let historyText = result.history;
    if (historyText.length > WOMAN_HISTORY_SHRINK_ABOVE_CHARS) {
      // Historico acima de 5 mil caracteres: segunda passada so' de reducao (nada novo entra). Falha ou resultado nao menor: fica o primeiro (o teto duro corta o final).
      this.logger.warn(`Agente da Mulher: historico com ${historyText.length} caracteres (meta ${WOMAN_HISTORY_TARGET_CHARS}); pedindo reducao`);
      const shorter = await this.shrink(historyText);
      if (shorter && shorter.length < historyText.length) historyText = shorter;
    }
    historyText = historyText.slice(0, WOMAN_HISTORY_MAX_CHARS);
    await this.prisma.menstrualHistorySummary.upsert({ where: { userId }, create: { userId, summary: historyText, chars: historyText.length }, update: { summary: historyText, chars: historyText.length } });
    return { narrative: result.narrative, history: historyText };
  }

  private async request(input: unknown): Promise<z.infer<typeof WomanOutputSchema> | null> {
    if (!this.client) return null;
    const client = this.client;
    const startedAt = Date.now();
    try {
      const response = await this.aiQueue.run(() => client.messages.parse({
        model: AI_MODELS.HAIKU_5_5,
        max_tokens: 6000,
        thinking: { type: 'disabled' },
        output_config: { effort: 'medium', format: zodOutputFormat(WomanOutputSchema) },
        system: [{ type: 'text', text: this.systemPrompt(), ...cacheControlFor('mulher') }],
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      }), { agent: 'mulher', deviceData: true });
      logAiUsage(this.logger, { agent: 'mulher', model: AI_MODELS.HAIKU_5_5, usage: response.usage, durationMs: Date.now() - startedAt, ttl: cacheTtlLabel('mulher') });
      return response.parsed_output ?? null;
    } catch (error) {
      this.logger.warn(`Agente da Mulher: falha ao gerar o texto (${error instanceof Error ? error.message.slice(0, 120) : 'erro'})`);
      return null;
    }
  }

  private async shrink(history: string): Promise<string | null> {
    if (!this.client) return null;
    const client = this.client;
    try {
      const response = await this.aiQueue.run(() => client.messages.parse({
        model: AI_MODELS.HAIKU_5_5,
        max_tokens: 4000,
        thinking: { type: 'disabled' },
        output_config: { effort: 'medium', format: zodOutputFormat(ShrinkSchema) },
        system: [{ type: 'text', text: `Voce reduz um historico resumido de acompanhamento do ciclo menstrual de uma aluna de corrida. Devolva o MESMO historico, mais curto: no maximo ${WOMAN_HISTORY_TARGET_CHARS} caracteres, mantendo os padroes mais persistentes e os fatos relevantes e cortando primeiro o que e' antigo, repetido ou de pouco peso. Nao acrescente nada novo, nao diagnostique, nao indique causa.` }],
        messages: [{ role: 'user', content: history }],
      }), { agent: 'mulher_reducao', deviceData: true });
      return response.parsed_output?.history ?? null;
    } catch (error) {
      this.logger.warn(`Agente da Mulher: falha ao reduzir o historico (${error instanceof Error ? error.message.slice(0, 120) : 'erro'})`);
      return null;
    }
  }

  private systemPrompt(): string {
    return [
      'Voce e o Agente da Mulher do Panzeri Run. Uma vez por mes, a pedido da aluna, voce escreve para ELA um resumo da trajetoria dela no ciclo menstrual e atualiza um historico resumido.',
      'Os numeros ja foram calculados pelo sistema (relatorioDoMes). Voce NAO calcula nem corrige numeros: so conta, em portugues claro e acolhedor, o que eles mostram.',
      'REGRAS: (1) fale com a aluna em segunda pessoa ("voce"); (2) descreva o que ela registrou em cada fase (menstrual, folicular, ovulatoria, lutea): esforco percebido, treinos e aderencia, km, dor, ritmo, sono e demais indicadores, destacando o que mudou entre as fases quando houver registros suficientes; (3) NUNCA diagnostique, nunca diga que algo e normal ou anormal, nunca indique causa ("por causa do ciclo"): fale em "no que voce registrou"; (4) NUNCA recomende tratamento, medicamento nem mudanca de treino; se algo merecer atencao medica, diga apenas que vale conversar com um profissional de saude; (5) diga as limitacoes (fases estimadas, ciclo sem duracao conhecida, anticoncepcional hormonal, poucos registros) sem alarme; (6) fase sem registros suficientes: diga que ainda nao ha dados, nunca invente; (7) relatos livres da aluna sao dela: cite-os com respeito, sem interpretar clinicamente; (8) diga "Panzeri Run" (nunca "app") e "programa de treino" (nunca "plano de treino"); nunca descreva o sistema como "motor".',
      `HISTORICO: devolva em "history" o historico resumido ATUALIZADO (historicoResumidoAtual + o mes novo), nunca do zero, em ate ${WOMAN_HISTORY_TARGET_CHARS} caracteres (teto duro ${WOMAN_HISTORY_MAX_CHARS}): padroes que se repetem entre os ciclos, fatos relevantes e o que mudou. Cada mes pesa um pouco menos que o anterior: o antigo vai ficando mais curto.`,
      'NARRATIVA: em "narrative", ate 2500 caracteres, em paragrafos curtos: visao geral do mes, uma parte curta por fase com registros, e fechamento com as limitacoes.',
    ].join('\n\n');
  }
}
