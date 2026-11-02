import { readFileSync } from 'fs';
import { join } from 'path';

// 02/11/2026 — a indentacao (JSON.stringify(x, null, 2)) custava 18.187 tokens (13,4% da entrada, ~US$ 0,036 por geracao)
// medidos em producao ([contagem-tokens]). O prompt do usuario da IA de prescricao vai compacto; o conteudo e' o mesmo.
describe('PrescriptionAgentService — prompt do usuario compacto', () => {
  const source = readFileSync(join(__dirname, '../src/training-plans/prescription-agent.service.ts'), 'utf8');

  it('nenhum montador de prompt do usuario serializa com indentacao', () => {
    expect(source).not.toMatch(/^\s*null,\s*\n\s*2,?\s*\n\s*\);/m);
  });

  it('compactar nao muda o conteudo: o JSON indentado e o compacto sao identicos depois de lidos', () => {
    const value = { a: { b: [1, null, 'x y'], c: '' }, d: 'linha\ncom quebra' };
    expect(JSON.parse(JSON.stringify(value))).toEqual(JSON.parse(JSON.stringify(value, null, 2)));
  });
});
