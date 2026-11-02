// Comparacao de TOKENS reais (02/11/2026). SO' MEDE, em segundo plano, pela contagem oficial da Anthropic (`messages.countTokens`, gratuita e sem gerar texto): quanto o prompt
// do Treinador da semana pesaria (a) escrito sem indentacao e (b) sem os blocos `byModality`. Nunca altera o prompt enviado, a resposta nem a geracao.
// Motivo: espacos repetidos costumam virar poucos tokens, entao a economia em CARACTERES (ai-prompt-size.ts) nao diz a economia em TOKENS.
// NUNCA contem conteudo (texto do aluno): so' numeros.
import { AI_MODELS, AI_RATES_USD_PER_MTOK } from './ai-models.config';

/** Quantas comparacoes por processo (reinicio zera). 0 desliga. Ajustavel por AI_TOKEN_COMPARE_MAX. Cada comparacao reenvia o prompt 2 vezes (mesmos dados ja elegiveis para a IA). */
export const DEFAULT_TOKEN_COMPARE_MAX = 3;

export function tokenCompareLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TOKEN_COMPARE_MAX;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 20 ? value : DEFAULT_TOKEN_COMPARE_MAX;
}

function stripKey(node: unknown, key: string): unknown {
  if (Array.isArray(node)) return node.map((item) => stripKey(item, key));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).filter(([k]) => k !== key).map(([k, v]) => [k, stripKey(v, key)]));
  }
  return node;
}

/** Mesmo prompt do usuario, sem indentacao. null se nao for JSON. */
export function compactUserPrompt(userPrompt: string): string | null {
  try { return JSON.stringify(JSON.parse(userPrompt)); } catch { return null; }
}

/** Mesmo prompt, sem indentacao e sem nenhum bloco `byModality` (so' para medir o peso desses blocos). null se nao for JSON. */
export function compactUserPromptWithoutByModality(userPrompt: string): string | null {
  try { return JSON.stringify(stripKey(JSON.parse(userPrompt), 'byModality')); } catch { return null; }
}

export interface TokenComparison {
  /** Tokens de entrada reais da geracao (entrada + gravacao + leitura de cache); so' referencia. */
  realInputTotal: number;
  /** Contagem oficial do prompt EXATAMENTE como enviado (com indentacao). Base da comparacao: as tres contagens usam o mesmo metodo, sem diferenca de formato de resposta. */
  indentedTotal: number;
  /** Contagem oficial do mesmo prompt sem indentacao (sistema identico). */
  compactTotal: number;
  /** Contagem oficial sem indentacao e sem `byModality`. */
  compactWithoutByModalityTotal: number;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const usd = (tokens: number) => Math.round(((tokens * AI_RATES_USD_PER_MTOK[AI_MODELS.SONNET_5].standard.input) / 1_000_000) * 10_000) / 10_000;

export function describeTokenComparison(c: TokenComparison): string {
  const indentSaved = c.indentedTotal - c.compactTotal;
  const modalitySaved = c.compactTotal - c.compactWithoutByModalityTotal;
  return `entrada_real_cobrada=${c.realInputTotal} | contagem_oficial: como_enviado=${c.indentedTotal} sem_indentacao=${c.compactTotal} sem_indentacao_e_sem_por_modalidade=${c.compactWithoutByModalityTotal} | indentacao: ${indentSaved} tokens = ${pct(indentSaved, c.indentedTotal)}% da entrada (~US$ ${usd(indentSaved)} por geracao) | blocos por modalidade: ${modalitySaved} tokens = ${pct(modalitySaved, c.compactTotal)}% do prompt compacto (~US$ ${usd(modalitySaved)} por geracao; uma compressao economizaria so' parte disso)`;
}
