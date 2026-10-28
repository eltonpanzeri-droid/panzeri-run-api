import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APPLE_ROUTE_LIMITS, AppleHealthIngestionService, appleRoutesBodyBytes } from '../src/apple-health/apple-health-ingestion.service';
import { PayloadTooLargeException } from '@nestjs/common';
import { bodySize, fitRoute } from '../../mobile/src/appleHealthSync/appleHealthSyncLogic';
import { classifySourceFamily, normalizeAppleHealthWorkout, utcOffsetMinutesAt } from '../src/apple-health/apple-health-normalizer';

// Etapa 1 da integracao Apple (06/10/2026): HKWorkout -> normalizer -> RawExternalActivity -> ActivityLog, com
// provenance preservada, idempotencia por HKWorkout.uuid e isolamento por usuario. Sem deduplicacao cross-provider,
// sem reconciliacao, sem IA.

const UUID_A = '9F1C2A3B-1111-4222-8333-444455556666';
const UUID_B = '0A0B0C0D-2222-4333-8444-555566667777';

function workout(overrides: Record<string, unknown> = {}) {
  return {
    uuid: UUID_A,
    sourceName: 'Treino',
    sourceBundleId: 'com.apple.health.5EC8D3F5-AAAA-BBBB-CCCC-123456789ABC',
    deviceName: 'Apple Watch',
    deviceManufacturer: 'Apple Inc.',
    deviceModel: 'Watch',
    startDate: '2026-10-03T09:00:00.000Z',
    endDate: '2026-10-03T09:45:00.000Z',
    durationSeconds: 2700.4,
    distanceMeters: 6000,
    activityType: 'running',
    activityTypeRaw: 37,
    isIndoor: false,
    timeZone: 'America/Sao_Paulo',
    workoutPlanId: null,
    ...overrides,
  };
}

describe('normalizeAppleHealthWorkout', () => {
  it('1. normaliza um HKWorkout de corrida para os campos canonicos', () => {
    const result = normalizeAppleHealthWorkout(workout());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { value } = result;
    expect(value.activity.sport).toBe('corrida');
    expect(value.activity.startedAt.toISOString()).toBe('2026-10-03T09:00:00.000Z');
    expect(value.activity.durationSec).toBe(2700);
    expect(value.activity.distanceMeters).toBe(6000);
    expect(value.activity.utcOffsetMinutes).toBe(-180); // America/Sao_Paulo, sem horario de verao em out/2026
  });

  it('2. preserva o UUID (minusculo, chave de idempotencia) e separa canal de ingestao da origem observada', () => {
    const result = normalizeAppleHealthWorkout(workout());
    if (!result.ok) throw new Error('esperava ok');
    expect(result.value.externalId).toBe(UUID_A.toLowerCase());
    expect(result.value.raw.uuid).toBe(UUID_A.toLowerCase());
    expect(result.value.providerMetrics).toMatchObject({
      channel: 'healthkit',
      hkWorkoutUuid: UUID_A.toLowerCase(),
      source: { name: 'Treino', bundleId: expect.stringContaining('com.apple.health'), family: 'apple' },
      device: { name: 'Apple Watch', manufacturer: 'Apple Inc.', model: 'Watch' },
    });
    // O canal (healthkit) NAO e' a origem: a origem vem do source informado pelo HealthKit.
    expect((result.value.providerMetrics.source as { family: string }).family).not.toBe('healthkit');
  });

  it('3. source Apple: familia "apple"', () => {
    expect(classifySourceFamily('com.apple.health.ABC')).toBe('apple');
    expect(classifySourceFamily('com.apple.workout')).toBe('apple');
  });

  it('4. source Strava: familia "strava", mas continua sendo canal healthkit (nao vira provider strava)', () => {
    const result = normalizeAppleHealthWorkout(workout({ sourceName: 'Strava', sourceBundleId: 'com.strava.stravaride', deviceName: null, deviceManufacturer: null, deviceModel: null }));
    if (!result.ok) throw new Error('esperava ok');
    expect(result.value.providerMetrics).toMatchObject({ channel: 'healthkit', source: { name: 'Strava', bundleId: 'com.strava.stravaride', family: 'strava' } });
    expect(result.value.providerMetrics.device).toBeNull(); // sem device informado: nao inventa "Apple Watch"
    expect(classifySourceFamily('com.garmin.connect.mobile')).toBeNull(); // desconhecido continua null
  });

  it('5. campos ausentes permanecem null — nunca zero, nunca inventados', () => {
    const result = normalizeAppleHealthWorkout({ uuid: UUID_B, startDate: '2026-10-03T09:00:00.000Z', endDate: '2026-10-03T09:30:00.000Z' });
    if (!result.ok) throw new Error('esperava ok');
    expect(result.value.activity.durationSec).toBeNull();
    expect(result.value.activity.distanceMeters).toBeNull();
    expect(result.value.activity.utcOffsetMinutes).toBeNull(); // sem timezone do treino: nao usa o fuso do aparelho/servidor
    expect(result.value.activity.sport).toBe('outra'); // tipo desconhecido: nao assume corrida
    expect(result.value.providerMetrics).toMatchObject({ source: { name: null, bundleId: null, family: null }, device: null, isIndoor: null, timeZone: null });
    expect(result.value.raw.distanceMeters).toBeNull();
    expect(result.value.raw.workoutPlanId).toBeNull();
  });

  it('rejeita dado invalido (uuid, datas, duracao/distancia negativas) em vez de gravar lixo', () => {
    expect(normalizeAppleHealthWorkout(workout({ uuid: 'abc' }))).toEqual({ ok: false, reason: 'uuid_invalido' });
    expect(normalizeAppleHealthWorkout(workout({ startDate: 'ontem' }))).toEqual({ ok: false, reason: 'inicio_invalido' });
    expect(normalizeAppleHealthWorkout(workout({ endDate: '2026-10-03T08:00:00.000Z' }))).toEqual({ ok: false, reason: 'fim_invalido' });
    expect(normalizeAppleHealthWorkout(workout({ durationSeconds: -1 }))).toEqual({ ok: false, reason: 'duracao_invalida' });
    expect(normalizeAppleHealthWorkout(workout({ distanceMeters: 'muito' }))).toEqual({ ok: false, reason: 'distancia_invalida' });
    expect(normalizeAppleHealthWorkout(null)).toEqual({ ok: false, reason: 'item_invalido' });
  });

  it('fuso invalido nao gera offset', () => {
    expect(utcOffsetMinutesAt('Nao/Existe', new Date('2026-10-03T09:00:00Z'))).toBeNull();
  });
});

// Banco em memoria com a mesma chave unica (provider, userId, externalId) do schema.
function buildService(options: { failFirstCreateWithP2002?: boolean; consent?: { mode: 'legacy' | 'recorded' | 'blocked'; allowed: string[] }; failRouteWriteFor?: string[]; identity?: unknown } = {}) {
  const points: Array<Record<string, unknown>> = [];
  const failRoutes = new Set(options.failRouteWriteFor ?? []);
  const raws = new Map<string, { id: string; userId: string; payload: unknown; payloadSchemaVersion?: string; ingestionMeta?: unknown }>();
  const logs = new Map<string, { id: string; userId: string; provider: string; externalId: string; [k: string]: unknown }>();
  let seq = 0;
  let failOnce = options.failFirstCreateWithP2002 ?? false;
  const k = (w: { provider_userId_externalId: { provider: string; userId: string; externalId: string } }) => {
    const { provider, userId, externalId } = w.provider_userId_externalId;
    return `${provider}|${userId}|${externalId}`;
  };
  const tx = {
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => logs.get(k(where)) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const row = [...logs.values()].find((l) => l.id === where.id)!; Object.assign(row, data); return row; }),
      create: jest.fn(async ({ data }: any) => {
        if (failOnce) {
          failOnce = false;
          // simula o vencedor da corrida gravando primeiro
          const key = `${data.provider}|${data.userId}|${data.externalId}`;
          logs.set(key, { id: `log-${++seq}`, ...data });
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: `log-${++seq}`, ...data };
        logs.set(`${data.provider}|${data.userId}|${data.externalId}`, row);
        return row;
      }),
    },
    activityTimeSeriesPoint: {
      deleteMany: jest.fn(async ({ where }: any) => { for (let i = points.length - 1; i >= 0; i -= 1) if (points[i].activityLogId === where.activityLogId) points.splice(i, 1); }),
      createMany: jest.fn(async ({ data }: any) => {
        const owner = [...logs.values()].find((l) => l.id === data[0].activityLogId);
        if (owner && failRoutes.has(String(owner.externalId))) throw new Error('falha simulada');
        points.push(...data);
      }),
    },
    rawExternalActivity: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = k(where);
        const existing = raws.get(key);
        if (existing) return existing;
        const row = { id: `raw-${++seq}`, ...create };
        raws.set(key, row);
        return row;
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    activityLog: { findMany: jest.fn(async ({ where }: any) => [...logs.values()].filter((l) => l.userId === where.userId && where.externalId.in.includes(l.externalId)).map((l) => ({ externalId: l.externalId, hasRoute: l.hasRoute === true }))) },
  };
  const access = options.consent ? { mode: options.consent.mode, allowed: new Set(options.consent.allowed) } : null;
  const consent = access ? { access: jest.fn(async () => access), writeWhileAuthorized: jest.fn(async (_user: string, write: (t: typeof tx, a: typeof access) => Promise<unknown>) => write(tx, access)) } : undefined;
  const link = options.identity ? { reconcileEvent: jest.fn(async () => ({})), reconcileAffectedByIdentity: jest.fn(async () => undefined) } : undefined;
  return { service: new AppleHealthIngestionService(prisma as never, options.identity as never, link as never, undefined, consent as never), raws, logs, tx, prisma, points, consent, failRoutes };
}

describe('AppleHealthIngestionService', () => {
  it('importa pela arquitetura canonica: RawExternalActivity + ActivityLog (provider apple_health), sem classificar nem reconciliar', async () => {
    const { service, raws, logs } = buildService();
    const result = await service.importWorkouts('user-1', { workouts: [workout()] });
    expect(result).toMatchObject({ created: 1, alreadyImported: 0, rejected: 0 });
    expect(raws.size).toBe(1);
    expect(logs.size).toBe(1);
    const log = [...logs.values()][0];
    expect(log).toMatchObject({ userId: 'user-1', provider: 'apple_health', externalId: UUID_A.toLowerCase(), sport: 'corrida' });
    expect(log.rawActivityId).toBe([...raws.values()][0].id);
    // Nada de reconciliacao nesta etapa: a atividade nasce sem classificacao (consumidores de TI/evolucao so' leem 'corresponding'/'alternative').
    expect(log.executionClassification).toBeUndefined();
    const raw = [...raws.values()][0];
    expect(raw.payloadSchemaVersion).toBe('apple-healthkit-workout-v1');
    expect(raw.ingestionMeta).toMatchObject({ channel: 'healthkit' });
  });

  it('6. importar de novo o mesmo HKWorkout.uuid nao cria outro ActivityLog nem outro Raw (mesmo com caixa diferente)', async () => {
    const { service, raws, logs } = buildService();
    await service.importWorkouts('user-1', { workouts: [workout()] });
    const again = await service.importWorkouts('user-1', { workouts: [workout(), workout({ uuid: UUID_A.toLowerCase() })] });
    expect(again).toMatchObject({ created: 0, alreadyImported: 2, rejected: 0 });
    expect(raws.size).toBe(1);
    expect(logs.size).toBe(1);
    expect(again.items[0].activityLogId).toBe([...logs.values()][0].id);
  });

  it('envio duplicado no mesmo lote cria um so', async () => {
    const { service, logs } = buildService();
    const result = await service.importWorkouts('user-1', { workouts: [workout(), workout()] });
    expect(result).toMatchObject({ created: 1, alreadyImported: 1 });
    expect(logs.size).toBe(1);
  });

  it('corrida de concorrencia (P2002 na chave unica) vira already_imported, nao erro nem duplicata', async () => {
    const { service, logs } = buildService({ failFirstCreateWithP2002: true });
    const result = await service.importWorkouts('user-1', { workouts: [workout()] });
    expect(result).toMatchObject({ created: 0, alreadyImported: 1, rejected: 0 });
    expect(logs.size).toBe(1);
  });

  it('7. isolamento: o mesmo uuid em dois usuarios gera registros separados, sempre do userId autenticado', async () => {
    const { service, raws, logs } = buildService();
    const a = await service.importWorkouts('user-1', { workouts: [workout()] });
    const b = await service.importWorkouts('user-2', { workouts: [workout()] });
    expect(a.created).toBe(1);
    expect(b.created).toBe(1); // user-2 nao foi tratado como duplicata do user-1
    expect(logs.size).toBe(2);
    expect(raws.size).toBe(2);
    const owners = [...logs.values()].map((l) => l.userId).sort();
    expect(owners).toEqual(['user-1', 'user-2']);
    // Um userId no corpo nunca e' honrado.
    const spoof = await service.importWorkouts('user-3', { workouts: [{ ...workout({ uuid: UUID_B }), userId: 'user-1' }] });
    expect(spoof.created).toBe(1);
    expect([...logs.values()].find((l) => l.externalId === UUID_B.toLowerCase())?.userId).toBe('user-3');
  });

  it('lote com item invalido: rejeita so aquele item e reporta o motivo', async () => {
    const { service, logs } = buildService();
    const result = await service.importWorkouts('user-1', { workouts: [workout(), workout({ uuid: 'x' }), workout({ uuid: UUID_B })] });
    expect(result).toMatchObject({ created: 2, rejected: 1 });
    expect(result.items[1]).toMatchObject({ status: 'rejected', reason: 'uuid_invalido' });
    expect(logs.size).toBe(2);
  });

  it('corpo vazio, sem lista ou maior que 50 e recusado', async () => {
    const { service } = buildService();
    await expect(service.importWorkouts('user-1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importWorkouts('user-1', { workouts: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importWorkouts('user-1', { workouts: Array.from({ length: 51 }, () => workout()) })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AppleHealthIngestionService — D2 (reconciliar observacoes afetadas)', () => {
  it('apos avaliar a identidade, reconcilia a observacao importada e depois as OUTRAS afetadas; reimportar o mesmo uuid nao reprocessa nada', async () => {
    const ctx = buildService();
    const identityResult = { activityLogId: 'log-2', status: 'matched', physicalEventId: 'ev-1', memberCount: 2, affectedActivityLogIds: ['outra', 'log-2'] };
    const identity = { evaluateSafely: jest.fn(async () => identityResult) };
    const link = { reconcileEvent: jest.fn(async () => ({})), reconcileAffectedByIdentity: jest.fn(async () => undefined) };
    const service = new AppleHealthIngestionService(ctx.prisma as never, identity as never, link as never);
    await service.importWorkouts('user-1', { workouts: [workout()] });
    const logId = [...ctx.logs.values()][0].id;
    expect(identity.evaluateSafely).toHaveBeenCalledWith(logId);
    expect(link.reconcileEvent).toHaveBeenCalledWith(logId);
    expect(link.reconcileAffectedByIdentity).toHaveBeenCalledWith(identityResult, logId);
    expect(link.reconcileEvent.mock.invocationCallOrder[0]).toBeLessThan(link.reconcileAffectedByIdentity.mock.invocationCallOrder[0]);
    await service.importWorkouts('user-1', { workouts: [workout()] }); // ja importado: nao avalia nem reconcilia de novo
    expect(identity.evaluateSafely).toHaveBeenCalledTimes(1);
    expect(link.reconcileEvent).toHaveBeenCalledTimes(1);
    expect(link.reconcileAffectedByIdentity).toHaveBeenCalledTimes(1);
  });
});

describe('Apple Saude — medidas do treino e distancia (28/10/2026, correcoes da auditoria)', () => {
  const rich = { avgHeartRateBpm: 152.4, maxHeartRateBpm: 178, activeEnergyKcal: 430.6, stepCount: 6500, powerAvgWatts: 240.2, elevationGainMeters: 85.5, avgSpeedMetersPerSecond: 2.7 };
  const recorded = (...groups: string[]) => ({ mode: 'recorded' as const, allowed: ['activity', ...groups] });

  it('normaliza FC, energia, passos (cadencia), potencia e elevacao; ausentes ficam null e fora da faixa e descartado', () => {
    const result = normalizeAppleHealthWorkout(workout(rich));
    if (!result.ok) throw new Error('esperava ok');
    expect(result.value.activity).toMatchObject({ avgHeartRateBpm: 152, maxHeartRateBpm: 178, caloriesKcal: 431, powerAvgWatts: 240, elevationGainMeters: 85.5, cadenceAvg: 144 });
    expect(result.value.providerMetrics).toMatchObject({ stepCount: 6500, cadenceBasis: 'steps_over_duration', avgSpeedMetersPerSecond: 2.7 });
    const bare = normalizeAppleHealthWorkout(workout());
    if (!bare.ok) throw new Error('esperava ok');
    expect(bare.value.activity).toMatchObject({ avgHeartRateBpm: null, maxHeartRateBpm: null, caloriesKcal: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null });
    const absurd = normalizeAppleHealthWorkout(workout({ avgHeartRateBpm: 900, powerAvgWatts: -3, stepCount: 0 }));
    if (!absurd.ok) throw new Error('esperava ok');
    expect(absurd.value.activity).toMatchObject({ avgHeartRateBpm: null, powerAvgWatts: null, cadenceAvg: null });
  });

  it('distancia: informada (>0), zero informado, ausente, indisponivel na origem e ilegivel sao situacoes DIFERENTES; o zero nao vira null', () => {
    const status = (w: Record<string, unknown>) => { const r = normalizeAppleHealthWorkout(w); if (!r.ok) throw new Error('esperava ok'); return r.value; };
    const measured = status(workout({ distanceMeters: 5020 }));
    expect(measured.activity.distanceMeters).toBe(5020);
    expect(measured.providerMetrics).toMatchObject({ distanceStatus: 'measured', distanceLimitation: null });
    const zero = status(workout({ distanceMeters: 0 }));
    expect(zero.activity.distanceMeters).toBe(0); // mantido como a origem informou
    expect(zero.raw.distanceMeters).toBe(0);
    expect(zero.providerMetrics).toMatchObject({ distanceStatus: 'zero_reported', distanceLimitation: 'zero_informado_pela_origem_sem_evidencia_de_distancia_medida' });
    const absent = status(workout({ distanceMeters: undefined }));
    expect(absent.activity.distanceMeters).toBeNull();
    expect(absent.providerMetrics).toMatchObject({ distanceStatus: 'absent' });
    const unavailable = status(workout({ distanceMeters: null, distanceStatus: 'unavailable' }));
    expect(unavailable.activity.distanceMeters).toBeNull();
    expect(unavailable.providerMetrics).toMatchObject({ distanceStatus: 'unavailable_at_source' });
    expect(unavailable.raw.distanceStatus).toBe('unavailable');
    // falha de leitura/conversao: rejeitado com motivo (nunca vira zero nem null silencioso)
    expect(normalizeAppleHealthWorkout(workout({ distanceMeters: 'NaN' }))).toEqual({ ok: false, reason: 'distancia_invalida' });
    expect(normalizeAppleHealthWorkout(workout({ distanceMeters: -5 }))).toEqual({ ok: false, reason: 'distancia_invalida' });
  });

  it('sem o grupo de sensores, FC/passos/potencia/biomecanica/elevacao sao descartados (energia e velocidade ficam)', () => {
    const result = normalizeAppleHealthWorkout(workout({ ...rich, avgStrideLengthMeters: 1.1 }), { sensors: false });
    if (!result.ok) throw new Error('esperava ok');
    expect(result.value.activity).toMatchObject({ avgHeartRateBpm: null, maxHeartRateBpm: null, powerAvgWatts: null, elevationGainMeters: null, cadenceAvg: null, caloriesKcal: 431 });
    expect(result.value.raw).toMatchObject({ avgHeartRateBpm: null, stepCount: null, avgStrideLengthMeters: null, activeEnergyKcal: 430.6 });
  });

  it('compatibilidade: payload do aplicativo antigo (sem medidas novas, sem distanceStatus) importa em modo legacy e nada de sensor e aceito', async () => {
    const { service, logs } = buildService({ consent: { mode: 'legacy', allowed: [] } });
    const result = await service.importWorkouts('user-1', { workouts: [workout(), workout({ uuid: UUID_B, distanceMeters: 0 })] });
    expect(result).toMatchObject({ created: 2, rejected: 0, consent: { mode: 'legacy', sensors: false } });
    const rows = [...logs.values()];
    expect(rows[0]).toMatchObject({ distanceMeters: 6000, avgHeartRateBpm: null });
    expect(rows[1]).toMatchObject({ distanceMeters: 0 }); // zero informado: mantido
  });

  it('com payload novo em modo legacy (sem registro de consentimento) as medidas de sensor NAO sao guardadas', async () => {
    const { service, logs } = buildService({ consent: { mode: 'legacy', allowed: [] } });
    await service.importWorkouts('user-1', { workouts: [workout(rich)] });
    expect([...logs.values()][0]).toMatchObject({ avgHeartRateBpm: null, powerAvgWatts: null, caloriesKcal: 431 });
  });

  it('consentimento: retirado/desatualizado bloqueia a importacao; registro sem o grupo de treinos tambem; com sensores autorizados as medidas sao guardadas', async () => {
    await expect(buildService({ consent: { mode: 'blocked', allowed: [] } }).service.importWorkouts('user-1', { workouts: [workout()] })).rejects.toThrow('nao esta autorizada');
    await expect(buildService({ consent: { mode: 'recorded', allowed: [] } }).service.importWorkouts('user-1', { workouts: [workout()] })).rejects.toThrow('nao esta autorizada');
    const withSensors = buildService({ consent: recorded('activity_sensors') });
    expect(await withSensors.service.importWorkouts('user-1', { workouts: [workout(rich)] })).toMatchObject({ created: 1, consent: { mode: 'recorded', sensors: true } });
    expect([...withSensors.logs.values()][0]).toMatchObject({ avgHeartRateBpm: 152, powerAvgWatts: 240, elevationGainMeters: 85.5 });
    const without = buildService({ consent: recorded() });
    await without.service.importWorkouts('user-1', { workouts: [workout(rich)] });
    expect([...without.logs.values()][0]).toMatchObject({ avgHeartRateBpm: null, powerAvgWatts: null });
  });

  it('reenvio: distancia null -> valor valido e preenchida; metricas null (colunas e providerMetrics) sao completadas; valores validos existentes nao sao sobrescritos', async () => {
    const { service, logs, raws } = buildService({ consent: recorded('activity_sensors') });
    await service.importWorkouts('user-1', { workouts: [workout({ distanceMeters: undefined })] });
    const log = [...logs.values()][0];
    expect(log.distanceMeters).toBeNull();
    log.avgHeartRateBpm = 140; // ja' existia: nao pode ser sobrescrito
    log.providerMetrics = { ...(log.providerMetrics as object), stepCount: null, avgSpeedMetersPerSecond: 2.0 }; // chave presente com null
    const again = await service.importWorkouts('user-1', { workouts: [workout({ distanceMeters: 6000, ...rich, avgHeartRateBpm: 999, avgSpeedMetersPerSecond: 9 })] });
    expect(again).toMatchObject({ created: 0, enriched: 1, alreadyImported: 1 });
    expect(logs.size).toBe(1);
    expect(raws.size).toBe(1);
    expect(log).toMatchObject({ distanceMeters: 6000, avgHeartRateBpm: 140, maxHeartRateBpm: 178, caloriesKcal: 431, powerAvgWatts: 240, cadenceAvg: 144 });
    expect(log.providerMetrics).toMatchObject({ stepCount: 6500, avgSpeedMetersPerSecond: 2.0 });
  });

  it('reenvio e idempotente: sem nada novo nao altera, nao duplica e nao apaga; zero ja gravado NAO e substituido nem apagado', async () => {
    const { service, logs } = buildService({ consent: recorded('activity_sensors') });
    await service.importWorkouts('user-1', { workouts: [workout({ distanceMeters: 0, ...rich })] });
    const log = [...logs.values()][0];
    const snapshot = JSON.stringify(log);
    const again = await service.importWorkouts('user-1', { workouts: [workout({ distanceMeters: 0, ...rich })] });
    expect(again).toMatchObject({ created: 0, enriched: 0, alreadyImported: 1 });
    expect(JSON.stringify(log)).toBe(snapshot);
    // origem passa a informar distancia > 0 para um treino que tinha 0: o 0 gravado e' preservado (nenhuma correcao retroativa automatica)
    await service.importWorkouts('user-1', { workouts: [workout({ distanceMeters: 7300, ...rich })] });
    expect(log.distanceMeters).toBe(0);
    expect(logs.size).toBe(1);
  });

  it('preservacao de ambiguos: completar FC/calorias NAO reavalia a identidade fisica; completar a distancia sim', async () => {
    const identity = { evaluateSafely: jest.fn(async () => ({ activityLogId: 'x', status: 'unique', affectedActivityLogIds: [] })) };
    const { service, logs } = buildService({ consent: recorded('activity_sensors'), identity });
    await service.importWorkouts('user-1', { workouts: [workout({ distanceMeters: 0 })] });
    expect(identity.evaluateSafely).toHaveBeenCalledTimes(1); // criacao
    const log = [...logs.values()][0];
    log.physicalIdentityStatus = 'ambiguous'; // como os dois registros de 08/10
    await service.importWorkouts('user-1', { workouts: [workout({ distanceMeters: 0, ...rich })] });
    expect(identity.evaluateSafely).toHaveBeenCalledTimes(1); // so' completou metricas: identidade intocada
    expect(log.physicalIdentityStatus).toBe('ambiguous');
    expect(log.avgHeartRateBpm).toBe(152);
    // distancia ausente completada: insumo da identidade mudou, entao e' reavaliada
    await service.importWorkouts('user-1', { workouts: [workout({ uuid: UUID_B, distanceMeters: undefined })] });
    log.distanceMeters = null;
    await service.importWorkouts('user-1', { workouts: [workout({ uuid: UUID_B, distanceMeters: 5000 })] });
    const second = [...logs.values()][1];
    expect(second.distanceMeters).toBe(5000);
    expect(identity.evaluateSafely).toHaveBeenCalledTimes(3); // 1a criacao + 2a criacao + distancia completada
  });
});

describe('Apple Saude — percurso GPS (28/10/2026)', () => {
  const pts = (n: number): Array<[number, number, number, number | null]> => Array.from({ length: n }, (_, i) => [i * 5, -23.5 + i * 0.0001, -46.6 + i * 0.0001, 760 + (i % 3)]);
  const recorded = (...groups: string[]) => ({ mode: 'recorded' as const, allowed: ['activity', ...groups] });

  it('sem consentimento registrado para o percurso o envio e recusado (a autorizacao do iOS nao basta); legacy e blocked tambem', async () => {
    for (const consent of [{ mode: 'legacy' as const, allowed: [] }, { mode: 'blocked' as const, allowed: [] }, recorded(), recorded('activity_sensors')]) {
      const { service } = buildService({ consent });
      await expect(service.importRoutes('user-1', { routes: [{ recordId: UUID_A, points: pts(10) }] })).rejects.toThrow('percurso');
    }
  });

  it('guarda o percurso de treino JA importado, sem depender de ele ter sido criado ou enriquecido agora; altitude so com o grupo de sensores', async () => {
    const { service, logs, points } = buildService({ consent: recorded('activity_route') });
    await service.importWorkouts('user-1', { workouts: [workout()] }); // treino importado antes, sem rota
    await service.importWorkouts('user-1', { workouts: [workout()] }); // reimportado: nada novo (nao enriquece)
    const result = await service.importRoutes('user-1', { routes: [{ recordId: UUID_A.toUpperCase(), points: pts(30) }] });
    expect(result).toMatchObject({ stored: 1, rejected: 0, items: [{ recordId: UUID_A.toLowerCase(), status: 'stored', points: 30 }] });
    expect([...logs.values()][0].hasRoute).toBe(true);
    expect(points).toHaveLength(30);
    expect(points.every((p) => p.elevationMeters === null && p.provider === 'apple_health')).toBe(true);
    const withAltitude = buildService({ consent: recorded('activity_route', 'activity_sensors') });
    await withAltitude.service.importWorkouts('user-1', { workouts: [workout()] });
    await withAltitude.service.importRoutes('user-1', { routes: [{ recordId: UUID_A, points: pts(5) }] });
    expect(withAltitude.points.some((p) => p.elevationMeters !== null)).toBe(true);
  });

  it('limites explicitos por requisicao: rotas demais e recusado, rota acima do limite de pontos e rejeitada (nao aceita calada) e atividade desconhecida volta com motivo', async () => {
    const { service } = buildService({ consent: recorded('activity_route') });
    await service.importWorkouts('user-1', { workouts: [workout()] });
    const many = Array.from({ length: APPLE_ROUTE_LIMITS.maxRoutesPerRequest + 1 }, () => ({ recordId: UUID_A, points: pts(5) }));
    await expect(service.importRoutes('user-1', { routes: many })).rejects.toThrow('rotas_demais');
    await expect(service.importRoutes('user-1', { routes: [{ recordId: UUID_A, points: pts(APPLE_ROUTE_LIMITS.maxPointsPerRoute + 1) }] })).rejects.toThrow('nenhuma_rota_valida');
    const mixed = await service.importRoutes('user-1', { routes: [{ recordId: UUID_A, points: pts(APPLE_ROUTE_LIMITS.maxPointsPerRoute) }, { recordId: UUID_B, points: pts(10) }] });
    expect(mixed).toMatchObject({ stored: 1, rejected: 1 });
    expect(mixed.items.find((i) => i.recordId === UUID_B.toLowerCase())).toMatchObject({ status: 'rejected', reason: 'atividade_nao_encontrada' });
    // o corpo de uma requisicao com o maximo permitido cabe no limite de bytes combinado com o app
    const biggest = JSON.stringify({ routes: Array.from({ length: 1 }, () => ({ recordId: UUID_A, points: pts(APPLE_ROUTE_LIMITS.maxPointsPerRoute).map((p) => [p[0], Number(p[1].toFixed(5)), Number(p[2].toFixed(5)), p[3]]) })) });
    expect(biggest.length).toBeLessThan(APPLE_ROUTE_LIMITS.maxRequestBytes); // 1 rota no maximo de pontos (coordenadas com 5 casas) cabe no orcamento de 60 KB, abaixo do limite de ~100 KB do corpo
  });

  it('falha parcial e recuperacao: a rota que falhou segue pendente e e enviada depois, sem duplicar a que ja foi guardada', async () => {
    const { service, logs, points, failRoutes } = buildService({ consent: recorded('activity_route'), failRouteWriteFor: [UUID_B.toLowerCase()] });
    await service.importWorkouts('user-1', { workouts: [workout(), workout({ uuid: UUID_B })] });
    const first = await service.importRoutes('user-1', { routes: [{ recordId: UUID_A, points: pts(20) }, { recordId: UUID_B, points: pts(20) }] });
    expect(first).toMatchObject({ stored: 1, rejected: 1 });
    expect(first.items.find((i) => i.recordId === UUID_B.toLowerCase())).toMatchObject({ status: 'rejected', reason: 'falha_ao_gravar' });
    const pending = await service.pendingRoutes('user-1', { recordIds: [UUID_A, UUID_B, '0c0c0c0c-9999-4999-8999-000000000000'] });
    expect(pending).toMatchObject({ pending: [UUID_B.toLowerCase()], complete: [UUID_A.toLowerCase()], notImported: ['0c0c0c0c-9999-4999-8999-000000000000'] });
    expect(pending.limits).toEqual(APPLE_ROUTE_LIMITS);
    // recuperacao: a falha era transitoria; o app consulta os pendentes e reenvia SO' a que falta
    const logB = [...logs.values()].find((l) => l.externalId === UUID_B.toLowerCase())!;
    expect(logB.hasRoute).not.toBe(true);
    failRoutes.clear();
    const retry = await service.importRoutes('user-1', { routes: [{ recordId: pending.pending[0], points: pts(20) }] });
    expect(retry).toMatchObject({ stored: 1, rejected: 0 });
    expect(logB.hasRoute).toBe(true);
    expect(await service.pendingRoutes('user-1', { recordIds: [UUID_A, UUID_B] })).toMatchObject({ pending: [], complete: [UUID_A.toLowerCase(), UUID_B.toLowerCase()] });
    // reenviar a rota ja completa nao e' necessario, mas se acontecer refaz sem duplicar pontos
    const again = await service.importRoutes('user-1', { routes: [{ recordId: UUID_A, points: pts(20) }] });
    expect(again).toMatchObject({ stored: 1, rejected: 0 });
    expect(points.filter((p) => p.activityLogId === [...logs.values()].find((l) => l.externalId === UUID_A.toLowerCase())!.id)).toHaveLength(20);
  });

  it('consulta de pendentes valida a lista (vazia, grande demais) e so enxerga treinos da propria aluna', async () => {
    const { service } = buildService({ consent: recorded('activity_route') });
    await service.importWorkouts('user-1', { workouts: [workout()] });
    await expect(service.pendingRoutes('user-1', { recordIds: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.pendingRoutes('user-1', { recordIds: Array.from({ length: APPLE_ROUTE_LIMITS.maxPendingIds + 1 }, () => UUID_A) })).rejects.toBeInstanceOf(BadRequestException);
    const other = await service.pendingRoutes('user-2', { recordIds: [UUID_A] });
    expect(other).toMatchObject({ pending: [], complete: [], notImported: [UUID_A.toLowerCase()] });
  });
});

describe('Apple Saude — limite de 60.000 bytes por requisicao de percurso no SERVIDOR (28/10/2026)', () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => [i * 3, Number((-23.5 + i * 0.000123456789).toFixed(5)), Number((-46.6 - i * 0.000098765432).toFixed(5)), 760.1]);
  const recorded = { mode: 'recorded' as const, allowed: ['activity', 'activity_route'] };
  // Preenche (com uma chave extra ignorada pelo normalizador) ate o corpo ter EXATAMENTE target bytes na medida do contrato: JSON.stringify({ routes }).
  function bodyOfSize(target: number) {
    const routes: Array<Record<string, unknown>> = [{ recordId: UUID_A, points: pts(300) }, { recordId: UUID_B, points: pts(200) }];
    const base = appleRoutesBodyBytes({ routes });
    const added = ',"pad":""'.length; // acrescimo fixo da chave extra, alem do preenchimento
    routes[0].pad = 'x'.repeat(target - base - added);
    return { routes };
  }

  it('o tamanho medido no servidor e o medido pelo app sao o MESMO numero (mesmo contrato, sem divergencia de serializacao)', () => {
    const items = [UUID_A, UUID_B].map((id) => fitRoute({ recordId: id, points: pts(2000) as never }, APPLE_ROUTE_LIMITS.maxRequestBytes, APPLE_ROUTE_LIMITS.maxPointsPerRoute)!);
    const wire = JSON.parse(JSON.stringify({ routes: items })); // o que o servidor recebe depois do parse
    expect(appleRoutesBodyBytes(wire)).toBe(bodySize(items));
  });

  it('aceita exatamente 60.000 bytes e recusa 60.001 com 413 e mensagem clara, sem gravar nada', async () => {
    const accepted = bodyOfSize(APPLE_ROUTE_LIMITS.maxRequestBytes);
    expect(appleRoutesBodyBytes(accepted)).toBe(60_000);
    const ok = buildService({ consent: recorded });
    await ok.service.importWorkouts('user-1', { workouts: [workout(), workout({ uuid: UUID_B })] });
    expect(await ok.service.importRoutes('user-1', accepted)).toMatchObject({ stored: 2, rejected: 0 });
    const over = bodyOfSize(APPLE_ROUTE_LIMITS.maxRequestBytes + 1);
    expect(appleRoutesBodyBytes(over)).toBe(60_001);
    const refused = buildService({ consent: recorded });
    await refused.service.importWorkouts('user-1', { workouts: [workout(), workout({ uuid: UUID_B })] });
    await expect(refused.service.importRoutes('user-1', over)).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(refused.service.importRoutes('user-1', over)).rejects.toThrow('60001 bytes e o limite e 60000');
    expect(refused.points).toHaveLength(0);
  });

  it('a checagem de bytes vem ANTES do consentimento e da validacao (nao processa corpo grande demais) e nao mexe no limite de pontos/rotas', async () => {
    const big = bodyOfSize(APPLE_ROUTE_LIMITS.maxRequestBytes + 500);
    await expect(buildService({ consent: { mode: 'blocked', allowed: [] } }).service.importRoutes('user-1', big)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(APPLE_ROUTE_LIMITS).toMatchObject({ maxRoutesPerRequest: 3, maxPointsPerRoute: 1200, maxRequestBytes: 60_000 });
  });
});
