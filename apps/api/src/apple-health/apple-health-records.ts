// Registros de SAUDE do Apple Saude (HealthKit) — 29/10/2026. Os dados do dia a dia (sono, passos, FC de repouso, HRV, VO2 max, composicao corporal, sinais vitais, mobilidade, ciclo, nutricao...)
// chegam no MESMO formato dos registros do Health Connect e sao normalizados pelo mesmo normalizador (health-connect-health-records.ts); so' o provedor ('apple_health') e o mapa de categorias mudam.
// O que cada tipo exige de autorizacao do aluno fica AQUI, num lugar so': a gravacao so' acontece com a categoria autorizada no momento da gravacao (fail-closed), e a retirada de uma categoria
// apaga o que ela guardou (ver AppleHealthConsentService.scrubHealthData).

export const APPLE_RECORDS_PAYLOAD_SCHEMA = 'apple-health-records-v1';

// kind -> categoria de consentimento. `daily` carrega duas categorias (atividade do dia e FC de repouso): exige uma delas e guarda so' os campos da autorizada.
export const APPLE_RECORD_CATEGORY: Record<string, string> = {
  sleep: 'sleep',
  hrv: 'hrv',
  daily: 'daily_activity',
  daily_energy: 'daily_activity',
  daily_movement: 'daily_activity',
  heart_rate_daily: 'heart_rate',
  cardiac_events: 'heart_rate',
  vo2_max: 'vo2_max',
  body_composition: 'body_composition',
  pulse_ox: 'pulse_ox',
  skin_temperature: 'skin_temperature',
  respiratory_rate: 'respiratory_rate',
  mobility: 'mobility',
  lifestyle_daily: 'lifestyle_load',
  nutrition: 'nutrition',
  hydration: 'nutrition',
  clinical_vitals: 'clinical_vitals',
  menstrual_cycle: 'menstrual_cycle',
};

// Categorias de saude do dia a dia (tudo que NAO e' treino, sensor de treino nem percurso).
export const APPLE_HEALTH_RECORD_CATEGORIES: readonly string[] = [...new Set([...Object.values(APPLE_RECORD_CATEGORY), 'resting_heart_rate'])];

// Tipos de indicador generico (tabela WearableMetricRecord) de cada categoria: o que apagar quando a categoria e' retirada.
export function metricKindsOfCategory(category: string): string[] {
  return Object.entries(APPLE_RECORD_CATEGORY).filter(([kind, c]) => c === category && !['sleep', 'hrv', 'daily'].includes(kind)).map(([kind]) => kind);
}
