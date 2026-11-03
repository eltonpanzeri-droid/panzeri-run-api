import { GOOGLE_REVIEW_EMAIL_PREFIX, normalizeReviewEmail, recoveryDemoRows, REVIEW_EMAIL_PREFIX, seedRecoveryData, seedReviewAccount } from '../src/app-review/review-accounts';
import { buildRecoverySummary } from '../src/me/recovery-summary';

// 03/11/2026 — conta de revisao do GOOGLE Play (login invalido na declaracao da versao 15). Dados 100% sinteticos, sem aleatorio, so' dos tipos que o app pede ao Android.
describe('conta de revisao do Google', () => {
  const NOW = new Date('2026-11-03T15:00:00.000Z');
  const rows = recoveryDemoRows('user-google', NOW);

  it('e-mail: aceita revisao-apple- e revisao-google-; qualquer outro e recusado', () => {
    expect(normalizeReviewEmail('Revisao-Google-Ativa@panzerirun.com')).toBe('revisao-google-ativa@panzerirun.com');
    expect(normalizeReviewEmail('revisao-apple-ativa@panzerirun.com')).toBe('revisao-apple-ativa@panzerirun.com');
    expect(() => normalizeReviewEmail('aluna@gmail.com')).toThrow(/revisao-apple-.*revisao-google-/);
    expect(GOOGLE_REVIEW_EMAIL_PREFIX).not.toBe(REVIEW_EMAIL_PREFIX);
  });

  it('nunca mistura as contas: kind google exige e-mail do Google e vice-versa (recusa antes de tocar no banco)', async () => {
    const prisma = {} as never; // qualquer acesso ao banco derrubaria o teste
    await expect(seedReviewAccount(prisma, { kind: 'google', email: 'revisao-apple-ativa@panzerirun.com', password: 'senha-de-teste-longa' })).rejects.toThrow(/Nada foi alterado/);
    await expect(seedReviewAccount(prisma, { kind: 'active', email: 'revisao-google-ativa@panzerirun.com', password: 'senha-de-teste-longa' })).rejects.toThrow(/Nada foi alterado/);
    await expect(seedReviewAccount(prisma, { kind: 'google', email: 'revisao-google-ativa@panzerirun.com', password: 'curta' })).rejects.toThrow(/pelo menos 12/);
  });

  it('35 dias de recuperacao: sono, VFC e dia a dia por dia; VO2 max semanal; so provider health_connect e marca de demonstracao', () => {
    expect(rows.sleep).toHaveLength(35);
    expect(rows.hrv).toHaveLength(35);
    expect(rows.daily).toHaveLength(35);
    expect(rows.metrics).toHaveLength(5);
    for (const row of [...rows.sleep, ...rows.hrv, ...rows.daily, ...rows.metrics]) {
      expect(row.userId).toBe('user-google');
      expect(row.provider).toBe('health_connect');
      expect(String(row.providerSummaryId)).toMatch(/^review-demo\|/);
    }
    expect(rows.daily[rows.daily.length - 1].calendarDate).toBe('2026-11-03');
    expect(rows.daily[0].calendarDate).toBe('2026-09-30');
  });

  it('chaves unicas por tabela (nada duplica) e valores plausiveis', () => {
    const unique = (list: Array<{ calendarDate?: string | null; startTimeSec: number }>) => new Set(list.map((r) => `${r.calendarDate}|${r.startTimeSec}`)).size;
    expect(unique(rows.sleep)).toBe(35);
    expect(unique(rows.hrv)).toBe(35);
    expect(unique(rows.daily)).toBe(35);
    expect(new Set(rows.metrics.map((m) => m.identityKey)).size).toBe(5);
    for (const s of rows.sleep) expect((s.durationSec as number) / 3600).toBeGreaterThanOrEqual(5.5), expect((s.durationSec as number) / 3600).toBeLessThanOrEqual(8.5);
    for (const h of rows.hrv) expect(h.lastNightAvg).toBeGreaterThan(35), expect(h.lastNightAvg).toBeLessThan(75);
    for (const d of rows.daily) expect(d.restingHeartRateBpm as number).toBeGreaterThanOrEqual(52), expect(d.restingHeartRateBpm as number).toBeLessThanOrEqual(62), expect(d.steps as number).toBeGreaterThan(3000);
  });

  it('deterministico: o mesmo dia gera sempre os mesmos valores (sem aleatorio)', () => {
    expect(recoveryDemoRows('user-google', NOW)).toEqual(rows);
  });

  it('so os tipos que o app pede ao Android: nada de saturacao, respiracao, nutricao, hidratacao nem calorias totais', () => {
    const kinds = new Set(rows.metrics.map((m) => m.metricKind));
    expect([...kinds]).toEqual(['vo2_max']);
    for (const d of rows.daily) expect(d).not.toHaveProperty('totalKilocalories');
  });

  it('a tela "Minha recuperacao" mostra sono, VFC, FC de repouso, passos, calorias ativas e VO2 max com esses dados', () => {
    const summary = buildRecoverySummary({
      sleep: rows.sleep.map((r) => ({ provider: r.provider, providerSummaryId: r.providerSummaryId ?? null, calendarDate: r.calendarDate, durationSec: r.durationSec ?? null })),
      hrv: rows.hrv.map((r) => ({ provider: r.provider, providerSummaryId: r.providerSummaryId ?? null, calendarDate: r.calendarDate, lastNightAvg: r.lastNightAvg, hrvValues: r.hrvValues })),
      daily: rows.daily.map((r) => ({ provider: r.provider, providerSummaryId: r.providerSummaryId ?? null, calendarDate: r.calendarDate, steps: r.steps ?? null, activeKilocalories: r.activeKilocalories ?? null, restingHeartRateBpm: r.restingHeartRateBpm ?? null })),
      metrics: rows.metrics.map((r) => ({ provider: r.provider, providerSummaryId: r.providerSummaryId ?? null, metricKind: r.metricKind, calendarDate: r.calendarDate ?? null, startTimeSec: r.startTimeSec, values: r.values })),
      now: NOW,
      days: 30,
      sourceName: (key: string) => key,
    } as never);
    expect(summary.empty).toBe(false);
    // uma unica origem: cada indicador tem os ~30 dias (nao 1) e nenhuma nota de "outras fontes"
    for (const indicator of summary.indicators) {
      expect(indicator.sourceKey).toBe('health_connect:review-demo');
      expect(indicator.note ?? '').not.toContain('outras fontes');
    }
    expect(summary.indicators.find((i) => i.id === 'sleep')?.days).toBeGreaterThanOrEqual(30);
    expect(summary.indicators.find((i) => i.id === 'steps')?.days).toBeGreaterThanOrEqual(30);
    // nao pede autorizar o que o app nao oferece mais no Android
    expect(summary.unavailable.map((u) => u.id)).toEqual([]);
    const ids = summary.indicators.map((i) => i.id);
    for (const expected of ['sleep', 'hrv.rmssd', 'restingHr', 'steps', 'activeKcal', 'vo2']) expect(ids).toContain(expected);
  });

  it('seedRecoveryData apaga SO os dados do proprio usuario e regrava (idempotente)', async () => {
    const calls: string[] = [];
    const model = (name: string) => ({ deleteMany: jest.fn(async (args: { where: { userId: string } }) => { calls.push(`${name}.delete:${args.where.userId}`); }), createMany: jest.fn(async (args: { data: unknown[] }) => { calls.push(`${name}.create:${args.data.length}`); }) });
    const tx = { wearableSleepSummary: model('sleep'), wearableHrvSummary: model('hrv'), wearableDailySummary: model('daily'), wearableMetricRecord: model('metric') };
    await seedRecoveryData(tx as never, 'user-google', NOW);
    expect(calls.filter((c) => c.includes('.delete:')).every((c) => c.endsWith(':user-google'))).toBe(true);
    expect(calls.filter((c) => c.includes('.create:'))).toEqual(['sleep.create:35', 'hrv.create:35', 'daily.create:35', 'metric.create:5']);
  });
});
