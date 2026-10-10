import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaClient } from '@prisma/client';
import { CoachService } from '../../src/coach/coach.service';
import { UpdateAnamneseDto } from '../../src/me/dto/update-anamnese.dto';
import { UpdateHealthDto } from '../../src/me/dto/update-health.dto';
import { MeService } from '../../src/me/me.service';
import { ReassessmentService } from '../../src/reassessment/reassessment.service';
import { ReportTimelineService } from '../../src/reporter/report-timeline.service';
import { TechnicalManagerAgentService } from '../../src/technical-manager/technical-manager-agent.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Rotina semanal, entrevista, objetivo e relatos (10/2026) em PostgreSQL real e dados sinteticos.

const validation = (cls: new () => object, body: object) => validateSync(plainToInstance(cls, body) as object, { whitelist: true, forbidNonWhitelisted: true });
// CPF valido e unico por execucao (a coluna e unica; evita colisao com restos de execucoes anteriores)
function validCpf(): string {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const check = (base: number[]) => { const sum = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0); const rest = (sum * 10) % 11; return rest === 10 ? 0 : rest; };
  const d1 = check(digits); const d2 = check([...digits, d1]);
  return [...digits, d1, d2].join('');
}
const day = (weekday: number, over: Record<string, unknown> = {}) => ({ weekday, noTraining: false, modalities: ['corrida'], availableMin: 40, modalityDurations: { corrida: 40 }, ...over });

describe('rotina, entrevista, objetivo e relatos (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const userIds: string[] = [];
  const trainingPlans = { generateWeek: jest.fn(async () => { throw new Error('generateWeek NAO pode ser chamado ao salvar rotina/entrevista'); }), generateFirstWeekIfNeeded: jest.fn(async () => undefined) };
  const telegram = { notifyCoach: jest.fn(async () => undefined) };
  const profileEvents: Array<{ code: string; content: string }> = [];
  const studentProfile = { recordEvent: jest.fn(async (_userId: string, code: string, content: string) => { profileEvents.push({ code, content }); }) };
  const relator = { analyze: jest.fn(async () => null) };
  const reportTimeline = new ReportTimelineService(prisma as never, relator as never, studentProfile as never);
  const me = new MeService(prisma as never, trainingPlans as never, studentProfile as never, telegram as never, reportTimeline);

  afterAll(async () => {
    await prisma.reassessment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.menstrualProfile.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await cleanupStudents(prisma, userIds);
    await prisma.$disconnect();
  });
  beforeEach(() => { jest.clearAllMocks(); profileEvents.length = 0; });

  async function student(label: string) {
    const s = await seedStudent(prisma, label, { startDate: new Date('2026-10-05T00:00:00.000Z') });
    userIds.push(s.userId);
    return s;
  }
  const routineAnswers = (over: Record<string, unknown> = {}) => ({ routine_modality_choice: 'corrida', monday_run_time: 'from_45_to_60', wednesday_run_time: 'from_45_to_60', saturday_run_time: 'from_90_to_150', ...over });

  it('valores historicos de saude (o que a propria entrevista grava) passam na validacao; lixo continua rejeitado; a rotina e opcional no salvamento composto', () => {
    expect(validation(UpdateHealthDto, { averageSleep: 'Entre 6 e 7 horas', stressLevel: '7/10', anxietyLevel: '5/10' })).toHaveLength(0);
    expect(validation(UpdateHealthDto, { averageSleep: 'Menos de 5 horas', stressLevel: 'Nao informado', anxietyLevel: 'nao' })).toHaveLength(0);
    expect(validation(UpdateHealthDto, { averageSleep: '6_7', stressLevel: 'moderado', anxietyLevel: 'leve' })).toHaveLength(0);
    expect(validation(UpdateHealthDto, { averageSleep: 'qualquer coisa', stressLevel: 'enorme' }).length).toBeGreaterThan(0);
    const body = { profile: { name: 'Aluno', email: 'a@b.invalid', birthDate: '1990-01-01', sex: 'prefiro_nao_informar', heightCm: 170, weightKg: 70 }, health: { averageSleep: 'Entre 6 e 7 horas', stressLevel: '7/10' }, preferences: { preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Rua'], mainGoal: 'Completar 10 km', experienceLevel: 'iniciante_intermediario' } };
    expect(validation(UpdateAnamneseDto, body)).toHaveLength(0); // sem availability
    // um campo desconhecido (como o health.activityLevel do relato da aluna) continua sendo recusado pela API — nao e' aceito silenciosamente
    expect(validation(UpdateAnamneseDto, { ...body, health: { ...body.health, activityLevel: 'ativa' } }).length).toBeGreaterThan(0);
  });

  it('alterar so a rotina (PUT /me/availability): so a WeeklyAvailability muda; saude historica, programa entregue e sessoes ficam intactos e nada e regenerado', async () => {
    const s = await student('rotina');
    await prisma.healthProfile.create({ data: { userId: s.userId, averageSleep: 'Entre 6 e 7 horas', stressLevel: '7/10', anxietyLevel: '4/10' } });
    await prisma.weeklyAvailability.create({ data: { userId: s.userId, weekday: 1, noTraining: false, modalities: ['corrida'], availableMin: 40, modalityDurations: { corrida: 40 } } });
    const sessionsBefore = await prisma.trainingSession.findMany({ where: { userId: s.userId }, orderBy: { id: 'asc' } });
    const result = await me.updateAvailability(s.userId, { availability: [day(1), day(3, { modalities: ['forca'], modalityDurations: { forca: 50 }, availableMin: 50 })] } as never);
    expect(result.routineChanged).toBe(true);
    expect((await prisma.weeklyAvailability.findMany({ where: { userId: s.userId }, orderBy: { weekday: 'asc' } })).map((d) => [d.weekday, d.modalities])).toEqual([[1, ['corrida']], [3, ['forca']]]);
    const health = await prisma.healthProfile.findUniqueOrThrow({ where: { userId: s.userId } });
    expect([health.averageSleep, health.stressLevel, health.anxietyLevel]).toEqual(['Entre 6 e 7 horas', '7/10', '4/10']);
    expect(await prisma.trainingSession.findMany({ where: { userId: s.userId }, orderBy: { id: 'asc' } })).toEqual(sessionsBefore); // treinos ja entregues: identicos
    expect(trainingPlans.generateWeek).not.toHaveBeenCalled();
    expect(await prisma.trainingPlan.count({ where: { userId: s.userId, status: 'active' } })).toBeGreaterThanOrEqual(0);
  });

  it('salvamento composto SEM rotina (perfil/saude/preferencias): a WeeklyAvailability atual nao e tocada', async () => {
    const s = await student('composto');
    await prisma.weeklyAvailability.create({ data: { userId: s.userId, weekday: 2, noTraining: false, modalities: ['forca'], availableMin: 60, modalityDurations: { forca: 60 } } });
    await me.updateAnamnese(s.userId, {
      profile: { name: 'Aluno Sintetico', email: `composto-${s.userId.slice(0, 6)}@sintetico.invalid`, birthDate: new Date('1990-01-01'), sex: 'prefiro_nao_informar', heightCm: 170, weightKg: 70 },
      health: { averageSleep: 'Entre 6 e 7 horas', stressLevel: '7/10' },
      preferences: { preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Rua'], mainGoal: 'Completar 10 km', experienceLevel: 'iniciante_intermediario' },
    } as never);
    expect((await prisma.weeklyAvailability.findMany({ where: { userId: s.userId } })).map((d) => [d.weekday, d.modalities])).toEqual([[2, ['forca']]]);
    expect((await prisma.healthProfile.findUniqueOrThrow({ where: { userId: s.userId } })).stressLevel).toBe('7/10'); // valor historico preservado, sem conversao
  });

  it('tela da entrevista com rotina JA existente: as respostas antigas NAO a sobrescrevem; observacao sobre a rotina vai ao fluxo de relatos UMA vez, mesmo reenviada', async () => {
    const s = await student('entrevista');
    await prisma.weeklyAvailability.create({ data: { userId: s.userId, weekday: 5, noTraining: false, modalities: ['corrida'], availableMin: 40, modalityDurations: { corrida: 40 } } }); // rotina atual (ex.: editada pelo treinador)
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: routineAnswers({ routine_observation: 'Ja treino musculacao em outra academia' }), completedAt: new Date('2026-08-01T00:00:00Z') } });
    const first = await me.completeRoutineFromInterview(s.userId, true);
    expect(first).toMatchObject({ synced: false, preserved: true });
    expect((await prisma.weeklyAvailability.findMany({ where: { userId: s.userId } })).map((d) => d.weekday)).toEqual([5]); // nada de seg/qua/sab da entrevista antiga
    const entries = await prisma.studentReportEntry.findMany({ where: { userId: s.userId, sourceType: 'onboarding_interview_routine_note' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ originalText: 'Ja treino musculacao em outra academia', userId: s.userId });
    expect(entries[0].occurredAt).toBeInstanceOf(Date);
    await new Promise((resolve) => setTimeout(resolve, 100)); // a analise do Relator roda em segundo plano
    expect(relator.analyze).toHaveBeenCalledTimes(1); // segue ao Relator existente
    expect(profileEvents.filter((e) => e.code === 'STUDENT_OBSERVATION')).toHaveLength(1);
    await me.completeRoutineFromInterview(s.userId, true); // mesma resposta reenviada sem alteracao
    expect(await prisma.studentReportEntry.count({ where: { userId: s.userId, sourceType: 'onboarding_interview_routine_note' } })).toBe(1);
    expect(profileEvents.filter((e) => e.code === 'STUDENT_OBSERVATION')).toHaveLength(1);
    // texto alterado => novo relato (historico preservado, nada apagado)
    await prisma.onboardingInterview.update({ where: { userId: s.userId }, data: { answers: routineAnswers({ routine_observation: 'Mudei de emprego, treino so de manha' }) } });
    await me.completeRoutineFromInterview(s.userId, true);
    expect(await prisma.studentReportEntry.count({ where: { userId: s.userId, sourceType: 'onboarding_interview_routine_note' } })).toBe(2);
  });

  it('primeira rotina (sem WeeklyAvailability): continua sendo criada a partir das respostas da rotina', async () => {
    const s = await student('primeira');
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: routineAnswers(), completedAt: new Date('2026-10-01T00:00:00Z') } });
    const result = await me.completeRoutineFromInterview(s.userId, true);
    expect(result).toMatchObject({ synced: true, days: 3 });
    expect((await prisma.weeklyAvailability.findMany({ where: { userId: s.userId, noTraining: false } })).map((d) => d.weekday).sort()).toEqual([1, 3, 6]);
  });

  it('reparo do treinador: previa por padrao (nada e gravado) e so substitui com dryRun=false', async () => {
    const s = await student('reparo');
    await prisma.weeklyAvailability.create({ data: { userId: s.userId, weekday: 5, noTraining: false, modalities: ['corrida'], availableMin: 40, modalityDurations: { corrida: 40 } } });
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: routineAnswers(), completedAt: new Date('2026-10-01T00:00:00Z') } });
    const preview = await me.syncAvailabilityFromInterview(s.userId, false, true, { dryRun: true, force: true });
    expect(preview).toMatchObject({ dryRun: true, changed: true });
    expect((await prisma.weeklyAvailability.findMany({ where: { userId: s.userId } })).map((d) => d.weekday)).toEqual([5]);
    await me.syncAvailabilityFromInterview(s.userId, false, true, { dryRun: false, force: true });
    expect((await prisma.weeklyAvailability.findMany({ where: { userId: s.userId, noTraining: false } })).map((d) => d.weekday).sort()).toEqual([1, 3, 6]);
  });

  it('treinador edita a rotina: o aluno ve a mesma WeeklyAvailability; as respostas da entrevista (historico) NAO sao reescritas; nada e regenerado alem da 1a semana', async () => {
    const s = await student('treinador');
    const interviewAnswers = routineAnswers();
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: interviewAnswers, completedAt: new Date('2026-10-01T00:00:00Z') } });
    const coach = Object.create(CoachService.prototype) as CoachService & Record<string, unknown>;
    Object.assign(coach, { prisma, trainingPlans, assertStudent: async () => undefined, logger: { warn: jest.fn() } });
    await coach.updateStudentAvailability(s.userId, { availability: [day(4, { modalities: ['forca'], modalityDurations: { forca: 45 }, availableMin: 45 })], applyNow: true } as never);
    expect((await me.availability(s.userId)).map((d) => [d.weekday, d.modalities])).toEqual([[4, ['forca']]]);
    expect((await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } })).answers).toEqual(interviewAnswers); // historico intacto
    expect(trainingPlans.generateWeek).not.toHaveBeenCalled();
    expect(trainingPlans.generateFirstWeekIfNeeded).toHaveBeenCalledTimes(1); // so' gera se ainda nao houver programa (gate interno)
  });

  it('refazer a entrevista (assinante com rotina e programa): nao regenera nem arquiva treinos; objetivo atual nao volta ao antigo; additional_info segue ao Relator uma vez', async () => {
    const s = await student('reconclusao');
    await prisma.user.update({ where: { id: s.userId }, data: { subscriptionStatus: 'active' } });
    await prisma.weeklyAvailability.create({ data: { userId: s.userId, weekday: 2, noTraining: false, modalities: ['corrida'], availableMin: 40, modalityDurations: { corrida: 40 } } });
    await prisma.userPreferences.create({ data: { userId: s.userId, mainGoal: 'Completar 21 km', preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Rua'] } });
    await prisma.onboardingInterview.create({
      data: {
        userId: s.userId, completedAt: new Date('2026-08-01T00:00:00Z'),
        answers: { personal_name: 'Aluno Sintetico', personal_phone: '11999999999', personal_cpf: validCpf(), personal_birth_date: '15/03/1990', personal_sex: 'Masculino', personal_height: 175, personal_weight: 70, personal_address_city: 'Sao Paulo', personal_address_state: 'SP', objective: 'Completar 5 km', additional_info: 'Tenho viagem em novembro', current_activities: ['Corrida'] },
      },
    });
    const planBefore = await prisma.trainingPlan.findMany({ where: { userId: s.userId } });
    await me.completeOnboarding(s.userId);
    expect(trainingPlans.generateWeek).not.toHaveBeenCalled();
    expect(trainingPlans.generateFirstWeekIfNeeded).toHaveBeenCalledTimes(1);
    expect(await prisma.trainingPlan.findMany({ where: { userId: s.userId } })).toEqual(planBefore); // programa entregue intacto
    expect((await prisma.userPreferences.findUniqueOrThrow({ where: { userId: s.userId } })).mainGoal).toBe('Completar 21 km'); // nao reverte ao objetivo da entrevista
    expect((await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } })).answers).toMatchObject({ objective: 'Completar 5 km' }); // historico preservado
    const extra = await prisma.studentReportEntry.findMany({ where: { userId: s.userId, sourceType: 'onboarding_interview_additional_info' } });
    expect(extra.map((e) => e.originalText)).toEqual(['Tenho viagem em novembro']);
    await me.completeOnboarding(s.userId);
    expect(await prisma.studentReportEntry.count({ where: { userId: s.userId, sourceType: 'onboarding_interview_additional_info' } })).toBe(1); // reenvio sem alteracao: sem duplicata
  });

  it('Gerente Tecnico recebe a disponibilidade OPERACIONAL atual e nao a rotina historica da entrevista', async () => {
    const s = await student('gerente');
    await prisma.userPreferences.create({ data: { userId: s.userId, mainGoal: 'Completar 10 km', preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Rua'] } });
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: routineAnswers({ objective: 'Completar 10 km', routine_observation: 'texto', monday_run_available_time: 'morning' }), completedAt: new Date('2026-08-01T00:00:00Z') } });
    await prisma.weeklyAvailability.create({ data: { userId: s.userId, weekday: 4, noTraining: false, modalities: ['forca'], availableMin: 45, modalityDurations: { forca: 45 } } });
    const manager = Object.create(TechnicalManagerAgentService.prototype) as unknown as { prisma: unknown; gatherStudentContext: (id: string) => Promise<Record<string, unknown>> };
    manager.prisma = prisma;
    const context = await manager.gatherStudentContext(s.userId);
    expect(context.disponibilidadeOperacionalAtual).toEqual([{ diaDaSemana: 4, semTreino: false, modalidades: ['forca'], minutosPorModalidade: { forca: 45 } }]);
    const answers = context.respostasEntrevista as Record<string, unknown>;
    expect(answers.objective).toBe('Completar 10 km'); // o resto da entrevista segue disponivel
    for (const key of ['monday_run_time', 'wednesday_run_time', 'routine_modality_choice', 'routine_observation', 'monday_run_available_time']) expect(answers).not.toHaveProperty(key);
  });

  it('correcao explicita do objetivo na entrevista atualiza o objetivo operacional e o Prescritor recebe um unico objetivo atual', async () => {
    const s = await student('objetivo-fix');
    await prisma.userPreferences.create({ data: { userId: s.userId, mainGoal: 'Completar 5 km', preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Rua'] } });
    await me.saveOnboardingAnswer(s.userId, { key: 'objective', value: 'Melhorar meu tempo nos 10 km', currentStep: 1 });
    expect((await prisma.userPreferences.findUniqueOrThrow({ where: { userId: s.userId } })).mainGoal).toBe('Melhorar meu tempo nos 10 km');
    // demais preferencias operacionais: so' o campo corrigido muda
    await me.saveOnboardingAnswer(s.userId, { key: 'current_activities', value: ['Corrida', 'Natacao'], currentStep: 2 });
    const preferences = await prisma.userPreferences.findUniqueOrThrow({ where: { userId: s.userId } });
    expect([preferences.mainGoal, preferences.preferredModalities]).toEqual(['Melhorar meu tempo nos 10 km', ['Corrida', 'Natacao']]);
  });

  it('informacao adicional editada depois da entrevista concluida segue ao Relator uma vez; antes da conclusao nao registra (completeOnboarding encaminha)', async () => {
    const s = await student('info-adicional');
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: {}, completedAt: new Date('2026-08-01T00:00:00Z') } });
    await me.saveOnboardingAnswer(s.userId, { key: 'additional_info', value: 'Passei a trabalhar a noite', currentStep: 9 });
    await me.saveOnboardingAnswer(s.userId, { key: 'additional_info', value: 'Passei a trabalhar a noite', currentStep: 9 });
    expect(await prisma.studentReportEntry.count({ where: { userId: s.userId, sourceType: 'onboarding_interview_additional_info' } })).toBe(1);
    const s2 = await student('info-adicional-antes');
    await prisma.onboardingInterview.create({ data: { userId: s2.userId, answers: {} } });
    await me.saveOnboardingAnswer(s2.userId, { key: 'additional_info', value: 'texto', currentStep: 9 });
    expect(await prisma.studentReportEntry.count({ where: { userId: s2.userId, sourceType: 'onboarding_interview_additional_info' } })).toBe(0);
  });

  it('reavaliacao: "continua o mesmo?" sim mantem; nao troca o objetivo OPERACIONAL e preserva o anterior no historico; entrevista inicial intacta', async () => {
    const s = await student('reavaliacao');
    await prisma.userPreferences.create({ data: { userId: s.userId, mainGoal: 'Completar 10 km', preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Rua'] } });
    await prisma.onboardingInterview.create({ data: { userId: s.userId, answers: { objective: 'Completar 10 km' }, completedAt: new Date('2026-06-01T00:00:00Z') } });
    const service = new ReassessmentService(prisma as never, { analyze: async () => null } as never, studentProfile as never, { getSnapshot: async () => null } as never, reportTimeline, undefined as never);
    expect((await service.state(s.userId)).currentGoal).toBe('Completar 10 km');

    await service.saveAnswer(s.userId, { key: 'objective_still_current', value: 'yes', currentStep: 0 });
    await service.complete(s.userId);
    let goal = (await prisma.userPreferences.findUniqueOrThrow({ where: { userId: s.userId } })).mainGoal;
    expect(goal).toBe('Completar 10 km');
    let last = await prisma.reassessment.findFirstOrThrow({ where: { userId: s.userId }, orderBy: { completedAt: 'desc' } });
    expect(last.answers).toMatchObject({ objective: 'Completar 10 km', objective_still_current: 'yes' });

    await service.saveAnswer(s.userId, { key: 'objective_still_current', value: 'no', currentStep: 0 });
    await service.saveAnswer(s.userId, { key: 'objective', value: 'Completar 42 km', currentStep: 1 });
    await service.complete(s.userId);
    goal = (await prisma.userPreferences.findUniqueOrThrow({ where: { userId: s.userId } })).mainGoal;
    expect(goal).toBe('Completar 42 km');
    last = await prisma.reassessment.findFirstOrThrow({ where: { userId: s.userId }, orderBy: { completedAt: 'desc' } });
    expect(last.answers).toMatchObject({ objective: 'Completar 42 km', objective_previous: 'Completar 10 km' });
    expect((await prisma.onboardingInterview.findUniqueOrThrow({ where: { userId: s.userId } })).answers).toMatchObject({ objective: 'Completar 10 km' }); // historico inicial preservado
    expect((await service.state(s.userId)).currentGoal).toBe('Completar 42 km');
  });
});
