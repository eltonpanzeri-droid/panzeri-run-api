import { PrismaClient } from '@prisma/client';
import { runWithAiScope } from '../../src/ai-governance/ai-scope';
import { ExecutionAnalysisService } from '../../src/activity-execution/execution-analysis.service';
import { TrainingAnalystService } from '../../src/training-plans/training-analyst.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Lote 3 (26/10/2026) em PostgreSQL real, dados sinteticos: o que o Prescritor e o Analista de Treinos recebem sobre o treino realizado da semana, inclusive extras que
// existem so' em ActivityLog, e a restricao de provedores (Strava) preservada. Nenhuma chamada de IA.

const WEEK_START = new Date('2026-10-19T00:00:00.000Z');
const NEXT_WEEK = new Date('2026-10-26T00:00:00.000Z');

describe('treino realizado da semana para o Prescritor e o Analista (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const execution = new ExecutionAnalysisService(prisma as never);
  const intelligence = { getVariableSnapshot: async () => { throw new Error('janelas indisponiveis no teste'); } };
  const analyst = new TrainingAnalystService(prisma as never, execution, intelligence as never);
  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  async function activity(userId: string, id: string, over: Record<string, unknown> = {}) {
    const provider = String(over.provider ?? 'polar');
    const raw = await prisma.rawExternalActivity.create({ data: { userId, provider, externalId: `${id}-${userId.slice(0, 6)}`, payload: { origem: 'sintetico' } } });
    return prisma.activityLog.create({
      data: {
        userId, provider, externalId: `${id}-${userId.slice(0, 6)}`, rawActivityId: raw.id, startedAt: new Date('2026-10-20T10:00:00Z'), utcOffsetMinutes: -180,
        durationSec: 3600, distanceMeters: 10000, sport: 'corrida', executionClassification: 'alternative', executionClassifiedBy: 'automatic', physicalIdentityStatus: 'unique', ...over,
      },
    });
  }

  async function seedWeek(label: string, a3Provider = 'polar') {
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
    const a3 = await activity(student.userId, 'a3', { provider: a3Provider, startedAt: new Date('2026-10-25T10:00:00Z'), distanceMeters: 16000, durationSec: 6000, executionClassification: 'corresponding' });
    await prisma.sessionExecutionLink.createMany({
      data: [
        { userId: student.userId, trainingSessionId: sessions[0], activityLogId: a1.id, status: 'active', origin: 'automatic', matchMethod: 'automatic_single_candidate' },
        { userId: student.userId, trainingSessionId: sessions[1], activityLogId: a2.id, status: 'active', origin: 'student', matchMethod: 'manual' },
        { userId: student.userId, trainingSessionId: sessions[2], activityLogId: a3.id, status: 'active', origin: 'automatic', matchMethod: 'automatic_single_candidate' },
      ],
    });
    return { ...student, prescribedIds: sessions, a1, a2, a3 };
  }

  const scopeFor = (userId: string, blocked: string[]) => ({ userId, destination: 'internal_ai' as const, blocked, blockedHealth: [] as string[], computedAt: Date.now() });

  it('corrida extra SO em ActivityLog chega ao Prescritor (treinoRealizadoDaSemana) e ao Analista (total, origem do cumprimento e extra com FC), sem sessao no calendario', async () => {
    const w = await seedWeek('analista');
    const extra = await activity(w.userId, 'extra', { provider: 'wahoo', startedAt: new Date('2026-10-24T10:00:00Z'), distanceMeters: 5000, durationSec: 1800, avgHeartRateBpm: 152, maxHeartRateBpm: 171, powerAvgWatts: 210 });
    expect(await prisma.trainingSession.count({ where: { userId: w.userId, origin: { in: ['device_extra', 'student_extra'] } } })).toBe(0);

    const draft = await execution.prepareWeeklyReport(w.userId, { startDate: WEEK_START, planId: w.planId, sessionIds: w.prescribedIds });
    const sent = draft!.promptIndicators.treinoRealizadoDaSemana as { prescricao: Record<string, unknown>; extras: { atividades: number; detalhe: Array<Record<string, unknown>> }; totalRealizado: { atividades: number; corrida: { km: number } } };
    expect(sent.prescricao).toMatchObject({ sessoesPrevistas: 3, sessoesCumpridas: 3, kmDeCorridaExecutadosNasPrescritas: 36.6, origemDoCumprimento: { vinculoAutomaticoDoSistema: 2, vinculoConfirmadoPorAlunoOuTreinador: 1 } });
    expect(sent.extras.detalhe).toEqual([expect.objectContaining({ modalidade: 'corrida', distanciaKm: 5, duracaoMin: 30, fcMediaBpm: 152, fcMaximaBpm: 171, potenciaMediaW: 210 })]);
    expect(sent.totalRealizado).toMatchObject({ atividades: 4, corrida: { km: 41.6 } });
    // o bloco antigo segue como estava (cumprimento so' das prescritas)
    expect(draft!.promptIndicators).toMatchObject({ sessoes: { prescritas: 3, realizadas: 3 }, corrida: { kmRealizados: 36.6 } });

    const withTotals = await analyst.buildForGeneration(w.userId, NEXT_WEEK, { startDate: WEEK_START, sessionIds: w.prescribedIds, indicators: draft!.aiIndicators, totals: draft!.aiTotals }, { persist: false });
    const week = withTotals!.week!;
    expect(week.facts.map((f) => f.code)).toEqual(expect.arrayContaining(['frequencia_e_adesao', 'total_realizado_da_semana', 'origem_do_cumprimento']));
    const extras = week.findings.find((f) => f.code === 'atividades_sem_prescricao')!;
    expect(extras.statement).toContain('5 km');
    expect(extras.statement).toContain('FC média 152 bpm');
    expect(extras.data).toMatchObject({ count: 1, runCount: 1, runKm: 5 });
    expect(week.evidence.activityLogIds).toContain(extra.id);
    expect(week.evidence.providers).toEqual(expect.arrayContaining(['polar', 'wahoo']));

    // sem os totais (caminho anterior) a corrida extra que so' existe em ActivityLog NAO aparece — a lacuna que o lote fecha
    const legacy = await analyst.buildForGeneration(w.userId, NEXT_WEEK, { startDate: WEEK_START, sessionIds: w.prescribedIds, indicators: draft!.aiIndicators }, { persist: false });
    expect(legacy!.week!.findings.find((f) => f.code === 'atividades_sem_prescricao')).toBeUndefined();
  });

  it('Strava (provedor bloqueado para a IA): some da visao de IA — totais, vinculos e detalhes — e continua no relatorio completo e nas fontes para a exclusao de dados', async () => {
    const w = await seedWeek('strava', 'strava');
    const extra = await activity(w.userId, 'extra-strava', { provider: 'strava', startedAt: new Date('2026-10-24T10:00:00Z'), distanceMeters: 5000, durationSec: 1800, avgHeartRateBpm: 149 });

    const draft = await runWithAiScope(scopeFor(w.userId, ['strava']), () => execution.prepareWeeklyReport(w.userId, { startDate: WEEK_START, planId: w.planId, sessionIds: w.prescribedIds }));
    // relatorio COMPLETO (mostrado ao aluno, gravado): tudo
    expect(draft!.indicators.totals!.total.run).toMatchObject({ events: 4, km: 41.6 });
    expect(draft!.indicators.totals!.prescription.performedSessions).toBe(3);
    expect(draft!.indicators.sources.providers).toEqual(expect.arrayContaining(['polar', 'strava']));
    expect(draft!.indicators.sources.activityLogIds).toContain(extra.id);
    // visao de IA: como se o Strava nao existisse (a extra e a atividade vinculada a s3 saem; s3 fica "sem registro", nunca "nao feita")
    expect(draft!.aiTotals!.total.run).toMatchObject({ events: 2, km: 20.6 });
    expect(draft!.aiTotals!.prescription).toMatchObject({ prescribedSessions: 3, performedSessions: 2, noRecordSessions: 1, notPerformedSessions: 0 });
    expect(draft!.aiTotals!.extras.events).toHaveLength(0);
    const prompt = JSON.stringify(draft!.promptIndicators);
    expect(prompt).not.toMatch(/strava/i);
    expect(prompt).not.toContain(extra.id);
    expect(prompt).not.toContain(w.a3.id);
    expect(draft!.promptIndicators.treinoRealizadoDaSemana).toMatchObject({ extras: { atividades: 0 }, totalRealizado: { atividades: 2, corrida: { km: 20.6 } } });
    // registro de egresso: so' o que foi ao prompt (o Strava NAO foi); as fontes do relatorio completo continuam com ele
    expect(draft!.promptProviders).not.toContain('strava');
    expect(draft!.promptProviders).toContain('polar');
    expect(draft!.indicators.sources.providers).toContain('strava');

    // Analista: contrato (retrato entregue ao Prescritor) construido so' com a visao de IA
    const contractRun = await runWithAiScope(scopeFor(w.userId, ['strava']), () => analyst.buildForGeneration(w.userId, NEXT_WEEK, { startDate: WEEK_START, sessionIds: w.prescribedIds, indicators: draft!.aiIndicators, totals: draft!.aiTotals }, { persist: false }));
    const contractJson = JSON.stringify(contractRun!.week);
    expect(contractJson).not.toContain(extra.id);
    expect(contractJson).not.toContain(w.a3.id);
    expect(contractRun!.week!.evidence.providers).not.toContain('strava');
    // o Analista recebe os indicadores da VISAO DE IA: adesao e km coerentes com os totais (2 de 3; 20,6 km), nunca os numeros completos com o Strava (3 de 3; 36,6 km)
    const adherence = contractRun!.week!.facts.find((f) => f.code === 'frequencia_e_adesao')!;
    expect(adherence.data).toMatchObject({ performed: 2, prescribed: 3 });
    expect(contractRun!.week!.facts.find((f) => f.code === 'volume_de_corrida')!.data).toMatchObject({ realizedKm: 20.6 });
    expect(contractJson).not.toContain('36,6');
    expect(contractJson).not.toContain('36.6');
    // o relatorio COMPLETO (aluno) segue com os numeros completos
    expect(draft!.indicators.overview).toMatchObject({ performed: 3, prescribed: 3 });
    expect(draft!.aiIndicators.overview).toMatchObject({ performed: 2, prescribed: 3 });
    expect(contractRun!.week!.findings.find((f) => f.code === 'atividades_sem_prescricao')).toBeUndefined();
  });

  it('sem provedor bloqueado a visao de IA e o proprio relatorio completo (mesmo objeto de totais)', async () => {
    const w = await seedWeek('semBloqueio');
    await activity(w.userId, 'extra-wahoo', { provider: 'wahoo', startedAt: new Date('2026-10-24T10:00:00Z'), distanceMeters: 5000, durationSec: 1800 });
    const draft = await execution.prepareWeeklyReport(w.userId, { startDate: WEEK_START, planId: w.planId, sessionIds: w.prescribedIds });
    expect(draft!.aiTotals).toBe(draft!.indicators.totals);
  });
});
