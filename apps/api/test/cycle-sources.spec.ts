import { cyclesFromAppleRows, cyclesFromGarminRows, isExternalCycleId, mergeCycleLogs } from '../src/menstrual-cycle/cycle-sources';
import { MenstrualCycleService } from '../src/menstrual-cycle/menstrual-cycle.service';
import { parseGarminHealthPush, requiredCategoryOf } from '../src/garmin/garmin-health';
import { GARMIN_CONSENT } from '../src/garmin/garmin-consent';

// 19/11/2026 (Elton): juntar manual + Apple Saude + Garmin, sempre dentro das permissoes da aluna; Garmin Women's Health (agenda do ciclo).
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const apple = (date: string, flow: number[]) => ({ calendarDate: date, startTimeSec: Math.floor(d(date).getTime() / 1000), values: { menstrualFlow: flow } });

describe('ciclos a partir do Apple Saude', () => {
  it('dias de sangramento viram um ciclo (inicio e fim); fluxo "nenhum" nao conta; falha de 1-3 dias continua o mesmo sangramento', () => {
    const cycles = cyclesFromAppleRows([apple('2026-10-01', [3]), apple('2026-10-02', [4]), apple('2026-10-03', [5]), apple('2026-10-05', [2]), apple('2026-10-29', [2]), apple('2026-10-30', [3])]);
    expect(cycles).toHaveLength(2);
    expect([cycles[0].cycleStartDate, cycles[0].cycleEndDate]).toEqual([d('2026-10-01'), d('2026-10-05')]);
    expect(cycles[1].cycleStartDate).toEqual(d('2026-10-29'));
    expect(cycles[0].id).toBe('ext:apple_health:2026-10-01');
    expect(isExternalCycleId(cycles[0].id)).toBe(true);
  });
  it('sem registro de sangramento ou valor estranho: nenhum ciclo', () => {
    expect(cyclesFromAppleRows([apple('2026-10-01', [5]), { calendarDate: '2026-10-02', startTimeSec: 0, values: 'x' }, { calendarDate: '2026-10-03', startTimeSec: 0, values: {} }])).toEqual([]);
  });
});

describe('ciclos a partir da Garmin', () => {
  const row = (values: Record<string, unknown>) => ({ values });
  it('so ciclos reais; previsto nao conta; fim so quando a aluna informou a duracao', () => {
    const cycles = cyclesFromGarminRows([
      row({ periodStartDate: '2026-10-01', periodLength: 5, hasSpecifiedPeriodLength: true, isPredictedCycle: false }),
      row({ periodStartDate: '2026-10-29', periodLength: 5, hasSpecifiedPeriodLength: false, isPredictedCycle: false }),
      row({ periodStartDate: '2026-11-26', isPredictedCycle: true }),
    ]);
    expect(cycles.map((c) => [c.id, c.cycleEndDate])).toEqual([['ext:garmin:2026-10-01', d('2026-10-05')], ['ext:garmin:2026-10-29', null]]);
  });
});

describe('juncao das fontes', () => {
  it('manual sempre fica; externo a ate 3 dias de um inicio existente e o mesmo ciclo; Garmin vence Apple', () => {
    const manual = [{ cycleStartDate: d('2026-10-01'), tag: 'manual' }];
    const merged = mergeCycleLogs(manual, [
      ...cyclesFromGarminRows([{ values: { periodStartDate: '2026-10-02', isPredictedCycle: false } }, { values: { periodStartDate: '2026-10-30', isPredictedCycle: false } }]),
      ...cyclesFromAppleRows([apple('2026-10-31', [3]), apple('2026-11-27', [3])]),
    ]);
    expect(merged.map((log) => log.cycleStartDate.toISOString().slice(0, 10))).toEqual(['2026-10-01', '2026-10-30', '2026-11-27']);
    expect((merged[0] as { tag?: string }).tag).toBe('manual');
    expect((merged[1] as { id: string }).id).toBe('ext:garmin:2026-10-30');
  });
});

function serviceWith(options: { connections: Array<{ provider: string; disconnectedAt: Date | null; grantedCategories: string[] }>; metrics: Array<Record<string, unknown>>; manual?: Array<Record<string, unknown>> }) {
  const prisma = {
    menstrualCycleLog: { findMany: jest.fn().mockResolvedValue(options.manual ?? []) },
    wearableMetricRecord: { findMany: jest.fn().mockResolvedValue(options.metrics) },
    providerConnection: { findMany: jest.fn().mockResolvedValue(options.connections) },
  };
  return new MenstrualCycleService(prisma as never, {} as never, {} as never);
}
const garminRows = [{ provider: 'garmin', calendarDate: '2026-10-01', startTimeSec: 0, values: { periodStartDate: '2026-10-01', isPredictedCycle: false } }];

describe('permissao lida agora', () => {
  it('conectada e com o grupo do ciclo marcado: entra; sem o grupo ou desconectada: nao entra', async () => {
    const on = serviceWith({ connections: [{ provider: 'garmin', disconnectedAt: null, grantedCategories: ['menstrual_cycle'] }], metrics: garminRows });
    expect(await on.loadCycleLogs('u1')).toHaveLength(1);
    const noGroup = serviceWith({ connections: [{ provider: 'garmin', disconnectedAt: null, grantedCategories: ['activity'] }], metrics: garminRows });
    expect(await noGroup.loadCycleLogs('u1')).toHaveLength(0);
    const off = serviceWith({ connections: [{ provider: 'garmin', disconnectedAt: new Date(), grantedCategories: ['menstrual_cycle'] }], metrics: garminRows });
    expect(await off.loadCycleLogs('u1')).toHaveLength(0);
  });
  it('para a IA sem o aceite do ciclo manual, o registro manual nao entra, mas a fonte autorizada sim', async () => {
    const service = serviceWith({ connections: [{ provider: 'garmin', disconnectedAt: null, grantedCategories: ['menstrual_cycle'] }], metrics: garminRows, manual: [{ id: 'm1', cycleStartDate: d('2026-09-03'), cycleEndDate: null }] });
    expect((await service.loadCycleLogs('u1', { forAi: true, manualAllowed: false })).map((log) => log.cycleStartDate.toISOString().slice(0, 10))).toEqual(['2026-10-01']);
    expect(await service.loadCycleLogs('u1', { forAi: false })).toHaveLength(2);
  });
});

describe('Garmin: ciclo (Women\'s Health API)', () => {
  const push = { mct: [
    { userId: 'g1', summaryId: 'x1', periodStartDate: '2026-10-01', dayInCycle: 3, periodLength: 5, currentPhaseType: 'MENSTRUAL', cycleLength: 28, predictedCycleLength: 28, isPredictedCycle: false, hasSpecifiedPeriodLength: true, pregnancySnapshot: {} },
    { userId: 'g1', summaryId: 'x2', periodStartDate: '2026-10-11', currentPhaseType: 'SECOND_TRIMESTER', pregnancySnapshot: { title: 'Gestacao', bloodGlucoseList: [{ valueInMilligramsPerDeciliter: 97 }] } },
  ] };
  it('guarda so a agenda do ciclo e descarta gestacao por inteiro', () => {
    const { records, ignored } = parseGarminHealthPush(push);
    expect(records).toHaveLength(1);
    expect(ignored).toBe(1);
    expect(records[0]).toMatchObject({ eventType: 'metric_summary', metricKind: 'menstrual_cycle', identityKey: 'mct:2026-10-01' });
    const text = JSON.stringify(records[0]);
    expect(text).not.toContain('pregnancy');
    expect(text).not.toContain('bloodGlucose');
    expect(requiredCategoryOf(records[0])).toBe('menstrual_cycle');
  });
  it('o texto de autorizacao tem o grupo proprio do ciclo e a versao nova', () => {
    expect(GARMIN_CONSENT.version).toBe('1.2');
    const group = GARMIN_CONSENT.groups.find((item) => item.id === 'cycle');
    expect(group?.categories).toEqual(['menstrual_cycle']);
    expect(group?.required).toBe(false);
    expect(JSON.stringify(GARMIN_CONSENT)).not.toContain('não recebe dados de saúde da mulher');
  });
});
