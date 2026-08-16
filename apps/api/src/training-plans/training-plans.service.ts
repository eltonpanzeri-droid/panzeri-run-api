import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runnerStrengthExercises } from './runner-strength-library';
import { gymExerciseLibrary } from './gym-exercise-library';
import {
  MethodologyInput,
  RunSessionDecision,
  StrengthSessionDecision,
  WeeklyMethodologyDecision,
  SessionPartDecision,
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
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudentProfileService, ProfileEventCode } from './student-profile.service';

interface SessionTemplate {
  title: string;
  modality: string;
  sessionType: string;
  zone: string;
  durationMin: number;
  notes: string;
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

// Instrucao de aquecimento/resfriamento generica e padrao para todo treino de corrida — decisao
// deliberada do treinador: isso e boilerplate pratico igual pra qualquer aluno, nao uma decisao
// de treino que precisa de raciocinio da IA a cada sessao. Fixo em codigo, sem custo de IA,
// apendado ao final do texto explicativo (notes) — MAS so quando o proprio treino ainda nao
// comecar com uma caminhada de verdade (ver shouldSkipStandardWarmupCooldown abaixo). Pedido
// explicito do treinador (10/08): nao faz sentido repetir "aqueca antes de comecar" quando o
// treino ja se inicia com pelo menos 5 minutos de caminhada descritos como parte real do treino.
const STANDARD_WARMUP_COOLDOWN_TEXT =
  'Aquecimento: 5-10 min de corrida bem leve ou caminhada rapida antes de comecar o treino prescrito. Resfriamento: 5 min de corrida bem leve ou caminhada logo apos terminar, seguido de alongamento leve.';
const STANDARD_WARMUP_COOLDOWN_MIN_LEADING_WALK_MIN = 5;

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
// Domingo a partir dessa hora (Sao Paulo): a semana seguinte fica "liberada" pro botao
// "Gerar treino da semana" (generateCurrentWeekOnDemand) poder gerar a semana seguinte em vez
// da atual (a primeira geracao, generateFirstWeekIfNeeded, nao usa mais essa constante — ver
// comentario la, o adiamento pra "domingo" foi removido por deixar alunas presas sem programa).
const WEEKLY_RELEASE_HOUR = 12;
// Corte pra decidir se "hoje" ainda conta como dia valido pra gerar treino quando a aluna toca o
// botao — depois dessa hora nao faz sentido pratico gerar o treino de um dia que ja nao tem mais
// tempo real de ser feito; nesse caso a geracao comeca no dia seguinte. Ajustavel livremente.
const TODAY_INCLUSION_CUTOFF_HOUR = 22;

@Injectable()
export class TrainingPlansService {
  private readonly logger = new Logger(TrainingPlansService.name);
  private readonly recentAiFailures = new Map<string, number>();
  private readonly recentPainAlerts = new Map<string, number>();
  // Trava contra disparo duplo do botao "Gerar treino da semana" (toque duplo, ou o app tentando
  // de novo apos uma conexao instavel) — guarda a Promise em andamento por aluna; uma segunda
  // chamada simultanea reaproveita a mesma Promise em vez de disparar uma segunda geracao. Mesmo
  // idioma de recentAiFailures/recentPainAlerts (em memoria, nao e lock distribuido de verdade —
  // nao sobrevive a mais de uma instancia da API, mas suficiente pro tamanho atual da operacao).
  private readonly currentWeekGenerationInFlight = new Map<string, Promise<{ generated: boolean; reason: string }>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly prescriptionAgent: PrescriptionAgentService,
    private readonly stravaAnalysisAgent: StravaAnalysisAgentService,
    private readonly painReports: PainReportsService,
    private readonly targetRaces: TargetRacesService,
    private readonly stravaService: StravaService,
    private readonly telegram: TelegramService,
    private readonly studentProfile: StudentProfileService,
    private readonly notifications: NotificationsService,
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
    await this.fixStuckScheduledPlan(userId, weekStart);
    const [plan, latestTest, user, onboarding] = await Promise.all([
      // startDate: weekStart e essencial aqui (bug real 10/08 — aluna Eduarda): sem esse filtro,
      // um plano "active" da SEMANA PASSADA (que so fica active ate a propria aluna gerar a nova
      // semana pelo botao — nada mais o arquiva sozinho, ver comentario da geracao sob demanda)
      // era devolvido como se fosse a semana atual, escondendo pra sempre o botao "Gerar treino
      // da semana" (so aparece quando current() cai no ramo `!plan` abaixo). A semana antiga
      // continua acessivel normalmente por "Anterior" (getWeekByOffset com offset negativo, que
      // nao filtra por status).
      // BUG REAL CORRIGIDO (16/08 — varias alunas ao mesmo tempo, "gerei e nao aparece nada"):
      // startDate: weekStart sozinho nao bastava. generateWeek()/generateCurrentWeekOnDemand tem
      // logica de "rolar pra semana seguinte" (domingo apos WEEKLY_RELEASE_HOUR, ou sem nenhum dia
      // futuro sobrando na semana atual) — quando isso acontece, o plano novo e criado com
      // startDate = semana QUE VEM, mas current() continuava filtrando so pela semana de HOJE (sem
      // essa mesma logica de rolagem). Resultado: aluna gera domingo a tarde, o plano novo existe
      // e fica "active" de verdade, mas current() nunca o encontra ate o calendario virar
      // segunda-feira — parece que "nao gerou nada". Corrigido buscando active tanto na semana
      // atual quanto na semana seguinte (so pode existir UM active por vez, generateWeek() sempre
      // arquiva o anterior antes de criar o novo — entao nao ha risco de pegar o active errado).
      this.prisma.trainingPlan.findFirst({
        where: { userId, status: 'active', startDate: { in: [weekStart, addDays(weekStart, 7)] } },
        orderBy: { startDate: 'desc' },
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
      // hasSubscriptionAccess precisa ir junto: sem isso o app nao tem como saber, quando ainda
      // nao existe programa (agora um estado normal com a geracao sob demanda), se a aluna ja
      // pagou e so precisa tocar "Gerar treino da semana", ou se ainda nem pagou. Faltando esse
      // campo, o app caia sempre na tela generica de "ative seu plano" — bug real, achado
      // 08/08 (aluna Carina, ja tinha pago e respondido tudo, via a tela de cobranca).
      // hasEverHadPlan tambem precisa ir junto (mesmo incidente, achado logo em seguida): sem
      // isso o app nao tem como saber se e uma aluna NOVA (primeira geracao, fluxo automatico
      // separado ao completar "Rotina de treinos") ou uma aluna com historico so aguardando
      // tocar o botao — mostrava o botao "Gerar treino da semana" pra aluna nova tambem, que
      // sempre falhava em silencio (generateCurrentWeekOnDemand recusa de proposito quando nao
      // existe nenhum plano anterior), deixando a aluna clicando sem nada acontecer.
      const anyPlanEver = await this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } });
      return {
        notGenerated: true,
        startDate: weekStart,
        endDate: addDays(weekStart, 6),
        hasSubscriptionAccess: hasSubscriptionAccess(user.subscriptionStatus),
        hasEverHadPlan: Boolean(anyPlanEver),
      };
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
  }

  // REPARO DE EMERGENCIA (03/08, manha): na noite de 02/08 o botao "Gerar semana seguinte para
  // todos" criou planos com um status intermediario "agendado" sem arquivar a semana anterior
  // (arquitetura errada, ja corrigida — geracao agora sempre vira "ativo" na hora). O codigo que
  // convertia esse "agendado" pra "ativo" foi removido ao consertar a arquitetura, e sem ele
  // esses planos ficaram presos: os alunos afetados voltaram a ver a semana antiga (ja passada)
  // como se fosse a atual. Este metodo so resolve esse estoque preso (nenhuma geracao nova cria
  // mais "agendado" daqui pra frente); fica como rede de seguranca permanente, sem custo — so
  // troca status no banco, nunca chama IA.
  private async fixStuckScheduledPlan(userId: string, weekStart: Date) {
    const stuckScheduled = await this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'scheduled', startDate: weekStart },
      select: { id: true },
    });
    if (!stuckScheduled) return;

    await this.prisma.$transaction([
      this.prisma.trainingPlan.updateMany({ where: { userId, status: 'active' }, data: { status: 'archived' } }),
      this.prisma.trainingPlan.update({ where: { id: stuckScheduled.id }, data: { status: 'active' } }),
    ]);
  }

  // Versao em lote do reparo acima, pra rodar de uma vez pelo painel do treinador (dashboard) em
  // vez de depender de cada aluno abrir o app primeiro.
  async fixAllStuckScheduledPlans() {
    const weekStart = startOfWeek(new Date());
    const stuck = await this.prisma.trainingPlan.findMany({
      where: { status: 'scheduled', startDate: weekStart },
      select: { id: true, userId: true },
    });
    for (const plan of stuck) {
      await this.prisma.$transaction([
        this.prisma.trainingPlan.updateMany({ where: { userId: plan.userId, status: 'active' }, data: { status: 'archived' } }),
        this.prisma.trainingPlan.update({ where: { id: plan.id }, data: { status: 'active' } }),
      ]);
    }
    return { fixed: stuck.length };
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
    if (!plan) return { needsUpdate: true, reason: 'Nenhum programa ativo para a semana atual.' };

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
        const alertStudent = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, studentCode: true } });
        await this.telegram.notifyCoach(
          `⚠️ Novo relato de dor no Panzeri Run elevou o nivel de cautela de um aluno.\nAluno: ${alertStudent?.name ?? 'desconhecido'} (Cod. ${alertStudent ? formatStudentCode(alertStudent.studentCode) : '?'})\nMotivo: ${currentPainSafety.reason ?? 'sem detalhe'}\nO programa desta semana precisa ser regenerado pelo painel para refletir isso.`,
        );
      }
      return { needsUpdate: true, reason: `Nivel de cautela por dor elevado: ${currentPainSafety.reason ?? 'sem detalhe'}` };
    }
    if (plan.generatedBy !== planEngineVersion) return { needsUpdate: true, reason: 'Programa gerado por uma versao antiga do motor de decisao.' };
    // Mesma correcao real de 16/08 aplicada em current() (ver comentario la): um plano gerado
    // domingo apos o horario de liberacao (ou sem dia futuro sobrando na rotina) legitimamente
    // rola pra semana seguinte — nao e "desatualizado", e o comportamento certo. Sem aceitar
    // tambem addDays(weekStart, 7) aqui, esse aviso acendia falso positivo no painel toda vez
    // que isso acontecia (visto ao vivo no caso da Roberta 16/08: plano certo, aviso errado).
    if (plan.startDate.getTime() !== weekStart.getTime() && plan.startDate.getTime() !== addDays(weekStart, 7).getTime()) {
      return { needsUpdate: true, reason: 'Programa ativo nao e da semana atual.' };
    }
    if (!planMatchesLatestTest(plan.inputSnapshot, latestTest?.id ?? null)) return { needsUpdate: true, reason: 'Ha um teste de 3km mais recente do que o usado no programa.' };
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

    // BUG REAL CORRIGIDO (16/08 — aluna Vanessa, "o da semana passada, que acabou hoje, tambem
    // nao aparece mais"): antes disso, negativo sempre contava a partir do calendario literal de
    // agora (startOfWeek(new Date())) — mas current() (offset 0) ja rola pra semana seguinte aos
    // domingos apos WEEKLY_RELEASE_HOUR (ver comentario em current()). Sem essa mesma rolagem
    // aqui, offset -1 (Anterior) nunca alcancava a semana que acabou de terminar (ela fica
    // arquivada assim que a semana seguinte e gerada, e so aparece pelo startDate exato aqui —
    // current() so devolve planos ativos). Usa a mesma referencia de "hoje" que current() usa
    // pra decidir a rolagem, garantindo que offset -1 sempre significa "a semana anterior a que
    // esta ativa agora", nunca uma semana perdida no meio do caminho.
    const { weekday: todayWeekday, hour: todayHour } = saoPauloWeekdayAndHour(new Date());
    const rolledPastRelease = todayWeekday === 0 && todayHour >= WEEKLY_RELEASE_HOUR;
    const navigationReference = rolledPastRelease ? addDays(new Date(), 7) : new Date();
    const targetWeekStart = startOfWeek(addDays(navigationReference, offset * 7));
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
      const anyPlanEver = await this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } });
      return {
        notGenerated: true,
        startDate: targetWeekStart,
        endDate: addDays(targetWeekStart, 6),
        hasSubscriptionAccess: hasSubscriptionAccess(user.subscriptionStatus),
        hasEverHadPlan: Boolean(anyPlanEver),
      };
    }

    return this.presentPlan(plan, hasSubscriptionAccess(user.subscriptionStatus), Boolean(latestTest));
  }

  // options.referenceDate/planStatus/archiveCurrentActive existem so para a pre-geracao da
  // semana SEGUINTE (ver generateNextWeekIfMissing) — a chamada normal (aluno abrindo o app,
  // treinador regenerando a semana atual) nunca passa isso, e o comportamento fica exatamente
  // igual ao de sempre. options.allowToday e diferente: e o treinador confirmando explicitamente
  // (pelo admin) que quer mesmo alterar o treino de HOJE ao regenerar a semana — sem isso, hoje
  // continua sempre preservado (comportamento padrao, nunca muda sozinho).
  //
  // REMOVIDO (08/08, bug real corrigido): existia aqui um "shouldDelayFirstGenerationToSunday"
  // que suspendia a primeira geracao quando era domingo antes do horario de liberacao e nao
  // sobrava dia disponivel nesta semana — a logica original contava com o job automatico de
  // domingo (WeeklyPlanSchedulerService) pra "terminar o servico de graca" poucas horas depois.
  // Isso ficou orfao quando a geracao em massa de domingo foi desativada (geracao virou sob
  // demanda, ver generateCurrentWeekOnDemand) — o adiamento continuava acontecendo, mas nada
  // mais existia pra de fato gerar depois, deixando a aluna PERMANENTEMENTE sem nenhum programa
  // ate uma intervencao manual do treinador (aconteceu de verdade com pelo menos duas alunas).
  // Nao precisa de substituto: generateWeek() ja rola sozinho pra semana seguinte quando nao
  // sobra dia disponivel nesta (ver hasFutureDayThisWeek/anyAvailableDayIsFuture abaixo) — ou
  // seja, chamar generateWeek direto, mesmo num domingo de manha, ja produz o resultado certo
  // (a semana seguinte), sem nenhum desperdicio a evitar.

  // Chamado pelo BillingService assim que um pagamento e confirmado (webhook, sincronizacao
  // manual/automatica com o Asaas, ou cupom de acesso), e tambem por qualquer rota que salva uma
  // rotina nova (updateAvailability, updateAnamnese, syncAvailabilityFromInterview) — nesses
  // casos serve como o proprio gate: so gera de verdade se for a primeira vez (nenhum
  // TrainingPlan ainda). Ordem explicita do treinador (03/08): uma MUDANCA de rotina de quem ja
  // tem plano NUNCA gera na hora — ela so vale a partir da proxima geracao automatica de domingo
  // (generateNextWeekIfMissing/WeeklyPlanSchedulerService), que ja le a rotina mais recente
  // salva no banco. Isso elimina o motivo de existir qualquer limite de frequencia pra alterar
  // rotina: mudar nao chama IA nenhuma, entao pode ser ilimitado — so a ULTIMA versao salva antes
  // de domingo e usada.
  async generateFirstWeekIfNeeded(userId: string): Promise<void> {
    const [existingPlan, interview, availability, user] = await Promise.all([
      this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { completedAt: true } }),
      this.prisma.weeklyAvailability.findMany({ where: { userId, noTraining: false }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } }),
    ]);
    if (existingPlan || !interview?.completedAt) return;
    if (!user || !hasSubscriptionAccess(user.subscriptionStatus)) return;
    // A rotina (dias/modalidades/tempo) agora e coletada numa tela propria DEPOIS da confirmacao
    // do pagamento (menu Rotina de treinos), nao mais dentro da entrevista — se o pagamento
    // acabou de ser confirmado mas o aluno ainda nao passou por essa tela, nao ha rotina nenhuma
    // pra gerar em cima ainda. Quando ele completar a tela de rotina, este mesmo metodo (chamado
    // de novo dali) e quem dispara a geracao de verdade.
    if (!availability.length) return;

    await this.generateWeek(userId);
  }

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
    const [user, latestTest, availability, onboarding, previousPlans, recentStrava, latestExecutionInsight, activePlanBeforeAdjustment, activeDirectives, painSafety, targetRaces, latestReassessment, activeObservations, longestRunSession] = await Promise.all([
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
      this.targetRaces.activeGoals(userId),
      this.prisma.reassessment.findFirst({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: 'desc' } }),
      this.prisma.studentObservation.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'desc' } }),
      // Fato objetivo, calculado direto dos treinos realmente concluidos (nao um resumo em prosa
      // que outro agente escreveu) — "qual foi o maior longao que este aluno ja correu de verdade,
      // quando, e como ele avaliou aquele treino". previousPlans acima so cobre as ultimas 4
      // semanas, insuficiente para diretrizes de progressao que se estendem por meses/anos (ex:
      // preparacao de maratona). Sem cache_control possivel (varia por aluno), mas e so um lookup
      // determinístico — sem raciocinio de IA envolvido, entao nao pesa no "pensar" do agente.
      this.prisma.trainingSession.findFirst({
        where: {
          userId,
          modality: { in: ['corrida', 'esteira'] },
          completion: { status: { in: ['done', 'adjusted'] }, distanceKm: { not: null } },
        },
        orderBy: { completion: { distanceKm: 'desc' } },
        select: { scheduledDate: true, completion: { select: { distanceKm: true, satisfaction: true, details: true } } },
      }),
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
    // BUG REAL CORRIGIDO (09/08 — Roberta, "semana atual continua aparecendo a antiga mesmo apos
    // domingo 12h"): esse rollover pra semana seguinte, quando nao sobra nenhum dia disponivel
    // "futuro" na semana atual, so se aplicava na PRIMEIRA geracao de um aluno
    // (!activePlanBeforeAdjustment). Pra qualquer aluno que JA tinha plano ativo — ou seja,
    // praticamente todo mundo, sempre — regenerar (seja pelo botao da propria aluna ou pelo
    // "Refazer nova semana de treinos" do treinador) ficava PRESO regenerando a mesma semana que
    // ja tinha acabado, indefinidamente, mesmo bem depois de domingo 12h — nunca avancava pra
    // semana seguinte sozinho.
    // A correcao NAO pode ser so "tirar a restricao": isso rolaria pra semana seguinte tambem no
    // meio de semana comum (ex: aluna que so treina Seg/Ter, treinador regenera na quinta pra
    // corrigir algo — nao sobra dia "futuro" na rotina dela, mas ainda estamos dentro da MESMA
    // semana de calendario, e a intencao e mexer nessa semana, nao pular pra frente). O limite
    // certo e o do calendario: so rola pra semana seguinte quando ja passou do horario oficial de
    // liberacao (domingo, WEEKLY_RELEASE_HOUR) — os mesmo criterio que a aluna ve no app — e nao
    // sobrar dia futuro na semana atual, para qualquer aluno, novo ou nao.
    const hasFutureDayThisWeek = anyAvailableDayIsFuture(availableDays, initialWeekStart, today);
    const { weekday: todayWeekday, hour: todayHour } = saoPauloWeekdayAndHour(new Date());
    const pastWeeklyRelease = todayWeekday === 0 && todayHour >= WEEKLY_RELEASE_HOUR;
    const shouldRollToNextWeek = !hasFutureDayThisWeek && !options?.referenceDate && (!activePlanBeforeAdjustment || pastWeeklyRelease);
    const weekStart = shouldRollToNextWeek ? addDays(initialWeekStart, 7) : initialWeekStart;

    const methodologyHistory = previousPlans.map((historyPlan) => {
      const runSessions = historyPlan.sessions.filter((session) => isRunningModality(session.modality));
      const completedRuns = runSessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted');
      // O treino mais longo da semana (candidato mais provavel a ser uma prova/longao que a IA
      // queira citar em notes) — guardamos a data exata dele, nao so a duracao, pra IA nunca mais
      // ter que adivinhar "quando foi" (ver comentario em MethodologyHistoryWeek).
      const longestRun = completedRuns.reduce<(typeof completedRuns)[number] | null>((longest, session) => {
        const durationMin = session.completion?.durationMin ?? session.durationMin ?? 0;
        const longestDurationMin = longest ? (longest.completion?.durationMin ?? longest.durationMin ?? 0) : -1;
        return durationMin > longestDurationMin ? session : longest;
      }, null);
      return {
        runMinutes: runSessions.reduce((total, session) => total + (session.durationMin ?? 0), 0),
        completedRunMinutes: completedRuns.reduce((total, session) => total + (session.completion?.durationMin ?? session.durationMin ?? 0), 0),
        longestRunMinutes: Math.max(0, ...completedRuns.map((session) => session.completion?.durationMin ?? session.durationMin ?? 0)),
        prescribedSessions: historyPlan.sessions.length,
        completedSessions: historyPlan.sessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length,
        weekStartDate: historyPlan.startDate.toISOString().slice(0, 10),
        longestRunDate: longestRun ? longestRun.scheduledDate.toISOString().slice(0, 10) : null,
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
    // So chama a IA do prontuario se houver evento novo acumulado desde a ultima atualizacao —
    // ver StudentProfileService.refreshProfile. Falha aqui nunca bloqueia a geracao da semana.
    const studentProfileSummary = await this.studentProfile.refreshProfile(userId).catch(() => '');
    // So busca quando o recorde historico for >=8km (pedido explicito do treinador 10/08) — abaixo
    // disso o "recorde quente vs frio" nao importa pra decisao. Nao calcula nem julga nada aqui —
    // so traz os treinos concluidos nas ultimas 10 semanas que chegaram perto (>=50%) do recorde,
    // pra IA fazer essa leitura sozinha (ver regra no prompt de sistema).
    const recordDistanceKm = longestRunSession?.completion?.distanceKm ?? null;
    const recentSessionsNearRecord = recordDistanceKm != null && recordDistanceKm >= 8
      ? await this.prisma.trainingSession.findMany({
          where: {
            userId,
            modality: { in: ['corrida', 'esteira'] },
            completion: { status: { in: ['done', 'adjusted'] }, distanceKm: { gte: recordDistanceKm * 0.5 } },
            scheduledDate: { gte: addDays(startOfWeek(new Date()), -70) },
          },
          orderBy: { completion: { distanceKm: 'desc' } },
          take: 5,
          select: { scheduledDate: true, completion: { select: { distanceKm: true, details: true } } },
        })
      : [];
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
      studentProfileSummary,
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
      // Array agora (correcao real 16/08 — antes so a prova mais proxima era visivel pra IA,
      // uma segunda meta simultanea ficava invisivel; ver comentario em
      // TargetRacesService.activeGoals). Tambem ja vem sem provas vencidas (arquivadas
      // automaticamente ali mesmo).
      targetRaces: targetRaces.map((race) => ({
        name: race.name,
        raceDate: race.raceDate.toISOString(),
        distanceKm: race.distanceKm,
        paceSecondsPerKm: race.paceSecondsPerKm,
        performanceIntent: race.performanceIntent,
        socialIntent: race.socialIntent,
        personalImportance: race.personalImportance,
        perceivedDifficulty: race.perceivedDifficulty,
        dedicationWillingness: race.dedicationWillingness,
        achievementSatisfaction: race.achievementSatisfaction,
        confidenceLevel: race.confidenceLevel,
        injuryConcern: race.injuryConcern,
        adjustmentOpenness: race.adjustmentOpenness,
        anxietyLevel: race.anxietyLevel,
        isFirstTimeAtDistance: race.isFirstTimeAtDistance,
      })),
      longestRunEver: longestRunSession?.completion?.distanceKm != null ? {
        distanceKm: longestRunSession.completion.distanceKm,
        date: longestRunSession.scheduledDate.toISOString().slice(0, 10),
        satisfaction: longestRunSession.completion.satisfaction,
        // "Correu" e diferente de "completou" a distancia (pode ter caminhado/parado em trechos) —
        // autorrelato direto do aluno no formulario pos-treino, ver [[correr_vs_completar_distancia]].
        // Null quando o aluno nao respondeu essa pergunta (registros antigos, antes dela existir).
        pacingMode: (() => {
          const value = jsonObject(longestRunSession.completion.details).pacingMode;
          return typeof value === 'string' ? value : null;
        })(),
      } : null,
      recentSessionsNearRecord: recentSessionsNearRecord
        .filter((session): session is typeof session & { completion: { distanceKm: number; details: unknown } } => session.completion?.distanceKm != null)
        .map((session) => ({
          distanceKm: session.completion.distanceKm,
          date: session.scheduledDate.toISOString().slice(0, 10),
          pacingMode: (() => {
            const value = jsonObject(session.completion.details).pacingMode;
            return typeof value === 'string' ? value : null;
          })(),
        })),
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
      // Persistido (nao so em memoria) pra dar visibilidade permanente no painel do treinador (ver
      // statusFromSummary em coach.service.ts) — antes disso a falha so aparecia no Telegram na
      // hora e sumia; se o treinador nao visse a mensagem naquele momento, nunca mais ficava
      // sabendo que aquela aluna ficou sem semana gerada por causa disso.
      await this.prisma.user.update({ where: { id: userId }, data: { lastPlanGenerationFailedAt: new Date() } }).catch(() => null);
      await this.telegram.notifyCoach(
        `⚠️ Falha ao gerar treino com IA para um aluno.\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nO programa NAO foi atualizado — verifique a chave da IA (ANTHROPIC_API_KEY) e os logs do EasyPanel, e gere novamente manualmente pelo painel. Novas tentativas automaticas para este aluno ficam pausadas por alguns minutos para nao gastar chamadas de IA repetidas.`,
      );
      throw new InternalServerErrorException('Nao foi possivel gerar o treino com o agente de IA no momento. O treinador ja foi avisado.');
    }
    this.recentAiFailures.delete(userId);
    // Limpa a marca de falha permanente assim que uma geracao tiver sucesso (qualquer gatilho:
    // botao da aluna, botao do treinador, entrevista, mudanca de rotina) — o painel volta a
    // mostrar o status normal em vez de "falhou" assim que o problema se resolver sozinho.
    if (user.lastPlanGenerationFailedAt) {
      await this.prisma.user.update({ where: { id: userId }, data: { lastPlanGenerationFailedAt: null } }).catch(() => null);
    }
    const methodology = aiDecision;

    // Ordem explicita do treinador (02/08): quando a IA cobre menos/mais dias ou duracao
    // diferente da rotina cadastrada SEM nenhuma diretriz individual explicando o motivo, gera a
    // semana normalmente mesmo assim (nunca descarta por causa disso, ver validateSessions em
    // prescription-agent.service.ts) — so avisa o treinador que a rotina saiu diferente do
    // combinado. Com diretriz ativa, o desvio e esperado e nao precisa de aviso.
    if (methodology.routineMismatch && activeDirectives.length === 0) {
      await this.telegram.notifyCoach(
        `ℹ️ Treino gerado, mas com rotina diferente do estipulado (sem diretriz do gerente tecnico).\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\n${methodology.routineMismatch}`,
      ).catch(() => null);
    }

    // Agrupado por weekday (nao um Map de 1 pra 1) porque uma diretriz individual pode pedir mais
    // de uma sessao de corrida no mesmo dia (ver buildSystemPromptStable) — o codigo nao valida
    // isso, so aceita o que a IA decidiu. .shift() consome a PRIMEIRA decisao daquele dia pro slot
    // normal de disponibilidade; qualquer sobra (segunda sessao no mesmo dia, ou um dia que nem
    // estava na disponibilidade normal) vira sessao extra depois do loop principal.
    const runDecisionsByWeekday = new Map<number, RunSessionDecision[]>();
    for (const decision of methodology.sessions) {
      const list = runDecisionsByWeekday.get(decision.weekday) ?? [];
      list.push(decision);
      runDecisionsByWeekday.set(decision.weekday, list);
    }

    const sessions = availableDays.slice(0, 7).flatMap((day) => {
      const scheduledDate = addDays(weekStart, weekdayOffsetFromMonday(day.weekday));
      const modalities = day.modalities.length ? day.modalities : ['corrida'];

      return modalities.flatMap((modality) => {
        const baseTemplate = this.templateForModality(modality, Boolean(latestTest));
        const runDecision = isRunningModality(modality) ? runDecisionsByWeekday.get(day.weekday)?.shift() : undefined;
        // A IA pode legitimamente nao cobrir todo dia da rotina agora (ver routineMismatch —
        // isso so avisa o treinador, nao descarta mais a semana inteira). Sem decisao nenhuma
        // pra este dia de corrida, nao ha o que montar — pula o dia (sem sessao), em vez de
        // tentar montar um treino vazio e travar (bug real 02/08, encontrado pelo treinador
        // logo apos essa mudanca: "Distancia/pace ausentes ao montar a sessao").
        if (isRunningModality(modality) && !runDecision) return [];
        const strengthDecision = (modality === 'forca' || modality === 'fortalecimento_corredores')
          ? methodology.strengthSessions?.find((decision) => decision.weekday === day.weekday && decision.modality === modality)
          : undefined;
        const template = runDecision ? {
          ...baseTemplate,
          title: runDecision.title,
          sessionType: this.deriveSessionTypeLabel(runDecision),
          durationMin: runDecision.durationMin,
          notes: this.shouldSkipStandardWarmupCooldown(runDecision.parts)
            ? runDecision.notes
            : `${runDecision.notes} ${STANDARD_WARMUP_COOLDOWN_TEXT}`,
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
        if (isStrength && !strengthDecision) {
          // A validacao do agente de IA (validateStrengthSessions) exige cobertura exata dos
          // dias de forca/fortalecimento — chegar aqui sem decisao e um bug de sincronizacao
          // entre a disponibilidade usada no prompt e a usada aqui, nao um caso esperado.
          throw new InternalServerErrorException(`Decisao de forca ausente do agente de IA para o dia ${day.weekday} (${modality}).`);
        }
        const prescription =
          strengthDecision
            ? this.strengthPrescription(durationMin, strengthDecision)
            // A sequencia de partes vem inteiramente da decisao da IA para ESTE dia (runDecision) —
            // nao existe mais nenhuma conta de codigo (duracao/pace fixo) decidindo isso.
            : this.runPrescription(durationMin, modality, { parts: runDecision?.parts ?? [] });

        return [{
          userId,
          scheduledDate,
          weekday: day.weekday,
          modality,
          title: fixedModalityTitle(modality),
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
          paceMinSec: !isStrength && prescription.representativePaceSecondsPerKm != null
            ? formatPace(prescription.representativePaceSecondsPerKm)
            : null,
          structure: prescription as unknown as Prisma.InputJsonObject,
          notes: isStrength ? (strengthDecision?.notes ?? template.notes) : template.notes,
          videoRefs: [],
          // So marca quando NAO ha diretriz ativa (com diretriz, o desvio e esperado — mesma
          // regra usada pro aviso de rotina agregado da semana, ver logo acima). Aviso fica na
          // sessao especifica, o aluno ve na tela do treino e conta no feedback pos-treino como
          // foi (WorkoutCompletionsService encaminha isso pro treinador via Telegram).
          routineMismatchNote: activeDirectives.length === 0
            ? methodology.sessionMismatches?.[mismatchKeyFor(day.weekday, modality)] ?? null
            : null,
        }];
      });
    });

    // Sobras de runDecisionsByWeekday: segunda sessao de corrida no mesmo dia, ou um dia que a IA
    // adicionou fora da disponibilidade normal — so acontece quando uma diretriz individual pediu
    // isso explicitamente (ver buildSystemPromptStable). O loop principal acima so cobre 1 sessao
    // de corrida por (dia, modalidade) porque vem da disponibilidade cadastrada do aluno.
    // LIMITE DE BOM SENSO (incidente real 03/08 — Roberta): sem nenhum teto, um erro da IA
    // etiquetando varias sessoes com o weekday errado (ex: 6 sessoes todas marcadas "terca", zero
    // na segunda) empilhava tudo no mesmo dia sem nenhum aviso. Nenhuma diretriz de verdade pede
    // mais de uma sessao extra no mesmo dia — corta o excesso (mantem so a primeira sobra) e avisa
    // o treinador, em vez de aceitar cegamente qualquer quantidade.
    const MAX_EXTRA_SESSIONS_PER_WEEKDAY = 1;
    const extraRunSessions = [...runDecisionsByWeekday.entries()].flatMap(([weekday, leftover]) => {
      if (!leftover.length) return [];
      if (leftover.length > MAX_EXTRA_SESSIONS_PER_WEEKDAY) {
        this.logger.warn(`Cortado excesso de sessoes de corrida no weekday ${weekday}: IA devolveu ${leftover.length + 1} sessoes pra esse dia, mantendo so ${MAX_EXTRA_SESSIONS_PER_WEEKDAY + 1} (provavel erro de numeracao de dias da IA, nao diretriz de verdade).`);
        leftover = leftover.slice(0, MAX_EXTRA_SESSIONS_PER_WEEKDAY);
      }
      const scheduledDate = addDays(weekStart, weekdayOffsetFromMonday(weekday));
      return leftover.map((runDecision) => {
        const durationMin = runDecision.durationMin;
        const prescription = this.runPrescription(durationMin, 'corrida', { parts: runDecision.parts });
        return {
          userId,
          scheduledDate,
          weekday,
          modality: 'corrida',
          title: fixedModalityTitle('corrida'),
          sessionType: this.deriveSessionTypeLabel(runDecision),
          locationSuggestion: 'Livre',
          durationMin: prescription.durationMin ?? durationMin,
          distanceKm: prescription.distanceKm,
          intensityZone: null,
          paceMinSec: prescription.representativePaceSecondsPerKm != null ? formatPace(prescription.representativePaceSecondsPerKm) : null,
          structure: prescription as unknown as Prisma.InputJsonObject,
          notes: this.shouldSkipStandardWarmupCooldown(runDecision.parts)
            ? runDecision.notes
            : `${runDecision.notes} ${STANDARD_WARMUP_COOLDOWN_TEXT}`,
          videoRefs: [],
          routineMismatchNote: activeDirectives.length === 0
            ? (methodology.sessionMismatches?.[mismatchKeyFor(weekday, 'corrida')] ?? 'Este treino foi gerado a mais, alem do combinado na sua rotina para este dia.')
            : null,
        };
      });
    });
    sessions.push(...extraRunSessions);

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
    // TRAVA FINAL DE BOM SENSO (incidente real 09/08 — Roberta, 6 sessoes de corrida empilhadas no
    // mesmo dia; incidente real 10/08 — Lucelane, 2 sessoes de fortalecimento na segunda-feira,
    // uma delas com texto desatualizado de uma geracao/tentativa anterior): o teto de "sobras"
    // acima (MAX_EXTRA_SESSIONS_PER_WEEKDAY) so cobre o caso de a IA etiquetar mal o weekday
    // DENTRO desta mesma chamada — nao cobre outras fontes de duplicacao (ex: "Recuperar treinos
    // presos em programa antigo" reencaixando sessoes de tentativas antigas). Como ultima linha de
    // defesa, ANTES de gravar no banco, nunca deixa mais de 2 sessoes da MESMA modalidade sair na
    // mesma data exata — nenhum caso real de treino pede isso, e 2 ja cobre o unico cenario
    // legitimo (diretriz pedindo sessao extra no mesmo dia). Cobre TODAS as modalidades agora
    // (antes so cobria corrida — o buraco em forca/fortalecimento foi exatamente o que deixou a
    // duplicata da Lucelane passar batido).
    const MAX_SESSIONS_PER_EXACT_DATE_AND_MODALITY = 2;
    const sessionCountByDateAndModality = new Map<string, number>();
    const sessionsAfterDailyCap = sessions.filter((session) => {
      const key = `${session.scheduledDate.toISOString()}_${session.modality}`;
      const count = sessionCountByDateAndModality.get(key) ?? 0;
      if (count >= MAX_SESSIONS_PER_EXACT_DATE_AND_MODALITY) {
        this.logger.warn(`Cortado excesso de sessoes de ${session.modality} na data ${session.scheduledDate.toISOString()} para o aluno ${userId} (trava final, ja tinha ${count} sessoes nesse dia).`);
        return false;
      }
      sessionCountByDateAndModality.set(key, count + 1);
      return true;
    });

    const sessionsToCreate = sessionsAfterDailyCap.filter((session) =>
      session.scheduledDate.getTime() > today.getTime() ||
      (Boolean(options?.allowToday) && session.scheduledDate.getTime() === today.getTime()),
    );
    const plan = await this.prisma.trainingPlan.create({
      data: {
        userId,
        name: 'Programa semanal',
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
          targetRaces: methodologyInput.targetRaces,
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

    // Copia em texto da prescricao numerica que acabou de ser decidida — puro codigo, sem custo
    // de IA (a criacao do texto em si nao chama nenhum modelo). Vira insumo pro agente do
    // prontuario condensar antes da PROXIMA geracao de semana.
    const weekSummaryForProfile = plan.sessions
      .map((session) => {
        const parts = [`${weekdayLabel(session.weekday)} ${session.modality}: ${session.title}`];
        if (session.distanceKm) parts.push(`${session.distanceKm}km`);
        if (session.durationMin) parts.push(`${session.durationMin}min`);
        return parts.join(', ');
      })
      .join(' | ');
    void this.studentProfile
      .recordEvent(userId, ProfileEventCode.WEEK_GENERATED, `Semana de ${plan.startDate.toISOString().slice(0, 10)} gerada: ${weekSummaryForProfile}`)
      .catch(() => undefined);

    // Avisa o aluno so quando um plano de verdade vira a semana ATIVA dele (nunca na
    // pre-geracao "scheduled" de domingo, que ja tem seu proprio aviso — ver Sunday-19h
    // notice no app). E so um INSERT no banco, sem nenhuma chamada de IA — nao tem custo de
    // token nenhum gerar este aviso.
    if (planStatus === 'active') {
      await this.notifications.notifyUser(userId, {
        title: 'Novo treino gerado',
        message: 'Seu programa de treino desta semana foi atualizado automaticamente.',
        type: 'info',
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

  // Chamado todo domingo 19h (ver WeeklyPlanSchedulerService). NAO existe pre-geracao nem status
  // intermediario — ordem explicita do treinador (02/08, revertendo um erro meu de arquitetura
  // na mesma noite): o robo de domingo GERA a semana seguinte e ela ja nasce como o plano ATIVO
  // na hora, exatamente como qualquer regeneracao normal (arquivando a semana que estava em
  // andamento). Nao ha "agendado" esperando ser promovido depois — o que a IA termina de gerar
  // ja e, no mesmo instante, o que aparece pro treinador e pro aluno.
  async generateNextWeekIfMissing(userId: string) {
    const nextWeekStart = startOfWeek(addDays(new Date(), 7));
    const [existing, anyPlanEver] = await Promise.all([
      this.prisma.trainingPlan.findFirst({
        where: { userId, startDate: nextWeekStart },
        select: { id: true },
      }),
      this.prisma.trainingPlan.findFirst({
        where: { userId },
        select: { id: true },
      }),
    ]);
    if (existing) return;
    // Aluna sem NENHUM plano ainda: a primeira geracao dela e sempre disparada pelo proprio
    // gatilho de onboarding (ver completeOnboarding em me.service.ts), nunca por este cron. Sem
    // esta checagem, uma aluna que completa a entrevista num domingo antes das 19h — e cuja
    // rotina ja rola direto pra semana seguinte por nao sobrar dia disponivel nesta semana (ver
    // hasFutureDayThisWeek acima) — pode ter a propria chamada de generateWeek() e esta do cron
    // mirando exatamente a mesma semana ao mesmo tempo, uma brigando com a outra pelos mesmos
    // dados. Pulando aqui, a primeira geracao fica sempre por conta exclusiva do gatilho dela.
    if (!anyPlanEver) return;

    await this.generateWeek(userId, undefined, {
      referenceDate: addDays(new Date(), 7),
    });
  }

  // Chamado SOMENTE pelo botao explicito "Gerar treino da semana" no app da aluna (ver
  // POST /training-plans/generate-current-week) — nunca por abrir nenhuma tela, nem no app da
  // aluna nem no painel do treinador. Substitui a geracao em massa que rodava sozinha todo
  // domingo 19h (ver WeeklyPlanSchedulerService): agora a autorizacao libera as
  // WEEKLY_RELEASE_HOUR de domingo, mas a geracao de verdade so acontece quando a propria aluna
  // toca o botao — a partir do dia do toque em diante, nunca retroativo, mesmo que ela fique
  // semanas sem abrir o app.
  async generateCurrentWeekOnDemand(userId: string): Promise<{ generated: boolean; reason: string }> {
    const inFlight = this.currentWeekGenerationInFlight.get(userId);
    if (inFlight) return inFlight;

    const promise = this.doGenerateCurrentWeekOnDemand(userId).finally(() => {
      this.currentWeekGenerationInFlight.delete(userId);
    });
    this.currentWeekGenerationInFlight.set(userId, promise);
    return promise;
  }

  private async doGenerateCurrentWeekOnDemand(userId: string): Promise<{ generated: boolean; reason: string }> {
    const [anyPlanEver, user, availability] = await Promise.all([
      this.prisma.trainingPlan.findFirst({ where: { userId }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } }),
      this.prisma.weeklyAvailability.findMany({ where: { userId, noTraining: false } }),
    ]);
    // Aluna sem nenhum plano ainda: fluxo separado (generateFirstWeekIfNeeded, disparado ao
    // concluir a entrevista/rotina) — este botao so existe pra quem ja tem historico.
    if (!anyPlanEver) return { generated: false, reason: 'sem_plano_anterior' };
    if (!user || !hasSubscriptionAccess(user.subscriptionStatus)) return { generated: false, reason: 'sem_acesso_pagamento' };
    if (!availability.length) return { generated: false, reason: 'sem_rotina_cadastrada' };

    const { weekday, hour } = saoPauloWeekdayAndHour(new Date());
    if (weekday === 0 && hour < WEEKLY_RELEASE_HOUR) {
      return { generated: false, reason: 'antes_do_horario_de_liberacao' };
    }

    const today = todayInSaoPaulo();
    const initialWeekStart = startOfWeek(new Date());
    const targetWeekStart = anyAvailableDayIsFuture(availability, initialWeekStart, today)
      ? initialWeekStart
      : addDays(initialWeekStart, 7);

    const existingPlanForWeek = await this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'active', startDate: targetWeekStart },
      select: { id: true },
    });
    if (existingPlanForWeek) return { generated: false, reason: 'ja_gerado' };

    const allowToday = hour < TODAY_INCLUSION_CUTOFF_HOUR;
    await this.generateWeek(userId, undefined, { allowToday });

    const diasDeAtraso = Math.max(0, Math.round((today.getTime() - targetWeekStart.getTime()) / 86400000));
    void this.studentProfile
      .recordEvent(
        userId,
        ProfileEventCode.WEEK_GENERATED,
        diasDeAtraso > 0
          ? `Semana de ${targetWeekStart.toISOString().slice(0, 10)} gerada sob demanda pela aluna (botao "Gerar treino da semana"), ${diasDeAtraso} dia(s) apos a liberacao.`
          : `Semana de ${targetWeekStart.toISOString().slice(0, 10)} gerada sob demanda pela aluna (botao "Gerar treino da semana"), no dia da liberacao.`,
      )
      .catch(() => undefined);

    return { generated: true, reason: 'ok' };
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
      throw new BadRequestException('Aluno nao tem programa ativo no momento.');
    }

    const today = todayInSaoPaulo();
    const existingSessions = await this.prisma.trainingSession.findMany({
      where: { planId: activePlan.id },
      select: { scheduledDate: true, modality: true },
    });
    // Chave por DIA calendario (nao timestamp exato) — tentativas de geracao diferentes no mesmo
    // dia podem produzir scheduledDate com milissegundos/horario ligeiramente diferentes mesmo
    // sendo "o mesmo dia", o que deixava a comparacao por timestamp exato passar batido e
    // duplicar sessoes no mesmo dia (incidente real 09/08 — Roberta, corrida; incidente real
    // 10/08 — Lucelane, fortalecimento — o teto abaixo so cobria corrida ate entao).
    const dateKeyOf = (date: Date) => date.toISOString().slice(0, 10);
    const existingKeys = new Set(existingSessions.map((session) => `${dateKeyOf(session.scheduledDate)}_${session.modality}`));
    const existingCountByDateAndModality = new Map<string, number>();
    for (const session of existingSessions) {
      const key = `${dateKeyOf(session.scheduledDate)}_${session.modality}`;
      existingCountByDateAndModality.set(key, (existingCountByDateAndModality.get(key) ?? 0) + 1);
    }

    const orphanedSessions = await this.prisma.trainingSession.findMany({
      where: {
        plan: { userId, status: 'archived' },
        scheduledDate: { gte: activePlan.startDate, lt: today },
      },
      include: { completion: true },
    });

    // Teto por (data exata, modalidade) — cobre qualquer modalidade agora, nao so corrida.
    const MAX_SESSIONS_PER_EXACT_DATE_AND_MODALITY = 2;
    const toRecover = orphanedSessions.filter((session) => {
      const key = `${dateKeyOf(session.scheduledDate)}_${session.modality}`;
      if (existingKeys.has(key)) return false;
      const count = existingCountByDateAndModality.get(key) ?? 0;
      if (count >= MAX_SESSIONS_PER_EXACT_DATE_AND_MODALITY) {
        this.logger.warn(`Recuperacao de treinos presos: ignorada sessao extra de ${session.modality} em ${dateKeyOf(session.scheduledDate)} para o aluno ${userId} (ja tinha ${count} nesse dia).`);
        return false;
      }
      existingCountByDateAndModality.set(key, count + 1);
      existingKeys.add(key);
      return true;
    });

    if (!toRecover.length) {
      return { recovered: 0 };
    }

    await this.prisma.trainingSession.updateMany({
      where: { id: { in: toRecover.map((session) => session.id) } },
      data: { planId: activePlan.id },
    });

    return { recovered: toRecover.length };
  }

  // Chamado pelo botao "Reagendar" da propria aluna (app) — move um treino ja gerado pra outro
  // dia da MESMA semana, sem gerar nada novo com IA (custo zero, so troca a data). Pedido antigo
  // do treinador ("o aluno precisa ter essa flexibilidade, pois isso ja gera uma independencia
  // dele da gente"). Substitui o "moveSession" antigo do app, que so mudava visualmente no
  // celular e nunca persistia nada de verdade.
  async rescheduleSession(userId: string, sessionId: string, targetWeekday: number) {
    if (!Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) {
      throw new BadRequestException('Dia da semana invalido.');
    }
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId },
      include: { plan: { select: { startDate: true } }, completion: { select: { id: true } } },
    });
    if (!session) {
      throw new NotFoundException('Treino nao encontrado.');
    }
    if (session.completion) {
      throw new BadRequestException('Esse treino ja foi concluido, nao da pra reagendar.');
    }

    const newDate = addDays(session.plan.startDate, weekdayOffsetFromMonday(targetWeekday));
    const today = todayInSaoPaulo();
    if (newDate.getTime() < today.getTime()) {
      throw new BadRequestException('Nao e possivel reagendar um treino para um dia que ja passou.');
    }

    const collision = await this.prisma.trainingSession.findFirst({
      where: { planId: session.planId, weekday: targetWeekday, modality: session.modality, id: { not: session.id } },
      select: { id: true },
    });
    if (collision) {
      throw new BadRequestException(`Ja existe um treino de ${session.modality} nesse dia.`);
    }

    await this.prisma.trainingSession.update({
      where: { id: session.id },
      data: { scheduledDate: newDate, weekday: targetWeekday },
    });
    return { rescheduled: true };
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
    const durationMin = session.durationMin ?? 45;

    // notes escrito pela IA para este dia de forca/fortalecimento especifico — antes deste fix
    // (2026-07-31) o update() abaixo nunca gravava esse campo, entao "Refazer" um dia avulso de
    // forca atualizava so exercicios/series/reps e deixava o texto antigo (ou o generico) parado
    // na tela. O titulo NAO e mais atualizado aqui: e sempre o nome fixo da modalidade
    // (fixedModalityTitle), decidido na criacao da sessao e nunca reescrito pela IA (pedido
    // explicito do treinador 03/08 — sem titulos "criativos").
    let strengthNotesUpdate: string | undefined;

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
          `⚠️ Falha ao gerar treino de forca avulso com IA.\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nO treino NAO foi atualizado — verifique a chave da IA e tente novamente pelo painel.`,
        );
        throw new InternalServerErrorException('Nao foi possivel gerar o treino com o agente de IA no momento. O treinador ja foi avisado.');
      }
      prescription = this.strengthPrescription(durationMin, strengthDecision);
      strengthNotesUpdate = strengthDecision.notes;
    } else {
      const paceEvidence: PaceEvidence = {
        testPace: latestTest ? { secondsPerKm: latestTest.paceSecondsPerKm, daysAgo: Math.max(0, Math.floor((Date.now() - latestTest.createdAt.getTime()) / 86400000)) } : null,
        selfReportedPace: paceFallback ? { secondsPerKm: paceFallback.paceSecondsPerKm, source: paceFallback.source } : null,
        stravaAveragePace: null,
      };
      // Decide TUDO deste dia numa unica chamada (distancia, pace, estrutura) — nunca reaproveita
      // um pace guardado de outro dia nem calcula distancia por formula (ver proposeRunSession).
      // Nao ha mais categoria pre-definida (sessionType) pra informar — a IA decide a forma do
      // treino do zero, olhando o contexto real deste dia.
      const runDecision = await this.prescriptionAgent.proposeRunSession({
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
          `⚠️ Falha ao gerar treino avulso com IA.\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nO treino NAO foi atualizado — verifique a chave da IA e tente novamente pelo painel.`,
        );
        throw new InternalServerErrorException('Nao foi possivel gerar o treino com o agente de IA no momento. O treinador ja foi avisado.');
      }
      prescription = this.runPrescription(durationMin, session.modality, runDecision);
    }

    return this.prisma.trainingSession.update({
      where: { id: sessionId },
      data: {
        distanceKm: prescription.distanceKm,
        paceMinSec: !isStrength && prescription.representativePaceSecondsPerKm != null
          ? formatPace(prescription.representativePaceSecondsPerKm)
          : null,
        structure: prescription as unknown as Prisma.InputJsonObject,
        ...(strengthNotesUpdate ? { notes: strengthNotesUpdate } : {}),
      },
    });
  }

  // Treino adicionado manualmente pelo treinador num dia especifico (ex: depois de uma conversa
  // pessoal com o aluno) — pedido explicito do treinador, 2026-08-01. Cria so o "casco" vazio da
  // sessao (sem IA, zero custo); o preenchimento de verdade acontece depois, na mesma tela de
  // edicao ja usada pra qualquer treino: o treinador digita na mao, ou clica em "Gerar novo
  // treino" (regenerateSession) pra pedir pra IA.
  async createManualSession(userId: string, input: { scheduledDate: string; modality: string }) {
    const [year, month, day] = input.scheduledDate.split('-').map(Number);
    const scheduledDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Data invalida.');
    }
    const today = todayInSaoPaulo();
    if (scheduledDate.getTime() < today.getTime()) {
      throw new BadRequestException('Nao e possivel adicionar um treino num dia que ja passou.');
    }

    const activePlan = await this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!activePlan) {
      throw new BadRequestException('Este aluno ainda nao tem um programa ativo — gere a semana antes de adicionar um treino avulso.');
    }

    const existing = await this.prisma.trainingSession.findFirst({
      where: { userId, scheduledDate, modality: input.modality },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Ja existe um treino dessa modalidade cadastrado para esse dia.');
    }

    const isStrength = input.modality === 'forca' || input.modality === 'fortalecimento_corredores';
    const title = fixedModalityTitle(input.modality);
    const structure: Prisma.InputJsonObject = isStrength
      ? { type: 'strength', category: title, exercises: [] }
      : { type: 'run', blocks: [] };

    const session = await this.prisma.trainingSession.create({
      data: {
        planId: activePlan.id,
        userId,
        scheduledDate,
        weekday: scheduledDate.getUTCDay(),
        modality: input.modality,
        title,
        locationSuggestion: 'Livre',
        structure,
      },
    });

    await this.notifications.notifyUser(userId, {
      title: 'Novo treino adicionado',
      message: 'O seu treinador adicionou um treino extra na sua semana.',
      type: 'info',
    });

    void this.studentProfile.recordEvent(
      userId,
      ProfileEventCode.DIRECTIVE_ADDED,
      `Treinador adicionou manualmente um treino de ${title} para o dia ${input.scheduledDate}.`,
    ).catch(() => undefined);

    return session;
  }

  // Rotulo puramente cosmetico, guardado so pra referencia futura do treinador no admin — nunca
  // lido de volta por nenhuma logica (a IA nao declara mais uma categoria, ver AiSessionSchema em
  // prescription-agent.service.ts). Derivado do que a propria IA preencheu pra aquele dia.
  private deriveSessionTypeLabel(decision: { parts?: SessionPartDecision[] } | undefined): string {
    if (!decision?.parts?.length) return 'corrida';
    if (decision.parts.length > 1) return 'misto';
    return decision.parts[0].kind === 'intervalada' ? 'intervalado' : 'continuo';
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

    if (modality === 'esteira') {
      return {
        title: 'Corrida na esteira',
        modality,
        sessionType: 'aerobic',
        zone: 'Z2',
        durationMin: 45,
        notes: 'Manter intensidade controlada e respiracao confortavel.',
      };
    }

    return {
      title: 'Corrida leve',
      modality: 'corrida',
      sessionType: 'continuo',
      zone: 'Z2',
      durationMin: 50,
      notes: hasTest ? 'Manter ritmo confortavel dentro da zona indicada.' : 'Manter conforto respiratorio.',
    };
  }

  // Nao existe mais categoria (sessionType) escolhida de antemao pela IA — ela descreve o treino
  // como uma sequencia ordenada de "parts" (ver AiSessionSchema em prescription-agent.service.ts),
  // normalmente 1 so, mas pode ser varias quando o treino for misto (ex: caminhada, depois um
  // bloco intervalado, depois mais caminhada — pedido explicito do treinador 10/08). Aqui so
  // montamos um bloco de exibicao por parte e somamos os totais — nao ha julgamento de conteudo
  // aqui, so formatacao do que a IA ja decidiu.
  private runPrescription(durationMin: number, modality: string, decision: { parts: SessionPartDecision[] }) {
    if (!decision.parts.length) {
      throw new InternalServerErrorException(`Nenhuma parte preenchida ao montar a sessao (durationMin=${durationMin}) — bug de sincronizacao entre a decisao da IA e a montagem da sessao.`);
    }
    // Aquecimento e desaquecimento GENERICOS nao fazem parte do treino prescrito nem da distancia/
    // duracao total quando o dia e simples (1 parte) — viram um texto padrao apendado ao final de
    // "notes" so nesse caso (ver STANDARD_WARMUP_COOLDOWN_TEXT/shouldSkipStandardWarmupCooldown).
    // Quando o dia tem varias partes, cada uma (inclusive uma caminhada real no inicio/fim) conta
    // de verdade pra distancia/duracao total — isso evita o erro que ja aconteceu na pratica: um
    // treino misto onde a caminhada real do inicio/fim nao entrava no total, subestimando o
    // volume/tempo real do aluno naquele dia (incidente real 10/08).
    const multiPart = decision.parts.length > 1;
    const blocks: RunBlock[] = decision.parts.map((part, index) => this.blockForPart(part, multiPart ? `Parte ${index + 1}` : null));

    const intervalPart = decision.parts.find((part): part is Extract<SessionPartDecision, { kind: 'intervalada' }> => part.kind === 'intervalada');
    // Parte "representativa" pra exibir um pace/velocidade unico no resumo do dia: prefere a
    // parte intervalada (o estimulo principal), senao a maior parte continua (o trecho mais
    // significativo do dia) — mesma logica de sempre, so adaptada pra uma lista de partes.
    const representativePaceSecondsPerKm = intervalPart
      ? intervalPart.stimulusPaceSecondsPerKm
      : (() => {
          const continuousParts = decision.parts.filter((part): part is Extract<SessionPartDecision, { kind: 'continua' }> => part.kind === 'continua');
          const mainPart = [...continuousParts].sort((left, right) => right.distanceKm - left.distanceKm)[0];
          return Math.round((mainPart.paceSecondsPerKmMin + mainPart.paceSecondsPerKmMax) / 2);
        })();

    return {
      type: 'run',
      modality,
      distanceKm: this.totalBlockDistance(blocks),
      durationMin: this.midpointDuration(blocks),
      durationRange: this.totalDurationRange(blocks),
      speedKmh: Number((3600 / representativePaceSecondsPerKm).toFixed(1)),
      representativePaceSecondsPerKm,
      blocks,
      reportFields: ['distanceKm', 'durationMin', 'pace', 'speedKmh', 'heartRate', 'rpe', 'notes'],
    };
  }

  private blockForPart(part: SessionPartDecision, forcedLabel: string | null): RunBlock {
    if (part.kind === 'intervalada') {
      return {
        label: forcedLabel ?? 'Serie intervalada',
        repeatCount: part.repeatCount,
        steps: [
          this.intervalStep(part.stimulusLabel, part.stimulusStepKm, part.stimulusPaceSecondsPerKm),
          this.intervalStep(part.recoveryLabel, part.recoveryStepKm, part.recoveryPaceSecondsPerKm),
        ],
      };
    }
    return this.runDistanceBlock(forcedLabel ?? 'Principal', part.distanceKm, part.paceSecondsPerKmMin, part.paceSecondsPerKmMax);
  }

  // Skip do texto fixo de aquecimento/resfriamento (ver STANDARD_WARMUP_COOLDOWN_TEXT) quando o
  // proprio treino ja se inicia com uma caminhada de verdade — pedido explicito do treinador
  // (10/08): nao faz sentido repetir a instrucao quando a primeira parte do treino ja e uma
  // caminhada de pelo menos 5 minutos, descrita pela propria IA.
  private shouldSkipStandardWarmupCooldown(parts: SessionPartDecision[]): boolean {
    if (parts.length < 2) return false;
    const first = parts[0];
    if (first.kind !== 'continua') return false;
    const averagePaceSecondsPerKm = (first.paceSecondsPerKmMin + first.paceSecondsPerKmMax) / 2;
    const firstPartDurationMin = (first.distanceKm * averagePaceSecondsPerKm) / 60;
    return firstPartDurationMin >= STANDARD_WARMUP_COOLDOWN_MIN_LEADING_WALK_MIN;
  }

  private runDistanceBlock(label: string, distanceKm: number, paceSecondsPerKmMin: number, paceSecondsPerKmMax: number, guidance?: string) {
    const fast = Math.min(paceSecondsPerKmMin, paceSecondsPerKmMax);
    const slow = Math.max(paceSecondsPerKmMin, paceSecondsPerKmMax);
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

  // Os exercicios, o foco muscular do dia, sets/reps/descanso/intensidade sao TODOS decisao real
  // da IA (ver StrengthSessionDecision e validateStrengthSessions em prescription-agent.service.ts)
  // — esta funcao so resolve os ids escolhidos contra o catalogo aprovado e monta a estrutura de
  // exibicao, sem nenhuma escolha propria de treino.
  private strengthPrescription(durationMin: number, decision: StrengthSessionDecision) {
    const isRunnerStrength = decision.modality === 'fortalecimento_corredores';
    const category = isRunnerStrength ? 'Fortalecimento para corredores' : 'Musculacao';
    const catalog = isRunnerStrength ? runnerStrengthExercises : gymExerciseLibrary;
    // Normalmente todo exerciseId vem do catalogo curado (com video/descricao). Um id fora do
    // catalogo so acontece quando uma diretriz individual do treinador pediu um exercicio
    // especifico por nome (ver validateStrengthSessions em prescription-agent.service.ts) — nesse
    // caso mostra o texto literal que a IA escreveu, sem video/descricao, em vez de descartar o
    // exercicio da sessao silenciosamente.
    const exercises = decision.exerciseIds.map(
      (id) => catalog.find((item) => item.id === id) ?? { id, name: id, description: null as string | null },
    );

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
        // So faz sentido recomendar cadencia especifica em musculacao, onde e so uma forma de
        // variar o estimulo (nao muda ganho de forca nem hipertrofia — controlado ou explosivo dao
        // no mesmo pra isso). Em fortalecimento para corredores o objetivo e outro (pliometria,
        // stiffness, coordenacao, potencia) e uma instrucao de cadencia lenta ali contradiz o
        // proprio exercicio — por isso nunca aparece pra essa categoria.
        cadence: isRunnerStrength ? null : ('group' in exercise && exercise.group === 'core' ? 'Execucao lenta e controlada' : '2s na fase excentrica / subida controlada'),
        loadField: !isRunnerStrength && 'group' in exercise && exercise.group !== 'core',
      })),
      reportFields: isRunnerStrength
        ? ['exercise', 'sets', 'reps', 'load', 'rpe', 'completed', 'notes', 'videoUrl']
        : ['exercise', 'sets', 'reps', 'load', 'rpe', 'completed', 'notes'],
    };
  }
  private presentPlan(plan: {
    id: string;
    planCode: number;
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
      routineMismatchNote: string | null;
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
      // Codigo de rastreio (pedido do treinador 16/08) — numero de controle sequencial pra
      // referenciar esta prescricao especifica em conversa/suporte, sem ambiguidade.
      planCode: plan.planCode,
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
        // Campo unico de texto explicativo — antes existia "recommendations" separado, removido
        // em 07/08. Sessoes antigas que ainda tem algo la (dado historico, nao apagado do banco)
        // continuam aparecendo, so que juntas com notes num unico texto pro aluno.
        notes: [session.notes, session.recommendations].filter(Boolean).join(' '),
        routineMismatchNote: session.routineMismatchNote,
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

function saoPauloWeekdayAndHour(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(date);
  const weekdayShort = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdayMap[weekdayShort] ?? -1, hour };
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

// Extraido de generateWeek/shouldDelayFirstGenerationToSunday (antes duplicado) — usado tambem
// por generateCurrentWeekOnDemand: verdadeiro se algum dia disponivel da semana (a partir de
// weekStart) ainda esta no futuro em relacao a hoje. Quando falso, quem chama deve rolar pra
// semana seguinte em vez de gerar a atual (ex: domingo, quando nenhum dia desta semana resta).
function anyAvailableDayIsFuture(availableDays: Array<{ weekday: number }>, weekStart: Date, today: Date): boolean {
  return availableDays.some((day) => addDays(weekStart, weekdayOffsetFromMonday(day.weekday)).getTime() > today.getTime());
}

const WEEKDAY_LABELS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
function weekdayLabel(weekday: number) {
  return WEEKDAY_LABELS[weekday] ?? String(weekday);
}

function isRunningModality(modality: string) {
  return modality === 'corrida' || modality === 'esteira';
}

// Titulo da sessao passa a ser SEMPRE o nome fixo da modalidade — nao e mais texto livre da IA
// (pedido explicito do treinador 03/08: nada de titulos "criativos" tipo "treino de forca de
// tornozelo", so os 3 nomes abaixo, sempre). A IA pode ate continuar escrevendo um titulo no
// campo bruto da decisao, mas ele e sempre substituido por este valor fixo ao montar a sessao.
function fixedModalityTitle(modality: string): string {
  if (modality === 'fortalecimento_corredores') return 'Fortalecimento para corredores';
  if (modality === 'forca') return 'Musculação';
  return 'Corrida';
}

// Mesma chave usada em WeeklyMethodologyDecision.sessionMismatches (ver prescription-agent.service.ts
// validateSessions/validateStrengthSessions) — qualquer sessao de corrida (corrida ou esteira) usa
// a chave fixa "weekday:corrida", forca/fortalecimento usam "weekday:modalidade real".
function mismatchKeyFor(weekday: number, modality: string): string {
  return isRunningModality(modality) ? `${weekday}:corrida` : `${weekday}:${modality}`;
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
