import { readFileSync } from 'fs';
import { join } from 'path';

// Etapa 2.1 — correcao visual do grafico do treino (DetailChart): os textos completos dos blocos eram desenhados DENTRO de faixas estreitas e se
// sobrepunham. Agora a faixa mostra so' o numero do bloco (e so' se couber), o texto completo aparece ao tocar e na lista numerada abaixo.
// Teste de codigo-fonte (o mobile nao tem runner de componentes neste repositorio), no mesmo estilo de legal-content.spec.ts.

const source = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'activityDetail.tsx'), 'utf8');

describe('DetailChart: rotulos dos blocos legiveis no celular', () => {
  it('nao desenha mais o texto completo do bloco dentro da faixa; so o numero curto, e apenas quando a faixa e larga o bastante', () => {
    expect(source).not.toMatch(/<SvgText[^>]*>\{b\.label\}<\/SvgText>/);
    expect(source).toMatch(/b\.shortLabel && sx\(b\.to\) - sx\(b\.from\) >= 14/);
    expect(source).toMatch(/shortLabel: String\(seg\.index \+ 1\)/);
  });

  it('preserva faixas prescritas, divisorias e a linha da execucao (logica do grafico intacta)', () => {
    expect(source).toContain('fill="#f59e0b" opacity={0.22}'); // faixa prescrita
    expect(source).toContain('strokeDasharray="4,3"'); // divisorias de bloco
    expect(source).toContain('<Path d={path} stroke={BLUE}'); // linha da execucao
  });

  it('o texto completo continua acessivel: toque no grafico mostra o bloco sob o cursor e a lista de blocos e numerada', () => {
    expect(source).toMatch(/cursorBand \? ` · bloco \$\{cursorBand\.shortLabel \?\? ''\}: \$\{cursorBand\.label\}`/);
    expect((source.match(/\{seg\.index \+ 1\}\. \{seg\.label\}/g) ?? []).length).toBe(2);
  });

  it('o relatorio pos-treino aparece no detalhe, sem IA e sem atribuir intencao', () => {
    expect(source).toContain('RELATÓRIO DO TREINO');
    expect(source).toContain('descreve o que aconteceu, não o motivo');
  });
});
