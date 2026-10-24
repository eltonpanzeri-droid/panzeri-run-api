'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, CalendarDays, Gauge, HeartPulse, Info, ShieldCheck, SlidersHorizontal, TriangleAlert, Users } from 'lucide-react';
import { Card, ChipGroup, Columns, Empty, HBars, Kpi, Legend, SheetFrame, nf } from './viz';
import type { HItem, Option } from './viz';

// Observatório Panzeri Run (24/10/2026). SOMENTE LEITURA e SÓ AGREGADOS: GET /observatory/status e /observatory/analysis. Nenhum nome, e-mail ou id de aluna chega aqui.
// Estatística descritiva: o que aparece são associações entre grupos, não causa. Cada número diz seu denominador (participantes, participantes-semanas, treinos, relatos ou km).
// Células com poucos participantes chegam suprimidas da API e aqui aparecem como "oculto" — nunca como zero.

// ───────── tipos (espelham o contrato da API; apps/api/src/observatory/observatory-engine.ts) ─────────
type Row<T> = { key: string; label: string; participants: number | null; suppressed: boolean; complementary: boolean; data: T | null };
type PainMetrics = {
  trainings: number; km: number; reports: number; reportsWithIntensity: number; reportsWithoutIntensity: number;
  reportsPer1000Km: number | null; meanIntensityReports: number | null; meanIntensityAll: number | null; painPointsPer1000Km: number | null;
  intensityBins: Array<{ key: string; label: string; count: number; pctOfKnown: number | null; per1000Km: number | null }>;
  coverage: { trainings: number; withFeedback: number; withoutFeedback: number; numericIntensityTrainings: number; intensityCoveragePct: number | null };
  zeroOrigins: { explicitNoPain: number; noPainReport: number };
};
type CohortSeriesPoint = { relativeWeek: number; participants: number | null; avgKm: number | null; paceSecondsPerKm: number | null; paceLabel: string | null; suppressed: boolean };
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
  quality: Record<string, number | string> & {
    stravaExcludedEvents: number; ambiguousIdentityEvents: number; unevaluatedIdentityEvents: number; invalidDistanceEvents: number; duplicateManualEvents: number;
    painReportsWithoutTraining: number; painConflicts: number; eligibleTrainings: number; trainingsWithoutDistance: number; manualTrainings: number; activityTrainings: number;
    participantWeeksIncomplete: number; participantWeeksNoData: number; participantsExcludedByFilters: number; note: string;
  };
};
type Status = { enabled: boolean; dataset: 'synthetic' | 'real'; reason?: string };
type Mode = 'cross' | 'cohort';
type GroupBy = 'volume' | 'age' | 'strength' | 'sex' | 'priorVolume' | 'priorStrength';
type Tab = 'panorama' | 'treino' | 'dor' | 'qualidade';

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
const emptyFilters = (): Filters => ({ from: addDays(localToday(), -(26 * 7 - 1)), to: localToday(), volumeBands: [], ageBands: [], strengthBands: [], sexes: [], mode: 'cross', groupBy: 'volume', includeZeroWeeks: false });
const paceText = (seconds: number | null | undefined) => (seconds == null ? '—' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km`);
const signed = (value: number | null | undefined) => (value == null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} s/km`);

function toQuery(f: Filters): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string | string[]) => { const text = Array.isArray(value) ? value.join(',') : value; if (text) params.set(key, text); };
  put('from', f.from); put('to', f.to); put('volumeBands', f.volumeBands); put('ageBands', f.ageBands); put('strengthBands', f.strengthBands); put('sexes', f.sexes);
  put('mode', f.mode); put('groupBy', f.groupBy); if (f.includeZeroWeeks) params.set('includeZeroWeeks', 'true');
  return params.toString();
}

// ───────── célula suprimida: nunca vira zero ─────────
function Hidden({ row, min }: { row: { suppressed: boolean; complementary: boolean }; min: number }) {
  return <span className="obsHidden" title={row.complementary ? 'Ocultado por segurança: mostrar este valor permitiria reconstruir outro grupo pequeno por diferença.' : `Menos de ${min} participantes neste grupo: valor oculto para não expor uma aluna.`}>{row.complementary ? 'oculto por segurança' : `oculto (menos de ${min} participantes)`}</span>;
}
function Cell<T>({ row, min, children }: { row: Row<T>; min: number; children: (data: T) => React.ReactNode }) {
  return row.suppressed || row.data == null ? <Hidden row={row} min={min} /> : <>{children(row.data)}</>;
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
  if (groups.length === 0) return <Empty icon={<BarChart3 size={22} />} title="Sem grupos para comparar" text="Todos os grupos têm menos participantes que o mínimo ou não há relatos." />;
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
  if (applied.includeZeroWeeks) chips.push({ key: 'zero', group: 'Semanas', text: 'com semanas sem treino (0 km)', remove: () => commit({ ...applied, includeZeroWeeks: false }) });
  const clearAll = () => commit({ ...emptyFilters(), from: applied.from, to: applied.to, mode: applied.mode, groupBy: applied.groupBy });
  const days = dayDiff(applied.from, applied.to) + 1;
  const r = result;
  const min = r?.minParticipants ?? 5;

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
  const volumeColumns = volumeRows.filter((row) => !row.suppressed && row.data).map((row) => ({ key: row.key, label: row.label.replace(' km', '').replace('Acima de ', '> ').replace('Até ', '≤ ').replace(' a ', '–'), value: row.data!.participantWeeks, sub: `${row.label}: ${nf(row.participants)} participantes · ${nf(row.data!.pctOfWeeks, 1)}% das participantes-semanas` }));
  const hiddenVolume = volumeRows.filter((row) => row.suppressed).length;
  const painGroups = (r?.pain.rows ?? []).filter((row) => !row.suppressed && row.data && row.data.trainings > 0);
  const painGroupDefs = painGroups.map((row, index) => ({ key: row.key, label: row.label, color: PALETTE[(r!.pain.groupBy === 'volume' ? COLOR_INDEX[row.key] ?? index : index) % PALETTE.length] }));
  const binKeys = r?.pain.overall?.intensityBins.map((b) => ({ key: b.key, label: b.label })) ?? painGroups[0]?.data?.intensityBins.map((b) => ({ key: b.key, label: b.label })) ?? [];
  const painClusters = binKeys.map((b) => ({
    key: b.key, label: b.label,
    values: painGroups.map((row, i) => { const bin = row.data!.intensityBins.find((x) => x.key === b.key); return { group: row.key, color: painGroupDefs[i].color, value: bin?.per1000Km ?? null, detail: `${nf(bin?.count)} relatos em ${nf(row.data!.km, 0)} km (${nf(row.participants)} participantes)` }; }),
  }));
  const hiddenPain = (r?.pain.rows ?? []).filter((row) => row.suppressed).length;
  const cohortGroups = (r?.pace.cohort.groups ?? []).filter((g) => !g.suppressed && g.data && g.data.series.some((p) => !p.suppressed));
  const cohortSeries: LineSeries[] = cohortGroups.map((g, i) => ({
    key: g.key, label: g.label, color: PALETTE[COLOR_INDEX[g.key] ?? i],
    points: g.data!.series.map((p) => ({ x: p.relativeWeek, y: p.suppressed ? null : p.paceSecondsPerKm, tip: p.suppressed ? 'oculto' : `${p.paceLabel ?? '—'} · ${nf(p.participants)} participantes · ${nf(p.avgKm, 1)} km/semana` })),
  }));
  const cohortSuppressedPoints = (r?.pace.cohort.groups ?? []).reduce((s, g) => s + (g.data?.series.filter((p) => p.suppressed).length ?? 0), 0);

  const tabs: Array<[Tab, string, React.ReactNode]> = [['panorama', 'Panorama', <BarChart3 key="a" size={15} />], ['treino', 'Treinamento', <Activity key="b" size={15} />], ['dor', 'Dor e recuperação', <HeartPulse key="c" size={15} />], ['qualidade', 'Qualidade dos dados', <ShieldCheck key="d" size={15} />]];

  const painCell = (row: Row<PainMetrics>, fn: (d: PainMetrics) => React.ReactNode) => <Cell row={row} min={min}>{fn}</Cell>;
  const painTable = (caption: string, rows: Array<Row<PainMetrics>>, withBins: boolean) => (
    <Table caption={caption} head={['Grupo', 'Participantes', 'Treinos', 'Km', 'Relatos', 'Relatos / 1.000 km', 'Intensidade média dos relatos', 'Intensidade média geral (por treino)', 'Pontos / 1.000 km', ...(withBins ? ['1–2 /1.000 km', '3–4 /1.000 km', '5–6 /1.000 km', '7–8 /1.000 km', '9–10 /1.000 km', 'Cobertura de feedback', 'Cobertura de nota'] : [])]}>
      {rows.map((row) => (
        <tr key={row.key} className={row.suppressed ? 'obsRowHidden' : undefined}>
          <td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
          {row.suppressed || !row.data ? <td colSpan={withBins ? 15 : 7}><Hidden row={row} min={min} /></td> : (
            <>
              <td>{nf(row.data.trainings)}</td><td>{nf(row.data.km, 0)}</td><td>{nf(row.data.reports)}</td><td>{nf(row.data.reportsPer1000Km, 2)}</td><td>{nf(row.data.meanIntensityReports, 1)}</td><td>{nf(row.data.meanIntensityAll, 2)}</td><td>{nf(row.data.painPointsPer1000Km, 1)}</td>
              {withBins ? <>{row.data.intensityBins.map((b) => <td key={b.key}>{nf(b.per1000Km, 2)}</td>)}<td>{nf(row.data.coverage.withFeedback)} de {nf(row.data.coverage.trainings)} ({nf(row.data.coverage.trainings > 0 ? (row.data.coverage.withFeedback / row.data.coverage.trainings) * 100 : null, 0)}%)</td><td>{nf(row.data.coverage.intensityCoveragePct, 1)}%</td></> : null}
            </>
          )}
        </tr>
      ))}
    </Table>
  );
  const priorBars = (rows: Array<Row<PainMetrics>>): HItem[] => rows.filter((row) => row.suppressed || (row.participants ?? 0) > 0).map((row) => ({
    key: row.key, label: row.label, sub: row.suppressed || !row.data ? 'menos participantes que o mínimo' : `${nf(row.participants)} participantes · ${nf(row.data.reports)} relatos em ${nf(row.data.km, 0)} km`,
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
                <Kpi icon={<CalendarDays size={16} />} label="Semanas completas" value={r.overview.weeks.complete} hint={`participantes-semanas · ${nf(r.overview.weeks.incomplete)} incompletas e ${nf(r.overview.weeks.noData)} sem dados ficaram fora`} />
              </div>
              <Card wide title="Distribuição do volume semanal" subtitle="Participantes-semanas por faixa de km semanal (semana completa, segunda a domingo, data de execução)">
                <Columns data={volumeColumns} unit="participantes-semanas" emptyTitle="Sem semanas completas" emptyText="Nenhuma faixa tem participantes suficientes neste recorte." />
                {hiddenVolume > 0 ? <p className="eqFine">{hiddenVolume} faixa(s) com menos de {min} participantes ficam ocultas na tabela e no gráfico.</p> : null}
              </Card>
              <Table caption="Volume semanal por faixa" head={['Faixa', 'Participantes', 'Participantes-semanas', '% das participantes-semanas', 'Km acumulados', 'Km médio por semana']}>
                {volumeRows.map((row) => (
                  <tr key={row.key}><td><b>{row.label}</b></td><td>{pcount(row, min)}</td>
                    {row.suppressed || !row.data ? <td colSpan={4}><Hidden row={row} min={min} /></td> : <><td>{nf(row.data.participantWeeks)}</td><td>{nf(row.data.pctOfWeeks, 1)}%</td><td>{nf(row.data.km, 0)} km</td><td>{nf(row.data.avgKmPerWeek, 1)} km</td></>}
                  </tr>
                ))}
                {r.volume.total ? <tr className="obsTotal"><td><b>Total</b></td><td>{nf(r.volume.total.participants)}</td><td>{nf(r.volume.total.participantWeeks)}</td><td>100%</td><td>{nf(r.volume.total.km, 0)} km</td><td>—</td></tr> : <tr className="obsTotal"><td><b>Total</b></td><td colSpan={5}><span className="obsHidden">omitido porque há faixas ocultas (impede reconstruir uma faixa pequena por diferença)</span></td></tr>}
              </Table>
            </>
          ) : null}

          {!r.overview.belowMinimum && tab === 'treino' ? (
            <>
              <div className="obsModeBar">
                <Seg<Mode> value={applied.mode} label="Tipo de comparação" options={[['cross', 'Comparação entre grupos atuais'], ['cohort', 'Evolução de grupos fixos']]} onChange={(mode) => commit({ ...applied, mode })} />
                <p className="obsModeText">{applied.mode === 'cross'
                  ? 'Mostra, no mesmo período, como o pace difere entre as faixas de volume semanal de cada semana. É uma comparação entre grupos, não prova que o volume muda o pace: quem corre mais costuma ser mais experiente.'
                  : `Cada corredora é classificada pelas ${r.pace.cohort.baselineWeeks} primeiras semanas completas e elegíveis e permanece nesse grupo; o gráfico mostra como o pace do grupo evolui depois. Ninguém é reclassificada com resultados futuros. Associação descritiva.`}</p>
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
                    <p className="eqFine">{r.pace.cohort.eligibleParticipants == null ? `Menos de ${min} participantes têm as ${r.pace.cohort.baselineWeeks} semanas de linha de base.` : `${nf(r.pace.cohort.eligibleParticipants)} participantes têm as ${r.pace.cohort.baselineWeeks} semanas completas de linha de base neste recorte.`}</p>
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
                <p className="obsModeText">Mede a <b>dor relatada</b> pela comunidade em relação à quilometragem corrida — não a dor real, nem lesão. Treino sem relato conta como intensidade 0 (zero operacional); os km desses treinos entram no denominador.</p>
              </div>
              {r.pain.overall ? (
                <div className="eqKpis obsKpis7">
                  <Kpi icon={<HeartPulse size={16} />} label="A · Relatos de dor" value={r.pain.overall.reports} hint={`relatos em ${nf(r.pain.overall.trainings)} treinos e ${nf(r.pain.overall.km, 0)} km`} />
                  <Kpi icon={<Gauge size={16} />} label="B · Relatos por 1.000 km" value={r.pain.overall.reportsPer1000Km} digits={2} hint="relatos ÷ km elegíveis × 1.000" />
                  <Kpi icon={<Activity size={16} />} label="C · Intensidade média dos relatos" value={r.pain.overall.meanIntensityReports} digits={1} hint={`só relatos com nota (${nf(r.pain.overall.reportsWithIntensity)}); sem zeros`} />
                  <Kpi icon={<Activity size={16} />} label="D · Intensidade média geral" value={r.pain.overall.meanIntensityAll} digits={2} hint={`por treino, com zeros (${nf(r.pain.overall.coverage.numericIntensityTrainings)} treinos com nota)`} />
                  <Kpi icon={<Gauge size={16} />} label="E · Pontos de intensidade por 1.000 km" value={r.pain.overall.painPointsPer1000Km} digits={1} hint="soma das notas dos relatos ÷ km × 1.000 (índice descritivo)" />
                  <Kpi icon={<ShieldCheck size={16} />} label="G · Cobertura de feedback" value={r.pain.overall.coverage.withFeedback} hint={`de ${nf(r.pain.overall.coverage.trainings)} treinos (${nf(r.pain.overall.coverage.trainings > 0 ? (r.pain.overall.coverage.withFeedback / r.pain.overall.coverage.trainings) * 100 : null, 0)}%); ${nf(r.pain.overall.coverage.withoutFeedback)} sem feedback`} />
                  <Kpi icon={<Info size={16} />} label="Relatos sem nota numérica" value={r.pain.overall.reportsWithoutIntensity} hint={`de ${nf(r.pain.overall.reports)} relatos; treinos com nota numérica: ${nf(r.pain.overall.coverage.intensityCoveragePct, 1)}%`} />
                </div>
              ) : null}
              {r.pain.overall ? <p className="eqFine">Origem dos zeros (auditoria, entram na métrica): {nf(r.pain.overall.zeroOrigins.explicitNoPain)} treinos com resposta explícita “sem dor” e {nf(r.pain.overall.zeroOrigins.noPainReport)} treinos sem relato de dor.</p> : null}
              <Card wide title="Relatos de dor por faixa de intensidade, a cada 1.000 km" subtitle={`Grupos: ${r.pain.groupLabel}. Cada coluna é a taxa de relatos naquela faixa por 1.000 km corridos pelo grupo.`}>
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

          {tab === 'qualidade' ? <QualityTab r={r} /> : null}

          <aside className="eqNotes" aria-label="Como ler">
            <strong>Como ler</strong>
            <ul>
              <li>Estatística descritiva: diferenças entre grupos são associações, não efeito do treino ou do equipamento.</li>
              <li>Semanas de segunda a domingo, pela data de execução do treino (não a programada). Só semanas completas entram nas faixas.</li>
              <li>Pace agregado = tempo total ÷ distância total. A média simples dos paces é outra métrica e não é usada aqui.</li>
              <li>Grupos com menos de {min} participantes ficam ocultos; quando só um grupo seria ocultado, outro também é, para não permitir reconstruí-lo por diferença. O piso de {min} é provisório e não garante anonimização.</li>
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
          <label className="eqSwitch obsCheck"><input type="checkbox" checked={draft.includeZeroWeeks} onChange={(e) => patch({ includeZeroWeeks: e.target.checked })} /><span>Contar semanas sem treino registrado como 0 km (por padrão ficam fora: não dá para saber se foi descanso ou falta de sincronização)</span></label>
          <p className="eqFine">Na evolução de grupos fixos, o filtro de força não se aplica; faixa de rodagem refere-se à linha de base.</p>
        </SheetFrame>
      ) : null}
    </section>
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
    ['Relatos de dor sem treino elegível no dia', q.painReportsWithoutTraining, 'não entram nas taxas por 1.000 km (sem exposição para dividir)'],
    ['Conflitos: relato de dor no treino marcado “sem dor”', q.painConflicts, 'prevalece o relato de dor'],
    ['Participantes-semanas incompletas', q.participantWeeksIncomplete, 'semana ainda em andamento ou parcialmente fora do período'],
    ['Participantes-semanas sem dados suficientes', q.participantWeeksNoData, 'semana sem treino entre semanas com treino: descanso ou falta de sincronização?'],
    ['Participantes fora por causa dos filtros', q.participantsExcludedByFilters, 'efeito dos filtros escolhidos'],
  ];
  return (
    <>
      <div className="eqKpis">
        <Kpi icon={<ShieldCheck size={16} />} label="Treinos elegíveis" value={q.eligibleTrainings} hint={`${nf(q.activityTrainings)} de atividade importada e ${nf(q.manualTrainings)} manuais`} />
        <Kpi icon={<TriangleAlert size={16} />} label="Excluídos (Strava + ambíguos)" value={q.stravaExcludedEvents + q.ambiguousIdentityEvents} hint="fora dos totais principais" />
        <Kpi icon={<CalendarDays size={16} />} label="Semanas sem dados suficientes" value={q.participantWeeksNoData} hint="participantes-semanas fora das faixas" />
        <Kpi icon={<Info size={16} />} label="Relatos sem treino no dia" value={q.painReportsWithoutTraining} hint="fora das taxas por 1.000 km" />
      </div>
      <Table caption="Qualidade e cobertura dos dados" head={['Item', 'Quantidade', 'O que significa']}>
        {rows.map(([label, value, hint]) => <tr key={label}><td><b>{label}</b></td><td>{typeof value === 'number' ? nf(value) : value}</td><td>{hint}</td></tr>)}
      </Table>
      <Card wide title="Procedência, período e atualização">
        <dl className="obsDl">
          <div><dt>Tipo de dado</dt><dd>{r.dataset === 'synthetic' ? 'Sintético (teste)' : 'Real'}</dd></div>
          <div><dt>Período analisado</dt><dd>{dmy(r.period.from)} a {dmy(r.period.to)}</dd></div>
          <div><dt>Atualizado em</dt><dd>{new Date(r.dataAsOf).toLocaleString('pt-BR')}</dd></div>
          <div><dt>Piso de participantes por célula</dt><dd>{r.minParticipants} (provisório)</dd></div>
          <div><dt>Restrição de origem</dt><dd>Strava (inclusive via Health Connect/Apple Saúde) não alimenta este produto</dd></div>
        </dl>
        <p className="eqFine">{q.note}</p>
      </Card>
    </>
  );
}
