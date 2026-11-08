import { parseGarminHealthPush, requiredCategoryOf } from '../src/garmin/garmin-health';
import { GarminHealthEventService } from '../src/garmin/garmin-health-events.service';
import { GarminController } from '../src/garmin/garmin.controller';
import { GARMIN_CONSENT } from '../src/garmin/garmin-consent';

// 08/11/2026 — Garmin, lote 5: TODOS os demais tipos de saude do portal (epochs, pulseox, allDayRespiration, healthSnapshot, bloodPressures, skinTemp, nutrition, hydration, breathingVariations),
// guardados como a Garmin enviou, uma autorizacao por tipo, mais o aviso de mudanca de permissoes. Formatos conferidos em "Health_API_2.1.pdf".
const U = 'garmin-user-1';
const START = 1_700_000_000;
const kinds = (body: unknown) => parseGarminHealthPush(body).records.map((r) => `${r.metricKind}:${requiredCategoryOf(r)}`);

describe('demais tipos de saude da Garmin', () => {
  it('cada tipo vira a metrica certa e exige a categoria certa (uma autorizacao por tipo)', () => {
    const body = {
      epochs: [{ userId: U, summaryId: 'e1', startTimeInSeconds: START, durationInSeconds: 900, activityType: 'WALKING', steps: 93, distanceInMeters: 49.1, activeKilocalories: 24, activeTimeInSeconds: 449, met: 3.3, intensity: 'ACTIVE' }],
      pulseox: [{ userId: U, summaryId: 'p1', calendarDate: '2026-11-07', startTimeInSeconds: START, durationInSeconds: 86400, timeOffsetSpo2Values: { 7140: 94 }, onDemand: false }],
      allDayRespiration: [{ userId: U, summaryId: 'r1', startTimeInSeconds: START, durationInSeconds: 900, timeOffsetEpochToBreaths: { 0: 14.6 } }],
      healthSnapshot: [{ userId: U, summaryId: 'h1', calendarDate: '2026-11-07', startTimeInSeconds: START, durationInSeconds: 120, summaries: [{ summaryType: 'heart_rate', minValue: 78, maxValue: 87, avgValue: 83 }] }],
      bloodPressures: [{ userId: U, summaryId: 'b1', systolic: 120, diastolic: 80, pulse: 70, sourceType: 'MANUAL', measurementTimeInSeconds: START, measurementTimeOffsetInSeconds: -10800 }],
      skinTemp: [{ userId: U, summaryId: 'k1', calendarDate: '2026-11-07', avgDeviationCelsius: -1.6, durationInSeconds: 1980, startTimeInSeconds: START }],
      nutrition: [{ userId: U, summaryId: 'n1', calendarDate: '2026-11-07', dailyNutritionIntake: { kiloCalories: 915, carbsInGrams: 40 }, loggedFoods: [{ mealConsumedTimeInLocal: '07:00:00', nutritionContentIntake: { kiloCalories: 173 } }] }],
      hydration: [{ userId: U, summaryId: 'y1', calendarDate: '2026-11-07', fluidIntakeInML: 473 }],
      breathingVariations: [{ userId: U, summaryId: 'v1', calendarDate: '2026-11-07', variation: 'MINIMAL', timeOffsetInSeconds: -10800, readings: [{ variation: 'FEW', startTimeInSeconds: START, endTimeInSeconds: START + 300 }] }],
    };
    expect(kinds(body)).toEqual([
      'epoch:daily_activity', 'pulse_ox:pulse_ox', 'respiration:respiratory_rate', 'health_snapshot:heart_rate', 'blood_pressure:clinical_vitals', 'skin_temperature:skin_temperature', 'nutrition:nutrition', 'hydration:nutrition', 'breathing_variations:respiratory_rate',
    ]);
  });

  it('guarda os campos como a Garmin enviou (sem inventar), sem identificadores, links de download e coordenadas', () => {
    const { records } = parseGarminHealthPush({ pulseox: [{ userId: U, summaryId: 'p1', calendarDate: '2026-11-07', startTimeInSeconds: START, durationInSeconds: 86400, startTimeOffsetInSeconds: -10800, timeOffsetSpo2Values: { '7140': 94, '10740': 98 }, onDemand: false, latitudeInDegree: -19.9, callbackURL: 'https://apis.garmin.com/x?token=SEGREDO' }] });
    expect(records[0].fields).toEqual({ kind: 'pulse_ox', calendarDate: '2026-11-07', startTimeInSeconds: START, durationInSeconds: 86400, startTimeOffsetInSeconds: -10800, timeOffsetSpo2Values: { '7140': 94, '10740': 98 }, onDemand: false });
    // o campo userId do REGISTRO (conta Garmin) serve so' para a fila; o que vai ao banco (fields) nao leva identificador, link nem coordenada
    expect(JSON.stringify(records[0].fields)).not.toMatch(/userId|callbackURL|SEGREDO|latitude|-19\.9/);
    expect(records[0]).toMatchObject({ identityKey: 'pox:p1', startTimeSec: START, startOffsetSec: -10800 });
  });

  it('nutricao e hidratacao (sem horario) usam o meio-dia UTC do dia como ancora e a identidade por dia: a atualizacao do dia substitui', () => {
    const { records } = parseGarminHealthPush({ nutrition: [{ userId: U, summaryId: 'n1', calendarDate: '2026-11-07', dailyNutritionIntake: { kiloCalories: 900 } }], hydration: [{ userId: U, summaryId: 'y1', calendarDate: '2026-11-07', fluidIntakeInML: 500 }] });
    const noon = Math.floor(Date.parse('2026-11-07T12:00:00Z') / 1000);
    expect(records.map((r) => [r.metricKind, r.identityKey, r.startTimeSec])).toEqual([['nutrition', 'nutri:2026-11-07', noon], ['hydration', 'hydra:2026-11-07', noon]]);
    expect(records[1].fields).toMatchObject({ fluidIntakeInML: 500 });
  });

  it('epocas: uma linha por inicio e tipo de atividade (a atualizacao do mesmo trecho substitui)', () => {
    const { records } = parseGarminHealthPush({ epochs: [{ userId: U, summaryId: 'a', startTimeInSeconds: START, activityType: 'WALKING', steps: 1 }, { userId: U, summaryId: 'b', startTimeInSeconds: START, activityType: 'SEDENTARY', steps: 0 }] });
    expect(records.map((r) => r.identityKey)).toEqual([`epoch:${START}:WALKING`, `epoch:${START}:SEDENTARY`]);
  });

  it('limita o tamanho: lista longa, texto longo e profundidade', () => {
    const big = { userId: U, summaryId: 's1', calendarDate: '2026-11-07', startTimeInSeconds: START, summaries: Array.from({ length: 900 }, (_, i) => ({ n: i })), note: 'x'.repeat(5000), deep: { a: { b: { c: { d: { e: 1 } } } } } };
    const { records } = parseGarminHealthPush({ healthSnapshot: [big] });
    const f = records[0].fields as Record<string, any>;
    expect(f.summaries).toHaveLength(500);
    expect(f.note).toHaveLength(200);
    expect(JSON.stringify(f.deep)).not.toContain('"e"');
  });

  it('sem horario nem dia nao ha como identificar: ignora; lixo nao quebra', () => {
    const result = parseGarminHealthPush({ bloodPressures: [{ userId: U, summaryId: 'b', systolic: 1 }], hydration: [{ userId: U, fluidIntakeInML: 1 }], skinTemp: [null, 3] });
    expect(result.records).toEqual([]);
    expect(result.ignored).toBe(4);
  });
});

describe('gravacao e autorizacao dos tipos novos', () => {
  it('sem clinical_vitals a pressao arterial NAO e guardada; com ela, vai para o receptor generico', async () => {
    const writes: any[] = [];
    const tx: any = { wearableMetricRecord: { upsert: jest.fn(async (a: any) => { writes.push(a); }) } };
    const build = (categories: string[]) => new GarminHealthEventService({ snapshot: jest.fn(async () => ({ categories, collectFrom: null })), writeWhileAuthorized: jest.fn(async (_p: string, _u: string, fn: any) => fn(tx, { categories })) } as any);
    const bp = parseGarminHealthPush({ bloodPressures: [{ userId: U, summaryId: 'b1', systolic: 120, diastolic: 80, pulse: 70, measurementTimeInSeconds: Math.floor(Date.now() / 1000) - 600, measurementTimeOffsetInSeconds: 0 }] }).records[0];
    const event = { id: 'e', provider: 'garmin', eventType: 'metric_summary', userId: 'u1', externalAccountId: U, attempt: 1, payload: bp } as any;
    expect((await build(['pulse_ox']).handle(event)).status).toBe('discard');
    expect(writes).toHaveLength(0);
    expect(await build(['clinical_vitals']).handle(event)).toEqual({ status: 'done' });
    expect(writes[0].create).toMatchObject({ provider: 'garmin', metricKind: 'blood_pressure', identityKey: 'bp:b1', values: { kind: 'blood_pressure', systolic: 120, diastolic: 80, pulse: 70 } });
  });

  it('o texto de autorizacao tem um grupo para cada tipo novo; pressao arterial e dado sensivel e diz isso', () => {
    const groups = Object.fromEntries(GARMIN_CONSENT.groups.map((g) => [g.id, g]));
    for (const id of ['oxygen', 'respiration', 'skin_temp', 'snapshot', 'blood_pressure', 'nutrition']) expect(groups[id]).toBeDefined();
    expect(groups.blood_pressure.description).toContain('sensível');
    expect(groups.blood_pressure.categories).toEqual(['clinical_vitals']);
    const all = new Set<string>(GARMIN_CONSENT.groups.flatMap((g) => g.categories));
    const sample = parseGarminHealthPush({ pulseox: [{ userId: U, summaryId: 'p', startTimeInSeconds: START }], skinTemp: [{ userId: U, summaryId: 'k', startTimeInSeconds: START }], hydration: [{ userId: U, summaryId: 'y', calendarDate: '2026-11-07' }], breathingVariations: [{ userId: U, summaryId: 'v', calendarDate: '2026-11-07' }], healthSnapshot: [{ userId: U, summaryId: 'h', startTimeInSeconds: START }] });
    for (const record of sample.records) expect(all.has(requiredCategoryOf(record) as string)).toBe(true);
  });
});

describe('mudanca de permissoes pelo lado da Garmin', () => {
  const KEY = 'k'.repeat(40);
  function build() {
    const recordEvent = jest.fn(async () => undefined);
    const connections: any = { recordEvent };
    const consent: any = { resolveActiveUserId: jest.fn(async (_p: string, id: string) => (id === 'garmin-user-1' ? 'u1' : null)) };
    return { ctrl: new GarminController(connections, { get: (n: string) => (n === 'GARMIN_WEBHOOK_KEY' ? KEY : undefined) } as any, consent, {} as any, {} as any), recordEvent };
  }
  const body = { userPermissionsChange: [{ userId: 'garmin-user-1', permissions: ['ACTIVITY_EXPORT', 'minuscula', 'X'.repeat(50)] }, { userId: 'desconhecido', permissions: [] }, { userId: 'com espaco' }] };

  it('chave errada = 404 e nada e registrado', async () => {
    const { ctrl, recordEvent } = build();
    await expect(ctrl.permissionsChange('errada', body)).rejects.toThrow();
    expect(recordEvent).not.toHaveBeenCalled();
  });
  it('registra o evento so de contas conectadas, com as permissoes validas, e nunca mexe na autorizacao da aluna', async () => {
    const { ctrl, recordEvent } = build();
    expect(await ctrl.permissionsChange(KEY, body)).toEqual({ ok: true, recorded: 1 });
    expect(recordEvent).toHaveBeenCalledWith('garmin', 'u1', 'garmin_permissions_changed', { permissions: ['ACTIVITY_EXPORT'] });
  });
});
