// Indicadores de saude/recuperacao/comportamento medidos por aparelho, organizados para a IA (29/10/2026). Modulo PURO (sem banco): catalogo de rotulos/unidades e montagem do resumo seletivo.
//
// Por que existe: antes so 5 variaveis diarias (sono, HRV, FC de repouso, passos, kcal ativa) chegavam a IA. Os demais indicadores autorizados (VO2 max, composicao corporal, SpO2, temperatura,
// respiracao, mobilidade, FC do dia, habitos, nutricao...) ficavam guardados e sem acesso. Aqui eles viram um resumo SELETIVO e CONTEXTUALIZADO: so' o que existe para ESTE aluno nos ultimos dias,
// so' o que ele autorizou (categoria), por fonte, com unidade e origem originais. Nao e' um escore de prontidao, nao interpreta causa e nao envia o historico bruto: serie completa fica disponivel
// por consulta (HealthIndicatorsService.query) para quem precisar de um periodo ou indicador especifico.
//
// Fora da IA por decisao de produto: pressao arterial, glicemia (clinical_vitals) e ciclo menstrual (menstrual_cycle) nao tem categoria de IA — nunca entram aqui. Percurso GPS tambem nao.

export interface IndicatorDef { kind: string; key: string; label: string; unit: string }

// [tipo de registro, chave guardada em values, rotulo, unidade ORIGINAL]. O Apple Saude fornece estas chaves; o Health Connect e outras fontes entram pelo caminho generico (chave e valores originais).
export const INDICATOR_CATALOG: readonly IndicatorDef[] = [
  { kind: 'daily_energy', key: 'basalKilocalories', label: 'Energia basal do dia', unit: 'kcal' },
  { kind: 'daily_movement', key: 'flightsClimbed', label: 'Lances de escada subidos', unit: 'lances' },
  { kind: 'daily_movement', key: 'exerciseMinutes', label: 'Minutos de exercício no dia', unit: 'min' },
  { kind: 'daily_movement', key: 'standMinutes', label: 'Minutos em pé no dia', unit: 'min' },
  { kind: 'daily_movement', key: 'moveMinutes', label: 'Minutos de movimento no dia', unit: 'min' },
  { kind: 'daily_movement', key: 'cyclingDistanceMeters', label: 'Distância de bicicleta no dia', unit: 'm' },
  { kind: 'daily_movement', key: 'swimmingDistanceMeters', label: 'Distância de natação no dia', unit: 'm' },
  { kind: 'daily_movement', key: 'swimmingStrokes', label: 'Braçadas de natação no dia', unit: 'braçadas' },
  { kind: 'daily_movement', key: 'wheelchairDistanceMeters', label: 'Distância em cadeira de rodas no dia', unit: 'm' },
  { kind: 'daily_movement', key: 'wheelchairPushes', label: 'Impulsos de cadeira de rodas no dia', unit: 'impulsos' },
  { kind: 'heart_rate_daily', key: 'heartRateAvg', label: 'Frequência cardíaca média do dia', unit: 'bpm' },
  { kind: 'heart_rate_daily', key: 'heartRateMin', label: 'Frequência cardíaca mínima do dia', unit: 'bpm' },
  { kind: 'heart_rate_daily', key: 'heartRateMax', label: 'Frequência cardíaca máxima do dia', unit: 'bpm' },
  { kind: 'heart_rate_daily', key: 'walkingHeartRateAvgBpm', label: 'Frequência cardíaca média ao caminhar', unit: 'bpm' },
  { kind: 'heart_rate_daily', key: 'heartRateRecoveryBpm', label: 'Recuperação da frequência cardíaca em 1 minuto após o exercício', unit: 'bpm' },
  { kind: 'cardiac_events', key: 'highHeartRateEvents', label: 'Avisos de frequência cardíaca alta no dia', unit: 'avisos' },
  { kind: 'cardiac_events', key: 'lowHeartRateEvents', label: 'Avisos de frequência cardíaca baixa no dia', unit: 'avisos' },
  { kind: 'cardiac_events', key: 'irregularRhythmEvents', label: 'Avisos de ritmo irregular no dia', unit: 'avisos' },
  { kind: 'cardiac_events', key: 'lowCardioFitnessEvents', label: 'Avisos de baixa aptidão cardiorrespiratória', unit: 'avisos' },
  { kind: 'vo2_max', key: 'vo2MaxMlKgMin', label: 'VO₂ máximo estimado', unit: 'mL/(kg·min)' },
  { kind: 'body_composition', key: 'bodyMassKg', label: 'Peso corporal', unit: 'kg' },
  { kind: 'body_composition', key: 'heightMeters', label: 'Altura', unit: 'm' },
  { kind: 'body_composition', key: 'bodyMassIndex', label: 'Índice de massa corporal', unit: 'kg/m²' },
  { kind: 'body_composition', key: 'bodyFatFraction', label: 'Gordura corporal (fração de 0 a 1)', unit: 'fração' },
  { kind: 'body_composition', key: 'leanBodyMassKg', label: 'Massa magra', unit: 'kg' },
  { kind: 'body_composition', key: 'waistCircumferenceMeters', label: 'Circunferência da cintura', unit: 'm' },
  { kind: 'pulse_ox', key: 'oxygenSaturationFractionAvg', label: 'Saturação de oxigênio média (fração de 0 a 1)', unit: 'fração' },
  { kind: 'pulse_ox', key: 'oxygenSaturationFractionMin', label: 'Saturação de oxigênio mínima (fração de 0 a 1)', unit: 'fração' },
  { kind: 'skin_temperature', key: 'wristTemperatureSleepingC', label: 'Temperatura do pulso durante o sono', unit: '°C' },
  { kind: 'skin_temperature', key: 'bodyTemperatureC', label: 'Temperatura corporal', unit: '°C' },
  { kind: 'respiratory_rate', key: 'respiratoryRateBrpmAvg', label: 'Frequência respiratória média', unit: 'resp/min' },
  { kind: 'respiratory_rate', key: 'respiratoryRateBrpmMin', label: 'Frequência respiratória mínima', unit: 'resp/min' },
  { kind: 'respiratory_rate', key: 'respiratoryRateBrpmMax', label: 'Frequência respiratória máxima', unit: 'resp/min' },
  { kind: 'mobility', key: 'walkingSpeedMs', label: 'Velocidade ao caminhar', unit: 'm/s' },
  { kind: 'mobility', key: 'walkingStepLengthMeters', label: 'Comprimento do passo ao caminhar', unit: 'm' },
  { kind: 'mobility', key: 'walkingAsymmetryFraction', label: 'Assimetria ao caminhar (fração de 0 a 1)', unit: 'fração' },
  { kind: 'mobility', key: 'walkingDoubleSupportFraction', label: 'Apoio duplo ao caminhar (fração de 0 a 1)', unit: 'fração' },
  { kind: 'mobility', key: 'stairAscentSpeedMs', label: 'Velocidade ao subir escadas', unit: 'm/s' },
  { kind: 'mobility', key: 'stairDescentSpeedMs', label: 'Velocidade ao descer escadas', unit: 'm/s' },
  { kind: 'mobility', key: 'walkingSteadinessFraction', label: 'Estabilidade ao caminhar (fração de 0 a 1)', unit: 'fração' },
  { kind: 'mobility', key: 'sixMinuteWalkDistanceMeters', label: 'Distância no teste de caminhada de 6 minutos', unit: 'm' },
  { kind: 'mobility', key: 'timesFallen', label: 'Quedas registradas no dia', unit: 'quedas' },
  { kind: 'lifestyle_daily', key: 'daylightMinutes', label: 'Tempo à luz do dia', unit: 'min' },
  { kind: 'lifestyle_daily', key: 'mindfulMinutes', label: 'Minutos de atenção plena', unit: 'min' },
  { kind: 'lifestyle_daily', key: 'environmentalAudioDbA', label: 'Exposição a ruído do ambiente (média)', unit: 'dB(A)' },
  { kind: 'lifestyle_daily', key: 'headphoneAudioDbA', label: 'Exposição a ruído de fones (média)', unit: 'dB(A)' },
  { kind: 'nutrition', key: 'dietaryEnergyKcal', label: 'Energia consumida no dia', unit: 'kcal' },
  { kind: 'nutrition', key: 'proteinGrams', label: 'Proteínas consumidas no dia', unit: 'g' },
  { kind: 'nutrition', key: 'carbohydratesGrams', label: 'Carboidratos consumidos no dia', unit: 'g' },
  { kind: 'nutrition', key: 'fatGrams', label: 'Gorduras consumidas no dia', unit: 'g' },
  { kind: 'nutrition', key: 'fiberGrams', label: 'Fibras consumidas no dia', unit: 'g' },
  { kind: 'nutrition', key: 'sugarGrams', label: 'Açúcares consumidos no dia', unit: 'g' },
  { kind: 'nutrition', key: 'sodiumMg', label: 'Sódio consumido no dia', unit: 'mg' },
  { kind: 'hydration', key: 'waterMl', label: 'Água consumida no dia', unit: 'mL' },
  { kind: 'hydration', key: 'caffeineMg', label: 'Cafeína consumida no dia', unit: 'mg' },
];

// Tipo de registro -> categoria de consentimento/IA. Tipos sem categoria de IA (pressao, glicemia, ciclo) NAO estao aqui de proposito.
export const AI_INDICATOR_CATEGORY: Readonly<Record<string, string>> = {
  daily_energy: 'daily_activity', daily_movement: 'daily_activity', heart_rate_daily: 'heart_rate', cardiac_events: 'heart_rate', vo2_max: 'vo2_max', body_composition: 'body_composition',
  pulse_ox: 'pulse_ox', skin_temperature: 'skin_temperature', respiratory_rate: 'respiratory_rate', mobility: 'mobility', lifestyle_daily: 'lifestyle_load', nutrition: 'nutrition', hydration: 'nutrition',
};
const CATALOG = new Map(INDICATOR_CATALOG.map((d) => [`${d.kind}.${d.key}`, d]));

export interface MetricRow { provider: string; providerSummaryId: string | null; metricKind: string; calendarDate: string | null; startTimeSec: number; values: unknown }
export interface IndicatorPoint { date: string; value: number }
export interface IndicatorSeries {
  id: string; rotulo: string; unidade: string; categoria: string; fonte: string; origem: string | null;
  dias: number; ultimaData: string; ultimo: number; media: number; minimo: number; maximo: number; ultimosValores: IndicatorPoint[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;
export function sourceKeyForMetric(provider: string, providerSummaryId: string | null): string {
  if (provider !== 'health_connect') return provider;
  const origin = (providerSummaryId ?? '').split('|')[0].trim();
  return `health_connect:${origin || 'origem_desconhecida'}`;
}

// Series por indicador e por FONTE (nunca mistura Apple com Health Connect: metodos de medicao diferentes). `allowed` decide por (provedor, categoria) se a IA pode ver; o que nao pode e' tratado como inexistente.
export function buildIndicatorSeries(rows: readonly MetricRow[], allowed: (provider: string, category: string) => boolean, options: { lastValues?: number; maxSeries?: number } = {}): IndicatorSeries[] {
  const lastValues = options.lastValues ?? 7;
  const buckets = new Map<string, { def: { label: string; unit: string }; category: string; id: string; source: string; origin: string | null; byDate: Map<string, number> }>();
  for (const row of rows) {
    const category = AI_INDICATOR_CATEGORY[row.metricKind];
    if (!category || !allowed(row.provider, category)) continue;
    const values = row.values && typeof row.values === 'object' && !Array.isArray(row.values) ? (row.values as Record<string, unknown>) : null;
    if (!values) continue;
    const date = row.calendarDate ?? new Date(row.startTimeSec * 1000).toISOString().slice(0, 10);
    const origin = values._origin && typeof values._origin === 'object' ? String((values._origin as { dataOrigin?: unknown }).dataOrigin ?? '') || null : null;
    for (const [key, raw] of Object.entries(values)) {
      if (key.startsWith('_') || typeof raw !== 'number' || !Number.isFinite(raw)) continue; // ausencia nunca vira zero; zero informado e' valor
      const known = CATALOG.get(`${row.metricKind}.${key}`);
      const source = sourceKeyForMetric(row.provider, row.providerSummaryId);
      const id = `${row.metricKind}.${key}`;
      const bucketKey = `${id}|${source}`;
      const bucket = buckets.get(bucketKey) ?? { def: known ?? { label: `${row.metricKind} / ${key}`, unit: 'unidade original da origem' }, category, id, source, origin, byDate: new Map() };
      bucket.byDate.set(date, raw);
      buckets.set(bucketKey, bucket);
    }
  }
  const series: IndicatorSeries[] = [];
  for (const b of buckets.values()) {
    const points = [...b.byDate.entries()].sort(([a], [c]) => (a < c ? -1 : 1)).map(([date, value]) => ({ date, value: round(value) }));
    if (points.length === 0) continue;
    const nums = points.map((p) => p.value);
    series.push({
      id: b.id, rotulo: b.def.label, unidade: b.def.unit, categoria: b.category, fonte: b.source, origem: b.origin, dias: points.length, ultimaData: points[points.length - 1].date,
      ultimo: points[points.length - 1].value, media: round(nums.reduce((s, n) => s + n, 0) / nums.length), minimo: Math.min(...nums), maximo: Math.max(...nums), ultimosValores: points.slice(-lastValues),
    });
  }
  series.sort((a, b) => (a.categoria < b.categoria ? -1 : a.categoria > b.categoria ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return series.slice(0, options.maxSeries ?? 80);
}

export const INDICATORS_NOTE =
  'Indicadores medidos por aparelho e AUTORIZADOS pelo aluno, dos ultimos dias, por fonte (fontes diferentes nao sao comparaveis). Valores e unidades originais; so existe indicador com dado real (ausente nao e zero). Sao descritivos: nao ha nota de prontidao, e correlacao entre um indicador e um treino nao prova causa. A HRV do Apple Saude (SDNN) e a de outras fontes (RMSSD) NAO sao a mesma medida.';
