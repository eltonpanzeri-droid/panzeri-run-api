// Objetivo "Correr ultramaratona" (29/10/2026). O objetivo operacional (UserPreferences.mainGoal) e' o que o Prescritor, o Gerente Tecnico, o painel e a reavaliacao leem; por isso a distancia
// escolhida pela aluna entra no proprio texto do objetivo ("Correr ultramaratona de 100 km"). A distancia crua fica tambem em OnboardingInterview.answers.ultra_distance_km.
export const ULTRA_OBJECTIVE = 'Correr ultramaratona';
export const ULTRA_DISTANCE_KEY = 'ultra_distance_km';
export const ULTRA_MIN_KM = 43;
export const ULTRA_MAX_KM = 999;

// Distancia valida de ultramaratona (acima da maratona, ate 3 digitos). Aceita numero ou texto com virgula.
export function parseUltraKm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim().replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= ULTRA_MIN_KM && n <= ULTRA_MAX_KM ? Math.round(n * 10) / 10 : null;
}

export const isUltraObjective = (objective: unknown): boolean => typeof objective === 'string' && (objective === ULTRA_OBJECTIVE || objective.startsWith(ULTRA_OBJECTIVE + ' '));

// Texto do objetivo operacional. Qualquer objetivo que nao seja ultramaratona passa intacto; ultramaratona sem distancia valida fica "Correr ultramaratona" (a entrevista exige a distancia).
export function composeObjective(objective: unknown, ultraKm: unknown): string | null {
  if (typeof objective !== 'string' || !objective.trim()) return null;
  const base = objective.trim();
  if (!isUltraObjective(base)) return base;
  const km = parseUltraKm(ultraKm);
  return km === null ? ULTRA_OBJECTIVE : `${ULTRA_OBJECTIVE} de ${String(km).replace('.', ',')} km`;
}
