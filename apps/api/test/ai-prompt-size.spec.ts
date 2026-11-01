import { describeOutputSize, describePromptSize, topFieldSizes } from '../src/common/ai-prompt-size';

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
    expect(describePromptSize({ systemStable: 'a', userPrompt: 'texto solto' })).toContain('usuario=11');
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
