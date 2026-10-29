import { AI_INDICATOR_CATEGORY, INDICATOR_CATALOG, MetricRow, buildIndicatorSeries } from '../src/training-intelligence/health-indicators';
import { HealthIndicatorsService } from '../src/training-intelligence/health-indicators.service';
import { runWithAiScope } from '../src/ai-governance/ai-scope';
import { HEALTH_AI_CATEGORIES } from '../src/ai-governance/ai-data-eligibility.service';
import { APPLE_RECORD_CATEGORY } from '../src/apple-health/apple-health-records';

// Acesso seletivo da IA aos indicadores de saude autorizados (29/10/2026). Dados SINTETICOS.

const row = (over: Partial<MetricRow> & { values: Record<string, unknown> }): MetricRow => ({ provider: 'apple_health', providerSummaryId: 'com.apple.health|x', metricKind: 'body_composition', calendarDate: '2026-10-20', startTimeSec: Date.parse('2026-10-20T03:00:00Z') / 1000, ...over });
const all = () => true;

describe('catalogo e categorias de IA', () => {
  it('todo indicador do catalogo pertence a um tipo com categoria de IA permitida; pressao, glicemia e ciclo nunca entram', () => {
    for (const def of INDICATOR_CATALOG) {
      const category = AI_INDICATOR_CATEGORY[def.kind];
      expect({ kind: def.kind, category: Boolean(category) }).toEqual({ kind: def.kind, category: true });
      expect(HEALTH_AI_CATEGORIES as readonly string[]).toContain(category);
      expect(def.kind in APPLE_RECORD_CATEGORY).toBe(true);
    }
    for (const sensitive of ['clinical_vitals', 'menstrual_cycle']) {
      expect(Object.keys(AI_INDICATOR_CATEGORY)).not.toContain(sensitive);
      expect(Object.values(AI_INDICATOR_CATEGORY)).not.toContain(sensitive);
    }
    expect(Object.values(AI_INDICATOR_CATEGORY)).not.toContain('activity_route');
  });
});

describe('series de indicadores', () => {
  it('preserva valor, unidade e origem; zero informado e valor; chave de metadados e nao numerico ficam de fora', () => {
    const series = buildIndicatorSeries([
      row({ values: { bodyMassKg: 70.4, bodyFatFraction: 0, note: 'x', _origin: { dataOrigin: 'com.apple.health', device: null } } }),
      row({ calendarDate: '2026-10-21', startTimeSec: Date.parse('2026-10-21T03:00:00Z') / 1000, values: { bodyMassKg: 70.1 } }),
    ], all);
    const mass = series.find((s) => s.id === 'body_composition.bodyMassKg')!;
    expect(mass).toMatchObject({ rotulo: 'Peso corporal', unidade: 'kg', categoria: 'body_composition', fonte: 'apple_health', dias: 2, ultimo: 70.1, minimo: 70.1, maximo: 70.4, origem: 'com.apple.health' });
    expect(series.find((s) => s.id === 'body_composition.bodyFatFraction')).toMatchObject({ ultimo: 0, dias: 1 });
    expect(series.find((s) => s.id.endsWith('.note'))).toBeUndefined();
    expect(series.find((s) => s.id.endsWith('._origin'))).toBeUndefined();
  });

  it('fontes diferentes nao se misturam (Apple x Health Connect por app de origem)', () => {
    const series = buildIndicatorSeries([
      row({ provider: 'apple_health', values: { bodyMassKg: 70 } }),
      row({ provider: 'health_connect', providerSummaryId: 'com.sec.android.app.shealth|w1', values: { bodyMassKg: 71 } }),
      row({ provider: 'health_connect', providerSummaryId: 'com.other|w2', values: { bodyMassKg: 72 } }),
    ], all);
    expect(series.map((s) => `${s.fonte}=${s.ultimo}`).sort()).toEqual(['apple_health=70', 'health_connect:com.other=72', 'health_connect:com.sec.android.app.shealth=71']);
  });

  it('o que o aluno nao autorizou (ou retirou) e tratado como inexistente', () => {
    const rows = [row({ values: { bodyMassKg: 70 } }), row({ metricKind: 'pulse_ox', values: { oxygenSaturationFractionAvg: 0.97 } })];
    const noBody = buildIndicatorSeries(rows, (_provider, category) => category !== 'body_composition');
    expect(noBody.map((s) => s.categoria)).toEqual(['pulse_ox']);
    expect(buildIndicatorSeries(rows, () => false)).toEqual([]);
  });

  it('tipos sem categoria de IA (ciclo, pressao) e tipos desconhecidos nunca viram indicador', () => {
    const series = buildIndicatorSeries([
      row({ metricKind: 'menstrual_cycle', values: { menstrualFlow: [2] } }),
      row({ metricKind: 'clinical_vitals', values: { systolicMmHgAvg: 120 } }),
      row({ metricKind: 'algo_novo', values: { x: 1 } }),
    ], all);
    expect(series).toEqual([]);
  });

  it('chave desconhecida de um tipo permitido entra pelo caminho generico, com unidade da origem (nada util e descartado)', () => {
    const [s] = buildIndicatorSeries([row({ metricKind: 'vo2_max', provider: 'health_connect', providerSummaryId: 'com.x|1', values: { vo2MillilitersPerMinuteKilogram: 48.5 } })], all);
    expect(s).toMatchObject({ id: 'vo2_max.vo2MillilitersPerMinuteKilogram', unidade: 'unidade original da origem', ultimo: 48.5 });
  });

  it('resumo: ultimos valores limitados, estatistica descritiva e limite de series', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ calendarDate: `2026-10-${String(10 + i).padStart(2, '0')}`, startTimeSec: Date.parse(`2026-10-${10 + i}T03:00:00Z`) / 1000, values: { bodyMassKg: 70 + i } }));
    const [s] = buildIndicatorSeries(rows, all, { lastValues: 7 });
    expect(s.dias).toBe(12);
    expect(s.ultimosValores).toHaveLength(7);
    expect(s.ultimosValores[6]).toEqual({ date: '2026-10-21', value: 81 });
    expect(s.media).toBe(75.5);
    const many = buildIndicatorSeries([row({ metricKind: 'mobility', values: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])) })], all, { maxSeries: 5 });
    expect(many).toHaveLength(5);
  });
});

describe('servico: so entra na IA com escopo e com autorizacao', () => {
  const prisma = (rows: MetricRow[]) => ({ wearableMetricRecord: { findMany: jest.fn(async () => rows) } }) as never;
  const rows = [row({ values: { bodyMassKg: 70 } }), row({ metricKind: 'pulse_ox', values: { oxygenSaturationFractionAvg: 0.97 } })];

  it('sem escopo de IA nada sai (fail-closed)', async () => {
    const service = new HealthIndicatorsService(prisma(rows));
    expect(await service.summary('u1', { now: new Date('2026-10-29T12:00:00Z') })).toBeNull();
    expect(await service.query('u1', { from: new Date('2026-10-01'), to: new Date('2026-10-29') })).toEqual([]);
  });

  it('com escopo: categorias bloqueadas saem; as demais chegam; consulta por indicador devolve so o pedido', async () => {
    const service = new HealthIndicatorsService(prisma(rows));
    const scope = { userId: 'u1', destination: 'external_ai' as const, blocked: [], blockedHealth: ['apple_health:body_composition'], computedAt: Date.now() };
    await runWithAiScope(scope, async () => {
      const summary = await service.summary('u1', { now: new Date('2026-10-29T12:00:00Z') });
      expect(summary?.indicadores.map((i) => i.id)).toEqual(['pulse_ox.oxygenSaturationFractionAvg']);
      expect(summary?.observacao).toContain('SDNN');
      expect(await service.query('u1', { indicatorIds: ['body_composition.bodyMassKg'], from: new Date('2026-10-01'), to: new Date('2026-10-29') })).toEqual([]);
      expect((await service.query('u1', { indicatorIds: ['pulse_ox.oxygenSaturationFractionAvg'], from: new Date('2026-10-01'), to: new Date('2026-10-29') })).length).toBe(1);
    });
    const open = { ...scope, blockedHealth: [] };
    await runWithAiScope(open, async () => {
      expect((await service.summary('u1', { now: new Date('2026-10-29T12:00:00Z') }))?.indicadores).toHaveLength(2);
    });
  });

  it('provedor inteiro bloqueado (consentimento retirado) tira tudo dele', async () => {
    const service = new HealthIndicatorsService(prisma(rows));
    await runWithAiScope({ userId: 'u1', destination: 'external_ai', blocked: ['apple_health'], blockedHealth: [], computedAt: Date.now() }, async () => {
      expect(await service.summary('u1', { now: new Date('2026-10-29T12:00:00Z') })).toBeNull();
    });
  });
});
