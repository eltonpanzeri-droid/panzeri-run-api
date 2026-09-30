import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';

// Sistema de Medalhas (30/09/2026) — pré-requisito da família 2 (Aderência). CAUSA RAIZ do bug
// real: `bucket.prescritas++`/`feitas++` rodavam pra QUALQUER sessão, extra ou não, contradizendo
// a regra já documentada em GLOSSARIO_METRICAS.md ("Extra: não entra em prescrito/elegível/
// aderência"). Um aluno com 3 de 4 prescritas cumpridas (75%) + 1 extra feito aparecia com
// 4/5 = 80% — aderência inflada artificialmente por um treino que nem estava prescrito.
// Cenário canônico pedido: prescrito=4, concluído=3, não realizado=1, extra=2.

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-default',
    userId: 'aluno-1',
    scheduledDate: new Date('2026-08-03T00:00:00Z'), // segunda-feira, semana fechada no passado
    modality: 'corrida',
    distanceKm: null, // planejado (TrainingSession.distanceKm) — sobrescrito por caso
    structure: {},
    plan: { status: 'active' },
    completion: null,
    ...overrides,
  };
}

function extraSession(overrides: Record<string, unknown> = {}) {
  return session({
    structure: { source: 'student', type: 'extra' },
    distanceKm: null, // sessão extra não tem "planejado" — o aluno mesmo criou
    ...overrides,
  });
}

function buildService(sessions: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(sessions);
  const prisma = { trainingSession: { findMany } };
  return { service: new EvolutionMetricService(prisma as never), findMany };
}

const PRESCRIBED_DONE = [
  session({ id: 'p1', distanceKm: 10, completion: { status: 'done', completedAt: new Date('2026-08-03T12:00:00Z'), distanceKm: 8, perceivedEffort: null } }),
  session({ id: 'p2', scheduledDate: new Date('2026-08-04T00:00:00Z'), distanceKm: 8, completion: { status: 'done', completedAt: new Date('2026-08-04T12:00:00Z'), distanceKm: 8, perceivedEffort: null } }),
  session({ id: 'p3', scheduledDate: new Date('2026-08-05T00:00:00Z'), distanceKm: 5, completion: { status: 'adjusted', completedAt: new Date('2026-08-05T12:00:00Z'), distanceKm: 5, perceivedEffort: null } }),
];
const PRESCRIBED_MISSED = session({ id: 'p4', scheduledDate: new Date('2026-08-06T00:00:00Z'), distanceKm: 6, completion: { status: 'missed', completedAt: new Date('2026-08-06T12:00:00Z'), distanceKm: null, perceivedEffort: null } });
const EXTRAS = [
  extraSession({ id: 'e1', scheduledDate: new Date('2026-08-07T00:00:00Z'), completion: { status: 'done', completedAt: new Date('2026-08-07T12:00:00Z'), distanceKm: 3, perceivedEffort: null } }),
  extraSession({ id: 'e2', scheduledDate: new Date('2026-08-08T00:00:00Z'), completion: { status: 'done', completedAt: new Date('2026-08-08T12:00:00Z'), distanceKm: 4, perceivedEffort: null } }),
];

const ALL_SESSIONS = [...PRESCRIBED_DONE, PRESCRIBED_MISSED, ...EXTRAS];

describe('EvolutionMetricService — extra nunca entra em prescrito/elegível/aderência (correção 30/09/2026)', () => {
  it('semana: prescrito=4, feitas=3, naoFeitas=1 — aderência 75%, NUNCA 80% (bug antigo contava os 2 extras no denominador/numerador)', async () => {
    const { service } = buildService(ALL_SESSIONS);
    const series = await service.getSeries('aluno-1');
    expect(series.weeks).toHaveLength(1);
    const week = series.weeks[0];
    expect(week.sessoesPrescritas).toBe(4);
    expect(week.sessoesFeitas).toBe(3);
    expect(week.sessoesNaoFeitas).toBe(1);
    expect(week.adherencePercent).toBe(75); // 3/4, nunca (3+2)/(4+2)=83% nem 4/5=80%
    expect(week.coveragePercent).toBe(100); // (3+1)/4
  });

  it('volume realizado (kmPercorridos) CONTINUA somando os extras — só a contagem de sessões/aderência exclui', async () => {
    const { service } = buildService(ALL_SESSIONS);
    const series = await service.getSeries('aluno-1');
    const week = series.weeks[0];
    // 3 prescritas feitas (8+8+5=21) + 2 extras (3+4=7) = 28km realizados na semana
    expect(week.kmPercorridos).toBe(28);
    expect(week.kmExtras).toBe(7);
    // km PRESCRITO (planejado) soma só as 4 sessões prescritas (10+8+5+6=29), nunca os extras
    expect(week.kmPrescritos).toBe(29);
  });

  it('buildAdherenceSummary (getOverview, all_time): mesma correção — extra fora do denominador', async () => {
    const { service } = buildService(ALL_SESSIONS);
    const overview = await service.getOverview('aluno-1');
    expect(overview.adherence.allTime.sessoesPrescritas).toBe(4);
    expect(overview.adherence.allTime.adherencePercent).toBe(75);
    expect(overview.adherence.allTime.coveragePercent).toBe(100);
  });

  it('modalityBreakdown: totalPrescritas e percentOfTotalPrescribed excluem extras', async () => {
    const { service } = buildService(ALL_SESSIONS);
    const overview = await service.getOverview('aluno-1');
    const corrida = overview.modalityBreakdown.find((m) => m.modality === 'corrida');
    expect(corrida?.sessoesPrescritas).toBe(4);
    expect(corrida?.adherencePercent).toBe(75);
    expect(corrida?.percentOfTotalPrescribed).toBe(100); // 4 de 4 prescritas totais, extras não contam no total
  });

  it('buildMonthlyAggregates: mesma correção — extra fora de prescrito/feitas, dentro do km realizado', async () => {
    const { service } = buildService(ALL_SESSIONS);
    const series = await service.getSeries('aluno-1');
    expect(series.months).toHaveLength(1);
    const month = series.months[0];
    expect(month.sessoesPrescritas).toBe(4);
    expect(month.sessoesFeitas).toBe(3);
    expect(month.sessoesNaoFeitas).toBe(1);
    expect(month.adherencePercent).toBe(75);
    expect(month.kmPercorridos).toBe(28); // realizado inclui extras, igual à semana
  });

  it('sem nenhum extra: comportamento idêntico ao de antes da correção (regressão zero pro caso comum)', async () => {
    const { service } = buildService([...PRESCRIBED_DONE, PRESCRIBED_MISSED]);
    const series = await service.getSeries('aluno-1');
    const week = series.weeks[0];
    expect(week.sessoesPrescritas).toBe(4);
    expect(week.adherencePercent).toBe(75);
    expect(week.kmPercorridos).toBe(21);
    expect(week.kmExtras).toBeNull();
  });
});
