import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { MAX_EXERCISES_PER_BATCH, HealthConnectIngestionService } from '../src/health-connect/health-connect-ingestion.service';
import { HealthConnectController } from '../src/health-connect/health-connect.controller';

// Prisma em memoria minimo (so' o que a ingestao usa): prova idempotencia, versao mais antiga ignorada, usuario sempre do JWT e limites do lote.
function fakePrisma() {
  const logs = new Map<string, any>();
  const raws = new Map<string, any>();
  const k = (w: any) => `${w.provider_userId_externalId.userId}|${w.provider_userId_externalId.externalId}`;
  const tx = {
    activityLog: {
      findUnique: async ({ where }: any) => logs.get(k(where)) ?? null,
      create: async ({ data }: any) => { const row = { id: `log-${logs.size + 1}`, ...data }; logs.set(`${data.userId}|${data.externalId}`, row); return row; },
      update: async ({ where, data }: any) => { const row = [...logs.values()].find((r) => r.id === where.id); Object.assign(row, data); return row; },
    },
    rawExternalActivity: {
      upsert: async ({ where, create }: any) => { const key = k(where); if (!raws.has(key)) raws.set(key, { id: `raw-${raws.size + 1}`, ...create }); return raws.get(key); },
      update: async ({ where, data }: any) => { Object.assign(raws.get(k(where)), data); return raws.get(k(where)); },
    },
  };
  return { prisma: { $transaction: async (fn: any) => fn(tx) } as never, logs, raws };
}

const item = (over: Record<string, unknown> = {}) => ({
  recordId: 'hc-1', dataOrigin: 'fi.polar.polarflow', lastModifiedTime: '2026-10-09T10:30:00.000Z', exerciseType: 56,
  startTime: '2026-10-09T09:00:00.000Z', endTime: '2026-10-09T09:55:00.000Z', distanceMeters: 10000, ...over,
});

describe('ingestao Health Connect', () => {
  it('reenvio identico nao duplica (10 sincronizacoes != 10 corridas)', async () => {
    const { prisma, logs, raws } = fakePrisma();
    const service = new HealthConnectIngestionService(prisma);
    const first = await service.importExercises('u1', { exercises: [item()] });
    expect(first).toMatchObject({ created: 1, updated: 0, alreadyImported: 0 });
    for (let i = 0; i < 9; i += 1) expect(await service.importExercises('u1', { exercises: [item()] })).toMatchObject({ created: 0, alreadyImported: 1 });
    expect(logs.size).toBe(1);
    expect(raws.size).toBe(1);
  });

  it('registro modificado na origem atualiza o MESMO registro; versao mais antiga e ignorada (fora de ordem)', async () => {
    const { prisma, logs } = fakePrisma();
    const service = new HealthConnectIngestionService(prisma);
    await service.importExercises('u1', { exercises: [item()] });
    const newer = await service.importExercises('u1', { exercises: [item({ distanceMeters: 10500, lastModifiedTime: '2026-10-09T12:00:00.000Z' })] });
    expect(newer).toMatchObject({ updated: 1 });
    const older = await service.importExercises('u1', { exercises: [item({ distanceMeters: 9000, lastModifiedTime: '2026-10-09T08:00:00.000Z' })] });
    expect(older).toMatchObject({ updated: 0, alreadyImported: 1 });
    expect(logs.size).toBe(1);
    expect([...logs.values()][0].distanceMeters).toBe(10500);
  });

  it('mudanca de app de origem (proveniencia) conta como modificacao', async () => {
    const { prisma } = fakePrisma();
    const service = new HealthConnectIngestionService(prisma);
    await service.importExercises('u1', { exercises: [item()] });
    const changed = await service.importExercises('u1', { exercises: [item({ dataOrigin: 'com.sec.android.app.shealth', lastModifiedTime: '2026-10-09T10:30:00.000Z' })] });
    expect(changed).toMatchObject({ updated: 1 });
  });

  it('alunos diferentes com o mesmo id de registro NAO se misturam', async () => {
    const { prisma, logs } = fakePrisma();
    const service = new HealthConnectIngestionService(prisma);
    await service.importExercises('u1', { exercises: [item()] });
    await service.importExercises('u2', { exercises: [item()] });
    expect(logs.size).toBe(2);
    expect([...logs.values()].map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('item invalido e rejeitado sem derrubar o lote; corpo vazio ou grande demais e 400', async () => {
    const { prisma } = fakePrisma();
    const service = new HealthConnectIngestionService(prisma);
    const result = await service.importExercises('u1', { exercises: [item(), { recordId: 'ruim', exerciseType: 56 }] });
    expect(result).toMatchObject({ created: 1, rejected: 1 });
    expect(result.items[1]).toMatchObject({ recordId: 'ruim', status: 'rejected', reason: 'inicio_invalido' });
    await expect(service.importExercises('u1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importExercises('u1', { exercises: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importExercises('u1', { exercises: Array.from({ length: MAX_EXERCISES_PER_BATCH + 1 }, (_, i) => item({ recordId: `r${i}` })) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('endpoint: exige JWT e usa SEMPRE o usuario do token (nunca do corpo)', async () => {
    const guards = Reflect.getMetadata('__guards__', HealthConnectController.prototype.importExercises) as unknown[];
    expect(guards).toHaveLength(1);
    const importExercises = jest.fn(async () => ({ created: 0 }));
    const controller = new HealthConnectController({ importExercises } as never, {} as never, {} as never);
    await controller.importExercises({ sub: 'user-do-token' } as never, { userId: 'outro-usuario', exercises: [item()] });
    expect(importExercises).toHaveBeenCalledWith('user-do-token', expect.objectContaining({ userId: 'outro-usuario' }));
  });
});
