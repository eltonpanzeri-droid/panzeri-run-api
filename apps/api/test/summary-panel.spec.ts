import 'reflect-metadata';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { buildCurrentWeek, buildSummaryPanel, longestActiveWeekStreak } from '../src/evolution/summary-panel';
import type { RawRealizedActivity, RawSessionData } from '../src/evolution/evolution.types';

// Painel de resumo da tela inicial (14/11/2026, lista de Elton): período livre nos itens que fazem sentido; semanas desde que entrou, semana com mais km e recorde de semanas ativas sempre desde o início.
// A SEMANA EM CURSO nunca entra nos números gerais; ela tem a própria seção (semanaAtual).
const TODAY = '2026-10-10'; // sábado; semana atual = 05/10 a 11/10; última semana fechada termina em 04/10
const session = (date: string, overrides: Partial<RawSessionData> = {}): RawSessionData => ({
  sessionId: `s-${date}-${Math.random()}`, scheduledDate: date, modality: 'corrida', completionStatus: 'done', completionDate: date, perceivedEffort: 5, distanceKm: 10,
  plannedDistanceKm: 10, isExtra: false, isPrescribed: true, origin: null, hasActiveLink: false, ...overrides,
});
const activity = (date: string, km: number, classification: 'corresponding' | 'alternative' = 'corresponding'): RawRealizedActivity => ({ id: `a-${date}`, isoDate: date, classification, distanceKm: km });
const statusOf = (s: RawSessionData) => (s.hasActiveLink || s.completionStatus === 'done' || s.completionStatus === 'adjusted' ? 'feita' : s.completionStatus === 'missed' ? 'nao_feita' : s.scheduledDate >= TODAY ? 'futura' : 'sem_registro') as 'feita' | 'nao_feita' | 'sem_registro' | 'futura';
const none = { from: null, to: null };

describe('painel de resumo (semanas fechadas)', () => {
  const sessions = [
    session('2026-09-07'), session('2026-09-09', { modality: 'forca', distanceKm: null }), // semana 1: 2 treinos
    // semana 2 (09-14): nada
    session('2026-09-22'), session('2026-09-29'), // semanas 3 e 4 seguidas
    session('2026-10-06'), // SEMANA EM CURSO: fica fora dos números gerais
    session('2026-10-08', { completionStatus: 'missed' }),
    session('2026-10-20'), // futuro: não conta
  ];

  it('sem período: tudo desde o início, SEM a semana em curso — treinos, modalidade, km, média e os itens sem período', () => {
    const p = buildSummaryPanel(sessions, [], TODAY, none, statusOf);
    expect(p.period).toEqual({ from: null, to: '2026-10-04', isAll: true });
    expect(p.treinosFeitos).toBe(4); // o treino de 06/10 (semana em curso) não entra
    expect(p.porModalidade).toEqual([{ modality: 'corrida', count: 3 }, { modality: 'forca', count: 1 }]);
    expect(p.kmPercorridos).toBe(30);
    expect(p.semanasComKm).toBe(3);
    expect(p.mediaKmPorSemana).toBe(10);
    expect(p.semanasDesdeQueEntrou).toBe(4); // de 07/09 até a última semana fechada (28/09)
    expect(p.semanaComMaisKm).toEqual({ km: 10, weekStart: '2026-09-07' });
    expect(p.recordeSemanasAtivas).toBe(2); // semanas 22/09 e 29/09 (a de 14/09 vazia quebra; a em curso não conta)
  });

  it('com período livre: filtra treinos, modalidade, km e média; os itens sem período NÃO mudam; o fim nunca passa da última semana fechada', () => {
    const p = buildSummaryPanel(sessions, [], TODAY, { from: '2026-09-22', to: '2026-10-09' }, statusOf);
    expect(p.period).toEqual({ from: '2026-09-22', to: '2026-10-04', isAll: false });
    expect(p.treinosFeitos).toBe(2);
    expect(p.kmPercorridos).toBe(20);
    expect(p.porModalidade).toEqual([{ modality: 'corrida', count: 2 }]);
    const all = buildSummaryPanel(sessions, [], TODAY, none, statusOf);
    expect(p.semanasDesdeQueEntrou).toBe(all.semanasDesdeQueEntrou);
    expect(p.semanaComMaisKm).toEqual(all.semanaComMaisKm);
    expect(p.recordeSemanasAtivas).toBe(all.recordeSemanasAtivas);
  });

  it('período dentro da semana em curso devolve zeros e média nula; período sem treinos também', () => {
    expect(buildSummaryPanel(sessions, [], TODAY, { from: '2026-10-05', to: '2026-12-31' }, statusOf).treinosFeitos).toBe(0);
    const empty = buildSummaryPanel(sessions, [], TODAY, { from: '2026-01-01', to: '2026-01-31' }, statusOf);
    expect(empty).toMatchObject({ treinosFeitos: 0, kmPercorridos: 0, mediaKmPorSemana: null, semanasComKm: 0 });
  });

  it('esteira conta como corrida, extra da aluna conta como treino feito, aluna sem dados tem tudo zerado', () => {
    const p = buildSummaryPanel([session('2026-09-29', { modality: 'esteira' }), session('2026-09-30', { isExtra: true, isPrescribed: false })], [], TODAY, none, statusOf);
    expect(p.porModalidade).toEqual([{ modality: 'corrida', count: 2 }]);
    const nobody = buildSummaryPanel([], [], TODAY, none, statusOf);
    expect(nobody).toMatchObject({ treinosFeitos: 0, kmPercorridos: 0, semanasDesdeQueEntrou: 0, semanaComMaisKm: null, recordeSemanasAtivas: 0 });
  });

  it('atividade do relógio entra nos km e na semana ativa; feedback manual com atividade vinculada não conta km duas vezes', () => {
    const linked = session('2026-09-29', { hasActiveLink: true, distanceKm: 12 });
    const p = buildSummaryPanel([linked], [activity('2026-09-29', 12.3)], TODAY, none, statusOf);
    expect(p.kmPercorridos).toBe(12.3);
    const onlyActivity = buildSummaryPanel([], [activity('2026-09-29', 5, 'alternative')], TODAY, none, statusOf);
    expect(onlyActivity.recordeSemanasAtivas).toBe(1);
    expect(onlyActivity.semanaComMaisKm?.km).toBe(5);
  });

  it('recorde de semanas seguidas: a sequência é por semanas do calendário', () => {
    expect(longestActiveWeekStreak(new Set(['2026-09-07', '2026-09-14', '2026-09-28']))).toBe(2);
    expect(longestActiveWeekStreak(new Set())).toBe(0);
    expect(longestActiveWeekStreak(new Set(['2026-09-07']))).toBe(1);
  });

  it('o km total do painel (sem período, semanas fechadas) é o MESMO que a Evolução soma semana a semana (uma matemática só)', () => {
    const service = new EvolutionMetricService({} as never);
    const mixed = [session('2026-09-08', { distanceKm: 8 }), session('2026-09-16', { distanceKm: 6.5, isExtra: true, isPrescribed: false }), session('2026-09-23', { hasActiveLink: true, distanceKm: 10 })];
    const acts = [activity('2026-09-23', 10.2), activity('2026-10-01', 4.4, 'alternative')];
    const weekly = (service as unknown as { buildWeeklyVolumes: (...a: unknown[]) => Array<{ kmPercorridos: number | null }> }).buildWeeklyVolumes(mixed, acts, TODAY, false);
    const weeklySum = weekly.reduce((acc, w) => acc + (w.kmPercorridos ?? 0), 0);
    const p = buildSummaryPanel(mixed, acts, TODAY, none, statusOf);
    expect(p.kmPercorridos).toBeCloseTo(Math.round(weeklySum * 10) / 10, 5);
  });
});

describe('semana atual (seção própria)', () => {
  // semana de 05/10 a 11/10; hoje é sábado 10/10 (resta 2 dias: sábado e domingo)
  const week = [
    session('2026-10-05', { plannedDistanceKm: 10, distanceKm: 10 }),
    session('2026-10-06', { modality: 'forca', plannedDistanceKm: null, distanceKm: null }),
    session('2026-10-08', { plannedDistanceKm: 12, distanceKm: 11 }),
    session('2026-10-09', { completionStatus: null, plannedDistanceKm: 8, distanceKm: null }), // prescrito ainda não feito
    session('2026-10-11', { completionStatus: null, plannedDistanceKm: 20, distanceKm: null }), // domingo
    session('2026-10-07', { isExtra: true, isPrescribed: false, plannedDistanceKm: null, distanceKm: 5 }), // extra da aluna
    session('2026-09-29'), // semana anterior: fora
  ];

  it('treinos feitos (por modalidade), km corridos, quanto falta de treino e de km, dias restantes e extras', () => {
    const w = buildCurrentWeek(week, [], TODAY, statusOf);
    expect(w.weekStart).toBe('2026-10-05');
    expect(w.weekEnd).toBe('2026-10-11');
    expect(w.diasRestantes).toBe(2);
    expect(w.treinosFeitos).toBe(4); // 05, 06, 07 (extra), 08
    expect(w.porModalidade).toEqual([{ modality: 'corrida', count: 3 }, { modality: 'forca', count: 1 }]);
    expect(w.treinosPrescritos).toBe(5);
    expect(w.prescritosFeitos).toBe(3);
    expect(w.treinosFaltam).toBe(2);
    expect(w.extrasFeitos).toBe(1);
    expect(w.kmRealizados).toBe(26); // 10 + 11 + 5 (extra)
    expect(w.kmPrescritos).toBe(50);
    expect(w.kmFaltam).toBe(24);
    expect(w.kmAlemDoPrescrito).toBe(0);
  });

  it('passou do prescrito: km que faltam = 0 e mostra o quanto passou; semana sem km prescrito: km que faltam nulo; semana sem nada: zeros', () => {
    const over = buildCurrentWeek([session('2026-10-05', { plannedDistanceKm: 10, distanceKm: 14 })], [], TODAY, statusOf);
    expect(over).toMatchObject({ kmFaltam: 0, kmAlemDoPrescrito: 4, treinosFaltam: 0 });
    const noKm = buildCurrentWeek([session('2026-10-05', { modality: 'forca', plannedDistanceKm: null, distanceKm: null })], [], TODAY, statusOf);
    expect(noKm.kmPrescritos).toBeNull();
    expect(noKm.kmFaltam).toBeNull();
    expect(buildCurrentWeek([], [], TODAY, statusOf)).toMatchObject({ treinosFeitos: 0, treinosPrescritos: 0, kmRealizados: 0, kmPrescritos: null });
  });

  it('o painel devolve a semana atual junto, e a semana atual não entra nos números gerais', () => {
    const p = buildSummaryPanel(week, [], TODAY, none, statusOf);
    expect(p.semanaAtual.treinosFeitos).toBe(4);
    expect(p.treinosFeitos).toBe(1); // só o treino de 29/09
  });

  it('em uma segunda-feira a semana atual está vazia e a anterior inteira vai para os números gerais', () => {
    const monday = '2026-10-12';
    const p = buildSummaryPanel(week, [], monday, none, (s) => statusOf(s));
    expect(p.semanaAtual.weekStart).toBe('2026-10-12');
    expect(p.semanaAtual.diasRestantes).toBe(7);
    expect(p.semanaAtual.treinosFeitos).toBe(0);
    expect(p.treinosFeitos).toBe(5); // 29/09 + as 4 da semana de 05/10
  });
});
