import { PrismaClient } from '@prisma/client';
import { loadWeeklyRealizedTotals } from '../../src/activity-execution/weekly-realized-totals.loader';
import { SessionExecutionLinkService } from '../../src/activity-execution/session-execution-link.service';
import { WeeklyCheckInService } from '../../src/training-plans/weekly-checkin.service';
import { WorkoutCompletionsService } from '../../src/workout-completions/workout-completions.service';
import { EvolutionMetricService } from '../../src/evolution/evolution-metric.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Regra de Elton (26/10/2026), PostgreSQL real e o servico REAL de vinculos: treino de 12 km marcado "nao fiz" + corrida de 12 km que chega depois.
//   - o sistema PERGUNTA ao aluno (candidato pendente); enquanto nao houver resposta, nada muda e nada e presumido;
//   - SIM: vincula a corrida ao treino e a marcacao passa de "nao realizado" para "realizado";
//   - NAO: o treino segue "nao realizado" e a corrida fica registrada como extra;
//   - nos dois casos a corrida conta UMA vez no total realizado.

const WEEK_START = new Date('2026-10-19T00:00:00.000Z');

describe('treino marcado "nao fiz" + atividade que chega depois (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const links = new SessionExecutionLinkService(prisma as never);
  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  async function activity(userId: string, id: string, over: Record<string, unknown> = {}) {
    const raw = await prisma.rawExternalActivity.create({ data: { userId, provider: 'polar', externalId: `${id}-${userId.slice(0, 6)}`, payload: { origem: 'sintetico' } } });
    return prisma.activityLog.create({
      data: {
        userId, provider: 'polar', externalId: `${id}-${userId.slice(0, 6)}`, rawActivityId: raw.id, startedAt: new Date('2026-10-21T10:00:00Z'), utcOffsetMinutes: -180,
        durationSec: 4200, distanceMeters: 12000, sport: 'corrida', executionClassification: null, physicalIdentityStatus: 'unique', ...over,
      },
    });
  }

  // aluno com o treino de 12 km (quarta 21/10) que ele marcou "nao fiz", com esforco e observacao ja' escritos
  async function studentWithMissedSession(label: string) {
    const s = await seedStudent(prisma, label, { startDate: WEEK_START });
    userIds.push(s.userId);
    await prisma.workoutCompletion.deleteMany({ where: { userId: s.userId } });
    await prisma.trainingSession.deleteMany({ where: { userId: s.userId } });
    const session = await prisma.trainingSession.create({ data: { planId: s.planId, userId: s.userId, scheduledDate: new Date('2026-10-21T00:00:00.000Z'), weekday: 3, modality: 'corrida', title: 'Corrida 12 km', durationMin: 70, distanceKm: 12, structure: { type: 'run' }, origin: 'agent' } });
    await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: session.id, status: 'missed', perceivedEffort: 4, notes: 'Nao consegui treinar' } });
    return { ...s, session };
  }
  const completionOf = (sessionId: string) => prisma.workoutCompletion.findUniqueOrThrow({ where: { sessionId } });
  const totals = (userId: string, ids: string[]) => loadWeeklyRealizedTotals(prisma as never, userId, WEEK_START, ids);

  it('1) a corrida chega depois do "nao fiz": vira pergunta pendente — a marcacao NAO e alterada e o vinculo NAO e presumido', async () => {
    const w = await studentWithMissedSession('pergunta');
    const run = await activity(w.userId, 'run12');
    expect(await links.classify(run.id)).toBe('ambiguous');
    expect((await prisma.activityLog.findUniqueOrThrow({ where: { id: run.id } })).executionClassification).toBe('ambiguous');
    const candidates = await prisma.sessionExecutionLink.findMany({ where: { activityLogId: run.id } });
    expect(candidates).toEqual([expect.objectContaining({ status: 'candidate', trainingSessionId: w.session.id, matchMethod: 'student_marked_not_done', origin: 'automatic' })]);
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: run.id, status: 'active' } })).toBe(0);
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'missed', perceivedEffort: 4, notes: 'Nao consegui treinar' });
    // enquanto nao ha resposta a atividade JA conta uma vez no volume total (exposicao ao treinamento), mas nao e cumprimento nem extra
    const pending = await totals(w.userId, [w.session.id]);
    expect(pending.total).toMatchObject({ events: 1, run: { events: 1, km: 12 } });
    expect(pending.pendingConfirmation.events).toEqual([expect.objectContaining({ activityLogId: run.id, distanceKm: 12 })]);
    expect(pending.prescription).toMatchObject({ prescribedSessions: 1, performedSessions: 0, notPerformedSessions: 1, executedRunKm: null });
    expect(pending.extras.events).toHaveLength(0);
    expect(pending.completeness.excludedUnclassified).toBe(0);
    // a Evolucao tambem nao a perde: entra no volume, nunca como extra nem como cumprimento
    const evolutionWeek = (await new EvolutionMetricService(prisma as never).getSeries(w.userId)).weeks.find((week) => week.weekStart === '2026-10-19')!;
    expect(evolutionWeek.kmPercorridos).toBe(12);
    expect(evolutionWeek.kmExtras).toBeNull();
    expect(evolutionWeek.sessoesFeitas).toBe(0);
  });

  it('2) SIM: vincula a corrida ao treino e a marcacao passa de "nao realizado" para "realizado", preservando o restante do feedback; conta uma vez', async () => {
    const w = await studentWithMissedSession('sim');
    const run = await activity(w.userId, 'run12-sim');
    await links.classify(run.id);
    const candidate = await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: run.id, status: 'candidate' } });
    await links.confirmCandidateAsStudent(w.userId, candidate.id);
    expect(await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: run.id, status: 'active' } })).toMatchObject({ trainingSessionId: w.session.id, origin: 'student' });
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'done', perceivedEffort: 4, notes: 'Nao consegui treinar' });
    expect((await prisma.activityLog.findUniqueOrThrow({ where: { id: run.id } })).executionClassification).toBe('corresponding');
    const result = await totals(w.userId, [w.session.id]);
    expect(result.prescription).toMatchObject({ prescribedSessions: 1, performedSessions: 1, notPerformedSessions: 0, executedRunKm: 12, provenance: { humanConfirmedLink: 1, automaticLink: 0 } });
    expect(result.extras.events).toHaveLength(0);
    expect(result.total).toMatchObject({ events: 1, run: { events: 1, km: 12 } });
  });

  it('3) NAO: o treino segue "nao realizado" e a corrida fica registrada como extra; conta uma vez; a automacao nao a reassocia depois', async () => {
    const w = await studentWithMissedSession('nao');
    const run = await activity(w.userId, 'run12-nao');
    await links.classify(run.id);
    await links.unlinkActivityAsStudent(w.userId, run.id);
    expect(await prisma.activityLog.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'student' });
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: run.id, status: { in: ['active', 'candidate'] } } })).toBe(0);
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'missed' });
    const result = await totals(w.userId, [w.session.id]);
    expect(result.prescription).toMatchObject({ prescribedSessions: 1, performedSessions: 0, notPerformedSessions: 1, executedRunKm: null });
    expect(result.extras.events).toEqual([expect.objectContaining({ activityLogId: run.id, distanceKm: 12 })]);
    expect(result.total).toMatchObject({ events: 1, run: { events: 1, km: 12 } });
    expect(await links.classify(run.id)).toBe('alternative'); // decisao do aluno prevalece
    expect(await links.reconcileEvent(run.id)).toMatchObject({ changed: false, classification: 'alternative' });
  });

  it('4) o vinculo manual do aluno ("Vincular a treino prescrito") a um treino marcado "nao fiz" tambem atualiza a marcacao', async () => {
    const w = await studentWithMissedSession('manual');
    const run = await activity(w.userId, 'run12-manual', { executionClassification: 'alternative', executionClassifiedBy: 'automatic' });
    await links.linkActivityToSessionAsStudent(w.userId, run.id, w.session.id);
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'done', perceivedEffort: 4 });
    const result = await totals(w.userId, [w.session.id]);
    expect(result.prescription).toMatchObject({ performedSessions: 1, executedRunKm: 12 });
    expect(result.total.events).toBe(1);
  });

  it('5) ordem inversa: a corrida ja estava vinculada e depois o aluno marca "nao fiz" — o vinculo automatico nao e mantido contra o registro dele, e a atividade vira pergunta (nao extra automatica)', async () => {
    const w = await studentWithMissedSession('inversa');
    await prisma.workoutCompletion.delete({ where: { sessionId: w.session.id } });
    const run = await activity(w.userId, 'run12-inversa');
    expect(await links.classify(run.id)).toBe('corresponding'); // sem "nao fiz": vinculo automatico
    await prisma.workoutCompletion.create({ data: { userId: w.userId, sessionId: w.session.id, status: 'missed' } });
    await links.reconcileEventsOfSession(w.session.id);
    expect((await prisma.activityLog.findUniqueOrThrow({ where: { id: run.id } })).executionClassification).toBe('ambiguous');
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: run.id, status: 'active' } })).toBe(0);
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: run.id, status: 'candidate', trainingSessionId: w.session.id } })).toBe(1);
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'missed' }); // a marcacao do aluno e' a que vale ate' ele responder
  });

  it('6) quando o aluno JA respondeu "fiz" (sem atividade) e a corrida chega depois, o fluxo existente segue igual: vincula sem perguntar e nao mexe na marcacao', async () => {
    const w = await studentWithMissedSession('fiz');
    await prisma.workoutCompletion.update({ where: { sessionId: w.session.id }, data: { status: 'done' } });
    const run = await activity(w.userId, 'run12-fiz');
    expect(await links.classify(run.id)).toBe('corresponding');
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'done' });
  });

  it('7) sem treino compativel marcado "nao fiz" nada muda: a atividade continua extra direta (modalidade diferente)', async () => {
    const w = await studentWithMissedSession('outra-modalidade');
    const swim = await activity(w.userId, 'natacao', { sport: 'natacao', distanceMeters: 1500, durationSec: 2400 });
    expect(await links.classify(swim.id)).toBe('alternative');
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: swim.id } })).toBe(0);
  });

  it('8) duas atividades candidatas ao MESMO treino: o segundo SIM e recusado (nunca 2 vinculos ativos); a segunda pode ser respondida NAO e vira extra', async () => {
    const w = await studentWithMissedSession('duas');
    const morning = await activity(w.userId, 'manha', { startedAt: new Date('2026-10-21T09:00:00Z'), distanceMeters: 5000, durationSec: 1800 });
    const evening = await activity(w.userId, 'noite', { startedAt: new Date('2026-10-21T21:00:00Z'), distanceMeters: 12000 });
    await links.classify(morning.id);
    await links.classify(evening.id);
    const first = await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: evening.id, status: 'candidate' } });
    const second = await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: morning.id, status: 'candidate' } });
    await links.confirmCandidateAsStudent(w.userId, first.id);
    await expect(links.confirmCandidateAsStudent(w.userId, second.id)).rejects.toThrow(/ja esta vinculado a outra atividade/);
    expect(await prisma.sessionExecutionLink.count({ where: { trainingSessionId: w.session.id, status: 'active' } })).toBe(1);
    await links.unlinkActivityAsStudent(w.userId, morning.id); // NAO a segunda
    const result = await totals(w.userId, [w.session.id]);
    expect(result.prescription).toMatchObject({ performedSessions: 1, executedRunKm: 12 });
    expect(result.extras.events).toEqual([expect.objectContaining({ activityLogId: morning.id, distanceKm: 5 })]);
    expect(result.total.events).toBe(2);
  });

  it('9) vinculo e atualizacao da marcacao sao atomicos: se a atualizacao falhar, nada fica pela metade e a pergunta continua pendente', async () => {
    const w = await studentWithMissedSession('atomico');
    const run = await activity(w.userId, 'run-atomico');
    await links.classify(run.id);
    const candidate = await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: run.id, status: 'candidate' } });
    const proto = SessionExecutionLinkService.prototype as unknown as { markDoneAfterStudentConfirmation: () => Promise<boolean> };
    const original = proto.markDoneAfterStudentConfirmation;
    proto.markDoneAfterStudentConfirmation = async () => { throw new Error('falha simulada'); };
    try {
      await expect(links.confirmCandidateAsStudent(w.userId, candidate.id)).rejects.toThrow('falha simulada');
    } finally { proto.markDoneAfterStudentConfirmation = original; }
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: run.id, status: 'active' } })).toBe(0);
    expect((await prisma.sessionExecutionLink.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe('candidate');
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'missed' });
    // com o sistema normal, a mesma resposta SIM funciona
    await links.confirmCandidateAsStudent(w.userId, candidate.id);
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'done' });
  });

  it('10) compatibilidade com apps antigos: a resposta NAO viaja como opcao do MESMO cartao (linkId "extra:<atividade>") ao MESMO endpoint de confirmacao — sem app novo', async () => {
    const w = await studentWithMissedSession('compat-antigo');
    const run = await activity(w.userId, 'run12-compat');
    await links.classify(run.id);
    // o app antigo so' le candidatos e envia o linkId escolhido para confirmCandidateAsStudent: o servidor entende o marcador
    const other = await seedStudent(prisma, 'compat-outro', { startDate: WEEK_START });
    userIds.push(other.userId);
    await expect(links.answerPendingActivityAsStudent(other.userId, 'extra:' + run.id)).rejects.toThrow(/nao encontrada/i); // atividade de outro aluno: 404
    await links.answerPendingActivityAsStudent(w.userId, 'extra:' + run.id);
    expect(await prisma.activityLog.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'student' });
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'missed' });
    const result = await totals(w.userId, [w.session.id]);
    expect(result.extras.events).toHaveLength(1);
    expect(result.total.events).toBe(1);
    // toque duplo / outro aparelho: mesma resposta, sem erro
    await expect(links.answerPendingActivityAsStudent(w.userId, 'extra:' + run.id)).resolves.toMatchObject({ classification: 'alternative' });
  });

  it('10b) o marcador "extra:" nunca desfaz um vinculo ATIVO (cartao velho depois de um SIM em outro aparelho)', async () => {
    const w = await studentWithMissedSession('compat-velho');
    const run = await activity(w.userId, 'run12-velho');
    await links.classify(run.id);
    const candidate = await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: run.id, status: 'candidate' } });
    await links.answerPendingActivityAsStudent(w.userId, candidate.id); // SIM (linkId real pelo mesmo metodo/endpoint)
    await expect(links.answerPendingActivityAsStudent(w.userId, 'extra:' + run.id)).rejects.toThrow(/ja foi vinculada/);
    expect(await prisma.sessionExecutionLink.count({ where: { activityLogId: run.id, status: 'active' } })).toBe(1);
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'done' });
  });

  it('11) depois do SIM o aluno pode completar o feedback: a sessao entra nos feedbacks pendentes e o envio preserva as observacoes anteriores; nada subjetivo e preenchido sozinho', async () => {
    const w = await studentWithMissedSession('feedback-depois');
    const run = await activity(w.userId, 'run12-feedback');
    await links.classify(run.id);
    const candidate = await prisma.sessionExecutionLink.findFirstOrThrow({ where: { activityLogId: run.id, status: 'candidate' } });
    await prisma.workoutCompletion.update({ where: { sessionId: w.session.id }, data: { perceivedEffort: null } }); // o aluno nao tinha informado esforco ao marcar "nao fiz"
    await links.confirmCandidateAsStudent(w.userId, candidate.id);
    const afterYes = await completionOf(w.session.id);
    expect(afterYes).toMatchObject({ status: 'done', perceivedEffort: null, painFlag: null, notes: 'Nao consegui treinar' }); // nenhum campo subjetivo foi preenchido automaticamente

    const checkin = new WeeklyCheckInService(prisma as never, {} as never, {} as never) as unknown as { pendingFeedbacksForPlan(userId: string, plan: { startDate: Date }): Promise<Array<{ sessionId: string }>> };
    expect((await checkin.pendingFeedbacksForPlan(w.userId, { startDate: WEEK_START })).map((p) => p.sessionId)).toEqual([w.session.id]);

    const completions = new WorkoutCompletionsService(
      prisma as never, { get: () => '' } as never, { recordEvent: async () => undefined } as never, { notifyCoach: async () => undefined } as never,
      { linkFirstObservationIfPending: async () => undefined } as never, { record: async () => undefined } as never, { evaluateForUser: async () => [] } as never, { setUsage: async () => undefined } as never,
    );
    await completions.upsert(w.userId, {
      sessionId: w.session.id, status: 'done', perceivedEffort: 7, executionBehavior: 'as_planned', painFlag: 'none',
      preSleepQuality: 4, sleepDurationCategory: '7_a_8h', bedtimeShiftDirection: 'on_time', wakeTimeShiftDirection: 'on_time', sleepInterruption: 2, sleepDifficulty: 1,
      prePhysicalFatigue: 2, preMentalFatigue: 2, preStressLevel: 2, preMotivation: 4, satisfactionElaboracao: 'gostei', postPhysicalFatigue: 2, postMentalFatigue: 2,
      emotionalExperienceDuring: 4, mentalStateChangePrePost: 4,
    } as never);
    // a observacao anterior nao foi apagada (campo nao enviado = mantido) e o esforco informado agora e' o do aluno
    expect(await completionOf(w.session.id)).toMatchObject({ status: 'done', perceivedEffort: 7, notes: 'Nao consegui treinar' });
    expect(await checkin.pendingFeedbacksForPlan(w.userId, { startDate: WEEK_START })).toEqual([]);
  });
});
