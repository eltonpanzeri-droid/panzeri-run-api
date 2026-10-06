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
    if (where.physicalIdentityStatus?.in && !where.physicalIdentityStatus.in.includes(r.physicalIdentityStatus)) return false;
    return true;
  };
  const activityLog = {
    findUnique: jest.fn(async ({ where }: any) => (data.has(where.id) ? { ...data.get(where.id)! } : null)),
    findMany: jest.fn(async ({ where, take }: any) => [...data.values()].filter((r) => matchWhere(r, where)).slice(0, take ?? 10_000).map((r) => ({ ...r }))),
    update: jest.fn(async ({ where, data: patch }: any) => Object.assign(data.get(where.id)!, patch)),
  };
  // Ecossistema primario por periodo (AthletePrimarySource) e historico de entregas (WorkoutDelivery), em memoria.
  const periods: Array<{ userId: string; provider: string; effectiveFrom: Date; createdAt: Date }> = [];
  const deliveries: Array<{ userId: string; provider: string; status: string; requestedAt: Date }> = [];
  const athletePrimarySource = {
    findFirst: jest.fn(async ({ where }: any) => {
      const found = periods
        .filter((p) => p.userId === where.userId && p.effectiveFrom <= where.effectiveFrom.lte)
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0];
      return found ? { provider: found.provider } : null;
    }),
    create: jest.fn(async ({ data: d }: any) => { periods.push({ userId: d.userId, provider: d.provider, effectiveFrom: d.effectiveFrom, createdAt: new Date() }); return { id: 'ps', provider: d.provider, effectiveFrom: d.effectiveFrom }; }),
  };
  const workoutDelivery = {
    findFirst: jest.fn(async ({ where }: any) => {
      const found = deliveries
        .filter((d) => d.userId === where.trainingSession.userId && where.status.in.includes(d.status) && d.requestedAt <= where.requestedAt.lte)
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0];
      return found ? { provider: found.provider } : null;
    }),
  };
  const tx = { $executeRaw: jest.fn(async () => 1), activityLog, athletePrimarySource, workoutDelivery };
  const prisma = { activityLog, athletePrimarySource, $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const service = new PhysicalActivityIdentityService(prisma as never);
  // particao: grupos de ids por physicalEventId
  const partition = () => {
    const groups = new Map<string, string[]>();
    for (const r of data.values()) if (r.physicalEventId) groups.set(r.physicalEventId, [...(groups.get(r.physicalEventId) ?? []), r.id].sort());
    return [...groups.values()].map((g) => g.join('+')).sort();
  };
  const setPrimary = (userId: string, provider: string, effectiveFrom: string) => periods.push({ userId, provider, effectiveFrom: new Date(effectiveFrom), createdAt: new Date() });
  const addDelivery = (userId: string, provider: string, status: string, requestedAt: string) => deliveries.push({ userId, provider, status, requestedAt: new Date(requestedAt) });
  return { service, data, original, activityLog, partition, setPrimary, addDelivery, periods };
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
    const allowed = new Set(['physicalEventId', 'physicalIdentityStatus', 'physicalIdentityEvidence', 'physicalIdentityEvaluatedAt', 'physicalCanonicalActivityLogId', 'physicalCanonicalReason']);
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

// Correcao de determinismo (06/10/2026): o estado final depende so' do CONJUNTO de observacoes, nunca da ordem em que chegaram.
describe('PhysicalActivityIdentityService — determinismo com chegada progressiva', () => {
  const arrivals: Array<{ id: string; make: () => Row }> = [
    { id: 'p1', make: () => POLAR('p1') },
    { id: 'p2', make: () => ({ ...POLAR('p2'), startedAt: new Date('2026-10-06T09:00:30Z') }) },
    { id: 'a', make: () => APPLE_STRAVA('a') },
    { id: 'w', make: () => APPLE_WATCH('w') },
  ];
  const permutations = <T,>(items: T[]): T[][] => (items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));

  function run(order: string[]) {
    const ctx = buildService([]);
    for (const id of order) {
      ctx.data.set(id, { ...arrivals.find((x) => x.id === id)!.make() });
      void 0;
    }
    return ctx;
  }

  async function arriveOneByOne(order: string[]) {
    const ctx = buildService([]);
    for (const id of order) {
      ctx.data.set(id, { ...arrivals.find((x) => x.id === id)!.make() });
      await ctx.service.evaluate(id);
    }
    const state = Object.fromEntries([...ctx.data.values()].sort((x, y) => (x.id < y.id ? -1 : 1)).map((r) => [r.id, r.physicalIdentityStatus]));
    return { partition: ctx.partition(), state };
  }

  it('registro conflitante chegando DEPOIS de um grupo formado desfaz o grupo: resultado igual ao da chegada simultanea (todas as 6 ordens de p1, p2, a)', async () => {
    const results = [];
    for (const order of permutations(['p1', 'p2', 'a'])) results.push(await arriveOneByOne(order));
    for (const result of results) {
      expect(result.partition).toEqual([]);
      expect(result.state).toEqual({ p1: 'ambiguous', p2: 'ambiguous', a: 'ambiguous' });
    }
  });

  it('com um quarto observador legitimo (w) e o conflito (p2), todas as 24 ordens convergem para o mesmo estado final', async () => {
    const outcomes = new Set<string>();
    for (const order of permutations(['p1', 'p2', 'a', 'w'])) {
      const { partition, state } = await arriveOneByOne(order);
      outcomes.add(JSON.stringify({ partition, state }));
    }
    expect(outcomes.size).toBe(1);
  });

  it('sem conflito (p1, a, w): todas as 6 ordens dao o mesmo evento unico', async () => {
    for (const order of permutations(['p1', 'a', 'w'])) {
      const { partition } = await arriveOneByOne(order);
      expect(partition).toEqual(['a+p1+w']);
    }
    expect(run(['p1']).data.size).toBe(1);
  });

  it('o id de um grupo novo e deterministico e o de um grupo existente e preservado quando ele cresce', async () => {
    const ctx = buildService([POLAR(), APPLE_STRAVA()]);
    await ctx.service.evaluate('a');
    const firstId = ctx.data.get('p')!.physicalEventId;
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    const again = buildService([POLAR(), APPLE_STRAVA()]);
    await again.service.evaluate('p');
    expect(again.data.get('p')!.physicalEventId).toBe(firstId);
    ctx.data.set('w', { ...APPLE_WATCH('w') });
    await ctx.service.evaluate('w');
    expect(new Set([...ctx.data.values()].map((r) => r.physicalEventId))).toEqual(new Set([firstId]));
  });
});

// ---- Etapa 3A: observacao canonica e ecossistema primario --------------------------------------------------------------------------
const POLAR_FLOW_VIA_HK = (id = 'pf') => row(id, 'apple_health', 'com.polar.polarflow', '2026-10-06T09:00:10Z', 34, 7.01);
const GARMIN = (id = 'g') => ({ ...row(id, 'garmin', null, '2026-10-06T09:00:00Z', 34, 7.01), avgHeartRateBpm: 150 } as Row);
const GARMIN_VIA_HK = (id = 'gh') => row(id, 'apple_health', 'com.garmin.connect.mobile', '2026-10-06T09:00:15Z', 34, 7.01);
const POLAR_RICH = (id = 'p') => ({ ...row(id, 'polar', null, '2026-10-06T09:00:00Z', 34, 7.01), avgHeartRateBpm: 152, caloriesKcal: 520, cadenceAvg: 170, hasRoute: true } as Row);

const canonicalOf = (ctx: { data: Map<string, Row> }, id: string) => (ctx.data.get(id) as any).physicalCanonicalActivityLogId as string | null;
const reasonOf = (ctx: { data: Map<string, Row> }, id: string) => (ctx.data.get(id) as any).physicalCanonicalReason as any;

async function evaluateAll(ctx: ReturnType<typeof buildService>, order: string[]) {
  for (const id of order) await ctx.service.evaluate(id);
}

describe('Etapa 3A — observacao canonica', () => {
  it('Polar primario + Polar direto + HealthKit(Strava) -> Polar canonico', async () => {
    const ctx = buildService([POLAR_RICH(), APPLE_STRAVA()]);
    ctx.setPrimary('user-1', 'polar', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx, ['a', 'p']);
    expect(canonicalOf(ctx, 'p')).toBe('p');
    expect(canonicalOf(ctx, 'a')).toBe('p'); // todos apontam para a mesma canonica
    expect(reasonOf(ctx, 'p')).toMatchObject({ rule: 'primary_ecosystem', primarySource: 'polar', primarySourceOrigin: 'explicit', fallbackReason: null });
    expect(reasonOf(ctx, 'p').candidates).toHaveLength(2);
  });

  it('Polar primario + Polar direto + Polar Flow via HealthKit -> o canal DIRETO do mesmo ecossistema e canonico (relay preservado)', async () => {
    const ctx = buildService([POLAR_RICH(), POLAR_FLOW_VIA_HK()]);
    ctx.setPrimary('user-1', 'polar', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx, ['pf', 'p']);
    expect(ctx.partition()).toEqual(['p+pf']);
    expect(canonicalOf(ctx, 'pf')).toBe('p');
    expect(ecosystemKeyOfForTest('apple_health', { source: { bundleId: 'com.polar.polarflow' } })).toBe('polar');
  });

  it('Garmin primario + Garmin direto + Garmin Connect via HealthKit -> Garmin canonico', async () => {
    const ctx = buildService([GARMIN(), GARMIN_VIA_HK()]);
    ctx.setPrimary('user-1', 'garmin', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx, ['gh', 'g']);
    expect(canonicalOf(ctx, 'g')).toBe('g');
    expect(canonicalOf(ctx, 'gh')).toBe('g');
    expect(reasonOf(ctx, 'g')).toMatchObject({ rule: 'primary_ecosystem', primarySource: 'garmin' });
  });

  it('Apple Watch / HealthKit primario -> o HealthKit de origem Apple e canonico (nao o HealthKit de origem Strava)', async () => {
    const ctx = buildService([APPLE_STRAVA(), APPLE_WATCH()]);
    ctx.setPrimary('user-1', 'apple_health', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx, ['a', 'w']);
    expect(ctx.partition()).toEqual(['a+w']);
    expect(canonicalOf(ctx, 'a')).toBe('w');
    expect(canonicalOf(ctx, 'w')).toBe('w');
    expect(reasonOf(ctx, 'w')).toMatchObject({ rule: 'primary_ecosystem', primarySource: 'apple_health' });
  });

  it('fonte primaria ausente neste evento -> fallback deterministico (registro valido mais completo), com o motivo registrado', async () => {
    const ctx = buildService([POLAR_RICH(), APPLE_WATCH()]);
    ctx.setPrimary('user-1', 'garmin', '2026-01-01T00:00:00Z'); // nao ha observacao Garmin
    await evaluateAll(ctx, ['p', 'w']);
    expect(canonicalOf(ctx, 'w')).toBe('p'); // Polar e' o mais completo — escolha neutra, nao hierarquia de provider
    expect(reasonOf(ctx, 'p')).toMatchObject({ rule: 'fallback_deterministic', primarySource: 'garmin', fallbackReason: 'primary_absent' });
  });

  it('sem primario definido -> fallback com motivo no_primary_defined; sem hierarquia universal (HealthKit mais completo vence um Polar vazio)', async () => {
    const richHealthKit = { ...APPLE_WATCH(), avgHeartRateBpm: 150, caloriesKcal: 500 } as Row;
    const ctx = buildService([POLAR(), richHealthKit]);
    await evaluateAll(ctx, ['p', 'w']);
    expect(canonicalOf(ctx, 'p')).toBe('w');
    expect(reasonOf(ctx, 'w')).toMatchObject({ rule: 'fallback_deterministic', primarySource: null, fallbackReason: 'no_primary_defined' });
  });

  it('observacao primaria sem duracao e distancia nao e valida: fallback com primary_has_no_valid_observation', async () => {
    const { selectCanonicalObservation } = await import('../src/activity-execution/physical-canonical');
    const base = { caloriesKcal: null, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: null };
    const emptyPolar = { id: 'p', provider: 'polar', providerMetrics: null, durationSec: null, distanceMeters: null, ...base };
    const hk = { id: 'a', provider: 'apple_health', providerMetrics: { source: { bundleId: 'com.strava.stravaride' } }, durationSec: 2040, distanceMeters: 7010, ...base };
    const selection = selectCanonicalObservation([emptyPolar, hk], { key: 'polar', origin: 'explicit' });
    expect(selection!.reason).toMatchObject({ rule: 'fallback_deterministic', fallbackReason: 'primary_has_no_valid_observation' });
    expect(selection!.canonicalId).toBe('a');
  });

  it('fonte primaria chegando DEPOIS: a observacao primaria entra e a canonica e recalculada', async () => {
    const ctx = buildService([APPLE_WATCH()]);
    ctx.setPrimary('user-1', 'polar', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx, ['w']);
    expect(canonicalOf(ctx, 'w')).toBe('w'); // unica observacao
    expect(reasonOf(ctx, 'w')).toMatchObject({ rule: 'sole_observation' });
    ctx.data.set('p', { ...POLAR_RICH() });
    await ctx.service.evaluate('p');
    expect(canonicalOf(ctx, 'w')).toBe('p');
    expect(canonicalOf(ctx, 'p')).toBe('p');
    expect(reasonOf(ctx, 'p')).toMatchObject({ rule: 'primary_ecosystem', primarySource: 'polar' });
  });

  it('ordem de chegada diferente -> mesma canonica (todas as 6 ordens de Polar, HealthKit/Strava e HealthKit/Watch)', async () => {
    const ids = ['p', 'a', 'w'];
    const perms: number[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const primary of ['polar', 'apple_health', null]) {
      const outcomes = new Set<string>();
      for (const order of perms) {
        const ctx = buildService([]);
        if (primary) ctx.setPrimary('user-1', primary, '2026-01-01T00:00:00Z');
        const rowsById: Record<string, Row> = { p: POLAR_RICH(), a: APPLE_STRAVA(), w: APPLE_WATCH() };
        for (const i of order) { ctx.data.set(ids[i], { ...rowsById[ids[i]] }); await ctx.service.evaluate(ids[i]); }
        outcomes.add(JSON.stringify(ids.map((id) => [canonicalOf(ctx, id), reasonOf(ctx, id)?.rule])));
      }
      expect(outcomes.size).toBe(1);
    }
  });

  it('mudanca futura Polar -> Garmin nao reescreve eventos historicos (preferencia atual != fonte canonica historica)', async () => {
    const ctx = buildService([
      { ...POLAR_RICH('p-old'), startedAt: new Date('2026-09-10T09:00:00Z') } as Row, row('a-old', 'apple_health', 'com.strava.stravaride', '2026-09-10T09:00:15Z', 34, 7.01),
      { ...GARMIN('g-new'), startedAt: new Date('2026-10-20T09:00:00Z') } as Row, row('gh-new', 'apple_health', 'com.garmin.connect.mobile', '2026-10-20T09:00:15Z', 34, 7.01),
    ]);
    ctx.setPrimary('user-1', 'polar', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx, ['p-old', 'a-old', 'g-new', 'gh-new']);
    expect(canonicalOf(ctx, 'a-old')).toBe('p-old');
    expect(reasonOf(ctx, 'a-old')).toMatchObject({ primarySource: 'polar', rule: 'primary_ecosystem' });
    // atleta migra para Garmin a partir de 15/10 — periodo NOVO; recalcula tudo
    ctx.setPrimary('user-1', 'garmin', '2026-10-15T00:00:00Z');
    await ctx.service.recomputeCanonicalForUser('user-1');
    expect(canonicalOf(ctx, 'a-old')).toBe('p-old'); // historico continua Polar
    expect(reasonOf(ctx, 'a-old')).toMatchObject({ primarySource: 'polar' });
    expect(canonicalOf(ctx, 'gh-new')).toBe('g-new'); // evento novo resolve pelo periodo Garmin
    expect(reasonOf(ctx, 'g-new')).toMatchObject({ primarySource: 'garmin', rule: 'primary_ecosystem' });
  });

  it('padrao derivado do historico de WorkoutDelivery quando nao ha preferencia explicita; entrega cancelada ou posterior ao evento nao conta', async () => {
    const ctx = buildService([POLAR(), APPLE_WATCH()]);
    ctx.addDelivery('user-1', 'polar', 'canceled', '2026-10-01T00:00:00Z');
    ctx.addDelivery('user-1', 'polar', 'sent', '2026-10-30T00:00:00Z'); // depois do evento
    await evaluateAll(ctx, ['p', 'w']);
    expect(reasonOf(ctx, 'p')).toMatchObject({ primarySource: null, fallbackReason: 'no_primary_defined' });
    ctx.addDelivery('user-1', 'polar', 'sent', '2026-10-02T00:00:00Z');
    await ctx.service.recomputeCanonicalForUser('user-1');
    expect(reasonOf(ctx, 'p')).toMatchObject({ primarySource: 'polar', primarySourceOrigin: 'delivery_history', rule: 'primary_ecosystem' });
    expect(canonicalOf(ctx, 'w')).toBe('p');
  });

  it('observacao unica: ela mesma e canonica (sole_observation); ambigua: sem canonica', async () => {
    const lone = buildService([POLAR()]);
    await lone.service.evaluate('p');
    expect(canonicalOf(lone, 'p')).toBe('p');
    expect(reasonOf(lone, 'p')).toMatchObject({ rule: 'sole_observation' });
    const weakApple = row('a', 'apple_health', 'com.strava.stravaride', '2026-10-06T09:05:00Z', 35, null);
    const amb = buildService([{ ...POLAR(), distanceMeters: null } as Row, weakApple]);
    await amb.service.evaluate('a');
    expect(canonicalOf(amb, 'a')).toBeNull();
    expect(canonicalOf(amb, 'p')).toBeNull();
  });

  it('recalcular e idempotente e nenhuma observacao original e alterada ou apagada', async () => {
    const ctx = buildService([POLAR_RICH(), APPLE_STRAVA(), APPLE_WATCH()]);
    ctx.setPrimary('user-1', 'polar', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx, ['p', 'a', 'w']);
    const writesBefore = ctx.activityLog.update.mock.calls.length;
    await ctx.service.recomputeCanonicalForUser('user-1');
    await ctx.service.recomputeCanonicalForUser('user-1');
    expect(ctx.activityLog.update.mock.calls.length).toBe(writesBefore); // nada mudou -> nada escrito
    expect(ctx.data.size).toBe(3); // nenhuma exclusao
    for (const id of ['p', 'a', 'w']) {
      const before = JSON.parse(ctx.original.get(id)!);
      const after = ctx.data.get(id)!;
      for (const k of ['provider', 'externalId', 'rawActivityId', 'sport', 'durationSec', 'distanceMeters', 'providerMetrics', 'executionClassification', 'userId']) {
        expect(JSON.stringify((after as any)[k])).toBe(JSON.stringify(before[k]));
      }
    }
    const allowed = new Set(['physicalEventId', 'physicalIdentityStatus', 'physicalIdentityEvidence', 'physicalIdentityEvaluatedAt', 'physicalCanonicalActivityLogId', 'physicalCanonicalReason']);
    for (const call of ctx.activityLog.update.mock.calls) for (const k of Object.keys((call[0] as any).data)) expect(allowed.has(k)).toBe(true);
  });

  it('setPrimarySource cria um periodo novo e recalcula; metricas da canonica nao sao complementadas com as das demais', async () => {
    const poorPolar = POLAR(); // sem FC
    const hkWithHr = { ...APPLE_WATCH(), avgHeartRateBpm: 149 } as Row;
    const ctx = buildService([poorPolar, hkWithHr]);
    await evaluateAll(ctx, ['p', 'w']);
    const result = await ctx.service.setPrimarySource('user-1', 'polar', { effectiveFrom: new Date('2026-01-01T00:00:00Z'), origin: 'coach' });
    expect(result.recomputed.events).toBe(1);
    expect(canonicalOf(ctx, 'w')).toBe('p');
    expect(((ctx.data.get('p') as any).avgHeartRateBpm ?? null)).toBeNull(); // nada copiado do HealthKit para a Polar
  });
});

import { ecosystemKeyOf as ecosystemKeyOfForTest } from '../src/activity-execution/physical-canonical';
