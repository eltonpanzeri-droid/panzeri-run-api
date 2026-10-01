'use client';
import * as React from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, BarChart3, CalendarDays, Check, Clock3, Layers3, Plus, RefreshCw, Search, X } from 'lucide-react';
import { LongitudinalChart, type Comparison } from './longitudinal-chart';
import { API_URL, COLORS, ChartConfig, ContextEvent, CustomPeriod, DEFAULT_LAYERS, DOMAINS, EVENT_TYPES, Layers, MODALITIES, PERIODS, SOURCES, Series, Snapshot, Student, Variable, compatibleAxes, selectableOverlayAxes, clampWindow, customPeriodRange, dateKey, dateLabel, defaultChartConfig, eventOverlaps, fmt, matchingStudents, observationsAt, seriesKey, seriesName, snapshotIsValid, time, windowFor } from './data';
import './studio.css';

type Tab = 'Visão geral' | 'Explorar' | 'Comparar' | 'Timeline' | 'Histórico';
type Theme = 'light' | 'dark' | 'softblue' | 'graphite' | 'system';
const TABS: Tab[] = ['Visão geral', 'Explorar', 'Comparar', 'Timeline', 'Histórico'];
const ICONS = [BarChart3, Search, Layers3, Clock3, CalendarDays];
const LAYER_LABELS: Array<[keyof Layers, string]> = [['raw', 'Bruto'], ['mm21', 'MM21'], ['mm60', 'MM60'], ['mm200', 'MM200'], ['baseline', 'Baseline'], ['habitual', 'Faixa habitual'], ['trend', 'Tendência'], ['events', 'Eventos']];
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Não foi possível carregar os dados.';
const EMPTY_SNAPSHOTS: Record<string, Snapshot> = {};
const MAX_SERIES = 10;
const VOLUME_COMPLETED = 'training.volumeCompletedTotalKm';
const VOLUME_PRESCRIBED = 'training.volumePrescribedKm';

export default function TrainingIntelligenceStudio({ accessToken, initialStudentId = '', onStudentChange }: { accessToken?: string; initialStudentId?: string; onStudentChange?: (id: string) => void } = {}) {
  const embedded = Boolean(accessToken);
  const [localToken, setLocalToken] = React.useState<string | null>(null);
  const token = accessToken ?? localToken;
  const [theme, setTheme] = React.useState<Theme>('system');
  const [tab, setTab] = React.useState<Tab>('Visão geral');
  const [students, setStudents] = React.useState<Student[]>([]);
  const [legend, setLegend] = React.useState<Variable[]>([]);
  const [studentId, setStudentId] = React.useState('');
  const [studentQuery, setStudentQuery] = React.useState('');
  const [period, setPeriod] = React.useState('183');
  const [customRange, setCustomRange] = React.useState<[number, number] | null>(null);
  const [series, setSeries] = React.useState<Series[]>([]);
  const [store, setStore] = React.useState<{ owner: string; entries: Record<string, Snapshot> }>({ owner: '', entries: {} });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [eventError, setEventError] = React.useState('');
  const [eventLoading, setEventLoading] = React.useState(false);
  const [events, setEvents] = React.useState<{ owner: string; rows: ContextEvent[] }>({ owner: '', rows: [] });
  const [layers, setLayers] = React.useState<Layers>(DEFAULT_LAYERS);
  const [chartConfigs, setChartConfigs] = React.useState<Record<string, ChartConfig>>({});
  const [cursor, setCursor] = React.useState('');
  const [drawer, setDrawer] = React.useState<ContextEvent | null>(null);
  const [picker, setPicker] = React.useState<'indicator' | 'event' | 'period' | null>(null);
  const [search, setSearch] = React.useState('');
  const [domain, setDomain] = React.useState('all');
  const [eventTypes, setEventTypes] = React.useState<string[] | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [overlay, setOverlay] = React.useState(false);
  const [focusData, setFocusData] = React.useState(true);
  const [zoom, setZoom] = React.useState<[number, number] | null>(null);
  const cache = React.useRef(new Map<string, Snapshot>());
  const snapshots = store.owner === studentId ? store.entries : EMPTY_SNAPSHOTS;
  const studentEvents = events.owner === studentId ? events.rows : [];
  const studentMatches = matchingStudents(students, studentQuery);
  const studentSelectValue = studentMatches.some((candidate) => candidate.id === studentId) ? studentId : '';

  React.useEffect(() => {
    if (!accessToken) setLocalToken(window.localStorage.getItem('panzeri_admin_token') ?? '');
    const stored = window.localStorage.getItem('panzeri_ti_theme');
    if (stored === 'light' || stored === 'dark' || stored === 'softblue' || stored === 'graphite' || stored === 'system') setTheme(stored);
  }, [accessToken]);

  React.useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const responses = await Promise.all(['variable-legend', 'students-list'].map((path) => fetch(`${API_URL}/coach/data/training-intelligence/${path}`, { headers, signal: controller.signal })));
        const failed = responses.findIndex((r) => !r.ok);
        if (failed !== -1) {
          const status = responses[failed].status;
          const resource = failed === 0 ? 'indicadores' : 'alunos';
          throw new Error(status === 401
            ? 'Sessão não aceita pela API (401). Entre novamente no Admin e abra Training Intelligence.'
            : `Não foi possível carregar ${resource} (HTTP ${status}). ${status === 403 ? 'A API recusou a permissão de acesso.' : 'Tente Atualizar dados.'}`);
        }
        const [variables, people] = await Promise.all(responses.map((r) => r.json())) as [Variable[], Student[]];
        if (!Array.isArray(variables) || !Array.isArray(people)) throw new Error('Formato inesperado na lista de alunos ou indicadores.');
        if (controller.signal.aborted) return;
        setLegend(variables); setStudents(people);
        setError('');
        setStudentId((current) => current || (people.some((person) => person.id === initialStudentId) ? initialStudentId : people[0]?.id) || '');
        const initial = ['training.volumeCompletedTotalKm', 'workout.preSleepQuality'].filter((id) => variables.some((v) => v.id === id));
        setSeries((current) => current.length ? current : initial.map((id) => ({ key: seriesKey(id), variableId: id, modality: '', visible: true })));
      } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    })();
    return () => controller.abort();
  }, [token, refresh, initialStudentId]);

  // Companion volume series use the same canonical observation endpoint and cache.
  // They are fetched for chart layers without becoming additional main panels.
  const requestKey = [...new Set(series.flatMap((s) => {
    const companion = s.variableId === VOLUME_COMPLETED ? VOLUME_PRESCRIBED : s.variableId === VOLUME_PRESCRIBED ? VOLUME_COMPLETED : null;
    const primary = legend.find((v) => v.id === s.variableId);
    const chosen = (chartConfigs[s.key]?.overlayIds ?? []).filter((id) => primary && legend.some((v) => v.id === id && selectableOverlayAxes(primary, v)));
    return [s.key, ...(companion && legend.some((v) => v.id === companion) ? [seriesKey(companion, s.modality)] : []), ...chosen.map((id) => seriesKey(id, s.modality))];
  }))].join('|');
  React.useEffect(() => {
    if (!token || !studentId) return;
    const controller = new AbortController();
    const requested = requestKey ? requestKey.split('|') : [];
    setLoading(requested.length > 0); setError('');
    (async () => {
      const entries: Record<string, Snapshot> = {};
      const errors: string[] = [];
      await Promise.all(requested.map(async (key) => {
        const cacheKey = `${studentId}/${key}`;
        const known = cache.current.get(cacheKey);
        if (known) { entries[key] = known; return; }
        const [variableId, modality] = key.split('::');
        try {
          const query = modality ? `?modalities=${encodeURIComponent(modality)}` : '';
          const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/observations/${encodeURIComponent(variableId)}${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 401 ? 'Sessão expirada. Entre novamente no Admin.' : `${variableId}: falha de carregamento (${response.status}).`);
          const payload: unknown = await response.json();
          if (!snapshotIsValid(payload, variableId)) throw new Error(`${variableId}: resposta incompatível com o contrato de observações.`);
          if (!controller.signal.aborted) { entries[key] = payload; cache.current.set(cacheKey, payload); }
        } catch (cause) { if (!controller.signal.aborted) errors.push(errorMessage(cause)); }
      }));
      if (!controller.signal.aborted) { setStore({ owner: studentId, entries }); setError(errors.join(' ')); setLoading(false); }
    })();
    return () => controller.abort();
  }, [token, studentId, requestKey, refresh]);

  React.useEffect(() => {
    if (!token || !studentId) return;
    const controller = new AbortController();
    setEventLoading(true); setEventError('');
    (async () => {
      try {
        const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/context-events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Eventos indisponíveis (${response.status}).`);
        const rows = await response.json() as ContextEvent[];
        if (!Array.isArray(rows)) throw new Error('Formato inesperado na resposta de eventos.');
        if (!controller.signal.aborted) setEvents({ owner: studentId, rows });
      } catch (cause) { if (!controller.signal.aborted) { setEvents({ owner: studentId, rows: [] }); setEventError(errorMessage(cause)); } }
      finally { if (!controller.signal.aborted) setEventLoading(false); }
    })();
    return () => controller.abort();
  }, [token, studentId, refresh]);

  const student = students.find((s) => s.id === studentId);
  const periodDefinition = PERIODS.find((p) => p.id === period);
  const loaded = series.filter((s) => snapshots[s.key]);
  const fullRange = React.useMemo(() => period === 'custom' && customRange ? customRange : windowFor(periodDefinition?.days ?? 183, Object.values(snapshots), events.owner === studentId ? events.rows : []), [period, customRange, periodDefinition?.days, snapshots, events, studentId]);
  const observedDates = loaded.filter((s) => s.visible).flatMap((s) => snapshots[s.key].observations.map((o) => time(o.timestamp))).filter((at) => at >= fullRange[0] && at <= fullRange[1]);
  const focusedRange: [number, number] = focusData && observedDates.length ? [Math.max(fullRange[0], Math.min(...observedDates)-86400000), Math.min(fullRange[1], Math.max(...observedDates)+86400000)] : fullRange;
  const range = clampWindow(focusedRange, zoom);
  const displayed = series.filter((s) => s.visible && snapshots[s.key]);
  const groups = displayed.filter((s,i) => !overlay || !displayed.slice(0,i).some((earlier) => compatibleAxes(snapshots[earlier.key].variable, snapshots[s.key].variable)));
  const filteredEvents = studentEvents.filter((e) => eventOverlaps(e, range) && (eventTypes === null || eventTypes.includes(e.type))).sort((a, b) => (b.startedAt ?? b.reportedAt).localeCompare(a.startedAt ?? a.reportedAt));
  const onCursor = React.useCallback((day: string) => setCursor((current) => current === day ? current : day), []);
  function switchStudent(id: string) { setStudentId(id); onStudentChange?.(id); setCursor(''); setDrawer(null); setZoom(null); }
  function searchStudents(query: string) {
    setStudentQuery(query);
    const matches = matchingStudents(students, query);
    if (query.trim() && matches.length === 1 && matches[0].id !== studentId) switchStudent(matches[0].id);
  }
  function addIndicator(id: string, modality = '') {
    const key = seriesKey(id, modality);
    setSeries((current) => current.some((s) => s.key === key) || current.length >= MAX_SERIES ? current : [...current, { key, variableId: id, modality, visible: true }]);
  }
  function changeModality(key: string, modality: string, compare = false) {
    const existing = series.find((s) => s.key === key);
    if (!existing) return;
    if (compare) { addIndicator(existing.variableId, modality); return; }
    const nextKey = seriesKey(existing.variableId, modality);
    if (series.some((s) => s.key === nextKey && s.key !== key)) return;
    setSeries((current) => current.some((s) => s.key === nextKey && s.key !== key) ? current : current.map((s) => s.key === key ? { ...s, modality, key: nextKey } : s));
    setChartConfigs((current) => { if (!current[key]) return current; const next = { ...current, [nextKey]: current[key] }; delete next[key]; return next; });
  }
  function changeTheme(next: Theme) { setTheme(next); window.localStorage.setItem('panzeri_ti_theme', next); }
  function toggleLayer(key: keyof Layers) {
    const next = !layers[key];
    setLayers((current) => ({ ...current, [key]: next }));
    setChartConfigs((current) => Object.fromEntries(Object.entries(current).map(([id, config]) => [id, { ...config, layers: { ...config.layers, [key]: next } }])));
  }
  function enableEventLayer() {
    setLayers((current) => ({ ...current, events: true }));
    setChartConfigs((current) => Object.fromEntries(Object.entries(current).map(([id, config]) => [id, { ...config, layers: { ...config.layers, events: true } }])));
  }
  function chartConfigFor(s: Series) { return chartConfigs[s.key] ?? { ...defaultChartConfig(snapshots[s.key].variable), layers }; }
  function updateChartConfig(key: string, next: ChartConfig) { setChartConfigs((current) => ({ ...current, [key]: next })); }
  function overlayCandidatesFor(s: Series) {
    const primary = snapshots[s.key].variable;
    const companion = s.variableId === VOLUME_COMPLETED ? VOLUME_PRESCRIBED : s.variableId === VOLUME_PRESCRIBED ? VOLUME_COMPLETED : null;
    return legend.filter((variable) => variable.id !== primary.id && variable.id !== companion && selectableOverlayAxes(primary, variable));
  }
  function comparisonsFor(s: Series): Comparison[] {
    const primary = snapshots[s.key].variable;
    const result: Comparison[] = [];
    const seen = new Set<string>();
    const add = (key: string, title: string, color: string, layer?: Comparison['layer']) => {
      const snapshot = snapshots[key];
      if (!snapshot || seen.has(key)) return;
      seen.add(key);
      result.push({ snapshot, title, color, layer });
    };
    if (overlay) for (const other of displayed) {
      if (other.key === s.key || !compatibleAxes(primary, snapshots[other.key].variable)) continue;
      add(other.key, seriesName(other, legend), COLORS[series.findIndex((item) => item.key === other.key) % COLORS.length]);
    }
    chartConfigFor(s).overlayIds.forEach((id, index) => {
      const candidate = legend.find((variable) => variable.id === id);
      if (candidate && overlayCandidatesFor(s).some((variable) => variable.id === id)) add(seriesKey(id, s.modality), candidate.constructLabel ?? id, COLORS[(series.findIndex((item) => item.key === s.key) + index + 1) % COLORS.length]);
    });
    const companion = s.variableId === VOLUME_COMPLETED ? VOLUME_PRESCRIBED : s.variableId === VOLUME_PRESCRIBED ? VOLUME_COMPLETED : null;
    if (companion) add(seriesKey(companion, s.modality), legend.find((variable) => variable.id === companion)?.constructLabel ?? companion, companion === VOLUME_PRESCRIBED ? '#e68a35' : '#1683ff', companion === VOLUME_PRESCRIBED ? 'prescribed' : 'completed');
    return result;
  }
  function toggleOverlay() {
    setOverlay((value) => !value);
  }
  const currentEvents = cursor ? filteredEvents.filter((e) => eventOverlaps(e, [time(cursor), time(cursor)])) : filteredEvents;

  if (token === null) return <main className="ti-gate"><p>Carregando sessão…</p></main>;
  if (!token) return <main className="ti-gate"><div className="ti-gate-card"><Activity size={32}/><h1>Training Intelligence</h1><p>Entre no Admin para abrir a investigação.</p><Link href="/">Entrar no Admin</Link></div></main>;
  return <div className={`ti-app${embedded ? ' ti-app-embedded' : ''}`} data-theme={theme}>
    {!embedded && <aside className="ti-sidebar">
      <Link href="/" className="ti-brand"><Activity size={30}/><span><b>PANZERI RUN</b><small>TRAINING INTELLIGENCE</small></span></Link>
      <p className="ti-side-caption">INVESTIGAÇÃO DO ATLETA</p>
      <nav>{TABS.map((name, i) => { const Icon = ICONS[i]; return <button key={name} className={`ti-nav ${tab === name ? 'active' : ''}`} aria-current={tab === name ? 'page' : undefined} onClick={() => { setTab(name); setDrawer(null); }}><Icon size={18}/>{name}</button>; })}</nav>
      <div className="ti-student-controls"><p className="ti-side-caption">ALUNO EM ANÁLISE</p><label className="ti-student-search"><Search size={15}/><input aria-label="Buscar aluno" placeholder="Buscar aluno…" value={studentQuery} onChange={(e) => searchStudents(e.target.value)}/></label><select className="ti-student-select" aria-label="Aluno" value={studentSelectValue} onChange={(e) => switchStudent(e.target.value)}>{!studentSelectValue && <option value="" disabled>{studentMatches.length ? "Selecione um aluno" : "Nenhum aluno encontrado"}</option>}{studentMatches.map((s) => <option key={s.id} value={s.id}>{s.name} · #{s.studentCode ?? '—'}</option>)}</select></div>
      <Link className="ti-back" href="/"><ArrowLeft size={15}/>Admin atual</Link>
    </aside>}
    <section className="ti-main">
      <header className="ti-header"><div className="ti-person"><div className="ti-avatar">{student?.name.slice(0, 1) ?? '—'}</div><div><h1>{student?.name ?? 'Selecione um aluno'}</h1><p>Aluno #{student?.studentCode ?? '—'} <span>·</span> Investigação longitudinal</p></div></div><div className="ti-header-controls">{embedded && <div className="ti-embedded-student"><label className="ti-search"><Search size={15}/><input aria-label="Buscar aluno para análise" placeholder="Buscar aluno…" value={studentQuery} onChange={(e) => searchStudents(e.target.value)}/></label><select aria-label="Aluno em análise" value={studentSelectValue} onChange={(e) => switchStudent(e.target.value)}>{!studentSelectValue && <option value="" disabled>{studentMatches.length ? "Selecione um aluno" : "Nenhum aluno encontrado"}</option>}{studentMatches.map((s) => <option key={s.id} value={s.id}>{s.name} · #{s.studentCode ?? '—'}</option>)}</select></div>}<label className="ti-theme-picker">Tema<select aria-label="Tema" value={theme} onChange={(e) => changeTheme(e.target.value as Theme)}><option value="light">Claro</option><option value="dark">Dark Navy</option><option value="softblue">Azul Suave</option><option value="graphite">Grafite</option><option value="system">Sistema</option></select></label><button className="ti-icon-button" title="Atualizar dados" aria-label="Atualizar dados" disabled={loading || eventLoading} onClick={() => { cache.current.clear(); setStore({ owner: '', entries: {} }); setRefresh((n) => n + 1); }}><RefreshCw size={17}/></button></div></header>
      <nav className="ti-mobile-tabs">{TABS.map((name) => <button key={name} className={tab === name ? 'selected' : ''} onClick={() => setTab(name)}>{name}</button>)}</nav>
      <div className="ti-page-head"><div><p className="ti-kicker">TRAINING INTELLIGENCE</p><h2>{tab === 'Visão geral' ? 'O atleta ao longo do tempo' : tab === 'Explorar' ? 'Explorar a trajetória' : tab === 'Comparar' ? 'Comparar indicadores' : tab === 'Timeline' ? 'Timeline integrada' : 'Histórico e evidências'}</h2><p className="ti-subtitle">{tab === 'Comparar' ? 'Escalas originais. Uma mesma janela temporal para investigar.' : 'Treinamento, percepção e contexto conectados pela mesma linha do tempo.'}</p></div><div className="ti-periods" aria-label="Período">{PERIODS.map((p) => <button key={p.id} className={period === p.id ? 'active' : ''} onClick={() => { setPeriod(p.id); setZoom(null); setCursor(''); }}>{p.label}</button>)}<button className={period === 'custom' ? 'active' : ''} onClick={() => setPicker('period')}>{period === 'custom' ? `${dateLabel(fullRange[0])}–${dateLabel(fullRange[1])}` : 'Personalizar'}</button></div></div>
      {error && <p role="alert" className="ti-error">{error}</p>}
      {student && <>
        <div className="ti-investigation-bar"><div className="ti-selected-indicators">{series.map((s, i) => <div key={s.key} className={`ti-selected-chip ${s.visible ? '' : 'muted'}`}><button aria-pressed={s.visible} onClick={() => setSeries((current) => current.map((v) => v.key === s.key ? { ...v, visible: !v.visible } : v))}><span style={{ background: COLORS[i % COLORS.length] }}/>{seriesName(s, legend)}</button><button aria-label={`Remover ${seriesName(s, legend)}`} onClick={() => setSeries((current) => current.filter((v) => v.key !== s.key))}><X size={12}/></button></div>)}</div><div className="ti-add-actions"><button className="ti-primary" onClick={() => setPicker('indicator')}><Plus size={16}/>Indicador</button><button className="ti-outline" onClick={() => setPicker('event')}><Plus size={16}/>Evento</button></div></div>
        {tab === 'Visão geral' && <section className="ti-metric-strip">{loaded.slice(0, 4).map((s) => { const snap = snapshots[s.key]; return <button key={s.key} onClick={() => { setTab('Explorar'); document.getElementById('ti-charts')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}><span>{seriesName(s, legend)}</span><strong>{fmt(snap.current)}<small>{snap.variable.scale?.unit ?? ''}</small></strong><small>{snap.currentWeekContext?.isPartialWeek ? 'Semana em andamento' : snap.evidence.lastObservationAt ? `Último registro · ${dateLabel(snap.evidence.lastObservationAt)}` : 'Ainda sem registro'}{snap.baseline?.value != null ? ` · baseline ${fmt(snap.baseline.value)}` : ''}</small></button>; })}</section>}
        <div className="ti-layout"><div className="ti-content">
          <section className="ti-card ti-chart-stack" id="ti-charts"><div className="ti-section-head"><div><h3>{tab === 'Comparar' ? 'Painéis sincronizados por data' : 'Evolução recente'}</h3><p>{dateLabel(range[0], true)} — {dateLabel(range[1], true)} · escalas originais</p></div></div>
            <div className="ti-workbench-toolbar"><button className={overlay ? 'on' : ''} aria-pressed={overlay} onClick={toggleOverlay}>Sobrepor todos compatíveis</button><button className={focusData ? 'on' : ''} aria-pressed={focusData} onClick={() => { setFocusData((v) => !v); setZoom(null); }}>Focar dados</button><button onClick={() => setPicker('indicator')}><Plus size={14}/>Indicador</button><button onClick={() => setPicker('event')}><Plus size={14}/>Evento</button><details><summary>Camadas em todos</summary><div>{LAYER_LABELS.map(([key, label]) => <button key={key} aria-pressed={layers[key]} className={layers[key] ? 'on' : ''} onClick={() => toggleLayer(key)}>{label}</button>)}</div></details></div>
            {!series.length && <div className="ti-empty"><BarChart3 size={35}/><h3>Por onde começar a investigação?</h3><p>Adicione sono, volume, RPE ou outro indicador disponível.</p><button className="ti-primary" onClick={() => setPicker('indicator')}><Plus size={16}/> Indicador</button></div>}
            {loading && <p role="status" className="ti-loading">Carregando séries do aluno…</p>}
            {groups.map((s, i) => snapshots[s.key] ? <React.Fragment key={s.key}><div className="ti-modality-controls">{(snapshots[s.key].availableModalities?.length ?? 0) > 0 && <><label>Modalidade<select aria-label={`Modalidade de ${seriesName(s, legend)}`} value={s.modality} onChange={(e) => changeModality(s.key, e.target.value)}><option value="">Todas (API)</option>{snapshots[s.key].availableModalities!.map((m) => <option key={m} value={m}>{MODALITIES[m] ?? m}</option>)}</select></label><label>Comparar com<select aria-label={`Comparar modalidade de ${seriesName(s, legend)}`} value="" disabled={series.length >= MAX_SERIES} onChange={(e) => { if (e.target.value) changeModality(s.key, e.target.value, true); }}><option value="">+ Modalidade</option>{snapshots[s.key].availableModalities!.filter((m) => m !== s.modality).map((m) => <option key={m} value={m}>{MODALITIES[m] ?? m}</option>)}</select></label></>}</div><ChartBoundary><LongitudinalChart comparisons={comparisonsFor(s)} overlayCandidates={overlayCandidatesFor(s)} loading={loading} snapshot={snapshots[s.key]} title={seriesName(s, legend)} color={COLORS[series.findIndex((v) => v.key === s.key) % COLORS.length]} layers={chartConfigFor(s).layers} config={chartConfigFor(s)} onConfig={(next) => updateChartConfig(s.key, next)} onReset={() => setChartConfigs((current) => ({ ...current, [s.key]: defaultChartConfig(snapshots[s.key].variable) }))} onRemove={() => setSeries((current) => current.filter((v) => v.key !== s.key))} range={range} cursor={cursor} onCursor={onCursor} events={filteredEvents} onEvent={(event) => { setDrawer(event); setCursor(dateKey(event.startedAt ?? event.reportedAt)); }} compact={i > 0}/></ChartBoundary></React.Fragment> : null)}
            {loaded.length > 0 && <div className="ti-zoom"><div><span>Janela compartilhada</span><button onClick={() => setZoom(null)} disabled={!zoom}>Restaurar período</button></div><label>Início<input aria-label="Início da janela" type="range" min={fullRange[0]} max={fullRange[1]} step={86400000} value={range[0]} onChange={(e) => setZoom([Math.min(Number(e.target.value), range[1] - 86400000), range[1]])}/></label><label>Fim<input aria-label="Fim da janela" type="range" min={fullRange[0]} max={fullRange[1]} step={86400000} value={range[1]} onChange={(e) => setZoom([range[0], Math.max(Number(e.target.value), range[0] + 86400000)])}/></label></div>}
          </section>
          <section className="ti-card ti-timeline"><div className="ti-section-head"><div><h3>{tab === 'Histórico' ? 'Contexto longitudinal disponível' : 'Acontecimentos no período'}</h3><p>Relatos e registros, com origem e datas preservadas.</p></div><button className="ti-outline" onClick={() => setPicker('event')}><Plus size={14}/>Evento</button></div>{eventLoading ? <p role="status" className="ti-loading">Carregando eventos…</p> : eventError ? <p role="alert" className="ti-error">{eventError}</p> : filteredEvents.length ? <div className={tab === 'Timeline' || tab === 'Histórico' ? 'ti-events-list' : 'ti-events-ribbon'}>{filteredEvents.map((event) => <button key={event.id} className="ti-timeline-item" onClick={() => { setDrawer(event); setCursor(dateKey(event.startedAt ?? event.reportedAt)); }}><span className="ti-event-dot"/><time>{dateLabel(event.startedAt ?? event.reportedAt, true)}</time><b>{EVENT_TYPES[event.type] ?? event.type}</b><small>{SOURCES[event.source] ?? event.source}</small>{event.originalText && <p>{event.originalText}</p>}</button>)}</div> : <p className="ti-empty-small">Nenhum evento contextual neste recorte. Use + Evento para revisar os filtros.</p>}</section>
          {tab === 'Histórico' && <section className="ti-card ti-evidence-table"><h3>Rastreabilidade das séries</h3>{loaded.map((s) => { const snap = snapshots[s.key]; return <div key={s.key}><b>{seriesName(s, legend)}</b><span>{snap.evidence.n} observações no histórico</span><small>{snap.evidence.observedSpan.from ? dateLabel(snap.evidence.observedSpan.from, true) : '—'} até {snap.evidence.observedSpan.to ? dateLabel(snap.evidence.observedSpan.to, true) : '—'}</small>{snap.evidence.comparabilityWarning && <p>{snap.evidence.comparabilityWarning}</p>}</div>; })}<p className="ti-muted">Esta versão reúne as séries e os Context Events. A integração de reavaliações e prontuário permanece pendente.</p></section>}
        </div>
        <aside className="ti-inspector"><div className="ti-inspector-title"><div><p>{drawer ? 'EVENTO SELECIONADO' : cursor ? 'DATA EM INVESTIGAÇÃO' : 'LEITURA DO ATLETA'}</p><h3>{drawer ? EVENT_TYPES[drawer.type] ?? drawer.type : cursor ? dateLabel(cursor, true) : 'Estado das variáveis'}</h3></div>{(cursor || drawer) && <button className="ti-icon-button" aria-label="Limpar seleção contextual" onClick={() => { setCursor(''); setDrawer(null); }}><X size={16}/></button>}</div>
          {drawer && <section className="ti-event-detail"><span className="ti-source-badge">{SOURCES[drawer.source] ?? drawer.source}</span><p>{dateLabel(drawer.startedAt ?? drawer.reportedAt, true)}{drawer.endedAt ? ` — ${dateLabel(drawer.endedAt, true)}` : ''}</p>{drawer.originalText && <blockquote>{drawer.originalText}</blockquote>}<dl><dt>Status</dt><dd>{drawer.status}</dd><dt>Registrado em</dt><dd>{dateLabel(drawer.reportedAt, true)}</dd>{drawer.subtype && <><dt>Detalhe</dt><dd>{drawer.subtype}</dd></>}</dl></section>}
          {!loaded.length && <p className="ti-empty-small">Os indicadores aparecerão aqui após o carregamento.</p>}
          {loaded.filter((s) => s.visible).map((s, i) => { const snap = snapshots[s.key]; const observations = cursor ? observationsAt(snap, cursor) : []; const trend = snap.trend?.short_21d; const average = cursor ? snap.movingAverageSeries?.short_21d?.find((p) => dateKey(p.timestamp) === cursor)?.value : snap.movingAverages?.short_21d?.value; return <section className="ti-summary" key={s.key}><div className="ti-summary-name"><span style={{ background: COLORS[i % COLORS.length] }}/><b>{seriesName(s, legend)}</b></div>{cursor ? <div className="ti-day-values">{observations.length ? observations.map((o, n) => <div key={n}><strong>{typeof o.value === 'number' ? fmt(o.value) : o.value}</strong><span>{snap.variable.scale?.unit} {MODALITIES[o.context?.modality ?? ''] ?? o.context?.modality ?? ''}</span>{o.context?.isPartialWeek && <small>Semana em andamento</small>}</div>) : <p>Sem observação nesta data.</p>}</div> : <div className="ti-current-reading"><strong>{fmt(snap.current)}</strong><span>{snap.variable.scale?.unit}</span></div>}<div className="ti-summary-row"><span>{cursor ? 'MM21 nesta data' : 'MM21 atual'}</span><b>{fmt(average)}</b></div><div className="ti-summary-row"><span>Baseline individual</span><b>{fmt(snap.baseline?.value)}</b></div><div className="ti-summary-row"><span>Faixa habitual</span><b>{fmt(snap.habitualRange?.lower)} – {fmt(snap.habitualRange?.upper)}</b></div>{trend && <div className="ti-summary-row"><span>Tendência atual · 21 dias</span><b>{({ increasing: 'Aumentando', decreasing: 'Diminuindo', stable: 'Estável', insufficient_data: 'Dados insuficientes', up: 'Aumentando', down: 'Diminuindo', flat: 'Estável' } as Record<string, string>)[trend.direction] ?? trend.direction}</b></div>}<small className="ti-muted">Referências históricas da API · {snap.evidence.n} registros{snap.baseline?.isPartialWindow ? ' · baseline parcial' : ''}</small>{snap.evidence.comparabilityWarning && <p className="ti-caution">{snap.evidence.comparabilityWarning}</p>}</section>; })}
          <div className="ti-inspector-title"><div><p>CONTEXTO</p><h3>{cursor ? 'Acontecimentos nesta data' : 'Acontecimentos recentes'}</h3></div></div>{eventError ? <p className="ti-caution">{eventError}</p> : eventLoading ? <p className="ti-muted">Carregando…</p> : currentEvents.slice(0, 5).map((event) => <button key={event.id} className="ti-event-row" onClick={() => setDrawer(event)}><span className="ti-event-dot"/><span><b>{EVENT_TYPES[event.type] ?? event.type}</b><small>{dateLabel(event.startedAt ?? event.reportedAt)}</small></span></button>)}{!eventLoading && !eventError && !currentEvents.length && <p className="ti-empty-small">Sem evento contextual nesta seleção.</p>}<p className="ti-causality-note">Coincidência temporal não demonstra causa ou efeito. Médias móveis e tendência são medidas distintas.</p>
        </aside></div>
      </>}
    </section>
    {picker && <Modal title={picker === 'indicator' ? 'Adicionar indicador' : picker === 'period' ? 'Período personalizado' : 'Eventos na investigação'} onClose={() => setPicker(null)}>
      {picker === 'period' ? <CustomPeriodForm onApply={(next) => { setCustomRange(next); setPeriod('custom'); setFocusData(false); setZoom(null); setCursor(''); setPicker(null); }}/>
      : picker === 'indicator' ? <><p className="ti-muted">Acrescente até dez séries. Cada uma conserva a escala original.</p><div className="ti-picker-tools"><label className="ti-search"><Search size={16}/><input autoFocus aria-label="Buscar indicador" placeholder="Sono, volume, dor…" value={search} onChange={(e) => setSearch(e.target.value)}/></label><select aria-label="Domínio" value={domain} onChange={(e) => setDomain(e.target.value)}><option value="all">Todos os domínios</option>{Object.entries(DOMAINS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="ti-picker-list">{legend.filter((v) => (domain === 'all' || domain === v.domain) && `${v.constructLabel ?? v.id} ${DOMAINS[v.domain]}`.toLowerCase().includes(search.toLowerCase())).map((v) => { const added = series.some((s) => s.variableId === v.id && !s.modality); return <button key={v.id} disabled={added || series.length >= MAX_SERIES} onClick={() => addIndicator(v.id)}><span><b>{v.constructLabel ?? v.id}</b><small>{DOMAINS[v.domain] ?? v.domain}{v.scale ? ` · ${v.scale.min}–${v.scale.max} ${v.scale.unit ?? ''}` : ''}</small></span>{added ? <Check size={17}/> : <Plus size={17}/>}</button>; })}</div><div className="ti-modal-foot"><span>{series.length} de 10 séries</span><button className="ti-primary" onClick={() => setPicker(null)}>Investigar</button></div></>
      : <><p className="ti-muted">Escolha os tipos de eventos existentes que deseja sobrepor aos gráficos. Esta ação não cria registros no aluno.</p><button className="ti-outline" onClick={() => { setEventTypes(null); enableEventLayer(); }}>Exibir todos os tipos</button><div className="ti-picker-list">{[...new Set(studentEvents.map((e) => e.type))].map((type) => <label key={type} className="ti-event-filter"><input type="checkbox" checked={eventTypes === null || eventTypes.includes(type)} onChange={(e) => { const all = eventTypes ?? [...new Set(studentEvents.map((v) => v.type))]; setEventTypes(e.target.checked ? [...all, type] : all.filter((v) => v !== type)); enableEventLayer(); }}/>{EVENT_TYPES[type] ?? type}<small>{studentEvents.filter((e) => e.type === type).length}</small></label>)}</div>{eventError && <p className="ti-error">{eventError}</p>}{!studentEvents.length && !eventError && <p className="ti-empty-small">Ainda não há Context Events carregados para este aluno.</p>}<div className="ti-modal-foot"><span>Camada de contexto</span><button className="ti-primary" onClick={() => setPicker(null)}>Aplicar</button></div></>}
    </Modal>}
  </div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={dialog} className="ti-modal" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}><div className="ti-modal-head"><h2>{title}</h2><button aria-label="Fechar" className="ti-icon-button" onClick={onClose}><X size={18}/></button></div>{children}</dialog>;
}

function CustomPeriodForm({ onApply }: { onApply: (range: [number, number]) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = React.useState<CustomPeriod['mode']>('dates');
  const [start, setStart] = React.useState(`${today.slice(0, 7)}-01`);
  const [end, setEnd] = React.useState(today);
  const [monthStart, setMonthStart] = React.useState(today.slice(0, 7));
  const [monthEnd, setMonthEnd] = React.useState(today.slice(0, 7));
  const [count, setCount] = React.useState(8);
  const [message, setMessage] = React.useState('');
  function apply(event: React.FormEvent) {
    event.preventDefault();
    const selection: CustomPeriod = mode === 'dates' ? { mode, start, end }
      : mode === 'weeks' || mode === 'months' ? { mode, count }
      : mode === 'month' ? { mode, month: monthStart }
      : { mode, start: monthStart, end: monthEnd };
    const range = customPeriodRange(selection);
    if (!range) { setMessage('Informe um intervalo válido, com o início antes do fim.'); return; }
    onApply(range);
  }
  return <form className="ti-period-form" onSubmit={apply}>
    <label>Como selecionar<select aria-label="Tipo de período" value={mode} onChange={(e) => { setMode(e.target.value as CustomPeriod['mode']); setMessage(''); }}><option value="dates">Entre duas datas</option><option value="weeks">Últimas X semanas</option><option value="months">Últimos X meses</option><option value="month">Mês específico</option><option value="monthRange">Entre dois meses</option></select></label>
    {mode === 'dates' && <div className="ti-period-fields"><label>Data inicial<input aria-label="Data inicial" type="date" value={start} onChange={(e) => setStart(e.target.value)}/></label><label>Data final<input aria-label="Data final" type="date" value={end} onChange={(e) => setEnd(e.target.value)}/></label></div>}
    {(mode === 'weeks' || mode === 'months') && <label>Quantidade de {mode === 'weeks' ? 'semanas' : 'meses'}<input aria-label="Quantidade de períodos" type="number" min="1" max={mode === 'weeks' ? '520' : '120'} value={count} onChange={(e) => setCount(Number(e.target.value))}/></label>}
    {(mode === 'month' || mode === 'monthRange') && <div className="ti-period-fields"><label>{mode === 'month' ? 'Mês' : 'Mês inicial'}<input aria-label="Mês inicial" type="month" value={monthStart} onChange={(e) => setMonthStart(e.target.value)}/></label>{mode === 'monthRange' && <label>Mês final<input aria-label="Mês final" type="month" value={monthEnd} onChange={(e) => setMonthEnd(e.target.value)}/></label>}</div>}
    {message && <p role="alert" className="ti-error">{message}</p>}
    <p className="ti-muted">O mesmo intervalo será aplicado a todos os gráficos, eventos e ao painel contextual. A janela inferior permite ajustar o recorte depois.</p>
    <div className="ti-modal-foot"><span>Escalas e valores seguem os dados da API.</span><button type="submit" className="ti-primary">Aplicar período</button></div>
  </form>;
}

class ChartBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div role="alert" className="ti-error">Não foi possível desenhar este gráfico. Os controles continuam disponíveis. <button onClick={() => this.setState({ failed: false })}>Tentar novamente</button></div> : this.props.children; }
}
