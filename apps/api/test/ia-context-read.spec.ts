import { PrescriptionTraceService } from '../src/training-plans/prescription-trace.service';

// 02/11/2026 — tela "O que a IA recebeu": leituras novas, SO' leitura (nenhuma chamada de IA, nenhuma escrita).
function build(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    $queryRaw: jest.fn(async () => [{ id: 'p1', createdAt: new Date('2026-11-02T10:54:00Z'), kind: 'weekly', planId: 'pl', sessionId: null, modelIds: ['m'], hasInput: true, inputChars: BigInt(478620), purgedAt: null }]),
    prescriptionEvidencePackage: { findMany: jest.fn(async () => []) },
    prescriptionDecision: { findMany: jest.fn(async () => []) },
    studentProfile: { findUnique: jest.fn(async () => ({ summary: 'resumo', updatedAt: new Date('2026-11-01T00:00:00Z') })) },
    studentProfileEvent: {
      findMany: jest.fn(async () => [
        { id: 'a', code: 'X', content: 'novo', createdAt: new Date('2026-11-02T00:00:00Z'), summarizedAt: null, sourceProviders: null },
        { id: 'b', code: 'Y', content: 'antigo', createdAt: new Date('2026-10-01T00:00:00Z'), summarizedAt: new Date('2026-10-02T00:00:00Z'), sourceProviders: null },
      ]),
    },
    ...overrides,
  };
  return { service: new PrescriptionTraceService(prisma, { get: () => undefined } as never), prisma };
}

describe('PrescriptionTraceService — leituras da tela "O que a IA recebeu"', () => {
  it('listPackages: converte o tamanho (bigint do Postgres) em numero, limita o tamanho da pagina e nao carrega o prompt', async () => {
    const { service, prisma } = build();
    const rows = await service.listPackages('u', 9999);
    expect(rows).toEqual([expect.objectContaining({ id: 'p1', hasInput: true, inputChars: 478620 })]);
    expect(typeof rows[0].inputChars).toBe('number');
    expect(rows[0]).not.toHaveProperty('agentInput');
    // limite maximo 100 no ultimo parametro do SQL
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(['u', 100]);
  });

  it('listPackages: limite invalido volta ao padrao (30)', async () => {
    const { service, prisma } = build();
    await service.listPackages('u', Number.NaN);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(['u', 30]);
  });

  it('getProntuario: separa eventos ainda nao condensados dos condensados e devolve o resumo', async () => {
    const { service } = build();
    const result = await service.getProntuario('u');
    expect(result.summary).toBe('resumo');
    expect(result.pendingEvents.map((e) => e.id)).toEqual(['a']);
    expect(result.condensedEvents.map((e) => e.id)).toEqual(['b']);
  });

  it('getProntuario: aluna sem prontuario devolve resumo vazio (nunca inventa)', async () => {
    const { service } = build({ studentProfile: { findUnique: jest.fn(async () => null) }, studentProfileEvent: { findMany: jest.fn(async () => []) } });
    expect(await service.getProntuario('u')).toEqual({ summary: '', summaryUpdatedAt: null, pendingEvents: [], condensedEvents: [] });
  });

  it('getTrace com packageId filtra pelo pacote pedido (e sempre pela aluna)', async () => {
    const { service, prisma } = build();
    await service.getTrace('u', { packageId: 'p1', includeAgentInput: true });
    expect(prisma.prescriptionEvidencePackage.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u', id: 'p1' });
  });
});
