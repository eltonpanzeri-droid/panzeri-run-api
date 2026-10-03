import { CoachService } from '../src/coach/coach.service';

// Extensao minima (02/10/2026) pedida pelo treinador: o diagnostico Admin "Atividades externas" ja
// existente (listExternalActivities/getExternalActivityRaw) passa a trazer junto os
// RawActivitySample da mesma ActivityLog, sem nenhuma chamada nova ao provedor e sem interpretar o
// payload — so' leitura do que a sincronizacao ja persistiu. Cobre: payload bruto presente,
// recordCount so' quando o payload e' array (null caso contrario, nunca 0 por omissao), payloadSize
// como indicador bruto (tamanho da serializacao JSON), e ausencia de samples nao quebra o raw
// existente.

function noop() {
  return {} as never;
}

function buildService(prisma: Record<string, unknown>) {
  return new CoachService(
    prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(),
    noop(), noop(), noop(), noop(),
  );
}

describe('CoachService.getExternalActivityRaw — samples anexados ao raw existente (sem nova chamada ao provedor)', () => {
  it('inclui os RawActivitySample da atividade, com recordCount/payloadSize como indicadores brutos', async () => {
    const rawActivity = {
      id: 'raw-1',
      provider: 'polar',
      externalId: 'ext-1',
      payload: { summary: true },
      payloadSchemaVersion: '1',
      ingestionMeta: null,
      sourceUpdatedAt: null,
      receivedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const sampleRows = [
      {
        id: 'sample-1',
        provider: 'polar',
        sampleType: 'heart-rate',
        payload: [1, 2, 3, 4],
        providerMeta: { href: 'https://example.com/samples/heart-rate' },
        fetchedAt: new Date('2026-10-01T00:05:00.000Z'),
        createdAt: new Date('2026-10-01T00:05:00.000Z'),
        updatedAt: new Date('2026-10-01T00:05:00.000Z'),
      },
      {
        id: 'sample-2',
        provider: 'polar',
        sampleType: 'rr-interval',
        payload: { raw: 'nao-e-array' },
        providerMeta: null,
        fetchedAt: new Date('2026-10-01T00:05:00.000Z'),
        createdAt: new Date('2026-10-01T00:05:00.000Z'),
        updatedAt: new Date('2026-10-01T00:05:00.000Z'),
      },
    ];
    const prisma = {
      activityLog: { findFirst: jest.fn().mockResolvedValue({ rawActivityId: 'raw-1' }) },
      rawExternalActivity: { findUnique: jest.fn().mockResolvedValue(rawActivity) },
      rawActivitySample: { findMany: jest.fn().mockResolvedValue(sampleRows) },
    };
    const service = buildService(prisma);

    const result = (await service.getExternalActivityRaw('student-1', 'log-1')) as any;

    expect(prisma.activityLog.findFirst).toHaveBeenCalledWith({
      where: { id: 'log-1', userId: 'student-1' },
      select: { rawActivityId: true },
    });
    expect(prisma.rawActivitySample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activityLogId: 'log-1' } }),
    );
    expect(result.payload).toEqual({ summary: true });
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]).toMatchObject({
      sampleType: 'heart-rate',
      recordCount: 4,
      payloadSize: JSON.stringify([1, 2, 3, 4]).length,
    });
    expect(result.samples[1]).toMatchObject({
      sampleType: 'rr-interval',
      recordCount: null,
      payloadSize: JSON.stringify({ raw: 'nao-e-array' }).length,
    });
  });

  it('retorna samples: [] quando a atividade nao tem nenhum sample ingerido, sem alterar o raw existente', async () => {
    const rawActivity = {
      id: 'raw-2',
      provider: 'polar',
      externalId: 'ext-2',
      payload: { summary: true },
      payloadSchemaVersion: '1',
      ingestionMeta: null,
      sourceUpdatedAt: null,
      receivedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const prisma = {
      activityLog: { findFirst: jest.fn().mockResolvedValue({ rawActivityId: 'raw-2' }) },
      rawExternalActivity: { findUnique: jest.fn().mockResolvedValue(rawActivity) },
      rawActivitySample: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = buildService(prisma);

    const result = (await service.getExternalActivityRaw('student-1', 'log-2')) as any;

    expect(result.samples).toEqual([]);
    expect(result.payloadSchemaVersion).toBe('1');
  });

  it('continua lancando NotFoundException quando a atividade nao pertence ao aluno, sem consultar samples', async () => {
    const prisma = {
      activityLog: { findFirst: jest.fn().mockResolvedValue(null) },
      rawExternalActivity: { findUnique: jest.fn() },
      rawActivitySample: { findMany: jest.fn() },
    };
    const service = buildService(prisma);

    await expect(service.getExternalActivityRaw('student-1', 'log-de-outro-aluno')).rejects.toBeInstanceOf(
      require('@nestjs/common').NotFoundException,
    );
    expect(prisma.rawActivitySample.findMany).not.toHaveBeenCalled();
  });
});
