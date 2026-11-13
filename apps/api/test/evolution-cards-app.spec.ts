import * as fs from 'fs';
import * as path from 'path';

// Cards da Evolução (13/11/2026): o app apenas apresenta o texto do servidor, em carrossel horizontal, e NENHUM gráfico existente é removido (decisão de Elton).
const home = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'home', file), 'utf8');

describe('Evolução em cards', () => {
  it('o carrossel le a sintese do servidor, e horizontal com o proximo card aparecendo e bolinhas de posicao', () => {
    const cards = home('EvolutionReadingCards.tsx');
    expect(cards).toContain("'/me/evolution/summary'");
    expect(cards).toContain('horizontal');
    expect(cards).toContain('snapToInterval={step}');
    expect(cards).toContain('PEEK');
    expect(cards).toContain('Leitura da sua evolução');
    for (const piece of ['O que mede', 'O seu padrão', 'O que isso indica', 'Nenhum indicador é analisado sozinho']) expect(cards).toContain(piece);
    // sem leitura (erro/sem dado) nada aparece e as telas de sempre continuam
    expect(cards).toContain('if (!data) return null;');
  });

  it('esta nas cinco areas com leitura e NENHUM grafico/secao existente foi removido do hub', () => {
    const hub = home('EvolutionHub.tsx');
    expect((hub.match(/<EvolutionReadingCards/g) ?? []).length).toBe(3); // treino/aderencia, carga/sono, bem-estar
    for (const kept of ['renderProgress(view)', '<AdherenceWeekly', '<LoadSection', '<WearableSleepSection', '<FeelingsDetailScreen', '<PainArea', 'Dados do seu relógio']) expect(hub).toContain(kept);
    expect(hub).toContain('hideBack');
    expect(home('FeelingsDetailScreen.tsx')).toContain('hideBack = false');
  });
});
