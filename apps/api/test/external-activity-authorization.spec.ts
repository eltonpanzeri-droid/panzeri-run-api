import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CoachController } from '../src/coach/coach.controller';
import { CoachService } from '../src/coach/coach.service';
import { RolesGuard } from '../src/common/roles.guard';
import { ActivityDetailService } from '../src/activity-execution/activity-detail.service';

// Bloco pre-Garmin 2 (05/10/2026). Modelo atual = treinador unico (nao existe vinculo treinador-aluno):
// coach e admin acompanham todos os alunos; o payload bruto do provider (diagnostico tecnico) e'
// exclusivo de admin e cada leitura e' auditada; o aluno so' enxerga a propria atividade pelas rotas me.

const guard = new RolesGuard(new Reflector());
const proto = CoachController.prototype as unknown as Record<string, (...args: never[]) => unknown>;

function contextFor(handlerName: string, role: string | undefined): ExecutionContext {
  return {
    getHandler: () => proto[handlerName],
    getClass: () => CoachController,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { sub: 'u1', email: 'x@x', role } : undefined }) }),
  } as unknown as ExecutionContext;
}
const allowed = (handler: string, role: string) => {
  try { return guard.canActivate(contextFor(handler, role)); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
};

describe('autorizacao por papel nas rotas de atividade externa', () => {
  it('coach consulta a listagem/resumo e pode reclassificar (acompanhamento normal); admin tambem', () => {
    expect(allowed('listExternalActivities', 'coach')).toBe(true);
    expect(allowed('listExternalActivities', 'admin')).toBe(true);
    expect(allowed('reclassifyExternalActivity', 'coach')).toBe(true);
    expect(allowed('reclassifyExternalActivity', 'admin')).toBe(true);
  });

  it('coach NAO acessa payload bruto/samples; admin acessa', () => {
    expect(allowed('getExternalActivityRaw', 'coach')).toBe(false);
    expect(allowed('getExternalActivityRaw', 'admin')).toBe(true);
  });

  it('aluno nao acessa nenhuma das rotas de treinador (listagem, raw, reclassify)', () => {
    for (const handler of ['listExternalActivities', 'getExternalActivityRaw', 'reclassifyExternalActivity']) {
      expect(allowed(handler, 'student')).toBe(false);
    }
  });

  it('as demais rotas do CoachController seguem coach/admin (nao alteradas)', () => {
    expect(allowed('sendStudentMessage', 'coach')).toBe(true);
    expect(allowed('getStudentMenstrualData', 'coach')).toBe(true);
  });
});

function build(prisma: Record<string, unknown>, classify = jest.fn()) {
  const noop = () => ({} as never);
  const sessionLink = { classify, getActiveLinkForActivity: jest.fn(async () => null) };
  return new CoachService(
    prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), sessionLink as never, noop(), noop(),
    noop(), noop(), noop(), noop(),
  );
}

describe('CoachService — posse da atividade e auditoria da leitura do raw', () => {
  const ADMIN = { id: 'admin-1', role: 'admin' };
  const SECRET_PAYLOAD = { 'heart-rate': { average: 151 }, gps: 'LAT-LON-SECRETO', token: 'tok-ultra-secreto' };

  function prismaWith(ownedBy: string | null) {
    const order: string[] = [];
    const prisma = {
      activityLog: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string } }) =>
          (ownedBy && where.userId === ownedBy ? { rawActivityId: 'raw-1', provider: 'polar' } : null)),
      },
      providerConnectionEvent: { create: jest.fn(async () => { order.push('audit'); return {}; }) },
      rawExternalActivity: {
        findUnique: jest.fn(async () => { order.push('read'); return { id: 'raw-1', provider: 'polar', externalId: 'e1', payload: SECRET_PAYLOAD, payloadSchemaVersion: '1', ingestionMeta: null, sourceUpdatedAt: null, receivedAt: new Date() }; }),
      },
      rawActivitySample: { findMany: jest.fn(async () => []) },
    };
    return { prisma, order };
  }

  it('activityLogId de outro aluno com studentId diferente: 404, sem leitura do raw e sem auditoria de leitura', async () => {
    const { prisma } = prismaWith('student-A');
    const service = build(prisma);

    await expect(service.getExternalActivityRaw('student-B', 'log-do-A', ADMIN)).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.activityLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'log-do-A', userId: 'student-B' } }));
    expect(prisma.rawExternalActivity.findUnique).not.toHaveBeenCalled();
    expect(prisma.rawActivitySample.findMany).not.toHaveBeenCalled();
    expect(prisma.providerConnectionEvent.create).not.toHaveBeenCalled();
  });

  it('reclassify com activityLogId de outro aluno: 404 e classify() nunca e chamado', async () => {
    const classify = jest.fn();
    const prisma = { activityLog: { findFirst: jest.fn(async () => null) } };
    const service = build(prisma, classify);

    await expect(service.reclassifyExternalActivity('student-B', 'log-do-A')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.activityLog.findFirst).toHaveBeenCalledWith({ where: { id: 'log-do-A', userId: 'student-B' } });
    expect(classify).not.toHaveBeenCalled();
  });

  it('leitura admin do raw gera auditoria (quem, atividade, aluno, quando, operacao) ANTES de devolver o dado', async () => {
    const { prisma, order } = prismaWith('student-A');
    const service = build(prisma);

    const result = (await service.getExternalActivityRaw('student-A', 'log-1', ADMIN)) as { payload: unknown };

    expect(result.payload).toEqual(SECRET_PAYLOAD);
    expect(order).toEqual(['audit', 'read']);
    expect(prisma.providerConnectionEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'student-A',
        provider: 'polar',
        type: 'raw_read',
        details: { actorId: 'admin-1', actorRole: 'admin', activityLogId: 'log-1', operation: 'read_raw_payload_and_samples' },
      },
    });
  });

  it('a auditoria nao contem payload, GPS, token nem credenciais', async () => {
    const { prisma } = prismaWith('student-A');
    const service = build(prisma);
    await service.getExternalActivityRaw('student-A', 'log-1', ADMIN);

    const recorded = JSON.stringify((prisma.providerConnectionEvent.create.mock.calls[0] as unknown[])[0]);
    for (const leaked of ['LAT-LON-SECRETO', 'tok-ultra-secreto', 'heart-rate', '151', '"payload"', '"samples"', 'Bearer']) {
      expect(recorded).not.toContain(leaked);
    }
  });

  it('falha ao gravar a auditoria nega a leitura (fail-closed): o raw nao e consultado', async () => {
    const { prisma } = prismaWith('student-A');
    prisma.providerConnectionEvent.create.mockRejectedValueOnce(new Error('db fora'));
    const service = build(prisma);

    await expect(service.getExternalActivityRaw('student-A', 'log-1', ADMIN)).rejects.toThrow('db fora');
    expect(prisma.rawExternalActivity.findUnique).not.toHaveBeenCalled();
  });

  it('listagem de resumo nao expoe payload bruto nem samples', async () => {
    const prisma = {
      activityLog: {
        findMany: jest.fn(async () => [{ id: 'log-1', provider: 'polar', rawActivity: { receivedAt: new Date(), sourceUpdatedAt: null } }]),
      },
    };
    const service = build(prisma);

    const list = await service.listExternalActivities('student-A');

    const select = (prisma.activityLog.findMany.mock.calls[0] as unknown[])[0] as { where: unknown; select: Record<string, unknown> };
    expect(select.where).toEqual({ userId: 'student-A' });
    expect(JSON.stringify(select.select)).not.toMatch(/payload|samples|ingestionMeta/);
    expect(list).toHaveLength(1);
  });
});

describe('rotas do aluno (me) — ownership preservado', () => {
  it('detalhe: atividade de outro aluno => 404 com consulta ja filtrada por userId do JWT', async () => {
    const prisma = { activityLog: { findFirst: jest.fn(async () => null) } };
    const service = new ActivityDetailService(prisma as never, {} as never);

    await expect(service.getDetail('aluno-2', 'log-do-aluno-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.activityLog.findFirst).toHaveBeenCalledWith({ where: { id: 'log-do-aluno-1', userId: 'aluno-2' } });
  });
});
