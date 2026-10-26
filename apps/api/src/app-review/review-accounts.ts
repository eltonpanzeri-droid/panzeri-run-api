import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { LEGAL_VERSION } from '../legal/legal-content';
import { runnerStrengthExercises } from '../training-plans/runner-strength-library';
import { TrainingPlansService, addDays, startOfWeek } from '../training-plans/training-plans.service';

// Contas de DEMONSTRACAO para a revisao da App Store (24/10/2026, Apple 2.1). Dados 100% sinteticos, criados por um comando controlado
// (cli.ts), idempotente e restrito a contas cujo e-mail comeca com `revisao-apple-`. Nada aqui chama IA, rede ou cobranca.
//   - 'active':  aluna com acesso concedido (cortesia manual_active, provedor revenuecat + override manual: nenhuma sincronizacao a revoga e o botao 'Cancelar' vira 'Gerenciar assinatura na loja'), programa da semana + 4 semanas de historico, feedbacks, tenis, prova alvo.
//   - 'expired': aluno cuja assinatura da LOJA esta expirada (status canceled + provedor revenuecat), sem nenhum registro na Apple/RevenueCat:
//                o estado "expirada" vem do nosso banco e NAO depende de a Apple renovar/cancelar no Sandbox (por isso nunca "volta a ativa" sozinha).
//                Ao comprar no Sandbox, o fluxo normal (RevenueCat -> /billing/store/sync) concede o acesso; rodar `seed` de novo restaura o estado expirado.

export type ReviewKind = 'active' | 'expired';
export interface ReviewAccountSpec { kind: ReviewKind; email: string; password: string }

export const REVIEW_EMAIL_PREFIX = 'revisao-apple-';
export const MIN_REVIEW_PASSWORD_LENGTH = 12;

export function normalizeReviewEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value) || !value.startsWith(REVIEW_EMAIL_PREFIX)) {
    throw new Error(`E-mail de revisao invalido: precisa comecar com "${REVIEW_EMAIL_PREFIX}".`);
  }
  return value;
}

// Id deterministico (formato uuid v5-like) derivado do e-mail: o mesmo e-mail sempre vira a mesma conta; um e-mail ja usado por OUTRA conta nunca e' sobrescrito.
export function reviewUserId(email: string): string {
  const hex = createHash('sha1').update(`panzeri-run:app-review:${normalizeReviewEmail(email)}`).digest('hex');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

const noop = {} as never;
const builders = new TrainingPlansService(noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop) as unknown as {
  runPrescription: (durationMin: number, modality: string, decision: { parts: unknown[] }) => { durationMin: number | null; distanceKm: number | null; representativePaceSecondsPerKm: number | null } & Record<string, unknown>;
  strengthPrescription: (durationMin: number, decision: Record<string, unknown>) => { durationMin: number | null } & Record<string, unknown>;
};

const continua = (distanceKm: number, min: number, max = min) => ({ kind: 'continua', distanceKm, paceSecondsPerKmMin: min, paceSecondsPerKmMax: max });
const intervalada = (repeatCount: number, stimulusKm: number, stimulusPace: number, recoveryKm: number, recoveryPace: number) => ({
  kind: 'intervalada', repeatCount,
  stimulusLabel: 'Tiro forte', stimulusStepKm: stimulusKm, stimulusPaceSecondsPerKm: stimulusPace,
  recoveryLabel: 'Trote leve', recoveryStepKm: recoveryKm, recoveryPaceSecondsPerKm: recoveryPace,
});

interface DraftSession {
  offset: number; // dias a partir da segunda-feira da semana
  modality: 'corrida' | 'fortalecimento_corredores';
  title: string;
  sessionType: string;
  notes: string;
  prescription: ReturnType<typeof builders.runPrescription> | ReturnType<typeof builders.strengthPrescription>;
  outcome: 'done' | 'adjusted' | 'missed';
}

const runnerIds = runnerStrengthExercises.slice(0, 5).map((exercise) => exercise.id);

// Semana-modelo da aluna de demonstracao; `week` 0 = semana atual, 1..4 = semanas passadas (volume crescente ate a atual).
export function buildWeekDrafts(week: number): DraftSession[] {
  const growth = 4 - Math.min(week, 4); // 0 (4 semanas atras) .. 4 (atual)
  const easyKm = 4 + growth * 0.5;
  const longKm = 7 + growth;
  const drafts: DraftSession[] = [];
  drafts.push({
    offset: 0, modality: 'fortalecimento_corredores', title: 'Fortalecimento para corredores', sessionType: 'forca',
    notes: 'Execute com boa técnica e sem dor. Pare se sentir dor articular.',
    prescription: builders.strengthPrescription(35, { modality: 'fortalecimento_corredores', exerciseIds: runnerIds, sets: 3, reps: '10-12', restSeconds: 60, intensity: 'Moderada', notes: '' }),
    outcome: 'done',
  });
  drafts.push({
    offset: 1, modality: 'corrida', title: 'Corrida', sessionType: 'continuo',
    notes: 'Ritmo confortável, em que você consegue conversar durante todo o treino.',
    prescription: builders.runPrescription(45, 'corrida', { parts: [continua(easyKm, 400, 430)] }),
    outcome: 'done',
  });
  drafts.push({
    offset: 3, modality: 'corrida', title: 'Corrida', sessionType: 'misto',
    notes: 'Aquecimento leve, tiros em ritmo forte com trote de recuperação e desaquecimento caminhando.',
    prescription: builders.runPrescription(50, 'corrida', { parts: [continua(1.5, 420, 450), intervalada(5, 0.6, 335, 0.4, 470), continua(1, 450, 480)] }),
    outcome: week === 2 ? 'adjusted' : 'done',
  });
  drafts.push({
    offset: 5, modality: 'corrida', title: 'Corrida', sessionType: 'continuo',
    notes: 'Treino longo em ritmo bem tranquilo. Hidrate-se e priorize terminar bem.',
    prescription: builders.runPrescription(70, 'corrida', { parts: [continua(longKm, 410, 440)] }),
    outcome: week === 3 ? 'missed' : 'done',
  });
  return drafts;
}

interface Persona { name: string; sex: 'Feminino' | 'Masculino'; birthDate: Date; heightCm: number; weightKg: number; phone: string }
const PERSONAS: Record<ReviewKind, Persona> = {
  active: { name: 'Aluna Demonstração (assinatura ativa)', sex: 'Feminino', birthDate: new Date('1990-05-15T00:00:00.000Z'), heightCm: 168, weightKg: 62, phone: '+5511900000001' },
  expired: { name: 'Aluno Demonstração (assinatura expirada)', sex: 'Masculino', birthDate: new Date('1988-03-20T00:00:00.000Z'), heightCm: 178, weightKg: 76, phone: '+5511900000002' },
};

function localToday(now: Date): Date {
  const sp = new Date(now.getTime() - 3 * 3_600_000); // America/Sao_Paulo (UTC-3, sem horario de verao)
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()));
}

function pace(distanceKm: number, durationMin: number): number { return Math.round((durationMin * 60) / distanceKm); }

export async function seedReviewAccount(prisma: PrismaClient, spec: ReviewAccountSpec, now = new Date(), options: { resetAccess?: boolean } = {}): Promise<{ userId: string; email: string; kind: ReviewKind; created: boolean }> {
  const email = normalizeReviewEmail(spec.email);
  if (spec.password.length < MIN_REVIEW_PASSWORD_LENGTH) throw new Error(`A senha precisa ter pelo menos ${MIN_REVIEW_PASSWORD_LENGTH} caracteres.`);
  const id = reviewUserId(email);
  const persona = PERSONAS[spec.kind];
  const weekStart = startOfWeek(now);
  const passwordHash = await bcrypt.hash(spec.password, 12);

  const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const byId = await prisma.user.findUnique({ where: { id }, select: { id: true, accountStatus: true } }); // conta excluida pelo revisor: o e-mail foi anonimizado, mas o id continua o mesmo
  const existing = byId ?? byEmail;
  if (byEmail && byEmail.id !== id) throw new Error('Ja existe uma conta com este e-mail que NAO e uma conta de revisao criada por este comando. Nada foi alterado.');

  return prisma.$transaction(async (tx) => {
    const created = !existing;
    // Acesso/assinatura: NUNCA e' revertido por padrao (uma compra Sandbox legitima fica). So' e' (re)definido ao criar, se a conta foi excluida, ou com --reset-access.
    const writeAccess = !existing || byId?.accountStatus === 'deleted' || Boolean(options.resetAccess);
    const access = spec.kind === 'active'
      ? { subscriptionStatus: 'manual_active', subscriptionProvider: 'revenuecat', subscriptionManualOverride: true, subscriptionCancelRequestedAt: null } // provedor 'revenuecat' = o app trata como assinatura da loja ("Gerenciar assinatura na loja", cancelamento recusado no servidor); o override manual impede qualquer reconciliacao de revogar
      : { subscriptionStatus: 'canceled', subscriptionProvider: 'revenuecat', subscriptionManualOverride: false, subscriptionCancelRequestedAt: null };
    const base = {
      email, passwordHash, name: persona.name, phone: persona.phone, birthDate: persona.birthDate, sex: persona.sex, heightCm: persona.heightCm, weightKg: persona.weightKg,
      role: 'student', accountStatus: 'active', refreshTokenHash: null, expoPushToken: null,
      acceptedTermsAt: now, acceptedPrivacyAt: now, acceptedTermsVersion: LEGAL_VERSION, acceptedPrivacyVersion: LEGAL_VERSION, acceptedExerciseResponsibilityAt: now,
      lastRoutineChangeAt: addDays(weekStart, -21),
      generationWeekStart: null, generationAttemptsUsed: 0, generationExtraAttempts: 0, lastGenerationAttemptAt: null, generationExhaustedAlertSent: false,
      ...(writeAccess ? { ...access, subscriptionUpdatedAt: now } : {}),
    };
    if (existing) await tx.user.update({ where: { id }, data: base });
    else await tx.user.create({ data: { id, ...base } });
    const current = await tx.user.findUniqueOrThrow({ where: { id }, select: { studentCode: true } });
    if (current.studentCode == null) {
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('"User_studentCode_seq"') AS nextval`;
      await tx.user.update({ where: { id }, data: { studentCode: Number(rows[0].nextval) } });
    }

    await applyContent(tx, id, spec.kind, now);
    if (writeAccess) {
      await tx.billingSubscription.deleteMany({ where: { userId: id } });
      if (spec.kind === 'expired') await tx.billingSubscription.create({ data: { userId: id, provider: 'revenuecat', providerStatus: 'expired', firstPaidAt: addDays(weekStart, -75) } });
    }
    return { userId: id, email, kind: spec.kind, created };
  }, { timeout: 60_000, maxWait: 15_000 });
}

// Cria UMA semana de programa (plano + sessoes + execucoes das datas que ja passaram). `week`: 0 = semana corrente, 1..4 = passadas (so' muda o volume).
async function createWeekPlan(tx: Prisma.TransactionClient, id: string, start: Date, week: number, today: Date): Promise<void> {
  const drafts = buildWeekDrafts(week);
  const plan = await tx.trainingPlan.create({
    data: {
      userId: id, name: week === 0 ? 'Programa da semana' : `Programa da semana ${start.toISOString().slice(0, 10)}`, goal: 'Correr 10 km com conforto',
      status: week === 0 ? 'active' : 'archived', startDate: start, endDate: addDays(start, 6), generatedBy: 'agent', createdAt: addDays(start, -1),
      inputSnapshot: { source: 'app-review-demo', synthetic: true } as Prisma.InputJsonObject,
      aiRecommendation: 'Programa de demonstração com dados sintéticos: mantenha a regularidade e respeite os dias de descanso.',
    },
  });
  for (const draft of drafts) {
    const scheduledDate = addDays(start, draft.offset);
    const isRun = draft.modality === 'corrida';
    const prescription = draft.prescription as { durationMin: number | null; distanceKm?: number | null; representativePaceSecondsPerKm?: number | null };
    const session = await tx.trainingSession.create({
      data: {
        planId: plan.id, userId: id, scheduledDate, weekday: scheduledDate.getUTCDay(), modality: draft.modality, title: draft.title, sessionType: draft.sessionType,
        locationSuggestion: 'Livre', durationMin: prescription.durationMin ?? undefined, distanceKm: prescription.distanceKm ?? undefined,
        paceMinSec: isRun && prescription.representativePaceSecondsPerKm != null ? `${Math.floor(prescription.representativePaceSecondsPerKm / 60)}:${String(prescription.representativePaceSecondsPerKm % 60).padStart(2, '0')}` : null,
        structure: draft.prescription as unknown as Prisma.InputJsonObject, notes: draft.notes, videoRefs: [], origin: 'agent',
      },
    });
    // so' executa o que ja passou (dia anterior a hoje); hoje e o futuro ficam como "a fazer"
    if (scheduledDate.getTime() >= today.getTime()) continue;
    const plannedMin = prescription.durationMin ?? 40;
    const plannedKm = prescription.distanceKm ?? null;
    const missed = draft.outcome === 'missed';
    const adjusted = draft.outcome === 'adjusted';
    const durationMin = missed ? null : Math.round(plannedMin * (adjusted ? 0.85 : 1.02));
    const distanceKm = missed || plannedKm == null ? null : Number((plannedKm * (adjusted ? 0.85 : 1.01)).toFixed(2));
    await tx.workoutCompletion.create({
      data: {
        userId: id, sessionId: session.id, status: draft.outcome, completedAt: new Date(scheduledDate.getTime() + 11 * 3_600_000),
        durationMin, distanceKm, avgPaceSecondsKm: durationMin && distanceKm ? pace(distanceKm, durationMin) : null,
        avgHeartRate: isRun && !missed ? 150 + week : null, maxHeartRate: isRun && !missed ? 172 : null,
        perceivedEffort: missed ? null : 5 + (draft.sessionType === 'misto' ? 2 : 0), painFlag: 'none',
        satisfactionElaboracao: missed ? null : 'gostei', satisfactionCapacidade: missed ? null : (adjusted ? 'neutro' : 'amei'),
        preSleepQuality: missed ? null : 4, prePhysicalFatigue: missed ? null : 2, preStressLevel: missed ? null : 2, preMotivation: missed ? null : 4, postWorkoutFeeling: missed ? null : 4,
      },
    });
  }
}

// Virada de semana: SO' acrescenta a semana corrente (arquiva o programa ativo anterior). Nunca apaga execucao, feedback, dor nem qualquer registro feito na conta.
async function rollWeekForward(tx: Prisma.TransactionClient, id: string, now: Date): Promise<void> {
  const weekStart = startOfWeek(now);
  const sameWeek = await tx.trainingPlan.findFirst({ where: { userId: id, startDate: weekStart }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  await tx.trainingPlan.updateMany({ where: { userId: id, status: 'active' }, data: { status: 'archived' } });
  if (sameWeek) { await tx.trainingPlan.update({ where: { id: sameWeek.id }, data: { status: 'active' } }); return; }
  await createWeekPlan(tx, id, weekStart, 0, localToday(now));
}

// Conteudo sintetico (tudo, MENOS acesso/assinatura/senha). Usado pelo seed e pela renovacao automatica diaria.
async function applyContent(tx: Prisma.TransactionClient, id: string, kind: ReviewKind, now: Date): Promise<void> {
  const persona = PERSONAS[kind];
  const today = localToday(now);
  const weekStart = startOfWeek(now);
  await wipeOwnedData(tx, id);
    await tx.healthProfile.create({ data: { userId: id, systolic: 118, diastolic: 76, diabetes: false, previousInjuries: 'Nenhuma lesão relevante.', healthProblems: 'Nenhum.', medications: 'Nenhum.', averageSleep: '7 a 8 horas', stressLevel: 'Moderado', anxietyLevel: 'Baixo' } });
    await tx.userPreferences.create({ data: { userId: id, preferredModalities: ['corrida', 'fortalecimento_corredores'], otherModalities: [], trainingLocations: ['Rua', 'Parque'], mainGoal: 'Correr 10 km com conforto', experienceLevel: 'iniciante_intermediario' } });
    const routine = [
      { weekday: 1, modalities: ['fortalecimento_corredores'], availableMin: 40 }, { weekday: 2, modalities: ['corrida'], availableMin: 50 },
      { weekday: 4, modalities: ['corrida'], availableMin: 60 }, { weekday: 6, modalities: ['corrida'], availableMin: 80 },
    ];
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const day = routine.find((item) => item.weekday === weekday);
      await tx.weeklyAvailability.create({ data: { userId: id, weekday, noTraining: !day, modalities: day?.modalities ?? [], availableMin: day?.availableMin ?? 0, modalityDurations: day ? { [day.modalities[0]]: day.availableMin } : {} } });
    }
    await tx.fitnessTest.create({ data: { userId: id, testType: '3km', totalSeconds: 1080, avgHeartRate: 172, maxHeartRate: 184, environment: 'Rua', vo2maxEstimated: 46.5, vvo2Kmh: 14.1, paceSecondsPerKm: 360, notes: 'Teste sintético de demonstração.', createdAt: addDays(weekStart, -35) } });
    await tx.onboardingInterview.create({
      data: {
        userId: id, currentStep: 0, interviewVersion: 1, quickIntakeCompletedAt: addDays(weekStart, -40), completedAt: addDays(weekStart, -38),
        answers: { review_demo_kind: kind, personal_name: persona.name, personal_sex: persona.sex, personal_height: persona.heightCm, personal_weight: persona.weightKg, main_goal: 'Correr 10 km com conforto', experience_level: 'iniciante_intermediario' },
      },
    });

    for (let week = 4; week >= 0; week -= 1) await createWeekPlan(tx, id, addDays(weekStart, -7 * week), week, today);

    await tx.shoe.create({ data: { userId: id, brand: 'ASICS', model: 'Novablast 5', nickname: 'Tênis de treino', startedUsingAt: addDays(weekStart, -60), status: 'active' } });
    await tx.targetRace.create({ data: { userId: id, name: 'Corrida de 10 km (demonstração)', raceDate: addDays(weekStart, 70), distanceKm: 10, targetSeconds: 3600, priority: 'principal', status: 'em_andamento', isFirstTimeAtDistance: true } });
    await tx.userNotification.create({ data: { userId: id, title: 'Bem-vinda ao Panzeri Run', message: 'Seu programa de treino da semana está disponível na aba Semana.', type: 'info' } });
    if (kind === 'active') {
      await tx.menstrualProfile.create({ data: { userId: id, hasActiveCycle: true, usesHormonalContraceptive: false, cycleLengthDays: 28, periodLengthDays: 5, cycleRegularity: 'regular', diuType: 'none', menopauseStatus: 'none' } });
    }
}

// Apaga SO' o que pertence a esta conta de revisao (id deterministico). Qualquer vinculo inesperado faz a transacao inteira falhar e nada muda.
async function wipeOwnedData(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.shoeUsage.deleteMany({ where: { shoe: { userId } } });
  await tx.shoeEvent.deleteMany({ where: { shoe: { userId } } });
  await tx.shoePhoto.deleteMany({ where: { userId } });
  await tx.workoutCompletion.deleteMany({ where: { userId } });
  await tx.shoe.deleteMany({ where: { userId } });
  await tx.weeklyCheckIn.deleteMany({ where: { plan: { userId } } });
  await tx.trainingSession.deleteMany({ where: { userId } });
  await tx.trainingPlan.deleteMany({ where: { userId } });
  await tx.targetRace.deleteMany({ where: { userId } });
  await tx.fitnessTest.deleteMany({ where: { userId } });
  await tx.weeklyRoutineChange.deleteMany({ where: { userId } });
  await tx.weeklyRoutineState.deleteMany({ where: { userId } });
  await tx.weeklyAvailability.deleteMany({ where: { userId } });
  await tx.healthProfile.deleteMany({ where: { userId } });
  await tx.userPreferences.deleteMany({ where: { userId } });
  await tx.onboardingInterview.deleteMany({ where: { userId } });
  await tx.menstrualCycleLog.deleteMany({ where: { userId } });
  await tx.menstrualDailyLog.deleteMany({ where: { userId } });
  await tx.menstrualProfile.deleteMany({ where: { userId } });
  await tx.userNotification.deleteMany({ where: { userId } });
}

export async function reviewAccountStatus(prisma: PrismaClient, emails: string[], now = new Date()) {
  const rows = [];
  const weekStart = startOfWeek(now);
  for (const raw of emails) {
    const email = normalizeReviewEmail(raw);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, subscriptionStatus: true, subscriptionProvider: true, accountStatus: true, studentCode: true } });
    if (!user) { rows.push({ email, exists: false }); continue; }
    const [plans, sessions, completions, currentPlan] = await Promise.all([
      prisma.trainingPlan.count({ where: { userId: user.id } }), prisma.trainingSession.count({ where: { userId: user.id } }),
      prisma.workoutCompletion.count({ where: { userId: user.id } }),
      prisma.trainingPlan.findFirst({ where: { userId: user.id, status: 'active', startDate: { in: [weekStart, addDays(weekStart, 7)] } }, select: { id: true } }),
    ]);
    rows.push({ email, exists: true, isReviewAccount: user.id === reviewUserId(email), status: user.subscriptionStatus, provider: user.subscriptionProvider, accountStatus: user.accountStatus, plans, sessions, completions, hasCurrentWeekPlan: Boolean(currentPlan) });
  }
  return rows;
}

// Renovacao automatica (diaria): quando a semana vira e a conta de demonstracao fica sem programa na semana corrente, a semana nova e' ACRESCENTADA (nada e' apagado: feedbacks do revisor ficam). Nunca toca em senha,
// assinatura, provedor, override nem cobranca (uma compra Sandbox legitima fica). So' age em contas criadas por este modulo (e-mail `revisao-apple-*` + id derivado + marca na entrevista).
export async function refreshReviewContent(prisma: PrismaClient, now = new Date()): Promise<{ checked: number; refreshed: number }> {
  const weekStart = startOfWeek(now);
  const users = await prisma.user.findMany({
    where: { email: { startsWith: REVIEW_EMAIL_PREFIX }, role: 'student', accountStatus: 'active' },
    select: { id: true, email: true, onboardingInterview: { select: { answers: true } } },
  });
  let checked = 0;
  let refreshed = 0;
  for (const user of users) {
    const kind = (user.onboardingInterview?.answers as { review_demo_kind?: string } | null | undefined)?.review_demo_kind;
    if ((kind !== 'active' && kind !== 'expired') || user.id !== reviewUserId(user.email)) continue;
    checked += 1;
    const hasCurrent = await prisma.trainingPlan.findFirst({ where: { userId: user.id, status: 'active', startDate: { in: [weekStart, addDays(weekStart, 7)] } }, select: { id: true } });
    if (hasCurrent) continue;
    await prisma.$transaction((tx) => rollWeekForward(tx, user.id, now), { timeout: 60_000, maxWait: 15_000 });
    refreshed += 1;
  }
  return { checked, refreshed };
}
