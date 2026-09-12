'use client';

import { Activity, AlertTriangle, ArrowUp, Bell, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CreditCard, Eye, EyeOff, FileText, Flag, Flame, Gauge, LayoutDashboard, LogIn, Menu, Plus, RefreshCw, Save, Search, Ticket, Trash2, TrendingUp, UserRound, UserX, Users, X } from 'lucide-react';
import type { ReactNode } from 'react';
import React, { useEffect, useRef, useState } from 'react';

const API_URL = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
const STUDENT_APP_URL = 'https://agenteselton-panzeri-run-app.hbljgk.easypanel.host';

interface DashboardResponse {
  totals: {
    students: number;
    activePlans: number;
    prescribedSessions: number;
    completedSessions: number;
    differentSessions: number;
    adherencePercent: number;
    paymentConfirmed: number;
    courtesyAccess: number;
    paymentOverdue: number;
    paymentPending: number;
    plansCreatedThisWeek: number;
  };
  students: StudentRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

// 07/09: substituída a interface antiga (baseada em tabela de alunos) pelo novo endpoint
// /analytics/funnel que rastreia eventos reais de funil (app_opened → pagamento).
interface FunnelReport {
  days: number;
  since: string;
  preCadastroDropoff: number;
  funnel: Array<{ event: string; label: string; sessions: number }>;
  questionErrors: Array<{ questionId: string | null; count: number }>;
  stalledSessions: Array<{
    sessionId: string;
    userId: string | null;
    userName: string | null;
    signedUpAt: string;
    lastEvent: string | null;
    lastQuestionId: string | null;
    lastSeenHoursAgo: number | null;
    hasError: boolean;
    lastError: { questionId: string | null; metadata: unknown; at: string } | null;
  }>;
}

type AdminView = 'dashboard' | 'students' | 'prospects' | 'exStudents' | 'weeks' | 'coupons' | 'finance' | 'notifications' | 'funnel' | 'raceCalendar';

// 10/09: calendário global de provas alvo — retornado por GET /coach/races/calendar.
interface RaceCalendarEntry {
  id: string;
  studentName: string | null;
  studentCode: number | null;
  name: string;
  raceDate: string; // YYYY-MM-DD
  distanceKm: number | null;
  targetSeconds: number | null;
  priority: string | null;
  paceSecondsPerKm: number | null;
}

type ExStudentRow = {
  id: string;
  studentCode: string;
  name: string;
  email: string;
  goal: string;
  studentSince: string;
  canceledAt: string;
  daysSinceSignup: number;
  selfRequested: boolean;
};

interface ProspectRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  level: 'quente' | 'morno' | 'frio';
  levelLabel: string;
}

interface StudentRow {
  id: string;
  studentCode: string;
  name: string;
  email: string;
  goal: string;
  planName: string;
  adherencePercent: number;
  completedSessions: number;
  prescribedSessions: number;
  differentSessions: number;
  missedSessions: number;
  prescribedKm: number;
  completedKm: number;
  lastThreeKm: string;
  status: string;
  accountStatus: string;
  subscriptionStatus?: string;
  subscriptionManualOverride?: boolean;
  billingNextChargeAt?: string | null;
  billingProviderStatus?: string | null;
  billingLastSyncAt?: string | null;
  stravaConnected?: boolean;
  stravaLastSyncAt?: string | null;
}

interface StudentDetail {
  id: string;
  studentCode: string;
  name: string;
  email: string;
  phone?: string | null;
  accountStatus: string;
  subscriptionStatus: string;
  subscriptionUpdatedAt?: string | null;
  subscriptionManualOverride?: boolean;
  billing?: {
    provider: string;
    providerStatus: string;
    nextChargeAt: string | null;
    lastSyncAt: string | null;
    checkoutUrl: string | null;
  } | null;
  needsUpdate?: boolean;
  needsUpdateReason?: string | null;
  generationBlocked?: boolean;
  strava?: { connected: boolean; automaticSync: boolean; lastActivityAt?: string | null };
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  cpf?: string | null;
  education?: string | null;
  address?: string | null;
  goal: string;
  targetRaces?: Array<{
    id: string;
    name: string;
    raceDate: string;
    distanceKm: number;
    targetSeconds: number | null;
    priority: string;
    status: string;
    paceSecondsPerKm: number | null;
  }>;
  analysisAgent?: {
    updatedAt: string;
    summary: {
      coachAnalysis?: { title?: string; text?: string };
      adherencePercent?: number;
      executionPercent?: number;
      progression?: {
        loadTrend?: string;
        distanceChangePercent?: number | null;
        last28Days?: {
          sessions?: number;
          distanceKm?: number;
          durationMin?: number;
          longestDistanceKm?: number;
          averagePace?: string | null;
          averageHeartRate?: number | null;
        };
      };
      analysisAgent?: { analyzedAt?: string; trigger?: string };
    };
  } | null;
  interview?: {
    answers: Record<string, unknown>;
    currentStep: number;
    completedAt?: string | null;
    updatedAt: string;
  } | null;
  health: {
    sleep: string;
    stress: string;
    anxiety?: string;
    injuries: string;
    healthProblems?: string;
    medications?: string;
  };
  preferences?: {
    preferredModalities: string[];
    otherModalities: string[];
    trainingLocations: string[];
  };
  availability?: Array<{
    weekday: number;
    noTraining: boolean;
    modalities: string[];
    availableMin?: number | null;
    modalityDurations?: Record<string, number> | null;
  }>;
  tests: Array<{ date: string; totalSeconds: number; pace: string; vo2max: number }>;
  observations?: Array<{
    id: string;
    content: string;
    active: boolean;
    createdAt: string;
  }>;
  reassessments?: Array<{
    completedAt: string | null;
    answers: Record<string, unknown>;
    evolutionSummary?: string | null;
    evolutionWins?: string[];
    evolutionConcerns?: string[];
  }>;
  plan: {
    planCode: number;
    name: string;
    startDate: string;
    recommendation?: string | null;
    methodology?: {
      rationale: string[];
      safetyAdjustment: boolean;
    } | null;
    summary: {
      prescribedSessions: number;
      completedSessions: number;
      missedSessions: number;
      differentSessions: number;
      prescribedKm: number;
      completedKm: number;
      adherencePercent: number;
    };
    sessions: Array<{
      id: string;
      date: string;
      weekday: number;
      title: string;
      modality: string;
      durationMin?: number | null;
      distanceKm?: number | null;
      zone?: string | null;
      pace?: string | null;
      sessionType?: string | null;
      structure?: Record<string, unknown> | null;
      completionStatus: string;
      perceivedEffort?: number | null;
      satisfactionElaboracao?: string | null;
      satisfaction?: string | null;
      satisfactionCapacidade?: string | null;
      satisfactionCarga?: string | null;
      feedback?: string | null;
      notes?: string | null;
      completedDurationMin?: number | null;
      completedDistanceKm?: number | null;
      completedPaceSecondsKm?: number | null;
      completedAt?: string | null;
      stravaActivity?: StravaActivity | null;
    }>;
  } | null;
  unmatchedStravaActivities?: StravaActivity[];
  reports?: CoachReport[];
  history?: Array<{
    id: string;
    name: string;
    status: string;
    startDate: string;
    endDate?: string | null;
    summary: {
      prescribedSessions: number;
      completedSessions: number;
      adherencePercent: number;
      prescribedKm: number;
      completedKm: number;
    };
    sessions?: Array<{
      id: string;
      date: string;
      weekday: number;
      title: string;
      modality: string;
      durationMin?: number | null;
      distanceKm?: number | null;
      zone?: string | null;
      structure?: Record<string, unknown> | null;
      notes?: string | null;
      completionStatus: string;
      completedAt?: string | null;
      completedDurationMin?: number | null;
      completedDistanceKm?: number | null;
      completedPaceSecondsKm?: number | null;
      perceivedEffort?: number | null;
      satisfactionElaboracao?: string | null;
      satisfaction?: string | null;
      satisfactionCapacidade?: string | null;
      satisfactionCarga?: string | null;
      feedback?: string | null;
      // Feedback v1 — bloco 1
      preSleepQuality?: number | null;
      prePhysicalFatigue?: number | null;
      preStressLevel?: number | null;
      preMotivation?: number | null;
      // Feedback v1 — bloco 2
      postWorkoutFeeling?: number | null;
      postWorkoutMood?: number | null;
      // Feedback v1 — bloco 3
      painFlag?: string | null;
      painTiming?: string | null;
      feedbackVersion?: number | null;
    }>;
  }>;
}

interface StravaActivity {
  id: string;
  stravaId: string;
  name?: string | null;
  type?: string | null;
  startDate: string;
  distanceKm?: number | null;
  durationMin?: number | null;
  paceSecondsKm?: number | null;
  averageHeartRate?: number | null;
  maxHeartRate?: number | null;
}
interface CoachReport {
  id: string;
  reportType: string;
  title: string;
  content: { generatedAt?: string; metrics?: Record<string, unknown>; sections?: Array<{ title: string; text: string }> };
  createdAt: string;
}

interface CouponRow {
  id: string;
  code: string;
  name: string;
  discountPercent: number;
  active: boolean;
  usageCount: number;
  redemptions?: Array<{ id: string; createdAt: string; student: { id: string; name: string; email: string; subscriptionStatus?: string } }>;
}

interface FinanceResponse {
  priceLabel: string;
  activePlans: number;
  payingPlans: number;
  courtesyPlans: number;
  pendingPlans: number;
  overduePlans: number;
  canceledPlans: number;
  estimatedMonthlyRevenueCents: number;
  coupons: Array<{ id: string; code: string; discountPercent: number; active: boolean; usageCount: number; redemptions: number }>;
}

interface CoachNotification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export default function AdminHome() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  // 28/08: guarda a promessa de renovacao de sessao em andamento (nao um estado de UI) — chamadas
  // concorrentes de refreshAdminSession esperam essa mesma promessa em vez de disparar pedidos
  // de refresh separados pro backend, que so aceita um refresh token valido por vez.
  const refreshPromiseRef = useRef<Promise<string> | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [funnelReport, setFunnelReport] = useState<FunnelReport | null>(null);
  const [loadingFunnel, setLoadingFunnel] = useState(false);
  const [raceCalendar, setRaceCalendar] = useState<RaceCalendarEntry[] | null>(null);
  const [loadingRaceCalendar, setLoadingRaceCalendar] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);
  // 01/09: 'list' e 'detail' sao os dois "modos" da view Alunos (pedido do treinador — antes era
  // sempre lista + painel gigante empilhados na mesma tela, ele precisava rolar/printar varias
  // vezes so pra mostrar um caso). Fica de fora de AdminView de proposito: e' um detalhe interno
  // so' da view 'students', nao uma aba nova no menu principal.
  const [studentViewMode, setStudentViewMode] = useState<'list' | 'detail'>('list');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [trainingFilter, setTrainingFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [studentListCollapsed, setStudentListCollapsed] = useState(false);
  const [status, setStatus] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRunningNotificationTriggers, setIsRunningNotificationTriggers] = useState(false);
  const [isRunningProspectNurture, setIsRunningProspectNurture] = useState(false);
  const [isSyncingBilling, setIsSyncingBilling] = useState(false);
  const [isGeneratingAllPlans, setIsGeneratingAllPlans] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [newStudentPassword, setNewStudentPassword] = useState('');
  const [lastInviteText, setLastInviteText] = useState('');
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  const [notifications, setNotifications] = useState<CoachNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [apiVersion, setApiVersion] = useState('verificando');
  const [activeView, setActiveView] = useState<AdminView>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [finance, setFinance] = useState<FinanceResponse | null>(null);
  const [prospects, setProspects] = useState<{ totals: { total: number; quente: number; morno: number; frio: number }; prospects: ProspectRow[] } | null>(null);
  const [exStudents, setExStudents] = useState<{ total: number; exStudents: ExStudentRow[] } | null>(null);
  // 04/09: lista de testadores gratuitos (Play Store) que o proprio treinador gerencia aqui, sem
  // precisar pedir deploy de codigo pra cada pessoa nova — ver createCheckout em billing.service.ts.
  const [freeTesterEmails, setFreeTesterEmails] = useState<{ id: string; email: string; note: string | null; accountStatus?: string; studentCode?: number | null }[]>([]);
  const [newTesterEmail, setNewTesterEmail] = useState('');
  const [newTesterNote, setNewTesterNote] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponName, setCouponName] = useState('');
  const [couponDiscount, setCouponDiscount] = useState('100');

  // 28/08, bug real corrigido (treinador deslogava toda vez que recarregava a pagina): antes,
  // essa tela SEMPRE chamava /auth/refresh ao carregar, mesmo com um accessToken salvo ainda
  // valido (dura 12h) — e o backend so mantem UM refresh token valido por vez (troca a cada uso).
  // Em desenvolvimento, o StrictMode do React dispara esse efeito duas vezes de proposito; as
  // duas chamadas de refresh corriam quase juntas com o mesmo token antigo, a primeira ganhava e
  // trocava o token, a segunda chegava com o token ja invalidado pela primeira e deslogava a
  // sessao inteira — mesmo ela estando perfeitamente boa. Agora so' tenta renovar quando REALMENTE
  // precisa: sem accessToken salvo (so' com refresh token), ou quando uma chamada de verdade
  // devolve 401 (tratado inline dentro de loadDashboard, mais abaixo).
  useEffect(() => {
    const savedToken = window.localStorage.getItem('panzeri_admin_token') ?? '';
    const savedRefreshToken = window.localStorage.getItem('panzeri_admin_refresh_token') ?? '';
    if (savedToken) {
      setToken(savedToken);
      loadDashboard(savedToken);
    } else if (savedRefreshToken) {
      refreshAdminSession(savedRefreshToken).then((accessToken) => {
        if (accessToken) loadDashboard(accessToken);
      });
    }
  }, []);

  // 28/08: o backend so mantem UM refresh token valido por vez (troca a cada uso, ver
  // auth.service.ts). Se duas chamadas dessa funcao corressem ao mesmo tempo (StrictMode
  // disparando efeito duas vezes, ou duas telas pedindo refresh quase juntas), a primeira ganha
  // e troca o token; a segunda chega com o token ja invalidado pela primeira e desloga a sessao
  // inteira, mesmo ela estando boa — foi exatamente esse bug que "sempre desloga ao recarregar"
  // vinha de. refreshPromiseRef garante que chamadas concorrentes esperem a MESMA promessa em vez
  // de disparar pedidos de refresh separados.
  async function refreshAdminSession(refreshToken: string) {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const promise = (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) {
          logout();
          return '';
        }
        const data = (await response.json()) as { tokens?: { accessToken?: string; refreshToken?: string } };
        const nextAccessToken = data.tokens?.accessToken ?? '';
        const nextRefreshToken = data.tokens?.refreshToken ?? '';
        if (!nextAccessToken || !nextRefreshToken) {
          logout();
          return '';
        }
        window.localStorage.setItem('panzeri_admin_token', nextAccessToken);
        window.localStorage.setItem('panzeri_admin_refresh_token', nextRefreshToken);
        setToken(nextAccessToken);
        return nextAccessToken;
      } catch {
        setStatus('Nao consegui renovar a sessao do painel.');
        return '';
      }
    })();

    refreshPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      refreshPromiseRef.current = null;
    }
  }

  // 28/08: mesma protecao contra token expirado que loadDashboard ja tinha, agora compartilhada
  // pelas telas mais simples (cupons, financeiro, prospectos, ex-alunos, detalhe de aluna) — sem
  // isso, cada uma delas so' engolia o 401 silenciosamente (`if (response.ok) {...}`, nada no
  // else) e a tela ficava congelada sem nenhuma pista de que a sessao caiu.
  // 28/08: devolve { data } em vez de so' o valor, distinguindo "sessao caiu de vez" de "essa
  // chamada especifica falhou" — sem isso, um loader que falhou por sessao expirada sobrescrevia
  // a mensagem em branco do logout() com um erro generico tipo "Nao consegui carregar os cupons"
  // bem na tela de login, confuso pra quem esta vendo.
  async function authorizedGet<T>(path: string, accessToken: string, retryAfterRefresh = true): Promise<{ data: T | null; loggedOut: boolean }> {
    try {
      const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 401) {
        if (retryAfterRefresh) {
          const savedRefreshToken = window.localStorage.getItem('panzeri_admin_refresh_token') ?? '';
          if (savedRefreshToken) {
            const renewedToken = await refreshAdminSession(savedRefreshToken);
            if (renewedToken) return authorizedGet<T>(path, renewedToken, false);
          }
        }
        // Sem refresh token salvo, ou a renovacao ja falhou (refreshAdminSession chama logout()
        // sozinho nesse caso) — mesmo assim garante que o estado fica limpo, igual loadDashboard
        // ja fazia, pra nao deixar a sessao "presa" sem token nem prompt claro de login de novo.
        logout();
        return { data: null, loggedOut: true };
      }
      if (!response.ok) return { data: null, loggedOut: false };
      return { data: (await response.json()) as T, loggedOut: false };
    } catch {
      return { data: null, loggedOut: false };
    }
  }

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => void loadDashboard(token, page, query), 350);
    return () => window.clearTimeout(timer);
  }, [query, page, token, showArchived]);

  async function login() {
    setStatus('Entrando...');
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        setStatus('Login nao autorizado.');
        return;
      }

      const data = (await response.json()) as { user?: { role?: string }; tokens?: { accessToken?: string; refreshToken?: string } };
      if (data.user?.role !== 'coach' && data.user?.role !== 'admin') {
        setStatus('Este acesso e apenas para treinador.');
        return;
      }

      const accessToken = data.tokens?.accessToken;
      const refreshToken = data.tokens?.refreshToken;
      if (!accessToken || !refreshToken) {
        setStatus('Nao recebi acesso da API.');
        return;
      }

      window.localStorage.setItem('panzeri_admin_token', accessToken);
      window.localStorage.setItem('panzeri_admin_refresh_token', refreshToken);
      setToken(accessToken);
      await loadDashboard(accessToken);
    } catch {
      setStatus('Nao consegui conectar com a API.');
    }
  }


  // 28/08: retryAfterRefresh so' existe pra evitar loop — se a renovacao automatica (dentro deste
  // mesmo bloco) ainda assim nao resolver, aceita que a sessao expirou de verdade e desloga, sem
  // tentar renovar de novo infinitamente.
  async function loadDashboard(accessToken = token, requestedPage = page, search = query, retryAfterRefresh = true) {
    if (!accessToken) return;
    setStatus('Atualizando painel...');
    try {
      const healthResponse = await fetch(`${API_URL}/health`);
      if (healthResponse.ok) {
        const health = (await healthResponse.json()) as { version?: string };
        setApiVersion(health.version ?? 'API antiga');
      }
      const params = new URLSearchParams({ page: String(requestedPage), pageSize: '25' });
      if (search.trim()) params.set('search', search.trim());
      if (showArchived) params.set('includeArchived', '1');
      const response = await fetch(`${API_URL}/coach/dashboard?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.status === 401 && retryAfterRefresh) {
        // Token de acesso expirou de verdade (12h) — tenta renovar UMA vez antes de desistir e
        // deslogar. So' entra aqui quando uma chamada real falhou, nunca so' por recarregar a
        // pagina (ver useEffect de inicializacao acima).
        const savedRefreshToken = window.localStorage.getItem('panzeri_admin_refresh_token') ?? '';
        if (savedRefreshToken) {
          const renewedToken = await refreshAdminSession(savedRefreshToken);
          if (renewedToken) {
            await loadDashboard(renewedToken, requestedPage, search, false);
            return;
          }
        }
      }

      if (!response.ok) {
        setStatus('Sessao expirada. Entre novamente.');
        window.localStorage.removeItem('panzeri_admin_token');
        window.localStorage.removeItem('panzeri_admin_refresh_token');
        setToken('');
        return;
      }

      const data = (await response.json()) as DashboardResponse;
      setDashboard(data);
      const notificationsResponse = await fetch(`${API_URL}/notifications`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (notificationsResponse.ok) {
        const notificationData = (await notificationsResponse.json()) as { items: CoachNotification[] };
        setNotifications(notificationData.items.filter((item) => !item.id.startsWith('auto-')));
      }
      setStatus('Painel atualizado.');
      const selectedStudent = data.students.find((student) => student.id === selectedStudentId) ?? (activeView === 'dashboard' ? undefined : data.students[0]);
      if (selectedStudent) {
        setSelectedStudentId(selectedStudent.id);
        await loadStudent(selectedStudent.id, accessToken);
      }
    } catch {
      setStatus('Nao consegui carregar o painel.');
    }
  }

  async function markNotificationRead(notificationId: string) {
    try {
      const response = await fetch(`${API_URL}/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setStatus('Nao consegui marcar a notificacao como lida.');
        return;
      }
      setNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, read: true } : item));
    } catch {
      setStatus('Nao consegui conectar com a API.');
    }
  }

  async function loadCoupons(accessToken = token) {
    if (!accessToken) return;
    const { data, loggedOut } = await authorizedGet<{ coupons: CouponRow[] }>('/coach/coupons', accessToken);
    if (data) setCoupons(data.coupons);
    else if (!loggedOut) setStatus('Nao consegui carregar os cupons.');
  }

  async function loadFinance(accessToken = token) {
    if (!accessToken) return;
    const { data, loggedOut } = await authorizedGet<FinanceResponse>('/coach/finance', accessToken);
    if (data) setFinance(data);
    else if (!loggedOut) setStatus('Nao consegui carregar o financeiro.');
  }

  async function loadFunnel(accessToken = token) {
    if (!accessToken) return;
    setLoadingFunnel(true);
    const { data, loggedOut } = await authorizedGet<FunnelReport>('/analytics/funnel', accessToken);
    setLoadingFunnel(false);
    if (data) setFunnelReport(data);
    else if (!loggedOut) setStatus('Nao consegui carregar o funil.');
  }

  // 10/09: carrega o calendário global de provas alvo de todos os alunos ativos.
  async function loadRaceCalendar(accessToken = token) {
    if (!accessToken) return;
    setLoadingRaceCalendar(true);
    const { data, loggedOut } = await authorizedGet<RaceCalendarEntry[]>('/coach/races/calendar', accessToken);
    setLoadingRaceCalendar(false);
    if (data) setRaceCalendar(data);
    else if (!loggedOut) setStatus('Nao consegui carregar o calendario de provas.');
  }

  async function loadProspects(accessToken = token) {
    if (!accessToken) return;
    const { data, loggedOut } = await authorizedGet<{ totals: { total: number; quente: number; morno: number; frio: number }; prospects: ProspectRow[] }>('/coach/prospects', accessToken);
    if (data) setProspects(data);
    else if (!loggedOut) setStatus('Nao consegui carregar os prospectos.');
  }

  async function loadFreeTesterEmails(accessToken = token) {
    if (!accessToken) return;
    const { data, loggedOut } = await authorizedGet<{ id: string; email: string; note: string | null; accountStatus?: string; studentCode?: number | null }[]>('/coach/free-tester-emails', accessToken);
    if (data) setFreeTesterEmails(data);
    else if (!loggedOut) setStatus('Nao consegui carregar a lista de testadores.');
  }

  // Aceita colar varios e-mails de uma vez (separados por virgula, espaco ou quebra de linha) —
  // mesmo formato que o Play Console usa pra listas de e-mail, pra nao precisar digitar um por um.
  async function addFreeTesterEmail() {
    const emails = newTesterEmail.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
    if (!emails.length) {
      setStatus('Informe pelo menos um e-mail do testador.');
      return;
    }
    let failed = 0;
    for (const email of emails) {
      const response = await fetch(`${API_URL}/coach/free-tester-emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, note: newTesterNote }),
      });
      if (!response.ok) failed += 1;
    }
    setNewTesterEmail('');
    setNewTesterNote('');
    setStatus(failed ? `${emails.length - failed} de ${emails.length} adicionados (${failed} falharam).` : `${emails.length} testador(es) adicionado(s) - nao vao ser cobrados.`);
    await loadFreeTesterEmails();
  }

  async function removeFreeTesterEmail(id: string) {
    const response = await fetch(`${API_URL}/coach/free-tester-emails/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setStatus('Nao consegui remover esse e-mail.');
      return;
    }
    setStatus('Testador removido da lista.');
    await loadFreeTesterEmails();
  }

  async function loadExStudents(accessToken = token) {
    if (!accessToken) return;
    const { data, loggedOut } = await authorizedGet<{ total: number; exStudents: ExStudentRow[] }>('/coach/ex-students', accessToken);
    if (data) setExStudents(data);
    else if (!loggedOut) setStatus('Nao consegui carregar os ex-alunos.');
  }

  async function createCoupon() {
    if (!couponCode.trim()) {
      setStatus('Informe o codigo do cupom.');
      return;
    }
    const response = await fetch(`${API_URL}/coach/coupons`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: couponCode, name: couponName || couponCode, discountPercent: Number(couponDiscount) || 0, active: true }),
    });
    if (!response.ok) {
      setStatus('Nao consegui criar o cupom. Verifique se ele ja existe.');
      return;
    }
    setCouponCode('');
    setCouponName('');
    setCouponDiscount('100');
    setStatus('Cupom criado.');
    await loadCoupons();
    await loadFinance();
  }

  async function toggleCoupon(coupon: CouponRow) {
    const response = await fetch(`${API_URL}/coach/coupons/${coupon.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !coupon.active }),
    });
    if (!response.ok) {
      setStatus('Nao consegui alterar o cupom.');
      return;
    }
    setStatus(coupon.active ? 'Cupom desativado.' : 'Cupom ativado.');
    await loadCoupons();
    await loadFinance();
  }
  function changeView(view: AdminView) {
    setActiveView(view);
    setMenuOpen(false);
    if (view === 'coupons') void loadCoupons();
    if (view === 'finance') void loadFinance();
    if (view === 'prospects') { void loadProspects(); void loadFreeTesterEmails(); }
    if (view === 'exStudents') void loadExStudents();
    if (view === 'funnel') void loadFunnel();
    if (view === 'raceCalendar') void loadRaceCalendar();
    // 01/09: entrar na aba Alunos pelo menu sempre volta pra lista (nunca reabre a ultima aluna
    // vista) — e' o novo comportamento padrao "lista primeiro". Antes disso existia aqui uma
    // pre-carga automatica da primeira aluna do dashboard so' pra 'students' tambem; removida
    // porque nao faz mais sentido com lista e detalhe sendo dois modos separados. A view 'weeks'
    // ainda usa esse auto-carregamento (o seletor dela sempre espera alguem selecionado).
    if (view === 'students') setStudentViewMode('list');
    if (view !== 'dashboard' && view !== 'students' && view !== 'coupons' && view !== 'finance' && view !== 'notifications' && view !== 'prospects' && view !== 'exStudents' && !selectedStudentId && dashboard?.students[0]) {
      void loadStudent(dashboard.students[0].id);
    }
  }

  async function loadStudent(studentId: string, accessToken = token) {
    setSelectedStudentId(studentId);
    const { data, loggedOut } = await authorizedGet<StudentDetail>(`/coach/students/${studentId}`, accessToken);
    if (data) {
      setStudentDetail(data);
    } else {
      // 28/08: limpa o detalhe antigo em vez de deixar a aluna errada exibida — selectedStudentId
      // ja mudou pra essa (nova) aluna, mas studentDetail continuaria mostrando a ANTERIOR se a
      // busca falhasse, dando a impressao de estar vendo os dados de quem nao esta selecionada.
      setStudentDetail(null);
      if (!loggedOut) setStatus('Nao consegui carregar o aluno.');
    }
  }

  async function goToStudent(studentId: string) {
    setStudentViewMode('detail');
    scrollToTop();
    await loadStudent(studentId);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function createStudent() {
    if (!newStudentName.trim() || !newStudentEmail.trim()) {
      setStatus('Preencha nome e e-mail do aluno.');
      return;
    }

    if (newStudentPassword && newStudentPassword.length < 8) {
      setStatus('A senha inicial precisa ter pelo menos 8 caracteres. Ou deixe em branco para gerar convite.');
      return;
    }

    setStatus('Criando aluno...');
    setIsCreatingStudent(true);
    setLastInviteText('');
    try {
      const payload: { name: string; email: string; password?: string } = {
        name: newStudentName,
        email: newStudentEmail,
      };
      if (newStudentPassword) {
        payload.password = newStudentPassword;
      }

      const response = await fetch(`${API_URL}/coach/students`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setStatus('Nao consegui criar o aluno. Verifique se o e-mail ja existe.');
        return;
      }

      const data = (await response.json()) as { accessText?: string; inviteLink?: string };
      if (data.accessText) {
        setLastInviteText(data.accessText);
        await copyText(data.accessText);
      }

      setNewStudentName('');
      setNewStudentEmail('');
      setNewStudentPassword('');
      setStatus(data.inviteLink ? 'Aluno criado e convite copiado.' : 'Aluno criado.');
      await loadDashboard();
    } catch {
      setStatus('Nao consegui conectar com a API.');
    } finally {
      setIsCreatingStudent(false);
    }
  }

  async function archiveStudent(studentId: string, name: string) {
    if (!window.confirm(`Arquivar ${name}? O aluno sai da lista, mas os dados ficam guardados e podem ser reativados depois.`)) {
      return;
    }
    setStatus('Arquivando aluno...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountStatus: 'archived' }),
      });
      if (!response.ok) {
        setStatus('Nao consegui arquivar o aluno.');
        return;
      }
      if (selectedStudentId === studentId) {
        setSelectedStudentId('');
        setStudentDetail(null);
      }
      setStatus('Aluno arquivado.');
      await loadDashboard();
    } catch {
      setStatus('Nao consegui conectar com a API.');
    }
  }

  async function updateStudentField(studentId: string, field: 'accountStatus' | 'subscriptionStatus', value: string) {
    setStatus('Atualizando aluno...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) {
        setStatus('Nao consegui atualizar o aluno.');
        return;
      }
      setStatus('Aluno atualizado.');
      await loadDashboard();
      if (selectedStudentId === studentId) await loadStudent(studentId);
    } catch {
      setStatus('Nao consegui conectar com a API.');
    }
  }

  async function syncAllBillingNow() {
    setIsSyncingBilling(true);
    setStatus('Sincronizando pagamentos com o Asaas...');
    try {
      const response = await fetch(`${API_URL}/coach/billing/refresh-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as { checked?: number; changed?: number; failed?: number; message?: string };
      if (!response.ok) {
        setStatus(`Nao consegui sincronizar os pagamentos: ${data.message ?? 'erro desconhecido'}.`);
        return;
      }
      setStatus(`Sincronizacao concluida: ${data.checked ?? 0} verificado(s), ${data.changed ?? 0} status atualizado(s), ${data.failed ?? 0} falha(s).`);
      loadDashboard();
    } catch {
      setStatus('Nao consegui conectar com a API.');
    } finally {
      setIsSyncingBilling(false);
    }
  }

  async function generateNextWeekAllStudents() {
    setIsGeneratingAllPlans(true);
    setStatus('Iniciando geracao da semana seguinte para todos os alunos...');
    try {
      const response = await fetch(`${API_URL}/coach/plans/generate-next-week-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setStatus(`Nao consegui iniciar a geracao: ${data.message ?? 'erro desconhecido'}.`);
        return;
      }
      setStatus(data.message ?? 'Geracao iniciada em segundo plano. Acompanhe pelos avisos no Telegram (falhas por aluno) e vá conferindo o painel aos poucos.');
    } catch {
      setStatus('Nao consegui conectar com a API.');
    } finally {
      setIsGeneratingAllPlans(false);
    }
  }

  async function runBackupNow() {
    setIsBackingUp(true);
    setStatus('Gerando backup do banco...');
    try {
      const response = await fetch(`${API_URL}/coach/backup/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as { ok: boolean; error?: string; sizeBytes?: number };
      if (!response.ok || !data.ok) {
        setStatus(`Nao consegui gerar o backup: ${data.error ?? 'erro desconhecido'}.`);
        return;
      }
      setStatus(`Backup gerado e enviado por e-mail (${Math.round((data.sizeBytes ?? 0) / 1024)} KB).`);
    } catch {
      setStatus('Nao consegui conectar com a API.');
    } finally {
      setIsBackingUp(false);
    }
  }

  async function runNotificationTriggersNow() {
    setIsRunningNotificationTriggers(true);
    setStatus('Rodando verificacao de avisos automaticos (pagamento pendente, entrevista incompleta, reavaliacao vencida)...');
    try {
      const response = await fetch(`${API_URL}/coach/notification-triggers/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setStatus('Nao consegui rodar a verificacao de avisos.');
        return;
      }
      setStatus('Verificacao concluida. Quem se encaixava em algum criterio (e nao recebeu aviso recente) recebeu e-mail agora.');
    } catch {
      setStatus('Nao consegui conectar com a API.');
    } finally {
      setIsRunningNotificationTriggers(false);
    }
  }

  async function runProspectNurtureNow() {
    setIsRunningProspectNurture(true);
    setStatus('Rodando sequencia de aquecimento (8h/24h/7d/30d)...');
    try {
      const response = await fetch(`${API_URL}/coach/prospects/nurture/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus('Nao consegui rodar a sequencia de aquecimento.');
        return;
      }
      setStatus(`Concluido. ${data?.checked ?? 0} prospecto(s) verificado(s), ${data?.sent ?? 0} e-mail(is) enviado(s).`);
    } catch {
      setStatus('Nao consegui conectar com a API.');
    } finally {
      setIsRunningProspectNurture(false);
    }
  }

  async function forgotPassword() {
    if (!forgotEmail.trim()) {
      setForgotStatus('Informe o e-mail.');
      return;
    }
    setForgotStatus('Gerando link...');
    try {
      const response = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = (await response.json()) as { resetLink?: string; message?: string };
      if (!response.ok || !data.resetLink) {
        setForgotStatus('Nao consegui gerar o link. Confira o e-mail.');
        return;
      }
      setForgotStatus(data.resetLink);
    } catch {
      setForgotStatus('Nao consegui conectar com a API.');
    }
  }

  function logout() {
    window.localStorage.removeItem('panzeri_admin_token');
    window.localStorage.removeItem('panzeri_admin_refresh_token');
    setToken('');
    setDashboard(null);
    setStudentDetail(null);
    setStatus('');
  }

  if (!token) {
    return (
      <main className="loginShell">
        <section className="loginCard">
          <div className="brand brandDark">
            <div className="brandMark">
              <Activity size={22} />
            </div>
            <strong>Panzeri Run</strong>
          </div>
          <p className="eyebrow">Painel do treinador</p>
          <h1>Entrar</h1>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" />
          <PasswordInput value={password} onChange={setPassword} placeholder="Senha" />
          <button type="button" onClick={login}>
            <LogIn size={18} />
            Entrar
          </button>
          {status ? <p className="statusText">{status}</p> : null}
          <button
            type="button"
            className="linkButton"
            onClick={() => {
              setShowForgotPassword((current) => !current);
              setForgotStatus('');
            }}
          >
            Esqueci minha senha
          </button>
          {showForgotPassword ? (
            <div className="forgotPasswordBox">
              <input
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                placeholder="E-mail da conta"
              />
              <button type="button" onClick={forgotPassword}>
                Gerar link de redefinicao
              </button>
              {forgotStatus ? (
                forgotStatus.startsWith('http') ? (
                  <p className="statusText">
                    Abra este link para trocar a senha:{' '}
                    <a href={forgotStatus} target="_blank" rel="noreferrer">
                      {forgotStatus}
                    </a>
                  </p>
                ) : (
                  <p className="statusText">{forgotStatus}</p>
                )
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  const paymentGroupOf = (subscriptionStatus?: string) => {
    if (subscriptionStatus === 'active' || subscriptionStatus === 'manual_active' || subscriptionStatus === 'grace') return 'confirmed';
    if (subscriptionStatus === 'overdue') return 'overdue';
    if (subscriptionStatus === 'canceled') return 'canceled';
    return 'pending';
  };
  const filteredStudents = (dashboard?.students ?? []).filter((student) => {
    const trainingOk = trainingFilter === 'all' || student.status === trainingFilter;
    const paymentOk = paymentFilter === 'all' || paymentGroupOf(student.subscriptionStatus) === paymentFilter;
    return trainingOk && paymentOk;
  });

  return (
    <main className="shell">
      <section className="content">
        <header className="topbar">
          <div className="topbarIdentity">
            <button className="menuButton" type="button" onClick={() => setMenuOpen((current) => !current)} aria-label="Abrir menu">
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div>
              <p className="eyebrow">Painel do treinador</p>
              <h1>{activeView === 'dashboard' ? 'Visao geral' : activeView === 'students' ? 'Alunos' : activeView === 'prospects' ? 'Prospectos' : activeView === 'exStudents' ? 'Ex-alunos' : activeView === 'weeks' ? 'Planejamento semanal' : activeView === 'coupons' ? 'Cupons' : activeView === 'notifications' ? 'Notificacoes' : activeView === 'funnel' ? 'Funil de cadastro' : activeView === 'raceCalendar' ? 'Calendario de provas' : 'Financeiro'}</h1>
              <small className="apiVersion">API {apiVersion}</small>
            </div>
          </div>
          <div className="topActions">
            {activeView !== 'dashboard' && activeView !== 'notifications' ? <label className="searchBox">
              <Search size={18} />
              <input placeholder="Buscar por nome ou e-mail" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            </label> : null}
            {activeView === 'students' ? (
              <label className="archivedToggle">
                <input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); setPage(1); }} />
                Mostrar arquivados
              </label>
            ) : null}
            <button className="iconButton" type="button" onClick={() => loadDashboard()}>
              <RefreshCw size={18} />
            </button>
            <button className="ghostButton" type="button" onClick={logout}>
              Sair
            </button>
          </div>
        </header>

        {menuOpen ? (
          <nav className="compactMenu">
            <button className={activeView === 'dashboard' ? 'active' : ''} type="button" onClick={() => changeView('dashboard')}><LayoutDashboard size={19} />Dashboard</button>
            <button className={activeView === 'students' ? 'active' : ''} type="button" onClick={() => changeView('students')}><Users size={19} />Alunos</button>
            <button className={activeView === 'prospects' ? 'active' : ''} type="button" onClick={() => changeView('prospects')}><Flame size={19} />Prospectos{prospects?.totals.total ? ` (${prospects.totals.total})` : ''}</button>
            <button className={activeView === 'exStudents' ? 'active' : ''} type="button" onClick={() => changeView('exStudents')}><UserX size={19} />Ex-alunos{exStudents?.total ? ` (${exStudents.total})` : ''}</button>
            <button className={activeView === 'weeks' ? 'active' : ''} type="button" onClick={() => changeView('weeks')}><CalendarDays size={19} />Semanas</button>
            <button className={activeView === 'coupons' ? 'active' : ''} type="button" onClick={() => changeView('coupons')}><Ticket size={19} />Cupons</button>
            <button className={activeView === 'finance' ? 'active' : ''} type="button" onClick={() => changeView('finance')}><CreditCard size={19} />Financeiro</button>
            <button className={activeView === 'notifications' ? 'active' : ''} type="button" onClick={() => changeView('notifications')}><Bell size={19} />Notificacoes{notifications.length ? ` (${notifications.length})` : ''}</button>
            <button className={activeView === 'funnel' ? 'active' : ''} type="button" onClick={() => changeView('funnel')}><TrendingUp size={19} />Funil</button>
            <button className={activeView === 'raceCalendar' ? 'active' : ''} type="button" onClick={() => changeView('raceCalendar')}><Flag size={19} />Provas</button>
          </nav>
        ) : null}

        {status ? <p className="statusText panelToast">{status}</p> : null}

        {activeView === 'dashboard' && notifications.length ? (
          <section className="notificationStrip">
            <button className="notificationHeading notificationToggle" type="button" onClick={() => setNotificationsOpen((open) => !open)}>
              <Bell size={18} /><strong>Atualizacoes dos alunos ({notifications.filter((n) => !n.read).length} novas)</strong>
              {notificationsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {notificationsOpen ? (
              <div className="notificationListScroll">
                {notifications.slice(0, 6).map((notification) => (
                  <div className={`coachNotification ${notification.read ? 'notificationRead' : ''}`} key={notification.id}>
                    <p className="notifTitle">{notification.title}</p>
                    <span>{notification.message}</span>
                  </div>
                ))}
                {notifications.length > 6 ? (
                  <button className="secondaryButton" type="button" onClick={() => changeView('notifications')}>Ver todas ({notifications.length})</button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === 'notifications' ? (
          <section className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Notificacoes</p>
                <h2>Atualizacoes dos alunos</h2>
              </div>
            </div>
            <div className="notificationListFull">
              {notifications.length ? notifications.map((notification) => (
                <div className={`coachNotificationFull ${notification.read ? 'notificationRead' : ''}`} key={notification.id}>
                  <div className="notifBody">
                    <p className="notifTitle">{notification.title}</p>
                    <span>{notification.message}</span>
                    <small>{dateTimeLabel(notification.createdAt)}</small>
                  </div>
                  {!notification.read ? (
                    <button className="secondaryButton notifReadBtn" type="button" onClick={() => markNotificationRead(notification.id)}>Lida</button>
                  ) : null}
                </div>
              )) : <p>Nenhuma notificacao registrada.</p>}
            </div>
          </section>
        ) : null}

        {activeView === 'dashboard' ? <section className="stats">
          <Stat label="Alunos" value={String(dashboard?.totals.students ?? 0)} detail={`${dashboard?.totals.activePlans ?? 0} com programa ativo`} />
          <Stat label="Treinos propostos" value={String(dashboard?.totals.prescribedSessions ?? 0)} detail="semana atual" />
          <Stat label="Treinos feitos" value={String(dashboard?.totals.completedSessions ?? 0)} detail={`${dashboard?.totals.differentSessions ?? 0} diferentes`} />
          <Stat label="Aderencia media" value={`${dashboard?.totals.adherencePercent ?? 0}%`} detail="treinos propostos" />
          <Stat label="Pagamento em dia" value={String(dashboard?.totals.paymentConfirmed ?? 0)} detail="pagantes reais" />
          <Stat label="Cortesia / liberacao manual" value={String(dashboard?.totals.courtesyAccess ?? 0)} detail="nao e pagamento" />
          <Stat label="Pagamento atrasado" value={String(dashboard?.totals.paymentOverdue ?? 0)} detail="alunos" />
          <Stat label="Pagamento pendente" value={String(dashboard?.totals.paymentPending ?? 0)} detail="alunos" />
          <Stat label="Treinos criados" value={String(dashboard?.totals.plansCreatedThisWeek ?? 0)} detail="nesta semana" />
        </section> : null}

        {activeView === 'dashboard' ? (
          <section className="miniSection">
            <h3>Funil de cadastro</h3>
            <p>Rastreamento em tempo real: desde a abertura do app até o pagamento, com detecção de erros na entrevista.</p>
            <button className="secondaryButton" type="button" onClick={() => changeView('funnel')}>
              <TrendingUp size={16} /> Ver funil completo
            </button>
          </section>
        ) : null}

        {activeView === 'dashboard' ? (
          <section className="miniSection">
            <h3>Gerar semana seguinte para todos os alunos</h3>
            <p>Dispara manualmente o mesmo processo que roda sozinho todo domingo 19h. Roda em segundo plano — pode levar bastante tempo com muitos alunos; falhas por aluno avisam no Telegram como sempre.</p>
            {isSundayInSaoPaulo() ? null : (
              <p className="formHintText">So funciona aos domingos, de proposito — pra nao arriscar gerar a semana de todos os alunos por engano em outro dia.</p>
            )}
            <button className="secondaryButton" type="button" disabled={isGeneratingAllPlans || !isSundayInSaoPaulo()} onClick={generateNextWeekAllStudents}>
              {isGeneratingAllPlans ? 'Iniciando...' : 'Gerar semana seguinte para todos'}
            </button>
          </section>
        ) : null}

        {activeView === 'dashboard' ? (
          <section className="miniSection">
            <h3>Sincronizar pagamentos com o Asaas</h3>
            <p>Verifica o status real de todos os alunos com assinatura Asaas de uma vez (pula contas de cortesia/liberacao manual). Use quando a API tiver ficado fora do ar e alunas pagantes ficarem presas na tela de assinatura.</p>
            <button className="secondaryButton" type="button" disabled={isSyncingBilling} onClick={syncAllBillingNow}>
              {isSyncingBilling ? 'Sincronizando...' : 'Sincronizar todos os pagamentos'}
            </button>
          </section>
        ) : null}

        {activeView === 'dashboard' ? (
          <section className="miniSection">
            <h3>Backup do banco de dados</h3>
            <p>Um backup automatico e enviado por e-mail todos os dias as 4h. Voce tambem pode gerar um agora.</p>
            <button className="secondaryButton" type="button" disabled={isBackingUp} onClick={runBackupNow}>
              {isBackingUp ? 'Gerando backup...' : 'Gerar backup agora'}
            </button>
          </section>
        ) : null}

        {activeView === 'dashboard' ? (
          <section className="miniSection">
            <h3>Avisos automaticos por e-mail</h3>
            <p>Roda todo dia as 9h sozinho (pagamento pendente/atrasado, entrevista incompleta, reavaliacao vencida). Voce tambem pode rodar agora, pra testar ou adiantar.</p>
            <button className="secondaryButton" type="button" disabled={isRunningNotificationTriggers} onClick={runNotificationTriggersNow}>
              {isRunningNotificationTriggers ? 'Rodando...' : 'Rodar verificacao agora'}
            </button>
          </section>
        ) : null}

        {activeView === 'students' ? <section className="workArea">
          {/* 01/09: lista e detalhe viraram dois "modos" da mesma view (opcao B combinada com o
              treinador: sem rota propria por aluno, so troca o que aparece na tela) — antes os dois
              ficavam empilhados na mesma pagina, e abrir um aluno so descia pra um painel gigante
              logo abaixo da lista (a aluna reportou precisar rolar/printar a tela inteira varias
              vezes pra mostrar um caso). Agora clicar num aluno esconde a lista e mostra so o painel
              dele, com um botao de volta explicito — ver studentViewMode. */}
          {studentViewMode === 'detail' ? (
          <div className="panel">
            <button className="secondaryButton backToListButton" type="button" onClick={() => setStudentViewMode('list')}>
              <ArrowUp size={16} style={{ transform: 'rotate(-90deg)' }} />
              Voltar para a lista de alunos
            </button>
            <StudentPanel
              student={studentDetail}
              token={token}
              onStatus={setStatus}
              onRefresh={async () => {
                // Sem recarregar studentDetail aqui, o painel do aluno aberto (rotina, semana de
                // treinos, etc) ficava com dado velho depois de qualquer acao — so a lista do
                // dashboard atualizava. Bug real 04/08: editar a rotina manualmente nao aparecia
                // na tabela ate o treinador sair e reabrir o aluno.
                await loadDashboard();
                if (studentDetail) await loadStudent(studentDetail.id);
              }}
            />
          </div>
          ) : (
          <div className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Alunos</p>
                <h2>Lista operacional{dashboard ? ` · ${dashboard.totals.students} no total` : ''}</h2>
              </div>
              <button className="secondaryButton" type="button" onClick={() => setStudentListCollapsed((collapsed) => !collapsed)}>
                {studentListCollapsed ? `Mostrar lista (${filteredStudents.length})` : 'Recolher lista'}
              </button>
            </div>
            <div className="studentFilters">
              <label>Treino
                <select value={trainingFilter} onChange={(event) => setTrainingFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  <option value="Nunca gerou treino">Nunca gerou treino</option>
                  <option value="Aguardando aluna gerar treino">Aguardando aluna gerar treino</option>
                  <option value="Falha ao gerar semana de treino">Falha ao gerar semana de treino</option>
                  <option value="Bloqueado">Bloqueado</option>
                  <option value="Treino gerado">Treino gerado</option>
                </select>
              </label>
              <label>Pagamento
                <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  <option value="confirmed">Confirmado</option>
                  <option value="pending">Pendente</option>
                  <option value="overdue">Atrasado</option>
                  <option value="canceled">Cancelado</option>
                </select>
              </label>
            </div>
            {/* 18/08: rotulo explicito adicionado — o treinador confundiu este bloco (convidar
                aluno novo) com a busca do topbar (filtrar lista), porque os dois campos de texto
                ficam um embaixo do outro com aparencia parecida. O campo de busca de verdade fica
                no topo da tela, ao lado do icone de lupa, perto de "Mostrar arquivados". */}
            <p className="formSectionLabel">Convidar novo aluno (isto NAO filtra a lista acima)</p>
            <div className="createStudent">
              <input value={newStudentName} onChange={(event) => setNewStudentName(event.target.value)} placeholder="Nome do aluno" />
              <input value={newStudentEmail} onChange={(event) => setNewStudentEmail(event.target.value)} placeholder="E-mail" />
              <PasswordInput value={newStudentPassword} onChange={setNewStudentPassword} placeholder="Senha inicial opcional" />
              <button type="button" onClick={createStudent} disabled={isCreatingStudent}>
                {isCreatingStudent ? 'Criando...' : 'Criar convite'}
              </button>
            </div>
            {lastInviteText ? (
              <div className="inviteBox">
                <div>
                  <strong>Convite criado</strong>
                  <p>Envie este texto para o aluno criar a propria senha.</p>
                </div>
                <textarea readOnly value={lastInviteText} />
                <button type="button" onClick={() => copyText(lastInviteText)}>
                  Copiar convite
                </button>
              </div>
            ) : null}
            {/* 08/09: paginacao tambem no topo da lista — antes so havia no final, exigindo rolar
                ate la pra trocar de pagina (pedido do treinador: "esse botao deve ficar na parte
                de cima tambem"). Mesmo componente com compact=true para nao ocupar espaco. */}
            <Pagination pagination={dashboard?.pagination} onPageChange={setPage} compact />
            {studentListCollapsed ? null : (
            <div className="table">
              <div className="row header">
                <span>Aluno</span>
                <span>Objetivo</span>
                <span>Aderencia</span>
                <span>Teste 3 km</span>
                <span>Treino</span>
                <span>Acesso ao app</span>
                <span>Assinatura</span>
                <span></span>
              </div>
              {filteredStudents.map((student) => (
                <div className={`row rowButton ${selectedStudentId === student.id ? 'selected' : ''}`} key={student.id} onClick={() => goToStudent(student.id)}>
                  <span>
                    <strong>{student.name} <small className="studentCodeTag">Cod. {student.studentCode}</small></strong>
                    <small>{student.email}</small>
                    <small className="status warn">Strava: recurso indisponivel</small>
                  </span>
                  <span>{student.goal}</span>
                  <span>{student.adherencePercent}%</span>
                  <span>{student.lastThreeKm}</span>
                  <span className={`status ${statusClass(student.status)}`}>{student.status}</span>
                  <select
                    className={accountStatusClass(student.accountStatus)}
                    value={student.accountStatus}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateStudentField(student.id, 'accountStatus', event.target.value)}
                  >
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="overdue">Vencido</option>
                    <option value="canceled">Cancelado</option>
                    <option value="archived">Arquivado</option>
                  </select>
                  <span className="billingCell">
                    <select
                      className={subscriptionStatusClass(student.subscriptionStatus ?? 'pending')}
                      value={student.subscriptionStatus ?? 'pending'}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateStudentField(student.id, 'subscriptionStatus', event.target.value)}
                    >
                      <option value="pending">Pagamento pendente</option>
                      <option value="manual_active">Cortesia / liberacao manual</option>
                      <option value="active">Pagamento confirmado</option>
                      <option value="grace">Prazo de tolerancia</option>
                      <option value="overdue">Pagamento atrasado</option>
                      <option value="canceled">Assinatura cancelada</option>
                    </select>
                    <small className="billingHint">{billingHint(student)}</small>
                  </span>
                  <button
                    type="button"
                    className="rowArchiveButton"
                    aria-label={`Arquivar ${student.name}`}
                    onClick={(event) => { event.stopPropagation(); archiveStudent(student.id, student.name); }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            )}
            <Pagination pagination={dashboard?.pagination} onPageChange={setPage} />
          </div>
          )}
        </section> : null}

        {activeView === 'prospects' ? (
          <section className="workArea">
            <div className="panel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Nunca pagaram (nem cortesia)</p>
                  <h2>Prospectos</h2>
                </div>
                <button className="secondaryButton" type="button" disabled={isRunningProspectNurture} onClick={runProspectNurtureNow}>
                  {isRunningProspectNurture ? 'Rodando...' : 'Rodar aquecimento agora'}
                </button>
              </div>
              <p className="formHintText">
                Gente que criou conta no app mas ainda nao virou aluna de verdade — sem pagamento nenhum, nem cortesia liberada.
                Nao consomem codigo de aluno nem aparecem na lista de Alunos. Ordenados do mais pra menos engajado.
              </p>
              <p className="formHintText">
                Sequencia automatica de e-mail roda sozinha de hora em hora: 8h, 24h, 7 dias e 30 dias apos o cadastro
                (cada degrau uma unica vez, com o conteudo se adaptando ao que a pessoa ja fez ate ali).
              </p>
              <div className="stats" style={{ marginBottom: 16 }}>
                <Stat label="Quente" value={String(prospects?.totals.quente ?? 0)} detail="entrevista + cobranca criada" />
                <Stat label="Morno" value={String(prospects?.totals.morno ?? 0)} detail="entrevista em andamento/concluida" />
                <Stat label="Frio" value={String(prospects?.totals.frio ?? 0)} detail="nao respondeu nada ainda" />
              </div>
              <div className="table">
                <div className="row header">
                  <span>Nome</span>
                  <span>E-mail</span>
                  <span>Cadastrado em</span>
                  <span>Nivel de interesse</span>
                </div>
                {(prospects?.prospects ?? []).map((prospect) => (
                  <div className="row" key={prospect.id}>
                    <span><strong>{prospect.name}</strong></span>
                    <span>{prospect.email}</span>
                    <span>{dateLabel(prospect.createdAt)}</span>
                    <span>
                      <span className={`status ${prospect.level === 'quente' ? 'good' : prospect.level === 'morno' ? 'warn' : ''}`}>
                        {prospect.level === 'quente' ? 'Quente' : prospect.level === 'morno' ? 'Morno' : 'Frio'}
                      </span>
                      <br />
                      <small>{prospect.levelLabel}</small>
                    </span>
                  </div>
                ))}
                {!prospects?.prospects.length ? <p className="formHintText">Nenhum prospecto no momento.</p> : null}
              </div>
            </div>

            <div className="panel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Teste fechado da Play Store</p>
                  <h2>Testadores gratuitos</h2>
                </div>
              </div>
              <p className="formHintText">
                E-mails aqui nunca sao cobrados de verdade ao tentar assinar (enquanto o app de teste ainda cai no
                fluxo antigo de pagamento) — recebem acesso liberado na hora. Quem ja e aluna pagante nao e afetado.
              </p>
              <div className="formRow">
                <input placeholder="e-mail@gmail.com (pode colar varios separados por virgula)" value={newTesterEmail} onChange={(event) => setNewTesterEmail(event.target.value)} />
                <input placeholder="Nota (opcional)" value={newTesterNote} onChange={(event) => setNewTesterNote(event.target.value)} />
                <button className="primaryButton" type="button" onClick={addFreeTesterEmail}>Adicionar</button>
              </div>
              <div className="table">
                <div className="row header">
                  <span>E-mail</span>
                  <span>Status real</span>
                  <span>Nota</span>
                  <span></span>
                </div>
                {freeTesterEmails.map((entry) => (
                  <div className="row" key={entry.id}>
                    <span>{entry.email}</span>
                    <span>
                      <span className={`status ${entry.accountStatus === 'Liberado como testador gratuito' ? 'good' : entry.accountStatus === 'Ainda nao criou conta' ? '' : 'warn'}`}>
                        {entry.accountStatus ?? '-'}
                      </span>
                    </span>
                    <span>{entry.note ?? '-'}</span>
                    <span><button className="secondaryButton" type="button" onClick={() => removeFreeTesterEmail(entry.id)}>Remover</button></span>
                  </div>
                ))}
                {!freeTesterEmails.length ? <p className="formHintText">Nenhum testador cadastrado.</p> : null}
              </div>
            </div>
          </section>
        ) : null}

        {activeView === 'exStudents' ? (
          <section className="workArea">
            <div className="panel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Ja pagaram, depois cancelaram</p>
                  <h2>Ex-alunos</h2>
                </div>
              </div>
              <p className="formHintText">
                Quem ja foi aluna de verdade (pagou pelo menos uma vez, tem codigo de aluno) e depois cancelou a
                assinatura. Diferente de Prospectos, que e' so' quem nunca chegou a pagar. Clique numa linha pra
                abrir o painel completo dela (treinos, historico, tudo) sem tirar ela desta lista.
              </p>
              <div className="table">
                <div className="row header">
                  <span>Nome</span>
                  <span>E-mail</span>
                  <span>Objetivo</span>
                  <span>Cadastro ate cancelar</span>
                  <span>Cancelou em</span>
                </div>
                {/* 01/09: linha virou clicavel (pedido do treinador — perdeu acesso ao painel de uma
                    aluna que cancelou, mesmo ela devendo continuar so' em Ex-alunos, nao em Alunos).
                    O painel de detalhe (StudentPanel/student-detail-anchor) so' e' renderizado dentro
                    da view 'students', entao troca a view pra la' pra mostrar o painel — mas a aluna
                    continua de fora da lista operacional de Alunos (CoachService.dashboard() ja
                    exclui subscriptionStatus 'canceled' dali), entao nao aparece duplicada. */}
                {(exStudents?.exStudents ?? []).map((exStudent) => (
                  <div className="row rowButton" key={exStudent.id} onClick={() => { setActiveView('students'); void goToStudent(exStudent.id); }}>
                    <span><strong>{exStudent.name}</strong><br /><small>{exStudent.studentCode}</small></span>
                    <span>{exStudent.email}</span>
                    <span>{exStudent.goal}</span>
                    <span>{exStudent.daysSinceSignup} dias</span>
                    <span>
                      {dateLabel(exStudent.canceledAt)}
                      <br />
                      <small>{exStudent.selfRequested ? 'Pediu cancelamento' : 'Assinatura caiu sozinha'}</small>
                    </span>
                  </div>
                ))}
                {!exStudents?.exStudents.length ? <p className="formHintText">Nenhum ex-aluno no momento.</p> : null}
              </div>
            </div>
          </section>
        ) : null}

        {activeView === 'weeks' ? (
          <section className="weeksView">
            <div className="studentChooser">
              <strong>Aluno</strong>
              <select value={selectedStudentId} onChange={(event) => loadStudent(event.target.value)}>
                <option value="">Selecione um aluno</option>
                {dashboard?.students.map((student) => <option value={student.id} key={student.id}>{student.name} - {student.email}</option>)}
              </select>
              <Pagination pagination={dashboard?.pagination} onPageChange={setPage} compact />
            </div>
            <StudentPanel
              student={studentDetail}
              token={token}
              onStatus={setStatus}
              onRefresh={async () => {
                await loadDashboard();
                if (studentDetail) await loadStudent(studentDetail.id);
              }}
            />
          </section>
        ) : null}
        {activeView === 'coupons' ? (
          <CouponsView
            coupons={coupons}
            code={couponCode}
            name={couponName}
            discount={couponDiscount}
            onCode={setCouponCode}
            onName={setCouponName}
            onDiscount={setCouponDiscount}
            onCreate={createCoupon}
            onToggle={toggleCoupon}
          />
        ) : null}

        {activeView === 'finance' ? <FinanceView finance={finance} onRefresh={() => loadFinance()} /> : null}

        {activeView === 'funnel' ? <FunnelView report={funnelReport} loading={loadingFunnel} onRefresh={() => loadFunnel()} /> : null}

        {activeView === 'raceCalendar' ? <RaceCalendarView races={raceCalendar} loading={loadingRaceCalendar} onRefresh={() => loadRaceCalendar()} /> : null}
      </section>
    </main>
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="passwordField">
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={visible ? 'text' : 'password'} />
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar senha' : 'Ver senha'}>
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        {visible ? 'Ocultar' : 'Ver'}
      </button>
    </label>
  );
}
function CouponsView({
  coupons,
  code,
  name,
  discount,
  onCode,
  onName,
  onDiscount,
  onCreate,
  onToggle,
}: {
  coupons: CouponRow[];
  code: string;
  name: string;
  discount: string;
  onCode: (value: string) => void;
  onName: (value: string) => void;
  onDiscount: (value: string) => void;
  onCreate: () => void;
  onToggle: (coupon: CouponRow) => void;
}) {
  return (
    <section className="panel fullPanel">
      <div className="panelHeader"><div><p className="eyebrow">Cupons</p><h2>Descontos e liberacoes</h2></div></div>
      <div className="couponCreateGrid">
        <input value={code} onChange={(event) => onCode(event.target.value.toUpperCase())} placeholder="Codigo. Ex: JUCAMISA10" />
        <input value={name} onChange={(event) => onName(event.target.value)} placeholder="Nome interno" />
        <input value={discount} onChange={(event) => onDiscount(event.target.value.replace(/\D/g, ''))} placeholder="Desconto %" inputMode="numeric" />
        <button type="button" onClick={onCreate}>Criar cupom</button>
      </div>
      <div className="couponList">
        {coupons.length ? coupons.map((coupon) => (
          <article className="couponCard" key={coupon.id}>
            <div><strong>{coupon.code}</strong><span>{coupon.name}</span></div>
            <b>{coupon.discountPercent}%</b>
            <span>{coupon.usageCount} uso(s)</span>
            <span>{coupon.active ? 'Ativo' : 'Inativo'}</span>
            <button className="secondaryButton" type="button" onClick={() => onToggle(coupon)}>{coupon.active ? 'Desativar' : 'Ativar'}</button>
            {coupon.redemptions?.length ? <small>{coupon.redemptions.slice(0, 3).map((item) => item.student.name).join(', ')}</small> : <small>Sem vendas/uso ainda.</small>}
          </article>
        )) : <p>Nenhum cupom criado ainda.</p>}
      </div>
    </section>
  );
}

function FunnelView({ report, loading, onRefresh }: { report: FunnelReport | null; loading: boolean; onRefresh: () => void }) {
  const top = report?.funnel[0]?.sessions ?? 1;
  return (
    <section className="panel fullPanel">
      <div className="panelHeader">
        <div><p className="eyebrow">Analytics</p><h2>Funil de cadastro</h2></div>
        <button className="secondaryButton" type="button" onClick={onRefresh}>Atualizar</button>
      </div>

      {loading ? <p style={{ padding: '24px', color: 'var(--muted)' }}>Carregando...</p> : null}

      {!loading && report ? (
        <>
          <p style={{ padding: '0 24px', color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
            Últimos {report.days} dias · {report.preCadastroDropoff} pessoa(s) abriram o app mas não criaram conta
          </p>

          {/* Funil de conversão */}
          <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report.funnel.map((step, i) => {
              const pct = top > 0 ? Math.round((step.sessions / top) * 100) : 0;
              const prevSessions = i > 0 ? (report.funnel[i - 1]?.sessions ?? step.sessions) : step.sessions;
              const dropPct = i > 0 && prevSessions > 0 ? Math.round(((prevSessions - step.sessions) / prevSessions) * 100) : null;
              return (
                <div key={step.event} className="funnelStep">
                  <div className="funnelStepBar" style={{ width: `${pct}%` }} />
                  <div className="funnelStepLabel">
                    <span>{step.label}</span>
                    <span className="funnelStepCount">
                      {step.sessions} {dropPct !== null && dropPct > 0 ? <span className="funnelDropoff">−{dropPct}%</span> : null}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Erros de pergunta */}
          {report.questionErrors.length > 0 ? (
            <div style={{ padding: '0 24px 24px' }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Perguntas com mais erros</h3>
              <table className="dataTable">
                <thead><tr><th>Pergunta</th><th>Erros</th></tr></thead>
                <tbody>
                  {report.questionErrors.map((e) => (
                    <tr key={e.questionId ?? 'desconhecida'}>
                      <td><code>{e.questionId ?? '—'}</code></td>
                      <td>{e.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Sessões travadas */}
          {report.stalledSessions.length > 0 ? (
            <div style={{ padding: '0 24px 24px' }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Pessoas paradas na entrevista ({report.stalledSessions.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {report.stalledSessions.map((s) => (
                  <div key={s.sessionId} className={`funnelStalled${s.hasError ? ' funnelStalledError' : ''}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{s.userName ?? `Sessão anônima ${s.sessionId.slice(0, 8)}`}</span>
                      {s.lastSeenHoursAgo !== null ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {s.lastSeenHoursAgo < 24 ? `${s.lastSeenHoursAgo}h atrás` : `${Math.floor(s.lastSeenHoursAgo / 24)}d atrás`}
                        </span>
                      ) : null}
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Parou em: <strong>{s.lastEvent ?? '—'}</strong>
                      {s.lastQuestionId ? ` · pergunta: ${s.lastQuestionId}` : ''}
                    </span>
                    {s.hasError && s.lastError ? (
                      <span style={{ fontSize: 12, color: '#dc2626' }}>
                        ⚠️ Último erro na pergunta <code>{s.lastError.questionId ?? '?'}</code>
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ padding: '0 24px 24px', color: 'var(--muted)', fontSize: 13 }}>
              Nenhuma pessoa parada na entrevista nos últimos {report.days} dias. ✅
            </p>
          )}
        </>
      ) : null}

      {!loading && !report ? (
        <p style={{ padding: '24px', color: 'var(--muted)' }}>Clique em Atualizar para carregar o funil.</p>
      ) : null}
    </section>
  );
}

// 10/09: calendário global de provas alvo — visão do treinador de todas as provas marcadas pelos
// alunos, agrupadas por mês, em ordem cronológica. Mostra: data, aluno, prova, distância, meta de
// pace e prioridade. Provas arquivadas (concluídas/canceladas) não aparecem (filtradas no backend).
function RaceCalendarView({ races, loading, onRefresh }: { races: RaceCalendarEntry[] | null; loading: boolean; onRefresh: () => void }) {
  const today = new Date().toISOString().slice(0, 10);

  // Agrupar provas por mês (YYYY-MM)
  const grouped: Map<string, RaceCalendarEntry[]> = new Map();
  if (races) {
    for (const race of races) {
      const month = race.raceDate.slice(0, 7);
      if (!grouped.has(month)) grouped.set(month, []);
      grouped.get(month)!.push(race);
    }
  }

  function formatDate(iso: string) {
    const [year, month, day] = iso.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  }

  function formatMonth(ym: string) {
    const [year, month] = ym.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  function formatPace(secondsPerKm: number | null) {
    if (!secondsPerKm) return '—';
    const m = Math.floor(secondsPerKm / 60);
    const s = secondsPerKm % 60;
    return `${m}:${String(s).padStart(2, '0')}/km`;
  }

  function daysUntil(iso: string) {
    const diff = Math.ceil((new Date(iso).getTime() - new Date(today).getTime()) / 86400000);
    if (diff < 0) return `há ${Math.abs(diff)} dias`;
    if (diff === 0) return 'hoje';
    if (diff === 1) return 'amanhã';
    return `em ${diff} dias`;
  }

  const priorityLabel: Record<string, string> = {
    main: '⭐ Principal',
    secondary: 'Secundária',
    practice: 'Treino',
  };

  return (
    <section className="panel fullPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Provas alvo</p>
          <h2>Calendario de provas</h2>
        </div>
        <button className="secondaryButton" type="button" onClick={onRefresh}>
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
      </div>

      {loading ? (
        <p style={{ padding: '24px', color: 'var(--muted)' }}>Carregando...</p>
      ) : !races ? (
        <p style={{ padding: '24px', color: 'var(--muted)' }}>Clique em Atualizar para carregar.</p>
      ) : races.length === 0 ? (
        <p style={{ padding: '24px', color: 'var(--muted)' }}>Nenhuma prova marcada pelos alunos.</p>
      ) : (
        <div style={{ padding: '0 24px 32px' }}>
          {Array.from(grouped.entries()).map(([month, monthRaces]) => (
            <div key={month} style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 10 }}>
                {formatMonth(month)}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {monthRaces.map((race) => {
                  const isPast = race.raceDate < today;
                  return (
                    <div
                      key={race.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '120px 1fr auto',
                        gap: '8px 16px',
                        alignItems: 'center',
                        padding: '12px 14px',
                        borderRadius: 8,
                        background: isPast ? 'var(--surface-muted, rgba(0,0,0,0.04))' : 'var(--surface, rgba(0,0,0,0.02))',
                        border: `1px solid ${isPast ? 'var(--border-muted, #e0e0e0)' : 'var(--border, #e0e0e0)'}`,
                        opacity: isPast ? 0.65 : 1,
                      }}
                    >
                      {/* Coluna 1: data + countdown */}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(race.raceDate)}</div>
                        <div style={{ fontSize: 11, color: isPast ? 'var(--muted)' : '#16a34a', marginTop: 2 }}>{daysUntil(race.raceDate)}</div>
                      </div>

                      {/* Coluna 2: nome da prova + aluno */}
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{race.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {race.studentName ?? 'Aluno desconhecido'}
                          {race.studentCode ? ` · #${String(race.studentCode).padStart(7, '0')}` : ''}
                        </div>
                        {race.priority ? (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {priorityLabel[race.priority] ?? race.priority}
                          </div>
                        ) : null}
                      </div>

                      {/* Coluna 3: distância + pace alvo */}
                      <div style={{ textAlign: 'right' }}>
                        {race.distanceKm ? (
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{race.distanceKm} km</div>
                        ) : null}
                        {race.paceSecondsPerKm ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                            {formatPace(race.paceSecondsPerKm)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FinanceView({ finance, onRefresh }: { finance: FinanceResponse | null; onRefresh: () => void }) {
  return (
    <section className="panel fullPanel">
      <div className="panelHeader"><div><p className="eyebrow">Financeiro</p><h2>Resumo de assinaturas</h2></div><button className="secondaryButton" type="button" onClick={onRefresh}>Atualizar</button></div>
      <section className="stats financeStats">
        <Stat label="Planos ativos" value={String(finance?.activePlans ?? 0)} detail="pagos + cortesias" />
        <Stat label="Pagantes" value={String(finance?.payingPlans ?? 0)} detail="assinaturas cobradas" />
        <Stat label="Cortesias" value={String(finance?.courtesyPlans ?? 0)} detail="cupons 100% ou manual" />
        <Stat label="Receita estimada" value={formatMoney(finance?.estimatedMonthlyRevenueCents ?? 0)} detail="mensal recorrente" />
      </section>
      <div className="financeGrid">
        <Detail icon={<AlertTriangle size={18} />} label="Pendentes" value={String(finance?.pendingPlans ?? 0)} />
        <Detail icon={<AlertTriangle size={18} />} label="Atrasados" value={String(finance?.overduePlans ?? 0)} />
        <Detail icon={<X size={18} />} label="Cancelados" value={String(finance?.canceledPlans ?? 0)} />
        <Detail icon={<Ticket size={18} />} label="Cupons criados" value={String(finance?.coupons.length ?? 0)} />
      </div>
      <section className="miniSection">
        <h3>Cupons com uso</h3>
        {finance?.coupons.length ? finance.coupons.map((coupon) => (
          <p key={coupon.id}><strong>{coupon.code}</strong>: {coupon.discountPercent}% | {coupon.redemptions} venda(s)/uso(s) | {coupon.active ? 'ativo' : 'inativo'}</p>
        )) : <p>Sem cupons registrados.</p>}
      </section>
    </section>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Pagination({
  pagination,
  onPageChange,
  compact = false,
}: {
  pagination?: DashboardResponse['pagination'];
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  if (!pagination) return null;
  return (
    <div className={`pagination ${compact ? 'compactPagination' : ''}`}>
      <button type="button" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)} aria-label="Pagina anterior"><ChevronLeft size={18} /></button>
      <span>Pagina {pagination.page} de {pagination.totalPages} <small>{pagination.totalItems} aluno(s)</small></span>
      <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)} aria-label="Proxima pagina"><ChevronRight size={18} /></button>
    </div>
  );
}

function StudentPanel({
  student,
  token,
  onStatus,
  onRefresh,
}: {
  student: StudentDetail | null;
  token: string;
  onStatus: (message: string) => void;
  onRefresh: () => void;
}) {
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [subscriptionStatus, setSubscriptionStatus] = useState('pending');
  const [inviteText, setInviteText] = useState('');
  const [expandedHistoryId, setExpandedHistoryId] = useState('');
  const [justAddedSessionId, setJustAddedSessionId] = useState('');
  const [mergeSourceEmail, setMergeSourceEmail] = useState('');
  const [messageText, setMessageText] = useState('');
  const [messageByEmail, setMessageByEmail] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: string; content: string; createdAt: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [directives, setDirectives] = useState<Array<{ id: string; content: string; createdAt: string; expiresAt?: string | null }>>([]);
  const [checkoutLinkUrl, setCheckoutLinkUrl] = useState('');
  const [manualCpf, setManualCpf] = useState('');
  const [billingHistory, setBillingHistory] = useState<Array<{ id: string; dueDate: string | null; value: number | null; status: string; paidAt: string | null; invoiceUrl: string | null }> | null>(null);
  // 01/09: o painel virou abas em vez de uma pagina so' com tudo empilhado (pedido do treinador —
  // ver studentViewMode no componente pai pro contexto completo dessa mudanca). "Treinos" e' a aba
  // padrao por ser a mais usada no dia a dia.
  const [detailTab, setDetailTab] = useState<'treinos' | 'cadastro' | 'avaliacao' | 'rotina' | 'diretrizes' | 'semanas' | 'evolucao' | 'ciclo'>('treinos');
  // 11/09: período universal da aba Evolução — compartilhado por todos os gráficos e seções.
  // Padrão 12 semanas (~3 meses). Opções: 4/8/12/24/52/999(Tudo).
  const [evolPeriod, setEvolPeriod] = useState<4 | 8 | 12 | 24 | 52 | 999>(12);

  useEffect(() => {
    setEditName(student?.name ?? '');
    setEditEmail(student?.email ?? '');
    setEditStatus(student?.accountStatus ?? 'active');
    setSubscriptionStatus(student?.subscriptionStatus ?? 'pending');
    setNewPassword('');
    setInviteText('');
    setExpandedHistoryId('');
    setMessageText('');
    setChatMessages([]);
    setChatInput('');
    setDirectives([]);
    setCheckoutLinkUrl('');
    setManualCpf(student?.cpf ?? '');
    setBillingHistory(null);
    setDetailTab('treinos');
  }, [student?.id, student?.name, student?.email, student?.accountStatus, student?.subscriptionStatus, student?.cpf]);

  useEffect(() => {
    if (!student?.id) return;
    void loadTechnicalManagerData(student.id);
  }, [student?.id, token]);

  async function loadTechnicalManagerData(studentId: string) {
    try {
      const [historyResponse, directivesResponse] = await Promise.all([
        fetch(`${API_URL}/coach/students/${studentId}/technical-manager/chat`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/coach/students/${studentId}/technical-manager/directives`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (historyResponse.ok) setChatMessages(await historyResponse.json());
      if (directivesResponse.ok) setDirectives(await directivesResponse.json());
    } catch {
      // Falha silenciosa - o restante do painel continua funcionando normalmente.
    }
  }

  async function sendChatMessage() {
    if (!student || !chatInput.trim() || sendingChat) return;
    const outgoing = chatInput.trim();
    setSendingChat(true);
    setChatMessages((previous) => [...previous, { id: `pendente-${Date.now()}`, role: 'coach', content: outgoing, createdAt: new Date().toISOString() }]);
    setChatInput('');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/technical-manager/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: outgoing }),
      });
      if (!response.ok) {
        onStatus('Nao consegui conversar com o agente agora.');
        return;
      }
      await loadTechnicalManagerData(student.id);
    } catch {
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setSendingChat(false);
    }
  }

  async function removeDirective(directiveId: string) {
    if (!student) return;
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/technical-manager/directives/${directiveId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui remover a diretriz.');
        return;
      }
      await loadTechnicalManagerData(student.id);
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  if (!student) {
    return (
      <aside className="sidePanel">
        <p className="eyebrow">Aluno</p>
        <h2>Selecione um aluno</h2>
      </aside>
    );
  }

  async function saveStudent() {
    if (!student) return;
    onStatus('Atualizando aluno...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editName,
          email: editEmail,
          accountStatus: editStatus,
          subscriptionStatus,
        }),
      });

      if (!response.ok) {
        onStatus('Nao consegui atualizar o aluno.');
        return;
      }

      onStatus('Aluno atualizado.');
      onRefresh();
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function resetPassword() {
    if (!student) return;
    if (newPassword.length < 8) {
      onStatus('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }

    onStatus('Atualizando senha...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/password`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
      });

      if (!response.ok) {
        onStatus('Nao consegui atualizar a senha.');
        return;
      }

      setNewPassword('');
      onStatus('Senha atualizada.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function createInvite() {
    if (!student) return;
    onStatus('Gerando convite...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        onStatus('Nao consegui gerar convite.');
        return;
      }

      const data = (await response.json()) as { accessText?: string };
      if (data.accessText) {
        setInviteText(data.accessText);
        await copyText(data.accessText);
      }
      onStatus('Convite copiado.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function reopenInterview() {
    if (!student) return;
    const response = await fetch(`${API_URL}/coach/students/${student.id}/onboarding/reopen`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      onStatus('Nao consegui liberar a entrevista.');
      return;
    }
    onStatus('Entrevista liberada para o aluno revisar.');
    onRefresh();
  }

  async function sendMessageToStudent() {
    if (!student) return;
    if (!messageText.trim()) {
      onStatus('Escreva uma mensagem antes de enviar.');
      return;
    }
    if (!messageByEmail) {
      onStatus('Selecione ao menos um canal de envio.');
      return;
    }
    setSendingMessage(true);
    onStatus('Enviando mensagem...');
    try {
      const channels = messageByEmail ? ['email'] : [];
      const response = await fetch(`${API_URL}/coach/students/${student.id}/message`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: messageText.trim(), channels }),
      });
      if (!response.ok) {
        onStatus('Nao consegui enviar a mensagem.');
        return;
      }
      const data = (await response.json()) as { email?: boolean; emailError?: string };
      if (data.email === false) {
        onStatus(`Falha ao enviar e-mail: ${data.emailError ?? 'erro desconhecido'}.`);
        return;
      }
      setMessageText('');
      onStatus('Mensagem enviada.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setSendingMessage(false);
    }
  }

  async function regenerateWeek() {
    if (!student) return;
    if (!window.confirm('Gerar uma nova semana de treinos para este aluno? Isso substitui os treinos ainda nao realizados desta semana (o treino de hoje normalmente NAO e alterado).')) {
      return;
    }
    const allowToday = window.confirm(
      'Quer TAMBEM alterar o treino de HOJE especificamente? O aluno pode ja estar vendo ou ter comecado esse treino. Clique OK para incluir hoje, ou Cancelar para manter hoje como esta (recomendado).',
    );
    onStatus('Gerando nova semana de treinos...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/plan/regenerate-week`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowToday }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        onStatus(typeof data?.message === 'string' ? data.message : 'Nao consegui gerar uma nova semana.');
        return;
      }
      await onRefresh();
      onStatus('Nova semana de treinos gerada.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  // Pedido explicito do treinador 16/08 — aluno tem 2 tentativas base de "Gerar treino da
  // semana" por semana; so aparece quando ele ja esgotou (ver generationBlocked em
  // coach.service.ts). Cada clique libera +1.
  async function allowExtraGenerationAttempt() {
    if (!student) return;
    onStatus('Liberando mais uma tentativa...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/plan/allow-extra-generation-attempt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui liberar a tentativa.');
        return;
      }
      await onRefresh();
      onStatus('Tentativa liberada — o aluno ja pode tentar gerar de novo.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function archiveObservation(observationId: string) {
    if (!student) return;
    onStatus('Arquivando observacao...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/observations/${observationId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui arquivar a observacao.');
        return;
      }
      await onRefresh();
      onStatus('Observacao arquivada.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function syncAvailability() {
    if (!student) return;
    onStatus('Sincronizando disponibilidade a partir da entrevista...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/sync-availability`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui sincronizar a disponibilidade.');
        return;
      }
      const data = (await response.json()) as { synced: boolean; days: number };
      await onRefresh();
      onStatus(`Disponibilidade sincronizada: ${data.days} dia(s) com treino a partir da entrevista.`);
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function recoverSessions() {
    if (!student) return;
    onStatus('Verificando treinos presos em programas antigos...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/plan/recover-sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui verificar os treinos deste aluno.');
        return;
      }
      const data = (await response.json()) as { recovered: number };
      await onRefresh();
      onStatus(data.recovered > 0 ? `${data.recovered} treino(s) recuperado(s) e devolvido(s) a semana atual.` : 'Nenhum treino preso encontrado.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function mergeFromDuplicate() {
    if (!student) return;
    if (!mergeSourceEmail.trim()) {
      onStatus('Informe o e-mail da conta duplicada.');
      return;
    }
    if (!window.confirm(`Transferir entrevista, saude, preferencias e testes de ${mergeSourceEmail.trim()} para ${student.email}? A conta duplicada sera arquivada.`)) {
      return;
    }
    onStatus('Mesclando contas...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/merge-from`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceEmail: mergeSourceEmail.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onStatus(data.message ?? 'Nao consegui mesclar as contas.');
        return;
      }
      setMergeSourceEmail('');
      onStatus(data.message ?? 'Contas mescladas.');
      onRefresh();
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function generateReport(reportType: 'technical' | 'evolution') {
    if (!student) return;
    onStatus(reportType === 'technical' ? 'Gerando prestacao tecnica...' : 'Gerando relatorio de evolucao...');
    const response = await fetch(`${API_URL}/coach/students/${student.id}/reports/${reportType}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      onStatus('Nao consegui gerar o relatorio.');
      return;
    }
    onStatus('Relatorio gerado e salvo no historico.');
    onRefresh();
  }

  async function saveCpf() {
    if (!student) return;
    const digits = manualCpf.replace(/\D/g, '');
    if (digits.length !== 11) {
      onStatus('Digite um CPF valido com 11 numeros.');
      return;
    }
    onStatus('Salvando CPF...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/billing/cpf`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: digits }),
      });
      const data = await response.json().catch(() => ({} as { message?: string }));
      if (!response.ok) {
        onStatus(typeof data.message === 'string' ? data.message : 'Nao consegui salvar o CPF.');
        return;
      }
      onStatus('CPF salvo.');
      await onRefresh();
    } catch {
      onStatus('Nao consegui salvar o CPF.');
    }
  }

  async function refreshBillingStatus() {
    if (!student) return;
    onStatus('Verificando pagamento no Asaas...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/billing/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({} as { message?: string; appStatus?: string; providerStatus?: string }));
      if (!response.ok) {
        onStatus(typeof data.message === 'string' ? data.message : 'Nao consegui verificar o pagamento.');
        return;
      }
      onStatus(`Verificado no Asaas: status ${data.appStatus ?? '?'} (${data.providerStatus ?? 'sem detalhe'}).`);
      await onRefresh();
    } catch {
      onStatus('Nao consegui verificar o pagamento agora.');
    }
  }

  // Historico de faturas (pedido 16/08, apos o caso da Eduarda — tela tipo "Historico de contas"
  // da Cemig). Sob demanda (botao), nao carrega sozinho junto com o resto do painel — evita mais
  // uma chamada ao Asaas toda vez que o treinador so abre a pagina do aluno.
  async function loadBillingHistory() {
    if (!student) return;
    onStatus('Carregando historico de faturas...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/billing/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui carregar o historico de faturas.');
        return;
      }
      const data = await response.json().catch(() => ({} as { payments?: typeof billingHistory }));
      setBillingHistory(Array.isArray(data.payments) ? data.payments : []);
      onStatus('Historico de faturas carregado.');
    } catch {
      onStatus('Nao consegui conectar com a API.');
    }
  }

  async function createCheckoutLink() {
    if (!student) return;
    onStatus('Gerando link de pagamento...');
    try {
      const digits = manualCpf.replace(/\D/g, '');
      const response = await fetch(`${API_URL}/coach/students/${student.id}/billing/checkout-link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(digits.length === 11 ? { cpf: digits } : {}),
      });
      const data = await response.json().catch(() => ({} as { message?: string; checkoutUrl?: string }));
      if (!response.ok || !data.checkoutUrl) {
        onStatus(typeof data.message === 'string' ? data.message : 'Nao consegui gerar o link de pagamento.');
        return;
      }
      setCheckoutLinkUrl(data.checkoutUrl);
      await copyText(data.checkoutUrl);
      onStatus('Link de pagamento copiado.');
    } catch {
      onStatus('Nao consegui gerar o link de pagamento.');
    }
  }

  async function copyAccessText() {
    if (!student) return;
    const text = `Acesso Panzeri Run\n\nLink: ${STUDENT_APP_URL}\nE-mail: ${student.email}\nSenha: informe a senha combinada com o treinador.`;
    try {
      await copyText(text);
      onStatus('Texto de acesso copiado.');
    } catch {
      onStatus('Nao consegui copiar automaticamente.');
    }
  }

  return (
      <section className="sidePanel detailPanel">
      {/* 01/09 (2ª rodada): cabecalho compacto de proposito — so' o suficiente pra confirmar "estou
          com a aluna certa" antes de olhar qualquer aba (nome + codigo + Strava). O resto do cadastro
          (e-mail, WhatsApp, CPF, altura, peso, escolaridade, endereco) morava aqui sempre visivel em
          toda aba, inclusive Treinos, competindo com o que o treinador realmente queria ver naquele
          momento — feedback direto dele depois da 1ª versao das abas. Foi pra dentro da aba Cadastro. */}
      <div className="studentIdentityHeader">
        <p className="eyebrow">Aluno selecionado</p>
        <h2>{student.name} <small className="studentCodeTag">Cod. {student.studentCode}</small></h2>
        <span className="status warn">Strava: recurso indisponivel</span>
      </div>

      {/* 01/09: o resto do painel virou abas (pedido do treinador — antes era uma pagina so' com
          tudo empilhado, precisava rolar/printar varias vezes so pra mostrar um caso). O aviso de
          plano desatualizado fica sempre visivel, fora de qualquer aba, porque e' um alerta que o
          treinador precisa ver não importa em qual aba estiver. Cada bloco de aba usa <> (Fragment)
          em vez de <div>, de proposito — o grid de 4 colunas do .detailPanel posiciona os filhos por
          seletor de filho direto (".detailPanel > .adminForm" etc.), e um <div> por aba quebraria
          esses seletores sem reescrever todo o CSS de layout.  */}
      <div className="detailTabs">
        <button type="button" className={detailTab === 'treinos' ? 'active' : ''} onClick={() => setDetailTab('treinos')}>Treinos</button>
        <button type="button" className={detailTab === 'cadastro' ? 'active' : ''} onClick={() => setDetailTab('cadastro')}>Cadastro</button>
        <button type="button" className={detailTab === 'avaliacao' ? 'active' : ''} onClick={() => setDetailTab('avaliacao')}>Avaliacao</button>
        <button type="button" className={detailTab === 'rotina' ? 'active' : ''} onClick={() => setDetailTab('rotina')}>Rotina</button>
        <button type="button" className={detailTab === 'diretrizes' ? 'active' : ''} onClick={() => setDetailTab('diretrizes')}>Diretrizes</button>
        <button type="button" className={detailTab === 'semanas' ? 'active' : ''} onClick={() => setDetailTab('semanas')}>Semanas anteriores</button>
        <button type="button" className={detailTab === 'evolucao' ? 'active' : ''} onClick={() => setDetailTab('evolucao')}>Evolucao</button>
        {student?.interview?.answers?.personal_sex === 'Feminino' && (
          <button type="button" className={detailTab === 'ciclo' ? 'active' : ''} onClick={() => setDetailTab('ciclo')}>Ciclo</button>
        )}
      </div>

      {student.needsUpdate ? (
        <div className="needsUpdateBanner">
          <strong>Este aluno precisa de atualizacao de treino.</strong>
          <span>{student.needsUpdateReason ?? 'Os dados usados na ultima geracao nao batem mais com o que esta salvo agora.'} Use "Refazer nova semana de treinos" na aba Treinos quando quiser aplicar.</span>
        </div>
      ) : null}

      {detailTab === 'cadastro' ? (
      <>
      <section className="miniSection">
        <h3>Dados de contato</h3>
        {student.strava?.connected && student.strava.lastActivityAt ? (
          <p className="formHintText">Ultima atividade no Strava: {dateTimeLabel(student.strava.lastActivityAt)}</p>
        ) : null}
        <div className="interviewAnswerGrid">
          <div className="interviewAnswerRow"><span className="interviewAnswerLabel">E-mail</span><span className="interviewAnswerValue">{student.email}</span></div>
          <div className="interviewAnswerRow"><span className="interviewAnswerLabel">WhatsApp</span><span className="interviewAnswerValue">{student.phone ?? 'Nao informado'}</span></div>
          <div className="interviewAnswerRow"><span className="interviewAnswerLabel">Nascimento</span><span className="interviewAnswerValue">{student.birthDate ? dateLabel(student.birthDate) : 'Nao informado'}</span></div>
          <div className="interviewAnswerRow"><span className="interviewAnswerLabel">CPF</span><span className="interviewAnswerValue">{student.cpf ?? 'Nao informado'}</span></div>
          <div className="interviewAnswerRow"><span className="interviewAnswerLabel">Altura</span><span className="interviewAnswerValue">{student.heightCm ? `${student.heightCm} cm` : 'Nao informado'}</span></div>
          <div className="interviewAnswerRow"><span className="interviewAnswerLabel">Peso</span><span className="interviewAnswerValue">{student.weightKg ? `${student.weightKg} kg` : 'Nao informado'}</span></div>
          <div className="interviewAnswerRow"><span className="interviewAnswerLabel">Escolaridade</span><span className="interviewAnswerValue">{student.education ?? 'Nao informado'}</span></div>
        </div>
        <div className="interviewAnswerRow addressRow"><span className="interviewAnswerLabel">Endereco</span><span className="interviewAnswerValue">{student.address ?? 'Nao informado'}</span></div>
      </section>

      {student.targetRaces?.length ? (
        <section className="miniSection targetRaceHighlight">
          <h3>Prova alvo</h3>
          {student.targetRaces.filter((race) => race.status === 'em_andamento').map((race) => (
            <div className="targetRaceCard" key={race.id}>
              <strong>{race.name}</strong>
              <span>{dateLabel(race.raceDate)} · {race.distanceKm} km{race.paceSecondsPerKm ? ` · pace alvo ${paceLabel(race.paceSecondsPerKm)}` : ''}</span>
              <span className={`status ${race.priority === 'principal' ? 'good' : 'warn'}`}>{race.priority === 'principal' ? 'Meta principal' : 'Meta secundaria'}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="miniSection adminForm">
        <h3>Dados de acesso</h3>
        <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Nome" />
        <input value={editEmail} onChange={(event) => setEditEmail(event.target.value)} placeholder="E-mail" />
        <select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
          <option value="active">Ativo</option>
          <option value="paused">Pausado</option>
          <option value="overdue">Vencido</option>
          <option value="canceled">Cancelado</option>
          <option value="archived">Arquivado</option>
        </select>
        <label className="adminFieldLabel">Assinatura
          <select value={subscriptionStatus} onChange={(event) => setSubscriptionStatus(event.target.value)}>
            <option value="pending">Pagamento pendente</option>
            <option value="manual_active">Cortesia / liberacao manual</option>
            <option value="active">Pagamento confirmado</option>
            <option value="grace">Prazo de tolerancia</option>
            <option value="overdue">Pagamento atrasado</option>
            <option value="canceled">Assinatura cancelada</option>
          </select>
        </label>
        {student.subscriptionManualOverride ? (
          <p className="formHintText">Protegido: esse status foi definido manualmente e nao sera sobrescrito pela sincronizacao automatica com o Asaas. Use "Verificar pagamento no Asaas" abaixo para voltar a sincronizar de verdade.</p>
        ) : student.billing ? (
          <div className="interviewAnswerGrid">
            <div className="interviewAnswerRow"><span className="interviewAnswerLabel">Vencimento</span><span className="interviewAnswerValue">{student.billing.nextChargeAt ? dateLabel(student.billing.nextChargeAt) : 'Nao definido'}</span></div>
            <div className="interviewAnswerRow"><span className="interviewAnswerLabel">Status no Asaas</span><span className="interviewAnswerValue">{student.billing.providerStatus}</span></div>
            <div className="interviewAnswerRow"><span className="interviewAnswerLabel">Ultima sincronizacao</span><span className="interviewAnswerValue">{student.billing.lastSyncAt ? dateTimeLabel(student.billing.lastSyncAt) : 'Nunca'}</span></div>
          </div>
        ) : (
          <p className="formHintText">Este aluno ainda nao tem assinatura Asaas vinculada.</p>
        )}
        <button className="secondaryButton" type="button" onClick={loadBillingHistory}>Ver historico de faturas</button>
        {billingHistory ? (
          billingHistory.length ? (
            <div className="interviewAnswerGrid">
              {billingHistory.map((payment) => (
                <div className="interviewAnswerRow" key={payment.id}>
                  <span className="interviewAnswerLabel">{payment.dueDate ? dateLabel(payment.dueDate) : 'Sem data'}{payment.value != null ? ` · R$ ${payment.value.toFixed(2).replace('.', ',')}` : ''}</span>
                  <span className="interviewAnswerValue">{payment.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="formHintText">Nenhuma fatura encontrada pra esse aluno.</p>
          )
        ) : null}
        <button type="button" onClick={saveStudent}>Salvar dados</button>
        <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="Nova senha" />
        <button type="button" onClick={resetPassword}>Trocar senha</button>
        <button className="secondaryButton" type="button" onClick={createInvite}>Gerar convite</button>
        <button className="secondaryButton" type="button" onClick={copyAccessText}>Copiar acesso</button>
        {inviteText ? (
          <div className="inviteBox compactInvite">
            <strong>Convite do aluno</strong>
            <textarea readOnly value={inviteText} />
            <button type="button" onClick={() => copyText(inviteText)}>
              Copiar convite
            </button>
          </div>
        ) : null}
        <label className="adminFieldLabel">CPF (para pagamento)
          <input value={manualCpf} onChange={(event) => setManualCpf(event.target.value)} placeholder="Somente numeros" maxLength={14} />
        </label>
        <button className="secondaryButton" type="button" onClick={saveCpf}>Salvar CPF</button>
        <button className="secondaryButton" type="button" onClick={refreshBillingStatus}>Verificar pagamento no Asaas</button>
        <button className="secondaryButton" type="button" onClick={createCheckoutLink}>Gerar link de pagamento</button>
        {checkoutLinkUrl ? (
          <div className="inviteBox compactInvite">
            <strong>Link de pagamento (envie por WhatsApp/e-mail se o aluno nao conseguir pagar pelo app)</strong>
            <textarea readOnly value={checkoutLinkUrl} />
            <button type="button" onClick={() => copyText(checkoutLinkUrl)}>
              Copiar link
            </button>
          </div>
        ) : null}
      </section>

      <section className="miniSection adminForm messageSection">
        <h3>Enviar mensagem para o aluno</h3>
        <textarea
          value={messageText}
          onChange={(event) => setMessageText(event.target.value)}
          placeholder="Escreva a mensagem para o aluno"
          rows={10}
          className="messageTextarea"
        />
        <label className="adminFieldLabel checkboxLabel">
          <input type="checkbox" checked={messageByEmail} onChange={(event) => setMessageByEmail(event.target.checked)} />
          Enviar por e-mail
        </label>
        <button type="button" disabled={sendingMessage} onClick={sendMessageToStudent}>
          {sendingMessage ? 'Enviando...' : 'Enviar mensagem'}
        </button>
      </section>
      </>
      ) : null}

      {detailTab === 'diretrizes' ? (
      <>
      <section className="miniSection technicalManagerPanel">
        <h3>Gerente tecnico</h3>
        <p className="formHintText">Converse sobre o caso deste aluno especifico: peca relatorios, opiniao, ou combine regras permanentes so para ele.</p>

        {directives.length ? (
          <div className="directiveList">
            <strong>Diretrizes ativas para {student.name}</strong>
            {directives.map((directive) => (
              <div className="directiveItem" key={directive.id}>
                <span>
                  {directive.content}
                  {directive.expiresAt ? (
                    <strong style={{ display: 'block', fontSize: '0.8em', fontWeight: 600, marginTop: 4 }}>
                      Temporaria — valida ate {new Date(directive.expiresAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                    </strong>
                  ) : (
                    <em style={{ display: 'block', fontSize: '0.8em', opacity: 0.7, marginTop: 4 }}>Permanente</em>
                  )}
                </span>
                <button type="button" className="removeStructureButton" onClick={() => removeDirective(directive.id)}>Remover</button>
              </div>
            ))}
          </div>
        ) : <p className="formHintText">Nenhuma diretriz ativa no momento para {student.name}.</p>}

        <div className="chatTranscript">
          {chatMessages.length ? chatMessages.map((chatMessage) => (
            <div className={`chatBubble ${chatMessage.role === 'coach' ? 'chatBubbleCoach' : 'chatBubbleAgent'}`} key={chatMessage.id}>
              <strong>{chatMessage.role === 'coach' ? 'Voce' : 'Gerente tecnico'}</strong>
              <p>{chatMessage.content}</p>
            </div>
          )) : <p className="formHintText">Nenhuma conversa ainda sobre este aluno.</p>}
        </div>

        <textarea
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          placeholder="Pergunte sobre o treino, peca o relatorio do Strava, ou combine uma regra para este aluno"
          rows={8}
          className="chatInputTextarea"
        />
        <button type="button" disabled={sendingChat || !chatInput.trim()} onClick={sendChatMessage}>
          {sendingChat ? 'Consultando o agente...' : 'Enviar'}
        </button>
      </section>
      </>
      ) : null}

      {detailTab === 'evolucao' ? (() => {
        // Dados semanais para gráficos (oldest-first).
        const allWeeks = [...(student.history ?? [])].reverse().map((h) => ({
          startDate: String(h.startDate).slice(0, 10),
          completedKm: h.summary.completedKm ?? 0,
          prescribedKm: h.summary.prescribedKm ?? 0,
          adherencePercent: h.summary.adherencePercent ?? 0,
          completedSessions: h.summary.completedSessions ?? 0,
          prescribedSessions: h.summary.prescribedSessions ?? 0,
        }));
        const hist = student.history ?? [];
        const allSessions = flatFeedbackSessions(hist);

        // Contadores para badges
        let feedbackSessions = 0; let commentCount = 0;
        for (const s of allSessions) {
          if (s.perceivedEffort != null || s.satisfactionElaboracao != null || s.preSleepQuality != null) feedbackSessions++;
          if (s.feedback?.trim()) commentCount++;
        }
        const PAIN_KW = ['dor', 'lesao', 'lesão', 'machuc', 'inflam', 'torce', 'torci'];
        const painObs = (student.observations ?? []).filter(
          (o) => PAIN_KW.some((kw) => o.content.toLowerCase().includes(kw))
        );
        let painComments = 0;
        for (const s of allSessions)
          if (s.feedback && PAIN_KW.some((kw) => s.feedback!.toLowerCase().includes(kw))) painComments++;

        const sessionsWithV1Pain = allSessions.filter((s) => s.painFlag != null && (s.completionStatus === 'done' || s.completionStatus === 'adjusted'));

        const handleCalendarDayClick = (planId: string) => {
          setExpandedHistoryId(planId);
          setDetailTab('semanas');
        };

        const cutoffDate = evolPeriod !== 999
          ? new Date(Date.now() - evolPeriod * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          : '0000-00-00';
        const filteredWeeks = allWeeks.filter((w) => w.startDate >= cutoffDate);
        const filteredSessions = allSessions.filter((s) => s.date >= cutoffDate);

        // Divisor de grupo
        const GroupLabel = ({ label }: { label: string }) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 2px', userSelect: 'none' }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>{label}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>
        );

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

          {/* ── FILTRO UNIVERSAL DE PERÍODO ──────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>Período</span>
            {([
              [4,'1m'],[8,'2m'],[12,'3m'],[24,'6m'],[52,'1a'],[999,'Tudo'],
            ] as [4|8|12|24|52|999, string][]).map(([p, label]) => (
              <button key={p} type="button"
                style={{ padding: '3px 10px', fontSize: 12, borderRadius: 20,
                  background: evolPeriod === p ? 'var(--accent)' : 'var(--surface)',
                  color: evolPeriod === p ? '#fff' : 'var(--muted)',
                  border: `1px solid ${evolPeriod === p ? 'var(--accent)' : 'var(--line)'}`,
                  cursor: 'pointer', fontWeight: evolPeriod === p ? 700 : 400, flexShrink: 0 }}
                onClick={() => setEvolPeriod(p)}>
                {label}
              </button>
            ))}
          </div>

          {/* ── VISÃO GERAL ───────────────────────────────────────────────── */}
          <GroupLabel label="Visão geral do período" />
          <VisaoGeralSection sessions={filteredSessions} weeks={filteredWeeks} />

          {/* ── TREINAMENTO ───────────────────────────────────────────────── */}
          <GroupLabel label="Treinamento" />

          <EvoSection icon="📊" title="Volume semanal" badge={`${filteredWeeks.length} sem`}
            desc="Km completados por semana (barra) vs prescritos (linha tracejada). Cor da barra = variação % vs semana anterior. Linha roxa = tendência de evolução.">
            <KmEvolutionChart weeks={filteredWeeks} period={999} />
            <EvolutionKeyNumbers weeks={allWeeks} period={evolPeriod} />
          </EvoSection>

          <EvoSection icon="📅" title="Calendário de treinos" badge="8 sem"
            desc="Últimas 8 semanas. Cor = status do treino. Anel colorido = nível de esforço percebido. Clique em qualquer bolinha para ver o treino completo na aba Semanas anteriores.">
            <TrainingCalendarDots history={hist} onDayClick={handleCalendarDayClick} />
          </EvoSection>

          <EvoSection icon="📋" title="Aderência aos treinos" badge={filteredWeeks.length > 0 ? `${filteredWeeks.length} sem` : undefined}
            desc="% de treinos planejados que foram realizados por semana. Meta ideal: acima de 80%. Queda sustentada por 2+ semanas merece atenção ao contexto.">
            <LoadChartAderencia weeks={filteredWeeks} history={hist} />
          </EvoSection>

          <EvoSection icon="📈" title="Análise de carga (ACWR)" badge={filteredWeeks.length > 1 ? `${filteredWeeks.length} sem` : undefined}
            desc="Carga Semanal + ACWR (Aguda:Crônica). Zona verde 0.8–1.3 = seguro. Acima de 1.5 = risco de overtraining.">
            <LoadAnalysisSection weeks={filteredWeeks} />
          </EvoSection>

          <EvoSection icon="💪" title="Esforço percebido (RPE)" badge={feedbackSessions > 0 ? `${feedbackSessions} treinos` : undefined}
            desc="RPE 1–10 por sessão, semana ou mês. Filtre por modalidade. Clique nas bolinhas do calendário para ver o treino completo.">
            <EffortSection history={hist} period={evolPeriod} />
          </EvoSection>

          {/* ── ESTADO E RESPOSTA ─────────────────────────────────────────── */}
          <GroupLabel label="Estado e resposta ao treinamento" />

          <EvoSection icon="🌙" title="Estado antes dos treinos" badge={filteredSessions.filter((s) => s.preSleepQuality != null).length > 0 ? `${filteredSessions.filter((s) => s.preSleepQuality != null).length} registros` : undefined}
            desc="Quatro variáveis pré-treino (escala 1–5): sono, cansaço físico, estresse e motivação. Coletados a partir de 11/09/2026. Ligue/desligue cada série para comparar trajetórias.">
            <PreWorkoutStateSection history={hist} period={evolPeriod} />
          </EvoSection>

          <EvoSection icon="⭐" title="Experiência com o treino" badge={feedbackSessions > 0 ? `${feedbackSessions} respostas` : undefined}
            desc="Quatro dimensões: elaboração (como o treino foi montado), execução (como o aluno conseguiu fazer), sensação corporal e humor final (1–5). Zona verde = ótimo, amarela = ok, vermelha = atenção. Ver distribuição expande detalhes.">
            <ExperienciaTreinoSection history={hist} period={evolPeriod} onDayClick={handleCalendarDayClick} />
          </EvoSection>

          <EvoSection icon="🔁" title="Arco do treino (pré → pós)"
            badge={(() => { const n = flatFeedbackSessions(hist).filter((s) => (s.completionStatus === 'done' || s.completionStatus === 'adjusted') && (s.preSleepQuality != null || s.preMotivation != null) && (s.postWorkoutFeeling != null || s.postWorkoutMood != null || s.satisfactionCapacidade != null)).length; return n > 0 ? `${n} sessões` : undefined; })()}
            desc="Como o aluno chegou (prontidão) vs como saiu (sensação + humor + execução). RPE alto com satisfação boa = sofrimento bom 💪. Dor aplica penalidade no delta. Série de deltas negativos por 3+ semanas = sinal de overtraining.">
            <ArcoTreinoSection history={hist} />
          </EvoSection>

          <EvoSection icon="🩹" title="Dor ao longo do tempo" badge={sessionsWithV1Pain.length > 0 ? sessionsWithV1Pain.filter((s) => s.painFlag !== 'none').length : undefined}
            desc="Intensidade de dor por sessão (0 = sem dor, 1 = leve, 2 = moderada, 3 = forte). Episódios detalhados com quando a dor apareceu. Círculo maior = dor mais intensa. Dados de v1 (a partir de 11/09/2026) + observações antigas.">
            <DorLongitudinalSection history={hist} />
            {/* Mantém relatos históricos de texto para contexto */}
            {(painObs.length + painComments) > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>Relatos históricos de dor em texto ({painObs.length + painComments})</summary>
                <PainReportsSection health={student.health} observations={student.observations ?? []} history={hist} />
              </details>
            )}
          </EvoSection>

          {/* ── ANÁLISE ───────────────────────────────────────────────────── */}
          <GroupLabel label="Análise e exploração" />

          <EvoSection icon="🔍" title="Explorar relações" desc="Cruze duas variáveis numéricas em scatter plot. Cada ponto = uma sessão. Cor = modalidade. Hover para ver detalhes. Não interprete como causalidade — é ferramenta de investigação.">
            <ExplorarRelacoesSection history={hist} />
          </EvoSection>

          <EvoSection icon="🕒" title="Timeline integrada" badge={allSessions.filter((s) => s.completionStatus !== 'sem_registro').length}
            desc="Todos os treinos em ordem cronológica inversa com estado pré-treino, RPE, satisfação, sensação final, dor e comentário de cada sessão num único card.">
            <TimelineIntegradaSection history={hist} />
          </EvoSection>

          {/* ── REGISTROS ─────────────────────────────────────────────────── */}
          <GroupLabel label="Registros e histórico" />

          <EvoSection icon="💬" title="Comentários em texto" badge={commentCount > 0 ? commentCount : undefined}
            desc="Texto livre registrado pelo aluno após os treinos. Fonte qualitativa — revela motivação, dificuldades e contexto fora do plano.">
            <CommentsSection history={hist} />
          </EvoSection>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <EvoSection icon="🔄" title="Reavaliações" badge={student.reassessments?.length ?? 0}
              desc="Síntese das reavaliações periódicas — evolução, conquistas e pontos de atenção gerados pela IA após cada ciclo avaliativo.">
              {student.reassessments?.length ? (
                student.reassessments.map((r, i) => (
                  <div key={r.completedAt ?? i} style={{ borderLeft: '3px solid var(--line)', paddingLeft: 12, marginBottom: 12 }}>
                    <strong style={{ fontSize: 13 }}>{r.completedAt ? dateLabel(r.completedAt) : 'Data nao registrada'}</strong>
                    {r.evolutionSummary ? <p style={{ fontSize: 13, marginTop: 4 }}>{r.evolutionSummary}</p> : <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sem analise gerada.</p>}
                    {r.evolutionWins?.length ? <p style={{ fontSize: 12, color: '#22c55e', marginTop: 4 }}>✓ {r.evolutionWins.join(' · ')}</p> : null}
                    {r.evolutionConcerns?.length ? <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>⚠ {r.evolutionConcerns.join(' · ')}</p> : null}
                  </div>
                ))
              ) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma reavaliacao concluida ainda.</p>}
            </EvoSection>

            <EvoSection icon="🏁" title="Provas alvo" badge={student.targetRaces?.length ?? 0}
              desc="Provas cadastradas como meta do aluno. Usadas pela IA para periodização e geração das semanas de pico e polimento.">
              {student.targetRaces?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {student.targetRaces.map((race) => (
                    <div key={race.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 13, borderLeft: '3px solid var(--accent)', paddingLeft: 10, flexWrap: 'wrap' }}>
                      <strong>{race.name}</strong>
                      <span style={{ color: 'var(--muted)' }}>{dateLabel(race.raceDate)}</span>
                      {race.distanceKm && <span>{race.distanceKm} km</span>}
                      {race.paceSecondsPerKm && <span style={{ color: 'var(--muted)' }}>meta {Math.floor(race.paceSecondsPerKm/60)}:{String(race.paceSecondsPerKm%60).padStart(2,'0')}/km</span>}
                      <span style={{ fontSize: 11, background: race.status === 'active' ? '#22c55e22' : 'var(--line)', color: race.status === 'active' ? '#22c55e' : 'var(--muted)', borderRadius: 4, padding: '1px 6px' }}>{race.status}</span>
                    </div>
                  ))}
                </div>
              ) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma prova alvo cadastrada.</p>}
            </EvoSection>
          </div>

          <EvoSection icon="📋" title="Relatórios do agente" badge={student.reports?.length ?? 0}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <button type="button" className="primaryButton" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => generateReport('technical')}>
                <FileText size={15} />Gerar prestacao tecnica
              </button>
              <button type="button" className="primaryButton" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => generateReport('evolution')}>
                <Activity size={15} />Gerar relatorio de evolucao
              </button>
            </div>
            {student.reports?.length ? (
              <div className="reportHistory">
                {student.reports.map((report) => (
                  <details key={report.id} className="reportItem">
                    <summary><strong>{report.title}</strong><span>{dateTimeLabel(report.createdAt)}</span></summary>
                    <ReportContent report={report} />
                  </details>
                ))}
              </div>
            ) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum relatorio gerado ainda.</p>}
          </EvoSection>

        </div>
        );
      })() : null}

      {detailTab === 'avaliacao' ? (
      <>
      <section className="miniSection observationsPanel">
        <div className="weekWorkspaceHeader">
          <div><p className="eyebrow">Registrado pelo aluno</p><h3>Observacoes</h3></div>
        </div>
        {student.observations?.length ? (
          <div className="observationsList">
            {student.observations.map((observation) => (
              <div className={`observationItem ${observation.active ? '' : 'observationArchived'}`} key={observation.id}>
                <div>
                  <p>{observation.content}</p>
                  <small>{dateTimeLabel(observation.createdAt)}{observation.active ? '' : ' - arquivada'}</small>
                </div>
                {observation.active ? (
                  <button type="button" className="secondaryButton" onClick={() => archiveObservation(observation.id)}>Arquivar</button>
                ) : null}
              </div>
            ))}
          </div>
        ) : <p>Nenhuma observacao registrada pelo aluno ainda.</p>}
      </section>

      <div className="studentInfoGrid">
      <section className="miniSection">
        <h3>Saude</h3>
        <p>Sono: {student.health.sleep}</p>
        <p>Estresse: {student.health.stress}</p>
        <p>Ansiedade: {student.health.anxiety ?? 'Nao informado'}</p>
        <p>Lesoes: {student.health.injuries}</p>
        <p>Saude: {student.health.healthProblems ?? 'Nao informado'}</p>
        <p>Medicamentos: {student.health.medications ?? 'Nao informado'}</p>
      </section>

      <section className="miniSection">
        <h3>Preferencias</h3>
        <p>Modalidades: {listLabel(student.preferences?.preferredModalities ?? [])}</p>
        <p>Outras: {listLabel(student.preferences?.otherModalities ?? [])}</p>
        <p>Locais: {listLabel(student.preferences?.trainingLocations ?? [])}</p>
      </section>

      <section className="miniSection">
        <h3>Ultimos testes</h3>
        {student.tests.length ? (
          student.tests.map((test) => (
            <p key={test.date}>
              {dateLabel(test.date)} - {test.pace} - VO2 {test.vo2max}
            </p>
          ))
        ) : (
          <p>Sem teste cadastrado.</p>
        )}
      </section>
      </div>

      <section className="miniSection interviewPanel">
        <div className="weekWorkspaceHeader">
          <div><p className="eyebrow">Entrevista guiada</p><h3>Respostas do aluno</h3></div>
          <span>{student.interview?.completedAt ? 'Concluida' : 'Pendente'}</span>
        </div>
        {student.interview?.updatedAt ? <p>Ultima atualizacao: {dateTimeLabel(student.interview.updatedAt)}</p> : null}
        {student.interview && Object.keys(student.interview.answers ?? {}).length ? (
          <div className="interviewAnswers">
            {/* 09/09: grupo "Rotina semanal" removido daqui — a rotina tem aba propria
                (detailTab === 'rotina') e exibi-la tambem aqui criava duplicacao para todos
                os alunos que responderam o fluxo de rotina pelo app. */}
            {groupInterviewAnswers(student.interview.answers).filter((group) => group.title !== 'Rotina semanal').map((group) => (
              <details key={group.title} open={group.title === 'Objetivo'}>
                <summary>{group.title}</summary>
                <div className="interviewAnswerGrid">
                  {group.items.map(([key, value]) => (
                    <div className="interviewAnswerRow" key={key}>
                      <span className="interviewAnswerLabel">{interviewLabel(key)}</span>
                      <span className="interviewAnswerValue">
                        {key === 'longest_distance_recent_time' ? (longestDistancePaceSummary(student.interview!.answers) ?? interviewValue(key, value)) : interviewValue(key, value)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        ) : <p>Nenhuma resposta registrada. A conclusao anterior era apenas uma compatibilidade da versao antiga.</p>}
        <button className="secondaryButton" type="button" onClick={reopenInterview}>Liberar revisao da entrevista</button>
        <div className="mergeBox">
          <p className="formHintText">Aluno criou conta duplicada e preencheu a entrevista na outra? Informe o e-mail da conta duplicada para transferir os dados para esta conta selecionada.</p>
          <div className="mergeRow">
            <input value={mergeSourceEmail} onChange={(event) => setMergeSourceEmail(event.target.value)} placeholder="E-mail da conta duplicada" />
            <button type="button" onClick={mergeFromDuplicate}>Mesclar para esta conta</button>
          </div>
        </div>
      </section>
      </>
      ) : null}

      {detailTab === 'rotina' ? (
      <>
      <section className="miniSection">
        <div className="weekWorkspaceHeader">
          <div><p className="eyebrow">Rotina semanal</p><h3>Dias e horarios de treino</h3></div>
        </div>
        <RoutineAvailabilityTable answers={student.interview?.answers ?? {}} availability={student.availability ?? []} />
        <ManualRoutineEditor studentId={student.id} token={token} availability={student.availability ?? []} onStatus={onStatus} onSaved={onRefresh} />
      </section>
      </>
      ) : null}

      {detailTab === 'treinos' ? (
      <>
      <div className="detailGrid">
        <Detail icon={<UserRound size={18} />} label="Objetivo" value={student.goal} />
        <Detail icon={<Gauge size={18} />} label="Aderencia" value={`${student.plan?.summary.adherencePercent ?? 0}%`} />
        <Detail icon={<CheckCircle2 size={18} />} label="Feitos" value={`${student.plan?.summary.completedSessions ?? 0}/${student.plan?.summary.prescribedSessions ?? 0}`} />
        <Detail icon={<AlertTriangle size={18} />} label="Diferentes" value={String(student.plan?.summary.differentSessions ?? 0)} />
      </div>
      {student.plan?.methodology ? <p className="methodologySummary">{methodologySummaryLine(student.plan.methodology)}</p> : null}

      <section className="miniSection weekWorkspace">
        <div className="weekWorkspaceHeader">
          <div>
            <p className="eyebrow">Planejamento e execucao</p>
            <h3>Semana atual</h3>
            {student.plan?.methodology ? (
              <span className="decisionSourceBadge decisionSourceAi">Gerado pelo agente de IA</span>
            ) : null}
          </div>
          <div className="weekWorkspaceActions">
            <span>{student.plan?.name ?? 'Sem programa ativo'}{student.plan ? ` · Prescricao nº ${student.plan.planCode}` : ''}</span>
            <button className="secondaryButton" type="button" onClick={regenerateWeek}><RefreshCw size={16} />Refazer nova semana de treinos</button>
            <button className="secondaryButton" type="button" onClick={recoverSessions}><RefreshCw size={16} />Recuperar treinos presos em programa antigo</button>
            <button className="secondaryButton" type="button" onClick={syncAvailability}><RefreshCw size={16} />Sincronizar disponibilidade da entrevista</button>
            <button className="secondaryButton" type="button" disabled title="Integracao com Strava ainda nao disponivel">Strava: recurso indisponivel</button>
            {student.generationBlocked ? (
              <button className="secondaryButton" type="button" onClick={allowExtraGenerationAttempt}><RefreshCw size={16} />Liberar mais uma tentativa de geracao</button>
            ) : null}
          </div>
        </div>
        {student.plan?.sessions.length ? (
          <div className="coachWeekBoard">
            {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
              const sessions = student.plan!.sessions
                .filter((session) => session.weekday === weekday)
                .slice()
                .sort((left, right) => modalityOrderRank(left.modality) - modalityOrderRank(right.modality));
              const dayDate = sessions[0]?.date ?? (student.plan?.startDate ? dateForWeekday(student.plan.startDate, weekday) : null);
              const existingModalities = new Set(sessions.map((session) => session.modality));
              return (
                <div className="coachDay" key={weekday}>
                  <div className="coachDayHeader">
                    <strong>{weekdayLabel(weekday)}</strong>
                    <span>{dayDate ? dateLabel(dayDate) : ''}</span>
                  </div>
                  {sessions.length ? sessions.map((session, index) => (
                    <EditableSession
                      key={session.id}
                      session={session}
                      studentId={student.id}
                      token={token}
                      testPaceSeconds={parsePaceSeconds(student.tests[0]?.pace)}
                      onStatus={onStatus}
                      onSaved={onRefresh}
                      sessionLabel={sessions.length > 1 ? `Treino ${index + 1} de ${sessions.length}` : null}
                      autoOpen={session.id === justAddedSessionId}
                    />
                  )) : <p className="restDay">Sem treino</p>}
                  {dayDate ? (
                    <AddSessionButton
                      studentId={student.id}
                      token={token}
                      scheduledDate={dayDate}
                      existingModalities={existingModalities}
                      routineModalities={
                        // 08/09: passa modalidades da rotina para o picker saber oferecer "todos do dia"
                        (() => {
                          const rd = student.availability?.find((d) => d.weekday === weekday);
                          return rd && !rd.noTraining ? rd.modalities : [];
                        })()
                      }
                      onStatus={onStatus}
                      onCreated={(newSessionId) => {
                        setJustAddedSessionId(newSessionId);
                        onRefresh();
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : <p>Sem programa ativo.</p>}
        {student.unmatchedStravaActivities?.length ? (
          <div className="unmatchedStrava">
            <h4>Outras atividades recebidas do Strava</h4>
            <p>Foram realizadas nesta semana, mas nao correspondem diretamente a um treino proposto.</p>
            {student.unmatchedStravaActivities.map((activity) => <StravaActivityPanel activity={activity} key={activity.id} />)}
          </div>
        ) : null}
      </section>
      </>
      ) : null}

      {detailTab === 'semanas' ? (
      <section className="miniSection">
        <h3>Historico de semanas</h3>
        {student.history?.length ? (
          student.history.map((plan) => (
            <div className="historyWeek" key={plan.id}>
              <button className="historyWeekButton" type="button" onClick={() => setExpandedHistoryId((current) => current === plan.id ? '' : plan.id)}>
                <span><strong>{dateLabel(plan.startDate)} - {plan.name}</strong><small>{plan.summary.adherencePercent}% aderencia | {plan.summary.completedSessions}/{plan.summary.prescribedSessions} treinos | {plan.summary.completedKm}/{plan.summary.prescribedKm} km</small></span>
                <span>{expandedHistoryId === plan.id ? 'Recolher' : 'Abrir semana'}</span>
              </button>
              {expandedHistoryId === plan.id ? (
                <div className="historySessions">
                  {plan.sessions?.map((session) => (
                    <article className="historySession" key={session.id}>
                      <div><strong>{weekdayLabel(session.weekday)} {dateLabel(session.date)} - {session.title}</strong><span>{modalityLabel(session.modality)} | {session.durationMin ?? 0} min {session.distanceKm ? `| ${session.distanceKm} km` : ''}</span></div>
                      <AdminPrescription structure={session.structure} notes={session.notes} />
                      <p className="historyExecution">{completionLabel(session.completionStatus)}{session.perceivedEffort ? ` | PSE ${session.perceivedEffort}/10` : ''}{satisfactionDimensionsLine(session)}{session.feedback ? ` | ${session.feedback}` : ''}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p>Sem historico registrado.</p>
        )}
      </section>
      ) : null}

      {detailTab === 'ciclo' ? (
        <CicloTab studentId={student.id} accessToken={token} />
      ) : null}

      </section>
  );
}

function CicloTab({ studentId, accessToken }: { studentId: string; accessToken: string }) {
  const [data, setData] = React.useState<{
    profile: { hasActiveCycle: boolean | null; usesHormonalContraceptive: boolean | null; contraceptiveType: string | null; cycleLengthDays: number | null; periodLengthDays: number | null } | null;
    logs: Array<{ id: string; cycleStartDate: string; crampsLevel: number | null; energyLevel: number | null; moodLevel: number | null }>;
    phase: { phase: string; dayOfCycle: number; isReliable: boolean } | null;
    correlations: {
      isReliable: boolean;
      cycleCount: number;
      phaseStats: Array<{ phase: string; done: number; missed: number; noInteraction: number; adherencePercent: number | null }>;
      averageSymptoms: { crampsLevel: number | null; energyLevel: number | null; moodLevel: number | null };
    } | null;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch(`${API_URL}/coach/students/${studentId}/menstrual-cycle`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) setData(await res.json());
      setLoading(false);
    })();
  }, [studentId, accessToken]);

  const PHASE_LABELS: Record<string, string> = {
    menstruacao: 'Menstruação', folicular: 'Folicular', ovulatoria: 'Ovulação', lutea: 'Lútea',
  };

  if (loading) return <section className="miniSection"><p>Carregando dados do ciclo...</p></section>;
  if (!data?.profile) return <section className="miniSection"><p>A aluna ainda não registrou informações de ciclo menstrual.</p></section>;

  const { profile, logs, phase, correlations } = data;

  return (
    <section className="miniSection">
      <h3>Ciclo menstrual</h3>
      <div className="card">
        <h4>Perfil</h4>
        <p><strong>Ciclo ativo:</strong> {profile.hasActiveCycle === true ? 'Sim' : profile.hasActiveCycle === false ? 'Não / menopausa' : 'Prefere não informar'}</p>
        {profile.hasActiveCycle && <>
          <p><strong>Anticoncepcional hormonal:</strong> {profile.usesHormonalContraceptive === true ? 'Sim' : profile.usesHormonalContraceptive === false ? 'Não' : 'Prefere não informar'}</p>
          {profile.usesHormonalContraceptive && <p><strong>Tipo:</strong> {profile.contraceptiveType ?? '—'}</p>}
          {!profile.usesHormonalContraceptive && profile.cycleLengthDays && <p><strong>Duração do ciclo:</strong> {profile.cycleLengthDays} dias</p>}
          {!profile.usesHormonalContraceptive && profile.periodLengthDays && <p><strong>Duração da menstruação:</strong> {profile.periodLengthDays} dias</p>}
        </>}
      </div>

      {phase && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4>Fase estimada hoje</h4>
          <p><strong>{PHASE_LABELS[phase.phase] ?? phase.phase}</strong> · Dia {phase.dayOfCycle + 1} do ciclo</p>
          {!phase.isReliable && <p style={{ color: '#d97706' }}>⚠️ Estimativa não confiável — usa anticoncepcional hormonal.</p>}
        </div>
      )}

      {correlations && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4>Correlação fase × aderência ({correlations.cycleCount} ciclos registrados)</h4>
          {!correlations.isReliable && <p style={{ color: '#d97706', marginBottom: 8 }}>⚠️ Dados de fase não confiáveis (anticoncepcional hormonal).</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Fase</th>
                <th style={{ padding: '6px 8px' }}>Feitos</th>
                <th style={{ padding: '6px 8px' }}>Perdidos</th>
                <th style={{ padding: '6px 8px' }}>Aderência</th>
              </tr>
            </thead>
            <tbody>
              {correlations.phaseStats.map((row) => (
                <tr key={row.phase} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '6px 8px' }}>{PHASE_LABELS[row.phase] ?? row.phase}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{row.done}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{row.missed}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{row.adherencePercent != null ? `${row.adherencePercent}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            Média de sintomas: cólicas {correlations.averageSymptoms.crampsLevel ?? '—'}/5 · energia {correlations.averageSymptoms.energyLevel ?? '—'}/5 · humor {correlations.averageSymptoms.moodLevel ?? '—'}/5
          </p>
        </div>
      )}

      {logs.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4>Histórico de ciclos ({logs.length})</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Data início</th>
                <th style={{ padding: '6px 8px' }}>Cólicas</th>
                <th style={{ padding: '6px 8px' }}>Energia</th>
                <th style={{ padding: '6px 8px' }}>Humor</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '6px 8px' }}>{log.cycleStartDate.slice(0, 10)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{log.crampsLevel ?? '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{log.energyLevel ?? '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{log.moodLevel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EditableSession({
  session,
  studentId,
  token,
  testPaceSeconds,
  onStatus,
  onSaved,
  sessionLabel,
  autoOpen,
}: {
  session: NonNullable<StudentDetail['plan']>['sessions'][number];
  studentId: string;
  token: string;
  testPaceSeconds: number | null;
  onStatus: (message: string) => void;
  onSaved: () => void;
  sessionLabel?: string | null;
  autoOpen?: boolean;
}) {
  const [title, setTitle] = useState(session.title);
  const [modality, setModality] = useState(session.modality);
  const [durationMin, setDurationMin] = useState(String(session.durationMin ?? ''));
  const [distanceKm, setDistanceKm] = useState(String(session.distanceKm ?? ''));
  const [zone, setZone] = useState(session.zone ?? '');
  const [notes, setNotes] = useState(session.notes ?? '');
  const [isEditing, setIsEditing] = useState(Boolean(autoOpen));
  const [structure, setStructure] = useState<Record<string, unknown>>(() => normalizeSessionStructure(session));
  const [saveMessage, setSaveMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    setStructure(normalizeSessionStructure(session));
  }, [session.id, session.structure, session.modality]);

  async function saveSession() {
    onStatus('Salvando treino do aluno...');
    setSaveMessage('Salvando treino...');
    setIsSaving(true);
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          modality,
          durationMin: Number(durationMin) || 0,
          distanceKm: Number(distanceKm.replace(',', '.')) || 0,
          intensityZone: zone,
          notes,
          structure,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { message?: string | string[] } | null;
        const detail = Array.isArray(error?.message) ? error?.message.join(', ') : error?.message;
        setSaveMessage(detail ? `Nao foi possivel salvar: ${detail}` : 'Nao foi possivel salvar. Confirme se a API foi implantada no EasyPanel.');
        onStatus('Nao consegui alterar este treino.');
        return;
      }
      onStatus('Treino do aluno atualizado.');
      setSaveMessage('Treino salvo com sucesso.');
      setIsEditing(false);
      onSaved();
    } catch {
      setSaveMessage('Falha de conexao com a API. Tente novamente.');
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setIsSaving(false);
    }
  }

  async function regenerateSession() {
    // 08/09: sem confirmacoes de nenhum tipo — o treinador clicou dentro da sessao especifica,
    // o contexto e claro. allowToday sempre true (o treinador decide quando gerar, nao o sistema).
    onStatus('Gerando novo treino...');
    setIsRegenerating(true);
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}/sessions/${session.id}/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowToday: true }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        onStatus(typeof data?.message === 'string' ? data.message : 'Nao consegui gerar um novo treino.');
        return;
      }
      onStatus('Novo treino gerado.');
      setIsEditing(false);
      onSaved();
    } catch {
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setIsRegenerating(false);
    }
  }

  const [isDeleting, setIsDeleting] = useState(false);
  // Escape hatch manual pra limpar treino duplicado/errado que a IA gerou (pedido real 10/08 —
  // Lucelane com sessoes de fortalecimento empilhadas no mesmo dia, sem nenhum jeito de remover
  // uma so). Nunca deixa apagar um treino que a aluna ja registrou (ver deleteTrainingSession).
  async function deleteSession() {
    if (!window.confirm('Excluir este treino definitivamente? Essa acao nao pode ser desfeita.')) return;
    onStatus('Excluindo treino...');
    setIsDeleting(true);
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}/sessions/${session.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onStatus(typeof data?.message === 'string' ? data.message : 'Nao consegui excluir o treino.');
        return;
      }
      onStatus('Treino excluido.');
      onSaved();
    } catch {
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setIsDeleting(false);
    }
  }

  function handleStructureChange(next: Record<string, unknown>) {
    if (next.type === 'run' || next.type === 'aerobic') {
      const totals = computeStructureTotals(next);
      const durationRange = totals.totalDurationMin ? `${totals.totalDurationMin} min` : undefined;
      setStructure({ ...next, distanceKm: totals.totalDistanceKm || undefined, durationMin: totals.totalDurationMin || undefined, durationRange });
      setDurationMin(totals.totalDurationMin ? String(totals.totalDurationMin) : '');
      setDistanceKm(totals.totalDistanceKm ? String(totals.totalDistanceKm) : '');
      return;
    }
    setStructure(next);
  }

  function changeModality(nextModality: string) {
    setModality(nextModality);
    const nextIsStrength = isStrengthModality(nextModality);
    const currentIsStrength = structure.type === 'strength';
    if (nextIsStrength !== currentIsStrength) {
      setStructure(nextIsStrength
        ? { type: 'strength', category: nextModality === 'fortalecimento_corredores' ? 'Fortalecimento para corredores' : 'Musculacao', exercises: [] }
        : { type: 'run', blocks: [] });
    }
  }

  return (
    <div className="sessionEditor" style={{ borderLeft: `4px solid ${modalityAccentColor(session.modality)}` }}>
      {sessionLabel ? <p className="multiSessionLabel">{sessionLabel}</p> : null}
      <div className="sessionEditorHeader">
        <span className={`executionStatus execution-${session.stravaActivity ? 'done' : session.completionStatus}`}>
          {session.stravaActivity ? 'Strava recebido' : completionLabel(session.completionStatus)}
        </span>
        <div className="sessionEditorHeaderActions">
          <button className="editSessionButton" type="button" onClick={() => setIsEditing((current) => !current)}>
            {isEditing ? 'Cancelar' : 'Editar'}
          </button>
          <button className="dangerButton" type="button" disabled={isDeleting} onClick={() => deleteSession()}>
            {isDeleting ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
      <div className="sessionOverview">
        <strong>{session.title}</strong>
        <span>{modalityLabel(session.modality)} | {session.durationMin ?? 0} min {session.distanceKm ? `| ${session.distanceKm} km` : ''}</span>
      </div>
      <AdminPrescription structure={session.structure} notes={session.notes} />
      <div className={`executionPanel ${session.completionStatus === 'sem_registro' && !session.stravaActivity ? 'emptyExecution' : ''}`}>
        <strong>Realizado pelo aluno</strong>
        {session.completionStatus === 'sem_registro' ? <span>{session.stravaActivity ? 'Sem registro manual no aplicativo' : 'Sem registro'}</span> : (
          <>
            <span>
              {session.completedDurationMin ? `${session.completedDurationMin} min` : 'Tempo nao informado'}
              {session.completedDistanceKm ? ` | ${session.completedDistanceKm} km` : ''}
              {session.completedPaceSecondsKm ? ` | ${paceLabel(session.completedPaceSecondsKm)}` : ''}
            </span>
            <span>{session.perceivedEffort ? `PSE ${session.perceivedEffort}/10` : 'PSE nao informada'}</span>
            <span>{session.satisfactionElaboracao ? `Elaboracao do treino: ${satisfactionLabel(session.satisfactionElaboracao)}` : 'Satisfacao com a elaboracao nao informada'}</span>
            <span>{session.satisfaction ? `Fazer o treino: ${satisfactionLabel(session.satisfaction)}` : 'Satisfacao em fazer o treino nao informada'}</span>
            <span>{session.satisfactionCapacidade ? `Como conseguiu fazer: ${satisfactionLabel(session.satisfactionCapacidade)}` : 'Satisfacao com como conseguiu fazer nao informada'}</span>
            <span>{session.satisfactionCarga ? `Carga: ${cargaLabel(session.satisfactionCarga)}` : 'Carga nao informada'}</span>
            <span>{session.feedback || 'Sem comentario'}</span>
          </>
        )}
      </div>
      {session.stravaActivity ? <StravaActivityPanel activity={session.stravaActivity} /> : null}
      {isEditing ? (
        <div className="editOverlay" role="dialog" aria-modal="true" aria-label="Editar treino">
          <div className="editDialog">
            <div className="editDialogHeader">
              <div><p className="eyebrow">Edicao manual</p><h2>{session.title}</h2></div>
              <div className="editDialogHeaderActions">
                <button className="secondaryButton" type="button" disabled={isRegenerating} onClick={() => regenerateSession()}>
                  <RefreshCw size={16} /> {isRegenerating ? 'Gerando...' : 'Gerar novo treino'}
                </button>
                <button className="closeEditButton" type="button" onClick={() => setIsEditing(false)}>Fechar</button>
              </div>
            </div>
            <div className="sessionEditForm">
              <label>Nome do treino<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <div className="sessionEditorGrid summaryEditorGrid">
                <label>Modalidade
                  <select value={modality} onChange={(event) => changeModality(event.target.value)}>
                    <option value="corrida">Corrida</option>
                    <option value="esteira">Corrida na esteira</option>
                    <option value="forca">Musculacao</option>
                    <option value="fortalecimento_corredores">Fortalecimento para corredores</option>
                  </select>
                </label>
                <label>Duracao total<input value={durationMin} onChange={(event) => setDurationMin(event.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
                {!isStrengthModality(modality) ? <label>Distancia total<input value={distanceKm} onChange={(event) => setDistanceKm(event.target.value)} inputMode="decimal" /></label> : null}
                {!isStrengthModality(modality) ? <label>Zona principal<input value={zone} onChange={(event) => setZone(event.target.value)} /></label> : null}
              </div>
              <StructureEditor structure={structure} testPaceSeconds={testPaceSeconds} onChange={handleStructureChange} />
              <label>Orientacoes para o aluno (explicacao do treino, cuidados, dicas)
                <textarea className="notesTextarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              {saveMessage ? <p className={`modalSaveMessage ${saveMessage.includes('sucesso') ? 'saveSuccess' : ''}`}>{saveMessage}</p> : null}
              <button className="saveEditButton" type="button" disabled={isSaving} onClick={saveSession}><Save size={16} /> {isSaving ? 'Salvando...' : 'Salvar treino completo'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 08/09: MANUAL_SESSION_MODALITIES removida — substituida por PICKER_COMBOS abaixo.
// esteira removida junto: nao existe como opcao manual; corrida vs esteira e so contexto pra IA.

// Combinacoes oferecidas no picker de "Adicionar treino".
// Ordem: individuais primeiro, depois combos, depois combo total.
const PICKER_COMBOS: Array<{ label: string; modalities: string[] }> = [
  { label: 'Corrida', modalities: ['corrida'] },
  { label: 'Musculacao', modalities: ['forca'] },
  { label: 'Fortalecimento', modalities: ['fortalecimento_corredores'] },
  { label: 'Corrida + Musculacao', modalities: ['corrida', 'forca'] },
  { label: 'Corrida + Fortalecimento', modalities: ['corrida', 'fortalecimento_corredores'] },
  { label: 'Corrida + Musculacao + Fortalecimento', modalities: ['corrida', 'forca', 'fortalecimento_corredores'] },
];

// 08/09: redesenhado para suportar:
// - "Adicionar todos do dia" quando a rotina tem 2+ modalidades pendentes
// - combos fixos (Corrida, Musculacao, Fortalecimento e combinacoes) em vez de lista individual
// - suporte a adicionar multiplas sessoes em sequencia (uma chamada por modalidade)
// - esteira tratada como corrida — nao aparece como opcao separada
function AddSessionButton({
  studentId,
  token,
  scheduledDate,
  existingModalities,
  routineModalities,
  onStatus,
  onCreated,
}: {
  studentId: string;
  token: string;
  scheduledDate: string;
  existingModalities: Set<string>;
  // Modalidades da rotina oficial para este dia (pode ser vazio se nao e dia de rotina)
  routineModalities: string[];
  onStatus: (message: string) => void;
  onCreated: (sessionId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // esteira e corrida sao equivalentes; normalizamos sempre para corrida ao criar sessao manual
  function normalizeM(m: string) { return m === 'esteira' ? 'corrida' : m; }
  const normalizedExisting = new Set([...existingModalities].map(normalizeM));

  // Modalidades da rotina para este dia, normalizadas e deduplicadas
  const normalizedRoutine = [...new Set(routineModalities.map(normalizeM))];
  // Quais ainda nao foram adicionadas
  const pendingRoutine = normalizedRoutine.filter((m) => !normalizedExisting.has(m));

  // Combos que ainda tem pelo menos uma modalidade faltando
  const availableCombos = PICKER_COMBOS.filter((combo) => combo.modalities.some((m) => !normalizedExisting.has(m)));

  // Nada mais pode ser adicionado
  if (!availableCombos.length && pendingRoutine.length === 0) return null;

  // Cria uma ou mais sessoes em sequencia (pula modalidades ja existentes).
  // Para batch (2+), dispara regenerate em paralelo logo apos criar — o treinador nao precisa
  // abrir cada sessao manualmente e clicar "Gerar novo treino".
  // Para sessao unica, mantem o comportamento original (abre o editor).
  async function createSessions(modalities: string[]) {
    const toAdd = modalities.filter((m) => !normalizedExisting.has(m));
    if (!toAdd.length) return;
    const isBatch = toAdd.length > 1;
    setIsCreating(true);
    onStatus(isBatch ? 'Criando sessoes...' : 'Adicionando treino...');
    try {
      // Passo 1: criar todas as sessoes
      const createdIds: string[] = [];
      for (const modality of toAdd) {
        const response = await fetch(`${API_URL}/coach/students/${studentId}/sessions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledDate, modality }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
          onStatus(detail ? `Nao foi possivel adicionar: ${detail}` : 'Nao foi possivel adicionar o treino.');
          setIsCreating(false);
          return;
        }
        if (data.id) createdIds.push(data.id as string);
      }

      setPickerOpen(false);

      if (isBatch) {
        // Passo 2 (batch): gerar conteudo via IA para cada sessao em paralelo
        onStatus(`${createdIds.length} sessoes criadas. Gerando conteudo com IA...`);
        // allowToday:true porque o treinador esta adicionando manualmente — sem ambiguidade
        await Promise.all(
          createdIds.map((id) =>
            fetch(`${API_URL}/coach/students/${studentId}/sessions/${id}/regenerate`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ allowToday: true }),
            }).catch(() => undefined),
          ),
        );
        onStatus('Treinos gerados.');
        const lastId = createdIds[createdIds.length - 1];
        if (lastId) onCreated(lastId);
      } else {
        // Sessao unica: abre o editor pra o treinador preencher ou pedir geracao
        onStatus('Treino adicionado. Preencha ou peca pra IA gerar.');
        const lastId = createdIds[createdIds.length - 1];
        if (lastId) onCreated(lastId);
      }
    } catch {
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setIsCreating(false);
    }
  }

  if (!pickerOpen) {
    return (
      <button className="addSessionButton" type="button" onClick={() => setPickerOpen(true)}>
        <Plus size={14} /> Adicionar treino
      </button>
    );
  }

  // Label legivel para uma lista de modalidades
  function modalityLabel(m: string) {
    if (m === 'corrida') return 'Corrida';
    if (m === 'forca') return 'Musculacao';
    if (m === 'fortalecimento_corredores') return 'Fortalecimento';
    return m;
  }

  return (
    <div className="addSessionPicker">
      {/* Botao "todos do dia" so aparece quando a rotina tem 2+ modalidades pendentes */}
      {pendingRoutine.length >= 2 ? (
        <button
          type="button"
          className="primaryButton"
          disabled={isCreating}
          onClick={() => createSessions(pendingRoutine)}
        >
          Todos do dia ({pendingRoutine.map(modalityLabel).join(' + ')})
        </button>
      ) : null}
      {availableCombos.map((combo) => (
        <button
          key={combo.modalities.join('+')}
          type="button"
          className="secondaryButton"
          disabled={isCreating}
          onClick={() => createSessions(combo.modalities)}
        >
          {combo.label}
        </button>
      ))}
      <button type="button" className="addSessionCancel" disabled={isCreating} onClick={() => setPickerOpen(false)}>Cancelar</button>
    </div>
  );
}

function StravaActivityPanel({ activity }: { activity: StravaActivity }) {
  return (
    <div className="stravaActivityPanel">
      <div className="stravaActivityHeader">
        <strong>Atividade recebida do Strava</strong>
        <span>{dateTimeLabel(activity.startDate)}</span>
      </div>
      <b>{activity.name || activity.type || 'Atividade'}</b>
      <div className="stravaMetrics">
        {activity.distanceKm !== null && activity.distanceKm !== undefined ? <span>{activity.distanceKm} km</span> : null}
        {activity.durationMin ? <span>{activity.durationMin} min</span> : null}
        {activity.paceSecondsKm ? <span>{paceLabel(activity.paceSecondsKm)}</span> : null}
        {activity.averageHeartRate ? <span>FC media {activity.averageHeartRate} bpm</span> : null}
        {activity.maxHeartRate ? <span>FC max. {activity.maxHeartRate} bpm</span> : null}
      </div>
    </div>
  );
}

function isSundayInSaoPaulo() {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date());
  return weekday === 'Sun';
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

interface ExerciseLibraryItem {
  id: string;
  name: string;
  description: string;
  hasVideo: boolean;
  videoUrl: string | null;
}

function StructureEditor({ structure, testPaceSeconds, onChange }: { structure: Record<string, unknown>; testPaceSeconds: number | null; onChange: (value: Record<string, unknown>) => void }) {
  const type = String(structure.type ?? 'run');
  const blocks = Array.isArray(structure.blocks) ? structure.blocks as Array<Record<string, unknown>> : [];
  const exercises = Array.isArray(structure.exercises) ? structure.exercises as Array<Record<string, unknown>> : [];
  const category = String(structure.category ?? '');
  const [exerciseOptions, setExerciseOptions] = useState<ExerciseLibraryItem[]>([]);
  // Antes essa falha era engolida em silencio (catch so zerava a lista) — o dropdown ficava
  // vazio sem nenhuma pista de por que, e a unica forma de descobrir era abrir o DevTools.
  const [exerciseLoadError, setExerciseLoadError] = useState(false);

  useEffect(() => {
    if (type !== 'strength') return;
    setExerciseLoadError(false);
    const token = window.localStorage.getItem('panzeri_admin_token') ?? '';
    fetch(`${API_URL}/coach/exercise-library`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`status ${response.status}`))))
      .then((data: { fortalecimentoCorredores: ExerciseLibraryItem[]; musculacao: ExerciseLibraryItem[] }) => {
        setExerciseOptions(category === 'Musculacao' ? data.musculacao : data.fortalecimentoCorredores);
      })
      .catch((error) => {
        console.error('Falha ao carregar biblioteca de exercicios:', error);
        setExerciseOptions([]);
        setExerciseLoadError(true);
      });
  }, [type, category]);

  function updateExercise(index: number, key: string, value: string | number) {
    const next = exercises.map((exercise, exerciseIndex) => exerciseIndex === index ? { ...exercise, [key]: value } : exercise);
    onChange({ ...structure, exercises: next });
  }

  function selectExerciseFromLibrary(index: number, exerciseId: string) {
    const picked = exerciseOptions.find((option) => option.id === exerciseId);
    if (!picked) return;
    const next = exercises.map((exercise, exerciseIndex) => exerciseIndex === index
      ? { ...exercise, name: picked.name, description: picked.description, videoUrl: picked.videoUrl ?? '' }
      : exercise);
    onChange({ ...structure, exercises: next });
  }

  const typeControl = (
    <div className="structureTypeControl"><span>Estrutura</span><strong>{type === 'strength' ? 'Exercicios' : type === 'aerobic' ? 'Aerobico' : 'Etapas de corrida'}</strong></div>
  );

  if (type === 'strength') {
    return (
      <section className="structureEditor">
        <div className="structureEditorTitle"><div><h3>Exercicios prescritos</h3><span>Edite cada exercicio individualmente</span></div>{typeControl}</div>
        {exerciseLoadError ? (
          <p className="fieldError">Nao consegui carregar a biblioteca de exercicios (verifique a conexao com a API). Voce ainda pode digitar o nome do exercicio manualmente no campo ao lado do menu.</p>
        ) : null}
        <div className="strengthTableScroll">
        <div className="strengthTableHeader">
          <span>Exercicio</span><span>Series</span><span>Repeticoes</span><span>Intensidade</span><span>Pausa</span><span>Cadencia</span><span>Video</span><span>Acao</span>
        </div>
        {exercises.map((exercise, index) => (
          <div className="structureEditRow strengthEditRow" key={index}>
            <label>Exercicio
              <select value={exerciseOptions.find((option) => option.name === exercise.name)?.id ?? ''} onChange={(event) => selectExerciseFromLibrary(index, event.target.value)}>
                <option value="">Escolher da biblioteca...</option>
                {exerciseOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}{option.hasVideo ? '' : ' (sem video)'}</option>
                ))}
              </select>
              <input value={String(exercise.name ?? '')} onChange={(event) => updateExercise(index, 'name', event.target.value)} placeholder="Ou digite manualmente" />
            </label>
            <label>Series<input value={String(exercise.sets ?? '')} onChange={(event) => updateExercise(index, 'sets', Number(event.target.value) || 0)} inputMode="numeric" /></label>
            <label>Repeticoes<input value={String(exercise.reps ?? '')} onChange={(event) => updateExercise(index, 'reps', event.target.value)} /></label>
            <label>Intensidade<input value={String(exercise.intensity ?? '')} onChange={(event) => updateExercise(index, 'intensity', event.target.value)} placeholder="RPE 7" /></label>
            <label>Pausa (s)<input value={String(exercise.restSeconds ?? '')} onChange={(event) => updateExercise(index, 'restSeconds', Number(event.target.value) || 0)} inputMode="numeric" /></label>
            <label>Cadencia<input value={String(exercise.cadence ?? '')} onChange={(event) => updateExercise(index, 'cadence', event.target.value)} /></label>
            <label>Video<input value={String(exercise.videoUrl ?? '')} onChange={(event) => updateExercise(index, 'videoUrl', event.target.value)} placeholder="Link" /></label>
            <button className="removeStructureButton" type="button" onClick={() => onChange({ ...structure, exercises: exercises.filter((_, exerciseIndex) => exerciseIndex !== index) })}>Remover exercicio</button>
            <label className="wideField">Explicacao<input value={String(exercise.description ?? '')} onChange={(event) => updateExercise(index, 'description', event.target.value)} /></label>
          </div>
        ))}
        </div>
        <button className="addStructureButton" type="button" onClick={() => onChange({ ...structure, exercises: [...exercises, { name: 'Novo exercicio', sets: 3, reps: '10', intensity: 'RPE 7', restSeconds: 60, cadence: '', description: '', videoUrl: '' }] })}>Adicionar exercicio</button>
      </section>
    );
  }

  const totals = computeStructureTotals(structure);

  return (
    <section className="structureEditor">
      <div className="structureEditorTitle"><div><h3>Etapas do treino</h3><span>Aquecimento, parte principal e desaquecimento</span></div>{typeControl}</div>
      {blocks.map((block, index) => (
        String(block.blockKind ?? 'continuous') === 'repeat' ? (
          <RepeatBlockEditor
            key={index}
            block={block}
            testPaceSeconds={testPaceSeconds}
            onChange={(nextBlock) => onChange({ ...structure, blocks: blocks.map((item, blockIndex) => blockIndex === index ? nextBlock : item) })}
            onRemove={() => onChange({ ...structure, blocks: blocks.filter((_, blockIndex) => blockIndex !== index) })}
          />
        ) : (
          <RunStepEditor
            key={index}
            block={block}
            testPaceSeconds={testPaceSeconds}
            onChange={(nextBlock) => onChange({ ...structure, blocks: blocks.map((item, blockIndex) => blockIndex === index ? nextBlock : item) })}
            onRemove={() => onChange({ ...structure, blocks: blocks.filter((_, blockIndex) => blockIndex !== index) })}
          />
        )
      ))}
      <div className="structureEditorAddRow">
        <button className="addStructureButton" type="button" onClick={() => onChange({ ...structure, blocks: [...blocks, { blockKind: 'continuous', label: 'Principal', durationType: 'time', durationMin: 10, intensityMode: 'pace', zone: 'Z2', paceRange: '', speedRange: '', activityType: 'corrida' }] })}>Adicionar etapa continua</button>
        <button className="addStructureButton" type="button" onClick={() => onChange({ ...structure, blocks: [...blocks, {
          blockKind: 'repeat',
          label: 'Tiros',
          repeatCount: 4,
          steps: [
            { label: 'Tiro', durationType: 'distance', distanceValue: '400', distanceUnit: 'm', intensityMode: 'pace', activityType: 'corrida', paceStart: '', paceEnd: '' },
            { pausaType: 'ativa', label: 'Recuperacao', durationType: 'distance', distanceValue: '200', distanceUnit: 'm', intensityMode: 'pace', activityType: 'caminhada', paceStart: '', paceEnd: '' },
          ],
        }] })}>Adicionar etapa repetida</button>
      </div>
      <div className="structureTotalsSummary">
        <span><strong>Total</strong>{totals.totalDistanceKm ? `${totals.totalDistanceKm.toFixed(2).replace('.', ',')} km` : '-'} {totals.totalDurationMin ? `| ${totals.totalDurationMin} min` : ''}</span>
        <span><strong>So corrida</strong>{totals.runDistanceKm ? `${totals.runDistanceKm.toFixed(2).replace('.', ',')} km` : '-'} {totals.runDurationMin ? `| ${totals.runDurationMin} min` : ''}</span>
        {totals.incomplete ? <span className="fieldError">Algumas etapas sem pace/velocidade nao entram nesse calculo.</span> : null}
      </div>
    </section>
  );
}

function RunStepEditor({
  block,
  testPaceSeconds,
  onChange,
  onRemove,
  hideRemove,
}: {
  block: Record<string, unknown>;
  testPaceSeconds: number | null;
  onChange: (value: Record<string, unknown>) => void;
  onRemove: () => void;
  hideRemove?: boolean;
}) {
  const durationType = String(block.durationType ?? (block.distanceValue ? 'distance' : 'time'));
  const intensityMode = String(block.intensityMode ?? 'pace');
  const parsedPaces = parsePaceRange(String(block.paceRange ?? ''));
  const paceStart = String(block.paceStart ?? parsedPaces[0] ?? '');
  const paceEnd = String(block.paceEnd ?? parsedPaces[1] ?? parsedPaces[0] ?? '');
  const parsedSpeeds = parseSpeedRange(String(block.speedRange ?? ''));
  const speedStart = String(block.speedStart ?? parsedSpeeds[0] ?? '');
  const speedEnd = String(block.speedEnd ?? parsedSpeeds[1] ?? parsedSpeeds[0] ?? '');

  function updatePace(key: 'paceStart' | 'paceEnd', value: string) {
    const nextStart = key === 'paceStart' ? value : paceStart;
    const nextEnd = key === 'paceEnd' ? value : paceEnd;
    const startSeconds = paceInputSeconds(nextStart);
    const endSeconds = paceInputSeconds(nextEnd);
    const next: Record<string, unknown> = { ...block, intensityMode: 'pace', paceStart: nextStart, paceEnd: nextEnd };
    if (startSeconds && endSeconds) {
      const slow = Math.max(startSeconds, endSeconds);
      const fast = Math.min(startSeconds, endSeconds);
      next.paceRange = `${paceFromSeconds(fast)} a ${paceFromSeconds(slow)}`;
      next.speedRange = speedRangeForPaces(fast, slow);
      next.zone = zoneForPace(Math.round((fast + slow) / 2), testPaceSeconds);
    }
    onChange(next);
  }

  function updateSpeed(key: 'speedStart' | 'speedEnd', value: string) {
    const nextStart = key === 'speedStart' ? value : speedStart;
    const nextEnd = key === 'speedEnd' ? value : speedEnd;
    const start = Number(nextStart.replace(',', '.'));
    const end = Number(nextEnd.replace(',', '.'));
    const next: Record<string, unknown> = { ...block, intensityMode: 'speed', speedStart: nextStart, speedEnd: nextEnd };
    if (start > 0 && end > 0) {
      const minimum = Math.min(start, end);
      const maximum = Math.max(start, end);
      const fastPace = Math.round(3600 / maximum);
      const slowPace = Math.round(3600 / minimum);
      next.speedRange = `${minimum.toFixed(1)} a ${maximum.toFixed(1)} km/h`;
      next.paceRange = `${paceFromSeconds(fastPace)} a ${paceFromSeconds(slowPace)}`;
      next.zone = zoneForPace(Math.round((fastPace + slowPace) / 2), testPaceSeconds);
    }
    onChange(next);
  }

  function updateZone(zone: string, mode = 'zone') {
    const recommended = paceRangeForZone(zone, testPaceSeconds);
    onChange({
      ...block,
      intensityMode: mode,
      zone,
      ...(recommended ? {
        paceStart: paceFromSeconds(recommended.fast).replace('/km', ''),
        paceEnd: paceFromSeconds(recommended.slow).replace('/km', ''),
        paceRange: `${paceFromSeconds(recommended.fast)} a ${paceFromSeconds(recommended.slow)}`,
        speedRange: speedRangeForPaces(recommended.fast, recommended.slow),
      } : {}),
    });
  }

  function updateRpe(rpe: string) {
    const zoneByRpe: Record<string, string> = {
      muito_fraco: 'Z1',
      fraco: 'Z2',
      moderado: 'Z3',
      forte: 'Z4',
      muito_forte: 'Z5',
    };
    updateZone(zoneByRpe[rpe] ?? 'Z2', 'rpe');
    onChange({ ...block, ...zonePrescription(zoneByRpe[rpe] ?? 'Z2', testPaceSeconds), intensityMode: 'rpe', rpe });
  }

  const stageOptions = ['Aquecimento', 'Caminhada', 'Corrida', 'Principal', 'Recuperacao', 'Tiro', 'Repeticao', 'Desaquecimento'];
  const currentLabel = String(block.label ?? 'Principal');
  const activityType = String(block.activityType ?? 'corrida');
  const paceWarning = paceMismatchWarning(block, activityType);

  return (
    <div className="structuredStep">
      <div className="stepTopGrid">
        <label>Etapa
          <select value={currentLabel} onChange={(event) => onChange({ ...block, label: event.target.value })}>
            {!stageOptions.includes(currentLabel) ? <option value={currentLabel}>{currentLabel}</option> : null}
            {stageOptions.map((option) => <option value={option} key={option}>{option}</option>)}
          </select>
        </label>
        <label>Corrida ou caminhada
          <select value={activityType} onChange={(event) => onChange({ ...block, activityType: event.target.value })}>
            <option value="corrida">Corrida</option>
            <option value="caminhada">Caminhada</option>
          </select>
        </label>
        <label>Medida
          <select value={durationType} onChange={(event) => onChange({ ...block, durationType: event.target.value })}>
            <option value="time">Tempo</option>
            <option value="distance">Distancia</option>
          </select>
        </label>
        {durationType === 'time' ? (
          <label>Minutos<input value={String(block.durationMin ?? '')} onChange={(event) => onChange({ ...block, durationMin: Number(event.target.value) || 0 })} inputMode="numeric" /></label>
        ) : (
          <>
            <label>Distancia<input value={String(block.distanceValue ?? '')} onChange={(event) => onChange({ ...block, distanceValue: event.target.value })} inputMode="decimal" /></label>
            <label>Unidade<select value={String(block.distanceUnit ?? 'km')} onChange={(event) => onChange({ ...block, distanceUnit: event.target.value })}><option value="km">km</option><option value="m">metros</option></select></label>
          </>
        )}
        <label>Referencia principal
          <select value={intensityMode} onChange={(event) => onChange({ ...block, intensityMode: event.target.value })}>
            <option value="pace">Pace</option>
            <option value="speed">Velocidade</option>
            <option value="zone">Zona</option>
            <option value="rpe">Percepcao de esforco</option>
          </select>
        </label>
      </div>

      {intensityMode === 'pace' ? (
        <div className="intensityInputs"><label>Pace limite (rapido)<input value={paceStart} onChange={(event) => updatePace('paceStart', event.target.value)} placeholder="05:13" /></label><label>Pace limite (lento)<input value={paceEnd} onChange={(event) => updatePace('paceEnd', event.target.value)} placeholder="05:38" /></label></div>
      ) : null}
      {intensityMode === 'speed' ? (
        <div className="intensityInputs"><label>Velocidade minima<input value={speedStart} onChange={(event) => updateSpeed('speedStart', event.target.value)} placeholder="10,7" /></label><label>Velocidade maxima<input value={speedEnd} onChange={(event) => updateSpeed('speedEnd', event.target.value)} placeholder="11,5" /></label></div>
      ) : null}
      {intensityMode === 'zone' ? (
        <div className="intensityInputs"><label>Zona<select value={String(block.zone ?? 'Z2')} onChange={(event) => updateZone(event.target.value)}>{['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map((zone) => <option key={zone}>{zone}</option>)}</select></label></div>
      ) : null}
      {intensityMode === 'rpe' ? (
        <div className="intensityInputs"><label>Percepcao de esforco<select value={String(block.rpe ?? 'moderado')} onChange={(event) => updateRpe(event.target.value)}><option value="muito_fraco">Muito fraco</option><option value="fraco">Fraco</option><option value="moderado">Moderado</option><option value="forte">Forte</option><option value="muito_forte">Muito forte</option></select></label></div>
      ) : null}

      <div className="calculatedIntensity">
        <span><strong>Zona</strong>{String(block.zone ?? '-')}</span>
        <span><strong>Pace</strong>{String(block.paceRange ?? '-')}</span>
        <span><strong>Velocidade</strong>{String(block.speedRange ?? '-').replaceAll('.', ',')}</span>
      </div>
      {paceWarning ? <p className="fieldError">{paceWarning}</p> : null}
      <label>Instrucao da etapa<input value={String(block.guidance ?? '')} onChange={(event) => onChange({ ...block, guidance: event.target.value })} placeholder="Orientacao que aparecera para o aluno" /></label>
      {!hideRemove ? <button className="removeStructureButton" type="button" onClick={onRemove}>Remover etapa</button> : null}
    </div>
  );
}

function RepeatBlockEditor({
  block,
  testPaceSeconds,
  onChange,
  onRemove,
}: {
  block: Record<string, unknown>;
  testPaceSeconds: number | null;
  onChange: (value: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const repeatCount = Number(block.repeatCount ?? 1) || 1;
  const label = String(block.label ?? 'Tiros');
  const steps = Array.isArray(block.steps) ? block.steps as Array<Record<string, unknown>> : [];
  const estimulo = steps[0] ?? { label: 'Tiro', durationType: 'distance', distanceValue: '400', distanceUnit: 'm', intensityMode: 'pace', activityType: 'corrida' };
  const pausa = steps[1] ?? { pausaType: 'ativa', label: 'Recuperacao', durationType: 'distance', distanceValue: '200', distanceUnit: 'm', intensityMode: 'pace', activityType: 'caminhada' };
  const pausaType = String(pausa.pausaType ?? 'ativa');

  function updateSteps(nextEstimulo: Record<string, unknown>, nextPausa: Record<string, unknown>) {
    onChange({ ...block, steps: [nextEstimulo, nextPausa] });
  }

  function setPausaType(nextType: string) {
    if (nextType === 'passiva') {
      updateSteps(estimulo, { pausaType: 'passiva', label: 'Pausa', durationType: 'time', durationMin: 1, observacao: String(pausa.observacao ?? '') });
    } else {
      updateSteps(estimulo, { pausaType: 'ativa', label: 'Recuperacao', durationType: 'distance', distanceValue: '200', distanceUnit: 'm', intensityMode: 'pace', activityType: 'caminhada' });
    }
  }

  return (
    <div className="structuredStep repeatBlock">
      <div className="stepTopGrid">
        <label>Nome do bloco<input value={label} onChange={(event) => onChange({ ...block, label: event.target.value })} /></label>
        <label>Repetir Nx<input value={String(repeatCount)} onChange={(event) => onChange({ ...block, repeatCount: Number(event.target.value) || 0 })} inputMode="numeric" /></label>
      </div>
      <h4>Estimulo</h4>
      <RunStepEditor
        block={estimulo}
        testPaceSeconds={testPaceSeconds}
        onChange={(nextEstimulo) => updateSteps(nextEstimulo, pausa)}
        onRemove={() => {}}
        hideRemove
      />
      <h4>Pausa</h4>
      <label>Tipo de pausa
        <select value={pausaType} onChange={(event) => setPausaType(event.target.value)}>
          <option value="ativa">Ativa (caminhada/corrida leve)</option>
          <option value="passiva">Passiva (parado)</option>
        </select>
      </label>
      {pausaType === 'ativa' ? (
        <RunStepEditor
          block={pausa}
          testPaceSeconds={testPaceSeconds}
          onChange={(nextPausa) => updateSteps(estimulo, { ...nextPausa, pausaType: 'ativa' })}
          onRemove={() => {}}
          hideRemove
        />
      ) : (
        <div className="stepTopGrid">
          <label>Minutos<input value={String(pausa.durationMin ?? '')} onChange={(event) => updateSteps(estimulo, { ...pausa, durationMin: Number(event.target.value) || 0 })} inputMode="numeric" /></label>
          <label className="wideField">Observacao (opcional)<input value={String(pausa.observacao ?? '')} onChange={(event) => updateSteps(estimulo, { ...pausa, observacao: event.target.value })} placeholder="Instrucao para o aluno durante a pausa" /></label>
        </div>
      )}
      <button className="removeStructureButton" type="button" onClick={onRemove}>Remover bloco repetido</button>
    </div>
  );
}

function paceMismatchWarning(block: Record<string, unknown>, activityType: string): string | null {
  const start = paceInputSeconds(String(block.paceStart ?? ''));
  const end = paceInputSeconds(String(block.paceEnd ?? ''));
  const paceSeconds = start && end ? Math.round((start + end) / 2) : start ?? end;
  if (!paceSeconds) return null;
  if (activityType === 'corrida' && paceSeconds > 510) return 'Ritmo incomum para corrida (mais lento que 8:30/km) - confira.';
  if (activityType === 'caminhada' && paceSeconds < 420) return 'Ritmo incomum para caminhada (mais rapido que 7:00/km) - confira.';
  return null;
}

function paceSecondsFromStep(step: Record<string, unknown>): number | null {
  const start = paceInputSeconds(String(step.paceStart ?? ''));
  const end = paceInputSeconds(String(step.paceEnd ?? ''));
  if (start && end) return Math.round((start + end) / 2);
  return start ?? end ?? null;
}

function stepDistanceAndDuration(step: Record<string, unknown>): { distanceKm: number; durationMin: number; ok: boolean } {
  const durationType = String(step.durationType ?? (step.distanceValue ? 'distance' : 'time'));
  const paceSeconds = paceSecondsFromStep(step);
  if (durationType === 'distance') {
    const raw = Number(String(step.distanceValue ?? '0').replace(',', '.')) || 0;
    const unit = String(step.distanceUnit ?? 'km');
    const distanceKm = unit === 'm' ? raw / 1000 : raw;
    if (!paceSeconds) return { distanceKm, durationMin: 0, ok: false };
    return { distanceKm, durationMin: (distanceKm * paceSeconds) / 60, ok: true };
  }
  const durationMin = Number(step.durationMin ?? 0) || 0;
  if (!paceSeconds) return { distanceKm: 0, durationMin, ok: false };
  return { distanceKm: (durationMin * 60) / paceSeconds, durationMin, ok: true };
}

interface StructureTotals {
  totalDistanceKm: number;
  totalDurationMin: number;
  runDistanceKm: number;
  runDurationMin: number;
  incomplete: boolean;
}

function computeStructureTotals(structure: Record<string, unknown>): StructureTotals {
  const blocks = Array.isArray(structure.blocks) ? structure.blocks as Array<Record<string, unknown>> : [];
  let totalDistanceKm = 0;
  let totalDurationMin = 0;
  let runDistanceKm = 0;
  let runDurationMin = 0;
  let incomplete = false;

  function addStep(step: Record<string, unknown>, multiplier: number, isRun: boolean) {
    const { distanceKm, durationMin, ok } = stepDistanceAndDuration(step);
    if (!ok) incomplete = true;
    totalDistanceKm += distanceKm * multiplier;
    totalDurationMin += durationMin * multiplier;
    if (isRun) {
      runDistanceKm += distanceKm * multiplier;
      runDurationMin += durationMin * multiplier;
    }
  }

  for (const block of blocks) {
    const blockKind = String(block.blockKind ?? 'continuous');
    if (blockKind === 'repeat') {
      const repeatCount = Number(block.repeatCount ?? 0) || 0;
      const steps = Array.isArray(block.steps) ? block.steps as Array<Record<string, unknown>> : [];
      const estimulo = steps[0];
      const pausa = steps[1];
      if (estimulo) addStep(estimulo, repeatCount, String(estimulo.activityType ?? 'corrida') === 'corrida');
      if (pausa) {
        if (String(pausa.pausaType ?? 'ativa') === 'passiva') {
          totalDurationMin += (Number(pausa.durationMin ?? 0) || 0) * repeatCount;
        } else {
          addStep(pausa, repeatCount, String(pausa.activityType ?? 'caminhada') === 'corrida');
        }
      }
    } else {
      addStep(block, 1, String(block.activityType ?? 'corrida') === 'corrida');
    }
  }

  return {
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    totalDurationMin: Math.round(totalDurationMin),
    runDistanceKm: Math.round(runDistanceKm * 100) / 100,
    runDurationMin: Math.round(runDurationMin),
    incomplete,
  };
}

function AdminPrescription({ structure, notes }: { structure?: Record<string, unknown> | null; notes?: string | null }) {
  if (!structure) {
    if (!notes) return null;
    return <p className="coachNotes">{notes}</p>;
  }
  const type = String(structure.type ?? '');
  if (type === 'run' || type === 'aerobic') {
    const blocks = Array.isArray(structure.blocks) ? structure.blocks as Array<Record<string, unknown>> : [];
    return (
      <div className="adminPrescription">
        {blocks.map((block) => {
          const repeatCount = Number(block.repeatCount ?? 0);
          const steps = Array.isArray(block.steps) ? block.steps as Array<Record<string, unknown>> : [];
          if (repeatCount && steps.length) {
            return (
              <div className="adminBlock" key={String(block.label)}>
                <strong>Repetir {repeatCount}x</strong>
                {steps.map((step, index) => {
                  const pausaType = step.pausaType ? String(step.pausaType) : null;
                  if (pausaType === 'passiva') {
                    return (
                      <span key={`${String(step.label)}-${index}`}>
                        - Pausa passiva{step.durationMin ? ` (${String(step.durationMin)} min)` : ''}
                        {step.observacao ? ` - ${String(step.observacao)}` : ''}
                      </span>
                    );
                  }
                  return (
                    <span key={`${String(step.label)}-${index}`}>
                      - {String(step.label)}{pausaType === 'ativa' ? ' (pausa ativa' + (step.activityType ? `, ${String(step.activityType)}` : '') + ')' : step.activityType ? ` (${String(step.activityType)})` : ''} por {String(step.distanceValue)}{String(step.distanceUnit ?? 'km')}
                      {step.paceRange ? ` - Pace (${String(step.paceRange)})` : ''}
                      {step.speedRange ? ` | Velocidade (${String(step.speedRange).replaceAll('.', ',')})` : ''}
                      {step.durationRange ? ` - completar entre ${String(step.durationRange)}` : ''}
                    </span>
                  );
                })}
              </div>
            );
          }
          return (
            <div className="adminBlock" key={String(block.label)}>
              <strong>{String(block.label)}</strong>
              <span>{adminStepMeasure(block)} {block.zone ? `| ${String(block.zone)}` : ''}</span>
              {block.paceRange ? <span>Pace: {String(block.paceRange)}</span> : null}
              {block.speedRange ? <span>Velocidade: {String(block.speedRange).replaceAll('.', ',')}</span> : null}
              {block.rpe ? <span>Esforco: {adminRpeLabel(String(block.rpe))}</span> : null}
              {block.guidance ? <span>{String(block.guidance)}</span> : null}
            </div>
          );
        })}
        {notes ? <p className="coachNotes">{notes}</p> : null}
      </div>
    );
  }
  const exercises = Array.isArray(structure.exercises) ? structure.exercises as Array<Record<string, unknown>> : [];
  return (
    <div className="adminPrescription">
      {exercises.map((exercise) => (
        <div className="adminBlock" key={String(exercise.name)}>
          <strong>{String(exercise.name)}</strong>
          <span>{String(exercise.sets)} series x {String(exercise.reps)} | pausa {String(exercise.restSeconds)}s</span>
          {exercise.intensity ? <span>Intensidade: {String(exercise.intensity)}</span> : null}
          {exercise.cadence ? <span>Cadencia: {String(exercise.cadence)}</span> : null}
          {exercise.videoUrl ? <span>Video cadastrado</span> : null}
        </div>
      ))}
      {notes ? <p className="coachNotes">{notes}</p> : null}
    </div>
  );
}

function ReportContent({ report }: { report: CoachReport }) {
  const metrics = report.content?.metrics ?? {};
  return (
    <div className="reportContent">
      {Object.keys(metrics).length ? (
        <div className="reportMetrics">
          {Object.entries(metrics).map(([key, value]) => <span key={key}><strong>{reportMetricLabel(key)}</strong>{String(value ?? '-')}</span>)}
        </div>
      ) : null}
      {report.content?.sections?.map((section) => (
        <article key={section.title}>
          <h4>{section.title}</h4>
          <p>{section.text}</p>
        </article>
      ))}
    </div>
  );
}

function reportMetricLabel(key: string) {
  const labels: Record<string, string> = {
    sessions: 'Treinos',
    weeklyKm: 'Km semana',
    latest3km: 'Teste 3 km',
    availabilityDays: 'Dias disponiveis',
    adherencePercent: 'Aderencia',
    completedSessions: 'Treinos feitos',
    prescribedSessions: 'Treinos previstos',
    prescribedKm: 'Km previstos',
    completedKm: 'Km feitos',
    stravaKm: 'Km Strava',
    stravaMinutes: 'Min Strava',
    averageEffort: 'PSE media',
    trend: 'Tendencia',
  };
  return labels[key] ?? key;
}
function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="detailItem">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function statusClass(status: string) {
  if (status === 'Treino gerado') return 'good';
  if (status === 'Nunca gerou treino') return 'warn';
  if (status === 'Bloqueado') return 'danger';
  // Precisa de acao real do treinador (verificar chave da IA/logs e gerar manualmente pelo
  // painel) — diferente de "Aguardando aluna gerar treino", que e so a aluna nao ter tocado o
  // botao ainda. Ver TrainingPlansService.generateWeek / lastPlanGenerationFailedAt.
  if (status === 'Falha ao gerar semana de treino') return 'danger';
  // Neutro de proposito — nao e um alerta, e a aluna aguardando tocar o botao de gerar a semana.
  if (status === 'Aguardando aluna gerar treino') return '';
  return '';
}

function accountStatusClass(status: string) {
  if (status === 'active') return 'good';
  if (status === 'paused' || status === 'overdue') return 'warn';
  if (status === 'canceled' || status === 'archived') return 'danger';
  return '';
}

function subscriptionStatusClass(status: string) {
  if (status === 'active' || status === 'manual_active') return 'good';
  if (status === 'pending' || status === 'grace') return 'warn';
  if (status === 'overdue' || status === 'canceled') return 'danger';
  return '';
}

// Visao rapida de vencimento/ultima sincronizacao pro treinador bater o olho na lista e ja saber
// se tem algum problema (pedido explicito apos o incidente de webhook perdido em 02/08) — sem
// precisar abrir o perfil de cada aluna uma por uma.
function billingHint(student: { subscriptionManualOverride?: boolean; billingNextChargeAt?: string | null; billingLastSyncAt?: string | null }) {
  if (student.subscriptionManualOverride) return 'Cortesia (nao verifica Asaas)';
  if (!student.billingNextChargeAt && !student.billingLastSyncAt) return 'Sem assinatura Asaas ainda';
  const parts: string[] = [];
  if (student.billingNextChargeAt) {
    const due = new Date(student.billingNextChargeAt);
    // 27/08: comparar por timestamp cru (due.getTime() < Date.now()) fazia vencimento de HOJE
    // aparecer como "Venceu em" a partir de qualquer horario depois da meia-noite UTC (9h em
    // Brasilia) — mesma familia do bug corrigido em billing.service.ts. Comparando por DIA de
    // calendario em Brasilia, vencimento hoje so vira "Venceu em" amanha.
    const dueDaySP = due.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const todayDaySP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const overdue = dueDaySP < todayDaySP;
    parts.push(`${overdue ? 'Venceu em' : 'Vence em'} ${due.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`);
  }
  if (student.billingLastSyncAt) {
    parts.push(`sync ${new Date(student.billingLastSyncAt).toLocaleDateString('pt-BR')}`);
  }
  return parts.join(' - ');
}

function completionLabel(status: string) {
  if (status === 'done') return 'feito';
  if (status === 'adjusted') return 'ajustado';
  if (status === 'missed') return 'nao feito';
  return 'sem registro';
}

function satisfactionLabel(value: string) {
  const labels: Record<string, string> = {
    amei: 'Amei',
    gostei: 'Gostei',
    neutro: 'Neutro',
    nao_gostei: 'Nao gostei',
    detestei: 'Detestei',
  };
  return labels[value] ?? value;
}

function cargaLabel(value: string) {
  const labels: Record<string, string> = {
    muito_leve: 'Muito leve',
    leve: 'Leve',
    na_medida: 'Na medida',
    pesada: 'Pesada',
    muito_pesada: 'Muito pesada',
  };
  return labels[value] ?? value;
}

// 19/08: satisfacao virou 4 perguntas separadas (elaboracao/fazer/capacidade/carga) em vez de uma
// so vaga — resume as que tiverem resposta numa unica linha compacta pro historico de semana.
function satisfactionDimensionsLine(session: {
  satisfactionElaboracao?: string | null;
  satisfaction?: string | null;
  satisfactionCapacidade?: string | null;
  satisfactionCarga?: string | null;
}) {
  const parts: string[] = [];
  if (session.satisfactionElaboracao) parts.push(`Elaboracao: ${satisfactionLabel(session.satisfactionElaboracao)}`);
  if (session.satisfaction) parts.push(`Fazer: ${satisfactionLabel(session.satisfaction)}`);
  if (session.satisfactionCapacidade) parts.push(`Como conseguiu: ${satisfactionLabel(session.satisfactionCapacidade)}`);
  if (session.satisfactionCarga) parts.push(`Carga: ${cargaLabel(session.satisfactionCarga)}`);
  return parts.length ? ` | ${parts.join(' | ')}` : '';
}

function methodologySummaryLine(methodology: {
  safetyAdjustment: boolean;
}) {
  const parts: string[] = [];
  if (methodology.safetyAdjustment) parts.push('Cautela ativa por dor/limitacao recente');
  parts.push('Decisao: agente de IA');
  return parts.join(' · ');
}

function modalityOrderRank(modality: string) {
  if (modality === 'corrida' || modality === 'esteira') return 0;
  if (modality === 'fortalecimento_corredores') return 1;
  if (modality === 'forca') return 2;
  return 3;
}

function modalityAccentColor(modality: string) {
  if (modality === 'corrida' || modality === 'esteira') return '#0f766e';
  if (modality === 'fortalecimento_corredores') return '#d97706';
  if (modality === 'forca') return '#7c3aed';
  return '#64748b';
}

function dateForWeekday(planStartDate: string, weekday: number) {
  const start = new Date(planStartDate);
  if (Number.isNaN(start.getTime())) return null;
  const offset = weekday === 0 ? 6 : weekday - 1;
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + offset));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function paceLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}/km`;
}

function adminStepMeasure(block: Record<string, unknown>) {
  if (block.durationType === 'distance' && block.distanceValue) {
    return `${String(block.distanceValue)} ${block.distanceUnit === 'm' ? 'm' : 'km'}`;
  }
  return `${String(block.durationMin ?? 0)} min`;
}

function adminRpeLabel(value: string) {
  const labels: Record<string, string> = {
    muito_fraco: 'Muito fraco',
    fraco: 'Fraco',
    moderado: 'Moderado',
    forte: 'Forte',
    muito_forte: 'Muito forte',
  };
  return labels[value] ?? value;
}

function parsePaceSeconds(value?: string | null) {
  if (!value) return null;
  const match = value.match(/(\d+):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function paceInputSeconds(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds > 0 ? seconds : null;
}

function paceFromSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}/km`;
}

function parsePaceRange(value: string) {
  return [...value.matchAll(/(\d{1,2}:\d{2})/g)].map((match) => match[1]);
}

function parseSpeedRange(value: string) {
  return [...value.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((match) => match[1].replace('.', ','));
}

function speedRangeForPaces(fastPace: number, slowPace: number) {
  const minimum = 3600 / slowPace;
  const maximum = 3600 / fastPace;
  return `${minimum.toFixed(1)} a ${maximum.toFixed(1)} km/h`;
}

function zoneForPace(paceSeconds: number, testPaceSeconds: number | null) {
  if (!testPaceSeconds) return 'Sem teste';
  const factor = paceSeconds / testPaceSeconds;
  if (factor >= 1.5) return 'Z1';
  if (factor >= 1.3) return 'Z2';
  if (factor >= 1.14) return 'Z3';
  if (factor >= 1.02) return 'Z4';
  return 'Z5';
}

function paceRangeForZone(zone: string, testPaceSeconds: number | null) {
  if (!testPaceSeconds) return null;
  const targetFactors: Record<string, number> = {
    Z1: 1.57,
    Z2: 1.36,
    Z3: 1.21,
    Z4: 1.07,
    Z5: 0.95,
  };
  const target = Math.round(testPaceSeconds * (targetFactors[zone] ?? targetFactors.Z2));
  return { slow: target + 12, fast: Math.max(target - 12, 1) };
}

function zonePrescription(zone: string, testPaceSeconds: number | null) {
  const recommended = paceRangeForZone(zone, testPaceSeconds);
  if (!recommended) return { zone };
  return {
    zone,
    paceStart: paceFromSeconds(recommended.fast).replace('/km', ''),
    paceEnd: paceFromSeconds(recommended.slow).replace('/km', ''),
    paceRange: `${paceFromSeconds(recommended.fast)} a ${paceFromSeconds(recommended.slow)}`,
    speedRange: speedRangeForPaces(recommended.fast, recommended.slow),
  };
}

function modalityLabel(value: string) {
  const labels: Record<string, string> = {
    corrida: 'Corrida',
    esteira: 'Corrida na esteira',
    forca: 'Musculacao',
    fortalecimento_corredores: 'Fortalecimento para corredores',
    bike: 'Bike ou aerobico',
  };
  return labels[value] ?? value;
}

function isStrengthModality(modality: string) {
  return modality === 'forca' || modality === 'fortalecimento_corredores';
}

function normalizeSessionStructure(session: NonNullable<StudentDetail['plan']>['sessions'][number]) {
  const existing: Record<string, unknown> = session.structure ? structuredClone(session.structure) : {};
  if (isStrengthModality(session.modality)) {
    return existing.type === 'strength'
      ? existing
      : {
          type: 'strength',
          category: session.modality === 'fortalecimento_corredores' ? 'Fortalecimento para corredores' : 'Musculacao',
          exercises: [],
        };
  }
  if (existing.type === 'run' || existing.type === 'aerobic') return existing;
  return { type: session.modality === 'bike' ? 'aerobic' : 'run', blocks: [] };
}

const ROUTINE_DAYS: Array<[string, string]> = [
  ['monday', 'Seg'], ['tuesday', 'Ter'], ['wednesday', 'Qua'], ['thursday', 'Qui'], ['friday', 'Sex'], ['saturday', 'Sab'], ['sunday', 'Dom'],
];

const ROUTINE_DAY_WEEKDAYS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
};

function RoutineAvailabilityTable({ answers, availability }: { answers: Record<string, unknown>; availability: NonNullable<StudentDetail['availability']> }) {
  const rows: Array<{ label: string; modalityKey: string; availableSuffix: string; aliases?: string[] }> = [
    // 08/09: esteira e corrida sao equivalentes na rotina (o tipo e so contexto pra IA) — a linha
    // "Corrida" mostra o valor de qualquer das duas, priorizando corrida. Dados historicos podem
    // ter 'esteira' no lugar de 'corrida'; o admin nao deve esconder isso como "NAO".
    { label: 'Corrida', modalityKey: 'corrida', availableSuffix: 'run_available_time', aliases: ['esteira'] },
    { label: 'Fortalecimento', modalityKey: 'fortalecimento_corredores', availableSuffix: 'fortalecimento_available_time' },
    { label: 'Musculacao', modalityKey: 'forca', availableSuffix: 'musculacao_available_time' },
  ];
  return (
    <div className="routineTableWrap">
    <table className="routineTable">
      <thead>
        <tr>
          <th>Modalidade</th>
          {ROUTINE_DAYS.map(([key, label]) => <th key={key}>{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.modalityKey}>
            <td>{row.label}</td>
            {ROUTINE_DAYS.map(([dayKey]) => {
              const day = availability.find((item) => item.weekday === ROUTINE_DAY_WEEKDAYS[dayKey]);
              // Verifica a chave principal e aliases (ex: corrida e esteira sao equivalentes)
              const allKeys = [row.modalityKey, ...(row.aliases ?? [])];
              const minutes = day && !day.noTraining
                ? allKeys.reduce<number | undefined>((found, key) => found ?? day.modalityDurations?.[key], undefined)
                : undefined;
              const isNone = !minutes;
              return <td key={dayKey} className={isNone ? 'routineCellOff' : 'routineCellOn'}>{isNone ? 'NAO' : `${minutes} min`}</td>;
            })}
          </tr>
        ))}
        {rows.map((row) => (
          <tr key={row.availableSuffix}>
            <td>Horario - {row.label}</td>
            {ROUTINE_DAYS.map(([dayKey]) => (
              <td key={dayKey}>{interviewValue(`${dayKey}_${row.availableSuffix}`, answers[`${dayKey}_${row.availableSuffix}`])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

const MANUAL_ROUTINE_MODALITIES: Array<{ key: string; label: string }> = [
  { key: 'corrida', label: 'Corrida' },
  { key: 'fortalecimento_corredores', label: 'Fortalecimento' },
  { key: 'forca', label: 'Musculacao' },
];

interface ManualRoutineDay {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  modalityDurations: Record<string, number>;
}

function manualRoutineDaysFromAvailability(availability: NonNullable<StudentDetail['availability']>): ManualRoutineDay[] {
  return ROUTINE_DAYS.map(([dayKey]) => {
    const weekday = ROUTINE_DAY_WEEKDAYS[dayKey];
    const saved = availability.find((item) => item.weekday === weekday);
    if (!saved || saved.noTraining || !saved.modalities.length) {
      return { weekday, noTraining: true, modalities: [], modalityDurations: {} };
    }
    return {
      weekday,
      noTraining: false,
      modalities: saved.modalities,
      modalityDurations: { ...(saved.modalityDurations ?? {}) },
    };
  });
}

// Botao "Editar rotina" no painel do treinador — pedido explicito 03/08 (caso da Roberta): o
// treinador precisa poder corrigir a rotina de um aluno na hora, sem depender do proprio aluno
// acertar isso sozinho pelo app nem esbarrar na trava de 1x por mes (essa trava e so do aluno).
function ManualRoutineEditor({ studentId, token, availability, onStatus, onSaved }: { studentId: string; token: string; availability: NonNullable<StudentDetail['availability']>; onStatus: (message: string) => void; onSaved: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState<ManualRoutineDay[]>(() => manualRoutineDaysFromAvailability(availability));
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setDays(manualRoutineDaysFromAvailability(availability));
    setEditing(true);
  }

  function toggleModality(weekday: number, modalityKey: string) {
    setDays((current) => current.map((day) => {
      if (day.weekday !== weekday) return day;
      const has = day.modalities.includes(modalityKey);
      const modalities = has ? day.modalities.filter((item) => item !== modalityKey) : [...day.modalities, modalityKey];
      const modalityDurations = { ...day.modalityDurations };
      if (has) {
        delete modalityDurations[modalityKey];
      } else {
        modalityDurations[modalityKey] = 45;
      }
      return { ...day, modalities, noTraining: modalities.length === 0, modalityDurations };
    }));
  }

  function updateMinutes(weekday: number, modalityKey: string, minutes: number) {
    setDays((current) => current.map((day) => (
      day.weekday === weekday ? { ...day, modalityDurations: { ...day.modalityDurations, [modalityKey]: minutes } } : day
    )));
  }

  async function save(applyNow: boolean) {
    setSaving(true);
    onStatus(applyNow ? 'Salvando rotina e gerando o treino...' : 'Salvando rotina...');
    try {
      const payload = days.map((day) => ({
        weekday: day.weekday,
        noTraining: day.noTraining,
        modalities: day.modalities,
        availableMin: day.noTraining ? 0 : Math.max(...day.modalities.map((key) => day.modalityDurations[key] ?? 45)),
        modalityDurations: day.modalityDurations,
      }));
      const response = await fetch(`${API_URL}/coach/students/${studentId}/availability`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability: payload, applyNow }),
      });
      if (!response.ok) {
        onStatus('Nao consegui salvar a rotina.');
        return;
      }
      await onSaved();
      onStatus(applyNow
        ? 'Rotina atualizada. O treino esta sendo gerado com base nela.'
        : 'Rotina salva. Vale a partir da geracao automatica de domingo — a semana atual continua igual.');
      setEditing(false);
    } catch {
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return <button className="secondaryButton" type="button" onClick={startEditing}>Editar rotina manualmente</button>;
  }

  return (
    <div className="manualRoutineEditor">
      {days.map((day) => (
        <div className="manualRoutineDay" key={day.weekday}>
          <strong>{weekdayLabel(day.weekday)}</strong>
          <div className="manualRoutineModalities">
            {MANUAL_ROUTINE_MODALITIES.map((modality) => {
              const checked = day.modalities.includes(modality.key);
              return (
                <label className="manualRoutineModalityRow" key={modality.key}>
                  <input type="checkbox" checked={checked} onChange={() => toggleModality(day.weekday, modality.key)} />
                  <span>{modality.label}</span>
                  {checked ? (
                    <input
                      type="number"
                      min={10}
                      // Era 240 (4h) — baixo demais pra alunos preparando prova longa: uma
                      // maratona sozinha ja tem 6h de tempo limite oficial. 480 (8h) da folga
                      // real pra longao de maratona/ultra sem soar como "sem limite nenhum".
                      max={480}
                      value={day.modalityDurations[modality.key] ?? 45}
                      onChange={(event) => updateMinutes(day.weekday, modality.key, Math.max(10, Number(event.target.value) || 45))}
                    />
                  ) : null}
                  {checked ? <span>min</span> : null}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div className="manualRoutineActions">
        <button className="primaryButton" type="button" onClick={() => save(true)} disabled={saving}>Salvar e gerar agora</button>
        <button className="secondaryButton" type="button" onClick={() => save(false)} disabled={saving}>Salvar (aplicar so domingo)</button>
        <button className="secondaryButton" type="button" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
      </div>
    </div>
  );
}

const DISTANCE_BUCKET_MIDPOINT_KM: Record<string, number> = {
  '1_3': 2, '3_5': 4, '5_8': 6.5, '8_10': 9, '10_15': 12.5, '15_21': 18, '21_30': 25.5, '30_42': 36, '42_plus': 45,
};

function formatMmssAsHms(value: unknown): string | null {
  const match = String(value ?? '').match(/^(\d{1,4}):(\d{1,2})$/);
  if (!match) return null;
  const totalMinutes = Number(match[1]);
  const seconds = Number(match[2]);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function longestDistancePaceSummary(answers: Record<string, unknown>): string | null {
  const hms = formatMmssAsHms(answers.longest_distance_recent_time);
  if (!hms) return null;
  const match = String(answers.longest_distance_recent_time ?? '').match(/^(\d{1,4}):(\d{1,2})$/);
  const distanceKm = DISTANCE_BUCKET_MIDPOINT_KM[String(answers.longest_distance_recent)];
  if (!match || !distanceKm) return hms;
  const totalSeconds = Number(match[1]) * 60 + Number(match[2]);
  const paceSecondsPerKm = Math.round(totalSeconds / distanceKm);
  const paceMin = Math.floor(paceSecondsPerKm / 60);
  const paceSec = paceSecondsPerKm % 60;
  return `${hms} (aprox. ${distanceKm} km) - pace estimado ${paceMin}:${String(paceSec).padStart(2, '0')}/km`;
}

// 10/09: ordem preferida dentro de cada grupo para colocar campos relacionados juntos
// (ex: "Maior distância" e "Vezes na maior distância" aparecem adjacentes).
const INTERVIEW_GROUP_ORDER: Record<string, string[]> = {
  'Experiencia com corrida': [
    'running_experience', 'weekly_running_km', 'best_comfortable_pace', 'current_continuous_run',
    'quick_current_stage', 'recent_running_feeling', 'fitness_self_rating', 'races_last_12_months',
    // longest_distance (campo legado numérico) fica junto de recent e count para aparecerem na
    // mesma linha da grade — "Maior distância | Maior distância (legado) | Vezes | Tempo".
    'longest_distance_recent', 'longest_distance', 'longest_distance_recent_count', 'longest_distance_recent_time',
    'second_longest_distance_recent', 'second_longest_distance_recent_count',
    'third_longest_distance_recent', 'third_longest_distance_recent_count',
    'ran_5k_recently',
  ],
};

function groupInterviewAnswers(answers: Record<string, unknown>) {
  const groups = new Map<string, Array<[string, unknown]>>();
  // 10/09: filtrar 'rating_intro' e chaves de marcação "tela vista" sem valor informativo.
  Object.entries(answers).filter(([key]) => key !== 'rating_intro' && !HIDDEN_INTERVIEW_KEYS.has(key)).forEach(([key, value]) => {
    const title = interviewGroup(key);
    groups.set(title, [...(groups.get(title) ?? []), [key, value]]);
  });
  // Reordenar campos dentro de cada grupo para colocar relacionados juntos.
  groups.forEach((items, title) => {
    const order = INTERVIEW_GROUP_ORDER[title];
    if (order) {
      items.sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    }
  });
  return Array.from(groups, ([title, items]) => ({ title, items }));
}

function interviewGroup(key: string) {
  if (key === 'objective') return 'Objetivo';
  if (key === 'additional_info') return 'Informacoes adicionais';
  if (key.startsWith('rating_')) return 'Autoavaliacao';
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)_/.test(key)) return 'Rotina semanal';
  if (key.startsWith('assessment_') || key.includes('circumference') || ['personal_height', 'personal_weight', 'muscle_mass', 'lean_mass', 'fat_mass', 'visceral_fat', 'basal_metabolism', 'body_fat_percentage', 'recent_physical_assessment'].includes(key)) return 'Avaliacao fisica recente';
  if (key.startsWith('personal_')) return 'Dados pessoais';
  if (key.startsWith('pain_detail_') || key.startsWith('health_condition_status_') || key.startsWith('running_condition_status_')) return 'Saude';
  if (['current_pain', 'pain_regions', 'pain_region', 'pain_other_location', 'important_injury', 'injury_description', 'health_conditions', 'health_conditions_other', 'continuous_medications', 'medical_recommendation', 'diagnosed_running_conditions', 'diagnosed_running_conditions_other'].includes(key)) return 'Saude';
  if (['sleep_hours', 'smoking', 'alcohol_frequency', 'work_routine', 'daily_steps'].includes(key)) return 'Habitos';
  if (['strength_experience', 'training_consistency', 'pushups', 'squat_experience', 'perceived_strength'].includes(key)) return 'Treinamento de forca';
  return 'Experiencia com corrida';
}

function interviewLabel(key: string) {
  const labels: Record<string, string> = {
    objective: 'Objetivo principal', running_experience: 'Experiencia com corrida', longest_distance: 'Maior distancia', best_comfortable_pace: 'Melhor pace confortavel',
    current_continuous_run: 'Corrida continua atual', races_last_12_months: 'Provas nos ultimos 12 meses', current_activities: 'Atividades atuais', favorite_activities: 'Atividades preferidas',
    ran_5k_recently: 'Correu 5km+ nos ultimos 6 meses', longest_distance_recent: 'Maior distancia no ultimo ano', longest_distance_recent_count: 'Vezes na maior distancia',
    second_longest_distance_recent: 'Segunda maior distancia', second_longest_distance_recent_count: 'Vezes na segunda maior distancia',
    third_longest_distance_recent: 'Terceira maior distancia', third_longest_distance_recent_count: 'Vezes na terceira maior distancia',
    longest_distance_recent_time: 'Tempo na maior distancia', recent_running_feeling: 'Sensacao nessas corridas', fitness_self_rating: 'Condicionamento auto-avaliado',
    strength_experience: 'Experiencia com musculacao', training_consistency: 'Frequencia nos treinos', pushups: 'Flexoes continuas', squat_experience: 'Experiencia com agachamento', perceived_strength: 'Forca percebida',
    current_pain: 'Dor atual', pain_regions: 'Regioes da dor', pain_region: 'Regiao da dor (entrevista antiga)', pain_detail_knee: 'Detalhe - joelho', pain_detail_ankle: 'Detalhe - tornozelo',
    pain_detail_foot: 'Detalhe - pe', pain_detail_shin: 'Detalhe - canela', pain_detail_calf: 'Detalhe - panturrilha', pain_detail_thigh: 'Detalhe - coxa',
    pain_detail_hip: 'Detalhe - quadril', pain_detail_glute: 'Detalhe - gluteo', pain_detail_lower_back: 'Detalhe - lombar', pain_other_location: 'Outro local de dor',
    diagnosed_running_conditions: 'Diagnosticos ja recebidos', diagnosed_running_conditions_other: 'Outro diagnostico',
    important_injury: 'Lesao importante', injury_description: 'Descricao da lesao', health_conditions: 'Condicoes de saude', health_conditions_other: 'Qual outra condicao', weekly_running_km: 'Km semanal atual',
    health_condition_status_hipertensao: 'Hipertensao - situacao', health_condition_status_diabetes: 'Diabetes - situacao', health_condition_status_colesterol: 'Colesterol elevado - situacao',
    health_condition_status_obesidade: 'Obesidade - situacao', health_condition_status_asma: 'Asma - situacao', health_condition_status_cardiaco: 'Problemas cardiacos - situacao',
    health_condition_status_artrose: 'Artrose - situacao', health_condition_status_artrite: 'Artrite - situacao', health_condition_status_hernia_disco: 'Hernia de disco - situacao',
    continuous_medications: 'Medicamentos continuos', medical_recommendation: 'Recomendacao medica', recent_physical_assessment: 'Avaliacao nos ultimos 6 meses', assessment_method: 'Metodo da avaliacao',
    sleep_hours: 'Horas de sono', smoking: 'Tabagismo', alcohol_frequency: 'Consumo de alcool', work_routine: 'Rotina de trabalho', daily_steps: 'Passos diarios',
    personal_name: 'Nome completo', personal_phone: 'WhatsApp', personal_birth_date: 'Data de nascimento', personal_sex: 'Sexo', personal_height: 'Altura', personal_weight: 'Peso',
    personal_cpf: 'CPF', personal_education: 'Escolaridade', personal_address: 'Endereco completo (entrevista antiga)', personal_nickname: 'Como prefere ser chamado',
    personal_cep: 'CEP', personal_address_street: 'Rua', personal_address_number: 'Numero', personal_address_complement: 'Complemento',
    personal_address_neighborhood: 'Bairro', personal_address_city: 'Cidade', personal_address_state: 'Estado',
    training_modality_preference: 'Preferencia de modalidades',
    routine_modality_choice: 'Modalidade de treino preferida',
    routine_modality_confirmation: 'Confirmacao de modalidade',
    routine_observation: 'Observacao sobre a rotina',
    quick_current_stage: 'Estagio atual com a corrida',
    quick_main_barrier: 'Principais barreiras',
    quick_expectations: 'Expectativas do treinamento',
    quick_has_target_race: 'Tem prova como objetivo',
    quick_target_race_name: 'Nome da prova alvo',
    quick_target_race_date: 'Data da prova alvo',
    routine_intro: 'Introducao de rotina (tela vista)',
    welcome_intro: 'Boas-vindas (tela vista)',
    routine_confirmation: 'Confirmacao de rotina (tela vista)',
    additional_info: 'Informacoes adicionais do aluno',
    rating_energy: 'Nota - Energia no dia a dia', rating_training_readiness: 'Nota - Disposicao para treinar', rating_fitness: 'Nota - Condicionamento fisico',
    rating_strength: 'Nota - Forca fisica', rating_sleep: 'Nota - Qualidade do sono', rating_recovery: 'Nota - Recuperacao apos os treinos',
    rating_stress: 'Nota - Nivel de estresse', rating_anxiety: 'Nota - Nivel de ansiedade', rating_motivation: 'Nota - Motivacao para treinar',
    rating_nutrition: 'Nota - Qualidade da alimentacao', rating_hydration: 'Nota - Hidratacao', rating_health: 'Nota - Saude geral',
    rating_pain_free: 'Nota - Quanto o corpo esta livre de dores', rating_body_satisfaction: 'Nota - Satisfacao com o corpo',
    rating_quality_of_life: 'Nota - Qualidade de vida', rating_goal_confidence: 'Nota - Confianca de atingir o objetivo',
    rating_routine_support: 'Nota - Quanto a rotina favorece o objetivo',
    waist_circumference: 'Circunferencia da cintura', abdomen_circumference: 'Circunferencia do abdomen', hip_circumference: 'Circunferencia do quadril',
    arm_circumference: 'Circunferencia do braco', thigh_circumference: 'Circunferencia da coxa', calf_circumference: 'Circunferencia da panturrilha',
  };
  if (labels[key]) return labels[key];
  const days: Record<string, string> = { monday: 'Segunda-feira', tuesday: 'Terca-feira', wednesday: 'Quarta-feira', thursday: 'Quinta-feira', friday: 'Sexta-feira', saturday: 'Sabado', sunday: 'Domingo' };
  const day = Object.keys(days).find((item) => key.startsWith(`${item}_`));
  if (day) {
    const fields: Record<string, string> = { run_time: 'tempo para corrida', run_location: 'local da corrida (antigo)', fortalecimento_time: 'tempo para fortalecimento', musculacao_time: 'tempo para musculacao', available_time: 'horario disponivel (antigo)', run_available_time: 'horario disponivel - corrida', fortalecimento_available_time: 'horario disponivel - fortalecimento', musculacao_available_time: 'horario disponivel - musculacao' };
    const suffix = key.slice(day.length + 1);
    return `${days[day]} - ${fields[suffix] ?? suffix}`;
  }
  if (key.startsWith('running_condition_status_')) return 'Diagnostico de corredor - situacao';
  return key.replace(/^rating_/, 'Nota - ').replace(/_/g, ' ');
}

// Muitas perguntas de escolha unica salvam um valor interno curto (ingles ou snake_case, ex:
// "yes"/"no", "muito_leve", "8_10") separado do texto em portugues que o aluno viu na tela.
// Sem esta traducao, o painel mostraria esses valores crus para o treinador.
const INTERVIEW_CHOICE_LABELS: Record<string, Record<string, string>> = {
  ran_5k_recently: { no: 'Nao', yes: 'Sim' },
  current_pain: { no: 'Nao', yes: 'Sim' },
  recent_physical_assessment: { no: 'Nao', yes: 'Sim' },
  reassessment_new_pain: { no: 'Nao', yes: 'Sim' },
  recent_running_feeling: {
    tranquila: 'Tranquila, consegui manter o ritmo com folga', moderada: 'Moderada, exigiu esforco mas terminei bem',
    dificil: 'Dificil, precisei desacelerar ou parar algumas vezes', muito_dificil: 'Muito dificil, quase nao consegui terminar',
  },
  fitness_self_rating: { muito_leve: 'Muito leve', leve: 'Leve', moderado: 'Moderado', forte: 'Forte', muito_forte: 'Muito forte' },
  weekly_running_km: {
    '0_10': 'Ate 10 km por semana', '10_20': '10 a 20 km por semana', '20_30': '20 a 30 km por semana', '30_40': '30 a 40 km por semana',
    '40_50': '40 a 50 km por semana', '50_75': '50 a 75 km por semana', '75_100': '75 a 100 km por semana', '100_plus': 'Mais de 100 km por semana',
  },
  training_modality_preference: {
    somente_corrida: 'Somente corrida', corrida_fortalecimento: 'Corrida + fortalecimento para corredores',
    corrida_musculacao: 'Corrida + musculacao', corrida_fortalecimento_musculacao: 'Corrida + fortalecimento para corredores + musculacao',
  },
  reassessment_goal_change: { same: 'Sim, continua o mesmo', changed: 'Mudou' },
  reassessment_routine_change: { no: 'Nao mudou', a_little: 'Mudou um pouco', a_lot: 'Mudou bastante' },
  reassessment_perceived_evolution: { piorou: 'Piorou', igual: 'Continua igual', melhorou_pouco: 'Melhorou um pouco', melhorou_muito: 'Melhorou bastante' },
  reassessment_satisfaction: {
    muito_insatisfeito: 'Muito insatisfeito', insatisfeito: 'Insatisfeito', neutro: 'Neutro', satisfeito: 'Satisfeito', muito_satisfeito: 'Muito satisfeito',
  },
  // 10/09: valores codificados das perguntas do quick-intake que chegavam crus no painel.
  running_experience: {
    currently_lt_3m: 'Corro atualmente, comecei ha menos de 3 meses.',
    currently_lt_6m: 'Corro atualmente, comecei ha menos de 6 meses.',
    currently_lt_1y: 'Corro atualmente, comecei ha menos de 1 ano.',
    currently_gt_1y: 'Corro atualmente, comecei ha mais de 1 ano.',
  },
  quick_current_stage: {
    nao_continuo: 'Ainda nao consigo correr continuamente',
    comecando_alterno: 'Estou comecando e alterno corrida e caminhada',
    alguns_km: 'Ja consigo correr alguns quilometros',
    frequencia: 'Corro com frequencia',
    performance: 'Ja treino para provas e busco performance',
  },
  quick_has_target_race: { sim: 'Sim', nao: 'Ainda nao tenho prova como objetivo' },
  quick_main_barrier: {
    falta_tempo: 'Falta de tempo',
    constancia: 'Dificuldade para manter constancia',
    medo_lesao: 'Medo de se machucar',
    nao_sei_treinar: 'Nao sei como treinar',
    ja_tentei: 'Ja tentei antes e nao consegui manter',
    conciliar_musculacao: 'Dificuldade para conciliar corrida e musculacao',
  },
  quick_expectations: {
    foco: 'Que me ajudem a manter o foco',
    desafio: 'Que saibam me desafiar quando puder ir alem',
    diminuir_ritmo: 'Que percebam quando e melhor diminuir o ritmo',
    seguranca: 'Que me deem seguranca de estar no caminho certo',
    ajustar_caminho: 'Que me ajudem a ajustar o caminho quando algo mudar',
    entender_rotina: 'Que entendam minha rotina',
    entender_treinamento: 'Que me ajudem a entender o treinamento',
    atentos_evolucao: 'Que estejam atentos a minha evolucao',
  },
  routine_modality_choice: {
    somente_corrida: 'Somente corrida',
    corrida_fortalecimento: 'Corrida + fortalecimento para corredores',
    corrida_musculacao: 'Corrida + musculacao',
    corrida_fortalecimento_musculacao: 'Corrida + fortalecimento + musculacao',
  },
  daily_steps: {
    ate_3000: '0 a 3 mil passos', '3000_a_5000': '3 mil a 5 mil passos', '5000_a_8000': '5 mil a 8 mil passos',
    '8000_a_10000': '8 mil a 10 mil passos', '10000_a_15000': '10 mil a 15 mil passos', '15000_a_20000': '15 mil a 20 mil passos',
    acima_20000: 'Acima de 20 mil passos',
  },
};

const DISTANCE_BUCKET_LABELS: Record<string, string> = {
  none: 'Nunca corri continuamente', '1_3': '1 a 3 km', '3_5': '3 a 5 km', '5_8': '5 a 8 km', '8_10': '8 a 10 km',
  '10_15': '10 a 15 km', '15_21': '15 a 21 km', '21_30': '21 a 30 km', '30_42': '30 a 42 km', '42_plus': 'Mais de 42 km',
};
const DISTANCE_COUNT_BUCKET_LABELS: Record<string, string> = {
  '1': '1 vez', '2_3': '2 a 3 vezes', '4_6': '4 a 6 vezes', '7_12': '7 a 12 vezes', '12_plus': 'Mais de 12 vezes',
};
const TIME_BUCKET_LABELS: Record<string, string> = {
  none: 'Nao posso treinar', up_to_30: 'Ate 30 minutos', from_30_to_45: '30 a 45 minutos',
  from_45_to_60: '45 a 60 minutos', from_60_to_90: '60 a 90 minutos',
  from_90_to_150: '90 a 150 minutos', from_150_to_240: '150 a 240 minutos', over_240: 'Mais de 240 minutos',
  // over_90 e legado — opcao removida do dropdown do app, mas ainda existe em respostas antigas.
  over_90: 'Mais de 90 minutos',
};
const LOCATION_LABELS: Record<string, string> = { street: 'Rua', treadmill: 'Esteira', either: 'Tanto faz' };
const DISTANCE_BUCKET_KEYS = new Set(['longest_distance', 'longest_distance_recent', 'second_longest_distance_recent', 'third_longest_distance_recent']);
const DISTANCE_COUNT_KEYS = new Set(['longest_distance_recent_count', 'second_longest_distance_recent_count', 'third_longest_distance_recent_count']);
const WEEKDAY_KEY_PREFIXES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// 10/09: chaves que só marcam "o aluno viu esta tela" — boolean Sim sem valor informativo para o treinador.
const HIDDEN_INTERVIEW_KEYS = new Set(['routine_intro', 'welcome_intro', 'routine_confirmation', 'routine_modality_confirmation']);

function interviewValue(key: string, value: unknown) {
  // 10/09: arrays (multi-select) agora traduzem cada item antes de juntar — antes chegavam como valores crus.
  if (Array.isArray(value)) {
    if (!value.length) return 'Nenhum';
    return value.map((item) => INTERVIEW_CHOICE_LABELS[key]?.[String(item)] ?? String(item)).join(', ');
  }
  if (value === true) return 'Sim';
  if (value === false) return 'Nao';
  if (value === 'unknown') return 'Nao sei';
  const stringValue = String(value ?? '');
  if ((key.startsWith('health_condition_status_') || key.startsWith('running_condition_status_')) && (stringValue === 'current' || stringValue === 'past')) {
    return stringValue === 'current' ? 'Tenho atualmente' : 'Tive no passado, nao tenho mais';
  }
  const directLabel = INTERVIEW_CHOICE_LABELS[key]?.[stringValue]
    ?? (DISTANCE_BUCKET_KEYS.has(key) ? DISTANCE_BUCKET_LABELS[stringValue] : undefined)
    ?? (DISTANCE_COUNT_KEYS.has(key) ? DISTANCE_COUNT_BUCKET_LABELS[stringValue] : undefined);
  if (directLabel) return directLabel;
  const day = WEEKDAY_KEY_PREFIXES.find((item) => key.startsWith(`${item}_`));
  if (day) {
    const suffix = key.slice(day.length + 1);
    if (suffix === 'run_time' || suffix === 'fortalecimento_time' || suffix === 'musculacao_time') return TIME_BUCKET_LABELS[stringValue] ?? stringValue;
    if (suffix === 'run_location') return LOCATION_LABELS[stringValue] ?? stringValue;
  }
  return value === undefined || value === null || stringValue.trim() === '' ? 'Nao informado' : stringValue;
}
function listLabel(items: string[]) {
  return items.length ? items.join(', ') : 'Nao informado';
}

function weekdayLabel(weekday: number) {
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][weekday] ?? String(weekday);
}

async function copyText(text: string) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10/09 / 11/09: Componentes de Evolução
// ─────────────────────────────────────────────────────────────────────────────

// Helpers compartilhados pelos novos componentes v1
type FlatSession = ReturnType<typeof flatFeedbackSessions>[number];

function painFlagNumeric(flag: string | null): number {
  if (!flag || flag === 'none') return 0;
  if (flag === 'leve') return 1;
  if (flag === 'moderado') return 2;
  if (flag === 'forte') return 3;
  return 0;
}

const PAIN_COLOR: Record<number, string> = { 0: '#22c55e', 1: '#facc15', 2: '#fb923c', 3: '#ef4444' };
const PAIN_LABEL: Record<number, string> = { 0: 'Sem dor', 1: 'Leve', 2: 'Moderada', 3: 'Forte' };

const SCALE5_GRADIENT = ['#ef4444', '#fb923c', '#facc15', '#86efac', '#22c55e'];
function scale5Color(v: number | null) { return v ? SCALE5_GRADIENT[v - 1] : '#cbd5e1'; }

const PAIN_TIMING_LABELS: Record<string, string> = {
  ja_comecei_sentindo: 'Já comecei sentindo',
  comeco_passou: 'Comecou e passou',
  comeco_continuou: 'Comecou e continuou',
  durante_passou: 'Durante e passou',
  durante_continuou: 'Durante até o final',
  so_depois: 'Só depois do treino',
};

function minToHhmm(min: number | null): string {
  if (!min) return '—';
  const h = Math.floor(min / 60); const m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`;
}

// ── VISÃO GERAL ────────────────────────────────────────────────────────────
/** Faixa de indicadores-chave do período acima dos cards. */
function VisaoGeralSection({ sessions, weeks }: { sessions: FlatSession[]; weeks: WeekData[] }) {
  const done = sessions.filter((s) => s.completionStatus === 'done' || s.completionStatus === 'adjusted');
  const withRPE = done.filter((s) => s.perceivedEffort != null);
  const withElab = done.filter((s) => s.satisfactionElaboracao != null);
  const withExec = done.filter((s) => s.satisfactionCapacidade != null);
  const withMotiv = done.filter((s) => s.preMotivation != null);
  const withPain = done.filter((s) => s.painFlag && s.painFlag !== 'none');

  const satScore = (v: string | null) => ({ amei: 5, gostei: 4, neutro: 3, nao_gostei: 2, detestei: 1 }[v ?? ''] ?? null);
  const avg = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? (v.reduce((a,b)=>a+b,0)/v.length) : null; };
  const fmt = (n: number | null, den: number, dec = 1) => n == null ? '–' : `${n.toFixed(dec)}/${den}`;

  const avgRPE = avg(withRPE.map((s) => s.perceivedEffort));
  const avgElab = avg(withElab.map((s) => satScore(s.satisfactionElaboracao)));
  const avgExec = avg(withExec.map((s) => satScore(s.satisfactionCapacidade)));
  const avgMotiv = avg(withMotiv.map((s) => s.preMotivation));
  const totalPrescribed = weeks.reduce((a, w) => a + w.prescribedSessions, 0);
  const totalDone = weeks.reduce((a, w) => a + w.completedSessions, 0);
  const totalKmP = weeks.reduce((a, w) => a + w.prescribedKm, 0);
  const totalKmC = weeks.reduce((a, w) => a + w.completedKm, 0);
  const adherence = totalPrescribed > 0 ? Math.round((totalDone / totalPrescribed) * 100) : null;

  const tiles: Array<{ label: string; value: string; sub?: string; color?: string }> = [
    { label: 'Aderência', value: adherence != null ? `${adherence}%` : '–', color: adherence != null ? (adherence >= 80 ? '#22c55e' : adherence >= 60 ? '#fb923c' : '#ef4444') : undefined },
    { label: 'Treinos feitos', value: totalPrescribed > 0 ? `${totalDone}` : '–', sub: totalPrescribed > 0 ? `de ${totalPrescribed}` : undefined },
    { label: 'Km', value: totalKmC > 0 ? `${totalKmC.toFixed(0)}` : '–', sub: totalKmP > 0 ? `de ${totalKmP.toFixed(0)} km` : undefined },
    { label: 'RPE médio', value: fmt(avgRPE, 10), sub: withRPE.length > 0 ? `${withRPE.length} registros` : undefined },
    { label: 'Elaboração', value: fmt(avgElab, 5), sub: withElab.length > 0 ? `${withElab.length} registros` : undefined },
    { label: 'Execução', value: fmt(avgExec, 5), sub: withExec.length > 0 ? `${withExec.length} registros` : undefined },
    { label: 'Motivação pré', value: fmt(avgMotiv, 5), sub: withMotiv.length > 0 ? `${withMotiv.length} registros` : undefined },
    { label: 'Treinos c/ dor', value: withPain.length > 0 ? String(withPain.length) : '0', sub: done.length > 0 ? `de ${done.length}` : undefined, color: withPain.length > 0 ? '#fb923c' : undefined },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, padding: '12px 0 4px' }}>
      {tiles.map((t) => (
        <div key={t.label} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.2 }}>{t.label}</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: t.color ?? 'var(--fg)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{t.value}</span>
          {t.sub && <span style={{ fontSize: 10, color: 'var(--muted)' }}>{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ── ESTADO ANTES DOS TREINOS ───────────────────────────────────────────────
type PreWorkoutSeries = 'sono' | 'cansaco' | 'estresse' | 'motivacao';
const PRE_SERIES: Array<{ key: PreWorkoutSeries; label: string; color: string; field: keyof FlatSession }> = [
  { key: 'sono',      label: 'Sono',       color: '#6366f1', field: 'preSleepQuality' },
  { key: 'cansaco',   label: 'Cansaço',    color: '#f59e0b', field: 'prePhysicalFatigue' },
  { key: 'estresse',  label: 'Estresse',   color: '#ef4444', field: 'preStressLevel' },
  { key: 'motivacao', label: 'Motivação',  color: '#22c55e', field: 'preMotivation' },
];

// Índice de Prontidão: média das 4 variáveis, invertendo cansaço e estresse
// (alto cansaço/estresse = ruim → inverte para escala positiva)
// Resultado fica na escala 1-5 como as séries individuais.
function computeReadiness(s: { preSleepQuality: number | null; prePhysicalFatigue: number | null; preStressLevel: number | null; preMotivation: number | null }): number | null {
  const vals: number[] = [];
  if (s.preSleepQuality != null)    vals.push(s.preSleepQuality);
  if (s.prePhysicalFatigue != null) vals.push(6 - s.prePhysicalFatigue); // invertido
  if (s.preStressLevel != null)     vals.push(6 - s.preStressLevel);     // invertido
  if (s.preMotivation != null)      vals.push(s.preMotivation);
  return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function PreWorkoutStateSection({ history }: { history: StudentDetail['history']; period?: number }) {
  const [active, setActive] = useState<Set<PreWorkoutSeries>>(new Set(['sono', 'cansaco', 'estresse', 'motivacao']));
  const [showReadiness, setShowReadiness] = useState(true);
  const [aggBy, setAggBy] = useState<'sessao' | 'semana' | 'mes'>('sessao');

  const allSessions = flatFeedbackSessions(history)
    .filter((s) => PRE_SERIES.some((p) => s[p.field] != null))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (allSessions.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum dado de estado pré-treino disponível ainda (coleta começou em 11/09/2026).</p>;

  // Agregar por período se necessário
  type DataPoint = { label: string; values: Partial<Record<PreWorkoutSeries, number | null>>; n: number; readiness: number | null };
  let points: DataPoint[] = [];

  if (aggBy === 'sessao') {
    points = allSessions.map((s) => ({
      label: s.date.slice(5).replace('-', '/'),
      n: 1,
      readiness: computeReadiness(s),
      values: {
        sono: s.preSleepQuality,
        cansaco: s.prePhysicalFatigue,
        estresse: s.preStressLevel,
        motivacao: s.preMotivation,
      },
    }));
  } else {
    const buckets = new Map<string, { sum: Partial<Record<PreWorkoutSeries, number>>; cnt: Partial<Record<PreWorkoutSeries, number>>; n: number }>();
    for (const s of allSessions) {
      const key = aggBy === 'semana' ? s.weekStart : s.date.slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, { sum: {}, cnt: {}, n: 0 });
      const b = buckets.get(key)!; b.n++;
      for (const { key: k, field } of PRE_SERIES) {
        const v = s[field] as number | null;
        if (v != null) { b.sum[k] = (b.sum[k] ?? 0) + v; b.cnt[k] = (b.cnt[k] ?? 0) + 1; }
      }
    }
    points = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, b]) => {
      const avgVals = Object.fromEntries(PRE_SERIES.map(({ key: k }) => [k, b.cnt[k] ? (b.sum[k]! / b.cnt[k]!) : null])) as Partial<Record<PreWorkoutSeries, number | null>>;
      return {
        label: aggBy === 'semana' ? key.slice(5).replace('-', '/') : key.slice(0, 7),
        n: b.n,
        values: avgVals,
        readiness: computeReadiness({ preSleepQuality: avgVals.sono ?? null, prePhysicalFatigue: avgVals.cansaco ?? null, preStressLevel: avgVals.estresse ?? null, preMotivation: avgVals.motivacao ?? null }),
      };
    });
  }

  const W = 560; const H = 180; const PL = 32; const PR = 8; const PT = 12; const PB = 28;
  const gW = W - PL - PR; const gH = H - PT - PB;
  const n = points.length;
  const xStep = n > 1 ? gW / (n - 1) : gW;
  const yScale = (v: number) => PT + gH - ((v - 1) / 4) * gH;

  const xLabels = n <= 8 ? points.map((p, i) => ({ i, label: p.label }))
    : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1].map((i) => ({ i, label: points[i].label }));

  return (
    <div>
      {/* Controles */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {PRE_SERIES.map(({ key: k, label, color }) => (
          <button key={k} type="button" onClick={() => setActive((prev) => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; })}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', fontWeight: active.has(k) ? 700 : 400,
              background: active.has(k) ? color + '22' : 'var(--surface)',
              border: `1.5px solid ${active.has(k) ? color : 'var(--line)'}`,
              color: active.has(k) ? color : 'var(--muted)' }}>
            {active.has(k) ? '✓ ' : ''}{label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['sessao', 'semana', 'mes'] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAggBy(a)}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, cursor: 'pointer',
                background: aggBy === a ? 'var(--accent)' : 'var(--surface)',
                color: aggBy === a ? '#fff' : 'var(--muted)',
                border: `1px solid ${aggBy === a ? 'var(--accent)' : 'var(--line)'}` }}>
              {a === 'sessao' ? 'Por sessão' : a === 'semana' ? 'Por semana' : 'Por mês'}
            </button>
          ))}
        </span>
      </div>
      {aggBy !== 'sessao' && <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Médias agregadas — n={points.reduce((a, p) => a + p.n, 0)} sessões</p>}
      {/* Gráfico */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {/* Bandas de zona: vermelho 1-2, amarelo 2-3.5, verde 3.5-5 */}
        <rect x={PL} y={yScale(5)} width={gW} height={yScale(3.5) - yScale(5)} fill="#22c55e18" />
        <rect x={PL} y={yScale(3.5)} width={gW} height={yScale(2) - yScale(3.5)} fill="#f59e0b14" />
        <rect x={PL} y={yScale(2)} width={gW} height={PT + gH - yScale(2)} fill="#ef444418" />
        {/* Rótulos de zona (direita) */}
        <text x={W - PR + 3} y={yScale(4.5) + 4} fontSize={7} fill="#22c55e99" textAnchor="start">ótimo</text>
        <text x={W - PR + 3} y={yScale(2.75) + 4} fontSize={7} fill="#f59e0b99" textAnchor="start">ok</text>
        <text x={W - PR + 3} y={yScale(1.5) + 4} fontSize={7} fill="#ef444499" textAnchor="start">baixo</text>
        {/* Grid */}
        {[1,2,3,4,5].map((v) => { const y = yScale(v); return (
          <g key={v}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--line)" strokeWidth={v === 3 ? 1 : 0.4} strokeDasharray={v === 3 ? '3,3' : undefined} />
            <text x={PL - 4} y={y + 4} fontSize={8} fill="var(--muted)" textAnchor="end">{v}</text>
          </g>
        ); })}
        {/* Linhas de cada série */}
        {PRE_SERIES.filter(({ key: k }) => active.has(k)).map(({ key: k, color }) => {
          const pts = points.map((p, i) => ({ x: PL + i * xStep, y: p.values[k] != null ? yScale(p.values[k]!) : null }));
          const segments: string[] = [];
          let seg = '';
          for (const { x, y } of pts) {
            if (y == null) { if (seg) segments.push(seg); seg = ''; }
            else seg += seg ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
          }
          if (seg) segments.push(seg);
          return (
            <g key={k}>
              {segments.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeOpacity={0.8} />)}
              {pts.map((pt, i) => pt.y != null ? <circle key={i} cx={pt.x} cy={pt.y} r={2.5} fill={color} /> : null)}
            </g>
          );
        })}
        {/* Linha de Prontidão (readiness index — média ponderada invertendo cansaço e estresse) */}
        {showReadiness && (() => {
          const pts = points.map((p, i) => ({ x: PL + i * xStep, y: p.readiness != null ? yScale(p.readiness) : null }));
          const segs: string[] = []; let seg = '';
          for (const { x, y } of pts) {
            if (y == null) { if (seg) segs.push(seg); seg = ''; }
            else seg += seg ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
          }
          if (seg) segs.push(seg);
          return (
            <g>
              {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#0ea5e9" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="5,3" />)}
              {pts.map((pt, i) => pt.y != null ? <circle key={i} cx={pt.x} cy={pt.y} r={3.5} fill="#0ea5e9" fillOpacity={0.85} /> : null)}
            </g>
          );
        })()}
        {/* Eixo X */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={PL + i * xStep} y={H - 4} fontSize={8} fill="var(--muted)" textAnchor="middle">{label}</text>
        ))}
      </svg>
      {/* Legenda de prontidão */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setShowReadiness((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
            background: showReadiness ? '#0ea5e922' : 'var(--surface)',
            border: `1.5px solid ${showReadiness ? '#0ea5e9' : 'var(--line)'}`,
            color: showReadiness ? '#0ea5e9' : 'var(--muted)', fontWeight: showReadiness ? 700 : 400 }}>
          {showReadiness ? '✓ ' : ''}Prontidão (índice)
        </button>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
          Prontidão = média(sono, motivação, 6−cansaço, 6−estresse) — escala 1–5. Abaixo de 2.5 merece atenção.
        </span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Escala 1–5. Ausência = dado não coletado (sessões anteriores a 11/09/2026).</p>
    </div>
  );
}

// ── EXPERIÊNCIA COM O TREINO ───────────────────────────────────────────────
type ExpSeries = 'elaboracao' | 'execucao' | 'sensacao' | 'humor';
const EXP_SERIES: Array<{ key: ExpSeries; label: string; color: string }> = [
  { key: 'elaboracao', label: 'Elaboração',   color: '#818cf8' },
  { key: 'execucao',   label: 'Execução',     color: '#34d399' },
  { key: 'sensacao',   label: 'Sensação corporal', color: '#f472b6' },
  { key: 'humor',      label: 'Humor final',  color: '#fb923c' },
];
const SAT_TO_5: Record<string, number> = { amei: 5, gostei: 4, neutro: 3, nao_gostei: 2, detestei: 1 };

function ExperienciaTreinoSection({ history, onDayClick }: { history: StudentDetail['history']; period?: number; onDayClick?: (planId: string) => void }) {
  const [active, setActive] = useState<Set<ExpSeries>>(new Set(['elaboracao', 'execucao', 'sensacao', 'humor']));
  const [aggBy, setAggBy] = useState<'sessao' | 'semana' | 'mes'>('sessao');
  const [showDist, setShowDist] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; idx: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const allSessions = flatFeedbackSessions(history)
    .filter((s) => s.satisfactionElaboracao != null || s.satisfactionCapacidade != null || s.postWorkoutFeeling != null || s.postWorkoutMood != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (allSessions.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem dados de experiência de treino disponíveis.</p>;

  type DataPoint = { label: string; elaboracao: number | null; execucao: number | null; sensacao: number | null; humor: number | null; n: number };

  function toNum(s: FlatSession): { elaboracao: number | null; execucao: number | null; sensacao: number | null; humor: number | null } {
    return {
      elaboracao: s.satisfactionElaboracao ? (SAT_TO_5[s.satisfactionElaboracao] ?? null) : null,
      execucao: s.satisfactionCapacidade ? (SAT_TO_5[s.satisfactionCapacidade] ?? null) : null,
      sensacao: s.postWorkoutFeeling ?? null,
      humor: s.postWorkoutMood ?? null,
    };
  }

  let points: DataPoint[] = [];
  if (aggBy === 'sessao') {
    points = allSessions.map((s) => ({ label: s.date.slice(5).replace('-', '/'), n: 1, ...toNum(s) }));
  } else {
    const buckets = new Map<string, { sum: Record<string, number>; cnt: Record<string, number>; n: number }>();
    for (const s of allSessions) {
      const key = aggBy === 'semana' ? s.weekStart : s.date.slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, { sum: {}, cnt: {}, n: 0 });
      const b = buckets.get(key)!; b.n++;
      const nums = toNum(s);
      for (const [k, v] of Object.entries(nums)) {
        if (v != null) { b.sum[k] = (b.sum[k] ?? 0) + v; b.cnt[k] = (b.cnt[k] ?? 0) + 1; }
      }
    }
    points = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, b]) => ({
      label: aggBy === 'semana' ? key.slice(5).replace('-', '/') : key.slice(0, 7),
      n: b.n,
      elaboracao: b.cnt.elaboracao ? b.sum.elaboracao / b.cnt.elaboracao : null,
      execucao: b.cnt.execucao ? b.sum.execucao / b.cnt.execucao : null,
      sensacao: b.cnt.sensacao ? b.sum.sensacao / b.cnt.sensacao : null,
      humor: b.cnt.humor ? b.sum.humor / b.cnt.humor : null,
    }));
  }

  const W = 560; const H = 180; const PL = 32; const PR = 8; const PT = 12; const PB = 28;
  const gW = W - PL - PR; const gH = H - PT - PB;
  const n = points.length;
  const xStep = n > 1 ? gW / (n - 1) : gW;
  const yScale = (v: number) => PT + gH - ((v - 1) / 4) * gH;
  const xLabels = n <= 8 ? points.map((p, i) => ({ i, label: p.label }))
    : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1].map((i) => ({ i, label: points[i].label }));

  // Distribuição de respostas
  const distCounts: Record<ExpSeries, Record<string, number>> = { elaboracao: {}, execucao: {}, sensacao: {}, humor: {} };
  for (const s of allSessions) {
    if (s.satisfactionElaboracao) distCounts.elaboracao[s.satisfactionElaboracao] = (distCounts.elaboracao[s.satisfactionElaboracao] ?? 0) + 1;
    if (s.satisfactionCapacidade) distCounts.execucao[s.satisfactionCapacidade] = (distCounts.execucao[s.satisfactionCapacidade] ?? 0) + 1;
    if (s.postWorkoutFeeling) { const k = String(s.postWorkoutFeeling); distCounts.sensacao[k] = (distCounts.sensacao[k] ?? 0) + 1; }
    if (s.postWorkoutMood) { const k = String(s.postWorkoutMood); distCounts.humor[k] = (distCounts.humor[k] ?? 0) + 1; }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {EXP_SERIES.map(({ key: k, label, color }) => (
          <button key={k} type="button" onClick={() => setActive((prev) => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; })}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', fontWeight: active.has(k) ? 700 : 400,
              background: active.has(k) ? color + '22' : 'var(--surface)', border: `1.5px solid ${active.has(k) ? color : 'var(--line)'}`,
              color: active.has(k) ? color : 'var(--muted)' }}>
            {active.has(k) ? '✓ ' : ''}{label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['sessao', 'semana', 'mes'] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAggBy(a)}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, cursor: 'pointer',
                background: aggBy === a ? 'var(--accent)' : 'var(--surface)', color: aggBy === a ? '#fff' : 'var(--muted)',
                border: `1px solid ${aggBy === a ? 'var(--accent)' : 'var(--line)'}` }}>
              {a === 'sessao' ? 'Por sessão' : a === 'semana' ? 'Por semana' : 'Por mês'}
            </button>
          ))}
        </span>
      </div>
      <div ref={wrapRef} style={{ position: 'relative' }}>
        {/* Tooltip HTML sobre o SVG */}
        {tooltip != null && aggBy === 'sessao' && (() => {
          const s = allSessions[tooltip.idx];
          if (!s) return null;
          const vals: string[] = [];
          if (s.satisfactionElaboracao) vals.push(`Elaboração: ${SAT_LABEL[s.satisfactionElaboracao] ?? s.satisfactionElaboracao}`);
          if (s.satisfactionCapacidade) vals.push(`Execução: ${SAT_LABEL[s.satisfactionCapacidade] ?? s.satisfactionCapacidade}`);
          if (s.postWorkoutFeeling != null) vals.push(`Sensação: ${s.postWorkoutFeeling}/5`);
          if (s.postWorkoutMood != null) vals.push(`Humor: ${s.postWorkoutMood}/5`);
          return (
            <div style={{
              position: 'absolute', left: tooltip.x, top: tooltip.y,
              transform: 'translate(-50%, -110%)',
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 8, padding: '8px 10px', fontSize: 11, zIndex: 50,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 180, pointerEvents: 'none',
            }}>
              <p style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>{s.date.slice(5).replace('-', '/')} · {s.title || s.modality}</p>
              {vals.map((v, i) => <p key={i} style={{ color: 'var(--muted)', marginBottom: 2 }}>{v}</p>)}
              {onDayClick && <p style={{ color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>Clique para ver o treino →</p>}
            </div>
          );
        })()}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: aggBy === 'sessao' && onDayClick ? 'default' : undefined }}>
          {/* Bandas de zona: verde 3.5-5, amarelo 2-3.5, vermelho 1-2 */}
          <rect x={PL} y={yScale(5)} width={gW} height={yScale(3.5) - yScale(5)} fill="#22c55e18" />
          <rect x={PL} y={yScale(3.5)} width={gW} height={yScale(2) - yScale(3.5)} fill="#f59e0b14" />
          <rect x={PL} y={yScale(2)} width={gW} height={PT + gH - yScale(2)} fill="#ef444418" />
          {[1,2,3,4,5].map((v) => { const y = yScale(v); return (
            <g key={v}>
              <line x1={PL} y1={y} x2={W-PR} y2={y} stroke="var(--line)" strokeWidth={v === 3 ? 1 : 0.4} strokeDasharray={v === 3 ? '3,3' : undefined} />
              <text x={PL-4} y={y+4} fontSize={8} fill="var(--muted)" textAnchor="end">{v}</text>
            </g>
          ); })}
          {EXP_SERIES.filter(({ key: k }) => active.has(k)).map(({ key: k, color }) => {
            const vals = points.map((p, i) => ({ x: PL + i * xStep, y: p[k] != null ? yScale(p[k]!) : null }));
            const segments: string[] = []; let seg = '';
            for (const { x, y } of vals) {
              if (y == null) { if (seg) segments.push(seg); seg = ''; }
              else seg += seg ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
            }
            if (seg) segments.push(seg);
            return (
              <g key={k}>
                {segments.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeOpacity={0.85} />)}
                {vals.map((pt, i) => pt.y != null ? <circle key={i} cx={pt.x} cy={pt.y} r={2.5} fill={color} /> : null)}
              </g>
            );
          })}
          {/* Áreas clicáveis invisíveis por ponto (Por sessão): cobrem todas as séries de uma vez */}
          {aggBy === 'sessao' && points.map((_, i) => {
            const cx = PL + i * xStep;
            return (
              <rect key={i} x={cx - 10} y={PT} width={20} height={gH}
                fill="transparent"
                style={{ cursor: onDayClick ? 'pointer' : 'default' }}
                onMouseEnter={() => {
                  if (!wrapRef.current) return;
                  const svgEl = wrapRef.current.querySelector('svg')!;
                  const svgRect = svgEl.getBoundingClientRect();
                  const wrapRect = wrapRef.current.getBoundingClientRect();
                  const scaleX = svgRect.width / W;
                  setTooltip({ x: cx * scaleX + (svgRect.left - wrapRect.left), y: PT * scaleX + (svgRect.top - wrapRect.top), idx: i });
                }}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => { if (onDayClick && allSessions[i]) onDayClick(allSessions[i].planId); }}
              />
            );
          })}
          {xLabels.map(({ i, label }) => (
            <text key={i} x={PL + i * xStep} y={H-4} fontSize={8} fill="var(--muted)" textAnchor="middle">{label}</text>
          ))}
        </svg>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        Elaboração e Execução: amei(5)→detestei(1). Sensação corporal e Humor: escala 1–5 direta (a partir de 11/09/2026).
      </p>
      <button type="button" onClick={() => setShowDist((v) => !v)}
        style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginTop: 4 }}>
        {showDist ? '▲ Ocultar distribuição' : '▼ Ver distribuição das respostas'}
      </button>
      {showDist && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginTop: 8 }}>
          {EXP_SERIES.map(({ key: k, label, color }) => {
            const counts = distCounts[k];
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            if (total === 0) return null;
            const isNumeric = k === 'sensacao' || k === 'humor';
            const entries = isNumeric
              ? [1,2,3,4,5].map((v) => ({ label: String(v), count: counts[String(v)] ?? 0 }))
              : ['amei','gostei','neutro','nao_gostei','detestei'].map((v) => ({ label: { amei: 'Amei', gostei: 'Gostei', neutro: 'Neutro', nao_gostei: 'Nao gostei', detestei: 'Detestei' }[v]!, count: counts[v] ?? 0 }));
            return (
              <div key={k}>
                <p style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 4 }}>{label}</p>
                {entries.filter((e) => e.count > 0).map((e) => (
                  <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, width: 70, color: 'var(--muted)' }}>{e.label}</span>
                    <div style={{ flex: 1, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${(e.count / total) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', width: 20, textAlign: 'right' }}>{e.count}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ARCO DO TREINO ────────────────────────────────────────────────────────
// Compara "como chegou" (prontidão pré-treino) vs "como saiu" (sensação+humor pós-treino).
// ── HELPERS PARA ARCO DO TREINO ───────────────────────────────────────────
/** satisfactionCapacidade (string categórica) → escala 1-5 */
function satCapScore(v: string | null | undefined): number | null {
  if (!v) return null;
  const m: Record<string, number> = { amei: 5, gostei: 4, ok: 3, neutro: 3, nao_gostei: 2, detestei: 1 };
  return m[v] ?? null;
}
/** Penalidade de dor sobre o delta final: none/null = neutro (não penaliza) */
function painPenalty(flag: string | null | undefined): number {
  if (!flag || flag === 'none') return 0;
  if (flag === 'leve') return -0.5;
  if (flag === 'moderado') return -1.0;
  return -2.0; // forte
}
/** RPE (1–10) + satisfação de execução → contexto do esforço percebido */
function rpeContext(rpe: number | null | undefined, satCap: string | null | undefined): 'bom' | 'ruim' | 'ambiguo' | 'leve' | null {
  if (rpe == null) return null;
  if (rpe >= 7) {
    if (satCap === 'amei' || satCap === 'gostei') return 'bom';        // sofrimento bom 💪
    if (satCap === 'nao_gostei' || satCap === 'detestei') return 'ruim'; // sofrimento ruim
    return 'ambiguo'; // RPE alto, satisfação desconhecida/neutra
  }
  return 'leve';
}

// Delta verde = treino energizou ou manteve o estado. Delta vermelho = treino drenou.
// Série de deltas negativos = sinal de overtraining ou acúmulo de fadiga.
function ArcoTreinoSection({ history }: { history: StudentDetail['history'] }) {
  const sessions = flatFeedbackSessions(history)
    .filter((s) => (s.completionStatus === 'done' || s.completionStatus === 'adjusted'))
    .filter((s) => {
      const hasPre = s.preSleepQuality != null || s.prePhysicalFatigue != null || s.preStressLevel != null || s.preMotivation != null;
      const hasPost = s.postWorkoutFeeling != null || s.postWorkoutMood != null || s.satisfactionCapacidade != null;
      return hasPre && hasPost;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sessions.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Dados insuficientes — é necessário ter pelo menos uma sessão com campos pré E pós preenchidos (a partir de 11/09/2026).</p>;

  // Pré: índice de prontidão (1-5)
  // Pós: média(sensação corporal, humor, execução) ajustada por penalidade de dor
  const points = sessions.map((s, i) => {
    const pre = computeReadiness(s) ?? 0;
    const satScore = satCapScore(s.satisfactionCapacidade);
    const postVals = [s.postWorkoutFeeling, s.postWorkoutMood, satScore].filter((v): v is number => v != null);
    const postRaw = postVals.length > 0 ? postVals.reduce((a, b) => a + b, 0) / postVals.length : null;
    // Penalidade de dor — none/null é neutro
    const penalty = painPenalty(s.painFlag);
    const post = postRaw != null ? Math.max(1, Math.min(5, postRaw + penalty)) : null;
    const delta = post != null ? post - pre : null;
    const rpeCtx = rpeContext(s.perceivedEffort, s.satisfactionCapacidade);
    return {
      i, label: s.date.slice(5).replace('-', '/'),
      pre, post, delta,
      rpe: s.perceivedEffort,
      rpeCtx,
      hasPain: !!(s.painFlag && s.painFlag !== 'none'),
      penalty,
    };
  });

  const W = 560; const H = 160; const PL = 32; const PR = 8; const PT = 12; const PB = 28;
  const gW = W - PL - PR; const gH = H - PT - PB;
  const n = points.length;
  const xStep = n > 1 ? gW / (n - 1) : gW;
  const yScale5 = (v: number) => PT + gH - ((v - 1) / 4) * gH;

  // Delta chart
  const DH = 48; const midY = 12 + DH / 2;
  const barH = (d: number) => Math.abs(d) / 4 * (DH / 2);
  const barY = (d: number) => d >= 0 ? midY - barH(d) : midY;

  const xLabels = n <= 8 ? points.map((p) => ({ i: p.i, label: p.label }))
    : [0, Math.floor(n/4), Math.floor(n/2), Math.floor(3*n/4), n-1].map((i) => ({ i, label: points[i].label }));

  const barW = Math.max(2, Math.min(12, gW / n - 2));

  const RPE_H = 36;
  const RPE_COLOR: Record<string, string> = { bom: '#22c55e', ruim: '#ef4444', ambiguo: '#f59e0b', leve: '#94a3b8' };

  const hasRpe = points.some((p) => p.rpe != null);

  return (
    <div>
      {/* KPIs de resumo */}
      {(() => {
        const withDelta = points.filter((p) => p.delta != null);
        if (withDelta.length === 0) return null;
        const avg = withDelta.reduce((a, p) => a + p.delta!, 0) / withDelta.length;
        const pos = withDelta.filter((p) => p.delta! > 0.2).length;
        const neg = withDelta.filter((p) => p.delta! < -0.2).length;
        const softBom = points.filter((p) => p.rpeCtx === 'bom').length;
        return (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: avg >= 0 ? '#22c55e' : '#ef4444' }}>{avg >= 0 ? '+' : ''}{avg.toFixed(1)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>delta médio</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{pos}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>treinos que energizaram</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{neg}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>treinos que drenaram</div>
            </div>
            {softBom > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{softBom}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>sofrimento bom 💪</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Gráfico de linhas pré vs pós */}
      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Prontidão pré × Sensação pós (escala 1–5)</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {/* Bandas */}
        <rect x={PL} y={yScale5(5)} width={gW} height={yScale5(3.5) - yScale5(5)} fill="#22c55e10" />
        <rect x={PL} y={yScale5(3.5)} width={gW} height={yScale5(2) - yScale5(3.5)} fill="#f59e0b10" />
        <rect x={PL} y={yScale5(2)} width={gW} height={PT + gH - yScale5(2)} fill="#ef444410" />
        {/* Grid */}
        {[1,2,3,4,5].map((v) => { const y = yScale5(v); return (
          <g key={v}>
            <line x1={PL} y1={y} x2={W-PR} y2={y} stroke="var(--line)" strokeWidth={0.4} />
            <text x={PL-4} y={y+4} fontSize={8} fill="var(--muted)" textAnchor="end">{v}</text>
          </g>
        ); })}
        {/* Linha pré (prontidão) — tracejada cinza */}
        {(() => {
          const segs: string[] = []; let seg = '';
          for (const p of points) {
            const x = PL + p.i * xStep; const y = yScale5(p.pre);
            seg += seg ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
          }
          if (seg) segs.push(seg);
          return segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,3" strokeLinejoin="round" />);
        })()}
        {/* Linha pós (sensação + humor + execução) — sólida azul */}
        {(() => {
          const segs: string[] = []; let seg = '';
          for (const p of points) {
            if (p.post == null) { if (seg) segs.push(seg); seg = ''; continue; }
            const x = PL + p.i * xStep; const y = yScale5(p.post);
            seg += seg ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
          }
          if (seg) segs.push(seg);
          return (<g>
            {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#0ea5e9" strokeWidth={2} strokeLinejoin="round" />)}
            {points.map((p) => p.post != null ? (
              <circle key={p.i} cx={PL + p.i * xStep} cy={yScale5(p.post)} r={3}
                fill={p.hasPain ? '#f59e0b' : '#0ea5e9'}
                stroke={p.hasPain ? '#0ea5e9' : 'none'} strokeWidth={1.5} />
            ) : null)}
          </g>);
        })()}
        {/* Círculos pré */}
        {points.map((p) => <circle key={p.i} cx={PL + p.i * xStep} cy={yScale5(p.pre)} r={2.5} fill="#94a3b8" />)}
        {/* Eixo X */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={PL + i * xStep} y={H-4} fontSize={8} fill="var(--muted)" textAnchor="middle">{label}</text>
        ))}
      </svg>

      {/* Gráfico de delta (barras) */}
      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 12, marginBottom: 2 }}>Delta pós−pré por sessão</p>
      <svg viewBox={`0 0 ${W} ${DH + 24}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <line x1={PL} y1={midY} x2={W-PR} y2={midY} stroke="var(--line)" strokeWidth={1} />
        <text x={PL-4} y={midY+4} fontSize={7} fill="var(--muted)" textAnchor="end">0</text>
        {points.map((p) => {
          if (p.delta == null) return null;
          const color = p.delta > 0.2 ? '#22c55e' : p.delta < -0.2 ? '#ef4444' : '#94a3b8';
          const bh = barH(p.delta);
          const by = barY(p.delta);
          const x = PL + p.i * xStep - barW / 2;
          return (
            <g key={p.i}>
              <rect x={x} y={by} width={barW} height={Math.max(1, bh)} fill={color} fillOpacity={0.8} rx={1} />
              {/* Marcador laranja quando há penalidade de dor */}
              {p.hasPain && (
                <text x={PL + p.i * xStep} y={p.delta >= 0 ? by - 2 : by + bh + 8} fontSize={7} textAnchor="middle" fill="#f59e0b">▲</text>
              )}
            </g>
          );
        })}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={PL + i * xStep} y={DH + 20} fontSize={8} fill="var(--muted)" textAnchor="middle">{label}</text>
        ))}
      </svg>

      {/* Faixa de RPE — sofrimento bom vs ruim */}
      {hasRpe && (
        <>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 10, marginBottom: 2 }}>Esforço percebido — RPE (1–10)</p>
          <svg viewBox={`0 0 ${W} ${RPE_H + 20}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
            <line x1={PL} y1={RPE_H / 2 + 4} x2={W-PR} y2={RPE_H / 2 + 4} stroke="var(--line)" strokeWidth={0.5} strokeDasharray="3,3" />
            <text x={PL-4} y={8} fontSize={7} fill="var(--muted)" textAnchor="end">10</text>
            <text x={PL-4} y={RPE_H + 4} fontSize={7} fill="var(--muted)" textAnchor="end">1</text>
            {points.map((p) => {
              if (p.rpe == null) return null;
              const cx = PL + p.i * xStep;
              const cy = 4 + RPE_H - ((p.rpe - 1) / 9) * RPE_H;
              const r = 3 + (p.rpe / 10) * 5; // raio escala com RPE
              const color = p.rpeCtx ? RPE_COLOR[p.rpeCtx] : '#94a3b8';
              return (
                <g key={p.i}>
                  <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.75} />
                  <text x={cx} y={cy + 3.5} fontSize={6} textAnchor="middle" fill="white" fontWeight="bold">{p.rpe}</text>
                </g>
              );
            })}
            {xLabels.map(({ i, label }) => (
              <text key={i} x={PL + i * xStep} y={RPE_H + 20} fontSize={8} fill="var(--muted)" textAnchor="middle">{label}</text>
            ))}
          </svg>
        </>
      )}

      {/* Legenda */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
        <span><span style={{ display: 'inline-block', width: 20, height: 2, background: '#94a3b8', verticalAlign: 'middle', marginRight: 4 }} />Prontidão pré</span>
        <span><span style={{ display: 'inline-block', width: 20, height: 2, background: '#0ea5e9', verticalAlign: 'middle', marginRight: 4 }} />Sensação pós (sensação + humor + execução)</span>
        <span><span style={{ color: '#f59e0b', marginRight: 2 }}>●</span>Pós c/ dor (penalidade no delta)</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#22c55e', borderRadius: 1, verticalAlign: 'middle', marginRight: 4 }} />Energizou</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#ef4444', borderRadius: 1, verticalAlign: 'middle', marginRight: 4 }} />Drenou</span>
        <span><span style={{ color: '#f59e0b', marginRight: 2 }}>▲</span>Dor (delta ajustado)</span>
      </div>
      {hasRpe && (
        <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#22c55e', verticalAlign: 'middle', marginRight: 4 }} />RPE alto + gostou (sofrimento bom 💪)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#ef4444', verticalAlign: 'middle', marginRight: 4 }} />RPE alto + não gostou</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', verticalAlign: 'middle', marginRight: 4 }} />RPE alto (execução não informada)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#94a3b8', verticalAlign: 'middle', marginRight: 4 }} />RPE leve (&lt;7)</span>
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Pós = média(sensação, humor, execução) com penalidade de dor (leve −0,5 / moderado −1,0 / forte −2,0). RPE alto + verde = sofrimento bom. Série de deltas negativos por 3+ semanas = sinal de overtraining.</p>
    </div>
  );
}

// ── DOR LONGITUDINAL ───────────────────────────────────────────────────────
function DorLongitudinalSection({ history }: { history: StudentDetail['history'] }) {
  const sessions = flatFeedbackSessions(history)
    .filter((s) => s.painFlag != null && (s.completionStatus === 'done' || s.completionStatus === 'adjusted'))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sessions.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum dado de dor disponível (coleta a partir de 11/09/2026).</p>;

  const withPain = sessions.filter((s) => s.painFlag && s.painFlag !== 'none');

  // Gráfico de pontos coloridos por nível de dor
  const W = 560; const H = 80; const PL = 8; const PR = 8;
  const gW = W - PL - PR; const n = sessions.length;
  const xStep = n > 1 ? gW / (n - 1) : 0;
  const cx = (i: number) => PL + i * xStep;
  const cy = H / 2;

  const xLabels = n <= 8 ? sessions.map((s, i) => ({ i, label: s.date.slice(5).replace('-', '/') }))
    : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1].map((i) => ({ i, label: sessions[i].date.slice(5).replace('-', '/') }));

  return (
    <div>
      {/* Resumo */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        {([0,1,2,3] as const).map((lvl) => {
          const cnt = sessions.filter((s) => painFlagNumeric(s.painFlag) === lvl).length;
          return (
            <div key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: PAIN_COLOR[lvl] }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{PAIN_LABEL[lvl]}: <strong style={{ color: 'var(--fg)' }}>{cnt}</strong></span>
            </div>
          );
        })}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{sessions.length} treinos com registro de dor</span>
      </div>
      {/* Timeline de pontos */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <line x1={PL} y1={cy} x2={W-PR} y2={cy} stroke="var(--line)" strokeWidth={1} />
        {sessions.map((s, i) => {
          const lvl = painFlagNumeric(s.painFlag);
          const r = lvl === 0 ? 4 : lvl === 1 ? 6 : lvl === 2 ? 8 : 10;
          return (
            <g key={s.id}>
              <title>{s.date} — {s.title} — {PAIN_LABEL[lvl]}{s.painTiming ? ` (${PAIN_TIMING_LABELS[s.painTiming] ?? s.painTiming})` : ''}</title>
              <circle cx={cx(i)} cy={cy} r={r} fill={PAIN_COLOR[lvl]} opacity={lvl === 0 ? 0.4 : 0.85} />
            </g>
          );
        })}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={cx(i)} y={H - 4} fontSize={8} fill="var(--muted)" textAnchor="middle">{label}</text>
        ))}
      </svg>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        Círculo maior = dor mais intensa. Passe o mouse sobre cada ponto para ver o treino e o momento da dor.
      </p>
      {/* Lista de episódios com dor */}
      {withPain.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--fg)' }}>Episódios registrados com dor ({withPain.length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {withPain.slice().reverse().map((s) => {
              const lvl = painFlagNumeric(s.painFlag);
              return (
                <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: 'var(--surface)', borderRadius: 8, borderLeft: `3px solid ${PAIN_COLOR[lvl]}` }}>
                  <div style={{ flexShrink: 0, width: 10, height: 10, borderRadius: '50%', background: PAIN_COLOR[lvl], marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{s.date.slice(5).replace('-', '/')}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.title}</span>
                      <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: PAIN_COLOR[lvl] + '22', color: PAIN_COLOR[lvl], fontWeight: 600 }}>{PAIN_LABEL[lvl]}</span>
                    </div>
                    {s.painTiming && <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{PAIN_TIMING_LABELS[s.painTiming] ?? s.painTiming}</p>}
                    {s.feedback && <p style={{ fontSize: 11, color: 'var(--fg)', marginTop: 2, fontStyle: 'italic' }}>"{s.feedback}"</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── EXPLORAR RELAÇÕES (scatter plot) ──────────────────────────────────────
type RelVar = 'sono' | 'cansaco' | 'estresse' | 'motivacao' | 'rpe' | 'elaboracao' | 'execucao' | 'sensacao' | 'dor';
const REL_VAR_OPTIONS: Array<{ key: RelVar; label: string }> = [
  { key: 'sono',        label: 'Sono (1–5)' },
  { key: 'cansaco',     label: 'Cansaço pré (1–5)' },
  { key: 'estresse',    label: 'Estresse pré (1–5)' },
  { key: 'motivacao',   label: 'Motivação pré (1–5)' },
  { key: 'rpe',         label: 'RPE (1–10)' },
  { key: 'elaboracao',  label: 'Elaboração (1–5)' },
  { key: 'execucao',    label: 'Execução (1–5)' },
  { key: 'sensacao',    label: 'Sensação final (1–5)' },
  { key: 'dor',         label: 'Dor (0–3)' },
];

function getVarValue(s: FlatSession, v: RelVar): number | null {
  switch (v) {
    case 'sono':       return s.preSleepQuality;
    case 'cansaco':    return s.prePhysicalFatigue;
    case 'estresse':   return s.preStressLevel;
    case 'motivacao':  return s.preMotivation;
    case 'rpe':        return s.perceivedEffort;
    case 'elaboracao': return s.satisfactionElaboracao ? (SAT_TO_5[s.satisfactionElaboracao] ?? null) : null;
    case 'execucao':   return s.satisfactionCapacidade ? (SAT_TO_5[s.satisfactionCapacidade] ?? null) : null;
    case 'sensacao':   return s.postWorkoutFeeling;
    case 'dor':        return painFlagNumeric(s.painFlag);
    default:           return null;
  }
}

function getVarRange(v: RelVar): [number, number] {
  return v === 'rpe' ? [1, 10] : v === 'dor' ? [0, 3] : [1, 5];
}

function ExplorarRelacoesSection({ history }: { history: StudentDetail['history'] }) {
  const [varA, setVarA] = useState<RelVar>('cansaco');
  const [varB, setVarB] = useState<RelVar>('rpe');
  const [hovered, setHovered] = useState<string | null>(null);

  const allSessions = flatFeedbackSessions(history)
    .filter((s) => s.completionStatus === 'done' || s.completionStatus === 'adjusted');

  const pts = allSessions
    .map((s) => ({ s, a: getVarValue(s, varA), b: getVarValue(s, varB) }))
    .filter((p): p is { s: FlatSession; a: number; b: number } => p.a != null && p.b != null);

  const [minA, maxA] = getVarRange(varA);
  const [minB, maxB] = getVarRange(varB);

  const W = 400; const H = 280; const PAD = 40;
  const gW = W - PAD * 2; const gH = H - PAD * 2;
  const xPos = (v: number) => PAD + ((v - minA) / (maxA - minA)) * gW;
  const yPos = (v: number) => H - PAD - ((v - minB) / (maxB - minB)) * gH;

  const labelA = REL_VAR_OPTIONS.find((o) => o.key === varA)?.label ?? varA;
  const labelB = REL_VAR_OPTIONS.find((o) => o.key === varB)?.label ?? varB;

  const hoveredPt = pts.find((p) => p.s.id === hovered);

  return (
    <div>
      {/* Seletor de variáveis */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Variável A (eixo horizontal)</label>
          <select value={varA} onChange={(e) => setVarA(e.target.value as RelVar)}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--fg)' }}>
            {REL_VAR_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 18, color: 'var(--muted)', paddingTop: 16 }}>×</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Variável B (eixo vertical)</label>
          <select value={varB} onChange={(e) => setVarB(e.target.value as RelVar)}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--fg)' }}>
            {REL_VAR_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)', paddingTop: 16 }}>
          {pts.length} pontos com ambas as variáveis registradas
        </span>
      </div>
      {pts.length < 3 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Dados insuficientes para o cruzamento selecionado (mínimo 3 sessões com ambas as variáveis).</p>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', overflow: 'visible', flex: '1 1 280px' }}>
            {/* Grid */}
            {Array.from({ length: maxA - minA + 1 }, (_, i) => minA + i).map((v) => (
              <line key={v} x1={xPos(v)} y1={PAD} x2={xPos(v)} y2={H - PAD} stroke="var(--line)" strokeWidth={0.5} />
            ))}
            {Array.from({ length: maxB - minB + 1 }, (_, i) => minB + i).map((v) => (
              <line key={v} x1={PAD} y1={yPos(v)} x2={W - PAD} y2={yPos(v)} stroke="var(--line)" strokeWidth={0.5} />
            ))}
            {/* Eixos */}
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--muted)" strokeWidth={1} />
            <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--muted)" strokeWidth={1} />
            {/* Labels eixo X */}
            {Array.from({ length: maxA - minA + 1 }, (_, i) => minA + i).map((v) => (
              <text key={v} x={xPos(v)} y={H - PAD + 12} fontSize={8} fill="var(--muted)" textAnchor="middle">{v}</text>
            ))}
            {/* Labels eixo Y */}
            {Array.from({ length: maxB - minB + 1 }, (_, i) => minB + i).map((v) => (
              <text key={v} x={PAD - 6} y={yPos(v) + 3} fontSize={8} fill="var(--muted)" textAnchor="end">{v}</text>
            ))}
            {/* Label eixo nomes */}
            <text x={W / 2} y={H - 4} fontSize={9} fill="var(--muted)" textAnchor="middle">{labelA}</text>
            <text x={10} y={H / 2} fontSize={9} fill="var(--muted)" textAnchor="middle" transform={`rotate(-90, 10, ${H/2})`}>{labelB}</text>
            {/* Pontos */}
            {pts.map((p) => (
              <circle
                key={p.s.id}
                cx={xPos(p.a)} cy={yPos(p.b)} r={5}
                fill={p.s.modality.toLowerCase().includes('corrida') ? '#6366f1' : p.s.modality.toLowerCase().includes('muscula') ? '#f59e0b' : '#22c55e'}
                opacity={hovered === p.s.id ? 1 : 0.65}
                stroke={hovered === p.s.id ? 'var(--fg)' : 'none'} strokeWidth={1.5}
                onMouseEnter={() => setHovered(p.s.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </svg>
          {/* Painel de detalhe ao hover */}
          <div style={{ flex: '0 0 160px', minWidth: 140 }}>
            {hoveredPt ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>{hoveredPt.s.date.slice(5).replace('-', '/')}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{hoveredPt.s.title}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--fg)' }}>{labelA}: <strong>{hoveredPt.a}</strong></span>
                  <span style={{ fontSize: 11, color: 'var(--fg)' }}>{labelB}: <strong>{hoveredPt.b}</strong></span>
                  {hoveredPt.s.perceivedEffort && <span style={{ fontSize: 11, color: 'var(--muted)' }}>RPE: {hoveredPt.s.perceivedEffort}</span>}
                  {hoveredPt.s.painFlag && hoveredPt.s.painFlag !== 'none' && <span style={{ fontSize: 11, color: '#fb923c' }}>Dor: {PAIN_LABEL[painFlagNumeric(hoveredPt.s.painFlag)]}</span>}
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <p style={{ fontSize: 11, color: 'var(--muted)' }}>Passe o mouse sobre um ponto para ver os detalhes do treino.</p>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} /><span style={{ fontSize: 10, color: 'var(--muted)' }}>Corrida</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} /><span style={{ fontSize: 10, color: 'var(--muted)' }}>Musculação</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} /><span style={{ fontSize: 10, color: 'var(--muted)' }}>Outros</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
        Cada ponto = uma sessão. Cor = modalidade. Não interprete como causalidade — é associação descritiva para investigação.
      </p>
    </div>
  );
}

// ── TIMELINE INTEGRADA ─────────────────────────────────────────────────────
function TimelineIntegradaSection({ history }: {
  history: StudentDetail['history'];

}) {
  const [limit, setLimit] = useState(20);

  // Montar eventos de todas as sessões com qualquer dado
  const events = (history ?? []).flatMap((plan) =>
    (plan.sessions ?? []).map((s) => ({ plan, session: s }))
  ).filter(({ session: s }) =>
    s.completionStatus !== 'sem_registro' && s.completionStatus != null
  ).sort((a, b) => String(b.session.date).localeCompare(String(a.session.date)));

  const visible = events.slice(0, limit);

  function sessionIcon(mod: string) {
    const m = mod.toLowerCase();
    if (m.includes('corrida') || m.includes('run')) return '🏃';
    if (m.includes('muscula') || m.includes('forca') || m.includes('força')) return '🏋️';
    if (m.includes('caminhada') || m.includes('walk')) return '🚶';
    return '⚡';
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map(({ session: s }) => {
          const painLvl = painFlagNumeric(s.painFlag ?? null);
          const isMissed = s.completionStatus === 'missed';
          return (
            <div key={s.id} style={{
              display: 'flex', gap: 10, padding: '10px 12px',
              background: 'var(--surface)', borderRadius: 8,
              borderLeft: `3px solid ${isMissed ? '#94a3b8' : painLvl > 1 ? PAIN_COLOR[painLvl] : 'var(--accent)'}`,
              opacity: isMissed ? 0.6 : 1,
            }}>
              <div style={{ flexShrink: 0, fontSize: 18, lineHeight: 1.2 }}>{sessionIcon(s.modality ?? '')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Linha 1: data + título + status */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{String(s.date).slice(5).replace('-', '/')}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.title}</span>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: isMissed ? '#94a3b822' : '#22c55e22', color: isMissed ? '#94a3b8' : '#22c55e', fontWeight: 600 }}>
                    {isMissed ? 'Não fez' : s.completionStatus === 'adjusted' ? 'Ajustado' : 'Feito'}
                  </span>
                </div>
                {/* Linha 2: bloco 1 — estado pré */}
                {(s.preSleepQuality != null || s.prePhysicalFatigue != null || s.preStressLevel != null || s.preMotivation != null) && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 3 }}>
                    {s.preSleepQuality != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Sono <span style={{ color: scale5Color(s.preSleepQuality), fontWeight: 700 }}>{s.preSleepQuality}/5</span></span>}
                    {s.prePhysicalFatigue != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Cansaço <span style={{ color: scale5Color(s.prePhysicalFatigue), fontWeight: 700 }}>{s.prePhysicalFatigue}/5</span></span>}
                    {s.preStressLevel != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Estresse <span style={{ fontWeight: 700 }}>{s.preStressLevel}/5</span></span>}
                    {s.preMotivation != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Motivação <span style={{ color: scale5Color(s.preMotivation), fontWeight: 700 }}>{s.preMotivation}/5</span></span>}
                  </div>
                )}
                {/* Linha 3: bloco 2 — treino */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 3 }}>
                  {s.perceivedEffort != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>RPE <strong style={{ color: 'var(--fg)' }}>{s.perceivedEffort}/10</strong></span>}
                  {s.satisfactionElaboracao != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Elaboração <strong>{s.satisfactionElaboracao}</strong></span>}
                  {s.satisfactionCapacidade != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Execução <strong>{s.satisfactionCapacidade}</strong></span>}
                  {s.postWorkoutFeeling != null && <span style={{ fontSize: 10, color: 'var(--muted)' }}>Sensação final <span style={{ color: scale5Color(s.postWorkoutFeeling), fontWeight: 700 }}>{s.postWorkoutFeeling}/5</span></span>}
                </div>
                {/* Dor */}
                {s.painFlag && s.painFlag !== 'none' && (
                  <div style={{ marginBottom: 3 }}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: PAIN_COLOR[painLvl] + '22', color: PAIN_COLOR[painLvl], fontWeight: 600 }}>
                      🩹 Dor {PAIN_LABEL[painLvl].toLowerCase()}{s.painTiming ? ` — ${PAIN_TIMING_LABELS[s.painTiming] ?? s.painTiming}` : ''}
                    </span>
                  </div>
                )}
                {/* Comentário */}
                {s.feedback?.trim() && (
                  <p style={{ fontSize: 11, color: 'var(--fg)', fontStyle: 'italic', marginTop: 2 }}>"{s.feedback.trim()}"</p>
                )}
                {/* Métricas de execução */}
                {(s.completedDistanceKm || s.completedDurationMin) && (
                  <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    {s.completedDistanceKm ? `${s.completedDistanceKm.toFixed(1)} km` : ''}{s.completedDistanceKm && s.completedDurationMin ? ' · ' : ''}
                    {s.completedDurationMin ? minToHhmm(s.completedDurationMin) : ''}
                    {s.completedPaceSecondsKm ? ` · ${Math.floor(s.completedPaceSecondsKm/60)}:${String(s.completedPaceSecondsKm%60).padStart(2,'0')}/km` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {events.length > limit && (
        <button type="button" onClick={() => setLimit((v) => v + 20)}
          style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', width: '100%' }}>
          Carregar mais ({events.length - limit} restantes)
        </button>
      )}
      {events.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum treino registrado no período.</p>}
    </div>
  );
}

type WeekData = {
  startDate: string;     // YYYY-MM-DD
  completedKm: number;
  prescribedKm: number;
  adherencePercent: number;
  completedSessions: number;
  prescribedSessions: number;
};

/** Volume semanal: 3 colunas por semana + linha de tendência.
 *
 *  ▪ Prescrito  (cinza #94a3b8) — km planejados pelo treinador
 *  ▪ Realizado  (verde #22c55e) — total de km completados na semana
 *  ▪ Extras     (ciano #06b6d4) — km realizados além do prescrito (treinos bônus ou avulsos)
 *  ▪ Tendência  (índigo #6366f1) — regressão linear sobre o volume realizado
 *
 *  Rótulo km visível no topo de TODAS as barras com valor > 0.
 */
function KmEvolutionChart({ weeks, period }: { weeks: WeekData[]; period: number }) {
  const visible = weeks.slice(period === 999 ? 0 : Math.max(0, weeks.length - period));
  if (visible.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem dados suficientes para o período selecionado.</p>;

  const VW = 640; const VH = 220;
  const ML = 44; const MR = 12; const MT = 24; const MB = 32;
  const CW = VW - ML - MR; const CH = VH - MT - MB;

  const maxKm = Math.max(...visible.flatMap((w) => [w.completedKm, w.prescribedKm]), 5);
  const topKm = Math.ceil(maxKm / 5) * 5;

  const n = visible.length;
  const slotW = CW / n;
  // 3 barras por slot: prescrito (esq), realizado (centro), extras (dir)
  // largura de cada barra: máximo 14px, mínimo 3px
  const bW = Math.max(3, Math.min(14, slotW * 0.28));

  const xPre  = (i: number) => ML + i * slotW + slotW * 0.22; // prescrito — esquerda
  const xReal = (i: number) => ML + i * slotW + slotW * 0.50; // realizado — centro
  const xExt  = (i: number) => ML + i * slotW + slotW * 0.78; // extras    — direita
  const xMid  = (i: number) => ML + i * slotW + slotW * 0.50; // label eixo X
  const yV = (km: number) => MT + CH - (km / topKm) * CH;

  // Linha de tendência: regressão linear sobre realizado
  const meanX = (n - 1) / 2;
  const meanY = visible.reduce((s, w) => s + w.completedKm, 0) / n;
  const denom = visible.reduce((s, _, i) => s + (i - meanX) ** 2, 0);
  const slope = denom !== 0 ? visible.reduce((s, w, i) => s + (i - meanX) * (w.completedKm - meanY), 0) / denom : 0;
  const intercept = meanY - slope * meanX;
  const ty0 = Math.max(0, intercept);
  const ty1 = Math.max(0, intercept + slope * (n - 1));

  const showLabel = bW >= 8;
  const xLabels = n <= 12
    ? visible.map((_, i) => i)
    : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1];

  function fmtKm(v: number) { return v % 1 === 0 ? String(v) : v.toFixed(1); }

  // Grid ticks
  const gridTicks = [0];
  const step = topKm <= 20 ? 5 : topKm <= 60 ? 10 : topKm <= 120 ? 20 : 30;
  for (let km = step; km <= topKm; km += step) gridTicks.push(km);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', overflow: 'visible', display: 'block' }}>
      {/* Grid horizontal */}
      {gridTicks.map((km) => (
        <g key={km}>
          <line x1={ML} x2={VW - MR} y1={yV(km)} y2={yV(km)}
            stroke="var(--line)" strokeWidth={km === 0 ? 1.2 : 0.5} />
          <text x={ML - 5} y={yV(km) + 4} textAnchor="end" fontSize={9} fill="var(--muted)">{km}km</text>
        </g>
      ))}

      {/* Barras */}
      {visible.map((w, i) => {
        const extraKm = Math.max(0, w.completedKm - w.prescribedKm);
        const bhPre  = Math.max(w.prescribedKm > 0 ? 1 : 0, (w.prescribedKm / topKm) * CH);
        const bhReal = Math.max(w.completedKm  > 0 ? 1 : 0, (w.completedKm  / topKm) * CH);
        const bhExt  = (extraKm / topKm) * CH;
        return (
          <g key={i}>
            <title>{w.startDate}: prescrito {w.prescribedKm}km · realizado {w.completedKm}km{extraKm > 0 ? ` (${extraKm.toFixed(1)}km extra)` : ''}</title>

            {/* Prescrito */}
            {w.prescribedKm > 0 && (
              <>
                <rect x={xPre(i) - bW / 2} y={yV(w.prescribedKm)} width={bW} height={bhPre} rx={2} fill="#94a3b8" />
                {showLabel && (
                  <text x={xPre(i)} y={yV(w.prescribedKm) - 4} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#64748b">
                    {fmtKm(w.prescribedKm)}
                  </text>
                )}
              </>
            )}

            {/* Realizado (total) */}
            {w.completedKm > 0 && (
              <>
                <rect x={xReal(i) - bW / 2} y={yV(w.completedKm)} width={bW} height={bhReal} rx={2} fill="#22c55e" />
                {showLabel && (
                  <text x={xReal(i)} y={yV(w.completedKm) - 4} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#16a34a">
                    {fmtKm(w.completedKm)}
                  </text>
                )}
              </>
            )}

            {/* Extras */}
            {extraKm > 0 && (
              <>
                <rect x={xExt(i) - bW / 2} y={yV(extraKm)} width={bW} height={bhExt} rx={2} fill="#06b6d4" />
                {showLabel && (
                  <text x={xExt(i)} y={yV(extraKm) - 4} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#0891b2">
                    {fmtKm(extraKm)}
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}

      {/* Linha de tendência */}
      {n >= 2 && (
        <line x1={xReal(0)} y1={yV(ty0)} x2={xReal(n - 1)} y2={yV(ty1)}
          stroke="#6366f1" strokeWidth={2} strokeLinecap="round" opacity={0.9} />
      )}

      {/* Labels eixo X */}
      {xLabels.map((i) => (
        <text key={i} x={xMid(i)} y={VH - 6} textAnchor="middle" fontSize={9} fill="var(--muted)">
          {visible[i]?.startDate.slice(5).replace('-', '/')}
        </text>
      ))}
    </svg>
  );
}

/** Legenda + números-chave abaixo do gráfico. */
function EvolutionKeyNumbers({ weeks, period }: { weeks: WeekData[]; period: number }) {
  const visible = weeks.slice(period === 999 ? 0 : Math.max(0, weeks.length - period));
  const last4 = weeks.slice(Math.max(0, weeks.length - 4));
  const avgKm4 = last4.length ? (last4.reduce((s, w) => s + w.completedKm, 0) / last4.length).toFixed(1) : '–';
  const avgAdh4 = last4.length ? Math.round(last4.reduce((s, w) => s + w.adherencePercent, 0) / last4.length) : null;
  const bestWeek = visible.length ? Math.max(...visible.map((w) => w.completedKm)).toFixed(1) : '–';
  const totalKm = visible.reduce((s, w) => s + w.completedKm, 0).toFixed(1);

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <div style={keyNumStyle}><span style={keyNumLabel}>Média KM (4 sem)</span><strong>{avgKm4} km</strong></div>
      <div style={keyNumStyle}><span style={keyNumLabel}>Aderência (4 sem)</span><strong>{avgAdh4 !== null ? `${avgAdh4}%` : '–'}</strong></div>
      <div style={keyNumStyle}><span style={keyNumLabel}>Melhor semana</span><strong>{bestWeek} km</strong></div>
      <div style={keyNumStyle}><span style={keyNumLabel}>Total no período</span><strong>{totalKm} km</strong></div>
      {/* legenda */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'#94a3b8', marginRight:4, verticalAlign:'middle' }} />Prescrito</span>
        <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'#22c55e', marginRight:4, verticalAlign:'middle' }} />Realizado</span>
        <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'#06b6d4', marginRight:4, verticalAlign:'middle' }} />Extras</span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
          <svg width={22} height={4} style={{ verticalAlign:'middle' }}><line x1={0} y1={2} x2={22} y2={2} stroke="#6366f1" strokeWidth={2} /></svg>
          Tendência
        </span>
      </div>
    </div>
  );
}
const keyNumStyle: React.CSSProperties = {
  background: 'var(--surface-alt, #f8fafc)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '6px 12px',
  minWidth: 110,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
const keyNumLabel: React.CSSProperties = { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };

type CalSession = {
  status: string;
  modality: string;
  distanceKm: number | null | undefined;
  perceivedEffort: number | null | undefined;
  satisfaction: string | null | undefined;
  title: string;
};

/** Abreviação de modalidade. */
function modalityLetter(modality: string): string {
  const m = (modality ?? '').toLowerCase();
  if (m.includes('corrida') || m === 'running') return 'C';
  if (m.includes('muscul')) return 'M';
  if (m.includes('fortale') || m.includes('forte')) return 'F';
  if (m.includes('caminh') || m === 'walk') return 'W';
  return '+';
}

/** Cor da borda pelo esforço percebido (ring). */
function effortRingColor(effort: number | null | undefined): string | null {
  if (!effort) return null;
  if (effort <= 3) return '#93c5fd'; // fácil — azul claro
  if (effort <= 6) return '#fbbf24'; // moderado — âmbar
  if (effort <= 8) return '#fb923c'; // intenso — laranja
  return '#ef4444';                  // muito intenso — vermelho
}

/** Calendário de bolinhas maior — 8 semanas, multi-sessão por dia, anel de esforço. */
// 11/09: onDayClick — callback disparado ao clicar em uma bolinha; recebe o planId do plano
// daquele dia para que a aba Semanas anteriores possa expandi-lo diretamente.
function TrainingCalendarDots({ history, onDayClick }: {
  history: StudentDetail['history'];
  onDayClick?: (planId: string) => void;
}) {
  // dayPlanMap: para cada dia, registra qual plano (mais recente) reivindicou esse dia
  const dayPlanMap = new Map<string, string>(); // date → plan.id
  const dayMap = new Map<string, CalSession[]>();

  for (const plan of (history ?? [])) {
    for (const session of (plan.sessions ?? [])) {
      const day = String(session.date).slice(0, 10);
      if (!dayPlanMap.has(day)) {
        // Primeira vez que vemos esse dia = plano mais recente (history é newest-first)
        dayPlanMap.set(day, plan.id);
        dayMap.set(day, []);
      }
      // Só adiciona sessões do plano que reivindicou esse dia (evita duplicatas de planos antigos)
      if (dayPlanMap.get(day) === plan.id) {
        dayMap.get(day)!.push({
          status: session.completionStatus ?? 'sem_registro',
          modality: session.modality ?? '',
          distanceKm: session.distanceKm,
          perceivedEffort: session.perceivedEffort,
          satisfaction: session.satisfaction,
          title: session.title ?? '',
        });
      }
    }
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  // Calcula o início: 7 semanas atrás + semana atual = 8 semanas visíveis. Começa na
  // segunda-feira da semana 7 semanas atrás para que a semana atual esteja sempre incluída.
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 7 * 7 - ((today.getDay() + 6) % 7)); // começa na segunda
  startDate.setHours(0, 0, 0, 0);

  const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
  const weeks: Date[][] = [];
  const cur = new Date(startDate);
  for (let w = 0; w < 8; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  function sessionColor(status: string, dateStr: string): string {
    if (status === 'done' || status === 'adjusted') return '#22c55e';
    if (status === 'missed') return '#ef4444';
    if (dateStr <= todayStr) return '#f59e0b';
    return '#94a3b8';
  }

  const DOT = 44; // px — tamanho da bolinha principal

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 380 }}>
        {/* Header dos dias da semana */}
        <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(7, 1fr)`, gap: '4px 4px', marginBottom: 6 }}>
          <div />
          {WEEKDAYS.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{d}</div>
          ))}
        </div>
        {/* Linhas de semana — mais recente no topo */}
        {[...weeks].reverse().map((week, wi) => {
          const weekLabel = `${week[0].getDate().toString().padStart(2, '0')}/${(week[0].getMonth() + 1).toString().padStart(2, '0')}`;
          return (
            <div key={wi} style={{ display: 'grid', gridTemplateColumns: `52px repeat(7, 1fr)`, gap: '4px 4px', marginBottom: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right', paddingRight: 8 }}>{weekLabel}</div>
              {week.map((day, di) => {
                const dateStr = day.toISOString().slice(0, 10);
                const sessions = dayMap.get(dateStr) ?? [];
                const isToday = dateStr === todayStr;
                if (sessions.length === 0) {
                  // Sem treino — bolinha vazia discreta
                  return (
                    <div key={di} style={{ display: 'flex', justifyContent: 'center' }}>
                      <div title={dateStr} style={{
                        width: DOT, height: DOT, borderRadius: '50%',
                        background: 'var(--line)', opacity: 0.18,
                        border: isToday ? '2px solid var(--accent)' : 'none',
                      }} />
                    </div>
                  );
                }
                // Sessão principal = corrida se existir, senão primeira
                const primary = sessions.find((s) => s.modality.toLowerCase().includes('corrida')) ?? sessions[0];
                const extra = sessions.length - 1; // número de sessões adicionais
                const bg = sessionColor(primary.status, dateStr);
                const ring = effortRingColor(primary.perceivedEffort);
                const letter = modalityLetter(primary.modality);
                // Texto do dot: km para corrida, letra para outros
                const isCorrida = primary.modality.toLowerCase().includes('corrida');
                const kmText = isCorrida && primary.distanceKm ? `${primary.distanceKm % 1 === 0 ? primary.distanceKm.toFixed(0) : primary.distanceKm.toFixed(1)}` : null;
                const tooltipParts = sessions.map((s) =>
                  `${s.title || s.modality}${s.distanceKm ? ` ${s.distanceKm}km` : ''}${s.perceivedEffort ? ` • esf.${s.perceivedEffort}` : ''}${s.satisfaction ? ` • ${s.satisfaction}` : ''}`
                );
                // planId associado ao dia (para navegar na aba Semanas anteriores)
                const dayPlanId = dayPlanMap.get(dateStr) ?? '';
                return (
                  <div key={di} style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <div
                        title={`${dateStr}\n${tooltipParts.join('\n')}${onDayClick ? '\n\nClique para ver o treino completo' : ''}`}
                        onClick={onDayClick && dayPlanId ? () => onDayClick(dayPlanId) : undefined}
                        style={{
                        width: DOT, height: DOT, borderRadius: '50%',
                        background: bg,
                        // Anel de esforço via box-shadow — fora do círculo, com gap branco para destacar.
                        // Camada 1 (interna): gap branco de 2px. Camada 2 (externa): anel colorido 3px.
                        // Quando é "hoje", substitui pelo anel de acento do tema.
                        boxShadow: isToday
                          ? '0 0 0 2px var(--bg), 0 0 0 5px var(--accent)'
                          : ring
                          ? `0 0 0 2px var(--bg), 0 0 0 5px ${ring}`
                          : 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexDirection: 'column',
                        cursor: onDayClick ? 'pointer' : 'default',
                        transition: 'opacity 0.15s',
                      }}
                        onMouseEnter={onDayClick ? (e) => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; } : undefined}
                        onMouseLeave={onDayClick ? (e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; } : undefined}
                      >
                        {kmText ? (
                          <>
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{kmText}</span>
                            <span style={{ fontSize: 7.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>km</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{letter}</span>
                        )}
                      </div>
                      {/* Badge para sessões extras (força + corrida no mesmo dia) */}
                      {extra > 0 && (
                        <div style={{
                          position: 'absolute', top: -4, right: -4,
                          width: 16, height: 16, borderRadius: '50%',
                          background: '#6366f1', color: '#fff',
                          fontSize: 9, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '1.5px solid var(--bg)',
                        }} title={sessions.slice(1).map((s) => s.modality).join(', ')}>
                          +{extra}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {/* Legenda */}
        <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap', rowGap: 6 }}>
          {[['#22c55e','Feito'],['#ef4444','Nao feito'],['#f59e0b','Sem registro'],['#94a3b8','Futuro']].map(([c, l]) => (
            <span key={l}><span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:c, marginRight:4, verticalAlign:'middle' }} />{l}</span>
          ))}
          <span style={{ borderLeft: '1px solid var(--line)', paddingLeft: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[['C','Corrida'],['M','Muscul.'],['F','Fortal.'],['W','Caminhada']].map(([l, label]) => (
              <span key={l} style={{ display:'flex', alignItems:'center', gap:3 }}>
                <span style={{ display:'inline-flex', width:14, height:14, borderRadius:'50%', background:'#64748b', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:700, color:'#fff' }}>{l}</span>
                {label}
              </span>
            ))}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 10, color: 'var(--muted)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Anel de esforço:</span>
          {[['#93c5fd','1-3 fácil'],['#fbbf24','4-6 mod.'],['#fb923c','7-8 intenso'],['#ef4444','9-10 máx']].map(([c, l]) => (
            <span key={l} style={{ display:'flex', alignItems:'center', gap:3 }}>
              {/* Mini-dot igual ao do calendário: fundo neutro + anel externo colorido */}
              <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#64748b', boxShadow:`0 0 0 2px var(--bg), 0 0 0 4px ${c}`, verticalAlign:'middle', marginRight: 2 }} />{l}
            </span>
          ))}
          <span style={{ marginLeft: 6 }}>
            <span style={{ display:'inline-flex', width:14, height:14, borderRadius:'50%', background:'#6366f1', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:700, color:'#fff', marginRight:3 }}>+1</span>
            sessao adicional no dia
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── EVOLUÇÃO: COMPONENTES BASE ─────────────────────────────────────────────

/** Acordeon genérico para a aba Evolução. */
function EvoSection({ icon, title, badge, desc, children }: {
  icon: string; title: string; badge?: string | number; desc?: string; children: ReactNode;
}) {
  return (
    <details style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
      <summary style={{
        cursor: 'pointer', padding: '13px 16px', display: 'flex', alignItems: 'center',
        gap: 10, listStyle: 'none', fontWeight: 600, fontSize: 14, userSelect: 'none',
        WebkitUserSelect: 'none',
      }}>
        <span style={{ fontSize: 17, lineHeight: 1 }}>{icon}</span>
        <span style={{ flex: 1, color: 'var(--text)' }}>{title}</span>
        {badge != null && badge !== 0 && (
          <span style={{ background: 'var(--line)', borderRadius: 10, padding: '1px 9px', fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>
            {badge}
          </span>
        )}
        <ChevronDown size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
      </summary>
      {desc && (
        <div style={{ padding: '8px 16px 0', background: 'var(--accent-soft)', borderBottom: '1px solid var(--line)' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 8px' }}>ℹ️ {desc}</p>
        </div>
      )}
      <div style={{ padding: '6px 16px 18px' }}>
        {children}
      </div>
    </details>
  );
}

// ─── FEEDBACKS DO ALUNO ─────────────────────────────────────────────────────

const SAT_SCORE: Record<string, number> = { amei: 5, gostei: 4, ok: 3, nao_gostei: 2, detestei: 1 };
const SAT_LABEL: Record<string, string> = { amei: '😍 Amei', gostei: '😊 Gostei', ok: '😐 Ok', nao_gostei: '😕 Nao gostei', detestei: '😤 Detestei' };
const SAT_EMOJI: Record<string, string> = { amei: '😍', gostei: '😊', ok: '😐', nao_gostei: '😕', detestei: '😤' };

/** Flatten de sessões com feedback de um histórico. */
function flatFeedbackSessions(history: StudentDetail['history']) {
  const out: Array<{
    id: string; planId: string; date: string; weekStart: string; modality: string; title: string;
    durationMin: number | null; distanceKm: number | null;
    completionStatus: string;
    completedDurationMin: number | null; completedDistanceKm: number | null;
    completedPaceSecondsKm: number | null;
    perceivedEffort: number | null;
    satisfaction: string | null; satisfactionElaboracao: string | null;
    satisfactionCapacidade: string | null; satisfactionCarga: string | null;
    feedback: string | null;
    // Feedback v1
    preSleepQuality: number | null; prePhysicalFatigue: number | null;
    preStressLevel: number | null; preMotivation: number | null;
    postWorkoutFeeling: number | null; postWorkoutMood: number | null;
    painFlag: string | null; painTiming: string | null;
    feedbackVersion: number | null;
  }> = [];
  for (const plan of (history ?? [])) {
    for (const session of (plan.sessions ?? [])) {
      out.push({
        id: session.id,
        planId: plan.id,
        date: String(session.date).slice(0, 10),
        weekStart: String(plan.startDate).slice(0, 10),
        modality: session.modality ?? '',
        title: session.title ?? '',
        durationMin: session.durationMin ?? null,
        distanceKm: session.distanceKm ?? null,
        completionStatus: session.completionStatus ?? 'sem_registro',
        completedDurationMin: session.completedDurationMin ?? null,
        completedDistanceKm: session.completedDistanceKm ?? null,
        completedPaceSecondsKm: session.completedPaceSecondsKm ?? null,
        perceivedEffort: session.perceivedEffort ?? null,
        satisfaction: session.satisfaction ?? null,
        satisfactionElaboracao: session.satisfactionElaboracao ?? null,
        satisfactionCapacidade: session.satisfactionCapacidade ?? null,
        satisfactionCarga: session.satisfactionCarga ?? null,
        feedback: session.feedback ?? null,
        preSleepQuality: session.preSleepQuality ?? null,
        prePhysicalFatigue: session.prePhysicalFatigue ?? null,
        preStressLevel: session.preStressLevel ?? null,
        preMotivation: session.preMotivation ?? null,
        postWorkoutFeeling: session.postWorkoutFeeling ?? null,
        postWorkoutMood: session.postWorkoutMood ?? null,
        painFlag: session.painFlag ?? null,
        painTiming: session.painTiming ?? null,
        feedbackVersion: session.feedbackVersion ?? null,
      });
    }
  }
  return out;
}

// Modalidades usadas no filtro de esforço e satisfação
const MODALITY_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'corrida', label: '🏃 Corrida' },
  { key: 'musculacao', label: '🏋️ Musculação' },
  { key: 'fortalecimento', label: '💪 Fortalec.' },
  { key: 'caminhada', label: '🚶 Caminhada' },
] as const;

function matchesModality(modality: string, filter: string): boolean {
  if (filter === 'all') return true;
  const m = modality.toLowerCase();
  if (filter === 'corrida') return m.includes('corrida') || m === 'running';
  if (filter === 'musculacao') return m.includes('muscul');
  if (filter === 'fortalecimento') return m.includes('fortale') || m.includes('forte');
  if (filter === 'caminhada') return m.includes('caminh') || m === 'walk';
  return true;
}

/** Esforço percebido — scatter plot por sessão + média semanal + tendência + filtro modalidade. */
function EffortSection({ history, period }: { history: StudentDetail['history']; period?: number }) {
  const [aggBy, setAggBy] = useState<'sessao' | 'semana' | 'mes'>('semana');
  const [modalityFilter, setModalityFilter] = useState<string>('all');
  const allSessions = flatFeedbackSessions(history).filter((s) => s.perceivedEffort != null);
  if (allSessions.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum esforço registrado ainda.</p>;

  // Filtra por período e modalidade
  const cutoff = period && period !== 999
    ? new Date(Date.now() - period * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : '0000-00-00';
  const sessions = allSessions
    .filter((s) => s.date >= cutoff)
    .filter((s) => matchesModality(s.modality, modalityFilter));

  const effortColor = (v: number) => v <= 3 ? '#93c5fd' : v <= 6 ? '#fbbf24' : v <= 8 ? '#fb923c' : '#ef4444';

  const VW = 620, VH = 200;
  const ML = 28, MR = 10, MT = 12, MB = 32;
  const CW = VW - ML - MR, CH = VH - MT - MB;
  const yFn = (v: number) => MT + CH - ((v - 1) / 9) * CH;

  // Filtros de modalidade + agregação
  const FilterBar = () => (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
      {MODALITY_FILTERS.map((f) => {
        const count = allSessions.filter((s) =>
          s.date >= cutoff && matchesModality(s.modality, f.key)
        ).length;
        if (f.key !== 'all' && count === 0) return null;
        return (
          <button key={f.key} type="button"
            style={{ padding: '2px 9px', fontSize: 11, borderRadius: 6,
              background: modalityFilter === f.key ? '#6366f1' : 'var(--surface)',
              color: modalityFilter === f.key ? '#fff' : 'var(--muted)',
              border: `1px solid ${modalityFilter === f.key ? '#6366f1' : 'var(--line)'}`,
              cursor: 'pointer' }}
            onClick={() => setModalityFilter(f.key)}>
            {f.label} {f.key !== 'all' && <span style={{ opacity: 0.7 }}>({count})</span>}
          </button>
        );
      })}
    </div>
  );

  if (aggBy === 'sessao') {
    // Scatter plot individual — cada sessão é um ponto
    const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) return <div><AggToggle value={aggBy} onChange={setAggBy} /><FilterBar /><p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem registros no período/modalidade.</p></div>;
    const xFn = (i: number) => ML + (i / Math.max(1, sorted.length - 1)) * CW;
    // Média móvel de 5 sessões
    const movAvg = sorted.map((_, i) => {
      const slice = sorted.slice(Math.max(0, i-2), i+3);
      return slice.reduce((s, x) => s + x.perceivedEffort!, 0) / slice.length;
    });
    const avg = sessions.reduce((s, x) => s + x.perceivedEffort!, 0) / sessions.length;
    const xLabels = sorted.length <= 10
      ? sorted.map((s, i) => ({ i, label: s.date.slice(5).replace('-', '/') }))
      : [0, Math.floor(sorted.length/3), Math.floor(2*sorted.length/3), sorted.length-1]
          .map((i) => ({ i, label: sorted[i].date.slice(5).replace('-', '/') }));
    return (
      <div>
        <AggToggle value={aggBy} onChange={setAggBy} />
        <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', display: 'block' }}>
          {[1,2,3,4,5,6,7,8,9,10].map((v) => (
            <g key={v}>
              <line x1={ML} x2={VW-MR} y1={yFn(v)} y2={yFn(v)} stroke="var(--line)" strokeWidth={v===5||v===8?0.8:0.3} strokeDasharray={v===5||v===8?'4,3':''}/>
              <text x={ML-3} y={yFn(v)+3.5} textAnchor="end" fontSize={8} fill="var(--muted)">{v}</text>
            </g>
          ))}
          {/* Zona confort */}
          <rect x={ML} y={yFn(6)} width={CW} height={yFn(4)-yFn(6)} fill="#fbbf2411" />
          {/* Linha de tendência (média móvel) */}
          <polyline
            points={movAvg.map((v, i) => `${xFn(i)},${yFn(v)}`).join(' ')}
            fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.7}
          />
          {/* Pontos */}
          {sorted.map((s, i) => (
            <circle key={i} cx={xFn(i)} cy={yFn(s.perceivedEffort!)} r={5}
              fill={effortColor(s.perceivedEffort!)} stroke="var(--bg)" strokeWidth={1.5} opacity={0.9}>
              <title>{s.date} — {s.title || s.modality}: {s.perceivedEffort}/10</title>
            </circle>
          ))}
          {/* Linha de média geral */}
          <line x1={ML} x2={VW-MR} y1={yFn(avg)} y2={yFn(avg)} stroke="#6366f1" strokeWidth={1} strokeDasharray="6,4" opacity={0.4}/>
          <text x={VW-MR+2} y={yFn(avg)+3} fontSize={8} fill="#6366f1" opacity={0.8}>⌀{avg.toFixed(1)}</text>
          {/* Labels eixo X */}
          {xLabels.map(({i,label}) => (
            <text key={i} x={xFn(i)} y={VH-4} textAnchor="middle" fontSize={8} fill="var(--muted)">{label}</text>
          ))}
        </svg>
        <EffortLegend sessions={sessions} />
      </div>
    );
  }

  if (aggBy === 'mes') {
    // Agrupado por mês — média mensal
    const byMonth = new Map<string, number[]>();
    for (const s of sessions) {
      const month = s.date.slice(0, 7); // 'YYYY-MM'
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month)!.push(s.perceivedEffort!);
    }
    const months = Array.from(byMonth.entries()).sort(([a],[b])=>a.localeCompare(b))
      .map(([month, vals]) => ({ month, avg: vals.reduce((a,v)=>a+v,0)/vals.length, count: vals.length, min: Math.min(...vals), max: Math.max(...vals) }));
    if (months.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem registros no período.</p>;
    const gap = CW / months.length;
    const barW = Math.max(8, Math.min(40, gap * 0.65));
    const xFn = (i: number) => ML + i * gap + gap / 2;
    return (
      <div>
        <AggToggle value={aggBy} onChange={setAggBy} />
        <FilterBar />
        <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', display: 'block' }}>
          {[1,3,5,7,8,10].map((v) => (
            <g key={v}>
              <line x1={ML} x2={VW-MR} y1={yFn(v)} y2={yFn(v)} stroke="var(--line)" strokeWidth={v===5||v===8?0.8:0.3}/>
              <text x={ML-3} y={yFn(v)+3.5} textAnchor="end" fontSize={8} fill="var(--muted)">{v}</text>
            </g>
          ))}
          {months.map((m, i) => (
            <g key={i}>
              {/* Barra min-max (amplitude) */}
              <line x1={xFn(i)} x2={xFn(i)} y1={yFn(m.max)} y2={yFn(m.min)} stroke={effortColor(m.avg)} strokeWidth={3} opacity={0.25}/>
              {/* Barra principal (média) */}
              <rect x={xFn(i)-barW/2} y={yFn(m.avg)} width={barW} height={Math.max(1,yFn(1)-yFn(m.avg))} fill={effortColor(m.avg)} rx={3} opacity={0.85}/>
              {/* Rótulo valor */}
              <text x={xFn(i)} y={yFn(m.avg)-3} textAnchor="middle" fontSize={8} fontWeight={600} fill={effortColor(m.avg)}>{m.avg.toFixed(1)}</text>
              <text x={xFn(i)} y={VH-4} textAnchor="middle" fontSize={8} fill="var(--muted)">
                {m.month.slice(5)}/{m.month.slice(2,4)}
              </text>
            </g>
          ))}
        </svg>
        <EffortLegend sessions={sessions} />
      </div>
    );
  }

  // aggBy === 'semana' (padrão) — barras de média semanal
  const byWeek = new Map<string, number[]>();
  for (const s of sessions) {
    if (!byWeek.has(s.weekStart)) byWeek.set(s.weekStart, []);
    byWeek.get(s.weekStart)!.push(s.perceivedEffort!);
  }
  const weeks = Array.from(byWeek.entries()).sort(([a],[b])=>a.localeCompare(b))
    .map(([week, vals]) => ({ week, avg: vals.reduce((a,v)=>a+v,0)/vals.length, count: vals.length, min: Math.min(...vals), max: Math.max(...vals) }));
  if (weeks.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem registros no período.</p>;

  const gap = CW / weeks.length;
  const barW = Math.max(6, Math.min(36, gap * 0.60));
  const xFn = (i: number) => ML + i * gap + gap / 2;
  // Tendência linear simples (regressão)
  const n = weeks.length;
  const meanX = (n-1)/2;
  const meanY = weeks.reduce((s,w)=>s+w.avg,0)/n;
  const slope = weeks.reduce((s,w,i)=>s+(i-meanX)*(w.avg-meanY),0) / weeks.reduce((s,_,i)=>s+(i-meanX)**2,0);
  const intercept = meanY - slope * meanX;
  const trendPts = `${xFn(0)},${yFn(intercept)} ${xFn(n-1)},${yFn(intercept + slope*(n-1))}`;

  const xLabels = weeks.length <= 10
    ? weeks.map((_,i)=>i)
    : weeks.map((_,i)=>i).filter((i)=>i===0||i===n-1||i%Math.ceil(n/6)===0);

  return (
    <div>
      <AggToggle value={aggBy} onChange={setAggBy} />
      <FilterBar />
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', display: 'block' }}>
        {[1,2,3,4,5,6,7,8,9,10].map((v) => (
          <g key={v}>
            <line x1={ML} x2={VW-MR} y1={yFn(v)} y2={yFn(v)} stroke="var(--line)" strokeWidth={v===5||v===8?0.8:0.3} strokeDasharray={v===5||v===8?'4,3':''}/>
            <text x={ML-3} y={yFn(v)+3.5} textAnchor="end" fontSize={8} fill="var(--muted)">{v}</text>
          </g>
        ))}
        {/* Zona 4-6 moderado */}
        <rect x={ML} y={yFn(6)} width={CW} height={yFn(4)-yFn(6)} fill="#fbbf2411" />
        {/* Amplitude (linha min-max) */}
        {weeks.map((w,i) => (
          <line key={`r${i}`} x1={xFn(i)} x2={xFn(i)} y1={yFn(w.max)} y2={yFn(w.min)} stroke={effortColor(w.avg)} strokeWidth={2} opacity={0.2}/>
        ))}
        {/* Barras de média */}
        {weeks.map((w,i) => (
          <g key={i}>
            <rect x={xFn(i)-barW/2} y={yFn(w.avg)} width={barW} height={Math.max(1,yFn(1)-yFn(w.avg))} fill={effortColor(w.avg)} rx={3} opacity={0.85}>
              <title>{w.week}: média {w.avg.toFixed(1)} · min {w.min} · max {w.max} · {w.count} treino(s)</title>
            </rect>
            {/* Rótulo no topo da barra */}
            {barW >= 16 && (
              <text x={xFn(i)} y={yFn(w.avg)-3} textAnchor="middle" fontSize={7.5} fontWeight={600} fill={effortColor(w.avg)}>{w.avg.toFixed(1)}</text>
            )}
          </g>
        ))}
        {/* Linha de tendência */}
        {n >= 3 && <line x1={xFn(0)} y1={yFn(intercept)} x2={xFn(n-1)} y2={yFn(intercept+slope*(n-1))}
          stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6,3" opacity={0.6}/>}
        {n >= 3 && <polyline points={trendPts} fill="none"/>}
        {/* Labels eixo X */}
        {xLabels.map((i) => (
          <text key={i} x={xFn(i)} y={VH-4} textAnchor="middle" fontSize={8} fill="var(--muted)">
            {weeks[i].week.slice(5).replace('-','/')}
          </text>
        ))}
      </svg>
      <EffortLegend sessions={sessions} />
    </div>
  );
}

function AggToggle({ value, onChange }: { value: 'sessao'|'semana'|'mes'; onChange: (v: 'sessao'|'semana'|'mes') => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
      {(['sessao','semana','mes'] as const).map((v) => (
        <button key={v} type="button"
          style={{ padding: '2px 10px', fontSize: 11, borderRadius: 6,
            background: value === v ? 'var(--accent)' : 'var(--surface)',
            color: value === v ? '#fff' : 'var(--muted)',
            border: `1px solid ${value === v ? 'var(--accent)' : 'var(--line)'}`,
            cursor: 'pointer' }}
          onClick={() => onChange(v)}>
          {v === 'sessao' ? 'Por sessão' : v === 'semana' ? 'Por semana' : 'Por mês'}
        </button>
      ))}
    </div>
  );
}

function EffortLegend({ sessions }: { sessions: Array<{ perceivedEffort: number|null }> }) {
  const counts = { facil: 0, moderado: 0, intenso: 0, maximo: 0 };
  for (const s of sessions) {
    const v = s.perceivedEffort!;
    if (v <= 3) counts.facil++;
    else if (v <= 6) counts.moderado++;
    else if (v <= 8) counts.intenso++;
    else counts.maximo++;
  }
  const total = sessions.length;
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
      {[['#93c5fd','1-3 fácil', counts.facil],['#fbbf24','4-6 moderado',counts.moderado],
        ['#fb923c','7-8 intenso',counts.intenso],['#ef4444','9-10 máximo',counts.maximo]].map(([c,l,n]) => (
        <span key={l as string}>
          <span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:c as string,marginRight:3,verticalAlign:'middle'}}/>
          {l} <span style={{ color: 'var(--text)', fontWeight: 600 }}>{n}</span>
          <span style={{ fontSize: 10 }}> ({total > 0 ? Math.round((n as number/total)*100) : 0}%)</span>
        </span>
      ))}
      <span style={{ marginLeft: 'auto' }}>{total} registro{total !== 1 ? 's' : ''}</span>
    </div>
  );
}

/** Satisfação por categoria — gráfico individual por categoria + filtro de modalidade. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SatisfactionSection({ history, period }: { history: StudentDetail['history']; period?: number }) {
  const [modalityFilter, setModalityFilter] = useState<string>('all');
  const allSessions = flatFeedbackSessions(history);

  // Filtra por período
  const cutoff = period && period !== 999
    ? new Date(Date.now() - period * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : '0000-00-00';
  const sessionsByPeriod = allSessions.filter((s) => s.date >= cutoff);
  const sessions = sessionsByPeriod.filter((s) => matchesModality(s.modality, modalityFilter));

  const categories: Array<{ key: 'satisfaction'|'satisfactionElaboracao'|'satisfactionCapacidade'|'satisfactionCarga'; label: string; desc: string; color: string; icon: string }> = [
    { key: 'satisfaction', label: 'Geral', desc: 'Como se sentiu com o treino no geral', color: '#22c55e', icon: '⭐' },
    { key: 'satisfactionElaboracao', label: 'Elaboração', desc: 'Se achou o treino bem elaborado/explicado', color: '#6366f1', icon: '📋' },
    { key: 'satisfactionCapacidade', label: 'Capacidade', desc: 'Se se sentiu capaz de realizar', color: '#f59e0b', icon: '💪' },
    { key: 'satisfactionCarga', label: 'Carga', desc: 'Se a carga foi adequada ao seu momento', color: '#ef4444', icon: '⚖️' },
  ];

  const weekKeys = Array.from(new Set(sessions.map((s) => s.weekStart))).sort();

  // Filtro de modalidade
  const SatFilterBar = () => (
    <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
      {MODALITY_FILTERS.map((f) => {
        const count = sessionsByPeriod.filter((s) => matchesModality(s.modality, f.key)).length;
        if (f.key !== 'all' && count === 0) return null;
        return (
          <button key={f.key} type="button"
            style={{ padding: '3px 10px', fontSize: 11, borderRadius: 14, cursor: 'pointer', border: 'none',
              background: modalityFilter === f.key ? '#6366f1' : 'var(--surface)',
              color: modalityFilter === f.key ? '#fff' : 'var(--muted)' }}
            onClick={() => setModalityFilter(f.key)}>
            {f.label}{f.key !== 'all' && <span style={{ marginLeft: 4, opacity: 0.75 }}>({count})</span>}
          </button>
        );
      })}
      <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center', marginLeft: 4 }}>
        {sessions.length} resp. · {weekKeys.length} sem.
      </span>
    </div>
  );

  if (sessionsByPeriod.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhuma avaliação registrada ainda.</p>;

  // Gráfico SVG individual por categoria
  const VW = 580, VH = 140;
  const ML = 22, MR = 8, MT = 10, MB = 24;
  const CW = VW - ML - MR, CH = VH - MT - MB;
  const xFn = (i: number) => ML + (weekKeys.length <= 1 ? CW/2 : (i / (weekKeys.length - 1)) * CW);
  const yFn = (v: number) => MT + CH - ((v - 1) / 4) * CH; // escala 1-5

  const xLabels = weekKeys.length <= 8
    ? weekKeys.map((_, i) => i)
    : [0, Math.floor(weekKeys.length/2), weekKeys.length-1];

  const CatChart = ({ cat }: { cat: typeof categories[number] }) => {
    const pts = weekKeys.map((week) => {
      const ws = sessions.filter((s) => s.weekStart === week && s[cat.key] && SAT_SCORE[s[cat.key]!]);
      if (ws.length === 0) return null;
      return ws.reduce((a, s) => a + (SAT_SCORE[s[cat.key]!] ?? 0), 0) / ws.length;
    });
    const counts: Record<string, number> = {};
    let total = 0;
    for (const s of sessions) {
      const v = s[cat.key];
      if (!v || !SAT_SCORE[v]) continue;
      counts[v] = (counts[v] ?? 0) + 1;
      total++;
    }
    const avg = total > 0
      ? Object.entries(counts).reduce((a, [k, n]) => a + (SAT_SCORE[k] ?? 0) * n, 0) / total
      : null;
    const top = Object.entries(counts).sort(([,a],[,b]) => b-a)[0];
    // Tendência
    const half = Math.floor(weekKeys.length / 2);
    const firstHalf = sessions.filter((s) => weekKeys.indexOf(s.weekStart) < half && s[cat.key] && SAT_SCORE[s[cat.key]!]);
    const secondHalf = sessions.filter((s) => weekKeys.indexOf(s.weekStart) >= half && s[cat.key] && SAT_SCORE[s[cat.key]!]);
    const avgFirst = firstHalf.length ? firstHalf.reduce((a,s)=>a+(SAT_SCORE[s[cat.key]!]??0),0)/firstHalf.length : null;
    const avgSecond = secondHalf.length ? secondHalf.reduce((a,s)=>a+(SAT_SCORE[s[cat.key]!]??0),0)/secondHalf.length : null;
    const trend = avgFirst && avgSecond ? avgSecond - avgFirst : null;

    if (total === 0) return (
      <div style={{ padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', opacity: 0.5 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{cat.icon} {cat.label}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>Sem dados no período/filtro</span>
      </div>
    );

    const polyPts = pts.map((v, i) => v !== null ? `${xFn(i)},${yFn(v)}` : null).filter(Boolean).join(' ');

    return (
      <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', overflow: 'hidden' }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 6px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{cat.icon} {cat.label}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>{cat.desc}</span>
          {trend !== null && Math.abs(trend) >= 0.1 && (
            <span style={{ fontSize: 12, color: trend > 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}
            </span>
          )}
          {avg !== null && (
            <span style={{ fontWeight: 800, fontSize: 17,
              color: avg >= 4 ? '#22c55e' : avg >= 3 ? '#fbbf24' : '#ef4444' }}>
              {avg.toFixed(1)}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>/5</span>
            </span>
          )}
        </div>
        {/* Chips de distribuição */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '8px 14px 4px' }}>
          {(['amei','gostei','ok','nao_gostei','detestei'] as const).map((v) => {
            const n = counts[v] ?? 0;
            if (!n) return null;
            const pct = Math.round((n / total) * 100);
            return (
              <span key={v} title={`${SAT_LABEL[v]}: ${n} — ${pct}%`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: v === top?.[0] ? cat.color + '20' : 'var(--surface)',
                border: `1px solid ${v === top?.[0] ? cat.color + '55' : 'transparent'}`,
                borderRadius: 20, padding: '2px 9px', fontSize: 12,
              }}>
                <span style={{ fontSize: 13 }}>{SAT_EMOJI[v]}</span>
                <span style={{ fontWeight: v === top?.[0] ? 700 : 400 }}>{n}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>({pct}%)</span>
              </span>
            );
          })}
          <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center', marginLeft: 2 }}>{total} resp.</span>
        </div>
        {/* Gráfico de tendência semanal (só se há >= 2 semanas) */}
        {weekKeys.length >= 2 && polyPts && (
          <div style={{ padding: '4px 10px 8px' }}>
            <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
              {[1,2,3,4,5].map((v) => (
                <g key={v}>
                  <line x1={ML} x2={VW-MR} y1={yFn(v)} y2={yFn(v)} stroke="var(--line)" strokeWidth={v===3?0.8:0.3} strokeDasharray={v===3?'4,3':''}/>
                  <text x={ML-3} y={yFn(v)+3.5} textAnchor="end" fontSize={8} fill="var(--muted)">{v}</text>
                </g>
              ))}
              {/* Área preenchida */}
              {(() => {
                const validPts = pts.map((v, i) => v !== null ? { x: xFn(i), y: yFn(v) } : null).filter(Boolean) as {x:number;y:number}[];
                if (validPts.length < 2) return null;
                const areaPath = `M${validPts[0].x},${yFn(1)} ` +
                  validPts.map(p => `L${p.x},${p.y}`).join(' ') +
                  ` L${validPts[validPts.length-1].x},${yFn(1)} Z`;
                return <path d={areaPath} fill={cat.color} opacity={0.08}/>;
              })()}
              <polyline points={polyPts} fill="none" stroke={cat.color} strokeWidth={2} strokeLinejoin="round" opacity={0.9}/>
              {pts.map((v, i) => v !== null ? (
                <circle key={i} cx={xFn(i)} cy={yFn(v)} r={3} fill={cat.color} stroke="var(--bg)" strokeWidth={1}>
                  <title>{weekKeys[i]}: {v.toFixed(2)}/5</title>
                </circle>
              ) : null)}
              {/* Labels eixo X */}
              {xLabels.map((i) => (
                <text key={i} x={xFn(i)} y={VH-2} textAnchor="middle" fontSize={8} fill="var(--muted)">
                  {weekKeys[i]?.slice(5).replace('-','/')}
                </text>
              ))}
            </svg>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SatFilterBar />
      {categories.map((cat) => <CatChart key={cat.key} cat={cat} />)}
    </div>
  );
}

/** Lista de comentários em texto livre. */
function CommentsSection({ history }: { history: StudentDetail['history'] }) {
  const comments = flatFeedbackSessions(history)
    .filter((s) => s.feedback && s.feedback.trim().length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (comments.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum comentário em texto registrado ainda.</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {comments.map((c, i) => (
        <div key={c.date + c.modality + i} style={{ borderLeft: '3px solid var(--line)', paddingLeft: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.date}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{c.modality || c.title}</span>
            {c.perceivedEffort != null && (
              <span style={{ fontSize: 11, background: 'var(--line)', borderRadius: 4, padding: '0 6px' }}>
                esforço {c.perceivedEffort}/10
              </span>
            )}
            {c.satisfaction && SAT_EMOJI[c.satisfaction] && (
              <span style={{ fontSize: 13 }} title={SAT_LABEL[c.satisfaction]}>{SAT_EMOJI[c.satisfaction]}</span>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{c.feedback}</p>
        </div>
      ))}
    </div>
  );
}

/** Relatos de dores e lesões — perfil de saúde + observações + comentários com palavras-chave. */
function PainReportsSection({ health, observations, history }: {
  health: StudentDetail['health'];
  observations: NonNullable<StudentDetail['observations']>;
  history: StudentDetail['history'];
}) {
  const PAIN_KW = ['dor', 'lesao', 'lesão', 'machuc', 'inflam', 'torce', 'torci', 'joelho', 'tornoz', 'canela', 'quadril', 'costas', 'lombar', 'tendão', 'tendao'];
  const matchesPain = (text: string) => PAIN_KW.some((kw) => text.toLowerCase().includes(kw));

  const painObs = observations.filter((o) => matchesPain(o.content));
  const painComments = flatFeedbackSessions(history)
    .filter((s) => s.feedback && matchesPain(s.feedback))
    .sort((a, b) => b.date.localeCompare(a.date));

  const hasHealthData = health?.injuries || health?.healthProblems || health?.medications;
  const hasAny = hasHealthData || painObs.length > 0 || painComments.length > 0;

  if (!hasAny) return (
    <p style={{ color: 'var(--muted)', fontSize: 13 }}>Nenhum relato de dor ou lesão encontrado no perfil, observações ou feedback.</p>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Perfil de saúde */}
      {hasHealthData && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 8 }}>Perfil de saúde (entrevista)</p>
          {health?.injuries && (
            <div style={{ borderLeft: '3px solid #f59e0b', paddingLeft: 10, marginBottom: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>Lesões / histórico</p>
              <p style={{ fontSize: 13 }}>{health.injuries}</p>
            </div>
          )}
          {health?.healthProblems && (
            <div style={{ borderLeft: '3px solid #f59e0b', paddingLeft: 10, marginBottom: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>Problemas de saúde</p>
              <p style={{ fontSize: 13 }}>{health.healthProblems}</p>
            </div>
          )}
          {health?.medications && (
            <div style={{ borderLeft: '3px solid #94a3b8', paddingLeft: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>Medicamentos</p>
              <p style={{ fontSize: 13 }}>{health.medications}</p>
            </div>
          )}
        </div>
      )}
      {/* Observações com menção a dor */}
      {painObs.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 8 }}>
            Observações do aluno com menção a dor ({painObs.length})
          </p>
          {painObs.map((o) => (
            <div key={o.id} style={{ borderLeft: '3px solid #ef4444', paddingLeft: 10, marginBottom: 8, opacity: o.active ? 1 : 0.5 }}>
              <p style={{ fontSize: 13, lineHeight: 1.5 }}>{o.content}</p>
              {!o.active && <p style={{ fontSize: 11, color: 'var(--muted)' }}>— arquivada</p>}
            </div>
          ))}
        </div>
      )}
      {/* Comentários pós-treino com menção a dor */}
      {painComments.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 8 }}>
            Relatos em feedback de treinos ({painComments.length})
          </p>
          {painComments.map((c, i) => (
            <div key={c.date + i} style={{ borderLeft: '3px solid #ef4444', paddingLeft: 10, marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{c.date} · {c.modality || c.title}</p>
              <p style={{ fontSize: 13, lineHeight: 1.5 }}>{c.feedback}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ANÁLISE DE CARGA ───────────────────────────────────────────────────────

/** Container com abas: Carga Semanal / Aguda:Crônica / Aderência. */
/** Carga semanal + ACWR — dois sub-gráficos em tabs (Aderência virou seção própria). */
function LoadAnalysisSection({ weeks }: { weeks: WeekData[] }) {
  const [tab, setTab] = useState<'semanal' | 'acr'>('semanal');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {([['semanal','Carga Semanal'],['acr','Aguda:Crônica']] as const).map(([key, label]) => (
          <button key={key} type="button"
            style={{ padding: '3px 12px', fontSize: 12, borderRadius: 6,
              background: tab === key ? 'var(--accent)' : 'transparent',
              color: tab === key ? '#fff' : 'var(--accent)',
              border: '1px solid var(--accent)', cursor: 'pointer', fontWeight: 500 }}
            onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'semanal' && <LoadChartSemanal weeks={weeks} />}
      {tab === 'acr' && <LoadChartACR weeks={weeks} />}
    </div>
  );
}

/** Barras coloridas por variação percentual + gridlines a cada 5km + linha de tendência. */
function LoadChartSemanal({ weeks }: { weeks: WeekData[] }) {
  if (weeks.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem dados.</p>;

  function barColor(i: number): string {
    if (i === 0) return '#3b82f6';
    const prev = weeks[i - 1].completedKm;
    if (prev === 0) return '#3b82f6';
    const delta = (weeks[i].completedKm - prev) / prev;
    if (delta <= 0.10) return '#22c55e';
    if (delta <= 0.25) return '#f59e0b';
    return '#ef4444';
  }

  const maxKm = Math.max(...weeks.map((w) => Math.max(w.completedKm, w.prescribedKm)), 5);
  const topKm = Math.ceil(maxKm / 5) * 5; // arredonda para múltiplo de 5
  const W = 620; const H = 170; const PL = 38; const PT = 10; const PB = 30; const PR = 10;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const barW = Math.max(4, (chartW / weeks.length) * 0.60);
  const gap = chartW / weeks.length;

  const yFn = (km: number) => PT + chartH - (km / topKm) * chartH;
  const xFn = (i: number) => PL + i * gap + gap / 2;

  // Gridlines a cada 5km
  const gridLines: number[] = [];
  for (let km = 0; km <= topKm; km += 5) gridLines.push(km);

  // Linha de tendência (regressão linear simples)
  const n = weeks.length;
  const meanX = (n - 1) / 2;
  const meanY = weeks.reduce((s, w) => s + w.completedKm, 0) / n;
  const slope = weeks.reduce((s, w, i) => s + (i - meanX) * (w.completedKm - meanY), 0)
    / (weeks.reduce((s, _, i) => s + (i - meanX) ** 2, 0) || 1);
  const intercept = meanY - slope * meanX;

  const xLabels: { i: number; label: string }[] = [];
  if (weeks.length <= 10) {
    weeks.forEach((w, i) => xLabels.push({ i, label: w.startDate.slice(5, 10).replace('-', '/') }));
  } else {
    weeks.forEach((_, i) => {
      if (i === 0 || i === n - 1 || i % Math.ceil(n / 8) === 0)
        xLabels.push({ i, label: weeks[i].startDate.slice(5, 10).replace('-', '/') });
    });
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        {/* Gridlines a cada 5km */}
        {gridLines.map((km) => (
          <g key={km}>
            <line x1={PL} y1={yFn(km)} x2={W - PR} y2={yFn(km)} stroke="var(--line)" strokeWidth={km === 0 ? 1 : 0.4} />
            <text x={PL - 4} y={yFn(km) + 3.5} textAnchor="end" fontSize={8.5} fill="var(--muted)">{km}</text>
          </g>
        ))}
        {/* Barras */}
        {weeks.map((w, i) => {
          const x = xFn(i);
          const y = yFn(w.completedKm);
          return (
            <g key={i}>
              <rect x={x - barW / 2} y={y} width={barW} height={Math.max(1, PT + chartH - y)}
                fill={barColor(i)} rx={2}>
                <title>{w.startDate}: {w.completedKm.toFixed(1)} km feito{weeks[i-1] ? ` (${((w.completedKm - weeks[i-1].completedKm) / (weeks[i-1].completedKm||1) * 100).toFixed(0)}% vs semana anterior)` : ''}</title>
              </rect>
              {/* Rótulo no topo da barra (se barra ≥ 14px) */}
              {barW >= 14 && w.completedKm > 0 && (
                <text x={x} y={y - 3} textAnchor="middle" fontSize={7.5} fontWeight={600} fill={barColor(i)}>
                  {w.completedKm % 1 === 0 ? w.completedKm : w.completedKm.toFixed(1)}
                </text>
              )}
            </g>
          );
        })}
        {/* Linha de tendência */}
        {n >= 3 && (
          <line
            x1={xFn(0)} y1={yFn(Math.max(0, intercept))}
            x2={xFn(n - 1)} y2={yFn(Math.max(0, intercept + slope * (n - 1)))}
            stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6,3" opacity={0.7}
          />
        )}
        {/* X labels */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={xFn(i)} y={H - 8} textAnchor="middle" fontSize={8.5} fill="var(--muted)">{label}</text>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap', alignItems: 'center' }}>
        {[['#22c55e','≤+10% (seguro)'],['#f59e0b','+10% a +25%'],['#ef4444','>+25% (salto)'],['#3b82f6','1ª semana']].map(([c, l]) => (
          <span key={l}><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:c, marginRight:4, verticalAlign:'middle' }} />{l}</span>
        ))}
        {n >= 3 && <span style={{ marginLeft: 8 }}>
          <span style={{ display:'inline-block', width:16, height:2, background:'#6366f1', marginRight:4, verticalAlign:'middle', opacity:0.7 }} />Tendência
        </span>}
      </div>
    </div>
  );
}

/** Razão Aguda:Crônica (ACWR) — Fadiga ÷ Fitness, com zonas de risco.
 *  Grade de quadriculado (H + V), escala Y de 0 a 3.0, labels X rotacionados,
 *  valores inline apenas nos pontos mais relevantes (primeiro, último, máx, mín).
 */
function LoadChartACR({ weeks }: { weeks: WeekData[] }) {
  if (weeks.length < 2) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Mínimo 2 semanas de dados para calcular a razão.</p>;

  const acwr = weeks.map((_, i) => {
    const acute   = weeks.slice(Math.max(0, i - 3), i + 1);
    const chronic = weeks.slice(Math.max(0, i - 5), i + 1);
    const aAvg = acute.reduce((s, w) => s + w.completedKm, 0) / acute.length;
    const cAvg = chronic.reduce((s, w) => s + w.completedKm, 0) / chronic.length;
    return cAvg > 0 ? aAvg / cAvg : 1;
  });

  const n = acwr.length;
  const W = 620; const H = 240;
  const PL = 40; const PT = 12; const PB = 56; const PR = 12; // PB grande para labels rotacionados
  const chartW = W - PL - PR; const chartH = H - PT - PB;

  // Escala Y: sempre 0–3, com ticks a cada 0.5
  const MAX_R = 3.0;
  const yFn = (r: number) => PT + chartH - Math.min(Math.max(r, 0) / MAX_R, 1) * chartH;
  const gap  = chartW / (n - 1 || 1);
  const xFn  = (i: number) => PL + i * gap;

  const polyPts = acwr.map((r, i) => `${xFn(i)},${yFn(r)}`).join(' ');

  // Ticks horizontais (grade H)
  const hTicks = [0, 0.5, 1.0, 1.3, 1.5, 2.0, 2.5, 3.0];
  // Ticks verticais (grade V) — um por ponto, mas exibimos linha apenas a cada slot controlado
  const vTickEvery = n <= 12 ? 1 : n <= 24 ? 2 : Math.ceil(n / 12);

  // Labels X — mostra a cada vTickEvery pontos
  const xLabelIdxs = weeks.map((_, i) => i).filter((i) => i % vTickEvery === 0 || i === n - 1);

  // Pontos onde mostrar o valor inline: primeiro, último, máximo e mínimo
  const maxIdx = acwr.reduce((m, v, i) => v > acwr[m] ? i : m, 0);
  const minIdx = acwr.reduce((m, v, i) => v < acwr[m] ? i : m, 0);
  const labelSet = new Set([0, n - 1, maxIdx, minIdx]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>

        {/* ── Zonas de cor ────────────────────────────── */}
        {/* Zona segura: 0.8–1.3 */}
        <rect x={PL} y={yFn(1.3)} width={chartW} height={yFn(0.8) - yFn(1.3)} fill="#22c55e" opacity={0.13} />
        {/* Zona de risco: >1.5 */}
        <rect x={PL} y={PT} width={chartW} height={Math.max(0, yFn(1.5) - PT)} fill="#ef4444" opacity={0.09} />

        {/* ── Grade H ─────────────────────────────────── */}
        {hTicks.map((r) => {
          const isRef = r === 0.8 || r === 1.0 || r === 1.3 || r === 1.5;
          return (
            <g key={r}>
              <line x1={PL} x2={W - PR} y1={yFn(r)} y2={yFn(r)}
                stroke="var(--line)"
                strokeWidth={r === 1.0 ? 1.2 : 0.5}
                strokeDasharray={isRef && r !== 1.0 ? '4,3' : '0'} />
              <text x={PL - 5} y={yFn(r) + 4} textAnchor="end" fontSize={9}
                fill={isRef ? 'var(--text)' : 'var(--muted)'} fontWeight={isRef ? 600 : 400}>
                {r.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* ── Grade V ─────────────────────────────────── */}
        {weeks.map((_, i) => i % vTickEvery === 0 || i === n - 1 ? (
          <line key={i} x1={xFn(i)} x2={xFn(i)} y1={PT} y2={PT + chartH}
            stroke="var(--line)" strokeWidth={0.4} />
        ) : null)}

        {/* ── Linha ACWR ──────────────────────────────── */}
        {n > 1 && <polyline points={polyPts} fill="none" stroke="#3b82f6" strokeWidth={2.2} strokeLinejoin="round" />}

        {/* ── Pontos + labels seletivos ───────────────── */}
        {acwr.map((r, i) => {
          const cx = xFn(i); const cy = yFn(r);
          const safe = r >= 0.8 && r <= 1.3;
          const risky = r > 1.5;
          const lColor = risky ? '#ef4444' : safe ? '#16a34a' : '#d97706';
          const showLbl = labelSet.has(i);
          // Pontos extremos ficam acima, outros abaixo para não colidir
          const lY = (i === maxIdx) ? cy - 9 : cy + 15;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={i === maxIdx || i === minIdx ? 5 : 3.5} fill="#3b82f6">
                <title>{weeks[i].startDate}: {r.toFixed(2)}</title>
              </circle>
              {showLbl && (
                <text x={cx} y={lY} textAnchor="middle" fontSize={9} fontWeight={700} fill={lColor}>
                  {r.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Labels eixo X (rotacionados -45°) ──────── */}
        {xLabelIdxs.map((i) => (
          <text key={i}
            x={xFn(i)} y={PT + chartH + 10}
            transform={`rotate(-45, ${xFn(i)}, ${PT + chartH + 10})`}
            textAnchor="end" fontSize={8.5} fill="var(--muted)">
            {weeks[i].startDate.slice(5, 10).replace('-', '/')}
          </text>
        ))}
      </svg>

      {/* ── Legenda ─────────────────────────────────────── */}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>
            <span style={{ display:'inline-block', width:12, height:12, background:'#22c55e', opacity:0.35, verticalAlign:'middle', marginRight:4, borderRadius:2 }} />
            0.8 a 1.3 = zona segura
          </span>
          <span>
            <span style={{ display:'inline-block', width:12, height:12, background:'#ef4444', opacity:0.25, verticalAlign:'middle', marginRight:4, borderRadius:2 }} />
            Acima de 1.5 = carga recente alta em relação à base
          </span>
          <span>Abaixo de 0.8 = estímulo possivelmente insuficiente</span>
        </div>
        <div style={{ fontSize: 10, fontStyle: 'italic', color: 'var(--muted)', marginTop: 2, borderTop: '1px solid var(--line)', paddingTop: 4 }}>
          ⚠️ O ACWR é um indicador auxiliar — um valor fora da zona segura isoladamente não representa necessariamente risco.
          Interprete sempre em conjunto com RPE, sono, dor e contexto do atleta. Nunca altere a prescrição com base nesse número sozinho.
        </div>
      </div>
    </div>
  );
}

/** Gráfico de colunas de aderência semanal com filtro por modalidade.
 *
 *  3 colunas por semana — cada uma com o número inline:
 *  🔵 Cinza (Prescritos): sessões planejadas para a semana
 *  🟢 Verde  (Feitos):     sessões concluídas (done + adjusted)
 *  🟡 Âmbar  (Sem reg.):   sessões sem registro de conclusão pelo aluno
 *  🩵 Ciano  (Extras):     sessões além do prescrito (só visível no filtro "Geral")
 */
function LoadChartAderencia({ weeks, history }: {
  weeks: WeekData[];
  history?: Array<{ startDate: string | null; sessions?: Array<{ modality: string; completionStatus: string }> | null }>;
}) {
  const [modFilter, setModFilter] = useState<string>('all');

  if (weeks.length === 0) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sem dados.</p>;

  // Map: weekStart → sessions[]
  const planMap = new Map<string, Array<{ modality: string; completionStatus: string }>>();
  for (const plan of (history ?? [])) {
    const ws = String(plan.startDate ?? '').slice(0, 10);
    planMap.set(ws, (plan.sessions ?? []).map((s) => ({ modality: s.modality ?? '', completionStatus: s.completionStatus ?? '' })));
  }

  function normMod(m: string): string {
    const ml = m.toLowerCase();
    if (ml.includes('corrida')) return 'corrida';
    if (ml.includes('muscul')) return 'musculacao';
    if (ml.includes('fortalec')) return 'fortalecimento';
    if (ml.includes('caminhada')) return 'caminhada';
    return 'outro';
  }

  // Only show modality options that actually appear in data
  const modsInData = new Set<string>();
  for (const sessions of planMap.values()) sessions.forEach((s) => modsInData.add(normMod(s.modality)));
  const MOD_OPTS = [
    { key: 'all', label: 'Geral' },
    { key: 'corrida', label: 'Corrida' },
    { key: 'musculacao', label: 'Musculação' },
    { key: 'fortalecimento', label: 'Fortalec.' },
    { key: 'caminhada', label: 'Caminhada' },
  ].filter((m) => m.key === 'all' || modsInData.has(m.key));

  const barData = weeks.map((w) => {
    const all = planMap.get(w.startDate) ?? [];
    const filtered = modFilter === 'all' ? all : all.filter((s) => normMod(s.modality) === modFilter);
    const prescritos = filtered.length;
    const feitos = filtered.filter((s) => s.completionStatus === 'done' || s.completionStatus === 'adjusted').length;
    const semReg = filtered.filter((s) => s.completionStatus === 'sem_registro').length;
    // Extras: só no modo Geral — sessões completadas além do prescrito na semana
    const extras = modFilter === 'all' ? Math.max(0, w.completedSessions - w.prescribedSessions) : 0;
    return { startDate: w.startDate, prescritos, feitos, semReg, extras };
  });

  const maxVal = Math.max(...barData.map((d) => Math.max(d.prescritos, d.feitos + d.extras, d.semReg)), 1);

  const VW = 620; const VH = 210;
  const ML = 24; const MR = 8; const MT = 24; const MB = 36;
  const CW = VW - ML - MR; const CH = VH - MT - MB;
  const slotW = CW / barData.length;
  const bW = Math.max(4, Math.min(16, slotW * 0.28));

  // 3 bar positions per slot
  const xPre  = (i: number) => ML + i * slotW + slotW * 0.22;
  const xFeit = (i: number) => ML + i * slotW + slotW * 0.50;
  const xSem  = (i: number) => ML + i * slotW + slotW * 0.78;
  const xMid  = (i: number) => ML + i * slotW + slotW * 0.50;
  const y0 = MT + CH;
  const yV = (v: number) => MT + CH - (v / maxVal) * CH;

  const showLabel = bW >= 8;
  const xLabels = barData.length <= 12
    ? barData.map((_, i) => i)
    : [0, Math.floor(barData.length / 3), Math.floor(2 * barData.length / 3), barData.length - 1];

  return (
    <div>
      {/* Filtro de modalidade */}
      {MOD_OPTS.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {MOD_OPTS.map((m) => (
            <button key={m.key} type="button" onClick={() => setModFilter(m.key)} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: '1.5px solid',
              borderColor: modFilter === m.key ? 'var(--accent)' : 'var(--line)',
              background: modFilter === m.key ? 'var(--accent)' : 'transparent',
              color: modFilter === m.key ? '#fff' : 'var(--text)',
              transition: 'all 0.15s',
            }}>{m.label}</button>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        {/* Baseline + gridlines */}
        <line x1={ML} x2={VW - MR} y1={y0} y2={y0} stroke="var(--line)" strokeWidth={1} />
        {Array.from({ length: maxVal }, (_, v) => v + 1).map((v) => (
          <g key={v}>
            <line x1={ML} x2={VW - MR} y1={yV(v)} y2={yV(v)} stroke="var(--line)" strokeWidth={0.4} />
            <text x={ML - 4} y={yV(v) + 4} textAnchor="end" fontSize={9} fill="var(--muted)">{v}</text>
          </g>
        ))}

        {/* Barras */}
        {barData.map((d, i) => {
          const bhPre   = (d.prescritos / maxVal) * CH;
          const bhFeit  = (d.feitos     / maxVal) * CH;
          const bhExtra = (d.extras     / maxVal) * CH;
          const bhSem   = (d.semReg     / maxVal) * CH;
          return (
            <g key={i}>
              <title>{d.startDate}: {d.prescritos} prescritos · {d.feitos} feitos · {d.semReg} sem registro{d.extras > 0 ? ` · ${d.extras} extra${d.extras > 1 ? 's' : ''}` : ''}</title>
              {/* Prescrito */}
              {d.prescritos > 0 && <rect x={xPre(i) - bW / 2} y={yV(d.prescritos)} width={bW} height={bhPre} rx={2} fill="#94a3b8" opacity={0.75} />}
              {showLabel && d.prescritos > 0 && (
                <text x={xPre(i)} y={yV(d.prescritos) - 4} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#64748b">{d.prescritos}</text>
              )}
              {/* Feito */}
              {d.feitos > 0 && <rect x={xFeit(i) - bW / 2} y={yV(d.feitos)} width={bW} height={bhFeit} rx={2} fill="#22c55e" />}
              {/* Extra empilhado no topo do "feito" */}
              {d.extras > 0 && <rect x={xFeit(i) - bW / 2} y={yV(d.feitos + d.extras)} width={bW} height={bhExtra} rx={2} fill="#06b6d4" />}
              {showLabel && (d.feitos + d.extras) > 0 && (
                <text x={xFeit(i)} y={yV(d.feitos + d.extras) - 4} textAnchor="middle" fontSize={8.5} fontWeight={700}
                  fill={d.extras > 0 ? '#06b6d4' : '#22c55e'}>
                  {d.feitos}{d.extras > 0 ? `+${d.extras}` : ''}
                </text>
              )}
              {/* Sem registro */}
              {d.semReg > 0 && <rect x={xSem(i) - bW / 2} y={yV(d.semReg)} width={bW} height={bhSem} rx={2} fill="#f59e0b" />}
              {showLabel && d.semReg > 0 && (
                <text x={xSem(i)} y={yV(d.semReg) - 4} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#d97706">{d.semReg}</text>
              )}
            </g>
          );
        })}

        {/* Labels eixo X */}
        {xLabels.map((i) => (
          <text key={i} x={xMid(i)} y={VH - 10} textAnchor="middle" fontSize={9} fill="var(--muted)">
            {barData[i]?.startDate.slice(5, 10).replace('-', '/')}
          </text>
        ))}
      </svg>

      {/* Legenda */}
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)', marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          ['#94a3b8', 'Prescritos'],
          ['#22c55e', 'Feitos'],
          ['#f59e0b', 'Sem registro'],
          ['#06b6d4', 'Extras (além do plano)'],
        ].map(([c, l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}






