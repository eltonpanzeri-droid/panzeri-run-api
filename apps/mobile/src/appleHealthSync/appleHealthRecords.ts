// Saude do dia a dia do Apple Saude (29/10/2026): catalogo de tipos HealthKit lidos e montagem dos registros enviados a API (POST /apple-health/health-records). Logica PURA (sem React nem modulo
// nativo), para ser testada. Regras:
//  - o nativo so' le (estatisticas por dia e amostras de categoria); QUEM MONTA os registros e' este arquivo;
//  - nada e' estimado: dia sem amostra nao gera valor, e valor 0 informado pelo HealthKit continua 0 (ausencia != zero);
//  - cada tipo pertence a UM grupo do consentimento (mesmos ids do servidor: apple-health-consent.ts). So' se le e se envia o que o grupo autorizado cobre;
//  - o HealthKit ja' desduplica fontes nas somas do dia (passos do iPhone + Watch); por isso a origem destes registros e' "com.apple.health" (agregado). Sono e amostras de categoria preservam a origem real.

export const APPLE_AGGREGATE_ORIGIN = 'com.apple.health';
export type StatName = 'sum' | 'avg' | 'min' | 'max' | 'latest';
export type StatRow = { identifier: string; day: string; startTime: string; offsetSeconds: number; sum?: number; avg?: number; min?: number; max?: number; latest?: number };
export type CategoryRow = { identifier: string; value: number; startTime: string; endTime: string; offsetSeconds: number; sourceBundleId: string; sourceName: string; deviceName: string | null };
export type HealthRecord = Record<string, unknown>;

export interface QuantitySpec {
  group: string;
  identifier: string;
  // ficha de unidade conhecida pelo nativo (unit(for:) no Swift)
  unit: string;
  // tipo de registro no servidor (APPLE_RECORD_CATEGORY)
  kind: string;
  // o que ler do dia e com que nome guardar: [estatistica, chave]
  outputs: ReadonlyArray<readonly [StatName, string]>;
}

const q = (group: string, kind: string, name: string, unit: string, outputs: ReadonlyArray<readonly [StatName, string]>): QuantitySpec => ({ group, identifier: `HKQuantityTypeIdentifier${name}`, unit, kind, outputs });
const sum = (key: string) => [['sum', key]] as const;
const avg = (key: string) => [['avg', key]] as const;
const latest = (key: string) => [['latest', key]] as const;
const range = (base: string): ReadonlyArray<readonly [StatName, string]> => [['avg', `${base}Avg`], ['min', `${base}Min`], ['max', `${base}Max`]];

// Tipos quantitativos. `daily` e' o registro diario classico (passos, distancia, calorias ativas e FC de repouso nas colunas proprias); `hrv` vira o registro de HRV.
export const QUANTITY_SPECS: readonly QuantitySpec[] = [
  q('daily', 'daily', 'StepCount', 'count', sum('steps')),
  q('daily', 'daily', 'DistanceWalkingRunning', 'm', sum('distanceMeters')),
  q('daily', 'daily', 'ActiveEnergyBurned', 'kcal', sum('activeKilocalories')),
  q('heart', 'daily', 'RestingHeartRate', 'bpm', avg('restingHeartRateBpm')),
  q('daily', 'daily_energy', 'BasalEnergyBurned', 'kcal', sum('basalKilocalories')),
  q('daily', 'daily_movement', 'FlightsClimbed', 'count', sum('flightsClimbed')),
  q('daily', 'daily_movement', 'AppleExerciseTime', 'min', sum('exerciseMinutes')),
  q('daily', 'daily_movement', 'AppleStandTime', 'min', sum('standMinutes')),
  q('daily', 'daily_movement', 'AppleMoveTime', 'min', sum('moveMinutes')),
  q('daily', 'daily_movement', 'DistanceCycling', 'm', sum('cyclingDistanceMeters')),
  q('daily', 'daily_movement', 'DistanceSwimming', 'm', sum('swimmingDistanceMeters')),
  q('daily', 'daily_movement', 'SwimmingStrokeCount', 'count', sum('swimmingStrokes')),
  q('daily', 'daily_movement', 'DistanceWheelchair', 'm', sum('wheelchairDistanceMeters')),
  q('daily', 'daily_movement', 'PushCount', 'count', sum('wheelchairPushes')),
  q('heart', 'heart_rate_daily', 'HeartRate', 'bpm', range('heartRate')),
  q('heart', 'heart_rate_daily', 'WalkingHeartRateAverage', 'bpm', avg('walkingHeartRateAvgBpm')),
  q('heart', 'heart_rate_daily', 'HeartRateRecoveryOneMinute', 'bpm', avg('heartRateRecoveryBpm')),
  q('hrv', 'hrv', 'HeartRateVariabilitySDNN', 'ms', avg('sdnnMs')),
  q('fitness', 'vo2_max', 'VO2Max', 'vo2', avg('vo2MaxMlKgMin')),
  q('body', 'body_composition', 'BodyMass', 'kg', latest('bodyMassKg')),
  q('body', 'body_composition', 'Height', 'm', latest('heightMeters')),
  q('body', 'body_composition', 'BodyMassIndex', 'count', latest('bodyMassIndex')),
  q('body', 'body_composition', 'BodyFatPercentage', 'percent', latest('bodyFatFraction')),
  q('body', 'body_composition', 'LeanBodyMass', 'kg', latest('leanBodyMassKg')),
  q('body', 'body_composition', 'WaistCircumference', 'm', latest('waistCircumferenceMeters')),
  q('vitals', 'pulse_ox', 'OxygenSaturation', 'percent', range('oxygenSaturationFraction')),
  q('vitals', 'skin_temperature', 'AppleSleepingWristTemperature', 'degC', avg('wristTemperatureSleepingC')),
  q('vitals', 'skin_temperature', 'BodyTemperature', 'degC', avg('bodyTemperatureC')),
  q('vitals', 'respiratory_rate', 'RespiratoryRate', 'bpm', range('respiratoryRateBrpm')),
  q('mobility', 'mobility', 'WalkingSpeed', 'mps', avg('walkingSpeedMs')),
  q('mobility', 'mobility', 'WalkingStepLength', 'm', avg('walkingStepLengthMeters')),
  q('mobility', 'mobility', 'WalkingAsymmetryPercentage', 'percent', avg('walkingAsymmetryFraction')),
  q('mobility', 'mobility', 'WalkingDoubleSupportPercentage', 'percent', avg('walkingDoubleSupportFraction')),
  q('mobility', 'mobility', 'StairAscentSpeed', 'mps', avg('stairAscentSpeedMs')),
  q('mobility', 'mobility', 'StairDescentSpeed', 'mps', avg('stairDescentSpeedMs')),
  q('mobility', 'mobility', 'AppleWalkingSteadiness', 'percent', avg('walkingSteadinessFraction')),
  q('mobility', 'mobility', 'SixMinuteWalkTestDistance', 'm', avg('sixMinuteWalkDistanceMeters')),
  q('mobility', 'mobility', 'NumberOfTimesFallen', 'count', sum('timesFallen')),
  q('lifestyle', 'lifestyle_daily', 'TimeInDaylight', 'min', sum('daylightMinutes')),
  q('lifestyle', 'lifestyle_daily', 'EnvironmentalAudioExposure', 'dbaspl', avg('environmentalAudioDbA')),
  q('lifestyle', 'lifestyle_daily', 'HeadphoneAudioExposure', 'dbaspl', avg('headphoneAudioDbA')),
  q('nutrition', 'nutrition', 'DietaryEnergyConsumed', 'kcal', sum('dietaryEnergyKcal')),
  q('nutrition', 'nutrition', 'DietaryProtein', 'g', sum('proteinGrams')),
  q('nutrition', 'nutrition', 'DietaryCarbohydrates', 'g', sum('carbohydratesGrams')),
  q('nutrition', 'nutrition', 'DietaryFatTotal', 'g', sum('fatGrams')),
  q('nutrition', 'nutrition', 'DietaryFiber', 'g', sum('fiberGrams')),
  q('nutrition', 'nutrition', 'DietarySugar', 'g', sum('sugarGrams')),
  q('nutrition', 'nutrition', 'DietarySodium', 'mg', sum('sodiumMg')),
  q('nutrition', 'hydration', 'DietaryWater', 'ml', sum('waterMl')),
  q('nutrition', 'hydration', 'DietaryCaffeine', 'mg', sum('caffeineMg')),
  q('clinical', 'clinical_vitals', 'BloodPressureSystolic', 'mmHg', range('systolicMmHg')),
  q('clinical', 'clinical_vitals', 'BloodPressureDiastolic', 'mmHg', range('diastolicMmHg')),
  q('clinical', 'clinical_vitals', 'BloodGlucose', 'mgdl', range('glucoseMgDl')),
  q('cycle', 'menstrual_cycle', 'BasalBodyTemperature', 'degC', avg('basalBodyTemperatureC')),
];

// Tipos de categoria (amostras com valor inteiro e intervalo).
export const SLEEP_IDENTIFIER = 'HKCategoryTypeIdentifierSleepAnalysis';
export const MINDFUL_IDENTIFIER = 'HKCategoryTypeIdentifierMindfulSession';
export const CYCLE_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['HKCategoryTypeIdentifierMenstrualFlow', 'menstrualFlow'],
  ['HKCategoryTypeIdentifierIntermenstrualBleeding', 'intermenstrualBleeding'],
  ['HKCategoryTypeIdentifierOvulationTestResult', 'ovulationTestResult'],
  ['HKCategoryTypeIdentifierCervicalMucusQuality', 'cervicalMucusQuality'],
];
export const CARDIAC_EVENT_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['HKCategoryTypeIdentifierHighHeartRateEvent', 'highHeartRateEvents'],
  ['HKCategoryTypeIdentifierLowHeartRateEvent', 'lowHeartRateEvents'],
  ['HKCategoryTypeIdentifierIrregularHeartRhythmEvent', 'irregularRhythmEvents'],
  ['HKCategoryTypeIdentifierLowCardioFitnessEvent', 'lowCardioFitnessEvents'],
];

// Grupo (consentimento) de cada tipo de categoria.
export const CATEGORY_GROUPS: Readonly<Record<string, readonly string[]>> = {
  sleep: [SLEEP_IDENTIFIER],
  lifestyle: [MINDFUL_IDENTIFIER],
  cycle: CYCLE_CATEGORIES.map(([id]) => id),
  heart: CARDIAC_EVENT_CATEGORIES.map(([id]) => id),
};

// Grupos de saude do dia a dia (os de treino — workouts, sensors, route — seguem o fluxo proprio de treinos).
export const HEALTH_GROUPS: readonly string[] = ['daily', 'sleep', 'heart', 'hrv', 'fitness', 'body', 'vitals', 'mobility', 'lifestyle', 'nutrition', 'clinical', 'cycle'];

export const specsForGroups = (groups: ReadonlySet<string>) => QUANTITY_SPECS.filter((spec) => groups.has(spec.group));
export const categoryIdsForGroups = (groups: ReadonlySet<string>) => [...new Set(Object.entries(CATEGORY_GROUPS).filter(([group]) => groups.has(group)).flatMap(([, ids]) => ids))];

const ISO = (ms: number) => new Date(ms).toISOString();
const localDay = (startTime: string, offsetSeconds: number) => ISO(new Date(startTime).getTime() + offsetSeconds * 1000).slice(0, 10);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── Estatisticas por dia -> registros ───────────────────────────────────────────────────────────────────────
// Agrupa por (tipo de registro, dia). `daily` e `hrv` sao planos (campos de topo); os demais levam `values`. Registro sem nenhum valor nao e' criado.
export function buildQuantityRecords(rows: readonly StatRow[], groups: ReadonlySet<string>): HealthRecord[] {
  const specById = new Map(specsForGroups(groups).map((spec) => [spec.identifier, spec]));
  const buckets = new Map<string, { kind: string; day: string; startTime: string; offsetSeconds: number; values: Record<string, number> }>();
  for (const row of rows) {
    const spec = specById.get(row.identifier);
    if (!spec || typeof row.day !== 'string') continue;
    for (const [stat, key] of spec.outputs) {
      const value = row[stat];
      if (!finite(value)) continue; // ausencia nunca vira zero
      const bucketKey = `${spec.kind}|${row.day}`;
      const bucket = buckets.get(bucketKey) ?? { kind: spec.kind, day: row.day, startTime: row.startTime, offsetSeconds: row.offsetSeconds, values: {} };
      bucket.values[key] = value;
      buckets.set(bucketKey, bucket);
    }
  }
  const records: HealthRecord[] = [];
  for (const { kind, day, startTime, offsetSeconds, values } of buckets.values()) {
    const base = { calendarDate: day, startTime, startZoneOffsetSeconds: offsetSeconds, dataOrigin: APPLE_AGGREGATE_ORIGIN };
    if (kind === 'daily') {
      records.push({ kind, ...base, ...values });
    } else if (kind === 'hrv') {
      if (finite(values.sdnnMs) && values.sdnnMs > 0) records.push({ kind, ...base, lastNightAvg: values.sdnnMs, hrvMetric: 'sdnn_ms' });
    } else {
      records.push({ kind, recordId: day, ...base, values });
    }
  }
  return records;
}

// ── Sono ────────────────────────────────────────────────────────────────────────────────────────────────────────
// HKCategoryValueSleepAnalysis: 0 na cama, 1 dormindo (sem etapa), 2 acordado, 3 basico, 4 profundo, 5 REM. Mapeia para os codigos de etapa do normalizador (1 acordado, 4 leve, 5 profundo,
// 6 REM) e preserva o valor original do Apple em sourceStage. "Na cama" nao e' sono e nao entra. Varias fontes gravam o mesmo sono (Watch com etapas, iPhone, apps): numa mesma noite fica UMA
// fonte — a que tem etapas; sem etapas, a que tem mais tempo dormindo — para nunca contar a noite duas vezes. Noites sao separadas por intervalo > 2 h entre amostras.
const SLEEP_GAP_MS = 2 * 3600_000;
const STAGE_OF: Record<number, number> = { 2: 1, 3: 4, 4: 5, 5: 6 };
const ASLEEP = new Set([1, 3, 4, 5]);

export function buildSleepRecords(rows: readonly CategoryRow[]): HealthRecord[] {
  const segments = rows
    .filter((row) => row.identifier === SLEEP_IDENTIFIER && (row.value === 1 || row.value in STAGE_OF))
    .map((row) => ({ ...row, startMs: new Date(row.startTime).getTime(), endMs: new Date(row.endTime).getTime() }))
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const clusters: Array<typeof segments> = [];
  let clusterEnd = -Infinity;
  for (const segment of segments) {
    if (clusters.length === 0 || segment.startMs - clusterEnd > SLEEP_GAP_MS) clusters.push([]);
    clusters[clusters.length - 1].push(segment);
    clusterEnd = Math.max(clusterEnd, segment.endMs);
  }
  const records: HealthRecord[] = [];
  for (const cluster of clusters) {
    const bySource = new Map<string, typeof cluster>();
    for (const segment of cluster) bySource.set(segment.sourceBundleId, [...(bySource.get(segment.sourceBundleId) ?? []), segment]);
    const scored = [...bySource.entries()].map(([source, list]) => ({
      source, list,
      staged: list.some((s) => s.value in STAGE_OF && s.value !== 2),
      asleepMs: list.filter((s) => ASLEEP.has(s.value)).reduce((total, s) => total + (s.endMs - s.startMs), 0),
    })).filter((s) => s.asleepMs > 0);
    if (scored.length === 0) continue; // so' "acordado": nao e' uma noite de sono
    scored.sort((a, b) => Number(b.staged) - Number(a.staged) || b.asleepMs - a.asleepMs || (a.source < b.source ? -1 : 1));
    const chosen = scored[0];
    const startMs = Math.min(...chosen.list.map((s) => s.startMs));
    const endMs = Math.max(...chosen.list.map((s) => s.endMs));
    const stages = chosen.staged
      ? chosen.list.filter((s) => s.value in STAGE_OF).map((s) => ({ startTime: s.startTime, endTime: s.endTime, stage: STAGE_OF[s.value], sourceStage: s.value }))
      : []; // sem etapas: a divisao fica nula no servidor (nunca zero inventado)
    records.push({
      kind: 'sleep', recordId: `apple-${Math.floor(startMs / 1000)}`, startTime: ISO(startMs), endTime: ISO(endMs), startZoneOffsetSeconds: chosen.list[0].offsetSeconds,
      dataOrigin: chosen.source, stages,
    });
  }
  return records;
}

// ── Ciclo menstrual, eventos cardiacos e atencao plena (categorias) ─────────────────────────────────────────────
export function buildCategoryRecords(rows: readonly CategoryRow[], groups: ReadonlySet<string>, quantityRows: readonly StatRow[] = []): HealthRecord[] {
  const records: HealthRecord[] = [];
  const dayOf = (row: CategoryRow) => localDay(row.startTime, row.offsetSeconds);

  if (groups.has('cycle')) {
    const days = new Map<string, { startTime: string; offsetSeconds: number; values: Record<string, unknown> }>();
    for (const [identifier, key] of CYCLE_CATEGORIES) {
      for (const row of rows.filter((r) => r.identifier === identifier)) {
        const day = dayOf(row);
        const entry = days.get(day) ?? { startTime: row.startTime, offsetSeconds: row.offsetSeconds, values: {} };
        entry.values[key] = [...((entry.values[key] as number[] | undefined) ?? []), row.value];
        days.set(day, entry);
      }
    }
    // A temperatura basal (quantidade) do mesmo dia entra no mesmo registro do ciclo; o tipo de registro `menstrual_cycle` tambem sai de buildQuantityRecords (temperatura sozinha). Aqui so' se
    // acrescentam os dias que tem amostras de categoria, sem substituir o registro da temperatura: o servidor guarda um por dia (mesma identidade) e o ultimo enviado vence, por isso o ciclo
    // inclui a temperatura basal quando existe.
    for (const [day, entry] of days) {
      const basal = quantityRows.find((r) => r.identifier === 'HKQuantityTypeIdentifierBasalBodyTemperature' && r.day === day);
      if (basal && finite(basal.avg)) entry.values.basalBodyTemperatureC = basal.avg;
      records.push({ kind: 'menstrual_cycle', recordId: day, calendarDate: day, startTime: entry.startTime, startZoneOffsetSeconds: entry.offsetSeconds, dataOrigin: APPLE_AGGREGATE_ORIGIN, values: entry.values });
    }
  }

  if (groups.has('heart')) {
    const days = new Map<string, { startTime: string; offsetSeconds: number; values: Record<string, number> }>();
    for (const [identifier, key] of CARDIAC_EVENT_CATEGORIES) {
      for (const row of rows.filter((r) => r.identifier === identifier)) {
        const day = dayOf(row);
        const entry = days.get(day) ?? { startTime: row.startTime, offsetSeconds: row.offsetSeconds, values: {} };
        entry.values[key] = (entry.values[key] ?? 0) + 1;
        days.set(day, entry);
      }
    }
    for (const [day, entry] of days) records.push({ kind: 'cardiac_events', recordId: day, calendarDate: day, startTime: entry.startTime, startZoneOffsetSeconds: entry.offsetSeconds, dataOrigin: APPLE_AGGREGATE_ORIGIN, values: entry.values });
  }
  return records;
}

// Atencao plena: minutos do dia somados na parte "lifestyle_daily" (mesma identidade do registro de luz do dia/ruido: o servidor guarda um por dia, entao e' fundido ANTES de enviar).
export function mergeMindfulIntoLifestyle(records: HealthRecord[], rows: readonly CategoryRow[]): HealthRecord[] {
  const minutes = new Map<string, { minutes: number; startTime: string; offsetSeconds: number }>();
  for (const row of rows.filter((r) => r.identifier === MINDFUL_IDENTIFIER)) {
    const seconds = (new Date(row.endTime).getTime() - new Date(row.startTime).getTime()) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const day = localDay(row.startTime, row.offsetSeconds);
    const entry = minutes.get(day) ?? { minutes: 0, startTime: row.startTime, offsetSeconds: row.offsetSeconds };
    entry.minutes += seconds / 60;
    minutes.set(day, entry);
  }
  const out = records.map((record) => ({ ...record }));
  for (const [day, entry] of minutes) {
    const existing = out.find((r) => r.kind === 'lifestyle_daily' && r.calendarDate === day);
    const value = Math.round(entry.minutes * 10) / 10;
    if (existing) existing.values = { ...(existing.values as Record<string, unknown>), mindfulMinutes: value };
    else out.push({ kind: 'lifestyle_daily', recordId: day, calendarDate: day, startTime: entry.startTime, startZoneOffsetSeconds: entry.offsetSeconds, dataOrigin: APPLE_AGGREGATE_ORIGIN, values: { mindfulMinutes: value } });
  }
  return out;
}

// O ciclo (categorias) e a temperatura basal (quantidade) compartilham a identidade `menstrual_cycle:<dia>`: mantem UM registro por dia, preferindo o que tem as amostras de categoria.
export function dedupeCycleRecords(records: HealthRecord[]): HealthRecord[] {
  const byDay = new Map<string, HealthRecord>();
  const rest: HealthRecord[] = [];
  for (const record of records) {
    if (record.kind !== 'menstrual_cycle') { rest.push(record); continue; }
    const day = String(record.calendarDate);
    const current = byDay.get(day);
    const hasCategories = (r: HealthRecord) => Object.keys(r.values as Record<string, unknown>).some((k) => k !== 'basalBodyTemperatureC');
    if (!current || (hasCategories(record) && !hasCategories(current))) byDay.set(day, record);
  }
  return [...rest, ...byDay.values()];
}

// Tudo de uma janela de datas: estatisticas + categorias -> registros prontos.
// `fromDay`/`toDay` (yyyy-MM-dd, fim exclusivo) delimitam os dias da janela: as amostras de categoria sao lidas com 1 dia de folga de cada lado (para noites de sono inteiras), mas ciclo, eventos
// cardiacos e atencao plena so' geram registro para dias DA janela — o dia vizinho e' completado pela janela vizinha, e um registro parcial dele sobrescreveria o completo (mesma identidade).
export function buildWindowRecords(input: { stats: readonly StatRow[]; categories: readonly CategoryRow[]; groups: ReadonlySet<string>; fromDay: string; toDay: string }): HealthRecord[] {
  const { stats, groups, fromDay, toDay } = input;
  const inWindow = (row: CategoryRow) => { const day = localDay(row.startTime, row.offsetSeconds); return day >= fromDay && day < toDay; };
  const categories = input.categories.filter((row) => row.identifier === SLEEP_IDENTIFIER || inWindow(row));
  let records = buildQuantityRecords(stats, groups);
  if (groups.has('sleep')) records.push(...buildSleepRecords(categories));
  records.push(...buildCategoryRecords(categories, groups, stats));
  if (groups.has('lifestyle')) records = mergeMindfulIntoLifestyle(records, categories);
  return dedupeCycleRecords(records);
}
