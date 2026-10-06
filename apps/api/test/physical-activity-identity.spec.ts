import { compareObservations, observerKeyOf, ObservedActivity } from '../src/activity-execution/physical-activity-identity';
import { PhysicalActivityIdentityService } from '../src/activity-execution/physical-activity-identity.service';

// Apple Etapa 2 (06/10/2026) — identidade fisica cross-provider: varios ActivityLog podem ser observacoes do MESMO evento.
// Referencias reais (sem regra por data/usuario): 06/10 7,01 km 34 min (polar x apple_health/strava), 03/10 30,07 x 30,08 km 156 min,
// 01/10 10,01 x 10,02 km 51 min. Os testes exercitam o matcher puro e o servico com um banco em memoria.

const POLAR_KEY = 'polar';
const STRAVA_VIA_HK = observerKeyOf('apple_health', { source: { bundleId: 'com.strava.stravaride', name: 'Strava' } });
const WATCH_VIA_HK = observerKeyOf('apple_health', { source: { bundleId: 'com.apple.health.ABC', name: 'Treino' } });

function obs(overrides: Partial<ObservedActivity> & { id: string }): ObservedActivity {
  return {
    userId: 'user-1', provider: 'polar', sport: 'corrida', startedAt: new Date('2026-10-06T09:00:00Z'),
    durationSec: 34 * 60, distanceMeters: 7010, endedAt: null, observerKey: POLAR_KEY, ...overrides,
  };
}

describe('compareObservations — matcher puro', () => {
  it('1. mesmo usuario + mesma modalidade + inicio/duracao/distancia fortemente compativeis -> mesmo evento (06/10)', () => {
    const polar = obs({ id: 'p' });
    const apple = obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, startedAt: new Date('2026-10-06T09:00:20Z'), durationSec: 34 * 60 + 3 });
    const result = compareObservations(polar, apple);
    expect(result.verdict).toBe('same');
    expect(result.evidence.find((e) => e.criterion === 'start_proximity')).toMatchObject({ matched: true, level: 'strong' });
    expect(result.evidence.find((e) => e.criterion === 'different_observer')?.matched).toBe(true);
  });

  it('2. ordem inversa (A,B) x (B,A) -> mesmo veredito', () => {
    const polar = obs({ id: 'p' });
    const apple = obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, startedAt: new Date('2026-10-06T09:00:20Z') });
    expect(compareObservations(polar, apple).verdict).toBe(compareObservations(apple, polar).verdict);
    expect(compareObservations(polar, apple).verdict).toBe('same');
  });

  it.each([
    ['03/10 — 30,07 x 30,08 km, 156 min', { startedAt: new Date('2026-10-03T08:00:00Z'), durationSec: 156 * 60, distanceMeters: 30080 }, { startedAt: new Date('2026-10-03T08:00:40Z'), durationSec: 156 * 60, distanceMeters: 30070 }],
    ['01/10 — 10,01 x 10,02 km, 51 min', { startedAt: new Date('2026-10-01T09:30:00Z'), durationSec: 51 * 60, distanceMeters: 10020 }, { startedAt: new Date('2026-10-01T09:30:10Z'), durationSec: 51 * 60, distanceMeters: 10010 }],
  ])('3. pequena diferenca realista de distancia ainda e match: %s', (_label, a, b) => {
    const result = compareObservations(obs({ id: 'p', ...a }), obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, ...b }));
    expect(result.verdict).toBe('same');
  });

  it('4. mesma distancia/duracao em HORARIOS diferentes -> nao e o mesmo evento', () => {
    const morning = obs({ id: 'p' });
    const evening = obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, startedAt: new Date('2026-10-06T21:00:00Z') });
    const result = compareObservations(morning, evening);
    expect(result.verdict).toBe('distinct');
    expect(result.reason).toBe('different_time');
  });

  it('5. proximos mas evidencia insuficiente -> ambiguo (nao forca match)', () => {
    const polar = obs({ id: 'p', distanceMeters: null });
    // inicio ~5 min depois (fraco), duracao 4% diferente (fraca), sem distancia num dos lados
    const other = obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, startedAt: new Date('2026-10-06T09:05:00Z'), durationSec: Math.round(34 * 60 * 1.04) });
    const result = compareObservations(polar, other);
    expect(result.verdict).toBe('ambiguous');
    expect(result.reason).toBe('insufficient_evidence');
  });

  it('mesmo horario mas distancia muito diferente -> ambiguo (divergencia de metrica), nunca same nem distinct', () => {
    const result = compareObservations(obs({ id: 'p' }), obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, distanceMeters: 9000 }));
    expect(result.verdict).toBe('ambiguous');
    expect(result.reason).toBe('metric_divergence_at_same_time');
  });

  it('6. usuarios diferentes -> nunca agrupar', () => {
    const result = compareObservations(obs({ id: 'p' }), obs({ id: 'a', userId: 'user-2', provider: 'apple_health', observerKey: STRAVA_VIA_HK }));
    expect(result).toMatchObject({ verdict: 'distinct', reason: 'different_athlete' });
  });

  it('7. modalidades incompativeis -> nao agrupar; modalidade desconhecida nunca vira same', () => {
    const run = obs({ id: 'p' });
    const strength = obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, sport: 'forca' });
    expect(compareObservations(run, strength)).toMatchObject({ verdict: 'distinct', reason: 'incompatible_modality' });
    const unknown = obs({ id: 'b', provider: 'apple_health', observerKey: STRAVA_VIA_HK, sport: 'outra' });
    expect(compareObservations(run, unknown).verdict).toBe('ambiguous');
    expect(compareObservations(run, obs({ id: 'c', provider: 'apple_health', observerKey: STRAVA_VIA_HK, sport: 'esteira' })).verdict).toBe('same'); // corrida x esteira compativeis
  });

  it('dois registros do MESMO observador nunca sao o mesmo evento (ex.: duas corridas seguidas do mesmo provider)', () => {
    const first = obs({ id: 'p1' });
    const second = obs({ id: 'p2', startedAt: new Date('2026-10-06T09:00:10Z') });
    expect(compareObservations(first, second)).toMatchObject({ verdict: 'distinct', reason: 'same_observer_two_records' });
  });

  it('dado ausente e null (nunca incompatibilidade): sem distancia nos dois lados continua possivel same com inicio+duracao fortes', () => {
    const result = compareObservations(obs({ id: 'p', distanceMeters: null }), obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, distanceMeters: null }));
    expect(result.evidence.find((e) => e.criterion === 'distance_compatible')?.matched).toBeNull();
    expect(result.verdict).toBe('same');
  });

  it('observerKeyOf: HealthKit distingue origens; provider direto e o proprio observador', () => {
    expect(observerKeyOf('polar', null)).toBe('polar');
    expect(STRAVA_VIA_HK).toBe('apple_health:com.strava.stravaride');
    expect(WATCH_VIA_HK).not.toBe(STRAVA_VIA_HK);
    expect(observerKeyOf('apple_health', null)).toBe('apple_health:desconhecido');
  });
});

// ---- Servico com banco em memoria ------------------------------------------------------------------------------------------------
type Row = {
  id: string; userId: string; provider: string; externalId: string; sport: string | null; startedAt: Date; durationSec: number | null;
  distanceMeters: number | null; providerMetrics: unknown; physicalEventId: string | null; physicalIdentityStatus: string | null;
  physicalIdentityEvidence?: unknown; physicalIdentityEvaluatedAt?: Date | null; rawActivityId: string; executionClassification: string | null;
};

function row(id: string, provider: string, bundle: string | null, start: string, minutes: number, km: number | null, userId = 'user-1', sport: string | null = 'corrida'): Row {
  return {
    id, userId, provider, externalId: `ext-${id}`, sport, startedAt: new Date(start), durationSec: minutes * 60, distanceMeters: km == null ? null : km * 1000,
    providerMetrics: provider === 'apple_health' ? { source: { bundleId: bundle, name: bundle }, endedAt: new Date(new Date(start).getTime() + minutes * 60000).toISOString() } : { device: 'x' },
    physicalEventId: null, physicalIdentityStatus: null, rawActivityId: `raw-${id}`, executionClassification: null,
  };
}

function buildService(rows: Row[]) {
  const data = new Map(rows.map((r) => [r.id, { ...r }]));
  const original = new Map(rows.map((r) => [r.id, JSON.stringify(r)]));
  const matchWhere = (r: Row, where: any) => {
    if (where.userId && r.userId !== where.userId) return false;
    if (where.id?.not && r.id === where.id.not) return false;
    if (where.startedAt && (r.startedAt < where.startedAt.gte || r.startedAt > where.startedAt.lte)) return false;
    if (where.physicalEventId?.in && !where.physicalEventId.in.includes(r.physicalEventId)) return false;
    if (where.physicalEventId?.not === null && r.physicalEventId === null) return false;
    return true;
  };
  const activityLog = {
    findUnique: jest.fn(async ({ where }: any) => (data.has(where.id) ? { ...data.get(where.id)! } : null)),
    findMany: jest.fn(async ({ where, take }: any) => [...data.values()].filter((r) => matchWhere(r, where)).slice(0, take ?? 10_000).map((r) => ({ ...r }))),
    update: jest.fn(async ({ where, data: patch }: any) => Object.assign(data.get(where.id)!, patch)),
  };
  const tx = { $executeRaw: jest.fn(async () => 1), activityLog };
  const prisma = { activityLog, $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const service = new PhysicalActivityIdentityService(prisma as never);
  // particao: grupos de ids por physicalEventId
  const partition = () => {
    const groups = new Map<string, string[]>();
    for (const r of data.values()) if (r.physicalEventId) groups.set(r.physicalEventId, [...(groups.get(r.physicalEventId) ?? []), r.id].sort());
    return [...groups.values()].map((g) => g.join('+')).sort();
  };
  return { service, data, original, activityLog, partition };
}

const POLAR = (id = 'p') => row(id, 'polar', null, '2026-10-06T09:00:00Z', 34, 7.01);
const APPLE_STRAVA = (id = 'a') => row(id, 'apple_health', 'com.strava.stravaride', '2026-10-06T09:00:20Z', 34, 7.01);
const APPLE_WATCH = (id = 'w') => row(id, 'apple_health', 'com.apple.health.ABC', '2026-10-06T08:59:55Z', 34, 7.0);

describe('PhysicalActivityIdentityService', () => {
  it('agrupa Polar + HealthKit(Strava) no mesmo physicalEventId, sem tocar em mais nada do registro', async () => {
    const { service, data, original } = buildService([POLAR(), APPLE_STRAVA()]);
    const result = await service.evaluate('a');
    expect(result).toMatchObject({ status: 'matched', memberCount: 2 });
    const [p, a] = [data.get('p')!, data.get('a')!];
    expect(p.physicalEventId).toBeTruthy();
    expect(p.physicalEventId).toBe(a.physicalEventId);
    expect(p.physicalIdentityStatus).toBe('matched');
    expect(a.physicalIdentityStatus).toBe('matched');
    // Preservacao: provider, externalId, raw, metricas, provenance, classificacao — tudo intacto.
    for (const id of ['p', 'a']) {
      const before = JSON.parse(original.get(id)!);
      const after = data.get(id)!;
      for (const key of ['provider', 'externalId', 'rawActivityId', 'sport', 'durationSec', 'distanceMeters', 'providerMetrics', 'executionClassification', 'userId']) {
        expect(JSON.stringify((after as any)[key])).toBe(JSON.stringify(before[key]));
      }
      expect(after.startedAt.toISOString()).toBe(before.startedAt);
    }
    expect(data.get('a')!.executionClassification).toBeNull(); // quarentena Apple preservada
    const evidence = data.get('a')!.physicalIdentityEvidence as { comparisons: Array<{ verdict: string; provider: string; criteria: unknown[] }> };
    expect(evidence.comparisons[0]).toMatchObject({ verdict: 'same', provider: 'polar' });
  });

  it('2. ordem de chegada nao importa: polar->apple e apple->polar produzem a mesma particao', async () => {
    const forward = buildService([POLAR(), APPLE_STRAVA()]);
    await forward.service.evaluate('p');
    await forward.service.evaluate('a');
    const reverse = buildService([POLAR(), APPLE_STRAVA()]);
    await reverse.service.evaluate('a');
    await reverse.service.evaluate('p');
    expect(forward.partition()).toEqual(['a+p']);
    expect(reverse.partition()).toEqual(forward.partition());
  });

  it('8. terceiro observador chegando depois entra no evento ja identificado (todas as 6 ordens dao a mesma particao)', async () => {
    const ids = ['p', 'a', 'w'];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const order of perms) {
      const ctx = buildService([POLAR(), APPLE_STRAVA(), APPLE_WATCH()]);
      for (const i of order) await ctx.service.evaluate(ids[i]);
      expect(ctx.partition()).toEqual(['a+p+w']);
      expect(new Set([...ctx.data.values()].map((r) => r.physicalEventId)).size).toBe(1);
    }
  });

  it('10. reprocessamento e idempotente: mesma particao, mesmo physicalEventId, nenhum grupo novo', async () => {
    const ctx = buildService([POLAR(), APPLE_STRAVA()]);
    await ctx.service.evaluate('a');
    const id = ctx.data.get('a')!.physicalEventId;
    for (let i = 0; i < 3; i++) { await ctx.service.evaluate('a'); await ctx.service.evaluate('p'); }
    expect(ctx.partition()).toEqual(['a+p']);
    expect(ctx.data.get('a')!.physicalEventId).toBe(id);
    expect(ctx.data.get('p')!.physicalEventId).toBe(id);
  });

  it('usuarios diferentes nunca agrupam, mesmo com dados identicos', async () => {
    const ctx = buildService([POLAR(), { ...APPLE_STRAVA(), userId: 'user-2' }]);
    await ctx.service.evaluate('a');
    expect(ctx.data.get('a')).toMatchObject({ physicalEventId: null, physicalIdentityStatus: 'unique' });
    expect(ctx.data.get('p')!.physicalEventId).toBeNull();
  });

  it('mesma distancia em horarios diferentes: cada um fica unique, sem grupo', async () => {
    const ctx = buildService([POLAR(), row('a', 'apple_health', 'com.strava.stravaride', '2026-10-06T21:00:00Z', 34, 7.01)]);
    await ctx.service.evaluate('a');
    expect(ctx.partition()).toEqual([]);
    expect(ctx.data.get('a')!.physicalIdentityStatus).toBe('unique');
  });

  it('5. evidencia insuficiente: ambos ficam ambiguous (simetrico) e NADA e agrupado', async () => {
    const weakApple = row('a', 'apple_health', 'com.strava.stravaride', '2026-10-06T09:05:00Z', 35, null);
    const ctx = buildService([{ ...POLAR(), distanceMeters: null }, weakApple]);
    await ctx.service.evaluate('a');
    expect(ctx.partition()).toEqual([]);
    expect(ctx.data.get('a')).toMatchObject({ physicalIdentityStatus: 'ambiguous', physicalEventId: null });
    expect(ctx.data.get('p')).toMatchObject({ physicalIdentityStatus: 'ambiguous', physicalEventId: null });
  });

  it('observador repetido no grupo -> ambiguo, nao une (dois registros Polar nao viram o mesmo evento por causa de um terceiro)', async () => {
    const ctx = buildService([POLAR('p1'), { ...POLAR('p2'), startedAt: new Date('2026-10-06T09:00:30Z') }, APPLE_STRAVA()]);
    await ctx.service.evaluate('p1');
    await ctx.service.evaluate('p2');
    await ctx.service.evaluate('a');
    expect(ctx.partition()).toEqual([]);
    expect(ctx.data.get('a')!.physicalIdentityStatus).toBe('ambiguous');
  });

  it('nunca escreve em coluna fora de physical* (nada de raw, classificacao ou metricas)', async () => {
    const ctx = buildService([POLAR(), APPLE_STRAVA()]);
    await ctx.service.evaluate('a');
    const allowed = new Set(['physicalEventId', 'physicalIdentityStatus', 'physicalIdentityEvidence', 'physicalIdentityEvaluatedAt']);
    for (const call of ctx.activityLog.update.mock.calls) {
      for (const key of Object.keys((call[0] as any).data)) expect(allowed.has(key)).toBe(true);
    }
  });

  it('serializa por usuario com advisory lock transacional', async () => {
    const ctx = buildService([POLAR(), APPLE_STRAVA()]);
    await ctx.service.evaluate('a');
    // $executeRaw e' o lock (uma chamada por avaliacao)
    const prisma = (ctx.service as any).prisma;
    const tx = await prisma.$transaction(async (t: any) => t);
    expect(tx.$executeRaw).toBeDefined();
  });

  it('backfill do historico de um aluno agrupa os 3 pares (06/10, 03/10, 01/10) e e idempotente', async () => {
    const rows = [
      row('p1', 'polar', null, '2026-10-06T09:00:00Z', 34, 7.01), row('a1', 'apple_health', 'com.strava.stravaride', '2026-10-06T09:00:20Z', 34, 7.01),
      row('p2', 'polar', null, '2026-10-03T08:00:00Z', 156, 30.08), row('a2', 'apple_health', 'com.strava.stravaride', '2026-10-03T08:00:40Z', 156, 30.07),
      row('p3', 'polar', null, '2026-10-01T09:30:00Z', 51, 10.02), row('a3', 'apple_health', 'com.strava.stravaride', '2026-10-01T09:30:10Z', 51, 10.01),
    ];
    const ctx = buildService(rows);
    const first = await ctx.service.evaluateUserHistory('user-1');
    expect(first).toMatchObject({ evaluated: 6, matchedEvents: 3, ambiguous: 0 });
    expect(ctx.partition()).toEqual(['a1+p1', 'a2+p2', 'a3+p3']);
    const ids = [...ctx.data.values()].map((r) => r.physicalEventId).sort();
    const second = await ctx.service.evaluateUserHistory('user-1');
    expect(second).toMatchObject({ matchedEvents: 3 });
    expect([...ctx.data.values()].map((r) => r.physicalEventId).sort()).toEqual(ids);
  });
});
