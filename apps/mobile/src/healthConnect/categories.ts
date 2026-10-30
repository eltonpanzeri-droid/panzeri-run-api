// Categorias de consentimento do Health Connect x tipos de registro do Android (22/10/2026). Modulo PURO (sem React Native).
// O servidor decide o que a aluna autorizou (grupos -> categorias, ver HEALTH_CONNECT_CONSENT na API); aqui so' se traduz cada categoria nos tipos de registro que o Android precisa liberar.
// O pedido de permissao ao ANDROID inclui APENAS as categorias que a aluna autorizou aqui, e so' tipos que o app declara no manifesto (app.json) e que o formulario de Apps de saude da Play
// Console cobre. Percurso GPS (ExerciseRoute) e temperatura da pele nao tem leitura nesta versao (a biblioteca atual nao oferece temperatura da pele; a rota pede uma permissao especial por
// sessao): a autorizacao ja' e' perguntada, mas nada e' pedido ao Android para elas ate' a leitura existir.

export const HC_CATEGORY_RECORD_TYPES: Readonly<Record<string, readonly string[]>> = {
  activity: ['ExerciseSession', 'Distance', 'Speed', 'ActiveCaloriesBurned'],
  activity_sensors: ['HeartRate', 'Power', 'StepsCadence', 'ElevationGained'],
  activity_route: [],
  sleep: ['SleepSession'],
  daily_activity: ['Steps', 'Distance', 'ActiveCaloriesBurned'],
  resting_heart_rate: ['RestingHeartRate'],
  hrv: ['HeartRateVariabilityRmssd'],
  vo2_max: ['Vo2Max'],
  // Composicao corporal (peso, gordura, massa magra/ossea/de agua) e calorias totais: NAO pedidos ao Android nesta versao (30/10/2026, Play: acesso minimo). O peso do aluno vem da entrevista e da reavaliacao.
  body_composition: [],
  pulse_ox: ['OxygenSaturation'],
  skin_temperature: [],
  respiratory_rate: ['RespiratoryRate'],
  nutrition: ['Nutrition', 'Hydration'],
};

export const HC_HISTORY_PERMISSION = { accessType: 'read' as const, recordType: 'ReadHealthDataHistory' as const };

// Tipos de registro que o Android deve liberar para as categorias autorizadas (sem repeticao).
export function recordTypesFor(categories: Iterable<string>): string[] {
  const out: string[] = [];
  for (const category of categories) for (const type of HC_CATEGORY_RECORD_TYPES[category] ?? []) if (!out.includes(type)) out.push(type);
  return out;
}

export function permissionsFor(categories: Iterable<string>, includeHistory: boolean): Array<{ accessType: 'read'; recordType: string }> {
  const list: Array<{ accessType: 'read'; recordType: string }> = recordTypesFor(categories).map((recordType) => ({ accessType: 'read' as const, recordType }));
  if (includeHistory) list.push({ ...HC_HISTORY_PERMISSION });
  return list;
}
