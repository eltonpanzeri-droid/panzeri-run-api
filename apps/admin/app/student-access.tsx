'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';

// "Como as alunas acessam" (05/11/2026). Lista nominal e SOMENTE LEITURA: GET /coach/equipment/student-access. O servidor não guarda a plataforma do aparelho; a classificação
// "provavelmente só navegador" é estimativa (sem notificação registrada e sem Health Connect nem Apple Saúde conectados). Nada aqui altera dado de aluna.

type Kind = 'android' | 'ios' | 'native_unknown' | 'browser_probable';
type Row = {
  id: string; studentCode: number | null; name: string | null; subscriptionStatus: string; paymentGroup: 'confirmed' | 'courtesy' | 'overdue' | 'pending' | 'canceled' | 'desconhecido'; accountStatus: string; push: boolean; access: Kind;
  connections: Array<{ provider: string; lastSyncAt: string | null }>;
  activities: Array<{ provider: string; count: number; lastAt: string | null }>;
};
type Result = { generatedAt: string; total: number; counts: Record<Kind, number>; rows: Row[]; notes: string[] };

const KIND_LABEL: Record<Kind, string> = { browser_probable: 'Provavelmente só navegador', android: 'Android (Health Connect)', ios: 'iPhone (Apple Saúde)', native_unknown: 'Panzeri Run instalado, sem conexão de saúde' };
const PROVIDER_LABEL: Record<string, string> = { health_connect: 'Health Connect', apple_health: 'Apple Saúde', polar: 'Polar', zepp: 'Zepp', coros: 'COROS', wahoo: 'Wahoo', strava: 'Strava' };
const STATUS_LABEL: Record<string, string> = { active: 'Ativa', pending: 'Pendente', canceled: 'Cancelada', cancelled: 'Cancelada', expired: 'Expirada', past_due: 'Em atraso', overdue: 'Em atraso', manual_active: 'Cortesia', grace: 'Em carência' };
const FILTERS: Array<{ key: 'all' | Kind; label: string }> = [
  { key: 'all', label: 'Todas' }, { key: 'browser_probable', label: 'Só navegador (estimado)' }, { key: 'android', label: 'Android' }, { key: 'ios', label: 'iPhone' }, { key: 'native_unknown', label: 'Instalado, sem conexão' },
];
// Mesma definição do painel: aluna atual = confirmado, cortesia ou atrasado; pendente = prospecto (nunca pagou); cancelado = ex-aluna.
type Situation = 'current' | 'pending' | 'canceled' | 'all';
const SITUATIONS: Array<{ key: Situation; label: string }> = [{ key: 'current', label: 'Alunas atuais' }, { key: 'pending', label: 'Prospectos' }, { key: 'canceled', label: 'Ex-alunas' }, { key: 'all', label: 'Todas' }];
const inSituation = (row: Row, situation: Situation) => situation === 'all' || (situation === 'current' ? ['confirmed', 'courtesy', 'overdue'].includes(row.paymentGroup) : row.paymentGroup === situation);
const providerName = (id: string) => PROVIDER_LABEL[id] ?? id;
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const stripAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function StudentAccess({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'all' | Kind>('browser_probable');
  const [situation, setSituation] = useState<Situation>('current');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    setState('loading'); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/equipment/student-access`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('Não foi possível carregar agora.');
      setResult((await response.json()) as Result); setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sem conexão com a API. Tente novamente.'); setState('error');
    }
  }, [accessToken, apiUrl]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const term = stripAccents(search.trim());
    return (result?.rows ?? []).filter((row) => inSituation(row, situation) && (filter === 'all' || row.access === filter) && (!term || stripAccents(`${row.name ?? ''} ${row.studentCode ?? ''}`).includes(term)));
  }, [result, filter, search, situation]);

  // Contagens recalculadas sobre a situação escolhida (alunas atuais por padrão), para os números dos filtros baterem com a lista.
  const scoped = useMemo(() => (result?.rows ?? []).filter((row) => inSituation(row, situation)), [result, situation]);
  const countOf = (key: 'all' | Kind) => (key === 'all' ? scoped.length : scoped.filter((row) => row.access === key).length);

  const copyNames = async () => {
    const text = rows.map((r) => `${r.studentCode != null ? String(r.studentCode).padStart(7, '0') : '—'}\t${r.name ?? 'Sem nome'}`).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(`${rows.length} nomes copiados.`); } catch { setCopied('Não foi possível copiar; selecione a tabela e copie.'); }
    setTimeout(() => setCopied(''), 4000);
  };

  return (
    <section className="eqRoot">
      <header className="eqTop">
        <div className="eqTitle"><h2>Como as alunas acessam</h2><p>Lista nominal, somente leitura. O servidor não guarda a plataforma do aparelho: &quot;só navegador&quot; é estimativa.</p></div>
        <button type="button" className="eqBtn ghost" onClick={() => void load()} disabled={state === 'loading'}><RefreshCw size={14} aria-hidden="true" /> {state === 'loading' ? 'Atualizando...' : 'Atualizar'}</button>
      </header>

      {state === 'error' ? <p role="alert">{message}</p> : null}
      {result ? (
        <>
          <div className="eqChips" role="group" aria-label="Filtrar por situação da assinatura">
            {SITUATIONS.map((item) => (
              <button key={item.key} type="button" className={`eqChip${situation === item.key ? ' on' : ''}`} aria-pressed={situation === item.key} onClick={() => setSituation(item.key)}>
                {item.label} ({(result?.rows ?? []).filter((row) => inSituation(row, item.key)).length})
              </button>
            ))}
          </div>
          <div className="eqChips" role="group" aria-label="Filtrar por forma de acesso">
            {FILTERS.map((item) => (
              <button key={item.key} type="button" className={`eqChip${filter === item.key ? ' on' : ''}`} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
                {item.label} ({countOf(item.key)})
              </button>
            ))}
          </div>
          <div className="eqChips">
            <input type="search" placeholder="Buscar por nome ou código" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar aluna" />
            <button type="button" className="eqBtn ghost" onClick={() => void copyNames()} disabled={rows.length === 0}><Copy size={14} aria-hidden="true" /> Copiar lista</button>
            {copied ? <small className="eqMuted" role="status">{copied}</small> : null}
          </div>
          <div className="extTableWrap">
            <table className="dataTable">
              <thead><tr><th>Código</th><th>Aluna</th><th>Assinatura</th><th>Acesso (estimado)</th><th>Push</th><th>Conexões e atividades recebidas</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.studentCode != null ? String(row.studentCode).padStart(7, '0') : '—'}</td>
                    <td>{row.name ?? 'Sem nome'}</td>
                    <td>{STATUS_LABEL[row.subscriptionStatus] ?? row.subscriptionStatus}</td>
                    <td>{KIND_LABEL[row.access]}</td>
                    <td>{row.push ? 'Sim' : 'Não'}</td>
                    <td>
                      {row.connections.length === 0 ? '—' : row.connections.map((c) => {
                        const got = row.activities.find((a) => a.provider === c.provider);
                        return <div key={c.provider}>{providerName(c.provider)}: {got ? `${got.count} atividade(s), última em ${dmy(got.lastAt)}` : 'nenhuma atividade recebida'}</div>;
                      })}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={6}>Nenhuma aluna neste filtro.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {result.notes.map((note) => <p key={note} className="eqFine">{note}</p>)}
          <p className="eqFine">Atualizado em {new Date(result.generatedAt).toLocaleString('pt-BR')}.</p>
        </>
      ) : state === 'loading' ? <p>Carregando...</p> : null}
    </section>
  );
}
