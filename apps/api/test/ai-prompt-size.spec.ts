import { byModalityFootprint, describeOutputSize, describePromptSize, measurePromptSize, topFieldSizes } from '../src/common/ai-prompt-size';

// 01/11/2026 — medicao de tamanho do prompt/resposta da IA: so' mede, nunca loga conteudo.
describe('ai-prompt-size', () => {
  it('ordena os campos do prompt do usuario do maior para o menor', () => {
    const fields = topFieldSizes({ pequeno: 'a', grande: 'x'.repeat(500), medio: 'y'.repeat(50) });
    expect(fields.map((f) => f.field)).toEqual(['grande', 'medio', 'pequeno']);
  });

  it('descreve o prompt com blocos de sistema e campos sem vazar conteudo', () => {
    const user = JSON.stringify({ historicoSemanal: 'SEGREDO-DO-ALUNO'.repeat(40), objetivo: 'meia' });
    const text = describePromptSize({ systemStable: 's'.repeat(1000), systemExtra: 'e'.repeat(10), userPrompt: user });
    expect(text).toContain('sistema_fixo=1000');
    expect(text).toContain('sistema_seguranca=10');
    expect(text).toMatch(/historicoSemanal=\d+, objetivo=\d+/);
    expect(text).not.toContain('SEGREDO-DO-ALUNO');
  });

  it('nao quebra com prompt que nao e JSON', () => {
    const text = describePromptSize({ systemStable: 'a', userPrompt: 'texto solto' });
    expect(text).toContain('usuario=11');
    expect(text).not.toContain('usuario_sem_indentacao');
    expect(text).toContain('por_modalidade: chars=0 blocos=0');
  });

  // 02/11/2026: mede quanto a indentacao ocupa e quanto pesa a repeticao por modalidade, para decidir cortes com numero e nao com palpite.
  it('mede o espaco da indentacao: o mesmo prompt escrito sem formatacao', () => {
    const value = { a: { b: { c: 1, d: [1, 2] } }, e: 'x' };
    const indented = JSON.stringify(value, null, 2);
    const compact = JSON.stringify(value);
    const m = measurePromptSize({ systemStable: 's', userPrompt: indented });
    expect(m.userChars).toBe(indented.length);
    expect(m.userCompactChars).toBe(compact.length);
    expect(m.userChars - (m.userCompactChars as number)).toBeGreaterThan(0);
    expect(describePromptSize({ systemStable: 's', userPrompt: indented })).toContain(`usuario_sem_indentacao=${compact.length} espacos_e_quebras_de_linha=${indented.length - compact.length}`);
  });

  it('soma todos os blocos byModality em qualquer profundidade, sem contar o conteudo duas vezes', () => {
    const block = { corrida: { n: 1 }, forca: { n: 2 } };
    const value = { athleteStateContext: { variables: { x: { byModality: block }, y: { byModality: block }, z: { current: 1 } } }, outro: [{ byModality: block }] };
    const m = measurePromptSize({ systemStable: 's', userPrompt: JSON.stringify(value) });
    expect(m.byModalityBlocks).toBe(3);
    expect(m.byModalityChars).toBe(JSON.stringify(block).length * 3);
  });

  it('prompt sem byModality devolve zero', () => {
    expect(byModalityFootprint({ a: { b: 1 } })).toEqual({ chars: 0, blocks: 0 });
    expect(byModalityFootprint(null)).toEqual({ chars: 0, blocks: 0 });
  });

  it('separa texto visivel do restante cobrado na saida', () => {
    const text = describeOutputSize({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'x'.repeat(3300) }],
      outputTokens: 5000,
      parsed: { sessions: [1, 2, 3], recommendation: 'oi' },
    });
    expect(text).toContain('tokens_cobrados=5000');
    expect(text).toContain('texto_visivel_chars=3300');
    expect(text).toContain('nao_visivel_estimado_tokens=4000');
    expect(text).toContain('em 1 bloco(s)');
    expect(text).toMatch(/sessions=\d+/);
  });

  it('saida sem parsed e sem blocos devolve zeros sem erro', () => {
    expect(describeOutputSize({ content: [], outputTokens: 0 })).toContain('tokens_cobrados=0');
  });
});
