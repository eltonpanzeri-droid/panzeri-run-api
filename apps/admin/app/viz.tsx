'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, SearchX, X } from 'lucide-react';

// Primitivas visuais compartilhadas pelas telas analiticas do painel (Inteligencia de Equipamentos e Observatorio Panzeri Run). Extraidas de equipment-intelligence.tsx em 24/10/2026 SEM mudar
// aparencia nem comportamento (mesmas classes eq* em styles.css). HTML/SVG puro, sem dependencia nova. Rotulos e valores entram sempre como TEXTO (nunca innerHTML).

export type Option = { value: string; label: string; students: number };
export const nf = (value: number | null | undefined, digits = 0) => (value == null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits }));
export const SINGULAR: Record<string, string> = { alunas: 'aluna', corridas: 'corrida' };

export function Kpi({ icon, label, value, hint, delta, digits = 0, suffix }: { icon: React.ReactNode; label: string; value: number | null; hint?: string; delta?: number | null; digits?: number; suffix?: string }) {
  return (
    <article className="eqKpi">
      <span className="eqKpiIcon" aria-hidden="true">{icon}</span>
      <small>{label}</small>
      <strong>{nf(value, digits)}{value != null && suffix ? <small className="eqKpiSuffix"> {suffix}</small> : null}</strong>
      {delta != null && delta !== 0 ? <span className="eqDelta" title="Diferença para o período anterior de mesma duração">{delta > 0 ? '▲' : '▼'} {nf(Math.abs(delta))} vs. período anterior</span> : delta === 0 ? <span className="eqDelta">= igual ao período anterior</span> : null}
      {hint ? <em>{hint}</em> : null}
    </article>
  );
}

export function Card({ title, subtitle, action, children, wide }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`eqCard${wide ? ' wide' : ''}`}>
      <header><div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</header>
      {children}
    </section>
  );
}

export function Empty({ icon, title, text }: { icon?: React.ReactNode; title: string; text?: string }) {
  return <div className="eqEmpty" role="status"><span aria-hidden="true">{icon ?? <SearchX size={22} />}</span><strong>{title}</strong>{text ? <p>{text}</p> : null}</div>;
}

export type HItem = { key: string; label: string; sub?: string; value: number; display?: string; muted?: boolean; segments?: Array<{ value: number; className: string; label: string }>; title?: string };

// Barras horizontais: marcas/modelos/plataformas. Barra fina (≤ 14 px) com ponta arredondada, valor na ponta; a linha inteira é o alvo do toque e abre o detalhe.
export function HBars({ items, max, onSelect, limit, unit, empty }: { items: HItem[]; max?: number; onSelect?: (key: string) => void; limit?: number; unit?: string; empty?: string }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return <Empty title={empty ?? 'Sem dados nos filtros escolhidos'} text="Afrouxe algum filtro ou amplie o período." />;
  const shown = all || !limit ? items : items.slice(0, limit);
  const top = max ?? Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="eqHBars">
      {shown.map((item) => {
        const body = (
          <>
            <span className="eqHLabel"><b>{item.label}</b>{item.sub ? <small>{item.sub}</small> : null}</span>
            <span className="eqHTrack" aria-hidden="true">
              {item.segments
                ? item.segments.map((segment, index) => <span key={index} className={`eqHFill ${segment.className}`} style={{ width: `${top > 0 ? (segment.value / top) * 100 : 0}%` }} title={`${segment.label}: ${nf(segment.value)}`} />)
                : <span className={`eqHFill${item.muted ? ' muted' : ''}`} style={{ width: `${top > 0 ? Math.max(item.value > 0 ? 1.5 : 0, (item.value / top) * 100) : 0}%` }} />}
            </span>
            <span className="eqHValue">{item.display ?? nf(item.value)}{unit && !item.display ? <small> {item.value === 1 ? SINGULAR[unit] ?? unit : unit}</small> : unit && item.display && /^d/.test(item.display) ? <small> {unit}</small> : null}</span>
          </>
        );
        return onSelect
          ? <button key={item.key} type="button" className="eqHRow clickable" onClick={() => onSelect(item.key)} title={item.title ?? `${item.label}: ${item.display ?? nf(item.value)} — toque para ver detalhes`}>{body}<ChevronRight size={14} className="eqHGo" aria-hidden="true" /></button>
          : <div key={item.key} className="eqHRow" title={item.title}>{body}</div>;
      })}
      {limit && items.length > limit ? <button type="button" className="eqLinkBtn" onClick={() => setAll((v) => !v)}>{all ? 'Mostrar menos' : `Ver todos (${items.length})`}</button> : null}
    </div>
  );
}

// Colunas (distribuições): barras com ponta arredondada, valor sobre a coluna, rótulos curtos, tooltip ao passar/focar.
export function Columns({ data, unit, emptyTitle, emptyText }: { data: Array<{ key: string; label: string; value: number; sub?: string }>; unit: string; emptyTitle: string; emptyText?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (data.length === 0 || total === 0) return <Empty icon={<BarChart3 size={22} />} title={emptyTitle} text={emptyText} />;
  const max = Math.max(1, ...data.map((d) => d.value));
  const height = 150;
  return (
    <div className="eqCols" role="img" aria-label={data.map((d) => `${d.label}: ${nf(d.value)} ${unit}`).join('; ')}>
      <div className="eqColsPlot" style={{ height: height + 34 }}>
        {data.map((d, index) => {
          const h = Math.max(d.value > 0 ? 3 : 0, Math.round((d.value / max) * height));
          return (
            <div key={d.key} className={`eqCol${hover === index ? ' hover' : ''}`} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} tabIndex={0}>
              <span className="eqColValue">{nf(d.value)}</span>
              <span className="eqColBar" style={{ height: h }} />
              <span className="eqColLabel">{d.label}</span>
              {hover === index ? <span className="eqTip" role="tooltip"><b>{nf(d.value)} {unit}</b><small>{d.sub ?? d.label}</small></span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ className: string; label: string }> }) {
  return <div className="eqLegend">{items.map((item) => <span key={item.label}><i className={item.className} />{item.label}</span>)}</div>;
}

export function ChipGroup({ label, options, selected, onChange, showCount = true }: { label: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void; showCount?: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open ? options : options.slice(0, 10);
  return (
    <fieldset className="eqField">
      <legend>{label}{selected.length ? <em>{selected.length}</em> : null}</legend>
      <div className="eqChips">
        {options.length === 0 ? <small className="eqMuted">Sem opções ainda.</small> : null}
        {shown.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button key={option.value} type="button" className={`eqChip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value])}>
              {option.label}{showCount ? <small>{option.students}</small> : null}
            </button>
          );
        })}
        {options.length > 10 ? <button type="button" className="eqLinkBtn" onClick={() => setOpen((v) => !v)}>{open ? 'Mostrar menos' : `Ver todos (${options.length})`}</button> : null}
      </div>
    </fieldset>
  );
}

export function SheetFrame({ title, subtitle, onClose, back, children, footer }: { title: string; subtitle?: string; onClose: () => void; back?: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="eqSheetWrap" role="presentation">
      <div className="eqScrim" onClick={onClose} />
      <aside className="eqSheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header>
          {back ? <button type="button" className="eqIconBtn" onClick={back} aria-label="Voltar"><ChevronLeft size={18} /></button> : null}
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button type="button" className="eqIconBtn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <div className="eqSheetBody">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </aside>
    </div>
  );
}

