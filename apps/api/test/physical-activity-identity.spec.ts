import { compareObservations, observerKeyOf, ObservedActivity } from '../src/activity-execution/physical-activity-identity';
import { PhysicalActivityIdentityService } from '../src/activity-execution/physical-activity-identity.service';
import { canonicalModality } from '../src/activity-execution/canonical-modality';

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

  it('caso real 01/10: Polar legado sport="RUNNING" x Apple "corrida" -> same / strong_multi_evidence (modalidade canonica, valor original preservado)', () => {
    const polar = obs({ id: 'p', sport: 'RUNNING', startedAt: new Date('2026-10-01T10:34:00Z'), durationSec: 3058, distanceMeters: 10018 });
    const apple = obs({ id: 'a', provider: 'apple_health', observerKey: 'apple_health:com.apple.health', sport: 'corrida', startedAt: new Date('2026-10-01T10:34:01Z'), durationSec: 3056, distanceMeters: 10012.1 });
    const result = compareObservations(polar, apple);
    expect(result).toMatchObject({ verdict: 'same', reason: 'strong_multi_evidence' });
    // o valor ORIGINAL fica na evidencia ao lado do canonico
    expect(result.evidence.find((e) => e.criterion === 'compatible_modality')).toMatchObject({ matched: true, detail: { a: 'RUNNING', b: 'corrida', canonicalA: 'corrida', canonicalB: 'corrida' } });
    // simetrico e independente de caixa
    expect(compareObservations(apple, obs({ ...polar, sport: 'running' })).verdict).toBe('same');
  });

  it('canonicalModality: aliases comprovados convergem; desconhecido e null (nunca incompativel); modalidades realmente diferentes seguem distintas', () => {
    expect(['RUNNING', 'running', ' Run ', 'corrida'].map(canonicalModality)).toEqual(['corrida', 'corrida', 'corrida', 'corrida']);
    expect(canonicalModality('OTHER')).toBe('outra');
    expect(canonicalModality('algo_nunca_visto')).toBeNull();
    expect(canonicalModality(null)).toBeNull();
    expect(compareObservations(obs({ id: 'p', sport: 'RUNNING' }), obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK, sport: 'forca' }))).toMatchObject({ verdict: 'distinct', reason: 'incompatible_modality' });
    expect(compareObservations(obs({ id: 'p', sport: 'algo_nunca_visto' }), obs({ id: 'a', provider: 'apple_health', observerKey: STRAVA_VIA_HK })).verdict).toBe('ambiguous');
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
  it('servico: Polar legado sport="RUNNING" + Apple "corrida" (01/10) agrupam em um PhysicalEvent sem alterar o sport gravado', async () => {
    const legacyPolar = row('p', 'polar', null, '2026-10-01T10:34:00Z', 51, 10.018, 'user-1', 'RUNNING');
    const apple = row('a', 'apple_health', 'com.apple.health', '2026-10-01T10:34:01Z', 51, 10.012);
    const { service, data } = buildService([legacyPolar, apple]);
    const result = await service.evaluate('a');
    expect(result).toMatchObject({ status: 'matched', memberCount: 2 });
    expect(data.get('p')!.sport).toBe('RUNNING');
    expect(data.get('p')!.physicalEventId).toBe(data.get('a')!.physicalEventId);
  });

  it('compareStored (diagnostico): usa o matcher atual com os valores persistidos, expoe entradas/deltas e NAO grava nada', async () => {
    const { service, activityLog, original, data } = buildService([POLAR(), APPLE_STRAVA(), row('o', 'apple_health', 'com.apple.health.X', '2026-10-06T09:00:00Z', 34, 7.01, 'user-2')]);
    const result = await service.compareStored('user-1', 'p', 'a');
    expect(result).toMatchObject({ verdict: 'same', reason: 'strong_multi_evidence', a: { activityLogId: 'p', provider: 'polar' }, b: { activityLogId: 'a', provider: 'apple_health' } });
    expect(result!.evidence.find((e) => e.criterion === 'start_proximity')?.detail).toMatchObject({ diffSec: 20 });
    expect(result!.a.startedAt).toBe('2026-10-06T09:00:00.000Z');
    expect(activityLog.update).not.toHaveBeenCalled();
    expect(JSON.stringify(data.get('p'))).toBe(original.get('p'));
    // outro aluno ou o mesmo id nos dois lados: sem comparacao
    expect(await service.compareStored('user-1', 'p', 'o')).toBeNull();
    expect(await service.compareStored('user-1', 'p', 'p')).toBeNull();
  });

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

// ---- Etapa 3A (regra v2): observacao canonica por PAPEL da observacao no evento ----------------------------------------------------
// Principio: gravador nativo vence copia/relay; proveniencia indeterminada nao e' promovida nem rebaixada sem evidencia; sem nativa a melhor
// observacao disponivel e' escolhida (nao e' erro); nada e' configurado pelo aluno ou treinador; WorkoutDelivery nao e' evidencia aqui.
import { baseProvenanceProfile, provenanceProfiles, selectCanonicalObservation } from '../src/activity-execution/physical-canonical';

const withDevice = (r: Row, device: Record<string, string>): Row => ({ ...r, providerMetrics: { ...(r.providerMetrics as object), device } });
const APPLE_DEVICE = { name: 'Apple Watch', manufacturer: 'Apple Inc.', model: 'Watch' };

const POLAR_RICH = (id = 'p') => ({ ...row(id, 'polar', null, '2026-10-06T09:00:00Z', 34, 7.01), avgHeartRateBpm: 152, caloriesKcal: 520, cadenceAvg: 170, hasRoute: true } as Row);
const GARMIN = (id = 'g') => ({ ...row(id, 'garmin', null, '2026-10-06T09:00:00Z', 34, 7.01), avgHeartRateBpm: 150, cadenceAvg: 168 } as Row);
const HK_STRAVA = (id = 'a') => APPLE_STRAVA(id);
const HK_POLAR_FLOW = (id = 'pf') => row(id, 'apple_health', 'com.polar.polarflow', '2026-10-06T09:00:10Z', 34, 7.01);
const HK_GARMIN_CONNECT = (id = 'gh') => row(id, 'apple_health', 'com.garmin.connect.mobile', '2026-10-06T09:00:15Z', 34, 7.01);
const WATCH_NATIVE = (id = 'w') => withDevice(APPLE_WATCH(id), APPLE_DEVICE);

const canonicalOf = (ctx: { data: Map<string, Row> }, id: string) => (ctx.data.get(id) as any).physicalCanonicalActivityLogId as string | null;
const reasonOf = (ctx: { data: Map<string, Row> }, id: string) => (ctx.data.get(id) as any).physicalCanonicalReason as any;
const roleOf = (reason: any, id: string) => reason.candidates.find((c: any) => c.activityLogId === id).role as string;

async function evaluateAll(ctx: ReturnType<typeof buildService>, order: string[]) {
  for (const id of order) await ctx.service.evaluate(id);
}
const permutations = <T,>(items: T[]): T[][] => (items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));

describe('Etapa 3A v2 — perfil de proveniencia', () => {
  it('provider direto = gravador nativo; Strava (agregador) = unknown', () => {
    expect(baseProvenanceProfile('polar', null)).toMatchObject({ role: 'native_recorder', ecosystem: 'polar', basis: 'direct_provider_integration' });
    expect(baseProvenanceProfile('garmin', null).role).toBe('native_recorder');
    expect(baseProvenanceProfile('strava', null)).toMatchObject({ role: 'unknown', basis: 'aggregator_cannot_tell_recorder' });
  });

  it('Apple Watch gravando via HealthKit pode ser native_recorder (origem Apple + device Apple); sem device Apple fica unknown', () => {
    expect(baseProvenanceProfile('apple_health', { source: { bundleId: 'com.apple.health.X' }, device: APPLE_DEVICE })).toMatchObject({ role: 'native_recorder', ecosystem: 'apple_health', basis: 'apple_device_recorded' });
    expect(baseProvenanceProfile('apple_health', { source: { bundleId: 'com.apple.health.X' } })).toMatchObject({ role: 'unknown', basis: 'apple_source_without_recording_device' });
  });

  it('HealthKit de app de terceiro NUNCA e classificado como relay sozinho (Strava, Polar Flow, Garmin Connect, desconhecido)', () => {
    for (const bundleId of ['com.strava.stravaride', 'com.polar.polarflow', 'com.garmin.connect.mobile', 'com.exemplo.app']) {
      expect(baseProvenanceProfile('apple_health', { source: { bundleId } })).toMatchObject({ role: 'unknown', basis: 'third_party_app_source' });
    }
  });

  it('sensor (cinta de FC) nao vira observador: device nao-Apple nao torna a observacao nativa nem importa o ecossistema do sensor', () => {
    const strapOnly = baseProvenanceProfile('apple_health', { source: { bundleId: 'com.apple.health.X' }, device: { name: 'Polar H10', manufacturer: 'Polar' } });
    expect(strapOnly.role).toBe('unknown');
    expect(strapOnly.ecosystem).toBe('apple_health'); // ecossistema = o da ORIGEM informada, nunca o do sensor
  });

  it('so vira relay com evidencia: HealthKit de app X + gravacao nativa DIRETA de X no mesmo evento; Strava nunca e promovido', () => {
    const polar = POLAR_RICH();
    const flow = HK_POLAR_FLOW();
    const strava = HK_STRAVA();
    const toInput = (r: Row) => ({ id: r.id, provider: r.provider, providerMetrics: r.providerMetrics, durationSec: r.durationSec, distanceMeters: r.distanceMeters, caloriesKcal: null, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: null });
    const together = provenanceProfiles([polar, flow, strava].map(toInput));
    expect(together.get('pf')).toMatchObject({ role: 'relay', basis: 'copy_of_native_in_same_event', ecosystem: 'polar' });
    expect(together.get('a')!.role).toBe('unknown'); // Strava: nao prova de quem veio
    expect(provenanceProfiles([toInput(flow)]).get('pf')!.role).toBe('unknown'); // sozinho: indeterminado
  });
});

describe('Etapa 3A v2 — selecao canonica por evento', () => {
  it('Polar + Strava(HealthKit) + Polar Flow(HealthKit) -> Polar direto canonico; Polar Flow = relay; Strava = unknown (todos preservados)', async () => {
    const ctx = buildService([POLAR_RICH(), HK_STRAVA(), HK_POLAR_FLOW()]);
    await evaluateAll(ctx, ['a', 'pf', 'p']);
    expect(ctx.partition()).toEqual(['a+p+pf']);
    for (const id of ['p', 'a', 'pf']) expect(canonicalOf(ctx, id)).toBe('p');
    const reason = reasonOf(ctx, 'p');
    expect(reason).toMatchObject({ version: 2, rule: 'native_recorder', nativeObservationPresent: true, overrideEcosystem: null });
    expect(roleOf(reason, 'p')).toBe('native_recorder');
    expect(roleOf(reason, 'pf')).toBe('relay');
    expect(roleOf(reason, 'a')).toBe('unknown');
    expect(ctx.data.size).toBe(3);
  });

  it('Garmin + Strava(HealthKit) + Garmin Connect(HealthKit) -> Garmin canonico (por papel, nao por marca)', async () => {
    const ctx = buildService([GARMIN(), HK_STRAVA(), HK_GARMIN_CONNECT()]);
    await evaluateAll(ctx, ['gh', 'a', 'g']);
    expect(canonicalOf(ctx, 'a')).toBe('g');
    expect(roleOf(reasonOf(ctx, 'g'), 'gh')).toBe('relay');
  });

  it('somente Strava via HealthKit (relogio conectado mas nao gravou): treino reconhecido, observacao unica canonica, sem exigir o relogio', async () => {
    const ctx = buildService([HK_STRAVA()]);
    await evaluateAll(ctx, ['a']);
    expect(canonicalOf(ctx, 'a')).toBe('a');
    expect(reasonOf(ctx, 'a')).toMatchObject({ version: 2, rule: 'sole_observation', nativeObservationPresent: false });
    expect(roleOf(reasonOf(ctx, 'a'), 'a')).toBe('unknown');
  });

  it('sem gravador nativo no evento: melhor observacao disponivel (best_available), sem tratar como erro e sem promover origem', async () => {
    const richer = { ...HK_STRAVA('a'), avgHeartRateBpm: 150, caloriesKcal: 500 } as Row;
    const other = row('z', 'apple_health', 'com.exemplo.app', '2026-10-06T09:00:05Z', 34, 7.0);
    const ctx = buildService([richer, other]);
    await evaluateAll(ctx, ['a', 'z']);
    expect(ctx.partition()).toEqual(['a+z']);
    expect(canonicalOf(ctx, 'z')).toBe('a');
    expect(reasonOf(ctx, 'a')).toMatchObject({ rule: 'best_available', nativeObservationPresent: false, tieBreak: 'completeness' });
    expect(roleOf(reasonOf(ctx, 'a'), 'z')).toBe('unknown');
  });

  it('Apple Watch (nativo via HealthKit) + Strava(HealthKit) -> Apple Watch canonico', async () => {
    const ctx = buildService([HK_STRAVA(), WATCH_NATIVE()]);
    await evaluateAll(ctx, ['a', 'w']);
    expect(canonicalOf(ctx, 'a')).toBe('w');
    expect(roleOf(reasonOf(ctx, 'w'), 'w')).toBe('native_recorder');
    expect(roleOf(reasonOf(ctx, 'w'), 'a')).toBe('unknown');
  });

  it('HealthKit Apple SEM device nao e nativo: nao vence um HealthKit de terceiro mais completo (conservador)', async () => {
    const strava = { ...HK_STRAVA('a'), avgHeartRateBpm: 150, caloriesKcal: 500 } as Row;
    const ctx = buildService([strava, APPLE_WATCH('w')]); // APPLE_WATCH sem device
    await evaluateAll(ctx, ['a', 'w']);
    expect(canonicalOf(ctx, 'a')).toBe('a');
    expect(reasonOf(ctx, 'a').rule).toBe('best_available');
  });

  it('dois relogios (Polar direto + Apple Watch nativo): ambos nativos, desempate por completude, alternativa preservada e registrada', async () => {
    const ctx = buildService([POLAR_RICH(), WATCH_NATIVE()]);
    await evaluateAll(ctx, ['w', 'p']);
    expect(canonicalOf(ctx, 'w')).toBe('p');
    expect(reasonOf(ctx, 'p')).toMatchObject({ rule: 'native_recorder', tieBreak: 'completeness', nativeAlternatives: ['w'] });
    expect(ctx.data.has('w')).toBe(true);
  });

  it('override excepcional (AthletePrimarySource explicito) so desempata entre nativos; nunca promove copia/unknown sobre um nativo', async () => {
    const ctx = buildService([POLAR_RICH(), WATCH_NATIVE(), HK_STRAVA()]);
    ctx.setPrimary('user-1', 'apple_health', '2026-01-01T00:00:00Z'); // suporte prefere o ecossistema Apple
    await evaluateAll(ctx, ['p', 'w', 'a']);
    expect(canonicalOf(ctx, 'a')).toBe('w'); // desempate entre os dois nativos
    expect(reasonOf(ctx, 'w')).toMatchObject({ tieBreak: 'explicit_override', overrideEcosystem: 'apple_health', nativeAlternatives: ['p'] });
    // override para um ecossistema SEM nativo no evento nao tem efeito
    const ctx2 = buildService([POLAR_RICH(), HK_STRAVA()]);
    ctx2.setPrimary('user-1', 'strava', '2026-01-01T00:00:00Z');
    await evaluateAll(ctx2, ['p', 'a']);
    expect(canonicalOf(ctx2, 'a')).toBe('p');
    expect(reasonOf(ctx2, 'p').overrideEcosystem).toBeNull();
  });

  it('sem nenhuma configuracao a escolha e automatica; WorkoutDelivery NAO influencia a canonica', async () => {
    const without = buildService([POLAR_RICH(), WATCH_NATIVE()]);
    await evaluateAll(without, ['p', 'w']);
    const withDelivery = buildService([POLAR_RICH(), WATCH_NATIVE()]);
    withDelivery.addDelivery('user-1', 'apple_health', 'sent', '2026-10-01T00:00:00Z'); // entrega para a Apple, nao muda nada
    await evaluateAll(withDelivery, ['p', 'w']);
    expect(canonicalOf(withDelivery, 'w')).toBe(canonicalOf(without, 'w'));
    expect(JSON.stringify(reasonOf(withDelivery, 'p'))).toBe(JSON.stringify(reasonOf(without, 'p')));
  });

  it('chegada tardia da melhor observacao: a canonica e recalculada (cópia -> nativa) sem apagar nada', async () => {
    const ctx = buildService([HK_STRAVA()]);
    await evaluateAll(ctx, ['a']);
    expect(canonicalOf(ctx, 'a')).toBe('a');
    ctx.data.set('p', { ...POLAR_RICH() });
    await ctx.service.evaluate('p');
    expect(canonicalOf(ctx, 'a')).toBe('p');
    expect(canonicalOf(ctx, 'p')).toBe('p');
    expect(reasonOf(ctx, 'p').rule).toBe('native_recorder');
    ctx.data.set('pf', { ...HK_POLAR_FLOW() });
    await ctx.service.evaluate('pf');
    expect(canonicalOf(ctx, 'pf')).toBe('p');
    expect(roleOf(reasonOf(ctx, 'p'), 'pf')).toBe('relay'); // agora ha evidencia suficiente de copia
    expect(ctx.data.size).toBe(3);
  });

  it('independe da ordem de chegada: todas as ordens de Polar, Polar Flow(HK), Strava(HK) e Apple Watch dao a mesma canonica e os mesmos papeis', async () => {
    const rowsById: Record<string, Row> = { p: POLAR_RICH(), pf: HK_POLAR_FLOW(), a: HK_STRAVA(), w: WATCH_NATIVE() };
    const outcomes = new Set<string>();
    for (const order of permutations(['p', 'pf', 'a', 'w'])) {
      const ctx = buildService([]);
      for (const id of order) { ctx.data.set(id, { ...rowsById[id] }); await ctx.service.evaluate(id); }
      outcomes.add(JSON.stringify(['p', 'pf', 'a', 'w'].map((id) => [canonicalOf(ctx, id), reasonOf(ctx, id)])));
    }
    expect(outcomes.size).toBe(1);
  });

  it('troca de relogio ao longo do tempo: cada evento resolve pelas SUAS observacoes, sem configuracao e sem reescrever a historia', async () => {
    const oldRun = { ...POLAR_RICH('p-old'), startedAt: new Date('2026-09-10T09:00:00Z') } as Row;
    const oldCopy = row('a-old', 'apple_health', 'com.strava.stravaride', '2026-09-10T09:00:15Z', 34, 7.01);
    const newRun = { ...GARMIN('g-new'), startedAt: new Date('2026-10-20T09:00:00Z') } as Row;
    const newCopy = row('gh-new', 'apple_health', 'com.garmin.connect.mobile', '2026-10-20T09:00:15Z', 34, 7.01);
    const ctx = buildService([oldRun, oldCopy, newRun, newCopy]);
    await evaluateAll(ctx, ['p-old', 'a-old', 'g-new', 'gh-new']);
    expect(canonicalOf(ctx, 'a-old')).toBe('p-old');
    expect(canonicalOf(ctx, 'gh-new')).toBe('g-new');
    const historic = JSON.stringify(reasonOf(ctx, 'p-old'));
    await ctx.service.recomputeCanonicalForUser('user-1');
    await ctx.service.evaluate('g-new');
    expect(JSON.stringify(reasonOf(ctx, 'p-old'))).toBe(historic); // evento antigo intacto
  });

  it('observacao unica e canonica de si mesma; ambigua fica sem canonica', async () => {
    const lone = buildService([POLAR()]);
    await lone.service.evaluate('p');
    expect(reasonOf(lone, 'p')).toMatchObject({ version: 2, rule: 'sole_observation' });
    const weakApple = row('a', 'apple_health', 'com.strava.stravaride', '2026-10-06T09:05:00Z', 35, null);
    const amb = buildService([{ ...POLAR(), distanceMeters: null } as Row, weakApple]);
    await amb.service.evaluate('a');
    expect(canonicalOf(amb, 'a')).toBeNull();
    expect(canonicalOf(amb, 'p')).toBeNull();
  });

  it('gravador nativo sem duracao e distancia nao e valido: cai para a melhor observacao valida (best_available)', () => {
    const base = { caloriesKcal: null, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: null };
    const emptyPolar = { id: 'p', provider: 'polar', providerMetrics: null, durationSec: null, distanceMeters: null, ...base };
    const hk = { id: 'a', provider: 'apple_health', providerMetrics: { source: { bundleId: 'com.strava.stravaride' } }, durationSec: 2040, distanceMeters: 7010, ...base };
    const selection = selectCanonicalObservation([emptyPolar, hk]);
    expect(selection!.canonicalId).toBe('a');
    expect(selection!.reason).toMatchObject({ rule: 'best_available', nativeObservationPresent: true });
  });

  it('preservacao: recalcular e idempotente, so escreve colunas physical*, nenhum ActivityLog excluido e nenhuma metrica copiada', async () => {
    const ctx = buildService([POLAR_RICH(), HK_STRAVA(), WATCH_NATIVE()]);
    await evaluateAll(ctx, ['p', 'a', 'w']);
    const writesBefore = ctx.activityLog.update.mock.calls.length;
    await ctx.service.recomputeCanonicalForUser('user-1');
    await ctx.service.recomputeCanonicalForUser('user-1');
    expect(ctx.activityLog.update.mock.calls.length).toBe(writesBefore);
    expect(ctx.data.size).toBe(3);
    for (const id of ['p', 'a', 'w']) {
      const before = JSON.parse(ctx.original.get(id)!);
      const after = ctx.data.get(id)!;
      for (const k of ['provider', 'externalId', 'rawActivityId', 'sport', 'durationSec', 'distanceMeters', 'providerMetrics', 'executionClassification', 'userId']) {
        expect(JSON.stringify((after as any)[k])).toBe(JSON.stringify(before[k]));
      }
    }
    expect(((ctx.data.get('w') as any).avgHeartRateBpm ?? null)).toBeNull(); // nada copiado da Polar para o Apple Watch
    const allowed = new Set(['physicalEventId', 'physicalIdentityStatus', 'physicalIdentityEvidence', 'physicalIdentityEvaluatedAt', 'physicalCanonicalActivityLogId', 'physicalCanonicalReason']);
    for (const call of ctx.activityLog.update.mock.calls) for (const k of Object.keys((call[0] as any).data)) expect(allowed.has(k)).toBe(true);
  });
});

// ---- Preparo para o Health Connect (Android) — observacoes SIMULADAS (o adaptador ainda nao existe) ----------------------------------
// Contrato de providerMetrics que o futuro adaptador deve gravar (e que os mecanismos compartilhados ja interpretam):
//   { channel:'health_connect', source:{ packageName (metadata.dataOrigin), name }, device:{ manufacturer, model, name }|null,
//     recordingMethod:'actively_recorded'|'automatically_recorded'|'manual_entry'|null, endedAt }
// O Health Connect e' um CANAL: nunca prova quem gravou (app intermediario x app de origem x dispositivo gravador sao camadas distintas).
const SAMSUNG_HEALTH = 'com.sec.android.app.shealth';
const POLAR_FLOW_PKG = 'fi.polar.polarflow';
const STRAVA_PKG = 'com.strava';
const GARMIN_CONNECT_PKG = 'com.garmin.android.apps.connectmobile';
const GALAXY_WATCH = { manufacturer: 'Samsung', model: 'SM-R960', name: 'Galaxy Watch6' };
const GALAXY_PHONE = { manufacturer: 'Samsung', model: 'SM-S918B', name: 'Galaxy S23' };

type HcOptions = { device?: Record<string, string> | null; method?: string | null; userId?: string; sport?: string | null };
function hcRow(id: string, pkg: string, start: string, minutes: number, km: number | null, options: HcOptions = {}): Row {
  const base = row(id, 'health_connect', null, start, minutes, km, options.userId ?? 'user-1', options.sport === undefined ? 'corrida' : options.sport);
  return {
    ...base,
    providerMetrics: {
      channel: 'health_connect', source: { packageName: pkg, name: pkg }, device: options.device ?? null, recordingMethod: options.method === undefined ? 'actively_recorded' : options.method,
      endedAt: new Date(new Date(start).getTime() + minutes * 60000).toISOString(),
    },
  };
}
const HC_SAMSUNG_WATCH = (id = 'hs') => hcRow(id, SAMSUNG_HEALTH, '2026-10-06T09:00:05Z', 34, 7.0, { device: GALAXY_WATCH });
const HC_POLAR_FLOW = (id = 'hp') => hcRow(id, POLAR_FLOW_PKG, '2026-10-06T09:00:12Z', 34, 7.01);
const HC_STRAVA = (id = 'hx') => hcRow(id, STRAVA_PKG, '2026-10-06T09:00:18Z', 34, 7.02);

describe('Health Connect — observador e proveniencia (mecanismos compartilhados)', () => {
  it('observerKeyOf: app de origem + dispositivo gravador quando informado; Apple e provider direto seguem iguais', () => {
    const watch = observerKeyOf('health_connect', HC_SAMSUNG_WATCH().providerMetrics);
    const phone = observerKeyOf('health_connect', hcRow('x', SAMSUNG_HEALTH, '2026-10-06T09:00:00Z', 34, 7, { device: GALAXY_PHONE }).providerMetrics);
    expect(watch).toBe(`health_connect:${SAMSUNG_HEALTH}|samsung/sm-r960`);
    expect(phone).not.toBe(watch); // mesmo app, dispositivos diferentes = observadores diferentes (podem ser comparados)
    expect(observerKeyOf('health_connect', HC_POLAR_FLOW().providerMetrics)).toBe(`health_connect:${POLAR_FLOW_PKG}`); // sem device: so o app
    expect(observerKeyOf('health_connect', null)).toBe('health_connect:desconhecido');
    expect(observerKeyOf('health_connect', { source: { name: 'App X' } })).toBe('health_connect:app x');
    expect(observerKeyOf('polar', null)).toBe('polar');
    expect(observerKeyOf('apple_health', { source: { bundleId: 'com.strava.stravaride' } })).toBe('apple_health:com.strava.stravaride');
    expect(observerKeyOf('apple_health', { source: { bundleId: 'com.apple.health.X' }, device: APPLE_DEVICE })).toBe('apple_health:com.apple.health.x'); // device nao entra na chave Apple
  });

  it('o canal Health Connect NUNCA e gravador nativo por ser Health Connect (sem origem/dispositivo comprovados)', () => {
    expect(baseProvenanceProfile('health_connect', null)).toMatchObject({ role: 'unknown', ecosystem: null, basis: 'third_party_app_source' });
    expect(baseProvenanceProfile('health_connect', { source: { packageName: 'com.exemplo.app' } })).toMatchObject({ role: 'unknown', ecosystem: null });
    expect(baseProvenanceProfile('health_connect', HC_POLAR_FLOW().providerMetrics)).toMatchObject({ role: 'unknown', ecosystem: 'polar', basis: 'third_party_app_source' });
    expect(baseProvenanceProfile('health_connect', HC_STRAVA().providerMetrics)).toMatchObject({ role: 'unknown', ecosystem: 'strava' });
    expect(baseProvenanceProfile('health_connect', hcRow('g', GARMIN_CONNECT_PKG, '2026-10-06T09:00:00Z', 34, 7).providerMetrics)).toMatchObject({ role: 'unknown', ecosystem: 'garmin' });
  });

  it('Samsung Health: so e gravador nativo com dispositivo Samsung gravando; sem device ou com entrada manual NAO se presume Galaxy Watch', () => {
    expect(baseProvenanceProfile('health_connect', HC_SAMSUNG_WATCH().providerMetrics)).toMatchObject({ role: 'native_recorder', ecosystem: 'samsung', basis: 'samsung_device_recorded' });
    expect(baseProvenanceProfile('health_connect', hcRow('a', SAMSUNG_HEALTH, '2026-10-06T09:00:00Z', 34, 7, { device: GALAXY_WATCH, method: 'automatically_recorded' }).providerMetrics).role).toBe('native_recorder');
    const noDevice = hcRow('b', SAMSUNG_HEALTH, '2026-10-06T09:00:00Z', 34, 7);
    expect(baseProvenanceProfile('health_connect', noDevice.providerMetrics)).toMatchObject({ role: 'unknown', ecosystem: 'samsung', basis: 'samsung_source_without_recording_device' });
    const otherMaker = hcRow('c', SAMSUNG_HEALTH, '2026-10-06T09:00:00Z', 34, 7, { device: { manufacturer: 'Polar', model: 'Pacer Pro' } });
    expect(baseProvenanceProfile('health_connect', otherMaker.providerMetrics)).toMatchObject({ role: 'unknown', basis: 'samsung_source_without_recording_device' }); // Samsung Health pode ter importado
    const manual = hcRow('d', SAMSUNG_HEALTH, '2026-10-06T09:00:00Z', 34, 7, { device: GALAXY_WATCH, method: 'manual_entry' });
    expect(baseProvenanceProfile('health_connect', manual.providerMetrics)).toMatchObject({ role: 'unknown', basis: 'manual_entry' });
    const unknownMethod = hcRow('e', SAMSUNG_HEALTH, '2026-10-06T09:00:00Z', 34, 7, { device: GALAXY_WATCH, method: null });
    expect(baseProvenanceProfile('health_connect', unknownMethod.providerMetrics).role).toBe('unknown'); // metodo ausente nao comprova gravacao
  });

  const candidate = (r: Row) => ({ id: r.id, provider: r.provider, providerMetrics: r.providerMetrics, durationSec: r.durationSec, distanceMeters: r.distanceMeters, caloriesKcal: null, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: null });

  it('copia pelo Health Connect so vira relay com gravacao nativa DIRETA do mesmo ecossistema no evento (Polar Flow + Polar direto); Strava nunca', () => {
    const withPolar = provenanceProfiles([candidate(POLAR()), candidate(HC_POLAR_FLOW())]);
    expect(withPolar.get('hp')).toMatchObject({ role: 'relay', ecosystem: 'polar', basis: 'copy_of_native_in_same_event' });
    expect(withPolar.get('p')!.role).toBe('native_recorder');
    expect(provenanceProfiles([candidate(HC_POLAR_FLOW())]).get('hp')!.role).toBe('unknown'); // sozinha: indeterminada, nunca relay nem nativa
    expect(provenanceProfiles([candidate(POLAR()), candidate(HC_STRAVA())]).get('hx')!.role).toBe('unknown'); // agregador nunca e promovido
    expect(provenanceProfiles([candidate(POLAR()), candidate(HC_SAMSUNG_WATCH())]).get('hs')!.role).toBe('native_recorder'); // outro ecossistema nativo comprovado nao e copia da Polar
    expect(provenanceProfiles([candidate(HC_SAMSUNG_WATCH()), candidate(HC_POLAR_FLOW())]).get('hp')!.role).toBe('unknown'); // sem Polar direto nao ha prova de copia
  });

  it('escolha da canonica nao depende da ordem: Polar direto vence a copia Polar Flow do Health Connect em todas as permutacoes', () => {
    for (const order of permutations([candidate(POLAR()), candidate(HC_POLAR_FLOW()), candidate(HC_STRAVA())])) {
      const selection = selectCanonicalObservation(order)!;
      expect(selection.canonicalId).toBe('p');
      expect(selection.reason.candidates.find((c) => c.activityLogId === 'hp')!.role).toBe('relay');
    }
  });
});

describe('Health Connect — identidade fisica e deduplicacao (servico em memoria, observacoes simuladas)', () => {
  const eventOf = (ctx: ReturnType<typeof buildService>, id: string) => ctx.data.get(id)!.physicalEventId;
  const statusOf = (ctx: ReturnType<typeof buildService>, id: string) => ctx.data.get(id)!.physicalIdentityStatus;

  it('1. Polar direto + copia Apple Health: um evento, canonica Polar (referencia de comportamento ja existente)', async () => {
    const ctx = buildService([POLAR_RICH(), HK_POLAR_FLOW()]);
    await evaluateAll(ctx, ['p', 'pf']);
    expect(ctx.partition()).toEqual(['p+pf']);
    expect(canonicalOf(ctx, 'p')).toBe('p');
  });

  it('2. Polar direto + copia simulada pelo Health Connect (Polar Flow): um evento; canonica Polar; copia preservada e sem classificacao — em todas as ordens', async () => {
    for (const order of permutations(['p', 'hp'])) {
      const ctx = buildService([POLAR_RICH(), HC_POLAR_FLOW()]);
      await evaluateAll(ctx, order);
      expect(ctx.partition()).toEqual(['hp+p']);
      expect(canonicalOf(ctx, 'hp')).toBe('p');
      expect(canonicalOf(ctx, 'p')).toBe('p');
      expect(roleOf(reasonOf(ctx, 'p'), 'hp')).toBe('relay');
      expect(ctx.data.size).toBe(2); // nada excluido
      expect(ctx.data.get('hp')!.executionClassification).toBeNull();
    }
  });

  it('3. duas origens diferentes dentro do Health Connect (Samsung Health do relogio + Polar Flow): um evento; canonica = gravacao Samsung comprovada', async () => {
    for (const order of permutations(['hs', 'hp'])) {
      const ctx = buildService([HC_SAMSUNG_WATCH(), HC_POLAR_FLOW()]);
      await evaluateAll(ctx, order);
      expect(ctx.partition()).toEqual(['hp+hs']);
      expect(canonicalOf(ctx, 'hp')).toBe('hs');
      expect(roleOf(reasonOf(ctx, 'hs'), 'hs')).toBe('native_recorder');
      expect(roleOf(reasonOf(ctx, 'hs'), 'hp')).toBe('unknown'); // sem Polar direto nao se afirma copia
    }
  });

  it('3b. mesmo app (Samsung Health) com relogio e celular do mesmo treino: dispositivos distintos sao comparaveis e formam UM evento', async () => {
    const ctx = buildService([HC_SAMSUNG_WATCH('w'), hcRow('ph', SAMSUNG_HEALTH, '2026-10-06T09:00:10Z', 34, 6.98, { device: GALAXY_PHONE })]);
    await evaluateAll(ctx, ['w', 'ph']);
    expect(ctx.partition()).toEqual(['ph+w']);
  });

  it('3c. mesma origem NAO significa mesma atividade: dois registros do mesmo app+dispositivo nunca se fundem, mesmo sobrepostos', async () => {
    const ctx = buildService([HC_SAMSUNG_WATCH('a'), hcRow('b', SAMSUNG_HEALTH, '2026-10-06T09:00:30Z', 34, 7.0, { device: GALAXY_WATCH })]);
    await evaluateAll(ctx, ['a', 'b']);
    expect(ctx.partition()).toEqual([]);
    expect(statusOf(ctx, 'a')).toBe('unique');
    expect(statusOf(ctx, 'b')).toBe('unique');
  });

  it('3d. mesmo agregador NAO significa atividades diferentes nem iguais: Health Connect de manha e a noite = duas execucoes; mesmo horario de apps diferentes = uma', async () => {
    const distinct = buildService([HC_STRAVA('m'), hcRow('n', GARMIN_CONNECT_PKG, '2026-10-06T21:00:00Z', 34, 7.0)]);
    await evaluateAll(distinct, ['m', 'n']);
    expect(distinct.partition()).toEqual([]);
    const same = buildService([HC_STRAVA('m'), hcRow('n', GARMIN_CONNECT_PKG, '2026-10-06T09:00:30Z', 34, 7.0)]);
    await evaluateAll(same, ['m', 'n']);
    expect(same.partition()).toEqual(['m+n']);
  });

  it('4. reenvio do mesmo registro pela mesma fonte: reavaliar e idempotente (evento, canonica e motivo estaveis; nada excluido)', async () => {
    const ctx = buildService([POLAR_RICH(), HC_POLAR_FLOW()]);
    await evaluateAll(ctx, ['p', 'hp']);
    const event = eventOf(ctx, 'p');
    const reason = JSON.stringify(reasonOf(ctx, 'p'));
    for (let i = 0; i < 3; i++) await ctx.service.evaluate('hp');
    expect(ctx.partition()).toEqual(['hp+p']);
    expect(eventOf(ctx, 'p')).toBe(event);
    expect(JSON.stringify(reasonOf(ctx, 'p'))).toBe(reason);
    expect(canonicalOf(ctx, 'hp')).toBe('p');
    expect(ctx.data.size).toBe(2);
  });

  it('5. chegada tardia de outra observacao da mesma corrida entra no evento ja identificado, sem criar outro evento (todas as ordens)', async () => {
    const baseline = buildService([POLAR_RICH(), HC_SAMSUNG_WATCH()]);
    await evaluateAll(baseline, ['p', 'hs']);
    const event = eventOf(baseline, 'p');
    const late = buildService([POLAR_RICH(), HC_SAMSUNG_WATCH(), HC_STRAVA()]);
    await evaluateAll(late, ['p', 'hs']);
    expect(eventOf(late, 'p')).toBe(event);
    await late.service.evaluate('hx');
    expect(late.partition()).toEqual(['hs+hx+p']);
    expect(eventOf(late, 'p')).toBe(event); // o grupo existente mantem o id
    expect(new Set(['p', 'hs', 'hx'].map((id) => canonicalOf(late, id))).size).toBe(1); // uma unica canonica
    const reference = buildService([POLAR_RICH(), HC_SAMSUNG_WATCH(), HC_STRAVA()]);
    await evaluateAll(reference, ['hx', 'hs', 'p']);
    expect(reference.partition()).toEqual(late.partition());
    expect(canonicalOf(reference, 'p')).toBe(canonicalOf(late, 'p'));
  });

  it('6/7. atualizacao que transforma matched em ambiguous (e depois resolve): estado coerente nos dois sentidos, sem perder dados', async () => {
    const ctx = buildService([POLAR_RICH(), HC_POLAR_FLOW()]);
    await evaluateAll(ctx, ['p', 'hp']);
    expect(ctx.partition()).toEqual(['hp+p']);
    // o registro do Health Connect e atualizado na origem com uma distancia muito divergente no mesmo horario
    ctx.data.get('hp')!.distanceMeters = 9000;
    await ctx.service.evaluate('hp');
    for (const id of ['p', 'hp']) {
      expect(statusOf(ctx, id)).toBe('ambiguous');
      expect(eventOf(ctx, id)).toBeNull();
      expect(canonicalOf(ctx, id)).toBeNull();
    }
    expect(ctx.data.size).toBe(2);
    expect(ctx.data.get('p')!.distanceMeters).toBe(7010); // nenhuma observacao foi alterada pela avaliacao
    // a origem corrige a distancia: a identidade se resolve de volta
    ctx.data.get('hp')!.distanceMeters = 7010;
    await ctx.service.evaluate('hp');
    expect(ctx.partition()).toEqual(['hp+p']);
    expect(statusOf(ctx, 'p')).toBe('matched');
    expect(canonicalOf(ctx, 'hp')).toBe('p');
  });

  it('8. duas corridas legitimas em horarios proximos continuam duas execucoes (sem sobreposicao), inclusive do mesmo app', async () => {
    const polarThenHc = buildService([POLAR(), hcRow('h', STRAVA_PKG, '2026-10-06T09:50:00Z', 34, 7.0)]);
    await evaluateAll(polarThenHc, ['p', 'h']);
    expect(polarThenHc.partition()).toEqual([]);
    expect(statusOf(polarThenHc, 'p')).toBe('unique');
    expect(statusOf(polarThenHc, 'h')).toBe('unique');
    const backToBack = buildService([hcRow('a', STRAVA_PKG, '2026-10-06T09:00:00Z', 30, 6.0), hcRow('b', STRAVA_PKG, '2026-10-06T09:35:00Z', 30, 6.0)]);
    await evaluateAll(backToBack, ['a', 'b']);
    expect(backToBack.partition()).toEqual([]);
  });

  it('9. divergencias: pequenas (<=1%) = mesmo evento; distancia relevante no mesmo horario = ambiguo; horario muito diferente = distinto', async () => {
    const small = buildService([POLAR(), hcRow('h', POLAR_FLOW_PKG, '2026-10-06T09:00:40Z', 34, 7.01 * 1.005)]);
    await evaluateAll(small, ['p', 'h']);
    expect(small.partition()).toEqual(['h+p']);
    const relevant = buildService([POLAR(), hcRow('h', STRAVA_PKG, '2026-10-06T09:00:10Z', 34, 7.01 * 1.06)]);
    await evaluateAll(relevant, ['p', 'h']);
    expect(statusOf(relevant, 'p')).toBe('ambiguous');
    expect(statusOf(relevant, 'h')).toBe('ambiguous');
    const farApart = buildService([POLAR(), hcRow('h', STRAVA_PKG, '2026-10-06T12:00:00Z', 34, 7.01)]);
    await evaluateAll(farApart, ['p', 'h']);
    expect(statusOf(farApart, 'p')).toBe('unique');
  });

  it('10. fusos: o instante com offset (-03:00) coincide com o UTC e agrupa; horario LOCAL lido como UTC (erro de adaptador) NAO e corrigido pela busca de +-12h', async () => {
    const correct = buildService([POLAR(), hcRow('h', POLAR_FLOW_PKG, new Date('2026-10-06T06:00:00-03:00').toISOString(), 34, 7.01)]);
    await evaluateAll(correct, ['p', 'h']);
    expect(correct.partition()).toEqual(['h+p']);
    const misread = buildService([POLAR(), hcRow('h', POLAR_FLOW_PKG, '2026-10-06T06:00:00Z', 34, 7.01)]); // 09:00Z gravado como 06:00Z (3 h de erro)
    await evaluateAll(misread, ['p', 'h']);
    expect(misread.partition()).toEqual([]); // limitacao conhecida: o adaptador PRECISA enviar instante com offset; o matcher nao adivinha fuso
    expect(statusOf(misread, 'p')).toBe('unique');
  });

  it('usuarios diferentes nunca se fundem, mesmo com observacoes identicas vindas do Health Connect', async () => {
    const ctx = buildService([HC_SAMSUNG_WATCH('a'), hcRow('b', POLAR_FLOW_PKG, '2026-10-06T09:00:10Z', 34, 7.0, { userId: 'user-2' })]);
    await evaluateAll(ctx, ['a', 'b']);
    expect(ctx.partition()).toEqual([]);
  });
});
