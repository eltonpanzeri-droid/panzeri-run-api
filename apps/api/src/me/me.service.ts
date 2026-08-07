import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateAvailability } from './availability.rules';
import { UpdateAvailabilityDto, AvailabilityDayDto } from './dto/update-availability.dto';
import { UpdateAnamneseDto } from './dto/update-anamnese.dto';
import { UpdateHealthDto } from './dto/update-health.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { normalizeCpf } from '../billing/billing.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { TrainingPlansService, hasSubscriptionAccess } from '../training-plans/training-plans.service';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';

// ATE 03/08 existia um limite de 1 alteracao de rotina a cada 30 dias, porque cada mudanca
// disparava uma geracao de IA na hora (custo real por alteracao). Ordem explicita do treinador
// (03/08): uma mudanca de rotina de quem JA TEM plano ativo nunca mais gera na hora — ela so
// entra em vigor na proxima geracao automatica de domingo (generateFirstWeekIfNeeded age como
// gate: so gera de verdade se for a primeira vez). Sem chamada de IA por mudanca, nao ha mais
// custo a proteger, entao o limite de frequencia deixou de fazer sentido e foi removido — o
// aluno pode ajustar a rotina quantas vezes quiser durante a semana, vale sempre a ULTIMA versao
// salva antes de domingo.

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
    private readonly studentProfile: StudentProfileService,
    private readonly telegram: TelegramService,
  ) {}

  acceptExerciseResponsibility(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { acceptedExerciseResponsibilityAt: new Date() },
      select: { acceptedExerciseResponsibilityAt: true },
    });
  }

  availability(userId: string) {
    return this.prisma.weeklyAvailability.findMany({
      where: { userId },
      orderBy: { weekday: 'asc' },
    });
  }

  async onboarding(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    if (interview?.completedAt && Object.keys(asAnswerObject(interview.answers)).length === 0) {
      return this.prisma.onboardingInterview.update({
        where: { userId },
        data: { completedAt: null, currentStep: 0 },
      });
    }
    return interview ?? { userId, answers: {}, currentStep: 0, completedAt: null };
  }

  reopenOnboarding(userId: string) {
    return this.prisma.onboardingInterview.upsert({
      where: { userId },
      create: { userId, answers: {}, currentStep: 0 },
      update: { completedAt: null, currentStep: 0 },
    });
  }

  async saveOnboardingAnswer(userId: string, dto: { key: string; value: unknown; currentStep: number }) {
    if (!/^[a-z0-9_]+$/i.test(dto.key) || dto.currentStep < 0) {
      throw new BadRequestException('Resposta de entrevista invalida.');
    }
    const current = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    const answers = asAnswerObject(current?.answers);
    answers[dto.key] = JSON.parse(JSON.stringify(dto.value)) as Prisma.InputJsonValue;
    return this.prisma.onboardingInterview.upsert({
      where: { userId },
      create: { userId, answers, currentStep: dto.currentStep },
      update: { answers, currentStep: dto.currentStep },
    });
  }

  async completeOnboarding(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    const answers = asAnswerObject(interview?.answers);
    const required = ['objective', 'running_experience', 'personal_name', 'personal_phone', 'personal_birth_date', 'personal_sex', 'personal_height', 'personal_weight', 'personal_cpf', 'personal_education', 'personal_cep', 'personal_address_number'];
    const missing = required.filter((key) => answers[key] === undefined || answers[key] === '');
    if (missing.length) throw new BadRequestException('Conclua todas as perguntas obrigatorias.');

    const normalizedCpf = normalizeCpf(String(answers.personal_cpf));
    if (!normalizedCpf) throw new BadRequestException('CPF invalido. Revise o campo de CPF na entrevista.');

    const assessedWeight = decimalValue(answers.personal_weight);
    const bodyFat = decimalValue(answers.body_fat_percentage);
    if (assessedWeight !== null && bodyFat !== null) {
      answers.fat_mass = roundedMeasurement(assessedWeight * bodyFat / 100);
      answers.lean_mass = roundedMeasurement(assessedWeight - assessedWeight * bodyFat / 100);
    }

    if (answers.basal_metabolism === 'automatic' || answers.basal_metabolism === undefined) {
      const basal = harrisBenedict({
        sex: stringValue(answers.personal_sex),
        birthDate: parseInterviewDate(stringValue(answers.personal_birth_date)),
        heightCm: decimalValue(answers.personal_height),
        weightKg: decimalValue(answers.personal_weight),
      });
      answers.basal_metabolism = basal ?? 'Nao foi possivel calcular';
    } else {
      const informedBasal = decimalValue(answers.basal_metabolism);
      if (informedBasal !== null) answers.basal_metabolism = informedBasal;
    }

    const availability = buildInterviewAvailability(answers);
    const preferredModalities = stringArray(answers.current_activities);
    const completedAt = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            name: String(answers.personal_name),
            phone: String(answers.personal_phone),
            birthDate: parseInterviewDate(String(answers.personal_birth_date)),
            sex: String(answers.personal_sex),
            heightCm: decimalValue(answers.personal_height),
            weightKg: decimalValue(answers.personal_weight),
            cpf: normalizedCpf,
            education: String(answers.personal_education),
            address: interviewAddressSummary(answers),
          },
        });
        await tx.healthProfile.upsert({
          where: { userId },
          create: {
            userId,
            averageSleep: stringValue(answers.sleep_hours),
            stressLevel: ratingValue(answers.rating_stress),
            anxietyLevel: ratingValue(answers.rating_anxiety),
            previousInjuries: interviewInjurySummary(answers),
            healthProblems: healthConditionsSummary(answers),
            medications: stringValue(answers.continuous_medications),
          },
          update: {
            averageSleep: stringValue(answers.sleep_hours),
            stressLevel: ratingValue(answers.rating_stress),
            anxietyLevel: ratingValue(answers.rating_anxiety),
            previousInjuries: interviewInjurySummary(answers),
            healthProblems: healthConditionsSummary(answers),
            medications: stringValue(answers.continuous_medications),
          },
        });
        await tx.userPreferences.upsert({
          where: { userId },
          create: {
            userId,
            preferredModalities,
            otherModalities: stringArray(answers.favorite_activities),
            trainingLocations: ['Corrida na rua'],
            mainGoal: String(answers.objective),
            experienceLevel: String(answers.running_experience),
          },
          update: {
            preferredModalities,
            otherModalities: stringArray(answers.favorite_activities),
            trainingLocations: ['Corrida na rua'],
            mainGoal: String(answers.objective),
            experienceLevel: String(answers.running_experience),
          },
        });
        await tx.weeklyAvailability.deleteMany({ where: { userId } });
        for (const day of availability) await tx.weeklyAvailability.create({ data: { userId, ...day } });
        await tx.onboardingInterview.update({ where: { userId }, data: { answers, completedAt } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Este CPF ja esta cadastrado em outra conta. Revise o campo de CPF na entrevista.');
      }
      throw error;
    }

    void this.studentProfile.recordEvent(
      userId,
      ProfileEventCode.ONBOARDING_COMPLETED,
      `Entrevista inicial concluida. Objetivo: ${stringValue(answers.objective)}. Experiencia com corrida: ${stringValue(answers.running_experience)}. Modalidades praticadas: ${preferredModalities.join(', ') || 'nenhuma informada'}.`,
    ).catch((error) => {
      this.logger.warn(`recordEvent(ONBOARDING_COMPLETED) falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
    });

    // Campo novo (2026-07-31): observacao livre especificamente sobre a rotina, preenchida
    // durante a propria entrevista (ex: "ja treino musculacao em outro lugar"). Grava no
    // prontuario UMA vez aqui (zero custo de IA, e so texto) — o agente de resumo do prontuario
    // e quem eventualmente "paga" pra condensar isso, nao esta chamada. Depois disso o agente de
    // prescricao semanal ja recebe essa informacao pronta no resumo, sem reprocessar de novo.
    const routineObservation = stringValue(answers.routine_observation).trim();
    if (routineObservation) {
      void this.studentProfile.recordEvent(
        userId,
        ProfileEventCode.STUDENT_OBSERVATION,
        `Observacao do aluno sobre a rotina (entrevista inicial): ${routineObservation}`,
      ).catch((error) => {
        this.logger.warn(`recordEvent(STUDENT_OBSERVATION, rotina) falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
      });
    }

    // Incidente real: prospectos respondiam a entrevista inteira, a IA gerava a semana de treino
    // (chamada cara), e boa parte desistia antes de assinar de verdade — gastando tokens a toa.
    // A partir de agora, concluir a entrevista NAO gera mais o treino sozinho: isso so acontece
    // quando o pagamento e confirmado (ver BillingService.triggerFirstWeekGeneration/
    // generateFirstWeekIfNeeded em training-plans.service.ts). A UNICA excecao e um aluno que JA
    // e assinante confirmado e esta reabrindo/refazendo a entrevista (ex: corrigindo algo) — nesse
    // caso gera na hora como sempre, porque ele ja pagou e o gatilho de pagamento nao vai disparar
    // de novo (subscriptionStatus ja estava active antes desta chamada).
    const payingUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } });
    if (payingUser && hasSubscriptionAccess(payingUser.subscriptionStatus)) {
      // generateWeek() cuida sozinho de arquivar o plano ativo anterior e de migrar os dias ja
      // passados/de hoje pro plano novo. NUNCA arquivamos manualmente antes de chamar generateWeek
      // — isso ja foi um bug real aqui (sessoes com registro de execucao perdidas ao regenerar),
      // ver [[routine_change_auto_regen]].
      // NAO AWAIT (bug real em producao 2026-07-29): generateWeek() pode levar 30s+ — se
      // esperassemos aqui, o proprio POST /me/onboarding/complete travava esse tempo todo.
      // REMOVIDO (08/08, bug real corrigido): havia aqui um adiamento pra "domingo antes das
      // 19h" que contava com o job automatico de domingo terminar o servico depois — esse job
      // nao roda mais sozinho (geracao virou sob demanda), entao o adiamento deixava a aluna
      // permanentemente sem programa nenhum. generateWeek() ja rola sozinho pra semana seguinte
      // quando nao sobra dia disponivel nesta, entao chamar direto sempre produz o resultado
      // certo, sem precisar adiar nada.
      void this.trainingPlans.generateWeek(userId).catch((error) => {
        this.logger.warn(`generateWeek apos completeOnboarding falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
      });
    } else {
      this.logger.log(`Entrevista concluida para ${userId} — geracao da primeira semana adiada ate a confirmacao do pagamento.`);
    }

    return { completed: true, completedAt, next: 'three_km_test' };
  }

  // As respostas de rotina da entrevista (${dia}_run_time etc.) so viram registros de
  // WeeklyAvailability dentro de completeOnboarding. Se o aluno reabre a entrevista para
  // revisar/atualizar essas respostas mas nao chega a concluir de novo (ou outra tela de
  // rotina sobrescreve depois), a disponibilidade real usada para gerar o treino fica
  // desatualizada em relacao ao que a entrevista diz. Este metodo recalcula
  // WeeklyAvailability a partir do que ja esta salvo em OnboardingInterview.answers, sem
  // exigir que o aluno refaca a entrevista.
  // notifyAsStudentRequest so e true quando quem chamou foi o proprio aluno (tela "Rotina de
  // treinos", via completeRoutineFromInterview) — o botao de reparo do treinador no painel
  // ("Sincronizar disponibilidade da entrevista") reaproveita este mesmo metodo mas NAO deve
  // mandar um Telegram dizendo "aluno solicitou", porque quem disparou foi o proprio treinador.
  async syncAvailabilityFromInterview(userId: string, notifyAsStudentRequest = false) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    if (!interview) {
      throw new BadRequestException('Aluno ainda nao respondeu a entrevista.');
    }
    const answers = asAnswerObject(interview.answers);
    const availability = buildInterviewAvailability(answers);

    const currentAvailability = await this.prisma.weeklyAvailability.findMany({ where: { userId } });
    const routineChanged = availabilityChanged(currentAvailability, availability);
    // Sem isso, um caso real como o da Thairine (04/08 — "salvou mas nao chegou Telegram") vira
    // adivinhacao: nao da pra saber se routineChanged deu false porque nada mudou de verdade, ou
    // se e um bug de comparacao. Loga sempre, nao so quando algo falha.
    this.logger.log(`syncAvailabilityFromInterview para ${userId}: routineChanged=${routineChanged}. Rotina anterior: ${JSON.stringify(currentAvailability.map((d) => ({ weekday: d.weekday, noTraining: d.noTraining, modalities: d.modalities, modalityDurations: d.modalityDurations })))}. Rotina nova (da entrevista): ${JSON.stringify(availability)}`);

    await this.prisma.$transaction([
      this.prisma.weeklyAvailability.deleteMany({ where: { userId } }),
      ...availability.map((day) => this.prisma.weeklyAvailability.create({ data: { userId, ...day } })),
      ...(routineChanged ? [this.prisma.user.update({ where: { id: userId }, data: { lastRoutineChangeAt: new Date() } })] : []),
    ]);

    // generateFirstWeekIfNeeded age como o proprio gate aqui: so gera de verdade se for a
    // PRIMEIRA vez (nenhum TrainingPlan ainda) e o pagamento ja estiver confirmado — pra quem ja
    // tem plano ativo, essa chamada nao faz nada agora, a rotina nova so entra em vigor na
    // proxima geracao automatica de domingo. NAO AWAIT: pode levar 30s+ na primeira vez.
    const existingPlanBefore = await this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } });
    if (routineChanged) {
      void this.trainingPlans.generateFirstWeekIfNeeded(userId).catch((error) => {
        this.logger.warn(`generateFirstWeekIfNeeded apos syncAvailabilityFromInterview falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
      });
      if (notifyAsStudentRequest) {
        const student = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, studentCode: true } });
        void this.telegram.notifyCoach(buildRoutineChangeTelegramMessage(student?.name, student?.studentCode, !existingPlanBefore)).catch(() => undefined);
      }
    }

    // firstTime informa pro chamador (tela Rotina do aluno) se isso vai gerar o treino agora
    // (primeira vez) ou se so vale a partir de domingo (mudanca de quem ja tem plano) — pra
    // mostrar a mensagem certa sem adivinhar.
    return { synced: true, days: availability.filter((day) => !day.noTraining).length, firstTime: !existingPlanBefore };
  }

  // Chamado pela tela "Rotina de treinos" do proprio aluno (pos-pagamento) ao confirmar a rotina
  // montada na entrevista — mesmo mecanismo de gate do sync acima (usado pelo botao de reparo do
  // treinador no painel): so gera na hora se for a primeira vez, senao so fica salva pra entrar
  // em vigor na proxima geracao de domingo.
  async completeRoutineFromInterview(userId: string) {
    return this.syncAvailabilityFromInterview(userId, true);
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        birthDate: dto.birthDate,
        sex: dto.sex,
        heightCm: dto.heightCm,
        weightKg: dto.weightKg,
        address: dto.address,
      },
    });
  }

  updateHealth(userId: string, dto: UpdateHealthDto) {
    return this.prisma.healthProfile.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    validateAvailability(dto.availability);

    const [currentAvailability, onboarding] = await Promise.all([
      this.prisma.weeklyAvailability.findMany({ where: { userId } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true } }),
    ]);
    const routineChanged = availabilityChanged(currentAvailability, dto.availability);
    this.logger.log(`updateAvailability para ${userId}: routineChanged=${routineChanged}. Rotina anterior: ${JSON.stringify(currentAvailability.map((d) => ({ weekday: d.weekday, noTraining: d.noTraining, modalities: d.modalities, modalityDurations: d.modalityDurations })))}. Rotina enviada: ${JSON.stringify(dto.availability)}`);

    // A entrevista inicial guarda sua propria copia dos dias/duracao (${dia}_run_time etc.),
    // usada na tabela "Horario" do painel admin e no contexto que os agentes de IA recebem
    // (respostasEntrevista) — sem sincronizar essa copia aqui, ela ficava presa na resposta
    // original da entrevista pra sempre, mesmo depois do aluno mudar a rotina de verdade por
    // aqui. Isso fazia o painel mostrar horario desatualizado e os agentes receberem uma
    // descricao de rotina que contradizia a disponibilidade real usada pra montar o treino.
    const syncedAnswers = syncInterviewAnswersFromAvailability(asAnswerObject(onboarding?.answers), dto.availability);

    await this.prisma.$transaction([
      this.prisma.weeklyAvailability.deleteMany({ where: { userId } }),
      ...dto.availability.map((day) =>
        this.prisma.weeklyAvailability.create({
          data: {
            userId,
            weekday: day.weekday,
            noTraining: day.noTraining,
            modalities: day.noTraining ? [] : day.modalities,
            availableMin: day.noTraining ? 0 : day.availableMin,
            modalityDurations: day.noTraining ? undefined : day.modalityDurations ?? {},
          },
        }),
      ),
      ...(onboarding ? [this.prisma.onboardingInterview.update({ where: { userId }, data: { answers: syncedAnswers } })] : []),
      ...(routineChanged ? [this.prisma.user.update({ where: { id: userId }, data: { lastRoutineChangeAt: new Date() } })] : []),
    ]);

    const updated = await this.prisma.weeklyAvailability.findMany({
      where: { userId },
      orderBy: { weekday: 'asc' },
    });

    // Ordem explicita do treinador (03/08): uma mudanca de rotina de quem JA TEM plano ativo
    // nunca gera na hora — so entra em vigor na proxima geracao automatica de domingo (a semana
    // atual continua rodando exatamente como estava). generateFirstWeekIfNeeded e o proprio gate:
    // so gera de verdade se for realmente a primeira vez (sem TrainingPlan ainda) e o pagamento
    // ja estiver confirmado; para quem ja tem plano, essa chamada nao faz nada. Como mudar rotina
    // nunca mais chama IA fora do dia de geracao normal, nao existe mais limite de frequencia —
    // o aluno pode ajustar quantas vezes quiser, vale sempre a ultima versao salva antes de
    // domingo. NAO AWAIT: pode levar 30s+ na primeira vez.
    let firstTime = false;
    if (routineChanged) {
      const existingPlanBefore = await this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } });
      firstTime = !existingPlanBefore;
      void this.trainingPlans.generateFirstWeekIfNeeded(userId).catch((error) => {
        this.logger.warn(`generateFirstWeekIfNeeded apos updateAvailability falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
      });
      const student = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, studentCode: true } });
      void this.telegram.notifyCoach(buildRoutineChangeTelegramMessage(student?.name, student?.studentCode, !existingPlanBefore)).catch(() => undefined);
    }

    return { availability: updated, routineChanged, firstTime };
  }

  async updateAnamnese(userId: string, dto: UpdateAnamneseDto) {
    validateAvailability(dto.availability.availability);

    const normalizedEmail = dto.profile.email.trim().toLowerCase();
    const emailOwner = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (emailOwner && emailOwner.id !== userId) {
      throw new BadRequestException('Este e-mail ja pertence a outra conta.');
    }

    const [currentAvailability, onboarding] = await Promise.all([
      this.prisma.weeklyAvailability.findMany({ where: { userId } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true } }),
    ]);
    const routineChanged = availabilityChanged(currentAvailability, dto.availability.availability);
    // Ver comentario equivalente em updateAvailability sobre por que a entrevista precisa
    // refletir a rotina real sempre que ela muda por aqui (painel admin e agentes de IA leem
    // as respostas antigas da entrevista, nao so a WeeklyAvailability).
    const syncedAnswers = syncInterviewAnswersFromAvailability(asAnswerObject(onboarding?.answers), dto.availability.availability);

    const result = await this.prisma.$transaction(async (tx) => {
      if (onboarding) {
        await tx.onboardingInterview.update({ where: { userId }, data: { answers: syncedAnswers } });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          name: dto.profile.name.trim(),
          email: normalizedEmail,
          birthDate: dto.profile.birthDate,
          sex: dto.profile.sex,
          heightCm: dto.profile.heightCm,
          weightKg: dto.profile.weightKg,
          address: dto.profile.address,
          ...(routineChanged ? { lastRoutineChangeAt: new Date() } : {}),
        },
      });

      await tx.healthProfile.upsert({
        where: { userId },
        create: { userId, ...dto.health },
        update: dto.health,
      });

      await tx.userPreferences.upsert({
        where: { userId },
        create: { userId, ...dto.preferences },
        update: dto.preferences,
      });

      await tx.weeklyAvailability.deleteMany({ where: { userId } });
      for (const day of dto.availability.availability) {
        await tx.weeklyAvailability.create({
          data: {
            userId,
            weekday: day.weekday,
            noTraining: day.noTraining,
            modalities: day.noTraining ? [] : day.modalities,
            availableMin: day.noTraining ? 0 : day.availableMin,
            modalityDurations: day.noTraining ? undefined : day.modalityDurations ?? {},
          },
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          accountStatus: true,
          studentCode: true,
          birthDate: true,
          sex: true,
          heightCm: true,
          weightKg: true,
          address: true,
          healthProfile: true,
          preferences: true,
          availability: { orderBy: { weekday: 'asc' } },
          tests: {
            where: { testType: '3km' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });

    // Mesmo mecanismo de gate de updateAvailability: generateFirstWeekIfNeeded so gera de
    // verdade se for a primeira vez; pra quem ja tem plano, a rotina nova so entra em vigor na
    // proxima geracao automatica de domingo. NAO AWAIT: pode levar 30s+ na primeira vez.
    if (routineChanged) {
      const existingPlanBefore = await this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } });
      void this.trainingPlans.generateFirstWeekIfNeeded(userId).catch((error) => {
        this.logger.warn(`generateFirstWeekIfNeeded apos updateAnamnese falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
      });
      void this.telegram.notifyCoach(buildRoutineChangeTelegramMessage(result.name, result.studentCode, !existingPlanBefore)).catch(() => undefined);
    }

    // routineChanged vai junto pra tela de anamnese (perfil/saude/preferencias/rotina, tudo num
    // unico salvamento) saber se deve mostrar a mensagem especifica de "rotina registrada e
    // treino recriado" ou so a confirmacao generica de perfil salvo — nem toda edicao de
    // anamnese mexe na rotina (ex: so atualizar peso ou e-mail).
    return { ...result, routineChanged };
  }
}

// Texto pedido explicitamente pelo treinador (04/08) — usado em toda rota onde o proprio aluno
// confirma uma mudanca de rotina (updateAvailability, updateAnamnese, tela "Rotina de treinos").
// Quando ja existe plano ativo, deixa claro que nada muda ate domingo e que da pra antecipar
// clicando "Refazer nova semana de treinos" no painel — esse botao ja le a rotina mais recente
// salva no banco, entao antecipar de verdade funciona sem nenhuma mudanca adicional.
function buildRoutineChangeTelegramMessage(studentName: string | undefined, studentCode: number | undefined, firstTime: boolean): string {
  const name = studentName ?? 'desconhecido';
  const code = studentCode !== undefined ? formatStudentCode(studentCode) : '?';
  if (firstTime) {
    return `🔁 Aluno "${name}" (Cod. ${code}) montou a rotina de treinos no Panzeri Run\n\nO primeiro treino esta sendo gerado automaticamente.`;
  }
  return `🔁 Aluno "${name}" (Cod. ${code}) solicitou alteracao de rotina no Panzeri Run\n\nEssa rotina passara a valer automaticamente apenas na proxima geracao automatica de domingo. Caso o treinador deseje antecipar, basta apenas "Refazer nova semana de treinos" no painel do aluno.`;
}

function normalizeModalityDurationsForCompare(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function availabilityDaySignature(day: { weekday: number; noTraining: boolean; modalities: string[]; availableMin?: number | null; modalityDurations?: unknown }) {
  return {
    weekday: day.weekday,
    noTraining: day.noTraining,
    modalities: day.noTraining ? [] : [...day.modalities].sort(),
    availableMin: day.noTraining ? 0 : day.availableMin ?? 0,
    modalityDurations: day.noTraining ? {} : normalizeModalityDurationsForCompare(day.modalityDurations),
  };
}

// Compara a rotina salva com a que o aluno acabou de enviar — so conta como mudanca de verdade
// (e consome a janela de 30 dias / dispara regeneracao) se algo realmente diferente. Sem isso,
// updateAnamnese (que reune perfil/saude/preferencias/rotina num unico salvamento) bloquearia ou
// regeneraria o treino toda vez que o aluno so quisesse atualizar o peso ou o e-mail, por exemplo.
function availabilityChanged(
  current: Array<{ weekday: number; noTraining: boolean; modalities: string[]; availableMin: number | null; modalityDurations: unknown }>,
  incoming: AvailabilityDayDto[],
) {
  const currentSignature = JSON.stringify(current.map(availabilityDaySignature).sort((left, right) => left.weekday - right.weekday));
  const incomingSignature = JSON.stringify(incoming.map(availabilityDaySignature).sort((left, right) => left.weekday - right.weekday));
  return currentSignature !== incomingSignature;
}

export function asAnswerObject(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, Prisma.InputJsonValue>;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function ratingValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number}/10` : 'Nao informado';
}

function parseInterviewDate(value: string) {
  const br = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date;
    throw new BadRequestException('Data de nascimento invalida.');
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Data de nascimento invalida.');
  return date;
}

const PAIN_DETAIL_KEYS = [
  'pain_detail_knee', 'pain_detail_ankle', 'pain_detail_foot', 'pain_detail_shin', 'pain_detail_calf',
  'pain_detail_thigh', 'pain_detail_hip', 'pain_detail_glute', 'pain_detail_lower_back',
];

function painSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const regions = stringArray(answers.pain_regions);
  if (!regions.length) return 'regiao nao informada';
  const details = PAIN_DETAIL_KEYS.flatMap((key) => stringArray(answers[key]));
  const other = stringValue(answers.pain_other_location);
  const parts = [regions.join(', ')];
  if (details.length) parts.push(`detalhes: ${details.join(', ')}`);
  if (other) parts.push(`outro local: ${other}`);
  return parts.join(' - ');
}

function interviewAddressSummary(answers: Record<string, Prisma.InputJsonValue>): string | undefined {
  const street = stringValue(answers.personal_address_street);
  const number = stringValue(answers.personal_address_number);
  const complement = stringValue(answers.personal_address_complement);
  const neighborhood = stringValue(answers.personal_address_neighborhood);
  const city = stringValue(answers.personal_address_city);
  const state = stringValue(answers.personal_address_state);
  const cep = stringValue(answers.personal_cep);
  const streetLine = [street, number].filter(Boolean).join(', ');
  const parts = [streetLine, complement, neighborhood, city && state ? `${city}/${state}` : city || state, cep].filter(Boolean);
  return parts.length ? parts.join(' - ') : undefined;
}

const HEALTH_CONDITION_SLUGS: Record<string, string> = {
  Hipertensao: 'hipertensao', Diabetes: 'diabetes', 'Colesterol elevado': 'colesterol', Obesidade: 'obesidade',
  Asma: 'asma', 'Problemas cardiacos': 'cardiaco', Artrose: 'artrose', Artrite: 'artrite', 'Hernia de disco': 'hernia_disco',
};

function healthConditionsSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const conditions = stringArray(answers.health_conditions).filter((item) => item !== 'Nenhuma');
  if (!conditions.length) return 'Nenhuma informada';
  return conditions.map((condition) => {
    if (condition === 'Outra') {
      const other = stringValue(answers.health_conditions_other);
      return other ? `Outra: ${other}` : 'Outra';
    }
    const slug = HEALTH_CONDITION_SLUGS[condition];
    const status = slug ? String(answers[`health_condition_status_${slug}`] ?? '') : '';
    const statusLabel = status === 'current' ? 'atual' : status === 'past' ? 'diagnostico anterior, sem a condicao atualmente' : '';
    return statusLabel ? `${condition} (${statusLabel})` : condition;
  }).join(', ');
}

const RUNNING_CONDITION_SLUGS: Record<string, string> = {
  'Sindrome da banda iliotibial (joelho do corredor)': 'itb', 'Sindrome da dor patelofemoral': 'patelofemoral',
  'Condromalacia patelar': 'condromalacia', 'Tendinopatia patelar (joelho do saltador)': 'tendinopatia_patelar',
  'Tendinopatia do quadriceps': 'tendinopatia_quadriceps', 'Sindrome da pata de ganso (bursite pes anserino)': 'pata_ganso',
  'Bursite pre-patelar': 'bursite_prepatelar', 'Fascite plantar': 'fascite_plantar', 'Esporao de calcaneo': 'esporao_calcaneo',
  'Tendinopatia de Aquiles': 'tendinopatia_aquiles', 'Tendinopatia do tibial posterior': 'tendinopatia_tibial_posterior',
  'Canelite (sindrome do estresse tibial medial)': 'canelite', 'Sindrome do compartimento tibial anterior': 'compartimento_tibial',
  'Fratura por estresse': 'fratura_estresse', 'Neuroma de Morton': 'neuroma_morton', Metatarsalgia: 'metatarsalgia',
  'Entorse de tornozelo (ligamentos)': 'entorse_tornozelo', 'Instabilidade cronica de tornozelo': 'instabilidade_tornozelo',
  'Sindrome do tunel do tarso': 'tunel_tarso', 'Bursite trocanterica': 'bursite_trocanterica', 'Sindrome do piriforme': 'piriforme',
  'Tendinopatia dos isquiotibiais': 'tendinopatia_isquiotibiais', 'Distensao muscular (estiramento)': 'distensao_muscular',
  'Ruptura ou lesao de menisco': 'lesao_menisco', 'Ruptura de ligamento do joelho (LCA/LCM/LCL)': 'ligamento_joelho',
  'Artrose de joelho': 'artrose_joelho', 'Artrose de quadril': 'artrose_quadril', 'Bursite isquiatica': 'bursite_isquiatica',
  'Distensao do adutor (virilha)': 'distensao_adutor', 'Lombalgia mecanica': 'lombalgia', 'Hernia de disco': 'hernia_disco_corredor',
  'Protrusao discal': 'protrusao_discal', 'Dor ciatica (ciatalgia)': 'dor_ciatica',
};

function diagnosedConditionsSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const conditions = stringArray(answers.diagnosed_running_conditions).filter((item) => item !== 'Nenhuma' && item !== 'Nao sei responder');
  const other = stringValue(answers.diagnosed_running_conditions_other);
  if (!conditions.length && !other) return '';
  const described = conditions.map((condition) => {
    const slug = RUNNING_CONDITION_SLUGS[condition];
    const status = slug ? String(answers[`running_condition_status_${slug}`] ?? '') : '';
    const statusLabel = status === 'current' ? 'atual' : status === 'past' ? 'diagnostico anterior, sem a condicao atualmente' : '';
    return statusLabel ? `${condition} (${statusLabel})` : condition;
  });
  return `Diagnosticos: ${[...described, other].filter(Boolean).join(', ')}`;
}

function interviewInjurySummary(answers: Record<string, Prisma.InputJsonValue>) {
  const parts = [
    answers.current_pain === 'yes' ? `Dor atual: ${painSummary(answers)}` : 'Sem dor atual',
    `Lesao previa: ${stringValue(answers.important_injury) || 'nao informada'}`,
    stringValue(answers.injury_description),
    diagnosedConditionsSummary(answers),
    stringValue(answers.medical_recommendation),
  ].filter(Boolean);
  return parts.join('. ');
}

const INTERVIEW_WEEK_DAYS = [
  { key: 'monday', weekday: 1 },
  { key: 'tuesday', weekday: 2 },
  { key: 'wednesday', weekday: 3 },
  { key: 'thursday', weekday: 4 },
  { key: 'friday', weekday: 5 },
  { key: 'saturday', weekday: 6 },
  { key: 'sunday', weekday: 0 },
];

// BUG REAL 04/08 (caso da Thairine): a tela "Rotina de treinos" so pergunta ${dia}_fortalecimento_time
// e ${dia}_musculacao_time quando a modalidade correspondente esta escolhida em
// routine_modality_choice — quando o aluno tira uma modalidade que tinha antes, a pergunta daquele
// dia simplesmente para de ser exibida, mas a resposta ANTIGA continua salva em answers (nunca e
// apagada, porque a pergunta nunca e revisitada). Sem isso, buildInterviewAvailability lia esse
// valor velho como se ainda fosse valido, entao "tirar musculacao" nunca tinha efeito nenhum. Zera
// explicitamente qualquer modalidade que nao esteja mais na escolha atual antes de calcular a
// disponibilidade. So mexe quando routine_modality_choice existe (entrevistas antigas, de antes
// dessa pergunta existir, ficam como estavam).
function sanitizeAnswersForModalityChoice(answers: Record<string, Prisma.InputJsonValue>): Record<string, Prisma.InputJsonValue> {
  const choice = answers.routine_modality_choice;
  if (typeof choice !== 'string') return answers;
  const includesFortalecimento = choice === 'corrida_fortalecimento' || choice === 'corrida_fortalecimento_musculacao';
  const includesMusculacao = choice === 'corrida_musculacao' || choice === 'corrida_fortalecimento_musculacao';
  const sanitized = { ...answers };
  for (const { key } of INTERVIEW_WEEK_DAYS) {
    if (!includesFortalecimento) {
      sanitized[`${key}_fortalecimento_time`] = 'none';
      delete sanitized[`${key}_fortalecimento_available_time`];
    }
    if (!includesMusculacao) {
      sanitized[`${key}_musculacao_time`] = 'none';
      delete sanitized[`${key}_musculacao_available_time`];
    }
  }
  return sanitized;
}

function buildInterviewAvailability(rawAnswers: Record<string, Prisma.InputJsonValue>) {
  const answers = sanitizeAnswersForModalityChoice(rawAnswers);
  const days = INTERVIEW_WEEK_DAYS;
  return days.map(({ key, weekday }) => {
    const runMinutes = interviewMinutes(answers[`${key}_run_time`]);
    const fortalecimentoMinutes = interviewMinutes(answers[`${key}_fortalecimento_time`]);
    const musculacaoMinutes = interviewMinutes(answers[`${key}_musculacao_time`]);
    const modalities: string[] = [];
    const modalityDurations: Record<string, number> = {};
    if (runMinutes > 0) {
      modalities.push('corrida');
      modalityDurations.corrida = runMinutes;
    }
    if (fortalecimentoMinutes > 0) {
      modalities.push('fortalecimento_corredores');
      modalityDurations.fortalecimento_corredores = fortalecimentoMinutes;
    }
    if (musculacaoMinutes > 0) {
      modalities.push('forca');
      modalityDurations.forca = musculacaoMinutes;
    }
    return {
      weekday,
      noTraining: modalities.length === 0,
      modalities,
      availableMin: Math.max(runMinutes, fortalecimentoMinutes, musculacaoMinutes, 0),
      modalityDurations,
    };
  });
}

function interviewMinutes(value: unknown) {
  const options: Record<string, number> = {
    none: 0,
    up_to_30: 30,
    from_30_to_45: 45,
    from_45_to_60: 60,
    from_60_to_90: 90,
    // over_90 e legado (opcao removida do dropdown do app, mas respostas antigas ja salvas no
    // banco ainda usam esse valor) — mantido com o mesmo numero de sempre pra nao mudar o teto de
    // duracao de ninguem que respondeu antes desta mudanca. Alunos preenchendo a entrevista agora
    // caem numa das tres faixas mais finas abaixo, pensadas pra cobrir longao de meia/maratona sem
    // depender de uma diretriz manual do treinador so pra liberar mais tempo (pedido do treinador
    // 2026-08-04, apos o caso da preparacao de maratona da Thairine).
    over_90: 105,
    from_90_to_150: 120,
    from_150_to_240: 195,
    over_240: 270,
  };
  return options[String(value)] ?? 0;
}

const WEEKDAY_TO_INTERVIEW_KEY: Record<number, string> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday',
};

function minutesToInterviewBucket(minutes: number) {
  if (minutes <= 0) return 'none';
  if (minutes <= 30) return 'up_to_30';
  if (minutes <= 45) return 'from_30_to_45';
  if (minutes <= 60) return 'from_45_to_60';
  if (minutes <= 90) return 'from_60_to_90';
  if (minutes <= 150) return 'from_90_to_150';
  if (minutes <= 240) return 'from_150_to_240';
  return 'over_240';
}

// Direcao inversa de buildInterviewAvailability. Sempre que a rotina real (WeeklyAvailability)
// muda por updateAvailability/updateAnamnese (nao pela entrevista em si), as respostas antigas
// da entrevista sobre dias/duracao (${dia}_run_time, ${dia}_musculacao_time,
// ${dia}_fortalecimento_time) ficavam presas na resposta original pra sempre. Essas respostas
// SAO lidas em dois lugares que nao usam WeeklyAvailability: a linha "Horario" da tabela de
// rotina no painel admin (apps/admin/app/page.tsx) e o contexto respostasEntrevista que os
// agentes de IA (prescricao, gerente tecnico) recebem — sem sincronizar de volta aqui, o painel
// mostrava um horario desatualizado e a IA podia receber uma descricao de rotina que contradizia
// a disponibilidade real usada pra montar o treino daquela mesma semana.
export function syncInterviewAnswersFromAvailability(
  currentAnswers: Record<string, Prisma.InputJsonValue>,
  availability: Array<{ weekday: number; noTraining: boolean; modalities: string[]; modalityDurations?: Record<string, number> | null }>,
): Record<string, Prisma.InputJsonValue> {
  const updated = { ...currentAnswers };
  for (const day of availability) {
    const dayKey = WEEKDAY_TO_INTERVIEW_KEY[day.weekday];
    if (!dayKey) continue;
    const durations = day.noTraining ? {} : day.modalityDurations ?? {};
    updated[`${dayKey}_run_time`] = minutesToInterviewBucket(durations.corrida ?? 0);
    updated[`${dayKey}_fortalecimento_time`] = minutesToInterviewBucket(durations.fortalecimento_corredores ?? 0);
    updated[`${dayKey}_musculacao_time`] = minutesToInterviewBucket(durations.forca ?? 0);
  }
  return updated;
}

function decimalValue(value: unknown) {
  if (value === undefined || value === null || value === '' || value === 'unknown') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function roundedMeasurement(value: number) {
  return Math.round(value * 10) / 10;
}

function harrisBenedict(input: { sex: string; birthDate: Date; heightCm: number | null; weightKg: number | null }) {
  if (!input.heightCm || !input.weightKg || !['Feminino', 'Masculino'].includes(input.sex)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - input.birthDate.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > input.birthDate.getUTCMonth()
    || (now.getUTCMonth() === input.birthDate.getUTCMonth() && now.getUTCDate() >= input.birthDate.getUTCDate());
  if (!birthdayPassed) age -= 1;
  const value = input.sex === 'Masculino'
    ? 88.362 + 13.397 * input.weightKg + 4.799 * input.heightCm - 5.677 * age
    : 447.593 + 9.247 * input.weightKg + 3.098 * input.heightCm - 4.330 * age;
  return Math.round(value);
}
