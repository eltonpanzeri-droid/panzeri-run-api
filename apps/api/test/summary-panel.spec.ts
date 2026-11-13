import 'reflect-metadata';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { buildSummaryPanel, longestActiveWeekStreak } from '../src/evolution/summary-panel';
import type { RawRealizedActivity, RawSessionData } from '../src/evolution/evolution.types';

// Painel de resumo da tela inicial (14/11/2026, lista de Elton): período livre nos itens que fazem sentido; semanas desde que entrou, semana com mais km e recorde de semanas ativas sempre desde o início.
const TODAY = '2026-10-10'; // sábado; semana atual começa em 2026-10-05
const session = (date: string, overrides: Partial<RawSessionData> = {}): RawSessionData => ({
  sessionId: `s-${date}-${Math.random()}`, scheduledDate: date, modality: 'corrida', completionStatus: 'done', completionDate: date, perceivedEffort: 5, distanceKm: 10,
  plannedDistanceKm: 10, isExtra: false, isPrescribed: true, origin: null, hasActiveLink: false, ...overrides,
});
const activity = (date: string, km: number, classification: 'corresponding' | 'alternative' = 'corresponding'): RawRealizedActivity => ({ id: `a-${date}`, isoDate: date, classification, distanceKm: km });
const statusOf = (s: RawSessionData) => (s.hasActiveLink || s.completionStatus === 'done' || s.completionStatus === 'adjusted' ? 'feita' : s.completionStatus === 'missed' ? 'nao_feita' : s.scheduledDate >= TODAY ? 'futura' : 'sem_registro') as 'feita' | 'nao_feita' | 'sem_registro' | 'futura';
const none = { from: null, to: null };

describe('painel de resumo', () => {
  const sessions = [
    session('2026-09-07'), session('2026-09-09', { modality: 'forca', distanceKm: null }), // semana 1: 2 treinos
    // semana 2 (09-14): nada
    session('2026-09-22'), session('2026-09-29'), session('2026-10-06'), // semanas 3, 4 e 5 seguidas
    session('2026-10-08', { completionStatus: 'missed' }), // não feito: não conta
    session('2026-10-20'), // futuro: não conta
  ];

  it('sem período: tudo desde o início — treinos feitos, por modalidade, km, média e os três itens sem período', () => {
    const p = buildSummaryPanel(sessions, [], TODAY, none, statusOf);
    expect(p.period.isAll).toBe(true);
    expect(p.treinosFeitos).toBe(5);
    expect(p.porModalidade).toEqual([{ modality: 'corrida', count: 4 }, { modality: 'forca', count: 1 }]);
    expect(p.kmPercorridos).toBe(40);
    expect(p.semanasComKm).toBe(4);
    expect(p.mediaKmPorSemana).toBe(10);
    expect(p.semanasDesdeQueEntrou).toBe(5); // de 07/09 até a semana de 05/10
    expect(p.semanaComMaisKm).toEqual({ km: 10, weekStart: '2026-09-07' });
    expect(p.recordeSemanasAtivas).toBe(3); // semanas 22/09, 29/09 e 06/10 (semana de 14/09 vazia quebra)
  });

  it('com período livre: filtra treinos, modalidade, km e média; os itens sem período NÃO mudam', () => {
    const p = buildSummaryPanel(sessions, [], TODAY, { from: '2026-09-22', to: '2026-10-07' }, statusOf);
    expect(p.period).toEqual({ from: '2026-09-22', to: '2026-10-07', isAll: false });
    expect(p.treinosFeitos).toBe(3);
    expect(p.kmPercorridos).toBe(30);
    expect(p.porModalidade).toEqual([{ modality: 'corrida', count: 3 }]);
    const all = buildSummaryPanel(sessions, [], TODAY, none, statusOf);
    expect(p.semanasDesdeQueEntrou).toBe(all.semanasDesdeQueEntrou);
    expect(p.semanaComMaisKm).toEqual(all.semanaComMaisKm);
    expect(p.recordeSemanasAtivas).toBe(all.recordeSemanasAtivas);
  });

  it('período no futuro é cortado em hoje; período sem treinos devolve zeros e média nula', () => {
    expect(buildSummaryPanel(sessions, [], TODAY, { from: '2026-10-09', to: '2026-12-31' }, statusOf).treinosFeitos).toBe(0);
    const empty = buildSummaryPanel(sessions, [], TODAY, { from: '2026-01-01', to: '2026-01-31' }, statusOf);
    expect(empty).toMatchObject({ treinosFeitos: 0, kmPercorridos: 0, mediaKmPorSemana: null, semanasComKm: 0 });
  });

  it('esteira conta como corrida, extra da aluna conta como treino feito, aluna sem dados tem tudo zerado', () => {
    const p = buildSummaryPanel([session('2026-10-06', { modality: 'esteira' }), session('2026-10-07', { isExtra: true, isPrescribed: false })], [], TODAY, none, statusOf);
    expect(p.porModalidade).toEqual([{ modality: 'corrida', count: 2 }]);
    const nobody = buildSummaryPanel([], [], TODAY, none, statusOf);
    expect(nobody).toMatchObject({ treinosFeitos: 0, kmPercorridos: 0, semanasDesdeQueEntrou: 0, semanaComMaisKm: null, recordeSemanasAtivas: 0 });
  });

  it('atividade do relógio entra nos km e na semana ativa; feedback manual com atividade vinculada não conta km duas vezes', () => {
    const linked = session('2026-10-06', { hasActiveLink: true, distanceKm: 12 });
    const p = buildSummaryPanel([linked], [activity('2026-10-06', 12.3)], TODAY, none, statusOf);
    expect(p.kmPercorridos).toBe(12.3);
    const onlyActivity = buildSummaryPanel([], [activity('2026-10-06', 5, 'alternative')], TODAY, none, statusOf);
    expect(onlyActivity.recordeSemanasAtivas).toBe(1);
    expect(onlyActivity.semanaComMaisKm?.km).toBe(5);
  });

  it('recorde de semanas seguidas: a sequência é por semanas do calendário', () => {
    expect(longestActiveWeekStreak(new Set(['2026-09-07', '2026-09-14', '2026-09-28']))).toBe(2);
    expect(longestActiveWeekStreak(new Set())).toBe(0);
    expect(longestActiveWeekStreak(new Set(['2026-09-07']))).toBe(1);
  });

  it('o km total do painel (sem período) é o MESMO que a Evolução soma semana a semana (uma matemática só)', () => {
    const service = new EvolutionMetricService({} as never);
    const mixed = [session('2026-09-08', { distanceKm: 8 }), session('2026-09-16', { distanceKm: 6.5, isExtra: true, isPrescribed: false }), session('2026-09-23', { hasActiveLink: true, distanceKm: 10 })];
    const acts = [activity('2026-09-23', 10.2), activity('2026-10-01', 4.4, 'alternative')];
    const weekly = (service as unknown as { buildWeeklyVolumes: (...a: unknown[]) => Array<{ kmPercorridos: number | null }> }).buildWeeklyVolumes(mixed, acts, TODAY, false);
    const weeklySum = weekly.reduce((acc, w) => acc + (w.kmPercorridos ?? 0), 0);
    const p = buildSummaryPanel(mixed, acts, TODAY, none, statusOf);
    expect(p.kmPercorridos).toBeCloseTo(Math.round(weeklySum * 10) / 10, 5);
  });
});
