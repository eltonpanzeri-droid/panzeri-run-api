import { buildRecoverySummary } from '../src/me/recovery-summary';
import { sourceDisplayName } from '../src/coach/student-health-recovery.service';

// "Minha recuperação" (30/10/2026): o aluno vê os próprios dados e por que são usados. Dados SINTÉTICOS.
const NOW = new Date('2026-10-30T15:00:00Z');
const base = { sleep: [], hrv: [], daily: [], metrics: [], now: NOW, days: 30, sourceName: sourceDisplayName };
const hc = (summary = 'com.sec.android.app.shealth|x') => ({ provider: 'health_connect', providerSummaryId: summary });
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

describe('minha recuperação', () => {
  it('sem nenhum dado: vazio (a tela explica como conectar), sem inventar indicador', () => {
    const result = buildRecoverySummary(base);
    expect(result.empty).toBe(true);
    expect(result.indicators).toEqual([]);
  });

  it('sono, HRV, FC de repouso e passos: último valor, média de 7 e de 30 dias, fonte legível e o motivo de usarmos', () => {
    const result = buildRecoverySummary({
      ...base,
      sleep: [1, 2, 3].map((n) => ({ ...hc(), calendarDate: day(n), durationSec: (400 + n * 10) * 60 })),
      hrv: [{ ...hc(), calendarDate: day(1), lastNightAvg: 52.4 }],
      daily: [{ ...hc(), calendarDate: day(1), steps: 8000, activeKilocalories: 350, restingHeartRateBpm: 54 }],
    });
    const by = Object.fromEntries(result.indicators.map((i) => [i.id, i]));
    expect(by.sleep).toMatchObject({ unit: 'min', days: 3, last: 410, source: 'Health Connect · Samsung Health' });
    expect(by.sleep.avg30).toBe(420);
    expect(by['hrv.rmssd'].note).toContain('RMSSD');
    expect(by.restingHr.last).toBe(54);
    expect(by.steps.last).toBe(8000);
    for (const indicator of result.indicators) expect(indicator.why.length).toBeGreaterThan(40);
  });

  it('HRV do Apple Saúde é SDNN e aparece separada; fontes diferentes nunca se misturam (fica a mais recente e avisa das outras)', () => {
    const result = buildRecoverySummary({
      ...base,
      hrv: [
        { provider: 'apple_health', providerSummaryId: 'com.apple.health|h', calendarDate: day(1), lastNightAvg: 48 },
        { ...hc(), calendarDate: day(3), lastNightAvg: 60 },
      ],
      daily: [
        { provider: 'apple_health', providerSummaryId: 'com.apple.health|d', calendarDate: day(1), steps: 7000, activeKilocalories: null, restingHeartRateBpm: null },
        { ...hc(), calendarDate: day(6), steps: 9999, activeKilocalories: null, restingHeartRateBpm: null },
      ],
    });
    const ids = result.indicators.map((i) => i.id);
    expect(ids).toContain('hrv.sdnn');
    expect(ids).toContain('hrv.rmssd');
    expect(result.indicators.find((i) => i.id === 'hrv.sdnn')!.note).toContain('SDNN');
    const steps = result.indicators.find((i) => i.id === 'steps')!;
    expect(steps).toMatchObject({ last: 7000, source: 'Apple Saúde', days: 1 });
    expect(steps.note).toContain('outras fontes');
  });

  it('oxigenação, respiração, VO₂, nutrição e hidratação: unidades corretas; nutrição e hidratação somam o dia; zero informado continua zero', () => {
    const m = (kind: string, values: Record<string, unknown>, d: number, id = 'a') => ({ ...hc(`com.google.android.apps.fitness|${id}`), metricKind: kind, calendarDate: day(d), startTimeSec: 0, values });
    const result = buildRecoverySummary({
      ...base,
      metrics: [
        m('pulse_ox', { percentage: 97 }, 1), m('respiratory_rate', { ratePerMinute: 14 }, 1), m('vo2_max', { vo2MillilitersPerMinuteKilogram: 46.2 }, 2),
        m('nutrition', { energyKcal: 600 }, 1, 'n1'), m('nutrition', { energyKcal: 700 }, 1, 'n2'),
        m('hydration', { volumeLiters: 0.5 }, 1, 'h1'), m('hydration', { volumeLiters: 0 }, 1, 'h2'),
      ],
    });
    const by = Object.fromEntries(result.indicators.map((i) => [i.id, i]));
    expect(by.spo2).toMatchObject({ unit: '%', last: 97 });
    expect(by.resp).toMatchObject({ unit: 'respirações/min', last: 14 });
    expect(by.vo2.last).toBe(46.2);
    expect(by.nutrition).toMatchObject({ unit: 'kcal', last: 1300 });
    expect(by.hydration).toMatchObject({ unit: 'L', last: 0.5 });
    const zero = buildRecoverySummary({ ...base, daily: [{ ...hc(), calendarDate: day(1), steps: 0, activeKilocalories: null, restingHeartRateBpm: null }] });
    expect(zero.indicators.find((i) => i.id === 'steps')!.last).toBe(0);
  });

  it('só entra o período pedido (30 dias); dado mais antigo fica de fora e ausência não vira indicador', () => {
    const result = buildRecoverySummary({ ...base, daily: [{ ...hc(), calendarDate: day(60), steps: 5000, activeKilocalories: null, restingHeartRateBpm: null }] });
    expect(result.empty).toBe(true);
  });
});
