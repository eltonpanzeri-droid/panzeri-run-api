'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, Dumbbell, Footprints, Layers, Plus, Route, Target, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { Empty, nf } from './viz';

// Observatório — painel de dor e evolução semanal (27/11/2026). Só agregados; nada individual. Semana com poucas alunas chega suprimida (null) e vira lacuna, nunca zero.
// O gráfico é desenhado na largura REAL do cartão (ResizeObserver), então a fonte tem sempre o mesmo tamanho — nada de texto esticado.

export type WeeklyLine = { key: string; label: string; color: string; values: Array<number | null>; dashed?: boolean };

export const SEG_COLOR: Record<string, string> = { total: '#475569', corridas: '#e5484d', corrida: '#e5484d', extra_corrida: '#8b5cf6', fortalecimento: '#22a06b', musculacao: '#2f7de1', extra_geral: '#94a3b8', outras: '#e8a317' };
export const SEG_SHORT: Record<string, string> = { total: 'Todos os treinos', corridas: 'Corrida (prescrita + extra)', corrida: 'Corrida', extra_corrida: 'Extra corrida', fortalecimento: 'Fortalecimento p/ corredores', musculacao: 'Musculação', extra_geral: 'Extra geral', outras: 'Outras prescritas' };
const SEG_ICON: Record<string, React.ReactNode> = { corridas: <Footprints size={15} />, corrida: <Footprints size={15} />, fortalecimento: <Dumbbell size={15} />, musculacao: <Dumbbell size={15} />, extra_corrida: <Route size={15} />, extra_geral: <Plus size={15} />, total: <Layers size={15} /> };

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const read = () => setW(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function WeeklyChart({ weeks, lines, format = (v) => nf(v, 1), unit = '', height = 230, area = false }: { weeks: string[]; lines: WeeklyLine[]; format?: (v: number) => string; unit?: string; height?: number; area?: boolean }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const ys = lines.flatMap((l) => l.values).filter((v): v is number => v != null);
  const H = height; const L = 40; const R = 12; const T = 10; const B = 26;
  if (weeks.length === 0 || ys.length === 0) return <div ref={ref}><Empty icon={<BarChart3 size={22} />} title="Sem pontos para mostrar" text="Nenhuma semana do período tem dados (ou alunas suficientes) para esta série." /></div>;
  const n = weeks.length;
  const y1 = niceMax(Math.max(...ys) * 1.1);
  const sx = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const sy = (y: number) => T + (1 - y / y1) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map((i) => (y1 * i) / 4);
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor((W - L) / 64))));
  const onMove = (event: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect(); if (!box) return;
    setHover(Math.min(n - 1, Math.max(0, Math.round(((event.clientX - box.left - L) / (W - L - R)) * (n - 1)))));
  };
  const runs = (values: Array<number | null>) => { const out: Array<Array<[number, number]>> = []; let cur: Array<[number, number]> = []; values.forEach((v, i) => { if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push([sx(i), sy(v)]); }); if (cur.length) out.push(cur); return out; };
  const tipLeft = hover == null ? 0 : Math.min(Math.max(sx(hover), 90), W - 90);
  return (
    <div className="obwChart" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ height: H }}>
      <svg width={W} height={H} role="img" aria-label="Evolução semanal">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="obwGrid" /><text x={L - 6} y={sy(t) + 4} textAnchor="end" className="obwAxis">{format(t)}</text></g>)}
        {weeks.map((w, i) => (i % every === 0 || i === n - 1 ? <text key={w} x={sx(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="obwAxis">{dm(w)}</text> : null))}
        {hover != null ? <line x1={sx(hover)} x2={sx(hover)} y1={T} y2={H - B} className="obwCross" /> : null}
        {lines.map((l, li) => (
          <g key={l.key}>
            {area && li === 0 ? runs(l.values).map((seg, i) => seg.length > 1 ? <polygon key={`a${i}`} points={`${seg[0][0]},${sy(0)} ${seg.map((p) => p.join(',')).join(' ')} ${seg[seg.length - 1][0]},${sy(0)}`} fill={l.color} opacity={0.12} /> : null) : null}
            {runs(l.values).map((seg, i) => seg.length > 1 ? <polyline key={i} points={seg.map((p) => p.join(',')).join(' ')} fill="none" stroke={l.color} strokeWidth={2.2} strokeDasharray={l.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" /> : <circle key={i} cx={seg[0][0]} cy={seg[0][1]} r={3.5} fill={l.color} />)}
            {l.values.map((v, i) => (v != null && hover === i ? <circle key={i} cx={sx(i)} cy={sy(v)} r={4.5} fill={l.color} stroke="var(--paper)" strokeWidth={2} /> : null))}
          </g>
        ))}
      </svg>
      {hover != null ? (
        <div className="obwTip" style={{ left: tipLeft }} role="tooltip">
          <b>Semana de {dm(weeks[hover])}</b>
          {lines.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.label}<em>{l.values[hover] == null ? 'sem dado' : `${format(l.values[hover] as number)}${unit ? ` ${unit}` : ''}`}</em></span>)}
        </div>
      ) : null}
    </div>
  );
}

export function Legend({ lines }: { lines: Array<{ key: string; label: string; color: string }> }) {
  return <div className="obwLegend">{lines.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.label}</span>)}</div>;
}

// ───────── rosca (distribuição por nível) ─────────
function Donut({ parts, center, sub }: { parts: Array<{ label: string; value: number; color: string }>; center: string; sub: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 52; const c = 2 * Math.PI * r; let acc = 0;
  return (
    <div className="obwDonut">
      <svg width={150} height={150} viewBox="0 0 150 150" role="img" aria-label="Distribuição por nível">
        <circle cx={75} cy={75} r={r} fill="none" stroke="var(--line)" strokeWidth={16} />
        {total > 0 ? parts.map((p) => { const len = (p.value / total) * c; const el = <circle key={p.label} cx={75} cy={75} r={r} fill="none" stroke={p.color} strokeWidth={16} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 75 75)" />; acc += len; return el; }) : null}
        <text x={75} y={72} textAnchor="middle" className="obwDonutNum">{center}</text>
        <text x={75} y={90} textAnchor="middle" className="obwDonutSub">{sub}</text>
      </svg>
      <ul>{parts.map((p) => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{total > 0 ? `${nf((p.value / total) * 100, 0)}%` : '—'}</b><small>{nf(p.value)}</small></li>)}</ul>
    </div>
  );
}

// ───────── barras horizontais comparativas ─────────
function CompareBars({ rows, unit, digits = 1 }: { rows: Array<{ key: string; label: string; value: number | null; color: string }>; unit?: string; digits?: number }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="obwBars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="obwBarLabel">{SEG_ICON[r.key]}{r.label}</span>
          <span className="obwBarTrack"><i style={{ width: `${r.value == null ? 0 : Math.max(2, (r.value / max) * 100)}%`, background: r.color }} /></span>
          <b>{r.value == null ? '—' : nf(r.value, digits)}<small>{unit ? ` ${unit}` : ''}</small></b>
        </li>
      ))}
    </ul>
  );
}

// ───────── painel por modalidade ─────────
type PainLike = { trainings: number; painTrainings: number; painPer100Trainings: number | null; levelPointsPer100Trainings: number | null; levels: { leve: number; moderado: number; forte: number; semNivel: number }; km: number; painPer1000Km: number | null; meanLevelAmongPain: number | null };
type SegRowLike = { key: string; label: string; suppressed: boolean; data: PainLike | null };
type WeeklyLike = { segments: Array<{ key: string; label: string; points: Array<{ week: string; trainings: number | null; painTrainings: number | null; painPer100: number | null; levelPointsPer100: number | null }> }>; relatar: Array<{ week: string }> };
export type DashInsights = {
  segments: { rows: SegRowLike[]; runsCombined: PainLike | null; total: PainLike | null };
  weekly: WeeklyLike;
  standalone: { overall: { reports: number; meanIntensity: number | null } | null; locations: Array<{ key: string; label: string; suppressed: boolean; data: { reports: number; meanNote: number | null; reportsPer100Trainings: number | null } | null }> };
};

// Variação: últimas 4 semanas x 4 semanas anteriores (taxa = soma dos treinos com dor ÷ soma dos treinos). Sem 8 semanas completas não há variação.
function variation(points: WeeklyLike['segments'][number]['points']): { now: number | null; before: number | null; deltaPP: number | null; deltaPct: number | null } {
  if (points.length < 8) return { now: null, before: null, deltaPP: null, deltaPct: null };
  const rate = (slice: typeof points) => { const t = slice.reduce((s, p) => s + (p.trainings ?? 0), 0); const d = slice.reduce((s, p) => s + (p.painTrainings ?? 0), 0); return t > 0 ? (d / t) * 100 : null; };
  const now = rate(points.slice(-4)); const before = rate(points.slice(-8, -4));
  return { now, before, deltaPP: now != null && before != null ? now - before : null, deltaPct: now != null && before != null && before > 0 ? ((now - before) / before) * 100 : null };
}
function Delta({ v, suffix }: { v: number | null; suffix: string }) {
  if (v == null) return <span className="obwDelta flat">—</span>;
  if (Math.abs(v) < 0.05) return <span className="obwDelta flat">= {suffix}</span>;
  return <span className={`obwDelta ${v < 0 ? 'good' : 'bad'}`}>{v < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}{v < 0 ? '−' : '+'}{nf(Math.abs(v), 1)}{suffix}</span>;
}

export function PainDashboard({ ins }: { ins: DashInsights }) {
  const options: Array<{ key: string; label: string }> = [
    { key: 'corridas', label: 'Corrida' }, { key: 'fortalecimento', label: 'Fortalecimento p/ corredores' }, { key: 'musculacao', label: 'Musculação' }, { key: 'extra_corrida', label: 'Extra corrida' }, { key: 'extra_geral', label: 'Extra geral' },
  ];
  const [sel, setSel] = useState('corridas');
  const weekly = ins.weekly;
  const dataOf = (key: string): PainLike | null => (key === 'corridas' ? ins.segments.runsCombined : ins.segments.rows.find((r) => r.key === key)?.data ?? null);
  const pointsOf = (key: string) => weekly.segments.find((s) => s.key === key)?.points ?? [];
  const weeks = weekly.relatar.map((p) => p.week);
  const d = dataOf(sel);
  const tot = ins.segments.total;
  const v = variation(pointsOf(sel));
  const vTot = variation(pointsOf('total'));
  const compKeys = options.map((o) => o.key);
  const levelParts = d ? [{ label: 'Leve', value: d.levels.leve, color: '#22a06b' }, { label: 'Moderada', value: d.levels.moderado, color: '#e8a317' }, { label: 'Forte', value: d.levels.forte, color: '#e5484d' }] : [];
  const regions = ins.standalone.locations.filter((l) => !l.suppressed && l.data && l.key !== 'nao_informado').slice(0, 6);
  const maxReg = Math.max(1, ...regions.map((r) => r.data?.reports ?? 0));
  const color = SEG_COLOR[sel] ?? '#2f7de1';
  return (
    <section className="obwDash" aria-label="Painel de dor por tipo de atividade">
      <div className="obwHead">
        <h3>Dor por tipo de atividade</h3>
        <p>Dor marcada no feedback do treino (sem dor ou nota de 1 a 10), a cada 100 treinos. Respostas anteriores a 30/11/2026 (leve, moderada, forte) foram convertidas em 3, 5 e 8. O “Relatar dor” fica à parte (aba própria).</p>
      </div>

      <div className="obwKpiRow">
        <article className="obwKpi"><span className="obwKpiIcon red"><Target size={18} /></span><div><small>Taxa de dor geral</small><strong>{nf(tot?.painPer100Trainings, 1)}<em> /100 treinos</em></strong><p>{nf(tot?.painTrainings)} treinos com dor em {nf(tot?.trainings)}</p></div></article>
        <article className="obwKpi"><span className="obwKpiIcon amber"><Zap size={18} /></span><div><small>Pontos de intensidade</small><strong>{nf(tot?.levelPointsPer100Trainings, 1)}<em> pts/100 treinos</em></strong><p>soma das notas de dor do feedback</p></div></article>
        <article className="obwKpi"><span className="obwKpiIcon green"><TrendingDown size={18} /></span><div><small>Variação (4 sem. x 4 sem. anteriores)</small><strong><Delta v={vTot.deltaPct} suffix="%" /></strong><p>{vTot.now != null ? `${nf(vTot.now, 1)} agora vs ${nf(vTot.before, 1)} antes (por 100)` : 'precisa de 8 semanas no período'}</p></div></article>
        <article className="obwKpi"><span className="obwKpiIcon blue"><Layers size={18} /></span><div><small>Treinos analisados</small><strong>{nf(tot?.trainings)}</strong><p>todas as modalidades do período</p></div></article>
      </div>

      <div className="obwTabs" role="tablist" aria-label="Modalidade">
        {options.map((o) => <button key={o.key} type="button" role="tab" aria-selected={sel === o.key} className={sel === o.key ? 'on' : ''} onClick={() => setSel(o.key)}>{SEG_ICON[o.key]}{o.label}</button>)}
      </div>

      <div className="obwGrid2">
        <section className="obwPanel">
          <h4>{options.find((o) => o.key === sel)?.label} · resumo</h4>
          {d ? (
            <div className="obwStats">
              <div><small>Treinos</small><strong>{nf(d.trainings)}</strong></div>
              <div><small>Com dor</small><strong>{nf(d.painTrainings)}</strong></div>
              <div><small>Taxa /100</small><strong>{nf(d.painPer100Trainings, 1)}</strong><Delta v={v.deltaPP} suffix=" p.p." /></div>
              <div><small>Pontos /100</small><strong>{nf(d.levelPointsPer100Trainings, 1)}</strong></div>
              {sel === 'corridas' ? <div><small>Por 1.000 km</small><strong>{nf(d.painPer1000Km, 1)}</strong></div> : null}
              <div><small>Intens. média (1–10)</small><strong>{nf(d.meanLevelAmongPain, 2)}</strong></div>
            </div>
          ) : <Empty title="Sem dados" text="Poucas alunas nesta modalidade no período." />}
        </section>
        <section className="obwPanel">
          <h4>Evolução (acumulada) · {options.find((o) => o.key === sel)?.label} <small>histórico desde o início do período</small></h4>
          <WeeklyChart weeks={weeks} area unit="" lines={[
            { key: 'taxa', label: 'Taxa de dor (por 100 treinos)', color, values: pointsOf(sel).map((p) => p.painPer100) },
            { key: 'pts', label: 'Pontos de intensidade (por 100)', color: '#e8a317', dashed: true, values: pointsOf(sel).map((p) => p.levelPointsPer100) },
          ]} />
          <Legend lines={[{ key: 'taxa', label: 'Taxa de dor (por 100 treinos)', color }, { key: 'pts', label: 'Pontos de intensidade (por 100)', color: '#e8a317' }]} />
        </section>
      </div>

      <div className="obwGrid3">
        <section className="obwPanel">
          <h4>Taxa de dor por 100 treinos <small>comparação por atividade</small></h4>
          <CompareBars digits={1} rows={compKeys.map((k) => ({ key: k, label: SEG_SHORT[k], value: dataOf(k)?.painPer100Trainings ?? null, color: SEG_COLOR[k] }))} />
        </section>
        <section className="obwPanel">
          <h4>Pontos de intensidade <small>por 100 treinos</small></h4>
          <CompareBars digits={1} rows={compKeys.map((k) => ({ key: k, label: SEG_SHORT[k], value: dataOf(k)?.levelPointsPer100Trainings ?? null, color: SEG_COLOR[k] }))} />
        </section>
        <section className="obwPanel">
          <h4>Distribuição por nível <small>{options.find((o) => o.key === sel)?.label}</small></h4>
          <Donut parts={levelParts} center={nf(d?.painTrainings)} sub="treinos com dor" />
        </section>
      </div>

      <section className="obwPanel">
        <h4>Regiões mais relatadas <small>Relatar dor (analisado à parte, sem ligação com o treino)</small></h4>
        {regions.length === 0 ? <Empty title="Sem relatos no período" /> : (
          <ul className="obwBars regions">
            {regions.map((r) => (
              <li key={r.key}>
                <span className="obwBarLabel">{r.label}</span>
                <span className="obwBarTrack"><i style={{ width: `${Math.max(2, ((r.data?.reports ?? 0) / maxReg) * 100)}%`, background: '#e5484d' }} /></span>
                <b>{nf(r.data?.reports)}<small> relatos · nota {nf(r.data?.meanNote, 1)}</small></b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
