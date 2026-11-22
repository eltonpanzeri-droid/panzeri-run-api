import { planGeneratedEmail } from '../src/training-plans/plan-generated-notice';
import { kmComparison, recognitionLine, shortObjective, weeklyEmailHtml, weeklyEmailText, type WeeklyEmailData, type WeeklyEmailLastWeek } from '../src/training-plans/weekly-email';
import { collectWeeklyEmailData } from '../src/training-plans/weekly-email-data';

// 22/11/2026 — e-mail do programa da semana: cartoes e barras em HTML, com resumo da semana passada e o objetivo de cada treino.
const last = (over: Partial<WeeklyEmailLastWeek> = {}): WeeklyEmailLastWeek => ({ prescribed: 4, done: 3, km: 31.4, minutes: 205, longestKm: 16, previousKm: 27.2, kmByWeekday: [0, 8, 0, 7.4, 0, 16, 0], unregistered: 1, medals: ['10 km em um treino'], ...over });
const data = (over: Partial<WeeklyEmailData> = {}): WeeklyEmailData => ({
  goal: 'Correr 10 km com conforto', weekLabel: '23/11 a 29/11', lastWeek: last(), appUrl: 'https://panzerirun.eltonpanzeripersonal.com.br',
  days: [
    { weekdayLabel: 'Ter', dateLabel: '24/11', title: 'Corrida leve', durationMin: 40, distanceKm: 6, zone: 'Z2', objective: 'Criar base aeróbica sem cansar. Mantenha a conversa fácil.' },
    { weekdayLabel: 'Qui', dateLabel: '26/11', title: 'Musculação <b>', durationMin: 45, distanceKm: null, zone: null, objective: null },
  ], ...over,
});

describe('textos do e-mail', () => {
  it('reconhecimento acolhedor: tudo feito, parcial, nada feito e sem dados — nunca cobra', () => {
    expect(recognitionLine(last({ done: 4 }))).toContain('todos os treinos');
    expect(recognitionLine(last())).toContain('3 dos 4 treinos');
    expect(recognitionLine(last({ done: 0 }))).toContain('recomeçar');
    expect(recognitionLine(null)).toContain('nova chance');
    for (const line of [recognitionLine(last({ done: 0 })), recognitionLine(null)]) expect(line).not.toMatch(/falhou|não fez|culpa/i);
  });
  it('comparacao de km so quando ha dado nas duas semanas', () => {
    expect(kmComparison(last())).toBe('4,2 km a mais que na semana anterior.');
    expect(kmComparison(last({ previousKm: 40 }))).toBe('8,6 km a menos que na semana anterior.');
    expect(kmComparison(last({ previousKm: null }))).toBeNull();
    expect(kmComparison(last({ km: 0 }))).toBeNull();
    expect(kmComparison(last({ previousKm: 31.4 }))).toBe('Mesmo volume da semana anterior.');
  });
  it('objetivo: primeira frase, no maximo 150 caracteres; vazio vira null', () => {
    expect(shortObjective('Criar base aeróbica. Mantenha leve.')).toBe('Criar base aeróbica.');
    expect(shortObjective('   ')).toBeNull();
    expect(shortObjective('a'.repeat(300))!.length).toBeLessThanOrEqual(150);
  });
});

describe('HTML do e-mail', () => {
  const args = { firstName: 'Elton', data: data(), baseMessage: '1 treino da semana passada ficou sem registro.', appleWatchNote: null };
  it('tem os cartoes: semana passada (numeros, barra, grafico por dia, medalha), cada treino com objetivo, e o botao para abrir o Panzeri Run', () => {
    const html = weeklyEmailHtml(args);
    expect(html).toContain('3 <span');
    expect(html).toContain('de 4 treinos');
    expect(html).toContain('31,4 km');
    expect(html).toContain('3h25');
    expect(html).toContain('km por dia');
    expect(html).toContain('10 km em um treino');
    expect(html).toContain('4,2 km a mais');
    expect(html).toContain('Corrida leve');
    expect(html).toContain('Objetivo:');
    expect(html).toContain('Correr 10 km com conforto');
    expect(html).toContain('href="https://panzerirun.eltonpanzeripersonal.com.br"');
    expect(html).toContain('Abrir o Panzeri Run');
    expect(html).toContain('ficou sem registro'); // so' aparece quando ha treino sem registro
  });
  it('texto do aluno e do treino e escapado (nada vira HTML)', () => {
    expect(weeklyEmailHtml(args)).toContain('Musculação &lt;b&gt;');
    expect(weeklyEmailHtml({ ...args, firstName: '<script>x</script>' })).not.toContain('<script>');
  });
  it('semana passada sem dados: sem cartao de numeros, so a frase acolhedora; sem treino sem registro nao repete a cobranca', () => {
    const html = weeklyEmailHtml({ ...args, data: data({ lastWeek: null }) });
    expect(html).not.toContain('COMO FOI A SUA SEMANA');
    expect(html).toContain('nova chance');
    expect(weeklyEmailHtml({ ...args, data: data({ lastWeek: last({ unregistered: 0 }) }) })).not.toContain('ficou sem registro');
  });
  it('aviso do Apple Watch entra no HTML e no texto quando ha', () => {
    const note = 'Confira se os treinos chegaram ao seu Apple Watch.';
    expect(weeklyEmailHtml({ ...args, appleWatchNote: note })).toContain(note);
    expect(weeklyEmailText({ ...args, appleWatchNote: note })).toContain(note);
  });
  it('versao em texto traz o resumo e cada treino com objetivo', () => {
    const text = weeklyEmailText(args);
    expect(text).toContain('Como foi a sua semana: 3 de 4 treinos · 31,4 km · 3h25.');
    expect(text).toContain('- Ter 24/11: Corrida leve (40 min · 6 km · Z2). Objetivo: Criar base aeróbica sem cansar.');
  });
});

describe('planGeneratedEmail com e sem dados da semana', () => {
  it('com dados: devolve assunto, texto e HTML; sem dados: o texto simples de antes, sem HTML', () => {
    const rich = planGeneratedEmail({ name: 'Elton Panzeri', baseMessage: 'Parabéns!', usesAppleWatch: false, weekly: data() });
    expect(rich.subject).toBe('Seu novo programa de treino chegou');
    expect(rich.html).toContain('<!doctype html>');
    expect(rich.content).toContain('Olá Elton');
    const plain = planGeneratedEmail({ name: 'Elton Panzeri', baseMessage: 'Parabéns!', usesAppleWatch: false, weekly: null });
    expect(plain.html).toBeUndefined();
    expect(plain.content).toContain('Seu novo programa de treino da semana está pronto');
  });
});

describe('coleta dos numeros', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const prisma = (opts: { prev: any[]; prev2: any[]; links?: any[]; medals?: any[] }) => ({
    trainingSession: { findMany: jest.fn(async ({ where }: any) => (where.scheduledDate.gte.getTime() === d('2026-11-16').getTime() ? opts.prev : opts.prev2)) },
    sessionExecutionLink: { findMany: jest.fn(async () => opts.links ?? []) },
    userAchievement: { findMany: jest.fn(async () => opts.medals ?? []) },
  }) as never;
  const planned = [{ scheduledDate: d('2026-11-24'), weekday: 1, title: 'Corrida leve', durationMin: 40, distanceKm: 6, intensityZone: 'Z2', notes: 'Base aeróbica. Fácil.' }];

  it('soma o que foi feito (atividade vinculada vale mais que o feedback), conta so os prescritos e junta o treino extra no volume', async () => {
    const prev = [
      { id: 'a', origin: 'agent', weekday: 5, completion: { status: 'done', distanceKm: 15, durationMin: 95 } },
      { id: 'b', origin: 'agent', weekday: 1, completion: { status: 'missed', distanceKm: null, durationMin: null } },
      { id: 'c', origin: 'agent', weekday: 3, completion: null },
      { id: 'x', origin: 'device_extra', weekday: 5, completion: null },
    ];
    const links = [{ trainingSessionId: 'a', activityLog: { distanceMeters: 16000, durationSec: 6000 } }, { trainingSessionId: 'x', activityLog: { distanceMeters: 14000, durationSec: 5400 } }];
    const out = await collectWeeklyEmailData(prisma({ prev, prev2: [{ id: 'z', origin: 'agent', weekday: 2, completion: { status: 'done', distanceKm: 20, durationMin: 120 } }], links, medals: [{ achievement: { name: 'Constância' } }] }),
      { userId: 'u1', weekStart: d('2026-11-23'), sessions: planned, goal: 'Correr 10 km', appUrl: 'https://x' });
    expect(out!.lastWeek).toMatchObject({ prescribed: 3, done: 1, unregistered: 1, km: 30, minutes: 190, longestKm: 16, previousKm: 20, medals: ['Constância'] });
    expect(out!.lastWeek!.kmByWeekday[5]).toBe(30); // sabado: 16 km do treino + 14 km do extra
    expect(out!.days).toEqual([{ weekdayLabel: 'Ter', dateLabel: '24/11', title: 'Corrida leve', durationMin: 40, distanceKm: 6, zone: 'Z2', objective: 'Base aeróbica.' }]);
    expect(out!.weekLabel).toBe('23/11 a 29/11');
  });
  it('semana passada sem treinos: lastWeek nulo; falha no banco: devolve null (o e-mail simples sai)', async () => {
    const ok = await collectWeeklyEmailData(prisma({ prev: [], prev2: [] }), { userId: 'u1', weekStart: d('2026-11-23'), sessions: planned, goal: null, appUrl: 'https://x' });
    expect(ok!.lastWeek).toBeNull();
    const broken = { trainingSession: { findMany: jest.fn(async () => { throw new Error('banco fora'); }) }, sessionExecutionLink: { findMany: jest.fn() }, userAchievement: { findMany: jest.fn() } } as never;
    expect(await collectWeeklyEmailData(broken, { userId: 'u1', weekStart: d('2026-11-23'), sessions: planned, goal: null, appUrl: 'https://x' })).toBeNull();
  });
});
