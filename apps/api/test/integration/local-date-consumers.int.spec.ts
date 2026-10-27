import { PrismaClient } from '@prisma/client';
import { loadWeeklyRealizedTotals } from '../../src/activity-execution/weekly-realized-totals.loader';
import { SessionExecutionLinkService } from '../../src/activity-execution/session-execution-link.service';
import { activityLocalDate } from '../../src/common/local-date';
import { weekStartOf } from '../../src/common/weekly-volume';
import { buildStudentCalendar } from '../../src/coach/student-calendar';
import { EvolutionMetricService } from '../../src/evolution/evolution-metric.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Lote 4 (26/10/2026) em PostgreSQL real, dados sinteticos: o MESMO conjunto de atividades, lido pelos consumidores (totais/relatorio semanal, Evolucao, calendario, vinculo),
// cai nos mesmos dias, nas mesmas semanas e nos mesmos EVENTOS FISICOS; o offset do aparelho e' preservado; e nada ja' gravado e' refeito.

// Corte do fuso no passado: estes testes exercitam a regra de Sao Paulo (sem configuracao vale a regra antiga, UTC; ver local-date-unification.spec.ts).
const SAVED_CUTOVER = process.env.LOCAL_DATE_CUTOVER_AT;
beforeAll(() => { process.env.LOCAL_DATE_CUTOVER_AT = '2000-01-01T00:00:00Z'; });
afterAll(() => { if (SAVED_CUTOVER === undefined) delete process.env.LOCAL_DATE_CUTOVER_AT; else process.env.LOCAL_DATE_CUTOVER_AT = SAVED_CUTOVER; });

describe('fuso unificado: consumidores, eventos fisicos e vinculos existentes (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const links = new SessionExecutionLinkService(prisma as never);
  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  async function activity(userId: string, id: string, over: Record<string, unknown> = {}) {
    const provider = String(over.provider ?? 'polar');
    const raw = await prisma.rawExternalActivity.create({ data: { userId, provider, externalId: `${id}-${userId.slice(0, 6)}`, payload: { origem: 'sintetico' } } });
    return prisma.activityLog.create({
      data: {
        userId, provider, externalId: `${id}-${userId.slice(0, 6)}`, rawActivityId: raw.id, startedAt: new Date('2026-10-20T10:00:00Z'), utcOffsetMinutes: null,
        durationSec: 3000, distanceMeters: 8000, sport: 'corrida', executionClassification: 'alternative', executionClassifiedBy: 'automatic', physicalIdentityStatus: 'unique', ...over,
      },
    });
  }

  async function student(label: string) {
    const s = await seedStudent(prisma, label, { startDate: new Date('2026-10-19T00:00:00.000Z') });
    userIds.push(s.userId);
    await prisma.workoutCompletion.deleteMany({ where: { userId: s.userId } });
    await prisma.trainingSession.deleteMany({ where: { userId: s.userId } });
    return s;
  }

  it('mesmos dias, mesmas semanas e mesmos eventos fisicos em totais, Evolucao e calendario (com offset informado preservado, inclusive 0)', async () => {
    const s = await student('consumidores');
    const rows = [
      await activity(s.userId, 'r1', { startedAt: new Date('2026-10-19T13:00:00Z'), utcOffsetMinutes: -180 }),                                   // segunda 19, offset informado
      await activity(s.userId, 'r2-dom', { startedAt: new Date('2026-10-26T02:30:00Z') }),                                                      // domingo 25 23:30 SP, sem offset
      await activity(s.userId, 'r3-seg', { startedAt: new Date('2026-10-26T03:10:00Z') }),                                                      // segunda 26 00:10 SP, sem offset
      await activity(s.userId, 'r4-off0', { startedAt: new Date('2026-10-26T01:00:00Z'), utcOffsetMinutes: 0 }),                                // offset 0 INFORMADO: segunda 26 01:00 (nao vira domingo)
      await activity(s.userId, 'r5-polar', { startedAt: new Date('2026-10-21T12:00:00Z'), utcOffsetMinutes: -180, physicalIdentityStatus: 'matched', physicalEventId: 'ev-5' }),
      await activity(s.userId, 'r6-ambigua', { startedAt: new Date('2026-10-22T12:00:00Z'), executionClassification: 'ambiguous' }),
    ];
    await prisma.activityLog.update({ where: { id: rows[4].id }, data: { physicalCanonicalActivityLogId: rows[4].id } });
    const apple = await activity(s.userId, 'r5-apple', { provider: 'apple_health', startedAt: new Date('2026-10-21T12:00:03Z'), utcOffsetMinutes: -180, sport: 'RUNNING', executionClassification: null, physicalIdentityStatus: 'matched', physicalEventId: 'ev-5', physicalCanonicalActivityLogId: rows[4].id });
    const dateOf = (row: { startedAt: Date; utcOffsetMinutes: number | null }) => activityLocalDate(row.startedAt, row.utcOffsetMinutes);
    expect(dateOf(rows[1])).toBe('2026-10-25');
    expect(dateOf(rows[2])).toBe('2026-10-26');
    expect(dateOf(rows[3])).toBe('2026-10-26'); // offset 0 preservado

    const evolution = new EvolutionMetricService(prisma as never);
    const evolutionRows = await (evolution as unknown as { fetchRealizedActivities(userId: string): Promise<Array<{ id: string; isoDate: string; distanceKm: number | null }>> }).fetchRealizedActivities(s.userId);
    const dbRows = await prisma.activityLog.findMany({ where: { userId: s.userId } });
    const calendar = buildStudentCalendar({
      plans: [], from: '2026-10-01', to: '2026-11-30', today: '2026-11-30', canonicalById: new Map(), summarize: () => null,
      activities: dbRows.map((row) => ({ id: row.id, provider: row.provider, startedAt: row.startedAt, utcOffsetMinutes: row.utcOffsetMinutes, sport: row.sport, durationSec: row.durationSec, distanceMeters: row.distanceMeters, avgHeartRateBpm: row.avgHeartRateBpm, executionClassification: row.executionClassification })),
    });

    for (const week of ['2026-10-19', '2026-10-26']) {
      const totals = await loadWeeklyRealizedTotals(prisma as never, s.userId, week, []);
      const totalsRunIds = [...totals.prescription.executedEvents, ...totals.extras.events, ...totals.pendingConfirmation.events].filter((e) => e.modality === 'corrida' || e.modality === 'esteira').map((e) => e.activityLogId as string).sort();
      const evolutionIds = evolutionRows.filter((r) => weekStartOf(r.isoDate) === week).map((r) => r.id).sort();
      expect(totalsRunIds).toEqual(evolutionIds); // mesmos eventos fisicos (ids), nao so' a soma
      const evolutionKm = evolutionRows.filter((r) => weekStartOf(r.isoDate) === week).reduce((acc, r) => acc + (r.distanceKm ?? 0), 0);
      expect(totals.total.run.km ?? 0).toBeCloseTo(evolutionKm, 1);
      // calendario: as atividades 'alternative' de cada semana sao exatamente as extras dos totais
      const calendarIds = calendar.activities.filter((a) => weekStartOf(a.dateIso) === week).map((a) => a.id).filter((id) => totals.extras.events.some((e) => e.activityLogId === id)).sort();
      expect(calendarIds).toEqual(totals.extras.events.map((e) => e.activityLogId as string).sort());
    }
    const weekA = await loadWeeklyRealizedTotals(prisma as never, s.userId, '2026-10-19', []);
    const weekB = await loadWeeklyRealizedTotals(prisma as never, s.userId, '2026-10-26', []);
    expect(weekA.total.activityLogIds).toEqual([rows[0].id, rows[1].id, rows[4].id, rows[5].id].sort()); // r1, domingo 23:30 SP, evento r5 (uma vez) e a ambigua resolvida r6 (pendente: conta no total)
    expect(weekB.total.activityLogIds).toEqual([rows[2].id, rows[3].id].sort());               // segunda 00:10 SP e o offset 0 informado
    expect(weekA.total.activityLogIds).not.toContain(apple.id);                                 // a observacao nao canonica nao conta de novo
    expect(weekA.pendingConfirmation.events.map((e) => e.activityLogId)).toEqual([rows[5].id]);  // a ambigua e' pendente, nunca extra nem cumprimento
  });

  it('vinculos EXISTENTES nao sao refeitos; atividades NOVAS sem offset usam o dia de Sao Paulo', async () => {
    const s = await student('vinculos');
    const sunday = await prisma.trainingSession.create({ data: { planId: s.planId, userId: s.userId, scheduledDate: new Date('2026-10-25T00:00:00.000Z'), weekday: 0, modality: 'corrida', title: 'Corrida', durationMin: 40, distanceKm: 8, structure: { type: 'run' }, origin: 'agent' } });
    const monday = await prisma.trainingSession.create({ data: { planId: s.planId, userId: s.userId, scheduledDate: new Date('2026-10-26T00:00:00.000Z'), weekday: 1, modality: 'corrida', title: 'Corrida', durationMin: 40, distanceKm: 8, structure: { type: 'run' }, origin: 'agent' } });

    // NOVA: domingo 22h em Sao Paulo (segunda 01:00 UTC), sem offset -> o reconciliador liga ao treino de DOMINGO
    const fresh = await activity(s.userId, 'nova', { startedAt: new Date('2026-10-26T01:00:00Z'), executionClassification: null, executionClassifiedBy: null });
    expect(await links.classify(fresh.id)).toBe('corresponding');
    expect(await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: fresh.id, status: 'active' } })).toMatchObject({ trainingSessionId: sunday.id });

    // ANTIGA: ligada pelo criterio antigo (dia UTC = segunda) ao treino de SEGUNDA. Nada e' refeito.
    const old = await activity(s.userId, 'antiga', { startedAt: new Date('2026-10-26T02:00:00Z'), executionClassification: 'corresponding' });
    const oldLink = await prisma.sessionExecutionLink.create({ data: { userId: s.userId, trainingSessionId: monday.id, activityLogId: old.id, status: 'active', origin: 'automatic', matchMethod: 'automatic_single_candidate' } });
    const before = JSON.stringify(await prisma.sessionExecutionLink.findUniqueOrThrow({ where: { id: oldLink.id } }));
    expect(await links.classify(old.id)).toBe('corresponding'); // ja' classificada: classify devolve a decisao existente
    expect(JSON.stringify(await prisma.sessionExecutionLink.findUniqueOrThrow({ where: { id: oldLink.id } }))).toBe(before);
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: old.id } })).toBe(1);
    expect((await prisma.activityLog.findUniqueOrThrow({ where: { id: old.id } })).executionClassification).toBe('corresponding');
  });

  // DECISAO PENDENTE (Elton): atividade ANTIGA sem offset, ja' 'alternative' e SEM vinculo, em fronteira de dia. O reconciliador recalcula o estado automatico nao-vinculado a cada
  // chamada (reconcileEvent: re-sincronizacao do aparelho, "nao feito" do aluno, reconcileUserHistory do treinador). Com a regra unica o dia passa a ser o de Sao Paulo, entao o
  // recalculo PODE passar a vincula-la a um treino de domingo. O teste fixa o comportamento atual: a simulacao (dryRun) nao grava nada e mostra o que mudaria.
  it('DECISAO PENDENTE: atividade antiga alternative sem vinculo em fronteira: simulacao nao grava; reconciliacao real pode vincular pelo dia de Sao Paulo', async () => {
    const s = await student('reconcilia-antiga');
    const sunday = await prisma.trainingSession.create({ data: { planId: s.planId, userId: s.userId, scheduledDate: new Date('2026-10-25T00:00:00.000Z'), weekday: 0, modality: 'corrida', title: 'Corrida', durationMin: 40, distanceKm: 8, structure: { type: 'run' }, origin: 'agent' } });
    const old = await activity(s.userId, 'antiga-alt', { startedAt: new Date('2026-10-26T01:00:00Z'), executionClassification: 'alternative', executionClassifiedBy: 'automatic' });
    const dry = await links.reconcileEvent(old.id, { dryRun: true });
    expect(dry.classification).toBe('corresponding');
    expect(dry.changed).toBe(true);
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: old.id } })).toBe(0); // simulacao nao grava
    expect((await prisma.activityLog.findUniqueOrThrow({ where: { id: old.id } })).executionClassification).toBe('alternative');
    const real = await links.reconcileEvent(old.id);
    expect(real.classification).toBe('corresponding');
    expect(await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: old.id, status: 'active' } })).toMatchObject({ trainingSessionId: sunday.id, origin: 'automatic' });
  });
});
