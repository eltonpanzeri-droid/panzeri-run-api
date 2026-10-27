import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { buildTrainingLoad, classifySessions, MIN_SESSIONS_IN_WINDOW, modalityGroup, weekStartOf, windowAt, type LoadInputRow } from '../src/coach/training-load';
import { activityLocalDate, StudentTrainingLoadService } from '../src/coach/student-training-load.service';

// 23/10/2026 — Carga de treino PROPRIA (esforco percebido x minutos), v2: data REAL da execucao, visoes por modalidade e duracao da atividade importada vinculada. Metrica descritiva em avaliacao,
// com a conta inteira a mostra no painel. Dados sinteticos.

const row = (id: string, date: string, rpe: number | null, minutes: number | null, over: Partial<LoadInputRow> = {}): LoadInputRow => ({
  id, date, modality: 'corrida', title: `Treino ${id}`, status: 'done', durationMin: minutes, perceivedEffort: rpe, isExtra: false, ...over,
});

// Corte do fuso no passado: estes testes exercitam a regra de Sao Paulo (sem configuracao a regra antiga, UTC, vale; ver local-date-unification.spec.ts).
const SAVED_CUTOVER = process.env.LOCAL_DATE_CUTOVER_AT;
beforeAll(() => { process.env.LOCAL_DATE_CUTOVER_AT = '2000-01-01T00:00:00Z'; });
afterAll(() => { if (SAVED_CUTOVER === undefined) delete process.env.LOCAL_DATE_CUTOVER_AT; else process.env.LOCAL_DATE_CUTOVER_AT = SAVED_CUTOVER; });

describe('o que entra e o que fica de fora', () => {
  it('carga da sessao = esforco percebido x minutos; ajustado entra marcado; nao feito nao entra em nenhuma lista', () => {
    const { sessions, excluded } = classifySessions([row('a', '2026-10-01', 7, 45), row('b', '2026-10-02', 5, 60, { status: 'adjusted' }), row('c', '2026-10-03', 8, 30, { status: 'missed' })]);
    expect(sessions.map((s) => [s.id, s.load, s.adjusted])).toEqual([['a', 315, false], ['b', 300, true]]);
    expect(excluded).toEqual([]);
  });

  it('sem esforco, sem duracao ou ambos: ficam de fora COM o motivo (nunca viram zero nem sao estimados); valores fora de faixa tambem', () => {
    const { sessions, excluded } = classifySessions([
      row('a', '2026-10-01', null, 45), row('b', '2026-10-02', 6, null), row('c', '2026-10-03', null, null), row('d', '2026-10-04', 0, 40), row('e', '2026-10-05', 11, 40), row('f', '2026-10-06', 6, 0), row('g', '2026-10-07', 4, 20),
    ]);
    expect(sessions.map((s) => s.id)).toEqual(['g']);
    expect(Object.fromEntries(excluded.map((e) => [e.id, e.reason]))).toEqual({
      a: 'sem_esforco', b: 'sem_duracao', c: 'sem_esforco_e_duracao', d: 'sem_esforco', e: 'sem_esforco', f: 'sem_duracao',
    });
  });

  it('status desconhecido (ex.: partial) nao entra em nenhuma lista; minutos fracionarios usam 2 casas e a conta bate com o exibido', () => {
    const { sessions, excluded } = classifySessions([row('p', '2026-10-01', 6, 40, { status: 'partial' }), row('f', '2026-10-02', 6, 33.3333)]);
    expect(excluded).toEqual([]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ minutes: 33.33, load: 200 }); // 6 x 33,33 = 199,98 -> 200,0 UA (o exibido na tela)
    expect(classifySessions([row('z', '2026-10-03', 6, 0.004)]).excluded[0].reason).toBe('sem_duracao');
  });

  it('semana comeca na segunda-feira', () => {
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19'); // segunda
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19'); // quarta
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19'); // domingo
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26');
  });
});

describe('AJUSTE 1 — data da execucao: real quando existe, programada (explicita) quando so ha ela', () => {
  it('a data usada e a recebida (real ou programada) e a ORIGEM fica registrada; sem informacao = programada (nunca se presume data real)', () => {
    const { sessions } = classifySessions([
      row('real', '2026-10-20', 6, 40, { dateSource: 'atividade_vinculada' }),
      row('prog', '2026-10-21', 6, 40, { dateSource: 'programada' }),
      row('reg', '2026-10-22', 6, 40, { dateSource: 'registro' }),
      row('semfonte', '2026-10-23', 6, 40),
    ]);
    expect(Object.fromEntries(sessions.map((s) => [s.id, s.dateSource]))).toEqual({ real: 'atividade_vinculada', prog: 'programada', reg: 'registro', semfonte: 'programada' });
  });

  it('o resultado conta quantos treinos tem data real, so programada e so registro', () => {
    const result = buildTrainingLoad([
      row('a', '2026-10-20', 6, 40, { dateSource: 'atividade_vinculada' }), row('b', '2026-10-21', 6, 40, { dateSource: 'atividade_vinculada' }),
      row('c', '2026-10-22', 6, 40, { dateSource: 'programada' }), row('d', '2026-10-23', 6, 40, { dateSource: 'registro' }),
    ], { from: '2026-10-19', to: '2026-10-25' }, '2026-10-25');
    expect(result.sources).toMatchObject({ dateReal: 2, dateProgrammedOnly: 1, dateRegisteredOnly: 1 });
  });

  it('a carga cai na semana da data REAL: treino programado no domingo e executado na segunda entra na semana seguinte', () => {
    const result = buildTrainingLoad([row('x', '2026-10-26', 6, 60, { dateSource: 'atividade_vinculada' })], { from: '2026-10-19', to: '2026-11-01' }, '2026-11-01'); // programado dom 25/10, executado seg 26/10
    const byWeek = Object.fromEntries(result.views.geral.weeks.map((w) => [w.weekStart, w.load]));
    expect(byWeek).toEqual({ '2026-10-19': 0, '2026-10-26': 360 });
  });

  it('dia LOCAL da atividade: usa o deslocamento da propria fonte; sem deslocamento, Sao Paulo', () => {
    expect(activityLocalDate(new Date('2026-10-21T01:30:00Z'), -180)).toBe('2026-10-20'); // 22h30 do dia 20 em Sao Paulo
    expect(activityLocalDate(new Date('2026-10-21T01:30:00Z'), null)).toBe('2026-10-20');
    expect(activityLocalDate(new Date('2026-10-21T01:30:00Z'), 60)).toBe('2026-10-21'); // fuso de outro lugar: respeitado
  });
});

describe('AJUSTE 2 — separacao por modalidade', () => {
  it('agrupamento: corrida inclui esteira; forca inclui fortalecimento; o resto fica em outras', () => {
    expect(['corrida', 'esteira'].map(modalityGroup)).toEqual(['corrida', 'corrida']);
    expect(['forca', 'fortalecimento_corredores'].map(modalityGroup)).toEqual(['forca', 'forca']);
    expect(['caminhada', 'bike', null, undefined, ''].map((m) => modalityGroup(m))).toEqual(['outras', 'outras', 'outras', 'outras', 'outras']);
  });

  // 9 semanas de corrida (100 UA) + 9 semanas de forca (200 UA), todas as segundas e quintas.
  const mixed: LoadInputRow[] = [];
  for (let i = 0; i < 9; i += 1) {
    mixed.push(row(`c${i}`, new Date(Date.UTC(2026, 7, 31 + i * 7, 12)).toISOString().slice(0, 10), 5, 20));
    mixed.push(row(`f${i}`, new Date(Date.UTC(2026, 8, 3 + i * 7, 12)).toISOString().slice(0, 10), 5, 40, { modality: 'forca' }));
  }

  it('cada visao tem a SUA soma; a geral e a soma das modalidades (e esta identificada como tal)', () => {
    const result = buildTrainingLoad(mixed, { from: '2026-10-05', to: '2026-10-18' }, '2026-10-25');
    const total = (view: 'geral' | 'corrida' | 'forca' | 'outras') => result.views[view].totals;
    expect(total('corrida')).toEqual({ sessions: 2, excluded: 0, load: 200 });
    expect(total('forca')).toEqual({ sessions: 2, excluded: 0, load: 400 });
    expect(total('outras')).toEqual({ sessions: 0, excluded: 0, load: 0 });
    expect(total('geral').load).toBe(total('corrida').load + total('forca').load + total('outras').load);
    expect(result.method.generalViewNote).toMatch(/soma de cargas sRPE de modalidades diferentes/);
    expect(result.sessions.every((s) => s.group === 'corrida' || s.group === 'forca')).toBe(true);
  });

  it('a razao e a janela sao calculadas por modalidade, de forma independente', () => {
    const result = buildTrainingLoad(mixed, { from: '2026-10-12', to: '2026-10-18' }, '2026-10-25', 1);
    expect(result.views.corrida.current).toMatchObject({ acuteLoad: 100, chronicWeeklyAverage: 100, ratio: 1 });
    expect(result.views.forca.current).toMatchObject({ acuteLoad: 200, chronicWeeklyAverage: 200, ratio: 1 });
    expect(result.views.geral.current).toMatchObject({ acuteLoad: 300, chronicWeeklyAverage: 300, ratio: 1 });
    expect(result.views.outras.current.ratio).toBeNull();
  });

  it('uma semana so de forca nao aparece na carga da corrida (e vice-versa); os treinos de fora tambem sao agrupados', () => {
    const rows = [row('c', '2026-10-20', 6, 30), row('f', '2026-10-21', 7, 45, { modality: 'forca' }), row('fx', '2026-10-22', null, 45, { modality: 'forca' })];
    const result = buildTrainingLoad(rows, { from: '2026-10-19', to: '2026-10-25' }, '2026-10-30');
    expect(result.views.corrida.weeks[0]).toMatchObject({ load: 180, sessions: 1, excluded: 0 });
    expect(result.views.forca.weeks[0]).toMatchObject({ load: 315, sessions: 1, excluded: 1 });
    expect(result.excluded.map((e) => [e.id, e.group])).toEqual([['fx', 'forca']]);
  });
});

describe('AJUSTE 3 — duracao da atividade importada vinculada (com origem identificada)', () => {
  it('com atividade vinculada vale a duracao DELA (relogio); a informada so vale sem atividade; a origem fica registrada e a informada divergente aparece', () => {
    const { sessions } = classifySessions([
      row('inf', '2026-10-01', 6, 40, { activityDurationMin: 55, activityProvider: 'polar' }),
      row('sem', '2026-10-03', 6, 40),
      row('imp', '2026-10-02', 6, null, { activityDurationMin: 55.5, activityProvider: 'polar' }),
    ]);
    const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
    expect(byId.inf).toMatchObject({ minutes: 55, durationSource: 'atividade_importada', durationProvider: 'polar', informedMinutes: 40, load: 330 });
    expect(byId.imp).toMatchObject({ informedMinutes: null });
    expect(byId.imp).toMatchObject({ minutes: 55.5, durationSource: 'atividade_importada', durationProvider: 'polar', load: 333 });
    expect(byId.sem).toMatchObject({ minutes: 40, durationSource: 'informada', informedMinutes: null, load: 240 }); // sem atividade vale a informada
  });

  it('a atividade NAO substitui o esforco percebido: sem esforco continua de fora; sem duracao nem atividade continua de fora', () => {
    const { sessions, excluded } = classifySessions([
      row('a', '2026-10-01', null, null, { activityDurationMin: 50, activityProvider: 'zepp' }),
      row('b', '2026-10-02', 6, null, { activityDurationMin: null }),
      row('c', '2026-10-03', 6, null, { activityDurationMin: 0 }),
    ]);
    expect(sessions).toEqual([]);
    expect(Object.fromEntries(excluded.map((e) => [e.id, e.reason]))).toEqual({ a: 'sem_esforco', b: 'sem_duracao', c: 'sem_duracao' });
  });

  it('o resultado conta a origem da duracao (informada x importada)', () => {
    const result = buildTrainingLoad([
      row('a', '2026-10-20', 6, 40), row('b', '2026-10-21', 6, null, { activityDurationMin: 50, activityProvider: 'health_connect' }), row('c', '2026-10-22', 6, null, { activityDurationMin: 30, activityProvider: 'polar' }),
    ], { from: '2026-10-19', to: '2026-10-25' }, '2026-10-25');
    expect(result.sources).toMatchObject({ durationInformed: 1, durationImported: 2 });
  });
});

describe('aguda, cronica e razao', () => {
  // Um treino de 100 UA (esforco 5 x 20 min) a cada segunda-feira, por 9 semanas.
  const weekly = Array.from({ length: 9 }, (_, i) => row(`w${i}`, new Date(Date.UTC(2026, 7, 31 + i * 7, 12)).toISOString().slice(0, 10), 5, 20));
  const { sessions } = classifySessions(weekly);

  it('aguda = ultimos 7 dias; cronica = soma de 28 dias / 4; razao = aguda / cronica (1,00 = mesmo habito)', () => {
    const w = windowAt('2026-10-25', sessions, [], 1);
    expect(w.acuteLoad).toBe(100);
    expect(w.chronicLoad).toBe(400);
    expect(w.chronicWeeklyAverage).toBe(100);
    expect(w.ratio).toBe(1);
    expect(w.chronicDaysCovered).toBe(28);
  });

  it('semana mais carregada que o habito da razao maior que 1', () => {
    const spike = classifySessions([...weekly.slice(0, 5), row('x', '2026-10-05', 8, 60)]).sessions;
    const w = windowAt('2026-10-11', spike, [], 1);
    expect(w.acuteLoad).toBe(480);
    expect(w.chronicLoad).toBe(780);
    expect(w.chronicWeeklyAverage).toBe(195);
    expect(w.ratio).toBe(2.46);
  });

  it('MINIMO de 10 treinos nos 28 dias: com menos a razao NAO existe e a nota diz quantos ha; com 10 ou mais ela volta', () => {
    expect(MIN_SESSIONS_IN_WINDOW).toBe(10);
    const few = windowAt('2026-10-25', sessions, []);
    expect(few).toMatchObject({ ratio: null, sessionsInWindow: 4, minSessions: 10 });
    expect(few.note).toMatch(/Poucos treinos: só 4 de 10 nos últimos 28 dias/);
    const ten = classifySessions(Array.from({ length: 10 }, (_, i) => row('m' + i, new Date(Date.UTC(2026, 8, 13 + i * 2, 12)).toISOString().slice(0, 10), 5, 20))).sessions; // 13/09..01/10
    const edge = windowAt('2026-10-10', ten, []);
    expect(edge.sessionsInWindow).toBe(10);
    expect(edge.ratio).not.toBeNull();
    expect(windowAt('2026-10-10', ten.slice(1), []).ratio).toBeNull(); // 9 treinos: sem razao
  });

  it('historico curto (menos de 28 dias): a razao NAO existe e a tela diz quantos dias ha', () => {
    const w = windowAt('2026-09-14', sessions, []);
    expect(w.ratio).toBeNull();
    expect(w.chronicDaysCovered).toBe(15);
    expect(w.note).toMatch(/Histórico curto: só 15 de 28 dias/);
  });

  it('treinos de fora dentro dos 28 dias: a razao e calculada so com o que foi informado e a nota avisa', () => {
    const { excluded } = classifySessions([row('e', '2026-10-14', null, 40)]);
    const w = windowAt('2026-10-25', sessions, excluded, 1);
    expect(w.ratio).toBe(1);
    expect(w.excludedInWindow).toBe(1);
    expect(w.note).toMatch(/1 treino\(s\) dos últimos 28 dias ficaram de fora/);
  });

  it('cargas minusculas nao viram "sem carga" por arredondamento: a razao usa os valores sem arredondar', () => {
    const tiny = classifySessions(Array.from({ length: 5 }, (_, i) => row('t' + i, new Date(Date.UTC(2026, 8, 1 + i * 7, 12)).toISOString().slice(0, 10), 1, 0.2))).sessions;
    const w = windowAt('2026-10-05', tiny, [], 1);
    expect(w.chronicLoad).toBeGreaterThan(0);
    expect(w.ratio).not.toBeNull();
    expect(w.note).toBeNull();
  });

  it('sem nenhuma carga nos 28 dias: sem razao (nunca divide por zero)', () => {
    const w = windowAt('2027-03-01', sessions, [], 1);
    expect(w.ratio).toBeNull();
    expect(w.note).toMatch(/Sem carga registrada/);
  });

  it('nao ha faixa de risco nem recomendacao automatica: o resultado so traz numeros e notas descritivas', () => {
    const result = buildTrainingLoad(weekly, { from: '2026-10-05', to: '2026-10-25' }, '2026-10-25');
    // Os numeros e as notas das visoes nunca trazem faixa de risco, classificacao ou recomendacao (o texto do metodo so' diz que NAO ha).
    expect(JSON.stringify(result.views)).not.toMatch(/risco|recomend|sobrecarga|perigo|les[aã]o|reduzir|aumentar/i);
  });
});

describe('resultado completo (o que o painel mostra)', () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => row(`w${i}`, new Date(Date.UTC(2026, 7, 31 + i * 7, 12)).toISOString().slice(0, 10), 5, 20)),
    row('sem', '2026-10-14', null, 30),
  ];

  it('recorta so a EXIBICAO no periodo: a janela cronica da primeira semana ainda enxerga os 28 dias anteriores', () => {
    const result = buildTrainingLoad(rows, { from: '2026-10-19', to: '2026-10-25' }, '2026-10-30', 1);
    expect(result.sessions.map((s) => s.id)).toEqual(['w7']);
    expect(result.views.geral.weeks).toHaveLength(1);
    expect(result.views.geral.weeks[0]).toMatchObject({ weekStart: '2026-10-19', load: 100, sessions: 1, inProgress: false });
    expect(result.views.geral.weeks[0].window.ratio).toBe(1);
    expect(result.views.geral.totals).toEqual({ sessions: 1, excluded: 0, load: 100 });
  });

  it('semana em andamento e marcada; razao atual ate o dia de hoje; exemplo = treino mais recente que entrou; metodo e formula acompanham o resultado', () => {
    const result = buildTrainingLoad(rows, { from: '2026-10-05', to: '2026-10-30' }, '2026-10-22');
    expect(result.views.geral.weeks.map((w) => w.inProgress)).toEqual([false, false, true, true]);
    expect(result.views.geral.current.asOf).toBe('2026-10-22');
    expect(result.example).toEqual({ date: '2026-10-26', rpe: 5, minutes: 20, load: 100 });
    expect(result.excluded.map((e) => e.id)).toEqual(['sem']);
    expect(result.method.formula).toMatch(/esforço percebido \(1 a 10\) × minutos/);
    expect(result.method.leftOut.join(' ')).toMatch(/Atlas ainda não usa/);
    expect(result.method.version).toMatch(/carga-propria v2/);
    expect(result.method.steps.join(' ')).toMatch(/sem risco|não há faixa de risco/i);
  });

  it('periodo que CORTA a semana: a barra soma so os dias dentro do periodo (bate com a lista) e a semana vem marcada como recortada', () => {
    const inside = [row('d1', '2026-10-20', 5, 40), row('d2', '2026-10-22', 6, 30), row('d3', '2026-10-24', 7, 60)];
    const result = buildTrainingLoad(inside, { from: '2026-10-21', to: '2026-10-23' }, '2026-10-30');
    expect(result.sessions.map((s) => s.id)).toEqual(['d2']);
    expect(result.views.geral.weeks).toHaveLength(1);
    expect(result.views.geral.weeks[0]).toMatchObject({ weekStart: '2026-10-19', clipped: true, load: 180, sessions: 1 });
    expect(result.views.geral.weeks[0].load).toBe(result.views.geral.totals.load);
    expect(result.views.geral.weeks[0].window.asOf).toBe('2026-10-23');
  });

  it('semana inteira dentro do periodo nao e recortada', () => {
    const result = buildTrainingLoad([row('d', '2026-10-21', 5, 40)], { from: '2026-10-19', to: '2026-10-25' }, '2026-10-30');
    expect(result.views.geral.weeks[0].clipped).toBe(false);
  });

  it('sem nenhum treino: tudo vazio e sem razao', () => {
    const result = buildTrainingLoad([], { from: '2026-10-01', to: '2026-10-30' }, '2026-10-30');
    expect(result.sessions).toEqual([]);
    expect(result.example).toBeNull();
    expect(result.views.geral.current.ratio).toBeNull();
  });
});

describe('servico: registros informados + atividade importada confirmada', () => {
  const completion = (id: string, over: Record<string, unknown> = {}) => ({
    id, sessionId: `s-${id}`, completedAt: new Date('2026-10-20T15:00:00Z'), status: 'done', durationMin: 40, perceivedEffort: 6,
    session: { scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'corrida', title: 'Rodagem', structure: {} }, ...over,
  });
  const activity = (id: string, over: Record<string, unknown> = {}) => ({
    id, provider: 'polar', startedAt: new Date('2026-10-21T13:00:00Z'), utcOffsetMinutes: -180, durationSec: 3300,
    physicalIdentityStatus: null, physicalEventId: null, physicalCanonicalActivityLogId: null, ...over,
  });
  function service(completions: unknown[], links: Array<{ trainingSessionId: string; origin?: string; activityLog: unknown }> = [], exists = true, canonicalById: Record<string, unknown> = {}) {
    const findMany = jest.fn().mockResolvedValue(completions);
    const linkFindMany = jest.fn().mockResolvedValue(links);
    const activityFindMany = jest.fn(async (args: { where: { id: { in: string[] } } }) => args.where.id.in.map((id) => canonicalById[id]).filter(Boolean));
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(exists ? { id: 's1' } : null) }, workoutCompletion: { findMany }, sessionExecutionLink: { findMany: linkFindMany }, activityLog: { findMany: activityFindMany } };
    return { service: new StudentTrainingLoadService(prisma as never), findMany, linkFindMany };
  }
  const run = (svc: StudentTrainingLoadService) => svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });

  it('le so treinos feitos ou ajustados; sem sessao, usa o dia do registro (marcado "registro") em horario de Sao Paulo', async () => {
    const { service: svc, findMany } = service([completion('a'), completion('b', { sessionId: null, session: null, completedAt: new Date('2026-10-22T02:00:00Z') })]);
    const result = await run(svc);
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 's1', status: { in: ['done', 'adjusted'] } });
    expect(result.sessions.map((s) => [s.id, s.date, s.dateSource])).toEqual([['a', '2026-10-20', 'programada'], ['b', '2026-10-21', 'registro']]);
    expect(result.sessions[0].load).toBe(240);
  });

  it('AJUSTE 1: com atividade vinculada ATIVA, a data e a real (dia local da atividade), nao a programada', async () => {
    const { service: svc, linkFindMany } = service([completion('a')], [{ trainingSessionId: 's-a', activityLog: activity('act1') }]);
    const result = await run(svc);
    expect(linkFindMany.mock.calls[0][0].where).toMatchObject({ userId: 's1', status: 'active', trainingSessionId: { in: ['s-a'] } });
    expect(result.sessions[0]).toMatchObject({ date: '2026-10-21', dateSource: 'atividade_vinculada' }); // programada era 20/10
  });

  it('AJUSTE 3: com atividade vinculada vale a duracao dela (e mostra a informada); sem atividade vale a informada; identifica a origem', async () => {
    const informed = service([completion('a', { durationMin: 40 })], [{ trainingSessionId: 's-a', activityLog: activity('act1') }]);
    expect((await run(informed.service)).sessions[0]).toMatchObject({ minutes: 55, durationSource: 'atividade_importada', informedMinutes: 40 });
    const noLink = service([completion('a', { durationMin: 40 })]);
    expect((await run(noLink.service)).sessions[0]).toMatchObject({ minutes: 40, durationSource: 'informada', informedMinutes: null });
    const missing = service([completion('a', { durationMin: null })], [{ trainingSessionId: 's-a', activityLog: activity('act1', { provider: 'health_connect', durationSec: 3330 }) }]);
    expect((await run(missing.service)).sessions[0]).toMatchObject({ minutes: 55.5, durationSource: 'atividade_importada', durationProvider: 'health_connect', load: 333 });
  });

  it('sem duplicar: dois registros do MESMO evento fisico (Polar + Health Connect) valem uma vez, pela observacao canonica', async () => {
    const polar = activity('p1', { provider: 'polar', durationSec: 3300, physicalIdentityStatus: 'matched', physicalEventId: 'ev1', physicalCanonicalActivityLogId: 'p1' });
    const hc = activity('h1', { provider: 'health_connect', durationSec: 3000, physicalIdentityStatus: 'matched', physicalEventId: 'ev1', physicalCanonicalActivityLogId: 'p1' });
    const { service: svc } = service([completion('a', { durationMin: null })], [{ trainingSessionId: 's-a', activityLog: polar }, { trainingSessionId: 's-a', activityLog: hc }], true, { p1: polar });
    const result = await run(svc);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ minutes: 55, durationProvider: 'polar' }); // 3300 s da canonica, nao os 3000 s do outro registro
  });

  it('AMBIGUO: dois eventos fisicos DISTINTOS vinculados ao mesmo treino => nenhuma atividade e usada (a data fica a programada e a duracao ausente)', async () => {
    const { service: svc } = service([completion('a', { durationMin: null })], [{ trainingSessionId: 's-a', activityLog: activity('x1') }, { trainingSessionId: 's-a', activityLog: activity('x2', { durationSec: 1200 }) }]);
    const result = await run(svc);
    expect(result.sessions).toEqual([]);
    expect(result.excluded[0]).toMatchObject({ reason: 'sem_duracao', dateSource: 'programada', date: '2026-10-20' });
  });

  it('a mesma atividade nunca serve a dois treinos (so o primeiro, na ordem de registro, usa)', async () => {
    const shared = activity('same');
    const { service: svc } = service(
      [completion('a', { durationMin: null, completedAt: new Date('2026-10-21T10:00:00Z') }), completion('b', { sessionId: 's-b', durationMin: null, completedAt: new Date('2026-10-22T10:00:00Z') })],
      [{ trainingSessionId: 's-a', activityLog: shared }, { trainingSessionId: 's-b', activityLog: shared }],
    );
    const result = await run(svc);
    expect(result.sessions.map((s) => s.id)).toEqual(['a']);
    expect(result.excluded.map((e) => [e.id, e.reason])).toEqual([['b', 'sem_duracao']]);
  });

  it('dados do Strava nunca sao usados (nem a data nem a duracao)', async () => {
    const { service: svc } = service([completion('a', { durationMin: null })], [{ trainingSessionId: 's-a', activityLog: activity('st', { provider: 'strava' }) }]);
    const result = await run(svc);
    expect(result.sessions).toEqual([]);
    expect(result.excluded[0].dateSource).toBe('programada');
  });

  it('o esforco percebido nunca vem da atividade: sem esforco continua de fora mesmo com atividade vinculada', async () => {
    const { service: svc } = service([completion('a', { perceivedEffort: null })], [{ trainingSessionId: 's-a', activityLog: activity('act1') }]);
    expect((await run(svc)).excluded[0]).toMatchObject({ reason: 'sem_esforco', dateSource: 'atividade_vinculada' });
  });

  it('VINCULO DISTANTE (automatico: mais de 3 dias; confirmado por pessoa: mais de 6) e ignorado: vale a data programada e a tela avisa; o deslocamento normal e mostrado', async () => {
    const far = service([completion('a', { durationMin: null })], [{ trainingSessionId: 's-a', activityLog: activity('far', { startedAt: new Date('2026-11-05T13:00:00Z') }) }]);
    const ignored = (await far.service.forStudent('s1', { from: '2026-10-01', to: '2026-11-10' })).excluded[0];
    expect(ignored).toMatchObject({ dateSource: 'programada', date: '2026-10-20', activityNote: 'vinculo_distante', reason: 'sem_duracao' });
    const near = service([completion('a')], [{ trainingSessionId: 's-a', activityLog: activity('near') }]); // executado 21/10, programado 20/10
    const auto4 = service([completion('a')], [{ trainingSessionId: 's-a', origin: 'automatic', activityLog: activity('auto4', { startedAt: new Date('2026-10-24T13:00:00Z') }) }]); // 4 dias, automatico
    expect((await run(auto4.service)).sessions[0]).toMatchObject({ dateSource: 'programada', date: '2026-10-20', activityNote: 'vinculo_distante' });
    const auto3 = service([completion('a')], [{ trainingSessionId: 's-a', origin: 'automatic', activityLog: activity('auto3', { startedAt: new Date('2026-10-23T13:00:00Z') }) }]); // 3 dias: ainda vale
    expect((await run(auto3.service)).sessions[0]).toMatchObject({ dateSource: 'atividade_vinculada', date: '2026-10-23', shiftDays: 3 });
    const early = (day: string) => completion('a', { session: { scheduledDate: new Date(`${day}T00:00:00Z`), modality: 'corrida', title: 'Rodagem', structure: {} } });
    const person4 = service([early('2026-10-18')], [{ trainingSessionId: 's-a', origin: 'student', activityLog: activity('person4', { startedAt: new Date('2026-10-22T13:00:00Z') }) }]); // 4 dias confirmado pela aluna
    expect((await run(person4.service)).sessions[0]).toMatchObject({ dateSource: 'atividade_vinculada', date: '2026-10-22', shiftDays: 4, activityNote: 'vinculo_confirmado' });
    const person7 = service([early('2026-10-14')], [{ trainingSessionId: 's-a', origin: 'coach', activityLog: activity('person7', { startedAt: new Date('2026-10-22T13:00:00Z') }) }]); // 8 dias: alem do limite
    expect((await run(person7.service)).sessions[0]).toMatchObject({ dateSource: 'programada', activityNote: 'vinculo_distante' });
    expect((await run(near.service)).sessions[0]).toMatchObject({ dateSource: 'atividade_vinculada', scheduledDate: '2026-10-20', shiftDays: 1, activityNote: null });
  });

  it('fuso presumido: sem deslocamento informado o dia local e o de Sao Paulo e isso fica marcado; com deslocamento nao', async () => {
    const assumed = service([completion('a')], [{ trainingSessionId: 's-a', activityLog: activity('z1', { utcOffsetMinutes: null }) }]);
    expect((await run(assumed.service)).sessions[0].dateZoneAssumed).toBe(true);
    const informed = service([completion('a')], [{ trainingSessionId: 's-a', activityLog: activity('z2', { utcOffsetMinutes: -180 }) }]);
    expect((await run(informed.service)).sessions[0].dateZoneAssumed).toBe(false);
  });

  it('a mesma atividade em dois treinos: fica com o de dia programado MAIS PROXIMO (nao o registrado primeiro); o outro recebe aviso', async () => {
    const shared = activity('same', { startedAt: new Date('2026-10-22T13:00:00Z') }); // executada em 22/10
    const farther = completion('far', { sessionId: 's-far', completedAt: new Date('2026-10-20T10:00:00Z'), durationMin: null, session: { scheduledDate: new Date('2026-10-19T00:00:00Z'), modality: 'corrida', title: 'Longe', structure: {} } });
    const closer = completion('close', { sessionId: 's-close', completedAt: new Date('2026-10-23T10:00:00Z'), durationMin: null, session: { scheduledDate: new Date('2026-10-22T00:00:00Z'), modality: 'corrida', title: 'Perto', structure: {} } });
    const { service: svc } = service([farther, closer], [{ trainingSessionId: 's-far', activityLog: shared }, { trainingSessionId: 's-close', activityLog: shared }]);
    const result = await run(svc);
    expect(result.sessions.map((s) => s.id)).toEqual(['close']); // o registrado primeiro NAO ganha: ganha o mais proximo
    expect(result.excluded[0]).toMatchObject({ id: 'far', activityNote: 'atividade_ja_usada', dateSource: 'programada' });
  });

  it('SESSAO EXTRA materializada de atividade: a duracao e rotulada como da atividade (nao "informada pela aluna") e a data e a da atividade', async () => {
    const extra = completion('x', {
      source: 'device_extra', durationMin: 50, completedAt: new Date('2026-10-22T13:00:00Z'),
      session: { scheduledDate: new Date('2026-10-22T00:00:00Z'), modality: 'corrida', title: 'corrida (extra · polar)', structure: { type: 'extra', source: 'device', provider: 'polar' } },
    });
    const { service: svc } = service([extra]);
    expect((await run(svc)).sessions[0]).toMatchObject({ durationSource: 'atividade_importada', durationProvider: 'polar', dateSource: 'atividade_vinculada', isExtra: true, minutes: 50 });
  });

  it('modalidade bruta do provedor (RUNNING) cai no grupo certo pela modalidade canonica', async () => {
    const { service: svc } = service([completion('a', { session: { scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'RUNNING', title: 'x', structure: {} } })]);
    expect((await run(svc)).sessions[0].group).toBe('corrida');
  });

  it('treino extra da aluna e identificado; modalidade vai para o grupo certo', async () => {
    const { service: svc } = service([completion('a', { session: { scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'forca', title: 'Extra', structure: { source: 'student', type: 'extra' } } })]);
    const result = await run(svc);
    expect(result.sessions[0]).toMatchObject({ isExtra: true, group: 'forca' });
    expect(result.views.forca.totals.sessions).toBe(1);
  });

  it('periodo no futuro e limitado a hoje; padrao = 12 semanas; datas invalidas viram 400; aluno inexistente vira 404', async () => {
    const { service: svc } = service([]);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const future = await svc.forStudent('s1', { from: today, to: '2099-12-31' });
    expect(future.period.to).toBe(today);
    const def = await svc.forStudent('s1', {});
    expect(def.period.from).toBe(new Date(new Date(today + 'T12:00:00Z').getTime() - 83 * 86_400_000).toISOString().slice(0, 10));
    await expect(svc.forStudent('s1', { from: 'ontem' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.forStudent('s1', { from: '2026-10-30', to: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service([], [], false).service.forStudent('x', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('estrutura: somente leitura, restrito ao treinador e fora do Atlas', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', 'src', ...parts), 'utf8');

  it('nada grava no banco e a rota esta no controller do treinador', () => {
    for (const file of ['student-training-load.service.ts', 'training-load.ts']) expect(read('coach', file)).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw)\s*\(/);
    const controller = read('coach', 'coach.controller.ts');
    expect(controller).toMatch(/@Roles\('coach', 'admin'\)\s*\n?\s*@Controller\('coach'\)/);
    expect(controller).toContain("@Get('students/:studentId/training-load')");
    expect(read('coach', 'coach.module.ts')).toContain('StudentTrainingLoadService');
  });

  it('a carga propria NAO esta ligada ao Atlas: nenhum arquivo da IA importa o calculo', () => {
    for (const dir of ['training-plans', 'training-intelligence', 'technical-manager', 'reassessment', 'evolution', 'reporter']) {
      for (const file of ['prescription-agent.service.ts', 'training-plans.service.ts', 'athlete-state-snapshot.service.ts', 'compact-agent-context.ts', 'observation-reader.service.ts', 'variable-registry.ts']) {
        try { expect(read(dir, file)).not.toMatch(/training-load'|coach\/training-load|student-training-load/); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
  });

  it('a leitura da atividade importada so usa vinculo ativo e a observacao canonica (sem tocar em tokens)', () => {
    const service = read('coach', 'student-training-load.service.ts');
    expect(service).toContain("status: 'active'");
    expect(service).toContain('pickCanonicalPerEvent');
    expect(service).toContain("COACH_HIDDEN_PROVIDERS = ['strava']");
    expect(service).not.toMatch(/accessToken|refreshToken|providerMetrics|raw/i);
  });
});
