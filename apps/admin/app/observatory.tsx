'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, CalendarDays, Gauge, HeartPulse, Info, ShieldCheck, SlidersHorizontal, TriangleAlert, Users } from 'lucide-react';
import { Card, ChipGroup, Columns, Empty, HBars, Kpi, SheetFrame, nf } from './viz';
import type { HItem, Option } from './viz';
import { Legend, PainDashboard, SEG_COLOR, SEG_SHORT, WeeklyChart } from './observatory-weekly';
import type { WeeklyLine } from './observatory-weekly';

// Observatório Panzeri Run (24/10/2026). SOMENTE LEITURA e SÓ AGREGADOS: GET /observatory/status e /observatory/analysis. Nenhum nome, e-mail ou id de aluna chega aqui.
// Estatística descritiva: o que aparece são associações entre grupos, não causa. Cada número diz seu denominador (alunas, treinos, relatos ou km). Semanas são sempre as do calendário (segunda a domingo), nunca somadas entre alunas.
// Células com poucos participantes chegam suprimidas da API e aqui aparecem como "oculto" — nunca como zero.

// ───────── tipos (espelham o contrato da API; apps/api/src/observatory/observatory-engine.ts) ─────────
type Row<T> = { key: string; label: string; participants: number | null; suppressed: boolean; complementary: boolean; data: T | null };
type PainMetrics = {
  trainings: number; km: number; reports: number; reportsWithIntensity: number; reportsWithoutIntensity: number;
  reportsPer1000Km: number | null; meanIntensityReports: number | null; meanIntensityAll: number | null; painPointsPer1000Km: number | null;
  intensityBins: Array<{ key: string; label: string; count: number; pctOfKnown: number | null; per1000Km: number | null }>;
  levelBins: Array<{ key: string; label: string; count: number; per1000Km: number | null }>;
  coverage: { trainings: number; withFeedback: number; withoutFeedback: number; numericIntensityTrainings: number; intensityCoveragePct: number | null };
  zeroOrigins: { explicitNoPain: number; noPainReport: number };
};
type PainLevelMetrics = {
  trainings: number; withFeedback: number; painTrainings: number; levels: { leve: number; moderado: number; forte: number; semNivel: number };
  painPer100Trainings: number | null; levelPer100Trainings: { leve: number | null; moderado: number | null; forte: number | null }; painPer100Answered: number | null; painPer10Trainings: number | null;
  meanLevelAmongPain: number | null; meanLevelAll: number | null; levelPoints: number; levelPointsPer100Trainings: number | null; levelPointsPer1000Km: number | null;
  km: number; painPer1000Km: number | null; timing: Array<{ key: string; count: number }>;
};
type Pace = { label: string; secondsPerKm: number; runs: number } | null;
type Relatar = { reports: number; meanNote: number | null; notePoints: number; reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null; reportsPer1000Km: number | null; notePointsPer1000Km: number | null };
type SegmentRow = PainLevelMetrics & { relatar: Relatar };
type AdherenceCell = { scheduled: number; registered: number; ratePct: number | null };
type CycleRow = {
  participants: number; participantDays: number; trainings: number; runs: number; runKm: number; avgKmPerRun: number | null; kmPerParticipantWeek: number | null;
  pain: PainLevelMetrics; runPace: Pace; participantsWithPace: number | null;
  relatar: { reports: number; meanNote: number | null; notePoints: number; reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null; reportsPer100Km: number | null; notePointsPer100Km: number | null };
  adherence: { all: AdherenceCell; bySegment: Partial<Record<string, AdherenceCell>> };
};
type CycleLocationCell = { reports: number; meanNote: number | null; reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null };
type CycleGroup = { phases: Array<{ phase: string; label: string; row: Row<CycleRow> }>; locations: Array<{ key: string; label: string; suppressed: boolean; cells: Record<string, CycleLocationCell | null> }> };
type WeeklyPoint = { week: string; weekNumber: number; suppressed: boolean; trainings: number | null; painTrainings: number | null; painPer100: number | null; levelPointsPer100: number | null; meanLevelAmongPain: number | null; km: number | null; painPer1000Km: number | null; levelPointsPer1000Km: number | null };
type WeeklyRelatarPoint = { week: string; weekNumber: number; suppressed: boolean; reports: number | null; meanNote: number | null; notePoints: number | null; reportsPer100Trainings: number | null; reportsPer1000Km: number | null; notePointsPer1000Km: number | null };
type WeeklySeries = { segments: Array<{ key: string; label: string; points: WeeklyPoint[] }>; relatar: WeeklyRelatarPoint[] };
type Insights = {
  scopeNote: string;
  weekly: WeeklySeries;
  segments: { rows: Array<Row<SegmentRow>>; runsCombined: SegmentRow | null; total: SegmentRow | null };
  runsByDistance: { rows: Array<Row<{ runs: number; extraRuns: number; km: number; participants: number; pace: Pace; participantsWithPace: number | null; pain: PainLevelMetrics }>>; runsWithoutDistance: number };
  weeklyVolume: { weeks: { from: string; to: string }; minWeeks: number; studentsWithRuns: number | null; rows: Array<Row<{ students: number }>>; note: string };
  standalone: {
    note: string; overall: { reports: number; participants: number; meanIntensity: number | null; notePoints: number; bins: Array<{ key: string; label: string; count: number; pct: number | null }> } | null;
    runKm: number; reportsPer1000RunKm: number | null; notePointsPer1000RunKm: number | null;
    locations: Array<Row<{ reports: number; participants: number; meanNote: number | null; notePoints: number; reportsPer1000RunKm: number | null; notePointsPer1000RunKm: number | null; reportsPer100Trainings: number | null; notePointsPer100Trainings: number | null }>>;
    sides: Array<Row<{ reports: number; meanNote: number | null }>>;
    locationBySegment: Array<{ key: string; label: string; suppressed: boolean; cells: Partial<Record<string, { reportsPer100: number | null; notePointsPer100: number | null }>> }>;
  };
  cycle: { notes: string[]; participantsWithCycle: number; participantsWithEstimatedPhases: number; trainingsOutsideCycle: number; natural: CycleGroup; hormonal: CycleGroup };
};
type CohortSeriesPoint = { week: string; weekNumber: number; participants: number | null; avgKm: number | null; paceSecondsPerKm: number | null; paceLabel: string | null; suppressed: boolean };
type Result = {
  dataset: 'real' | 'synthetic'; dataAsOf: string; period: { from: string; to: string }; mode: 'cross' | 'cohort'; minParticipants: number;
  overview: { participants: number | null; participantWeeks: number | null; trainings: number | null; km: number | null; belowMinimum: boolean; weeks: { complete: number; incomplete: number; noData: number } };
  volume: { rows: Array<Row<{ participantWeeks: number; km: number; pctOfWeeks: number; avgKmPerWeek: number | null }>>; total: { participantWeeks: number; participants: number; km: number } | null };
  pace: {
    cross: Array<Row<{ pace: { secondsPerKm: number; label: string } | null; paceEvents: number; km: number; participantsWithPace: number; participantPace: { p25: string | null; median: string | null; p75: string | null } }>>;
    cohort: {
      baselineWeeks: number; maxWeeks: number; eligibleParticipants: number | null;
      groups: Array<Row<{
        baselinePace: { secondsPerKm: number; label: string } | null; baselineAvgKm: number | null; series: CohortSeriesPoint[];
        paceChange: { participants: number | null; medianDeltaSecPerKm: number | null; p25: number | null; p75: number | null } | null;
      }>>;
    };
  };
  pain: {
    overall: PainMetrics | null; groupBy: GroupBy; groupLabel: string; rows: Array<Row<PainMetrics>>;
    prior: { volume: Array<Row<PainMetrics>>; strength: Array<Row<PainMetrics>> };
    pendingDimensions: Array<{ id: string; label: string; reason: string }>;
  };
  insights: Insights | null;
  quality: Record<string, number | string> & {
    stravaExcludedEvents: number; ambiguousIdentityEvents: number; unevaluatedIdentityEvents: number; invalidDistanceEvents: number; duplicateManualEvents: number;
    painConflicts: number; eligibleTrainings: number; trainingsWithoutDistance: number; manualTrainings: number; activityTrainings: number;
    participantWeeksIncomplete: number; participantWeeksNoData: number; participantsExcludedByFilters: number; note: string;
  };
};
type Status = { enabled: boolean; dataset: 'synthetic' | 'real'; reason?: string };
type Mode = 'cross' | 'cohort';
type GroupBy = 'volume' | 'age' | 'strength' | 'sex' | 'priorVolume' | 'priorStrength';
type Tab = 'panorama' | 'treino' | 'dor' | 'tipos' | 'relatar' | 'ciclo' | 'qualidade';

interface Filters {
  from: string; to: string; volumeBands: string[]; ageBands: string[]; strengthBands: string[]; sexes: string[]; mode: Mode; groupBy: GroupBy; includeZeroWeeks: boolean;
}

// ───────── opções dos filtros (mesmas faixas do contrato da API) ─────────
const opt = (value: string, label: string): Option => ({ value, label, students: 0 });
const VOLUME_OPTIONS = [opt('v1', 'Até 20 km'), opt('v2', '20 a 40 km'), opt('v3', '40 a 60 km'), opt('v4', '60 a 90 km'), opt('v5', '90 a 120 km'), opt('v6', '120 a 160 km'), opt('v7', '160 a 200 km'), opt('v8', 'Acima de 200 km')];
const AGE_OPTIONS = [opt('lt30', 'Menos de 30'), opt('30_39', '30 a 39'), opt('40_49', '40 a 49'), opt('50_59', '50 a 59'), opt('60_69', '60 a 69'), opt('70p', '70 ou mais'), opt('unk', 'Não informado')];
const STRENGTH_OPTIONS = [opt('s0', 'Nenhuma sessão de força'), opt('s1', '1 sessão de força'), opt('s2p', '2 ou mais sessões de força')];
const SEX_OPTIONS = [opt('F', 'Feminino'), opt('M', 'Masculino'), opt('other', 'Outro'), opt('unknown', 'Não informado')];
const GROUP_OPTIONS: Array<[GroupBy, string]> = [['volume', 'Volume semanal'], ['age', 'Faixa etária'], ['strength', 'Força na semana'], ['sex', 'Sexo'], ['priorVolume', 'Volume dos 28 dias anteriores'], ['priorStrength', 'Força dos 28 dias anteriores']];
// paleta categórica em ordem fixa (cor segue a entidade, nunca o ranking)
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const COLOR_INDEX: Record<string, number> = { v1: 0, v2: 1, v3: 2, v4: 3, v5: 4, v6: 5, v7: 6, v8: 7 };

const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const addDays = (date: string, days: number) => new Date(new Date(`${date}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const emptyFilters = (): Filters => ({ from: '2026-08-01', to: localToday(), volumeBands: [], ageBands: [], strengthBands: [], sexes: [], mode: 'cross', groupBy: 'volume', includeZeroWeeks: true });
const paceText = (seconds: number | null | undefined) => (seconds == null ? '—' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km`);
const signed = (value: number | null | undefined) => (value == null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} s/km`);

function toQuery(f: Filters): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string | string[]) => { const text = Array.isArray(value) ? value.join(',') : value; if (text) params.set(key, text); };
  put('from', f.from); put('to', f.to); put('volumeBands', f.volumeBands); put('ageBands', f.ageBands); put('strengthBands', f.strengthBands); put('sexes', f.sexes);
  put('mode', f.mode); put('groupBy', f.groupBy); if (!f.includeZeroWeeks) params.set('includeZeroWeeks', 'false');
  return params.toString();
}

// ───────── célula suprimida: nunca vira zero ─────────
function Hidden({ row, min }: { row: { suppressed: boolean; complementary: boolean }; min: number }) {
  return <span className="obsHidden" title={row.complementary ? 'Ocultado por segurança: mostrar este valor permitiria reconstruir outro grupo pequeno por diferença.' : `Menos de ${min} participantes neste grupo: valor oculto para não expor uma aluna.`}>{row.complementary ? 'oculto por segurança' : `oculto (menos de ${min} participantes)`}</span>;
}
// O tamanho de um grupo suprimido tambem nao e' mostrado (so' "< N"): o numero exato revelaria o tamanho da celula pequena.
const pcount = (row: { participants: number | null; suppressed: boolean }, min: number) => (row.suppressed || row.participants == null ? `< ${min}` : nf(row.participants));
const Table = ({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) => (
  <div className="eqTableWrap"><table className="eqTable obsTable"><caption>{caption}</caption><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
);

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (next: T) => void; label: string }) {
  return <div className="eqSeg obsSeg" role="group" aria-label={label}>{options.map(([id, text]) => <button key={id} type="button" className={value === id ? 'on' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>;
}

// ───────── gráfico de linhas (grupos fixos): uma linha por faixa, lacuna onde o ponto foi suprimido ─────────
type LineSeries = { key: string; label: string; color: string; points: Array<{ x: number; y: number | null; tip: string }> };
function LineChart({ series, xMax, yFormat }: { series: LineSeries[]; xMax: number; yFormat: (v: number) => string }) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 640; const H = 280; const L = 58; const R = 14; const T = 14; const B = 50;
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null);
  if (ys.length === 0) return <Empty icon={<BarChart3 size={22} />} title="Sem pontos para mostrar" text="Nenhum grupo fixo tem participantes suficientes nas semanas após a linha de base." />;
  const lo = Math.min(...ys); const hi = Math.max(...ys); const pad = Math.max(5, (hi - lo) * 0.15);
  const y0 = Math.floor((lo - pad) / 10) * 10; const y1 = Math.ceil((hi + pad) / 10) * 10;
  const sx = (x: number) => L + ((x - 1) / Math.max(1, xMax - 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / Math.max(1, y1 - y0)) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map((i) => y0 + ((y1 - y0) * i) / 4);
  const onMove = (event: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect(); if (!box) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    setHoverX(Math.min(xMax, Math.max(1, Math.round(1 + ((px - L) / (W - L - R)) * (xMax - 1)))));
  };
  const segments = (s: LineSeries) => { const out: string[] = []; let cur: string[] = []; for (const p of s.points) { if (p.y == null) { if (cur.length > 1) out.push(cur.join(' ')); cur = []; } else cur.push(`${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`); } if (cur.length > 1) out.push(cur.join(' ')); return out; };
  const hoverRows = hoverX == null ? [] : series.map((s) => ({ s, p: s.points.find((p) => p.x === hoverX) })).filter((r) => r.p);
  return (
    <div className="obsLine" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHoverX(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pace por semana após a linha de base, uma linha por grupo fixo" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="obsGrid" /><text x={L - 8} y={sy(t) + 4} textAnchor="end" className="obsAxis">{yFormat(t)}</text></g>)}
        {[1, Math.round(xMax / 4), Math.round(xMax / 2), Math.round((3 * xMax) / 4), xMax].filter((v, i, a) => v >= 1 && a.indexOf(v) === i).map((x) => <text key={x} x={sx(x)} y={H - B + 18} textAnchor="middle" className="obsAxis">{x}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="obsAxisTitle">semanas após a linha de base</text>
        {hoverX != null ? <line x1={sx(hoverX)} x2={sx(hoverX)} y1={T} y2={H - B} className="obsCross" /> : null}
        {series.map((s) => (
          <g key={s.key}>
            {segments(s).map((pts, i) => <polyline key={i} points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {s.points.filter((p) => p.y != null && (hoverX === p.x || p.x === 1)).map((p) => <circle key={p.x} cx={sx(p.x)} cy={sy(p.y!)} r={4} fill={s.color} stroke="var(--paper)" strokeWidth={2} />)}
          </g>
        ))}
      </svg>
      {hoverX != null && hoverRows.length > 0 ? (
        <div className="eqTip obsLineTip" role="tooltip"><b>Semana {hoverX} após a linha de base</b>{hoverRows.map(({ s, p }) => <small key={s.key}><i style={{ background: s.color }} />{s.label}: {p!.tip}</small>)}</div>
      ) : null}
    </div>
  );
}

// ───────── colunas agrupadas: cada faixa de intensidade tem uma coluna por grupo ─────────
function GroupedColumns({ clusters, groups }: { clusters: Array<{ key: string; label: string; values: Array<{ group: string; color: string; value: number | null; detail: string }> }>; groups: Array<{ key: string; label: string; color: string }> }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0.0001, ...clusters.flatMap((c) => c.values.map((v) => v.value ?? 0)));
  const height = 150;
  if (groups.length === 0) return <Empty icon={<BarChart3 size={22} />} title="Sem grupos para comparar" text="Não há relatos neste recorte." />;
  return (
    <div className="obsGrouped" role="img" aria-label="Relatos de dor por 1.000 km, por faixa de intensidade e por grupo">
      <div className="obsGroupedPlot" style={{ height: height + 40 }}>
        {clusters.map((c) => (
          <div key={c.key} className="obsCluster">
            <div className="obsClusterBars" style={{ height: height + 6 }}>
              {c.values.map((v) => {
                const id = `${c.key}:${v.group}`;
                return (
                  <div key={v.group} className={`obsGBar${hover === id ? ' hover' : ''}`} tabIndex={0} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(id)} onBlur={() => setHover(null)}>
                    <span className="obsGBarFill" style={{ height: Math.max(v.value != null && v.value > 0 ? 3 : 0, Math.round(((v.value ?? 0) / max) * height)), background: v.color }} />
                    {hover === id ? <span className="eqTip" role="tooltip"><b>{nf(v.value, 2)} por 1.000 km</b><small>{groups.find((g) => g.key === v.group)?.label} · {v.detail}</small></span> : null}
                  </div>
                );
              })}
            </div>
            <span className="obsClusterLabel">{c.label.replace('Intensidade ', '')}</span>
          </div>
        ))}
      </div>
      <p className="obsAxisCap">Faixa de intensidade relatada (1–10) · relatos por 1.000 km corridos</p>
      <div className="eqLegend">{groups.map((g) => <span key={g.key}><i style={{ background: g.color }} />{g.label}</span>)}</div>
    </div>
  );
}

// ───────── tela ─────────
export default function Observatory({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState('');
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(applied);
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<Tab>('panorama');
  const [sheet, setSheet] = useState(false);
  const seq = useRef(0);

  const run = useCallback(async (filters: Filters) => {
    const mine = ++seq.current;
    setState('loading'); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/observatory/analysis?${toQuery(filters)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        let detail = response.status === 403 ? 'Acesso restrito a administradoras autorizadas.' : 'Não foi possível carregar agora.';
        try { const body = (await response.json()) as { message?: string | string[] }; const text = Array.isArray(body.message) ? body.message.join(' ') : body.message; if (text) detail = text; } catch { /* mensagem padrão */ }
        if (mine === seq.current) { setMessage(detail); setState('error'); }
        return;
      }
      const body = (await response.json()) as Result;
      if (mine === seq.current) { setResult(body); setState('ready'); }
    } catch {
      if (mine === seq.current) { setMessage('Sem conexão com a API. Tente novamente.'); setState('error'); }
    }
  }, [accessToken, apiUrl]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`${apiUrl}/observatory/status`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!alive) return;
        if (response.status === 403) { setStatusError('Acesso restrito a administradoras autorizadas.'); return; }
        if (!response.ok) { setStatusError('Não foi possível verificar o estado do Observatório agora.'); return; }
        const body = (await response.json()) as Status;
        setStatus(body);
        if (body.enabled) void run(applied);
      } catch { if (alive) setStatusError('Sem conexão com a API. Tente novamente.'); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [accessToken, apiUrl]);

  const commit = (next: Filters) => { setApplied(next); setDraft(next); void run(next); };
  const patch = (changes: Partial<Filters>) => setDraft((current) => ({ ...current, ...changes }));
  const shortcut = (weeks: number) => { const to = localToday(); patch({ to, from: addDays(to, -(weeks * 7 - 1)) }); };

  // etiquetas ativas (remover aplica na hora)
  const chips: Array<{ key: string; group: string; text: string; remove: () => void }> = [];
  const addList = (group: string, values: string[], list: Option[], set: (v: string[]) => Filters) => values.forEach((v) => chips.push({ key: `${group}:${v}`, group, text: list.find((o) => o.value === v)?.label ?? v, remove: () => commit(set(values.filter((x) => x !== v))) }));
  addList('Rodagem', applied.volumeBands, VOLUME_OPTIONS, (n) => ({ ...applied, volumeBands: n }));
  addList('Idade', applied.ageBands, AGE_OPTIONS, (n) => ({ ...applied, ageBands: n }));
  addList('Força', applied.strengthBands, STRENGTH_OPTIONS, (n) => ({ ...applied, strengthBands: n }));
  addList('Sexo', applied.sexes, SEX_OPTIONS, (n) => ({ ...applied, sexes: n }));
  if (!applied.includeZeroWeeks) chips.push({ key: 'zero', group: 'Semanas', text: 'sem as semanas sem treino', remove: () => commit({ ...applied, includeZeroWeeks: true }) });
  const clearAll = () => commit({ ...emptyFilters(), from: applied.from, to: applied.to, mode: applied.mode, groupBy: applied.groupBy });
  const days = dayDiff(applied.from, applied.to) + 1;
  const r = result;
  const min = r?.minParticipants ?? 1;
  const ins = r?.insights ?? null;

  // ── estados sem dados ──
  if (statusError) return <section className="eqRoot obsRoot"><Empty icon={<ShieldCheck size={22} />} title="Observatório indisponível" text={statusError} /></section>;
  if (!status) return <section className="eqRoot obsRoot"><div className="eqSkeleton" aria-label="Carregando"><span /><span /><span /><span /></div></section>;
  if (!status.enabled) {
    return (
      <section className="eqRoot obsRoot">
        <header className="eqTop"><div className="eqTitle"><h2>Observatório Panzeri Run</h2><p>Análise agregada do comportamento da comunidade de corredoras.</p></div></header>
        <div className="obsOff" role="status">
          <ShieldCheck size={26} aria-hidden="true" />
          <h3>Observatório desativado</h3>
          <p>{status.reason ?? 'A funcionalidade está desligada por padrão e só deve ser ativada depois da validação com dados sintéticos e da autorização para dados reais.'}</p>
          <small>Para ligar o ambiente de teste (dados sintéticos), a variável de ambiente do Observatório precisa ser ativada no servidor da API.</small>
        </div>
      </section>
    );
  }

  // ── dados derivados ──
  const volumeRows = r?.volume.rows ?? [];
  const volumeColumns = volumeRows.filter((row) => !row.suppressed && row.data).map((row) => ({ key: row.key, label: row.label.replace(' km', '').replace('Acima de ', '> ').replace('Até ', '≤ ').replace(' a ', '–'), value: row.participants ?? 0, sub: `${row.label}: ${nf(row.participants)} alunas · ${nf(row.data!.avgKmPerWeek, 1)} km por semana corrida` }));
  const hiddenVolume = volumeRows.filter((row) => row.suppressed).length;
  const painGroups = (r?.pain.rows ?? []).filter((row) => !row.suppressed && row.data && row.data.trainings > 0);
  const painGroupDefs = painGroups.map((row, index) => ({ key: row.key, label: row.label, color: PALETTE[(r!.pain.groupBy === 'volume' ? COLOR_INDEX[row.key] ?? index : index) % PALETTE.length] }));
  const binKeys = r?.pain.overall?.levelBins.map((b) => ({ key: b.key, label: b.label })) ?? painGroups[0]?.data?.levelBins.map((b) => ({ key: b.key, label: b.label })) ?? [];
  const painClusters = binKeys.map((b) => ({
    key: b.key, label: b.label,
    values: painGroups.map((row, i) => { const bin = row.data!.levelBins.find((x) => x.key === b.key); return { group: row.key, color: painGroupDefs[i].color, value: bin?.per1000Km ?? null, detail: `${nf(bin?.count)} treinos com ${b.label.toLowerCase()} em ${nf(row.data!.km, 0)} km (${nf(row.participants)} participantes)` }; }),
  }));
  const hiddenPain = (r?.pain.rows ?? []).filter((row) => row.suppressed).length;
  const cohortGroups = (r?.pace.cohort.groups ?? []).filter((g) => !g.suppressed && g.data && g.data.series.some((p) => !p.suppressed));
  const cohortSeries: LineSeries[] = cohortGroups.map((g, i) => ({
    key: g.key, label: g.label, color: PALETTE[COLOR_INDEX[g.key] ?? i],
    points: g.data!.series.map((p) => ({ x: p.weekNumber, y: p.suppressed ? null : p.paceSecondsPerKm, tip: p.suppressed ? 'oculto' : `semana de ${p.week.slice(8, 10)}/${p.week.slice(5, 7)} · ${p.paceLabel ?? '—'} · ${nf(p.participants)} participantes · ${nf(p.avgKm, 1)} km/semana` })),
  }));
  const cohortSuppressedPoints = (r?.pace.cohort.groups ?? []).reduce((s, g) => s + (g.data?.series.filter((p) => p.suppressed).length ?? 0), 0);

  const tabs: Array<[Tab, string, React.ReactNode]> = [['panorama', 'Panorama', <BarChart3 key="a" size={15} />], ['treino', 'Treinamento', <Activity key="b" size={15} />], ['dor', 'Dor e recuperação', <HeartPulse key="c" size={15} />], ['tipos', 'Dor por tipo de treino', <Gauge key="e" size={15} />], ['relatar', 'Relatar dor', <HeartPulse key="f" size={15} />], ['ciclo', 'Ciclo menstrual', <CalendarDays key="g" size={15} />], ['qualidade', 'Qualidade dos dados', <ShieldCheck key="d" size={15} />]];

  const painTable = (caption: string, rows: Array<Row<PainMetrics>>, withBins: boolean) => (
    <Table caption={caption} head={['Grupo', 'Participantes', 'Treinos', 'Km', 'Treinos com dor', 'Treinos com dor / 1.000 km', ...(withBins ? ['Leve /1.000 km', 'Moderada /1.000 km', 'Forte /1.000 km', 'Cobertura de feedback'] : [])]}>
      {rows.map((row) => (
        <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}>
          <td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
          {row.suppressed || !row.data ? <td colSpan={withBins ? 9 : 5}><Hidden row={row} min={min} /></td> : (
            <>
              <td>{nf(row.data.trainings)}</td><td>{nf(row.data.km, 0)}</td><td>{nf(row.data.reports)}</td><td>{nf(row.data.reportsPer1000Km, 2)}</td>
              {withBins ? <>{row.data.levelBins.map((b) => <td key={b.key}>{nf(b.per1000Km, 2)}</td>)}<td>{nf(row.data.coverage.withFeedback)} de {nf(row.data.coverage.trainings)} ({nf(row.data.coverage.trainings > 0 ? (row.data.coverage.withFeedback / row.data.coverage.trainings) * 100 : null, 0)}%)</td></> : null}
            </>
          )}
        </tr>
      ))}
    </Table>
  );
  const priorBars = (rows: Array<Row<PainMetrics>>): HItem[] => rows.filter((row) => row.suppressed || (row.participants ?? 0) > 0).map((row) => ({
    key: row.key, label: row.label, sub: row.suppressed || !row.data ? 'menos participantes que o mínimo' : `${nf(row.participants)} participantes · ${nf(row.data.reports)} treinos com dor em ${nf(row.data.km, 0)} km`,
    value: row.data?.reportsPer1000Km ?? 0, display: row.suppressed || !row.data ? (row.complementary ? 'oculto por segurança' : `oculto (< ${min})`) : `${nf(row.data.reportsPer1000Km, 2)} /1.000 km`, muted: row.suppressed,
  }));

  return (
    <section className="eqRoot obsRoot">
      <header className="eqTop">
        <div className="eqTitle"><h2>Observatório Panzeri Run</h2><p>Comportamento agregado da comunidade de corredoras. Associações descritivas, não causa; nenhum dado individual.</p></div>
        <div className="eqTopActions">
          <button type="button" className="eqPeriod" onClick={() => { setDraft(applied); setSheet(true); }} title="Alterar período e filtros"><CalendarDays size={15} aria-hidden="true" /><span><b>{dm(applied.from)} – {dmy(applied.to)}</b><small>{nf(days)} dias · semanas de segunda a domingo</small></span></button>
          <button type="button" className="eqBtn primary" onClick={() => { setDraft(applied); setSheet(true); }}><SlidersHorizontal size={15} aria-hidden="true" /> Filtros{chips.length ? <span className="eqBadge">{chips.length}</span> : null}</button>
        </div>
      </header>

      {status.dataset === 'synthetic' ? <div className="obsSynth" role="status"><TriangleAlert size={16} aria-hidden="true" /><b>Dados sintéticos — estrutura em teste, nenhum dado real.</b> <span>Os números abaixo foram gerados para validar telas e cálculos e não descrevem as alunas.</span></div> : null}

      <div className="eqBar"><div className="eqTabs" role="tablist" aria-label="Áreas do Observatório">{tabs.map(([id, text, icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{icon}{text}</button>)}</div></div>

      {chips.length > 0 ? (
        <div className="eqActive" aria-label="Filtros ativos">
          {chips.map((chip) => <button key={chip.key} type="button" className="eqTag" onClick={chip.remove} title="Remover este filtro"><small>{chip.group}</small>{chip.text}<span aria-hidden="true">×</span></button>)}
          <button type="button" className="eqLinkBtn" onClick={clearAll}>Limpar todos</button>
        </div>
      ) : null}

      {state === 'error' ? <p className="eqError" role="alert">{message} <button type="button" className="eqLinkBtn" onClick={() => void run(applied)}>Tentar de novo</button></p> : null}
      {state === 'loading' && !r ? <div className="eqSkeleton" aria-label="Carregando"><span /><span /><span /><span /></div> : null}

      {r ? (
        <div className={`eqBody${state === 'loading' ? ' eqBusy' : ''}`}>
          {r.overview.belowMinimum ? <Empty icon={<ShieldCheck size={22} />} title={`Menos de ${min} participantes neste recorte`} text="Para proteger as alunas, nada é mostrado quando poucas pessoas compõem o resultado. Relaxe algum filtro ou amplie o período." /> : null}

          {!r.overview.belowMinimum && tab === 'panorama' ? (
            <>
              <div className="eqKpis">
                <Kpi icon={<Users size={16} />} label="Participantes" value={r.overview.participants} hint="alunas distintas com semanas completas no recorte" />
                <Kpi icon={<Activity size={16} />} label="Treinos de corrida" value={r.overview.trainings} hint="eventos físicos deduplicados, só corrida" />
                <Kpi icon={<Gauge size={16} />} label="Quilômetros" value={r.overview.km} suffix="km" hint="soma dos treinos de corrida elegíveis" />
                <Kpi icon={<CalendarDays size={16} />} label="Semanas corridas" value={Math.round((new Date(`${r.period.to}T12:00:00Z`).getTime() - new Date(`${r.period.from}T12:00:00Z`).getTime()) / 86_400_000 / 7 + 1 / 7)} hint={`do calendário, de segunda a domingo, de ${r.period.from.split('-').reverse().join('/')} a ${r.period.to.split('-').reverse().join('/')} · a semana atual fica de fora`} />
              </div>
              <Card wide title="Distribuição do volume semanal" subtitle="Alunas por faixa de km semanal (semanas corridas do calendário, segunda a domingo, data de execução)">
                <Columns data={volumeColumns} unit="alunas" emptyTitle="Sem semanas corridas" emptyText="Nenhuma aluna tem corrida neste recorte." />
                {hiddenVolume > 0 ? <p className="eqFine">{hiddenVolume} faixa(s) com menos de {min} participantes ficam ocultas na tabela e no gráfico.</p> : null}
              </Card>
              <Table caption="Volume semanal por faixa" head={['Faixa', 'Alunas', 'Km acumulados', 'Km médio por semana corrida']}>
                {volumeRows.map((row) => (
                  <tr key={row.key}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
                    {row.suppressed || !row.data ? <td colSpan={2}><Hidden row={row} min={min} /></td> : <><td>{nf(row.data.km, 0)} km</td><td>{nf(row.data.avgKmPerWeek, 1)} km</td></>}
                  </tr>
                ))}
                {r.volume.total ? <tr className="obsTotal"><td><b>Total</b></td><td>{nf(r.volume.total.participants)}</td><td>{nf(r.volume.total.km, 0)} km</td><td>—</td></tr> : <tr className="obsTotal"><td><b>Total</b></td><td colSpan={3}>—</td></tr>}
              </Table>
            </>
          ) : null}

          {!r.overview.belowMinimum && tab === 'treino' ? (
            <>
              <div className="obsModeBar">
                <Seg<Mode> value={applied.mode} label="Tipo de comparação" options={[['cross', 'Comparação entre grupos atuais'], ['cohort', 'Evolução de grupos fixos']]} onChange={(mode) => commit({ ...applied, mode })} />
                <p className="obsModeText">{applied.mode === 'cross'
                  ? 'Mostra, no mesmo período, como o pace difere entre as faixas de volume semanal de cada semana. É uma comparação entre grupos, não prova que o volume muda o pace: quem corre mais costuma ser mais experiente.'
                  : `Cada corredora é classificada pelas ${r.pace.cohort.baselineWeeks} primeiras semanas corridas do período (a partir de 01/08/2026) e permanece nesse grupo; o gráfico mostra o pace do grupo em cada semana do calendário depois disso. Ninguém é reclassificada com resultados futuros. Associação descritiva.`}</p>
              </div>

              {applied.mode === 'cross' ? (
                <>
                  <Card wide title="Pace por faixa de volume semanal" subtitle="Pace agregado = tempo total ÷ distância total dos treinos da faixa (não é a média dos paces). Menor = mais rápido.">
                    <HBars items={r.pace.cross.map((row) => ({ key: row.key, label: row.label, sub: row.suppressed ? 'menos participantes que o mínimo' : `${nf(row.participants)} participantes${row.data ? ` · ${nf(row.data.km, 0)} km` : ''}`, value: row.data?.pace?.secondsPerKm ?? 0, display: row.suppressed || !row.data ? (row.complementary ? 'oculto por segurança' : `oculto (< ${min})`) : row.data.pace?.label ?? '—', muted: row.suppressed || !row.data?.pace }))} empty="Sem pace calculável neste recorte" />
                  </Card>
                  <Table caption="Pace por faixa (comparação entre grupos atuais)" head={['Faixa', 'Participantes', 'Participantes com pace', 'Pace agregado (tempo total ÷ distância total)', 'Pace por participante: p25', 'Mediana', 'p75', 'Km', 'Treinos com tempo e distância']}>
                    {r.pace.cross.map((row) => (
                      <tr key={row.key}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
                        {row.suppressed || !row.data ? <td colSpan={7}><Hidden row={row} min={min} /></td> : <><td>{nf(row.data.participantsWithPace)}</td><td><b>{row.data.pace?.label ?? '—'}</b></td><td>{row.data.participantPace.p25 ?? '—'}</td><td>{row.data.participantPace.median ?? '—'}</td><td>{row.data.participantPace.p75 ?? '—'}</td><td>{nf(row.data.km, 0)}</td><td>{nf(row.data.paceEvents)}</td></>}
                      </tr>
                    ))}
                  </Table>
                </>
              ) : (
                <>
                  <Card wide title="Evolução do pace de grupos fixos" subtitle={`Uma linha por faixa de volume na linha de base (${r.pace.cohort.baselineWeeks} semanas). Eixo vertical: pace agregado (min/km; menor = mais rápido).`}>
                    <LineChart series={cohortSeries} xMax={Math.max(4, ...cohortSeries.flatMap((s) => s.points.filter((p) => p.y != null).map((p) => p.x)))} yFormat={(v) => paceText(v).replace('/km', '')} />
                    <div className="eqLegend">{cohortSeries.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
                    {cohortSuppressedPoints > 0 ? <p className="eqFine">{cohortSuppressedPoints} ponto(s) com menos de {min} participantes ficam ocultos e aparecem como lacuna na linha.</p> : null}
                    <p className="eqFine">{r.pace.cohort.eligibleParticipants == null ? `Menos de ${min} participantes têm as ${r.pace.cohort.baselineWeeks} semanas de linha de base.` : `${nf(r.pace.cohort.eligibleParticipants)} participantes têm todas as ${r.pace.cohort.baselineWeeks} semanas corridas de linha de base neste recorte.`}</p>
                  </Card>
                  <Table caption="Grupos fixos: linha de base e variação do pace" head={['Grupo fixo (faixa na linha de base)', 'Participantes no grupo', 'Km médio por semana (linha de base)', 'Pace na linha de base', 'Variação mediana do pace (primeiras 8 semanas seguintes)', 'Quartil 25', 'Quartil 75', 'Participantes com as duas medidas']}>
                    {r.pace.cohort.groups.map((row) => (
                      <tr key={row.key}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
                        {row.suppressed || !row.data ? <td colSpan={6}><Hidden row={row} min={min} /></td> : <><td>{nf(row.data.baselineAvgKm, 1)} km</td><td>{row.data.baselinePace?.label ?? '—'}</td>
                          {row.data.paceChange && row.data.paceChange.medianDeltaSecPerKm != null ? <><td><b>{signed(row.data.paceChange.medianDeltaSecPerKm)}</b></td><td>{signed(row.data.paceChange.p25)}</td><td>{signed(row.data.paceChange.p75)}</td></> : <td colSpan={3}>{row.data.paceChange ? <span className="obsHidden">oculto (menos de {min} participantes com as duas medidas)</span> : '—'}</td>}
                          <td>{row.data.paceChange && row.data.paceChange.medianDeltaSecPerKm == null ? `< ${min}` : nf(row.data.paceChange?.participants)}</td></>}
                      </tr>
                    ))}
                  </Table>
                  <p className="eqFine">Variação = pace agregado das 8 primeiras semanas seguintes menos o pace agregado da linha de base, por participante; negativo = ficou mais rápida. Mediana e quartis entre as participantes do grupo.</p>
                </>
              )}
            </>
          ) : null}

          {!r.overview.belowMinimum && tab === 'dor' ? (
            <>
              <div className="obsModeBar">
                <label className="obsSelect">Agrupar por
                  <select value={applied.groupBy} onChange={(e) => commit({ ...applied, groupBy: e.target.value as GroupBy })}>{GROUP_OPTIONS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
                </label>
                <p className="obsModeText">Mede a <b>dor marcada no feedback dos treinos de corrida</b> (sem dor, leve, moderada ou forte) em relação à quilometragem corrida — não a dor real, nem lesão. Treino sem relato conta como sem dor (zero operacional); os km desses treinos entram no denominador. O “Relatar dor” (nota 1 a 10) é analisado à parte, na aba Análise ampliada.</p>
              </div>
              {r.pain.overall ? (
                <>
                <div className="eqKpis obsKpis7">
                  {ins ? (
                    <>
                      <Kpi icon={<HeartPulse size={16} />} label="A · Treinos com dor no feedback (todos os tipos)" value={ins.segments.total?.painTrainings ?? null} hint={`de ${nf(ins.segments.total?.trainings)} treinos · ${nf(ins.segments.total?.painPer100Trainings, 2)} a cada 100 (${nf(ins.segments.total?.painPer100Trainings, 1)}%)`} />
                      <Kpi icon={<Gauge size={16} />} label="B · Corridas com dor por 1.000 km" value={ins.segments.runsCombined?.painPer1000Km ?? null} digits={2} hint={`só corrida (prescrita + extra), ${nf(ins.segments.runsCombined?.km, 0)} km com distância válida`} />
                      <Kpi icon={<Activity size={16} />} label="C · Intensidade média dos relatos após o treino" value={ins.segments.total?.meanLevelAmongPain ?? null} digits={2} hint="escala 0–3 do feedback, só treinos com dor (leve 1, moderada 2, forte 3)" />
                      <Kpi icon={<Activity size={16} />} label="C2 · Intensidade média dos relatos no Relatar dor" value={ins.standalone.overall?.meanIntensity ?? null} digits={1} hint={`nota de 1 a 10 · ${nf(ins.standalone.overall?.reports)} relatos`} />
                      <Kpi icon={<Activity size={16} />} label="D · Intensidade média geral por treino" value={ins.segments.total?.meanLevelAll ?? null} digits={2} hint="escala 0–3, treinos sem dor incluídos (zero)" />
                      <Kpi icon={<Gauge size={16} />} label="E · Pontos de intensidade por 1.000 km (corrida)" value={ins.segments.runsCombined?.levelPointsPer1000Km ?? null} digits={1} hint="soma da escala 0–3 do feedback ÷ km de corrida × 1.000" />
                      <Kpi icon={<Gauge size={16} />} label="E2 · Soma das notas do Relatar dor por 1.000 km" value={ins.standalone.notePointsPer1000RunKm} digits={1} hint="soma das notas 1–10 ÷ km de corrida × 1.000 (exposição)" />
                      <Kpi icon={<HeartPulse size={16} />} label="Total de relatos no Relatar dor" value={ins.standalone.overall?.reports ?? null} hint={`${nf(ins.standalone.overall?.participants)} alunas · analisado à parte`} />
                    </>
                  ) : null}
                  <Kpi icon={<ShieldCheck size={16} />} label="G · Cobertura de feedback" value={r.pain.overall.coverage.withFeedback} hint={`de ${nf(r.pain.overall.coverage.trainings)} treinos de corrida (${nf(r.pain.overall.coverage.trainings > 0 ? (r.pain.overall.coverage.withFeedback / r.pain.overall.coverage.trainings) * 100 : null, 0)}%); ${nf(r.pain.overall.coverage.withoutFeedback)} sem feedback`} />
                </div>
                <details className="obsDetails"><summary>O que é “elegível” nos números por 1.000 km?</summary>
                  <p className="eqFine">Entra: treino de corrida (prescrito ou extra) das semanas completas dentro do período, de alunas ativas e fora de conta de teste, deduplicado (o mesmo treino recebido do relógio e do Health Connect conta uma vez), com distância válida. Não entra: origem Strava (direta ou via Health Connect/Apple Saúde); identidade física ambígua; treino sem distância válida (conta como treino, mas não entra no km); registro manual que repete uma atividade importada; semana incompleta ou sem dados. Esses números aparecem na aba Qualidade dos dados.</p>
                </details>
                {ins ? <><PainDashboard ins={ins} /><WeeklyPainCharts w={ins.weekly} /></> : null}
                </>
              ) : null}
              {r.pain.overall ? <p className="eqFine">Origem dos zeros (auditoria, entram na métrica): {nf(r.pain.overall.zeroOrigins.explicitNoPain)} treinos com resposta explícita “sem dor” e {nf(r.pain.overall.zeroOrigins.noPainReport)} treinos sem relato de dor.</p> : null}
              <Card wide title="Treinos com dor por nível, a cada 1.000 km" subtitle={`Grupos: ${r.pain.groupLabel}. Dor marcada no feedback do treino de corrida (leve, moderada ou forte). Cada coluna é a taxa por 1.000 km corridos pelo grupo.`}>
                <GroupedColumns clusters={painClusters} groups={painGroupDefs} />
                {hiddenPain > 0 ? <p className="eqFine">{hiddenPain} grupo(s) com menos de {min} participantes ficam ocultos no gráfico e na tabela.</p> : null}
              </Card>
              {painTable(`Dor por grupo — ${r.pain.groupLabel}`, r.pain.rows, true)}
              <Card wide title="Exposição anterior" subtitle="Comportamento dos 28 dias ANTERIORES ao treino (nunca dados posteriores ao relato). Dados anteriores ao treino; associação, não causa.">
                <h4 className="eqH4">Volume semanal médio dos 28 dias anteriores · relatos por 1.000 km</h4>
                <HBars items={priorBars(r.pain.prior.volume)} empty="Sem histórico anterior suficiente" />
                <h4 className="eqH4">Sessões de força por semana (média dos 28 dias anteriores) · relatos por 1.000 km</h4>
                <HBars items={priorBars(r.pain.prior.strength)} empty="Sem histórico anterior suficiente" />
                <details className="obsDetails"><summary>Tabelas da exposição anterior</summary>{painTable('Volume dos 28 dias anteriores', r.pain.prior.volume, false)}{painTable('Força dos 28 dias anteriores', r.pain.prior.strength, false)}</details>
              </Card>
              <Card wide title="Dimensões em preparação" subtitle="Ainda sem dados confiáveis integrados: nenhum gráfico é mostrado para elas.">
                <ul className="obsPending">{r.pain.pendingDimensions.map((d) => <li key={d.id}><b>{d.label}</b><span>{d.reason}</span></li>)}</ul>
              </Card>
            </>
          ) : null}

          {!r.overview.belowMinimum && tab === 'tipos' && r.insights ? <TiposTab ins={r.insights} min={min} /> : null}
          {!r.overview.belowMinimum && tab === 'relatar' && r.insights ? <RelatarTab ins={r.insights} min={min} /> : null}
          {!r.overview.belowMinimum && tab === 'ciclo' && r.insights ? <CicloTab ins={r.insights} min={min} /> : null}

          {tab === 'qualidade' ? <QualityTab r={r} /> : null}

          <aside className="eqNotes" aria-label="Como ler">
            <strong>Como ler</strong>
            <ul>
              <li>Estatística descritiva: diferenças entre grupos são associações, não efeito do treino ou do equipamento.</li>
              <li>Semanas de segunda a domingo, pela data de execução do treino (não a programada). Só semanas completas entram nas faixas.</li>
              <li>Pace agregado = tempo total ÷ distância total. A média simples dos paces é outra métrica e não é usada aqui.</li>
              <li>Atividades do Strava (inclusive por origem indireta) e de identidade ambígua ficam fora dos totais principais.</li>
            </ul>
            <small>Atualizado em {new Date(r.dataAsOf).toLocaleString('pt-BR')}</small>
          </aside>
        </div>
      ) : null}

      {sheet ? (
        <SheetFrame title="Filtros" subtitle="Todos valem ao mesmo tempo (E). O período é livre." onClose={() => { setDraft(applied); setSheet(false); }}
          footer={<><button type="button" className="eqBtn ghost" onClick={() => setDraft({ ...emptyFilters(), from: draft.from, to: draft.to, mode: draft.mode, groupBy: draft.groupBy })}>Limpar filtros</button><button type="button" className="eqBtn primary" onClick={() => { commit(draft); setSheet(false); }}>{JSON.stringify(draft) !== JSON.stringify(applied) ? 'Aplicar filtros' : 'Fechar'}</button></>}>
          <fieldset className="eqField">
            <legend><CalendarDays size={14} aria-hidden="true" /> Período</legend>
            <div className="eqDates">
              <label>De<input type="date" value={draft.from} max={draft.to} onChange={(e) => patch({ from: e.target.value })} /></label>
              <label>Até<input type="date" value={draft.to} max={localToday()} onChange={(e) => patch({ to: e.target.value })} /></label>
            </div>
            <div className="eqChips">{([[8, '8 semanas'], [13, '13 semanas'], [26, '26 semanas'], [52, '52 semanas']] as Array<[number, string]>).map(([weeks, text]) => <button key={text} type="button" className="eqChip" onClick={() => shortcut(weeks)}>{text}</button>)}</div>
          </fieldset>
          <ChipGroup label="Faixa de rodagem semanal" options={VOLUME_OPTIONS} selected={draft.volumeBands} onChange={(n) => patch({ volumeBands: n })} showCount={false} />
          <ChipGroup label="Faixa etária" options={AGE_OPTIONS} selected={draft.ageBands} onChange={(n) => patch({ ageBands: n })} showCount={false} />
          <ChipGroup label="Treinos de força na semana" options={STRENGTH_OPTIONS} selected={draft.strengthBands} onChange={(n) => patch({ strengthBands: n })} showCount={false} />
          <ChipGroup label="Sexo (quando informado)" options={SEX_OPTIONS} selected={draft.sexes} onChange={(n) => patch({ sexes: n })} showCount={false} />
          <label className="eqSwitch obsCheck"><input type="checkbox" checked={draft.includeZeroWeeks} onChange={(e) => patch({ includeZeroWeeks: e.target.checked })} /><span>Contar semanas sem treino registrado como 0 km (entre a primeira e a última semana com treino da aluna)</span></label>
          <p className="eqFine">Na evolução de grupos fixos, o filtro de força não se aplica; faixa de rodagem refere-se à linha de base.</p>
        </SheetFrame>
      ) : null}
    </section>
  );
}

const paceLabel = (pace: Pace) => (pace ? pace.label : '—');

const pct = (value: number | null | undefined, digits = 1) => (value == null ? '—' : `${nf(value, digits)}%`);
const lmf = (m: { levels: { leve: number; moderado: number; forte: number } }) => `${nf(m.levels.leve)} / ${nf(m.levels.moderado)} / ${nf(m.levels.forte)}`;
const cellText = (c: AdherenceCell | undefined) => (c && c.scheduled > 0 ? `${nf(c.registered)}/${nf(c.scheduled)} (${pct(c.ratePct, 0)})` : '—');

// Dor por tipo de treino (feedback do treino), corridas por distância e alunas por volume (26/11/2026). Só agregados protegidos; descritivo, não causa.
// Evolução semanal: uma linha por tipo de treino (cores fixas), semanas de segunda a domingo do período escolhido no botão de datas.
function weeklyLines(w: WeeklySeries, keys: string[], pick: (p: WeeklyPoint) => number | null): WeeklyLine[] {
  return keys.map((k) => ({ key: k, label: SEG_SHORT[k] ?? k, color: SEG_COLOR[k] ?? '#2a78d6', values: (w.segments.find((s) => s.key === k)?.points ?? []).map(pick) }));
}
function WeeklyCard({ title, subtitle, weeks, lines, unit, digits = 1 }: { title: string; subtitle: string; weeks: string[]; lines: WeeklyLine[]; unit?: string; digits?: number }) {
  return (
    <Card title={title} subtitle={subtitle}>
      <WeeklyChart weeks={weeks} lines={lines} unit={unit} format={(v) => nf(v, digits)} height={210} />
      <Legend lines={lines} />
    </Card>
  );
}
function WeeklyPainCharts({ w }: { w: WeeklySeries }) {
  const weeks = w.segments[0]?.points.map((p) => p.week) ?? [];
  const keys = ['corridas', 'musculacao', 'fortalecimento', 'extra_corrida', 'extra_geral'];
  const sub = 'Semanas de segunda a domingo; o período é o do botão de datas.';
  return (
    <div className="obwGrid2">
      <WeeklyCard title="Evolução semanal · treinos com dor a cada 100 treinos" subtitle={sub} weeks={weeks} lines={weeklyLines(w, [...keys, 'total'], (p) => p.painPer100)} unit="/100 treinos" />
      <WeeklyCard title="Evolução semanal · pontos de intensidade a cada 100 treinos" subtitle={`Soma da escala 0–3 do feedback ÷ treinos × 100. ${sub}`} weeks={weeks} lines={weeklyLines(w, [...keys, 'total'], (p) => p.levelPointsPer100)} unit="pts/100 treinos" />
      <WeeklyCard title="Evolução semanal · corridas com dor por 1.000 km" subtitle={`Só corrida (prescrita + extra). ${sub}`} weeks={weeks}
        lines={[...weeklyLines(w, ['corridas'], (p) => p.painPer1000Km), { key: 'relatar', label: 'Relatar dor: relatos por 1.000 km (exposição)', color: '#eb6834', values: w.relatar.map((p) => p.reportsPer1000Km) }]} unit="/1.000 km" digits={2} />
      <WeeklyCard title="Evolução semanal · intensidade média dos treinos com dor (0–3)" subtitle={sub} weeks={weeks} lines={weeklyLines(w, keys, (p) => p.meanLevelAmongPain)} unit="escala 0–3" digits={2} />
    </div>
  );
}
function WeeklyRelatarCharts({ w }: { w: WeeklySeries }) {
  const weeks = w.relatar.map((p) => p.week);
  const sub = 'Relatar dor, à parte; semanas de segunda a domingo.';
  return (
    <div className="obwGrid2">
      <WeeklyCard title="Evolução semanal · relatos no Relatar dor" subtitle={sub} weeks={weeks} lines={[{ key: 'r', label: 'Relatos na semana', color: '#eb6834', values: w.relatar.map((p) => p.reports) }]} unit="relatos" digits={0} />
      <WeeklyCard title="Evolução semanal · nota média do Relatar dor (1–10)" subtitle={sub} weeks={weeks} lines={[{ key: 'n', label: 'Nota média', color: '#e34948', values: w.relatar.map((p) => p.meanNote) }]} unit="nota" digits={1} />
      <WeeklyCard title="Evolução semanal · relatos por 1.000 km e a cada 100 treinos (exposição)" subtitle={`Relatos da semana ÷ volume da mesma semana; não atribui o relato a um treino. ${sub}`} weeks={weeks}
        lines={[{ key: 'km', label: 'Relatos por 1.000 km de corrida', color: '#6250d6', values: w.relatar.map((p) => p.reportsPer1000Km) }, { key: 't', label: 'Relatos a cada 100 treinos (todos os tipos)', color: '#1baf7a', values: w.relatar.map((p) => p.reportsPer100Trainings) }]} digits={2} />
    </div>
  );
}

function TiposTab({ ins, min }: { ins: Insights; min: number }) {
  const hidden = (row: { suppressed: boolean; complementary: boolean }, cols: number) => <td colSpan={cols}><Hidden row={row} min={min} /></td>;
  const painCells = (m: SegmentRow) => (
    <><td>{nf(m.trainings)}</td><td>{nf(m.withFeedback)}</td><td>{nf(m.painTrainings)}</td><td>{nf(m.painPer100Trainings, 2)}</td><td>{lmf(m)}</td><td>{nf(m.meanLevelAmongPain, 2)}</td><td>{nf(m.meanLevelAll, 2)}</td><td>{nf(m.levelPointsPer100Trainings, 1)}</td><td>{nf(m.km, 0)}</td><td>{nf(m.painPer1000Km, 2)}</td><td>{nf(m.levelPointsPer1000Km, 1)}</td></>
  );
  const exposureCells = (m: SegmentRow) => <><td>{nf(m.trainings)}</td><td>{nf(m.relatar.reportsPer100Trainings, 2)}</td><td>{nf(m.relatar.notePointsPer100Trainings, 1)}</td><td>{nf(m.relatar.reportsPer1000Km, 2)}</td><td>{nf(m.relatar.notePointsPer1000Km, 1)}</td></>;
  const seg = ins.segments;
  return (
    <>
      <p className="eqFine">{ins.scopeNote}</p>
      <Table caption="Dor por tipo de treino (marcada no feedback do treino)" head={['Tipo de treino', 'Alunas', 'Treinos', 'Com feedback', 'Treinos com dor', 'Com dor a cada 100 treinos', 'Leve / moderada / forte', 'Intensidade média, só com dor (0–3)', 'Intensidade média geral (0–3)', 'Pontos a cada 100 treinos', 'Km', 'Com dor / 1.000 km', 'Pontos / 1.000 km']}>
        {seg.rows.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 11) : painCells(row.data)}</tr>)}
        {seg.runsCombined ? <tr><td><b>Corridas (prescrita + extra)</b></td><td>—</td>{painCells(seg.runsCombined)}</tr> : null}
        {seg.total ? <tr><td><b>Todos os tipos</b></td><td>—</td>{painCells(seg.total)}</tr> : null}
      </Table>
      <p className="eqFine">Intensidade do treino = escala 0 a 3 do feedback (sem dor 0, leve 1, moderada 2, forte 3), a mesma da Evolução. “Pontos” = soma dessa escala. Km e “por 1.000 km” só têm sentido para corrida (treinos sem distância válida ficam fora do km).</p>
      <Table caption="“Relatar dor” como taxa de exposição por tipo de treino (não atribui o relato ao treino)" head={['Tipo de treino', 'Treinos', 'Relatos a cada 100 treinos', 'Soma das notas a cada 100 treinos', 'Relatos / 1.000 km (corrida)', 'Soma das notas / 1.000 km (corrida)']}>
        {seg.rows.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td>{row.suppressed || !row.data ? hidden(row, 5) : exposureCells(row.data)}</tr>)}
        {seg.runsCombined ? <tr><td><b>Corridas (prescrita + extra)</b></td>{exposureCells(seg.runsCombined)}</tr> : null}
        {seg.total ? <tr><td><b>Todos os tipos</b></td>{exposureCells(seg.total)}</tr> : null}
      </Table>
      <Table caption="Corridas por faixa de distância (prescritas e extras)" head={['Distância da corrida', 'Alunas', 'Corridas', 'Das quais extras', 'Km', 'Pace (tempo total ÷ distância total)', 'Corridas com dor', 'Com dor a cada 10 corridas', 'Intensidade média, só com dor (0–3)', 'Intensidade média geral (0–3)', 'Leve / moderada / forte']}>
        {ins.runsByDistance.rows.map((row) => (
          <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}>
            <td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
            {row.suppressed || !row.data ? hidden(row, 9) : <><td>{nf(row.data.runs)}</td><td>{nf(row.data.extraRuns)}</td><td>{nf(row.data.km, 0)}</td><td>{paceLabel(row.data.pace)}</td><td>{nf(row.data.pain.painTrainings)}</td><td>{nf(row.data.pain.painPer10Trainings, 2)}</td><td>{nf(row.data.pain.meanLevelAmongPain, 2)}</td><td>{nf(row.data.pain.meanLevelAll, 2)}</td><td>{lmf(row.data.pain)}</td></>}
          </tr>
        ))}
      </Table>
      {ins.runsByDistance.runsWithoutDistance > 0 ? <p className="eqFine">{nf(ins.runsByDistance.runsWithoutDistance)} corrida(s) sem distância válida ficam fora desta tabela.</p> : null}
      <Table caption={`Alunas por volume semanal — últimas 10 semanas (${dmy(ins.weeklyVolume.weeks.from)} a ${dmy(ins.weeklyVolume.weeks.to)})`} head={['Faixa (elegível em ≥ 7 das 10 semanas)', 'Alunas']}>
        {ins.weeklyVolume.rows.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td>{row.suppressed || !row.data ? hidden(row, 1) : <td>{nf(row.data.students)}</td>}</tr>)}
        {ins.weeklyVolume.studentsWithRuns != null ? <tr><td><b>Total com corrida nas 10 semanas</b></td><td>{nf(ins.weeklyVolume.studentsWithRuns)}</td></tr> : null}
      </Table>
      <p className="eqFine">{ins.weeklyVolume.note}</p>
    </>
  );
}

// "Relatar dor" (nota 1–10 e local), analisado à parte.
function RelatarTab({ ins, min }: { ins: Insights; min: number }) {
  const sr = ins.standalone;
  const hidden = (row: { suppressed: boolean; complementary: boolean }, cols: number) => <td colSpan={cols}><Hidden row={row} min={min} /></td>;
  const segCols = ins.segments.rows;
  const matrix = (caption: string, pick: 'reportsPer100' | 'notePointsPer100', digits: number) => (
    <Table caption={caption} head={['Local', ...segCols.map((s) => s.label)]}>
      {sr.locationBySegment.map((loc) => (
        <tr key={loc.key} className={loc.suppressed ? 'obsRowHidden' : undefined}><td><b>{loc.label}</b></td>{loc.suppressed ? <td colSpan={segCols.length}>oculto (&lt; {min} alunas)</td> : segCols.map((s) => <td key={s.key}>{nf(loc.cells[s.key as keyof typeof loc.cells]?.[pick], digits)}</td>)}</tr>
      ))}
    </Table>
  );
  return (
    <>
      <Card wide title="Relatar dor — visão geral" subtitle={sr.note}>
        {sr.overall ? (
          <div className="eqKpis">
            <Kpi icon={<HeartPulse size={16} />} label="Total de relatos (Relatar dor)" value={sr.overall.reports} hint={`${nf(sr.overall.participants)} alunas`} />
            <Kpi icon={<Gauge size={16} />} label="Intensidade média dos relatos (1 a 10)" value={sr.overall.meanIntensity} digits={1} hint="média das notas do Relatar dor" />
            <Kpi icon={<Activity size={16} />} label="Soma das notas" value={sr.overall.notePoints} hint="notas somadas, todos os relatos" />
            <Kpi icon={<Gauge size={16} />} label="Relatos por 1.000 km corridos" value={sr.reportsPer1000RunKm} digits={2} hint={`sobre ${nf(sr.runKm, 0)} km de corrida do mesmo grupo`} />
            <Kpi icon={<Activity size={16} />} label="Soma das notas por 1.000 km" value={sr.notePointsPer1000RunKm} digits={1} hint="índice descritivo (corrida)" />
          </div>
        ) : <Empty title="Sem relatos no período" />}
      </Card>
      <WeeklyRelatarCharts w={ins.weekly} />
      {sr.overall ? (
        <Table caption="Relatos por faixa de nota" head={['Faixa', 'Relatos', '% dos relatos']}>
          {sr.overall.bins.map((b) => <tr key={b.key}><td><b>{b.label}</b></td><td>{nf(b.count)}</td><td>{pct(b.pct)}</td></tr>)}
        </Table>
      ) : null}
      <Table caption="Relatos por local da dor" head={['Local', 'Alunas', 'Relatos', 'Nota média (1–10)', 'Soma das notas', 'Relatos / 1.000 km', 'Notas / 1.000 km', 'Relatos a cada 100 treinos', 'Notas a cada 100 treinos']}>
        {sr.locations.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 7) : <><td>{nf(row.data.reports)}</td><td>{nf(row.data.meanNote, 1)}</td><td>{nf(row.data.notePoints)}</td><td>{nf(row.data.reportsPer1000RunKm, 2)}</td><td>{nf(row.data.notePointsPer1000RunKm, 1)}</td><td>{nf(row.data.reportsPer100Trainings, 2)}</td><td>{nf(row.data.notePointsPer100Trainings, 1)}</td></>}</tr>)}
      </Table>
      <p className="eqFine">Os locais são os que o Panzeri Run coleta hoje (joelho, tornozelo, pé, canela, panturrilha, coxa, quadril, glúteo, lombar/coluna). Direito e esquerdo ficam juntos aqui e separados na tabela de lado abaixo. Ainda não coletamos a parte do joelho (interno, externo, patela); isso exige uma pergunta nova no Relatar dor.</p>
      <Table caption="Relatos por lado (quando a aluna informou o lado)" head={['Local · lado', 'Alunas', 'Relatos', 'Nota média (1–10)']}>
        {sr.sides.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 2) : <><td>{nf(row.data.reports)}</td><td>{nf(row.data.meanNote, 1)}</td></>}</tr>)}
      </Table>
      {matrix('Local da dor × tipo de treino — relatos a cada 100 treinos do tipo (exposição)', 'reportsPer100', 2)}
      {matrix('Local da dor × tipo de treino — soma das notas a cada 100 treinos do tipo (exposição)', 'notePointsPer100', 1)}
    </>
  );
}

// Fases do ciclo: dor, "Relatar dor", adesão, km e local.
function CicloTab({ ins, min }: { ins: Insights; min: number }) {
  const c = ins.cycle;
  const hidden = (row: { suppressed: boolean; complementary: boolean }, cols: number) => <td colSpan={cols}><Hidden row={row} min={min} /></td>;
  const block = (title: string, group: CycleGroup) => (
    <>
      <h3 className="eqH4">{title}</h3>
      <Table caption={`${title} — treinos e dor do treino (feedback)`} head={['Fase', 'Alunas', 'Dias-aluna', 'Treinos', 'Treinos com dor a cada 100 treinos', 'Intensidade média, só com dor (0–3)', 'Leve / moderada / forte']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 5) : <><td>{nf(row.data.participantDays)}</td><td>{nf(row.data.trainings)}</td><td>{nf(row.data.pain.painPer100Trainings, 2)}</td><td>{nf(row.data.pain.meanLevelAmongPain, 2)}</td><td>{lmf(row.data.pain)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} — Relatar dor por fase`} head={['Fase', 'Relatos', 'Relatos a cada 100 treinos', 'Relatos a cada 100 km', 'Nota média (1–10)', 'Soma das notas a cada 100 treinos', 'Soma das notas a cada 100 km']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td>{row.suppressed || !row.data ? hidden(row, 6) : <><td>{nf(row.data.relatar.reports)}</td><td>{nf(row.data.relatar.reportsPer100Trainings, 2)}</td><td>{nf(row.data.relatar.reportsPer100Km, 2)}</td><td>{nf(row.data.relatar.meanNote, 1)}</td><td>{nf(row.data.relatar.notePointsPer100Trainings, 1)}</td><td>{nf(row.data.relatar.notePointsPer100Km, 1)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} — adesão por fase (registrados ÷ programados)`} head={['Fase', 'Geral', 'Corrida', 'Fortalecimento', 'Musculação', 'Outras modalidades']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td>{row.suppressed || !row.data ? hidden(row, 5) : <><td>{cellText(row.data.adherence.all)}</td><td>{cellText(row.data.adherence.bySegment.corrida)}</td><td>{cellText(row.data.adherence.bySegment.fortalecimento)}</td><td>{cellText(row.data.adherence.bySegment.musculacao)}</td><td>{cellText(row.data.adherence.bySegment.outras)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} — km e pace por fase`} head={['Fase', 'Corridas', 'Km', 'Km por corrida', 'Km por aluna por semana', 'Pace da corrida']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td>{row.suppressed || !row.data ? hidden(row, 5) : <><td>{nf(row.data.runs)}</td><td>{nf(row.data.runKm, 0)}</td><td>{nf(row.data.avgKmPerRun, 1)}</td><td>{nf(row.data.kmPerParticipantWeek, 1)}</td><td>{paceLabel(row.data.runPace)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} — local da dor × fase (relatos · nota média · relatos a cada 100 treinos da fase)`} head={['Local', ...group.phases.map((p) => p.label)]}>
        {group.locations.map((loc) => (
          <tr key={loc.key} className={loc.suppressed ? 'obsRowHidden' : undefined}><td><b>{loc.label}</b></td>{loc.suppressed ? <td colSpan={4}>oculto (&lt; {min} alunas)</td> : group.phases.map((p) => { const cell = loc.cells[p.phase as keyof typeof loc.cells]; return <td key={p.phase}>{cell ? `${nf(cell.reports)} · ${nf(cell.meanNote, 1)} · ${nf(cell.reportsPer100Trainings, 1)}` : '—'}</td>; })}</tr>
        ))}
      </Table>
    </>
  );
  return (
    <>
      <Card wide title="Fases do ciclo menstrual" subtitle="Só alunas que registraram o ciclo. Fase estimada; descritivo, não causa.">
        <ul className="obsPending">{c.notes.map((n) => <li key={n}><span>{n}</span></li>)}</ul>
        <p className="eqFine">{nf(c.participantsWithCycle)} aluna(s) com ciclo registrado; {nf(c.participantsWithEstimatedPhases)} com fase estimada em parte do histórico; {nf(c.trainingsOutsideCycle)} treino(s) fora de qualquer ciclo registrado.</p>
      </Card>
      {block('Ciclo natural (sem anticoncepcional hormonal)', c.natural)}
      {block('Com anticoncepcional hormonal (fase só estimada)', c.hormonal)}
    </>
  );
}

function QualityTab({ r }: { r: Result }) {
  const q = r.quality;
  const rows: Array<[string, number | string, string]> = [
    ['Treinos de corrida elegíveis', q.eligibleTrainings, 'eventos físicos deduplicados que entram nas análises'],
    ['— de atividade importada (relógio/aplicativo)', q.activityTrainings, 'um evento por treino, mesmo recebido de duas fontes'],
    ['— registrados à mão pela aluna', q.manualTrainings, 'autorrelato sem atividade importada'],
    ['Treinos sem distância válida', q.trainingsWithoutDistance, 'contam como treino, mas não entram na soma de km'],
    ['Excluídos: origem Strava (direta ou indireta)', q.stravaExcludedEvents, 'restrição de uso do provedor: não alimentam o Observatório'],
    ['Excluídos: identidade física ambígua', q.ambiguousIdentityEvents, 'ficam fora dos totais principais até a identidade ser resolvida'],
    ['Incluídos, mas com identidade não avaliada', q.unevaluatedIdentityEvents, 'dados legados sem avaliação de identidade; entram sinalizados'],
    ['Treinos manuais que repetiam atividade importada', q.duplicateManualEvents, 'descartados para não contar o mesmo treino duas vezes'],
    ['Conflitos: relato de dor no treino marcado “sem dor”', q.painConflicts, 'prevalece o relato de dor'],
    ['Participantes fora por causa dos filtros', q.participantsExcludedByFilters, 'efeito dos filtros escolhidos'],
  ];
  return (
    <>
      <div className="eqKpis">
        <Kpi icon={<ShieldCheck size={16} />} label="Treinos elegíveis" value={q.eligibleTrainings} hint={`${nf(q.activityTrainings)} de atividade importada e ${nf(q.manualTrainings)} manuais`} />
        <Kpi icon={<TriangleAlert size={16} />} label="Excluídos (Strava + ambíguos)" value={q.stravaExcludedEvents + q.ambiguousIdentityEvents} hint="fora dos totais principais" />
        <Kpi icon={<Info size={16} />} label="Conflitos de dor no mesmo treino" value={q.painConflicts} hint="prevalece a dor marcada" />
      </div>
      <Table caption="Qualidade e cobertura dos dados" head={['Item', 'Quantidade', 'O que significa']}>
        {rows.map(([label, value, hint]) => <tr key={label}><td><b>{label}</b></td><td>{typeof value === 'number' ? nf(value) : value}</td><td>{hint}</td></tr>)}
      </Table>
      <Card wide title="Procedência, período e atualização">
        <dl className="obsDl">
          <div><dt>Tipo de dado</dt><dd>{r.dataset === 'synthetic' ? 'Sintético (teste)' : 'Real'}</dd></div>
          <div><dt>Período analisado</dt><dd>{dmy(r.period.from)} a {dmy(r.period.to)}</dd></div>
          <div><dt>Atualizado em</dt><dd>{new Date(r.dataAsOf).toLocaleString('pt-BR')}</dd></div>
          <div><dt>Restrição de origem</dt><dd>Strava (inclusive via Health Connect/Apple Saúde) não alimenta este produto</dd></div>
        </dl>
        <p className="eqFine">{q.note}</p>
      </Card>
    </>
  );
}
