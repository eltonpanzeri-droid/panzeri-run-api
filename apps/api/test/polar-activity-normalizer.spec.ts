import { extractPolarProviderMetrics, normalizePolarModality } from '../src/polar/polar-activity-normalizer';

// Casos reais confirmados em producao em 01/10/2026 (uma corrida + dois treinos de forca
// importados via Polar AccessLink) — ver diagnostico que motivou esta normalizacao.
describe('normalizePolarModality', () => {
  it('sport=RUNNING -> corrida', () => {
    expect(normalizePolarModality({ sport: 'RUNNING' })).toBe('corrida');
  });

  it('sport=OTHER + detailed-sport-info=STRENGTH_TRAINING -> forca (sport sozinho nao e suficiente)', () => {
    expect(normalizePolarModality({ sport: 'OTHER', ['detailed-sport-info']: 'STRENGTH_TRAINING' })).toBe('forca');
  });

  it('sport=OTHER sem detailed-sport-info reconhecido -> outra (nunca "OTHER" bruto, nunca forca por adivinhacao)', () => {
    expect(normalizePolarModality({ sport: 'OTHER' })).toBe('outra');
    expect(normalizePolarModality({ sport: 'OTHER', ['detailed-sport-info']: 'RUNNING_TRACK' })).toBe('outra');
  });

  it('sport ausente ou de formato inesperado -> outra, nunca null nem o valor bruto', () => {
    expect(normalizePolarModality({})).toBe('outra');
    expect(normalizePolarModality({ sport: 123 })).toBe('outra');
  });

  it('nunca retorna o enum bruto da Polar como modalidade (RUNNING/OTHER/STRENGTH_TRAINING nao sao valores canonicos validos)', () => {
    const result = normalizePolarModality({ sport: 'RUNNING' });
    expect(['corrida', 'esteira', 'forca', 'fortalecimento_corredores', 'bike', 'outra']).toContain(result);
  });
});

describe('extractPolarProviderMetrics — sentinelas de indisponibilidade nunca viram observacao valida', () => {
  it('caso real: corrida com muscle-load=1086.25 interpretado como MEDIUM — valor preservado', () => {
    const metrics = extractPolarProviderMetrics({
      sport: 'RUNNING',
      ['training-load-pro']: { ['muscle-load']: 1086.25, ['muscle-load-interpretation']: 'MEDIUM' },
    });
    expect(metrics?.muscleLoad).toEqual({ value: 1086.25, interpretation: 'MEDIUM' });
  });

  it('caso real: treino de forca com muscle-load=-1 + interpretation=NOT_AVAILABLE -> value null (nunca -1, nunca carga negativa)', () => {
    const metrics = extractPolarProviderMetrics({
      sport: 'OTHER',
      ['detailed-sport-info']: 'STRENGTH_TRAINING',
      ['training-load-pro']: { ['muscle-load']: -1, ['muscle-load-interpretation']: 'NOT_AVAILABLE' },
    });
    expect(metrics?.muscleLoad).toEqual({ value: null, interpretation: 'NOT_AVAILABLE' });
  });

  it('caso real: perceived-load=0 + perceived-load-interpretation=NOT_AVAILABLE -> value null (nunca carga percebida zero)', () => {
    const metrics = extractPolarProviderMetrics({ ['perceived-load']: 0, ['perceived-load-interpretation']: 'NOT_AVAILABLE' });
    expect(metrics?.perceivedLoad).toEqual({ value: null, interpretation: 'NOT_AVAILABLE' });
  });

  it('caso real: user-rpe=UNKNOWN -> ausente do resultado (nunca RPE zero)', () => {
    const metrics = extractPolarProviderMetrics({ ['user-rpe']: 'UNKNOWN' });
    expect(metrics?.userRpe).toBeUndefined();
  });

  it('user-rpe numerico valido e preservado', () => {
    const metrics = extractPolarProviderMetrics({ ['user-rpe']: 7 });
    expect(metrics?.userRpe).toBe(7);
  });

  it('cardio-load com interpretation valida (nao NOT_AVAILABLE) preserva o valor', () => {
    const metrics = extractPolarProviderMetrics({
      ['training-load-pro']: { ['cardio-load']: 240.8, ['cardio-load-interpretation']: 'HIGH' },
    });
    expect(metrics?.cardioLoad).toEqual({ value: 240.8, interpretation: 'HIGH' });
  });

  it('device, detailed-sport-info e running-index ficam estruturados e identificaveis', () => {
    const metrics = extractPolarProviderMetrics({
      device: 'Polar Vantage V3',
      ['detailed-sport-info']: 'STRENGTH_TRAINING',
      ['running-index']: 52,
    });
    expect(metrics).toMatchObject({ device: 'Polar Vantage V3', detailedSportInfo: 'STRENGTH_TRAINING', runningIndex: 52 });
  });

  it('percentuais de macronutriente ficam agrupados sob "nutrition", nao como colunas soltas', () => {
    const metrics = extractPolarProviderMetrics({
      ['carbohydrate-percentage']: 62,
      ['fat-percentage']: 28,
      ['protein-percentage']: 10,
    });
    expect(metrics?.nutrition).toEqual({ carbohydratePercentage: 62, fatPercentage: 28, proteinPercentage: 10 });
  });

  it('payload totalmente vazio de metricas proprietarias -> null (nao um objeto vazio)', () => {
    expect(extractPolarProviderMetrics({ sport: 'RUNNING' })).toBeNull();
  });
});
