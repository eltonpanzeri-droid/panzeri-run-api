import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 02/11/2026 (ordem de Elton): as seis areas da Evolucao ficam na TELA PRINCIPAL, em grade, e a aba "Evolucao" usa a mesma lista. (Le o texto do arquivo: o componente e' de react-native.)
const mobile = (f: string) => readFileSync(join(__dirname, '..', '..', 'mobile', f), 'utf8');

describe('grade das seis areas da Evolucao', () => {
  it('tem as seis areas, na ordem combinada', () => {
    const titles = [...mobile('home/EvolutionAreaGrid.tsx').matchAll(/title: '([^']+)', subtitle/g)].map((m) => m[1]);
    expect(titles).toEqual(['Evolução do treinamento', 'Resposta à carga', 'Sono e recuperação', 'Bem-estar', 'Dor', 'Aderência']);
  });
  it('a Home mostra a grade e abre a area escolhida; a aba Evolucao usa a mesma grade e abre direto na area', () => {
    expect(mobile('home/HomeScreen.tsx')).toContain('<EvolutionAreaGrid onOpenArea={onOpenArea} />');
    expect(mobile('home/EvolutionHub.tsx')).toContain('<EvolutionAreaGrid onOpenArea={setView} />');
    const app = mobile('App.tsx');
    expect(app).toContain("onOpenArea={(area) => { setEvolutionArea(area); setActiveTab('progress'); }}");
    expect(app).toContain('initialArea={evolutionArea}');
  });
});
