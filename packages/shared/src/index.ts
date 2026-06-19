export type UserRole = 'student' | 'admin' | 'coach';

export type TrainingZone = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';

export interface ThreeKmTestResult {
  totalSeconds: number;
  vo2maxEstimated: number;
  vvo2Kmh: number;
  paceSecondsPerKm: number;
}

export interface WeeklyAvailabilityInput {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin?: number | null;
}
