import { compareObservations, observerKeyOf, ObservedActivity } from '../src/activity-execution/physical-activity-identity';
import { PhysicalActivityIdentityService } from '../src/activity-execution/physical-activity-identity.service';

// 02/11/2026 — o MESMO app de origem regravando o MESMO treino (caso real: Garmin Connect reescreveu no Apple Saude, com outro UUID e agora com FC, corridas/forca de 29/10 a 31/10).
// Regra: so' quando inicio e duracao coincidem EXATAMENTE (ao segundo), na mesma modalidade, e a distancia nao diverge. Qualquer outra coisa segue distinta, como antes.

const GARMIN = { source: { bundleId: 'com.garmin.connect.mobile', name: 'Connect' } };
const GARMIN_KEY = observerKeyOf('apple_health', GARMIN);

function obs(over: Partial<ObservedActivity> & { id: string }): ObservedActivity {
  return {
    userId: 'u', provider: 'apple_health', sport: 'corrida', startedAt: new Date('2026-10-31T11:31:05.000Z'),
    durationSec: 2512, distanceMeters: 7010, endedAt: null, observerKey: GARMIN_KEY, ...over,
  };
}

describe('mesmo app regravando o mesmo treino — comparacao pura', () => {
  it('inicio e duracao identicos, mesma modalidade -> same / same_observer_identical_record', () => {
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b' }))).toMatchObject({ verdict: 'same', reason: 'same_observer_identical_record' });
  });

  it('uma das copias sem distancia (null) continua o mesmo treino; forca com 0 e 0 tambem', () => {
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', distanceMeters: null })).verdict).toBe('same');
    expect(compareObservations(obs({ id: 'a', sport: 'forca', distanceMeters: 0, durationSec: 3247 }), obs({ id: 'b', sport: 'forca', distanceMeters: 0, durationSec: 3247 })).verdict).toBe('same');
  });

  it('milissegundos diferentes no mesmo segundo ainda coincidem; 1 segundo de diferenca no inicio NAO', () => {
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', startedAt: new Date('2026-10-31T11:31:05.900Z') })).verdict).toBe('same');
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', startedAt: new Date('2026-10-31T11:31:06.000Z') }))).toMatchObject({ verdict: 'distinct', reason: 'same_observer_two_records' });
  });

  it('duracao diferente (mesmo inicio) -> continuam distintos (um treino encerrado e outro iniciado)', () => {
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', durationSec: 2513 }))).toMatchObject({ verdict: 'distinct', reason: 'same_observer_two_records' });
  });

  it('duas corridas seguidas do mesmo app (fim de uma = inicio da outra) -> distintas', () => {
    const first = obs({ id: 'a', durationSec: 1800 });
    const second = obs({ id: 'b', startedAt: new Date(first.startedAt.getTime() + 1800 * 1000), durationSec: 1800 });
    expect(compareObservations(first, second).verdict).toBe('distinct');
  });

  it('modalidades diferentes no mesmo instante -> distintas; modalidade desconhecida nunca vira same', () => {
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', sport: 'forca' })).verdict).toBe('distinct');
    expect(compareObservations(obs({ id: 'a', sport: 'outra' }), obs({ id: 'b', sport: 'outra' })).verdict).toBe('distinct');
  });

  it('distancia muito diferente no mesmo instante -> continuam distintos (nao funde algo estranho)', () => {
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', distanceMeters: 9000 }))).toMatchObject({ verdict: 'distinct', reason: 'same_observer_two_records' });
  });

  it('sem duracao ou duracao zero -> sem coincidencia exata para afirmar', () => {
    expect(compareObservations(obs({ id: 'a', durationSec: null }), obs({ id: 'b', durationSec: null })).verdict).toBe('distinct');
    expect(compareObservations(obs({ id: 'a', durationSec: 0 }), obs({ id: 'b', durationSec: 0 })).verdict).toBe('distinct');
  });

  it('outro atleta nunca; simetrico (A,B) = (B,A); corrida x esteira do mesmo app NAO conta como mesma modalidade exata', () => {
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', userId: 'v' })).verdict).toBe('distinct');
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', distanceMeters: null })).verdict).toBe(compareObservations(obs({ id: 'b', distanceMeters: null }), obs({ id: 'a' })).verdict);
    expect(compareObservations(obs({ id: 'a' }), obs({ id: 'b', sport: 'esteira' })).verdict).toBe('distinct');
  });
});

// ---- Servico com banco em memoria -------------------------------------------------------------------------------------------------
type Row = Record<string, any>;

function row(id: string, start: string, over: Row = {}): Row {
  return {
    id, userId: 'u', provider: 'apple_health', externalId: `ext-${id}`, sport: 'corrida', startedAt: new Date(start), durationSec: 2512, distanceMeters: 7010,
    caloriesKcal: 378, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: 25, hasRoute: false,
    providerMetrics: { ...GARMIN, device: null, endedAt: new Date(new Date(start).getTime() + (over.durationSec ?? 2512) * 1000).toISOString() },
    physicalEventId: null, physicalIdentityStatus: null, physicalCanonicalActivityLogId: null, physicalCanonicalReason: null, physicalIdentityEvidence: null, ...over,
  };
}

function build(rows: Row[]) {
  const data = new Map(rows.map((r) => [r.id, { ...r }]));
  const match = (r: Row, where: any) => {
    if (where.userId && r.userId !== where.userId) return false;
    if (where.startedAt && (r.startedAt < where.startedAt.gte || r.startedAt > where.startedAt.lte)) return false;
    if (where.physicalEventId?.in && !where.physicalEventId.in.includes(r.physicalEventId)) return false;
    if (where.id?.in && !where.id.in.includes(r.id)) return false;
    return true;
  };
  const activityLog = {
    findUnique: jest.fn(async ({ where }: any) => (data.has(where.id) ? { ...data.get(where.id) } : null)),
    findMany: jest.fn(async ({ where }: any) => [...data.values()].filter((r) => match(r, where)).map((r) => ({ ...r }))),
    update: jest.fn(async ({ where, data: patch }: any) => Object.assign(data.get(where.id)!, patch)),
  };
  const athletePrimarySource = { findFirst: jest.fn(async () => null) };
  const workoutDelivery = { findFirst: jest.fn(async () => null) };
  const tx = { $executeRaw: jest.fn(async () => 1), activityLog, athletePrimarySource, workoutDelivery };
  const prisma = { activityLog, athletePrimarySource, $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { service: new PhysicalActivityIdentityService(prisma as never), data };
}

describe('servico — copias do mesmo app viram UM evento; a mais completa e a canonica', () => {
  const START = '2026-10-31T11:31:05.000Z';

  it('caso da Ju (31/10): copia sem FC (chegou antes) + copia com FC (chegou depois) -> um evento, canonica = a com FC, nenhuma metrica copiada', async () => {
    const { service, data } = build([row('sem-fc', START)]);
    expect(await service.evaluate('sem-fc')).toMatchObject({ status: 'unique' });
    // so' no dia seguinte chega a segunda copia, com outro UUID e agora com FC
    data.set('com-fc', row('com-fc', START, { avgHeartRateBpm: 132, maxHeartRateBpm: 145 }));
    const result = await service.evaluate('com-fc');
    expect(result).toMatchObject({ status: 'matched', memberCount: 2 });
    expect(data.get('sem-fc')!.physicalEventId).toBe(data.get('com-fc')!.physicalEventId);
    expect(data.get('sem-fc')!.physicalCanonicalActivityLogId).toBe('com-fc');
    expect(data.get('com-fc')!.physicalCanonicalActivityLogId).toBe('com-fc');
    // a copia sem FC continua sem FC (nada e' fundido)
    expect(data.get('sem-fc')!.avgHeartRateBpm).toBeNull();
    // a mudanca de canonica da copia antiga e' devolvida para a reconciliacao posterior
    expect(result!.affectedActivityLogIds).toEqual(expect.arrayContaining(['sem-fc']));
  });

  it('ordem de chegada nao importa', async () => {
    const forward = build([row('a', START), row('b', START, { avgHeartRateBpm: 132 })]);
    await forward.service.evaluate('a'); await forward.service.evaluate('b');
    const reverse = build([row('a', START), row('b', START, { avgHeartRateBpm: 132 })]);
    await reverse.service.evaluate('b'); await reverse.service.evaluate('a');
    for (const ctx of [forward, reverse]) {
      expect(ctx.data.get('a')!.physicalIdentityStatus).toBe('matched');
      expect(ctx.data.get('a')!.physicalCanonicalActivityLogId).toBe('b');
    }
  });

  it('forca 29/10: TRES copias identicas (2 sem FC, 1 com FC) -> um unico evento, canonica = a com FC, nenhuma fica ambigua', async () => {
    const s = '2026-10-29T10:40:15.000Z';
    const base = { sport: 'forca', distanceMeters: 0, durationSec: 3326, caloriesKcal: 208 };
    const { service, data } = build([row('f1', s, base), row('f2', s, base), row('f3', s, { ...base, avgHeartRateBpm: 95, maxHeartRateBpm: 132 })]);
    for (const id of ['f1', 'f2', 'f3']) await service.evaluate(id);
    const groups = new Set(['f1', 'f2', 'f3'].map((id) => data.get(id)!.physicalEventId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
    for (const id of ['f1', 'f2', 'f3']) {
      expect(data.get(id)!.physicalIdentityStatus).toBe('matched');
      expect(data.get(id)!.physicalCanonicalActivityLogId).toBe('f3');
    }
  });

  it('duas corridas diferentes do mesmo app no mesmo dia continuam dois eventos, e uma duplicata nao arrasta a outra', async () => {
    const morning = row('m', '2026-10-31T09:00:00.000Z', { durationSec: 1800 });
    const noon = row('n', '2026-10-31T09:30:00.000Z', { durationSec: 1800 });
    const noonCopy = row('n2', '2026-10-31T09:30:00.000Z', { durationSec: 1800, avgHeartRateBpm: 140 });
    const { service, data } = build([morning, noon, noonCopy]);
    for (const id of ['m', 'n', 'n2']) await service.evaluate(id);
    expect(data.get('m')!.physicalIdentityStatus).toBe('unique');
    expect(data.get('n')!.physicalEventId).toBe(data.get('n2')!.physicalEventId);
    expect(data.get('n')!.physicalEventId).not.toBe(data.get('m')!.physicalEventId);
  });

  it('reavaliar sem mudanca nao altera nada (idempotente)', async () => {
    const { service } = build([row('a', START), row('b', START, { avgHeartRateBpm: 132 })]);
    await service.evaluate('a'); await service.evaluate('b');
    expect(await service.evaluate('b')).toMatchObject({ status: 'matched', affectedActivityLogIds: [] });
  });
});
