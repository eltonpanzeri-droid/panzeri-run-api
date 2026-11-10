import { fitUrlOf, isSafeFitUrl, seriesRows } from '../src/wahoo/wahoo-fit';

// 10/11/2026: FIT do treino Wahoo (summary.file.url). NAO validado com treino real da Wahoo (nenhuma aluna conectada): so' a protecao do endereco e a forma das linhas.
describe('FIT do treino Wahoo', () => {
  it('so baixa https com nome de host publico, sem credenciais, porta, IP ou nome interno (SSRF)', () => {
    expect(isSafeFitUrl('https://cdn.wahoofitness.com/files/abc.fit')).toBe(true);
    for (const bad of ['http://cdn.wahoofitness.com/a.fit', 'https://user:pw@cdn.wahoofitness.com/a.fit', 'https://cdn.wahoofitness.com:8443/a.fit', 'https://127.0.0.1/a.fit', 'https://10.0.0.5/a.fit', 'https://localhost/a.fit', 'https://servico.internal/a.fit', 'https://intranet/a.fit', 'https://[::1]/a.fit', 'ftp://x.com/a.fit', '', null, 7, `https://a.com/${'x'.repeat(2100)}`]) expect(isSafeFitUrl(bad)).toBe(false);
  });
  it('fitUrlOf le workout_summary.file.url e ignora o que nao for endereco seguro', () => {
    expect(fitUrlOf({ file: { url: 'https://cdn.example.com/a.fit' } })).toBe('https://cdn.example.com/a.fit');
    expect(fitUrlOf({ file: { url: 'http://cdn.example.com/a.fit' } })).toBeNull();
    expect(fitUrlOf({ file: null })).toBeNull();
    expect(fitUrlOf(null)).toBeNull();
  });
  it('linhas da serie: provider wahoo, sem latitude/longitude (GPS nao e guardado), valores arredondados e ausencia continua nula', () => {
    const rows = seriesRows({ points: [{ offsetSec: 5, distanceMeters: 20.5, speedKmh: 10.2, heartRateBpm: 150.4, cadenceSpm: null, powerWatts: 250.6, elevationMeters: 12, latitude: -19.9, longitude: -43.9 }] } as any, 'log1');
    expect(rows).toEqual([{ activityLogId: 'log1', provider: 'wahoo', offsetSec: 5, normalizationVersion: 1, heartRateBpm: 150, speedKmh: 10.2, distanceMeters: 20.5, cadenceSpm: null, powerWatts: 251, elevationMeters: 12 }]);
    expect(Object.keys(rows[0])).not.toContain('latitude');
  });
});
