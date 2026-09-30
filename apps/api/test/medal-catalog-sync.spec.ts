import { MedalCatalogSyncService } from '../src/medals/medal-catalog-sync.service';
import { MEDAL_CATALOG } from '../src/medals/medal-catalog';

// Sistema de Medalhas (30/09/2026) — sincronização do catálogo pra Achievement é idempotente
// (upsert por `code`) e nunca derruba o boot da API se o banco falhar.

function buildService(existingCodes: string[] = []) {
  const findUnique = jest.fn().mockImplementation(({ where }: { where: { code: string } }) =>
    Promise.resolve(existingCodes.includes(where.code) ? { id: `id-${where.code}` } : null),
  );
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = { achievement: { findUnique, upsert } };
  const service = new MedalCatalogSyncService(prisma as never);
  return { service, findUnique, upsert };
}

describe('MedalCatalogSyncService', () => {
  it('faz upsert de TODAS as medalhas do catálogo, uma vez cada', async () => {
    const { service, upsert } = buildService();
    await service.syncCatalog();
    expect(upsert).toHaveBeenCalledTimes(MEDAL_CATALOG.length);
  });

  it('upsert usa `code` como chave estável (where), nunca id/nome', async () => {
    const { service, upsert } = buildService();
    await service.syncCatalog();
    const firstCall = upsert.mock.calls[0][0];
    expect(firstCall.where).toEqual({ code: MEDAL_CATALOG[0].code });
  });

  it('conta corretamente criadas vs atualizadas', async () => {
    const someExisting = MEDAL_CATALOG.slice(0, 5).map((m) => m.code);
    const { service } = buildService(someExisting);
    const result = await service.syncCatalog();
    expect(result.updated).toBe(5);
    expect(result.created).toBe(MEDAL_CATALOG.length - 5);
  });

  it('onModuleInit nunca lança — falha de banco é logada, não derruba o boot da API', async () => {
    const prisma = { achievement: { findUnique: jest.fn().mockRejectedValue(new Error('banco indisponivel')), upsert: jest.fn() } };
    const service = new MedalCatalogSyncService(prisma as never);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('cada upsert preserva create/update com os mesmos campos definicionais do catálogo (nunca perde grau/criteria/threshold)', async () => {
    const { service, upsert } = buildService();
    await service.syncCatalog();
    const call = upsert.mock.calls.find((c) => c[0].where.code === 'aderencia_semana_perfeita')[0];
    expect(call.create).toMatchObject({ grau: 'ouro', threshold: 100, unit: '%', category: 'aderencia' });
    expect(call.update).toMatchObject({ grau: 'ouro', threshold: 100, unit: '%', category: 'aderencia' });
  });
});
