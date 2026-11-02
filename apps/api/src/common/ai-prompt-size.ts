// Medicao do tamanho do que e' enviado e devolvido pela IA (01/11/2026). SO' MEDE: nunca altera prompt, resposta nem decisao.
// Motivo: o custo de uma geracao semanal (~US$ 0,43) tem partes que nunca foram medidas por bloco (prompt fixo, cada campo do
// prompt variavel, texto x raciocinio da resposta). Sem esta medicao qualquer corte seria palpite.
// NUNCA contem conteudo (texto do aluno, respostas): apenas nomes de campos e contagens de caracteres.

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

/** Soma o tamanho de todos os campos `byModality` (blocos por modalidade) em qualquer profundidade do prompt. Mede a repeticao por modalidade do contexto do atleta. */
export function byModalityFootprint(value: unknown): { chars: number; blocks: number } {
  let chars = 0;
  let blocks = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [key, inner] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'byModality' && inner && typeof inner === 'object') { chars += sizeOf(inner); blocks += 1; } else walk(inner);
    }
  };
  walk(value);
  return { chars, blocks };
}

export interface PromptSizeMeasure {
  totalChars: number;
  totalTokensEstimate: number;
  systemFixedChars: number;
  systemSafetyChars: number;
  userChars: number;
  userTokensEstimate: number;
  userFields: FieldSize[];
  /** Tamanho do mesmo prompt do usuario escrito sem indentacao (so' para medir quanto a formatacao ocupa). null se o prompt nao for JSON. */
  userCompactChars: number | null;
  byModalityChars: number;
  byModalityBlocks: number;
}

export interface OutputSizeMeasure {
  billedTokens: number;
  visibleTextChars: number;
  visibleTokensEstimate: number;
  thinkingReturnedChars: number;
  thinkingBlocks: number;
  /** Tokens cobrados que NAO aparecem como texto visivel (raciocinio nao devolvido pela API + estrutura). Estimativa. */
  notVisibleTokensEstimate: number;
  responseFields: FieldSize[];
}

/** Prompt enviado: blocos de sistema e, dentro do prompt do usuario (JSON), os maiores campos. */
export function measurePromptSize(params: { systemStable: string; systemExtra?: string; userPrompt: string }): PromptSizeMeasure {
  const { systemStable, systemExtra = '', userPrompt } = params;
  let userFields: FieldSize[] = [];
  let userCompactChars: number | null = null;
  let modality = { chars: 0, blocks: 0 };
  try {
    const parsed = JSON.parse(userPrompt);
    userFields = topFieldSizes(parsed, 14);
    userCompactChars = JSON.stringify(parsed).length;
    modality = byModalityFootprint(parsed);
  } catch {
    userFields = [];
  }
  const totalChars = systemStable.length + systemExtra.length + userPrompt.length;
  return {
    totalChars,
    totalTokensEstimate: tokensOf(totalChars),
    systemFixedChars: systemStable.length,
    systemSafetyChars: systemExtra.length,
    userChars: userPrompt.length,
    userTokensEstimate: tokensOf(userPrompt.length),
    userFields,
    userCompactChars,
    byModalityChars: modality.chars,
    byModalityBlocks: modality.blocks,
  };
}

interface ContentBlockLike { type: string; text?: string; thinking?: string }

/**
 * Resposta devolvida: texto visivel x raciocinio. O raciocinio pode vir resumido ou omitido pela API; por isso a diferenca entre
 * output_tokens (cobrado) e os tokens estimados do texto visivel e' registrada como "nao_visivel" (inclui raciocinio nao devolvido).
 */
export function measureOutputSize(params: { content: ContentBlockLike[]; outputTokens: number; parsed?: unknown }): OutputSizeMeasure {
  const { content, outputTokens, parsed } = params;
  const textChars = content.filter((b) => b.type === 'text').reduce((sum, b) => sum + (b.text?.length ?? 0), 0);
  const thinkingBlocks = content.filter((b) => b.type === 'thinking');
  const thinkingChars = thinkingBlocks.reduce((sum, b) => sum + (b.thinking?.length ?? 0), 0);
  const visibleTokens = tokensOf(textChars);
  return {
    billedTokens: outputTokens,
    visibleTextChars: textChars,
    visibleTokensEstimate: visibleTokens,
    thinkingReturnedChars: thinkingChars,
    thinkingBlocks: thinkingBlocks.length,
    notVisibleTokensEstimate: Math.max(0, outputTokens - visibleTokens),
    responseFields: topFieldSizes(parsed, 10),
  };
}

export function describePromptSize(params: { systemStable: string; systemExtra?: string; userPrompt: string }): string {
  const m = measurePromptSize(params);
  const formatting = m.userCompactChars === null ? '' : ` | formatacao: usuario_sem_indentacao=${m.userCompactChars} espacos_e_quebras_de_linha=${m.userChars - m.userCompactChars}`;
  return `total_chars=${m.totalChars} (~${m.totalTokensEstimate} tokens) | sistema_fixo=${m.systemFixedChars} (~${tokensOf(m.systemFixedChars)}) sistema_seguranca=${m.systemSafetyChars} usuario=${m.userChars} (~${m.userTokensEstimate}) | maiores_campos_do_usuario: ${formatFields(m.userFields)}${formatting} | por_modalidade: chars=${m.byModalityChars} blocos=${m.byModalityBlocks}`;
}

export function describeOutputSize(params: { content: ContentBlockLike[]; outputTokens: number; parsed?: unknown }): string {
  const m = measureOutputSize(params);
  return `saida: tokens_cobrados=${m.billedTokens} texto_visivel_chars=${m.visibleTextChars} (~${m.visibleTokensEstimate} tokens) raciocinio_devolvido_chars=${m.thinkingReturnedChars} em ${m.thinkingBlocks} bloco(s) nao_visivel_estimado_tokens=${m.notVisibleTokensEstimate} | maiores_campos_da_resposta: ${formatFields(m.responseFields)}`;
}
