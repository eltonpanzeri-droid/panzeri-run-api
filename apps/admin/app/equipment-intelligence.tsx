'use client';

import React, { Fragment, useCallback, useEffect, useState } from 'react';

// Inteligência de Equipamentos (23/10/2026). SOMENTE LEITURA e SÓ AGREGADOS: GET /coach/equipment/options e /coach/equipment/intelligence. Nenhum nome, e-mail ou id de aluna aparece aqui.
// Estatística descritiva: associação entre equipamento e pace/volume não é causalidade. Filtros combináveis (todos juntos, "E"); período livre.

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
type Result = {
  generatedAt: string;
  filters: Record<string, unknown>;
  period: { from: string; to: string };
  population: { studentsEligible: number; studentsIncluded: number | null; studentsWithDevice: number | null; studentsWithShoe: number | null; studentsSendingData: number | null };
  devices: {
    byManufacturer: Array<{ key: string; label: string; students: number; devices: number; activities: number | null }>;
    byModel: Array<{ key: string; manufacturer: string; label: string; students: number; activities: number | null }>;
    byPlatform: Array<{ key: string; label: string; students: number; devices: number; activities: number | null; studentsSendingData: number }>;
    studentsWithoutDevice: number | null;
  };
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

const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const addDays = (date: string, days: number) => new Date(new Date(`${date}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const nf = (value: number | null, digits = 0) => (value == null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits }));
const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

const STATUS_LABEL: Record<string, string> = { active: 'Ativa', pending: 'Pendente', canceled: 'Cancelada', cancelled: 'Cancelada', expired: 'Expirada', past_due: 'Em atraso', overdue: 'Em atraso' };
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

function ChipGroup({ label, options, selected, onChange, showCount = true }: { label: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void; showCount?: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open ? options : options.slice(0, 8);
  return (
    <div className="eqField">
      <span className="eqLabel">{label}{selected.length ? <em> · {selected.length} selecionado(s)</em> : null}</span>
      <div className="eqChips">
        {options.length === 0 ? <small className="eqMuted">Sem opções ainda.</small> : null}
        {shown.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button key={option.value} type="button" className={`eqChip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value])}>
              {option.label}{showCount ? <small> {option.students}</small> : null}
            </button>
          );
        })}
        {options.length > 8 ? <button type="button" className="eqMore" onClick={() => setOpen((v) => !v)}>{open ? 'Mostrar menos' : `Ver todos (${options.length})`}</button> : null}
      </div>
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return <span className="eqBarTrack" aria-hidden="true"><span className="eqBarFill" style={{ width: `${max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%` }} /></span>;
}

function ShoeTable({ title, rows, showBrand }: { title: string; rows: ShoeGroup[]; showBrand?: boolean }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.students));
  if (rows.length === 0) return <p className="eqMuted">Nenhum tênis nos filtros escolhidos.</p>;
  return (
    <div className="eqTableWrap">
      <table className="eqTable">
        <caption>{title}</caption>
        <thead><tr><th>{showBrand ? 'Modelo' : 'Marca'}</th><th>Alunas</th><th></th><th>Tênis</th><th>Em uso / aposentados</th><th>Corridas</th><th>Km</th><th>Km médio por tênis</th><th>Pace (descritivo)</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.key}>
              <tr className="eqRow" onClick={() => setOpenKey(openKey === row.key ? null : row.key)} aria-expanded={openKey === row.key}>
                <td><button type="button" className="eqLink">{openKey === row.key ? '▾' : '▸'} {showBrand && row.brand ? `${row.brand} ` : ''}{row.label}</button></td>
                <td>{nf(row.students)}</td><td className="eqBarCell"><Bar value={row.students} max={max} /></td>
                <td>{nf(row.shoes)}</td><td>{nf(row.active)} / {nf(row.retired)}</td><td>{nf(row.runs)}</td><td>{nf(row.km, 1)}</td>
                <td>{row.avgKmPerShoe != null ? nf(row.avgKmPerShoe, 1) : '—'}</td>
                <td>{row.performanceHidden ? <span className="eqSmall" title="Menos de 3 alunas neste grupo: só a contagem é mostrada; corridas, km, pace e faixas ficam ocultos para não expor uma aluna.">só contagem</span> : row.pace ? row.pace.label : row.paceHidden ? <span className="eqSmall" title="Menos de 3 alunas com tempo e distância: o pace não é mostrado para não expor uma aluna.">amostra pequena</span> : '—'}</td>
              </tr>
              {openKey === row.key ? (
                <tr className="eqDetailRow"><td colSpan={9}>
                  <div className="eqBandsInline">
                    {row.performanceHidden ? <span className="eqSmall">Menos de 3 alunas neste grupo: as faixas de distância não são mostradas.</span> : null}
                    {row.bands.map((band) => <span key={band.key} className="eqBandPill"><b>{band.label}</b> {nf(band.count)} corr. · {nf(band.distanceKm, 1)} km</span>)}
                  </div>
                </td></tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ title, head, rows, barIndex }: { title: string; head: string[]; rows: Array<Array<React.ReactNode>>; barIndex?: { col: number; values: number[] } }) {
  if (rows.length === 0) return <p className="eqMuted">Sem dados nos filtros escolhidos.</p>;
  const max = barIndex ? Math.max(1, ...barIndex.values) : 1;
  return (
    <div className="eqTableWrap">
      <table className="eqTable">
        <caption>{title}</caption>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((cells, r) => <tr key={r}>{cells.map((cell, c) => <td key={c} className={barIndex && c === barIndex.col ? 'eqBarCell' : undefined}>{barIndex && c === barIndex.col ? <Bar value={barIndex.values[r]} max={max} /> : cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function EquipmentIntelligence({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [refreshMsg, setRefreshMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(async (current: Draft) => {
    setState('loading'); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/equipment/intelligence?${toQuery(current)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        let detail = 'Não foi possível carregar agora.';
        try { const body = (await response.json()) as { message?: string | string[] }; const text = Array.isArray(body.message) ? body.message.join(' ') : body.message; if (text) detail = text; } catch { /* mensagem padrão */ }
        setMessage(detail); setState('error'); return;
      }
      setResult((await response.json()) as Result); setState('ready');
    } catch {
      setMessage('Sem conexão com a API. Tente novamente.'); setState('error');
    }
  }, [accessToken, apiUrl]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`${apiUrl}/coach/equipment/options`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (response.ok && alive) setOptions((await response.json()) as Options);
      } catch { /* os filtros ficam sem opções; a análise segue funcionando */ }
    })();
    void run(draft);
    return () => { alive = false; };
  }, [accessToken, apiUrl]);

  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  const shortcut = (days: number | 'ano') => {
    const to = localToday();
    patch({ to, from: days === 'ano' ? `${to.slice(0, 4)}-01-01` : addDays(to, -(days - 1)) });
  };
  const clear = () => { const next = emptyDraft(); setDraft(next); void run(next); };

  async function refreshDevices() {
    setRefreshing(true); setRefreshMsg('');
    try {
      const response = await fetch(`${apiUrl}/coach/equipment/refresh-devices`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 403) { setRefreshMsg('Somente o administrador pode atualizar a base de dispositivos.'); return; }
      if (!response.ok) { setRefreshMsg('Não foi possível atualizar agora.'); return; }
      const body = (await response.json()) as { users: number; devices: number };
      setRefreshMsg(`Base atualizada: ${nf(body.devices)} dispositivo(s) de ${nf(body.users)} aluna(s).`);
      void run(draft);
    } catch {
      setRefreshMsg('Sem conexão com a API.');
    } finally {
      setRefreshing(false);
    }
  }

  const label = (list: Option[] | undefined, value: string) => list?.find((o) => o.value === value)?.label ?? value;
  const active: Array<{ key: string; text: string; remove: () => void }> = [];
  const addList = (group: string, values: string[], list: Option[] | undefined, set: (next: string[]) => void) =>
    values.forEach((v) => active.push({ key: `${group}:${v}`, text: `${group}: ${label(list, v)}`, remove: () => { set(values.filter((x) => x !== v)); } }));
  addList('Marca do relógio', draft.watchBrands, options?.watchBrands, (n) => patch({ watchBrands: n }));
  addList('Modelo do relógio', draft.watchModels, options?.watchModels, (n) => patch({ watchModels: n }));
  addList('Plataforma', draft.platforms, options?.platforms, (n) => patch({ platforms: n }));
  addList('Marca do tênis', draft.shoeBrands, options?.shoeBrands, (n) => patch({ shoeBrands: n }));
  addList('Modelo do tênis', draft.shoeModels, options?.shoeModels, (n) => patch({ shoeModels: n }));
  addList('Situação da aluna', draft.studentStatuses, options?.studentStatuses?.map((o) => ({ ...o, label: STATUS_LABEL[o.label] ?? o.label })), (n) => patch({ studentStatuses: n }));
  draft.bands.forEach((b) => active.push({ key: `band:${b}`, text: `Faixa: ${options?.bands.find((x) => x.value === b)?.label ?? b}`, remove: () => patch({ bands: draft.bands.filter((x) => x !== b) }) }));
  if (draft.shoeStatus !== 'all') active.push({ key: 'ss', text: `Tênis: ${draft.shoeStatus === 'active' ? 'em uso' : 'aposentado'}`, remove: () => patch({ shoeStatus: 'all' }) });
  if (draft.shoeKmMin || draft.shoeKmMax) active.push({ key: 'sk', text: `Km do tênis: ${draft.shoeKmMin || '0'} a ${draft.shoeKmMax || '∞'}`, remove: () => patch({ shoeKmMin: '', shoeKmMax: '' }) });
  if (draft.runnerKmMin || draft.runnerKmMax) active.push({ key: 'rk', text: `Volume da aluna: ${draft.runnerKmMin || '0'} a ${draft.runnerKmMax || '∞'} km`, remove: () => patch({ runnerKmMin: '', runnerKmMax: '' }) });

  const statusOptions = options?.studentStatuses.map((o) => ({ ...o, label: STATUS_LABEL[o.label] ?? o.label })) ?? [];
  const r = result;

  return (
    <section className="eqRoot">
      <div className="eqIntro">
        <strong>Equipamentos da base</strong>
        <p>Relógios e tênis das alunas, só em números agregados. Combine os filtros para investigar um grupo; o que aparece é descrição, não relação de causa entre o equipamento e o desempenho.</p>
      </div>

      <form className="eqFilters" onSubmit={(event) => { event.preventDefault(); void run(draft); }}>
        <div className="eqPeriod">
          <label>De<input type="date" value={draft.from} max={draft.to} onChange={(e) => patch({ from: e.target.value })} /></label>
          <label>Até<input type="date" value={draft.to} max={localToday()} onChange={(e) => patch({ to: e.target.value })} /></label>
          <div className="eqShortcuts" role="group" aria-label="Atalhos de período">
            {([[30, '30 dias'], [90, '90 dias'], [180, '180 dias'], ['ano', 'Este ano']] as Array<[number | 'ano', string]>).map(([value, text]) => <button key={text} type="button" onClick={() => shortcut(value)}>{text}</button>)}
          </div>
        </div>

        <div className="eqGrid">
          <ChipGroup label="Marca do relógio" options={options?.watchBrands ?? []} selected={draft.watchBrands} onChange={(n) => patch({ watchBrands: n })} />
          <ChipGroup label="Modelo do relógio" options={options?.watchModels ?? []} selected={draft.watchModels} onChange={(n) => patch({ watchModels: n })} />
          <ChipGroup label="Plataforma de integração" options={options?.platforms ?? []} selected={draft.platforms} onChange={(n) => patch({ platforms: n })} />
          <ChipGroup label="Marca do tênis" options={options?.shoeBrands ?? []} selected={draft.shoeBrands} onChange={(n) => patch({ shoeBrands: n })} />
          <ChipGroup label="Modelo do tênis" options={options?.shoeModels ?? []} selected={draft.shoeModels} onChange={(n) => patch({ shoeModels: n })} />
          <ChipGroup label="Situação da aluna" options={statusOptions} selected={draft.studentStatuses} onChange={(n) => patch({ studentStatuses: n })} />
        </div>

        <div className="eqGrid eqGridSmall">
          <div className="eqField">
            <span className="eqLabel">Situação do tênis</span>
            <div className="eqChips">
              {([['all', 'Todos'], ['active', 'Em uso'], ['retired', 'Aposentados']] as Array<[Draft['shoeStatus'], string]>).map(([value, text]) => (
                <button key={value} type="button" className={`eqChip${draft.shoeStatus === value ? ' on' : ''}`} aria-pressed={draft.shoeStatus === value} onClick={() => patch({ shoeStatus: value })}>{text}</button>
              ))}
            </div>
          </div>
          <div className="eqField">
            <span className="eqLabel">Km acumulado do tênis</span>
            <div className="eqRange"><input type="number" min={0} placeholder="mín." value={draft.shoeKmMin} onChange={(e) => patch({ shoeKmMin: e.target.value })} /><span>a</span><input type="number" min={0} placeholder="máx." value={draft.shoeKmMax} onChange={(e) => patch({ shoeKmMax: e.target.value })} /></div>
          </div>
          <div className="eqField">
            <span className="eqLabel">Volume de corrida da aluna no período (km)</span>
            <div className="eqRange"><input type="number" min={0} placeholder="mín." value={draft.runnerKmMin} onChange={(e) => patch({ runnerKmMin: e.target.value })} /><span>a</span><input type="number" min={0} placeholder="máx." value={draft.runnerKmMax} onChange={(e) => patch({ runnerKmMax: e.target.value })} /></div>
            <small className="eqMuted">Conta só corridas vindas de relógio/aplicativo; aluna sem esse dado fica de fora quando o filtro é usado.</small>
          </div>
          <ChipGroup label="Faixas de distância das corridas" options={(options?.bands ?? []).map((b) => ({ value: b.value, label: b.label, students: 0 }))} selected={draft.bands} onChange={(n) => patch({ bands: n })} showCount={false} />
        </div>

        <div className="eqActions">
          <button type="submit" className="primaryButton" disabled={state === 'loading'}>{state === 'loading' ? 'Carregando...' : 'Aplicar filtros'}</button>
          <button type="button" className="secondaryButton" onClick={clear}>Limpar filtros</button>
          <button type="button" className="secondaryButton" onClick={refreshDevices} disabled={refreshing} title="Reconstrói a lista de dispositivos a partir das atividades recebidas (somente administrador).">{refreshing ? 'Atualizando...' : 'Atualizar base de dispositivos'}</button>
          {refreshMsg ? <small className="eqMuted" role="status">{refreshMsg}</small> : null}
        </div>
        {active.length > 0 ? (
          <div className="eqActive" aria-label="Filtros ativos">
            {active.map((chip) => <button key={chip.key} type="button" className="eqActiveChip" onClick={chip.remove} title="Remover (clique em Aplicar filtros)">{chip.text} ×</button>)}
          </div>
        ) : null}
      </form>

      {state === 'error' ? <p className="eqError" role="alert">{message}</p> : null}
      {state === 'loading' && !r ? <p className="eqMuted">Carregando...</p> : null}

      {r ? (
        <div className={`eqResults${state === 'loading' ? ' eqBusy' : ''}`}>
          <p className="eqMuted">Período: {dmy(r.period.from)} a {dmy(r.period.to)} · atualizado em {new Date(r.generatedAt).toLocaleString('pt-BR')}</p>
          <div className="eqCards">
            <article><small>Alunas nos filtros</small><strong>{nf(r.population.studentsIncluded)}</strong><em>de {nf(r.population.studentsEligible)} na situação escolhida</em></article>
            <article><small>Com relógio/dispositivo</small><strong>{nf(r.population.studentsWithDevice)}</strong></article>
            <article><small>Com tênis cadastrado</small><strong>{nf(r.population.studentsWithShoe)}</strong></article>
            <article><small>Enviando dados no período</small><strong>{nf(r.population.studentsSendingData)}</strong><em>ao menos uma atividade recebida</em></article>
          </div>

          {r.population.studentsIncluded === 0 ? <p className="eqEmpty">Nenhuma aluna atende a todos os filtros ao mesmo tempo. Afrouxe algum filtro.</p> : null}
          {r.shoes.performanceHidden ? <p className="eqSmall" role="status">Menos de 3 alunas neste resultado: as contagens são exatas, mas corridas, km, pace e faixas de distância ficam ocultos para não expor uma aluna.</p> : null}

          <h3 className="eqH">Relógios e dispositivos</h3>
          <div className="eqCols">
            <SimpleTable title="Por fabricante" head={['Fabricante', 'Alunas', '', 'Dispositivos', 'Atividades']}
              rows={r.devices.byManufacturer.map((m) => [m.label, nf(m.students), '', nf(m.devices), nf(m.activities)])} barIndex={{ col: 2, values: r.devices.byManufacturer.map((m) => m.students) }} />
            <SimpleTable title="Por plataforma de integração" head={['Plataforma', 'Alunas', '', 'Enviando dados no período', 'Atividades']}
              rows={r.devices.byPlatform.map((p) => [p.label, nf(p.students), '', `${nf(p.studentsSendingData)} de ${nf(p.students)}`, nf(p.activities)])} barIndex={{ col: 2, values: r.devices.byPlatform.map((p) => p.students) }} />
          </div>
          <SimpleTable title="Por modelo" head={['Fabricante', 'Modelo', 'Alunas', '', 'Atividades']}
            rows={r.devices.byModel.map((m) => [m.manufacturer, m.label, nf(m.students), '', nf(m.activities)])} barIndex={{ col: 3, values: r.devices.byModel.map((m) => m.students) }} />
          <p className="eqSmall">Alunas sem relógio/dispositivo registrado nos filtros: <b>{nf(r.devices.studentsWithoutDevice)}</b>. Fabricante só aparece quando a fonte informou ou a plataforma atende uma única marca; caso contrário fica "Não identificado".</p>

          <h3 className="eqH">Tênis</h3>
          <div className="eqCards">
            <article><small>Tênis</small><strong>{nf(r.shoes.totals.shoes)}</strong></article>
            <article><small>Em uso</small><strong>{nf(r.shoes.totals.active)}</strong></article>
            <article><small>Aposentados</small><strong>{nf(r.shoes.totals.retired)}</strong></article>
            <article><small>Alunas sem tênis</small><strong>{nf(r.shoes.totals.studentsWithoutShoe)}</strong></article>
          </div>
          <ShoeTable title="Por marca (toque na linha para ver as faixas de distância)" rows={r.shoes.byBrand} />
          <ShoeTable title="Por modelo (toque na linha para ver as faixas de distância)" rows={r.shoes.byModel} showBrand />
          <div className="eqCols">
            <SimpleTable title="Quilometragem acumulada dos tênis" head={['Faixa', 'Tênis', '']} rows={r.shoes.kmDistribution.map((b) => [b.label, nf(b.shoes), ''])} barIndex={{ col: 2, values: r.shoes.kmDistribution.map((b) => b.shoes) }} />
            <SimpleTable title="Corridas por faixa de distância (todos os tênis filtrados)" head={['Faixa', 'Corridas', '', 'Km']} rows={r.shoes.distanceBands.map((b) => [b.label, nf(b.runs), '', nf(b.km, 1)])} barIndex={{ col: 2, values: r.shoes.distanceBands.map((b) => b.runs) }} />
          </div>

          <aside className="eqNotes" aria-label="Notas metodológicas">
            <strong>Como ler</strong>
            <ul>{r.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
