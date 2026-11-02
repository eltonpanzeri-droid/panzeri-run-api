import { compactUserPrompt, compactUserPromptWithoutByModality, DEFAULT_TOKEN_COMPARE_MAX, describeTokenComparison, tokenCompareLimit } from '../src/common/ai-token-compare';

// 02/11/2026 — comparacao de tokens reais (so' mede; nunca altera o prompt enviado).
describe('ai-token-compare', () => {
  const value = { objetivo: 'meia', athleteStateContext: { variables: { carga: { current: 3, byModality: { corrida: { n: 1 }, forca: { n: 2 } } } }, outro: [{ byModality: { x: 1 }, mantido: true }] } };
  const indented = JSON.stringify(value, null, 2);

  it('sem indentacao: mesmo conteudo, menos caracteres', () => {
    const compact = compactUserPrompt(indented);
    expect(compact).toBe(JSON.stringify(value));
    expect(compact!.length).toBeLessThan(indented.length);
    expect(JSON.parse(compact!)).toEqual(value);
  });

  it('sem byModality: remove o campo em qualquer profundidade e preserva todo o resto', () => {
    const slim = JSON.parse(compactUserPromptWithoutByModality(indented)!);
    expect(JSON.stringify(slim)).not.toContain('byModality');
    expect(slim.objetivo).toBe('meia');
    expect(slim.athleteStateContext.variables.carga.current).toBe(3);
    expect(slim.athleteStateContext.outro).toEqual([{ mantido: true }]);
  });

  it('nao altera o objeto original nem o texto de entrada', () => {
    const before = indented;
    compactUserPromptWithoutByModality(indented);
    expect(indented).toBe(before);
    expect(JSON.stringify(value)).toContain('byModality');
  });

  it('prompt que nao e JSON devolve null (nada e medido, nada quebra)', () => {
    expect(compactUserPrompt('texto solto')).toBeNull();
    expect(compactUserPromptWithoutByModality('texto solto')).toBeNull();
  });

  it('limite por processo: padrao 3, 0 desliga, valor invalido volta ao padrao', () => {
    expect(tokenCompareLimit(undefined)).toBe(DEFAULT_TOKEN_COMPARE_MAX);
    expect(tokenCompareLimit('')).toBe(DEFAULT_TOKEN_COMPARE_MAX);
    expect(tokenCompareLimit('0')).toBe(0);
    expect(tokenCompareLimit('5')).toBe(5);
    expect(tokenCompareLimit('abc')).toBe(DEFAULT_TOKEN_COMPARE_MAX);
    expect(tokenCompareLimit('-1')).toBe(DEFAULT_TOKEN_COMPARE_MAX);
    expect(tokenCompareLimit('999')).toBe(DEFAULT_TOKEN_COMPARE_MAX);
  });

  it('descreve economias em tokens, percentual e dolar sem conteudo de aluno', () => {
    const text = describeTokenComparison({ realInputTotal: 186_081, indentedTotal: 180_000, compactTotal: 150_000, compactWithoutByModalityTotal: 120_000 });
    expect(text).toContain('indentacao: 30000 tokens = 16.7% da entrada (~US$ 0.06 por geracao)');
    expect(text).toContain('blocos por modalidade: 30000 tokens = 20% do prompt compacto (~US$ 0.06 por geracao');
    expect(text).toContain('entrada_real_cobrada=186081');
  });
});
