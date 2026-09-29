import { TrainingIntelligenceQueryService } from '../src/training-intelligence/training-intelligence-query.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
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
  const mathLayer = new MathLayerService();
  const service = new TrainingIntelligenceQueryService(reader as never, mathLayer, new LongitudinalDynamicsService(mathLayer));
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

    // Rastreabilidade ate o registro original (auditoria, item 10): cada observacao usada nos
    // calculos precisa carregar o sessionId que permite voltar ao registro bruto.
    expect(result.observations).toHaveLength(3);
    expect(result.observations[0].context.sessionId).toBe('s1');
    expect(result.observations.map((o) => o.value)).toEqual([3, 4, 5]);

    // Dinamica longitudinal (segundo bloco, 24/09/2026).
    expect(result.variability).toHaveProperty('short_21d');
    expect(result.variability).toHaveProperty('medium_60d');
    expect(result.variability).toHaveProperty('long_200d');
    expect(result.habitualRange?.method).toBe('empirical_percentile_linear_interpolation');
    expect(result.variabilityChange?.direction).toBeDefined();
    expect(result.persistence).not.toBeNull();
    expect(result.excursions).not.toBeNull();
  });

  // 25/09/2026 (Visualizacao Longitudinal) — movingAverageSeries e' a MESMA funcao movingAverage()
  // reaplicada com asOf em cada observacao (nao uma formula nova). Um ponto por observacao, cada
  // um refletindo so' o que era conhecido ATE aquela data (nunca "olhando pra frente").
  it('movingAverageSeries reaplica movingAverage() em cada data de observacao (curva, nao so o valor atual)', async () => {
    const observations = [
      observation({ timestamp: new Date('2026-08-01T00:00:00.000Z'), value: 2 }),
      observation({ timestamp: new Date('2026-08-15T00:00:00.000Z'), value: 4 }),
      observation({ timestamp: new Date('2026-09-01T00:00:00.000Z'), value: 6 }),
    ];
    const { service } = buildService(observations);
    const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');

    expect(result.movingAverageSeries).toHaveProperty('short_21d');
    const series = result.movingAverageSeries!.short_21d;
    expect(series).toHaveLength(3);
    // Na primeira observacao, a janela de 21 dias so conhece esse unico ponto -> media = o proprio valor.
    expect(series[0].value).toBe(2);
    expect(series[0].isPartialWindow).toBe(true);
    // Na ultima observacao, o valor da serie bate com o "atual" de movingAverages (mesma janela, mesmo asOf).
    expect(series[2].value).toBe(result.movingAverages!.short_21d.value);
    expect(series[2].timestamp).toBe('2026-09-01T00:00:00.000Z');
  });

  // 25/09/2026 (Exploracao Longitudinal) — pedido do treinador: RPE de corrida e RPE de musculacao
  // sao coisas distintas, misturar as duas numa unica media/baseline seria uma composicao
  // silenciosa. O filtro de modalidade precisa recalcular TUDO (mean/baseline/evidence) so' sobre
  // o subconjunto escolhido, nunca so' filtrar pontos do grafico em cima de estatisticas mistas.
  it('filtro de modalidade recalcula mean/baseline/evidence so sobre o subconjunto escolhido, preservando availableModalities do historico completo', async () => {
    const observations = [
      observation({ value: 8, timestamp: new Date('2026-08-01T00:00:00.000Z'), context: { modality: 'corrida' } }),
      observation({ value: 4, timestamp: new Date('2026-08-15T00:00:00.000Z'), context: { modality: 'forca' } }),
      observation({ value: 6, timestamp: new Date('2026-09-01T00:00:00.000Z'), context: { modality: 'corrida' } }),
    ];
    const { service } = buildService(observations);

    const all = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');
    expect(all.availableModalities).toEqual(['corrida', 'forca']);
    expect(all.evidence.n).toBe(3);
    expect(all.mean?.value).toBe(6); // (8+4+6)/3

    const soCorrida = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality', ['corrida']);
    expect(soCorrida.evidence.n).toBe(2);
    expect(soCorrida.mean?.value).toBe(7); // (8+6)/2 — forca excluida do calculo, nao so do grafico
    expect(soCorrida.observations.every((o) => o.context.modality === 'corrida')).toBe(true);
    // availableModalities sempre reflete o historico INTEIRO, pra o seletor nao perder opcoes ja usadas antes.
    expect(soCorrida.availableModalities).toEqual(['corrida', 'forca']);
  });

  it('variavel sem dimensao de modalidade (checkin.* semanal) ignora o filtro sem quebrar', async () => {
    const observations = [observation({ variableId: 'checkin.prescriptionLiking', source: 'student_weekly_checkin', instrumentVersion: 2, context: { checkinId: 'c1' } })];
    const { service } = buildService(observations);
    const result = await service.getVariableSnapshot('aluno-1', 'checkin.prescriptionLiking', ['corrida']);
    expect(result.availableModalities).toEqual([]);
    expect(result.evidence.n).toBe(1);
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
    // Mesmo sem matematica aplicavel, a rastreabilidade continua disponivel.
    expect(result.observations).toHaveLength(1);
    expect(result.variability).toBeNull();
    expect(result.habitualRange).toBeNull();
    expect(result.excursions).toBeNull();
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

  it('comparabilityWarning nao suprime o calculo de variabilidade/faixa habitual (aviso, nao exclusao)', async () => {
    const observations = [
      observation({ variableId: 'workout.preStressLevel', instrumentVersion: 1, value: 2, timestamp: new Date('2026-08-01T00:00:00.000Z') }),
      observation({ variableId: 'workout.preStressLevel', instrumentVersion: 2, value: 4, timestamp: new Date('2026-09-01T00:00:00.000Z') }),
    ];
    const { service } = buildService(observations);
    const result = await service.getVariableSnapshot('aluno-1', 'workout.preStressLevel');
    expect(result.evidence.comparabilityWarning).not.toBeNull();
    expect(result.variability?.long_200d.n).toBe(2);
    expect(result.habitualRange?.n).toBe(2);
  });

  // 27/09/2026 — bug real achado validando Volume/Aderência/ACWR com aluna real: variáveis com
  // total GLOBAL genuinamente RECOMBINADO (não apenas "sem filtro") marcam a entrada global com
  // context.modality==='global' (ver TRAINING_LOAD_GLOBAL_TAG em observation-reader.service.ts).
  // Sem filtro explícito, a resposta tem que usar SÓ essa entrada — nunca misturar com as entradas
  // por modalidade real no mesmo pool (isso inflava n e podia fazer "current" pegar o valor de uma
  // modalidade errada em vez do total combinado).
  describe('modalidade "global" reservada (total recombinado, ex: aderência semanal)', () => {
    it('sem filtro: usa SO a entrada global, nunca mistura com as entradas por modalidade', async () => {
      const observations = [
        observation({ context: { modality: 'global' }, timestamp: new Date('2026-09-01T00:00:00.000Z'), value: 80 }),
        observation({ context: { modality: 'corrida' }, timestamp: new Date('2026-09-01T00:00:00.000Z'), value: 100 }),
        observation({ context: { modality: 'forca' }, timestamp: new Date('2026-09-01T00:00:00.000Z'), value: 50 }),
      ];
      const { service } = buildService(observations);
      const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');
      expect(result.evidence.n).toBe(1); // nunca 3 — so a global conta quando nao ha filtro
      expect(result.current).toBe(80); // nunca 100 (corrida) nem 50 (forca) por acaso de ordenacao
    });

    it('availableModalities nunca inclui a tag reservada "global" na lista de modalidades reais', async () => {
      const observations = [
        observation({ context: { modality: 'global' }, value: 80 }),
        observation({ context: { modality: 'corrida' }, value: 100 }),
      ];
      const { service } = buildService(observations);
      const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');
      expect(result.availableModalities).toEqual(['corrida']);
    });

    it('filtro explicito por modalidade real continua funcionando normalmente (nao afetado pela tag global)', async () => {
      const observations = [
        observation({ context: { modality: 'global' }, value: 80 }),
        observation({ context: { modality: 'corrida' }, value: 100 }),
        observation({ context: { modality: 'forca' }, value: 50 }),
      ];
      const { service } = buildService(observations);
      const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality', ['corrida']);
      expect(result.evidence.n).toBe(1);
      expect(result.current).toBe(100);
    });

    it('variavel SEM a tag global (ex: RPE de verdade) continua com o comportamento antigo — sem filtro usa TODAS as observacoes', async () => {
      const observations = [
        observation({ context: { modality: 'corrida' }, timestamp: new Date('2026-08-01T00:00:00.000Z'), value: 5 }),
        observation({ context: { modality: 'musculacao' }, timestamp: new Date('2026-09-01T00:00:00.000Z'), value: 3 }),
      ];
      const { service } = buildService(observations);
      const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');
      expect(result.evidence.n).toBe(2); // comportamento inalterado: Global = tudo, sem tag reservada
      expect(result.current).toBe(3);
    });
  });

  // Auditoria Astra (29/09/2026), item 20 — currentWeekContext extrai numerator/denominator/
  // coveragePercent/isPartialWeek da observacao MAIS RECENTE (a que vira `current`), pra variaveis
  // de training_load. Ausente (null) pra qualquer variavel que nao carregue esse context.
  describe('currentWeekContext (item 20 da auditoria)', () => {
    it('extrai os metadados da observacao mais recente quando presentes (variavel de training_load)', async () => {
      const observations = [
        observation({
          variableId: 'training.adherencePercent',
          timestamp: new Date('2026-09-14T12:00:00.000Z'),
          value: 0.8,
          source: 'weekly_training_load',
          context: { isPartialWeek: false, numerator: 4, denominator: 5, coveragePercent: 80 },
        }),
        observation({
          variableId: 'training.adherencePercent',
          timestamp: new Date('2026-09-21T12:00:00.000Z'), // mais recente -> este e' o `current`
          value: 0.6,
          source: 'weekly_training_load',
          context: { isPartialWeek: true, numerator: 3, denominator: 5, coveragePercent: 60 },
        }),
      ];
      const { service } = buildService(observations);
      const result = await service.getVariableSnapshot('aluno-1', 'training.adherencePercent');
      expect(result.current).toBe(0.6);
      expect(result.currentWeekContext).toEqual({ isPartialWeek: true, numerator: 3, denominator: 5, coveragePercent: 60 });
    });

    it('null quando a variavel nao carrega esse context (ex: RPE comum)', async () => {
      const observations = [observation({ value: 4 })];
      const { service } = buildService(observations);
      const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');
      expect(result.currentWeekContext).toBeNull();
    });

    it('null quando nao ha nenhuma observacao', async () => {
      const { service } = buildService([]);
      const result = await service.getVariableSnapshot('aluno-1', 'workout.preSleepQuality');
      expect(result.currentWeekContext).toBeNull();
    });
  });

  // Auditoria Astra (29/09/2026), item 17 — variavel categorica (workout.painFlag) preserva o
  // valor como STRING na resposta, nunca tenta converter pra numero nem quebra o mathApplicable=false.
  describe('variavel categorica — item 17 da auditoria', () => {
    it('mathApplicable=false e o valor da categoria chega intacto em observations (nunca descartado)', async () => {
      const observations = [
        observation({ variableId: 'workout.painFlag', value: 'moderado', source: 'student_feedback_per_workout' }),
      ];
      const { service } = buildService(observations);
      const result = await service.getVariableSnapshot('aluno-1', 'workout.painFlag');
      expect(result.mathApplicable).toBe(false);
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0].value).toBe('moderado');
    });
  });
});
