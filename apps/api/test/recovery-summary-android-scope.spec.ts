import { buildRecoverySummary } from '../src/me/recovery-summary';

// 03/11/2026 — Google Play (escopo minimo): "Dados que nao chegaram" nao pode mandar a aluna do Android autorizar o que o app nao pede mais (calorias totais, saturacao, respiracao, nutricao, hidratacao).
// Apple Saude (e demais fontes) seguem como estavam: la esses dados continuam sendo lidos.
describe('Minha recuperacao: dados que o app nao pede mais ao Android', () => {
  const NOW = new Date('2026-11-03T15:00:00.000Z');
  const sleep = (provider: string, providerSummaryId: string | null) => [{ provider, providerSummaryId, calendarDate: '2026-11-02', durationSec: 25_200 }];
  const build = (provider: string, providerSummaryId: string | null, authorized?: Set<string>) =>
    buildRecoverySummary({ sleep: sleep(provider, providerSummaryId), hrv: [], daily: [], metrics: [], now: NOW, days: 30, sourceName: (key: string) => key, authorizedCategories: authorized } as never);
  const REMOVED = ['totalKcal', 'spo2', 'resp', 'nutrition', 'hydration'];

  it('so Health Connect: os 5 tipos retirados NAO aparecem em "nao chegaram", mesmo sem autorizacao; os que o app ainda pede continuam aparecendo', () => {
    for (const authorized of [new Set(['sleep']), undefined]) {
      const ids = build('health_connect', 'com.sec.android.app.shealth|abc', authorized).unavailable.map((u) => u.id);
      for (const removed of REMOVED) expect(ids).not.toContain(removed);
      expect(ids).toEqual(expect.arrayContaining(['hrv', 'restingHr', 'steps', 'activeKcal', 'vo2']));
    }
  });

  it('Apple Saude: os 5 tipos continuam listados (o iPhone ainda os le)', () => {
    const ids = build('apple_health', null).unavailable.map((u) => u.id);
    for (const removed of REMOVED) expect(ids).toContain(removed);
  });

  it('dado ja guardado de um tipo retirado continua aparecendo como indicador', () => {
    const summary = buildRecoverySummary({
      sleep: sleep('health_connect', 'com.sec.android.app.shealth|abc'), hrv: [], daily: [],
      metrics: [{ provider: 'health_connect', providerSummaryId: 'com.sec.android.app.shealth|m', metricKind: 'pulse_ox', calendarDate: '2026-11-02', startTimeSec: Math.floor(NOW.getTime() / 1000) - 86_400, values: { percentage: 97 } }],
      now: NOW, days: 30, sourceName: (key: string) => key,
    } as never);
    expect(summary.indicators.map((i) => i.id)).toContain('spo2');
  });
});
