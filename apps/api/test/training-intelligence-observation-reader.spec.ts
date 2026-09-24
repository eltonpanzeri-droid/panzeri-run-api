import { NotFoundException } from '@nestjs/common';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';

// 24/09/2026 — fundacao da Camada Matematica Longitudinal (auditoria aprovada). Cobre os casos
// exigidos explicitamente: sessao-fantasma excluida, sessao extra excluida so quando a variavel
// exige (executionVsPrescribed), missing != zero, versoes diferentes de instrumento preservadas
// (nunca misturadas silenciosamente), variavel desconhecida.

function buildReader(sessions: unknown[], checkins: unknown[] = []) {
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    weeklyCheckIn: { findMany: jest.fn().mockResolvedValue(checkins) },
  };
  return { reader: new ObservationReaderService(prisma as never), prisma };
}

function session(overrides: Record<string, unknown>) {
  return {
    id: 'session-default',
    userId: 'aluno-1',
    modality: 'corrida',
    scheduledDate: new Date('2026-09-01T00:00:00.000Z'),
    structure: {},
    plan: { status: 'active' },
    completion: null,
    ...overrides,
  };
}

function completion(overrides: Record<string, unknown>) {
  return {
    id: 'completion-default',
    feedbackVersion: 2,
    completedAt: new Date('2026-09-01T12:00:00.000Z'),
    details: {},
    ...overrides,
  };
}

describe('ObservationReaderService', () => {
  it('lanca NotFoundException para variavel desconhecida', async () => {
    const { reader } = buildReader([]);
    await expect(reader.getObservations('aluno-1', 'variavel.inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serie vazia quando o aluno nao tem nenhuma sessao', async () => {
    const { reader } = buildReader([]);
    const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
    expect(obs).toEqual([]);
  });

  it('missing nunca vira zero: sessao completada mas sem o campo preenchido nao gera observacao', async () => {
    const { reader } = buildReader([
      session({ id: 's1', completion: completion({ preSleepQuality: null }) }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
    expect(obs).toEqual([]);
  });

  it('sessao sem completion (sem registro) nao gera observacao', async () => {
    const { reader } = buildReader([session({ id: 's1', completion: null })]);
    const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
    expect(obs).toEqual([]);
  });

  it('exclui sessao-fantasma: plano arquivado sem completion', async () => {
    const { reader } = buildReader([
      session({ id: 'fantasma', plan: { status: 'archived' }, completion: null }),
      session({ id: 'real', plan: { status: 'active' }, completion: completion({ preSleepQuality: 4 }) }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
    expect(obs).toHaveLength(1);
    expect(obs[0].context.sessionId).toBe('real');
  });

  it('sessao de plano arquivado COM completion continua contando (nao e fantasma)', async () => {
    const { reader } = buildReader([
      session({ id: 'arquivada-mas-feita', plan: { status: 'archived' }, completion: completion({ preSleepQuality: 5 }) }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(5);
  });

  it('inclui sessao extra por padrao (excludeExtraSessions=false)', async () => {
    const { reader } = buildReader([
      session({
        id: 'extra-1',
        structure: { source: 'student', type: 'extra' },
        completion: completion({ preSleepQuality: 3 }),
      }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
    expect(obs).toHaveLength(1);
    expect(obs[0].context.isExtra).toBe(true);
  });

  it('exclui sessao extra quando a variavel exige (executionVsPrescribed: nao ha prescrito de referencia)', async () => {
    const { reader } = buildReader([
      session({
        id: 'extra-1',
        structure: { source: 'student', type: 'extra' },
        completion: completion({ executionVsPrescribed: 3 }),
      }),
      session({
        id: 'normal-1',
        structure: {},
        completion: completion({ executionVsPrescribed: 4 }),
      }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.executionVsPrescribed');
    expect(obs).toHaveLength(1);
    expect(obs[0].context.sessionId).toBe('normal-1');
  });

  it('preserva instrumentVersion por observacao — nao mistura versoes silenciosamente', async () => {
    const { reader } = buildReader([
      session({ id: 'v1', completion: completion({ feedbackVersion: 1, preStressLevel: 2 }) }),
      session({ id: 'v2', completion: completion({ feedbackVersion: 2, preStressLevel: 4 }) }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.preStressLevel');
    expect(obs.map((o) => o.instrumentVersion)).toEqual([1, 2]);
  });

  it('variavel v2-only nao gera observacao a partir de uma sessao feedbackVersion 1', async () => {
    const { reader } = buildReader([
      session({ id: 'v1', completion: completion({ feedbackVersion: 1, preMentalFatigue: 3 }) }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.preMentalFatigue');
    expect(obs).toEqual([]);
  });

  it('emotionalExperienceDuring le de details.postWorkoutMood na v1 e da coluna na v2', async () => {
    const { reader } = buildReader([
      session({
        id: 'v1',
        completion: completion({ feedbackVersion: 1, details: { postWorkoutMood: 4 } }),
      }),
      session({
        id: 'v2',
        completion: completion({ feedbackVersion: 2, emotionalExperienceDuring: 5 }),
      }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.emotionalExperienceDuring');
    expect(obs.map((o) => o.value)).toEqual([4, 5]);
  });

  it('converte satisfactionElaboracao (categoria) usando a mesma tabela de score do workout-completions.service', async () => {
    const { reader } = buildReader([
      session({ id: 's1', completion: completion({ satisfactionElaboracao: 'gostei' }) }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.satisfactionElaboracao');
    expect(obs).toHaveLength(1);
    expect(typeof obs[0].value).toBe('number');
  });

  it('le variavel de check-in semanal e filtra a query por checkinSkipped=false', async () => {
    const { reader, prisma } = buildReader([], [
      { id: 'c1', checkinVersion: 3, checkinSkipped: false, weekStartDate: new Date('2026-09-01'), prescriptionLiking: 4 },
      { id: 'c2', checkinVersion: 3, checkinSkipped: false, weekStartDate: new Date('2026-09-08'), prescriptionLiking: null },
    ]);
    const obs = await reader.getObservations('aluno-1', 'checkin.prescriptionLiking');
    expect(obs).toHaveLength(1);
    expect(obs[0].value).toBe(4);
    expect(prisma.weeklyCheckIn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ checkinSkipped: false }) }),
    );
  });
});
