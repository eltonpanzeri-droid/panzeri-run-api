import { activitySourceLabel, activitySourceLabels } from '../src/coach/activity-source-label';
import { completedMetrics } from '../src/coach/objective-execution';

describe('origem do treino sincronizado (painel)', () => {
  it('Garmin mostra o relogio como o Strava', () => {
    expect(activitySourceLabel('garmin', { garmin: { deviceName: 'Forerunner 970' } })).toBe('Garmin Forerunner 970 (via Garmin)');
    expect(activitySourceLabel('garmin', { garmin: { deviceName: 'Garmin Fenix 8' } })).toBe('Garmin Fenix 8 (via Garmin)');
    expect(activitySourceLabel('garmin', { garmin: {} })).toBe('Garmin');
  });
  it('Apple Saude/Health Connect: aparelho e canal; sem aparelho so o canal; Polar so o canal', () => {
    expect(activitySourceLabel('apple_health', { device: { name: 'Apple Watch' } })).toBe('Apple Watch (via Apple Saude)');
    expect(activitySourceLabel('health_connect', { device: { manufacturer: 'Samsung', model: 'Galaxy Watch7' } })).toBe('Samsung Galaxy Watch7 (via Health Connect)');
    expect(activitySourceLabel('apple_health', { source: { name: 'Garmin Connect' } })).toBe('Garmin Connect (via Apple Saude)');
    expect(activitySourceLabel('polar', null)).toBe('Polar');
    expect(activitySourceLabel('strava', null)).toBe('Strava');
  });
  it('lista sem repeticao e ignora consulta sem os campos de origem', () => {
    const link = { activityLog: { id: 'a', provider: 'garmin', providerMetrics: { garmin: { deviceName: 'Forerunner 970' } } } };
    expect(activitySourceLabels([link, { activityLog: { id: 'b', provider: 'garmin', providerMetrics: { garmin: { deviceName: 'Forerunner 970' } } } }])).toEqual(['Garmin Forerunner 970 (via Garmin)']);
    expect(activitySourceLabels([{ activityLog: { id: 'c' } }])).toEqual([]);
  });
  it('completedMetrics: vinculado mostra o relogio; so feedback feito mostra "informado pela aluna"; nao feito, nada', () => {
    const linked = { executionLinks: [{ activityLog: { id: 'a', distanceMeters: 10000, durationSec: 3000, provider: 'garmin', providerMetrics: { garmin: { deviceName: 'Forerunner 970' } } } }] };
    expect(completedMetrics(linked).completedSources).toEqual(['Garmin Forerunner 970 (via Garmin)']);
    expect(completedMetrics({ completion: { status: 'done' } }).completedSources).toEqual(['Informado pela aluna (sem relogio vinculado)']);
    expect(completedMetrics({ completion: { status: 'missed' } }).completedSources).toEqual([]);
    expect(completedMetrics({}).completedSources).toEqual([]);
  });
});
