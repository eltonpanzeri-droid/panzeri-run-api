'use client';

import { Activity, AlertTriangle, Bell, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CreditCard, Eye, EyeOff, FileText, Gauge, LayoutDashboard, LogIn, Menu, RefreshCw, Save, Search, Ticket, Trash2, UserRound, Users, X } from 'lucide-react';
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
  };
  students: StudentRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

type AdminView = 'dashboard' | 'students' | 'weeks' | 'coupons' | 'finance' | 'notifications';

interface StudentRow {
  id: string;
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
}

interface StudentDetail {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  accountStatus: string;
  subscriptionStatus: string;
  subscriptionUpdatedAt?: string | null;
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  goal: string;
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
  reassessments?: Array<{
    completedAt: string | null;
    answers: Record<string, unknown>;
    evolutionSummary?: string | null;
    evolutionWins?: string[];
    evolutionConcerns?: string[];
  }>;
  plan: {
    name: string;
    recommendation?: string | null;
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
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentDetail, setStudentDetail] = useState<StudentDetail | null>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatus] = useState('');
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
    if (view !== 'dashboard' && view !== 'coupons' && view !== 'finance' && view !== 'notifications' && !selectedStudentId && dashboard?.students[0]) {
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
        </section>
      </main>
    );
  }

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
              <h1>{activeView === 'dashboard' ? 'Visao geral' : activeView === 'students' ? 'Alunos' : activeView === 'weeks' ? 'Planejamento semanal' : activeView === 'coupons' ? 'Cupons' : activeView === 'notifications' ? 'Notificacoes' : 'Financeiro'}</h1>
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
          <Stat label="Alunos" value={String(dashboard?.totals.students ?? 0)} detail={`${dashboard?.totals.activePlans ?? 0} com plano ativo`} />
          <Stat label="Treinos propostos" value={String(dashboard?.totals.prescribedSessions ?? 0)} detail="semana atual" />
          <Stat label="Treinos feitos" value={String(dashboard?.totals.completedSessions ?? 0)} detail={`${dashboard?.totals.differentSessions ?? 0} diferentes`} />
          <Stat label="Aderencia media" value={`${dashboard?.totals.adherencePercent ?? 0}%`} detail="treinos propostos" />
        </section> : null}

        {activeView === 'students' ? <section className="workArea">
          <div className="panel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Alunos</p>
                <h2>Lista operacional</h2>
              </div>
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
              {dashboard?.students.map((student) => (
                <div className={`row rowButton ${selectedStudentId === student.id ? 'selected' : ''}`} key={student.id} onClick={() => loadStudent(student.id)}>
                  <span>
                    <strong>{student.name}</strong>
                    <small>{student.email}</small>
                  </span>
                  <span>{student.goal}</span>
                  <span>{student.adherencePercent}%</span>
                  <span>{student.lastThreeKm}</span>
                  <span className={`status ${statusClass(student.status)}`}>{student.status}</span>
                  <select
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
                  <select
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
            <Pagination pagination={dashboard?.pagination} onPageChange={setPage} />
          </div>

          <StudentPanel
            student={studentDetail}
            token={token}
            onStatus={setStatus}
            onRefresh={() => {
              loadDashboard();
            }}
          />
        </section> : null}

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
            <StudentPanel student={studentDetail} token={token} onStatus={setStatus} onRefresh={() => loadDashboard()} />
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
  const [mergeSourceEmail, setMergeSourceEmail] = useState('');
  const [messageText, setMessageText] = useState('');
  const [messageByEmail, setMessageByEmail] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    setEditName(student?.name ?? '');
    setEditEmail(student?.email ?? '');
    setEditStatus(student?.accountStatus ?? 'active');
    setSubscriptionStatus(student?.subscriptionStatus ?? 'pending');
    setNewPassword('');
    setInviteText('');
    setExpandedHistoryId('');
    setMessageText('');
  }, [student?.id, student?.name, student?.email, student?.accountStatus, student?.subscriptionStatus]);

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
    if (!window.confirm('Gerar uma nova semana de treinos para este aluno? Isso substitui os treinos ainda nao realizados desta semana.')) {
      return;
    }
    onStatus('Gerando nova semana de treinos...');
    try {
      const response = await fetch(`${API_URL}/coach/students/${student.id}/plan/regenerate-week`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui gerar uma nova semana.');
        return;
      }
      await onRefresh();
      onStatus('Nova semana de treinos gerada.');
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
        <h2>{student.name}</h2>
        <small>{student.email}</small>
        {student.phone ? <small>{student.phone}</small> : null}
      </div>

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
      </section>

      <section className="miniSection adminForm">
        <h3>Enviar mensagem para o aluno</h3>
        <textarea
          value={messageText}
          onChange={(event) => setMessageText(event.target.value)}
          placeholder="Escreva a mensagem para o aluno"
          rows={4}
        />
        <label className="adminFieldLabel checkboxLabel">
          <input type="checkbox" checked={messageByEmail} onChange={(event) => setMessageByEmail(event.target.checked)} />
          Enviar por e-mail
        </label>
        <button type="button" disabled={sendingMessage} onClick={sendMessageToStudent}>
          {sendingMessage ? 'Enviando...' : 'Enviar mensagem'}
        </button>
      </section>

      <div className="detailGrid">
        <Detail icon={<UserRound size={18} />} label="Objetivo" value={student.goal} />
        <Detail icon={<Gauge size={18} />} label="Aderencia" value={`${student.plan?.summary.adherencePercent ?? 0}%`} />
        <Detail icon={<CheckCircle2 size={18} />} label="Feitos" value={`${student.plan?.summary.completedSessions ?? 0}/${student.plan?.summary.prescribedSessions ?? 0}`} />
        <Detail icon={<AlertTriangle size={18} />} label="Diferentes" value={String(student.plan?.summary.differentSessions ?? 0)} />
      </div>

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
      <section className="miniSection">
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

      <div className="studentInfoGrid">
      <section className="miniSection">
        <h3>Dados e saude</h3>
        <p>Nascimento: {student.birthDate ? dateLabel(student.birthDate) : 'Nao informado'}</p>
        <p>Altura: {student.heightCm ? `${student.heightCm} cm` : 'Nao informado'}</p>
        <p>Peso: {student.weightKg ? `${student.weightKg} kg` : 'Nao informado'}</p>
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
        <h3>Disponibilidade semanal</h3>
        {student.availability?.length ? student.availability.map((day) => (
          <p key={day.weekday}>
            {weekdayLabel(day.weekday)}: {day.noTraining ? 'Sem treino' : availabilityLabel(day)}
          </p>
        )) : <p>Nao informada.</p>}
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
                {group.items.map(([key, value]) => <p key={key}><strong>{interviewLabel(key)}:</strong> {interviewValue(value)}</p>)}
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
        <div className="weekWorkspaceHeader">
          <div>
            <p className="eyebrow">Planejamento e execucao</p>
            <h3>Semana atual</h3>
          </div>
          <div className="weekWorkspaceActions">
            <span>{student.plan?.name ?? 'Sem plano ativo'}</span>
            <button className="secondaryButton" type="button" onClick={regenerateWeek}><RefreshCw size={16} />Refazer nova semana de treinos</button>
          </div>
        </div>
        {student.plan?.sessions.length ? (
          <div className="coachWeekBoard">
            {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
              const sessions = student.plan!.sessions.filter((session) => session.weekday === weekday);
              return (
                <div className="coachDay" key={weekday}>
                  <div className="coachDayHeader">
                    <strong>{weekdayLabel(weekday)}</strong>
                    <span>{sessions[0] ? dateLabel(sessions[0].date) : ''}</span>
                  </div>
                  {sessions.length ? sessions.map((session) => (
                    <EditableSession
                      key={session.id}
                      session={session}
                      studentId={student.id}
                      token={token}
                      testPaceSeconds={parsePaceSeconds(student.tests[0]?.pace)}
                      onStatus={onStatus}
                      onSaved={onRefresh}
                    />
                  )) : <p className="restDay">Sem treino</p>}
                </div>
              );
            })}
          </div>
        ) : <p>Sem plano ativo.</p>}
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
}: {
  session: NonNullable<StudentDetail['plan']>['sessions'][number];
  studentId: string;
  token: string;
  testPaceSeconds: number | null;
  onStatus: (message: string) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(session.title);
  const [modality, setModality] = useState(session.modality);
  const [durationMin, setDurationMin] = useState(String(session.durationMin ?? ''));
  const [distanceKm, setDistanceKm] = useState(String(session.distanceKm ?? ''));
  const [zone, setZone] = useState(session.zone ?? '');
  const [notes, setNotes] = useState(session.notes ?? '');
  const [isEditing, setIsEditing] = useState(false);
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
    if (!window.confirm('Gerar um novo treino para este dia? Isso substitui o treino atual (edicoes manuais serao perdidas).')) {
      return;
    }
    onStatus('Gerando novo treino...');
    setIsRegenerating(true);
    try {
      const response = await fetch(`${API_URL}/coach/students/${studentId}/sessions/${session.id}/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        onStatus('Nao consegui gerar um novo treino.');
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

  function changeModality(nextModality: string) {
    setModality(nextModality);
    const nextIsStrength = isStrengthModality(nextModality);
    const currentIsStrength = structure.type === 'strength';
    if (nextIsStrength !== currentIsStrength) {
      setStructure(nextIsStrength
        ? { type: 'strength', category: nextModality === 'fortalecimento_corredores' ? 'Fortalecimento para corredores' : 'Musculacao', exercises: [] }
        : { type: nextModality === 'bike' ? 'aerobic' : 'run', blocks: [] });
    }
  }

  return (
    <div className="sessionEditor">
      <div className="sessionEditorHeader">
        <span className={`executionStatus execution-${session.stravaActivity ? 'done' : session.completionStatus}`}>
          {session.stravaActivity ? 'Strava recebido' : completionLabel(session.completionStatus)}
        </span>
        <button className="editSessionButton" type="button" onClick={() => setIsEditing((current) => !current)}>
          {isEditing ? 'Cancelar' : 'Editar'}
        </button>
      </div>
      <div className="sessionOverview">
        <strong>{session.title}</strong>
        <span>{modalityLabel(session.modality)} | {session.durationMin ?? 0} min {session.distanceKm ? `| ${session.distanceKm} km` : ''} {session.zone ? `| ${session.zone}` : ''}</span>
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
              <button className="closeEditButton" type="button" onClick={() => setIsEditing(false)}>Fechar</button>
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
                    <option value="bike">Bike ou aerobico</option>
                  </select>
                </label>
                <label>Duracao total<input value={durationMin} onChange={(event) => setDurationMin(event.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
                {!isStrengthModality(modality) ? <label>Distancia total<input value={distanceKm} onChange={(event) => setDistanceKm(event.target.value)} inputMode="decimal" /></label> : null}
                {!isStrengthModality(modality) ? <label>Zona principal<input value={zone} onChange={(event) => setZone(event.target.value)} /></label> : null}
              </div>
              <StructureEditor structure={structure} testPaceSeconds={testPaceSeconds} onChange={setStructure} />
              <label>Orientacoes gerais<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
              {saveMessage ? <p className={`modalSaveMessage ${saveMessage.includes('sucesso') ? 'saveSuccess' : ''}`}>{saveMessage}</p> : null}
              <button className="saveEditButton" type="button" disabled={isSaving} onClick={saveSession}><Save size={16} /> {isSaving ? 'Salvando...' : 'Salvar treino completo'}</button>
              <button className="secondaryButton" type="button" disabled={isRegenerating} onClick={regenerateSession}><RefreshCw size={16} /> {isRegenerating ? 'Gerando...' : 'Gerar novo treino'}</button>
            </div>
          </div>
        </div>
      ) : null}
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

  useEffect(() => {
    if (type !== 'strength') return;
    const token = window.localStorage.getItem('panzeri_admin_token') ?? '';
    fetch(`${API_URL}/coach/exercise-library`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { fortalecimentoCorredores: ExerciseLibraryItem[]; musculacao: ExerciseLibraryItem[] } | null) => {
        if (!data) return;
        setExerciseOptions(category === 'Musculacao' ? data.musculacao : data.fortalecimentoCorredores);
      })
      .catch(() => setExerciseOptions([]));
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

  return (
    <section className="structureEditor">
      <div className="structureEditorTitle"><div><h3>Etapas do treino</h3><span>Aquecimento, parte principal e desaquecimento</span></div>{typeControl}</div>
      {blocks.map((block, index) => (
        <RunStepEditor
          key={index}
          block={block}
          testPaceSeconds={testPaceSeconds}
          onChange={(nextBlock) => onChange({ ...structure, blocks: blocks.map((item, blockIndex) => blockIndex === index ? nextBlock : item) })}
          onRemove={() => onChange({ ...structure, blocks: blocks.filter((_, blockIndex) => blockIndex !== index) })}
        />
      ))}
      <button className="addStructureButton" type="button" onClick={() => onChange({ ...structure, blocks: [...blocks, { label: 'Principal', durationType: 'time', durationMin: 10, intensityMode: 'pace', zone: 'Z2', paceRange: '', speedRange: '' }] })}>Adicionar etapa</button>
    </section>
  );
}

function RunStepEditor({
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

  return (
    <div className="structuredStep">
      <div className="stepTopGrid">
        <label>Etapa
          <select value={currentLabel} onChange={(event) => onChange({ ...block, label: event.target.value })}>
            {!stageOptions.includes(currentLabel) ? <option value={currentLabel}>{currentLabel}</option> : null}
            {stageOptions.map((option) => <option value={option} key={option}>{option}</option>)}
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
      <label>Instrucao da etapa<input value={String(block.guidance ?? '')} onChange={(event) => onChange({ ...block, guidance: event.target.value })} placeholder="Orientacao que aparecera para o aluno" /></label>
      <button className="removeStructureButton" type="button" onClick={onRemove}>Remover etapa</button>
    </div>
  );
}

function AdminPrescription({ structure, notes }: { structure?: Record<string, unknown> | null; notes?: string | null }) {
  if (!structure) return notes ? <p className="coachNotes">{notes}</p> : null;
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
                {steps.map((step, index) => (
                  <span key={`${String(step.label)}-${index}`}>
                    - {String(step.label)} por {String(step.distanceValue)}{String(step.distanceUnit ?? 'km')}
                    {step.paceRange ? ` - Pace (${String(step.paceRange)})` : ''}
                    {step.speedRange ? ` | Velocidade (${String(step.speedRange).replaceAll('.', ',')})` : ''}
                    {step.durationRange ? ` - completar entre ${String(step.durationRange)}` : ''}
                  </span>
                ))}
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
  if (status === 'Sem plano') return 'warn';
  if (status === 'Bloqueado (pagamento)') return 'danger';
  return '';
}

function paymentStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    manual_active: 'Cortesia',
    active: 'Pago',
    grace: 'Tolerancia',
    overdue: 'Atrasado',
    canceled: 'Cancelado',
  };
  return labels[status ?? ''] ?? 'Pendente';
}

function paymentStatusClass(status?: string) {
  if (status === 'active' || status === 'manual_active') return 'good';
  if (status === 'pending' || status === 'grace') return 'warn';
  if (status === 'overdue' || status === 'canceled') return 'danger';
  return '';
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

function groupInterviewAnswers(answers: Record<string, unknown>) {
  const groups = new Map<string, Array<[string, unknown]>>();
  Object.entries(answers).forEach(([key, value]) => {
    const title = interviewGroup(key);
    groups.set(title, [...(groups.get(title) ?? []), [key, value]]);
  });
  return Array.from(groups, ([title, items]) => ({ title, items }));
}

function interviewGroup(key: string) {
  if (key === 'objective') return 'Objetivo';
  if (key.startsWith('rating_')) return 'Autoavaliacao';
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)_/.test(key)) return 'Rotina semanal';
  if (key.startsWith('assessment_') || key.includes('circumference') || ['muscle_mass', 'lean_mass', 'fat_mass', 'visceral_fat', 'basal_metabolism', 'body_fat_percentage', 'recent_physical_assessment'].includes(key)) return 'Avaliacao fisica recente';
  if (key.startsWith('personal_')) return 'Dados pessoais';
  if (['current_pain', 'pain_region', 'important_injury', 'injury_description', 'health_conditions', 'continuous_medications', 'medical_recommendation'].includes(key)) return 'Saude';
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
    current_pain: 'Dor atual', pain_region: 'Regiao da dor', important_injury: 'Lesao importante', injury_description: 'Descricao da lesao', health_conditions: 'Condicoes de saude',
    continuous_medications: 'Medicamentos continuos', medical_recommendation: 'Recomendacao medica', recent_physical_assessment: 'Avaliacao nos ultimos 6 meses', assessment_method: 'Metodo da avaliacao',
    sleep_hours: 'Horas de sono', smoking: 'Tabagismo', alcohol_frequency: 'Consumo de alcool', work_routine: 'Rotina de trabalho', daily_steps: 'Passos diarios',
    personal_name: 'Nome completo', personal_phone: 'WhatsApp', personal_birth_date: 'Data de nascimento', personal_sex: 'Sexo', personal_height: 'Altura', personal_weight: 'Peso',
  };
  if (labels[key]) return labels[key];
  const days: Record<string, string> = { monday: 'Segunda-feira', tuesday: 'Terca-feira', wednesday: 'Quarta-feira', thursday: 'Quinta-feira', friday: 'Sexta-feira', saturday: 'Sabado', sunday: 'Domingo' };
  const day = Object.keys(days).find((item) => key.startsWith(`${item}_`));
  if (day) {
    const fields: Record<string, string> = { run_time: 'tempo para corrida', run_location: 'local da corrida', strength_time: 'tempo para fortalecimento', available_time: 'horario disponivel' };
    const suffix = key.slice(day.length + 1);
    return `${days[day]} - ${fields[suffix] ?? suffix}`;
  }
  return key.replace(/^rating_/, 'Nota - ').replace(/_/g, ' ');
}

function interviewValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Nenhum';
  if (value === true) return 'Sim';
  if (value === false) return 'Nao';
  if (value === 'unknown') return 'Nao sei';
  return String(value ?? 'Nao informado');
}
function listLabel(items: string[]) {
  return items.length ? items.join(', ') : 'Nao informado';
}

function weekdayLabel(weekday: number) {
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][weekday] ?? String(weekday);
}

function availabilityLabel(day: NonNullable<StudentDetail['availability']>[number]) {
  return day.modalities.map((modality) => {
    const duration = day.modalityDurations?.[modality] ?? day.availableMin;
    return `${modality}${duration ? ` (${duration} min)` : ''}`;
  }).join(', ');
}

async function copyText(text: string) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}









