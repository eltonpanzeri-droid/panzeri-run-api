import 'reflect-metadata';
import { BadRequestException, ConflictException, GoneException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../../src/auth/auth.service';
import { assertRoutineUnchanged, readRoutineState } from '../../src/common/routine-state';
import { CoachController } from '../../src/coach/coach.controller';
import { CoachService } from '../../src/coach/coach.service';
import { MeController } from '../../src/me/me.controller';
import { MeService } from '../../src/me/me.service';
import { RoutineService } from '../../src/me/routine.service';
import { ReportTimelineService } from '../../src/reporter/report-timeline.service';
import { TrainingPlansController } from '../../src/training-plans/training-plans.controller';
import { planMatchesRoutine, sessionStillInRoutine, TrainingPlansService } from '../../src/training-plans/training-plans.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Entrevista e rotina sao processos INDEPENDENTES (26/10/2026) — PostgreSQL real, dados sinteticos, nenhum servico externo (IA, Telegram, e-mail sao dublês).
// Cobre: a entrevista nao escreve rotina; primeiro cadastro e edicao pelo comando unico; pausa total e' rotina valida; revisao/conflito (inclusive concorrencia real);
// endpoints legados sem poder de escrita; primeira prescricao so' com rotina; geracao sem dias inventados e ligada a revisao; todas as modalidades sobrevivem;
// falha depois do commit nao vira erro; aluno e treinador coerentes.

function validCpf(): string {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const check = (base: number[]) => { const sum = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0); const rest = (sum * 10) % 11; return rest === 10 ? 0 : rest; };
  const d1 = check(digits); const d2 = check([...digits, d1]);
  return [...digits, d1, d2].join('');
}
const interviewAnswers = (over: Record<string, unknown> = {}) => ({
  personal_name: 'Aluno Sintetico', personal_phone: '11999999999', personal_cpf: validCpf(), personal_birth_date: '15/03/1990', personal_sex: 'Masculino', personal_height: 175, personal_weight: 70,
  personal_address_city: 'Sao Paulo', personal_address_state: 'SP', objective: 'Completar 5 km', running_experience: 'Nunca corri', current_activities: ['Musculacao'], favorite_activities: ['Natacao'],
  sleep_hours: 'Entre 6 e 7 horas', rating_stress: 7, rating_anxiety: 4, continuous_medications: 'nenhuma', current_pain: 'no', important_injury: 'never', health_conditions: ['Nenhuma'], ...over,
});
type Day = { weekday: number; noTraining: boolean; modalities: string[]; availableMin?: number | null; modalityDurations?: Record<string, number> };
const rest = (weekday: number): Day => ({ weekday, noTraining: true, modalities: [], availableMin: 0 });
const run = (weekday: number, minutes = 40): Day => ({ weekday, noTraining: false, modalities: ['corrida'], availableMin: minutes, modalityDurations: { corrida: minutes } });
const week = (active: Day[]): Day[] => Array.from({ length: 7 }, (_, weekday) => active.find((day) => day.weekday === weekday) ?? rest(weekday));

describe('separacao definitiva entre entrevista e rotina (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const generateFirstWeekIfNeeded = jest.fn(async () => undefined);
  const trainingPlansStub = { generateFirstWeekIfNeeded, generateWeek: jest.fn(async () => { throw new Error('generateWeek NAO pode ser chamado aqui'); }) };
  const telegram = { notifyCoach: jest.fn(async () => undefined) };
  const studentProfile = { recordEvent: jest.fn(async () => undefined) };
  const relator = { analyze: jest.fn(async () => null) };
  const reportTimeline = new ReportTimelineService(prisma as never, relator as never, studentProfile as never);
  const routine = new RoutineService(prisma as never, trainingPlansStub as never, studentProfile as never, telegram as never, reportTimeline);
  const me = new MeService(prisma as never, trainingPlansStub as never, studentProfile as never, telegram as never, reportTimeline);

  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });
  beforeEach(() => { jest.clearAllMocks(); });

  async function student(label: string, opts: { access?: boolean; interview?: boolean } = {}) {
    const s = await seedStudent(prisma, label, { startDate: new Date('2026-10-05T00:00:00.000Z') });
    userIds.push(s.userId);
    // seedStudent cria um programa; para testar o "sem rotina" ele e' removido (apenas dados sinteticos)
    await prisma.workoutCompletion.deleteMany({ where: { userId: s.userId } });
    await prisma.trainingSession.deleteMany({ where: { userId: s.userId } });
    await prisma.trainingPlan.deleteMany({ where: { userId: s.userId } });
    await prisma.user.update({ where: { id: s.userId }, data: { subscriptionStatus: opts.access === false ? 'pending' : 'active' } });
    if (opts.interview !== false) await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: interviewAnswers(), completedAt: new Date('2026-10-01T00:00:00Z') } });
    return s;
  }
  const rows = (userId: string) => prisma.weeklyAvailability.findMany({ where: { userId }, orderBy: { weekday: 'asc' } });

  it('1/3/4. a entrevista conclui SEM escrever na rotina; o primeiro cadastro e as edicoes nao tocam a entrevista', async () => {
    const s = await student('entrevista', { interview: false });
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: interviewAnswers({ monday_run_time: 'from_45_to_60', routine_modality_choice: 'corrida' }) } });
    const done = await me.completeOnboarding(s.userId);
    expect(done).toMatchObject({ completed: true, routineConfigured: false });
    expect(await rows(s.userId)).toHaveLength(0); // as respostas antigas de rotina na entrevista NAO viram disponibilidade
    expect(await prisma.weeklyRoutineState.count({ where: { userId: s.userId } })).toBe(0);
    expect(generateFirstWeekIfNeeded).not.toHaveBeenCalled(); // assinante sem rotina: aguarda o formulario da rotina

    const interviewBefore = await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } });
    expect(await routine.status(s.userId)).toMatchObject({ configured: false, revision: 0 });
    const first = await routine.replaceWeek(s.userId, week([run(1), run(3), run(6, 90)]), { expectedRevision: 0, source: 'student', actorId: s.userId });
    expect(first).toMatchObject({ status: 'saved', configured: true, revision: 1, routineChanged: true, firstTime: true });
    await routine.replaceWeek(s.userId, week([run(2)]), { expectedRevision: 1, source: 'student', actorId: s.userId });
    const interviewAfter = await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } });
    expect(interviewAfter.answers).toEqual(interviewBefore.answers); // respostas da entrevista intactas
    expect(interviewAfter.completedAt).toEqual(interviewBefore.completedAt); // entrevista continua concluida (nao foi reaberta)
    expect(generateFirstWeekIfNeeded).toHaveBeenCalled(); // a primeira prescricao parte da rotina cadastrada
    expect((await rows(s.userId)).filter((d) => !d.noTraining).map((d) => d.weekday)).toEqual([2]);
  });

  it('5/6. rotina com os sete dias de descanso e VALIDA: continua cadastrada e nada a restaura a partir da entrevista, mesmo reconcluindo-a', async () => {
    const s = await student('pausa');
    await routine.replaceWeek(s.userId, week([]), { source: 'student', actorId: s.userId });
    expect(await readRoutineState(prisma, s.userId)).toMatchObject({ configured: true, allRest: true, revision: 1 });
    await prisma.onboardingInterview.update({ where: { userId: s.userId }, data: { answers: interviewAnswers({ monday_run_time: 'from_45_to_60', routine_modality_choice: 'corrida' }) } });
    generateFirstWeekIfNeeded.mockClear(); // (a propria gravacao da pausa ja chamou o gate; o que interessa e' a reconclusao da entrevista)
    await me.reopenOnboarding(s.userId);
    await me.completeOnboarding(s.userId); // reconclui a entrevista com respostas antigas de rotina
    const state = await readRoutineState(prisma, s.userId);
    expect(state).toMatchObject({ configured: true, allRest: true, revision: 1 });
    expect((await rows(s.userId)).every((d) => d.noTraining)).toBe(true);
    expect(await me.availability(s.userId)).toHaveLength(7);
    expect(generateFirstWeekIfNeeded).not.toHaveBeenCalled(); // pausa nao dispara geracao
  });

  it('7/8. caminhos legados nao escrevem a rotina: complete-routine e reparo respondem 410; resposta de rotina na entrevista e recusada; anamnese ignora disponibilidade', async () => {
    const s = await student('legado');
    await routine.replaceWeek(s.userId, week([run(4)]), { source: 'student', actorId: s.userId });
    const before = await rows(s.userId);
    const controller = new MeController(me as never, {} as never, prisma as never, {} as never, routine);
    const asUser = { sub: s.userId } as never;
    // compatibilidade LIGADA (padrao): quem ja tem rotina nunca e' alterado pelo app antigo
    await expect(controller.completeRoutine(asUser)).resolves.toMatchObject({ preserved: true, firstTime: false });
    await expect(controller.saveOnboardingAnswer(asUser, { key: 'monday_run_time', value: 'from_45_to_60', currentStep: 3 })).resolves.toEqual({ staged: true });
    expect((await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } })).answers).not.toHaveProperty('monday_run_time');
    expect(await rows(s.userId)).toEqual(before);
    // compatibilidade DESLIGADA: 410 / 400 como no fluxo novo
    process.env.LEGACY_ROUTINE_COMPAT = 'off';
    try {
      await expect(controller.completeRoutine(asUser)).rejects.toBeInstanceOf(GoneException);
      await expect(controller.saveOnboardingAnswer(asUser, { key: 'monday_run_time', value: 'from_45_to_60', currentStep: 3 })).rejects.toBeInstanceOf(BadRequestException);
    } finally { delete process.env.LEGACY_ROUTINE_COMPAT; }
    const coachController = Object.create(CoachController.prototype) as CoachController;
    expect(() => coachController.syncStudentAvailability()).toThrow(GoneException);
    expect((CoachService.prototype as unknown as Record<string, unknown>).syncStudentAvailability).toBeUndefined();
    expect((MeService.prototype as unknown as Record<string, unknown>).syncAvailabilityFromInterview).toBeUndefined();
    expect((MeService.prototype as unknown as Record<string, unknown>).completeRoutineFromInterview).toBeUndefined();

    for (const key of ['monday_run_time', 'routine_modality_choice', 'routine_observation', 'sunday_musculacao_available_time']) {
      await expect(me.saveOnboardingAnswer(s.userId, { key, value: 'from_45_to_60', currentStep: 3 })).rejects.toBeInstanceOf(BadRequestException);
    }
    const stored = await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } });
    expect(stored.answers).not.toHaveProperty('monday_run_time');
    await me.saveOnboardingAnswer(s.userId, { key: 'objective', value: 'Melhorar meu tempo', currentStep: 1 }); // o resto da entrevista segue funcionando

    await me.updateAnamnese(s.userId, {
      profile: { name: 'Aluno', email: `legado-${s.userId.slice(0, 6)}@sintetico.invalid`, birthDate: new Date('1990-01-01'), sex: 'Masculino', heightCm: 170, weightKg: 70 },
      health: { averageSleep: 'Entre 6 e 7 horas', stressLevel: '7/10' },
      preferences: { preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Rua'], mainGoal: 'Completar 10 km', experienceLevel: 'iniciante_intermediario' },
      availability: { availability: week([run(0, 60), run(5, 60)]), observation: 'tentativa antiga' },
    } as never);
    expect(await rows(s.userId)).toEqual(before); // cliente antigo reenviando semana obsoleta: a rotina nao muda
    expect((await readRoutineState(prisma, s.userId)).revision).toBe(1);
  });

  it('17. compatibilidade com app antigo: 1o cadastro so pelo comando unico, sem restaurar respostas historicas, sem tocar rotina existente', async () => {
    const s = await student('appantigo', { interview: false });
    // entrevista com respostas HISTORICAS de rotina (sem carimbo de sessao): nunca devem virar rotina
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: interviewAnswers({ monday_run_time: 'from_60_to_90', routine_modality_choice: 'corrida' }), completedAt: new Date('2026-10-01T00:00:00Z') } });
    const controller = new MeController(me as never, {} as never, prisma as never, {} as never, routine);
    const asUser = { sub: s.userId } as never;
    // sem nenhuma resposta nesta sessao: nada e' gravado
    await expect(controller.completeRoutine(asUser)).rejects.toBeInstanceOf(BadRequestException);
    expect(await rows(s.userId)).toHaveLength(0);

    // sessao do app antigo: o rascunho antigo e' descartado e so' as respostas desta sessao contam
    await controller.saveOnboardingAnswer(asUser, { key: 'routine_modality_choice', value: 'corrida', currentStep: 1 });
    await controller.saveOnboardingAnswer(asUser, { key: 'tuesday_run_time', value: 'from_30_to_45', currentStep: 2 });
    await controller.saveOnboardingAnswer(asUser, { key: 'thursday_run_time', value: 'up_to_30', currentStep: 3 });
    const staged = (await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } })).answers as Record<string, unknown>;
    expect(staged).not.toHaveProperty('monday_run_time');
    expect(await rows(s.userId)).toHaveLength(0); // rascunho nao e' rotina

    const done = await controller.completeRoutine(asUser);
    expect(done).toMatchObject({ synced: true, firstTime: true, days: 2 });
    const saved = await rows(s.userId);
    expect(saved.filter((d) => !d.noTraining).map((d) => [d.weekday, d.modalityDurations])).toEqual([[2, { corrida: 45 }], [4, { corrida: 30 }]]);
    const change = await prisma.weeklyRoutineChange.findFirstOrThrow({ where: { userId: s.userId } });
    expect(change).toMatchObject({ revision: 1, source: 'legacy_app' });
    const after = (await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } })).answers as Record<string, unknown>;
    expect(Object.keys(after).filter((key) => key.includes('_run_time') || key.startsWith('__legacy'))).toEqual([]); // rascunho consumido
    expect(generateFirstWeekIfNeeded).toHaveBeenCalledTimes(1);

    // repetir: nao altera nada
    await expect(controller.completeRoutine(asUser)).resolves.toMatchObject({ preserved: true });
    expect((await readRoutineState(prisma, s.userId)).revision).toBe(1);

    // rascunho VELHO (mais de 48h) nao vira rotina
    const old = await student('appantigo-velho', { interview: false });
    await prisma.onboardingInterview.create({ data: { userId: old.userId, answers: interviewAnswers({ monday_run_time: 'from_45_to_60', __legacy_routine_staged_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString() }) } });
    await expect(controller.completeRoutine({ sub: old.userId } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(await rows(old.userId)).toHaveLength(0);
  });

  it('9/16. escrita obsoleta recebe 409 sem alterar nada; duas gravacoes simultaneas: so uma vence; treinador e aluno coerentes pela mesma revisao', async () => {
    const s = await student('conflito');
    await routine.replaceWeek(s.userId, week([run(1)]), { expectedRevision: 0, source: 'student', actorId: s.userId }); // revisao 1
    const coach = Object.create(CoachService.prototype) as CoachService & Record<string, unknown>;
    Object.assign(coach, { prisma, routine, assertStudent: async () => undefined, logger: { warn: jest.fn() } });

    // o treinador salva com a revisao que carregou (1) -> revisao 2; a aluna, ainda com a 1, e' barrada
    await coach.updateStudentAvailability(s.userId, { availability: week([run(2), run(4)]), applyNow: false, expectedRevision: 1 } as never, 'coach-1');
    await expect(routine.replaceWeek(s.userId, week([run(5)]), { expectedRevision: 1, source: 'student', actorId: s.userId })).rejects.toMatchObject({ response: { code: 'routine_conflict', revision: 2 } });
    expect((await rows(s.userId)).filter((d) => !d.noTraining).map((d) => d.weekday)).toEqual([2, 4]); // a escrita obsoleta nao venceu
    // treinador sem revisao (painel antigo/aberto antes): recusado; revisao velha: 409
    await expect(coach.updateStudentAvailability(s.userId, { availability: week([run(3)]), applyNow: false } as never, 'coach-1')).rejects.toMatchObject({ response: { code: 'routine_revision_required' } });
    await expect(coach.updateStudentAvailability(s.userId, { availability: week([run(3)]), applyNow: false, expectedRevision: 1 } as never, 'coach-1')).rejects.toBeInstanceOf(ConflictException);

    // concorrencia real: duas gravacoes com a MESMA revisao esperada — exatamente uma passa
    const results = await Promise.allSettled([
      routine.replaceWeek(s.userId, week([run(0)]), { expectedRevision: 2, source: 'student', actorId: s.userId }),
      routine.replaceWeek(s.userId, week([run(6)]), { expectedRevision: 2, source: 'coach', actorId: 'coach-1' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && (r.reason as ConflictException) instanceof ConflictException)).toHaveLength(1);
    expect((await readRoutineState(prisma, s.userId)).revision).toBe(3);

    // historico: uma linha por gravacao efetiva, com origem e ator; so agenda (nenhum texto livre)
    const changes = await prisma.weeklyRoutineChange.findMany({ where: { userId: s.userId }, orderBy: { revision: 'asc' } });
    expect(changes.map((c) => c.revision)).toEqual([1, 2, 3]);
    expect(changes[1]).toMatchObject({ source: 'coach', actorId: 'coach-1' });
    expect(JSON.stringify(changes[1].after)).not.toMatch(/observa|nome|email/i);
  });

  it('alteracao parcial so muda os dias enviados; semana incompleta na substituicao integral e recusada; aluno legado (sem estado) conta como cadastrado, revisao 0', async () => {
    const s = await student('parcial');
    await routine.replaceWeek(s.userId, week([run(1), run(3), run(5)]), { source: 'student', actorId: s.userId });
    await expect(routine.replaceWeek(s.userId, [run(2)] as never, { source: 'student' })).rejects.toBeInstanceOf(BadRequestException); // 1 dia nao apaga os outros 6
    expect((await rows(s.userId)).filter((d) => !d.noTraining).map((d) => d.weekday)).toEqual([1, 3, 5]);
    const patched = await routine.patchDays(s.userId, [{ weekday: 3, noTraining: true, modalities: [] }] as never, { expectedRevision: 1, source: 'student' });
    expect(patched.revision).toBe(2);
    expect((await rows(s.userId)).filter((d) => !d.noTraining).map((d) => d.weekday)).toEqual([1, 5]);

    const legacy = await student('legado-linhas');
    await prisma.weeklyAvailability.create({ data: { userId: legacy.userId, weekday: 2, noTraining: false, modalities: ['forca'], availableMin: 50, modalityDurations: { forca: 50 } } });
    expect(await readRoutineState(prisma, legacy.userId)).toMatchObject({ configured: true, revision: 0, allRest: false });
    await expect(routine.replaceWeek(legacy.userId, week([run(4)]), { expectedRevision: 1, source: 'student' })).rejects.toBeInstanceOf(ConflictException);
    await routine.replaceWeek(legacy.userId, week([run(4)]), { expectedRevision: 0, source: 'student' });
    expect((await readRoutineState(prisma, legacy.userId)).revision).toBe(1);
    await expect(routine.patchDays(legacy.userId, [run(1)] as never, { expectedRevision: 1, source: 'student' })).resolves.toMatchObject({ status: 'saved' });
  });

  it('14. todas as modalidades (inclusive legadas) sobrevivem a leitura, edicao e novo salvamento; reenviar o que foi lido nao altera nada', async () => {
    const s = await student('modalidades');
    const full: Day[] = week([
      { weekday: 1, noTraining: false, modalities: ['corrida', 'forca', 'fortalecimento_corredores'], availableMin: 120, modalityDurations: { corrida: 50, forca: 40, fortalecimento_corredores: 30 } },
      { weekday: 3, noTraining: false, modalities: ['bike', 'natacao', 'esteira'], availableMin: 100, modalityDurations: { bike: 60, natacao: 40 } },
    ]);
    await routine.replaceWeek(s.userId, full, { source: 'student' });
    const read = (await routine.status(s.userId)).availability.map((d) => ({ weekday: d.weekday, noTraining: d.noTraining, modalities: d.modalities, availableMin: d.availableMin, modalityDurations: d.modalityDurations as Record<string, number> }));
    expect(read.find((d) => d.weekday === 3)?.modalities.sort()).toEqual(['bike', 'esteira', 'natacao']); // "bike" NAO virou corrida
    const resave = await routine.replaceWeek(s.userId, read as never, { expectedRevision: 1, source: 'student' });
    expect(resave.status).toBe('unchanged'); // ida e volta identica: sem nova revisao
    expect(resave.revision).toBe(1);
    await expect(routine.replaceWeek(s.userId, week([{ weekday: 2, noTraining: false, modalities: ['Corrida!'], availableMin: 40 }]), { source: 'student' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(routine.replaceWeek(s.userId, week([{ weekday: 2, noTraining: false, modalities: ['corrida'], availableMin: -5 }]), { source: 'student' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('15. falha de efeito secundario DEPOIS do commit (aviso, relato, primeira geracao) nao vira erro nem desfaz a rotina salva', async () => {
    const s = await student('pos-commit');
    telegram.notifyCoach.mockImplementation((() => { throw new Error('telegram fora do ar'); }) as never);
    generateFirstWeekIfNeeded.mockImplementation((async () => { throw new Error('IA fora do ar'); }) as never);
    const failingTimeline = jest.spyOn(reportTimeline, 'record').mockRejectedValue(new Error('relator fora do ar'));
    const result = await routine.replaceWeek(s.userId, week([run(2)]), { source: 'student', actorId: s.userId, observation: 'so treino de manha' });
    expect(result).toMatchObject({ status: 'saved', revision: 1, configured: true });
    expect((await rows(s.userId)).filter((d) => !d.noTraining).map((d) => d.weekday)).toEqual([2]); // gravada e confirmada pelo banco
    failingTimeline.mockRestore();
  });

  it('observacao textual junto da rotina vai ao fluxo de relatos uma vez (mesmo reenviada) e nunca altera a agenda', async () => {
    const s = await student('observacao');
    await routine.replaceWeek(s.userId, week([run(2)]), { source: 'student', observation: '  Faco musculacao em outra academia  ' });
    await routine.replaceWeek(s.userId, week([run(2)]), { expectedRevision: 1, source: 'student', observation: 'Faco musculacao em outra academia' }); // igual: sem nova revisao
    const entries = await prisma.studentReportEntry.findMany({ where: { userId: s.userId, sourceType: 'onboarding_interview_routine_note' } });
    expect(entries.map((e) => e.originalText)).toEqual(['Faco musculacao em outra academia']);
    expect((await readRoutineState(prisma, s.userId)).revision).toBe(1);
  });

  it('10/11. primeira prescricao exige entrevista + rotina cadastrada COM dias; pausa e ausencia de cadastro nao geram; nenhum dia fixo de reserva', async () => {
    const generateWeek = jest.fn(async () => undefined);
    const plans = Object.assign(Object.create(TrainingPlansService.prototype), { prisma, generateWeek }) as TrainingPlansService;

    const none = await student('prescricao-sem-rotina');
    await plans.generateFirstWeekIfNeeded(none.userId);
    expect(generateWeek).not.toHaveBeenCalled(); // sem rotina: nada

    const paused = await student('prescricao-pausa');
    await routine.replaceWeek(paused.userId, week([]), { source: 'student', skipFirstGeneration: true });
    await plans.generateFirstWeekIfNeeded(paused.userId);
    expect(generateWeek).not.toHaveBeenCalled(); // pausa: nada

    const noInterview = await student('prescricao-sem-entrevista', { interview: false });
    await routine.replaceWeek(noInterview.userId, week([run(1)]), { source: 'student', skipFirstGeneration: true });
    await plans.generateFirstWeekIfNeeded(noInterview.userId);
    expect(generateWeek).not.toHaveBeenCalled(); // rotina sem entrevista concluida: nada

    const ok = await student('prescricao-ok');
    await routine.replaceWeek(ok.userId, week([run(1)]), { source: 'student', skipFirstGeneration: true });
    await plans.generateFirstWeekIfNeeded(ok.userId);
    expect(generateWeek).toHaveBeenCalledTimes(1);

    // a geracao em si: sem rotina cadastrada ou em pausa, recusa — sem sessoes em dias inventados
    const locked = Object.assign(Object.create(TrainingPlansService.prototype), {
      prisma, requireTrace: () => ({}), logger: { log: jest.fn(), warn: jest.fn() }, recentAiFailures: new Map(),
      reassessmentService: { isReassessmentDue: async () => false, getLatestValidEvolutionReport: async () => null },
      painReports: { computeSafetyTier: async () => ({ tier: 'normal', reason: null }) },
      targetRaces: { activeGoals: async () => [] },
      menstrualCycle: { getAgentContext: async () => null },
    }) as unknown as { generateWeekLocked: (userId: string, options?: object) => Promise<unknown> };
    for (const [userId, code] of [[none.userId, 'routine_required'], [paused.userId, 'routine_all_rest']] as const) {
      await expect(locked.generateWeekLocked(userId)).rejects.toMatchObject({ response: { code } });
      expect(await prisma.trainingPlan.count({ where: { userId } })).toBe(0); // nenhum programa/sessao criado
    }
  });

  it('12/13. publicar programa sobre rotina que mudou durante a geracao e recusado; plano com override nao escapa da comparacao; regeneracao de dia fora da rotina e barrada; o corpo do cliente nao e override', async () => {
    const s = await student('revisao-geracao');
    await routine.replaceWeek(s.userId, week([run(1), run(3)]), { source: 'student', skipFirstGeneration: true });
    const atStart = await readRoutineState(prisma, s.userId);
    await expect(prisma.$transaction((tx) => assertRoutineUnchanged(tx as never, s.userId, atStart))).resolves.toBeUndefined();
    await routine.replaceWeek(s.userId, week([run(2)]), { expectedRevision: atStart.revision, source: 'coach', actorId: 'coach-1', skipFirstGeneration: true }); // muda DURANTE a geracao
    await expect(prisma.$transaction((tx) => assertRoutineUnchanged(tx as never, s.userId, atStart))).rejects.toMatchObject({ response: { code: 'routine_changed_during_generation' } });
    // a verificacao de atualizacao do programa usa a revisao (override antigo nao tem mais excecao)
    const active = [{ weekday: 2, modalities: ['corrida'], availableMin: 40, modalityDurations: { corrida: 40 } }];
    expect(planMatchesRoutine({ routineRevision: 1 }, 2, active)).toBe(false);
    expect(planMatchesRoutine({ routineRevision: 2 }, 2, active)).toBe(true);
    expect(planMatchesRoutine({ weeklyOverrideUsed: true, availabilityDays: [{ weekday: 1, modalities: ['corrida'], availableMin: 40, modalityDurations: {} }] }, 0, active)).toBe(false);
    // regeneracao do CONTEUDO de um dia que saiu da rotina
    expect(sessionStillInRoutine(active, { weekday: 1, modality: 'corrida' })).toBe(false);
    expect(sessionStillInRoutine(active, { weekday: 2, modality: 'esteira' })).toBe(true); // qualquer corrida vale para corrida
    expect(sessionStillInRoutine(active, { weekday: 2, modality: 'forca' })).toBe(false);
    // o controlador ignora a disponibilidade enviada pelo cliente
    const generateWeek = jest.fn(async () => undefined);
    const plansController = new TrainingPlansController({ generateWeek } as never, {} as never);
    await plansController.generateWeek({ sub: s.userId } as never, { availability: week([run(0)]) });
    expect(generateWeek).toHaveBeenCalledWith(s.userId);
    expect((await readRoutineState(prisma, s.userId)).activeDays.map((d) => d.weekday)).toEqual([2]);
  });

  it('o estado da rotina chega ao app em /me (cadastrada? revisao? pausa?)', async () => {
    const s = await student('me-estado');
    const auth = Object.create(AuthService.prototype) as AuthService & Record<string, unknown>;
    Object.assign(auth, { prisma });
    expect(await auth.me(s.userId)).toMatchObject({ routine: { configured: false, revision: 0, allRest: false } });
    await routine.replaceWeek(s.userId, week([]), { source: 'student', skipFirstGeneration: true });
    expect(await auth.me(s.userId)).toMatchObject({ routine: { configured: true, revision: 1, allRest: true } });
  });
});
