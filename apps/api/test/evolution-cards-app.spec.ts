import * as fs from 'fs';
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }), { virtual: true });
jest.mock('../../mobile/home/homeApi', () => ({ fetchJsonAuth: jest.fn() }));
import { fetchJsonAuth } from '../../mobile/home/homeApi';
import { findIndicator, loadEvolutionSummary, volumeReadingId } from '../../mobile/home/evolutionReading';
import * as path from 'path';

// Evolução (14/11/2026, desenho de Elton): cada GRANDE ÁREA tem UM card com cinco botões (sem rolagem lateral) e cada GRÁFICO tem os cinco blocos embaixo; o app só apresenta o texto do servidor.
const home = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'home', file), 'utf8');
const app = () => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');

describe('Card único da área', () => {
  it('sem rolagem lateral: o carrossel antigo foi removido e o card tem os cinco botões na ordem do desenho', () => {
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'mobile', 'home', 'EvolutionReadingCards.tsx'))).toBe(false);
    const card = home('AreaGuideCard.tsx');
    expect(card).not.toContain('horizontal');
    expect(card).toContain('useEvolutionSummary');
    const titles = ['O que é?', 'Como interpretar?', 'Quais são os seus números?', 'Como você está?', 'Limitações'];
    let last = -1;
    for (const title of titles) { const at = card.indexOf(`title: '${title}'`); expect(at).toBeGreaterThan(last); last = at; }
    expect(card).toContain("defaultOpen: true"); // só o primeiro começa aberto
    expect((card.match(/defaultOpen/g) ?? []).length).toBe(1);
    expect(card).toContain('if (!data) return null;');
  });

  it('está nas áreas com leitura e NENHUM gráfico/seção existente foi removido do hub; o aviso solto do topo saiu', () => {
    const hub = home('EvolutionHub.tsx');
    expect((hub.match(/<AreaGuideCard/g) ?? []).length).toBe(3); // treino/aderência, carga/sono, bem-estar
    for (const kept of ['renderProgress(view)', '<AdherenceWeekly', '<LoadSection', '<WearableSleepSection', '<FeelingsDetailScreen', '<PainArea', 'Dados do seu relógio']) expect(hub).toContain(kept);
    expect(hub).not.toContain('TOP_NOTICE}');
    expect(hub).toContain('hideBack');
  });
});

describe('Botões grandes (acordeão)', () => {
  it('o primeiro começa aberto e os demais fechados; botões grandes e destacados; texto maior que o padrão', () => {
    const accordion = home('GuideAccordion.tsx');
    expect(accordion).toContain('section.defaultOpen');
    expect(accordion).toContain('minHeight: 54');
    expect(accordion).toContain('borderWidth: 2');
    expect(accordion).toContain("fontSize: 16, lineHeight: 25");
    expect(accordion).toContain('accessibilityState={{ expanded: isOpen }}');
  });
});


describe('Cinco blocos sob cada gráfico', () => {
  it('O que é? (aberto), Como interpretar?, Quais são os seus números?, Como você está? e Limitações desse dado, nessa ordem; sem leitura só "O que é?" e as limitações gerais', () => {
    const meaning = home('IndicatorMeaning.tsx');
    const titles = ['O que é?', 'Como interpretar?', 'Quais são os seus números?', 'Como você está?', 'Limitações desse dado'];
    let last = -1;
    for (const title of titles) { const at = meaning.indexOf(`title: '${title}'`); expect(at).toBeGreaterThan(last); last = at; }
    expect(meaning).toContain('useIndicatorReading');
    expect(meaning).toContain('GENERIC_LIMITATIONS');
    expect((meaning.match(/defaultOpen: true/g) ?? []).length).toBe(2); // um por modo (com e sem leitura)
  });

  it('os avisos soltos saíram das telas de Evolução (só as Limitações os têm)', () => {
    expect(home('FeelingsDetailScreen.tsx')).not.toContain('Descrição dos seus próprios registros, sem diagnóstico');
    expect(home('EvolutionObjective.tsx')).not.toContain('{caution ?');
    expect(home('IndicatorMeaning.tsx')).not.toContain('MEANING_FOOTER');
  });

  it('o gráfico interativo de volume ganhou "Comparar" e os cinco blocos seguem o que está marcado; o card duplicado não existe', () => {
    const source = app();
    expect(source).not.toContain('Volume: prescrito, realizado e comparação');
    expect(source).toContain('Comparar prescrito × realizado');
    expect(source).toContain("<IndicatorMeaning id={volumeReadingId(chartSeries) ?? 'training.volume'} />");
    expect(source).toContain("label: 'Total prescrito'");
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
