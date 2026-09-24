import { TrainingIntelligenceQueryService } from '../src/training-intelligence/training-intelligence-query.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { Observation } from '../src/training-intelligence/observation-reader.service';

// 24/09/2026 — fundacao da Camada Matematica Longitudinal (auditoria aprovada). Valida o endpoint
// de ponta a ponta: Prisma (mockado no ObservationReader) -> MathLayer -> resposta estruturada,
// incluindo o aviso explicito de nao-comparabilidade entre versoes de instrumento.

function observation(overrides: Partial<Observation>): Observation {
  return {
    athleteId: 'aluno-1',
    variableId: 'workout.preSleepQuality',
    value: 3,
    timestamp: new Date('2026-09-01T12:00:00.000Z'),
    source: 'student_feedback_per_workout',
    instrumentVersion: 2,
    context: { sessionId: 's1' },
    ...overrides,
  };
}

function buildService(observations: Observation[]) {
  const reader = { getObservations: jest.fn().mockResolvedValue(observations) };
  const service = new TrainingIntelligenceQueryService(reader as never, new MathLayerService());
  return { service, reader };
}

describe('TrainingIntelligenceQueryService', () => {
  it('retorna estrutura completa (current/mean/movingAverages/baseline/deviation/trend/evidence) para variavel numerica', async () => {
    const observations = [
      observation({ timestamp: new Date('2026-08-01T00:00:00.000Z'), value: 3 }),
      observation({ timestamp: new Date('2026-08-15T00:00:00.000Z'), value: 4 }),
      observation({ timestamp: new Date('2026-09-01T00:00:00.000Z'), value: 5 }),
    ];
    const { service } = buildService(observations);
    const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');

    expect(result.mathApplicable).toBe(true);
    expect(result.current).toBe(5);
    expect(result.mean).toEqual({ value: 4, n: 3 });
    expect(result.movingAverages).toHaveProperty('short_21d');
    expect(result.movingAverages).toHaveProperty('medium_60d');
    expect(result.movingAverages).toHaveProperty('long_200d');
    expect(result.baseline?.n).toBe(3);
    expect(result.deviation?.current).toBe(5);
    expect(result.trend).toHaveProperty('short_21d');
    expect(result.evidence.n).toBe(3);
    expect(result.evidence.instrumentVersions).toEqual([2]);
    expect(result.evidence.comparabilityWarning).toBeNull();
  });

  it('serie vazia: mathApplicable true mas todos os resultados numericos vem null/zerados', async () => {
    const { service } = buildService([]);
    const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');
    expect(result.current).toBeNull();
    expect(result.mean).toEqual({ value: null, n: 0 });
    expect(result.evidence.n).toBe(0);
    expect(result.evidence.lastObservationAt).toBeNull();
  });

  it('variavel categorica retorna mathApplicable false e nao tenta calcular estatisticas', async () => {
    const { service } = buildService([observation({ variableId: 'workout.painFlag', value: 1 })]);
    const result = await service.getVariableSnapshot('aluno-1', 'workout.painFlag');
    expect(result.mathApplicable).toBe(false);
    expect(result.mathSkippedReason).toBeDefined();
    expect(result.current).toBeNull();
    expect(result.movingAverages).toBeNull();
  });

  it('emite comparabilityWarning quando a serie mistura versoes nao-comparaveis (preStressLevel v1+v2)', async () => {
    const observations = [
      observation({ variableId: 'workout.preStressLevel', instrumentVersion: 1, value: 2 }),
      observation({ variableId: 'workout.preStressLevel', instrumentVersion: 2, value: 4 }),
    ];
    const { service } = buildService(observations);
    const result = await service.getVariableSnapshot('aluno-1', 'workout.preStressLevel');
    expect(result.evidence.instrumentVersions).toEqual([1, 2]);
    expect(result.evidence.comparabilityWarning).toContain('NAO sao');
  });

  it('nao emite comparabilityWarning quando so ha uma versao presente, mesmo em variavel nao-comparavel', async () => {
    const observations = [observation({ variableId: 'workout.preStressLevel', instrumentVersion: 2, value: 4 })];
    const { service } = buildService(observations);
    const result = await service.getVariableSnapshot('aluno-1', 'workout.preStressLevel');
    expect(result.evidence.comparabilityWarning).toBeNull();
  });
});
