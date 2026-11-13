import { buildWeekDayCells, pickTodaySession, weekSummarySentence, HomeSessionLite } from '../../mobile/home/homeLogic';

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

describe('Hoje: vários treinos, feedback e frase da semana (14/11/2026)', () => {
  it('com dois treinos hoje, mostra primeiro o que falta, avisa que há mais de um e o extra da aluna não conta como treino do dia', () => {
    const done = session('forca', TODAY, { realized: { activityLogId: 'a' }, completion: { status: 'done' } });
    const pending = session('corrida', TODAY);
    const extra = session('extra', TODAY, { structure: { type: 'extra', source: 'student' } });
    const out = pickTodaySession([done, pending, extra], TODAY);
    expect(out.session?.id).toBe('corrida');
    expect(out.state).toBe('not_done');
    expect(out.todayCount).toBe(2);
    expect(pickTodaySession([done, extra], TODAY).todayCount).toBe(1);
  });

  it('feedback: com registro = enviado; treino feito pelo relógio sem registro = falta o feedback', () => {
    expect(pickTodaySession([session('s', TODAY, { realized: { activityLogId: 'a' } })], TODAY).feedbackGiven).toBe(false);
    expect(pickTodaySession([session('s', TODAY, { realized: { activityLogId: 'a' }, completion: { status: 'done' } })], TODAY).feedbackGiven).toBe(true);
    expect(pickTodaySession([], TODAY)).toMatchObject({ state: 'rest_day', todayCount: 0, feedbackGiven: false });
  });

  it('frase da semana usa os mesmos números do cartão e muda conforme o andamento', () => {
    expect(weekSummarySentence(null)).toBeNull();
    expect(weekSummarySentence({ sessoesPrescritas: 0, sessoesFeitas: 0, sessoesNaoFeitas: 0 })).toBeNull();
    expect(weekSummarySentence({ sessoesPrescritas: 8, sessoesFeitas: 7, sessoesNaoFeitas: 0 })).toBe('Você está em dia: 7 de 8 treinos feitos.');
    expect(weekSummarySentence({ sessoesPrescritas: 8, sessoesFeitas: 8, sessoesNaoFeitas: 0 })).toBe('Semana completa: você fez todos os treinos.');
    expect(weekSummarySentence({ sessoesPrescritas: 4, sessoesFeitas: 0, sessoesNaoFeitas: 0 })).toBe('Sua semana está começando, com 4 treinos pela frente.');
    expect(weekSummarySentence({ sessoesPrescritas: 5, sessoesFeitas: 2, sessoesNaoFeitas: 1 })).toContain('Você fez 2 de 5 treinos até agora');
    expect(weekSummarySentence({ sessoesPrescritas: 5, sessoesFeitas: 3, sessoesNaoFeitas: 2 })).toBe('Você fez 3 de 5 treinos nesta semana.');
  });
});
