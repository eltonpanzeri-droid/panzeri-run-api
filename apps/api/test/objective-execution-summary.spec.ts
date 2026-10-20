import { summarizeSessions } from '../src/coach/coach.service';
import { mapHistorySession } from '../src/coach/history-session';
import { objectiveExecutionOf } from '../src/coach/objective-execution';

// Bug real 20/10/2026: semana de 12/10 com 10,15 km (ter, vinculado, sem feedback) + 10,0 + 5,5. Os graficos do painel somavam so' o feedback digitado (15,6 km) e
// mostravam a terca como "sem registro".
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const link = (id: string, meters: number, seconds: number) => ({ activityLog: { id, distanceMeters: meters, durationSec: seconds } });
const session = (id: string, iso: string, over: Record<string, unknown> = {}) => ({
  id, scheduledDate: day(iso), weekday: day(iso).getUTCDay(), title: 't', modality: 'corrida', durationMin: 50, distanceKm: 8, completion: null, executionLinks: [], ...over,
});

describe('execucao objetiva no resumo e no historico do painel', () => {
  const week = [
    session('a', '2026-10-13', { executionLinks: [link('x1', 10150, 2820)] }), // vinculado, sem feedback
    session('b', '2026-10-15', { completion: { status: 'done', distanceKm: 10 } }),
    session('c', '2026-10-17', { distanceKm: 5, completion: { status: 'done', distanceKm: 5.5 } }),
  ];

  it('soma o km do relogio mesmo sem feedback e conta o treino como feito', () => {
    const summary = summarizeSessions(week as never);
    expect(summary.completedKm).toBeCloseTo(25.65, 2);
    expect(summary.completedSessions).toBe(3);
    expect(summary.unregisteredSessions).toBe(0);
  });

  it('com vinculo e feedback de distancia digitada: prevalece o km do relogio, sem somar duas vezes', () => {
    const summary = summarizeSessions([session('a', '2026-10-13', { executionLinks: [link('x1', 10150, 2820)], completion: { status: 'done', distanceKm: 9 } })] as never);
    expect(summary.completedKm).toBeCloseTo(10.2, 1);
  });

  it('vinculo prevalece sobre "nao fiz" (mesma regra de classifySession)', () => {
    const summary = summarizeSessions([session('a', '2026-10-13', { executionLinks: [link('x1', 8000, 2400)], completion: { status: 'missed', distanceKm: null } })] as never);
    expect(summary.completedSessions).toBe(1);
    expect(summary.missedSessions).toBe(0);
  });

  it('sem vinculo nada muda: feedback manual, nao feito e sem registro continuam como antes', () => {
    const summary = summarizeSessions([
      session('a', '2026-10-13', { completion: { status: 'done', distanceKm: 7 } }),
      session('b', '2026-10-14', { completion: { status: 'missed', distanceKm: null } }),
      session('c', '2026-10-15'),
    ] as never);
    expect(summary).toMatchObject({ completedSessions: 1, missedSessions: 1, unregisteredSessions: 1, completedKm: 7 });
  });

  it('a mesma atividade ligada duas vezes nao soma duas vezes', () => {
    expect(objectiveExecutionOf({ executionLinks: [link('x1', 5000, 1500), link('x1', 5000, 1500)] }).distanceKm).toBe(5);
  });

  it('historico: sessao vinculada sem feedback vira feita com km/tempo/pace do relogio', () => {
    const mapped = mapHistorySession(week[0]);
    expect(mapped).toMatchObject({ completionStatus: 'done', executedByDevice: true });
    expect(mapped.completedDistanceKm).toBeCloseTo(10.15, 2);
    expect(mapped.completedDurationMin).toBeCloseTo(47, 0);
    expect(mapped.completedPaceSecondsKm).toBe(278);
  });

  it('historico: sem vinculo continua "sem_registro" e usa so o feedback', () => {
    expect(mapHistorySession(session('z', '2026-10-14'))).toMatchObject({ completionStatus: 'sem_registro', executedByDevice: false, completedDistanceKm: null });
  });
});

describe('treino marcado "nao fiz" nao soma km (Duane, semana 12/10)', () => {
  const week = [
    session('a', '2026-10-13', { distanceKm: 9.5, completion: { status: 'adjusted', distanceKm: 8, durationMin: 50 } }),
    session('b', '2026-10-15', { distanceKm: 8.4, completion: { status: 'missed', distanceKm: 8.4, durationMin: 50 } }),
    session('c', '2026-10-16', { distanceKm: 5.5, completion: { status: 'missed', distanceKm: 5.5 } }),
    session('d', '2026-10-18', { distanceKm: 11.5, completion: { status: 'done', distanceKm: 12 } }),
  ];

  it('realizado = so feito/ajustado (20,0 km), prescrito intacto (34,9 km)', () => {
    const summary = summarizeSessions(week as never);
    expect(summary.completedKm).toBe(20);
    expect(summary.prescribedKm).toBe(34.9);
    expect(summary.missedSessions).toBe(2);
  });

  it('historico: "nao fiz" nao mostra km/tempo realizados', () => {
    expect(mapHistorySession(week[1])).toMatchObject({ completionStatus: 'missed', completedDistanceKm: null, completedDurationMin: null });
    expect(mapHistorySession(week[0])).toMatchObject({ completionStatus: 'adjusted', completedDistanceKm: 8 });
  });
});
