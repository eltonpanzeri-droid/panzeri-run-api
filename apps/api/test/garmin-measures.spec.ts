import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeMeasure, GarminCoachController, GarminMeasuresController, GarminMeasuresService, GARMIN_MEASURE_LABELS } from '../src/garmin/garmin-measures.service';

// 08/11/2026 — "O que a Garmin trouxe": resumo somente leitura por tipo (tela da aluna e ficha no painel).
describe('texto curto do ultimo valor', () => {
  it('cada tipo descreve so o que a Garmin mediu (ausente = nao aparece, nunca zero)', () => {
    expect(describeMeasure('vo2_max', { vo2Max: 48, fitnessAge: 32 })).toBe('VO₂ máx 48 · idade fitness 32');
    expect(describeMeasure('vo2_max', { vo2Max: null, vo2MaxCycling: null, fitnessAge: 32 })).toBe('idade fitness 32');
    expect(describeMeasure('body_composition', { weightInGrams: 75450, bodyFatInPercent: 17.1, bodyMassIndex: 23.2 })).toBe('peso 75,5 kg · gordura 17,1% · IMC 23,2');
    expect(describeMeasure('blood_pressure', { systolic: 120, diastolic: 80, pulse: 70 })).toBe('120/80 mmHg · pulso 70');
    expect(describeMeasure('skin_temperature', { avgDeviationCelsius: -1.6 })).toBe('desvio -1,6 °C');
    expect(describeMeasure('nutrition', { dailyNutritionIntake: { kiloCalories: 915 } })).toBe('915 kcal');
    expect(describeMeasure('hydration', { fluidIntakeInML: 473 })).toBe('473 mL');
    expect(describeMeasure('pulse_ox', { timeOffsetSpo2Values: { 0: 94, 60: 96 } })).toBe('SpO₂ médio 95%');
    expect(describeMeasure('respiration', { timeOffsetEpochToBreaths: { 0: 14, 60: 16 } })).toBe('média 15 resp/min');
    expect(describeMeasure('breathing_variations', { variation: ' MINIMAL' })).toBe('variações: minimal');
    expect(describeMeasure('health_snapshot', { summaries: [{ summaryType: 'stress', avgValue: 80 }, { summaryType: 'heart_rate', avgValue: 83 }] })).toBe('FC média 83 bpm');
    expect(describeMeasure('epoch', { steps: 93, durationInSeconds: 900 })).toBe('passos 93 · em 15 min');
    expect(describeMeasure('lifestyle_load', { kind: 'daily_stress_body_battery', averageStressLevel: 30, bodyBatteryChargedValue: 60, bodyBatteryDrainedValue: 55 })).toBe('estresse médio 30 · Body Battery +60 / −55');
  });
  it('sem valor ou tipo desconhecido: nulo, sem quebrar', () => {
    expect(describeMeasure('vo2_max', {})).toBeNull();
    expect(describeMeasure('blood_pressure', { systolic: 120 })).toBeNull();
    expect(describeMeasure('desconhecido', { x: 1 })).toBeNull();
    expect(describeMeasure('pulse_ox', null)).toBeNull();
  });
  it('todo tipo guardado tem rotulo em portugues', () => {
    for (const kind of ['lifestyle_load', 'vo2_max', 'body_composition', 'epoch', 'pulse_ox', 'respiration', 'breathing_variations', 'health_snapshot', 'blood_pressure', 'skin_temperature', 'nutrition', 'hydration']) expect(GARMIN_MEASURE_LABELS[kind]).toBeTruthy();
  });
});

describe('GarminMeasuresService', () => {
  function build(options: { connection?: any } = {}) {
    const prisma: any = {
      providerConnection: { findUnique: jest.fn(async () => (options.connection === undefined ? { disconnectedAt: null, grantedCategories: ['activity', 'sleep'], grantedPurposes: ['watch_delivery'] } : options.connection)) },
      activityLog: { count: jest.fn(async () => 2), findFirst: jest.fn(async () => ({ startedAt: new Date('2026-11-07T10:00:00Z'), sport: 'corrida', distanceMeters: 8000, durationSec: 2700 })) },
      wearableSleepSummary: { count: jest.fn(async () => 3), findFirst: jest.fn(async () => ({ calendarDate: '2026-11-07', startTimeSec: 1_700_000_000, durationSec: 27000, scoreValue: 82 })) },
      wearableHrvSummary: { count: jest.fn(async () => 1), findFirst: jest.fn(async () => ({ calendarDate: '2026-11-07', startTimeSec: 1_700_000_100, lastNightAvg: 44 })) },
      wearableDailySummary: { count: jest.fn(async () => 5), findFirst: jest.fn(async () => ({ calendarDate: '2026-11-07', startTimeSec: 1_700_000_200, steps: 9000, restingHeartRateBpm: 52, activeKilocalories: 400 })) },
      wearableMetricRecord: {
        groupBy: jest.fn(async () => [{ metricKind: 'blood_pressure', _count: { _all: 4 } }, { metricKind: 'hydration', _count: { _all: 9 } }]),
        findMany: jest.fn(async () => [{ metricKind: 'blood_pressure', calendarDate: '2026-11-07', startTimeSec: 1_700_000_300, values: { systolic: 118, diastolic: 76, pulse: 64 } }, { metricKind: 'hydration', calendarDate: '2026-11-07', startTimeSec: 1_700_000_400, values: { fluidIntakeInML: 500 } }]),
      },
    };
    return { service: new GarminMeasuresService(prisma), prisma };
  }

  it('lista todos os tipos: os que chegaram com quantidade, ultima data e valor; os demais com zero', async () => {
    const { service } = build();
    const result = await service.forUser('u1');
    expect(result.connected).toBe(true);
    expect(result.grantedPurposes).toEqual(['watch_delivery']);
    const byId = Object.fromEntries(result.measures.map((m) => [m.id, m]));
    expect(result.measures).toHaveLength(16); // 4 (atividade, sono, HRV, dia) + 12 metricas
    expect(byId.activity).toMatchObject({ count: 2, text: 'corrida · 8 km · 45 min' });
    expect(byId.sleep).toMatchObject({ count: 3, lastCalendarDate: '2026-11-07', text: '7,5 h · pontuação 82' });
    expect(byId.hrv.text).toBe('média da noite 44');
    expect(byId.daily.text).toBe('9000 passos · FC de repouso 52');
    expect(byId.blood_pressure).toMatchObject({ count: 4, text: '118/76 mmHg · pulso 64' });
    expect(byId.hydration).toMatchObject({ count: 9, text: '500 mL' });
    expect(byId.vo2_max).toMatchObject({ count: 0, lastAt: null, text: null });
  });
  it('consulta SEMPRE so o proprio usuario e so o provedor Garmin', async () => {
    const { service, prisma } = build();
    await service.forUser('u9');
    for (const model of ['activityLog', 'wearableSleepSummary', 'wearableHrvSummary', 'wearableDailySummary']) expect(prisma[model].count.mock.calls[0][0].where).toEqual({ userId: 'u9', provider: 'garmin' });
    expect(prisma.wearableMetricRecord.groupBy.mock.calls[0][0].where).toEqual({ userId: 'u9', provider: 'garmin' });
    expect(prisma.providerConnection.findUnique.mock.calls[0][0].where).toEqual({ provider_userId: { provider: 'garmin', userId: 'u9' } });
  });
  it('nunca expoe token, identificador da conta Garmin nem coordenadas', async () => {
    const { service } = build();
    const text = JSON.stringify(await service.forUser('u1'));
    expect(text).not.toMatch(/token|userId|externalAccountId|latitude|longitude/i);
  });
  it('conta desconectada ou nunca conectada: connected=false e tudo zerado, sem erro', async () => {
    const disconnected = await build({ connection: { disconnectedAt: new Date(), grantedCategories: [], grantedPurposes: [] } }).service.forUser('u1');
    expect(disconnected.connected).toBe(false);
    const never = await build({ connection: null }).service.forUser('u1');
    expect(never.connected).toBe(false);
    expect(never.grantedCategories).toEqual([]);
  });
  it('as duas rotas usam o mesmo servico: a da aluna pelo JWT, a do treinador pelo id da aluna', async () => {
    const { service } = build();
    const spy = jest.spyOn(service, 'forUser');
    await new GarminMeasuresController(service).mine({ sub: 'meu-id', email: 'a@b.c', role: 'student' });
    await new GarminCoachController(service).forStudent('aluna-7');
    expect(spy.mock.calls).toEqual([['meu-id'], ['aluna-7']]);
  });
  it('a rota do treinador e restrita a coach/admin e a da aluna exige login (estatico)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'garmin', 'garmin-measures.service.ts'), 'utf8');
    expect(source).toContain("@Roles('coach', 'admin')");
    expect(source).toContain("@Controller('coach/students')");
    expect(source).toMatch(/@UseGuards\(AuthGuard\('jwt'\)\)\s+@Get\('measures'\)/);
  });
  it('as telas estao ligadas: cartao da aluna e ficha do painel', () => {
    const mobile = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'garmin', 'GarminIntegration.tsx'), 'utf8');
    const admin = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8');
    expect(mobile).toContain('/garmin/measures');
    expect(mobile).toContain('<MeasuresCard accessToken={accessToken} apiUrl={apiUrl} />');
    expect(admin).toContain('<GarminMeasures studentId={student.id} accessToken={token} apiUrl={API_URL} />');
  });
});
