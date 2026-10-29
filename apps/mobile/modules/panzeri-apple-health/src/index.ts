import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

// Bloco 1 (prova tecnica) — HealthKit + WorkoutKit. Modulo nativo SO iOS: em Android, web/PWA e Expo Go o modulo nao
// existe, `isSupported` e' false e nenhuma chamada e' feita. Estas funcoes so' leem/agendam NO aparelho; o envio de treinos lidos para a API
// (sincronizacao com o Panzeri Run) e' feito pelo app, com autorizacao do usuario.

export interface AppleRunningWorkout {
  uuid: string;
  sourceName: string;
  sourceBundleId: string;
  sourceProductType: string | null;
  deviceName: string | null;
  deviceManufacturer: string | null;
  deviceModel: string | null;
  deviceHardwareVersion: string | null;
  deviceSoftwareVersion: string | null;
  activityType: string;
  activityTypeRaw: number;
  isIndoor: boolean | null;
  timeZone: string | null;
  startDate: string;
  endDate: string;
  durationSeconds: number;
  distanceMeters: number | null;
  // 'unavailable' = o HealthKit nao tem estatistica de distancia para o treino (nao e' zero); 'reported' = valor informado (inclusive 0).
  distanceStatus?: 'reported' | 'unavailable';
  // UUID do Panzeri Run quando o treino foi executado a partir de um plano agendado por nos (round trip); senao null.
  workoutPlanId: string | null;
  // Medidas associadas ao treino no app Saude (28/10/2026). So' existem quando o iOS as entregou: sem autorizacao ou sem dado, o campo falta (nunca zero).
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  activeEnergyKcal?: number;
  stepCount?: number;
  powerAvgWatts?: number;
  avgSpeedMetersPerSecond?: number;
  avgStrideLengthMeters?: number;
  avgGroundContactTimeMs?: number;
  avgVerticalOscillationCm?: number;
  elevationGainMeters?: number;
}

// Ponto compacto do percurso: [deslocamentoSeg, latitude, longitude, altitude|null].
export type AppleRoutePoint = [number, number, number, number | null];

export interface AppleScheduledWorkout {
  planId: string;
  date: string | null;
  complete: boolean;
}

// Resultado da construcao/validacao nativa de um CustomWorkout (sem agendar). Rejeicoes sao estruturadas e identificaveis.
export interface NativeCustomWorkoutValidation {
  valid: boolean;
  errors: Array<{ code: string; message: string; path: string }>;
  summary?: {
    activity: string;
    location: string;
    blocks: Array<{ iterations: number; steps: Array<{ purpose: string; meters: number }> }>;
    totalMeters: number;
    serializedBytes: number;
  };
}

// Resultado do agendamento de um CustomWorkout: scheduled=false so' quando o spec foi recusado (errors identificaveis); falha de autorizacao/agendamento REJEITA.
export interface NativeScheduleCustomWorkoutResult {
  scheduled: boolean;
  planId: string;
  scheduledFor?: string;
  errors?: Array<{ code: string; message: string; path: string }>;
}

// Saude do dia a dia (29/10/2026). Linhas cruas lidas pelo nativo; quem monta os registros e' src/appleHealthSync/appleHealthRecords.ts.
export interface AppleStatRow { identifier: string; day: string; startTime: string; offsetSeconds: number; sum?: number; avg?: number; min?: number; max?: number; latest?: number }
export interface AppleCategoryRow { identifier: string; value: number; startTime: string; endTime: string; offsetSeconds: number; sourceBundleId: string; sourceName: string; deviceName: string | null }
export interface NativeRows<T> { rows: T[]; failed: string[] }

export type HealthAuthorizationRequestStatus = 'shouldRequest' | 'unnecessary' | 'unknown';
export type WorkoutAuthorizationState = 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'unknown';

interface NativeModule {
  isHealthDataAvailable(): boolean;
  getHealthAuthorizationRequestStatus(): Promise<HealthAuthorizationRequestStatus>;
  requestHealthAuthorization(): Promise<{ requested: boolean }>;
  readRecentRunningWorkouts(limit: number): Promise<AppleRunningWorkout[]>;
  readWorkoutRoute(uuid: string, maxPoints: number): Promise<AppleRoutePoint[]>;
  readWorkoutsInRange(startIso: string, endIso: string, limit: number): Promise<AppleRunningWorkout[]>;
  requestHealthAuthorizationFor(quantityIds: string[], categoryIds: string[]): Promise<{ requested: boolean; typeCount: number }>;
  readDailyStatistics(specsJson: string, startIso: string, endIso: string): Promise<NativeRows<AppleStatRow>>;
  readCategorySamples(identifiers: string[], startIso: string, endIso: string): Promise<NativeRows<AppleCategoryRow>>;
  requestWorkoutAuthorization(): Promise<WorkoutAuthorizationState>;
  scheduleRunWorkout(planId: string, distanceKm: number, startIso: string): Promise<{ scheduled: boolean; planId: string; distanceKm: number; scheduledFor: string }>;
  validateCustomWorkoutSpec(specJson: string): NativeCustomWorkoutValidation;
  scheduleCustomWorkoutSpec(planId: string, specJson: string, startIso: string): Promise<NativeScheduleCustomWorkoutResult>;
  listScheduledWorkouts(): Promise<AppleScheduledWorkout[]>;
  removeAllScheduledWorkouts(): Promise<{ removed: boolean }>;
}

const native: NativeModule | null = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeModule>('PanzeriAppleHealth') : null;

export const isAppleHealthSupported = native !== null;

function module_(): NativeModule {
  if (!native) throw new Error('Apple Saude/WorkoutKit disponivel apenas no app nativo iOS (build com o modulo PanzeriAppleHealth).');
  return native;
}

export const isHealthDataAvailable = () => (native ? native.isHealthDataAvailable() : false);
export const getHealthAuthorizationRequestStatus = () => module_().getHealthAuthorizationRequestStatus();
export const requestHealthAuthorization = () => module_().requestHealthAuthorization();
export const readRecentRunningWorkouts = (limit = 5) => module_().readRecentRunningWorkouts(limit);
export const readWorkoutRoute = (uuid: string, maxPoints = 2000) => module_().readWorkoutRoute(uuid, maxPoints);
// Treinos de TODOS os tipos num periodo (mais recente primeiro).
export const readWorkoutsInRange = (start: Date, end: Date, limit = 500) => module_().readWorkoutsInRange(start.toISOString(), end.toISOString(), limit);
// Pede leitura (nunca escrita) dos tipos de saude informados, alem dos de treino.
export const requestHealthAuthorizationFor = (quantityIds: string[], categoryIds: string[]) => module_().requestHealthAuthorizationFor(quantityIds, categoryIds);
export const readDailyStatistics = (specs: Array<{ identifier: string; unit: string }>, start: Date, end: Date) => module_().readDailyStatistics(JSON.stringify(specs), start.toISOString(), end.toISOString());
export const readCategorySamples = (identifiers: string[], start: Date, end: Date) => module_().readCategorySamples(identifiers, start.toISOString(), end.toISOString());
export const requestWorkoutAuthorization = () => module_().requestWorkoutAuthorization();
export const scheduleRunWorkout = (planId: string, distanceKm: number, start: Date) => module_().scheduleRunWorkout(planId, distanceKm, start.toISOString());
// Constroi e valida (SEM agendar) um CustomWorkout a partir do AppleCustomWorkoutSpec ja validado pela API. O spec vai como JSON, sem alteracao.
export const validateCustomWorkoutSpec = (specJson: string): NativeCustomWorkoutValidation => module_().validateCustomWorkoutSpec(specJson);
// Agenda o CustomWorkout do spec (ja' validado pela API) com o planId estavel da entrega. Usa o mesmo builder da validacao nativa.
export const scheduleCustomWorkoutSpec = (planId: string, specJson: string, start: Date) => module_().scheduleCustomWorkoutSpec(planId, specJson, start.toISOString());
export const listScheduledWorkouts = () => module_().listScheduledWorkouts();
export const removeAllScheduledWorkouts = () => module_().removeAllScheduledWorkouts();
