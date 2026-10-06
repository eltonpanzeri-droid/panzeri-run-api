import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppleHealthIngestionService } from '../src/apple-health/apple-health-ingestion.service';
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
function buildService(options: { failFirstCreateWithP2002?: boolean } = {}) {
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
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { service: new AppleHealthIngestionService(prisma as never), raws, logs, tx };
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
