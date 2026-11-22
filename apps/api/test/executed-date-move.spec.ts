import { BadRequestException } from '@nestjs/common';
import { moveSessionToExecutedDate, restorePrescribedDate, weekdayMondayFirst } from '../src/activity-execution/executed-date-move';

// 22/11/2026 (ordem de Elton): a data REALIZADA prevalece. O treino prescrito vai para o dia da execucao (qualquer semana); o dia prescrito fica guardado; desvincular devolve.
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Row = Record<string, any>;
function build(sessions: Row[], plans: Row[]) {
  const db = {
    trainingSession: {
      findUnique: jest.fn(async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => sessions.find((s) => s.planId === where.planId && s.weekday === where.weekday && s.modality === where.modality && s.id !== where.id.not && !['device_extra', 'student_extra'].includes(s.origin ?? '')) ?? null),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(sessions.find((s) => s.id === where.id)!, data); }),
    },
    trainingPlan: {
      findMany: jest.fn(async ({ where }: any) => plans.filter((p) => p.startDate <= where.startDate.lte && p.startDate > where.startDate.gt).sort((a, b) => b.createdAt - a.createdAt)),
    },
  };
  return db as never;
}
// semana 16/11 (seg) a 22/11 (dom) = plano p47; semana 09/11 a 15/11 = plano p46 (ativo) e p46old (arquivado)
const plans = (): Row[] => [
  { id: 'p47', status: 'active', startDate: d('2026-11-16'), createdAt: 5 },
  { id: 'p46', status: 'active', startDate: d('2026-11-09'), createdAt: 4 },
  { id: 'p46old', status: 'archived', startDate: d('2026-11-09'), createdAt: 1 },
];
const run16km = (over: Row = {}): Row => ({ id: 'run', userId: 'u1', planId: 'p47', scheduledDate: d('2026-11-21'), weekday: 5, modality: 'corrida', title: 'Longão 16 km', origin: 'agent', prescribedDate: null, ...over });

describe('data realizada prevalece: mover o treino prescrito para o dia da execucao', () => {
  it('o caso do Elton: prescrito sabado 21/11, feito sexta 20/11 -> sexta; o dia prescrito fica guardado', async () => {
    const rows = [run16km(), { id: 'forca', userId: 'u1', planId: 'p47', scheduledDate: d('2026-11-20'), weekday: 4, modality: 'forca', title: 'Musculação', origin: 'agent' }];
    const result = await moveSessionToExecutedDate(build(rows, plans()), { sessionId: 'run', executedIso: '2026-11-20' });
    expect(result).toEqual({ moved: true, reason: 'moved', from: '2026-11-21', to: '2026-11-20' });
    expect(rows[0]).toMatchObject({ scheduledDate: d('2026-11-20'), weekday: 4, planId: 'p47', prescribedDate: d('2026-11-21') });
    expect(rows[1].scheduledDate).toEqual(d('2026-11-20')); // a musculacao da sexta (outra modalidade) nao foi tocada
  });
  it('mesmo dia: nada muda', async () => {
    const rows = [run16km()];
    expect(await moveSessionToExecutedDate(build(rows, plans()), { sessionId: 'run', executedIso: '2026-11-21' })).toMatchObject({ moved: false, reason: 'same_day' });
    expect(rows[0].prescribedDate).toBeNull();
  });
  it('outra semana: o treino passa para o programa daquela semana (o ativo, nao o arquivado)', async () => {
    const rows = [run16km()];
    const result = await moveSessionToExecutedDate(build(rows, plans()), { sessionId: 'run', executedIso: '2026-11-12' });
    expect(result).toMatchObject({ moved: true, to: '2026-11-12' });
    expect(rows[0]).toMatchObject({ planId: 'p46', weekday: 3, scheduledDate: d('2026-11-12'), prescribedDate: d('2026-11-21') });
  });
  it('sem programa que cubra o dia: nao move (o vinculo continua, so a data nao muda)', async () => {
    const rows = [run16km()];
    expect(await moveSessionToExecutedDate(build(rows, plans()), { sessionId: 'run', executedIso: '2026-06-01' })).toMatchObject({ moved: false, reason: 'no_plan' });
    expect(rows[0].scheduledDate).toEqual(d('2026-11-21'));
  });
  it('ja existe treino prescrito da mesma modalidade no dia: pergunta (date_conflict); com a autorizacao da aluna, move', async () => {
    const rows = [run16km(), { id: 'outra', userId: 'u1', planId: 'p47', scheduledDate: d('2026-11-20'), weekday: 4, modality: 'corrida', title: 'Rodagem', origin: 'agent' }];
    const db = build(rows, plans());
    await expect(moveSessionToExecutedDate(db, { sessionId: 'run', executedIso: '2026-11-20' })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'date_conflict', existingTitle: 'Rodagem' }) });
    expect(rows[0].scheduledDate).toEqual(d('2026-11-21')); // nada mudou sem autorizacao
    expect(await moveSessionToExecutedDate(db, { sessionId: 'run', executedIso: '2026-11-20', confirmConflict: true })).toMatchObject({ moved: true });
    expect(rows[0].scheduledDate).toEqual(d('2026-11-20'));
  });
  it('treino extra no dia de destino nao e conflito; treino extra nunca e movido', async () => {
    const rows = [run16km(), { id: 'extra', userId: 'u1', planId: 'p47', scheduledDate: d('2026-11-20'), weekday: 4, modality: 'corrida', title: 'Extra', origin: 'device_extra' }];
    expect(await moveSessionToExecutedDate(build(rows, plans()), { sessionId: 'run', executedIso: '2026-11-20' })).toMatchObject({ moved: true });
    expect(await moveSessionToExecutedDate(build(rows, plans()), { sessionId: 'extra', executedIso: '2026-11-19' })).toMatchObject({ moved: false });
  });
  it('mover duas vezes mantem o dia prescrito ORIGINAL', async () => {
    const rows = [run16km()];
    const db = build(rows, plans());
    await moveSessionToExecutedDate(db, { sessionId: 'run', executedIso: '2026-11-20' });
    await moveSessionToExecutedDate(db, { sessionId: 'run', executedIso: '2026-11-19' });
    expect(rows[0]).toMatchObject({ scheduledDate: d('2026-11-19'), prescribedDate: d('2026-11-21') });
  });
});

describe('desvincular: o treino volta ao dia prescrito', () => {
  it('devolve data, dia da semana e programa; limpa a marca', async () => {
    const rows = [run16km({ scheduledDate: d('2026-11-20'), weekday: 4, prescribedDate: d('2026-11-21') })];
    const result = await restorePrescribedDate(build(rows, plans()), 'run');
    expect(result).toEqual({ moved: true, reason: 'moved', from: '2026-11-20', to: '2026-11-21' });
    expect(rows[0]).toMatchObject({ scheduledDate: d('2026-11-21'), weekday: 5, planId: 'p47', prescribedDate: null });
  });
  it('treino que nunca foi movido pelo vinculo: nada acontece', async () => {
    const rows = [run16km()];
    expect(await restorePrescribedDate(build(rows, plans()), 'run')).toMatchObject({ moved: false });
    expect(rows[0].scheduledDate).toEqual(d('2026-11-21'));
  });
});

describe('segunda = 0', () => {
  it('dia da semana (segunda primeiro)', () => {
    expect(weekdayMondayFirst(d('2026-11-16'))).toBe(0);
    expect(weekdayMondayFirst(d('2026-11-20'))).toBe(4);
    expect(weekdayMondayFirst(d('2026-11-22'))).toBe(6);
  });
});
void BadRequestException;
