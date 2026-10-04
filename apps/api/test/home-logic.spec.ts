import { buildWeekDayCells, pickTodaySession, HomeSessionLite } from '../../mobile/home/homeLogic';

// "Sua semana" (04/10/2026): as bolinhas diarias liam so' WorkoutCompletion, enquanto os agregados
// (7/8 treinos, km) ja' reconheciam a execucao objetiva (ActivityLog + vinculo ativo). Caso real:
// sabado 03/10 corrida de 30 km pelo relogio, sem feedback, aparecia sem marca.

const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const TODAY = '2026-10-04';

function session(id: string, isoDate: string, overrides: Partial<HomeSessionLite> = {}): HomeSessionLite {
  return { id, isoDate, title: 'Corrida', detail: '', modality: 'corrida', distanceKm: 10, durationMin: 60, structure: {}, completion: null, realized: null, ...overrides };
}

const cell = (cells: ReturnType<typeof buildWeekDayCells>, iso: string) => cells.find((c) => c.isoDate === iso)!;

describe('buildWeekDayCells — execucao objetiva', () => {
  it('A: sabado com execucao do relogio e sem feedback -> done (nao fica sem marca)', () => {
    const cells = buildWeekDayCells(WEEK, [session('s-sab', '2026-10-03', { realized: { activityLogId: 'act-1' } })], TODAY);
    expect(cell(cells, '2026-10-03').state).toBe('done');
    expect(cell(cells, '2026-10-03').target).toEqual({ kind: 'session', id: 's-sab' });
  });

  it('B: sexta nao realizada (missed explicito) continua missed, sem execucao objetiva', () => {
    const cells = buildWeekDayCells(WEEK, [session('s-sex', '2026-10-02', { completion: { status: 'missed' } })], TODAY);
    expect(cell(cells, '2026-10-02').state).toBe('missed');
  });

  it('B: dia passado sem feedback e sem execucao nao vira missed inventado', () => {
    const cells = buildWeekDayCells(WEEK, [session('s-qui', '2026-10-01')], TODAY);
    expect(cell(cells, '2026-10-01').state).toBe('rest');
  });

  it('feedback adjusted + execucao objetiva -> adjusted (feedback refina, nao nega)', () => {
    const cells = buildWeekDayCells(WEEK, [session('s', '2026-10-03', { completion: { status: 'adjusted' }, realized: { activityLogId: 'a' } })], TODAY);
    expect(cell(cells, '2026-10-03').state).toBe('adjusted');
  });

  it('execucao objetiva prevalece sobre completion missed contraditorio (vinculo ativo prova que aconteceu)', () => {
    const cells = buildWeekDayCells(WEEK, [session('s', '2026-10-03', { completion: { status: 'missed' }, realized: { activityLogId: 'a' } })], TODAY);
    expect(cell(cells, '2026-10-03').state).toBe('done');
  });

  it('C: atividade alternativa sozinha marca o dia como extra e abre a atividade, sem cumprir sessao prescrita', () => {
    const cells = buildWeekDayCells(WEEK, [], TODAY, [{ activityLogId: 'act-9', isoDate: '2026-10-02' }]);
    expect(cell(cells, '2026-10-02').state).toBe('extra');
    expect(cell(cells, '2026-10-02').target).toEqual({ kind: 'alternative', id: 'act-9' });
  });

  it('C: alternativa no mesmo dia de prescricao NAO realizada nao transforma a prescricao em cumprida', () => {
    const cells = buildWeekDayCells(
      WEEK,
      [session('s-sex', '2026-10-02', { completion: { status: 'missed' } })],
      TODAY,
      [{ activityLogId: 'act-9', isoDate: '2026-10-02' }],
    );
    expect(cell(cells, '2026-10-02').state).toBe('missed');
    expect(cell(cells, '2026-10-02').target).toEqual({ kind: 'session', id: 's-sex' });
  });

  it('D: dia com multiplas sessoes preserva o indicador (count) e abre a sessao prescrita', () => {
    const cells = buildWeekDayCells(
      WEEK,
      [session('forca', '2026-09-29', { modality: 'forca', completion: { status: 'done' } }), session('corrida', '2026-09-29', { realized: { activityLogId: 'a' } })],
      TODAY,
      [{ activityLogId: 'act-2', isoDate: '2026-09-29' }],
    );
    expect(cell(cells, '2026-09-29').count).toBe(3);
  });

  it('dia de descanso nao tem alvo de toque', () => {
    const cells = buildWeekDayCells(WEEK, [], TODAY);
    expect(cell(cells, '2026-09-29').target).toBeNull();
  });
});

describe('pickTodaySession — execucao objetiva', () => {
  it('treino de hoje com execucao do relogio e sem feedback -> concluido', () => {
    const today = pickTodaySession([session('s', TODAY, { realized: { activityLogId: 'a' } })], TODAY);
    expect(today.state).toBe('done_as_planned');
  });
});
