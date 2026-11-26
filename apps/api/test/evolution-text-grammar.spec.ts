import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 26/11/2026 — a Evolucao dizia "A recente esta praticamente igual da de longo prazo" (concordancia errada).
describe('Evolucao: concordancia da comparacao com o longo prazo', () => {
  const src = readFileSync(join(__dirname, '../src/training-intelligence/evolution-summary.ts'), 'utf8');
  it('usa "igual A" e "acima/abaixo DA" (nunca "igual da de")', () => {
    expect(src).toContain("word === 'praticamente igual' ? `${word} à` : `${word} da`");
    expect(src).toContain("withArticle(compareWord(ac.acute.value as number, ac.chronic.value as number))} de longo prazo.");
    expect(src).not.toMatch(/compareWord\(ac\.acute\.value as number, ac\.chronic\.value as number\)\} da de longo prazo/);
  });
});
