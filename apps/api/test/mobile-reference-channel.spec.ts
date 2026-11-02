import { modalityName, referenceChannelPoints } from '../../mobile/home/chartData';
import type { SnapshotLite } from '../../mobile/home/insights';

// 02/11/2026: a faixa cinza dos graficos da aluna vem da serie de referencias do SERVIDOR (mesma do painel do treinador). O app nao calcula faixa: so' converte.
const snapshot = (points: Array<{ timestamp: string; lower: number | null; upper: number | null; median: number | null; basis: 'individual' | 'limited' | 'none' }>): SnapshotLite => ({
  variable: {},
  mathApplicable: true,
  current: 3,
  trend: null,
  observations: [],
  evidence: { n: points.length },
  reference: { points: points.map((p) => ({ timestamp: p.timestamp, band: { lower: p.lower, upper: p.upper, median: p.median, basis: p.basis } })) },
});

describe('referenceChannelPoints (faixa habitual vinda do servidor)', () => {
  it('converte a faixa de cada ponto e usa a mediana como linha central', () => {
    const result = referenceChannelPoints(snapshot([{ timestamp: '2026-10-01T12:00:00.000Z', lower: 2, upper: 4, median: 3, basis: 'individual' }]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ lower: 2, upper: 4, mean: 3 });
  });

  it('ponto sem faixa sustentada (basis none ou limites nulos) nao desenha faixa: ausencia nunca vira "normal"', () => {
    const result = referenceChannelPoints(snapshot([
      { timestamp: '2026-10-01T12:00:00.000Z', lower: null, upper: null, median: null, basis: 'none' },
      { timestamp: '2026-10-02T12:00:00.000Z', lower: 1, upper: 5, median: 3, basis: 'none' },
      { timestamp: '2026-10-03T12:00:00.000Z', lower: null, upper: 5, median: 3, basis: 'limited' },
    ]));
    expect(result).toEqual([]);
  });

  it('base limitada tambem aparece (o servidor ja decidiu que ha faixa) e a saida vem ordenada no tempo', () => {
    const result = referenceChannelPoints(snapshot([
      { timestamp: '2026-10-05T12:00:00.000Z', lower: 2, upper: 4, median: null, basis: 'limited' },
      { timestamp: '2026-10-01T12:00:00.000Z', lower: 1, upper: 3, median: 2, basis: 'individual' },
    ]));
    expect(result.map((p) => p.lower)).toEqual([1, 2]);
    // sem mediana, a linha central e' o meio da faixa (so' representacao)
    expect(result[1].mean).toBe(3);
  });

  it('sem snapshot ou sem referencia devolve vazio (API antiga nao quebra a tela)', () => {
    expect(referenceChannelPoints(null)).toEqual([]);
    expect(referenceChannelPoints({ ...snapshot([]), reference: undefined })).toEqual([]);
  });
});

describe('modalityName', () => {
  it('nomes conhecidos em portugues e fallback legivel para os demais', () => {
    expect(modalityName('corrida')).toBe('Corrida');
    expect(modalityName('forca')).toBe('Força');
    expect(modalityName('fortalecimento_corredores')).toBe('Fortalecimento');
    expect(modalityName('mobilidade_ativa')).toBe('Mobilidade ativa');
  });
});
