import { NotFoundException } from '@nestjs/common';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';

// 24/09/2026 — fundacao da Camada Matematica Longitudinal (auditoria aprovada). Cobre os casos
// exigidos explicitamente: sessao-fantasma excluida, sessao extra excluida so quando a variavel
// exige (executionVsPrescribed), missing != zero, versoes diferentes de instrumento preservadas
// (nunca misturadas silenciosamente), variavel desconhecida.

// 01/10/2026: nightlySleepLog/stressCheckin vazios por padrao — fixtures existentes usam
// completions SEM nightlySleepLogId/stressCheckinId (undefined), entao continuam 100% pelo
// caminho legado (versions), exatamente como sempre foi lido. Testes especificos do registro
// compartilhado passam `nights`/`stressCheckins` explicitamente.
function buildReader(sessions: unknown[], checkins: unknown[] = [], nights: unknown[] = [], stressCheckins: unknown[] = []) {
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    weeklyCheckIn: { findMany: jest.fn().mockResolvedValue(checkins) },
    nightlySleepLog: { findMany: jest.fn().mockResolvedValue(nights) },
    stressCheckin: { findMany: jest.fn().mockResolvedValue(stressCheckins) },
  };
  return { reader: new ObservationReaderService(prisma as never, {} as never, {} as never), prisma };
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

  // 28/09/2026 — bug real reportado pelo treinador: grafico mostrava RPE num dia sem nenhum treino.
  // Causa: timestamp da observacao usava completion.completedAt (momento do envio do feedback) em
  // vez do dia de calendario do treino. Aluno que treina num dia e envia o feedback so' depois
  // (inclusive virando a noite) fazia o ponto aparecer no dia ERRADO no grafico.
  it('timestamp da observacao e o dia do TREINO (scheduledDate), nunca o momento em que o feedback foi enviado', async () => {
    const { reader } = buildReader([
      session({
        id: 's1',
        scheduledDate: new Date('2026-09-27T00:00:00.000Z'),
        // feedback enviado de madrugada do dia seguinte — completedAt cai em outro dia de calendario
        completion: completion({ preSleepQuality: 4, completedAt: new Date('2026-09-28T02:30:00.000Z') }),
      }),
    ]);
    const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
    expect(obs).toHaveLength(1);
    expect(obs[0].timestamp.toISOString().slice(0, 10)).toBe('2026-09-27');
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

  // Auditoria Astra (29/09/2026), item 17 — CAUSA RAIZ: toNumericValue() fazia Number(raw) pra
  // QUALQUER string, sem olhar dataType. Number("moderado")=NaN, entao painFlag (dataType
  // 'categorical' no VariableRegistry) era SEMPRE descartado como "ausencia", mesmo com dor
  // relatada de verdade — nenhum registro de dor jamais chegava na Training Intelligence.
  describe('workout.painFlag (categorica) — item 17 da auditoria', () => {
    it('preserva a categoria de dor como STRING, nunca descarta nem inventa numero', async () => {
      const { reader } = buildReader([
        session({ id: 's1', completion: completion({ painFlag: 'moderado' }) }),
      ]);
      const obs = await reader.getObservations('aluno-1', 'workout.painFlag');
      expect(obs).toHaveLength(1);
      expect(obs[0].value).toBe('moderado');
      expect(typeof obs[0].value).toBe('string');
    });

    it('cobre as 3 categorias reais (leve/moderado/forte) — nenhuma delas vira NaN/ausencia', async () => {
      const { reader } = buildReader([
        session({ id: 's1', completion: completion({ painFlag: 'leve' }) }),
        session({ id: 's2', scheduledDate: new Date('2026-09-02T00:00:00.000Z'), completion: completion({ id: 'c2', painFlag: 'moderado' }) }),
        session({ id: 's3', scheduledDate: new Date('2026-09-03T00:00:00.000Z'), completion: completion({ id: 'c3', painFlag: 'forte' }) }),
      ]);
      const obs = await reader.getObservations('aluno-1', 'workout.painFlag');
      expect(obs.map((o) => o.value)).toEqual(['leve', 'moderado', 'forte']);
    });

    it('painFlag "none" tambem e preservado como categoria (nao e a mesma coisa que ausencia de registro)', async () => {
      const { reader } = buildReader([session({ id: 's1', completion: completion({ painFlag: 'none' }) })]);
      const obs = await reader.getObservations('aluno-1', 'workout.painFlag');
      expect(obs).toHaveLength(1);
      expect(obs[0].value).toBe('none');
    });

    it('ausencia de verdade (campo null, aluno nao respondeu) continua sem gerar observacao', async () => {
      const { reader } = buildReader([session({ id: 's1', completion: completion({ painFlag: null }) })]);
      const obs = await reader.getObservations('aluno-1', 'workout.painFlag');
      expect(obs).toEqual([]);
    });

    it('variavel numerica comum (nao-categorica) continua funcionando exatamente como antes', async () => {
      const { reader } = buildReader([session({ id: 's1', completion: completion({ preSleepQuality: 4 }) })]);
      const obs = await reader.getObservations('aluno-1', 'workout.preSleepQuality');
      expect(obs).toHaveLength(1);
      expect(obs[0].value).toBe(4);
      expect(typeof obs[0].value).toBe('number');
    });
  });
});
