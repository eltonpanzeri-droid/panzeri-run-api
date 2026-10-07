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
  // UUID do Panzeri Run quando o treino foi executado a partir de um plano agendado por nos (round trip); senao null.
  workoutPlanId: string | null;
}

export interface AppleScheduledWorkout {
  planId: string;
  date: string | null;
  complete: boolean;
}

export type HealthAuthorizationRequestStatus = 'shouldRequest' | 'unnecessary' | 'unknown';
export type WorkoutAuthorizationState = 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'unknown';

interface NativeModule {
  isHealthDataAvailable(): boolean;
  getHealthAuthorizationRequestStatus(): Promise<HealthAuthorizationRequestStatus>;
  requestHealthAuthorization(): Promise<{ requested: boolean }>;
  readRecentRunningWorkouts(limit: number): Promise<AppleRunningWorkout[]>;
  requestWorkoutAuthorization(): Promise<WorkoutAuthorizationState>;
  scheduleRunWorkout(planId: string, distanceKm: number, startIso: string): Promise<{ scheduled: boolean; planId: string; distanceKm: number; scheduledFor: string }>;
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
export const requestWorkoutAuthorization = () => module_().requestWorkoutAuthorization();
export const scheduleRunWorkout = (planId: string, distanceKm: number, start: Date) => module_().scheduleRunWorkout(planId, distanceKm, start.toISOString());
export const listScheduledWorkouts = () => module_().listScheduledWorkouts();
export const removeAllScheduledWorkouts = () => module_().removeAllScheduledWorkouts();
