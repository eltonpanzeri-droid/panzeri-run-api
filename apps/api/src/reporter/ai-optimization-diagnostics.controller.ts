import { Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { StudentReporterAgentService, RelatorAgentInput, RelatorOutputSchema } from './student-reporter-agent.service';
import { AI_MODELS } from '../common/ai-models.config';

// ENDPOINT TEMPORARIO DE DIAGNOSTICO (28/09/2026) — tarefa de otimizacao de custo/caching. Existe
// so pra validar com METRICAS REAIS da Anthropic (nunca simuladas): (1) se a troca Haiku x Sonnet
// no Agente Relator preserva qualidade em casos representativos, e (2) se prompt caching de fato
// gera cache_creation/cache_read reais nos dois modelos. Nao usa dado real de nenhum aluno — so
// textos sinteticos. REMOVER apos a validacao (ver relatorio da tarefa) — nao e' feature
// permanente do produto.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/diagnostics')
export class AiOptimizationDiagnosticsController {
  private readonly logger = new Logger(AiOptimizationDiagnosticsController.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly relatorAgent: StudentReporterAgentService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  @Post('relator-haiku-vs-sonnet')
  async relatorHaikuVsSonnet() {
    if (!this.client) return { error: 'ANTHROPIC_API_KEY nao configurada.' };
    const client = this.client;

    // Amostra representativa (sintetica, nenhum dado real de aluno): ambigua, emocionalmente
    // complexa, recorrente, relacionada a dor.
    const cases: Array<{ label: string; input: RelatorAgentInput }> = [
      {
        label: 'ambiguo',
        input: {
          studentName: 'Aluna Teste', sourceType: 'workout_feedback_notes', promptQuestion: null,
          relatedLabel: 'Treino de teste', occurredAt: new Date().toISOString(),
          originalText: 'Hoje foi estranho. Nao sei explicar direito, so nao rendeu como eu esperava.',
          priorEntries: [],
        },
      },
      {
        label: 'emocionalmente_complexo',
        input: {
          studentName: 'Aluna Teste', sourceType: 'student_observation', promptQuestion: 'Escreva aqui o que quer avisar...',
          relatedLabel: 'Observacao', occurredAt: new Date().toISOString(),
          originalText: 'Estou pensando em desistir. Nao sinto que estou evoluindo e isso ta mexendo com minha cabeca, mas ao mesmo tempo nao quero jogar fora tudo que ja construi.',
          priorEntries: [],
        },
      },
      {
        label: 'recorrente',
        input: {
          studentName: 'Aluna Teste', sourceType: 'workout_missed_comment', promptQuestion: 'Conte com suas palavras',
          relatedLabel: 'Treino nao realizado', occurredAt: new Date().toISOString(),
          originalText: 'De novo nao consegui treinar de manha, o trabalho ta tomando o horario que eu tinha reservado.',
          priorEntries: [
            { occurredAt: new Date(Date.now() - 7 * 86400000).toISOString(), sourceType: 'workout_missed_comment', originalText: 'Nao consegui treinar de manha essa semana tambem, correria no trabalho.', themes: ['ROTINA', 'TRABALHO'], relevance: 'ACOMPANHAR' },
            { occurredAt: new Date(Date.now() - 14 * 86400000).toISOString(), sourceType: 'workout_missed_comment', originalText: 'Perdi o treino de novo por causa do trabalho.', themes: ['ROTINA', 'TRABALHO'], relevance: 'PONTUAL' },
          ],
        },
      },
      {
        label: 'dor',
        input: {
          studentName: 'Aluna Teste', sourceType: 'pain_report', promptQuestion: 'Comentario (opcional)',
          relatedLabel: 'Relato de dor', occurredAt: new Date().toISOString(),
          originalText: 'A dor no joelho ja tinha sumido semana passada, mas voltou hoje um pouco depois do treino, bem mais leve que da outra vez.',
          priorEntries: [],
        },
      },
    ];

    const results = [];
    for (const testCase of cases) {
      const haiku = await this.relatorAgent.analyze(testCase.input);
      const sonnetResponse = await client.messages.parse({
        model: AI_MODELS.SONNET_5,
        max_tokens: 2000,
        thinking: { type: 'disabled' },
        output_config: {
          effort: 'low',
          format: zodOutputFormat(RelatorOutputSchema),
        },
        system: [{ type: 'text', text: this.relatorAgent.buildSystemPrompt() }],
        messages: [{ role: 'user', content: JSON.stringify(testCase.input, null, 2) }],
      }).catch((error) => {
        this.logger.warn(`Falha na chamada Sonnet de comparacao (${testCase.label}): ${(error as Error).message}`);
        return null;
      });
      results.push({
        case: testCase.label,
        haiku,
        sonnet: sonnetResponse?.parsed_output ?? null,
        sonnetUsage: sonnetResponse?.usage ?? null,
      });
    }
    return { results };
  }

  // Validacao de mecanica de cache com METRICAS REAIS (nunca simuladas): manda o MESMO prefixo
  // estavel duas vezes seguidas, uma vez por modelo, usando o proprio prompt do Relator (~1600
  // tokens) — real o bastante pra passar o minimo de cache do Sonnet 5 (512 tokens) mas abaixo do
  // minimo do Haiku 4.5 (4096 tokens). Espera-se: Sonnet cria cache na 1a chamada e le da 2a;
  // Haiku nunca cria cache nas duas (numeros ficam em 0), confirmando a limitacao documentada.
  @Post('cache-check')
  async cacheCheck() {
    if (!this.client) return { error: 'ANTHROPIC_API_KEY nao configurada.' };
    const client = this.client;
    const systemText = this.relatorAgent.buildSystemPrompt();
    const userMessage = { role: 'user' as const, content: 'Teste de cache — ignore e responda apenas com um objeto JSON minimo valido para o schema.' };

    async function callTwice(model: string) {
      const first = await client.messages.parse({
        model, max_tokens: 500, thinking: { type: 'disabled' },
        output_config: { format: zodOutputFormat(RelatorOutputSchema) },
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: JSON.stringify({ ...userMessage, marker: 'call-1' }) }],
      }).catch((error) => ({ error: (error as Error).message }));
      const second = await client.messages.parse({
        model, max_tokens: 500, thinking: { type: 'disabled' },
        output_config: { format: zodOutputFormat(RelatorOutputSchema) },
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: JSON.stringify({ ...userMessage, marker: 'call-2' }) }],
      }).catch((error) => ({ error: (error as Error).message }));
      return {
        firstUsage: 'usage' in first ? first.usage : first,
        secondUsage: 'usage' in second ? second.usage : second,
      };
    }

    const sonnet = await callTwice(AI_MODELS.SONNET_5);
    const haiku = await callTwice(AI_MODELS.HAIKU_4_5);
    return { promptEstimatedTokens: Math.round(systemText.length / 3.7), sonnet, haiku };
  }
}
