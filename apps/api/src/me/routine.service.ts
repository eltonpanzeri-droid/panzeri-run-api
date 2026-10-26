import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readRoutineState, ROUTINE_REQUIRED_CODE } from '../common/routine-state';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { TrainingPlansService, hasSubscriptionAccess } from '../training-plans/training-plans.service';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';
import { ReportTimelineService } from '../reporter/report-timeline.service';
import { STUDENT_REPORT_SOURCE_TYPES } from '../reporter/report-timeline.constants';
import type { AvailabilityDayDto } from './dto/update-availability.dto';
import { isRoutineAnswerKey } from '../training-plans/training-methodology';
import { isLegacyRoutineCompatEnabled, LEGACY_STAGE_KEY, legacyDraftToDays, legacyStageIsFresh } from './routine-legacy-compat';
import { minimizedRoutine, NormalizedRoutineDay, routineSignature, validateFullRoutineWeek, validateRoutinePatch } from './routine.rules';

// Comando UNICO de gravacao da ROTINA (26/10/2026). Aluno, treinador e mesclagem de contas gravam WeeklyAvailability SOMENTE por aqui; entrevista, anamnese, relatos,
// diretrizes e respostas historicas nao criam, restauram nem substituem a rotina. Cada gravacao e' uma transacao serializada por aluno (trava de aviso do Postgres), confere a
// REVISAO esperada (escrita obsoleta recebe 409, nunca sobrescreve em silencio), substitui as linhas, incrementa a revisao e registra antes/depois. Efeitos secundarios
// (aviso ao treinador, primeira geracao, relato) acontecem DEPOIS do commit e nunca transformam uma rotina ja salva em erro.

export type RoutineSource = 'student' | 'coach' | 'merge' | 'legacy_app';
export type RoutineWriteStatus = 'saved' | 'unchanged';

export interface RoutineWriteInput {
  expectedRevision?: number | null;
  source: RoutineSource;
  actorId?: string | null;
  observation?: string | null;
  // true = so' grava (nao dispara a primeira geracao). Usado quando o treinador salva sem pedir efeito imediato.
  skipFirstGeneration?: boolean;
  // true = so' grava se NINGUEM tem rotina ainda (verificado dentro da trava). Usado pela compatibilidade com apps antigos: nunca altera rotina existente.
  onlyIfUnconfigured?: boolean;
}

export interface RoutineWriteResult {
  status: RoutineWriteStatus;
  configured: true;
  revision: number;
  routineChanged: boolean;
  firstTime: boolean;
  // true so' quando a primeira geracao foi de fato disparada (entrevista concluida + acesso ativo + dia com treino + ainda sem programa). Nao e' sinonimo de firstTime.
  generationStarted: boolean;
  availability: Array<{ id: string; weekday: number; noTraining: boolean; modalities: string[]; availableMin: number | null; modalityDurations: Prisma.JsonValue | null }>;
}

@Injectable()
export class RoutineService {
  private readonly logger = new Logger(RoutineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
    private readonly studentProfile: StudentProfileService,
    private readonly telegram: TelegramService,
    private readonly reportTimeline: ReportTimelineService,
  ) {}

  // Estado atual lido DIRETAMENTE da rotina (nunca de cache nem da entrevista): configurada?, revisao e os sete dias.
  async status(userId: string) {
    const state = await readRoutineState(this.prisma, userId);
    return { configured: state.configured, revision: state.revision, allRest: state.allRest, availability: state.days };
  }

  // Substituicao INTEGRAL da semana (os sete dias).
  async replaceWeek(userId: string, days: AvailabilityDayDto[], input: RoutineWriteInput): Promise<RoutineWriteResult> {
    const next = validateFullRoutineWeek(days);
    return this.commit(userId, input, () => next);
  }

  // Alteracao PARCIAL: so' os dias enviados mudam. Exige rotina ja cadastrada e a revisao esperada (sem ela nao ha como saber sobre qual semana o cliente decidiu).
  async patchDays(userId: string, days: AvailabilityDayDto[], input: RoutineWriteInput & { expectedRevision: number }): Promise<RoutineWriteResult> {
    const patch = validateRoutinePatch(days);
    return this.commit(userId, input, (current) => {
      if (current.length === 0) throw new BadRequestException({ code: ROUTINE_REQUIRED_CODE, message: 'A rotina ainda nao foi cadastrada. Envie a semana inteira primeiro.' });
      const byDay = new Map<number, NormalizedRoutineDay>(current.map((day) => [day.weekday, day]));
      for (const day of patch) byDay.set(day.weekday, day);
      return [...byDay.values()].sort((left, right) => left.weekday - right.weekday);
    });
  }

  private async commit(
    userId: string,
    input: RoutineWriteInput,
    compute: (current: NormalizedRoutineDay[]) => NormalizedRoutineDay[],
  ): Promise<RoutineWriteResult> {
    type Outcome =
      | { kind: 'conflict'; revision: number; availability: RoutineWriteResult['availability'] }
      | { kind: 'done'; status: RoutineWriteStatus; revision: number; changed: boolean; availability: RoutineWriteResult['availability'] };

    const outcome: Outcome = await this.prisma.$transaction(async (tx) => {
      // Uma gravacao por aluno por vez (inclusive a primeira, quando ainda nao existe nenhuma linha para travar).
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`routine:${userId}`}))::text AS locked`;
      const [state, rows] = await Promise.all([
        tx.weeklyRoutineState.findUnique({ where: { userId } }),
        tx.weeklyAvailability.findMany({ where: { userId }, orderBy: { weekday: 'asc' } }),
      ]);
      const revisionBefore = state?.revision ?? 0;
      const configuredBefore = Boolean(state) || rows.length > 0;
      if (input.onlyIfUnconfigured && configuredBefore) return { kind: 'done', status: 'unchanged', revision: revisionBefore, changed: false, availability: rows };
      if (input.expectedRevision != null && input.expectedRevision !== revisionBefore) {
        return { kind: 'conflict', revision: revisionBefore, availability: rows };
      }
      const currentNormalized: NormalizedRoutineDay[] = rows.map((row) => ({
        weekday: row.weekday, noTraining: row.noTraining, modalities: row.modalities, availableMin: row.availableMin ?? 0,
        modalityDurations: (row.modalityDurations && typeof row.modalityDurations === 'object' && !Array.isArray(row.modalityDurations) ? row.modalityDurations : {}) as Record<string, number>,
      }));
      const next = compute(currentNormalized);
      const changed = !configuredBefore || routineSignature(rows) !== routineSignature(next);
      if (!changed) return { kind: 'done', status: 'unchanged', revision: revisionBefore, changed: false, availability: rows };

      const revision = revisionBefore + 1;
      await tx.weeklyAvailability.deleteMany({ where: { userId } });
      for (const day of next) {
        await tx.weeklyAvailability.create({
          data: {
            userId, weekday: day.weekday, noTraining: day.noTraining, modalities: day.modalities,
            availableMin: day.availableMin, modalityDurations: day.noTraining ? Prisma.JsonNull : (day.modalityDurations as Prisma.InputJsonObject),
          },
        });
      }
      await tx.weeklyRoutineState.upsert({ where: { userId }, create: { userId, revision }, update: { revision } });
      await tx.weeklyRoutineChange.create({
        data: {
          userId, revision, source: input.source, actorId: input.actorId ?? null,
          before: minimizedRoutine(rows) as unknown as Prisma.InputJsonValue, after: minimizedRoutine(next) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { lastRoutineChangeAt: new Date() } });
      const availability = await tx.weeklyAvailability.findMany({ where: { userId }, orderBy: { weekday: 'asc' } });
      return { kind: 'done', status: 'saved', revision, changed: true, availability };
    });

    if (outcome.kind === 'conflict') {
      throw new ConflictException({
        code: 'routine_conflict',
        message: 'A rotina foi alterada por outra pessoa ou em outra tela. Recarregue a rotina atual antes de salvar.',
        revision: outcome.revision,
        configured: outcome.availability.length > 0 || outcome.revision > 0,
        availability: outcome.availability,
      });
    }

    // ---- A partir daqui a rotina JA ESTA gravada: qualquer falha abaixo e' registrada e nunca vira erro de gravacao. ----
    const hadPlan = await this.safely('consulta de programa existente', async () => Boolean(await this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } })), true);
    const eligibleForFirstPlan = await this.safely('conferencia do gate da primeira geracao', async () => {
      const [student, interview] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } }),
        this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
      ]);
      return Boolean(student && hasSubscriptionAccess(student.subscriptionStatus) && interview?.completedAt);
    }, false);
    const generationStarted = outcome.changed && !input.skipFirstGeneration && !hadPlan && eligibleForFirstPlan && outcome.availability.some((day) => !day.noTraining);
    if (outcome.changed) {
      if (!input.skipFirstGeneration) await this.safely('primeira geracao', async () => {
        void this.trainingPlans.generateFirstWeekIfNeeded(userId).catch((error) => {
          this.logger.warn(`generateFirstWeekIfNeeded apos gravar a rotina falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
        });
      }, undefined);
      if (input.source === 'student' || input.source === 'legacy_app') {
        await this.safely('aviso ao treinador', async () => {
          const student = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, studentCode: true } });
          void this.telegram.notifyCoach(buildRoutineChangeTelegramMessage(student?.name, student?.studentCode, !hadPlan, generationStarted)).catch(() => undefined);
        }, undefined);
      }
    }
    const note = (input.observation ?? '').trim();
    if (note) await this.safely('relato da observacao', () => this.forwardObservation(userId, note), undefined);

    return { status: outcome.status, configured: true, revision: outcome.revision, routineChanged: outcome.changed, firstTime: !hadPlan, generationStarted, availability: outcome.availability };
  }

  // ---- COMPATIBILIDADE com apps nativos antigos (ver routine-legacy-compat.ts). Nada aqui le a entrevista como fonte: so' o rascunho da sessao atual do app. ----

  // PUT /me/onboarding/answer com chave de rotina (so' apps antigos enviam isso). Retorna false quando o caminho esta desligado (o chamador responde 400 como antes).
  async stageLegacyAnswer(userId: string, dto: { key: string; value: unknown; currentStep: number }): Promise<boolean> {
    if (!isLegacyRoutineCompatEnabled()) return false;
    const state = await readRoutineState(this.prisma, userId);
    // Quem ja tem rotina nao a altera por aqui: a resposta e' aceita (o app antigo segue o fluxo) e descartada.
    if (state.configured) return true;
    const current = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    let answers = { ...((current?.answers && typeof current.answers === 'object' && !Array.isArray(current.answers) ? current.answers : {}) as Record<string, Prisma.InputJsonValue>) };
    // Sessao nova (sem rascunho recente): descarta qualquer resposta de rotina antiga — respostas historicas nunca viram rotina.
    if (!legacyStageIsFresh(answers)) {
      answers = Object.fromEntries(Object.entries(answers).filter(([key]) => !isRoutineAnswerKey(key))) as Record<string, Prisma.InputJsonValue>;
    }
    answers[dto.key] = JSON.parse(JSON.stringify(dto.value ?? null)) as Prisma.InputJsonValue;
    answers[LEGACY_STAGE_KEY] = new Date().toISOString();
    await this.prisma.onboardingInterview.upsert({
      where: { userId },
      create: { userId, answers, currentStep: dto.currentStep },
      update: { answers, currentStep: dto.currentStep },
    });
    return true;
  }

  // POST /me/onboarding/complete-routine (apps antigos). Grava a PRIMEIRA rotina a partir do rascunho da sessao, pelo comando unico. Retorna null quando desligado (chamador responde 410).
  async completeLegacyRoutine(userId: string) {
    if (!isLegacyRoutineCompatEnabled()) return null;
    const state = await readRoutineState(this.prisma, userId);
    if (state.configured) {
      return { synced: false, preserved: true, reason: 'existing_routine_preserved', days: state.activeDays.length, firstTime: false };
    }
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true } });
    const answers = (interview?.answers && typeof interview.answers === 'object' && !Array.isArray(interview.answers) ? interview.answers : {}) as Record<string, unknown>;
    if (!legacyStageIsFresh(answers)) {
      throw new BadRequestException({ code: ROUTINE_REQUIRED_CODE, message: 'Nao encontrei as respostas da rotina desta sessao. Preencha a rotina de treinos novamente.' });
    }
    const observation = typeof answers.routine_observation === 'string' ? answers.routine_observation : null;
    const result = await this.replaceWeek(userId, legacyDraftToDays(answers), { source: 'legacy_app', actorId: userId, observation, onlyIfUnconfigured: true });
    // Rascunho consumido: nenhuma resposta de rotina fica guardada na entrevista.
    await this.safely('limpeza do rascunho legado', async () => {
      const cleaned = Object.fromEntries(Object.entries(answers).filter(([key]) => !isRoutineAnswerKey(key) && key !== LEGACY_STAGE_KEY)) as Prisma.InputJsonObject;
      await this.prisma.onboardingInterview.update({ where: { userId }, data: { answers: cleaned } });
    }, undefined);
    return { synced: result.routineChanged, preserved: !result.routineChanged, days: result.availability.filter((day) => !day.noTraining).length, firstTime: result.firstTime };
  }

  private async safely<T>(what: string, action: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await action();
    } catch (error) {
      this.logger.warn(`Rotina ja gravada; falhou (nao bloqueante) ${what} para o aluno: ${(error as Error).message}`);
      return fallback;
    }
  }

  // Texto livre do aluno sobre a rotina: segue ao mecanismo de relatos (Relator -> Prontuario). Nao altera a agenda. Idempotente por texto.
  private async forwardObservation(userId: string, text: string) {
    const recorded = await this.reportTimeline.record({
      userId,
      sourceType: STUDENT_REPORT_SOURCE_TYPES.ONBOARDING_INTERVIEW_ROUTINE_NOTE,
      promptQuestion: 'Alguma observacao sobre sua rotina?',
      relatedLabel: 'Rotina semanal',
      originalText: text,
      occurredAt: new Date(),
      dedupe: true,
    });
    if (!recorded) return;
    void this.studentProfile.recordEvent(userId, ProfileEventCode.STUDENT_OBSERVATION, `Observacao do aluno sobre a rotina (edicao da rotina): ${text}`).catch((error) => {
      this.logger.warn(`recordEvent(STUDENT_OBSERVATION, rotina) falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
    });
  }
}

function buildRoutineChangeTelegramMessage(studentName: string | undefined, studentCode: number | null | undefined, firstTime: boolean, generationStarted: boolean): string {
  const name = studentName ?? 'desconhecido';
  const code = formatStudentCode(studentCode);
  if (firstTime && generationStarted) return `🔁 Aluno "${name}" (Cod. ${code}) montou a rotina de treinos no Panzeri Run\n\nO primeiro treino esta sendo gerado automaticamente.`;
  if (firstTime) return `🔁 Aluno "${name}" (Cod. ${code}) cadastrou a rotina de treinos no Panzeri Run\n\nO primeiro treino AINDA NAO foi gerado (falta entrevista concluida, acesso ativo ou algum dia com treino).`;
  return `🔁 Aluno "${name}" (Cod. ${code}) alterou a rotina de treinos no Panzeri Run\n\nOs treinos ja entregues NAO mudam. Para aplicar a rotina nova, use "Refazer nova semana de treinos" no painel do aluno.`;
}
