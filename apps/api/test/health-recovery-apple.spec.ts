import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { StudentHealthRecoveryService, sourceDisplayName } from '../src/coach/student-health-recovery.service';

// Saúde e recuperação do treinador com o Apple Saúde (30/10/2026). Regressão: o sono, a HRV e o dia chegavam ao servidor e o painel os descartava porque o provedor não estava na lista.

const math = new MathLayerService();
const epoch = (iso: string) => Math.floor(Date.parse(`${iso}:00.000Z`) / 1000);
const received = new Date('2026-10-29T22:00:00.000Z');

function service(seed: { sleep?: unknown[]; hrv?: unknown[]; daily?: unknown[]; authorized: Record<string, Record<string, boolean>> }) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 's1' }) },
    wearableSleepSummary: { findMany: jest.fn().mockResolvedValue(seed.sleep ?? []) },
    wearableHrvSummary: { findMany: jest.fn().mockResolvedValue(seed.hrv ?? []) },
    wearableDailySummary: { findMany: jest.fn().mockResolvedValue(seed.daily ?? []) },
  };
  const integrations = { forStudent: jest.fn().mockResolvedValue({ integrations: Object.entries(seed.authorized).map(([provider, cats]) => ({ provider, state: 'connected', categories: Object.entries(cats).map(([id, authorized]) => ({ id, authorized })) })) }) };
  return new StudentHealthRecoveryService(prisma as never, integrations as never, math);
}
const sleep = (id: string, date: string, start: string, minutes: number, stages = true) => ({
  id, provider: 'apple_health', providerSummaryId: 'com.garmin.connect.mobile|sleep:1', calendarDate: date, startTimeSec: epoch(start), startOffsetSec: -10800, endTimeSec: epoch(start) + minutes * 60, durationSec: minutes * 60,
  deepSleepSec: stages ? 70 * 60 : null, lightSleepSec: stages ? 250 * 60 : null, remSleepSec: stages ? 90 * 60 : null, awakeSec: stages ? 10 * 60 : null, napTotalSec: null, scoreValue: null, receivedAt: received,
});
const hrv = (date: string, value: number) => ({ provider: 'apple_health', providerSummaryId: 'com.apple.health|hrv', calendarDate: date, lastNightAvg: value, receivedAt: received });
const daily = (date: string) => ({ provider: 'apple_health', providerSummaryId: 'com.apple.health|daily', calendarDate: date, steps: 9000, activeKilocalories: 400, restingHeartRateBpm: 52, receivedAt: received });
const allOn = { apple_health: { sleep: true, hrv: true, heart: true, daily: true } };
const period = { from: '2026-10-01', to: '2026-10-30' };

describe('Apple Saúde em Saúde e recuperação', () => {
  it('sono, HRV, FC de repouso e passos do Apple Saúde aparecem quando os grupos estão autorizados', async () => {
    const result = await service({ sleep: [sleep('a', '2026-10-29', '2026-10-28T23:30', 480)], hrv: [hrv('2026-10-29', 48)], daily: [daily('2026-10-29')], authorized: allOn }).forStudent('s1', period);
    const by = Object.fromEntries(result.indicators.map((i) => [i.id, i]));
    expect(by.hrv.points.length).toBeGreaterThan(0);
    expect(by.restingHr.points.length).toBeGreaterThan(0);
    expect(by.steps.points.length).toBeGreaterThan(0);
    expect(result.sleep.nights.length).toBeGreaterThan(0); // é o que alimenta "Composição do sono por noite"
    expect(result.sleep.nights[0].sessions[0]).toMatchObject({ deepMin: 70, remMin: 90 });
    expect(result.sleep.nights[0].totalMin).toBe(480);
  });

  it('a nota da HRV diz que é SDNN e que não é comparável a RMSSD; a fonte tem nome legível', async () => {
    const result = await service({ hrv: [hrv('2026-10-29', 48)], authorized: allOn }).forStudent('s1', period);
    const note = JSON.stringify(result.indicators.find((i) => i.id === 'hrv'));
    expect(note).toContain('SDNN');
    expect(note).toContain('RMSSD');
    expect(sourceDisplayName('apple_health')).toBe('Apple Saúde');
  });

  it('grupo não autorizado: o dado fica oculto (a autorização manda, não a existência de linhas)', async () => {
    const result = await service({ sleep: [sleep('a', '2026-10-29', '2026-10-28T23:30', 480)], hrv: [hrv('2026-10-29', 48)], daily: [daily('2026-10-29')], authorized: { apple_health: { sleep: false, hrv: false, heart: false, daily: false } } }).forStudent('s1', period);
    expect(result.sleep.nights).toHaveLength(0);
    for (const id of ['hrv', 'restingHr', 'steps']) expect(result.indicators.find((i) => i.id === id)!.points).toHaveLength(0);
  });

  it('a FC de repouso depende do grupo de frequência cardíaca e os passos do grupo de atividade do dia (independentes)', async () => {
    const onlyHeart = await service({ daily: [daily('2026-10-29')], authorized: { apple_health: { sleep: false, hrv: false, heart: true, daily: false } } }).forStudent('s1', period);
    expect(onlyHeart.indicators.find((i) => i.id === 'restingHr')!.points.length).toBeGreaterThan(0);
    expect(onlyHeart.indicators.find((i) => i.id === 'steps')!.points).toHaveLength(0);
  });
});
