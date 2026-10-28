'use client';
import * as React from 'react';
import { Info, Search, X } from 'lucide-react';
import { API_URL, EVENT_TYPES, SOURCES, ContextEvent, PERIODS, dateKey, dateLabel, displayVariable, fmtFor, snapshotIsValid, unitLabel, windowFor, type Observation, type Variable } from './data';
import { ChartLegend, DEFAULT_EXPLORER_LAYERS, ExplorerChart, ModalityKey, type ExplorerLayers } from './explorer-chart';
import {
  CATEGORIES, MODALITY_LABELS, SIGNAL_LABEL, availableGroups, modalitiesQueryOf, referenceFor, statusOf, ucFirst,
  type Availability, type ExplorerSnapshot, type ExplorerVariable, type ModalityGroupId,
} from './explorer-data';
import SleepComposition from './sleep-composition';
import './explorer.css';

export type PeriodSelection = { id: string; custom: [number, number] | null };
type CategoryId = (typeof CATEGORIES)[number]['id'];
const DEFAULT_ACTIVE: Record<string, string> = { treinos: 'training.volumeCompletedTotalKm', sono: 'workout.preSleepQuality', recuperacao: 'wearable.hrvLastNightAvg', bem_estar: 'workout.prePhysicalFatigue', saude: 'workout.painFlag', atividade_diaria: 'wearable.dailySteps' };
const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : 'Não foi possível carregar os dados.');
const categoryOf = (variable: ExplorerVariable): string => variable.info?.category ?? 'treinos';
const valueText = (value: number | string, unit?: string) => (typeof value === 'number' ? `${fmtFor(unit)(value)}${unitLabel(unit) ? ` ${unitLabel(unit)}` : ''}` : String(value));

export default function EvolutionExplorer({ studentId, token, studentIsFemale, period, onOpenOriginal, onOpenIntegrations, panels }: {
  studentId: string; token: string; studentIsFemale: boolean | null; period: PeriodSelection; onOpenOriginal?: (target: { date: string; sessionId?: string }) => void; onOpenIntegrations?: () => void; panels?: { volume: React.ReactNode; carga: React.ReactNode };
}) {
  const [legend, setLegend] = React.useState<ExplorerVariable[]>([]);
  const [legendError, setLegendError] = React.useState('');
  const [category, setCategory] = React.useState<CategoryId>('treinos');
  const [search, setSearch] = React.useState('');
  // Visualizacao especializada da categoria Sono (composicao por noite, vinda da antiga aba Saude e Recuperacao): e' o que abre ao entrar em Sono
  // 'sleep' = composicao do sono (categoria Sono); 'volume' e 'carga' = os dois paineis semanais que abrem a categoria Treinos (vindos da pagina do aluno)
  const [special, setSpecial] = React.useState<'sleep' | 'volume' | 'carga' | null>(panels ? 'volume' : null);
  const specialView = special !== null;
  const [activeId, setActiveId] = React.useState<string>(DEFAULT_ACTIVE.treinos);
  const [availability, setAvailability] = React.useState<Record<string, Availability>>({});
  const [group, setGroup] = React.useState<ModalityGroupId>('agregada');
  const [source, setSource] = React.useState('');
  const [layers, setLayers] = React.useState<ExplorerLayers>(DEFAULT_EXPLORER_LAYERS);
  const [snapshot, setSnapshot] = React.useState<{ key: string; data: ExplorerSnapshot } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState<number | null>(null);
  const [infoFor, setInfoFor] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<{ owner: string; rows: ContextEvent[]; error: string } | null>(null);
  const [eventSelected, setEventSelected] = React.useState<ContextEvent | null>(null);
  // modalidades e fontes disponiveis do indicador ativo: guardadas a parte para os seletores nao sumirem enquanto a serie filtrada carrega
  const [meta, setMeta] = React.useState<{ id: string; modalities: string[]; sources: NonNullable<ExplorerSnapshot['availableSources']>; main: string | null } | null>(null);
  const cache = React.useRef(new Map<string, ExplorerSnapshot>());
  const remember = React.useCallback((id: string, data: ExplorerSnapshot) => setMeta((previous) => (previous && previous.id === id && !(data.availableSources?.length) && !data.availableModalities?.length ? previous : { id, modalities: data.availableModalities ?? [], sources: data.availableSources ?? [], main: data.mainSource ?? null })), []);
  const headers = React.useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${API_URL}/coach/data/training-intelligence/variable-legend`, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? 'Sessão não aceita pela API (401). Entre novamente no Admin.' : `Não foi possível carregar o catálogo de indicadores (HTTP ${response.status}).`);
        const rows = await response.json() as Variable[];
        if (!Array.isArray(rows)) throw new Error('Formato inesperado no catálogo de indicadores.');
        if (!controller.signal.aborted) { setLegend(rows.map(displayVariable) as ExplorerVariable[]); setLegendError(''); }
      } catch (cause) { if (!controller.signal.aborted) setLegendError(errorMessage(cause)); }
    })();
    return () => controller.abort();
  }, [headers]);

  const inCategory = React.useMemo(() => legend.filter((variable) => categoryOf(variable) === category), [legend, category]);
  const needle = search.trim().toLocaleLowerCase('pt-BR');
  const listed = React.useMemo(() => (needle
    ? legend.filter((variable) => `${variable.constructLabel ?? variable.id} ${variable.id}`.toLocaleLowerCase('pt-BR').includes(needle))
    : inCategory), [legend, inCategory, needle]);

  // disponibilidade (n de registros) so' dos indicadores listados: nao baixa a serie de cada um
  React.useEffect(() => {
    const ids = listed.map((variable) => variable.id).filter((id) => !availability[id]);
    if (!ids.length || !studentId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/observations-availability?variables=${encodeURIComponent(ids.join(','))}`, { headers, signal: controller.signal });
        if (!response.ok) return;
        const rows = await response.json() as Availability[];
        if (!Array.isArray(rows) || controller.signal.aborted) return;
        setAvailability((current) => ({ ...current, ...Object.fromEntries(rows.map((row) => [row.id, row])) }));
      } catch { /* a lista continua utilizavel sem as contagens */ }
    })();
    return () => controller.abort();
  }, [listed, studentId, headers, availability]);

  const active = legend.find((variable) => variable.id === activeId) ?? null;

  // O seletor de modalidade/fonte depende da variavel: ao trocar de indicador volta ao padrao
  React.useEffect(() => { setGroup('agregada'); setSource(''); setSelected(null); setInfoFor(null); }, [activeId]);

  const modalitiesQuery = modalitiesQueryOf(group, meta?.id === activeId ? meta.modalities : undefined);
  const requestKey = `${studentId}|${activeId}|${modalitiesQuery}|${source}`;

  React.useEffect(() => {
    if (!studentId || !active || category === 'contexto' || specialView) return;
    const cached = cache.current.get(requestKey);
    if (cached) { setSnapshot({ key: requestKey, data: cached }); remember(activeId, cached); setError(''); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    (async () => {
      try {
        const query = new URLSearchParams({ reference: '1' });
        if (modalitiesQuery) query.set('modalities', modalitiesQuery);
        if (source) query.set('source', source);
        const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/observations/${encodeURIComponent(activeId)}?${query.toString()}`, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? 'Sessão expirada. Entre novamente no Admin.' : `${activeId}: falha de carregamento (${response.status}).`);
        const payload: unknown = await response.json();
        if (!snapshotIsValid(payload, activeId)) throw new Error(`${activeId}: resposta incompatível com o contrato de observações.`);
        if (controller.signal.aborted) return;
        cache.current.set(requestKey, payload as ExplorerSnapshot);
        setSnapshot({ key: requestKey, data: payload as ExplorerSnapshot });
        remember(activeId, payload as ExplorerSnapshot);
      } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [requestKey, studentId, active, activeId, category, specialView, headers, modalitiesQuery, source, remember]);

  React.useEffect(() => {
    if (category !== 'contexto' || !studentId || events?.owner === studentId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/context-events`, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(`Eventos indisponíveis (${response.status}).`);
        const rows = await response.json() as ContextEvent[];
        if (!controller.signal.aborted) setEvents({ owner: studentId, rows: Array.isArray(rows) ? rows : [], error: '' });
      } catch (cause) { if (!controller.signal.aborted) setEvents({ owner: studentId, rows: [], error: errorMessage(cause) }); }
    })();
    return () => controller.abort();
  }, [category, studentId, headers, events]);

  const current = snapshot && snapshot.key === requestKey ? snapshot.data : null;
  const periodDefinition = PERIODS.find((candidate) => candidate.id === period.id);
  const range = React.useMemo<[number, number]>(() => (period.id === 'custom' && period.custom ? period.custom : windowFor(periodDefinition?.days ?? 183, current ? [current] : [], [])), [period, periodDefinition?.days, current]);

  function pickCategory(next: CategoryId) {
    setCategory(next); setSearch(''); setEventSelected(null); setSpecial(next === 'sono' ? 'sleep' : next === 'treinos' && panels ? 'volume' : null);
    if (next !== 'contexto') setActiveId(DEFAULT_ACTIVE[next] && legend.some((v) => v.id === DEFAULT_ACTIVE[next]) ? DEFAULT_ACTIVE[next] : (legend.find((v) => categoryOf(v) === next)?.id ?? activeId));
  }
  function pickVariable(variable: ExplorerVariable) {
    const next = categoryOf(variable);
    setSpecial(null);
    if (category !== next) setCategory(next as CategoryId);
    setActiveId(variable.id);
  }
  const toggleLayer = (key: keyof ExplorerLayers) => setLayers((currentLayers) => ({ ...currentLayers, [key]: !currentLayers[key] }));

  const info = infoFor ? legend.find((variable) => variable.id === infoFor) ?? null : null;
  const unit = current?.variable.scale?.unit ?? active?.scale?.unit ?? '';
  const groups = availableGroups(meta?.id === activeId ? meta.modalities : undefined);
  const sources = meta?.id === activeId ? meta.sources : [];
  const lastIndex = current ? current.observations.reduce((best, o, index, all) => (new Date(o.timestamp).getTime() >= new Date(all[best].timestamp).getTime() ? index : best), 0) : 0;
  const lastObservation = current?.observations[lastIndex];
  const lastNumericPosition = current && lastObservation ? current.observations.filter((o) => typeof o.value === 'number').indexOf(lastObservation) : -1;
  const lastReference = current && lastObservation ? referenceFor(current, lastObservation, lastNumericPosition) : null;
  // Cor por modalidade em QUALQUER indicador cujas observacoes tem modalidade (treino, feedback do treino, sono relatado no treino...); indicadores sem modalidade (relogio) mantem a cor padrao
  const colorByModality = Boolean(current?.observations.some((o) => o.context?.modality));
  const shown = selected != null && current ? current.observations[selected] : null;
  const shownReference = current && shown ? referenceFor(current, shown, current.observations.filter((o) => typeof o.value === 'number').indexOf(shown)) : null;

  if (legendError) return <p role="alert" className="evx-error">{legendError}</p>;
  return <div className="evx">
    <div className="evx-categories" role="tablist" aria-label="Categorias de indicadores">
      {CATEGORIES.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={category === id && !needle} className={category === id && !needle ? 'active' : ''} onClick={() => pickCategory(id)}>{label}</button>)}
    </div>
    <div className="evx-body">
      <aside className="evx-side" aria-label="Indicadores">
        <label className="evx-search"><Search size={15} /><input aria-label="Buscar indicador" placeholder="Buscar indicador…" value={search} onChange={(e) => setSearch(e.target.value)} />{search && <button type="button" aria-label="Limpar busca" onClick={() => setSearch('')}><X size={13} /></button>}</label>
        {category === 'contexto' && !needle
          ? <p className="evx-side-note">Acontecimentos de vida registrados para esta aluna: viagem, trabalho, doença, mudança de rotina. Não são medidas, são registros datados.</p>
          : <ul className="evx-list">
            {category === 'sono' && !needle && <li><button type="button" className={`evx-item available ${special === 'sleep' ? 'active' : ''}`} aria-current={special === 'sleep' ? 'true' : undefined} onClick={() => setSpecial('sleep')}><span><b>Composição do sono por noite</b><small>etapas, pontuação e sessões</small></span></button></li>}
            {category === 'treinos' && !needle && panels && ([['volume', 'Volume semanal', 'prescrito x realizado por semana'], ['carga', 'Carga semanal e relação aguda:crônica', 'carga e aumento contra a semana anterior']] as const).map(([id, title, note]) => <li key={id}><button type="button" className={`evx-item available ${special === id ? 'active' : ''}`} aria-current={special === id ? 'true' : undefined} onClick={() => setSpecial(id)}><span><b>{title}</b><small>{note}</small></span></button></li>)}
            {listed.map((variable) => {
              const status = statusOf(variable, availability[variable.id], studentIsFemale);
              return <li key={variable.id}>
                <button type="button" className={`evx-item ${variable.id === activeId && category !== 'contexto' && !specialView ? 'active' : ''} ${status.kind}`} aria-current={variable.id === activeId && !specialView ? 'true' : undefined} onClick={() => pickVariable(variable)}>
                  <span><b>{ucFirst(variable.constructLabel ?? variable.id)}</b>{status.label && <small>{status.label}</small>}{needle && <small className="evx-chip">{CATEGORIES.find((c) => c.id === categoryOf(variable))?.label}</small>}</span>
                </button>
                <button type="button" className="evx-info-btn" aria-label={`Informações sobre ${variable.constructLabel ?? variable.id}`} aria-expanded={infoFor === variable.id} onClick={() => setInfoFor(infoFor === variable.id ? null : variable.id)}><Info size={15} /></button>
              </li>;
            })}
            {!listed.length && <li className="evx-empty-small">{needle ? 'Nenhum indicador encontrado.' : 'Carregando indicadores…'}</li>}
          </ul>}
        <p className="evx-side-foot">Indicadores fora do catálogo (carga sRPE, sessões perdidas, calendário) estão em “Treinos e carga”.</p>
      </aside>
      <section className="evx-main">
        {info && !(specialView && !needle && category !== 'contexto') && <div className="evx-info" role="dialog" aria-label={`Informações: ${info.constructLabel ?? info.id}`}>
          <div className="evx-info-head"><b>{info.constructLabel ?? info.id}</b><button type="button" aria-label="Fechar informações" onClick={() => setInfoFor(null)}><X size={15} /></button></div>
          <dl>
            <dt>Definição</dt><dd>{info.dataType === 'categorical' ? 'Registro categórico: guarda a categoria informada, sem média nem tendência numérica.' : `Valores maiores indicam mais de: ${info.constructLabel ?? info.id}. Não significa melhor nem pior.`}</dd>
            <dt>Unidade</dt><dd>{info.scale ? `${unitLabel(info.scale.unit) ?? 'escala'} (${fmtFor(info.scale.unit)(info.scale.min).replace(',0', '')} a ${fmtFor(info.scale.unit)(info.scale.max).replace(',0', '')})` : 'Categorias'}</dd>
            <dt>Origem</dt><dd>{info.info?.evidenceLabel ?? '—'}</dd>
            <dt>Periodicidade</dt><dd>{info.info?.periodicityLabel ?? '—'}</dd>
            <dt>Condições de comparação</dt><dd>{[
              info.info?.versionComparability === 'not_comparable_across_versions' ? 'Versões do questionário não são comparáveis entre si.' : 'Versões do questionário comparáveis.',
              info.info?.crossSourceComparability === 'not_comparable' ? 'Fontes diferentes (relógios/aplicativos) nunca são misturadas: cada uma tem a sua série.' : 'Fonte única.',
              info.info ? `Janelas de referência em ${info.info.windowUnit}.` : '',
            ].filter(Boolean).join(' ')}</dd>
            {info.info?.notes && <><dt>Observações</dt><dd>{info.info.notes}</dd></>}
          </dl>
        </div>}

        {category === 'treinos' && panels && (special === 'volume' || special === 'carga') && !needle ? <div className="evoGrid">{special === 'volume' ? panels.volume : panels.carga}</div>
          : category === 'sono' && special === 'sleep' && !needle ? <SleepComposition key={studentId} studentId={studentId} token={token} period={period} onOpenIntegrations={onOpenIntegrations} />
          : category === 'contexto' && !needle ? <ContextPanel events={events} studentId={studentId} range={range} selected={eventSelected} onSelect={setEventSelected} />
          : !active ? <p className="evx-empty">Carregando indicadores…</p>
          : <>
            <header className="evx-head">
              <div><h3>{ucFirst(active.constructLabel ?? active.id)}</h3><p>{unit ? `${unitLabel(unit)} · ` : ''}{current ? `${current.evidence.n} registros${current.selectedSource ? ` · fonte: ${current.selectedSource}` : ''}` : loading ? 'Carregando…' : ''}</p></div>
              <button type="button" className="evx-info-btn big" aria-label="Informações do indicador" onClick={() => setInfoFor(infoFor === active.id ? null : active.id)}><Info size={17} />Sobre este indicador</button>
            </header>
            {error && <p role="alert" className="evx-error">{error}</p>}
            <div className="evx-controls">
              {groups.length > 1 && <div className="evx-segment" role="group" aria-label="Modalidade">{groups.map((item) => <button key={item.id} type="button" className={group === item.id ? 'active' : ''} aria-pressed={group === item.id} onClick={() => { setGroup(item.id); setSelected(null); }}>{item.label}</button>)}</div>}
              {sources.length > 1 && <label className="evx-source">Fonte<select aria-label="Fonte dos dados" value={source || meta?.main || ''} onChange={(e) => { setSource(e.target.value); setSelected(null); }}>{sources.map((item) => <option key={item.key} value={item.key}>{item.key} · {item.n} registros{item.key === meta?.main ? ' (principal)' : ''}</option>)}</select></label>}
            </div>
            {current?.evidence.comparabilityWarning && <p className="evx-caution">{current.evidence.comparabilityWarning}</p>}
            {loading && !current && <p role="status" className="evx-empty">Carregando série…</p>}
            {current && (current.mathApplicable
              ? <>
                <ExplorerChart snapshot={current} range={range} layers={layers} selectedIndex={selected} onSelect={setSelected} title={active.constructLabel ?? active.id} byModality={colorByModality} />
                <ChartLegend snapshot={current} layers={layers} onToggle={toggleLayer} />
                {colorByModality && <ModalityKey snapshot={current} range={range} />}
                <Summary snapshot={current} unit={unit} lastObservation={lastObservation} lastReference={lastReference} />
              </>
              : <CategoricalPanel snapshot={current} range={range} selected={selected} onSelect={setSelected} />)}
            {current && shown && <ObservationDetail snapshot={current} observation={shown} reference={shownReference} unit={unit} onClose={() => setSelected(null)} onOpenOriginal={onOpenOriginal} />}
            <p className="evx-causality">Coincidência temporal não demonstra causa nem efeito. Médias, faixa e sinal descrevem o histórico anterior da própria aluna, sem dizer se algo é bom ou ruim.</p>
          </>}
      </section>
    </div>
  </div>;
}

function Summary({ snapshot, unit, lastObservation, lastReference }: { snapshot: ExplorerSnapshot; unit: string; lastObservation: Observation | undefined; lastReference: ReturnType<typeof referenceFor> }) {
  const reference = snapshot.reference;
  const band = lastReference?.band;
  const bandText = !band || band.basis === 'none' || band.lower == null ? 'Sem base suficiente'
    : `${fmtFor(unit)(band.lower)} – ${fmtFor(unit)(band.upper)}`;
  const bandNote = !band ? '' : band.basis === 'individual' ? `${band.n} registros anteriores` : band.basis === 'limited' ? `base pequena: ${band.n} registros` : `${lastReference?.priorN ?? 0} registros anteriores (mínimo ${reference?.bandPolicy.limitedMin ?? 4})`;
  const partial = snapshot.currentWeekContext?.isPartialWeek;
  return <section className="evx-summary" aria-label="Resumo matemático">
    <div className="evx-card"><span>Mais recente</span><strong>{lastObservation ? valueText(lastObservation.value, unit) : '—'}</strong><small>{lastObservation ? dateLabel(lastObservation.timestamp, true) : 'sem registro'}{partial ? ' · semana em andamento' : ''}</small></div>
    <div className="evx-card"><span>Média histórica anterior</span><strong>{lastReference?.historicalMean.value != null ? valueText(lastReference.historicalMean.value, unit) : '—'}</strong><small>{lastReference ? `${lastReference.historicalMean.n} registros antes do mais recente` : 'sem referência'}</small></div>
    <div className="evx-card"><span>Faixa habitual anterior</span><strong>{bandText}</strong><small>{bandNote}</small></div>
    <div className={`evx-card signal ${lastReference?.signal ?? 'no_reference'}`}><span>Posição do mais recente</span><strong>{lastReference ? SIGNAL_LABEL[lastReference.signal] : 'Sem referência suficiente'}</strong><small>{lastReference?.outsideBy != null ? `${lastReference.outsideBy > 0 ? '+' : ''}${fmtFor(unit)(lastReference.outsideBy)} ${unitLabel(unit) ?? ''} além do limite` : 'Sinal neutro: não indica melhora nem piora'}</small></div>
    {reference && lastReference && <div className="evx-refs"><b>Médias móveis anteriores ao mais recente</b>{reference.windows.map((window) => { const item = lastReference.movingAverages[window.key]; return <span key={window.key}>{window.label}: <em>{item.value == null ? 'sem base' : valueText(item.value, unit)}</em><small>{item.n} reg.{item.isPartialWindow && item.value != null ? ' · janela parcial' : ''}</small></span>; })}</div>}
    {lastReference && lastReference.priorN < (reference?.bandPolicy.individualMin ?? 12) && <p className="evx-low">Quantidade de registros ainda baixa ({lastReference.priorN} antes do mais recente): as referências são exploratórias.</p>}
  </section>;
}

function ObservationDetail({ snapshot, observation, reference, unit, onClose, onOpenOriginal }: {
  snapshot: ExplorerSnapshot; observation: Observation; reference: ReturnType<typeof referenceFor>; unit: string; onClose: () => void; onOpenOriginal?: (target: { date: string; sessionId?: string }) => void;
}) {
  const context = observation.context ?? {};
  return <section className="evx-detail" aria-label="Registro original">
    <div className="evx-detail-head"><b>Registro original · {dateLabel(observation.timestamp, true)}</b><button type="button" aria-label="Fechar registro" onClick={onClose}><X size={15} /></button></div>
    <dl>
      <dt>Valor</dt><dd>{valueText(observation.value, unit)}</dd>
      {context.modality && <><dt>Modalidade</dt><dd>{MODALITY_LABELS[context.modality] ?? context.modality}</dd></>}
      {typeof context.sourceKey === 'string' && <><dt>Fonte</dt><dd>{context.sourceKey}</dd></>}
      {observation.instrumentVersion != null && <><dt>Versão do instrumento</dt><dd>{observation.instrumentVersion}</dd></>}
      {reference && <><dt>Referência na época</dt><dd>{SIGNAL_LABEL[reference.signal]}{reference.band.lower != null ? ` (${fmtFor(unit)(reference.band.lower)} – ${fmtFor(unit)(reference.band.upper)})` : ''} · {reference.priorN} registros anteriores · média histórica {reference.historicalMean.value == null ? '—' : fmtFor(unit)(reference.historicalMean.value)}</dd></>}
      {context.isPartialWeek && <><dt>Semana</dt><dd>Em andamento no momento do registro</dd></>}
      {['sessionId', 'workoutCompletionId', 'checkinId'].filter((key) => typeof context[key] === 'string').map((key) => <React.Fragment key={key}><dt>{key === 'sessionId' ? 'Sessão' : key === 'workoutCompletionId' ? 'Feedback do treino' : 'Check-in semanal'}</dt><dd className="evx-id">{String(context[key])}</dd></React.Fragment>)}
    </dl>
    {onOpenOriginal && <button type="button" className="evx-open" onClick={() => onOpenOriginal({ date: dateKey(observation.timestamp), sessionId: typeof context.sessionId === 'string' ? context.sessionId : undefined })}>Abrir na aba Semanas anteriores</button>}
    {snapshot.reference == null && <p className="evx-low">Este registro não tem referências anteriores calculadas.</p>}
  </section>;
}

function CategoricalPanel({ snapshot, range, selected, onSelect }: { snapshot: ExplorerSnapshot; range: [number, number]; selected: number | null; onSelect: (index: number | null) => void }) {
  const rows = snapshot.observations.map((observation, index) => ({ observation, index })).filter(({ observation }) => { const at = Date.parse(`${dateKey(observation.timestamp)}T00:00:00Z`); return at >= range[0] && at <= range[1]; }).reverse();
  const counts = new Map<string, number>();
  for (const { observation } of rows) counts.set(String(observation.value), (counts.get(String(observation.value)) ?? 0) + 1);
  return <section className="evx-categorical">
    <p className="evx-caution">Indicador categórico: guarda a categoria informada. Não há média, faixa habitual nem tendência numérica; abaixo estão as contagens e os registros do período.</p>
    {rows.length ? <>
      <div className="evx-counts">{[...counts.entries()].map(([category, count]) => <span key={category}><b>{category}</b>{count}</span>)}</div>
      <ul className="evx-records">{rows.slice(0, 80).map(({ observation, index }) => <li key={index}><button type="button" className={selected === index ? 'active' : ''} onClick={() => onSelect(selected === index ? null : index)}><time>{dateLabel(observation.timestamp, true)}</time><b>{String(observation.value)}</b><small>{observation.context?.modality ? MODALITY_LABELS[observation.context.modality] ?? observation.context.modality : ''}</small></button></li>)}</ul>
    </> : <p className="evx-empty">Nenhum registro neste período.</p>}
  </section>;
}

function ContextPanel({ events, studentId, range, selected, onSelect }: { events: { owner: string; rows: ContextEvent[]; error: string } | null; studentId: string; range: [number, number]; selected: ContextEvent | null; onSelect: (event: ContextEvent | null) => void }) {
  if (!events || events.owner !== studentId) return <p role="status" className="evx-empty">Carregando acontecimentos…</p>;
  if (events.error) return <p role="alert" className="evx-error">{events.error}</p>;
  const rows = events.rows.filter((event) => { const at = Date.parse(`${dateKey(event.startedAt ?? event.reportedAt)}T00:00:00Z`); return at >= range[0] && at <= range[1]; }).sort((a, b) => (b.startedAt ?? b.reportedAt).localeCompare(a.startedAt ?? a.reportedAt));
  return <section className="evx-context">
    <header className="evx-head"><div><h3>Acontecimentos de contexto</h3><p>{rows.length} no período · registros datados, não medidas</p></div></header>
    {rows.length ? <ul className="evx-records">{rows.map((event) => <li key={event.id}><button type="button" className={selected?.id === event.id ? 'active' : ''} onClick={() => onSelect(selected?.id === event.id ? null : event)}><time>{dateLabel(event.startedAt ?? event.reportedAt, true)}</time><b>{EVENT_TYPES[event.type] ?? event.type}</b><small>{SOURCES[event.source] ?? event.source}</small></button></li>)}</ul> : <p className="evx-empty">Nenhum acontecimento neste período.</p>}
    {selected && <section className="evx-detail"><div className="evx-detail-head"><b>{EVENT_TYPES[selected.type] ?? selected.type} · {dateLabel(selected.startedAt ?? selected.reportedAt, true)}</b><button type="button" aria-label="Fechar" onClick={() => onSelect(null)}><X size={15} /></button></div>{selected.originalText && <blockquote>{selected.originalText}</blockquote>}<dl><dt>Situação</dt><dd>{selected.status}</dd><dt>Registrado em</dt><dd>{dateLabel(selected.reportedAt, true)}</dd>{selected.endedAt && <><dt>Até</dt><dd>{dateLabel(selected.endedAt, true)}</dd></>}</dl></section>}
    <p className="evx-causality">Contexto relatado é registro, nunca causa comprovada de uma mudança fisiológica próxima.</p>
  </section>;
}
