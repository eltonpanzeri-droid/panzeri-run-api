import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeHrDecoupling, HR_DECOUPLING_CATEGORIES, hrDecouplingCategoryOf, hrDecouplingVariableId, SeriesPointInput } from '../src/training-intelligence/hr-decoupling';
import { ensureHrDecouplings } from '../src/training-intelligence/hr-decoupling-store';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { evidenceKindOf, getVariableDefinition } from '../src/training-intelligence/variable-registry';
import { explorerInfoOf } from '../src/training-intelligence/explorer-catalog';
import { ACCOUNT_DELETE_ORDER } from '../src/account-deletion/account-deletion.service';

// 03/11/2026 — desacoplamento da frequencia cardiaca: formula, elegibilidade (CV <= 10% e diferenca entre metades <= 5%, limites inclusivos), cinco faixas de duracao, dados ausentes/invalidos,
// persistencia idempotente e leitura por faixa. Series sinteticas de 1 amostra por segundo.
const MINUTES = 40; // 2400 s: faixa de 30 a 60 min

function series(speedOf: (t: number, n: number) => number | null, hrOf: (t: number, n: number) => number | null, seconds = MINUTES * 60): SeriesPointInput[] {
  const points: SeriesPointInput[] = [];
  for (let t = 0; t <= seconds; t++) points.push({ offsetSec: t, speedKmh: speedOf(t, seconds), heartRateBpm: hrOf(t, seconds) });
  return points;
}
const firstHalf = (t: number, n: number) => t < n / 2;

describe('desacoplamento — formula', () => {
  it('positivo: FC maior na segunda metade com a mesma velocidade → 100 × (1 − R2/R1)', () => {
    const r = computeHrDecoupling(series(() => 10, (t, n) => (firstHalf(t, n) ? 140 : 147)));
    expect(r.eligible).toBe(true);
    expect(r.r1).toBeCloseTo(10 / 140, 10);
    expect(r.r2).toBeCloseTo(10 / 147, 10);
    expect(r.decouplingPct).toBeCloseTo(100 * (1 - 140 / 147), 8);
    expect(r.decouplingPct!).toBeGreaterThan(0);
  });

  it('negativo: FC menor na segunda metade → valor negativo preservado', () => {
    const r = computeHrDecoupling(series(() => 10, (t, n) => (firstHalf(t, n) ? 147 : 140)));
    expect(r.eligible).toBe(true);
    expect(r.decouplingPct).toBeCloseTo(100 * (1 - 147 / 140), 8);
    expect(r.decouplingPct!).toBeLessThan(0);
  });

  it('zero: mesma relacao velocidade/FC nas duas metades → exatamente 0, ainda elegivel', () => {
    const r = computeHrDecoupling(series(() => 10, () => 150));
    expect(r.eligible).toBe(true);
    expect(r.decouplingPct).toBe(0);
  });

  it('o trecho e dividido em duas metades de igual duracao e guarda o rastro (medias, trecho, cobertura)', () => {
    const r = computeHrDecoupling(series(() => 10, () => 150));
    expect(r).toMatchObject({ analyzedStartSec: 0, analyzedEndSec: MINUTES * 60, category: 'd30', meanSpeed1: 10, meanSpeed2: 10, meanHr1: 150, meanHr2: 150, pointCount: MINUTES * 60 + 1 });
    expect(r.coverageSpeed1).toBeGreaterThanOrEqual(0.99);
    expect(r.coverageHr2).toBeGreaterThanOrEqual(0.99);
  });
});

describe('desacoplamento — elegibilidade', () => {
  // velocidade alternando 11 / 9 a cada segundo: media 10, desvio 1 → CV exatamente 10%; metades iguais (diferenca 0)
  const EVEN = MINUTES * 60 - 1;
  const alternating = (hi: number, lo: number) => (t: number) => (t % 2 === 0 ? hi : lo);

  it('CV exatamente 10% e elegivel (limite inclusivo)', () => {
    const r = computeHrDecoupling(series(alternating(11, 9), () => 150, EVEN)); // numero par de amostras: media exatamente 10
    expect(r.speedCvPct).toBe(10);
    expect(r.eligible).toBe(true);
  });

  it('CV acima de 10% exclui, mesmo com metades iguais (so um criterio falha)', () => {
    const r = computeHrDecoupling(series(alternating(12, 8), () => 150, EVEN));
    expect(r.speedCvPct!).toBeCloseTo(20, 6);
    expect(r.halfDiffPct!).toBeLessThan(5);
    expect(r).toMatchObject({ eligible: false, exclusionReason: 'cv_velocidade_acima_do_limite' });
    expect(r.decouplingPct).not.toBeNull(); // valor guardado para auditoria, mas nao entra no historico
  });

  it('diferenca entre metades exatamente 5% e elegivel (limite inclusivo)', () => {
    const r = computeHrDecoupling(series((t, n) => (firstHalf(t, n) ? 10 : 10.5), () => 150));
    expect(r.halfDiffPct).toBe(5);
    expect(r.eligible).toBe(true);
  });

  it('diferenca acima de 5% exclui, mesmo com CV baixo (so um criterio falha)', () => {
    const r = computeHrDecoupling(series((t, n) => (firstHalf(t, n) ? 10 : 11), () => 150));
    expect(r.speedCvPct!).toBeLessThan(10);
    expect(r).toMatchObject({ eligible: false, exclusionReason: 'diferenca_entre_metades_acima_do_limite' });
  });

  it('os dois criterios falhando → motivo combinado', () => {
    const r = computeHrDecoupling(series((t, n) => (firstHalf(t, n) ? (t % 2 === 0 ? 14 : 6) : (t % 2 === 0 ? 17 : 8)), () => 150));
    expect(r.exclusionReason).toBe('cv_e_diferenca_acima_do_limite');
  });
});

describe('desacoplamento — faixas de duracao', () => {
  it('limites: 30–<60, 60–<90, 90–<120, 120–150 (150 inclusive), >150; menos de 30 sem faixa', () => {
    expect(hrDecouplingCategoryOf(29.99)).toBeNull();
    expect(hrDecouplingCategoryOf(30)).toBe('d30');
    expect(hrDecouplingCategoryOf(59.99)).toBe('d30');
    expect(hrDecouplingCategoryOf(60)).toBe('d60');
    expect(hrDecouplingCategoryOf(89.99)).toBe('d60');
    expect(hrDecouplingCategoryOf(90)).toBe('d90');
    expect(hrDecouplingCategoryOf(119.99)).toBe('d90');
    expect(hrDecouplingCategoryOf(120)).toBe('d120');
    expect(hrDecouplingCategoryOf(150)).toBe('d120');
    expect(hrDecouplingCategoryOf(150.01)).toBe('d150');
    expect([...HR_DECOUPLING_CATEGORIES]).toEqual(['d30', 'd60', 'd90', 'd120', 'd150']);
  });

  it('a faixa vem da duracao em movimento da propria serie', () => {
    expect(computeHrDecoupling(series(() => 10, () => 150, 65 * 60)).category).toBe('d60');
    expect(computeHrDecoupling(series(() => 10, () => 150, 95 * 60)).category).toBe('d90');
  });

  it('corrida com menos de 30 minutos em movimento nao tem faixa e nao e elegivel', () => {
    const r = computeHrDecoupling(series(() => 10, () => 150, 20 * 60));
    expect(r).toMatchObject({ eligible: false, category: null, exclusionReason: 'duracao_fora_das_faixas' });
  });
});

describe('desacoplamento — dados ausentes e invalidos', () => {
  it('sem serie → sem_serie_temporal; sem FC ou sem velocidade → sem_amostras_validas (nunca zero)', () => {
    expect(computeHrDecoupling([])).toMatchObject({ eligible: false, exclusionReason: 'sem_serie_temporal', decouplingPct: null });
    expect(computeHrDecoupling(series(() => 10, () => null))).toMatchObject({ eligible: false, exclusionReason: 'sem_amostras_validas', decouplingPct: null });
    expect(computeHrDecoupling(series(() => null, () => 150))).toMatchObject({ eligible: false, exclusionReason: 'sem_amostras_validas' });
  });

  it('amostras invalidas (FC fora de 30–230, velocidade <= 0) sao descartadas e contadas', () => {
    const r = computeHrDecoupling(series((t) => (t % 100 === 0 ? 0 : 10), (t) => (t % 50 === 0 ? 250 : t % 70 === 0 ? 20 : 150)));
    expect(r.discardedSpeedSamples).toBeGreaterThan(0);
    expect(r.discardedHrSamples).toBeGreaterThan(0);
    expect(r.validHrSamples + r.discardedHrSamples).toBe(MINUTES * 60 + 1);
    expect(r.eligible).toBe(true);
  });

  it('metade com menos de 80% do tempo coberto → cobertura_insuficiente (sem interpolar)', () => {
    const r = computeHrDecoupling(series(() => 10, (t, n) => (t > n * 0.6 && t < n * 0.95 ? null : 150)));
    expect(r).toMatchObject({ eligible: false, exclusionReason: 'cobertura_insuficiente' });
    expect(r.coverageHr2!).toBeLessThan(0.8);
    expect(r.gapCount).toBeGreaterThan(0);
  });

  it('lacuna maior que 10 s nao conta como tempo coberto', () => {
    const r = computeHrDecoupling(series(() => 10, (t) => (t >= 600 && t < 900 ? null : 150)));
    expect(r.gapCount).toBeGreaterThanOrEqual(1);
    expect(r.coverageHr1!).toBeLessThan(1);
  });
});

describe('desacoplamento — persistencia idempotente', () => {
  const points = series(() => 10, (t, n) => (firstHalf(t, n) ? 140 : 147)).map((p) => ({ ...p, normalizationVersion: 1 }));

  function fakePrisma(stored: Record<string, unknown> | null, pointCount: number) {
    return {
      activityTimeSeriesPoint: { groupBy: jest.fn().mockResolvedValue(pointCount ? [{ activityLogId: 'a1', _count: { _all: pointCount } }] : []), findMany: jest.fn().mockResolvedValue(points) },
      activityHrDecoupling: { findMany: jest.fn().mockResolvedValue(stored ? [stored] : []), upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ ...create })) },
    };
  }

  it('calcula e grava quando nao existe; nao regrava quando a quantidade de pontos nao mudou', async () => {
    const first = fakePrisma(null, points.length);
    const rows = await ensureHrDecouplings(first as never, ['a1']);
    expect(first.activityHrDecoupling.upsert).toHaveBeenCalledTimes(1);
    expect(rows.get('a1')).toMatchObject({ eligible: true, category: 'd30' });

    const saved = { ...(first.activityHrDecoupling.upsert.mock.calls[0][0].create as object), pointCount: points.length };
    const second = fakePrisma(saved, points.length);
    await ensureHrDecouplings(second as never, ['a1']);
    expect(second.activityHrDecoupling.upsert).not.toHaveBeenCalled();
    expect(second.activityTimeSeriesPoint.findMany).not.toHaveBeenCalled();
  });

  it('recalcula quando a serie mudou (outra quantidade de pontos)', async () => {
    const stale = fakePrisma({ activityLogId: 'a1', algorithmVersion: 1, pointCount: 10, eligible: false, category: null, exclusionReason: 'trecho_curto' }, points.length);
    const rows = await ensureHrDecouplings(stale as never, ['a1']);
    expect(stale.activityHrDecoupling.upsert).toHaveBeenCalledTimes(1);
    expect(rows.get('a1')?.eligible).toBe(true);
  });

  it('atividade sem serie guarda a exclusao sem_serie_temporal (e e relida sem custo)', async () => {
    const none = fakePrisma(null, 0);
    const rows = await ensureHrDecouplings(none as never, ['a1']);
    expect(rows.get('a1')).toMatchObject({ eligible: false, exclusionReason: 'sem_serie_temporal' });
    expect(none.activityTimeSeriesPoint.findMany).not.toHaveBeenCalled();
  });

  it('falha ao gravar nao derruba a leitura: usa o resultado recem-calculado', async () => {
    const broken = fakePrisma(null, points.length);
    broken.activityHrDecoupling.upsert.mockRejectedValue(new Error('conflito'));
    const rows = await ensureHrDecouplings(broken as never, ['a1']);
    expect(rows.get('a1')?.eligible).toBe(true);
  });
});

describe('desacoplamento — leitura por faixa', () => {
  const log = (id: string, startedAt: string) => ({ id, userId: 's1', startedAt: new Date(startedAt), provider: 'polar', sport: 'RUNNING', executionClassification: 'alternative', physicalIdentityStatus: 'unique', durationSec: 2400, distanceMeters: 6000 });
  const stored = (activityLogId: string, over: Record<string, unknown>) => ({ activityLogId, algorithmVersion: 1, pointCount: 5, eligible: true, category: 'd30', exclusionReason: null, decouplingPct: 2, ...over });

  function readerWith(rows: unknown[], logs: unknown[]) {
    const prisma = {
      activityLog: { findMany: jest.fn().mockResolvedValue(logs) },
      activityTimeSeriesPoint: { groupBy: jest.fn().mockResolvedValue((logs as Array<{ id: string }>).map((l) => ({ activityLogId: l.id, _count: { _all: 5 } }))), findMany: jest.fn() },
      activityHrDecoupling: { findMany: jest.fn().mockResolvedValue(rows), upsert: jest.fn() },
      sessionExecutionLink: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new ObservationReaderService(prisma as never, {} as never, new MathLayerService());
  }

  const logs = [log('a', '2026-10-01T10:00:00Z'), log('b', '2026-10-05T10:00:00Z'), log('c', '2026-10-08T10:00:00Z'), log('d', '2026-10-10T10:00:00Z')];
  const rows = [stored('a', { decouplingPct: 2.5 }), stored('b', { category: 'd60', decouplingPct: 4 }), stored('c', { eligible: false, exclusionReason: 'cv_velocidade_acima_do_limite', decouplingPct: 9 }), stored('d', { decouplingPct: -1.5 })];

  it('cada variavel devolve so as corridas ELEGIVEIS da sua faixa, com o rastro da atividade', async () => {
    const reader = readerWith(rows, logs);
    const d30 = await reader.getObservations('s1', hrDecouplingVariableId('d30'));
    expect(d30.map((o) => [o.context.activityLogId, o.value])).toEqual([['a', 2.5], ['d', -1.5]]);
    const d60 = await reader.getObservations('s1', hrDecouplingVariableId('d60'));
    expect(d60.map((o) => [o.context.activityLogId, o.value])).toEqual([['b', 4]]);
    expect(await reader.getObservations('s1', hrDecouplingVariableId('d90'))).toEqual([]);
  });
});

describe('desacoplamento — registro e protecao de dados', () => {
  it('cinco variaveis irmas, por corrida, calculadas pelo servidor, em resposta ao esforco', () => {
    for (const category of HR_DECOUPLING_CATEGORIES) {
      const definition = getVariableDefinition(hrDecouplingVariableId(category))!;
      expect(definition).toMatchObject({ source: 'activity_objective', expectedFrequency: 'per_workout', missingPolicy: 'never_impute', scale: { unit: '%' } });
      expect(evidenceKindOf(definition)).toBeDefined();
      expect(explorerInfoOf(definition).subgroup).toBe('intensidade_resposta');
    }
  });

  it('o resultado derivado sai junto com a conta, o provedor e a atividade apagada', () => {
    expect(ACCOUNT_DELETE_ORDER.indexOf('activityHrDecoupling' as never)).toBeGreaterThan(-1);
    expect(ACCOUNT_DELETE_ORDER.indexOf('activityHrDecoupling' as never)).toBeLessThan(ACCOUNT_DELETE_ORDER.indexOf('activityLog'));
    const src = (file: string) => readFileSync(join(__dirname, '..', 'src', 'activity-execution', file), 'utf8');
    expect(src('provider-data-deletion.service.ts')).toContain('activityHrDecoupling');
    expect(src('session-execution-link.service.ts')).toContain('activityHrDecoupling');
  });

  it('o texto da ordem proibe o nome antigo: nenhuma string do indicador diz "desacoplamento aerobio"', () => {
    for (const file of ['hr-decoupling.ts', 'hr-decoupling-store.ts', 'variable-registry.ts']) {
      const text = readFileSync(join(__dirname, '..', 'src', 'training-intelligence', file), 'utf8').toLowerCase();
      expect(text).not.toContain('desacoplamento aerobio');
      expect(text).not.toContain('desacoplamento aeróbio');
    }
  });
});
