import { dayAnchorSec, parseDailyHealth, parseRestingHeartRate, parseSleepHrv, parseSleepOverview } from '../src/coros/coros-health-records';
import { CorosHealthSyncService, HEALTH_MIN_INTERVAL_MS } from '../src/coros/coros-health-sync.service';
import { COROS_CONSENT } from '../src/coros/coros-consent';

// ATENCAO: os textos abaixo sao SINTETICOS, montados a partir da descricao oficial das ferramentas do COROS MCP e das respostas vazias/cabecalhos vistos na sonda de 30/10/2026 (nao ha relogio
// COROS na conta de teste). Quando houver uma resposta REAL, acrescente-a aqui e ajuste coros-health-records.ts.
const DAILY_EMPTY = '"Daily Health Data — Last 3 days | HRV Baseline: 42 ms\\nNote: sleep entries are dated by their wake-up day.\\n\\n--- 20261030 ---\\nSteps: 0 | Calories: 0 kcal | Exercise: 0 min"';
const DAILY = 'Daily Health Data — Last 3 days | HRV Baseline: 42 ms\n\n--- 20261029 ---\nSteps: 8,432 | Calories: 2100 kcal | Exercise: 45 min\n\n--- 20261030 ---\nSteps: 0 | Calories: 0 kcal | Exercise: 0 min';
const SLEEP = [
  'Sleep Overview', '========================', '',
  '2026-10-29',
  'Sleep score: 82',
  'Main sleep duration: 7h 30min',
  'Deep: 20% | Light: 55% | REM: 25%',
  'Awake time: 25min',
  'Main sleep window: 2026-10-28T23:10:00-03:00 - 2026-10-29T06:40:00-03:00',
  '',
  '2026-10-30', 'Sleep detail for this day is not available yet.',
].join('\n');

describe('leitor de saude da COROS (formato inferido; nao validado com dados reais)', () => {
  it('respostas vazias ou sem dado nao geram nenhum registro (ausencia nunca vira zero)', () => {
    expect(parseDailyHealth(DAILY_EMPTY)).toEqual([]);
    expect(parseSleepOverview('"Sleep Overview\\n\\n2026-10-30\\nSleep detail for this day is not available yet."')).toEqual([]);
    expect(parseSleepHrv('Sleep HRV — 2026-10-28 to 2026-10-30\n\nNo data found in the last 3 days.')).toEqual([]);
    expect(parseRestingHeartRate('No resting heart rate data found.')).toEqual([]);
  });

  it('saude diaria: passos e dia zerado descartado', () => {
    expect(parseDailyHealth(DAILY)).toEqual([{ calendarDate: '2026-10-29', steps: 8432, distanceMeters: null }]);
  });

  it('sono: duracao, etapas (so com as 3 proporcoes fechando ~100%), nota e janela com fuso', () => {
    const [night] = parseSleepOverview(SLEEP);
    expect(night).toMatchObject({ calendarDate: '2026-10-29', durationSec: 27000, scoreValue: 82, awakeSec: 1500, deepSleepSec: 5400, lightSleepSec: 14850, remSleepSec: 6750, startOffsetSec: -10800 });
    expect(night.startTimeSec).toBe(Date.parse('2026-10-28T23:10:00-03:00') / 1000);
    expect(night.endTimeSec).toBe(Date.parse('2026-10-29T06:40:00-03:00') / 1000);
  });

  it('sono: proporcoes que nao fecham nao viram etapas; janela sem fuso nao gera horario', () => {
    const text = '2026-10-29\nMain sleep duration: 7h 0min\nDeep: 70% | Light: 70% | REM: 70%\nMain sleep window: 23:10 - 06:10';
    const [night] = parseSleepOverview(text);
    expect(night.durationSec).toBe(25200);
    expect(night.deepSleepSec).toBeNull();
    expect(night.startTimeSec).toBeNull();
  });

  it('sono: duracao fisiologicamente impossivel e descartada', () => {
    expect(parseSleepOverview('2026-10-29\nMain sleep duration: 0h 10min')).toEqual([]);
  });

  it('HRV: so a media oficial do dia, nunca a linha de base', () => {
    const text = 'Sleep HRV — 2026-10-28 to 2026-10-30\n\n2026-10-29\nAverage HRV: 48 ms\nBaseline: 42 ms\nNormal range: 35-60 ms\n\n2026-10-30\nBaseline: 42 ms';
    expect(parseSleepHrv(text)).toEqual([{ calendarDate: '2026-10-29', averageMs: 48 }]);
  });

  it('FC de repouso: valor plausivel por dia; fora de 25-140 bpm descartado', () => {
    const text = '2026-10-28: 52 bpm\n20261029 | 51\n2026-10-30: 250 bpm';
    expect(parseRestingHeartRate(text)).toEqual([{ calendarDate: '2026-10-28', bpm: 52 }, { calendarDate: '2026-10-29', bpm: 51 }]);
  });
});

describe('consentimento COROS inclui os grupos de saude', () => {
  it('sono, saude diaria e HRV sao grupos opcionais e independentes', () => {
    const groups = Object.fromEntries(COROS_CONSENT.groups.map((g) => [g.id, g]));
    expect(groups.sleep).toMatchObject({ required: false, categories: ['sleep'] });
    expect(groups.daily).toMatchObject({ required: false, categories: ['daily_activity', 'resting_heart_rate'] });
    expect(groups.hrv).toMatchObject({ required: false, categories: ['hrv'] });
    expect(groups.sleep.requires ?? []).toEqual([]);
  });
});

describe('CorosHealthSyncService', () => {
  function build(responses: Record<string, string | Error>) {
    const rows = { sleep: [] as any[], hrv: [] as any[], daily: [] as any[] };
    const upsert = (list: any[]) => jest.fn(async ({ where, create, update }: any) => {
      const key = JSON.stringify(Object.values(where)[0]);
      const found = list.find((r) => r.key === key);
      if (found) Object.assign(found.row, update); else list.push({ key, row: create });
    });
    const prisma: any = {
      wearableSleepSummary: { upsert: upsert(rows.sleep), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      wearableHrvSummary: { upsert: upsert(rows.hrv) },
      wearableDailySummary: { upsert: upsert(rows.daily) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const calls: string[] = [];
    const client: any = { callTool: jest.fn(async (_t: string, tool: string) => { calls.push(tool); const r = responses[tool]; if (r instanceof Error) throw r; return r ?? ''; }) };
    return { service: new CorosHealthSyncService(prisma, client), rows, calls };
  }
  const now = new Date('2026-10-30T12:00:00Z');

  it('grava so as categorias autorizadas e consulta so as ferramentas correspondentes', async () => {
    const { service, rows, calls } = build({ querySleepHrv: '2026-10-29\nAverage HRV: 48 ms', querySleepOverview: SLEEP, queryDailyHealthData: DAILY, queryRestingHeartRate: '2026-10-29: 51 bpm' });
    const result = await service.run('u1', 'tok', ['hrv'], now);
    expect(calls).toEqual(['querySleepHrv']);
    expect(result).toMatchObject({ hrv: 1, sleep: 0, daily: 0 });
    expect(rows.hrv[0].row).toMatchObject({ userId: 'u1', provider: 'coros', calendarDate: '2026-10-29', startTimeSec: dayAnchorSec('2026-10-29'), lastNightAvg: 48 });
    expect(rows.sleep).toHaveLength(0);
    expect(rows.daily).toHaveLength(0);
  });

  it('FC de repouso e atividade diaria sao autorizacoes independentes: sem "daily_activity" nao grava passos', async () => {
    const { service, rows } = build({ queryDailyHealthData: DAILY, queryRestingHeartRate: '2026-10-29: 51 bpm' });
    await service.run('u1', 'tok', ['resting_heart_rate'], now);
    expect(rows.daily[0].row).toMatchObject({ restingHeartRateBpm: 51, steps: null, distanceMeters: null });
  });

  it('sono com janela completa e gravado; sem horario absoluto NAO e gravado nem estimado', async () => {
    const ok = build({ querySleepOverview: SLEEP });
    const a = await ok.service.run('u1', 'tok', ['sleep'], now);
    expect(a.sleep).toBe(1);
    expect(ok.rows.sleep[0].row).toMatchObject({ calendarDate: '2026-10-29', durationSec: 27000, scoreValue: 82, startOffsetSec: -10800 });
    const noWindow = build({ querySleepOverview: '2026-10-29\nMain sleep duration: 7h 0min' });
    const b = await noWindow.service.run('u1', 'tok', ['sleep'], now);
    expect(b).toMatchObject({ sleep: 0, skipped: 1 });
    expect(noWindow.rows.sleep).toHaveLength(0);
  });

  it('idempotente: repetir a consulta nao duplica; intervalo minimo de 3 h entre consultas da mesma aluna', async () => {
    const { service, rows, calls } = build({ querySleepHrv: '2026-10-29\nAverage HRV: 48 ms' });
    await service.run('u1', 'tok', ['hrv'], now);
    const second = await service.run('u1', 'tok', ['hrv'], new Date(now.getTime() + 60_000));
    expect(second.ran).toBe(false);
    await service.run('u1', 'tok', ['hrv'], new Date(now.getTime() + HEALTH_MIN_INTERVAL_MS + 1000));
    expect(calls).toHaveLength(2);
    expect(rows.hrv).toHaveLength(1);
  });

  it('falha de uma ferramenta nao derruba as outras', async () => {
    const { service, rows } = build({ querySleepOverview: new Error('boom'), querySleepHrv: '2026-10-29\nAverage HRV: 48 ms' });
    const result = await service.run('u1', 'tok', ['sleep', 'hrv'], now);
    expect(result).toMatchObject({ sleep: 0, hrv: 1 });
    expect(rows.hrv).toHaveLength(1);
  });

  it('sem nenhuma categoria de saude autorizada: nao consulta nada', async () => {
    const { service, calls } = build({});
    const result = await service.run('u1', 'tok', ['activity'], now);
    expect(result.ran).toBe(false);
    expect(calls).toEqual([]);
  });
});
