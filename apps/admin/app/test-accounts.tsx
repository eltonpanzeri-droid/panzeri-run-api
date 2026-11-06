'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// Cadastros de teste (05/11/2026): contas criadas para a Apple e o Google testarem o Panzeri Run e outros cadastros de teste. Ficam FORA de todas as contas, contagens e listas de alunas.
type Row = { id: string; studentCode: number | null; name: string | null; email: string; subscriptionStatus: string; paymentGroup: string; accountStatus: string; createdAt: string; kind: 'review_apple' | 'review_google' | 'other' };
const KIND_LABEL: Record<Row['kind'], string> = { review_apple: 'Conta de revisão da Apple', review_google: 'Conta de revisão do Google', other: 'Cadastro de teste' };
const GROUP_LABEL: Record<string, string> = { confirmed: 'Confirmado', courtesy: 'Cortesia', overdue: 'Atrasado', pending: 'Pendente', canceled: 'Cancelado', desconhecido: 'Desconhecido' };
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default function TestAccounts({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [newId, setNewId] = useState('');

  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const load = useCallback(async () => {
    setState('loading'); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/test-accounts`, { headers });
      if (!response.ok) throw new Error('Não foi possível carregar agora.');
      setRows(((await response.json()) as { rows: Row[] }).rows); setState('ready');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sem conexão com a API.'); setState('error'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, apiUrl]);
  useEffect(() => { void load(); }, [load]);

  const mark = async (id: string, isTestAccount: boolean) => {
    setBusy(id); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/test-accounts/${encodeURIComponent(id)}`, { method: 'POST', headers, body: JSON.stringify({ isTestAccount }) });
      if (!response.ok) throw new Error('Não foi possível salvar.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar.'); } finally { setBusy(''); }
  };

  return (
    <section className="eqRoot">
      <header className="eqTop">
        <div className="eqTitle"><h2>Alunas de teste</h2><p>Contas criadas para a Apple e o Google testarem o Panzeri Run e outros cadastros de teste. Não entram em nenhuma conta, contagem ou lista de alunas.</p></div>
        <button type="button" className="eqBtn ghost" onClick={() => void load()} disabled={state === 'loading'}><RefreshCw size={14} aria-hidden="true" /> {state === 'loading' ? 'Atualizando...' : 'Atualizar'}</button>
      </header>
      {message ? <p role="alert">{message}</p> : null}
      <div className="extTableWrap">
        <table className="dataTable">
          <thead><tr><th>Código</th><th>Nome</th><th>E-mail</th><th>Tipo</th><th>Assinatura</th><th>Criada em</th><th /></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.studentCode != null ? String(row.studentCode).padStart(7, '0') : '—'}</td>
                <td>{row.name ?? 'Sem nome'}</td>
                <td>{row.email}</td>
                <td>{KIND_LABEL[row.kind]}</td>
                <td>{GROUP_LABEL[row.paymentGroup] ?? row.subscriptionStatus}</td>
                <td>{dmy(row.createdAt)}</td>
                <td><button type="button" className="eqBtn ghost" disabled={busy === row.id} onClick={() => void mark(row.id, false)} title="Volta a contar como aluna">Desmarcar como teste</button></td>
              </tr>
            ))}
            {rows.length === 0 && state === 'ready' ? <tr><td colSpan={7}>Nenhum cadastro de teste.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="eqChips">
        <input type="text" placeholder="Marcar outro cadastro como teste: cole o id da aluna" value={newId} onChange={(e) => setNewId(e.target.value)} aria-label="Id do cadastro a marcar como teste" />
        <button type="button" className="eqBtn ghost" disabled={!newId.trim() || busy !== ''} onClick={() => { void mark(newId.trim(), true).then(() => setNewId('')); }}>Marcar como teste</button>
      </div>
      <p className="eqFine">O id fica na barra de endereço da página da aluna. Marcar como teste tira a pessoa de todas as contas e listas; desmarcar a traz de volta.</p>
    </section>
  );
}
