import { PolarSyncFallbackSchedulerService } from '../src/polar/polar-sync-fallback-scheduler.service';

// Fallback de recuperacao (03/10/2026): so' sincroniza conexoes que nao sincronizaram nas ultimas
// 6h, nunca cria pipeline novo (reaproveita o sync() existente), e tolera falha de um usuario sem
// derrubar os demais nem liberar a trava de execucao sobreposta.

function build(connections: Array<{ userId: string }>, syncImpl?: (userId: string) => Promise<unknown>) {
  const findMany = jest.fn(async (_args: { where: { OR: unknown[] } }) => connections);
  const sync = jest.fn(syncImpl ?? (async () => ({ status: 'synced', imported: 0, resumedTransaction: false })));
  const service = new PolarSyncFallbackSchedulerService(
    { polarConnection: { findMany } } as never,
    { sync } as never,
  );
  return { service, findMany, sync };
}

describe('PolarSyncFallbackSchedulerService', () => {
  it('consulta so conexoes nunca sincronizadas ou sincronizadas antes do corte de 6h', async () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const { service, findMany } = build([]);

    await service.syncStaleConnections(now);

    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { lastSyncCompletedAt: null },
      { lastSyncCompletedAt: { lt: new Date('2026-10-03T06:00:00Z') } },
    ]);
  });

  it('chama o sync() existente pra cada conexao elegivel — nenhum pipeline novo', async () => {
    const { service, sync } = build([{ userId: 'u1' }, { userId: 'u2' }]);

    await service.syncStaleConnections(new Date('2026-10-03T12:00:00Z'));

    expect(sync.mock.calls).toEqual([['u1'], ['u2']]);
  });

  it('falha de um usuario nao impede os demais de sincronizarem', async () => {
    const { service, sync } = build(
      [{ userId: 'u1' }, { userId: 'u2' }],
      async (userId) => {
        if (userId === 'u1') throw new Error('token expirado');
        return { status: 'synced', imported: 1, resumedTransaction: false };
      },
    );

    await expect(service.syncStaleConnections(new Date('2026-10-03T12:00:00Z'))).resolves.toBeUndefined();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('execucao sobreposta e pulada (trava), sem chamar sync() de novo', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { service, sync } = build([{ userId: 'u1' }], async () => {
      await gate;
      return { status: 'synced', imported: 0, resumedTransaction: false };
    });

    const first = service.syncStaleConnections(new Date('2026-10-03T12:00:00Z'));
    await service.syncStaleConnections(new Date('2026-10-03T12:00:00Z'));
    release();
    await first;

    expect(sync).toHaveBeenCalledTimes(1);
  });
});
