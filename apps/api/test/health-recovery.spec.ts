import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { buildSleepNights, compareSummaries, parseDay, summarize, validatePeriod, type SleepRow } from '../src/coach/health-recovery';
import { StudentHealthRecoveryService } from '../src/coach/student-health-recovery.service';

// 23/10/2026 — Saude e Recuperacao (painel do treinador). Cenarios SINTETICOS, inclusive os ainda nao observados no Health Connect (sono dividido, sessoes sobrepostas, cochilo).

const math = new MathLayerService();
const epoch = (iso: string) => Math.floor(Date.parse(`${iso}:00.000Z`) / 1000);

function row(id: string, date: string, start: string, durationMin: number | null, extra: Partial<SleepRow> = {}): SleepRow {
  const startTimeSec = epoch(start);
  return {
    id, calendarDate: date, startTimeSec, startOffsetSec: 0, endTimeSec: durationMin == null ? null : startTimeSec + durationMin * 60,
    durationSec: durationMin == null ? null : durationMin * 60, deepSleepSec: null, lightSleepSec: null, remSleepSec: null, awakeSec: null, napTotalSec: null, scoreValue: null, ...extra,
  };
}

describe('sono: sessoes principal, adicional e cochilo (sem descartar nada)', () => {
  it('uma sessao: o total e' + " o dela", () => {
    const [night] = buildSleepNights([row('a', '2026-10-21', '2026-10-20T23:00', 420)]);
    expect(night.totalMin).toBe(420);
    expect(night.totalBasis).toBe('sessao_unica');
    expect(night.sessions).toHaveLength(1);
    expect(night.sessions[0].role).toBe('principal');
  });

  it('noite dividida (duas sessoes noturnas sem sobreposicao): soma, com principal + adicional', () => {
    const [night] = buildSleepNights([row('p', '2026-10-21', '2026-10-20T23:00', 300), row('b', '2026-10-21', '2026-10-21T04:30', 120)]);
    expect(night.sessions.map((s) => s.role)).toEqual(['principal', 'adicional']);
    expect(night.totalMin).toBe(420);
    expect(night.totalBasis).toBe('soma_sem_sobreposicao');
    expect(night.sessions.every((s) => s.counted)).toBe(true);
  });

  it('sessao contida inteira em outra: aparece, mas NAO e somada (nao conta o mesmo periodo duas vezes)', () => {
    const [night] = buildSleepNights([row('p', '2026-10-21', '2026-10-20T23:00', 420), row('c', '2026-10-21', '2026-10-21T01:00', 60)]);
    expect(night.sessions).toHaveLength(2);
    expect(night.totalMin).toBe(420);
    const contained = night.sessions.find((s) => s.id === 'c')!;
    expect(contained.counted).toBe(false);
    expect(contained.note).toMatch(/não somado/);
    expect(night.limitations.join(' ')).toMatch(/contidas em outra/);
  });

  it('sobreposicao parcial: total INDETERMINADO (null), todas as sessoes listadas e a limitacao dita', () => {
    const [night] = buildSleepNights([row('p', '2026-10-21', '2026-10-20T23:00', 360), row('o', '2026-10-21', '2026-10-21T04:00', 180)]);
    expect(night.totalMin).toBeNull();
    expect(night.totalBasis).toBe('indeterminado');
    expect(night.sessions).toHaveLength(2);
    expect(night.limitations.join(' ')).toMatch(/sobrepõem só em parte/);
    expect(night.deepMin).toBeNull();
  });

  it('sessao adicional sem duracao: total indeterminado, nada inventado', () => {
    const [night] = buildSleepNights([row('p', '2026-10-21', '2026-10-20T23:00', 300), row('x', '2026-10-21', '2026-10-21T05:00', null)]);
    expect(night.totalMin).toBeNull();
    expect(night.limitations.join(' ')).toMatch(/sem horário ou duração/);
  });

  it('cochilo: sessao adicional que comeca entre 9h e 19h NAO entra no total da noite e e contada a parte', () => {
    const [night] = buildSleepNights([row('p', '2026-10-21', '2026-10-20T23:00', 420), row('n', '2026-10-21', '2026-10-21T14:00', 40)]);
    expect(night.sessions.find((s) => s.id === 'n')!.role).toBe('cochilo');
    expect(night.totalMin).toBe(420);
    expect(night.napMin).toBe(40);
    expect(night.limitations.join(' ')).toMatch(/cochilo/);
  });

  it('cochilo informado em campo proprio (Zepp, napTotalSec) tem prioridade', () => {
    const [night] = buildSleepNights([row('p', '2026-10-21', '2026-10-20T23:00', 400, { napTotalSec: 25 * 60 })]);
    expect(night.napMin).toBe(25);
    expect(night.totalMin).toBe(400);
  });

  it('etapas so entram quando TODAS as sessoes contadas as informam; senao ficam null (nunca somas parciais)', () => {
    const withStages = (id: string, start: string, d: number) => row(id, '2026-10-21', start, d, { deepSleepSec: 60 * 60, lightSleepSec: 120 * 60, remSleepSec: 60 * 60, awakeSec: 10 * 60 });
    const [full] = buildSleepNights([withStages('a', '2026-10-20T23:00', 250), withStages('b', '2026-10-21T04:30', 250)]);
    expect(full.deepMin).toBe(120);
    const [partial] = buildSleepNights([withStages('a', '2026-10-20T23:00', 250), row('b', '2026-10-21', '2026-10-21T04:30', 100)]);
    expect(partial.deepMin).toBeNull();
  });

  it('sessao principal que comeca de dia (so cochilo na data, ou cochilo maior que a noite): a limitacao e dita e nada e reclassificado em silencio', () => {
    const [onlyNap] = buildSleepNights([row('n', '2026-10-21', '2026-10-21T14:00', 45)]);
    expect(onlyNap.sessions[0].role).toBe('principal');
    expect(onlyNap.totalMin).toBe(45);
    expect(onlyNap.limitations.join(' ')).toMatch(/pode ser um cochilo, e não a noite de sono/);
    const [longNap] = buildSleepNights([row('n', '2026-10-21', '2026-10-21T10:00', 400), row('w', '2026-10-21', '2026-10-21T23:30', 120)]);
    expect(longNap.sessions.find((s) => s.id === 'n')!.role).toBe('principal');
    expect(longNap.limitations.join(' ')).toMatch(/pode ser um cochilo/);
    expect(longNap.sessions).toHaveLength(2);
  });

  it('preserva a ordem das datas e nunca descarta registros (n de sessoes = n de linhas)', () => {
    const rows = [row('a', '2026-10-22', '2026-10-21T23:00', 400), row('b', '2026-10-21', '2026-10-20T23:00', 410), row('c', '2026-10-21', '2026-10-21T13:00', 30)];
    const nights = buildSleepNights(rows);
    expect(nights.map((n) => n.date)).toEqual(['2026-10-21', '2026-10-22']);
    expect(nights.reduce((sum, n) => sum + n.sessions.length, 0)).toBe(rows.length);
  });

  it('horario local usa o deslocamento informado pela propria fonte', () => {
    const r = row('a', '2026-10-21', '2026-10-21T02:00', 420, { startOffsetSec: -3 * 3600 });
    const [night] = buildSleepNights([r]);
    expect(night.sessions[0].start).toBe('2026-10-20T23:00');
  });
});

describe('resumo de periodo e comparacao', () => {
  const points = Array.from({ length: 20 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 1 + i, 12)).toISOString().slice(0, 10), value: 50 + i }));

  it('respeita o periodo escolhido e informa a quantidade de observacoes', () => {
    const s = summarize(points, { from: '2026-10-05', to: '2026-10-14' }, math);
    expect(s.n).toBe(10);
    expect(s.min).toBe(54);
    expect(s.max).toBe(63);
    expect(s.mean).toBe(58.5);
    expect(s.first).toEqual({ date: '2026-10-05', value: 54 });
    expect(s.last).toEqual({ date: '2026-10-14', value: 63 });
    expect(s.trend.direction).toBe('increasing');
    expect(s.trend.minObservations).toBe(5);
  });

  it('poucos registros (menos de 5) NAO viram tendencia: insuficiente, mesmo havendo dois pontos', () => {
    const s = summarize(points, { from: '2026-10-05', to: '2026-10-08' }, math);
    expect(s.n).toBe(4);
    expect(s.trend.direction).toBe('insufficient_data');
    expect(s.trend.slopePerDay).toBeNull();
    expect(s.mean).toBe(55.5); // media e n continuam mostrados
    expect(summarize(points, { from: '2026-10-05', to: '2026-10-09' }, math).trend.direction).toBe('increasing'); // 5 registros ja valem
  });

  it('periodo sem dados: n=0 e nada inventado', () => {
    const s = summarize(points, { from: '2027-01-01', to: '2027-01-31' }, math);
    expect(s).toMatchObject({ n: 0, mean: null, min: null, max: null, first: null, last: null });
    expect(s.trend.direction).toBe('insufficient_data');
  });

  it('um unico dia: sem tendencia', () => {
    expect(summarize(points, { from: '2026-10-03', to: '2026-10-03' }, math).trend.direction).toBe('insufficient_data');
  });

  it('comparacao entre dois periodos: diferenca B - A calculada no servidor; sem media = sem diferenca', () => {
    const a = summarize(points, { from: '2026-10-01', to: '2026-10-05' }, math);
    const b = summarize(points, { from: '2026-10-11', to: '2026-10-15' }, math);
    const delta = compareSummaries(a, b);
    expect(delta.mean).toBe(10);
    expect(delta.meanPercent).toBe(19.2);
    expect(compareSummaries(summarize(points, { from: '2027-01-01', to: '2027-01-02' }, math), b)).toEqual({ mean: null, meanPercent: null });
  });

  it('datas: formato e coerencia validados', () => {
    expect(parseDay('2026-10-23')).toBe('2026-10-23');
    for (const bad of ['2026-13-01', '2026-02-30', '23/10/2026', '', 5, null]) expect(parseDay(bad as never)).toBeNull();
    expect(validatePeriod('2026-10-23', '2026-10-01')).toMatch(/não pode ser depois/);
    expect(validatePeriod('2000-01-01', '2026-10-01')).toMatch(/longo demais/);
    expect(validatePeriod('2026-10-01', '2026-10-23')).toBeNull();
  });
});

describe('servico: autorizacao, fonte, periodo livre e comparacao', () => {
  interface Seed { sleep?: unknown[]; hrv?: unknown[]; daily?: unknown[]; authorized?: Record<string, Record<string, boolean>> }
  const day = (offset: number) => new Date(Date.UTC(2026, 9, 1 + offset, 12)).toISOString().slice(0, 10);

  function service(seed: Seed) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 's1' }) },
      wearableSleepSummary: { findMany: jest.fn().mockResolvedValue(seed.sleep ?? []) },
      wearableHrvSummary: { findMany: jest.fn().mockResolvedValue(seed.hrv ?? []) },
      wearableDailySummary: { findMany: jest.fn().mockResolvedValue(seed.daily ?? []) },
    };
    const auth = seed.authorized ?? { zepp: { sleep: true, hrv: true, resting_heart_rate: true, daily: true }, health_connect: { sleep: true, hrv: true, resting_hr: true, daily: true } };
    const integrations = {
      forStudent: jest.fn().mockResolvedValue({
        integrations: Object.entries(auth).map(([provider, cats]) => ({ provider, categories: Object.entries(cats).map(([id, authorized]) => ({ id, authorized })) })),
      }),
    };
    return new StudentHealthRecoveryService(prisma as never, integrations as never, math);
  }
  const hrvRow = (provider: string, summaryId: string | null, date: string, value: number) => ({ provider, providerSummaryId: summaryId, calendarDate: date, lastNightAvg: value, receivedAt: new Date('2026-10-22T10:00:00.000Z') });
  const dailyRow = (provider: string, date: string, extra: Record<string, number | null>) => ({ provider, providerSummaryId: provider === 'zepp' ? 'z' : 'com.sec.android.app.shealth|d', calendarDate: date, steps: null, activeKilocalories: null, restingHeartRateBpm: null, receivedAt: new Date('2026-10-22T10:00:00.000Z'), ...extra });
  const sleepRow = (id: string, provider: string, summaryId: string | null, date: string, start: string, minutes: number) => ({
    id, provider, providerSummaryId: summaryId, calendarDate: date, startTimeSec: epoch(start), startOffsetSec: 0, endTimeSec: epoch(start) + minutes * 60, durationSec: minutes * 60,
    deepSleepSec: null, lightSleepSec: null, remSleepSec: null, awakeSec: null, napTotalSec: null, scoreValue: null, receivedAt: new Date('2026-10-22T10:00:00.000Z'),
  });

  it('periodo livre: so entram pontos da janela escolhida e o resumo informa n', async () => {
    const daily = Array.from({ length: 30 }, (_, i) => dailyRow('zepp', day(i), { steps: 5000 + i * 100 }));
    const result = await service({ daily }).forStudent('s1', { from: '2026-10-10', to: '2026-10-19' });
    const steps = result.indicators.find((i) => i.id === 'steps')!;
    expect(steps.points).toHaveLength(10);
    expect(steps.summary.n).toBe(10);
    expect(steps.state).toBe('ok');
    expect(result.availableRange).toEqual({ from: '2026-10-01', to: '2026-10-30' });
  });

  it('comparacao entre dois periodos escolhidos pelo treinador', async () => {
    const daily = Array.from({ length: 30 }, (_, i) => dailyRow('zepp', day(i), { steps: 5000 + i * 100 }));
    const result = await service({ daily }).forStudent('s1', { from: '2026-10-21', to: '2026-10-30', compareFrom: '2026-10-01', compareTo: '2026-10-10' });
    const steps = result.indicators.find((i) => i.id === 'steps')!;
    expect(steps.compare!.summary.n).toBe(10);
    expect(steps.compare!.delta.mean).toBe(2000);
    expect(result.comparePeriod).toEqual({ from: '2026-10-01', to: '2026-10-10' });
  });

  it('categoria NAO autorizada: o dado nao aparece e o estado diz "nao autorizada"', async () => {
    const result = await service({
      hrv: [hrvRow('zepp', 'x', '2026-10-20', 48)],
      authorized: { zepp: { sleep: true, hrv: false, resting_heart_rate: true, daily: true } },
    }).forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    const hrv = result.indicators.find((i) => i.id === 'hrv')!;
    expect(hrv.state).toBe('nao_autorizada');
    expect(hrv.points).toEqual([]);
    expect(hrv.sources).toEqual([]);
    expect(result.availableRange).toEqual({ from: null, to: null });
  });

  it('sem NENHUMA conexao autorizando: o dado nao aparece e o estado nao revela que existem linhas', async () => {
    const result = await service({ hrv: [hrvRow('zepp', 'x', '2026-10-20', 48)], authorized: {} }).forStudent('s1', {});
    const hrv = result.indicators.find((i) => i.id === 'hrv')!;
    expect(hrv.points).toEqual([]);
    expect(hrv.sources).toEqual([]);
    expect(hrv.state).toBe('sem_dados'); // sem conexao nao ha o que dizer sobre autorizacao
  });

  it('"nao autorizada" vem da AUTORIZACAO, nao de existirem linhas: categoria bloqueada sem nenhuma linha tambem diz nao autorizada', async () => {
    const result = await service({ authorized: { zepp: { sleep: true, hrv: false, resting_heart_rate: true, daily: true } } }).forStudent('s1', {});
    expect(result.indicators.find((i) => i.id === 'hrv')!.state).toBe('nao_autorizada');
    expect(result.indicators.find((i) => i.id === 'steps')!.state).toBe('sem_dados');
  });

  it('FC de repouso e passos/calorias (categoria daily) sao autorizados de forma independente, em ambas as fontes', async () => {
    const daily = (provider: string) => [dailyRow(provider, '2026-10-20', { steps: 9000, activeKilocalories: 500, restingHeartRateBpm: 55 })];
    const zeppRestingBlocked = await service({ daily: daily('zepp'), authorized: { zepp: { sleep: true, hrv: true, resting_heart_rate: false, daily: true } } }).forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    expect(zeppRestingBlocked.indicators.find((i) => i.id === 'restingHr')!.points).toEqual([]);
    expect(zeppRestingBlocked.indicators.find((i) => i.id === 'restingHr')!.state).toBe('nao_autorizada');
    expect(zeppRestingBlocked.indicators.find((i) => i.id === 'steps')!.points).toHaveLength(1);
    const dailyBlocked = await service({ daily: daily('zepp'), authorized: { zepp: { sleep: true, hrv: true, resting_heart_rate: true, daily: false } } }).forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    expect(dailyBlocked.indicators.find((i) => i.id === 'steps')!.points).toEqual([]);
    expect(dailyBlocked.indicators.find((i) => i.id === 'activeKcal')!.points).toEqual([]);
    expect(dailyBlocked.indicators.find((i) => i.id === 'restingHr')!.points).toHaveLength(1);
    const hcRestingBlocked = await service({ daily: daily('health_connect'), authorized: { health_connect: { sleep: true, hrv: true, resting_hr: false, daily: true } } }).forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    expect(hcRestingBlocked.indicators.find((i) => i.id === 'restingHr')!.points).toEqual([]);
    expect(hcRestingBlocked.indicators.find((i) => i.id === 'steps')!.points).toHaveLength(1);
  });

  it('source invalida (lista, vazia ou longa demais) e ignorada e nao e ecoada', async () => {
    for (const bad of [['a', 'b'], '', 'x'.repeat(200)]) {
      const result = await service({}).forStudent('s1', { source: bad as never });
      expect(result.requestedSource).toBeNull();
    }
  });

  it('sem nenhum dado: estado "sem dados", nunca zero', async () => {
    const result = await service({}).forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    for (const i of result.indicators) expect(i.state).toBe('sem_dados');
    expect(result.sleep.state).toBe('sem_dados');
  });

  it('duas fontes de HRV: nunca misturadas; a principal e a padrao; a pedida troca; fonte inexistente avisa', async () => {
    const hrv = [
      ...Array.from({ length: 10 }, (_, i) => hrvRow('zepp', 'zepp-1', day(20 + i), 48)),
      ...Array.from({ length: 4 }, (_, i) => hrvRow('health_connect', 'com.sec.android.app.shealth|h', day(26 + i), 52)),
    ];
    const svc = service({ hrv });
    const auto = (await svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30' })).indicators.find((i) => i.id === 'hrv')!;
    expect(auto.mixedSources).toBe(true);
    expect(auto.sources.map((s) => s.key)).toEqual(['zepp', 'health_connect:com.sec.android.app.shealth']);
    expect(auto.selectedSource).toBe('zepp');
    expect(auto.summary.n).toBe(10);
    expect(auto.methodNote).toMatch(/não especifica a unidade/);
    const hc = (await svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30', source: 'health_connect:com.sec.android.app.shealth' })).indicators.find((i) => i.id === 'hrv')!;
    expect(hc.selectedSource).toBe('health_connect:com.sec.android.app.shealth');
    expect(hc.summary.n).toBe(4);
    expect(hc.summary.mean).toBe(52);
    expect(hc.methodNote).toMatch(/RMSSD/);
    const missing = (await svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30', source: 'polar' })).indicators.find((i) => i.id === 'hrv')!;
    expect(missing.state).toBe('fonte_sem_este_indicador');
    expect(missing.points).toEqual([]);
  });

  it('fonte principal que parou de enviar: a mais recente passa a ser a padrao', async () => {
    const now = new Date();
    const iso = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    const hrv = [
      ...Array.from({ length: 30 }, (_, i) => hrvRow('zepp', 'z', iso(60 + i), 48)),
      ...Array.from({ length: 5 }, (_, i) => hrvRow('health_connect', 'com.sec.android.app.shealth|h', iso(1 + i), 52)),
    ];
    const result = await service({ hrv }).forStudent('s1', { from: iso(120), to: iso(0) });
    const block = result.indicators.find((i) => i.id === 'hrv')!;
    expect(block.mainSource).toBe('health_connect:com.sec.android.app.shealth');
  });

  it('sono: noite dividida soma, sobreposicao parcial fica sem total e e contada em nightsWithoutSafeTotal', async () => {
    const sleep = [
      sleepRow('a', 'health_connect', 'com.sec.android.app.shealth|1', '2026-10-21', '2026-10-20T23:00', 300),
      sleepRow('b', 'health_connect', 'com.sec.android.app.shealth|2', '2026-10-21', '2026-10-21T04:30', 120),
      sleepRow('c', 'health_connect', 'com.sec.android.app.shealth|3', '2026-10-22', '2026-10-21T23:00', 360),
      sleepRow('d', 'health_connect', 'com.sec.android.app.shealth|4', '2026-10-22', '2026-10-22T04:00', 180),
    ];
    const result = await service({ sleep }).forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    expect(result.sleep.nights).toHaveLength(2);
    expect(result.sleep.nights[0].totalMin).toBe(420);
    expect(result.sleep.nights[1].totalMin).toBeNull();
    expect(result.sleep.nightsWithoutSafeTotal).toBe(1);
    expect(result.sleep.summary.n).toBe(1); // so' a noite com total determinado entra na media
    expect(result.sleep.summary.mean).toBe(420);
  });

  it('sono de fonte NAO autorizada nao aparece', async () => {
    const sleep = [sleepRow('a', 'zepp', 'z', '2026-10-21', '2026-10-20T23:00', 420)];
    const result = await service({ sleep, authorized: { zepp: { sleep: false, hrv: true, resting_heart_rate: true, daily: true } } }).forStudent('s1', {});
    expect(result.sleep.nights).toEqual([]);
    expect(result.sleep.state).toBe('nao_autorizada');
  });

  it('entradas invalidas viram 400 e aluno inexistente vira 404', async () => {
    const svc = service({});
    await expect(svc.forStudent('s1', { from: '2026-10-30', to: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.forStudent('s1', { from: 'ontem' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.forStudent('s1', { compareFrom: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    const missing = new StudentHealthRecoveryService({ user: { findUnique: jest.fn().mockResolvedValue(null) } } as never, {} as never, math);
    await expect(missing.forStudent('x', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('somente leitura: nenhum metodo de escrita do banco e chamado', async () => {
    const svc = service({ daily: [dailyRow('zepp', '2026-10-20', { steps: 1000 })] });
    await svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    expect(true).toBe(true); // o fake nao define create/update/upsert/delete: qualquer chamada lancaria
  });
});

describe('estrutura: somente leitura e restrito ao treinador', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  const read = (file: string) => readFileSync(join(__dirname, '..', 'src', 'coach', file), 'utf8');

  it('o servico e as funcoes puras nao escrevem no banco (nenhum create/update/upsert/delete/executeRaw)', () => {
    for (const file of ['student-health-recovery.service.ts', 'health-recovery.ts']) {
      expect(read(file)).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe)\s*\(/);
    }
  });

  it('a rota fica no controller do treinador (guarda de papel da classe) e o servico esta no modulo', () => {
    const controller = read('coach.controller.ts');
    expect(controller).toMatch(/@Roles\('coach', 'admin'\)\s*\n?\s*@Controller\('coach'\)/);
    expect(controller).toContain("@Get('students/:studentId/health-recovery')");
    expect(read('coach.module.ts')).toContain('StudentHealthRecoveryService');
  });

  it('as tres leituras sao filtradas pela autorizacao por categoria e nao ha leitura do token ou segredo da conexao', () => {
    const source = read('student-health-recovery.service.ts');
    expect(source).toContain('this.integrations.forStudent');
    expect(source).not.toMatch(/accessToken|refreshToken|externalAccountId/);
  });
});
