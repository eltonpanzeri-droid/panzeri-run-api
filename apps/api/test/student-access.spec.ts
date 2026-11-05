import { StudentAccessService, classifyAccess } from '../src/equipment/student-access.service';

// 05/11/2026 — "Como as alunas acessam": lista nominal SOMENTE LEITURA. O servidor nao guarda a plataforma; so' classifica pelo que sabe (push, Health Connect, Apple Saude).
describe('classifyAccess', () => {
  it('Health Connect => Android; Apple Saude => iPhone; push sem conexao => instalado; nada => navegador (estimado)', () => {
    expect(classifyAccess({ push: false, providers: ['health_connect'] })).toBe('android');
    expect(classifyAccess({ push: true, providers: ['health_connect', 'polar'] })).toBe('android');
    expect(classifyAccess({ push: false, providers: ['apple_health'] })).toBe('ios');
    expect(classifyAccess({ push: true, providers: ['zepp'] })).toBe('native_unknown');
    expect(classifyAccess({ push: false, providers: [] })).toBe('browser_probable');
    expect(classifyAccess({ push: false, providers: ['polar'] })).toBe('browser_probable'); // Polar pelo site funciona sem instalar nada
  });
});

describe('StudentAccessService.run', () => {
  const build = () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', name: 'Ana', studentCode: 1, subscriptionStatus: 'active', accountStatus: 'active', expoPushToken: null },
          { id: 'u2', name: 'Bia', studentCode: 2, subscriptionStatus: 'active', accountStatus: 'active', expoPushToken: 'ExponentPushToken[x]' },
          { id: 'u3', name: 'Cris', studentCode: null, subscriptionStatus: 'manual', accountStatus: 'active', expoPushToken: null },
          { id: 'u4', name: 'Dani', studentCode: 4, subscriptionStatus: 'active', accountStatus: 'active', expoPushToken: null },
        ]),
      },
      providerConnection: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'u2', provider: 'health_connect', lastSyncCompletedAt: new Date('2026-11-04T10:00:00Z') },
          { userId: 'u3', provider: 'apple_health', lastSyncCompletedAt: null },
        ]),
      },
      activityLog: {
        groupBy: jest.fn().mockResolvedValue([{ userId: 'u2', provider: 'health_connect', _count: { _all: 7 }, _max: { startedAt: new Date('2026-11-03T08:00:00Z') } }]),
      },
    };
    return { service: new StudentAccessService(prisma as never), prisma };
  };

  it('classifica, conta e traz as atividades recebidas por conexao', async () => {
    const { service } = build();
    const result = await service.run();
    expect(result.total).toBe(4);
    expect(result.counts).toEqual({ android: 1, ios: 1, native_unknown: 0, browser_probable: 2 });
    const byName = Object.fromEntries(result.rows.map((r) => [r.name, r]));
    expect(byName.Bia).toMatchObject({ access: 'android', push: true, activities: [{ provider: 'health_connect', count: 7 }] });
    expect(byName.Cris).toMatchObject({ access: 'ios', activities: [] }); // conectou mas nenhuma atividade chegou: aparece vazio
    expect(byName.Ana.access).toBe('browser_probable');
    expect(result.notes.join(' ')).toContain('estimativa');
  });

  it('so le: consulta alunas sem arquivadas e sem contas de revisao das lojas, e nunca grava', async () => {
    const { service, prisma } = build();
    await service.run();
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ role: 'student', accountStatus: { not: 'archived' } });
    expect(JSON.stringify(where.NOT)).toContain('revisao-apple-');
    expect(JSON.stringify(where.NOT)).toContain('revisao-google-');
    expect(Object.keys(prisma)).toEqual(['user', 'providerConnection', 'activityLog']);
    for (const model of Object.values(prisma)) expect(Object.keys(model as object).every((m) => m === 'findMany' || m === 'groupBy')).toBe(true);
  });

  it('conexao desconectada nao conta: a consulta filtra disconnectedAt nulo', async () => {
    const { service, prisma } = build();
    await service.run();
    expect(prisma.providerConnection.findMany.mock.calls[0][0].where).toMatchObject({ disconnectedAt: null });
  });
});
