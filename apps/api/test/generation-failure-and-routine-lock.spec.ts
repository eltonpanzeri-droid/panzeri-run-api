import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { RoutineService } from '../src/me/routine.service';
import { traceStub } from './helpers/trace-stub';

// 16/11/2026 (caso Roberta): a IA terminou, o programa nao foi gravado e ninguem soube o motivo. Regras de Elton:
//  - uma geracao concluida NUNCA e' descartada por mudanca de rotina (vale a rotina de quando a aluna pediu o treino);
//  - a aluna nao troca a rotina enquanto o programa esta sendo montado;
//  - toda falha de geracao vai para o log com o erro real e, se o treinador ainda nao foi avisado, para o Telegram com o motivo.

const none = () => ({}) as never;

function buildService() {
  const lock = {
    create: jest.fn().mockResolvedValue({ userId: 'u1', startedAt: new Date() }),
    findUnique: jest.fn().mockResolvedValue(null),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn().mockResolvedValue({}),
  };
  const prisma = { trainingPlanGenerationLock: lock, user: { findUnique: jest.fn().mockResolvedValue({ name: 'Roberta Kemp', studentCode: 17 }) } };
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
  const service = new TrainingPlansService(
    prisma as never, none(), none(), none(), telegram as never, none(), none(), none(), none(), none(), none(), none(), none(), none(), traceStub(),
  );
  const locked = jest.spyOn(service as unknown as { generateWeekLocked: (...args: unknown[]) => Promise<unknown> }, 'generateWeekLocked');
  return { service, prisma, telegram, lock, locked };
}

describe('falha de geracao: log e aviso ao treinador com o motivo', () => {
  it('erro inesperado depois da IA (ex.: gravacao): avisa o treinador com aluno, codigo e motivo, e relanca o erro original', async () => {
    const { service, telegram, locked } = buildService();
    const boom = new Error('transacao falhou: conexao encerrada');
    locked.mockRejectedValue(boom);
    await expect(service.generateWeek('u1')).rejects.toBe(boom);
    expect(telegram.notifyCoach).toHaveBeenCalledTimes(1);
    const text = (telegram.notifyCoach.mock.calls[0] as string[])[0];
    expect(text).toContain('Roberta Kemp');
    expect(text).toContain('0000017');
    expect(text).toContain('transacao falhou');
    expect(text).toContain('NAO foi atualizado');
  });

  it('falha da IA que ja avisou o treinador por conta propria: nao avisa de novo', async () => {
    const { service, telegram, locked } = buildService();
    const failure = new InternalServerErrorException('Nao foi possivel gerar o treino com o agente de IA no momento. O treinador ja foi avisado.');
    (service as unknown as { alertedFailures: WeakSet<object> }).alertedFailures.add(failure);
    locked.mockRejectedValue(failure);
    await expect(service.generateWeek('u1')).rejects.toBe(failure);
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('recusa de regra de negocio (HTTP 4xx, ex.: sem acesso pago): so log, sem Telegram', async () => {
    const { service, telegram, locked } = buildService();
    locked.mockRejectedValue(new BadRequestException('Este aluno nao tem acesso pago ativo no momento'));
    await expect(service.generateWeek('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('o Telegram fora do ar nunca esconde o erro original nem deixa a trava presa', async () => {
    const { service, telegram, lock, locked } = buildService();
    telegram.notifyCoach.mockRejectedValue(new Error('telegram fora'));
    const boom = new Error('falha real');
    locked.mockRejectedValue(boom);
    await expect(service.generateWeek('u1')).rejects.toBe(boom);
    expect(lock.delete).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});

describe('geracao em andamento', () => {
  it('trava recente = em andamento; trava presa (processo morto) ou ausente = nao', async () => {
    const { service, lock } = buildService();
    lock.findUnique.mockResolvedValue({ userId: 'u1', startedAt: new Date() });
    expect(await service.isGenerationInProgress('u1')).toBe(true);
    lock.findUnique.mockResolvedValue({ userId: 'u1', startedAt: new Date(Date.now() - 20 * 60_000) });
    expect(await service.isGenerationInProgress('u1')).toBe(false);
    lock.findUnique.mockResolvedValue(null);
    expect(await service.isGenerationInProgress('u1')).toBe(false);
  });

  it('a publicacao do programa nao confere mais a rotina (a IA concluida nunca e\' descartada)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'training-plans.service.ts'), 'utf8');
    expect(source).not.toContain('assertRoutineUnchanged');
    expect(source).toContain('routineRevision: routineAtStart.revision');
  });
});

describe('troca de rotina durante a geracao', () => {
  function buildRoutine(inProgress: boolean) {
    const trainingPlans = { isGenerationInProgress: jest.fn().mockResolvedValue(inProgress) };
    const prisma = { $transaction: jest.fn().mockRejectedValue(new Error('SENTINEL_TRANSACAO')) };
    const routine = new RoutineService(prisma as never, trainingPlans as never, none(), none(), none());
    return { routine, prisma };
  }
  const day = (weekday: number) => ({ weekday, noTraining: weekday !== 1, modalities: weekday === 1 ? ['corrida'] : [], availableMin: weekday === 1 ? 40 : 0, modalityDurations: weekday === 1 ? { corrida: 40 } : {} });
  const week = Array.from({ length: 7 }, (_, i) => day(i));

  it('aluna: recusada com generation_in_progress e nada e\' gravado', async () => {
    const { routine, prisma } = buildRoutine(true);
    const error = await routine.replaceWeek('u1', week as never, { source: 'student' }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'generation_in_progress' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('app antigo (legacy_app) tambem e\' recusado', async () => {
    const { routine } = buildRoutine(true);
    await expect(routine.replaceWeek('u1', week as never, { source: 'legacy_app' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('treinador nao e\' bloqueado', async () => {
    const { routine, prisma } = buildRoutine(true);
    await expect(routine.replaceWeek('u1', week as never, { source: 'coach' })).rejects.toThrow('SENTINEL_TRANSACAO');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('sem geracao em andamento a aluna grava normalmente', async () => {
    const { routine, prisma } = buildRoutine(false);
    await expect(routine.replaceWeek('u1', week as never, { source: 'student' })).rejects.toThrow('SENTINEL_TRANSACAO');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
