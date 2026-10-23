'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, ArrowRight, Flame, Footprints, GitCompare, HeartPulse, Info, Moon, Plug, TrendingDown, TrendingUp, Minus } from 'lucide-react';

// Aluno > Saude e Recuperacao (23/10/2026). SOMENTE LEITURA: GET /coach/students/:id/health-recovery. Todas as contas (media, tendencia, total da noite, diferenca entre periodos) vem
// PRONTAS do servidor; aqui so' se desenha. O servidor so' devolve o que a aluna autorizou e nunca mistura fontes: cada indicador e' mostrado para UMA fonte por vez.

type DayValue = { date: string; value: number };
type Trend = { direction: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data'; slopePerDay: number | null; n: number; minObservations?: number };
type Summary = { n: number; mean: number | null; min: number | null; max: number | null; first: DayValue | null; last: DayValue | null; trend: Trend };
type Delta = { mean: number | null; meanPercent: number | null };
type Compare = { summary: Summary; delta: Delta } | null;
type SourceInfo = { key: string; name: string; n: number; firstDate: string; lastDate: string; lastReceivedAt: string | null };
type State = 'ok' | 'sem_dados_no_periodo' | 'sem_dados' | 'nao_autorizada' | 'fonte_sem_este_indicador';
type Common = { label: string; unit: string; state: State; sources: SourceInfo[]; selectedSource: string | null; mainSource: string | null; mixedSources: boolean; methodNote: string | null };
type SleepSession = { id: string; role: 'principal' | 'adicional' | 'cochilo'; start: string; end: string | null; endIsEstimated: boolean; durationMin: number | null; deepMin: number | null; lightMin: number | null; remMin: number | null; awakeMin: number | null; scoreValue: number | null; counted: boolean; note: string | null };
type Night = { date: string; sessions: SleepSession[]; totalMin: number | null; totalBasis: 'sessao_unica' | 'soma_sem_sobreposicao' | 'indeterminado'; deepMin: number | null; lightMin: number | null; remMin: number | null; awakeMin: number | null; napMin: number | null; limitations: string[] };
type Indicator = Common & { id: 'hrv' | 'restingHr' | 'steps' | 'activeKcal'; points: DayValue[]; summary: Summary; compare: Compare };
type SleepBlock = Common & { id: 'sleep'; nights: Night[]; summary: Summary; compare: Compare; stageMeans: { deepMin: number | null; lightMin: number | null; remMin: number | null; awakeMin: number | null; napMin: number | null }; nightsTotal: number; nightsWithoutSafeTotal: number; scorePoints: DayValue[] };
type Result = { studentId: string; generatedAt: string; period: { from: string; to: string }; comparePeriod: { from: string; to: string } | null; availableRange: { from: string | null; to: string | null }; sources: Array<{ key: string; name: string }>; sleep: SleepBlock; indicators: Indicator[] };

type TabId = 'sleep' | 'hrv' | 'restingHr' | 'steps' | 'activeKcal';
const TABS: Array<{ id: TabId; label: string; Icon: typeof Moon }> = [
  { id: 'sleep', label: 'Sono', Icon: Moon },
  { id: 'hrv', label: 'HRV', Icon: Activity },
  { id: 'restingHr', label: 'FC de repouso', Icon: HeartPulse },
  { id: 'steps', label: 'Passos', Icon: Footprints },
  { id: 'activeKcal', label: 'Calorias ativas', Icon: Flame },
];

const STATE_LABEL: Record<State, string> = {
  ok: 'Recebendo', sem_dados_no_periodo: 'Sem dados neste período', sem_dados: 'Sem dados ainda', nao_autorizada: 'Não autorizada pela aluna', fonte_sem_este_indicador: 'Esta fonte não tem este indicador',
};
const STATE_TONE: Record<State, string> = { ok: 'ok', sem_dados_no_periodo: 'warn', sem_dados: 'neutral', nao_autorizada: 'bad', fonte_sem_este_indicador: 'neutral' };

const COLORS = { deep: '#1d4ed8', light: '#60a5fa', rem: '#8b5cf6', awake: '#f59e0b', total: '#0f766e', nap: '#94a3b8', undetermined: '#cbd5e1', line: '#0f766e', mean: '#64748b' };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(new Date(`${date}T12:00:00.000Z`).getTime() + days * 86_400_000));
const dmy = (date: string | null | undefined) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—');
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const when = (value: string | null) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const num = (value: number | null | undefined, decimals = 1) => (value == null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: decimals }));
const hm = (minutes: number | null | undefined) => {
  if (minutes == null) return '—';
  const total = Math.round(minutes);
  const h = Math.floor(total / 60); const m = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
};
const clock = (local: string | null) => (local ? local.slice(11, 16) : '—');

function unitText(id: TabId, source: string | null): string {
  if (id === 'restingHr') return 'bpm';
  if (id === 'steps') return 'passos';
  if (id === 'activeKcal') return 'kcal';
  if (id === 'hrv') return source?.startsWith('health_connect') || source === 'polar' ? 'ms' : ''; // Zepp: unidade nao especificada pela fonte (dita na nota do indicador); Polar e Health Connect: RMSSD em ms
  return '';
}
const fmtValue = (id: TabId, value: number | null | undefined, source: string | null) => {
  if (value == null) return '—';
  if (id === 'sleep') return hm(value);
  const unit = unitText(id, source);
  return `${num(value, id === 'steps' || id === 'activeKcal' ? 0 : 1)}${unit ? ` ${unit}` : ''}`;
};

function trendWords(id: TabId, trend: Trend, source: string | null): { text: string; Icon: typeof Minus; tone: string } {
  if (trend.direction === 'insufficient_data' || trend.slopePerDay == null) return { text: `Poucos registros para indicar tendência (mínimo ${trend.minObservations ?? 5})`, Icon: Minus, tone: 'neutral' };
  const perDay = Math.abs(trend.slopePerDay);
  const amount = id === 'sleep' ? (perDay < 1 ? `${num(perDay, 2)} min` : perDay < 60 ? `${num(perDay, 1)} min` : hm(perDay)) : fmtValue(id, perDay, source);
  if (trend.direction === 'stable') return { text: 'Estável no período', Icon: Minus, tone: 'neutral' };
  return trend.direction === 'increasing'
    ? { text: `Subindo, cerca de ${amount} por dia`, Icon: TrendingUp, tone: 'neutral' }
    : { text: `Caindo, cerca de ${amount} por dia`, Icon: TrendingDown, tone: 'neutral' };
}

function SummaryCards({ id, summary, source, label }: { id: TabId; summary: Summary; source: string | null; label?: string }) {
  const t = trendWords(id, summary.trend, source);
  const TIcon = t.Icon;
  return (
    <div className="hrSummary" aria-label={label}>
      <div><small>Observações</small><strong>{summary.n}</strong><em>{id === 'sleep' ? 'noites com total confiável' : 'dias com medição'}</em></div>
      <div><small>Média do período</small><strong>{fmtValue(id, summary.mean, source)}</strong></div>
      <div><small>Menor e maior</small><strong>{fmtValue(id, summary.min, source)} <ArrowRight size={12} /> {fmtValue(id, summary.max, source)}</strong></div>
      <div><small>Primeira e última</small><strong>{summary.first ? `${dm(summary.first.date)}: ${fmtValue(id, summary.first.value, source)}` : '—'}</strong><em>{summary.last ? `${dm(summary.last.date)}: ${fmtValue(id, summary.last.value, source)}` : ''}</em></div>
      <div className={`hrTrend ${t.tone}`}><small>Tendência no período</small><strong><TIcon size={15} /> {t.text}</strong><em>descrição do período, não diagnóstico · reta de melhor ajuste · {summary.trend.n} registro(s)</em></div>
    </div>
  );
}

function CompareTable({ id, current, compare, period, comparePeriod, source }: { id: TabId; current: Summary; compare: NonNullable<Compare>; period: Result['period']; comparePeriod: NonNullable<Result['comparePeriod']>; source: string | null }) {
  const diff = compare.delta.mean;
  const magnitude = diff == null ? '' : id === 'sleep' ? hm(Math.abs(diff)) : fmtValue(id, Math.abs(diff), source);
  const diffText = diff == null ? 'sem base para comparar' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${magnitude}${compare.delta.meanPercent != null ? ` (${compare.delta.meanPercent > 0 ? '+' : ''}${num(compare.delta.meanPercent, 1)}%)` : ''}`;
  const row = (label: string, a: string, b: string) => <tr><th>{label}</th><td>{a}</td><td>{b}</td></tr>;
  return (
    <div className="hrCompare">
      <h4><GitCompare size={15} /> Comparação entre períodos</h4>
      <table>
        <thead><tr><th /><th>Comparação<br /><small>{dmy(comparePeriod.from)} a {dmy(comparePeriod.to)}</small></th><th>Período atual<br /><small>{dmy(period.from)} a {dmy(period.to)}</small></th></tr></thead>
        <tbody>
          {row('Observações', String(compare.summary.n), String(current.n))}
          {row('Média', fmtValue(id, compare.summary.mean, source), fmtValue(id, current.mean, source))}
          {row('Menor', fmtValue(id, compare.summary.min, source), fmtValue(id, current.min, source))}
          {row('Maior', fmtValue(id, compare.summary.max, source), fmtValue(id, current.max, source))}
          {row('Tendência', trendWords(id, compare.summary.trend, source).text, trendWords(id, current.trend, source).text)}
        </tbody>
      </table>
      <p className="hrDelta">Diferença da média (atual − comparação): <strong>{diffText}</strong></p>
    </div>
  );
}

function SleepTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartNight }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const n = payload[0].payload.night;
  return (
    <div className="hrTooltip">
      <strong>{dmy(n.date)}</strong>
      <div>Total da noite: <b>{n.totalMin == null ? 'não determinado' : hm(n.totalMin)}</b></div>
      {n.napMin != null ? <div>Cochilos: {hm(n.napMin)}</div> : null}
      {n.sessions.map((s) => (
        <div key={s.id} className="hrTipSession">{s.role === 'principal' ? 'Sono principal' : s.role === 'adicional' ? 'Sessão adicional' : 'Cochilo'}: {clock(s.start)}–{clock(s.end)} · {hm(s.durationMin)}{!s.counted ? ' (não somada)' : ''}</div>
      ))}
      {n.limitations.map((l) => <div key={l} className="hrTipLimit">{l}</div>)}
    </div>
  );
}

interface ChartNight { date: string; label: string; deep: number | null; light: number | null; rem: number | null; awake: number | null; total: number | null; undetermined: number | null; nap: number | null; score: number | null; night: Night }

function SleepView({ block, period, compare, comparePeriod }: { block: SleepBlock; period: Result['period']; compare: Compare; comparePeriod: Result['comparePeriod'] }) {
  const data: ChartNight[] = block.nights.map((n) => {
    const stages = n.deepMin != null && n.lightMin != null && n.remMin != null && n.awakeMin != null;
    const principal = n.sessions.find((s) => s.role === 'principal');
    const score = block.scorePoints.find((p) => p.date === n.date)?.value ?? null;
    return {
      date: n.date, label: dm(n.date), night: n, nap: n.napMin, score,
      deep: stages ? n.deepMin : null, light: stages ? n.lightMin : null, rem: stages ? n.remMin : null, awake: stages ? n.awakeMin : null,
      total: n.totalMin != null && !stages ? n.totalMin : null,
      undetermined: n.totalMin == null ? principal?.durationMin ?? null : null,
    };
  });
  const hasScore = data.some((d) => d.score != null);
  const [showSessions, setShowSessions] = useState(false);
  const withLimits = block.nights.filter((n) => n.limitations.length > 0);
  return (
    <>
      <SummaryCards id="sleep" summary={block.summary} source={block.selectedSource} />
      <div className="hrStages">
        <span>Média das etapas (noites completas): </span>
        <b style={{ color: COLORS.deep }}>profundo {hm(block.stageMeans.deepMin)}</b> · <b style={{ color: COLORS.light }}>leve {hm(block.stageMeans.lightMin)}</b> · <b style={{ color: COLORS.rem }}>REM {hm(block.stageMeans.remMin)}</b> · <b style={{ color: COLORS.awake }}>acordada {hm(block.stageMeans.awakeMin)}</b> · <b>cochilo {hm(block.stageMeans.napMin)}</b>
      </div>
      {block.nightsWithoutSafeTotal > 0 ? (
        <p className="hrNotice warn"><AlertTriangle size={14} /><span>{block.nightsWithoutSafeTotal} de {block.nightsTotal} noite(s) com sessões que se sobrepõem ou sem duração: o total não foi calculado para não contar o mesmo período duas vezes. Nessas noites a barra cinza mostra só a sessão principal registrada.</span></p>
      ) : null}
      <div className="hrChart" role="img" aria-label="Gráfico de sono por noite">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
            <YAxis yAxisId="min" fontSize={11} tickFormatter={(v: number) => `${Math.round(v / 60)}h`} />
            {hasScore ? <YAxis yAxisId="score" orientation="right" fontSize={11} domain={[0, 100]} /> : null}
            <Tooltip content={<SleepTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="min" dataKey="deep" name="Profundo" stackId="n" fill={COLORS.deep} isAnimationActive={false} />
            <Bar yAxisId="min" dataKey="light" name="Leve" stackId="n" fill={COLORS.light} isAnimationActive={false} />
            <Bar yAxisId="min" dataKey="rem" name="REM" stackId="n" fill={COLORS.rem} isAnimationActive={false} />
            <Bar yAxisId="min" dataKey="awake" name="Acordada" stackId="n" fill={COLORS.awake} isAnimationActive={false} />
            <Bar yAxisId="min" dataKey="total" name="Duração (sem etapas)" stackId="n" fill={COLORS.total} isAnimationActive={false} />
            <Bar yAxisId="min" dataKey="undetermined" name="Total não determinado (sessão principal)" stackId="n" fill={COLORS.undetermined} isAnimationActive={false} />
            <Bar yAxisId="min" dataKey="nap" name="Cochilo (separado)" fill={COLORS.nap} isAnimationActive={false} />
            {block.summary.mean != null ? <ReferenceLine yAxisId="min" y={block.summary.mean} stroke={COLORS.mean} strokeDasharray="5 4" label={{ value: 'média', fontSize: 11, fill: COLORS.mean, position: 'insideTopRight' }} /> : null}
            {hasScore ? <Line yAxisId="score" type="monotone" dataKey="score" name="Pontuação do fabricante" stroke="#e11d48" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="hrFootnote">Cada barra mostra o tempo em cada etapa (ou só a duração, quando a fonte não informa etapas). O <strong>total da noite</strong> (média e balão ao passar o mouse) soma as sessões sem contar períodos sobrepostos duas vezes, e pode diferir da soma das etapas, porque a fonte pode não incluir o tempo acordada. Cochilos (sessões extras entre 9h e 19h, ou o campo de cochilo da fonte) não entram no total da noite. A pontuação é calculada pelo fabricante do relógio, não pelo Panzeri Run.</p>
      {compare && comparePeriod ? <CompareTable id="sleep" current={block.summary} compare={compare} period={period} comparePeriod={comparePeriod} source={block.selectedSource} /> : null}
      {block.nights.length > 0 ? (
        <>
          <button type="button" className="hrLink" aria-expanded={showSessions} onClick={() => setShowSessions((v) => !v)}>{showSessions ? 'Ocultar' : 'Ver'} as sessões de cada noite{withLimits.length > 0 ? ` (${withLimits.length} com observação)` : ''}</button>
          {showSessions ? (
            <div className="hrSessionsWrap"><table className="hrSessions">
              <thead><tr><th>Noite</th><th>Tipo</th><th>Início–fim</th><th>Duração</th><th>Etapas</th><th /></tr></thead>
              <tbody>
                {[...block.nights].reverse().flatMap((n) => n.sessions.map((s, i) => (
                  <tr key={s.id} className={s.counted ? '' : 'muted'}>
                    <td>{i === 0 ? dmy(n.date) : ''}</td>
                    <td>{s.role === 'principal' ? 'Principal' : s.role === 'adicional' ? 'Adicional' : 'Cochilo'}</td>
                    <td>{clock(s.start)}–{clock(s.end)}{s.endIsEstimated ? '*' : ''}</td>
                    <td>{hm(s.durationMin)}</td>
                    <td>{s.deepMin != null ? `${hm(s.deepMin)} prof. · ${hm(s.lightMin)} leve · ${hm(s.remMin)} REM · ${hm(s.awakeMin)} acord.` : '—'}</td>
                    <td>{s.note ?? (i === 0 && n.totalMin != null ? `Total da noite: ${hm(n.totalMin)}` : i === 0 && n.limitations[0] ? n.limitations[0] : '')}</td>
                  </tr>
                )))}
              </tbody>
            </table></div>
          ) : null}
          {showSessions ? <p className="hrFootnote">* fim estimado pela duração informada.</p> : null}
        </>
      ) : null}
    </>
  );
}

function SeriesView({ block, period, comparePeriod, source }: { block: Indicator; period: Result['period']; comparePeriod: Result['comparePeriod']; source: string | null }) {
  const data = block.points.map((p) => ({ date: p.date, label: dm(p.date), value: p.value }));
  const unit = unitText(block.id, source);
  const isBars = block.id === 'steps' || block.id === 'activeKcal';
  const domain: [number | string, number | string] = block.id === 'restingHr' || block.id === 'hrv' ? ['auto', 'auto'] : [0, 'auto'];
  return (
    <>
      <SummaryCards id={block.id} summary={block.summary} source={source} />
      <div className="hrChart" role="img" aria-label={`Gráfico de ${block.label}`}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
            <YAxis fontSize={11} domain={domain} unit={unit && unit.length <= 4 ? ` ${unit}` : ''} width={isBars ? 64 : 56} />
            <Tooltip formatter={(v) => [fmtValue(block.id, typeof v === 'number' ? v : Number(v), source), block.label]} labelFormatter={(_l, items) => dmy(items?.[0]?.payload?.date)} />
            {isBars ? <Bar dataKey="value" name={block.label} fill={COLORS.line} isAnimationActive={false} /> : <Line type="monotone" dataKey="value" name={block.label} stroke={COLORS.line} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />}
            {block.summary.mean != null ? <ReferenceLine y={block.summary.mean} stroke={COLORS.mean} strokeDasharray="5 4" label={{ value: 'média', fontSize: 11, fill: COLORS.mean, position: 'insideTopRight' }} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {block.id === 'hrv' ? <p className="hrFootnote">HRV é um indicador de recuperação medido pelo relógio, não um diagnóstico. Valores de fontes diferentes usam métodos diferentes e nunca são colocados no mesmo gráfico.</p> : null}
      {block.compare && comparePeriod ? <CompareTable id={block.id} current={block.summary} compare={block.compare} period={period} comparePeriod={comparePeriod} source={source} /> : null}
    </>
  );
}

export default function StudentHealthRecovery({ studentId, accessToken, apiUrl, onOpenIntegrations }: { studentId: string; accessToken: string; apiUrl: string; onOpenIntegrations?: () => void }) {
  // "Hoje" no horario LOCAL do navegador (iso() usa UTC e adiantaria o dia entre 21h e 23h59 em Brasilia).
  const today = useMemo(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }, []);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [source, setSource] = useState('');
  const [compareOn, setCompareOn] = useState(false);
  const [compFrom, setCompFrom] = useState(addDays(today, -59));
  const [compTo, setCompTo] = useState(addDays(today, -30));
  const [tab, setTab] = useState<TabId>('sleep');
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const rangeProblem = from > to ? 'A data inicial não pode ser depois da data final.' : compareOn && compFrom > compTo ? 'No período de comparação, a data inicial não pode ser depois da final.' : null;

  const load = useCallback(async () => {
    if (rangeProblem || !from || !to) return;
    const mine = ++seq.current;
    setLoading(true); setError(null);
    const params = new URLSearchParams({ from, to });
    if (source) params.set('source', source);
    if (compareOn && compFrom && compTo) { params.set('compareFrom', compFrom); params.set('compareTo', compTo); }
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/health-recovery?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (mine !== seq.current) return;
      if (!response.ok) { setData(null); setError(response.status === 400 ? 'Confira as datas escolhidas.' : 'Não foi possível carregar agora.'); setLoading(false); return; }
      setData((await response.json()) as Result);
    } catch { if (mine === seq.current) { setData(null); setError('Não foi possível carregar agora.'); } }
    if (mine === seq.current) setLoading(false);
  }, [apiUrl, studentId, accessToken, from, to, source, compareOn, compFrom, compTo, rangeProblem]);

  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  // Trocar de aluna invalida qualquer resposta em voo e zera fonte, aba e erro (a chave de fonte de uma aluna nao vale para outra).
  useEffect(() => { seq.current += 1; setData(null); setSource(''); setTab('sleep'); setError(null); setLoading(false); }, [studentId]);

  const shortcut = (days: number | 'all') => {
    setTo(today);
    if (days === 'all') setFrom(data?.availableRange.from ?? addDays(today, -365));
    else setFrom(addDays(today, -(days - 1)));
  };

  const blocks: Array<SleepBlock | Indicator> = data ? [data.sleep, ...data.indicators] : [];
  const current = data ? (tab === 'sleep' ? data.sleep : data.indicators.find((i) => i.id === tab)!) : null;
  const allBlocked = data ? blocks.every((b) => b.state === 'nao_autorizada' || b.state === 'sem_dados') : false;
  const selected = current?.sources.find((s) => s.key === current.selectedSource) ?? null;

  return (
    <div className="hrTab">
      <div className="hrHead">
        <div>
          <h3><HeartPulse size={18} /> Saúde e recuperação</h3>
          <p>Sono, variabilidade da frequência cardíaca (HRV), frequência cardíaca de repouso, passos e calorias que a aluna autorizou compartilhar. Somente leitura. Cada indicador mostra <strong>uma fonte por vez</strong>: fontes diferentes medem de formas diferentes e não são comparáveis.</p>
        </div>
      </div>

      <div className="hrControls">
        <div className="hrField"><label htmlFor="hr-from">De</label><input id="hr-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="hrField"><label htmlFor="hr-to">Até</label><input id="hr-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="hrShortcuts" role="group" aria-label="Atalhos de período">
          {[7, 30, 90, 180].map((d) => <button key={d} type="button" onClick={() => shortcut(d)}>{d === 180 ? '6 meses' : `${d} dias`}</button>)}
          <button type="button" onClick={() => shortcut('all')}>Todo o histórico</button>
        </div>
        <div className="hrField"><label htmlFor="hr-source">Fonte dos dados</label>
          <select id="hr-source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Automática (fonte principal de cada indicador)</option>
            {(data?.sources ?? []).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </div>
        <label className="hrCheck"><input type="checkbox" checked={compareOn} onChange={(e) => setCompareOn(e.target.checked)} /> Comparar com outro período</label>
        {compareOn ? (
          <div className="hrCompareRange">
            <div className="hrField"><label htmlFor="hr-cfrom">Comparação: de</label><input id="hr-cfrom" type="date" value={compFrom} max={compTo} onChange={(e) => setCompFrom(e.target.value)} /></div>
            <div className="hrField"><label htmlFor="hr-cto">até</label><input id="hr-cto" type="date" value={compTo} min={compFrom} max={today} onChange={(e) => setCompTo(e.target.value)} /></div>
          </div>
        ) : null}
      </div>
      {rangeProblem ? <p className="hrNotice bad"><AlertTriangle size={14} /><span>{rangeProblem}</span></p> : null}
      {error ? <p className="hrNotice bad"><AlertTriangle size={14} /><span>{error} <button type="button" className="hrLink" onClick={() => void load()}>Tentar de novo</button></span></p> : null}
      {data?.availableRange.from ? <p className="hrFootnote">Histórico disponível: {dmy(data.availableRange.from)} a {dmy(data.availableRange.to)}. {loading ? 'Atualizando…' : ''}</p> : null}

      {!data && !error ? <p className="hrEmpty">Carregando…</p> : null}

      {data ? (
        <>
          <div className="hrStatus" role="list" aria-label="Situação de cada indicador">
            {blocks.map((b) => (
              <button key={b.id} type="button" role="listitem" className={`hrStatusItem ${STATE_TONE[b.state]} ${tab === b.id ? 'active' : ''}`} onClick={() => setTab(b.id)}>
                <strong>{TABS.find((t) => t.id === b.id)?.label}</strong>
                <span>{STATE_LABEL[b.state]}</span>
                {b.mixedSources ? <em>{b.sources.length} fontes</em> : null}
              </button>
            ))}
          </div>

          {allBlocked ? (
            <div className="hrEmpty">
              <p>{blocks.some((b) => b.state === 'nao_autorizada') ? 'A aluna não autorizou o compartilhamento destes dados, então eles não aparecem aqui.' : 'Ainda não chegaram dados de saúde desta aluna.'}</p>
              {onOpenIntegrations ? <button type="button" className="hrLink" onClick={onOpenIntegrations}><Plug size={14} /> Ver o estado das integrações</button> : null}
            </div>
          ) : null}

          {current && !allBlocked ? (
            <section className="hrCard" aria-label={current.label}>
              <header>
                <h4>{current.label}</h4>
                <span className={`hrBadge ${STATE_TONE[current.state]}`}>{STATE_LABEL[current.state]}</span>
              </header>

              <div className="hrSource">
                {selected ? (
                  <>
                    <span>Fonte: <strong>{selected.name}</strong>{current.selectedSource === current.mainSource ? ' (fonte principal)' : ''}</span>
                    <span>Última medição: <strong>{dmy(selected.lastDate)}</strong></span>
                    <span>Última sincronização: <strong>{when(selected.lastReceivedAt)}</strong></span>
                    <span>{selected.n} dia(s) com dado no histórico</span>
                  </>
                ) : <span>Sem fonte selecionada.</span>}
              </div>

              {current.mixedSources ? (
                <p className="hrNotice warn"><Info size={14} /><span>Há dados de {current.sources.length} fontes ({current.sources.map((s) => s.name).join(', ')}). Elas medem de formas diferentes e <strong>não são comparáveis</strong>: o gráfico mostra só {selected?.name ?? 'uma delas'}. Para ver outra, escolha em “Fonte dos dados”.</span></p>
              ) : null}
              {current.methodNote ? <p className="hrNotice"><Info size={14} /><span>{current.methodNote}</span></p> : null}

              {current.state === 'nao_autorizada' ? <p className="hrEmpty">A aluna não autorizou o compartilhamento desta categoria. Nada é exibido.</p> : null}
              {current.state === 'sem_dados' ? <p className="hrEmpty">Ainda não chegou nenhum dado desta categoria.</p> : null}
              {current.state === 'fonte_sem_este_indicador' ? <p className="hrEmpty">A fonte escolhida não tem este indicador. Troque a fonte ou volte para “Automática”.</p> : null}
              {current.state === 'sem_dados_no_periodo' ? <p className="hrEmpty">Nenhuma medição entre {dmy(data.period.from)} e {dmy(data.period.to)}{selected ? ` (última medição desta fonte: ${dmy(selected.lastDate)})` : ''}. Amplie o período.</p> : null}

              {current.state === 'ok' ? (
                current.id === 'sleep'
                  ? <SleepView block={current} period={data.period} compare={current.compare} comparePeriod={data.comparePeriod} />
                  : <SeriesView block={current} period={data.period} comparePeriod={data.comparePeriod} source={current.selectedSource} />
              ) : null}
            </section>
          ) : null}
          <p className="hrFootnote">Atualizado em {when(data.generatedAt)} · <button type="button" className="hrLink" onClick={() => void load()}>Atualizar</button> · Aqui o treinador só consulta; quem conecta e autoriza é a aluna, no aplicativo.</p>
        </>
      ) : null}
    </div>
  );
}
