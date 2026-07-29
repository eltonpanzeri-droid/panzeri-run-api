import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runnerStrengthExercises } from './runner-strength-library';
import { gymExerciseLibrary } from './gym-exercise-library';
import {
  MethodologyInput,
  StrengthSessionDecision,
  WeeklyMethodologyDecision,
  IntervalStructureDecision,
  WalkRunStructureDecision,
  PANZERI_METHODOLOGY_VERSION,
  PANZERI_PRESCRIPTION_PRINCIPLES,
  sanitizeInterviewAnswers,
  parseMmSsToSeconds,
  isCurrentlyRunning,
} from './training-methodology';
import { PrescriptionAgentService, PaceEvidence } from './prescription-agent.service';
import { StravaAnalysisAgentService, StravaAnalysisReport } from './strava-analysis-agent.service';
import { PainReportsService } from '../pain-reports/pain-reports.service';
import { TargetRacesService } from '../target-races/target-races.service';
import { StravaService } from '../strava/strava.service';
import { TelegramService } from '../billing/telegram.service';

interface SessionTemplate {
  title: string;
  modality: string;
  sessionType: string;
  zone: string;
  durationMin: number;
  notes: string;
  recommendations?: string;
}

interface RunStep {
  label: string;
  durationMin: number;
  durationMinLower: number;
  durationMinUpper: number;
  durationRange: string;
  durationType: string;
  distanceValue: number;
  distanceUnit: string;
  paceRange?: string | null;
  speedRange?: string | null;
  guidance?: string;
}

interface RunBlock extends Partial<RunStep> {
  label: string;
  repeatCount?: number;
  steps?: RunStep[];
}

interface WeeklyAvailabilityInput {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin?: number | null;
  modalityDurations?: Record<string, number>;
}

const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
const planEngineVersion = 'rules-v11-' + PANZERI_METHODOLOGY_VERSION;

// Disjuntor contra gasto em loop: current() e chamado toda vez que ALGUEM SO ABRE a pagina do
// aluno (painel do treinador ou app da aluna) — nao e uma acao explicita de "gerar treino". Se a
// geracao com IA falhar (bug, cota, instabilidade), o plano fica desatualizado pra sempre e
// current() tenta gerar de novo TODA vez que a pagina e reaberta, sem limite nenhum. Na pratica
// isso ja causou um gasto real e repetido so de reabrir a pagina de um aluno com problema
// enquanto o proprio bug estava sendo investigado — cada reabertura custava uma chamada cara ao
// Opus, com 2 tentativas internas, e falhava de novo. Este cooldown garante que, apos uma falha,
// o sistema espera antes de tentar de novo automaticamente, em vez de gastar a cada visualizacao.
// Cadencia padrao da analise do Strava (ver refreshStravaAnalysis) — o treinador pode pedir uma
// frequencia diferente pra um aluno especifico (StravaAnalysisCache.customFrequencyDays).
const DEFAULT_STRAVA_ANALYSIS_FREQUENCY_DAYS = 30;
const AI_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const PAIN_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class TrainingPlansService {
  private readonly logger = new Logger(TrainingPlansService.name);
  private readonly recentAiFailures = new Map<string, number>();
  private readonly recentPainAlerts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly prescriptionAgent: PrescriptionAgentService,
    private readonly stravaAnalysisAgent: StravaAnalysisAgentService,
    private readonly painReports: PainReportsService,
    private readonly targetRaces: TargetRacesService,
    private readonly stravaService: StravaService,
    private readonly telegram: TelegramService,
  ) {}

  // REGRA DURA (2026-07-28): current() e SO LEITURA — nunca chama generateWeek() nem mexe no
  // banco. E chamado toda vez que o aluno abre o app E toda vez que o treinador abre a pagina
  // do aluno no painel; antes disso tinha um "auto-heal" aqui que podia disparar uma geracao de
  // IA inteira so por alguem ter ABERTO uma tela pra olhar — isso gastava tokens sem necessidade
  // (as vezes repetidas vezes seguidas, cada reabertura de pagina) e, se a geracao falhasse,
  // podia derrubar a tela inteira. A logica de deteccao que existia aqui foi extraida para
  // checkPlanFreshness() — so LEITURA, nenhuma geracao — chamada pelo painel do treinador
  // (CoachService.student()) pra mostrar quando um aluno precisa de atualizacao. NENHUM cron
  // roda isso sozinho (pedido explicito do treinador: nada de rotina automatica gastando
  // recursos so pra "talvez" regenerar algo). Qualquer acao que realmente PRECISE gerar um
  // treino novo na hora (concluir entrevista, mudar rotina, sincronizar disponibilidade) chama
  // generateWeek() explicitamente no proprio ponto da acao — nunca depende deste metodo.
  async current(userId: string) {
    const weekStart = startOfWeek(new Date());
    const [plan, latestTest, user, onboarding] = await Promise.all([
      this.prisma.trainingPlan.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        include: {
          sessions: {
            orderBy: { scheduledDate: 'asc' },
            include: { completion: true },
          },
        },
      }),
      this.prisma.fitnessTest.findFirst({
        where: { userId, testType: '3km' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { subscriptionStatus: true } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
    ]);

    if (!onboarding?.completedAt) return onboardingRequiredPlan(hasSubscriptionAccess(user.subscriptionStatus));

    if (!plan) {
      return { notGenerated: true, startDate: weekStart, endDate: addDays(weekStart, 6) };
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
  }

  // Deteccao pura (nenhuma escrita, nenhuma chamada de IA) — substitui o antigo auto-heal
  // automatico. O treinador pediu explicitamente para NAO ter uma rotina automatica regenerando
  // planos sozinha (mesmo so a cada X horas, ja seria um gasto de recursos sem necessidade real);
  // em vez disso, esta funcao so INFORMA se um aluno precisa de atualizacao, e quem decide gerar
  // e sempre uma acao explicita (o botao "Refazer nova semana" do treinador, ou um dos gatilhos
  // explicitos ja existentes: concluir entrevista, mudar rotina, sincronizar disponibilidade).
  // Chamada a partir de current() (leitura normal do aluno/painel) — como isso ja acontece toda
  // vez que alguem abre uma tela, nao precisa de nenhum cron rodando sozinho por tras.
  async checkPlanFreshness(userId: string): Promise<{ needsUpdate: boolean; reason: string | null }> {
    const weekStart = startOfWeek(new Date());
    const [plan, availability, latestTest, onboarding] = await Promise.all([
      this.prisma.trainingPlan.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.weeklyAvailability.findMany({
        where: { userId, noTraining: false },
        orderBy: { weekday: 'asc' },
      }),
      this.prisma.fitnessTest.findFirst({
        where: { userId, testType: '3km' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
    ]);

    if (!onboarding?.completedAt) return { needsUpdate: false, reason: null };
    if (!plan) return { needsUpdate: true, reason: 'Nenhum plano ativo para a semana atual.' };

    const currentPainSafety = await this.painReports.computeSafetyTier(userId);
    const painTierElevated = planPainTierIsStale(plan.inputSnapshot, currentPainSafety.tier);

    if (painTierElevated) {
      // Continua avisando o treinador na hora (por Telegram), mas so uma vez a cada 12h por
      // aluno — sem isso, toda vez que o aluno (ou o proprio treinador) abrisse a tela o alerta
      // repetiria, ja que a condicao persiste ate alguem clicar em regenerar.
      const lastAlertAt = this.recentPainAlerts.get(userId);
      if (!lastAlertAt || Date.now() - lastAlertAt > PAIN_ALERT_COOLDOWN_MS) {
        this.recentPainAlerts.set(userId, Date.now());
        this.logger.warn(`Nivel de cautela por dor elevado para o aluno ${userId}.`);
        await this.telegram.notifyCoach(
          `⚠️ Novo relato de dor no Panzeri Run elevou o nivel de cautela de um aluno (id ${userId}).\nMotivo: ${currentPainSafety.reason ?? 'sem detalhe'}\nO plano desta semana precisa ser regenerado pelo painel para refletir isso.`,
        );
      }
      return { needsUpdate: true, reason: `Nivel de cautela por dor elevado: ${currentPainSafety.reason ?? 'sem detalhe'}` };
    }
    if (plan.generatedBy !== planEngineVersion) return { needsUpdate: true, reason: 'Plano gerado por uma versao antiga do motor de decisao.' };
    if (plan.startDate.getTime() !== weekStart.getTime()) return { needsUpdate: true, reason: 'Plano ativo nao e da semana atual.' };
    if (!planMatchesLatestTest(plan.inputSnapshot, latestTest?.id ?? null)) return { needsUpdate: true, reason: 'Ha um teste de 3km mais recente do que o usado no plano.' };
    if (!planMatchesAvailability(plan.inputSnapshot, availability)) return { needsUpdate: true, reason: 'A disponibilidade real do aluno mudou desde a ultima geracao.' };
    return { needsUpdate: false, reason: null };
  }

  // Navegacao Anterior/Proxima da aluna na tela de semana (pedido do treinador, espelhando o
  // Sisrun). offset 0 e sempre a semana atual (usa a mesma logica de current(), com geracao
  // sob demanda). offsets negativos sao semanas passadas — sempre existem no banco (nunca sao
  // apagadas, so viram "archived"), entao aqui e so leitura, sem gerar nada. offset +1 (unico
  // permitido pra frente) e a semana seguinte: so existe depois da pre-geracao de domingo 19h
  // (ver WeeklyPlanSchedulerService); antes disso retornamos notGenerated para o app mostrar a
  // mensagem de espera, sem inventar prazo fixo de "so aparece entre 19h e 00h" no cliente.
  async getWeekByOffset(userId: string, offset: number) {
    if (offset === 0) return this.current(userId);
    if (!Number.isInteger(offset) || offset > 1 || offset < -52) {
      throw new BadRequestException('Semana invalida.');
    }

    const targetWeekStart = startOfWeek(addDays(new Date(), offset * 7));
    // Para semanas futuras (offset > 0), so um plano "scheduled" (exatamente o que a
    // pre-geracao de domingo 19h cria) conta como a semana seguinte de verdade. Sem esse
    // filtro, um plano "archived" de testes antigos cuja data por coincidencia bate com a
    // semana seguinte de hoje seria mostrado como se fosse a pre-geracao real.
    const planStatusFilter = offset > 0 ? { status: 'scheduled' } : {};
    const [plan, latestTest, user, onboarding] = await Promise.all([
      this.prisma.trainingPlan.findFirst({
        where: { userId, startDate: targetWeekStart, ...planStatusFilter },
        orderBy: { createdAt: 'desc' },
        include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
      }),
      this.prisma.fitnessTest.findFirst({ where: { userId, testType: '3km' }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { subscriptionStatus: true } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
    ]);

    if (!onboarding?.completedAt) return onboardingRequiredPlan(hasSubscriptionAccess(user.subscriptionStatus));
    if (!plan) {
      return {
        notGenerated: true,
        startDate: targetWeekStart,
        endDate: addDays(targetWeekStart, 6),
      };
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
  }

  // options.referenceDate/planStatus/archiveCurrentActive existem so para a pre-geracao da
  // semana SEGUINTE (domingo 19h, ver generateNextWeekIfMissing) — a chamada normal (aluno
  // abrindo o app, treinador regenerando a semana atual) nunca passa isso, e o comportamento
  // fica exatamente igual ao de sempre. options.allowToday e diferente: e o treinador confirmando
  // explicitamente (pelo admin) que quer mesmo alterar o treino de HOJE ao regenerar a semana —
  // sem isso, hoje continua sempre preservado (comportamento padrao, nunca muda sozinho).
  async generateWeek(
    userId: string,
    weeklyOverride?: WeeklyAvailabilityInput[],
    options?: { referenceDate?: Date; planStatus?: string; archiveCurrentActive?: boolean; allowToday?: boolean },
  ) {
    const referenceDate = options?.referenceDate ?? new Date();
    const planStatus = options?.planStatus ?? 'active';
    const archiveCurrentActive = options?.archiveCurrentActive ?? true;

    // Disjuntor: current() (chamado so por ABRIR a pagina do aluno, painel ou app) cai aqui
    // sempre que o plano nao bate com a disponibilidade/teste atual — se a ultima tentativa
    // falhou ha pouco tempo, nao tenta de novo automaticamente (custaria uma chamada cara ao
    // Opus a cada reabertura de pagina, sem nenhum progresso real ate o motivo da falha ser
    // corrigido). Vale tanto para a abertura passiva quanto para o botao explicito de regenerar
    // semana do treinador (os dois chamam generateWeek sem options) — evita tambem cliques
    // repetidos por frustracao durante uma instabilidade. So a pre-geracao automatica de domingo
    // 19h (que passa options.referenceDate) ignora este disjuntor, por rodar so uma vez por semana.
    const lastFailureAt = this.recentAiFailures.get(userId);
    if (lastFailureAt && Date.now() - lastFailureAt < AI_FAILURE_COOLDOWN_MS && !options?.referenceDate) {
      const minutesLeft = Math.ceil((AI_FAILURE_COOLDOWN_MS - (Date.now() - lastFailureAt)) / 60000);
      throw new InternalServerErrorException(
        `A ultima tentativa de gerar o treino deste aluno falhou ha pouco tempo. Para nao gastar chamadas de IA repetidas sem necessidade, aguarde cerca de ${minutesLeft} min antes de tentar de novo, ou peca para o treinador tentar manualmente pelo painel.`,
      );
    }

    // O webhook do Strava ja mantem os treinos do aluno atualizados em tempo real, mas isso e
    // uma rede de seguranca (webhook perdido, assinatura caida, etc): antes de decidir o treino,
    // tenta puxar dados novos do Strava. syncIfStale so faz a chamada de verdade se o ultimo sync
    // tiver mais de alguns minutos, entao isso nao pesa quando ja esta em dia. Qualquer erro aqui
    // e ignorado de proposito — melhor gerar o treino com o que ja temos do que travar por causa
    // de uma falha de sincronizacao.
    await this.stravaService.syncIfStale(userId).catch(() => null);

    const historyStart = addDays(startOfWeek(new Date()), -35);
    const [user, latestTest, availability, onboarding, previousPlans, recentStrava, latestExecutionInsight, activePlanBeforeAdjustment, activeDirectives, painSafety, targetRace, latestReassessment, activeObservations] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          healthProfile: true,
          preferences: true,
        },
      }),
      this.prisma.fitnessTest.findFirst({
        where: { userId, testType: '3km' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.weeklyAvailability.findMany({
        where: { userId, noTraining: false },
        orderBy: { weekday: 'asc' },
      }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true, answers: true } }),
      this.prisma.trainingPlan.findMany({
        where: { userId, startDate: { lt: startOfWeek(new Date()) } },
        orderBy: { startDate: 'desc' },
        take: 4,
        include: { sessions: { include: { completion: true } } },
      }),
      this.prisma.stravaActivity.findMany({
        where: { userId, startDate: { gte: historyStart } },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.trainingExecutionInsight.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { summary: true },
      }),
      this.prisma.trainingPlan.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, startDate: true },
      }),
      this.prisma.studentDirective.findMany({
        where: { userId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      }),
      this.painReports.computeSafetyTier(userId),
      this.targetRaces.currentGoal(userId),
      this.prisma.reassessment.findFirst({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: 'desc' } }),
      this.prisma.studentObservation.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'desc' } }),
    ]);

    if (!onboarding?.completedAt) return onboardingRequiredPlan(hasSubscriptionAccess(user.subscriptionStatus));

    const answers = sanitizeInterviewAnswers(jsonObject(onboarding.answers));
    const paceFallback = estimatePaceFromAnswers(answers);
    const paceSource: 'test' | 'self_report_5k' | 'qualitative' | 'default' = latestTest ? 'test' : paceFallback?.source ?? 'default';

    const initialWeekStart = startOfWeek(referenceDate);
    const adjustedAvailability = weeklyOverride?.filter((day) => !day.noTraining) ?? [];
    const rawAvailableDays =
      adjustedAvailability.length > 0
        ? adjustedAvailability
        : availability.length > 0
        ? availability
        : [
            { weekday: 1, modalities: ['forca'], availableMin: 45 },
            { weekday: 2, modalities: ['corrida'], availableMin: 35 },
            { weekday: 4, modalities: ['corrida'], availableMin: 40 },
            { weekday: 6, modalities: ['corrida'], availableMin: 55 },
          ];
    // Dor intensa relatada recentemente (tier remove_running): a corrida sai da semana mesmo
    // que o aluno tenha escolhido treinar so corrida — seguranca sobrepoe preferencia de
    // modalidade nesse caso. Aplicado AQUI, antes de montar o contexto da IA, para que tanto a
    // decisao de corrida quanto a de forca/fortalecimento que a IA recebe reflitam exatamente os
    // dias/modalidades que de fato serao gerados logo abaixo — nao faz sentido a IA decidir uma
    // corrida para um dia que sera descartado, nem deixar de decidir os exercicios de um dia que
    // so virou forca por causa dessa troca.
    const availableDays = remapAvailabilityForPainSafety(rawAvailableDays, painSafety.tier === 'remove_running');

    const today = todayInSaoPaulo();
    // Primeira geracao (sem plano ativo anterior) de uma aluna que concluiu a entrevista tarde
    // demais na propria semana pra sobrar algum dia disponivel (ex: entrevista concluida num
    // domingo a noite, com rotina que treina so ate sabado) resultaria num plano vazio: todo dia
    // desta semana ja seria passado, e o filtro "so o futuro" logo abaixo removeria a semana
    // inteira. Nesse caso especifico, comeca direto na semana seguinte em vez de entregar um
    // plano sem nenhum treino ate a virada natural de segunda.
    const hasFutureDayThisWeek = availableDays.some(
      (day) => addDays(initialWeekStart, weekdayOffsetFromMonday(day.weekday)).getTime() > today.getTime(),
    );
    const weekStart = !hasFutureDayThisWeek && !activePlanBeforeAdjustment && !options?.referenceDate
      ? addDays(initialWeekStart, 7)
      : initialWeekStart;

    const methodologyHistory = previousPlans.map((historyPlan) => {
      const runSessions = historyPlan.sessions.filter((session) => isRunningModality(session.modality));
      const completedRuns = runSessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted');
      return {
        runMinutes: runSessions.reduce((total, session) => total + (session.durationMin ?? 0), 0),
        completedRunMinutes: completedRuns.reduce((total, session) => total + (session.completion?.durationMin ?? session.durationMin ?? 0), 0),
        longestRunMinutes: Math.max(0, ...completedRuns.map((session) => session.completion?.durationMin ?? session.durationMin ?? 0)),
        prescribedSessions: historyPlan.sessions.length,
        completedSessions: historyPlan.sessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length,
      };
    });
    const stravaRuns = recentStrava.filter((activity) => isStravaRunningActivity(activity.type, activity.name));
    const executionSummary = jsonObject(latestExecutionInsight?.summary);
    const progression = jsonObject(executionSummary.progression);
    // A analise do Strava NAO roda mais aqui — ela tem sua propria cadencia, desacoplada da
    // geracao da semana (mensal por padrao, ou a frequencia customizada do aluno, ou quando o
    // treinador pede manualmente — ver StravaAnalysisSchedulerService e refreshStravaAnalysis).
    // generateWeek() so LE o que ja estiver pronto no cache, nunca dispara uma chamada de IA nova.
    const stravaAnalysisCache = await this.prisma.stravaAnalysisCache.findUnique({ where: { userId } });
    const stravaAnalysis = (stravaAnalysisCache?.analysis as unknown as StravaAnalysisReport | null) ?? null;
    const methodologyInput: MethodologyInput = {
      goal: user.preferences?.mainGoal ?? 'Evoluir com consistencia',
      experience: user.preferences?.experienceLevel ?? '',
      answers,
      availability: availableDays.map((day) => ({
        weekday: day.weekday,
        modalities: day.modalities,
        availableMin: day.availableMin,
        modalityDurations: normalizeModalityDurations('modalityDurations' in day ? day.modalityDurations : undefined),
      })),
      history: methodologyHistory,
      stravaRunMinutes: Math.round(stravaRuns.reduce((total, activity) => total + (activity.movingTimeSec ?? 0), 0) / 60),
      stravaLongestRunMinutes: Math.round(Math.max(0, ...stravaRuns.map((activity) => activity.movingTimeSec ?? 0)) / 60),
      executionInsight: latestExecutionInsight ? {
        adherencePercent: numericValue(executionSummary.adherencePercent),
        executionPercent: numericValue(executionSummary.executionPercent),
        actualKm: numericValue(executionSummary.actualKm),
        actualMinutes: numericValue(executionSummary.actualMinutes),
        distanceChangePercent: nullableNumericValue(progression.distanceChangePercent),
        loadTrend: String(progression.loadTrend ?? 'sem_base_anterior'),
      } : null,
      stravaAnalysis,
      studentDirectives: activeDirectives.map((directive) => directive.content),
      activeObservations: activeObservations.map((observation) => observation.content),
      todayDate: todayInSaoPaulo().toISOString().slice(0, 10),
      weekDates: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        date: addDays(weekStart, weekdayOffsetFromMonday(weekday)).toISOString().slice(0, 10),
      })),
      recentReassessment: latestReassessment ? {
        completedAt: latestReassessment.completedAt!.toISOString(),
        answers: sanitizeInterviewAnswers(jsonObject(latestReassessment.answers)),
        evolutionSummary: latestReassessment.evolutionSummary,
        evolutionWins: Array.isArray(latestReassessment.evolutionWins) ? latestReassessment.evolutionWins as string[] : [],
        evolutionConcerns: Array.isArray(latestReassessment.evolutionConcerns) ? latestReassessment.evolutionConcerns as string[] : [],
      } : null,
      painTier: painSafety.tier,
      painReason: painSafety.reason,
      targetRace: targetRace ? {
        name: targetRace.name,
        raceDate: targetRace.raceDate.toISOString(),
        distanceKm: targetRace.distanceKm,
        paceSecondsPerKm: targetRace.paceSecondsPerKm,
      } : null,
    };
    const stravaPacedRuns = stravaRuns.filter((activity) => (activity.avgPaceSecKm ?? 0) > 0 && (activity.distanceKm ?? 0) >= 1);
    const stravaAveragePaceSecondsPerKm = stravaPacedRuns.length
      ? Math.round(stravaPacedRuns.reduce((total, activity) => total + (activity.avgPaceSecKm ?? 0), 0) / stravaPacedRuns.length)
      : null;
    const paceEvidence: PaceEvidence = {
      testPace: latestTest ? { secondsPerKm: latestTest.paceSecondsPerKm, daysAgo: Math.floor((Date.now() - latestTest.createdAt.getTime()) / 86400000) } : null,
      selfReportedPace: paceFallback ? { secondsPerKm: paceFallback.paceSecondsPerKm, source: paceFallback.source } : null,
      stravaAveragePace: stravaAveragePaceSecondsPerKm ? { secondsPerKm: stravaAveragePaceSecondsPerKm, sampleRuns: stravaPacedRuns.length } : null,
    };
    const aiDecision = await this.prescriptionAgent.proposeWeeklyDecision(methodologyInput, paceEvidence);
    if (!aiDecision) {
      // O treinador foi explicito: a prescricao TEM que vir de raciocinio real da IA, nunca de
      // um motor de regras fixas — o motor antigo nao lia diretiva nenhuma nem pace especifico e
      // sempre prescrevia quase a mesma coisa, o que ele classificou como inaceitavel para alunas
      // ativas. Por isso, se a IA falhar mesmo apos as tentativas internas, NAO geramos um plano
      // com regra fixa: preferimos deixar o plano atual intacto e alertar o treinador na hora,
      // para ele intervir manualmente, em vez de dar ao aluno um treino ruim silenciosamente.
      this.logger.error(`Falha ao gerar semana de treino com IA para o aluno ${userId} apos tentativas — nenhum plano de regra fixa sera usado no lugar.`);
      this.recentAiFailures.set(userId, Date.now());
      await this.telegram.notifyCoach(
        `⚠️ Falha ao gerar treino com IA para um aluno (id ${userId}). O plano NAO foi atualizado — verifique a chave da IA (ANTHROPIC_API_KEY) e os logs do EasyPanel, e gere novamente manualmente pelo painel. Novas tentativas automaticas para este aluno ficam pausadas por alguns minutos para nao gastar chamadas de IA repetidas.`,
      );
      throw new InternalServerErrorException('Nao foi possivel gerar o treino com o agente de IA no momento. O treinador ja foi avisado.');
    }
    this.recentAiFailures.delete(userId);
    const methodology = aiDecision;

    const sessions = availableDays.slice(0, 7).flatMap((day) => {
      const scheduledDate = addDays(weekStart, weekdayOffsetFromMonday(day.weekday));
      const modalities = day.modalities.length ? day.modalities : ['corrida'];

      return modalities.map((modality) => {
        const baseTemplate = this.templateForModality(modality, Boolean(latestTest));
        const runDecision = isRunningModality(modality) ? methodology.sessions.find((decision) => decision.weekday === day.weekday) : undefined;
        const strengthDecision = (modality === 'forca' || modality === 'fortalecimento_corredores')
          ? methodology.strengthSessions?.find((decision) => decision.weekday === day.weekday && decision.modality === modality)
          : undefined;
        const template = runDecision ? {
          ...baseTemplate,
          title: runDecision.title,
          sessionType: runDecision.sessionType,
          durationMin: runDecision.durationMin,
          notes: runDecision.notes,
          recommendations: runDecision.recommendations,
        } : baseTemplate;
        const modalityDurations = normalizeModalityDurations('modalityDurations' in day ? day.modalityDurations : undefined);
        const requestedDuration = modalityDurations?.[modality] ?? day.availableMin ?? template.durationMin;
        // O agente de IA (validateSessions em prescription-agent.service.ts) ja garante que
        // runDecision.durationMin so ultrapassa a disponibilidade normal do dia quando a propria
        // IA citou, para ESSE dia especifico, qual diretriz autoriza isso (durationJustification) —
        // entao aqui basta confiar no valor ja validado, sem checar de novo se existe "alguma"
        // diretriz ativa (checagem antiga que liberava o teto pra TODOS os dias so por existir
        // qualquer diretriz, mesmo sem relacao com aquele dia especifico — removida).
        const durationMin = runDecision ? runDecision.durationMin : Math.min(requestedDuration, template.durationMin);
        const isStrength = modality === 'forca' || modality === 'fortalecimento_corredores';
        const isAerobic = modality === 'bike';
        if (isStrength && !strengthDecision) {
          // A validacao do agente de IA (validateStrengthSessions) exige cobertura exata dos
          // dias de forca/fortalecimento — chegar aqui sem decisao e um bug de sincronizacao
          // entre a disponibilidade usada no prompt e a usada aqui, nao um caso esperado.
          throw new InternalServerErrorException(`Decisao de forca ausente do agente de IA para o dia ${day.weekday} (${modality}).`);
        }
        const prescription =
          strengthDecision
            ? this.strengthPrescription(durationMin, strengthDecision)
            : modality === 'bike'
            ? this.aerobicPrescription(durationMin, modality)
            // Distancia e pace vem inteiramente da decisao da IA para ESTE dia (runDecision) —
            // nao existe mais nenhuma conta de codigo (duracao/pace fixo) decidindo isso.
            : this.runPrescription(durationMin, modality, template.sessionType, {
                distanceKm: runDecision?.distanceKm ?? null,
                paceSecondsPerKm: runDecision?.paceSecondsPerKm ?? null,
                intervalStructure: runDecision?.intervalStructure,
                walkRunStructure: runDecision?.walkRunStructure,
              });

        return {
          userId,
          scheduledDate,
          weekday: day.weekday,
          modality,
          title: isRunningModality(modality) ? 'Treino de corrida' : template.title,
          sessionType: template.sessionType,
          locationSuggestion: 'Livre',
          // Usa a duracao calculada pela propria prescricao (que agora reflete o tempo REAL da
          // estrutura montada), nao o numero decidido antes de montar os blocos — pra corrida com
          // intervalos/caminhada, os dois podiam divergir (ver correcao em runPrescription acima).
          durationMin: prescription.durationMin ?? durationMin,
          distanceKm: prescription.distanceKm,
          // Zona (Base/Z2/Z4) nao e mais uma informacao que o aluno/treinador precisam ver — o
          // pace/distancia real de cada sessao ja veio da decisao contextual da IA, nao de um
          // rotulo de zona (ver [[no_math_rules_for_workout_calc]] atualizado).
          intensityZone: null,
          paceMinSec: !isStrength && !isAerobic && prescription.representativePaceSecondsPerKm != null
            ? formatPace(prescription.representativePaceSecondsPerKm)
            : null,
          structure: prescription as unknown as Prisma.InputJsonObject,
          notes: template.notes,
          recommendations: isRunningModality(modality) ? template.recommendations ?? null : null,
          videoRefs: [],
        };
      });
    });

    if (archiveCurrentActive) {
      await this.prisma.trainingPlan.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'archived' },
      });
    }

    // REGRA EXPLICITA DO TREINADOR: nunca criar sessao com data de hoje ou de um dia que ja
    // passou — nem ao regenerar a semana de um aluno em andamento, nem na primeira geracao de
    // um aluno novo que se cadastrou no meio da semana (ex: entrevista concluida numa
    // quinta-feira, com dias disponiveis na segunda/terca). Antes, so filtravamos "so o futuro"
    // quando ja existia um plano ativo pra esta semana (regeneracao) — na primeira geracao esses
    // dias passados eram mantidos, o que criava sessoes "perdidas" antes mesmo do aluno existir
    // no sistema, aparecendo como baixa aderencia no painel do treinador sem o aluno ter culpa
    // nenhuma. O rollover para a semana seguinte (acima) ja cobre o caso de nao sobrar dia
    // nenhum nesta semana; aqui so filtramos os dias que ficaram no passado dentro da semana
    // escolhida.
    const sessionsToCreate = sessions.filter((session) =>
      session.scheduledDate.getTime() > today.getTime() ||
      (Boolean(options?.allowToday) && session.scheduledDate.getTime() === today.getTime()),
    );
    const plan = await this.prisma.trainingPlan.create({
      data: {
        userId,
        name: 'Plano semanal',
        goal: user.preferences?.mainGoal ?? 'Evoluir com consistencia',
        status: planStatus,
        startDate: weekStart,
        endDate: addDays(weekStart, 6),
        generatedBy: planEngineVersion,
        aiRecommendation: composeRecommendation(paceSource, methodology.recommendation, painSafety.tier === 'remove_running'),
        inputSnapshot: toInputJson({
          user: {
            heightCm: user.heightCm,
            weightKg: user.weightKg,
            sleep: user.healthProfile?.averageSleep,
            stress: user.healthProfile?.stressLevel,
          },
          latestTestId: latestTest?.id,
          paceSource,
          paceEvidence,
          painTier: painSafety.tier,
          painReason: painSafety.reason,
          targetRace: methodologyInput.targetRace,
          methodology: {
            version: PANZERI_METHODOLOGY_VERSION,
            principles: PANZERI_PRESCRIPTION_PRINCIPLES,
            rationale: methodology.rationale,
            safetyAdjustment: methodology.safetyAdjustment,
            decisionSource: methodology.source,
            history: methodologyHistory,
            stravaRunMinutes: Math.round(stravaRuns.reduce((total, activity) => total + (activity.movingTimeSec ?? 0), 0) / 60),
            analysisAgent: latestExecutionInsight ? executionSummary : null,
            stravaAnalysis,
            studentDirectives: activeDirectives.map((directive) => directive.content),
            decisionDateTime: saoPauloDateTime(new Date()),
          },
          weeklyOverrideUsed: adjustedAvailability.length > 0,
          availabilityDays: availableDays.map((day) => ({
            weekday: day.weekday,
            modalities: day.modalities,
            availableMin: day.availableMin,
            modalityDurations: normalizeModalityDurations('modalityDurations' in day ? day.modalityDurations : undefined),
          })),
        }),
        sessions: {
          create: sessionsToCreate,
        },
      },
      include: {
        sessions: {
          orderBy: { scheduledDate: 'asc' },
          include: { completion: true },
        },
      },
    });

    // Avisa o aluno so quando um plano de verdade vira a semana ATIVA dele (nunca na
    // pre-geracao "scheduled" de domingo, que ja tem seu proprio aviso — ver Sunday-19h
    // notice no app). E so um INSERT no banco, sem nenhuma chamada de IA — nao tem custo de
    // token nenhum gerar este aviso.
    if (planStatus === 'active') {
      await this.prisma.userNotification.create({
        data: {
          userId,
          title: 'Novo treino gerado',
          message: 'Seu programa de treino desta semana foi atualizado automaticamente.',
          type: 'info',
        },
      });
    }

    if (activePlanBeforeAdjustment) {
      // Hoje e os dias que ja passaram nunca podem ser reescritos ao gerar uma nova semana —
      // o que o aluno ja fez (ou nao fez) fica registrado no plano anterior, so migramos essas
      // sessoes (com seus registros de execucao) para o plano novo para que continuem
      // aparecendo normalmente na semana atual.
      await this.prisma.trainingSession.updateMany({
        where: {
          planId: activePlanBeforeAdjustment.id,
          scheduledDate: { gte: weekStart, lte: today },
        },
        data: { planId: plan.id },
      });
      const adjustedPlan = await this.prisma.trainingPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: { sessions: { orderBy: { scheduledDate: 'asc' }, include: { completion: true } } },
      });
      return this.presentPlan(adjustedPlan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
  }

  // Chamado todo domingo 19h (ver WeeklyPlanSchedulerService) para deixar a semana seguinte
  // pronta com antecedencia — muitas alunas se organizam no domingo para treinar ja segunda de
  // manha. Gera com status "scheduled" (nunca "active") e NUNCA arquiva o plano da semana atual,
  // que ainda esta em andamento. Quando a semana seguinte realmente comecar, `current()` promove
  // esse plano "scheduled" para "active" em vez de gerar tudo de novo do zero (ver metodo current).
  async generateNextWeekIfMissing(userId: string) {
    const nextWeekStart = startOfWeek(addDays(new Date(), 7));
    const existing = await this.prisma.trainingPlan.findFirst({
      where: { userId, startDate: nextWeekStart },
      select: { id: true },
    });
    if (existing) return;

    await this.generateWeek(userId, undefined, {
      referenceDate: addDays(new Date(), 7),
      planStatus: 'scheduled',
      archiveCurrentActive: false,
    });
  }

  // Analise do historico do Strava (cadencia, FC, padroes) — desacoplada de generateWeek() de
  // proposito (ver comentario la): ela tem sua propria cadencia, nao a da geracao de treino.
  // Chamada por: StravaAnalysisSchedulerService (mensal, por padrao, ou a frequencia customizada
  // do aluno), o botao "Gerar relatorio do Strava agora" do treinador (force: true), e o Gerente
  // Tecnico so quando muda a frequencia de um aluno (nao chama isso diretamente, so guarda a
  // preferencia — ver setStravaAnalysisFrequency).
  //
  // force=true ignora a data de vencimento (dueForAnalysis) mas AINDA exige atividade nova desde a
  // ultima analise real — nao existe custo de IA sem dado novo pra analisar, mesmo forcado a mao.
  async refreshStravaAnalysis(userId: string, options?: { force?: boolean }): Promise<{ analyzed: boolean; reason: string }> {
    const cache = await this.prisma.stravaAnalysisCache.findUnique({ where: { userId } });
    const frequencyDays = cache?.customFrequencyDays ?? DEFAULT_STRAVA_ANALYSIS_FREQUENCY_DAYS;
    const dueForAnalysis = !cache?.analysis || Date.now() - cache.updatedAt.getTime() >= frequencyDays * 24 * 60 * 60 * 1000;
    if (!options?.force && !dueForAnalysis) {
      return { analyzed: false, reason: `Ainda nao venceu o prazo de analise (a cada ${frequencyDays} dia(s)).` };
    }

    const historyStart = addDays(startOfWeek(new Date()), -35);
    const recentStrava = await this.prisma.stravaActivity.findMany({
      where: { userId, startDate: { gte: historyStart } },
      orderBy: { startDate: 'desc' },
    });
    const latestActivityId = recentStrava[0]?.stravaId ?? null;
    if (!latestActivityId) {
      return { analyzed: false, reason: 'Aluno sem atividades recentes no Strava para analisar.' };
    }
    if (!options?.force && cache?.lastActivityId === latestActivityId) {
      return { analyzed: false, reason: 'Nenhuma atividade nova desde a ultima analise.' };
    }

    const analysis = await this.stravaAnalysisAgent.analyze(recentStrava);
    if (!analysis) {
      return { analyzed: false, reason: 'Falha ao gerar a analise com o agente de IA — tente novamente.' };
    }

    await this.prisma.stravaAnalysisCache.upsert({
      where: { userId },
      create: { userId, lastActivityId: latestActivityId, analysis: analysis as unknown as Prisma.InputJsonObject, customFrequencyDays: cache?.customFrequencyDays ?? null },
      update: { lastActivityId: latestActivityId, analysis: analysis as unknown as Prisma.InputJsonObject },
    });
    return { analyzed: true, reason: 'Analise atualizada com sucesso.' };
  }

  // Chamado pelo Gerente Tecnico quando o treinador pede uma periodicidade especifica para um
  // aluno (ex: "analise o Strava da Fulana a cada 7 dias") — so guarda a preferencia, nao dispara
  // analise nenhuma agora (isso e responsabilidade do cron mensal/botao manual).
  async setStravaAnalysisFrequency(userId: string, frequencyDays: number | null) {
    await this.prisma.stravaAnalysisCache.upsert({
      where: { userId },
      create: { userId, customFrequencyDays: frequencyDays },
      update: { customFrequencyDays: frequencyDays },
    });
  }

  // Corrige alunos afetados pelo bug antigo de regeneracao de semana: antes da correcao, gerar
  // um novo treino sem usar o ajuste de rotina (ex: o botao do treinador) arquivava o plano
  // anterior sem migrar os dias ja passados daquela semana, fazendo treinos ja feitos (com
  // registro de execucao) sumirem da visao atual. Este metodo procura essas sessoes presas em
  // planos arquivados e as devolve ao plano ativo atual, sem duplicar nada.
  async recoverOrphanedSessions(userId: string) {
    const activePlan = await this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!activePlan) {
      throw new BadRequestException('Aluno nao tem plano ativo no momento.');
    }

    const today = todayInSaoPaulo();
    const existingSessions = await this.prisma.trainingSession.findMany({
      where: { planId: activePlan.id },
      select: { scheduledDate: true, modality: true },
    });
    const existingKeys = new Set(existingSessions.map((session) => `${session.scheduledDate.toISOString()}_${session.modality}`));

    const orphanedSessions = await this.prisma.trainingSession.findMany({
      where: {
        plan: { userId, status: 'archived' },
        scheduledDate: { gte: activePlan.startDate, lt: today },
      },
      include: { completion: true },
    });

    const toRecover = orphanedSessions.filter(
      (session) => !existingKeys.has(`${session.scheduledDate.toISOString()}_${session.modality}`),
    );

    if (!toRecover.length) {
      return { recovered: 0 };
    }

    await this.prisma.trainingSession.updateMany({
      where: { id: { in: toRecover.map((session) => session.id) } },
      data: { planId: activePlan.id },
    });

    return { recovered: toRecover.length };
  }

  async regenerateSession(userId: string, sessionId: string, options?: { allowToday?: boolean }) {
    const session = await this.prisma.trainingSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      throw new BadRequestException('Treino nao encontrado para este aluno.');
    }
    const today = todayInSaoPaulo();
    // Dia que ja passou nunca pode ser reescrito, sem excecao. O dia de hoje e diferente: o
    // treinador pode precisar mudar o treino de hoje mesmo (ex: aluno avisou que nao pode fazer o
    // que estava prescrito) — nesse caso o admin pede uma segunda confirmacao explicita e manda
    // allowToday=true, ja que o aluno pode ja estar vendo ou ter comecado o treino atual.
    if (session.scheduledDate.getTime() < today.getTime()) {
      throw new BadRequestException('Nao e possivel gerar um novo treino para um dia que ja passou.');
    }
    if (session.scheduledDate.getTime() === today.getTime() && !options?.allowToday) {
      throw new BadRequestException({
        message: 'Este e o treino de hoje — o aluno pode ja estar vendo ou ate ja ter comecado esse treino. Confirme novamente se quiser mesmo alterar o treino de hoje.',
        code: 'today_session_locked',
      });
    }

    const [user, latestTest, onboarding, activeDirectives, activeObservations, latestReassessment] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { preferences: true } }),
      this.prisma.fitnessTest.findFirst({ where: { userId, testType: '3km' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true } }),
      this.prisma.studentDirective.findMany({
        where: { userId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      }),
      this.prisma.studentObservation.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.reassessment.findFirst({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: 'desc' } }),
    ]);

    const answers = sanitizeInterviewAnswers(jsonObject(onboarding?.answers));
    const painSafety = await this.painReports.computeSafetyTier(userId);
    const safetyAdjustment = painSafety.tier !== 'normal';
    const paceFallback = estimatePaceFromAnswers(answers);

    const isStrength = session.modality === 'forca' || session.modality === 'fortalecimento_corredores';
    const isAerobic = session.modality === 'bike';
    const durationMin = session.durationMin ?? 45;

    let prescription;
    if (isStrength) {
      const methodologyInput: MethodologyInput = {
        goal: user.preferences?.mainGoal ?? 'Evoluir com consistencia',
        experience: user.preferences?.experienceLevel ?? '',
        answers,
        availability: [],
        history: [],
        stravaRunMinutes: 0,
        stravaLongestRunMinutes: 0,
        studentDirectives: activeDirectives.map((directive) => directive.content),
        activeObservations: activeObservations.map((observation) => observation.content),
        todayDate: todayInSaoPaulo().toISOString().slice(0, 10),
        recentReassessment: latestReassessment ? {
          completedAt: latestReassessment.completedAt!.toISOString(),
          answers: sanitizeInterviewAnswers(jsonObject(latestReassessment.answers)),
          evolutionSummary: latestReassessment.evolutionSummary,
          evolutionWins: Array.isArray(latestReassessment.evolutionWins) ? latestReassessment.evolutionWins as string[] : [],
          evolutionConcerns: Array.isArray(latestReassessment.evolutionConcerns) ? latestReassessment.evolutionConcerns as string[] : [],
        } : null,
        painTier: painSafety.tier,
        painReason: painSafety.reason,
      };
      const strengthDecision = await this.prescriptionAgent.proposeStrengthSession(methodologyInput, {
        weekday: session.weekday,
        modality: session.modality as 'forca' | 'fortalecimento_corredores',
        durationMin,
      });
      if (!strengthDecision) {
        this.logger.error(`Falha ao gerar decisao de forca avulsa com IA para o aluno ${userId}, sessao ${sessionId} — treino nao foi alterado.`);
        await this.telegram.notifyCoach(
          `⚠️ Falha ao gerar treino de forca avulso com IA para um aluno (id ${userId}). O treino NAO foi atualizado — verifique a chave da IA e tente novamente pelo painel.`,
        );
        throw new InternalServerErrorException('Nao foi possivel gerar o treino com o agente de IA no momento. O treinador ja foi avisado.');
      }
      prescription = this.strengthPrescription(durationMin, strengthDecision);
    } else if (isAerobic) {
      prescription = this.aerobicPrescription(durationMin, session.modality);
    } else {
      const sessionType = (session.sessionType ?? 'easy_run') as 'easy_run' | 'quality_run' | 'long_run' | 'walk_run';
      const paceEvidence: PaceEvidence = {
        testPace: latestTest ? { secondsPerKm: latestTest.paceSecondsPerKm, daysAgo: Math.max(0, Math.floor((Date.now() - latestTest.createdAt.getTime()) / 86400000)) } : null,
        selfReportedPace: paceFallback ? { secondsPerKm: paceFallback.paceSecondsPerKm, source: paceFallback.source } : null,
        stravaAveragePace: null,
      };
      // Decide TUDO deste dia numa unica chamada (distancia, pace, estrutura) — nunca reaproveita
      // um pace guardado de outro dia nem calcula distancia por formula (ver proposeRunSession).
      const runDecision = await this.prescriptionAgent.proposeRunSession({
        sessionType,
        durationMin,
        evidence: paceEvidence,
        studentDirectives: activeDirectives.map((directive) => directive.content),
        activeObservations: activeObservations.map((observation) => observation.content),
        painTier: painSafety.tier,
        painReason: painSafety.reason,
      });
      if (!runDecision) {
        this.logger.error(`Falha ao gerar treino de corrida avulso com IA para o aluno ${userId}, sessao ${sessionId} — treino nao foi alterado.`);
        await this.telegram.notifyCoach(
          `⚠️ Falha ao gerar treino avulso com IA para um aluno (id ${userId}). O treino NAO foi atualizado — verifique a chave da IA e tente novamente pelo painel.`,
        );
        throw new InternalServerErrorException('Nao foi possivel gerar o treino com o agente de IA no momento. O treinador ja foi avisado.');
      }
      prescription = this.runPrescription(durationMin, session.modality, sessionType, runDecision);
    }

    return this.prisma.trainingSession.update({
      where: { id: sessionId },
      data: {
        distanceKm: prescription.distanceKm,
        paceMinSec: !isStrength && !isAerobic && prescription.representativePaceSecondsPerKm != null
          ? formatPace(prescription.representativePaceSecondsPerKm)
          : null,
        structure: prescription as unknown as Prisma.InputJsonObject,
      },
    });
  }

  private templateForModality(modality: string, hasTest: boolean): SessionTemplate {
    if (modality === 'fortalecimento_corredores') {
      return {
        title: 'Fortalecimento para corredores',
        modality,
        sessionType: 'strength',
        zone: 'Base',
        durationMin: 45,
        notes: 'Fortalecimento especifico para corredores com videos de execucao cadastrados.',
      };
    }

    if (modality === 'forca') {
      return {
        title: 'Musculacao',
        modality,
        sessionType: 'strength',
        zone: 'Base',
        durationMin: 45,
        notes: 'Treino de musculacao geral. Registrar carga, controle de execucao e pausas.',
      };
    }

    if (modality === 'bike' || modality === 'esteira') {
      return {
        title: modality === 'bike' ? 'Bike ou aerobico leve' : 'Corrida na esteira',
        modality,
        sessionType: 'aerobic',
        zone: 'Z2',
        durationMin: 45,
        notes:
          modality === 'bike'
            ? 'Aerobico complementar em intensidade controlada, sem competir com os treinos de corrida.'
            : 'Manter intensidade controlada e respiracao confortavel.',
      };
    }

    return {
      title: 'Corrida leve',
      modality: 'corrida',
      sessionType: 'easy_run',
      zone: 'Z2',
      durationMin: 50,
      notes: hasTest ? 'Manter ritmo confortavel dentro da zona indicada.' : 'Manter conforto respiratorio.',
    };
  }

  private runPrescription(
    durationMin: number,
    modality: string,
    sessionType: string,
    decision: {
      distanceKm: number | null;
      paceSecondsPerKm: number | null;
      intervalStructure?: IntervalStructureDecision | null;
      walkRunStructure?: WalkRunStructureDecision | null;
    },
  ) {
    // Aquecimento e desaquecimento NAO fazem mais parte do treino prescrito nem da distancia/
    // duracao total — viraram uma recomendacao em texto (campo "recommendations", escrita pela
    // IA por sessao), exibida separadamente. Isso evita o erro que ja aconteceu na pratica: um
    // treino "leve" de poucos km onde boa parte era so aquecimento/desaquecimento contando pro
    // volume, distorcendo o quanto o aluno realmente treinou naquele dia.
    //
    // Distancia e pace vem inteiramente da decisao da IA para ESTE dia especifico — nao existe
    // mais nenhuma conta de codigo (duracao dividida por um pace fixo da semana) decidindo isso.

    if (sessionType === 'quality_run') {
      // A estrutura (quantas repeticoes, distancia/pace de cada trecho forte/recuperacao, quanto
      // de volume leve) e decisao do agente de IA (validada em prescription-agent.service.ts) —
      // nao existe mais nenhuma proporcao/passo/pace fixo aqui. Chegar aqui sem essa estrutura e
      // um bug de sincronizacao entre quem gerou a decisao e quem monta a sessao.
      if (!decision.intervalStructure || decision.paceSecondsPerKm == null) {
        throw new InternalServerErrorException(`Estrutura do treino intervalado ausente ao montar a sessao (durationMin=${durationMin}).`);
      }
      const { repeatCount, fastStepKm, fastPaceSecondsPerKm, recoveryStepKm, recoveryPaceSecondsPerKm, easyVolumeKm } = decision.intervalStructure;
      const intervalBlock: RunBlock = {
        label: 'Serie intervalada',
        repeatCount,
        steps: [
          this.intervalStep('Correr forte', fastStepKm, fastPaceSecondsPerKm),
          this.intervalStep('Recuperar', recoveryStepKm, recoveryPaceSecondsPerKm),
        ],
      };
      const blocks = [
        intervalBlock,
        this.runDistanceBlock('Recuperacoes e volume leve', easyVolumeKm, decision.paceSecondsPerKm),
      ];
      return {
        type: 'run', modality, distanceKm: this.totalBlockDistance(blocks), durationMin: this.midpointDuration(blocks), durationRange: this.totalDurationRange(blocks),
        speedKmh: Number((3600 / fastPaceSecondsPerKm).toFixed(1)),
        representativePaceSecondsPerKm: fastPaceSecondsPerKm,
        blocks,
        reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'heartRate', 'rpe', 'notes'],
      };
    }

    if (sessionType === 'walk_run') {
      // Mesma logica do quality_run acima: a estrutura vem da decisao do agente de IA, ja validada
      // — nao existe mais pace/passo fixo aqui.
      if (!decision.walkRunStructure) {
        throw new InternalServerErrorException(`Estrutura de caminhada-corrida ausente ao montar a sessao (durationMin=${durationMin}).`);
      }
      const { repeatCount, walkStepKm, runStepKm, walkPaceSecondsPerKm, runPaceSecondsPerKm } = decision.walkRunStructure;
      const intervalBlock: RunBlock = {
        label: 'Bloco intervalado',
        repeatCount,
        steps: [
          this.intervalStep('Caminhar', walkStepKm, walkPaceSecondsPerKm),
          this.intervalStep('Correr', runStepKm, runPaceSecondsPerKm),
        ],
      };
      const blocks = [intervalBlock];
      return {
        type: 'run', modality, distanceKm: this.totalBlockDistance(blocks), durationMin: this.midpointDuration(blocks), durationRange: this.totalDurationRange(blocks),
        speedKmh: Number((3600 / runPaceSecondsPerKm).toFixed(1)),
        representativePaceSecondsPerKm: runPaceSecondsPerKm,
        blocks,
        reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'heartRate', 'rpe', 'notes'],
      };
    }

    // easy_run / long_run: distancia e pace decididos diretamente pela IA para este dia.
    if (decision.distanceKm == null || decision.paceSecondsPerKm == null) {
      throw new InternalServerErrorException(`Distancia/pace ausentes ao montar a sessao (durationMin=${durationMin}, sessionType=${sessionType}).`);
    }
    const blocks = [this.runDistanceBlock('Principal', decision.distanceKm, decision.paceSecondsPerKm)];

    return {
      type: 'run',
      modality,
      distanceKm: this.totalBlockDistance(blocks),
      durationMin: this.midpointDuration(blocks),
      durationRange: this.totalDurationRange(blocks),
      speedKmh: Number((3600 / decision.paceSecondsPerKm).toFixed(1)),
      representativePaceSecondsPerKm: decision.paceSecondsPerKm,
      blocks,
      reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'heartRate', 'rpe', 'notes'],
    };
  }

  private runDistanceBlock(label: string, distanceKm: number, paceSecondsPerKm: number, guidance?: string) {
    const fast = Math.max(paceSecondsPerKm - 12, 1);
    const slow = paceSecondsPerKm + 12;
    const minimumSeconds = Math.round(distanceKm * fast);
    const maximumSeconds = Math.round(distanceKm * slow);

    return {
      label,
      durationMin: Math.round(((minimumSeconds + maximumSeconds) / 2) / 60),
      durationMinLower: minimumSeconds,
      durationMinUpper: maximumSeconds,
      durationRange: formatElapsedRange(minimumSeconds, maximumSeconds),
      durationType: 'distance',
      distanceValue: distanceKm,
      distanceUnit: 'km',
      paceRange: `${formatPace(fast)} a ${formatPace(slow)}`,
      speedRange: `${(3600 / slow).toFixed(1)} a ${(3600 / fast).toFixed(1)} km/h`,
      guidance,
    };
  }

  private blockDistance(block: RunBlock): number {
    if (block.repeatCount && block.steps) {
      return block.repeatCount * block.steps.reduce((total, step) => total + step.distanceValue, 0);
    }
    return block.distanceValue ?? 0;
  }

  private blockDurationBounds(block: RunBlock): { lower: number; upper: number } {
    if (block.repeatCount && block.steps) {
      return {
        lower: block.repeatCount * block.steps.reduce((total, step) => total + step.durationMinLower, 0),
        upper: block.repeatCount * block.steps.reduce((total, step) => total + step.durationMinUpper, 0),
      };
    }
    return { lower: block.durationMinLower ?? 0, upper: block.durationMinUpper ?? 0 };
  }

  private totalBlockDistance(blocks: RunBlock[]) {
    return Number(blocks.reduce((total, block) => total + this.blockDistance(block), 0).toFixed(1));
  }

  private totalDurationRange(blocks: RunBlock[]) {
    const lower = blocks.reduce((total, block) => total + this.blockDurationBounds(block).lower, 0);
    const upper = blocks.reduce((total, block) => total + this.blockDurationBounds(block).upper, 0);
    return formatElapsedRange(lower, upper);
  }

  private midpointDuration(blocks: RunBlock[]) {
    const lower = blocks.reduce((total, block) => total + this.blockDurationBounds(block).lower, 0);
    const upper = blocks.reduce((total, block) => total + this.blockDurationBounds(block).upper, 0);
    return Math.round(((lower + upper) / 2) / 60);
  }

  private intervalStep(label: string, distanceKm: number, paceSecondsCenter: number, toleranceSeconds = 20) {
    const fast = Math.max(paceSecondsCenter - toleranceSeconds, 60);
    const slow = paceSecondsCenter + toleranceSeconds;
    const minimumSeconds = Math.round(distanceKm * fast);
    const maximumSeconds = Math.round(distanceKm * slow);
    return {
      label,
      durationMin: Math.round(((minimumSeconds + maximumSeconds) / 2) / 60),
      durationMinLower: minimumSeconds,
      durationMinUpper: maximumSeconds,
      durationRange: formatElapsedRange(minimumSeconds, maximumSeconds),
      durationType: 'distance',
      distanceValue: distanceKm,
      distanceUnit: 'km',
      paceRange: `${formatPace(fast)} a ${formatPace(slow)}`,
      speedRange: `${(3600 / slow).toFixed(2)} a ${(3600 / fast).toFixed(2)} km/h`,
    };
  }

  private aerobicPrescription(durationMin: number, modality: string) {
    const mainDuration = Math.max(durationMin - 10, 15);

    return {
      type: 'aerobic',
      modality,
      distanceKm: null,
      durationMin,
      speedKmh: null,
      representativePaceSecondsPerKm: null as number | null,
      paceRange: null,
      guidance: `Fazer ${durationMin} min de exercicio aerobico, de preferencia bike ou outro aparelho aerobico, em esforco leve/controlado. Manter esforco controlado para nao atrapalhar os treinos de corrida dos outros dias.`,
      blocks: [
        { label: 'Aquecimento', durationMin: 5, guidance: 'Comecar leve e soltar a musculatura.' },
        {
          label: 'Principal',
          durationMin: mainDuration,
          guidance: 'Manter respiracao confortavel, sem transformar em treino forte.',
        },
        { label: 'Desaquecimento', durationMin: 5, guidance: 'Reduzir gradualmente a intensidade.' },
      ],
      reportFields: ['durationMin', 'modality', 'heartRate', 'rpe', 'notes'],
    };
  }

  // Os exercicios, o foco muscular do dia, sets/reps/descanso/intensidade sao TODOS decisao real
  // da IA (ver StrengthSessionDecision e validateStrengthSessions em prescription-agent.service.ts)
  // — esta funcao so resolve os ids escolhidos contra o catalogo aprovado e monta a estrutura de
  // exibicao, sem nenhuma escolha propria de treino.
  private strengthPrescription(durationMin: number, decision: StrengthSessionDecision) {
    const isRunnerStrength = decision.modality === 'fortalecimento_corredores';
    const category = isRunnerStrength ? 'Fortalecimento para corredores' : 'Musculacao';
    const exercises = decision.exerciseIds
      .map((id) => (isRunnerStrength ? runnerStrengthExercises : gymExerciseLibrary).find((item) => item.id === id))
      .filter((item): item is (typeof gymExerciseLibrary)[number] | (typeof runnerStrengthExercises)[number] => Boolean(item));

    return {
      type: 'strength',
      category,
      durationMin,
      distanceKm: null,
      representativePaceSecondsPerKm: null as number | null,
      exercises: exercises.map((exercise) => ({
        id: exercise.id,
        category,
        name: exercise.name,
        description: exercise.description,
        videoUrl: 'videoUrl' in exercise ? exercise.videoUrl : null,
        sets: decision.sets,
        reps: decision.reps,
        intensity: decision.intensity,
        restSeconds: decision.restSeconds,
        cadence: 'group' in exercise && exercise.group === 'core' ? 'Execucao lenta e controlada' : '2s na fase excentrica / subida controlada',
        loadField: !isRunnerStrength && 'group' in exercise && exercise.group !== 'core',
      })),
      reportFields: isRunnerStrength
        ? ['exercise', 'sets', 'reps', 'load', 'rpe', 'completed', 'notes', 'videoUrl']
        : ['exercise', 'sets', 'reps', 'load', 'rpe', 'completed', 'notes'],
    };
  }
  private presentPlan(plan: {
    id: string;
    name: string;
    goal: string;
    startDate: Date;
    endDate: Date | null;
    createdAt: Date;
    aiRecommendation: string | null;
    sessions: Array<{
      id: string;
      scheduledDate: Date;
      weekday: number;
      modality: string;
      title: string;
      durationMin: number | null;
      intensityZone: string | null;
      paceMinSec: string | null;
      distanceKm: number | null;
      structure: unknown;
      notes: string | null;
      recommendations: string | null;
      completion?: {
        status: string;
        completedAt: Date;
        durationMin: number | null;
        distanceKm: number | null;
        avgPaceSecondsKm: number | null;
        perceivedEffort: number | null;
        satisfaction: string | null;
        painFlag: string | null;
        notes: string | null;
        details: unknown;
      } | null;
    }>;
  }, unlocked = true, hasTest = true) {
    if (!unlocked) {
      return {
        id: plan.id,
        name: plan.name,
        goal: plan.goal,
        startDate: plan.startDate,
        endDate: plan.endDate,
        recommendation: null,
        locked: true,
        requiresTest: false,
        billingProvider: 'asaas',
        priceLabel: 'R$ 19,90 por mes',
        sessions: [],
      };
    }
    return {
      id: plan.id,
      name: plan.name,
      goal: plan.goal,
      requiresTest: !hasTest,
      startDate: plan.startDate,
      endDate: plan.endDate,
      generatedAt: plan.createdAt,
      recommendation: plan.aiRecommendation,
      locked: false,
      sessions: plan.sessions.map((session) => ({
        id: session.id,
        day: dayNames[session.weekday] ?? 'Dia',
        date: formatDate(session.scheduledDate),
        title: session.title,
        detail: [structureDurationLabel(session.structure, session.durationMin), session.intensityZone, session.paceMinSec]
          .filter(Boolean)
          .join(' - '),
        modality: session.modality,
        zone: session.intensityZone ?? '',
        durationMin: session.durationMin,
        distanceKm: session.distanceKm,
        structure: session.structure,
        notes: session.notes,
        recommendations: session.recommendations,
        completion: session.completion
          ? {
              status: session.completion.status,
              completedAt: session.completion.completedAt,
              durationMin: session.completion.durationMin,
              distanceKm: session.completion.distanceKm,
              avgPaceSecondsKm: session.completion.avgPaceSecondsKm,
              perceivedEffort: session.completion.perceivedEffort,
              satisfaction: session.completion.satisfaction,
              painFlag: session.completion.painFlag,
              notes: session.completion.notes,
              details: session.completion.details,
            }
          : null,
      })),
    };
  }
}

export function hasSubscriptionAccess(status: string) {
  return status === 'active' || status === 'manual_active' || status === 'grace';
}

// hasSubscriptionAccess precisa ser passado explicitamente por quem chama (nao calculado aqui)
// porque um aluno que JA pagou pode ter a entrevista reaberta (auto-correcao do proprio aluno,
// ou reabertura pelo treinador) sem deixar de ser assinante — sem esse dado, o app mostrava o
// cartao de "Ativar assinatura" pra ela de novo, incondicionalmente, mesmo ja sendo assinante
// ativa. Isso ja causou um relato real de aluna dizendo que o app "mostra que ela nao pagou".
function onboardingRequiredPlan(hasSubscriptionAccess: boolean) {
  return {
    id: 'onboarding-required',
    name: 'Entrevista inicial',
    goal: '',
    startDate: startOfWeek(new Date()),
    endDate: addDays(startOfWeek(new Date()), 6),
    recommendation: null,
    requiresOnboarding: true,
    requiresTest: false,
    locked: false,
    hasSubscriptionAccess,
    sessions: [],
  };
}

const DEFAULT_PACE_SECONDS_PER_KM = 420;

const QUALITATIVE_PACE_SECONDS: Record<string, number> = {
  muito_leve: 450,
  leve: 420,
  moderado: 390,
  forte: 360,
  muito_forte: 330,
};

function numericAnswer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : null;
  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.'));
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
  }
  return null;
}

// A entrevista pergunta a maior distancia recente em faixas (opcao de marcar, nao numero
// digitado). Para o calculo de equivalencia de pace ainda precisamos de um km representativo,
// entao usamos o meio de cada faixa como estimativa.
const DISTANCE_BUCKET_MIDPOINT_KM: Record<string, number> = {
  '1_3': 2, '3_5': 4, '5_8': 6.5, '8_10': 9, '10_15': 12.5, '15_21': 18, '21_30': 25.5, '30_42': 36, '42_plus': 45,
};

function distanceBucketToKm(value: unknown): number | null {
  if (typeof value === 'string' && value in DISTANCE_BUCKET_MIDPOINT_KM) return DISTANCE_BUCKET_MIDPOINT_KM[value];
  return numericAnswer(value);
}

function estimatePaceFromAnswers(answers: Record<string, unknown>): { paceSecondsPerKm: number; source: 'self_report_5k' | 'qualitative' } | null {
  if (isCurrentlyRunning(answers)) {
    const distanceKm = distanceBucketToKm(answers.longest_distance);
    const distanceSeconds = parseMmSsToSeconds(answers.longest_distance_recent_time);
    if (distanceKm && distanceSeconds) {
      const threeKmEquivalentSeconds = distanceSeconds * Math.pow(3 / distanceKm, 1.06);
      return { paceSecondsPerKm: Math.round(threeKmEquivalentSeconds / 3), source: 'self_report_5k' };
    }
  }

  const rating = typeof answers.fitness_self_rating === 'string' ? answers.fitness_self_rating : null;
  if (rating && rating in QUALITATIVE_PACE_SECONDS) {
    return { paceSecondsPerKm: QUALITATIVE_PACE_SECONDS[rating], source: 'qualitative' };
  }

  return null;
}

function composeRecommendation(paceSource: 'test' | 'self_report_5k' | 'qualitative' | 'default', recommendation: string, runningRemovedForPain = false) {
  const note =
    paceSource === 'self_report_5k'
      ? 'Como voce ainda nao fez o teste oficial de 3 km, usamos o tempo de 5 km que voce informou para calcular os ritmos do seu treino. Assim que fizer o teste de 3 km, o treino sera recalculado automaticamente com mais precisao.'
      : paceSource === 'qualitative'
        ? 'Como voce ainda nao fez o teste oficial de 3 km, usamos o nivel de condicionamento que voce informou para estimar os ritmos do seu treino. Assim que fizer o teste de 3 km, o treino sera recalculado automaticamente com mais precisao.'
        : paceSource === 'default'
          ? 'Ainda nao temos seu teste de 3 km nem outra referencia de ritmo, entao usamos um ritmo geral inicial. Faca o teste de 3 km assim que possivel para deixar seu treino muito mais preciso e individualizado.'
          : null;

  const painNote = runningRemovedForPain
    ? 'Por causa da dor que voce relatou, tiramos a corrida da sua semana por enquanto — isso nao e medo de voce se machucar, e o cuidado que um treinador de verdade tem nesse momento. O fortalecimento para corredores que preparamos agora e parte real do seu progresso: ele trabalha exatamente o que vai te ajudar a voltar a correr melhor e com mais seguranca. Continue nos contando como a dor evolui (pelo menu de relato de dor) assim que tiver novidade, para liberarmos a corrida assim que fizer sentido.'
    : null;

  return [painNote, note, recommendation].filter(Boolean).join('\n\n');
}

function pickModality(modalities: string[], fallback: string) {
  if (modalities.includes(fallback)) {
    return fallback;
  }

  return modalities[0] ?? fallback;
}

function startOfWeek(date: Date) {
  const parts = saoPauloDateParts(date);
  const start = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  return start;
}

function todayInSaoPaulo() {
  const parts = saoPauloDateParts(new Date());
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function saoPauloDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function saoPauloDateTime(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(date);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function weekdayOffsetFromMonday(weekday: number) {
  return weekday === 0 ? 6 : weekday - 1;
}

function isRunningModality(modality: string) {
  return modality === 'corrida' || modality === 'esteira';
}

interface AvailableDay {
  weekday: number;
  modalities: string[];
  availableMin?: number | null;
  modalityDurations?: unknown;
}

function remapAvailabilityForPainSafety(days: AvailableDay[], removeRunning: boolean): AvailableDay[] {
  if (!removeRunning) return days;
  return days.map((day) => ({
    ...day,
    modalities: [...new Set(day.modalities.map((modality) => (isRunningModality(modality) ? 'fortalecimento_corredores' : modality)))],
  }));
}

function isStravaRunningActivity(type: string | null, name: string | null) {
  const value = `${type ?? ''} ${name ?? ''}`.toLowerCase();
  return value.includes('run') || value.includes('corrida');
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function structureDurationLabel(structure: unknown, durationMin: number | null) {
  const value = jsonObject(structure).durationRange;
  if (typeof value === 'string' && value) return `Tempo ${value}`;
  return durationMin ? `${durationMin} min` : null;
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumericValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function normalizeModalityDurations(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).reduce<Record<string, number>>((acc, [key, duration]) => {
    const parsedDuration = Number(duration);
    if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
      acc[key] = parsedDuration;
    }
    return acc;
  }, {});
}

function planMatchesAvailability(inputSnapshot: unknown, availability: Array<{ weekday: number; modalities: string[]; availableMin: number | null; modalityDurations: unknown }>) {
  if (snapshotUsedWeeklyOverride(inputSnapshot)) {
    return true;
  }

  const snapshotAvailability = readSnapshotAvailability(inputSnapshot);
  if (!snapshotAvailability) {
    return false;
  }

  return JSON.stringify(snapshotAvailability) === JSON.stringify(availabilitySignature(availability));
}

const PAIN_TIER_SEVERITY: Record<string, number> = { normal: 0, reduced: 1, remove_running: 2 };

// So considera "piorou" (nunca "melhorou") de proposito: uma dor que sumiu nao justifica
// interromper o aluno no meio da semana com um treino recalculado, mas uma dor nova/pior sim.
function planPainTierIsStale(inputSnapshot: unknown, currentTier: string): boolean {
  const snapshotTier =
    inputSnapshot && typeof inputSnapshot === 'object' && typeof (inputSnapshot as { painTier?: unknown }).painTier === 'string'
      ? ((inputSnapshot as { painTier: string }).painTier)
      : 'normal';
  return (PAIN_TIER_SEVERITY[currentTier] ?? 0) > (PAIN_TIER_SEVERITY[snapshotTier] ?? 0);
}

function planMatchesLatestTest(inputSnapshot: unknown, latestTestId: string | null) {
  if (!inputSnapshot || typeof inputSnapshot !== 'object') {
    return latestTestId === null;
  }

  const snapshotTestId = (inputSnapshot as { latestTestId?: unknown }).latestTestId;
  return (typeof snapshotTestId === 'string' ? snapshotTestId : null) === latestTestId;
}

function snapshotUsedWeeklyOverride(inputSnapshot: unknown) {
  return Boolean(inputSnapshot && typeof inputSnapshot === 'object' && (inputSnapshot as { weeklyOverrideUsed?: unknown }).weeklyOverrideUsed);
}

function readSnapshotAvailability(inputSnapshot: unknown) {
  if (!inputSnapshot || typeof inputSnapshot !== 'object' || !('availabilityDays' in inputSnapshot)) {
    return null;
  }

  const availabilityDays = (inputSnapshot as { availabilityDays?: unknown }).availabilityDays;
  if (!Array.isArray(availabilityDays)) {
    return null;
  }

  return availabilityDays
    .map((day) => {
      if (!day || typeof day !== 'object') {
        return null;
      }
      const item = day as { weekday?: unknown; modalities?: unknown; availableMin?: unknown; modalityDurations?: unknown };
      return {
        weekday: Number(item.weekday),
        modalities: Array.isArray(item.modalities) ? [...item.modalities].map(String).sort() : [],
        availableMin: Number(item.availableMin ?? 0),
        modalityDurations: normalizeModalityDurations(item.modalityDurations) ?? {},
      };
    })
    .filter((day): day is { weekday: number; modalities: string[]; availableMin: number; modalityDurations: Record<string, number> } => Boolean(day))
    .sort((left, right) => left.weekday - right.weekday);
}

function availabilitySignature(availability: Array<{ weekday: number; modalities: string[]; availableMin: number | null; modalityDurations: unknown }>) {
  return availability
    .map((day) => ({
      weekday: day.weekday,
      modalities: [...day.modalities].sort(),
      availableMin: day.availableMin ?? 0,
      modalityDurations: normalizeModalityDurations(day.modalityDurations) ?? {},
    }))
    .sort((left, right) => left.weekday - right.weekday);
}

function formatDate(date: Date) {
  return `${date.getUTCDate().toString().padStart(2, '0')}/${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}

function roundDistance(value: number) {
  return Number((Math.round(value * 10) / 10).toFixed(1));
}

function formatElapsedRange(minimumSeconds: number, maximumSeconds: number) {
  return `${formatElapsed(minimumSeconds)} a ${formatElapsed(maximumSeconds)}`;
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
