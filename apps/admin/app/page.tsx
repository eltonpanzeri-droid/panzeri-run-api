'use client';

import { Activity, AlertTriangle, ArrowUp, Bell, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CreditCard, Eye, EyeOff, FileText, Flame, Gauge, LayoutDashboard, LogIn, Menu, Plus, RefreshCw, Save, Search, Ticket, Trash2, UserRound, Users, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

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

interface FunnelReport {
  totals: {
    totalStudents: number;
    neverStartedOrFinishedInterview: number;
    completedInterviewNoPayment: number;
    paid: number;
  };
  averages: {
    diasCadastroAteEntrevista: number | null;
    diasEntrevistaAtePagamento: number | null;
  };
  completedInterviewNoPaymentList: Array<{
    id: string;
    studentCode: string;
    name: string;
    email: string;
    interviewCompletedAt: string | null;
    diasDesdeAEntrevista: number | null;
  }>;
  neverStartedInterviewList: Array<{
    id: string;
    studentCode: string;
    name: string;
    email: string;
    createdAt: string;
    diasDesdeOCadastro: number;
  }>;
}

type AdminView = 'dashboard' | 'students' | 'prospects' | 'weeks' | 'coupons' | 'finance' | 'notifications';

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
      decisionSource: 'ai' | 'deterministic';
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
      satisfaction?: string | null;
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
      perceivedEffort?: number | null;
      satisfaction?: string | null;
      feedback?: string | null;
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
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [funnelReport, setFunnelReport] = useState<FunnelReport | null>(null);
  const [loadingFunnel, setLoadingFunnel] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);
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
  const [couponCode, setCouponCode] = useState('');
  const [couponName, setCouponName] = useState('');
  const [couponDiscount, setCouponDiscount] = useState('100');

  useEffect(() => {
    const savedToken = window.localStorage.getItem('panzeri_admin_token') ?? '';
    const savedRefreshToken = window.localStorage.getItem('panzeri_admin_refresh_token') ?? '';
    if (savedRefreshToken) {
      refreshAdminSession(savedRefreshToken).then((accessToken) => {
        if (accessToken) loadDashboard(accessToken);
      });
    } else if (savedToken) {
      setToken(savedToken);
      loadDashboard(savedToken);
    }
  }, []);

  async function refreshAdminSession(refreshToken: string) {
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

  async function loadFunnelReport() {
    if (!token) return;
    setLoadingFunnel(true);
    setStatus('Calculando levantamento do funil...');
    try {
      const response = await fetch(`${API_URL}/coach/funnel-report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setStatus('Nao consegui calcular o levantamento.');
        return;
      }
      const data = (await response.json()) as FunnelReport;
      setFunnelReport(data);
      setStatus('Levantamento atualizado.');
    } catch {
      setStatus('Nao consegui conectar com a API.');
    } finally {
      setLoadingFunnel(false);
    }
  }

  async function loadDashboard(accessToken = token, requestedPage = page, search = query) {
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

      if (!response.ok) {
        setStatus('Sessao expirada. Entre novamente.');
        window.localStorage.removeItem('panzeri_admin_token');
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
        setNotifications(notificationData.items.filter((item) => !item.id.startsWith('auto-')).slice(0, 8));
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
    try {
      const response = await fetch(`${API_URL}/coach/coupons`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) {
        const data = (await response.json()) as { coupons: CouponRow[] };
        setCoupons(data.coupons);
      }
    } catch {
      setStatus('Nao consegui carregar os cupons.');
    }
  }

  async function loadFinance(accessToken = token) {
    if (!accessToken) return;
    try {
      const response = await fetch(`${API_URL}/coach/finance`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) setFinance((await response.json()) as FinanceResponse);
    } catch {
      setStatus('Nao consegui carregar o financeiro.');
    }
  }

  async function loadProspects(accessToken = token) {
    if (!accessToken) return;
    try {
      const response = await fetch(`${API_URL}/coach/prospects`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) setProspects(await response.json());
    } catch {
      setStatus('Nao consegui carregar os prospectos.');
    }
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
    if (view === 'prospects') void loadProspects();
    if (view !== 'dashboard' && view !== 'coupons' && view !== 'finance' && view !== 'notifications' && view !== 'prospects' && !selectedStudentId && dashboard?.students[0]) {
      void loadStudent(dashboard.students[0].id);
    }
  }

  async function loadStudent(studentId: string, accessToken = token) {
    setSelectedStudentId(studentId);
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return;
      setStudentDetail((await response.json()) as StudentDetail);
    } catch {
      setStatus('Nao consegui carregar o aluno.');
    }
  }

  async function goToStudent(studentId: string) {
    await loadStudent(studentId);
    document.getElementById('student-detail-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
              <h1>{activeView === 'dashboard' ? 'Visao geral' : activeView === 'students' ? 'Alunos' : activeView === 'prospects' ? 'Prospectos' : activeView === 'weeks' ? 'Planejamento semanal' : activeView === 'coupons' ? 'Cupons' : activeView === 'notifications' ? 'Notificacoes' : 'Financeiro'}</h1>
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
            <button className={activeView === 'weeks' ? 'active' : ''} type="button" onClick={() => changeView('weeks')}><CalendarDays size={19} />Semanas</button>
            <button className={activeView === 'coupons' ? 'active' : ''} type="button" onClick={() => changeView('coupons')}><Ticket size={19} />Cupons</button>
            <button className={activeView === 'finance' ? 'active' : ''} type="button" onClick={() => changeView('finance')}><CreditCard size={19} />Financeiro</button>
            <button className={activeView === 'notifications' ? 'active' : ''} type="button" onClick={() => changeView('notifications')}><Bell size={19} />Notificacoes{notifications.length ? ` (${notifications.length})` : ''}</button>
          </nav>
        ) : null}

        {status ? <p className="statusText panelToast">{status}</p> : null}

        {activeView === 'dashboard' && notifications.length ? (
          <section className="notificationStrip">
            <button className="notificationHeading notificationToggle" type="button" onClick={() => setNotificationsOpen((open) => !open)}>
              <Bell size={18} /><strong>Atualizacoes dos alunos ({notifications.length})</strong>
              {notificationsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {notificationsOpen ? (
              <div className="notificationList">
                {notifications.slice(0, 5).map((notification) => (
                  <div className="coachNotification" key={notification.id}>
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                  </div>
                ))}
                <button className="secondaryButton" type="button" onClick={() => changeView('notifications')}>Ver todas as notificacoes</button>
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
            <div className="notificationList notificationListFull">
              {notifications.length ? notifications.map((notification) => (
                <div className={`coachNotification ${notification.read ? 'notificationRead' : ''}`} key={notification.id}>
                  <div>
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{dateTimeLabel(notification.createdAt)}</small>
                  </div>
                  {!notification.read ? (
                    <button className="secondaryButton" type="button" onClick={() => markNotificationRead(notification.id)}>Marcar como lida</button>
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
            <h3>Funil de conversao (cadastro - entrevista - pagamento)</h3>
            <p>Levantamento sob demanda direto do banco — nao recalcula sozinho, clique pra atualizar.</p>
            <button className="secondaryButton" type="button" disabled={loadingFunnel} onClick={loadFunnelReport}>
              {loadingFunnel ? 'Calculando...' : funnelReport ? 'Atualizar levantamento' : 'Carregar levantamento'}
            </button>
            {funnelReport ? (
              <>
                <div className="stats funnelStats">
                  <Stat label="Total de alunos" value={String(funnelReport.totals.totalStudents)} detail="cadastrados" />
                  <Stat label="Nunca completou a entrevista" value={String(funnelReport.totals.neverStartedOrFinishedInterview)} detail="cadastrou e parou" />
                  <Stat label="Completou entrevista, nao pagou" value={String(funnelReport.totals.completedInterviewNoPayment)} detail="maior intencao" />
                  <Stat label="Pagando" value={String(funnelReport.totals.paid)} detail="conversao real" />
                </div>
                <p className="formHintText">
                  Tempo medio cadastro ate entrevista: {funnelReport.averages.diasCadastroAteEntrevista ?? '-'} dias.{' '}
                  Tempo medio entrevista ate pagamento: {funnelReport.averages.diasEntrevistaAtePagamento ?? '-'} dias (aproximado).
                </p>
                {funnelReport.completedInterviewNoPaymentList.length ? (
                  <div className="funnelList">
                    <h4>Completou entrevista, nunca pagou ({funnelReport.completedInterviewNoPaymentList.length})</h4>
                    {funnelReport.completedInterviewNoPaymentList.map((item) => (
                      <div className="funnelListRow" key={item.id}>
                        <span><strong>{item.name}</strong> (Cod. {item.studentCode})</span>
                        <span>{item.email}</span>
                        <span>{item.diasDesdeAEntrevista != null ? `${item.diasDesdeAEntrevista} dias desde a entrevista` : '-'}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {funnelReport.neverStartedInterviewList.length ? (
                  <div className="funnelList">
                    <h4>Nunca completou a entrevista ({funnelReport.neverStartedInterviewList.length})</h4>
                    {funnelReport.neverStartedInterviewList.map((item) => (
                      <div className="funnelListRow" key={item.id}>
                        <span><strong>{item.name}</strong> (Cod. {item.studentCode})</span>
                        <span>{item.email}</span>
                        <span>{item.diasDesdeOCadastro} dias desde o cadastro</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
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
          <div className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Alunos</p>
                <h2>Lista operacional</h2>
              </div>
              <button className="secondaryButton" type="button" onClick={() => setStudentListCollapsed((collapsed) => !collapsed)}>
                {studentListCollapsed ? `Mostrar lista (${filteredStudents.length})` : 'Recolher lista'}
              </button>
            </div>
            <div className="studentFilters">
              <label>Treino
                <select value={trainingFilter} onChange={(event) => setTrainingFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  <option value="Sem treino">Sem treino criado</option>
                  <option value="Aguardando aluna gerar a semana">Aguardando aluna gerar a semana</option>
                  <option value="Falha ao gerar - verificar">Falha ao gerar - verificar</option>
                  <option value="Bloqueado (pagamento)">Bloqueado (pagamento)</option>
                  <option value="Aguardando primeiro treino">Aguardando primeiro treino</option>
                  <option value="Acesso liberado">Acesso liberado</option>
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
                    <small className={`status ${student.stravaConnected ? 'good' : 'warn'}`}>{student.stravaConnected ? 'Strava conectado' : 'Strava nao conectado'}</small>
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

          <div id="student-detail-anchor">
            {studentDetail ? (
              <button className="secondaryButton backToTopButton" type="button" onClick={scrollToTop}>
                <ArrowUp size={16} />
                Voltar ao topo
              </button>
            ) : null}
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
        </section> : null}

        {activeView === 'prospects' ? (
          <section className="workArea">
            <div className="panel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Nunca pagaram (nem cortesia)</p>
                  <h2>Prospectos</h2>
                </div>
              </div>
              <p className="formHintText">
                Gente que criou conta no app mas ainda nao virou aluna de verdade — sem pagamento nenhum, nem cortesia liberada.
                Nao consomem codigo de aluno nem aparecem na lista de Alunos. Ordenados do mais pra menos engajado.
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

  async function analyzeStrava() {
    if (!student) return;
    onStatus('Gerando relatorio do Strava...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/strava/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui gerar o relatorio do Strava.');
        return;
      }
      const data = (await response.json()) as { analyzed: boolean; reason: string };
      onStatus(data.reason);
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
      <div>
        <p className="eyebrow">Aluno selecionado</p>
        <h2>{student.name} <small className="studentCodeTag">Cod. {student.studentCode}</small></h2>
        <div>
          <span className={`status ${student.strava?.connected ? 'good' : 'warn'}`}>
            {student.strava?.connected ? 'Strava conectado' : 'Strava nao conectado'}
          </span>
          {student.strava?.connected && student.strava.lastActivityAt ? (
            <small> ultima atividade: {dateTimeLabel(student.strava.lastActivityAt)}</small>
          ) : null}
        </div>
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
      </div>

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

      <div className="detailGrid">
        <Detail icon={<UserRound size={18} />} label="Objetivo" value={student.goal} />
        <Detail icon={<Gauge size={18} />} label="Aderencia" value={`${student.plan?.summary.adherencePercent ?? 0}%`} />
        <Detail icon={<CheckCircle2 size={18} />} label="Feitos" value={`${student.plan?.summary.completedSessions ?? 0}/${student.plan?.summary.prescribedSessions ?? 0}`} />
        <Detail icon={<AlertTriangle size={18} />} label="Diferentes" value={String(student.plan?.summary.differentSessions ?? 0)} />
      </div>
      {student.plan?.methodology ? <p className="methodologySummary">{methodologySummaryLine(student.plan.methodology)}</p> : null}

      <section className="miniSection reportPanel">
        <div className="weekWorkspaceHeader">
          <div><p className="eyebrow">Supervisao tecnica</p><h3>Relatorios do agente</h3></div>
        </div>
        <div className="reportActions">
          <button type="button" onClick={() => generateReport('technical')}><FileText size={16} />Gerar prestacao tecnica</button>
          <button type="button" onClick={() => generateReport('evolution')}><Activity size={16} />Gerar relatorio de evolucao</button>
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
        ) : <p>Nenhum relatorio gerado ainda.</p>}
      </section>
      <section className="miniSection stravaAnalysisPanel">
        <div className="weekWorkspaceHeader">
          <div><p className="eyebrow">Agente II</p><h3>Analise automatica do Strava</h3></div>
          <span>{student.analysisAgent?.updatedAt ? dateTimeLabel(student.analysisAgent.updatedAt) : 'Aguardando atividade'}</span>
        </div>
        {student.analysisAgent ? (
          <>
            <p>{student.analysisAgent.summary.coachAnalysis?.text ?? 'Analise registrada.'}</p>
            <div className="detailGrid">
              <Detail icon={<CheckCircle2 size={18} />} label="Execucao" value={`${student.analysisAgent.summary.executionPercent ?? 0}%`} />
              <Detail icon={<Gauge size={18} />} label="Aderencia" value={`${student.analysisAgent.summary.adherencePercent ?? 0}%`} />
              <Detail icon={<Activity size={18} />} label="Km em 28 dias" value={String(student.analysisAgent.summary.progression?.last28Days?.distanceKm ?? 0)} />
              <Detail icon={<Activity size={18} />} label="Tendencia" value={trendLabel(student.analysisAgent.summary.progression?.loadTrend)} />
            </div>
            <p>Ultimos 28 dias: {student.analysisAgent.summary.progression?.last28Days?.sessions ?? 0} atividades, {student.analysisAgent.summary.progression?.last28Days?.durationMin ?? 0} min, maior corrida de {student.analysisAgent.summary.progression?.last28Days?.longestDistanceKm ?? 0} km.</p>
          </>
        ) : <p>O relatorio aparecera automaticamente quando uma nova atividade chegar pelo Strava.</p>}
      </section>

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

      <section className="miniSection">
        <h3>Reavaliacoes e evolucao</h3>
        {student.reassessments?.length ? (
          student.reassessments.map((reassessment, index) => (
            <div key={reassessment.completedAt ?? index} className="adminBlock">
              <strong>{reassessment.completedAt ? dateLabel(reassessment.completedAt) : 'Data nao registrada'}</strong>
              {reassessment.evolutionSummary ? <p>{reassessment.evolutionSummary}</p> : <p>Sem analise de evolucao gerada.</p>}
              {reassessment.evolutionWins?.length ? <p>Avancos: {reassessment.evolutionWins.join(' | ')}</p> : null}
              {reassessment.evolutionConcerns?.length ? <p>Pontos de atencao: {reassessment.evolutionConcerns.join(' | ')}</p> : null}
            </div>
          ))
        ) : (
          <p>Nenhuma reavaliacao concluida ainda.</p>
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
            {groupInterviewAnswers(student.interview.answers).map((group) => (
              <details key={group.title} open={group.title === 'Objetivo' || group.title === 'Rotina semanal'}>
                <summary>{group.title}</summary>
                {group.title === 'Rotina semanal' ? (
                  <>
                    <RoutineAvailabilityTable answers={student.interview!.answers} availability={student.availability ?? []} />
                    <ManualRoutineEditor studentId={student.id} token={token} availability={student.availability ?? []} onStatus={onStatus} onSaved={onRefresh} />
                  </>
                ) : (
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
                )}
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

      <section className="miniSection weekWorkspace">
        {student.needsUpdate ? (
          <div className="needsUpdateBanner">
            <strong>Este aluno precisa de atualizacao de treino.</strong>
            <span>{student.needsUpdateReason ?? 'Os dados usados na ultima geracao nao batem mais com o que esta salvo agora.'} Use "Refazer nova semana de treinos" abaixo quando quiser aplicar.</span>
          </div>
        ) : null}
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
            <button className="secondaryButton" type="button" onClick={analyzeStrava}><RefreshCw size={16} />Gerar relatorio do Strava agora</button>
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
                      <p className="historyExecution">{completionLabel(session.completionStatus)}{session.perceivedEffort ? ` | PSE ${session.perceivedEffort}/10` : ''}{session.satisfaction ? ` | Satisfacao: ${satisfactionLabel(session.satisfaction)}` : ''}{session.feedback ? ` | ${session.feedback}` : ''}</p>
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

  async function regenerateSession(allowToday?: boolean) {
    if (
      !allowToday &&
      !window.confirm(
        'Gerar novo treino so para este dia? Isso recalcula apenas esta sessao, aplicando diretivas ativas do aluno. Os outros dias da semana nao sao alterados. Nao e possivel gerar de novo para um dia que ja passou.',
      )
    ) {
      return;
    }
    onStatus('Gerando novo treino...');
    setIsRegenerating(true);
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}/sessions/${session.id}/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowToday: Boolean(allowToday) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data?.code === 'today_session_locked') {
          setIsRegenerating(false);
          if (window.confirm('Este e o treino de hoje — o aluno pode ja estar vendo ou ate ja ter comecado. Tem certeza que quer gerar um novo treino para hoje mesmo assim?')) {
            await regenerateSession(true);
          } else {
            onStatus('');
          }
          return;
        }
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
            <span>{session.satisfaction ? `Satisfacao com o treino: ${satisfactionLabel(session.satisfaction)}` : 'Satisfacao nao informada'}</span>
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

const MANUAL_SESSION_MODALITIES: Array<{ value: string; label: string }> = [
  { value: 'corrida', label: 'Corrida' },
  { value: 'esteira', label: 'Corrida na esteira' },
  { value: 'forca', label: 'Musculacao' },
  { value: 'fortalecimento_corredores', label: 'Fortalecimento para corredores' },
];

function AddSessionButton({
  studentId,
  token,
  scheduledDate,
  existingModalities,
  onStatus,
  onCreated,
}: {
  studentId: string;
  token: string;
  scheduledDate: string;
  existingModalities: Set<string>;
  onStatus: (message: string) => void;
  onCreated: (sessionId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const options = MANUAL_SESSION_MODALITIES.filter((option) => !existingModalities.has(option.value));

  async function createSession(modality: string) {
    setIsCreating(true);
    onStatus('Adicionando treino...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate, modality }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
        onStatus(detail ? `Nao foi possivel adicionar: ${detail}` : 'Nao foi possivel adicionar o treino.');
        return;
      }
      onStatus('Treino adicionado. Preencha ou peca pra IA gerar.');
      setPickerOpen(false);
      onCreated(data.id as string);
    } catch {
      onStatus('Nao consegui conectar com a API.');
    } finally {
      setIsCreating(false);
    }
  }

  if (!options.length) return null;

  if (!pickerOpen) {
    return (
      <button className="addSessionButton" type="button" onClick={() => setPickerOpen(true)}>
        <Plus size={14} /> Adicionar treino
      </button>
    );
  }

  return (
    <div className="addSessionPicker">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="secondaryButton"
          disabled={isCreating}
          onClick={() => createSession(option.value)}
        >
          {option.label}
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
        <div className="intensityInputs"><label>Pace inicial<input value={paceStart} onChange={(event) => updatePace('paceStart', event.target.value)} placeholder="05:13" /></label><label>Pace final<input value={paceEnd} onChange={(event) => updatePace('paceEnd', event.target.value)} placeholder="05:38" /></label></div>
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
  if (status === 'Acesso liberado') return 'good';
  if (status === 'Sem treino') return 'warn';
  if (status === 'Bloqueado (pagamento)') return 'danger';
  // Precisa de acao real do treinador (verificar chave da IA/logs e gerar manualmente pelo
  // painel) — diferente de "Aguardando aluna gerar a semana", que e so a aluna nao ter tocado o
  // botao ainda. Ver TrainingPlansService.generateWeek / lastPlanGenerationFailedAt.
  if (status === 'Falha ao gerar - verificar') return 'danger';
  // Neutro de proposito — nao e um alerta, e a aluna aguardando tocar o botao de gerar a semana.
  if (status === 'Aguardando aluna gerar a semana') return '';
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
    const overdue = due.getTime() < Date.now();
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

function methodologySummaryLine(methodology: {
  decisionSource: 'ai' | 'deterministic';
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

function trendLabel(value?: string) {
  const labels: Record<string, string> = {
    aumentando: 'Carga aumentando',
    reduzindo: 'Carga reduzindo',
    estavel: 'Carga estavel',
    sem_base_anterior: 'Construindo historico',
  };
  return labels[value ?? ''] ?? 'Sem dados';
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
  const rows: Array<{ label: string; modalityKey: string; availableSuffix: string }> = [
    { label: 'Corrida', modalityKey: 'corrida', availableSuffix: 'run_available_time' },
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
              const minutes = day && !day.noTraining ? day.modalityDurations?.[row.modalityKey] : undefined;
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

function groupInterviewAnswers(answers: Record<string, unknown>) {
  const groups = new Map<string, Array<[string, unknown]>>();
  Object.entries(answers).filter(([key]) => key !== 'rating_intro').forEach(([key, value]) => {
    const title = interviewGroup(key);
    groups.set(title, [...(groups.get(title) ?? []), [key, value]]);
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

function interviewValue(key: string, value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Nenhum';
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









