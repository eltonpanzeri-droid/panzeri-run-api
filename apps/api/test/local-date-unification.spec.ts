import { activityLocalDate, activityLocalDayStart, hasInformedOffset, OPERATIONAL_TIME_ZONE } from '../src/common/local-date';
import { localCalendarDate } from '../src/activity-execution/session-execution-link.service';
import { activityLocalDate as totalsLocalDate } from '../src/activity-execution/weekly-realized-totals';
import { activityLocalDate as trainingLoadLocalDate } from '../src/coach/student-training-load.service';
import { activityLocalDay as shoeLocalDay } from '../src/equipment/shoe-facts';
import { buildStudentCalendar } from '../src/coach/student-calendar';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { weekStartOf } from '../src/common/weekly-volume';

// Lote 4 (26/10/2026): UMA regra de dia local para todos os consumidores. Offset do aparelho preservado (inclusive 0); sem offset, America/Sao_Paulo (nunca UTC).

const INSTANTS: Array<[string, string]> = [
  ['domingo 23:30 em Sao Paulo (segunda 02:30 UTC)', '2026-10-26T02:30:00Z'],
  ['segunda 00:10 em Sao Paulo (03:10 UTC)', '2026-10-26T03:10:00Z'],
  ['limite: 02:59:59 UTC (ainda domingo em SP)', '2026-10-26T02:59:59Z'],
  ['limite: 03:00:00 UTC (segunda em SP)', '2026-10-26T03:00:00Z'],
  ['segunda 01:00 UTC (domingo 22:00 em SP)', '2026-10-26T01:00:00Z'],
  ['meio do dia', '2026-10-21T15:00:00Z'],
  ['virada de mes: 31/10 23:30 SP', '2026-11-01T02:30:00Z'],
];
const OFFSETS: Array<number | null | undefined> = [null, undefined, 0, -180, -120, 60, 540];

describe('corte do fuso (sem offset): antes = UTC antigo, depois = Sao Paulo; sem configuracao = regra antiga', () => {
  const saved = process.env.LOCAL_DATE_CUTOVER_AT;
  afterEach(() => { if (saved === undefined) delete process.env.LOCAL_DATE_CUTOVER_AT; else process.env.LOCAL_DATE_CUTOVER_AT = saved; });
  const night = new Date('2026-10-26T02:30:00Z'); // domingo 23:30 SP / segunda 02:30 UTC

  it('sem configuracao (ou valor invalido) a regra antiga (UTC) vale para tudo', () => {
    delete process.env.LOCAL_DATE_CUTOVER_AT;
    expect(activityLocalDate(night, null)).toBe('2026-10-26');
    process.env.LOCAL_DATE_CUTOVER_AT = 'lixo';
    expect(activityLocalDate(night, null)).toBe('2026-10-26');
    process.env.LOCAL_DATE_CUTOVER_AT = '';
    expect(activityLocalDate(night, null)).toBe('2026-10-26');
  });

  it('antes do corte mantem o dia UTC antigo; no instante do corte e depois vale Sao Paulo; offset informado nunca e afetado', () => {
    process.env.LOCAL_DATE_CUTOVER_AT = '2026-10-27T00:00:00Z';
    expect(activityLocalDate(night, null)).toBe('2026-10-26');                                        // antes: historico estavel
    expect(activityLocalDate(new Date('2026-10-26T23:59:59Z'), undefined)).toBe('2026-10-26');
    expect(activityLocalDate(new Date('2026-10-27T00:00:00Z'), null)).toBe('2026-10-26');             // no corte: SP (21:00 do dia 26)
    expect(activityLocalDate(new Date('2026-10-28T02:30:00Z'), null)).toBe('2026-10-27');             // depois: SP
    expect(activityLocalDate(night, -180)).toBe('2026-10-25');                                         // offset informado prevalece, antes do corte
    expect(activityLocalDate(night, 0)).toBe('2026-10-26');
    expect(activityLocalDayStart(night, null).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('regra unica do dia local da atividade', () => {
  const saved = process.env.LOCAL_DATE_CUTOVER_AT;
  beforeAll(() => { process.env.LOCAL_DATE_CUTOVER_AT = '2000-01-01T00:00:00Z'; }); // corte no passado: exercita a regra de Sao Paulo
  afterAll(() => { if (saved === undefined) delete process.env.LOCAL_DATE_CUTOVER_AT; else process.env.LOCAL_DATE_CUTOVER_AT = saved; });

  it('com offset informado ele e preservado (inclusive 0 = UTC informado); sem offset vale America/Sao_Paulo, nunca UTC', () => {
    expect(OPERATIONAL_TIME_ZONE).toBe('America/Sao_Paulo');
    const sundayNight = new Date('2026-10-26T02:30:00Z');
    expect(activityLocalDate(sundayNight, -180)).toBe('2026-10-25');
    expect(activityLocalDate(sundayNight, 0)).toBe('2026-10-26'); // offset 0 foi INFORMADO: nao cai no padrao
    expect(activityLocalDate(sundayNight, 120)).toBe('2026-10-26');
    expect(activityLocalDate(sundayNight, null)).toBe('2026-10-25');
    expect(activityLocalDate(sundayNight, undefined)).toBe('2026-10-25');
    expect(hasInformedOffset(0)).toBe(true);
    expect(hasInformedOffset(null)).toBe(false);
    expect(hasInformedOffset(Number.NaN)).toBe(false);
  });

  it('fronteira exata do dia em Sao Paulo (03:00 UTC) e virada de semana domingo/segunda', () => {
    expect(activityLocalDate(new Date('2026-10-26T02:59:59Z'), null)).toBe('2026-10-25');
    expect(activityLocalDate(new Date('2026-10-26T03:00:00Z'), null)).toBe('2026-10-26');
    expect(weekStartOf(activityLocalDate(new Date('2026-10-26T02:59:59Z'), null))).toBe('2026-10-19');
    expect(weekStartOf(activityLocalDate(new Date('2026-10-26T03:00:00Z'), null))).toBe('2026-10-26');
  });

  it('atividade que atravessa a meia-noite pertence ao dia de INICIO (o instante de inicio decide)', () => {
    const start = new Date('2026-10-26T01:50:00Z'); // domingo 22:50 em SP
    const end = new Date(start.getTime() + 2 * 3600_000); // termina segunda 00:50 em SP
    expect(activityLocalDate(start, null)).toBe('2026-10-25');
    expect(activityLocalDate(end, null)).toBe('2026-10-26'); // so' o fim estaria na segunda; a atividade nao e' dividida
    expect(activityLocalDayStart(start, null).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('o historico do fuso de Sao Paulo (horario de verao ate 2018) e respeitado pela interpretacao', () => {
    expect(activityLocalDate(new Date('2018-12-01T02:30:00Z'), null)).toBe('2018-12-01'); // UTC-2 em dezembro de 2018
    expect(activityLocalDate(new Date('2018-12-01T01:30:00Z'), null)).toBe('2018-11-30');
    expect(activityLocalDate(new Date('2026-12-01T02:30:00Z'), null)).toBe('2026-11-30'); // sem horario de verao desde 2019: UTC-3
  });

  describe.each(INSTANTS)('todos os consumidores concordam: %s', (_label, iso) => {
    const startedAt = new Date(iso);
    it.each(OFFSETS.map((offset) => [String(offset), offset] as const))('offset %s', async (_name, offset) => {
      const expected = activityLocalDate(startedAt, offset);
      // vinculo de atividade com treino / materializacao / janela de vinculo manual
      expect(localCalendarDate(startedAt, (offset ?? null) as number | null)).toBe(expected);
      // relatorio e totais semanais
      expect(totalsLocalDate(startedAt, offset)).toBe(expected);
      // carga de treino e tenis
      expect(trainingLoadLocalDate(startedAt, (offset ?? null) as number | null)).toBe(expected);
      expect(shoeLocalDay(startedAt, (offset ?? null) as number | null)).toBe(expected);
      // calendario do aluno
      const calendar = buildStudentCalendar({
        plans: [], from: '2026-10-01', to: '2026-11-30', today: '2026-11-30', canonicalById: new Map(), summarize: () => null,
        activities: [{ id: 'a', provider: 'polar', startedAt, utcOffsetMinutes: (offset ?? null) as number | null, sport: 'corrida', durationSec: 3600, distanceMeters: 10000, avgHeartRateBpm: null, executionClassification: 'alternative' }],
      });
      expect(calendar.activities.map((a) => a.dateIso)).toEqual([expected]);
      // Evolucao
      const row = { id: 'a', provider: 'polar', startedAt, utcOffsetMinutes: (offset ?? null) as number | null, distanceMeters: 10000, durationSec: 3600, sport: 'corrida', executionClassification: 'alternative', physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null };
      const prisma = { activityLog: { findMany: jest.fn().mockResolvedValue([row]) }, trainingSession: { findMany: jest.fn().mockResolvedValue([]) } };
      const [evolution] = await (new EvolutionMetricService(prisma as never) as unknown as { fetchRealizedActivities(userId: string): Promise<Array<{ isoDate: string }>> }).fetchRealizedActivities('u1');
      expect(evolution.isoDate).toBe(expected);
    });
  });
});
