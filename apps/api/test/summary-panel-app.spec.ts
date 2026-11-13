import * as fs from 'fs';
import * as path from 'path';
import { isoToBr, maskBrDate, parseBrDate, periodLabel, presetRange, queryFor, validateCustomRange } from '../../mobile/home/summaryPanelLogic';

// Painel de resumo na tela inicial (14/11/2026, lista de Elton): período livre com datas reais, padrão "desde o início", e o painel antigo fora da Evolução do treinamento.
const mobile = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', file), 'utf8');
const TODAY = '2026-11-14';

describe('período do painel', () => {
  it('padrão = desde o início (sem datas); 30 dias e 3 meses terminam hoje', () => {
    expect(presetRange('all', TODAY)).toEqual({ from: null, to: null });
    expect(presetRange('30d', TODAY)).toEqual({ from: '2026-10-16', to: TODAY });
    expect(presetRange('90d', TODAY)).toEqual({ from: '2026-08-17', to: TODAY });
    expect(periodLabel({ from: null, to: null })).toBe('desde o início');
    expect(periodLabel({ from: '2026-10-16', to: TODAY })).toBe('16/10/2026 a 14/11/2026');
    expect(queryFor({ from: null, to: null })).toBe('');
    expect(queryFor({ from: '2026-10-16', to: TODAY })).toBe('?from=2026-10-16&to=2026-11-14');
  });

  it('máscara e leitura de datas: só números viram dd/mm/aaaa; data inexistente é recusada', () => {
    expect(maskBrDate('16102026')).toBe('16/10/2026');
    expect(maskBrDate('1610')).toBe('16/10');
    expect(maskBrDate('16/10/2026999')).toBe('16/10/2026');
    expect(parseBrDate('16/10/2026')).toBe('2026-10-16');
    expect(parseBrDate('31/02/2026')).toBeNull();
    expect(parseBrDate('16/10/26')).toBeNull();
    expect(parseBrDate('')).toBeNull();
    expect(isoToBr('2026-10-16')).toBe('16/10/2026');
  });

  it('período livre: exige as duas datas, na ordem certa, sem futuro; data final futura vira hoje', () => {
    expect(validateCustomRange('01/09/2026', '30/09/2026', TODAY)).toEqual({ ok: true, range: { from: '2026-09-01', to: '2026-09-30' } });
    expect(validateCustomRange('01/09/2026', '31/12/2026', TODAY)).toEqual({ ok: true, range: { from: '2026-09-01', to: TODAY } });
    expect(validateCustomRange('', '30/09/2026', TODAY)).toMatchObject({ ok: false });
    expect(validateCustomRange('30/09/2026', '01/09/2026', TODAY)).toMatchObject({ ok: false, error: 'A data inicial não pode ser depois da final.' });
    expect(validateCustomRange('01/12/2026', '10/12/2026', TODAY)).toMatchObject({ ok: false });
  });
});

describe('onde o painel aparece', () => {
  it('fica na tela inicial e SAIU da Evolução do treinamento (cartões antigos removidos)', () => {
    expect(mobile('home/HomeScreen.tsx')).toContain('<SummaryPanel');
    const app = mobile('App.tsx');
    for (const old of ['TOTAL (km)', 'MELHOR SEM.', 'RECORDE SEQ.', 'ÚLTIMO REG.', 'MÉDIA/SEM.']) expect(app).not.toContain(old);
  });

  it('o painel lê tudo do servidor e traz os sete itens da lista, com "desde o início" nos que não aceitam período', () => {
    const panel = mobile('home/SummaryPanel.tsx');
    expect(panel).toContain('/me/evolution/panel');
    for (const item of ['SEMANAS DESDE QUE ENTROU', 'TREINOS FEITOS', 'TREINOS POR MODALIDADE', 'KM PERCORRIDOS', 'SEMANA COM MAIS KM', 'RECORDE DE SEMANAS ATIVAS', 'MÉDIA DE KM POR SEMANA']) expect(panel).toContain(item);
    expect(panel).toContain("useState<PanelPreset>('all')");
    expect(panel).toContain('Período livre');
    expect((panel.match(/desde o início/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
