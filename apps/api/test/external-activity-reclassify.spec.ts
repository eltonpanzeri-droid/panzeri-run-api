import { NotFoundException } from '@nestjs/common';
import { CoachService } from '../src/coach/coach.service';

// Reprocessamento manual MINIMO (03/10/2026) — pra' atividades que ja' existiam em ActivityLog
// ANTES do gatilho automatico de classify() apos ingestao Polar (ver
// PolarActivityIngestionService.ingestExercise). Nao reimplementa nenhuma logica de correspondencia
// nova: so' chama o classify() JA' EXISTENTE/testado em SessionExecutionLinkService, com a mesma
// checagem de posse (activityLogId pertence ao studentId) usada em getExternalActivityRaw.

function noop() {
  return {} as never;
}

function buildService(prisma: Record<string, unknown>, sessionExecutionLink: Record<string, unknown>) {
  return new CoachService(
    prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(),
    noop(), noop(), noop(), sessionExecutionLink as never);
}

describe('CoachService.reclassifyExternalActivity', () => {
  it('delega pro classify() ja existente e retorna a classificacao + vinculo ativo resultante (ou null)', async () => {
    const prisma = {
      activityLog: { findFirst: jest.fn().mockResolvedValue({ id: 'log-1', userId: 'student-1' }) },
    };
    const sessionExecutionLink = {
      classify: jest.fn().mockResolvedValue('corresponding'),
      getActiveLinkForActivity: jest.fn().mockResolvedValue({ id: 'link-1', trainingSessionId: 'session-hoje' }),
    };
    const service = buildService(prisma, sessionExecutionLink);

    const result = await service.reclassifyExternalActivity('student-1', 'log-1');

    expect(prisma.activityLog.findFirst).toHaveBeenCalledWith({ where: { id: 'log-1', userId: 'student-1' } });
    expect(sessionExecutionLink.classify).toHaveBeenCalledWith('log-1');
    expect(result).toEqual({
      activityLogId: 'log-1',
      classification: 'corresponding',
      activeLinkTrainingSessionId: 'session-hoje',
    });
  });

  it('classificacao ambigua/alternative nao tem vinculo ativo — activeLinkTrainingSessionId fica null (nunca inventado)', async () => {
    const prisma = {
      activityLog: { findFirst: jest.fn().mockResolvedValue({ id: 'log-2', userId: 'student-1' }) },
    };
    const sessionExecutionLink = {
      classify: jest.fn().mockResolvedValue('ambiguous'),
      getActiveLinkForActivity: jest.fn().mockResolvedValue(null),
    };
    const service = buildService(prisma, sessionExecutionLink);

    const result = await service.reclassifyExternalActivity('student-1', 'log-2');

    expect(result).toEqual({ activityLogId: 'log-2', classification: 'ambiguous', activeLinkTrainingSessionId: null });
  });

  it('nunca chama classify() quando a atividade nao pertence a esse aluno (checagem de posse, mesma regra de getExternalActivityRaw)', async () => {
    const prisma = {
      activityLog: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const sessionExecutionLink = { classify: jest.fn(), getActiveLinkForActivity: jest.fn() };
    const service = buildService(prisma, sessionExecutionLink);

    await expect(service.reclassifyExternalActivity('student-1', 'log-de-outro-aluno')).rejects.toBeInstanceOf(NotFoundException);
    expect(sessionExecutionLink.classify).not.toHaveBeenCalled();
  });

  it('e idempotente por natureza do proprio classify() — chamar de novo numa atividade ja classificada nao reclassifica (comportamento herdado, nao reimplementado aqui)', async () => {
    const prisma = {
      activityLog: { findFirst: jest.fn().mockResolvedValue({ id: 'log-3', userId: 'student-1' }) },
    };
    const sessionExecutionLink = {
      classify: jest.fn().mockResolvedValue('corresponding'),
      getActiveLinkForActivity: jest.fn().mockResolvedValue({ id: 'link-3', trainingSessionId: 'session-x' }),
    };
    const service = buildService(prisma, sessionExecutionLink);

    const first = await service.reclassifyExternalActivity('student-1', 'log-3');
    const second = await service.reclassifyExternalActivity('student-1', 'log-3');

    expect(first).toEqual(second);
    expect(sessionExecutionLink.classify).toHaveBeenCalledTimes(2); // cada chamada delega — e' o classify() quem e' idempotente internamente
  });
});
