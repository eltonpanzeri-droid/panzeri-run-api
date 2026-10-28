'use client';
import * as React from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Info, Minus, Plug, TrendingDown, TrendingUp } from 'lucide-react';
import { API_URL, PERIODS, dateKey } from './data';
import { ChartLegend, DEFAULT_EXPLORER_LAYERS, LAYER_COLORS, type ExplorerLayers } from './explorer-chart';
import { SIGNAL_LABEL, referenceFor, type ExplorerSnapshot, type ReferencePoint } from './explorer-data';

// Composicao do sono por noite (Evolucao > Sono). E' o grafico especializado da antiga aba "Saude e Recuperacao" (23/10/2026), preservado: uma coluna empilhada por noite
// (profundo, leve, REM, acordada), pontuacao do fabricante em linha, total da noite sem contar sessoes sobrepostas duas vezes e sessoes de cada noite. SOMENTE LEITURA:
// as noites e o resumo vem prontos de GET /coach/students/:id/health-recovery; as referencias (media historica, MM7/21/60/200, faixa habitual) vem do backend
// (observations/:id?reference=1) e so' usam observacoes ANTERIORES. Nada de estatistica e' calculado aqui.

type DayValue = { date: string; value: number };
type Trend = { direction: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data'; slopePerDay: number | null; n: number; minObservations?: number };
type Summary = { n: number; mean: number | null; min: number | null; max: number | null; first: DayValue | null; last: DayValue | null; trend: Trend };
type SourceInfo = { key: string; name: string; n: number; firstDate: string; lastDate: string; lastReceivedAt: string | null };
type State = 'ok' | 'sem_dados_no_periodo' | 'sem_dados' | 'nao_autorizada' | 'fonte_sem_este_indicador';
type SleepSession = { id: string; role: 'principal' | 'adicional' | 'cochilo'; start: string; end: string | null; endIsEstimated: boolean; durationMin: number | null; deepMin: number | null; lightMin: number | null; remMin: number | null; awakeMin: number | null; scoreValue: number | null; counted: boolean; note: string | null };
type Night = { date: string; sessions: SleepSession[]; totalMin: number | null; totalBasis: string; deepMin: number | null; lightMin: number | null; remMin: number | null; awakeMin: number | null; napMin: number | null; limitations: string[] };
type SleepBlock = {
  label: string; state: State; sources: SourceInfo[]; selectedSource: string | null; mainSource: string | null; mixedSources: boolean; methodNote: string | null;
  nights: Night[]; summary: Summary; stageMeans: { deepMin: number | null; lightMin: number | null; remMin: number | null; awakeMin: number | null; napMin: number | null }; nightsTotal: number; nightsWithoutSafeTotal: number; scorePoints: DayValue[];
};
type Result = { period: { from: string; to: string }; availableRange: { from: string | null; to: string | null }; sources: Array<{ key: string; name: string }>; sleep: SleepBlock };

const STATE_LABEL: Record<State, string> = {
  ok: 'Recebendo', sem_dados_no_periodo: 'Sem dados neste período', sem_dados: 'Sem dados ainda', nao_autorizada: 'Não autorizada pela aluna', fonte_sem_este_indicador: 'Esta fonte não tem este indicador',
};
const COLORS = { deep: '#1d4ed8', light: '#60a5fa', rem: '#8b5cf6', awake: '#f59e0b', total: '#0f766e', nap: '#94a3b8', undetermined: '#cbd5e1', score: '#e11d48' };

// Variavel cuja serie de referencias e' sobreposta. Cada uma tem as proprias medias e faixa (nunca se misturam grandezas): a duracao total, cada etapa ou a pontuacao.
const REFERENCE_TARGETS: Array<{ id: string; label: string; axis: 'min' | 'score' }> = [
  { id: 'wearable.sleepDurationMin', label: 'Duração do sono', axis: 'min' },
  { id: 'wearable.sleepDeepMin', label: 'Sono profundo', axis: 'min' },
  { id: 'wearable.sleepLightMin', label: 'Sono leve', axis: 'min' },
  { id: 'wearable.sleepRemMin', label: 'Sono REM', axis: 'min' },
  { id: 'wearable.sleepAwakeMin', label: 'Tempo acordada', axis: 'min' },
  { id: 'wearable.sleepScore', label: 'Pontuação do sono', axis: 'score' },
];

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

function trendWords(trend: Trend): { text: string; Icon: typeof Minus } {
  if (trend.direction === 'insufficient_data' || trend.slopePerDay == null) return { text: `Poucos registros para indicar tendência (mínimo ${trend.minObservations ?? 5})`, Icon: Minus };
  const perDay = Math.abs(trend.slopePerDay);
  const amount = perDay < 1 ? `${num(perDay, 2)} min` : perDay < 60 ? `${num(perDay, 1)} min` : hm(perDay);
  if (trend.direction === 'stable') return { text: 'Estável no período', Icon: Minus };
  return trend.direction === 'increasing' ? { text: `Subindo, cerca de ${amount} por dia`, Icon: TrendingUp } : { text: `Caindo, cerca de ${amount} por dia`, Icon: TrendingDown };
}

function SummaryCards({ summary }: { summary: Summary }) {
  const t = trendWords(summary.trend);
  const TIcon = t.Icon;
  return (
    <div className="hrSummary" aria-label="Resumo do sono no período">
      <div><small>Observações</small><strong>{summary.n}</strong><em>noites com total confiável</em></div>
      <div><small>Média do período</small><strong>{hm(summary.mean)}</strong></div>
      <div><small>Menor e maior</small><strong>{hm(summary.min)} <ArrowRight size={12} /> {hm(summary.max)}</strong></div>
      <div><small>Primeira e última</small><strong>{summary.first ? `${dm(summary.first.date)}: ${hm(summary.first.value)}` : '—'}</strong><em>{summary.last ? `${dm(summary.last.date)}: ${hm(summary.last.value)}` : ''}</em></div>
      <div className="hrTrend neutral"><small>Tendência no período</small><strong><TIcon size={15} /> {t.text}</strong><em>descrição do período, não diagnóstico · reta de melhor ajuste · {summary.trend.n} registro(s)</em></div>
    </div>
  );
}

interface ChartNight {
  date: string; label: string; deep: number | null; light: number | null; rem: number | null; awake: number | null; total: number | null; undetermined: number | null; nap: number | null; score: number | null;
  mean: number | null; mm7: number | null; mm21: number | null; mm60: number | null; mm200: number | null; band: [number, number] | null; reference: ReferencePoint | null; night: Night;
}

function SleepTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartNight }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const n = row.night;
  return (
    <div className="hrTooltip">
      <strong>{dmy(n.date)}</strong>
      <div>Total da noite: <b>{n.totalMin == null ? 'não determinado' : hm(n.totalMin)}</b></div>
      {n.napMin != null ? <div>Cochilos: {hm(n.napMin)}</div> : null}
      {n.sessions.map((s) => (
        <div key={s.id} className="hrTipSession">{s.role === 'principal' ? 'Sono principal' : s.role === 'adicional' ? 'Sessão adicional' : 'Cochilo'}: {clock(s.start)}–{clock(s.end)} · {hm(s.durationMin)}{!s.counted ? ' (não somada)' : ''}</div>
      ))}
      {row.reference ? <div className="hrTipSession">Referência: {SIGNAL_LABEL[row.reference.signal]}{row.reference.band.lower != null ? ` (${num(row.reference.band.lower, 0)} – ${num(row.reference.band.upper, 0)})` : ''}</div> : null}
      {n.limitations.map((l) => <div key={l} className="hrTipLimit">{l}</div>)}
    </div>
  );
}

export default function SleepComposition({ studentId, token, period, onOpenIntegrations }: {
  studentId: string; token: string; period: { id: string; custom: [number, number] | null }; onOpenIntegrations?: () => void;
}) {
  // "Hoje" no horario LOCAL do navegador (iso() usa UTC e adiantaria o dia entre 21h e 23h59 em Brasilia).
  const today = React.useMemo(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }, []);
  const { from, to } = React.useMemo(() => {
    if (period.id === 'custom' && period.custom) return { from: iso(new Date(period.custom[0])), to: iso(new Date(period.custom[1])) };
    const days = PERIODS.find((p) => p.id === period.id)?.days ?? 0;
    return { from: addDays(today, days ? -(days - 1) : -3600), to: today };
  }, [period, today]);
  const [source, setSource] = React.useState('');
  const [targetId, setTargetId] = React.useState(REFERENCE_TARGETS[0].id);
  const [layers, setLayers] = React.useState<ExplorerLayers>(DEFAULT_EXPLORER_LAYERS);
  const [data, setData] = React.useState<{ key: string; result: Result } | null>(null);
  const [refSnapshot, setRefSnapshot] = React.useState<{ key: string; snapshot: ExplorerSnapshot | null } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showSessions, setShowSessions] = React.useState(false);
  const headers = React.useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const key = `${studentId}|${from}|${to}|${source}`;

  React.useEffect(() => { setSource(''); }, [studentId]);

  React.useEffect(() => {
    const controller = new AbortController();
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ from, to });
        if (source) params.set('source', source);
        const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/health-recovery?${params.toString()}`, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? 'Sessão expirada. Entre novamente no Admin.' : 'Não foi possível carregar o sono agora.');
        const result = await response.json() as Result;
        if (!controller.signal.aborted) setData({ key, result });
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o sono agora.'); }
    })();
    return () => controller.abort();
  }, [key, studentId, from, to, source, headers]);

  const block = data && data.key === key ? data.result.sleep : null;
  const refSource = block?.selectedSource ?? '';
  const refKey = `${studentId}|${targetId}|${refSource}`;
  React.useEffect(() => {
    if (!block || block.state !== 'ok') return;
    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({ reference: '1' });
        if (refSource) params.set('source', refSource);
        const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/observations/${encodeURIComponent(targetId)}?${params.toString()}`, { headers, signal: controller.signal });
        if (!response.ok) throw new Error('sem referencias');
        const snapshot = await response.json() as ExplorerSnapshot;
        if (!controller.signal.aborted) setRefSnapshot({ key: refKey, snapshot });
      } catch { if (!controller.signal.aborted) setRefSnapshot({ key: refKey, snapshot: null }); }
    })();
    return () => controller.abort();
  }, [refKey, block, studentId, targetId, refSource, headers]);

  const target = REFERENCE_TARGETS.find((t) => t.id === targetId) ?? REFERENCE_TARGETS[0];
  const refSnap = refSnapshot && refSnapshot.key === refKey ? refSnapshot.snapshot : null;

  // referencia de cada noite: a observacao da variavel escolhida com a mesma data de calendario (a sessao principal tem prioridade sobre sessoes adicionais/cochilos)
  const refByDate = React.useMemo(() => {
    const map = new Map<string, { point: ReferencePoint; principal: boolean }>();
    if (!refSnap?.reference) return map;
    const numeric = refSnap.observations.filter((o) => typeof o.value === 'number');
    numeric.forEach((observation, position) => {
      const point = referenceFor(refSnap, observation, position);
      if (!point) return;
      const context = (observation.context ?? {}) as Record<string, unknown>;
      const day = typeof context.calendarDate === 'string' ? context.calendarDate : dateKey(observation.timestamp);
      const principal = context.sessionRole === 'principal' || context.sessionRole === undefined;
      const existing = map.get(day);
      if (!existing || (principal && !existing.principal)) map.set(day, { point, principal });
    });
    return map;
  }, [refSnap]);

  const rows = React.useMemo<ChartNight[]>(() => (block?.nights ?? []).map((n) => {
    const stages = n.deepMin != null && n.lightMin != null && n.remMin != null && n.awakeMin != null;
    const principal = n.sessions.find((s) => s.role === 'principal');
    const ref = refByDate.get(n.date)?.point ?? null;
    const ma = (k: 'mm7' | 'mm21' | 'mm60' | 'mm200') => ref?.movingAverages[k].value ?? null;
    return {
      date: n.date, label: dm(n.date), night: n, nap: n.napMin, score: block?.scorePoints.find((p) => p.date === n.date)?.value ?? null,
      deep: stages ? n.deepMin : null, light: stages ? n.lightMin : null, rem: stages ? n.remMin : null, awake: stages ? n.awakeMin : null,
      total: n.totalMin != null && !stages ? n.totalMin : null,
      undetermined: n.totalMin == null ? principal?.durationMin ?? null : null,
      reference: ref, mean: ref?.historicalMean.value ?? null, mm7: ma('mm7'), mm21: ma('mm21'), mm60: ma('mm60'), mm200: ma('mm200'),
      band: ref && ref.band.basis !== 'none' && ref.band.lower != null && ref.band.upper != null ? [ref.band.lower, ref.band.upper] : null,
    };
  }), [block, refByDate]);

  if (error) return <p role="alert" className="evx-error">{error}</p>;
  if (!block || !data) return <p role="status" className="evx-empty">Carregando sono…</p>;

  const hasScore = rows.some((r) => r.score != null);
  const refAxis = target.axis === 'score' && hasScore ? 'score' : 'min';
  const withLimits = block.nights.filter((n) => n.limitations.length > 0);
  const selected = block.sources.find((s) => s.key === block.selectedSource) ?? null;
  const sourceOptions = data.result.sources;

  return (
    <div className="hrTab">
      <header className="evx-head">
        <div><h3>Composição do sono</h3><p>Uma coluna por noite, com o tempo em cada etapa. Somente leitura: o treinador consulta; quem conecta e autoriza é a aluna, no aplicativo.</p></div>
        {sourceOptions.length > 1 ? <label className="evx-source">Fonte<select aria-label="Fonte dos dados do sono" value={source || block.mainSource || ''} onChange={(e) => setSource(e.target.value)}>{sourceOptions.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label> : null}
      </header>

      {block.state !== 'ok' ? (
        <div className="hrEmpty">
          <p>{block.state === 'sem_dados_no_periodo' ? `Nenhuma noite entre ${dmy(data.result.period.from)} e ${dmy(data.result.period.to)}. Amplie o período.` : STATE_LABEL[block.state] + (block.state === 'nao_autorizada' ? '. Nada é exibido.' : '.')}</p>
          {onOpenIntegrations ? <button type="button" className="hrLink" onClick={onOpenIntegrations}><Plug size={14} /> Ver o estado das integrações</button> : null}
        </div>
      ) : (
        <>
          <div className="hrSource">
            {selected ? (
              <>
                <span>Fonte: <strong>{selected.name}</strong>{block.selectedSource === block.mainSource ? ' (fonte principal)' : ''}</span>
                <span>Última medição: <strong>{dmy(selected.lastDate)}</strong></span>
                <span>Última sincronização: <strong>{when(selected.lastReceivedAt)}</strong></span>
              </>
            ) : <span>Sem fonte selecionada.</span>}
          </div>
          {block.mixedSources ? <p className="hrNotice warn"><Info size={14} /><span>Há dados de {block.sources.length} fontes ({block.sources.map((s) => s.name).join(', ')}). Elas medem de formas diferentes e <strong>não são comparáveis</strong>: o gráfico mostra só {selected?.name ?? 'uma delas'}.</span></p> : null}
          {block.methodNote ? <p className="hrNotice"><Info size={14} /><span>{block.methodNote}</span></p> : null}

          <SummaryCards summary={block.summary} />
          <div className="hrStages">
            <span>Média das etapas (noites completas): </span>
            <b style={{ color: COLORS.deep }}>profundo {hm(block.stageMeans.deepMin)}</b> · <b style={{ color: COLORS.light }}>leve {hm(block.stageMeans.lightMin)}</b> · <b style={{ color: COLORS.rem }}>REM {hm(block.stageMeans.remMin)}</b> · <b style={{ color: COLORS.awake }}>acordada {hm(block.stageMeans.awakeMin)}</b> · <b>cochilo {hm(block.stageMeans.napMin)}</b>
          </div>
          {block.nightsWithoutSafeTotal > 0 ? (
            <p className="hrNotice warn"><AlertTriangle size={14} /><span>{block.nightsWithoutSafeTotal} de {block.nightsTotal} noite(s) com sessões que se sobrepõem ou sem duração: o total não foi calculado para não contar o mesmo período duas vezes. Nessas noites a barra cinza mostra só a sessão principal registrada.</span></p>
          ) : null}

          <div className="evx-controls">
            <label className="evx-source">Referências de<select aria-label="Série das referências históricas" value={targetId} onChange={(e) => setTargetId(e.target.value)}>{REFERENCE_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          </div>
          <div className="hrChart" role="img" aria-label="Gráfico de composição do sono por noite">
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                {layers.band ? <Area yAxisId={refAxis} type="monotone" dataKey="band" name={`Faixa habitual · ${target.label}`} stroke={LAYER_COLORS.band} strokeOpacity={0.45} fill={LAYER_COLORS.band} fillOpacity={0.16} connectNulls={false} isAnimationActive={false} legendType="none" /> : null}
                {layers.mean ? <Line yAxisId={refAxis} type="monotone" dataKey="mean" name={`Média histórica · ${target.label}`} stroke={LAYER_COLORS.mean} strokeWidth={1.8} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} legendType="none" /> : null}
                {(['mm7', 'mm21', 'mm60', 'mm200'] as const).filter((k) => layers[k]).map((k) => <Line key={k} yAxisId={refAxis} type="monotone" dataKey={k} name={`${refSnap?.reference?.windows.find((w) => w.key === k)?.label ?? k.toUpperCase()} · ${target.label}`} stroke={LAYER_COLORS[k]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />)}
                {hasScore ? <Line yAxisId="score" type="monotone" dataKey="score" name="Pontuação do fabricante" stroke={COLORS.score} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} /> : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {refSnap ? <ChartLegend snapshot={refSnap} layers={layers} onToggle={(k) => setLayers((current) => ({ ...current, [k]: !current[k] }))} /> : <p className="hrFootnote">Referências históricas indisponíveis para “{target.label}” nesta fonte (poucos registros ou série não recebida).</p>}
          <p className="hrFootnote">As linhas e a faixa mostram o histórico <strong>anterior</strong> de “{target.label}” (cada noite é comparada só com as noites que vieram antes dela). Elas ficam no mesmo eixo das colunas ({refAxis === 'score' ? 'à direita, de 0 a 100' : 'em minutos'}) e descrevem o padrão da própria aluna, sem dizer se algo é bom ou ruim. Cada barra mostra o tempo em cada etapa (ou só a duração, quando a fonte não informa etapas). O <strong>total da noite</strong> soma as sessões sem contar períodos sobrepostos duas vezes e pode diferir da soma das etapas. Cochilos não entram no total da noite. A pontuação é calculada pelo fabricante do relógio, não pelo Panzeri Run.</p>

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
      )}
    </div>
  );
}
