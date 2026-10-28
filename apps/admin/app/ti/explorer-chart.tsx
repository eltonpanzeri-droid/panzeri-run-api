'use client';
import * as React from 'react';
import { chartAxis, dateKey, dateLabel, fmt, inWindow, time, type Observation } from './data';
import { MODALITY_COLORS, MODALITY_COLOR_LABELS, modalityColorKey, modalityNameOf, type ModalityColorKey } from './modality-colors';
import { SIGNAL_LABEL, referenceFor, layerLabelOf, type ExplorerSnapshot, type ReferencePoint, type ReferenceWindowKey } from './explorer-data';

// Grafico principal da exploracao: uma COLUNA por observacao (duas sessoes no mesmo dia ficam lado a lado, cada uma clicavel), com as referencias ANTERIORES que o backend
// entrega (media historica, MM7/21/60/200 e faixa habitual). O SVG so' mapeia valores canonicos para coordenadas: nenhuma estatistica e' calculada aqui.
export type ExplorerLayers = { mean: boolean; mm7: boolean; mm21: boolean; mm60: boolean; mm200: boolean; band: boolean };
export const DEFAULT_EXPLORER_LAYERS: ExplorerLayers = { mean: true, mm7: false, mm21: true, mm60: false, mm200: false, band: true };
export const LAYER_COLORS: Record<keyof ExplorerLayers, string> = { mean: '#b9822e', mm7: '#12a19a', mm21: '#3a78e6', mm60: '#d8a118', mm200: '#8a5fd0', band: '#7a56c2' };
const MOVING: ReferenceWindowKey[] = ['mm7', 'mm21', 'mm60', 'mm200'];

type Bar = { observation: Observation; index: number; reference: ReferencePoint | null; x: number; width: number; value: number; colorKey: ModalityColorKey | null };

export function ExplorerChart({ snapshot, range, layers, selectedIndex, onSelect, title, byModality = false }: {
  snapshot: ExplorerSnapshot; range: [number, number]; layers: ExplorerLayers; selectedIndex: number | null; onSelect: (index: number | null) => void; title: string; byModality?: boolean;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(860);
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => { const next = Math.max(320, Math.round(entry.contentRect.width)); setWidth((previous) => (previous === next ? previous : next)); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const gradient = React.useId().replaceAll(':', '');
  const height = 400;
  const left = 52, right = width - 20, top = 30, bottom = height - 54;
  const reference = snapshot.reference ?? null;
  const unit = snapshot.variable.scale?.unit ?? '';

  const numericPosition = new Map<Observation, number>();
  snapshot.observations.filter((o) => typeof o.value === 'number').forEach((o, i) => numericPosition.set(o, i));
  const visible = snapshot.observations.map((observation, index) => ({ observation, index })).filter(({ observation }) => typeof observation.value === 'number' && inWindow(observation.timestamp, range));
  const lastAt = snapshot.observations.reduce((max, o) => Math.max(max, time(o.timestamp)), -Infinity);
  const referencePoints = (reference?.points ?? []).filter((point) => inWindow(point.timestamp, range));

  const values: number[] = visible.map(({ observation }) => observation.value as number);
  for (const key of MOVING) if (layers[key]) for (const p of referencePoints) { const v = p.movingAverages[key].value; if (v != null) values.push(v); }
  if (layers.mean) for (const p of referencePoints) if (p.historicalMean.value != null) values.push(p.historicalMean.value);
  if (layers.band) for (const p of referencePoints) { if (p.band.lower != null) values.push(p.band.lower); if (p.band.upper != null) values.push(p.band.upper); }
  const { min, max, ticks } = chartAxis(snapshot.variable, values, true, false);
  const spanMs = Math.max(1, range[1] - range[0]);
  const x = (at: number) => left + ((at - range[0]) / spanMs) * (right - left);
  const y = (v: number) => bottom - ((v - min) / Math.max(0.000001, max - min)) * (bottom - top);
  const days = Math.max(1, spanMs / 86400000);
  // largura da coluna = a unidade do indicador: semanal ocupa quase a semana inteira; por dia/treino, quase um dia
  const slotDays = reference?.unit === 'semanas' ? 6 : reference?.unit === 'ciclos' ? 20 : 0.82;
  const slot = Math.min(60, Math.max(4, ((right - left) / days) * slotDays));

  // colunas: observacoes do mesmo dia dividem o espaco do dia, uma por sessao
  const byDay = new Map<string, typeof visible>();
  for (const item of visible) { const key = dateKey(item.observation.timestamp); byDay.set(key, [...(byDay.get(key) ?? []), item]); }
  const bars: Bar[] = [];
  for (const [day, items] of byDay) {
    const each = Math.max(3, slot / items.length);
    const total = each * items.length;
    items.forEach((item, position) => {
      bars.push({ observation: item.observation, index: item.index, reference: referenceFor(snapshot, item.observation, numericPosition.get(item.observation) ?? -1), x: x(time(day)) - total / 2 + position * each, width: Math.max(2, each - (items.length > 1 ? 1.5 : 0)), value: item.observation.value as number, colorKey: byModality ? modalityColorKey(item.observation.context?.modality) : null });
    });
  }

  const usedKeys = [...new Set(bars.map((bar) => bar.colorKey).filter((key): key is ModalityColorKey => key !== null))];
  const linePath = (key: ReferenceWindowKey | 'mean') => {
    let started = false;
    return referencePoints.map((point) => {
      const v = key === 'mean' ? point.historicalMean.value : point.movingAverages[key].value;
      if (v == null) { started = false; return ''; }
      const command = started ? 'L' : 'M'; started = true;
      return `${command}${x(time(point.timestamp)).toFixed(1)},${y(v).toFixed(1)}`;
    }).join(' ');
  };
  // faixa habitual anterior: um poligono por trecho continuo de mesma base (a "limitada" fica mais clara e tracejada)
  const bandSegments: Array<{ basis: 'individual' | 'limited'; points: ReferencePoint[] }> = [];
  for (const point of referencePoints) {
    if (point.band.lower == null || point.band.upper == null || point.band.basis === 'none') { continue; }
    const basis = point.band.basis;
    const lastSegment = bandSegments[bandSegments.length - 1];
    if (lastSegment && lastSegment.basis === basis) lastSegment.points.push(point); else bandSegments.push({ basis, points: [point] });
  }
  const bandPath = (points: ReferencePoint[]) => {
    const upper = points.map((p) => `${x(time(p.timestamp)).toFixed(1)} ${y(p.band.upper as number).toFixed(1)}`);
    const lower = [...points].reverse().map((p) => `${x(time(p.timestamp)).toFixed(1)} ${y(p.band.lower as number).toFixed(1)}`);
    return `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;
  };
  const tickCount = Math.max(2, Math.min(8, Math.floor(width / 120)));
  const xTicks: number[] = Array.from({ length: tickCount + 1 }, (_unused, i) => range[0] + (spanMs * i) / tickCount);
  const tooltip = (bar: Bar) => {
    const ref = bar.reference;
    return [
      `${dateLabel(bar.observation.timestamp, true)} · ${fmt(bar.value)} ${unit}`.trim(),
      bar.colorKey ? `Modalidade: ${bar.colorKey === 'agregada' ? MODALITY_COLOR_LABELS.agregada : modalityNameOf(bar.observation.context?.modality)}` : '',
      ref ? `${SIGNAL_LABEL[ref.signal]}${ref.band.lower != null ? ` (${fmt(ref.band.lower)} – ${fmt(ref.band.upper)})` : ''}` : 'Sem referência anterior',
      ref ? `Referência: ${ref.priorN} registros anteriores` : '',
    ].filter(Boolean).join('\n');
  };

  return <div ref={root} className="evx-chart" style={{ height }}>
    <svg role="img" aria-label={`${title}: ${bars.length} observações no período`} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--evx-bar)" stopOpacity="1" /><stop offset="1" stopColor="var(--evx-bar)" stopOpacity="0.55" /></linearGradient>{usedKeys.map((key) => <linearGradient key={key} id={`${gradient}-${key}`} x1="0" x2="0" y1="0" y2="1"><stop stopColor={MODALITY_COLORS[key]} stopOpacity="1" /><stop offset="1" stopColor={MODALITY_COLORS[key]} stopOpacity="0.6" /></linearGradient>)}<clipPath id={`${gradient}-clip`}><rect x={left - 2} y={top - 6} width={right - left + 4} height={bottom - top + 8} /></clipPath></defs>
      {ticks.map((v) => <g key={v}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--evx-grid)" strokeWidth="1" /><text x={left - 9} y={y(v) + 4} textAnchor="end" fill="var(--evx-muted)" fontSize="11">{fmt(v)}</text></g>)}
      <text x={left} y={16} fill="var(--evx-muted)" fontSize="12">{unit || 'Valor'}</text>
      {xTicks.map((at) => <g key={at}><line x1={x(at)} x2={x(at)} y1={top} y2={bottom} stroke="var(--evx-grid)" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" /><text x={x(at)} y={bottom + 22} textAnchor={at === range[0] ? 'start' : at === range[1] ? 'end' : 'middle'} fill="var(--evx-muted)" fontSize="11">{dateLabel(at)}</text></g>)}
      <g clipPath={`url(#${gradient}-clip)`}>
        {layers.band && bandSegments.map((segment, i) => segment.points.length > 1
          ? <path key={i} d={bandPath(segment.points)} data-band={segment.basis} fill={LAYER_COLORS.band} fillOpacity={segment.basis === 'individual' ? 0.2 : 0.09} stroke={LAYER_COLORS.band} strokeOpacity="0.45" strokeWidth="1" strokeDasharray={segment.basis === 'limited' ? '4 3' : undefined} />
          : <rect key={i} data-band={segment.basis} x={x(time(segment.points[0].timestamp)) - 6} width="12" y={y(segment.points[0].band.upper as number)} height={Math.max(1, y(segment.points[0].band.lower as number) - y(segment.points[0].band.upper as number))} fill={LAYER_COLORS.band} fillOpacity={segment.basis === 'individual' ? 0.2 : 0.09} />)}
        {bars.map((bar) => {
          const isLast = time(bar.observation.timestamp) === lastAt;
          const isSelected = bar.index === selectedIndex;
          const barTop = Math.min(y(0), y(bar.value));
          const barHeight = Math.max(1.5, Math.abs(y(0) - y(bar.value)));
          return <g key={bar.index} role="button" tabIndex={0} aria-label={`Observação de ${dateLabel(bar.observation.timestamp, true)}: ${fmt(bar.value)} ${unit}${bar.colorKey ? ` · ${bar.colorKey === 'agregada' ? MODALITY_COLOR_LABELS.agregada : modalityNameOf(bar.observation.context?.modality)}` : ''}`} aria-pressed={isSelected} data-observation-index={bar.index} onClick={() => onSelect(isSelected ? null : bar.index)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(isSelected ? null : bar.index); } }} style={{ cursor: 'pointer' }}>
            <rect data-observation="true" data-modality={bar.colorKey ?? undefined} x={bar.x} y={barTop} width={bar.width} height={barHeight} rx={Math.min(3, bar.width / 2)} fill={`url(#${gradient}${bar.colorKey ? `-${bar.colorKey}` : ''})`} opacity={bar.observation.context?.isPartialWeek ? 0.6 : isLast || isSelected ? 1 : 0.86} stroke={isSelected ? 'var(--evx-ink)' : isLast ? (bar.colorKey ? MODALITY_COLORS[bar.colorKey] : 'var(--evx-bar)') : 'none'} strokeWidth={isSelected ? 2 : isLast ? 1.5 : 0}><title>{tooltip(bar)}</title></rect>
            {bar.reference && (bar.reference.signal === 'above' || bar.reference.signal === 'below') && <path data-signal={bar.reference.signal} d={`M ${bar.x + bar.width / 2} ${barTop - 13} l 4.5 5.5 l -4.5 5.5 l -4.5 -5.5 Z`} fill="var(--evx-signal)" />}
          </g>;
        })}
        {layers.mean && <path data-layer="mean" d={linePath('mean')} fill="none" stroke={LAYER_COLORS.mean} strokeWidth="1.8" strokeDasharray="6 4" />}
        {MOVING.filter((key) => layers[key]).map((key) => <path key={key} data-layer={key} d={linePath(key)} fill="none" stroke={LAYER_COLORS[key]} strokeWidth="2" />)}
      </g>
      <line x1={left} x2={right} y1={y(0) >= bottom ? bottom : y(0)} y2={y(0) >= bottom ? bottom : y(0)} stroke="var(--evx-axis)" strokeWidth="1" />
    </svg>
    {!bars.length && <div className="evx-chart-empty">{snapshot.observations.length ? 'Nenhuma observação neste período. Amplie o período para ver o histórico.' : 'Ainda não há observações deste indicador.'}</div>}
  </div>;
}

export function ChartLegend({ snapshot, layers, onToggle }: { snapshot: ExplorerSnapshot; layers: ExplorerLayers; onToggle: (key: keyof ExplorerLayers) => void }) {
  const reference = snapshot.reference ?? null;
  const entries: Array<{ key: keyof ExplorerLayers; label: string; available: boolean }> = [
    { key: 'mean', label: 'Média histórica anterior', available: Boolean(reference?.points.some((p) => p.historicalMean.value != null)) },
    ...(['mm7', 'mm21', 'mm60', 'mm200'] as const).map((key) => ({ key, label: layerLabelOf(reference, key), available: Boolean(reference?.points.some((p) => p.movingAverages[key].value != null)) })),
    { key: 'band', label: 'Faixa habitual anterior', available: Boolean(reference?.points.some((p) => p.band.basis !== 'none')) },
  ];
  return <div className="evx-legend" role="group" aria-label="Referências no gráfico">
    {entries.map(({ key, label, available }) => <button type="button" key={key} className={`evx-layer ${layers[key] && available ? 'on' : ''}`} aria-pressed={layers[key]} disabled={!available} title={available ? undefined : 'Sem base suficiente de registros anteriores para esta referência.'} onClick={() => onToggle(key)}><i style={{ background: LAYER_COLORS[key] }} />{label}{!available && <small>sem base</small>}</button>)}
    <span className="evx-layer-note"><i className="evx-diamond" />fora da faixa habitual (sinal neutro, não indica melhora nem piora)</span>
  </div>;
}

// Chave de cores das modalidades presentes no periodo: cor + nome (a cor sozinha nunca identifica a modalidade)
export function ModalityKey({ snapshot, range }: { snapshot: ExplorerSnapshot; range: [number, number] }) {
  const present = new Set<ModalityColorKey>();
  for (const observation of snapshot.observations) if (typeof observation.value === 'number' && inWindow(observation.timestamp, range)) present.add(modalityColorKey(observation.context?.modality));
  const keys = (Object.keys(MODALITY_COLORS) as ModalityColorKey[]).filter((key) => present.has(key));
  if (!keys.length) return null;
  return <div className="evx-modkey" role="group" aria-label="Cores por modalidade">
    <b>Modalidade</b>
    {keys.map((key) => <span key={key}><i style={{ background: MODALITY_COLORS[key] }} />{MODALITY_COLOR_LABELS[key]}{key === 'agregada' ? ' (total)' : ''}</span>)}
  </div>;
}
