// Fronteira do adapter Polar: payload bruto da AccessLink -> (a) modalidade canonica do Panzeri
// Run e (b) metricas estruturadas mas EXPLICITAMENTE identificadas como proprietarias da Polar.
// Nenhuma funcao aqui deve ser reusada por outro provedor — um futuro GarminAdapter/CorosAdapter/
// AppleAdapter tera' seu proprio arquivo com suas proprias regras de interpretacao, convergindo pro
// MESMO vocabulario canonico ('corrida' | 'esteira' | 'forca' | 'fortalecimento_corredores' |
// 'bike' | 'outra' — o mesmo ja usado em TrainingSession.modality, ver strava.service.ts
// modalityFromActivity). O dominio (ActivityLog, Training Intelligence) nunca importa nada deste
// arquivo nem conhece os nomes de campo da Polar.
//
// So' mapeamos aqui o que ja foi observado em payload real (01/10/2026): sport=RUNNING e
// sport=OTHER + detailed-sport-info=STRENGTH_TRAINING. Nao inventamos regra pra sport ainda nao
// visto (ex.: bike/natacao) — isso exige confirmar o formato real da Polar primeiro (ver aba
// "Atividades externas" do Admin, que expoe o raw payload pra essa checagem), em vez de adivinhar
// pelo nome do enum.

interface PolarTrainingLoadPro {
  ['cardio-load']?: unknown;
  ['cardio-load-interpretation']?: unknown;
  ['muscle-load']?: unknown;
  ['muscle-load-interpretation']?: unknown;
}

export interface PolarNormalizerInput {
  sport?: unknown;
  ['detailed-sport-info']?: unknown;
  ['running-index']?: unknown;
  ['training-load-pro']?: PolarTrainingLoadPro;
  ['cardio-load-interpretation']?: unknown;
  ['muscle-load-interpretation']?: unknown;
  ['user-rpe']?: unknown;
  ['perceived-load']?: unknown;
  ['perceived-load-interpretation']?: unknown;
  ['device']?: unknown;
  ['carbohydrate-percentage']?: unknown;
  ['fat-percentage']?: unknown;
  ['protein-percentage']?: unknown;
}

export interface PolarMetricWithInterpretation {
  value: number | null;
  interpretation: string | null;
}

export interface PolarProviderMetrics {
  device?: string;
  detailedSportInfo?: string;
  runningIndex?: number;
  cardioLoad?: PolarMetricWithInterpretation;
  muscleLoad?: PolarMetricWithInterpretation;
  perceivedLoad?: PolarMetricWithInterpretation;
  userRpe?: number;
  nutrition?: { carbohydratePercentage?: number; fatPercentage?: number; proteinPercentage?: number };
}

// Regra observada em producao (01/10/2026): Polar usa sport=OTHER como "nao classificado em uma
// modalidade especifica" e so' o detailed-sport-info diz que e' musculacao. Olhar sport sozinho
// (como o codigo fazia antes desta normalizacao, gravando o enum bruto direto em ActivityLog.sport)
// classificaria incorretamente todo treino de forca como modalidade "OTHER".
export function normalizePolarModality(summary: PolarNormalizerInput): string {
  const sport = typeof summary.sport === 'string' ? summary.sport.toUpperCase() : '';
  const detailedSportInfo = typeof summary['detailed-sport-info'] === 'string' ? summary['detailed-sport-info'].toUpperCase() : '';

  if (sport === 'RUNNING') return 'corrida';
  if (sport === 'OTHER' && detailedSportInfo === 'STRENGTH_TRAINING') return 'forca';

  return 'outra';
}

// Le um par valor+interpretacao do Training Load Pro, aceitando tanto a interpretacao aninhada
// dentro de training-load-pro quanto no nivel raiz (a documentacao publica da AccessLink nao deixa
// 100% claro qual e' o formato real em todo payload; aceitar os dois e' mais seguro do que acertar
// um e quebrar silenciosamente no outro). Sentinela de indisponibilidade SEMPRE resolve pra null —
// nunca inferimos ausencia pelo valor numerico em si (-1, 0 etc. podem ser validos em outro
// contexto), so' pela interpretacao explicita do provedor.
function readLoadMetric(
  trainingLoadPro: PolarTrainingLoadPro | undefined,
  valueKey: 'cardio-load' | 'muscle-load',
  interpretationKey: 'cardio-load-interpretation' | 'muscle-load-interpretation',
  rootInterpretation: unknown,
): PolarMetricWithInterpretation | undefined {
  const rawValue = trainingLoadPro?.[valueKey];
  const rawInterpretation = trainingLoadPro?.[interpretationKey] ?? rootInterpretation;
  if (rawValue === undefined && rawInterpretation === undefined) return undefined;

  const interpretation = typeof rawInterpretation === 'string' ? rawInterpretation : null;
  const isUnavailable = interpretation === 'NOT_AVAILABLE';
  const numericValue = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;

  return { value: isUnavailable ? null : numericValue, interpretation };
}

export function extractPolarProviderMetrics(summary: PolarNormalizerInput): PolarProviderMetrics | null {
  const metrics: PolarProviderMetrics = {};

  if (typeof summary.device === 'string') metrics.device = summary.device;
  if (typeof summary['detailed-sport-info'] === 'string') metrics.detailedSportInfo = summary['detailed-sport-info'];
  if (typeof summary['running-index'] === 'number' && Number.isFinite(summary['running-index'])) {
    metrics.runningIndex = summary['running-index'];
  }

  const trainingLoadPro = summary['training-load-pro'];
  const cardioLoad = readLoadMetric(trainingLoadPro, 'cardio-load', 'cardio-load-interpretation', summary['cardio-load-interpretation']);
  if (cardioLoad) metrics.cardioLoad = cardioLoad;
  const muscleLoad = readLoadMetric(trainingLoadPro, 'muscle-load', 'muscle-load-interpretation', summary['muscle-load-interpretation']);
  if (muscleLoad) metrics.muscleLoad = muscleLoad;

  const perceivedLoadInterpretation = typeof summary['perceived-load-interpretation'] === 'string' ? summary['perceived-load-interpretation'] : null;
  if (typeof summary['perceived-load'] === 'number' || perceivedLoadInterpretation) {
    const isUnavailable = perceivedLoadInterpretation === 'NOT_AVAILABLE';
    const value = typeof summary['perceived-load'] === 'number' && Number.isFinite(summary['perceived-load']) ? summary['perceived-load'] : null;
    metrics.perceivedLoad = { value: isUnavailable ? null : value, interpretation: perceivedLoadInterpretation };
  }

  // user-rpe: sentinela e' a string 'UNKNOWN' (nao um par valor+interpretation como os anteriores).
  if (typeof summary['user-rpe'] === 'number' && Number.isFinite(summary['user-rpe'])) {
    metrics.userRpe = summary['user-rpe'];
  } else if (typeof summary['user-rpe'] === 'string' && summary['user-rpe'] !== 'UNKNOWN' && summary['user-rpe'].trim() !== '' && Number.isFinite(Number(summary['user-rpe']))) {
    metrics.userRpe = Number(summary['user-rpe']);
  }

  const carb = typeof summary['carbohydrate-percentage'] === 'number' ? summary['carbohydrate-percentage'] : undefined;
  const fat = typeof summary['fat-percentage'] === 'number' ? summary['fat-percentage'] : undefined;
  const protein = typeof summary['protein-percentage'] === 'number' ? summary['protein-percentage'] : undefined;
  if (carb !== undefined || fat !== undefined || protein !== undefined) {
    metrics.nutrition = {
      ...(carb !== undefined ? { carbohydratePercentage: carb } : {}),
      ...(fat !== undefined ? { fatPercentage: fat } : {}),
      ...(protein !== undefined ? { proteinPercentage: protein } : {}),
    };
  }

  return Object.keys(metrics).length > 0 ? metrics : null;
}
