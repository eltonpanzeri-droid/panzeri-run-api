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

describe('CoachService — decisao humana de identidade (D1/identidade) e D2 (troca de fonte primaria)', () => {
  const withServices = (prisma: Record<string, unknown>, link: Record<string, unknown>, identity: Record<string, unknown>, confirmation: Record<string, unknown>) =>
    new CoachService(prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), link as never, identity as never, confirmation as never);

  it('resolveExternalActivityIdentity: confere a posse do aluno e delega a decisao com o id do treinador', async () => {
    const prisma = { activityLog: { findFirst: jest.fn().mockResolvedValue({ id: 'log-2', userId: 'student-1' }) } };
    const confirmation = { resolveAsCoach: jest.fn().mockResolvedValue({ status: 'resolved', decision: 'distinct' }) };
    const result = await withServices(prisma, {}, {}, confirmation).resolveExternalActivityIdentity('student-1', 'coach-1', 'log-2', 'distinct');
    expect(prisma.activityLog.findFirst).toHaveBeenCalledWith({ where: { id: 'log-2', userId: 'student-1' } });
    expect(confirmation.resolveAsCoach).toHaveBeenCalledWith('student-1', { id: 'coach-1' }, 'log-2', 'distinct');
    expect(result).toMatchObject({ status: 'resolved' });
  });

  it('resolveExternalActivityIdentity: atividade de outro aluno ou decisao invalida nao chegam ao servico', async () => {
    const confirmation = { resolveAsCoach: jest.fn() };
    const other = { activityLog: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(withServices(other, {}, {}, confirmation).resolveExternalActivityIdentity('student-1', 'coach-1', 'log-de-outro', 'same')).rejects.toBeInstanceOf(NotFoundException);
    const own = { activityLog: { findFirst: jest.fn().mockResolvedValue({ id: 'log-2' }) } };
    await expect(withServices(own, {}, {}, confirmation).resolveExternalActivityIdentity('student-1', 'coach-1', 'log-2', 'talvez')).rejects.toThrow(/same|distinct/);
    expect(confirmation.resolveAsCoach).not.toHaveBeenCalled();
  });

  it('revertExternalActivityIdentity e identityQuality delegam ao servico (so leitura nos indicadores)', async () => {
    const confirmation = { revertAsCoach: jest.fn().mockResolvedValue({ status: 'reverted' }), quality: jest.fn().mockResolvedValue({ windowDays: 90 }) };
    const service = withServices({}, {}, {}, confirmation);
    await expect(service.revertExternalActivityIdentity('student-1', 'coach-1', 'log-2')).resolves.toMatchObject({ status: 'reverted' });
    expect(confirmation.revertAsCoach).toHaveBeenCalledWith('student-1', { id: 'coach-1' }, 'log-2');
    await expect(service.identityQuality(30)).resolves.toMatchObject({ windowDays: 90 });
    expect(confirmation.quality).toHaveBeenCalledWith(30);
  });

  it('setStudentPrimarySource: depois de recalcular a canonica, reconcilia os eventos afetados (D2) e devolve o resultado original', async () => {
    const recomputed = { events: 2, affectedActivityLogIds: ['a', 'b'] };
    const identity = { setPrimarySource: jest.fn().mockResolvedValue({ id: 'ps-1', provider: 'garmin', effectiveFrom: new Date('2026-01-01T00:00:00Z'), recomputed }) };
    const link = { reconcileAffectedByIdentity: jest.fn().mockResolvedValue(undefined) };
    const result = await withServices({}, link, identity, {}).setStudentPrimarySource('student-1', { provider: 'garmin' });
    expect(identity.setPrimarySource).toHaveBeenCalledWith('student-1', 'garmin', expect.objectContaining({ origin: 'coach' }));
    expect(link.reconcileAffectedByIdentity).toHaveBeenCalledWith(recomputed, null);
    expect(result).toMatchObject({ id: 'ps-1', recomputed });
  });
});
