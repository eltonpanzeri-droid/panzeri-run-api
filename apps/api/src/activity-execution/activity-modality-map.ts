// Equivalencias OFICIAS entre os codigos de atividade de cada provedor e a modalidade canonica do Panzeri Run (10/2026).
// Fontes (conferidas em 10/10/2026):
//  - Apple HealthKit: HKWorkoutActivityType (valores numericos do enum, ex.: running = 37). O app iOS ja grava activityTypeRaw no payload.
//  - Wahoo Cloud API: enumeracao workout_type_id (id -> nome + familia) da documentacao oficial.
//  - Polar AccessLink v3: `sport` e' texto livre ("Sport name"); `detailed-sport-info` e' "nome de um esporte compativel com o Polar Flow".
//    A lista completa (apendice) NAO foi acessivel na conferencia: so' os valores documentados/observados em payload real sao mapeados
//    (ver polar-activity-normalizer.ts). Ampliar la' quando o apendice for conferido.
//  - Strava: nao e' um provedor de ActivityLog (so' chega via Apple Health, ja' coberto pelo tipo HealthKit). Garmin: ainda nao integrado —
//    para adicionar, criar um mapa novo neste arquivo seguindo o mesmo formato e apontar o adapter novo para ele.
// Regras: o valor ORIGINAL do provedor continua no payload bruto (RawExternalActivity); aqui so' se decide a modalidade canonica. Nada de
// equivalencia por semelhanca de nome: so' codigos da tabela. Codigo desconhecido => 'outra' (registrada como atividade, nunca descartada).

// Vocabulario canonico de atividades observadas. As quatro primeiras sao as modalidades PRESCRITAS (mais 'fortalecimento_corredores', que so'
// existe como prescricao); as demais so' registram o que aconteceu (atividade extra no historico).
export type ObservedModality = 'corrida' | 'esteira' | 'forca' | 'funcional' | 'bike' | 'natacao' | 'caminhada' | 'outra';

// ── Apple HealthKit ───────────────────────────────────────────────────────────────────────────────────────────────────
const APPLE_BY_RAW: Record<number, ObservedModality> = {
  37: 'corrida',      // running
  50: 'forca',        // traditionalStrengthTraining
  20: 'funcional',    // functionalStrengthTraining
  11: 'funcional',    // crossTraining
  63: 'funcional',    // highIntensityIntervalTraining
  73: 'funcional',    // mixedCardio
  59: 'funcional',    // coreTraining
  30: 'funcional',    // mixedMetabolicCardioTraining (descontinuado pela Apple)
  52: 'caminhada',    // walking
  24: 'caminhada',    // hiking
  13: 'bike',         // cycling
  74: 'bike',         // handCycling
  46: 'natacao',      // swimming
};

export function appleHealthModality(activityTypeRaw: unknown, activityType: unknown, isIndoor: unknown): ObservedModality {
  const byRaw = typeof activityTypeRaw === 'number' && Number.isInteger(activityTypeRaw) ? APPLE_BY_RAW[activityTypeRaw] : undefined;
  const modality: ObservedModality = byRaw ?? (activityTypeRaw == null && activityType === 'running' ? 'corrida' : 'outra');
  // HKMetadataKeyIndoorWorkout: corrida em ambiente fechado = esteira (mesmo grupo de compatibilidade da corrida).
  return modality === 'corrida' && isIndoor === true ? 'esteira' : modality;
}

// ── Wahoo Cloud API (workout_type_id) ─────────────────────────────────────────────────────────────────────────────────
const WAHOO_BY_ID: Record<number, ObservedModality> = {
  1: 'corrida', 3: 'corrida', 4: 'corrida', 67: 'corrida',        // RUNNING, RUNNING_TRACK, RUNNING_TRAIL, RUNNING_RACE
  5: 'esteira', 71: 'esteira',                                    // RUNNING_TREADMILL, RUNNING_INDOOR_VIRTUAL
  42: 'funcional',                                                // WORKOUT (treino generico de academia)
  0: 'bike', 11: 'bike', 12: 'bike', 13: 'bike', 14: 'bike', 15: 'bike', 16: 'bike', 21: 'bike', 49: 'bike', 61: 'bike', 64: 'bike', 68: 'bike', 70: 'bike',
  25: 'natacao', 26: 'natacao',                                   // SWIMMING_LAP, SWIMMING_OPEN_WATER
  6: 'caminhada', 7: 'caminhada', 8: 'caminhada', 9: 'caminhada', 10: 'caminhada', 56: 'caminhada', // familia WALKING da documentacao
};

export function wahooModality(workoutTypeId: unknown): ObservedModality {
  return typeof workoutTypeId === 'number' && Number.isInteger(workoutTypeId) ? (WAHOO_BY_ID[workoutTypeId] ?? 'outra') : 'outra';
}

// ── Compatibilidade prescricao x atividade ────────────────────────────────────────────────────────────────────────────
// 'funcional' (funcional/cross training/HIIT/circuito/treino generico de academia) so' pode corresponder a uma musculacao ou a um
// fortalecimento prescritos COM evidencia de duracao compativel — nunca sozinho, e nunca com a corrida.
export const WEAK_FORCE_ACTIVITY = 'funcional';
export const FORCE_SESSION_MODALITIES = ['forca', 'fortalecimento_corredores'];
