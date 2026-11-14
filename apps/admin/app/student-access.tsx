'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';

// "Como as alunas acessam" (05/11/2026). Lista nominal e SOMENTE LEITURA: GET /coach/equipment/student-access. O servidor não guarda a plataforma do aparelho; a classificação
// "provavelmente só navegador" é estimativa (sem notificação registrada e sem Health Connect nem Apple Saúde conectados). Nada aqui altera dado de aluna.

type Kind = 'android' | 'ios' | 'native_unknown' | 'browser_probable';
type PaysVia = 'store' | 'asaas' | 'manual';
type Row = {
  paysVia: PaysVia; asaasLeftover: string | null;
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
type Situation = 'current' | 'canceled' | 'all';
const SITUATIONS: Array<{ key: Situation; label: string }> = [{ key: 'current', label: 'Alunas atuais' }, { key: 'canceled', label: 'Ex-alunas' }, { key: 'all', label: 'Todas' }];
const inSituation = (row: Row, situation: Situation) => situation === 'all' || (situation === 'current' ? ['confirmed', 'courtesy', 'overdue'].includes(row.paymentGroup) : row.paymentGroup === situation);
const PAYS_LABEL: Record<PaysVia, string> = { store: 'Loja (Apple/Google)', asaas: 'Asaas (cartão)', manual: 'Cortesia/manual' };
const PAYS_FILTERS: Array<{ key: 'all' | PaysVia | 'duplicate'; label: string }> = [{ key: 'all', label: 'Todas as formas' }, { key: 'store', label: 'Paga pela loja' }, { key: 'asaas', label: 'Paga pelo Asaas' }, { key: 'manual', label: 'Cortesia/manual' }, { key: 'duplicate', label: 'Loja + Asaas gravado (conferir)' }];
const providerName = (id: string) => PROVIDER_LABEL[id] ?? id;
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const stripAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type InvitePreview = { toSend: number; alreadySent: number; subject: string; sample: string; notes: string[] };

// Convite para baixar o Panzeri Run nas lojas (08/11/2026): previa -> teste so' para o seu e-mail -> envio real com a contagem confirmada. Cada aluna recebe uma vez.
function NativeInviteCard({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const loadPreview = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/coach/equipment/native-invite`, { headers });
      if (!response.ok) throw new Error('Não foi possível carregar a prévia.');
      setPreview((await response.json()) as InvitePreview);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sem conexão com a API.'); }
    setBusy(false);
  }, [accessToken, apiUrl]);
  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const sendTest = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/equipment/native-invite/test`, { method: 'POST', headers });
      const data = await response.json().catch(() => ({}));
      setMessage(response.ok ? `Teste enviado para ${data.sentTo}. Confira a caixa de entrada e o spam.` : (data.message ?? 'O teste não saiu.'));
    } catch { setMessage('Sem conexão com a API.'); }
    setBusy(false);
  };

  const sendAll = async () => {
    if (!preview || preview.toSend === 0) return;
    if (!window.confirm(`Enviar o convite por e-mail e aviso no sino para ${preview.toSend} alunas? Cada uma recebe uma vez e não dá para desfazer.`)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/equipment/native-invite/send`, { method: 'POST', headers, body: JSON.stringify({ expectedCount: preview.toSend }) });
      const data = await response.json().catch(() => ({}));
      setMessage(response.ok ? `Enviado para ${data.sent} alunas.${data.failed?.length ? ` Falharam ${data.failed.length}: ${data.failed.map((f: { name: string | null }) => f.name ?? 'sem nome').join(', ')}.` : ''}` : (data.message ?? 'O envio não foi feito.'));
    } catch { setMessage('Sem conexão com a API. Atualize a prévia antes de tentar de novo.'); }
    await loadPreview();
  };

  return (
    <div className="eqCard" style={{ marginBottom: 16 }}>
      <h3>Convite para baixar o Panzeri Run na loja</h3>
      <p className="eqFine">Envia e-mail e aviso no sino para alunas atuais que parecem usar só o navegador (estimativa). Primeiro mande um teste para o seu e-mail.</p>
      {preview ? <p><strong>{preview.toSend}</strong> a receber{preview.alreadySent ? ` · ${preview.alreadySent} já receberam` : ''}</p> : <p>Carregando...</p>}
      <div className="eqChips">
        <button type="button" className="eqBtn ghost" onClick={() => setShowSample((v) => !v)}>{showSample ? 'Esconder texto' : 'Ver o texto do e-mail'}</button>
        <button type="button" className="eqBtn ghost" onClick={() => void sendTest()} disabled={busy}>Enviar teste para mim</button>
        <button type="button" className="eqBtn" onClick={() => void sendAll()} disabled={busy || !preview || preview.toSend === 0}>Enviar para {preview?.toSend ?? 0} alunas</button>
      </div>
      {showSample && preview ? <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.subject + '\n\n' + preview.sample}</pre> : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

export default function StudentAccess({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [situation, setSituation] = useState<Situation>('current');
  const [search, setSearch] = useState('');
  const [pays, setPays] = useState<'all' | PaysVia | 'duplicate'>('all');
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
    return (result?.rows ?? []).filter((row) => inSituation(row, situation) && (pays === 'all' || (pays === 'duplicate' ? row.asaasLeftover != null : row.paysVia === pays)) && (filter === 'all' || row.access === filter) && (!term || stripAccents(`${row.name ?? ''} ${row.studentCode ?? ''}`).includes(term)));
  }, [result, filter, search, situation, pays]);

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
      <NativeInviteCard accessToken={accessToken} apiUrl={apiUrl} />
      {result ? (
        <>
          <div className="eqChips" style={{ alignItems: 'flex-end', gap: 12 }}>
            <label className="eqFine">Situação
              <select value={situation} onChange={(e) => setSituation(e.target.value as Situation)} style={{ display: 'block' }}>
                {SITUATIONS.map((item) => <option key={item.key} value={item.key}>{item.label} ({(result?.rows ?? []).filter((row) => inSituation(row, item.key)).length})</option>)}
              </select>
            </label>
            <label className="eqFine">Paga por
              <select value={pays} onChange={(e) => setPays(e.target.value as typeof pays)} style={{ display: 'block' }}>
                {PAYS_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label} ({scoped.filter((row) => (item.key === 'all' ? true : item.key === 'duplicate' ? row.asaasLeftover != null : row.paysVia === item.key)).length})</option>)}
              </select>
            </label>
            <label className="eqFine">Acesso
              <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | Kind)} style={{ display: 'block' }}>
                {FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label} ({countOf(item.key)})</option>)}
              </select>
            </label>
          </div>
          <div className="eqChips">
            <input type="search" placeholder="Buscar por nome ou código" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar aluna" />
            <button type="button" className="eqBtn ghost" onClick={() => void copyNames()} disabled={rows.length === 0}><Copy size={14} aria-hidden="true" /> Copiar lista</button>
            {copied ? <small className="eqMuted" role="status">{copied}</small> : null}
          </div>
          <div className="extTableWrap">
            <table className="dataTable">
              <thead><tr><th>Código</th><th>Aluna</th><th>Assinatura</th><th>Paga por</th><th>Acesso (estimado)</th><th>Push</th><th>Conexões e atividades recebidas</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.studentCode != null ? String(row.studentCode).padStart(7, '0') : '—'}</td>
                    <td>{row.name ?? 'Sem nome'}</td>
                    <td>{STATUS_LABEL[row.subscriptionStatus] ?? row.subscriptionStatus}</td>
                    <td>{PAYS_LABEL[row.paysVia]}{row.asaasLeftover ? <div><small>Asaas gravado ({row.asaasLeftover}): conferir no Asaas</small></div> : null}</td>
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
                {rows.length === 0 ? <tr><td colSpan={7}>Nenhuma aluna neste filtro.</td></tr> : null}
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
