import * as fs from 'fs';
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }), { virtual: true });
jest.mock('../../mobile/home/homeApi', () => ({ fetchJsonAuth: jest.fn() }));
import { fetchJsonAuth } from '../../mobile/home/homeApi';
import { findIndicator, loadEvolutionSummary, volumeReadingId } from '../../mobile/home/evolutionReading';
import * as path from 'path';

// Cards da Evolução (13/11/2026): o app apenas apresenta o texto do servidor, em carrossel horizontal, e NENHUM gráfico existente é removido (decisão de Elton).
const home = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'home', file), 'utf8');

describe('Evolução em cards', () => {
  it('o carrossel le a sintese do servidor, e horizontal com o proximo card aparecendo e bolinhas de posicao', () => {
    const cards = home('EvolutionReadingCards.tsx');
    expect(home('evolutionReading.ts')).toContain("'/me/evolution/summary'");
    expect(cards).toContain('useEvolutionSummary');
    expect(cards).toContain('horizontal');
    expect(cards).toContain('snapToInterval={IS_WEB ? undefined : step}');
    expect(cards).toContain('scrollSnapType');
    expect(cards).toContain('scrollSnapAlign');
    expect(cards).toContain('PEEK');
    expect(cards).toContain('Leitura da sua evolução');
    // compacto: padrão e tendência sempre visíveis; texto longo só sob demanda ("Ver explicação")
    for (const piece of ['Ver explicação', 'O que mede', 'O que isso indica', 'Nenhum indicador é analisado sozinho']) expect(cards).toContain(piece);
    expect(cards).toContain('openCards');
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

describe('Explicação sob cada gráfico (14/11/2026)', () => {
  it('a explicação geral começa RECOLHIDA e a frase da aluna fica sempre visível, vinda do servidor', () => {
    const meaning = home('IndicatorMeaning.tsx');
    expect(meaning).toContain('useState(false)');
    expect(meaning).not.toContain('useState(true)');
    expect(meaning).toContain('O seu caso');
    expect(meaning).toContain('useIndicatorReading');
  });

  it('o card de gráficos duplicado foi removido e o gráfico interativo ganhou "Comparar" e a frase conforme o que está marcado', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).not.toContain('Volume: prescrito, realizado e comparação');
    expect(app).toContain('Comparar prescrito × realizado');
    expect(app).toContain('volumeReadingId(chartSeries)');
    expect(app).toContain("label: 'Total prescrito'");
  });

  it('o hub fornece o token por contexto a todas as áreas', () => {
    expect(home('EvolutionHub.tsx')).toContain('EvolutionReadingContext.Provider');
  });

  it('o texto sob o gráfico de volume muda conforme as séries marcadas', () => {
    expect(volumeReadingId(['percorrido'])).toBe('training.volumeCompletedTotalKm');
    expect(volumeReadingId(['prescrito'])).toBe('training.volumePrescribedKm');
    expect(volumeReadingId(['percorrido', 'prescrito'])).toBe('training.volumeRatioCompletedPrescribed');
    expect(volumeReadingId(['extras'])).toBe('training.volumeExtraKm');
    expect(volumeReadingId(['percorrido', 'extras'])).toBe('training.volumeCompletedTotalKm');
    expect(volumeReadingId([])).toBeNull();
  });

  it('acha o indicador pelo id de variável e pelo id do texto de volume; sem leitura, nada; uma chamada só ao servidor em um minuto', async () => {
    const indicator = { variableId: 'training.volumeCompletedTotalKm', name: 'volume', status: 'ok', bucket: 'tracked', texts: { whatItMeasures: '', habitual: 'h', trend: null, meaning: null } };
    const summary = { areas: [{ id: 'training', title: 'T', text: '', meaning: null, counts: { evaluated: 0 }, indicators: [indicator] }] } as never;
    expect(findIndicator(summary, 'training.volume')?.variableId).toBe('training.volumeCompletedTotalKm');
    expect(findIndicator(summary, 'training.volumeCompletedTotalKm')).toBeTruthy();
    expect(findIndicator(summary, 'outro')).toBeNull();
    expect(findIndicator(null, 'training.volume')).toBeNull();
    const fetchMock = fetchJsonAuth as jest.Mock;
    fetchMock.mockResolvedValue(summary);
    await Promise.all([loadEvolutionSummary('tok-1'), loadEvolutionSummary('tok-1'), loadEvolutionSummary('tok-1')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(null);
    await loadEvolutionSummary('tok-erro');
    await loadEvolutionSummary('tok-erro');
    expect(fetchMock).toHaveBeenCalledTimes(2); // erro nao fica guardado
  });
});
