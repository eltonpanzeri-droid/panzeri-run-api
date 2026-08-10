import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { MergeStudentDto } from './dto/merge-student.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateTrainingSessionDto } from './dto/update-training-session.dto';
import { CreateManualSessionDto } from './dto/create-manual-session.dto';
import { TrainingPlansService, hasSubscriptionAccess } from '../training-plans/training-plans.service';
import { StravaService } from '../strava/strava.service';
import { MessagingService } from '../messaging/messaging.service';
import { SendStudentMessageDto } from './dto/send-student-message.dto';
import { runnerStrengthExercises } from '../training-plans/runner-strength-library';
import { gymExerciseLibrary } from '../training-plans/gym-exercise-library';
import { BackupService } from '../backup/backup.service';
import { MeService, syncInterviewAnswersFromAvailability, asAnswerObject } from '../me/me.service';
import { BillingService } from '../billing/billing.service';
import { formatStudentCode } from '../billing/telegram.service';
import { sanitizeInterviewAnswers } from '../training-plans/training-methodology';
import { WeeklyPlanSchedulerService } from '../training-plans/weekly-plan-scheduler.service';
import { UpdateStudentAvailabilityDto } from './dto/update-student-availability.dto';
import { validateAvailability } from '../me/availability.rules';

@Injectable()
export class CoachService {
  private readonly logger = new Logger(CoachService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
    private readonly strava: StravaService,
    private readonly messaging: MessagingService,
    private readonly backup: BackupService,
    private readonly meService: MeService,
    private readonly billing: BillingService,
    private readonly weeklyPlanScheduler: WeeklyPlanSchedulerService,
  ) {}

  // Gatilho manual do mesmo job que rodaria sozinho todo domingo 19h (ver
  // WeeklyPlanSchedulerService — pausado em 02/08 apos o incidente do loop de deploy). Usado pelo
  // treinador pra gerar a semana seguinte de TODOS os alunos de uma vez quando o robo automatico
  // estiver desligado (ou pra recuperar alunos que ficaram sem a pre-geracao por qualquer motivo).
  // NAO AWAIT: com varios alunos, cada um podendo levar minutos (retentativas de IA), isso pode
  // demorar dezenas de minutos no total — segurar a resposta HTTP travaria o botao do painel ate
  // estourar o timeout do proprio navegador/EasyPanel bem antes de terminar. Responde na hora
  // avisando que comecou; o log do EasyPanel e os avisos de falha no Telegram (ja existentes por
  // aluno) mostram o progresso real.
  generateNextWeekForAllStudents() {
    this.weeklyPlanScheduler.assertManualTriggerAllowed();
    void this.weeklyPlanScheduler.generateNextWeekPlans().catch((error) => {
      this.logger.warn(`generateNextWeekForAllStudents falhou (nao bloqueante): ${(error as Error).message}`);
    });
    return { started: true, message: 'Geracao da semana seguinte iniciada em segundo plano para todos os alunos.' };
  }

  // Gera o mesmo link de pagamento que o app do aluno geraria, para o treinador poder
  // enviar manualmente por WhatsApp/e-mail quando o app do aluno nao consegue concluir o
  // pagamento sozinho (ex: bloqueio de rede especifico do aparelho dele).
  createStudentCheckoutLink(studentId: string, cpf?: string) {
    return this.billing.createCheckout(studentId, cpf);
  }

  saveStudentCpf(studentId: string, cpf: string) {
    return this.billing.saveCpf(studentId, cpf);
  }

  refreshStudentBillingStatus(studentId: string) {
    return this.billing.refreshStatusForStudent(studentId);
  }

  refreshAllPendingBillingStatus() {
    return this.billing.refreshAllPendingStudents();
  }

  async createStudent(dto: CreateStudentDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('E-mail ja cadastrado.');
    }

    const temporaryPassword = dto.password ?? randomBytes(18).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          name: dto.name.trim(),
          passwordHash,
          role: 'student',
          accountStatus: dto.password ? 'active' : 'paused',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          accountStatus: true,
          createdAt: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('E-mail ja cadastrado.');
      }
      throw error;
    }

    if (!dto.password) {
      const invite = await this.createStudentInvite(user.id);
      return {
        user,
        message: 'Aluno criado. Envie o convite para ele criar a propria senha.',
        ...invite,
      };
    }

    return {
      user,
      message: 'Aluno criado. Envie o e-mail e a senha inicial para ele acessar o app.',
      accessText: buildAccessText(user.email, dto.password),
    };
  }

  async updateStudent(studentId: string, dto: UpdateStudentDto) {
    await this.assertStudent(studentId);
    const data: { name?: string; email?: string; accountStatus?: string; subscriptionStatus?: string; subscriptionUpdatedAt?: Date; subscriptionManualOverride?: boolean; refreshTokenHash?: null } = {};

    if (dto.name) {
      data.name = dto.name.trim();
    }

    if (dto.email) {
      const email = dto.email.toLowerCase().trim();
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== studentId) {
        throw new BadRequestException('E-mail ja cadastrado.');
      }
      data.email = email;
    }

    if (dto.accountStatus) {
      data.accountStatus = dto.accountStatus;
      if (dto.accountStatus !== 'active') {
        data.refreshTokenHash = null;
      }
    }

    if (dto.subscriptionStatus) {
      data.subscriptionStatus = dto.subscriptionStatus;
      data.subscriptionUpdatedAt = new Date();
      // Trava contra o auto-sync do Asaas (getMine/refreshFromAsaas) sobrescrever essa decisao
      // manual do treinador assim que o aluno abrir a aba de assinatura no app — foi exatamente
      // isso que reverteu a liberacao manual da Roberta de volta para pendente sem avisar ninguem.
      data.subscriptionManualOverride = true;
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('Nenhum dado para atualizar.');
    }

    // Treinador liberando o acesso manualmente pelo dropdown (ex: aluno pagou por fora, cortesia)
    // dispara a mesma geracao de primeira semana que a confirmacao automatica do Asaas dispara —
    // generateFirstWeekIfNeeded ja garante que so gera se for realmente a primeira vez.
    if (dto.subscriptionStatus && hasSubscriptionAccess(dto.subscriptionStatus)) {
      void this.trainingPlans.generateFirstWeekIfNeeded(studentId).catch((error) => {
        this.logger.warn(`generateFirstWeekIfNeeded falhou para ${studentId} (nao bloqueante): ${(error as Error).message}`);
      });
    }

    return this.prisma.user.update({
      where: { id: studentId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        accountStatus: true,
        subscriptionStatus: true,
        subscriptionUpdatedAt: true,
        updatedAt: true,
      },
    });
  }

  async resetStudentPassword(studentId: string, dto: ResetStudentPasswordDto) {
    await this.assertStudent(studentId);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.user.update({
      where: { id: studentId },
      data: { passwordHash, refreshTokenHash: null },
    });

    return {
      message: 'Senha do aluno atualizada.',
      accessText: buildAccessText((await this.prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { email: true } })).email, dto.password),
    };
  }

  async updateTrainingSession(studentId: string, sessionId: string, dto: UpdateTrainingSessionDto) {
    await this.assertStudent(studentId);
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId: studentId },
      select: { id: true },
    });
    if (!session) {
      throw new BadRequestException('Treino nao encontrado para este aluno.');
    }

    const data = {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.modality !== undefined ? { modality: dto.modality.trim() } : {}),
      ...(dto.durationMin !== undefined ? { durationMin: dto.durationMin || null } : {}),
      ...(dto.distanceKm !== undefined ? { distanceKm: dto.distanceKm || null } : {}),
      ...(dto.intensityZone !== undefined ? { intensityZone: dto.intensityZone.trim() || null } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
      ...(dto.structure !== undefined ? { structure: dto.structure as Prisma.InputJsonObject } : {}),
    };
    if (!Object.keys(data).length) {
      throw new BadRequestException('Nenhuma alteracao informada.');
    }

    return this.prisma.trainingSession.update({ where: { id: sessionId }, data });
  }

  // Escape hatch manual do treinador pra limpar sessao duplicada/errada que a IA gerou (pedido
  // real 10/08 — Lucelane com 3 sessoes de fortalecimento empilhadas no mesmo dia, sem nenhum
  // jeito de tirar uma so pelo painel). Nunca deixa apagar um treino que a aluna ja registrou
  // como feito — isso destruiria um dado real de aderencia, nao so "limpar uma sobra".
  async deleteTrainingSession(studentId: string, sessionId: string) {
    await this.assertStudent(studentId);
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId: studentId },
      select: { id: true, completion: { select: { id: true } } },
    });
    if (!session) {
      throw new BadRequestException('Treino nao encontrado para este aluno.');
    }
    if (session.completion) {
      throw new BadRequestException('Esse treino ja foi registrado pela aluna — nao da pra excluir, so editar.');
    }
    await this.prisma.trainingSession.delete({ where: { id: sessionId } });
    return { message: 'Treino excluido.' };
  }

  async createStudentInvite(studentId: string) {
    const user = await this.assertStudent(studentId);
    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });

    return {
      inviteLink: `${publicAppUrl()}/reset-password?token=${token}`,
      accessText: `Acesso Panzeri Run\n\nLink para criar senha: ${publicAppUrl()}/reset-password?token=${token}\nE-mail: ${user.email}`,
    };
  }

  async mergeStudent(targetId: string, dto: MergeStudentDto) {
    const target = await this.assertStudent(targetId);
    const sourceEmail = dto.sourceEmail.toLowerCase().trim();
    const source = await this.prisma.user.findUnique({ where: { email: sourceEmail } });

    if (!source || source.role !== 'student') {
      throw new BadRequestException('Nao encontrei nenhum aluno com esse e-mail.');
    }
    if (source.id === targetId) {
      throw new BadRequestException('Informe o e-mail da OUTRA conta duplicada, diferente da conta selecionada.');
    }

    const existingInterview = await this.prisma.onboardingInterview.findUnique({ where: { userId: targetId } });
    if (existingInterview?.completedAt) {
      throw new BadRequestException('Esta conta ja tem uma entrevista concluida. Resolva manualmente antes de mesclar.');
    }

    const [existingHealth, existingPreferences, existingAvailability] = await Promise.all([
      this.prisma.healthProfile.findUnique({ where: { userId: targetId } }),
      this.prisma.userPreferences.findUnique({ where: { userId: targetId } }),
      this.prisma.weeklyAvailability.findMany({ where: { userId: targetId }, select: { id: true } }),
    ]);

    await this.prisma.$transaction([
      ...(existingInterview ? [this.prisma.onboardingInterview.delete({ where: { userId: targetId } })] : []),
      ...(existingHealth ? [this.prisma.healthProfile.delete({ where: { userId: targetId } })] : []),
      ...(existingPreferences ? [this.prisma.userPreferences.delete({ where: { userId: targetId } })] : []),
      ...(existingAvailability.length ? [this.prisma.weeklyAvailability.deleteMany({ where: { userId: targetId } })] : []),
      this.prisma.onboardingInterview.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.healthProfile.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.userPreferences.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.weeklyAvailability.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.fitnessTest.updateMany({ where: { userId: source.id }, data: { userId: targetId } }),
      this.prisma.user.update({ where: { id: source.id }, data: { accountStatus: 'archived', refreshTokenHash: null } }),
    ]);

    return {
      message: `Dados de anamnese, saude, preferencias, disponibilidade e testes de ${source.email} foram transferidos para ${target.email}. A conta duplicada foi arquivada.`,
    };
  }

  async regenerateStudentWeek(studentId: string, allowToday?: boolean) {
    await this.assertStudent(studentId);
    await this.trainingPlans.generateWeek(studentId, undefined, { allowToday });
    return { message: 'Nova semana de treinos gerada.' };
  }

  async recoverStudentSessions(studentId: string) {
    await this.assertStudent(studentId);
    return this.trainingPlans.recoverOrphanedSessions(studentId);
  }

  async syncStudentAvailability(studentId: string) {
    await this.assertStudent(studentId);
    return this.meService.syncAvailabilityFromInterview(studentId);
  }

  // Botao "Editar rotina" no painel — pedido explicito do treinador (03/08, caso da Roberta): ele
  // precisa poder corrigir a rotina de um aluno na hora, sem depender do proprio aluno acertar
  // isso sozinho pelo app nem esbarrar na trava de 1x por mes (essa trava e so pro aluno; o
  // treinador sempre pode corrigir). NAO mexe em lastRoutineChangeAt — uma correcao do treinador
  // nao deveria consumir a janela mensal do aluno.
  // applyNow (04/08): o treinador escolhe se quer ver o efeito na hora (gera a semana ja com a
  // rotina nova) ou so deixar salvo pra valer na proxima geracao automatica de domingo, igual a
  // quando o proprio aluno pede a mudanca — default true, pra nao mudar o comportamento de quem
  // ja usava esse botao esperando efeito imediato.
  async updateStudentAvailability(studentId: string, dto: UpdateStudentAvailabilityDto) {
    await this.assertStudent(studentId);
    validateAvailability(dto.availability);
    const applyNow = dto.applyNow ?? true;

    // BUG REAL 04/08: esse metodo so gravava WeeklyAvailability, nunca a copia que a entrevista
    // guarda (${dia}_run_time etc.). Como a tela "Rotina de treinos" do aluno LE dessa copia da
    // entrevista pra decidir o que salvar (buildInterviewAvailability), qualquer coisa que
    // reabrisse aquela tela — ou o proprio aluno so confirmando sem mudar nada — sobrescrevia
    // silenciosamente a correcao manual do treinador com os dados antigos da entrevista. Mesmo
    // sync que updateAvailability ja fazia, agora replicado aqui.
    const onboarding = await this.prisma.onboardingInterview.findUnique({ where: { userId: studentId }, select: { answers: true } });
    const syncedAnswers = onboarding
      ? syncInterviewAnswersFromAvailability(asAnswerObject(onboarding.answers), dto.availability)
      : null;

    await this.prisma.$transaction([
      this.prisma.weeklyAvailability.deleteMany({ where: { userId: studentId } }),
      ...dto.availability.map((day) =>
        this.prisma.weeklyAvailability.create({
          data: {
            userId: studentId,
            weekday: day.weekday,
            noTraining: day.noTraining,
            modalities: day.noTraining ? [] : day.modalities,
            availableMin: day.noTraining ? 0 : day.availableMin,
            modalityDurations: day.noTraining ? undefined : day.modalityDurations ?? {},
          },
        }),
      ),
      ...(syncedAnswers ? [this.prisma.onboardingInterview.update({ where: { userId: studentId }, data: { answers: syncedAnswers } })] : []),
    ]);

    // Mesmo gate de pagamento das outras rotas de rotina — nunca gera pra quem ainda nao pagou,
    // mesmo que o ajuste tenha sido feito pelo treinador.
    const student = await this.prisma.user.findUnique({ where: { id: studentId }, select: { name: true, studentCode: true, subscriptionStatus: true } });
    if (applyNow && student && hasSubscriptionAccess(student.subscriptionStatus)) {
      void this.trainingPlans.generateWeek(studentId).catch((error) => {
        this.logger.warn(`generateWeek apos updateStudentAvailability (treinador) falhou para ${studentId} (nao bloqueante): ${(error as Error).message}`);
      });
    }

    return this.prisma.weeklyAvailability.findMany({ where: { userId: studentId }, orderBy: { weekday: 'asc' } });
  }

  async analyzeStudentStrava(studentId: string) {
    await this.assertStudent(studentId);
    return this.trainingPlans.refreshStravaAnalysis(studentId, { force: true });
  }

  async runDatabaseBackup() {
    return this.backup.runBackup();
  }

  async regenerateStudentSession(studentId: string, sessionId: string, allowToday?: boolean) {
    await this.assertStudent(studentId);
    return this.trainingPlans.regenerateSession(studentId, sessionId, { allowToday });
  }

  async createManualSession(studentId: string, dto: CreateManualSessionDto) {
    await this.assertStudent(studentId);
    return this.trainingPlans.createManualSession(studentId, dto);
  }

  async archiveObservation(studentId: string, observationId: string) {
    await this.assertStudent(studentId);
    const observation = await this.prisma.studentObservation.findFirst({ where: { id: observationId, userId: studentId } });
    if (!observation) {
      throw new BadRequestException('Observacao nao encontrada.');
    }
    return this.prisma.studentObservation.update({ where: { id: observationId }, data: { active: false } });
  }

  exerciseLibrary() {
    return {
      fortalecimentoCorredores: runnerStrengthExercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        description: exercise.description,
        hasVideo: Boolean(exercise.videoUrl),
        videoUrl: exercise.videoUrl,
      })),
      musculacao: gymExerciseLibrary.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        description: exercise.description,
        hasVideo: Boolean(exercise.videoUrl),
        videoUrl: exercise.videoUrl,
      })),
    };
  }

  async sendStudentMessage(studentId: string, dto: SendStudentMessageDto) {
    await this.assertStudent(studentId);
    const results: Record<string, boolean | string | undefined> = {};

    if (dto.channels.includes('email')) {
      const result = await this.messaging.sendEmail(studentId, {
        subject: 'Mensagem do seu treinador - Panzeri Run',
        content: dto.message,
        trigger: 'manual',
      });
      results.email = result.ok;
      results.emailError = result.error;
    }

    return results;
  }

  async reopenStudentOnboarding(studentId: string) {
    await this.assertStudent(studentId);
    await this.prisma.onboardingInterview.upsert({
      where: { userId: studentId },
      create: { userId: studentId, answers: {}, currentStep: 0 },
      update: { completedAt: null, currentStep: 0 },
    });
    return { message: 'Entrevista liberada para revisao.' };
  }

  async dashboard(input: { search: string; page: number; pageSize: number; includeArchived?: boolean }) {
    // Reparo de emergencia (03/08) do incidente de planos "agendados" presos — ver comentario
    // detalhado em fixAllStuckScheduledPlans. So troca status no banco, nao chama IA.
    await this.trainingPlans.fixAllStuckScheduledPlans().catch((error) => {
      this.logger.warn(`fixAllStuckScheduledPlans falhou (nao bloqueante): ${(error as Error).message}`);
    });
    const studentWhere: Prisma.UserWhereInput = {
      role: 'student',
      ...(input.includeArchived ? {} : { accountStatus: { not: 'archived' } }),
      ...(input.search ? {
        OR: [
          { name: { contains: input.search, mode: 'insensitive' } },
          { email: { contains: input.search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const weekStart = coachWeekStart(new Date());
    const weekEnd = addDays(weekStart, 6);
    weekEnd.setUTCHours(23, 59, 59, 999);
    const [students, filteredCount, totalStudents, activePlanUsers, prescribedSessions, eligibleSessions, completedSessions, differentSessions, paymentConfirmed, courtesyAccess, paymentOverdue, paymentPending, plansCreatedThisWeekUsers] = await Promise.all([
      this.prisma.user.findMany({
      where: studentWhere,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        preferences: true,
        tests: {
          where: { testType: '3km' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        // startDate: weekStart e essencial aqui (mesmo bug corrigido em TrainingPlansService.current()
        // em 10/08 — aluna Eduarda): sem esse filtro, um plano "active" da SEMANA PASSADA (que so
        // fica active ate a propria aluna gerar a nova semana pelo botao) aparecia como "Acesso
        // liberado" na coluna Treino, escondendo que a semana atual dela nem foi gerada ainda.
        plans: {
          where: { status: 'active', startDate: weekStart },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
        },
        billingSubscription: true,
        // Conta TODOS os planos (ativo ou arquivado) — usado so pra saber se a aluna ja teve
        // algum plano gerado alguma vez, pra distinguir "nunca teve nada" de "esta entre semanas,
        // aguardando tocar o botao de gerar" no status exibido (ver statusFromSummary).
        _count: { select: { plans: true } },
      },
      }),
      this.prisma.user.count({ where: studentWhere }),
      this.prisma.user.count({ where: { role: 'student', ...(input.includeArchived ? {} : { accountStatus: { not: 'archived' } }) } }),
      this.prisma.trainingPlan.findMany({ where: { status: 'active' }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.trainingSession.count({ where: { scheduledDate: { gte: weekStart, lte: weekEnd }, plan: { status: 'active' } } }),
      this.prisma.trainingSession.count({ where: { scheduledDate: { gte: weekStart, lte: new Date() }, plan: { status: 'active' } } }),
      this.prisma.workoutCompletion.count({ where: { status: { in: ['done', 'adjusted'] }, session: { scheduledDate: { gte: weekStart, lte: new Date() }, plan: { status: 'active' } } } }),
      this.prisma.workoutCompletion.count({ where: { status: 'adjusted', session: { scheduledDate: { gte: weekStart, lte: new Date() }, plan: { status: 'active' } } } }),
      this.prisma.user.count({ where: { ...studentWhere, subscriptionStatus: { in: ['active', 'grace'] } } }),
      this.prisma.user.count({ where: { ...studentWhere, subscriptionStatus: 'manual_active' } }),
      this.prisma.user.count({ where: { ...studentWhere, subscriptionStatus: 'overdue' } }),
      this.prisma.user.count({ where: { ...studentWhere, subscriptionStatus: 'pending' } }),
      this.prisma.trainingPlan.findMany({ where: { status: 'active', createdAt: { gte: weekStart } }, distinct: ['userId'], select: { userId: true } }),
    ]);

    const stravaConnections = await this.prisma.stravaConnection.findMany({
      where: { userId: { in: students.map((student) => student.id) } },
      select: { userId: true, updatedAt: true },
    });
    const stravaConnectionByUserId = new Map(stravaConnections.map((connection) => [connection.userId, connection]));

    const rows = students.map((student) => {
      const plan = student.plans[0] ?? null;
      const summary = plan ? summarizeSessions(plan.sessions) : emptySummary();
      const stravaConnection = stravaConnectionByUserId.get(student.id);
      return {
        id: student.id,
        studentCode: formatStudentCode(student.studentCode),
        name: student.name,
        email: student.email,
        goal: student.preferences?.mainGoal ?? 'Objetivo nao informado',
        planName: plan?.name ?? 'Sem programa ativo',
        adherencePercent: summary.adherencePercent,
        completedSessions: summary.completedSessions,
        prescribedSessions: summary.prescribedSessions,
        eligibleSessions: summary.eligibleSessions,
        differentSessions: summary.differentSessions,
        missedSessions: summary.missedSessions,
        prescribedKm: summary.prescribedKm,
        completedKm: summary.completedKm,
        lastThreeKm: student.tests[0]?.totalSeconds ? formatDuration(student.tests[0].totalSeconds) : 'Sem teste',
        status: statusFromSummary(summary, student.subscriptionStatus, student._count.plans > 0, student.lastPlanGenerationFailedAt),
        accountStatus: student.accountStatus,
        subscriptionStatus: student.subscriptionStatus,
        subscriptionManualOverride: student.subscriptionManualOverride,
        billingNextChargeAt: student.billingSubscription?.nextChargeAt ?? null,
        billingProviderStatus: student.billingSubscription?.providerStatus ?? null,
        billingLastSyncAt: student.billingSubscription?.updatedAt ?? null,
        stravaConnected: Boolean(stravaConnection),
        stravaLastSyncAt: stravaConnection?.updatedAt ?? null,
      };
    });

    return {
      totals: {
        students: totalStudents,
        activePlans: activePlanUsers.length,
        prescribedSessions,
        eligibleSessions,
        completedSessions,
        differentSessions,
        adherencePercent: eligibleSessions ? Math.round((completedSessions / eligibleSessions) * 100) : 0,
        paymentConfirmed,
        courtesyAccess,
        paymentOverdue,
        paymentPending,
        plansCreatedThisWeek: plansCreatedThisWeekUsers.length,
      },
      students: rows,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems: filteredCount,
        totalPages: Math.max(Math.ceil(filteredCount / input.pageSize), 1),
      },
    };
  }

  // Levantamento do funil de conversao (pedido do treinador 2026-08-05, apos perceber que muitos
  // cadastros completam a entrevista mas nunca pagam, e outros nem completam a entrevista).
  // So leitura, nenhuma chamada de IA — cruza User + OnboardingInterview + subscriptionStatus.
  async signupFunnel() {
    const studentWhere: Prisma.UserWhereInput = { role: 'student', accountStatus: { not: 'archived' } };
    const students = await this.prisma.user.findMany({
      where: studentWhere,
      select: {
        id: true,
        name: true,
        email: true,
        studentCode: true,
        createdAt: true,
        subscriptionStatus: true,
        subscriptionUpdatedAt: true,
        subscriptionManualOverride: true,
        onboardingInterview: { select: { completedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86400000);
    const average = (values: number[]) => (values.length ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10 : null);
    const now = new Date();

    const neverStartedInterview = students.filter((student) => !student.onboardingInterview?.completedAt);
    // Cortesia/liberacao manual (subscriptionManualOverride) NAO conta como "pagou" pra esse
    // levantamento — o objetivo aqui e medir conversao de pagamento real, nao acesso liberado.
    const paid = students.filter((student) => hasSubscriptionAccess(student.subscriptionStatus) && !student.subscriptionManualOverride);
    const completedInterviewNoPayment = students.filter(
      (student) => student.onboardingInterview?.completedAt && !hasSubscriptionAccess(student.subscriptionStatus),
    );

    const daysSignupToInterview = students
      .filter((student): student is typeof student & { onboardingInterview: { completedAt: Date } } => Boolean(student.onboardingInterview?.completedAt))
      .map((student) => daysBetween(student.createdAt, student.onboardingInterview.completedAt));
    const daysInterviewToPayment = paid
      .filter((student): student is typeof student & { onboardingInterview: { completedAt: Date } } => Boolean(student.onboardingInterview?.completedAt))
      .map((student) => daysBetween(student.onboardingInterview.completedAt, student.subscriptionUpdatedAt));

    return {
      totals: {
        totalStudents: students.length,
        neverStartedOrFinishedInterview: neverStartedInterview.length,
        completedInterviewNoPayment: completedInterviewNoPayment.length,
        paid: paid.length,
      },
      averages: {
        // Aproximado: subscriptionUpdatedAt e a ultima mudanca de status, nao um historico
        // completo — pra quem esta pagando hoje e nunca teve outra mudanca depois, isso reflete
        // bem o momento da confirmacao do pagamento.
        diasCadastroAteEntrevista: average(daysSignupToInterview),
        diasEntrevistaAtePagamento: average(daysInterviewToPayment),
      },
      completedInterviewNoPaymentList: completedInterviewNoPayment
        .slice()
        .sort((a, b) => (a.onboardingInterview?.completedAt?.getTime() ?? 0) - (b.onboardingInterview?.completedAt?.getTime() ?? 0))
        .map((student) => ({
          id: student.id,
          studentCode: formatStudentCode(student.studentCode),
          name: student.name,
          email: student.email,
          interviewCompletedAt: student.onboardingInterview?.completedAt ?? null,
          diasDesdeAEntrevista: student.onboardingInterview?.completedAt ? daysBetween(student.onboardingInterview.completedAt, now) : null,
        })),
      neverStartedInterviewList: neverStartedInterview
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((student) => ({
          id: student.id,
          studentCode: formatStudentCode(student.studentCode),
          name: student.name,
          email: student.email,
          createdAt: student.createdAt,
          diasDesdeOCadastro: daysBetween(student.createdAt, now),
        })),
    };
  }

  async student(studentId: string) {
    await this.assertStudent(studentId);
    // Deteccao pura (nenhuma escrita, nenhuma chamada de IA) — so pra AVISAR o treinador se o
    // plano deste aluno esta desatualizado (teste novo, rotina mudou, nivel de dor elevado). A
    // decisao de gerar e sempre dele, pelo botao "Refazer nova semana" — nunca automatica so por
    // ter aberto esta pagina. Erro aqui nunca pode impedir o resto da pagina de carregar.
    const planFreshness = await this.trainingPlans.checkPlanFreshness(studentId).catch((error) => {
      this.logger.warn(`checkPlanFreshness falhou para o aluno ${studentId} (nao bloqueante): ${(error as Error).message}`);
      return { needsUpdate: false, reason: null };
    });
    await this.strava.syncIfStale(studentId).catch(() => undefined);
    const stravaStatus = await this.strava.status(studentId).catch(() => null);
    const student = await (this.prisma.user as any).findFirstOrThrow({
      where: { id: studentId, role: 'student' },
      include: {
        onboardingInterview: true,
        healthProfile: true,
        preferences: true,
        availability: { orderBy: { weekday: 'asc' } },
        tests: {
          where: { testType: '3km' },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        plans: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
        },
        coachReports: { orderBy: { createdAt: 'desc' }, take: 20 },
        reassessments: {
          where: { completedAt: { not: null } },
          orderBy: { completedAt: 'desc' },
          take: 5,
        },
        targetRaces: { orderBy: { raceDate: 'asc' } },
        billingSubscription: true,
      },
    });

    const plan = student.plans.find((item: any) => item.status === 'active') ?? student.plans[0] ?? null;
    const analysisInsight = plan
      ? await this.prisma.trainingExecutionInsight.findUnique({ where: { planId: plan.id } })
      : null;
    const observations = await this.prisma.studentObservation.findMany({ where: { userId: studentId }, orderBy: { createdAt: 'desc' }, take: 30 });
    const stravaActivities = plan
      ? await this.prisma.stravaActivity.findMany({
          where: {
            userId: studentId,
            startDate: { gte: plan.startDate, lte: plan.endDate ?? addDays(plan.startDate, 6) },
          },
          orderBy: { startDate: 'asc' },
        })
      : [];
    const usedStravaIds = new Set<string>();
    const stravaBySession = new Map<string, (typeof stravaActivities)[number]>();
    for (const session of plan?.sessions ?? []) {
      const activity = stravaActivities.find((candidate) =>
        !usedStravaIds.has(candidate.id) &&
        sameUtcDay(candidate.startDate, session.scheduledDate) &&
        stravaMatchesModality(candidate, session.modality),
      );
      if (activity) {
        usedStravaIds.add(activity.id);
        stravaBySession.set(session.id, activity);
      }
    }
    const summary = plan ? summarizeSessions(plan.sessions) : emptySummary();
    const uniqueHistory = Array.from(
      student.plans.reduce((plans: Map<string, any>, historyPlan: any) => {
        const weekKey = historyPlan.startDate.toISOString().slice(0, 10);
        if (!plans.has(weekKey)) plans.set(weekKey, historyPlan);
        return plans;
      }, new Map<string, any>()).values(),
    ) as any[];

    return {
      id: student.id,
      studentCode: formatStudentCode(student.studentCode),
      name: student.name,
      email: student.email,
      phone: student.phone,
      accountStatus: student.accountStatus,
      subscriptionStatus: student.subscriptionStatus,
      subscriptionUpdatedAt: student.subscriptionUpdatedAt,
      subscriptionManualOverride: student.subscriptionManualOverride,
      billing: student.billingSubscription
        ? {
            provider: student.billingSubscription.provider,
            providerStatus: student.billingSubscription.providerStatus,
            nextChargeAt: student.billingSubscription.nextChargeAt,
            lastSyncAt: student.billingSubscription.updatedAt,
            checkoutUrl: student.billingSubscription.checkoutUrl,
          }
        : null,
      needsUpdate: planFreshness.needsUpdate,
      needsUpdateReason: planFreshness.reason,
      strava: stravaStatus ? {
        connected: stravaStatus.connected,
        automaticSync: stravaStatus.automaticSync,
        lastActivityAt: stravaStatus.lastActivityAt,
      } : { connected: false, automaticSync: false, lastActivityAt: null },
      analysisAgent: analysisInsight ? {
        updatedAt: analysisInsight.updatedAt,
        summary: analysisInsight.summary,
      } : null,
      observations: observations.map((observation: any) => ({
        id: observation.id,
        content: observation.content,
        active: observation.active,
        createdAt: observation.createdAt,
      })),
      birthDate: student.birthDate,
      heightCm: student.heightCm,
      weightKg: student.weightKg,
      cpf: student.cpf,
      education: student.education,
      address: student.address,
      goal: student.preferences?.mainGoal ?? 'Objetivo nao informado',
      targetRaces: student.targetRaces.map((race: any) => ({
        id: race.id,
        name: race.name,
        raceDate: race.raceDate,
        distanceKm: race.distanceKm,
        targetSeconds: race.targetSeconds,
        priority: race.priority,
        status: race.status,
        paceSecondsPerKm: race.targetSeconds && race.distanceKm ? Math.round(race.targetSeconds / race.distanceKm) : null,
      })),
      interview: student.onboardingInterview ? {
        answers: sanitizeInterviewAnswers(jsonObject(student.onboardingInterview.answers)),
        currentStep: student.onboardingInterview.currentStep,
        completedAt: student.onboardingInterview.completedAt,
        updatedAt: student.onboardingInterview.updatedAt,
      } : null,
      health: {
        sleep: student.healthProfile?.averageSleep ?? 'Nao informado',
        stress: student.healthProfile?.stressLevel ?? 'Nao informado',
        anxiety: student.healthProfile?.anxietyLevel ?? 'Nao informado',
        injuries: student.healthProfile?.previousInjuries ?? 'Nao informado',
        healthProblems: student.healthProfile?.healthProblems ?? 'Nao informado',
        medications: student.healthProfile?.medications ?? 'Nao informado',
      },
      preferences: {
        preferredModalities: student.preferences?.preferredModalities ?? [],
        otherModalities: student.preferences?.otherModalities ?? [],
        trainingLocations: student.preferences?.trainingLocations ?? [],
      },
      availability: student.availability.map((day: any) => ({
        weekday: day.weekday,
        noTraining: day.noTraining,
        modalities: day.modalities,
        availableMin: day.availableMin,
        modalityDurations: day.modalityDurations,
      })),
      tests: student.tests.map((test: any) => ({
        date: test.createdAt.toISOString(),
        totalSeconds: test.totalSeconds,
        pace: formatPace(test.paceSecondsPerKm),
        vo2max: test.vo2maxEstimated,
      })),
      reassessments: student.reassessments.map((reassessment: any) => ({
        completedAt: reassessment.completedAt,
        answers: sanitizeInterviewAnswers(jsonObject(reassessment.answers)),
        evolutionSummary: reassessment.evolutionSummary,
        evolutionWins: reassessment.evolutionWins ?? [],
        evolutionConcerns: reassessment.evolutionConcerns ?? [],
      })),
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            startDate: plan.startDate,
            endDate: plan.endDate,
            recommendation: plan.aiRecommendation,
            methodology: readMethodologySnapshot(plan.inputSnapshot),
            summary,
            sessions: plan.sessions.map((session: any) => ({
              id: session.id,
              date: session.scheduledDate,
              weekday: session.weekday,
              title: session.title,
              modality: session.modality,
              durationMin: session.durationMin,
              distanceKm: session.distanceKm,
              zone: session.intensityZone,
              pace: session.paceMinSec,
              sessionType: session.sessionType,
              structure: session.structure,
              completionStatus: session.completion?.status ?? 'sem_registro',
              perceivedEffort: session.completion?.perceivedEffort ?? null,
              satisfaction: session.completion?.satisfaction ?? null,
              feedback: session.completion?.notes ?? null,
              completedDurationMin: session.completion?.durationMin ?? null,
              completedDistanceKm: session.completion?.distanceKm ?? null,
              completedPaceSecondsKm: session.completion?.avgPaceSecondsKm ?? null,
              completedAt: session.completion?.completedAt ?? null,
              stravaActivity: serializeStravaActivity(stravaBySession.get(session.id) ?? null),
              // Campo unico de texto explicativo — "recommendations" foi removido em 07/08 (dois
              // campos so confundiam e gastavam token da IA a toa); sessoes antigas que ainda tem
              // algo la aparecem juntas aqui, num so texto.
              notes: [session.notes, session.recommendations].filter(Boolean).join(' '),
              routineMismatchNote: session.routineMismatchNote,
            })),
          }
        : null,
      reports: student.coachReports.map((report: any) => ({
        id: report.id,
        reportType: report.reportType,
        title: report.title,
        content: report.content,
        createdAt: report.createdAt,
      })),
      unmatchedStravaActivities: stravaActivities
        .filter((activity) => !usedStravaIds.has(activity.id))
        .map((activity) => serializeStravaActivity(activity)),
      history: uniqueHistory.map((historyPlan: any) => ({
        id: historyPlan.id,
        name: historyPlan.name,
        status: historyPlan.status,
        startDate: historyPlan.startDate,
        endDate: historyPlan.endDate,
        summary: summarizeSessions(historyPlan.sessions),
        sessions: historyPlan.sessions.map((session: any) => ({
          id: session.id,
          date: session.scheduledDate,
          weekday: session.weekday,
          title: session.title,
          modality: session.modality,
          durationMin: session.durationMin,
          distanceKm: session.distanceKm,
          zone: session.intensityZone,
          structure: session.structure,
          notes: [session.notes, session.recommendations].filter(Boolean).join(' '),
          routineMismatchNote: session.routineMismatchNote,
          completionStatus: session.completion?.status ?? 'sem_registro',
          perceivedEffort: session.completion?.perceivedEffort ?? null,
          satisfaction: session.completion?.satisfaction ?? null,
          feedback: session.completion?.notes ?? null,
        })),
      })),
    };
  }

  async coupons() {
    const prisma = this.prisma as any;
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { redemptions: { include: { user: { select: { id: true, name: true, email: true, subscriptionStatus: true } } } } },
    });
    return {
      coupons: coupons.map((coupon: any) => ({
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discountPercent: coupon.discountPercent,
        active: coupon.active,
        usageCount: coupon.usageCount,
        createdAt: coupon.createdAt,
        redemptions: coupon.redemptions.map((redemption: any) => ({
          id: redemption.id,
          createdAt: redemption.createdAt,
          student: redemption.user,
        })),
      })),
    };
  }

  async createCoupon(dto: { code: string; name?: string; discountPercent?: number; active?: boolean }) {
    const code = normalizeCouponCode(dto.code);
    if (!code) throw new BadRequestException('Informe o codigo do cupom.');
    const discountPercent = clampPercent(dto.discountPercent ?? 100);
    const prisma = this.prisma as any;
    return prisma.coupon.create({
      data: {
        code,
        name: dto.name?.trim() || code,
        discountPercent,
        active: dto.active ?? true,
      },
    });
  }

  async updateCoupon(couponId: string, dto: { code?: string; name?: string; discountPercent?: number; active?: boolean }) {
    const data: Record<string, unknown> = {};
    if (dto.code !== undefined) data.code = normalizeCouponCode(dto.code);
    if (dto.name !== undefined) data.name = dto.name.trim() || normalizeCouponCode(dto.code ?? 'Cupom');
    if (dto.discountPercent !== undefined) data.discountPercent = clampPercent(dto.discountPercent);
    if (dto.active !== undefined) data.active = dto.active;
    if (!Object.keys(data).length) throw new BadRequestException('Nenhuma alteracao informada.');
    const prisma = this.prisma as any;
    return prisma.coupon.update({ where: { id: couponId }, data });
  }

  async finance() {
    const [students, subscriptions, coupons] = await Promise.all([
      this.prisma.user.groupBy({ by: ['subscriptionStatus'], where: { role: 'student' }, _count: true }),
      this.prisma.billingSubscription.findMany({ include: { user: { select: { id: true, name: true, email: true, subscriptionStatus: true } } } }),
      (this.prisma as any).coupon.findMany({ include: { redemptions: true } }),
    ]);
    const countByStatus = Object.fromEntries(students.map((item) => [item.subscriptionStatus, item._count]));
    const active = Number(countByStatus.active ?? 0) + Number(countByStatus.manual_active ?? 0) + Number(countByStatus.grace ?? 0);
    const courtesy = Number(countByStatus.manual_active ?? 0);
    const paying = Number(countByStatus.active ?? 0) + Number(countByStatus.grace ?? 0);
    return {
      priceCents: 1990,
      priceLabel: 'R$ 19,90',
      activePlans: active,
      payingPlans: paying,
      courtesyPlans: courtesy,
      pendingPlans: Number(countByStatus.pending ?? 0),
      overduePlans: Number(countByStatus.overdue ?? 0),
      canceledPlans: Number(countByStatus.canceled ?? 0),
      estimatedMonthlyRevenueCents: paying * 1990,
      subscriptions: subscriptions.map((item) => ({
        id: item.id,
        provider: item.provider,
        providerStatus: item.providerStatus,
        nextChargeAt: item.nextChargeAt,
        checkoutUrl: item.checkoutUrl,
        student: item.user,
      })),
      coupons: coupons.map((coupon: any) => ({
        id: coupon.id,
        code: coupon.code,
        discountPercent: coupon.discountPercent,
        active: coupon.active,
        usageCount: coupon.usageCount,
        redemptions: coupon.redemptions.length,
      })),
    };
  }

  async generateStudentReport(studentId: string, reportType: string) {
    if (!['technical', 'evolution'].includes(reportType)) {
      throw new BadRequestException('Tipo de relatorio invalido.');
    }
    const detail = await this.student(studentId);
    const content = reportType === 'technical' ? buildTechnicalReportContent(detail) : buildEvolutionReportContent(detail);
    const prisma = this.prisma as any;
    return prisma.coachReport.create({
      data: {
        userId: studentId,
        reportType,
        title: reportType === 'technical' ? 'Prestacao de contas tecnica do agente' : 'Relatorio de evolucao do aluno',
        content: content as Prisma.InputJsonObject,
      },
    });
  }
  private assertStudent(studentId: string) {
    return this.prisma.user.findFirstOrThrow({
      where: { id: studentId, role: 'student' },
    });
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function satisfactionSummary(sessions: any[]) {
  const labels: Record<string, string> = {
    amei: 'Amei',
    gostei: 'Gostei',
    neutro: 'Neutro',
    nao_gostei: 'Nao gostei',
    detestei: 'Detestei',
  };
  const counts = sessions.reduce((acc: Record<string, number>, session: any) => {
    if (session.satisfaction) acc[session.satisfaction] = (acc[session.satisfaction] ?? 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts);
  if (!entries.length) return 'sem registro';
  return entries.map(([value, count]) => `${labels[value] ?? value} (${count})`).join(', ');
}

function readMethodologySnapshot(inputSnapshot: unknown) {
  if (!inputSnapshot || typeof inputSnapshot !== 'object' || !('methodology' in inputSnapshot)) return null;
  const methodology = (inputSnapshot as { methodology?: unknown }).methodology;
  if (!methodology || typeof methodology !== 'object') return null;
  const { rationale, safetyAdjustment, decisionSource } = methodology as {
    rationale?: unknown;
    safetyAdjustment?: unknown;
    decisionSource?: unknown;
  };
  return {
    rationale: Array.isArray(rationale) ? rationale.filter((item): item is string => typeof item === 'string') : [],
    safetyAdjustment: Boolean(safetyAdjustment),
    decisionSource: decisionSource === 'ai' ? 'ai' : 'deterministic',
  };
}

function buildTechnicalReportContent(detail: any) {
  const summary = detail.plan?.summary ?? emptySummary();
  const tests = detail.tests ?? [];
  const availability = detail.availability ?? [];
  const rationale: string[] = detail.plan?.methodology?.rationale ?? [];
  const decisionSource = detail.plan?.methodology?.decisionSource;
  const sourceLabel = decisionSource === 'ai' ? 'Agente de IA (Metodologia Elton Panzeri)' : 'Motor deterministico (regras fixas)';
  return {
    generatedAt: new Date().toISOString(),
    type: 'technical',
    student: { id: detail.id, name: detail.name, email: detail.email, goal: detail.goal },
    metrics: {
      sessions: summary.prescribedSessions,
      weeklyKm: summary.prescribedKm,
      latest3km: tests[0]?.pace ?? 'Sem teste',
      availabilityDays: availability.filter((day: any) => !day.noTraining).length,
    },
    sections: [
      {
        title: 'Leitura inicial do aluno',
        text: `Objetivo registrado: ${detail.goal}. Teste recente: ${tests[0]?.pace ?? 'nao informado'}. Disponibilidade util na semana: ${availability.filter((day: any) => !day.noTraining).length} dia(s).`,
      },
      {
        title: 'Programa criado',
        text: `Programa atual: ${detail.plan?.name ?? 'sem programa ativo'}. Foram prescritos ${summary.prescribedSessions} treino(s), com ${summary.prescribedKm} km planejados quando aplicavel.`,
      },
      {
        title: 'Justificativa tecnica',
        text: rationale.length
          ? `Decisao gerada por: ${sourceLabel}. Decisoes desta semana: ${rationale.join(' ')}`
          : 'O programa foi montado cruzando objetivo, teste de 3 km, rotina semanal informada, modalidades disponiveis e sinais de saude/recuperacao. A progressao deve respeitar aderencia, feedback, dor, fadiga e dados externos do Strava quando disponiveis.',
      },
      {
        title: 'Expectativa de resposta',
        text: 'A expectativa e aumentar consistencia, preservar seguranca e ajustar volume/intensidade conforme execucao real. Caso a aderencia caia, o agente deve reduzir complexidade e adequar rotina antes de elevar carga.',
      },
      {
        title: 'Pontos para supervisao do treinador',
        text: `Monitorar treinos diferentes do proposto (${summary.differentSessions}), treinos sem registro (${summary.missedSessions}) e comentarios do aluno. Validar manualmente se houver dor, fadiga alta ou queda consistente de desempenho.`,
      },
    ],
  };
}

function buildEvolutionReportContent(detail: any) {
  const summary = detail.plan?.summary ?? emptySummary();
  const sessions = detail.plan?.sessions ?? [];
  const done = sessions.filter((session: any) => session.completionStatus === 'done' || session.completionStatus === 'adjusted');
  const strava = [
    ...sessions.map((session: any) => session.stravaActivity).filter(Boolean),
    ...(detail.unmatchedStravaActivities ?? []),
  ];
  const avgEffort = done.length
    ? Math.round((done.reduce((total: number, session: any) => total + Number(session.perceivedEffort ?? 0), 0) / done.length) * 10) / 10
    : null;
  const stravaKm = round(strava.reduce((total: number, activity: any) => total + Number(activity.distanceKm ?? 0), 0));
  const stravaMinutes = Math.round(strava.reduce((total: number, activity: any) => total + Number(activity.durationMin ?? 0), 0));
  const latestInsight = detail.analysisAgent?.summary;
  return {
    generatedAt: new Date().toISOString(),
    type: 'evolution',
    student: { id: detail.id, name: detail.name, email: detail.email, goal: detail.goal },
    metrics: {
      adherencePercent: summary.adherencePercent,
      completedSessions: summary.completedSessions,
      prescribedSessions: summary.prescribedSessions,
      prescribedKm: summary.prescribedKm,
      completedKm: summary.completedKm,
      stravaKm,
      stravaMinutes,
      averageEffort: avgEffort,
      trend: latestInsight?.progression?.loadTrend ?? 'sem tendencia calculada',
    },
    sections: [
      {
        title: 'Execucao do programa',
        text: `Aderencia atual: ${summary.adherencePercent}%. Foram concluidos ${summary.completedSessions} de ${summary.prescribedSessions} treino(s), com ${summary.completedKm}/${summary.prescribedKm} km registrados no app.`,
      },
      {
        title: 'Feedback do aluno',
        text: done.length
          ? `PSE media informada: ${avgEffort ?? 'nao informada'}/10. Satisfacao com o treino proposto: ${satisfactionSummary(done)}. Comentarios recentes: ${done.map((session: any) => session.feedback).filter(Boolean).slice(0, 3).join(' | ') || 'sem comentarios recentes'}.`
          : 'Ainda nao ha feedback manual suficiente para conclusao.',
      },
      {
        title: 'Dados do Strava',
        text: strava.length ? `Foram encontrados ${strava.length} atividade(s) no Strava no periodo observado, somando ${stravaKm} km e ${stravaMinutes} min. O agente deve comparar modalidade, distancia, tempo, pace, frequencia cardiaca e cadencia quando disponiveis.` : 'Ainda nao ha atividades Strava suficientes no periodo observado.',
      },
      {
        title: 'Tendencia observada',
        text: latestInsight?.coachAnalysis?.text ?? 'Sem tendencia automatica consolidada. A proxima analise deve priorizar consistencia, resposta cardiovascular e diferenca entre prescrito e realizado.',
      },
      {
        title: 'Proximas decisoes sugeridas',
        text: 'Manter ajuste semanal baseado na rotina real. Se houver boa aderencia e feedback leve/moderado, progredir carga com cautela. Se houver baixa aderencia ou esforco alto, reduzir volume/intensidade e simplificar a semana.',
      },
    ],
  };
}
function serializeStravaActivity(activity: {
  id: string;
  stravaId: string;
  name: string | null;
  type: string | null;
  startDate: Date;
  distanceKm: number | null;
  movingTimeSec: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
} | null) {
  if (!activity) return null;
  return {
    id: activity.id,
    stravaId: activity.stravaId,
    name: activity.name,
    type: activity.type,
    startDate: activity.startDate,
    distanceKm: activity.distanceKm,
    durationMin: activity.movingTimeSec ? Math.round(activity.movingTimeSec / 60) : null,
    paceSecondsKm: activity.avgPaceSecKm,
    averageHeartRate: activity.avgHeartRate,
    maxHeartRate: activity.maxHeartRate,
  };
}

function sameUtcDay(left: Date, right: Date) {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function stravaMatchesModality(activity: { type: string | null; name: string | null }, modality: string) {
  const value = `${activity.type ?? ''} ${activity.name ?? ''}`.toLowerCase();
  if (modality === 'corrida' || modality === 'esteira') return value.includes('run');
  if (modality === 'bike') return value.includes('ride') || value.includes('bike');
  if (modality === 'forca' || modality === 'fortalecimento_corredores') {
    return ['weight', 'strength', 'workout', 'training', 'treinamento', 'peso', 'musculacao', 'forca']
      .some((term) => value.includes(term));
  }
  return false;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function coachWeekStart(date: Date) {
  const result = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return result;
}

function buildAccessText(email: string, password: string) {
  return `Acesso Panzeri Run\n\nLink: ${studentAppUrl()}\nE-mail: ${email}\nSenha inicial: ${password}`;
}

function studentAppUrl() {
  return process.env.STUDENT_APP_URL ?? 'https://agenteselton-panzeri-run-app.hbljgk.easypanel.host';
}

function publicAppUrl() {
  return process.env.APP_PUBLIC_URL ?? 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function summarizeSessions(sessions: Array<{ scheduledDate: Date; durationMin: number | null; distanceKm: number | null; completion: { status: string; distanceKm: number | null } | null }>) {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  const prescribedSessions = sessions.length;
  const eligible = sessions.filter((session) => session.scheduledDate <= today);
  const eligibleSessions = eligible.length;
  const completedSessions = eligible.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length;
  const missedSessions = eligible.filter((session) => session.completion?.status === 'missed' || !session.completion).length;
  const differentSessions = eligible.filter((session) => session.completion?.status === 'adjusted').length;
  const prescribedKm = round(sessions.reduce((total, session) => total + (session.distanceKm ?? 0), 0));
  const completedKm = round(sessions.reduce((total, session) => total + (session.completion?.distanceKm ?? 0), 0));

  return {
    prescribedSessions,
    eligibleSessions,
    completedSessions,
    missedSessions,
    differentSessions,
    prescribedKm,
    completedKm,
    adherencePercent: eligibleSessions ? Math.round((completedSessions / eligibleSessions) * 100) : 0,
  };
}

function emptySummary() {
  return {
    prescribedSessions: 0,
    eligibleSessions: 0,
    completedSessions: 0,
    missedSessions: 0,
    differentSessions: 0,
    prescribedKm: 0,
    completedKm: 0,
    adherencePercent: 0,
  };
}

function statusFromSummary(
  summary: { prescribedSessions: number; eligibleSessions: number },
  subscriptionStatus: string,
  hasEverHadPlan: boolean,
  lastPlanGenerationFailedAt: Date | null,
) {
  // Este status reflete apenas o estagio de acesso ao treino (existe plano? ja teve algum treino
  // elegivel?) — a qualidade da aderencia ja aparece na coluna "Aderencia" e no detalhe do aluno,
  // nao deve ser duplicada aqui como um rotulo de alerta que confunde quem acabou de comecar.
  // Um plano pode existir no banco (gerado antes do pagamento cair) sem que o aluno realmente
  // consiga ve-lo no app — "Acesso liberado" so pode refletir a mesma regra usada para o aluno
  // (hasSubscriptionAccess), nunca so a existencia de sessoes prescritas.
  if (!summary.prescribedSessions) {
    // Diferente de "Aguardando aluna gerar a semana" (normal, ainda nao tocou o botao): aqui ela
    // (ou o treinador) JA tocou e a chamada de IA falhou — precisa de acao (ver
    // TrainingPlansService.generateWeek, lastPlanGenerationFailedAt). Fica assim ate a proxima
    // tentativa ter sucesso (o campo e limpo la), nunca se resolve sozinho.
    if (lastPlanGenerationFailedAt) return 'Falha ao gerar - verificar';
    // Desde que a geracao virou sob demanda (botao "Gerar treino da semana", 06/08), e normal uma
    // aluna com historico real ficar alguns dias sem plano ativo pra semana atual — nao e "Sem
    // treino" (que soa como algo quebrado), e sim aguardando ela mesma tocar o botao.
    if (hasEverHadPlan) return 'Aguardando aluna gerar a semana';
    return 'Sem treino';
  }
  if (!hasSubscriptionAccess(subscriptionStatus)) return 'Bloqueado (pagamento)';
  if (!summary.eligibleSessions) return 'Aguardando primeiro treino';
  return 'Acesso liberado';
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}








