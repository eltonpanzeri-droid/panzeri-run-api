'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, CalendarDays, ChevronLeft, ChevronRight, Footprints, Info, RefreshCw, SearchX, SlidersHorizontal, Users, Watch, X } from 'lucide-react';

// Inteligência de Equipamentos (redesenho 24/10/2026). Mesma API e mesmos cálculos de antes: GET /coach/equipment/options e /intelligence (só agregados; nenhum nome, e-mail ou id de aluna).
// Estatística descritiva: associação entre equipamento e pace/volume não é causalidade. Filtros combináveis (todos juntos, "E"); período livre.
// Visões: Visão geral | Tênis | Relógios. Filtros ficam num painel lateral; período e filtros ativos ficam sempre à vista. Gráficos em HTML/SVG puro (sem dependência nova).

type Option = { value: string; label: string; students: number };
type Options = {
  watchBrands: Option[]; watchModels: Option[]; platforms: Option[]; shoeBrands: Option[]; shoeModels: Option[]; studentStatuses: Option[];
  bands: Array<{ value: string; label: string }>;
};
type Band = { key: string; label: string; count: number; distanceKm: number };
type ShoeGroup = {
  key: string; label: string; brand?: string; shoes: number; active: number; retired: number; students: number; performanceHidden: boolean; runs: number | null; km: number | null; avgKmPerShoe: number | null;
  pace: { secondsPerKm: number; label: string; runs: number } | null; paceHidden: boolean; bands: Band[];
};
type WatchBrand = { key: string; label: string; students: number; devices: number; activities: number | null };
type WatchModel = { key: string; manufacturer: string; label: string; students: number; activities: number | null; technicalIds?: string[] };
type Platform = { key: string; label: string; students: number; devices: number; activities: number | null; studentsSendingData: number };
type Result = {
  generatedAt: string;
  filters: Record<string, unknown>;
  period: { from: string; to: string };
  population: { studentsEligible: number; studentsIncluded: number | null; studentsWithDevice: number | null; studentsWithShoe: number | null; studentsSendingData: number | null };
  devices: { byManufacturer: WatchBrand[]; byModel: WatchModel[]; byPlatform: Platform[]; studentsWithoutDevice: number | null };
  shoes: {
    totals: { shoes: number | null; active: number | null; retired: number | null; students: number | null; studentsWithoutShoe: number | null };
    performanceHidden: boolean;
    byBrand: ShoeGroup[]; byModel: ShoeGroup[];
    kmDistribution: Array<{ key: string; label: string; shoes: number }>;
    distanceBands: Array<{ key: string; label: string; runs: number; km: number }>;
  };
  notes: string[];
};

interface Draft {
  from: string; to: string;
  watchBrands: string[]; watchModels: string[]; platforms: string[]; shoeBrands: string[]; shoeModels: string[]; studentStatuses: string[]; bands: string[];
  shoeStatus: 'all' | 'active' | 'retired';
  shoeKmMin: string; shoeKmMax: string; runnerKmMin: string; runnerKmMax: string;
}
type View = 'geral' | 'tenis' | 'relogios';
type Sheet = { kind: 'filters' } | { kind: 'shoeBrand' | 'shoeModel' | 'watchBrand' | 'watchModel'; key: string } | null;
type ShoeMetric = 'students' | 'shoes' | 'km' | 'runs';

const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const addDays = (date: string, days: number) => new Date(new Date(`${date}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
const nf = (value: number | null | undefined, digits = 0) => (value == null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits }));
const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
// "Não identificado" fica por último: nao e' um fabricante/modelo para comparar com os demais.
const unknownLast = (a: { muted?: boolean; value: number }, b: { muted?: boolean; value: number }) => Number(!!a.muted) - Number(!!b.muted) || b.value - a.value;
const nk = (text: string | null | undefined) => (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const SINGULAR: Record<string, string> = { alunas: 'aluna', corridas: 'corrida' };
const UNIDENTIFIED = 'Não identificado';
const MODEL_UNKNOWN = 'Modelo não identificado';

const STATUS_LABEL: Record<string, string> = { active: 'Ativa', pending: 'Pendente', canceled: 'Cancelada', cancelled: 'Cancelada', expired: 'Expirada', past_due: 'Em atraso', overdue: 'Em atraso' };
const SHORT_BAND: Record<string, string> = { ate_5: '≤ 5', '5_10': '5–10', '10_15': '10–15', '15_25': '15–25', '25_30': '25–30', '30_40': '30–40', acima_40: '> 40' };
const SHORT_KM: Record<string, string> = { sem_corridas: 'Sem corridas', ate_100: '≤ 100', '100_300': '100–300', '300_500': '300–500', '500_800': '500–800', acima_800: '> 800' };

const emptyDraft = (): Draft => ({
  from: addDays(localToday(), -179), to: localToday(), watchBrands: [], watchModels: [], platforms: [], shoeBrands: [], shoeModels: [], studentStatuses: [], bands: [],
  shoeStatus: 'all', shoeKmMin: '', shoeKmMax: '', runnerKmMin: '', runnerKmMax: '',
});

function toQuery(draft: Draft): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string | string[]) => { const text = Array.isArray(value) ? value.join(',') : value; if (text) params.set(key, text); };
  put('from', draft.from); put('to', draft.to);
  put('watchBrands', draft.watchBrands); put('watchModels', draft.watchModels); put('platforms', draft.platforms);
  put('shoeBrands', draft.shoeBrands); put('shoeModels', draft.shoeModels); put('studentStatuses', draft.studentStatuses); put('bands', draft.bands);
  if (draft.shoeStatus !== 'all') put('shoeStatus', draft.shoeStatus);
  put('shoeKmMin', draft.shoeKmMin); put('shoeKmMax', draft.shoeKmMax); put('runnerKmMin', draft.runnerKmMin); put('runnerKmMax', draft.runnerKmMax);
  return params.toString();
}

// ───────────────────────────── componentes visuais ─────────────────────────────

function Kpi({ icon, label, value, hint, delta }: { icon: React.ReactNode; label: string; value: number | null; hint?: string; delta?: number | null }) {
  return (
    <article className="eqKpi">
      <span className="eqKpiIcon" aria-hidden="true">{icon}</span>
      <small>{label}</small>
      <strong>{nf(value)}</strong>
      {delta != null && delta !== 0 ? <span className="eqDelta" title="Diferença para o período anterior de mesma duração">{delta > 0 ? '▲' : '▼'} {nf(Math.abs(delta))} vs. período anterior</span> : delta === 0 ? <span className="eqDelta">= igual ao período anterior</span> : null}
      {hint ? <em>{hint}</em> : null}
    </article>
  );
}

function Card({ title, subtitle, action, children, wide }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`eqCard${wide ? ' wide' : ''}`}>
      <header><div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</header>
      {children}
    </section>
  );
}

function Empty({ icon, title, text }: { icon?: React.ReactNode; title: string; text?: string }) {
  return <div className="eqEmpty" role="status"><span aria-hidden="true">{icon ?? <SearchX size={22} />}</span><strong>{title}</strong>{text ? <p>{text}</p> : null}</div>;
}

type HItem = { key: string; label: string; sub?: string; value: number; display?: string; muted?: boolean; segments?: Array<{ value: number; className: string; label: string }>; title?: string };

// Barras horizontais: marcas/modelos/plataformas. Barra fina (≤ 14 px) com ponta arredondada, valor na ponta; a linha inteira é o alvo do toque e abre o detalhe.
function HBars({ items, max, onSelect, limit, unit, empty }: { items: HItem[]; max?: number; onSelect?: (key: string) => void; limit?: number; unit?: string; empty?: string }) {
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
function Columns({ data, unit, emptyTitle, emptyText }: { data: Array<{ key: string; label: string; value: number; sub?: string }>; unit: string; emptyTitle: string; emptyText?: string }) {
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

function Legend({ items }: { items: Array<{ className: string; label: string }> }) {
  return <div className="eqLegend">{items.map((item) => <span key={item.label}><i className={item.className} />{item.label}</span>)}</div>;
}

function ChipGroup({ label, options, selected, onChange, showCount = true }: { label: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void; showCount?: boolean }) {
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

function SheetFrame({ title, subtitle, onClose, back, children, footer }: { title: string; subtitle?: string; onClose: () => void; back?: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
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

const groupStat = (label: string, value: string) => <div className="eqStat"><small>{label}</small><strong>{value}</strong></div>;

// ───────────────────────────── tela ─────────────────────────────

export default function EquipmentIntelligence({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [applied, setApplied] = useState<Draft>(emptyDraft);
  const [draft, setDraft] = useState<Draft>(applied);
  const [result, setResult] = useState<Result | null>(null);
  const [previous, setPrevious] = useState<Result | null>(null);
  const [compare, setCompare] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<View>('geral');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [shoeMetric, setShoeMetric] = useState<ShoeMetric>('students');
  const [refreshMsg, setRefreshMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const seq = useRef(0);

  const fetchResult = useCallback(async (current: Draft): Promise<Result> => {
    const response = await fetch(`${apiUrl}/coach/equipment/intelligence?${toQuery(current)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      let detail = 'Não foi possível carregar agora.';
      try { const body = (await response.json()) as { message?: string | string[] }; const text = Array.isArray(body.message) ? body.message.join(' ') : body.message; if (text) detail = text; } catch { /* mensagem padrão */ }
      throw new Error(detail);
    }
    return (await response.json()) as Result;
  }, [accessToken, apiUrl]);

  const run = useCallback(async (current: Draft, withCompare: boolean) => {
    const mine = ++seq.current;
    setState('loading'); setMessage('');
    try {
      const main = await fetchResult(current);
      let prev: Result | null = null;
      if (withCompare) {
        const length = dayDiff(current.from, current.to) + 1;
        try { prev = await fetchResult({ ...current, from: addDays(current.from, -length), to: addDays(current.from, -1) }); } catch { prev = null; }
      }
      if (mine !== seq.current) return;
      setResult(main); setPrevious(prev); setState('ready');
    } catch (error) {
      if (mine !== seq.current) return;
      setMessage(error instanceof Error ? error.message : 'Sem conexão com a API. Tente novamente.'); setState('error');
    }
  }, [fetchResult]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`${apiUrl}/coach/equipment/options`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (response.ok && alive) setOptions((await response.json()) as Options);
      } catch { /* os filtros ficam sem opções; a análise segue funcionando */ }
    })();
    void run(applied, compare);
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [accessToken, apiUrl]);

  const commit = (next: Draft, withCompare = compare) => { setApplied(next); setDraft(next); void run(next, withCompare); };
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  const shortcut = (days: number | 'ano') => { const to = localToday(); patch({ to, from: days === 'ano' ? `${to.slice(0, 4)}-01-01` : addDays(to, -(days - 1)) }); };
  const toggleCompare = (on: boolean) => { setCompare(on); void run(applied, on); };

  async function refreshDevices() {
    setRefreshing(true); setRefreshMsg('');
    try {
      const response = await fetch(`${apiUrl}/coach/equipment/refresh-devices`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 403) { setRefreshMsg('Somente o administrador pode atualizar a base de dispositivos.'); return; }
      if (!response.ok) { setRefreshMsg('Não foi possível atualizar agora.'); return; }
      const body = (await response.json()) as { users: number; devices: number };
      setRefreshMsg(`Base atualizada: ${nf(body.devices)} dispositivo(s) de ${nf(body.users)} aluna(s).`);
      void run(applied, compare);
    } catch { setRefreshMsg('Sem conexão com a API.'); } finally { setRefreshing(false); }
  }

  // ── filtros ativos (etiquetas removíveis: remover aplica na hora) ──
  const statusOptions = useMemo(() => options?.studentStatuses.map((o) => ({ ...o, label: STATUS_LABEL[o.label] ?? o.label })) ?? [], [options]);
  const label = (list: Option[] | undefined, value: string) => list?.find((o) => o.value === value)?.label ?? value;
  const activeChips: Array<{ key: string; group: string; text: string; remove: () => void }> = [];
  const addList = (group: string, values: string[], list: Option[] | undefined, set: (next: string[]) => Draft) =>
    values.forEach((v) => activeChips.push({ key: `${group}:${v}`, group, text: label(list, v), remove: () => commit(set(values.filter((x) => x !== v))) }));
  addList('Marca do relógio', applied.watchBrands, options?.watchBrands, (n) => ({ ...applied, watchBrands: n }));
  addList('Modelo do relógio', applied.watchModels, options?.watchModels, (n) => ({ ...applied, watchModels: n }));
  addList('Plataforma', applied.platforms, options?.platforms, (n) => ({ ...applied, platforms: n }));
  addList('Marca do tênis', applied.shoeBrands, options?.shoeBrands, (n) => ({ ...applied, shoeBrands: n }));
  addList('Modelo do tênis', applied.shoeModels, options?.shoeModels, (n) => ({ ...applied, shoeModels: n }));
  addList('Aluna', applied.studentStatuses, statusOptions, (n) => ({ ...applied, studentStatuses: n }));
  applied.bands.forEach((b) => activeChips.push({ key: `band:${b}`, group: 'Faixa', text: options?.bands.find((x) => x.value === b)?.label ?? b, remove: () => commit({ ...applied, bands: applied.bands.filter((x) => x !== b) }) }));
  if (applied.shoeStatus !== 'all') activeChips.push({ key: 'ss', group: 'Tênis', text: applied.shoeStatus === 'active' ? 'em uso' : 'aposentado', remove: () => commit({ ...applied, shoeStatus: 'all' }) });
  if (applied.shoeKmMin || applied.shoeKmMax) activeChips.push({ key: 'sk', group: 'Km do tênis', text: `${applied.shoeKmMin || '0'} a ${applied.shoeKmMax || '∞'}`, remove: () => commit({ ...applied, shoeKmMin: '', shoeKmMax: '' }) });
  if (applied.runnerKmMin || applied.runnerKmMax) activeChips.push({ key: 'rk', group: 'Volume da aluna', text: `${applied.runnerKmMin || '0'} a ${applied.runnerKmMax || '∞'} km`, remove: () => commit({ ...applied, runnerKmMin: '', runnerKmMax: '' }) });
  const clearAll = () => { const next = { ...emptyDraft(), from: applied.from, to: applied.to }; commit(next); };

  const r = result;
  const days = dayDiff(applied.from, applied.to) + 1;
  const pop = r?.population;
  const prevPop = previous?.population;
  const delta = (key: 'studentsIncluded' | 'studentsWithDevice' | 'studentsWithShoe' | 'studentsSendingData') => (compare && pop && prevPop && pop[key] != null && prevPop[key] != null ? (pop[key] as number) - (prevPop[key] as number) : undefined);

  // ── dados dos gráficos ──
  const shoeBrandItems = (metric: ShoeMetric): HItem[] => (r?.shoes.byBrand ?? []).map((b) => {
    const hidden = (metric === 'km' || metric === 'runs') && b.performanceHidden;
    const value = metric === 'students' ? b.students : metric === 'shoes' ? b.shoes : metric === 'km' ? b.km ?? 0 : b.runs ?? 0;
    return { key: b.key, label: b.label, sub: `${nf(b.shoes)} tênis · ${nf(b.active)} em uso`, value: hidden ? 0 : value, display: hidden ? 'só contagem' : metric === 'km' ? `${nf(value, 0)} km` : nf(value), muted: hidden, title: hidden ? 'Menos de 3 alunas com corrida neste grupo: o desempenho fica oculto.' : undefined };
  }).sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
  const shoeModelItems = (metric: ShoeMetric): HItem[] => (r?.shoes.byModel ?? []).map((m) => {
    const hidden = (metric === 'km' || metric === 'runs') && m.performanceHidden;
    const value = metric === 'students' ? m.students : metric === 'shoes' ? m.shoes : metric === 'km' ? m.km ?? 0 : m.runs ?? 0;
    return { key: m.key, label: m.label, sub: m.brand, value: hidden ? 0 : value, display: hidden ? 'só contagem' : metric === 'km' ? `${nf(value, 0)} km` : nf(value), muted: hidden };
  }).sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
  const watchBrandItems: HItem[] = (r?.devices.byManufacturer ?? []).map((m) => ({ key: m.key, label: m.label, sub: `${nf(m.devices)} dispositivo(s)`, value: m.students, muted: m.label === UNIDENTIFIED })).sort(unknownLast);
  const watchModelItems: HItem[] = (r?.devices.byModel ?? []).map((m) => ({ key: m.key, label: m.label, sub: m.manufacturer, value: m.students, muted: m.label === MODEL_UNKNOWN })).sort(unknownLast);
  const platformItems: HItem[] = (r?.devices.byPlatform ?? []).map((p) => ({
    key: p.key, label: p.label, sub: `${nf(p.studentsSendingData)} de ${nf(p.students)} enviando dados`, value: p.students, display: nf(p.students),
    segments: [{ value: p.studentsSendingData, className: 'on', label: 'Enviando dados no período' }, { value: Math.max(0, p.students - p.studentsSendingData), className: 'off', label: 'Sem envio no período' }],
    title: `${p.label}: ${nf(p.students)} alunas, ${nf(p.studentsSendingData)} enviando dados no período`,
  }));
  const platformMax = Math.max(1, ...platformItems.map((i) => i.value));
  const kmDist = (r?.shoes.kmDistribution ?? []).map((b) => ({ key: b.key, label: SHORT_KM[b.key] ?? b.label, value: b.shoes, sub: b.label }));
  const bandDist = (r?.shoes.distanceBands ?? []).map((b) => ({ key: b.key, label: SHORT_BAND[b.key] ?? b.label, value: b.runs, sub: `${b.label} · ${nf(b.km, 1)} km` }));
  const totalShoeKm = r?.shoes.performanceHidden ? null : (r?.shoes.distanceBands ?? []).reduce((sum, b) => sum + b.km, 0);
  const perfNote = r?.shoes.performanceHidden ? 'Menos de 3 alunas neste resultado: as contagens são exatas, mas corridas, km, pace e faixas ficam ocultos para não expor uma aluna.' : null;

  // ── detalhes ──
  const renderSheet = () => {
    if (!sheet || !r) return null;
    if (sheet.kind === 'filters') {
      const changed = JSON.stringify(draft) !== JSON.stringify(applied);
      return (
        <SheetFrame title="Filtros" subtitle="Todos valem ao mesmo tempo (E). O período é livre." onClose={() => { setDraft(applied); setSheet(null); }}
          footer={<><button type="button" className="eqBtn ghost" onClick={() => setDraft({ ...emptyDraft(), from: draft.from, to: draft.to })}>Limpar filtros</button><button type="button" className="eqBtn primary" onClick={() => { commit(draft); setSheet(null); }}>{changed ? 'Aplicar filtros' : 'Fechar'}</button></>}>
          <fieldset className="eqField">
            <legend><CalendarDays size={14} aria-hidden="true" /> Período</legend>
            <div className="eqDates">
              <label>De<input type="date" value={draft.from} max={draft.to} onChange={(e) => patch({ from: e.target.value })} /></label>
              <label>Até<input type="date" value={draft.to} max={localToday()} onChange={(e) => patch({ to: e.target.value })} /></label>
            </div>
            <div className="eqChips">{([[30, '30 dias'], [90, '90 dias'], [180, '180 dias'], ['ano', 'Este ano']] as Array<[number | 'ano', string]>).map(([value, text]) => <button key={text} type="button" className="eqChip" onClick={() => shortcut(value)}>{text}</button>)}</div>
          </fieldset>
          <ChipGroup label="Marca do relógio" options={options?.watchBrands ?? []} selected={draft.watchBrands} onChange={(n) => patch({ watchBrands: n })} />
          <ChipGroup label="Modelo do relógio" options={options?.watchModels ?? []} selected={draft.watchModels} onChange={(n) => patch({ watchModels: n })} />
          <ChipGroup label="Plataforma de integração" options={options?.platforms ?? []} selected={draft.platforms} onChange={(n) => patch({ platforms: n })} />
          <ChipGroup label="Marca do tênis" options={options?.shoeBrands ?? []} selected={draft.shoeBrands} onChange={(n) => patch({ shoeBrands: n })} />
          <ChipGroup label="Modelo do tênis" options={options?.shoeModels ?? []} selected={draft.shoeModels} onChange={(n) => patch({ shoeModels: n })} />
          <fieldset className="eqField">
            <legend>Situação do tênis</legend>
            <div className="eqChips">{([['all', 'Todos'], ['active', 'Em uso'], ['retired', 'Aposentados']] as Array<[Draft['shoeStatus'], string]>).map(([value, text]) => <button key={value} type="button" className={`eqChip${draft.shoeStatus === value ? ' on' : ''}`} aria-pressed={draft.shoeStatus === value} onClick={() => patch({ shoeStatus: value })}>{text}</button>)}</div>
          </fieldset>
          <fieldset className="eqField">
            <legend>Km acumulado do tênis</legend>
            <div className="eqRange"><input type="number" min={0} placeholder="mín." value={draft.shoeKmMin} onChange={(e) => patch({ shoeKmMin: e.target.value })} /><span>a</span><input type="number" min={0} placeholder="máx." value={draft.shoeKmMax} onChange={(e) => patch({ shoeKmMax: e.target.value })} /></div>
          </fieldset>
          <fieldset className="eqField">
            <legend>Volume de corrida da aluna no período (km)</legend>
            <div className="eqRange"><input type="number" min={0} placeholder="mín." value={draft.runnerKmMin} onChange={(e) => patch({ runnerKmMin: e.target.value })} /><span>a</span><input type="number" min={0} placeholder="máx." value={draft.runnerKmMax} onChange={(e) => patch({ runnerKmMax: e.target.value })} /></div>
            <small className="eqMuted">Conta só corridas vindas de relógio/aplicativo; aluna sem esse dado fica de fora quando o filtro é usado.</small>
          </fieldset>
          <ChipGroup label="Faixas de distância das corridas" options={(options?.bands ?? []).map((b) => ({ value: b.value, label: b.label, students: 0 }))} selected={draft.bands} onChange={(n) => patch({ bands: n })} showCount={false} />
          <ChipGroup label="Situação da aluna" options={statusOptions} selected={draft.studentStatuses} onChange={(n) => patch({ studentStatuses: n })} />
          <div className="eqAdminBox">
            <button type="button" className="eqBtn ghost" onClick={refreshDevices} disabled={refreshing} title="Reconstrói a lista de dispositivos a partir das atividades recebidas (somente administrador)."><RefreshCw size={14} aria-hidden="true" /> {refreshing ? 'Atualizando...' : 'Atualizar base de dispositivos'}</button>
            <small className="eqMuted">A base se atualiza sozinha a cada atividade recebida; este botão é só para forçar uma reconstrução.</small>
            {refreshMsg ? <small role="status">{refreshMsg}</small> : null}
          </div>
        </SheetFrame>
      );
    }
    if (sheet.kind === 'shoeBrand' || sheet.kind === 'shoeModel') {
      const group = (sheet.kind === 'shoeBrand' ? r.shoes.byBrand : r.shoes.byModel).find((g) => g.key === sheet.key);
      if (!group) return null;
      const brandKey = sheet.kind === 'shoeBrand' ? group.key : r.shoes.byBrand.find((b) => b.key === nk(group.brand))?.key;
      const models = sheet.kind === 'shoeBrand' ? r.shoes.byModel.filter((m) => nk(m.brand) === group.key) : [];
      const total = Math.max(1, group.shoes);
      return (
        <SheetFrame title={sheet.kind === 'shoeModel' && group.brand ? `${group.brand} ${group.label}` : group.label} subtitle={sheet.kind === 'shoeBrand' ? 'Marca de tênis' : 'Modelo de tênis'} onClose={() => setSheet(null)}
          back={sheet.kind === 'shoeModel' && brandKey ? () => setSheet({ kind: 'shoeBrand', key: brandKey }) : undefined}>
          <div className="eqStats">{groupStat('Alunas', nf(group.students))}{groupStat('Tênis', nf(group.shoes))}{groupStat('Em uso', nf(group.active))}{groupStat('Aposentados', nf(group.retired))}</div>
          <div className="eqSplit" aria-label="Em uso e aposentados"><span className="on" style={{ width: `${(group.active / total) * 100}%` }} /><span className="off" style={{ width: `${(group.retired / total) * 100}%` }} /></div>
          <Legend items={[{ className: 'on', label: 'Em uso' }, { className: 'off', label: 'Aposentados' }]} />
          {group.performanceHidden ? (
            <Empty icon={<Info size={22} />} title="Desempenho oculto" text="Menos de 3 alunas com corrida neste grupo. As contagens acima são exatas; corridas, km, pace e faixas ficam ocultos para não expor uma aluna." />
          ) : (
            <>
              <div className="eqStats">{groupStat('Corridas', nf(group.runs))}{groupStat('Km', nf(group.km, 0))}{groupStat('Km médio por tênis', nf(group.avgKmPerShoe, 0))}{groupStat('Pace (descritivo)', group.pace ? group.pace.label : group.paceHidden ? 'amostra pequena' : '—')}</div>
              <h4 className="eqH4">Corridas por faixa de distância</h4>
              <Columns data={group.bands.map((b) => ({ key: b.key, label: SHORT_BAND[b.key] ?? b.label, value: b.count, sub: `${b.label} · ${nf(b.distanceKm, 1)} km` }))} unit="corridas" emptyTitle="Sem corridas neste grupo" />
            </>
          )}
          {models.length > 0 ? (<><h4 className="eqH4">Modelos desta marca</h4><HBars items={models.map((m) => ({ key: m.key, label: m.label, sub: `${nf(m.shoes)} tênis`, value: m.students }))} onSelect={(key) => setSheet({ kind: 'shoeModel', key })} unit="alunas" /></>) : null}
          <p className="eqFine">Descrição, não relação de causa entre o equipamento e o desempenho.</p>
        </SheetFrame>
      );
    }
    if (sheet.kind === 'watchBrand') {
      const group = r.devices.byManufacturer.find((g) => g.key === sheet.key);
      if (!group) return null;
      const models = r.devices.byModel.filter((m) => nk(m.manufacturer) === nk(group.label));
      return (
        <SheetFrame title={group.label} subtitle="Fabricante de relógio/dispositivo" onClose={() => setSheet(null)}>
          <div className="eqStats">{groupStat('Alunas', nf(group.students))}{groupStat('Dispositivos', nf(group.devices))}{groupStat('Atividades recebidas', group.activities == null ? 'oculto (<3 alunas)' : nf(group.activities))}</div>
          {group.label === UNIDENTIFIED ? <p className="eqFine">O fabricante só é mostrado quando a fonte informou ou a plataforma atende uma única marca. Nada é presumido.</p> : null}
          <h4 className="eqH4">Modelos</h4>
          <HBars items={models.map((m) => ({ key: m.key, label: m.label, sub: m.technicalIds?.length ? `${m.technicalIds.length} identificador(es) técnico(s)` : undefined, value: m.students, muted: m.label === MODEL_UNKNOWN }))} onSelect={(key) => setSheet({ kind: 'watchModel', key })} unit="alunas" empty="Nenhum modelo identificado" />
        </SheetFrame>
      );
    }
    const model = r.devices.byModel.find((g) => g.key === sheet.key);
    if (!model) return null;
    const brand = r.devices.byManufacturer.find((b) => nk(b.label) === nk(model.manufacturer));
    return (
      <SheetFrame title={model.label === MODEL_UNKNOWN ? `${model.manufacturer} · ${MODEL_UNKNOWN}` : `${model.manufacturer} ${model.label}`} subtitle="Modelo de relógio/dispositivo" onClose={() => setSheet(null)} back={brand ? () => setSheet({ kind: 'watchBrand', key: brand.key }) : undefined}>
        <div className="eqStats">{groupStat('Alunas', nf(model.students))}{groupStat('Atividades recebidas', model.activities == null ? 'oculto (<3 alunas)' : nf(model.activities))}</div>
        {model.label === MODEL_UNKNOWN ? (
          <div className="eqTech">
            <strong>Modelo não identificado</strong>
            <p>A fonte não informou um nome comercial confiável, então o modelo não é inventado. Os identificadores técnicos recebidos ficam aqui só para consulta:</p>
            {model.technicalIds?.length ? <ul>{model.technicalIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul> : <p className="eqFine">Nenhum identificador técnico foi informado.</p>}
          </div>
        ) : null}
      </SheetFrame>
    );
  };

  const shoeMetricLabel: Record<ShoeMetric, string> = { students: 'Alunas', shoes: 'Tênis', km: 'Km', runs: 'Corridas' };
  const tabs: Array<[View, string, React.ReactNode]> = [['geral', 'Visão geral', <BarChart3 key="g" size={15} />], ['tenis', 'Tênis', <Footprints key="t" size={15} />], ['relogios', 'Relógios', <Watch key="r" size={15} />]];

  return (
    <section className="eqRoot">
      <header className="eqTop">
        <div className="eqTitle"><h2>Inteligência de Equipamentos</h2><p>Relógios e tênis da base, só em números agregados. Descrição, não relação de causa.</p></div>
        <div className="eqTopActions">
          <button type="button" className="eqPeriod" onClick={() => { setDraft(applied); setSheet({ kind: 'filters' }); }} title="Alterar período e filtros"><CalendarDays size={15} aria-hidden="true" /><span><b>{dm(applied.from)} – {dmy(applied.to)}</b><small>{nf(days)} dias</small></span></button>
          <button type="button" className="eqBtn primary" onClick={() => { setDraft(applied); setSheet({ kind: 'filters' }); }}><SlidersHorizontal size={15} aria-hidden="true" /> Filtros{activeChips.length ? <span className="eqBadge">{activeChips.length}</span> : null}</button>
        </div>
      </header>

      <div className="eqBar">
        <div className="eqTabs" role="tablist" aria-label="Visões">
          {tabs.map(([id, text, icon]) => <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{icon}{text}</button>)}
        </div>
        <label className="eqSwitch"><input type="checkbox" checked={compare} onChange={(e) => toggleCompare(e.target.checked)} /><span>Comparar com o período anterior</span></label>
      </div>

      {activeChips.length > 0 ? (
        <div className="eqActive" aria-label="Filtros ativos">
          {activeChips.map((chip) => <button key={chip.key} type="button" className="eqTag" onClick={chip.remove} title="Remover este filtro"><small>{chip.group}</small>{chip.text}<X size={12} aria-hidden="true" /></button>)}
          <button type="button" className="eqLinkBtn" onClick={clearAll}>Limpar todos</button>
        </div>
      ) : null}

      {state === 'error' ? <p className="eqError" role="alert">{message} <button type="button" className="eqLinkBtn" onClick={() => void run(applied, compare)}>Tentar de novo</button></p> : null}
      {state === 'loading' && !r ? <div className="eqSkeleton" aria-label="Carregando"><span /><span /><span /><span /></div> : null}

      {r ? (
        <div className={`eqBody${state === 'loading' ? ' eqBusy' : ''}`}>
          {r.population.studentsIncluded === 0 ? <Empty title="Nenhuma aluna atende a todos os filtros ao mesmo tempo" text="Afrouxe algum filtro ou amplie o período." /> : null}

          {r.population.studentsIncluded !== 0 && view === 'geral' ? (
            <>
              <div className="eqKpis">
                <Kpi icon={<Users size={16} />} label="Alunas nos filtros" value={pop?.studentsIncluded ?? null} hint={`de ${nf(pop?.studentsEligible)} na situação escolhida`} delta={delta('studentsIncluded')} />
                <Kpi icon={<Watch size={16} />} label="Com relógio" value={pop?.studentsWithDevice ?? null} hint={`${nf(r.devices.studentsWithoutDevice)} sem relógio registrado`} delta={delta('studentsWithDevice')} />
                <Kpi icon={<Footprints size={16} />} label="Com tênis cadastrado" value={pop?.studentsWithShoe ?? null} hint={`${nf(r.shoes.totals.studentsWithoutShoe)} sem tênis`} delta={delta('studentsWithShoe')} />
                <Kpi icon={<Activity size={16} />} label="Enviando dados" value={pop?.studentsSendingData ?? null} hint="ao menos uma atividade no período" delta={delta('studentsSendingData')} />
              </div>
              {perfNote ? <p className="eqNote"><Info size={14} aria-hidden="true" /> {perfNote}</p> : null}
              <div className="eqGrid2">
                <Card title="Marcas de tênis mais usadas" subtitle="Alunas por marca" action={<button type="button" className="eqLinkBtn" onClick={() => setView('tenis')}>Ver tênis <ChevronRight size={13} /></button>}>
                  <HBars items={shoeBrandItems('students')} limit={6} onSelect={(key) => setSheet({ kind: 'shoeBrand', key })} unit="alunas" empty="Nenhum tênis nos filtros" />
                </Card>
                <Card title="Fabricantes de relógio" subtitle="Alunas por fabricante" action={<button type="button" className="eqLinkBtn" onClick={() => setView('relogios')}>Ver relógios <ChevronRight size={13} /></button>}>
                  <HBars items={watchBrandItems} limit={6} onSelect={(key) => setSheet({ kind: 'watchBrand', key })} unit="alunas" empty="Nenhum relógio nos filtros" />
                </Card>
                <Card title="Plataformas de integração" subtitle="Quem de fato está enviando dados no período">
                  <HBars items={platformItems} max={platformMax} empty="Nenhuma plataforma nos filtros" />
                  {platformItems.length > 0 ? <Legend items={[{ className: 'on', label: 'Enviando dados' }, { className: 'off', label: 'Sem envio no período' }]} /> : null}
                </Card>
                <Card title="Corridas por faixa de distância" subtitle={totalShoeKm != null ? `${nf(totalShoeKm, 0)} km com tênis associados no período` : 'Corridas associadas a tênis no período'}>
                  <Columns data={bandDist} unit="corridas" emptyTitle={r.shoes.performanceHidden ? 'Desempenho oculto' : 'Sem corridas no período'} emptyText={r.shoes.performanceHidden ? 'Menos de 3 alunas neste resultado.' : 'Nenhuma corrida associada a tênis nos filtros.'} />
                </Card>
              </div>
            </>
          ) : null}

          {r.population.studentsIncluded !== 0 && view === 'tenis' ? (
            <>
              <div className="eqKpis">
                <Kpi icon={<Footprints size={16} />} label="Tênis" value={r.shoes.totals.shoes} hint={`de ${nf(r.shoes.totals.students)} alunas`} />
                <Kpi icon={<Activity size={16} />} label="Em uso" value={r.shoes.totals.active} />
                <Kpi icon={<Footprints size={16} />} label="Aposentados" value={r.shoes.totals.retired} />
                <Kpi icon={<Users size={16} />} label="Alunas sem tênis" value={r.shoes.totals.studentsWithoutShoe} />
              </div>
              {perfNote ? <p className="eqNote"><Info size={14} aria-hidden="true" /> {perfNote}</p> : null}
              <div className="eqGrid2">
                <Card title="Marcas" subtitle="Toque numa marca para ver os modelos e as faixas" action={<div className="eqSeg" role="group" aria-label="Medida">{(['students', 'shoes', 'km', 'runs'] as ShoeMetric[]).map((m) => <button key={m} type="button" className={shoeMetric === m ? 'on' : ''} aria-pressed={shoeMetric === m} onClick={() => setShoeMetric(m)}>{shoeMetricLabel[m]}</button>)}</div>}>
                  <HBars items={shoeBrandItems(shoeMetric)} limit={10} onSelect={(key) => setSheet({ kind: 'shoeBrand', key })} unit={shoeMetric === 'students' ? 'alunas' : shoeMetric === 'shoes' ? 'tênis' : shoeMetric === 'runs' ? 'corridas' : undefined} empty="Nenhum tênis nos filtros" />
                </Card>
                <Card title="Modelos" subtitle={`Medida: ${shoeMetricLabel[shoeMetric].toLowerCase()}`}>
                  <HBars items={shoeModelItems(shoeMetric)} limit={10} onSelect={(key) => setSheet({ kind: 'shoeModel', key })} unit={shoeMetric === 'students' ? 'alunas' : shoeMetric === 'shoes' ? 'tênis' : shoeMetric === 'runs' ? 'corridas' : undefined} empty="Nenhum tênis nos filtros" />
                </Card>
                <Card title="Quilometragem acumulada" subtitle="Tênis por faixa de km acumulado">
                  <Columns data={kmDist} unit="tênis" emptyTitle={r.shoes.performanceHidden ? 'Desempenho oculto' : 'Sem tênis nos filtros'} emptyText={r.shoes.performanceHidden ? 'Menos de 3 alunas neste resultado.' : undefined} />
                </Card>
                <Card title="Distâncias percorridas" subtitle="Corridas por faixa (cada corrida entra em uma só)">
                  <Columns data={bandDist} unit="corridas" emptyTitle={r.shoes.performanceHidden ? 'Desempenho oculto' : 'Sem corridas no período'} emptyText={r.shoes.performanceHidden ? 'Menos de 3 alunas neste resultado.' : undefined} />
                </Card>
              </div>
              <details className="eqDetails" open={openTable === 'tenis'} onToggle={(e) => setOpenTable((e.target as HTMLDetailsElement).open ? 'tenis' : null)}>
                <summary>Tabelas detalhadas de tênis</summary>
                <ShoeTable title="Por marca" rows={r.shoes.byBrand} onSelect={(key) => setSheet({ kind: 'shoeBrand', key })} />
                <ShoeTable title="Por modelo" rows={r.shoes.byModel} showBrand onSelect={(key) => setSheet({ kind: 'shoeModel', key })} />
              </details>
            </>
          ) : null}

          {r.population.studentsIncluded !== 0 && view === 'relogios' ? (
            <>
              <div className="eqKpis">
                <Kpi icon={<Watch size={16} />} label="Alunas com relógio" value={pop?.studentsWithDevice ?? null} delta={delta('studentsWithDevice')} />
                <Kpi icon={<Users size={16} />} label="Sem relógio registrado" value={r.devices.studentsWithoutDevice} />
                <Kpi icon={<Activity size={16} />} label="Enviando dados" value={pop?.studentsSendingData ?? null} hint="ao menos uma atividade no período" delta={delta('studentsSendingData')} />
                <Kpi icon={<BarChart3 size={16} />} label="Plataformas em uso" value={r.devices.byPlatform.length} />
              </div>
              <div className="eqGrid2">
                <Card title="Fabricantes" subtitle="Toque num fabricante para ver os modelos">
                  <HBars items={watchBrandItems} limit={10} onSelect={(key) => setSheet({ kind: 'watchBrand', key })} unit="alunas" empty="Nenhum relógio nos filtros" />
                  <p className="eqFine">Fabricante só aparece quando a fonte informou ou a plataforma atende uma única marca; caso contrário fica “{UNIDENTIFIED}”.</p>
                </Card>
                <Card title="Plataformas de integração" subtitle="Quem de fato está enviando dados no período">
                  <HBars items={platformItems} max={platformMax} empty="Nenhuma plataforma nos filtros" />
                  {platformItems.length > 0 ? <Legend items={[{ className: 'on', label: 'Enviando dados' }, { className: 'off', label: 'Sem envio no período' }]} /> : null}
                </Card>
                <Card wide title="Modelos" subtitle="Alunas por modelo; “Modelo não identificado” guarda o identificador técnico nos detalhes">
                  <HBars items={watchModelItems} limit={12} onSelect={(key) => setSheet({ kind: 'watchModel', key })} unit="alunas" empty="Nenhum modelo nos filtros" />
                </Card>
              </div>
              <details className="eqDetails" open={openTable === 'relogios'} onToggle={(e) => setOpenTable((e.target as HTMLDetailsElement).open ? 'relogios' : null)}>
                <summary>Tabelas detalhadas de relógios</summary>
                <WatchTables r={r} />
              </details>
            </>
          ) : null}

          <aside className="eqNotes" aria-label="Notas metodológicas">
            <strong>Como ler</strong>
            <ul>{r.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            <small>Atualizado em {new Date(r.generatedAt).toLocaleString('pt-BR')}</small>
          </aside>
        </div>
      ) : null}

      {renderSheet()}
    </section>
  );
}

function ShoeTable({ title, rows, showBrand, onSelect }: { title: string; rows: ShoeGroup[]; showBrand?: boolean; onSelect: (key: string) => void }) {
  if (rows.length === 0) return <Empty title="Nenhum tênis nos filtros escolhidos" />;
  return (
    <div className="eqTableWrap">
      <table className="eqTable">
        <caption>{title}</caption>
        <thead><tr><th>{showBrand ? 'Modelo' : 'Marca'}</th><th>Alunas</th><th>Tênis</th><th>Em uso / aposent.</th><th>Corridas</th><th>Km</th><th>Km médio por tênis</th><th>Pace</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td><button type="button" className="eqLinkBtn" onClick={() => onSelect(row.key)}>{showBrand && row.brand ? `${row.brand} ` : ''}{row.label}</button></td>
              <td>{nf(row.students)}</td><td>{nf(row.shoes)}</td><td>{nf(row.active)} / {nf(row.retired)}</td>
              <td>{row.performanceHidden ? '—' : nf(row.runs)}</td><td>{row.performanceHidden ? '—' : nf(row.km, 1)}</td><td>{row.performanceHidden ? '—' : nf(row.avgKmPerShoe, 1)}</td>
              <td>{row.performanceHidden ? <span className="eqSmall" title="Menos de 3 alunas com corrida neste grupo: só a contagem é mostrada.">só contagem</span> : row.pace ? row.pace.label : row.paceHidden ? <span className="eqSmall" title="Menos de 3 alunas com tempo e distância.">amostra pequena</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WatchTables({ r }: { r: Result }) {
  const table = (title: string, head: string[], rows: Array<Array<React.ReactNode>>) => (rows.length === 0 ? null : (
    <div className="eqTableWrap"><table className="eqTable"><caption>{title}</caption><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((cells, i) => <tr key={i}>{cells.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>
  ));
  return (
    <>
      {table('Por fabricante', ['Fabricante', 'Alunas', 'Dispositivos', 'Atividades'], r.devices.byManufacturer.map((m) => [m.label, nf(m.students), nf(m.devices), nf(m.activities)]))}
      {table('Por plataforma de integração', ['Plataforma', 'Alunas', 'Enviando dados no período', 'Atividades'], r.devices.byPlatform.map((p) => [p.label, nf(p.students), `${nf(p.studentsSendingData)} de ${nf(p.students)}`, nf(p.activities)]))}
      {table('Por modelo', ['Fabricante', 'Modelo', 'Alunas', 'Atividades', 'Identificador técnico'], r.devices.byModel.map((m) => [m.manufacturer, m.label, nf(m.students), nf(m.activities), m.technicalIds?.length ? <code key="t">{m.technicalIds.join(', ')}</code> : '—']))}
    </>
  );
}
