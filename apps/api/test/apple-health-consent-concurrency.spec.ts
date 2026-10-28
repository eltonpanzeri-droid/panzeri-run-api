import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { AppleHealthConsentService } from '../src/apple-health/apple-health-consent.service';
import { AppleHealthIngestionService } from '../src/apple-health/apple-health-ingestion.service';
import { APPLE_HEALTH_CONSENT } from '../src/apple-health/apple-health-consent';
import { consentTextHash } from '../src/provider-hub/provider-consent.service';

// Revogacao x gravacao concorrentes (28/10/2026, correcao da auditoria). Os servicos REAIS rodam sobre um banco em memoria que simula as travas de linha do Postgres: `FOR SHARE` (gravacoes) e
// `FOR UPDATE` (alteracao/retirada de autorizacao) se excluem; quem pede espera ate a transacao dona confirmar. Dados SINTETICOS.

const UUID_A = '9f1c2a3b-1111-4222-8333-444455556666';
const UUID_B = '0a0b0c0d-2222-4333-8444-555566667777';
const ack = { acknowledged: true, version: APPLE_HEALTH_CONSENT.version, textHash: consentTextHash(APPLE_HEALTH_CONSENT) };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(condition: () => boolean) { for (let i = 0; i < 500 && !condition(); i += 1) await tick(); if (!condition()) throw new Error('condicao nao atingida'); }
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }

function fakeDb() {
  const rows = new Map<string, any>();
  const logs: any[] = []; const raws: any[] = []; const points: any[] = []; const events: any[] = [];
  const hooks: { onPointsCreate?: () => Promise<void>; onLogCreate?: () => Promise<void>; onPointsDelete?: () => Promise<void> } = {};
  // travas por linha (um usuario basta aqui)
  const lock = { shared: 0, exclusive: false, waiters: [] as Array<{ mode: 'share' | 'update'; grant: () => void }>, waitingUpdate: 0, waitingShare: 0 };
  const compatible = (mode: 'share' | 'update') => (mode === 'share' ? !lock.exclusive : !lock.exclusive && lock.shared === 0);
  const pump = () => { while (lock.waiters.length > 0 && compatible(lock.waiters[0].mode)) { const w = lock.waiters.shift()!; if (w.mode === 'share') { lock.shared += 1; lock.waitingShare -= 1; } else { lock.exclusive = true; lock.waitingUpdate -= 1; } w.grant(); } };
  const acquire = async (mode: 'share' | 'update') => {
    if (lock.waiters.length === 0 && compatible(mode)) { if (mode === 'share') lock.shared += 1; else lock.exclusive = true; return; }
    if (mode === 'share') lock.waitingShare += 1; else lock.waitingUpdate += 1;
    await new Promise<void>((resolve) => { lock.waiters.push({ mode, grant: resolve }); });
  };
  const release = (mode: 'share' | 'update') => { if (mode === 'share') lock.shared -= 1; else lock.exclusive = false; pump(); };
  const logOf = (id: string) => logs.find((l) => l.id === id);
  let seq = 0;

  const store: any = {
    providerConnection: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.provider_userId.userId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => { const k = where.provider_userId.userId; rows.set(k, { ...(rows.get(k) ?? {}), ...(rows.has(k) ? update : create) }); return rows.get(k); }),
      updateMany: jest.fn(async ({ where, data }: any) => { const row = rows.get(where.userId); if (!row || (where.disconnectedAt === null && row.disconnectedAt)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    },
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => logs.find((l) => l.provider === where.provider_userId_externalId.provider && l.userId === where.provider_userId_externalId.userId && l.externalId === where.provider_userId_externalId.externalId) ?? null),
      create: jest.fn(async ({ data }: any) => { if (hooks.onLogCreate) { const h = hooks.onLogCreate; hooks.onLogCreate = undefined; await h(); } const row = { id: `log-${++seq}`, hasRoute: false, ...data }; logs.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(logOf(where.id), data); return logOf(where.id); }),
      updateMany: jest.fn(async ({ where, data }: any) => { let count = 0; for (const l of logs) if (l.userId === where.userId && l.provider === where.provider && (where.hasRoute === undefined || l.hasRoute === where.hasRoute)) { Object.assign(l, data); count += 1; } return { count }; }),
      findMany: jest.fn(async ({ where }: any) => logs.filter((l) => l.userId === where.userId && l.provider === where.provider && l.providerMetrics)),
    },
    activityTimeSeriesPoint: {
      deleteMany: jest.fn(async ({ where }: any) => {
        if (hooks.onPointsDelete) { const h = hooks.onPointsDelete; hooks.onPointsDelete = undefined; await h(); }
        for (let i = points.length - 1; i >= 0; i -= 1) {
          const p = points[i]; const owner = logOf(p.activityLogId);
          const byActivity = where.activityLogId ? p.activityLogId === where.activityLogId : owner?.userId === where.activityLog?.userId;
          if (byActivity && p.provider === where.provider) points.splice(i, 1);
        }
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: any) => { if (hooks.onPointsCreate) { const h = hooks.onPointsCreate; hooks.onPointsCreate = undefined; await h(); } points.push(...data); return { count: data.length }; }),
      updateMany: jest.fn(async ({ where, data }: any) => { for (const p of points) if (p.provider === where.provider && p.elevationMeters != null && logOf(p.activityLogId)?.userId === where.activityLog.userId) Object.assign(p, data); return { count: 0 }; }),
    },
    rawExternalActivity: {
      upsert: jest.fn(async ({ where, create }: any) => { const existing = raws.find((r) => r.externalId === where.provider_userId_externalId.externalId && r.userId === where.provider_userId_externalId.userId); if (existing) return existing; const row = { id: `raw-${++seq}`, ...create }; raws.push(row); return row; }),
      findMany: jest.fn(async ({ where }: any) => raws.filter((r) => r.userId === where.userId && r.provider === where.provider)),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(raws.find((r) => r.id === where.id), data); return {}; }),
    },
    providerConnectionEvent: { create: jest.fn(async ({ data }: any) => { events.push(data); return data; }), findMany: jest.fn(async () => []) },
  };
  const prisma: any = {
    ...store,
    $transaction: jest.fn(async (fn: any) => {
      const held: Array<'share' | 'update'> = [];
      const tx: any = {
        ...store,
        $queryRaw: jest.fn(async (strings: TemplateStringsArray, _provider: string, userId: string) => {
          const mode = strings.join('?').includes('FOR UPDATE') ? 'update' : 'share';
          await acquire(mode); held.push(mode);
          const row = rows.get(userId); return row ? [row] : [];
        }),
      };
      try { return await fn(tx); } finally { for (const mode of held) release(mode); }
    }),
  };
  return { prisma, rows, logs, raws, points, events, hooks, lock };
}

function setup() {
  const db = fakeDb();
  const providerData = { invalidateAiArtifacts: jest.fn(async () => ({})), deleteProviderData: jest.fn(async () => ({})) };
  const consent = new AppleHealthConsentService(db.prisma, providerData as never);
  const ingestion = new AppleHealthIngestionService(db.prisma, undefined, undefined, undefined, consent);
  return { ...db, consent, ingestion, providerData };
}
const workout = (uuid = UUID_A, extra: Record<string, unknown> = {}) => ({
  uuid, sourceName: 'Treino', sourceBundleId: 'com.apple.health.X', deviceName: 'Apple Watch', deviceManufacturer: 'Apple Inc.', startDate: '2026-10-03T09:00:00.000Z', endDate: '2026-10-03T09:45:00.000Z',
  durationSeconds: 2700, distanceMeters: 6000, activityType: 'running', activityTypeRaw: 37, isIndoor: false, timeZone: 'America/Sao_Paulo', ...extra,
});
const sensors = { avgHeartRateBpm: 150, maxHeartRateBpm: 175, stepCount: 6500, powerAvgWatts: 230, elevationGainMeters: 40 };
const route = (id = UUID_A) => ({ routes: [{ recordId: id, points: Array.from({ length: 12 }, (_, i) => [i * 5, -23.5 + i * 0.0001, -46.6, 760]) }] });
const grantAll = (c: AppleHealthConsentService, user = 'u1') => c.updateGroups(user, { grant: ['workouts', 'sensors', 'route'], ...ack });

describe('revogacao concorrente com gravacao em andamento', () => {
  it('rota ja em gravacao quando a revogacao chega: a revogacao espera, depois APAGA o que foi gravado e nenhuma rota fica; nova rota e recusada', async () => {
    const t = setup();
    await grantAll(t.consent);
    await t.ingestion.importWorkouts('u1', { workouts: [workout()] });
    const writing = gate();
    t.hooks.onPointsCreate = () => writing.promise; // a gravacao do percurso fica pausada DENTRO da transacao
    const route1 = t.ingestion.importRoutes('u1', route());
    await until(() => t.lock.shared === 1);
    let revoked = false;
    const revoke = t.consent.updateGroups('u1', { revoke: ['route'] }).then(() => { revoked = true; });
    await until(() => t.lock.waitingUpdate === 1); // a revogacao esta esperando a gravacao terminar
    expect(revoked).toBe(false);
    writing.release();
    await route1; await revoke;
    expect(t.points).toHaveLength(0);
    expect(t.logs[0].hasRoute).toBe(false);
    expect(t.rows.get('u1').grantedCategories).toEqual(['activity', 'activity_sensors']);
    await expect(t.ingestion.importRoutes('u1', route())).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.points).toHaveLength(0);
  });

  it('revogacao em andamento quando a rota chega (autorizacao consultada ANTES): a gravacao espera, rele a retirada dentro da trava e nao grava nada', async () => {
    const t = setup();
    await grantAll(t.consent);
    await t.ingestion.importWorkouts('u1', { workouts: [workout()] });
    const paused = gate();
    t.hooks.onPointsDelete = () => paused.promise; // a revogacao fica pausada na limpeza, com a linha travada
    const revoke = t.consent.updateGroups('u1', { revoke: ['route'] });
    await until(() => t.lock.exclusive);
    const incoming = t.ingestion.importRoutes('u1', route()); // passa na checagem inicial (consentimento ainda com percurso) e vai esperar a trava
    await until(() => t.lock.waitingShare === 1);
    paused.release();
    await revoke;
    const result = await incoming;
    expect(result).toMatchObject({ stored: 0 });
    expect(result.items[0]).toMatchObject({ status: 'rejected', reason: 'categoria_nao_autorizada' });
    expect(t.points).toHaveLength(0);
    expect(t.logs[0].hasRoute).toBe(false);
  });

  it('sensores: gravacao em andamento durante a retirada de sensores termina e a retirada apaga o que ela gravou; gravacoes seguintes ja nao guardam sensores', async () => {
    const t = setup();
    await grantAll(t.consent);
    const writing = gate();
    t.hooks.onLogCreate = () => writing.promise;
    const importing = t.ingestion.importWorkouts('u1', { workouts: [workout(UUID_A, sensors)] });
    await until(() => t.lock.shared === 1);
    const revoke = t.consent.updateGroups('u1', { revoke: ['sensors'] });
    await until(() => t.lock.waitingUpdate === 1);
    writing.release();
    await importing; await revoke;
    expect(t.logs[0]).toMatchObject({ avgHeartRateBpm: null, maxHeartRateBpm: null, powerAvgWatts: null, cadenceAvg: null, elevationGainMeters: null });
    expect(t.raws[0].payload.avgHeartRateBpm).toBeNull();
    await t.ingestion.importWorkouts('u1', { workouts: [workout(UUID_B, sensors)] });
    const second = t.logs.find((l) => l.externalId === UUID_B)!;
    expect(second).toMatchObject({ avgHeartRateBpm: null, powerAvgWatts: null });
    expect(second.distanceMeters).toBe(6000); // o treino em si segue importado
  });

  it('retirada total no meio de um lote: o treino em gravacao termina, os seguintes sao recusados (autorizacao_retirada) e nada e regravado depois', async () => {
    const t = setup();
    await grantAll(t.consent);
    const writing = gate();
    t.hooks.onLogCreate = () => writing.promise;
    const batch = t.ingestion.importWorkouts('u1', { workouts: [workout(UUID_A), workout(UUID_B)] });
    await until(() => t.lock.shared === 1);
    const withdraw = t.consent.withdrawAll('u1');
    await until(() => t.lock.waitingUpdate === 1);
    writing.release();
    const result = await batch; await withdraw;
    expect(result.items[0]).toMatchObject({ status: 'created' });
    expect(result.items[1]).toMatchObject({ status: 'rejected', reason: 'autorizacao_retirada' });
    expect(t.logs.map((l) => l.externalId)).toEqual([UUID_A]);
    await expect(t.ingestion.importWorkouts('u1', { workouts: [workout(UUID_B)] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(t.ingestion.importRoutes('u1', route())).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.logs).toHaveLength(1);
    expect(t.points).toHaveLength(0);
  });

  it('preserva o que nao foi revogado: treino, distancia, outras categorias autorizadas, dados de OUTRA fonte e outros alunos', async () => {
    const t = setup();
    await grantAll(t.consent);
    await t.consent.updateGroups('u2', { grant: ['workouts', 'route'], ...ack });
    await t.ingestion.importWorkouts('u1', { workouts: [workout(UUID_A, sensors)] });
    await t.ingestion.importRoutes('u1', route());
    await t.ingestion.importWorkouts('u2', { workouts: [workout(UUID_B)] });
    await t.ingestion.importRoutes('u2', route(UUID_B));
    // dados de outra fonte do MESMO aluno
    t.logs.push({ id: 'polar-1', userId: 'u1', provider: 'polar', externalId: 'p1', avgHeartRateBpm: 140, hasRoute: true, providerMetrics: { stepCount: 100 } });
    t.points.push({ activityLogId: 'polar-1', provider: 'polar', latitude: 1, longitude: 1, elevationMeters: 5 });
    await t.consent.updateGroups('u1', { revoke: ['route'] });
    const a = t.logs.find((l) => l.externalId === UUID_A)!;
    expect(a).toMatchObject({ hasRoute: false, avgHeartRateBpm: 150, distanceMeters: 6000, provider: 'apple_health' }); // sensores continuam autorizados
    expect(t.points.filter((p) => p.provider === 'apple_health' && p.activityLogId === a.id)).toHaveLength(0);
    expect(t.points.some((p) => p.provider === 'polar')).toBe(true);
    expect(t.logs.find((l) => l.id === 'polar-1')).toMatchObject({ hasRoute: true, avgHeartRateBpm: 140 });
    const b = t.logs.find((l) => l.externalId === UUID_B)!;
    expect(b.hasRoute).toBe(true); // outro aluno intacto
    expect(t.points.filter((p) => p.activityLogId === b.id).length).toBeGreaterThan(0);
    await t.consent.updateGroups('u1', { revoke: ['sensors'] });
    expect(t.logs.find((l) => l.externalId === UUID_A)).toMatchObject({ avgHeartRateBpm: null, distanceMeters: 6000 });
    expect(t.logs.find((l) => l.id === 'polar-1')).toMatchObject({ avgHeartRateBpm: 140 });
    expect(t.rows.get('u1').grantedCategories).toEqual(['activity']);
  });
});
