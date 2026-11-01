// Medicao do tamanho do que e' enviado e devolvido pela IA (01/11/2026). SO' MEDE: nunca altera prompt, resposta nem decisao.
// Motivo: o custo de uma geracao semanal (~US$ 0,43) tem partes que nunca foram medidas por bloco (prompt fixo, cada campo do
// prompt variavel, texto x raciocinio da resposta). Sem esta medicao qualquer corte seria palpite.
// NUNCA loga conteudo (texto do aluno, respostas): apenas nomes de campos e contagens de caracteres.

/** Estimativa de tokens a partir de caracteres. So' para comparar blocos entre si; o numero real de tokens vem de usage na linha [custo-ia]. */
export const CHARS_PER_TOKEN_ESTIMATE = 3.3;
const tokensOf = (chars: number) => Math.round(chars / CHARS_PER_TOKEN_ESTIMATE);

const sizeOf = (value: unknown): number => (value === undefined ? 0 : (JSON.stringify(value) ?? '').length);

export interface FieldSize { field: string; chars: number }

export function topFieldSizes(value: unknown, limit = 12): FieldSize[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .map(([field, inner]) => ({ field, chars: sizeOf(inner) }))
    .sort((a, b) => b.chars - a.chars)
    .slice(0, limit);
}

const formatFields = (fields: FieldSize[]) => fields.map((f) => `${f.field}=${f.chars}`).join(', ');

/** Prompt enviado: blocos de sistema e, dentro do prompt do usuario (JSON), os maiores campos. */
export function describePromptSize(params: { systemStable: string; systemExtra?: string; userPrompt: string }): string {
  const { systemStable, systemExtra = '', userPrompt } = params;
  let fields: FieldSize[] = [];
  try {
    fields = topFieldSizes(JSON.parse(userPrompt), 14);
  } catch {
    fields = [];
  }
  const total = systemStable.length + systemExtra.length + userPrompt.length;
  return `total_chars=${total} (~${tokensOf(total)} tokens) | sistema_fixo=${systemStable.length} (~${tokensOf(systemStable.length)}) sistema_seguranca=${systemExtra.length} usuario=${userPrompt.length} (~${tokensOf(userPrompt.length)}) | maiores_campos_do_usuario: ${formatFields(fields)}`;
}

interface ContentBlockLike { type: string; text?: string; thinking?: string }

/**
 * Resposta devolvida: texto visivel x raciocinio. O raciocinio pode vir resumido ou omitido pela API; por isso a diferenca entre
 * output_tokens (cobrado) e os tokens estimados do texto visivel e' registrada como "nao_visivel" (inclui raciocinio nao devolvido).
 */
export function describeOutputSize(params: { content: ContentBlockLike[]; outputTokens: number; parsed?: unknown }): string {
  const { content, outputTokens, parsed } = params;
  const textChars = content.filter((b) => b.type === 'text').reduce((sum, b) => sum + (b.text?.length ?? 0), 0);
  const thinkingBlocks = content.filter((b) => b.type === 'thinking');
  const thinkingChars = thinkingBlocks.reduce((sum, b) => sum + (b.thinking?.length ?? 0), 0);
  const visibleTokens = tokensOf(textChars);
  const notVisible = Math.max(0, outputTokens - visibleTokens);
  const fields = topFieldSizes(parsed, 10);
  return `saida: tokens_cobrados=${outputTokens} texto_visivel_chars=${textChars} (~${visibleTokens} tokens) raciocinio_devolvido_chars=${thinkingChars} em ${thinkingBlocks.length} bloco(s) nao_visivel_estimado_tokens=${notVisible} | maiores_campos_da_resposta: ${formatFields(fields)}`;
}
