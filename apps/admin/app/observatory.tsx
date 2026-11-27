'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, CalendarDays, Gauge, HeartPulse, Info, ShieldCheck, SlidersHorizontal, TriangleAlert, Users } from 'lucide-react';
import { Card, ChipGroup, Columns, Empty, HBars, Kpi, SheetFrame, nf } from './viz';
import type { HItem, Option } from './viz';

// ObservatÃ³rio Panzeri Run (24/10/2026). SOMENTE LEITURA e SÃ“ AGREGADOS: GET /observatory/status e /observatory/analysis. Nenhum nome, e-mail ou id de aluna chega aqui.
// EstatÃ­stica descritiva: o que aparece sÃ£o associaÃ§Ãµes entre grupos, nÃ£o causa. Cada nÃºmero diz seu denominador (alunas, treinos, relatos ou km). Semanas sÃ£o sempre as do calendÃ¡rio (segunda a domingo), nunca somadas entre alunas.
// CÃ©lulas com poucos participantes chegam suprimidas da API e aqui aparecem como "oculto" â€” nunca como zero.

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ tipos (espelham o contrato da API; apps/api/src/observatory/observatory-engine.ts) â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
type Insights = {
  scopeNote: string;
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ opÃ§Ãµes dos filtros (mesmas faixas do contrato da API) â”€â”€â”€â”€â”€â”€â”€â”€â”€
const opt = (value: string, label: string): Option => ({ value, label, students: 0 });
const VOLUME_OPTIONS = [opt('v1', 'AtÃ© 20 km'), opt('v2', '20 a 40 km'), opt('v3', '40 a 60 km'), opt('v4', '60 a 90 km'), opt('v5', '90 a 120 km'), opt('v6', '120 a 160 km'), opt('v7', '160 a 200 km'), opt('v8', 'Acima de 200 km')];
const AGE_OPTIONS = [opt('lt30', 'Menos de 30'), opt('30_39', '30 a 39'), opt('40_49', '40 a 49'), opt('50_59', '50 a 59'), opt('60_69', '60 a 69'), opt('70p', '70 ou mais'), opt('unk', 'NÃ£o informado')];
const STRENGTH_OPTIONS = [opt('s0', 'Nenhuma sessÃ£o de forÃ§a'), opt('s1', '1 sessÃ£o de forÃ§a'), opt('s2p', '2 ou mais sessÃµes de forÃ§a')];
const SEX_OPTIONS = [opt('F', 'Feminino'), opt('M', 'Masculino'), opt('other', 'Outro'), opt('unknown', 'NÃ£o informado')];
const GROUP_OPTIONS: Array<[GroupBy, string]> = [['volume', 'Volume semanal'], ['age', 'Faixa etÃ¡ria'], ['strength', 'ForÃ§a na semana'], ['sex', 'Sexo'], ['priorVolume', 'Volume dos 28 dias anteriores'], ['priorStrength', 'ForÃ§a dos 28 dias anteriores']];
// paleta categÃ³rica em ordem fixa (cor segue a entidade, nunca o ranking)
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const COLOR_INDEX: Record<string, number> = { v1: 0, v2: 1, v3: 2, v4: 3, v5: 4, v6: 5, v7: 6, v8: 7 };

const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const addDays = (date: string, days: number) => new Date(new Date(`${date}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const emptyFilters = (): Filters => ({ from: '2026-08-01', to: localToday(), volumeBands: [], ageBands: [], strengthBands: [], sexes: [], mode: 'cross', groupBy: 'volume', includeZeroWeeks: true });
const paceText = (seconds: number | null | undefined) => (seconds == null ? 'â€”' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km`);
const signed = (value: number | null | undefined) => (value == null ? 'â€”' : `${value > 0 ? '+' : value < 0 ? 'âˆ’' : ''}${Math.abs(value)} s/km`);

function toQuery(f: Filters): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string | string[]) => { const text = Array.isArray(value) ? value.join(',') : value; if (text) params.set(key, text); };
  put('from', f.from); put('to', f.to); put('volumeBands', f.volumeBands); put('ageBands', f.ageBands); put('strengthBands', f.strengthBands); put('sexes', f.sexes);
  put('mode', f.mode); put('groupBy', f.groupBy); if (!f.includeZeroWeeks) params.set('includeZeroWeeks', 'false');
  return params.toString();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ cÃ©lula suprimida: nunca vira zero â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Hidden({ row, min }: { row: { suppressed: boolean; complementary: boolean }; min: number }) {
  return <span className="obsHidden" title={row.complementary ? 'Ocultado por seguranÃ§a: mostrar este valor permitiria reconstruir outro grupo pequeno por diferenÃ§a.' : `Menos de ${min} participantes neste grupo: valor oculto para nÃ£o expor uma aluna.`}>{row.complementary ? 'oculto por seguranÃ§a' : `oculto (menos de ${min} participantes)`}</span>;
}
// O tamanho de um grupo suprimido tambem nao e' mostrado (so' "< N"): o numero exato revelaria o tamanho da celula pequena.
const pcount = (row: { participants: number | null; suppressed: boolean }, min: number) => (row.suppressed || row.participants == null ? `< ${min}` : nf(row.participants));
const Table = ({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) => (
  <div className="eqTableWrap"><table className="eqTable obsTable"><caption>{caption}</caption><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
);

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (next: T) => void; label: string }) {
  return <div className="eqSeg obsSeg" role="group" aria-label={label}>{options.map(([id, text]) => <button key={id} type="button" className={value === id ? 'on' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ grÃ¡fico de linhas (grupos fixos): uma linha por faixa, lacuna onde o ponto foi suprimido â”€â”€â”€â”€â”€â”€â”€â”€â”€
type LineSeries = { key: string; label: string; color: string; points: Array<{ x: number; y: number | null; tip: string }> };
function LineChart({ series, xMax, yFormat }: { series: LineSeries[]; xMax: number; yFormat: (v: number) => string }) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 640; const H = 280; const L = 58; const R = 14; const T = 14; const B = 50;
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null);
  if (ys.length === 0) return <Empty icon={<BarChart3 size={22} />} title="Sem pontos para mostrar" text="Nenhum grupo fixo tem participantes suficientes nas semanas apÃ³s a linha de base." />;
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
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pace por semana apÃ³s a linha de base, uma linha por grupo fixo" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="obsGrid" /><text x={L - 8} y={sy(t) + 4} textAnchor="end" className="obsAxis">{yFormat(t)}</text></g>)}
        {[1, Math.round(xMax / 4), Math.round(xMax / 2), Math.round((3 * xMax) / 4), xMax].filter((v, i, a) => v >= 1 && a.indexOf(v) === i).map((x) => <text key={x} x={sx(x)} y={H - B + 18} textAnchor="middle" className="obsAxis">{x}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="obsAxisTitle">semanas apÃ³s a linha de base</text>
        {hoverX != null ? <line x1={sx(hoverX)} x2={sx(hoverX)} y1={T} y2={H - B} className="obsCross" /> : null}
        {series.map((s) => (
          <g key={s.key}>
            {segments(s).map((pts, i) => <polyline key={i} points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {s.points.filter((p) => p.y != null && (hoverX === p.x || p.x === 1)).map((p) => <circle key={p.x} cx={sx(p.x)} cy={sy(p.y!)} r={4} fill={s.color} stroke="var(--paper)" strokeWidth={2} />)}
          </g>
        ))}
      </svg>
      {hoverX != null && hoverRows.length > 0 ? (
        <div className="eqTip obsLineTip" role="tooltip"><b>Semana {hoverX} apÃ³s a linha de base</b>{hoverRows.map(({ s, p }) => <small key={s.key}><i style={{ background: s.color }} />{s.label}: {p!.tip}</small>)}</div>
      ) : null}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ colunas agrupadas: cada faixa de intensidade tem uma coluna por grupo â”€â”€â”€â”€â”€â”€â”€â”€â”€
function GroupedColumns({ clusters, groups }: { clusters: Array<{ key: string; label: string; values: Array<{ group: string; color: string; value: number | null; detail: string }> }>; groups: Array<{ key: string; label: string; color: string }> }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0.0001, ...clusters.flatMap((c) => c.values.map((v) => v.value ?? 0)));
  const height = 150;
  if (groups.length === 0) return <Empty icon={<BarChart3 size={22} />} title="Sem grupos para comparar" text="NÃ£o hÃ¡ relatos neste recorte." />;
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
                    {hover === id ? <span className="eqTip" role="tooltip"><b>{nf(v.value, 2)} por 1.000 km</b><small>{groups.find((g) => g.key === v.group)?.label} Â· {v.detail}</small></span> : null}
                  </div>
                );
              })}
            </div>
            <span className="obsClusterLabel">{c.label.replace('Intensidade ', '')}</span>
          </div>
        ))}
      </div>
      <p className="obsAxisCap">Faixa de intensidade relatada (1â€“10) Â· relatos por 1.000 km corridos</p>
      <div className="eqLegend">{groups.map((g) => <span key={g.key}><i style={{ background: g.color }} />{g.label}</span>)}</div>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ tela â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        let detail = response.status === 403 ? 'Acesso restrito a administradoras autorizadas.' : 'NÃ£o foi possÃ­vel carregar agora.';
        try { const body = (await response.json()) as { message?: string | string[] }; const text = Array.isArray(body.message) ? body.message.join(' ') : body.message; if (text) detail = text; } catch { /* mensagem padrÃ£o */ }
        if (mine === seq.current) { setMessage(detail); setState('error'); }
        return;
      }
      const body = (await response.json()) as Result;
      if (mine === seq.current) { setResult(body); setState('ready'); }
    } catch {
      if (mine === seq.current) { setMessage('Sem conexÃ£o com a API. Tente novamente.'); setState('error'); }
    }
  }, [accessToken, apiUrl]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`${apiUrl}/observatory/status`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!alive) return;
        if (response.status === 403) { setStatusError('Acesso restrito a administradoras autorizadas.'); return; }
        if (!response.ok) { setStatusError('NÃ£o foi possÃ­vel verificar o estado do ObservatÃ³rio agora.'); return; }
        const body = (await response.json()) as Status;
        setStatus(body);
        if (body.enabled) void run(applied);
      } catch { if (alive) setStatusError('Sem conexÃ£o com a API. Tente novamente.'); }
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
  addList('ForÃ§a', applied.strengthBands, STRENGTH_OPTIONS, (n) => ({ ...applied, strengthBands: n }));
  addList('Sexo', applied.sexes, SEX_OPTIONS, (n) => ({ ...applied, sexes: n }));
  if (!applied.includeZeroWeeks) chips.push({ key: 'zero', group: 'Semanas', text: 'sem as semanas sem treino', remove: () => commit({ ...applied, includeZeroWeeks: true }) });
  const clearAll = () => commit({ ...emptyFilters(), from: applied.from, to: applied.to, mode: applied.mode, groupBy: applied.groupBy });
  const days = dayDiff(applied.from, applied.to) + 1;
  const r = result;
  const min = r?.minParticipants ?? 1;
  const ins = r?.insights ?? null;

  // â”€â”€ estados sem dados â”€â”€
  if (statusError) return <section className="eqRoot obsRoot"><Empty icon={<ShieldCheck size={22} />} title="ObservatÃ³rio indisponÃ­vel" text={statusError} /></section>;
  if (!status) return <section className="eqRoot obsRoot"><div className="eqSkeleton" aria-label="Carregando"><span /><span /><span /><span /></div></section>;
  if (!status.enabled) {
    return (
      <section className="eqRoot obsRoot">
        <header className="eqTop"><div className="eqTitle"><h2>ObservatÃ³rio Panzeri Run</h2><p>AnÃ¡lise agregada do comportamento da comunidade de corredoras.</p></div></header>
        <div className="obsOff" role="status">
          <ShieldCheck size={26} aria-hidden="true" />
          <h3>ObservatÃ³rio desativado</h3>
          <p>{status.reason ?? 'A funcionalidade estÃ¡ desligada por padrÃ£o e sÃ³ deve ser ativada depois da validaÃ§Ã£o com dados sintÃ©ticos e da autorizaÃ§Ã£o para dados reais.'}</p>
          <small>Para ligar o ambiente de teste (dados sintÃ©ticos), a variÃ¡vel de ambiente do ObservatÃ³rio precisa ser ativada no servidor da API.</small>
        </div>
      </section>
    );
  }

  // â”€â”€ dados derivados â”€â”€
  const volumeRows = r?.volume.rows ?? [];
  const volumeColumns = volumeRows.filter((row) => !row.suppressed && row.data).map((row) => ({ key: row.key, label: row.label.replace(' km', '').replace('Acima de ', '> ').replace('AtÃ© ', 'â‰¤ ').replace(' a ', 'â€“'), value: row.participants ?? 0, sub: `${row.label}: ${nf(row.participants)} alunas Â· ${nf(row.data!.avgKmPerWeek, 1)} km por semana corrida` }));
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
    points: g.data!.series.map((p) => ({ x: p.weekNumber, y: p.suppressed ? null : p.paceSecondsPerKm, tip: p.suppressed ? 'oculto' : `semana de ${p.week.slice(8, 10)}/${p.week.slice(5, 7)} Â· ${p.paceLabel ?? 'â€”'} Â· ${nf(p.participants)} participantes Â· ${nf(p.avgKm, 1)} km/semana` })),
  }));
  const cohortSuppressedPoints = (r?.pace.cohort.groups ?? []).reduce((s, g) => s + (g.data?.series.filter((p) => p.suppressed).length ?? 0), 0);

  const tabs: Array<[Tab, string, React.ReactNode]> = [['panorama', 'Panorama', <BarChart3 key="a" size={15} />], ['treino', 'Treinamento', <Activity key="b" size={15} />], ['dor', 'Dor e recuperaÃ§Ã£o', <HeartPulse key="c" size={15} />], ['tipos', 'Dor por tipo de treino', <Gauge key="e" size={15} />], ['relatar', 'Relatar dor', <HeartPulse key="f" size={15} />], ['ciclo', 'Ciclo menstrual', <CalendarDays key="g" size={15} />], ['qualidade', 'Qualidade dos dados', <ShieldCheck key="d" size={15} />]];

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
    key: row.key, label: row.label, sub: row.suppressed || !row.data ? 'menos participantes que o mÃ­nimo' : `${nf(row.participants)} participantes Â· ${nf(row.data.reports)} treinos com dor em ${nf(row.data.km, 0)} km`,
    value: row.data?.reportsPer1000Km ?? 0, display: row.suppressed || !row.data ? (row.complementary ? 'oculto por seguranÃ§a' : `oculto (< ${min})`) : `${nf(row.data.reportsPer1000Km, 2)} /1.000 km`, muted: row.suppressed,
  }));

  return (
    <section className="eqRoot obsRoot">
      <header className="eqTop">
        <div className="eqTitle"><h2>ObservatÃ³rio Panzeri Run</h2><p>Comportamento agregado da comunidade de corredoras. AssociaÃ§Ãµes descritivas, nÃ£o causa; nenhum dado individual.</p></div>
        <div className="eqTopActions">
          <button type="button" className="eqPeriod" onClick={() => { setDraft(applied); setSheet(true); }} title="Alterar perÃ­odo e filtros"><CalendarDays size={15} aria-hidden="true" /><span><b>{dm(applied.from)} â€“ {dmy(applied.to)}</b><small>{nf(days)} dias Â· semanas de segunda a domingo</small></span></button>
          <button type="button" className="eqBtn primary" onClick={() => { setDraft(applied); setSheet(true); }}><SlidersHorizontal size={15} aria-hidden="true" /> Filtros{chips.length ? <span className="eqBadge">{chips.length}</span> : null}</button>
        </div>
      </header>

      {status.dataset === 'synthetic' ? <div className="obsSynth" role="status"><TriangleAlert size={16} aria-hidden="true" /><b>Dados sintÃ©ticos â€” estrutura em teste, nenhum dado real.</b> <span>Os nÃºmeros abaixo foram gerados para validar telas e cÃ¡lculos e nÃ£o descrevem as alunas.</span></div> : null}

      <div className="eqBar"><div className="eqTabs" role="tablist" aria-label="Ãreas do ObservatÃ³rio">{tabs.map(([id, text, icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{icon}{text}</button>)}</div></div>

      {chips.length > 0 ? (
        <div className="eqActive" aria-label="Filtros ativos">
          {chips.map((chip) => <button key={chip.key} type="button" className="eqTag" onClick={chip.remove} title="Remover este filtro"><small>{chip.group}</small>{chip.text}<span aria-hidden="true">Ã—</span></button>)}
          <button type="button" className="eqLinkBtn" onClick={clearAll}>Limpar todos</button>
        </div>
      ) : null}

      {state === 'error' ? <p className="eqError" role="alert">{message} <button type="button" className="eqLinkBtn" onClick={() => void run(applied)}>Tentar de novo</button></p> : null}
      {state === 'loading' && !r ? <div className="eqSkeleton" aria-label="Carregando"><span /><span /><span /><span /></div> : null}

      {r ? (
        <div className={`eqBody${state === 'loading' ? ' eqBusy' : ''}`}>
          {r.overview.belowMinimum ? <Empty icon={<ShieldCheck size={22} />} title={`Menos de ${min} participantes neste recorte`} text="Para proteger as alunas, nada Ã© mostrado quando poucas pessoas compÃµem o resultado. Relaxe algum filtro ou amplie o perÃ­odo." /> : null}

          {!r.overview.belowMinimum && tab === 'panorama' ? (
            <>
              <div className="eqKpis">
                <Kpi icon={<Users size={16} />} label="Participantes" value={r.overview.participants} hint="alunas distintas com semanas completas no recorte" />
                <Kpi icon={<Activity size={16} />} label="Treinos de corrida" value={r.overview.trainings} hint="eventos fÃ­sicos deduplicados, sÃ³ corrida" />
                <Kpi icon={<Gauge size={16} />} label="QuilÃ´metros" value={r.overview.km} suffix="km" hint="soma dos treinos de corrida elegÃ­veis" />
                <Kpi icon={<CalendarDays size={16} />} label="Semanas corridas" value={Math.round((new Date(`${r.period.to}T12:00:00Z`).getTime() - new Date(`${r.period.from}T12:00:00Z`).getTime()) / 86_400_000 / 7 + 1 / 7)} hint={`do calendÃ¡rio, de segunda a domingo, de ${r.period.from.split('-').reverse().join('/')} a ${r.period.to.split('-').reverse().join('/')} Â· a semana atual fica de fora`} />
              </div>
              <Card wide title="DistribuiÃ§Ã£o do volume semanal" subtitle="Alunas por faixa de km semanal (semanas corridas do calendÃ¡rio, segunda a domingo, data de execuÃ§Ã£o)">
                <Columns data={volumeColumns} unit="alunas" emptyTitle="Sem semanas corridas" emptyText="Nenhuma aluna tem corrida neste recorte." />
                {hiddenVolume > 0 ? <p className="eqFine">{hiddenVolume} faixa(s) com menos de {min} participantes ficam ocultas na tabela e no grÃ¡fico.</p> : null}
              </Card>
              <Table caption="Volume semanal por faixa" head={['Faixa', 'Alunas', 'Km acumulados', 'Km mÃ©dio por semana corrida']}>
                {volumeRows.map((row) => (
                  <tr key={row.key}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
                    {row.suppressed || !row.data ? <td colSpan={2}><Hidden row={row} min={min} /></td> : <><td>{nf(row.data.km, 0)} km</td><td>{nf(row.data.avgKmPerWeek, 1)} km</td></>}
                  </tr>
                ))}
                {r.volume.total ? <tr className="obsTotal"><td><b>Total</b></td><td>{nf(r.volume.total.participants)}</td><td>{nf(r.volume.total.km, 0)} km</td><td>â€”</td></tr> : <tr className="obsTotal"><td><b>Total</b></td><td colSpan={3}>â€”</td></tr>}
              </Table>
            </>
          ) : null}

          {!r.overview.belowMinimum && tab === 'treino' ? (
            <>
              <div className="obsModeBar">
                <Seg<Mode> value={applied.mode} label="Tipo de comparaÃ§Ã£o" options={[['cross', 'ComparaÃ§Ã£o entre grupos atuais'], ['cohort', 'EvoluÃ§Ã£o de grupos fixos']]} onChange={(mode) => commit({ ...applied, mode })} />
                <p className="obsModeText">{applied.mode === 'cross'
                  ? 'Mostra, no mesmo perÃ­odo, como o pace difere entre as faixas de volume semanal de cada semana. Ã‰ uma comparaÃ§Ã£o entre grupos, nÃ£o prova que o volume muda o pace: quem corre mais costuma ser mais experiente.'
                  : `Cada corredora Ã© classificada pelas ${r.pace.cohort.baselineWeeks} primeiras semanas corridas do perÃ­odo (a partir de 01/08/2026) e permanece nesse grupo; o grÃ¡fico mostra o pace do grupo em cada semana do calendÃ¡rio depois disso. NinguÃ©m Ã© reclassificada com resultados futuros. AssociaÃ§Ã£o descritiva.`}</p>
              </div>

              {applied.mode === 'cross' ? (
                <>
                  <Card wide title="Pace por faixa de volume semanal" subtitle="Pace agregado = tempo total Ã· distÃ¢ncia total dos treinos da faixa (nÃ£o Ã© a mÃ©dia dos paces). Menor = mais rÃ¡pido.">
                    <HBars items={r.pace.cross.map((row) => ({ key: row.key, label: row.label, sub: row.suppressed ? 'menos participantes que o mÃ­nimo' : `${nf(row.participants)} participantes${row.data ? ` Â· ${nf(row.data.km, 0)} km` : ''}`, value: row.data?.pace?.secondsPerKm ?? 0, display: row.suppressed || !row.data ? (row.complementary ? 'oculto por seguranÃ§a' : `oculto (< ${min})`) : row.data.pace?.label ?? 'â€”', muted: row.suppressed || !row.data?.pace }))} empty="Sem pace calculÃ¡vel neste recorte" />
                  </Card>
                  <Table caption="Pace por faixa (comparaÃ§Ã£o entre grupos atuais)" head={['Faixa', 'Participantes', 'Participantes com pace', 'Pace agregado (tempo total Ã· distÃ¢ncia total)', 'Pace por participante: p25', 'Mediana', 'p75', 'Km', 'Treinos com tempo e distÃ¢ncia']}>
                    {r.pace.cross.map((row) => (
                      <tr key={row.key}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
                        {row.suppressed || !row.data ? <td colSpan={7}><Hidden row={row} min={min} /></td> : <><td>{nf(row.data.participantsWithPace)}</td><td><b>{row.data.pace?.label ?? 'â€”'}</b></td><td>{row.data.participantPace.p25 ?? 'â€”'}</td><td>{row.data.participantPace.median ?? 'â€”'}</td><td>{row.data.participantPace.p75 ?? 'â€”'}</td><td>{nf(row.data.km, 0)}</td><td>{nf(row.data.paceEvents)}</td></>}
                      </tr>
                    ))}
                  </Table>
                </>
              ) : (
                <>
                  <Card wide title="EvoluÃ§Ã£o do pace de grupos fixos" subtitle={`Uma linha por faixa de volume na linha de base (${r.pace.cohort.baselineWeeks} semanas). Eixo vertical: pace agregado (min/km; menor = mais rÃ¡pido).`}>
                    <LineChart series={cohortSeries} xMax={Math.max(4, ...cohortSeries.flatMap((s) => s.points.filter((p) => p.y != null).map((p) => p.x)))} yFormat={(v) => paceText(v).replace('/km', '')} />
                    <div className="eqLegend">{cohortSeries.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
                    {cohortSuppressedPoints > 0 ? <p className="eqFine">{cohortSuppressedPoints} ponto(s) com menos de {min} participantes ficam ocultos e aparecem como lacuna na linha.</p> : null}
                    <p className="eqFine">{r.pace.cohort.eligibleParticipants == null ? `Menos de ${min} participantes tÃªm as ${r.pace.cohort.baselineWeeks} semanas de linha de base.` : `${nf(r.pace.cohort.eligibleParticipants)} participantes tÃªm todas as ${r.pace.cohort.baselineWeeks} semanas corridas de linha de base neste recorte.`}</p>
                  </Card>
                  <Table caption="Grupos fixos: linha de base e variaÃ§Ã£o do pace" head={['Grupo fixo (faixa na linha de base)', 'Participantes no grupo', 'Km mÃ©dio por semana (linha de base)', 'Pace na linha de base', 'VariaÃ§Ã£o mediana do pace (primeiras 8 semanas seguintes)', 'Quartil 25', 'Quartil 75', 'Participantes com as duas medidas']}>
                    {r.pace.cohort.groups.map((row) => (
                      <tr key={row.key}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
                        {row.suppressed || !row.data ? <td colSpan={6}><Hidden row={row} min={min} /></td> : <><td>{nf(row.data.baselineAvgKm, 1)} km</td><td>{row.data.baselinePace?.label ?? 'â€”'}</td>
                          {row.data.paceChange && row.data.paceChange.medianDeltaSecPerKm != null ? <><td><b>{signed(row.data.paceChange.medianDeltaSecPerKm)}</b></td><td>{signed(row.data.paceChange.p25)}</td><td>{signed(row.data.paceChange.p75)}</td></> : <td colSpan={3}>{row.data.paceChange ? <span className="obsHidden">oculto (menos de {min} participantes com as duas medidas)</span> : 'â€”'}</td>}
                          <td>{row.data.paceChange && row.data.paceChange.medianDeltaSecPerKm == null ? `< ${min}` : nf(row.data.paceChange?.participants)}</td></>}
                      </tr>
                    ))}
                  </Table>
                  <p className="eqFine">VariaÃ§Ã£o = pace agregado das 8 primeiras semanas seguintes menos o pace agregado da linha de base, por participante; negativo = ficou mais rÃ¡pida. Mediana e quartis entre as participantes do grupo.</p>
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
                <p className="obsModeText">Mede a <b>dor marcada no feedback dos treinos de corrida</b> (sem dor, leve, moderada ou forte) em relaÃ§Ã£o Ã  quilometragem corrida â€” nÃ£o a dor real, nem lesÃ£o. Treino sem relato conta como sem dor (zero operacional); os km desses treinos entram no denominador. O â€œRelatar dorâ€ (nota 1 a 10) Ã© analisado Ã  parte, na aba AnÃ¡lise ampliada.</p>
              </div>
              {r.pain.overall ? (
                <>
                <div className="eqKpis obsKpis7">
                  {ins ? (
                    <>
                      <Kpi icon={<HeartPulse size={16} />} label="A Â· Treinos com dor no feedback (todos os tipos)" value={ins.segments.total?.painTrainings ?? null} hint={`de ${nf(ins.segments.total?.trainings)} treinos Â· ${nf(ins.segments.total?.painPer100Trainings, 2)} a cada 100 (${nf(ins.segments.total?.painPer100Trainings, 1)}%)`} />
                      <Kpi icon={<Gauge size={16} />} label="B Â· Corridas com dor por 1.000 km" value={ins.segments.runsCombined?.painPer1000Km ?? null} digits={2} hint={`sÃ³ corrida (prescrita + extra), ${nf(ins.segments.runsCombined?.km, 0)} km com distÃ¢ncia vÃ¡lida`} />
                      <Kpi icon={<Activity size={16} />} label="C Â· Intensidade mÃ©dia dos relatos apÃ³s o treino" value={ins.segments.total?.meanLevelAmongPain ?? null} digits={2} hint="escala 0â€“3 do feedback, sÃ³ treinos com dor (leve 1, moderada 2, forte 3)" />
                      <Kpi icon={<Activity size={16} />} label="C2 Â· Intensidade mÃ©dia dos relatos no Relatar dor" value={ins.standalone.overall?.meanIntensity ?? null} digits={1} hint={`nota de 1 a 10 Â· ${nf(ins.standalone.overall?.reports)} relatos`} />
                      <Kpi icon={<Activity size={16} />} label="D Â· Intensidade mÃ©dia geral por treino" value={ins.segments.total?.meanLevelAll ?? null} digits={2} hint="escala 0â€“3, treinos sem dor incluÃ­dos (zero)" />
                      <Kpi icon={<Gauge size={16} />} label="E Â· Pontos de intensidade por 1.000 km (corrida)" value={ins.segments.runsCombined?.levelPointsPer1000Km ?? null} digits={1} hint="soma da escala 0â€“3 do feedback Ã· km de corrida Ã— 1.000" />
                      <Kpi icon={<Gauge size={16} />} label="E2 Â· Soma das notas do Relatar dor por 1.000 km" value={ins.standalone.notePointsPer1000RunKm} digits={1} hint="soma das notas 1â€“10 Ã· km de corrida Ã— 1.000 (exposiÃ§Ã£o)" />
                      <Kpi icon={<HeartPulse size={16} />} label="Total de relatos no Relatar dor" value={ins.standalone.overall?.reports ?? null} hint={`${nf(ins.standalone.overall?.participants)} alunas Â· analisado Ã  parte`} />
                    </>
                  ) : null}
                  <Kpi icon={<ShieldCheck size={16} />} label="G Â· Cobertura de feedback" value={r.pain.overall.coverage.withFeedback} hint={`de ${nf(r.pain.overall.coverage.trainings)} treinos de corrida (${nf(r.pain.overall.coverage.trainings > 0 ? (r.pain.overall.coverage.withFeedback / r.pain.overall.coverage.trainings) * 100 : null, 0)}%); ${nf(r.pain.overall.coverage.withoutFeedback)} sem feedback`} />
                </div>
                <details className="obsDetails"><summary>O que Ã© â€œelegÃ­velâ€ nos nÃºmeros por 1.000 km?</summary>
                  <p className="eqFine">Entra: treino de corrida (prescrito ou extra) das semanas completas dentro do perÃ­odo, de alunas ativas e fora de conta de teste, deduplicado (o mesmo treino recebido do relÃ³gio e do Health Connect conta uma vez), com distÃ¢ncia vÃ¡lida. NÃ£o entra: origem Strava (direta ou via Health Connect/Apple SaÃºde); identidade fÃ­sica ambÃ­gua; treino sem distÃ¢ncia vÃ¡lida (conta como treino, mas nÃ£o entra no km); registro manual que repete uma atividade importada; semana incompleta ou sem dados. Esses nÃºmeros aparecem na aba Qualidade dos dados.</p>
                </details>
                </>
              ) : null}
              {r.pain.overall ? <p className="eqFine">Origem dos zeros (auditoria, entram na mÃ©trica): {nf(r.pain.overall.zeroOrigins.explicitNoPain)} treinos com resposta explÃ­cita â€œsem dorâ€ e {nf(r.pain.overall.zeroOrigins.noPainReport)} treinos sem relato de dor.</p> : null}
              <Card wide title="Treinos com dor por nÃ­vel, a cada 1.000 km" subtitle={`Grupos: ${r.pain.groupLabel}. Dor marcada no feedback do treino de corrida (leve, moderada ou forte). Cada coluna Ã© a taxa por 1.000 km corridos pelo grupo.`}>
                <GroupedColumns clusters={painClusters} groups={painGroupDefs} />
                {hiddenPain > 0 ? <p className="eqFine">{hiddenPain} grupo(s) com menos de {min} participantes ficam ocultos no grÃ¡fico e na tabela.</p> : null}
              </Card>
              {painTable(`Dor por grupo â€” ${r.pain.groupLabel}`, r.pain.rows, true)}
              <Card wide title="ExposiÃ§Ã£o anterior" subtitle="Comportamento dos 28 dias ANTERIORES ao treino (nunca dados posteriores ao relato). Dados anteriores ao treino; associaÃ§Ã£o, nÃ£o causa.">
                <h4 className="eqH4">Volume semanal mÃ©dio dos 28 dias anteriores Â· relatos por 1.000 km</h4>
                <HBars items={priorBars(r.pain.prior.volume)} empty="Sem histÃ³rico anterior suficiente" />
                <h4 className="eqH4">SessÃµes de forÃ§a por semana (mÃ©dia dos 28 dias anteriores) Â· relatos por 1.000 km</h4>
                <HBars items={priorBars(r.pain.prior.strength)} empty="Sem histÃ³rico anterior suficiente" />
                <details className="obsDetails"><summary>Tabelas da exposiÃ§Ã£o anterior</summary>{painTable('Volume dos 28 dias anteriores', r.pain.prior.volume, false)}{painTable('ForÃ§a dos 28 dias anteriores', r.pain.prior.strength, false)}</details>
              </Card>
              <Card wide title="DimensÃµes em preparaÃ§Ã£o" subtitle="Ainda sem dados confiÃ¡veis integrados: nenhum grÃ¡fico Ã© mostrado para elas.">
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
              <li>EstatÃ­stica descritiva: diferenÃ§as entre grupos sÃ£o associaÃ§Ãµes, nÃ£o efeito do treino ou do equipamento.</li>
              <li>Semanas de segunda a domingo, pela data de execuÃ§Ã£o do treino (nÃ£o a programada). SÃ³ semanas completas entram nas faixas.</li>
              <li>Pace agregado = tempo total Ã· distÃ¢ncia total. A mÃ©dia simples dos paces Ã© outra mÃ©trica e nÃ£o Ã© usada aqui.</li>
              <li>Atividades do Strava (inclusive por origem indireta) e de identidade ambÃ­gua ficam fora dos totais principais.</li>
            </ul>
            <small>Atualizado em {new Date(r.dataAsOf).toLocaleString('pt-BR')}</small>
          </aside>
        </div>
      ) : null}

      {sheet ? (
        <SheetFrame title="Filtros" subtitle="Todos valem ao mesmo tempo (E). O perÃ­odo Ã© livre." onClose={() => { setDraft(applied); setSheet(false); }}
          footer={<><button type="button" className="eqBtn ghost" onClick={() => setDraft({ ...emptyFilters(), from: draft.from, to: draft.to, mode: draft.mode, groupBy: draft.groupBy })}>Limpar filtros</button><button type="button" className="eqBtn primary" onClick={() => { commit(draft); setSheet(false); }}>{JSON.stringify(draft) !== JSON.stringify(applied) ? 'Aplicar filtros' : 'Fechar'}</button></>}>
          <fieldset className="eqField">
            <legend><CalendarDays size={14} aria-hidden="true" /> PerÃ­odo</legend>
            <div className="eqDates">
              <label>De<input type="date" value={draft.from} max={draft.to} onChange={(e) => patch({ from: e.target.value })} /></label>
              <label>AtÃ©<input type="date" value={draft.to} max={localToday()} onChange={(e) => patch({ to: e.target.value })} /></label>
            </div>
            <div className="eqChips">{([[8, '8 semanas'], [13, '13 semanas'], [26, '26 semanas'], [52, '52 semanas']] as Array<[number, string]>).map(([weeks, text]) => <button key={text} type="button" className="eqChip" onClick={() => shortcut(weeks)}>{text}</button>)}</div>
          </fieldset>
          <ChipGroup label="Faixa de rodagem semanal" options={VOLUME_OPTIONS} selected={draft.volumeBands} onChange={(n) => patch({ volumeBands: n })} showCount={false} />
          <ChipGroup label="Faixa etÃ¡ria" options={AGE_OPTIONS} selected={draft.ageBands} onChange={(n) => patch({ ageBands: n })} showCount={false} />
          <ChipGroup label="Treinos de forÃ§a na semana" options={STRENGTH_OPTIONS} selected={draft.strengthBands} onChange={(n) => patch({ strengthBands: n })} showCount={false} />
          <ChipGroup label="Sexo (quando informado)" options={SEX_OPTIONS} selected={draft.sexes} onChange={(n) => patch({ sexes: n })} showCount={false} />
          <label className="eqSwitch obsCheck"><input type="checkbox" checked={draft.includeZeroWeeks} onChange={(e) => patch({ includeZeroWeeks: e.target.checked })} /><span>Contar semanas sem treino registrado como 0 km (entre a primeira e a Ãºltima semana com treino da aluna)</span></label>
          <p className="eqFine">Na evoluÃ§Ã£o de grupos fixos, o filtro de forÃ§a nÃ£o se aplica; faixa de rodagem refere-se Ã  linha de base.</p>
        </SheetFrame>
      ) : null}
    </section>
  );
}

const paceLabel = (pace: Pace) => (pace ? pace.label : 'â€”');

const pct = (value: number | null | undefined, digits = 1) => (value == null ? 'â€”' : `${nf(value, digits)}%`);
const lmf = (m: { levels: { leve: number; moderado: number; forte: number } }) => `${nf(m.levels.leve)} / ${nf(m.levels.moderado)} / ${nf(m.levels.forte)}`;
const cellText = (c: AdherenceCell | undefined) => (c && c.scheduled > 0 ? `${nf(c.registered)}/${nf(c.scheduled)} (${pct(c.ratePct, 0)})` : 'â€”');

// Dor por tipo de treino (feedback do treino), corridas por distÃ¢ncia e alunas por volume (26/11/2026). SÃ³ agregados protegidos; descritivo, nÃ£o causa.
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
      <Table caption="Dor por tipo de treino (marcada no feedback do treino)" head={['Tipo de treino', 'Alunas', 'Treinos', 'Com feedback', 'Treinos com dor', 'Com dor a cada 100 treinos', 'Leve / moderada / forte', 'Intensidade mÃ©dia, sÃ³ com dor (0â€“3)', 'Intensidade mÃ©dia geral (0â€“3)', 'Pontos a cada 100 treinos', 'Km', 'Com dor / 1.000 km', 'Pontos / 1.000 km']}>
        {seg.rows.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 11) : painCells(row.data)}</tr>)}
        {seg.runsCombined ? <tr><td><b>Corridas (prescrita + extra)</b></td><td>â€”</td>{painCells(seg.runsCombined)}</tr> : null}
        {seg.total ? <tr><td><b>Todos os tipos</b></td><td>â€”</td>{painCells(seg.total)}</tr> : null}
      </Table>
      <p className="eqFine">Intensidade do treino = escala 0 a 3 do feedback (sem dor 0, leve 1, moderada 2, forte 3), a mesma da EvoluÃ§Ã£o. â€œPontosâ€ = soma dessa escala. Km e â€œpor 1.000 kmâ€ sÃ³ tÃªm sentido para corrida (treinos sem distÃ¢ncia vÃ¡lida ficam fora do km).</p>
      <Table caption="â€œRelatar dorâ€ como taxa de exposiÃ§Ã£o por tipo de treino (nÃ£o atribui o relato ao treino)" head={['Tipo de treino', 'Treinos', 'Relatos a cada 100 treinos', 'Soma das notas a cada 100 treinos', 'Relatos / 1.000 km (corrida)', 'Soma das notas / 1.000 km (corrida)']}>
        {seg.rows.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td>{row.suppressed || !row.data ? hidden(row, 5) : exposureCells(row.data)}</tr>)}
        {seg.runsCombined ? <tr><td><b>Corridas (prescrita + extra)</b></td>{exposureCells(seg.runsCombined)}</tr> : null}
        {seg.total ? <tr><td><b>Todos os tipos</b></td>{exposureCells(seg.total)}</tr> : null}
      </Table>
      <Table caption="Corridas por faixa de distÃ¢ncia (prescritas e extras)" head={['DistÃ¢ncia da corrida', 'Alunas', 'Corridas', 'Das quais extras', 'Km', 'Pace (tempo total Ã· distÃ¢ncia total)', 'Corridas com dor', 'Com dor a cada 10 corridas', 'Intensidade mÃ©dia, sÃ³ com dor (0â€“3)', 'Intensidade mÃ©dia geral (0â€“3)', 'Leve / moderada / forte']}>
        {ins.runsByDistance.rows.map((row) => (
          <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}>
            <td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
            {row.suppressed || !row.data ? hidden(row, 9) : <><td>{nf(row.data.runs)}</td><td>{nf(row.data.extraRuns)}</td><td>{nf(row.data.km, 0)}</td><td>{paceLabel(row.data.pace)}</td><td>{nf(row.data.pain.painTrainings)}</td><td>{nf(row.data.pain.painPer10Trainings, 2)}</td><td>{nf(row.data.pain.meanLevelAmongPain, 2)}</td><td>{nf(row.data.pain.meanLevelAll, 2)}</td><td>{lmf(row.data.pain)}</td></>}
          </tr>
        ))}
      </Table>
      {ins.runsByDistance.runsWithoutDistance > 0 ? <p className="eqFine">{nf(ins.runsByDistance.runsWithoutDistance)} corrida(s) sem distÃ¢ncia vÃ¡lida ficam fora desta tabela.</p> : null}
      <Table caption={`Alunas por volume semanal â€” Ãºltimas 10 semanas (${dmy(ins.weeklyVolume.weeks.from)} a ${dmy(ins.weeklyVolume.weeks.to)})`} head={['Faixa (elegÃ­vel em â‰¥ 7 das 10 semanas)', 'Alunas']}>
        {ins.weeklyVolume.rows.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td>{row.suppressed || !row.data ? hidden(row, 1) : <td>{nf(row.data.students)}</td>}</tr>)}
        {ins.weeklyVolume.studentsWithRuns != null ? <tr><td><b>Total com corrida nas 10 semanas</b></td><td>{nf(ins.weeklyVolume.studentsWithRuns)}</td></tr> : null}
      </Table>
      <p className="eqFine">{ins.weeklyVolume.note}</p>
    </>
  );
}

// "Relatar dor" (nota 1â€“10 e local), analisado Ã  parte.
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
      <Card wide title="Relatar dor â€” visÃ£o geral" subtitle={sr.note}>
        {sr.overall ? (
          <div className="eqKpis">
            <Kpi icon={<HeartPulse size={16} />} label="Total de relatos (Relatar dor)" value={sr.overall.reports} hint={`${nf(sr.overall.participants)} alunas`} />
            <Kpi icon={<Gauge size={16} />} label="Intensidade mÃ©dia dos relatos (1 a 10)" value={sr.overall.meanIntensity} digits={1} hint="mÃ©dia das notas do Relatar dor" />
            <Kpi icon={<Activity size={16} />} label="Soma das notas" value={sr.overall.notePoints} hint="notas somadas, todos os relatos" />
            <Kpi icon={<Gauge size={16} />} label="Relatos por 1.000 km corridos" value={sr.reportsPer1000RunKm} digits={2} hint={`sobre ${nf(sr.runKm, 0)} km de corrida do mesmo grupo`} />
            <Kpi icon={<Activity size={16} />} label="Soma das notas por 1.000 km" value={sr.notePointsPer1000RunKm} digits={1} hint="Ã­ndice descritivo (corrida)" />
          </div>
        ) : <Empty title="Sem relatos no perÃ­odo" />}
      </Card>
      {sr.overall ? (
        <Table caption="Relatos por faixa de nota" head={['Faixa', 'Relatos', '% dos relatos']}>
          {sr.overall.bins.map((b) => <tr key={b.key}><td><b>{b.label}</b></td><td>{nf(b.count)}</td><td>{pct(b.pct)}</td></tr>)}
        </Table>
      ) : null}
      <Table caption="Relatos por local da dor" head={['Local', 'Alunas', 'Relatos', 'Nota mÃ©dia (1â€“10)', 'Soma das notas', 'Relatos / 1.000 km', 'Notas / 1.000 km', 'Relatos a cada 100 treinos', 'Notas a cada 100 treinos']}>
        {sr.locations.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 7) : <><td>{nf(row.data.reports)}</td><td>{nf(row.data.meanNote, 1)}</td><td>{nf(row.data.notePoints)}</td><td>{nf(row.data.reportsPer1000RunKm, 2)}</td><td>{nf(row.data.notePointsPer1000RunKm, 1)}</td><td>{nf(row.data.reportsPer100Trainings, 2)}</td><td>{nf(row.data.notePointsPer100Trainings, 1)}</td></>}</tr>)}
      </Table>
      <p className="eqFine">Os locais sÃ£o os que o Panzeri Run coleta hoje (joelho, tornozelo, pÃ©, canela, panturrilha, coxa, quadril, glÃºteo, lombar/coluna). Direito e esquerdo ficam juntos aqui e separados na tabela de lado abaixo. Ainda nÃ£o coletamos a parte do joelho (interno, externo, patela); isso exige uma pergunta nova no Relatar dor.</p>
      <Table caption="Relatos por lado (quando a aluna informou o lado)" head={['Local Â· lado', 'Alunas', 'Relatos', 'Nota mÃ©dia (1â€“10)']}>
        {sr.sides.map((row) => <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 2) : <><td>{nf(row.data.reports)}</td><td>{nf(row.data.meanNote, 1)}</td></>}</tr>)}
      </Table>
      {matrix('Local da dor Ã— tipo de treino â€” relatos a cada 100 treinos do tipo (exposiÃ§Ã£o)', 'reportsPer100', 2)}
      {matrix('Local da dor Ã— tipo de treino â€” soma das notas a cada 100 treinos do tipo (exposiÃ§Ã£o)', 'notePointsPer100', 1)}
    </>
  );
}

// Fases do ciclo: dor, "Relatar dor", adesÃ£o, km e local.
function CicloTab({ ins, min }: { ins: Insights; min: number }) {
  const c = ins.cycle;
  const hidden = (row: { suppressed: boolean; complementary: boolean }, cols: number) => <td colSpan={cols}><Hidden row={row} min={min} /></td>;
  const block = (title: string, group: CycleGroup) => (
    <>
      <h3 className="eqH4">{title}</h3>
      <Table caption={`${title} â€” treinos e dor do treino (feedback)`} head={['Fase', 'Alunas', 'Dias-aluna', 'Treinos', 'Treinos com dor a cada 100 treinos', 'Intensidade mÃ©dia, sÃ³ com dor (0â€“3)', 'Leve / moderada / forte']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td><td>{pcount(row, min)}</td>{row.suppressed || !row.data ? hidden(row, 5) : <><td>{nf(row.data.participantDays)}</td><td>{nf(row.data.trainings)}</td><td>{nf(row.data.pain.painPer100Trainings, 2)}</td><td>{nf(row.data.pain.meanLevelAmongPain, 2)}</td><td>{lmf(row.data.pain)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} â€” Relatar dor por fase`} head={['Fase', 'Relatos', 'Relatos a cada 100 treinos', 'Relatos a cada 100 km', 'Nota mÃ©dia (1â€“10)', 'Soma das notas a cada 100 treinos', 'Soma das notas a cada 100 km']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td>{row.suppressed || !row.data ? hidden(row, 6) : <><td>{nf(row.data.relatar.reports)}</td><td>{nf(row.data.relatar.reportsPer100Trainings, 2)}</td><td>{nf(row.data.relatar.reportsPer100Km, 2)}</td><td>{nf(row.data.relatar.meanNote, 1)}</td><td>{nf(row.data.relatar.notePointsPer100Trainings, 1)}</td><td>{nf(row.data.relatar.notePointsPer100Km, 1)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} â€” adesÃ£o por fase (registrados Ã· programados)`} head={['Fase', 'Geral', 'Corrida', 'Fortalecimento', 'MusculaÃ§Ã£o', 'Outras modalidades']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td>{row.suppressed || !row.data ? hidden(row, 5) : <><td>{cellText(row.data.adherence.all)}</td><td>{cellText(row.data.adherence.bySegment.corrida)}</td><td>{cellText(row.data.adherence.bySegment.fortalecimento)}</td><td>{cellText(row.data.adherence.bySegment.musculacao)}</td><td>{cellText(row.data.adherence.bySegment.outras)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} â€” km e pace por fase`} head={['Fase', 'Corridas', 'Km', 'Km por corrida', 'Km por aluna por semana', 'Pace da corrida']}>
        {group.phases.map(({ phase, label, row }) => <tr key={phase} className={row.suppressed ? 'obsRowHidden' : undefined}><td><b>{label}</b></td>{row.suppressed || !row.data ? hidden(row, 5) : <><td>{nf(row.data.runs)}</td><td>{nf(row.data.runKm, 0)}</td><td>{nf(row.data.avgKmPerRun, 1)}</td><td>{nf(row.data.kmPerParticipantWeek, 1)}</td><td>{paceLabel(row.data.runPace)}</td></>}</tr>)}
      </Table>
      <Table caption={`${title} â€” local da dor Ã— fase (relatos Â· nota mÃ©dia Â· relatos a cada 100 treinos da fase)`} head={['Local', ...group.phases.map((p) => p.label)]}>
        {group.locations.map((loc) => (
          <tr key={loc.key} className={loc.suppressed ? 'obsRowHidden' : undefined}><td><b>{loc.label}</b></td>{loc.suppressed ? <td colSpan={4}>oculto (&lt; {min} alunas)</td> : group.phases.map((p) => { const cell = loc.cells[p.phase as keyof typeof loc.cells]; return <td key={p.phase}>{cell ? `${nf(cell.reports)} Â· ${nf(cell.meanNote, 1)} Â· ${nf(cell.reportsPer100Trainings, 1)}` : 'â€”'}</td>; })}</tr>
        ))}
      </Table>
    </>
  );
  return (
    <>
      <Card wide title="Fases do ciclo menstrual" subtitle="SÃ³ alunas que registraram o ciclo. Fase estimada; descritivo, nÃ£o causa.">
        <ul className="obsPending">{c.notes.map((n) => <li key={n}><span>{n}</span></li>)}</ul>
        <p className="eqFine">{nf(c.participantsWithCycle)} aluna(s) com ciclo registrado; {nf(c.participantsWithEstimatedPhases)} com fase estimada em parte do histÃ³rico; {nf(c.trainingsOutsideCycle)} treino(s) fora de qualquer ciclo registrado.</p>
      </Card>
      {block('Ciclo natural (sem anticoncepcional hormonal)', c.natural)}
      {block('Com anticoncepcional hormonal (fase sÃ³ estimada)', c.hormonal)}
    </>
  );
}

function QualityTab({ r }: { r: Result }) {
  const q = r.quality;
  const rows: Array<[string, number | string, string]> = [
    ['Treinos de corrida elegÃ­veis', q.eligibleTrainings, 'eventos fÃ­sicos deduplicados que entram nas anÃ¡lises'],
    ['â€” de atividade importada (relÃ³gio/aplicativo)', q.activityTrainings, 'um evento por treino, mesmo recebido de duas fontes'],
    ['â€” registrados Ã  mÃ£o pela aluna', q.manualTrainings, 'autorrelato sem atividade importada'],
    ['Treinos sem distÃ¢ncia vÃ¡lida', q.trainingsWithoutDistance, 'contam como treino, mas nÃ£o entram na soma de km'],
    ['ExcluÃ­dos: origem Strava (direta ou indireta)', q.stravaExcludedEvents, 'restriÃ§Ã£o de uso do provedor: nÃ£o alimentam o ObservatÃ³rio'],
    ['ExcluÃ­dos: identidade fÃ­sica ambÃ­gua', q.ambiguousIdentityEvents, 'ficam fora dos totais principais atÃ© a identidade ser resolvida'],
    ['IncluÃ­dos, mas com identidade nÃ£o avaliada', q.unevaluatedIdentityEvents, 'dados legados sem avaliaÃ§Ã£o de identidade; entram sinalizados'],
    ['Treinos manuais que repetiam atividade importada', q.duplicateManualEvents, 'descartados para nÃ£o contar o mesmo treino duas vezes'],
    ['Conflitos: relato de dor no treino marcado â€œsem dorâ€', q.painConflicts, 'prevalece o relato de dor'],
    ['Participantes fora por causa dos filtros', q.participantsExcludedByFilters, 'efeito dos filtros escolhidos'],
  ];
  return (
    <>
      <div className="eqKpis">
        <Kpi icon={<ShieldCheck size={16} />} label="Treinos elegÃ­veis" value={q.eligibleTrainings} hint={`${nf(q.activityTrainings)} de atividade importada e ${nf(q.manualTrainings)} manuais`} />
        <Kpi icon={<TriangleAlert size={16} />} label="ExcluÃ­dos (Strava + ambÃ­guos)" value={q.stravaExcludedEvents + q.ambiguousIdentityEvents} hint="fora dos totais principais" />
        <Kpi icon={<Info size={16} />} label="Conflitos de dor no mesmo treino" value={q.painConflicts} hint="prevalece a dor marcada" />
      </div>
      <Table caption="Qualidade e cobertura dos dados" head={['Item', 'Quantidade', 'O que significa']}>
        {rows.map(([label, value, hint]) => <tr key={label}><td><b>{label}</b></td><td>{typeof value === 'number' ? nf(value) : value}</td><td>{hint}</td></tr>)}
      </Table>
      <Card wide title="ProcedÃªncia, perÃ­odo e atualizaÃ§Ã£o">
        <dl className="obsDl">
          <div><dt>Tipo de dado</dt><dd>{r.dataset === 'synthetic' ? 'SintÃ©tico (teste)' : 'Real'}</dd></div>
          <div><dt>PerÃ­odo analisado</dt><dd>{dmy(r.period.from)} a {dmy(r.period.to)}</dd></div>
          <div><dt>Atualizado em</dt><dd>{new Date(r.dataAsOf).toLocaleString('pt-BR')}</dd></div>
          <div><dt>RestriÃ§Ã£o de origem</dt><dd>Strava (inclusive via Health Connect/Apple SaÃºde) nÃ£o alimenta este produto</dd></div>
        </dl>
        <p className="eqFine">{q.note}</p>
      </Card>
    </>
  );
}
