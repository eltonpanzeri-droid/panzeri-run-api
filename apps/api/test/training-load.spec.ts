import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { buildTrainingLoad, classifySessions, weekStartOf, windowAt, type LoadInputRow } from '../src/coach/training-load';
import { StudentTrainingLoadService } from '../src/coach/student-training-load.service';

// 23/10/2026 — Carga de treino PROPRIA (esforco percebido x minutos): metrica descritiva em avaliacao, com a conta inteira a mostra no painel. Dados sinteticos.

const row = (id: string, date: string, rpe: number | null, minutes: number | null, over: Partial<LoadInputRow> = {}): LoadInputRow => ({
  id, date, modality: 'corrida', title: `Treino ${id}`, status: 'done', durationMin: minutes, perceivedEffort: rpe, isExtra: false, ...over,
});

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

describe('aguda, cronica e razao', () => {
  // Um treino de 100 UA (esforco 5 x 20 min) a cada segunda-feira, por 9 semanas.
  const weekly = Array.from({ length: 9 }, (_, i) => row(`w${i}`, new Date(Date.UTC(2026, 7, 31 + i * 7, 12)).toISOString().slice(0, 10), 5, 20));
  const { sessions } = classifySessions(weekly);

  it('aguda = ultimos 7 dias; cronica = soma de 28 dias / 4; razao = aguda / cronica (1,00 = mesmo habito)', () => {
    const w = windowAt('2026-10-25', sessions, []); // ultimo treino: 2026-10-26? (nao entra) — a ultima segunda ate' 25/10 e' 19/10
    expect(w.acuteLoad).toBe(100);
    expect(w.chronicLoad).toBe(400);
    expect(w.chronicWeeklyAverage).toBe(100);
    expect(w.ratio).toBe(1);
    expect(w.chronicDaysCovered).toBe(28);
  });

  it('semana mais carregada que o habito da razao maior que 1', () => {
    const spike = classifySessions([...weekly.slice(0, 5), row('x', '2026-10-05', 8, 60)]).sessions; // treino extra de 480 UA na semana de 05/10
    const w = windowAt('2026-10-11', spike, []);
    expect(w.acuteLoad).toBe(480); // so' o treino de 5/10 (o treino semanal de 5/10 ficou de fora desta massa)
    expect(w.chronicLoad).toBe(780); // 14/09 + 21/09 + 28/09 (100 cada) + 480
    expect(w.chronicWeeklyAverage).toBe(195);
    expect(w.ratio).toBe(2.46);
  });

  it('historico curto (menos de 28 dias): a razao NAO existe e a tela diz quantos dias ha', () => {
    const w = windowAt('2026-09-14', sessions, []);
    expect(w.ratio).toBeNull();
    expect(w.chronicDaysCovered).toBe(15);
    expect(w.note).toMatch(/Histórico curto: só 15 de 28 dias/);
  });

  it('treinos de fora dentro dos 28 dias: a razao e calculada so com o que foi informado e a nota avisa', () => {
    const { excluded } = classifySessions([row('e', '2026-10-14', null, 40)]);
    const w = windowAt('2026-10-25', sessions, excluded);
    expect(w.ratio).toBe(1);
    expect(w.excludedInWindow).toBe(1);
    expect(w.note).toMatch(/1 treino\(s\) dos últimos 28 dias ficaram de fora/);
  });

  it('cargas minusculas nao viram "sem carga" por arredondamento: a razao usa os valores sem arredondar', () => {
    const tiny = classifySessions(Array.from({ length: 5 }, (_, i) => row('t' + i, new Date(Date.UTC(2026, 8, 1 + i * 7, 12)).toISOString().slice(0, 10), 1, 0.2))).sessions; // 0,2 UA cada
    const w = windowAt('2026-10-05', tiny, []);
    expect(w.chronicLoad).toBeGreaterThan(0);
    expect(w.ratio).not.toBeNull();
    expect(w.note).toBeNull();
  });

  it('sem nenhuma carga nos 28 dias: sem razao (nunca divide por zero)', () => {
    const w = windowAt('2027-03-01', sessions, []);
    expect(w.ratio).toBeNull();
    expect(w.note).toMatch(/Sem carga registrada/);
  });
});

describe('resultado completo (o que o painel mostra)', () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => row(`w${i}`, new Date(Date.UTC(2026, 7, 31 + i * 7, 12)).toISOString().slice(0, 10), 5, 20)),
    row('sem', '2026-10-14', null, 30),
  ];

  it('recorta so a EXIBICAO no periodo: a janela cronica da primeira semana ainda enxerga os 28 dias anteriores', () => {
    const result = buildTrainingLoad(rows, { from: '2026-10-19', to: '2026-10-25' }, '2026-10-30');
    expect(result.sessions.map((s) => s.id)).toEqual(['w7']);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0]).toMatchObject({ weekStart: '2026-10-19', load: 100, sessions: 1, inProgress: false });
    expect(result.weeks[0].window.ratio).toBe(1); // usa o historico antes de 19/10
    expect(result.totals).toEqual({ sessions: 1, excluded: 0, load: 100 });
  });

  it('semana em andamento e marcada; razao atual ate o dia de hoje; exemplo = treino mais recente que entrou; metodo e formula acompanham o resultado', () => {
    const result = buildTrainingLoad(rows, { from: '2026-10-05', to: '2026-10-30' }, '2026-10-22');
    expect(result.weeks.map((w) => w.inProgress)).toEqual([false, false, true, true].slice(0, result.weeks.length));
    expect(result.current.asOf).toBe('2026-10-22');
    expect(result.example).toEqual({ date: '2026-10-26', rpe: 5, minutes: 20, load: 100 });
    expect(result.excluded.map((e) => e.id)).toEqual(['sem']);
    expect(result.method.formula).toMatch(/esforço percebido \(1 a 10\) × minutos/);
    expect(result.method.leftOut.join(' ')).toMatch(/Atlas ainda não usa/);
    expect(result.method.version).toMatch(/carga-propria v1/);
  });

  it('periodo que CORTA a semana: a barra soma so os dias dentro do periodo (bate com a lista) e a semana vem marcada como recortada', () => {
    const inside = [row('d1', '2026-10-20', 5, 40), row('d2', '2026-10-22', 6, 30), row('d3', '2026-10-24', 7, 60)]; // seg 19/10: terca, quinta e sabado
    const result = buildTrainingLoad(inside, { from: '2026-10-21', to: '2026-10-23' }, '2026-10-30');
    expect(result.sessions.map((s) => s.id)).toEqual(['d2']);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0]).toMatchObject({ weekStart: '2026-10-19', clipped: true, load: 180, sessions: 1 });
    expect(result.weeks[0].load).toBe(result.totals.load); // barra = total do periodo = lista
    expect(result.weeks[0].window.asOf).toBe('2026-10-23');
  });

  it('semana inteira dentro do periodo nao e recortada', () => {
    const result = buildTrainingLoad([row('d', '2026-10-21', 5, 40)], { from: '2026-10-19', to: '2026-10-25' }, '2026-10-30');
    expect(result.weeks[0].clipped).toBe(false);
  });

  it('sem nenhum treino: tudo vazio e sem razao', () => {
    const result = buildTrainingLoad([], { from: '2026-10-01', to: '2026-10-30' }, '2026-10-30');
    expect(result.sessions).toEqual([]);
    expect(result.example).toBeNull();
    expect(result.current.ratio).toBeNull();
  });
});

describe('servico: leitura dos registros ja informados', () => {
  const completion = (id: string, over: Record<string, unknown> = {}) => ({
    id, completedAt: new Date('2026-10-20T15:00:00Z'), status: 'done', durationMin: 40, perceivedEffort: 6,
    session: { scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'corrida', title: 'Rodagem', structure: {} }, ...over,
  });
  function service(completions: unknown[], exists = true) {
    const findMany = jest.fn().mockResolvedValue(completions);
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(exists ? { id: 's1' } : null) }, workoutCompletion: { findMany } };
    return { service: new StudentTrainingLoadService(prisma as never), findMany };
  }

  it('le so treinos feitos ou ajustados e usa a data da sessao; sem sessao, a data local de Sao Paulo da conclusao', async () => {
    const { service: svc, findMany } = service([
      completion('a'),
      completion('b', { session: null, completedAt: new Date('2026-10-22T02:00:00Z') }), // 22/10 02:00 UTC = 21/10 23:00 em Sao Paulo
    ]);
    const result = await svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30' });
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 's1', status: { in: ['done', 'adjusted'] } });
    expect(result.sessions.map((s) => [s.id, s.date])).toEqual([['a', '2026-10-20'], ['b', '2026-10-21']]);
    expect(result.sessions[0].load).toBe(240);
  });

  it('a data do treino e o DIA AGENDADO: domingo registrado na segunda conta no domingo', async () => {
    const { service: svc } = service([completion('a', { completedAt: new Date('2026-10-19T12:00:00Z'), session: { scheduledDate: new Date('2026-10-18T00:00:00Z'), modality: 'corrida', title: 'Longao', structure: {} } })]);
    expect((await svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30' })).sessions[0].date).toBe('2026-10-18');
  });

  it('periodo no futuro e limitado a hoje (sem semanas futuras vazias)', async () => {
    const { service: svc } = service([]);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const result = await svc.forStudent('s1', { from: today, to: '2099-12-31' });
    expect(result.period.to).toBe(today);
    expect(result.weeks.every((w) => w.weekStart <= today)).toBe(true);
  });

  it('treino extra da aluna e identificado', async () => {
    const { service: svc } = service([completion('a', { session: { scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'corrida', title: 'Extra', structure: { source: 'student', type: 'extra' } } })]);
    expect((await svc.forStudent('s1', { from: '2026-10-01', to: '2026-10-30' })).sessions[0].isExtra).toBe(true);
  });

  it('datas invalidas viram 400, aluno inexistente vira 404; padrao = 12 semanas', async () => {
    const { service: svc } = service([]);
    await expect(svc.forStudent('s1', { from: 'ontem' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.forStudent('s1', { from: '2026-10-30', to: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service([], false).service.forStudent('x', {})).rejects.toBeInstanceOf(NotFoundException);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const result = await svc.forStudent('s1', {});
    expect(result.period.to).toBe(today);
    expect(result.period.from).toBe(new Date(new Date(today + 'T12:00:00Z').getTime() - 83 * 86_400_000).toISOString().slice(0, 10)); // 12 semanas
    expect((await svc.forStudent('s1', { to: '2026-10-01' })).period).toEqual({ from: '2026-07-10', to: '2026-10-01' }); // data passada: respeitada
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
});
