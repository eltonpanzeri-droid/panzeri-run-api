import { parsePolarGpx, POLAR_ROUTE_MAX_POINTS } from '../src/polar/polar-route';

// 19/11/2026 (Elton): Polar com percurso GPS, so com autorizacao explicita da aluna (licenca da AccessLink), atras de POLAR_ROUTE_ENABLED.
const gpx = (points: Array<{ lat: number | string; lon: number | string; ele?: number; time: string }>) =>
  `<?xml version="1.0"?><gpx><trk><trkseg>${points.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.ele === undefined ? '' : `<ele>${p.ele}</ele>`}<time>${p.time}</time></trkpt>`).join('')}</trkseg></trk></gpx>`;
const start = new Date('2026-11-19T10:00:00Z');

describe('leitura do GPX da Polar', () => {
  it('converte pontos em deslocamento (s) desde o inicio da atividade, com altitude quando existe', () => {
    const points = parsePolarGpx(gpx([{ lat: -19.9, lon: -43.9, ele: 850.5, time: '2026-11-19T10:00:00Z' }, { lat: -19.9001, lon: -43.9001, time: '2026-11-19T10:00:05Z' }]), start);
    expect(points).toEqual([
      { offsetSec: 0, latitude: -19.9, longitude: -43.9, elevationMeters: 850.5 },
      { offsetSec: 5, latitude: -19.9001, longitude: -43.9001, elevationMeters: null },
    ]);
  });

  it('descarta coordenada impossivel, 0/0, sem horario e altitude absurda', () => {
    const points = parsePolarGpx(gpx([
      { lat: 95, lon: 10, time: '2026-11-19T10:00:01Z' }, { lat: 0, lon: 0, time: '2026-11-19T10:00:02Z' }, { lat: 'x', lon: 10, time: '2026-11-19T10:00:03Z' },
      { lat: -19.9, lon: -43.9, ele: 99999, time: '2026-11-19T10:00:04Z' }, { lat: -19.9, lon: -43.9, time: 'nao e data' },
    ]), start);
    expect(points).toEqual([{ offsetSec: 4, latitude: -19.9, longitude: -43.9, elevationMeters: null }]);
  });

  it('um ponto por segundo; tempo anterior ao inicio vira zero; ordenado', () => {
    const points = parsePolarGpx(gpx([
      { lat: -19.9, lon: -43.9, time: '2026-11-19T10:00:03.200Z' }, { lat: -19.91, lon: -43.91, time: '2026-11-19T10:00:03.400Z' }, { lat: -19.8, lon: -43.8, time: '2026-11-19T09:59:50Z' },
    ]), start);
    expect(points.map((p) => p.offsetSec)).toEqual([0, 3]);
  });

  it('reduz percursos enormes ao teto sem perder o ultimo ponto; entrada vazia ou lixo = nada', () => {
    const many = Array.from({ length: 7000 }, (_, i) => ({ lat: -19.9 + i * 0.00001, lon: -43.9, time: new Date(start.getTime() + i * 1000).toISOString() }));
    const reduced = parsePolarGpx(gpx(many), start);
    expect(reduced).toHaveLength(POLAR_ROUTE_MAX_POINTS);
    expect(reduced[reduced.length - 1].offsetSec).toBe(6999);
    expect(parsePolarGpx('', start)).toEqual([]);
    expect(parsePolarGpx('<html>erro</html>', start)).toEqual([]);
  });
});

describe('autorizacao e gate (POLAR_ROUTE_ENABLED)', () => {
  const load = (flag?: string) => {
    jest.resetModules();
    if (flag === undefined) delete process.env.POLAR_ROUTE_ENABLED; else process.env.POLAR_ROUTE_ENABLED = flag;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../src/polar/polar-health-consent') as typeof import('../src/polar/polar-health-consent');
  };
  afterAll(() => { delete process.env.POLAR_ROUTE_ENABLED; });

  it('desligado (padrao): texto 1.2 de antes, sem o grupo e sem aceitar o id do percurso', () => {
    const m = load(undefined);
    expect(m.POLAR_HEALTH_CONSENT.version).toBe('1.2');
    expect(m.POLAR_HEALTH_CONSENT.groups.map((g) => g.id)).toEqual(['sleep', 'hrv', 'daily_activity', 'heart_rate']);
    expect(m.isPolarHealthCategory('activity_route')).toBe(false); // desligado, o servidor recusa o grupo
    expect(m.POLAR_HEALTH_CATEGORIES).not.toContain('activity_route');
    expect(JSON.stringify(m.POLAR_HEALTH_CONSENT)).not.toContain('Percurso GPS');
  });

  it('ligado: texto 1.3 com o grupo, aviso de dado sensivel e origem Polar', () => {
    const m = load('true');
    expect(m.POLAR_HEALTH_CONSENT.version).toBe('1.3');
    const group = m.POLAR_HEALTH_CONSENT.groups.find((g) => g.id === 'activity_route');
    expect(group?.description).toContain('Dado sensível');
    expect(group?.description).toContain('Polar');
    expect(m.POLAR_HEALTH_CATEGORIES).toContain('activity_route');
    expect(m.polarHealthTextHash()).not.toBe(load(undefined).polarHealthTextHash());
  });

  it('so ha percurso quando o grupo esta marcado sobre o texto vigente', () => {
    const m = load('true');
    const ok = { disconnectedAt: null, grantedCategories: ['sleep', 'activity_route'], consentVersion: m.POLAR_HEALTH_CONSENT.version, consentTextHash: m.polarHealthTextHash() };
    expect(m.grantedPolarHealthCategories(ok)).toContain('activity_route');
    expect(m.grantedPolarHealthCategories({ ...ok, grantedCategories: ['sleep'] })).not.toContain('activity_route');
    expect(m.grantedPolarHealthCategories({ ...ok, consentVersion: '1.2' })).toEqual([]);
    expect(m.grantedPolarHealthCategories({ ...ok, disconnectedAt: new Date() })).toEqual([]);
  });
});
