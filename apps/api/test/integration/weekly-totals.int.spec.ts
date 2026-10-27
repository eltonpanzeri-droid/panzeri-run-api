import { PrismaClient } from '@prisma/client';
import { ExecutionAnalysisService } from '../../src/activity-execution/execution-analysis.service';
import { SessionExecutionLinkService } from '../../src/activity-execution/session-execution-link.service';
import { loadWeeklyRealizedTotals } from '../../src/activity-execution/weekly-realized-totals.loader';
import { totalsInvariantViolations } from '../../src/activity-execution/weekly-realized-totals';
import { EvolutionMetricService } from '../../src/evolution/evolution-metric.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Totais da semana (lote 2, 26/10/2026) em PostgreSQL real, dados sinteticos: adaptador de banco, relatorio semanal com extras, relatorios antigos preservados e
// mesmos eventos fisicos da Evolucao. Semana 19/10 a 25/10/2026.

const WEEK_START = new Date('2026-10-19T00:00:00.000Z');

// Corte do fuso no passado: estes testes exercitam a regra de Sao Paulo (sem configuracao vale a regra antiga, UTC; ver local-date-unification.spec.ts).
const SAVED_CUTOVER = process.env.LOCAL_DATE_CUTOVER_AT;
beforeAll(() => { process.env.LOCAL_DATE_CUTOVER_AT = '2000-01-01T00:00:00Z'; });
afterAll(() => { if (SAVED_CUTOVER === undefined) delete process.env.LOCAL_DATE_CUTOVER_AT; else process.env.LOCAL_DATE_CUTOVER_AT = SAVED_CUTOVER; });

describe('totais realizados da semana (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const analysis = new ExecutionAnalysisService(prisma as never);
  const linkService = new SessionExecutionLinkService(prisma as never);
  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  async function activity(userId: string, id: string, over: Record<string, unknown> = {}) {
    const raw = await prisma.rawExternalActivity.create({ data: { userId, provider: String(over.provider ?? 'polar'), externalId: `${id}-${userId.slice(0, 6)}`, payload: { origem: 'sintetico' } } });
    return prisma.activityLog.create({
      data: {
        userId, provider: 'polar', externalId: `${id}-${userId.slice(0, 6)}`, rawActivityId: raw.id, startedAt: new Date('2026-10-20T10:00:00Z'), utcOffsetMinutes: -180,
        durationSec: 3600, distanceMeters: 10000, sport: 'corrida', executionClassification: 'alternative', executionClassifiedBy: 'automatic', physicalIdentityStatus: 'unique', ...over,
      },
    });
  }

  // 3 corridas prescritas (planejado 10+10+15 = 35 km) em 20, 22 e 25/10 e as atividades que as cumpriram.
  async function seedWeek(label: string) {
    const student = await seedStudent(prisma, label, { startDate: WEEK_START });
    userIds.push(student.userId);
    await prisma.workoutCompletion.deleteMany({ where: { userId: student.userId } });
    await prisma.trainingSession.deleteMany({ where: { userId: student.userId } });
    const sessions: string[] = [];
    for (const [index, day] of ['2026-10-20', '2026-10-22', '2026-10-25'].entries()) {
      const row = await prisma.trainingSession.create({
        data: { planId: student.planId, userId: student.userId, scheduledDate: new Date(`${day}T00:00:00.000Z`), weekday: new Date(`${day}T12:00:00Z`).getUTCDay(), modality: 'corrida', title: 'Corrida', sessionType: 'continuo', durationMin: 60, distanceKm: index === 2 ? 15 : 10, structure: { type: 'run' }, origin: 'agent' },
      });
      sessions.push(row.id);
    }
    const a1 = await activity(student.userId, 'a1', { startedAt: new Date('2026-10-20T10:00:00Z'), distanceMeters: 10200, durationSec: 3720, executionClassification: 'corresponding' });
    const a2 = await activity(student.userId, 'a2', { startedAt: new Date('2026-10-22T10:00:00Z'), distanceMeters: 10400, durationSec: 3840, executionClassification: 'corresponding' });
    const a3 = await activity(student.userId, 'a3', { startedAt: new Date('2026-10-25T10:00:00Z'), distanceMeters: 16000, durationSec: 6000, executionClassification: 'corresponding' });
    await prisma.sessionExecutionLink.createMany({
      data: [
        { userId: student.userId, trainingSessionId: sessions[0], activityLogId: a1.id, status: 'active', origin: 'automatic', matchMethod: 'automatic_single_candidate' },
        { userId: student.userId, trainingSessionId: sessions[1], activityLogId: a2.id, status: 'active', origin: 'student', matchMethod: 'manual' },
        { userId: student.userId, trainingSessionId: sessions[2], activityLogId: a3.id, status: 'active', origin: 'automatic', matchMethod: 'automatic_single_candidate' },
      ],
    });
    return { ...student, prescribedIds: sessions, a1, a2, a3 };
  }

  it('o caso real: 3 de 3 prescritas + 1 corrida extra SO em ActivityLog = 4 corridas / 41,6 km, e o texto do aluno mostra prescricao, extra e total', async () => {
    const w = await seedWeek('caso-real');
    const extra = await activity(w.userId, 'extra', { provider: 'wahoo', startedAt: new Date('2026-10-24T10:00:00Z'), distanceMeters: 5000, durationSec: 1800 });

    const draft = await analysis.prepareWeeklyReport(w.userId, { startDate: WEEK_START, planId: w.planId, sessionIds: w.prescribedIds });
    expect(draft).not.toBeNull();
    const ind = draft!.indicators;
    expect(ind.overview).toMatchObject({ prescribed: 3, performed: 3 });
    expect(ind.totals!.prescription).toMatchObject({ prescribedSessions: 3, performedSessions: 3, plannedRunKm: 35, executedRunKm: 36.6, provenance: { automaticLink: 2, humanConfirmedLink: 1, manualRecord: 0 } });
    expect(ind.totals!.extras.events).toEqual([expect.objectContaining({ origin: 'somente_atividade', activityLogId: extra.id, distanceKm: 5, durationMin: 30 })]);
    expect(ind.totals!.total.run).toEqual({ events: 4, km: 41.6, minutes: 256 });
    expect(totalsInvariantViolations(ind.totals!)).toEqual([]);
    expect(draft!.textLines[0]).toBe('Você realizou os 3 treinos previstos: 3 de corrida.');
    expect(draft!.textLines).toContain('Corrida extra em sáb 24/10: 5 km em 30 min.');
    expect(draft!.textLines.some((line) => line.startsWith('Total da semana, somando treinos previstos e extras: 4 atividades'))).toBe(true);
    // as fontes do extra entram nas fontes do relatorio (a exclusao de dados de um provedor passa a invalidar tambem o que veio dele)
    expect(ind.sources.providers).toEqual(expect.arrayContaining(['polar', 'wahoo']));
    expect(ind.sources.activityLogIds).toContain(extra.id);
    // o Prescritor continua recebendo o MESMO formato de antes (a mudanca do prompt e' do lote 3)
    expect(JSON.stringify(draft!.promptIndicators)).not.toContain('totals');
    expect(draft!.promptIndicators).toMatchObject({ sessoes: { prescritas: 3, realizadas: 3 }, corrida: { kmRealizados: 36.6 } });
  });

  it('a mesma extra materializada no calendario (device_extra com vinculo), uma extra manual e varios dispositivos nao duplicam eventos', async () => {
    const w = await seedWeek('materializada');
    const mat = await activity(w.userId, 'mat', { startedAt: new Date('2026-10-24T10:00:00Z'), distanceMeters: 5000, durationSec: 1800 });
    // FORMATO REAL de producao: materializeExtraActivity cria a sessao device_extra + conclusao 'done' (copia da atividade) SEM SessionExecutionLink; o elo e' structure.activityLogId.
    const materialized = await linkService.materializeExtraActivity(mat.id);
    expect(materialized!.session.origin).toBe('device_extra');
    expect(await prisma.sessionExecutionLink.count({ where: { trainingSessionId: materialized!.session.id } })).toBe(0);
    // musculacao extra registrada pelo aluno, sem atividade
    const strengthExtra = await prisma.trainingSession.create({
      data: { planId: w.planId, userId: w.userId, scheduledDate: new Date('2026-10-23T00:00:00.000Z'), weekday: 5, modality: 'forca', title: 'Musculação (extra)', structure: { type: 'extra', source: 'student' }, origin: 'student_extra' },
    });
    await prisma.workoutCompletion.create({ data: { userId: w.userId, sessionId: strengthExtra.id, status: 'done', durationMin: 50, perceivedEffort: 7 } });
    // mesmo evento fisico da primeira corrida visto por dois dispositivos (Polar canonica + Apple Health)
    await prisma.activityLog.updateMany({ where: { id: w.a1.id }, data: { physicalIdentityStatus: 'matched', physicalEventId: 'ev-a1', physicalCanonicalActivityLogId: w.a1.id } });
    await activity(w.userId, 'a1-apple', { provider: 'apple_health', startedAt: new Date('2026-10-20T10:00:03Z'), distanceMeters: 10190, durationSec: 3718, sport: 'RUNNING', executionClassification: null, physicalIdentityStatus: 'matched', physicalEventId: 'ev-a1', physicalCanonicalActivityLogId: w.a1.id });
    // atividade ainda ambigua: fica fora, com aviso
    await activity(w.userId, 'amb', { startedAt: new Date('2026-10-21T10:00:00Z'), executionClassification: 'ambiguous', physicalIdentityStatus: 'unique' });

    const totals = await loadWeeklyRealizedTotals(prisma as never, w.userId, WEEK_START, w.prescribedIds);
    expect(totals.prescription).toMatchObject({ prescribedSessions: 3, performedSessions: 3 });
    expect(totals.extras.events.map((e) => [e.origin, e.modality])).toEqual([['student_extra', 'forca'], ['device_extra', 'corrida']]);
    expect(totals.extras.events.filter((e) => e.activityLogId === mat.id)).toHaveLength(1); // o MESMO evento fisico nao vira 2 extras (atividade + sessao sintetica)
    expect(totals.total.events).toBe(6); // 3 prescritas + corrida extra materializada + musculacao extra + a ambigua (pendente: conta no total)
    expect(totals.total.run.events).toBe(5);
    expect(totals.pendingConfirmation.events).toHaveLength(1);
    expect(totals.total.byModality.forca).toEqual({ events: 1, minutes: 50, km: null });
    expect(totals.completeness.excludedUnclassified).toBe(0);
    expect(totalsInvariantViolations(totals)).toEqual([]);
  });

  it('fronteira de semana e fuso: sem offset vale Sao Paulo; segunda 00:10 fica na semana seguinte; atividade em outra semana vinculada a sessao desta nao conta duas vezes', async () => {
    const w = await seedWeek('fronteira');
    const domingoNoite = await activity(w.userId, 'dom', { startedAt: new Date('2026-10-26T02:30:00Z'), utcOffsetMinutes: null, distanceMeters: 7000, durationSec: 2400 });
    const segundaCedo = await activity(w.userId, 'seg', { startedAt: new Date('2026-10-26T03:10:00Z'), utcOffsetMinutes: null, distanceMeters: 3000, durationSec: 1200 });
    const thisWeek = await loadWeeklyRealizedTotals(prisma as never, w.userId, WEEK_START, w.prescribedIds);
    const nextWeek = await loadWeeklyRealizedTotals(prisma as never, w.userId, '2026-10-26', []);
    expect(thisWeek.total.activityLogIds).toContain(domingoNoite.id);
    expect(thisWeek.total.activityLogIds).not.toContain(segundaCedo.id);
    expect(nextWeek.total.activityLogIds).toEqual([segundaCedo.id]);

    // sessao de domingo desta semana vinculada a uma atividade que o relogio registrou na segunda local: o evento vale na semana da execucao
    const sunday = await prisma.trainingSession.update({ where: { id: w.prescribedIds[2] }, data: { scheduledDate: new Date('2026-10-25T00:00:00.000Z') } });
    await prisma.sessionExecutionLink.updateMany({ where: { trainingSessionId: sunday.id }, data: { activityLogId: segundaCedo.id } });
    await prisma.workoutCompletion.create({ data: { userId: w.userId, sessionId: sunday.id, status: 'done', distanceKm: 3, durationMin: 20 } });
    const again = await loadWeeklyRealizedTotals(prisma as never, w.userId, WEEK_START, w.prescribedIds);
    expect(again.total.activityLogIds).not.toContain(segundaCedo.id);
    expect(again.prescription.executedEvents.some((event) => event.sessionId === sunday.id)).toBe(false);
  });

  it('sessao sintetica do aparelho (formato real) em fronteira de semana: a atividade conta na semana do dia local e a sessao (criada pelo dia UTC) nao a conta de novo na outra semana', async () => {
    const w = await seedWeek('sintetica-fronteira');
    // domingo 22h em Sao Paulo, sem offset: dia local = domingo (semana 19-25); antes do lote 4 a sessao sintetica nascia no dia UTC (segunda), hoje nasce no dia local
    const sundayNight = await activity(w.userId, 'dom22', { startedAt: new Date('2026-10-26T01:00:00Z'), utcOffsetMinutes: null, distanceMeters: 8000, durationSec: 2700 });
    const materialized = await linkService.materializeExtraActivity(sundayNight.id);
    expect(materialized!.session.scheduledDate.toISOString().slice(0, 10)).toBe('2026-10-25'); // lote 4: a sessao sintetica agora nasce no dia LOCAL (Sao Paulo), alinhada a atividade
    const thisWeek = await loadWeeklyRealizedTotals(prisma as never, w.userId, WEEK_START, w.prescribedIds);
    const nextWeek = await loadWeeklyRealizedTotals(prisma as never, w.userId, '2026-10-26', []);
    expect(thisWeek.extras.events.filter((e) => e.activityLogId === sundayNight.id)).toHaveLength(1);
    expect(thisWeek.total.run.events).toBe(4);
    expect(nextWeek.total.events).toBe(0); // nem pela atividade (outra semana local) nem pela sessao sintetica
    expect(totalsInvariantViolations(thisWeek)).toEqual([]);
  });

  it('mesmos EVENTOS FISICOS da Evolucao (ids e km), com banco real', async () => {
    const w = await seedWeek('paridade');
    await activity(w.userId, 'p-extra', { provider: 'wahoo', startedAt: new Date('2026-10-24T10:00:00Z'), distanceMeters: 5000, durationSec: 1800 });
    await activity(w.userId, 'p-esteira', { provider: 'zepp', sport: 'esteira', startedAt: new Date('2026-10-23T10:00:00Z'), distanceMeters: 6000, durationSec: 2400 });
    await activity(w.userId, 'p-nat', { sport: 'natacao', startedAt: new Date('2026-10-21T10:00:00Z'), distanceMeters: 1500, durationSec: 2400 });
    await prisma.activityLog.updateMany({ where: { id: w.a2.id }, data: { physicalIdentityStatus: 'matched', physicalEventId: 'ev-a2', physicalCanonicalActivityLogId: w.a2.id } });
    await activity(w.userId, 'p-a2-apple', { provider: 'apple_health', startedAt: new Date('2026-10-22T10:00:04Z'), distanceMeters: 10390, durationSec: 3838, sport: 'RUNNING', executionClassification: 'corresponding', physicalIdentityStatus: 'matched', physicalEventId: 'ev-a2', physicalCanonicalActivityLogId: w.a2.id });

    const totals = await loadWeeklyRealizedTotals(prisma as never, w.userId, WEEK_START, w.prescribedIds);
    const evolution = new EvolutionMetricService(prisma as never);
    const evolutionRows = (await (evolution as unknown as { fetchRealizedActivities(userId: string): Promise<Array<{ id: string; isoDate: string; distanceKm: number | null }>> }).fetchRealizedActivities(w.userId))
      .filter((row) => row.isoDate >= '2026-10-19' && row.isoDate <= '2026-10-25');
    const totalsRunIds = [...totals.prescription.executedEvents, ...totals.extras.events, ...totals.pendingConfirmation.events].filter((e) => e.modality === 'corrida' || e.modality === 'esteira').map((e) => e.activityLogId as string).sort();
    expect(totalsRunIds).toEqual(evolutionRows.map((row) => row.id).sort());
    expect(totals.total.run.km).toBeCloseTo(evolutionRows.reduce((acc, row) => acc + (row.distanceKm ?? 0), 0), 1);
    expect(totalsInvariantViolations(totals)).toEqual([]);
  });

  it('relatorios JA EMITIDOS ficam intactos: gravar um relatorio novo nao reescreve o antigo e o antigo continua sendo apresentado como sempre foi', async () => {
    const w = await seedWeek('preservacao');
    const oldPlan = await prisma.trainingPlan.create({ data: { userId: w.userId, name: 'Programa anterior', goal: 'Correr 10km', startDate: new Date('2026-10-12T00:00:00.000Z'), endDate: new Date('2026-10-18T00:00:00.000Z'), generatedBy: 'teste-sintetico', inputSnapshot: { origem: 'sintetico' }, status: 'archived' } });
    const oldIndicators = { version: 1, weekStartDate: '2026-10-12', overview: { prescribed: 2, performed: 2, notPerformed: 0, noRecord: 0, frequencyPct: 100, byModality: { corrida: { prescribed: 2, performed: 2 } } }, strength: null, run: null, completeness: { sessionsWithoutData: 0, summaryOnly: 0, manualOnly: 0, notes: [] }, sources: { sessionIds: [], activityLogIds: [], providers: [] } };
    const oldLines = ['Você realizou os 2 treinos previstos: 2 de corrida.'];
    const oldRow = await prisma.weeklyExecutionReport.create({
      data: { userId: w.userId, weekStartDate: new Date('2026-10-12T00:00:00.000Z'), analyzedPlanId: null, deliveredWithPlanId: oldPlan.id, algorithmVersion: 1, indicators: oldIndicators, textLines: oldLines, sources: oldIndicators.sources },
    });
    const before = JSON.stringify(await prisma.weeklyExecutionReport.findUniqueOrThrow({ where: { id: oldRow.id } }));

    await activity(w.userId, 'pres-extra', { startedAt: new Date('2026-10-24T10:00:00Z'), distanceMeters: 5000, durationSec: 1800 });
    const draft = await analysis.prepareWeeklyReport(w.userId, { startDate: WEEK_START, planId: w.planId, sessionIds: w.prescribedIds });
    const newPlan = await prisma.trainingPlan.create({ data: { userId: w.userId, name: 'Programa novo', goal: 'Correr 10km', startDate: new Date('2026-10-26T00:00:00.000Z'), endDate: new Date('2026-11-01T00:00:00.000Z'), generatedBy: 'teste-sintetico', inputSnapshot: { origem: 'sintetico' } } });
    await prisma.$transaction((tx) => analysis.persistWeeklyReport(tx, w.userId, draft!, newPlan.id));

    expect(JSON.stringify(await prisma.weeklyExecutionReport.findUniqueOrThrow({ where: { id: oldRow.id } }))).toBe(before);
    const oldView = await analysis.presentationFor(w.userId, oldPlan.id, [], []);
    expect(oldView.weeklyReport?.lines).toEqual(oldLines);
    const newView = await analysis.presentationFor(w.userId, newPlan.id, [], []);
    expect(newView.weeklyReport?.lines).toContain('Corrida extra em sáb 24/10: 5 km em 30 min.');
    const stored = await prisma.weeklyExecutionReport.findFirstOrThrow({ where: { deliveredWithPlanId: newPlan.id } });
    expect((stored.indicators as { totals?: { total: { run: { km: number } } } }).totals?.total.run.km).toBe(41.6);
    expect((stored.indicators as { version: number }).version).toBe(1); // a versao do algoritmo de execucao (e das linhas vivas) nao mudou
  });
});
