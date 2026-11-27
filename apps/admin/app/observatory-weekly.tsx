'use client';

import React, { useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Empty } from './viz';

// Observatório — evolução semanal (27/11/2026). Gráfico de linhas genérico: uma linha por série, semanas de segunda a domingo no eixo X,
// lacuna (nunca zero) onde o ponto foi suprimido por ter poucos participantes. Só agregados; nada individual.

export type WeeklyLine = { key: string; label: string; color: string; values: Array<number | null> };
export type WeeklyAxis = { week: string; hidden?: boolean }[];

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

export function WeeklyChart({ weeks, lines, format = (v) => String(Math.round(v * 10) / 10), unit = '', height = 240 }: { weeks: string[]; lines: WeeklyLine[]; format?: (v: number) => string; unit?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 720; const H = height; const L = 48; const R = 14; const T = 12; const B = 44;
  const ys = lines.flatMap((l) => l.values).filter((v): v is number => v != null);
  if (weeks.length === 0 || ys.length === 0) return <Empty icon={<BarChart3 size={22} />} title="Sem pontos para mostrar" text="Nenhuma semana do período tem dados suficientes (ou participantes suficientes) para esta série." />;
  const n = weeks.length;
  const y1 = niceMax(Math.max(...ys) * 1.08);
  const sx = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const sy = (y: number) => T + (1 - y / y1) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map((i) => (y1 * i) / 4);
  const every = Math.max(1, Math.ceil(n / 8));
  const onMove = (event: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect(); if (!box) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    setHover(Math.min(n - 1, Math.max(0, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  const runs = (values: Array<number | null>) => { const out: string[] = []; let cur: string[] = []; values.forEach((v, i) => { if (v == null) { if (cur.length > 1) out.push(cur.join(' ')); cur = []; } else cur.push(`${sx(i).toFixed(1)},${sy(v).toFixed(1)}`); }); if (cur.length > 1) out.push(cur.join(' ')); return out; };
  return (
    <div className="obsLine" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolução semanal" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="obsGrid" /><text x={L - 8} y={sy(t) + 4} textAnchor="end" className="obsAxis">{format(t)}</text></g>)}
        {weeks.map((w, i) => (i % every === 0 || i === n - 1 ? <text key={w} x={sx(i)} y={H - B + 16} textAnchor="middle" className="obsAxis">{dm(w)}</text> : null))}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="obsAxisTitle">semana (início na segunda-feira){unit ? ` · ${unit}` : ''}</text>
        {hover != null ? <line x1={sx(hover)} x2={sx(hover)} y1={T} y2={H - B} className="obsCross" /> : null}
        {lines.map((l) => (
          <g key={l.key}>
            {runs(l.values).map((pts, i) => <polyline key={i} points={pts} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {l.values.map((v, i) => (v != null && (hover === i || n <= 14) ? <circle key={i} cx={sx(i)} cy={sy(v)} r={hover === i ? 4.5 : 3} fill={l.color} stroke="var(--paper)" strokeWidth={1.5} /> : null))}
          </g>
        ))}
      </svg>
      {hover != null ? (
        <div className="eqTip obsLineTip" role="tooltip">
          <b>Semana de {dm(weeks[hover])}</b>
          {lines.map((l) => <small key={l.key}><i style={{ background: l.color }} />{l.label}: {l.values[hover] == null ? 'sem dado / oculto' : `${format(l.values[hover] as number)}${unit ? ` ${unit}` : ''}`}</small>)}
        </div>
      ) : null}
    </div>
  );
}

export function Legend({ lines }: { lines: Array<{ key: string; label: string; color: string }> }) {
  return <div className="eqLegend">{lines.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.label}</span>)}</div>;
}
