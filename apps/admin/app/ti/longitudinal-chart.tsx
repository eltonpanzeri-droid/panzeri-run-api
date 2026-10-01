'use client';
import * as React from 'react';
import { ChartConfig, ChartLabels, ChartView, ContextEvent, EVENT_TYPES, Layers, Snapshot, chartAxis, chartViews, dateKey, dateLabel, eventOverlaps, fmt, inWindow, observationsAt, time } from './data';

type Comparison = { snapshot: Snapshot; color: string; title: string };
type Props = { comparisons?: Comparison[]; snapshot: Snapshot; color: string; layers: Layers; config: ChartConfig; onConfig: (next: ChartConfig) => void; onReset: () => void; onRemove: () => void; range: [number, number]; cursor: string; onCursor: (date: string) => void; events: ContextEvent[]; onEvent: (event: ContextEvent) => void; compact?: boolean; title: string };
const WINDOWS = [{ key: 'short_21d', toggle: 'mm21', name: 'MM21', color: '#139d94' }, { key: 'medium_60d', toggle: 'mm60', name: 'MM60', color: '#aa6ee1' }, { key: 'long_200d', toggle: 'mm200', name: 'MM200', color: '#c58b4c' }] as const;

// SVG only maps canonical API values to screen coordinates. It never derives training metrics.
export function LongitudinalChart({ snapshot, color, layers, config, onConfig, onReset, onRemove, range, cursor, onCursor, events, onEvent, compact, title, comparisons = [] }: Props) {
  const root = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(800);
  const [fullScale, setFullScale] = React.useState(false);
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(280, Math.round(entry.contentRect.width));
      setWidth((previous) => previous === next ? previous : next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const gradient = React.useId().replaceAll(':', '');
  const height = compact && !config.expanded ? 280 : 450;
  const left = 49, right = width - 18, top = 32, bottom = height - 60;
  const visible = snapshot.observations.filter((o) => inWindow(o.timestamp, range));
  const numeric = visible.filter((o): o is typeof o & { value: number } => typeof o.value === 'number');
  const derived = WINDOWS.filter((w) => layers[w.toggle]).flatMap((w) => (snapshot.movingAverageSeries?.[w.key] ?? []).filter((p) => inWindow(p.timestamp, range) && p.value != null).map((p) => p.value!));
  const extra = comparisons.flatMap((c) => c.snapshot.observations.filter((o) => inWindow(o.timestamp, range) && typeof o.value === 'number').map((o) => ({ ...o, value: o.value as number, color: c.color, title: c.title })));
  const values = [...(layers.raw ? numeric.map((o) => o.value) : []), ...derived, ...(layers.raw ? extra.map((o) => o.value) : [])];
  if (layers.baseline && snapshot.baseline?.value != null) values.push(snapshot.baseline.value);
  if (layers.habitual && snapshot.habitualRange) for (const v of [snapshot.habitualRange.lower, snapshot.habitualRange.upper]) if (v != null) values.push(v);
  const bars = config.view === 'bars' || config.view === 'mixed';
  const line = config.view === 'line' || config.view === 'mixed';
  const dots = config.view === 'line' || config.view === 'points' || config.view === 'mixed';
  const { min, max, ticks } = chartAxis(snapshot.variable, values, bars, fullScale);
  const x = (at: number) => left + (at - range[0]) / Math.max(1, range[1] - range[0]) * (right - left);
  const y = (v: number) => bottom - (v - min) / Math.max(0.000001, max - min) * (bottom - top);
  const dates = [...new Set([...visible, ...extra].map((o) => dateKey(o.timestamp)))].sort();
  const selected = cursor ? observationsAt(snapshot, cursor) : [];
  const selectedInWindow = cursor && inWindow(cursor, range);
  const path = (points: Array<{ timestamp: string; value: number | null }>) => {
    let started = false;
    return points.filter((p) => inWindow(p.timestamp, range)).map((p) => {
      if (p.value == null) { started = false; return ''; }
      const command = started ? 'L' : 'M'; started = true;
      return `${command}${x(time(p.timestamp)).toFixed(2)},${y(p.value).toFixed(2)}`;
    }).join(' ');
  };
  function inspect(clientX: number) {
    const rect = root.current?.getBoundingClientRect();
    if (!rect || !dates.length) return;
    const pixel = (clientX - rect.left) * width / rect.width;
    const at = range[0] + Math.max(0, Math.min(1, (pixel - left) / (right - left))) * (range[1] - range[0]);
    const nearest = dates.reduce((a, b) => Math.abs(time(a) - at) <= Math.abs(time(b) - at) ? a : b);
    if (nearest !== cursor) onCursor(nearest);
  }
  const partial = visible.filter((o) => o.context?.isPartialWeek);
  const rangeInfo = snapshot.habitualRange;
  const availableLayers: Array<[keyof Layers, string, boolean]> = [
    ['raw', 'Bruto', true], ['mm21', 'MM21', Boolean(snapshot.movingAverageSeries?.short_21d?.length)],
    ['mm60', 'MM60', Boolean(snapshot.movingAverageSeries?.medium_60d?.length)],
    ['mm200', 'MM200', Boolean(snapshot.movingAverageSeries?.long_200d?.length)],
    ['baseline', 'Baseline', snapshot.baseline?.value != null],
    ['habitual', 'Faixa habitual', rangeInfo?.lower != null && rangeInfo.upper != null],
    ['trend', 'Tendência', Boolean(snapshot.trend?.short_21d)], ['events', 'Eventos', events.length > 0],
  ];
  const trend = snapshot.trend?.short_21d;
  const trendLabel = trend ? ({ increasing: 'Aumentando', decreasing: 'Diminuindo', stable: 'Estável', insufficient_data: 'Dados insuficientes', up: 'Aumentando', down: 'Diminuindo', flat: 'Estável' } as Record<string, string>)[trend.direction] ?? trend.direction : '';
  const showRawLabels = config.labels === 'raw' || config.labels === 'both';
  const showAverageLabels = config.labels === 'average' || config.labels === 'both';
  return <article className="ti-chart-panel" data-variable={snapshot.variable.id}>
    <div className="ti-chart-title"><div><span className="ti-chart-dot" style={{ background: color }}/><div><h3>{title}</h3><p>{snapshot.variable.scale?.unit ?? (snapshot.mathApplicable ? 'Escala original' : 'Registros categóricos')} · {visible.length} observações no recorte{partial.length ? ' · semana em andamento' : ''}</p></div></div><div className="ti-chart-current"><strong style={{ color }}>{snapshot.mathApplicable ? fmt(snapshot.current) : '—'}</strong><small>último registro{snapshot.evidence.lastObservationAt ? ` · ${dateLabel(snapshot.evidence.lastObservationAt)}` : ''}</small></div></div>
    {snapshot.evidence.comparabilityWarning && <p className="ti-caution">{snapshot.evidence.comparabilityWarning}</p>}
    <div className="ti-chart-toolbar"><details className="ti-chart-settings"><summary>Configurar gráfico</summary><div className="ti-settings-grid"><label>Visualização<select aria-label={`Visualização de ${title}`} value={config.view} onChange={(e) => onConfig({ ...config, view: e.target.value as ChartView })}>{chartViews(snapshot.variable).map((view) => <option key={view} value={view}>{({ mixed: 'Linha + barras', bars: 'Barras', line: 'Linha', points: 'Pontos' } as Record<ChartView, string>)[view]}</option>)}</select></label><label>Rótulos<select aria-label={`Rótulos de ${title}`} value={config.labels} onChange={(e) => onConfig({ ...config, labels: e.target.value as ChartLabels })}><option value="off">Ocultos</option><option value="raw">Bruto</option><option value="average" disabled={!availableLayers.some(([key, , available]) => available && (key === 'mm21' || key === 'mm60' || key === 'mm200'))}>Médias móveis</option><option value="both" disabled={!availableLayers.some(([key, , available]) => available && (key === 'mm21' || key === 'mm60' || key === 'mm200'))}>Bruto e médias</option></select></label><fieldset><legend>Camadas deste gráfico</legend>{availableLayers.filter(([, , available]) => available).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={() => onConfig({ ...config, layers: { ...layers, [key]: !layers[key] } })}/>{label}</label>)}</fieldset><div className="ti-settings-actions"><button onClick={onReset}>Restaurar padrão</button><button onClick={onRemove}>Remover gráfico</button></div></div></details>{compact && <button className="ti-chart-expand" onClick={() => onConfig({ ...config, expanded: !config.expanded })}>{config.expanded ? 'Compactar' : 'Expandir'}</button>}{layers.trend && trend && <span className="ti-trend-chip">Tendência 21d · {trendLabel}</span>}</div>
    {!snapshot.mathApplicable ? <div className="ti-category-records">{visible.length ? visible.map((o, i) => <div key={`${o.timestamp}-${i}`}><time>{dateLabel(o.timestamp, true)}</time><b>{String(o.value)}</b><span>{o.context?.modality ?? ''}</span></div>) : <p className="ti-empty">Nenhum registro neste período.</p>}</div> : <>
      <div ref={root} className="ti-svg-chart" style={{ height }}>
        {visible.length || extra.length ? <svg role="img" aria-label={`${title}: ${visible.length} observações no período`} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} onPointerMove={(e) => inspect(e.clientX)} onClick={(e) => inspect(e.clientX)}>
          <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop stopColor={color} stopOpacity="0.95"/><stop offset="1" stopColor={color} stopOpacity="0.45"/></linearGradient><clipPath id={`${gradient}-clip`}><rect x={left - 4} y={top - 4} width={right - left + 8} height={bottom - top + 8}/></clipPath></defs>
          <rect x={left} y={top} width={right-left} height={bottom-top} fill="var(--ti-plot)" rx="6"/>
          {ticks.map((v, i) => <g key={v}>{(i % (ticks.length > 10 ? 2 : 1) === 0 || v === 0) && <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--ti-grid)" strokeDasharray="3 5"/>}<text x={left - 10} y={y(v) + 4} textAnchor="end" fill="var(--ti-muted)" fontSize="11">{fmt(v)}</text></g>)}
          <text x={left} y={15} fill="var(--ti-muted)" fontSize="12">{snapshot.variable.scale?.unit ?? 'Valor'}</text>
          {dates.filter((_, i) => i % Math.max(1, Math.ceil(dates.length / Math.max(3, Math.floor((right-left)/75)))) === 0).map((day) => <g key={day}><line x1={x(time(day))} x2={x(time(day))} y1={top} y2={bottom} stroke="var(--ti-grid)" strokeDasharray="2 5" opacity=".55"/><text x={x(time(day))} y={bottom+22} textAnchor="middle" fill="var(--ti-muted)" fontSize="11">{dateLabel(day)}</text></g>)}
          <text x={(left+right)/2} y={height-8} textAnchor="middle" fill="var(--ti-muted)" fontSize="12">Data · espaçamento temporal real</text>
          <g clipPath={`url(#${gradient}-clip)`}>
            {bars && min < 0 && max > 0 && <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="var(--ti-muted)" strokeWidth="1.2"/>}
            {layers.habitual && rangeInfo?.lower != null && rangeInfo.upper != null && <rect x={left} y={y(rangeInfo.upper)} width={right - left} height={Math.max(0, y(rangeInfo.lower) - y(rangeInfo.upper))} fill={color} opacity="0.07"/>}
            {partial.map((o, i) => <rect key={i} x={x(time(o.timestamp))} y={top} width={Math.max(4, x(Math.min(range[1], time(o.timestamp) + 6 * 86400000)) - x(time(o.timestamp)))} height={bottom - top} fill="#eba848" opacity="0.12"/>)}
            {layers.baseline && snapshot.baseline?.value != null && <line x1={left} x2={right} y1={y(snapshot.baseline.value)} y2={y(snapshot.baseline.value)} stroke="#bd8e49" strokeDasharray="6 5"/>}
            {layers.raw && line && <path data-raw-line="true" d={path(numeric)} fill="none" stroke={color} strokeWidth="2.4"/>}
            {layers.raw && bars && numeric.map((o, i) => <rect key={i} data-observation="true" data-raw-bar="true" x={x(time(o.timestamp)) - 5} y={Math.min(y(0), y(o.value))} width="10" height={Math.max(1, Math.abs(y(0) - y(o.value)))} rx="2" fill={`url(#${gradient})`} opacity={o.context?.isPartialWeek ? .55 : 1}><title>{dateLabel(o.timestamp, true)}: {fmt(o.value)} · {o.context?.modality ?? ''}{o.context?.isPartialWeek ? ' · semana parcial' : ''}</title></rect>)}
            {layers.raw && dots && numeric.map((o, i) => <circle key={i} data-observation="true" cx={x(time(o.timestamp))} cy={y(o.value)} r={dateKey(o.timestamp) === cursor ? 5 : 3.5} fill="var(--ti-plot)" stroke={color} strokeWidth="2"><title>{dateLabel(o.timestamp, true)}: {fmt(o.value)} · {o.context?.modality ?? ''}</title></circle>)}
            {WINDOWS.filter((w) => layers[w.toggle]).map((w) => <g key={w.key}><path data-derived={w.key} d={path(snapshot.movingAverageSeries?.[w.key] ?? [])} stroke={w.color} strokeWidth="1.7" strokeDasharray={w.toggle === 'mm21' ? undefined : '5 4'} opacity=".8" fill="none"/>{showAverageLabels && (snapshot.movingAverageSeries?.[w.key] ?? []).filter((p) => p.value != null && inWindow(p.timestamp, range) && (dates.length <= 20 || dateKey(p.timestamp) === cursor)).map((p, i) => <text key={i} x={x(time(p.timestamp))} y={y(p.value!) + 17} textAnchor="middle" fill={w.color} stroke="var(--ti-plot)" strokeWidth="3" paintOrder="stroke" fontSize="11">{fmt(p.value)}</text>)}</g>)}
            {layers.raw && comparisons.map((c) => <g key={c.title} data-comparison={c.snapshot.variable.id}><path d={path(c.snapshot.observations.filter((o): o is typeof o & { value: number } => typeof o.value === 'number'))} fill="none" stroke={c.color} strokeWidth="2.4" strokeDasharray="6 3"/>{extra.filter((o) => o.title === c.title).map((o,i) => <circle key={i} cx={x(time(o.timestamp))} cy={y(o.value)} r="4" fill="var(--ti-plot)" stroke={c.color}/>)}</g>)}
            {layers.raw && showRawLabels && [...numeric.map((o) => ({...o, color, title})), ...extra].map((o,i,all) => (all.length <= 24 || dateKey(o.timestamp) === cursor) && <text key={`label-${i}`} data-value-label="true" x={x(time(o.timestamp))} y={y(o.value)+(o.value<0?17:-10)+(o.title!==title?25:0)} textAnchor="middle" fill={o.color} stroke="var(--ti-plot)" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="600">{fmt(o.value)}</text>)}
            {selectedInWindow && <line x1={x(time(cursor))} x2={x(time(cursor))} y1={top} y2={bottom} stroke="var(--ti-muted)" strokeDasharray="4 4"/>}
          </g>
          {layers.events && events.filter((event) => eventOverlaps(event, range)).map((event, i) => { const start = Math.max(range[0], time(event.startedAt ?? event.reportedAt)); const end = event.endedAt ? Math.min(range[1], time(event.endedAt)) : event.status === 'active' ? range[1] : start; return <g key={event.id} role="button" tabIndex={0} aria-label={`Evento: ${EVENT_TYPES[event.type] ?? event.type}`} onClick={(e) => { e.stopPropagation(); onEvent(event); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEvent(event); } }} style={{ cursor: 'pointer' }}>{end > start && <rect x={x(start)} y={top} width={x(end)-x(start)} height={bottom-top} fill="#ab71cb" opacity=".055" pointerEvents="none"/>}<line x1={x(start)} x2={x(start)} y1={top} y2={bottom} stroke="#ab71cb" strokeDasharray="2 5" opacity="0.38" pointerEvents="none"/><circle cx={x(start)} cy={bottom - 6 - (i % 3) * 10} r="5" fill="#ab71cb"><title>{EVENT_TYPES[event.type] ?? event.type} · {dateLabel(event.startedAt ?? event.reportedAt)}</title></circle></g>; })}
        </svg> : <div className="ti-empty ti-chart-empty">{snapshot.observations.length ? 'Nenhuma observação no recorte. Amplie o período ou escolha Tudo.' : 'Ainda não há observações desta variável para o aluno.'}</div>}
      </div>
      {comparisons.length > 0 && <p className="ti-muted">Eixo comum em unidades originais. Médias móveis, baseline e faixa habitual referem-se a {title}. Em séries densas, os rótulos aparecem na data investigada.</p>}
      <div className="ti-chart-foot"><label className="ti-date-inspect">Eixo Y<select aria-label={`Escala de ${title}`} value={fullScale ? 'full' : 'auto'} onChange={(e) => setFullScale(e.target.value === 'full')}><option value="auto">{snapshot.variable.dataType === 'ordinal_scale' ? 'Escala do instrumento' : 'Ajustar aos dados'}</option><option value="full">Escala completa</option></select></label><div className="ti-chart-legend"><span><i style={{background:color}}/>{title}</span>{comparisons.map((c) => <span key={c.title}><i style={{background:c.color}}/>{c.title} · tracejado</span>)}{layers.raw && <span><i style={{ background: color }}/>Bruto</span>}{WINDOWS.filter((w) => layers[w.toggle]).map((w) => <span key={w.key}><i style={{ background: w.color }}/>{w.name}{snapshot.movingAverages?.[w.key]?.isPartialWindow ? ' · janela parcial' : ''}</span>)}{layers.habitual && rangeInfo && <span>Faixa habitual{rangeInfo.isPartialWindow ? ' · parcial' : ''}</span>}{layers.baseline && snapshot.baseline && <span>Baseline{snapshot.baseline.isPartialWindow ? ' · parcial' : ''}</span>}</div><label className="ti-date-inspect">Examinar data<select aria-label={`Data de ${title}`} value={dates.includes(cursor) ? cursor : ''} onChange={(e) => onCursor(e.target.value)}><option value="">Selecione</option>{dates.map((d) => <option key={d} value={d}>{dateLabel(d, true)}</option>)}</select></label></div>
      {selectedInWindow && <div className="ti-inline-reading" aria-live="polite"><b>{dateLabel(cursor, true)}</b>{extra.filter((o) => dateKey(o.timestamp)===cursor).map((o,i) => <span key={`extra-${i}`} style={{color:o.color}}>{o.title}: {fmt(o.value)} {snapshot.variable.scale?.unit}</span>)}{selected.length ? selected.map((o, i) => <span key={i} style={{ color }}>{fmt(typeof o.value === 'number' ? o.value : null)} {snapshot.variable.scale?.unit} {o.context?.modality ? `· ${o.context.modality}` : ''}</span>) : <span>Sem observação nesta data</span>}{WINDOWS.filter((w) => layers[w.toggle]).map((w) => { const p = snapshot.movingAverageSeries?.[w.key]?.find((v) => dateKey(v.timestamp) === cursor); return p?.value != null ? <span key={w.key}>{w.name} {fmt(p.value)}</span> : null; })}</div>}
    </>}
  </article>;
}
