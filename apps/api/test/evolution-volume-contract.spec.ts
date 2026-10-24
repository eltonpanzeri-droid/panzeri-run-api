import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 24/10/2026 — contrato do volume semanal: `kmPercorridos` JA' INCLUI os km extras (`kmExtras` e' um SUBCONJUNTO, nao uma parcela a somar). O app somava os dois e
// mostrava, no grafico "Volume por semana", mais km do que o historico e o texto da propria tela (ex.: 47 km contra 41,6 km). Este teste impede o consumidor de somar de novo.
const root = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

describe('volume semanal: kmPercorridos ja inclui os extras', () => {
  it('o contrato da API diz que os extras estao inclusos em kmPercorridos', () => {
    expect(read('api', 'src', 'evolution', 'evolution.types.ts')).toMatch(/Já incluso em kmPercorridos/);
  });

  it('nenhuma tela do app soma kmExtras a kmPercorridos (grafico, total do periodo, media e melhor semana)', () => {
    const app = read('mobile', 'App.tsx');
    // qualquer expressao que some kmExtras na mesma linha em que usa kmPercorridos
    const offending = app.split('\n').filter((line) => /kmPercorridos/.test(line) && /\+\s*\(?\s*\w+\.kmExtras|kmExtras[^;\n]*\+\s*\(?\s*\w+\.kmPercorridos/.test(line));
    expect(offending).toEqual([]);
  });

  it('o grafico, o total do periodo, a media e a melhor semana usam o mesmo valor semanal (kmPercorridos)', () => {
    const app = read('mobile', 'App.tsx');
    expect(app).toMatch(/const total = w\.kmPercorridos \?\? 0;/);
    expect(app).toMatch(/const periodKm = slicedWeeks\.reduce\(\(acc, w\) => acc \+ \(w\.kmPercorridos \?\? 0\), 0\);/);
    expect(app).toMatch(/Math\.max\(best, w\.kmPercorridos \?\? 0\)/);
  });
});
