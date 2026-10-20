import { BadRequestException } from '@nestjs/common';
import { CoachController } from '../src/coach/coach.controller';
import { CoachService, summarizeSessions } from '../src/coach/coach.service';
import { buildStudentCalendar, CALENDAR_CUTOFF_ISO, CalendarActivityRow, CalendarLinkedActivity, mondayOf, normalizeCalendarRange, statusOf } from '../src/coach/student-calendar';

type Row = Record<string, any>;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('normalizeCalendarRange', () => {
  it('aceita periodo valido e corta no marco do historico valido (01/08/2026)', () => {
    expect(CALENDAR_CUTOFF_ISO).toBe('2026-08-01');
    expect(normalizeCalendarRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31', empty: false });
    expect(normalizeCalendarRange('2026-07-20', '2026-08-10')).toEqual({ from: '2026-08-01', to: '2026-08-10', empty: false });
  });
  it('periodo todo anterior ao marco vem vazio, sem erro', () => {
    expect(normalizeCalendarRange('2026-06-01', '2026-06-30')).toEqual({ from: '2026-08-01', to: '2026-08-01', empty: true });
  });
  it('recusa formato invalido, data inexistente, from depois de to e periodo acima de 70 dias', () => {
    for (const [from, to] of [['x', '2026-10-01'], ['2026-10-01', undefined], ['2026-02-30', '2026-03-05'], ['2026-10-10', '2026-10-01'], ['2026-08-01', '2026-12-31']]) {
      expect(() => normalizeCalendarRange(from, to)).toThrow(BadRequestException);
    }
    expect(() => normalizeCalendarRange('2026-08-01', '2026-10-10')).not.toThrow(); // 70 dias exatos
  });
  it('mondayOf devolve a segunda-feira da semana (domingo pertence a semana que termina nele)', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
  });
});

describe('statusOf (mesma precedencia da serie longitudinal)', () => {
  const today = '2026-10-20';
  it('execucao objetiva (vinculo ativo) vale como feito, mesmo com "nao feito" marcado', () => {
    expect(statusOf({ completion: { status: 'missed' } }, true, '2026-10-10', today)).toBe('feito');
    expect(statusOf({ completion: null }, true, '2026-10-10', today)).toBe('feito');
  });
  it('sem atividade: registro do aluno decide; sem registro passado = sem_registro; hoje e futuro = futuro', () => {
    expect(statusOf({ completion: { status: 'done' } }, false, '2026-10-10', today)).toBe('feito');
    expect(statusOf({ completion: { status: 'adjusted' } }, false, '2026-10-10', today)).toBe('ajustado');
    expect(statusOf({ completion: { status: 'missed' } }, false, '2026-10-10', today)).toBe('nao_feito');
    expect(statusOf({ completion: null }, false, '2026-10-10', today)).toBe('sem_registro');
    expect(statusOf({ completion: null }, false, '2026-10-20', today)).toBe('futuro');
    expect(statusOf({ completion: null }, false, '2026-10-25', today)).toBe('futuro');
  });
});

const session = (id: string, date: string, over: Row = {}) => ({
  id, scheduledDate: d(date), weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), title: 'T', modality: 'corrida', durationMin: 50, distanceKm: 8, intensityZone: null,
  structure: null, notes: 'n', recommendations: null, routineMismatchNote: null, origin: 'agent', completion: null, executionLinks: [], ...over,
});
const plan = (id: string, start: string, createdAt: string, sessions: Row[]) => ({ id, startDate: d(start), createdAt: new Date(createdAt), planCode: null, sessions });
const link = (id: string, over: Row = {}): { activityLog: CalendarLinkedActivity } => ({ activityLog: { id, provider: 'polar', startedAt: new Date('2026-10-12T10:00:00Z'), distanceMeters: 10000, durationSec: 3000, avgHeartRateBpm: 150, ...over } });
const build = (plans: Row[], extra: Partial<Parameters<typeof buildStudentCalendar>[0]> = {}) =>
  buildStudentCalendar({ plans: plans as never, from: '2026-10-12', to: '2026-10-25', today: '2026-10-20', canonicalById: new Map(), activities: [], summarize: (s) => ({ n: s.length }), ...extra });

describe('buildStudentCalendar — semanas e sessoes', () => {
  it('cada semana usa o plano mais recente; sessao SEM registro de plano anterior da mesma semana e fantasma e nao aparece; COM registro aparece', () => {
    const oldPlan = plan('old', '2026-10-12', '2026-10-11T10:00:00Z', [
      session('o1', '2026-10-13', { completion: { status: 'done', perceivedEffort: 6 } }),
      session('o2', '2026-10-14'), // fantasma da regeneracao
    ]);
    const newPlan = plan('new', '2026-10-12', '2026-10-12T08:00:00Z', [session('n1', '2026-10-15')]);
    const out = build([oldPlan, newPlan]);
    expect(out.sessions.map((s) => s.id)).toEqual(['o1', 'n1']);
    expect(out.sessions.find((s) => s.id === 'o1')?.planId).toBe('new'); // pertence a semana vigente
    expect(out.weeks).toEqual([{ weekStart: '2026-10-12', planId: 'new', summary: { n: 2 } }]);
  });

  it('o resumo da semana considera a semana inteira, mesmo quando o periodo pedido pega so parte dela', () => {
    const p = plan('p', '2026-10-19', '2026-10-19T00:00:00Z', [session('a', '2026-10-19'), session('b', '2026-10-21'), session('c', '2026-10-25')]);
    const out = build([p], { from: '2026-10-21', to: '2026-10-21' });
    expect(out.sessions.map((s) => s.id)).toEqual(['b']);
    expect(out.weeks[0].summary).toEqual({ n: 3 });
  });

  it('semanas fora do periodo nao entram; semana que comeca antes do inicio mas termina dentro entra', () => {
    const before = plan('b', '2026-10-05', '2026-10-05T00:00:00Z', [session('x', '2026-10-06')]);
    const crossing = plan('c', '2026-10-12', '2026-10-12T00:00:00Z', [session('y', '2026-10-14')]);
    const out = build([before, crossing], { from: '2026-10-14', to: '2026-10-20' });
    expect(out.weeks.map((w) => w.weekStart)).toEqual(['2026-10-12']);
    expect(out.sessions.map((s) => s.id)).toEqual(['y']);
  });

  it('status, tipo, feedback e execucao do relogio (canonica; pace derivado); extras do aluno e do relogio sao identificados', () => {
    const canonical: CalendarLinkedActivity = { id: 'canon', provider: 'apple_health', startedAt: new Date('2026-10-13T09:00:00Z'), distanceMeters: 8000, durationSec: 2400, avgHeartRateBpm: 148 };
    const p = plan('p', '2026-10-12', '2026-10-12T00:00:00Z', [
      session('linked', '2026-10-13', { executionLinks: [link('read', { distanceMeters: 7990 })] }),
      session('missed', '2026-10-14', { completion: { status: 'missed' } }),
      session('norec', '2026-10-15'),
      session('future', '2026-10-22'),
      session('extraAluno', '2026-10-16', { structure: { source: 'student', type: 'extra' }, completion: { status: 'done', perceivedEffort: 5 } }),
      session('extraRelogio', '2026-10-17', { origin: 'device_extra', structure: { activityLogId: 'zzz', provider: 'polar' }, completion: { status: 'done' } }),
    ]);
    const out = build([p], { canonicalById: new Map([['read', canonical]]) });
    const by = Object.fromEntries(out.sessions.map((s) => [s.id, s]));
    expect(by.linked).toMatchObject({ status: 'feito', executedByDevice: true, hasFeedback: false, kind: 'prescrito', execution: { activityLogId: 'canon', provider: 'apple_health', distanceKm: 8, durationMin: 40, avgPaceSecondsKm: 300, avgHeartRateBpm: 148 } });
    expect(by.missed).toMatchObject({ status: 'nao_feito', hasFeedback: true, executedByDevice: false, execution: null });
    expect(by.norec).toMatchObject({ status: 'sem_registro', hasFeedback: false });
    expect(by.future.status).toBe('futuro');
    expect(by.extraAluno.kind).toBe('extra_aluno');
    expect(by.extraRelogio.kind).toBe('extra_relogio');
  });

  it('mantem todos os campos do historico por sessao (mesmo formato da aba Evolucao) mais os do calendario', () => {
    const p = plan('p', '2026-10-12', '2026-10-12T00:00:00Z', [session('a', '2026-10-13', { completion: { status: 'done', durationMin: 51, distanceKm: 8.1, avgPaceSecondsKm: 380, perceivedEffort: 7, notes: 'ok', painFlag: 'none', feedbackVersion: 2 } })]);
    const s = build([p]).sessions[0];
    expect(s).toMatchObject({ id: 'a', completionStatus: 'done', completedDistanceKm: 8.1, completedDurationMin: 51, perceivedEffort: 7, feedback: 'ok', painFlag: 'none', feedbackVersion: 2, planId: 'p', dateIso: '2026-10-13', origin: 'agent' });
  });
});

describe('buildStudentCalendar — atividades fora do programa', () => {
  const act = (id: string, over: Partial<CalendarActivityRow> = {}): CalendarActivityRow => ({
    id, provider: 'polar', startedAt: new Date('2026-10-14T10:00:00Z'), utcOffsetMinutes: -180, sport: 'natacao', durationSec: 1800, distanceMeters: 1000, avgHeartRateBpm: 130, executionClassification: 'alternative', ...over,
  });

  it('mostra alternativas e a confirmar (ambigua ou nao processada); nao repete correspondentes nem as ja ligadas a uma sessao ou a sessao sintetica do relogio', () => {
    const p = plan('p', '2026-10-12', '2026-10-12T00:00:00Z', [
      session('s1', '2026-10-13', { executionLinks: [link('linked-read')] }),
      session('s2', '2026-10-17', { origin: 'device_extra', structure: { activityLogId: 'extra-1' }, completion: { status: 'done' } }),
    ]);
    const out = build([p], {
      canonicalById: new Map([['linked-read', { id: 'linked-canon', provider: 'apple_health', distanceMeters: 1, durationSec: 1, avgHeartRateBpm: null }]]),
      activities: [act('alt'), act('amb', { executionClassification: 'ambiguous' }), act('nul', { executionClassification: null }), act('corr', { executionClassification: 'corresponding' }), act('linked-read'), act('linked-canon'), act('extra-1')],
    });
    expect(out.activities.map((a) => [a.id, a.classification])).toEqual([['alt', 'alternative'], ['amb', 'ambiguous'], ['nul', null]]);
  });

  it('o dia e o local do atleta (fuso do provedor), a modalidade e a canonica e o periodo e respeitado', () => {
    const out = build([], {
      activities: [
        act('late', { startedAt: new Date('2026-10-15T01:30:00Z'), utcOffsetMinutes: -180 }), // 14/10 22:30 local
        act('outside', { startedAt: new Date('2026-11-20T12:00:00Z') }),
        act('run', { sport: 'RUNNING', startedAt: new Date('2026-10-16T12:00:00Z') }),
      ],
    });
    expect(out.activities.map((a) => [a.id, a.dateIso, a.modality])).toEqual([['late', '2026-10-14', 'natacao'], ['run', '2026-10-16', 'corrida']]);
    expect(out.activities[0]).toMatchObject({ durationMin: 30, distanceKm: 1, avgHeartRateBpm: 130 });
  });
});

describe('CoachService.calendar e a rota', () => {
  const proto = CoachService.prototype as unknown as Row;
  const fakeThis = (over: Row = {}) => ({
    assertStudent: jest.fn(async () => undefined),
    prisma: {
      trainingPlan: { findMany: jest.fn(async (_args?: unknown) => [] as unknown[]) },
      activityLog: { findMany: jest.fn(async (_args?: unknown) => [] as unknown[]) },
    },
    ...over,
  });

  it('periodo anterior a 01/08/2026: devolve vazio sem consultar o banco', async () => {
    const self = fakeThis();
    const out = await proto.calendar.call(self, 'u1', '2026-06-01', '2026-06-30');
    expect(out).toMatchObject({ sessions: [], activities: [], weeks: [] });
    expect(self.prisma.trainingPlan.findMany).not.toHaveBeenCalled();
    expect(self.assertStudent).toHaveBeenCalledWith('u1');
  });

  it('consulta so os planos das semanas do periodo, do proprio aluno, e as atividades na janela do fuso; so leitura', async () => {
    const self = fakeThis();
    const out = await proto.calendar.call(self, 'u1', '2026-10-01', '2026-10-31');
    expect(out).toMatchObject({ from: '2026-10-01', to: '2026-10-31', sessions: [], activities: [], weeks: [] });
    const planQuery = self.prisma.trainingPlan.findMany.mock.calls[0][0] as any;
    expect(planQuery.where.userId).toBe('u1');
    expect(planQuery.where.startDate.gte).toEqual(new Date('2026-09-28T00:00:00Z')); // segunda da semana que contem 01/10
    const activityQuery = self.prisma.activityLog.findMany.mock.calls[0][0] as any;
    expect(activityQuery.where.userId).toBe('u1');
    expect(Object.keys(self.prisma)).toEqual(['trainingPlan', 'activityLog']); // nada de escrita disponivel
  });

  it('parametros invalidos viram 400 antes de qualquer consulta', async () => {
    const self = fakeThis();
    await expect(proto.calendar.call(self, 'u1', 'abc', '2026-10-31')).rejects.toThrow(BadRequestException);
    expect(self.prisma.trainingPlan.findMany).not.toHaveBeenCalled();
  });

  it('a rota GET /coach/students/:studentId/calendar existe e herda a protecao de coach/admin do controlador', () => {
    expect(Reflect.getMetadata('path', CoachController.prototype.calendar)).toBe('students/:studentId/calendar');
    expect(Reflect.getMetadata('method', CoachController.prototype.calendar)).toBe(0); // GET
    expect(Reflect.getMetadata('roles', CoachController)).toEqual(['coach', 'admin']);
  });

  it('resumo por semana e o mesmo do historico (summarizeSessions), nao uma conta nova', async () => {
    const self = fakeThis({ prisma: { trainingPlan: { findMany: jest.fn(async () => [plan('p', '2026-10-12', '2026-10-12T00:00:00Z', [session('a', '2026-10-13', { completion: { status: 'done', distanceKm: 8 } })])]) }, activityLog: { findMany: jest.fn(async () => []) } } });
    const out = await proto.calendar.call(self, 'u1', '2026-10-12', '2026-10-18');
    expect(out.weeks[0].summary).toEqual(summarizeSessions([session('a', '2026-10-13', { completion: { status: 'done', distanceKm: 8 } })] as never));
  });
});

describe('CoachService.activityDetailForStudent e a rota', () => {
  const proto = CoachService.prototype as unknown as Row;

  it('usa o studentId como dono da atividade (outra conta => o servico responde 404) e confere o aluno antes', async () => {
    const getDetail = jest.fn(async (_u: string, _a: string) => ({ ok: true }));
    const self = { assertStudent: jest.fn(async () => undefined), activityDetail: { getDetail } };
    const out = await proto.activityDetailForStudent.call(self, 'aluno1', 'act9');
    expect(out).toEqual({ ok: true });
    expect(self.assertStudent).toHaveBeenCalledWith('aluno1');
    expect(getDetail).toHaveBeenCalledWith('aluno1', 'act9');
  });

  it('sem o servico de detalhe injetado: 404, nunca erro generico', async () => {
    const self = { assertStudent: jest.fn(async () => undefined), activityDetail: undefined };
    await expect(proto.activityDetailForStudent.call(self, 'a', 'b')).rejects.toThrow('indisponivel');
  });

  it('a rota GET existe sob a protecao de coach/admin', () => {
    expect(Reflect.getMetadata('path', CoachController.prototype.activityDetail)).toBe('students/:studentId/activities/:activityLogId/detail');
    expect(Reflect.getMetadata('method', CoachController.prototype.activityDetail)).toBe(0);
    expect(Reflect.getMetadata('roles', CoachController)).toEqual(['coach', 'admin']);
  });
});
