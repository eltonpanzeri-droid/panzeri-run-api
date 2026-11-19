'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Ferramentas > "Avisos enviados" (19/11/2026, Lote 5 das notificacoes): o que os avisos proativos (biblioteca educativa, relatorio semanal) enviaram e o que as preferencias das alunas barraram. So' leitura.
interface Total { category: string; status: string; reason: string | null; count: number }
interface Row { at: string; category: string; ruleId: string; status: string; reason: string | null; studentName: string | null; studentCode: string | null }
interface Summary { enabled: boolean; days: number; totals: Total[]; recent: Row[] }

const CATEGORY_LABEL: Record<string, string> = {
  novidades: 'Novidades do Panzeri Run', instrucoes: 'Instruções de uso', relatorios: 'Relatórios', saude: 'Dicas de saúde', educacao_treino: 'Educação para o treino', mundo_corrida: 'Mundo das corridas e treinos',
};
const REASON_LABEL: Record<string, string> = {
  category_off: 'tema desligado pela aluna', outside_window: 'fora do horário', daily_cap: 'teto do dia', category_cap: 'faixa do tema', duplicate: 'já enviado', unknown_category: 'tema desconhecido', error: 'erro',
};

export default function NotificationsLog({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`${apiUrl}/coach/notifications/summary?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('status');
      setData((await response.json()) as Summary);
    } catch {
      setError('Não consegui carregar os avisos agora.');
    }
  }, [apiUrl, token, days]);
  useEffect(() => { void load(); }, [load]);

  const sent = (data?.totals ?? []).filter((total) => total.status === 'sent').reduce((sum, total) => sum + total.count, 0);
  const blocked = (data?.totals ?? []).filter((total) => total.status !== 'sent').reduce((sum, total) => sum + total.count, 0);

  return (
    <section className="miniSection">
      <div className="weekWorkspaceHeader">
        <div><p className="eyebrow">Ferramentas</p><h3>Avisos enviados</h3></div>
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          {[1, 7, 30].map((value) => <option key={value} value={value}>{value === 1 ? 'Últimas 24 h' : `Últimos ${value} dias`}</option>)}
        </select>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      {data ? (
        <>
          <p className="muted">{data.enabled ? 'Envio automático LIGADO.' : 'Envio automático DESLIGADO (variável PROACTIVE_NOTIFICATIONS_ENABLED).'} Enviados: {sent}. Barrados pelas preferências das alunas: {blocked}.</p>
          <table className="routineTable">
            <thead><tr><th>Tema</th><th>Situação</th><th>Motivo</th><th>Quantidade</th></tr></thead>
            <tbody>
              {data.totals.map((total, index) => (
                <tr key={index}><td>{CATEGORY_LABEL[total.category] ?? total.category}</td><td>{total.status === 'sent' ? 'Enviado' : 'Barrado'}</td><td>{total.reason ? (REASON_LABEL[total.reason] ?? total.reason) : '—'}</td><td>{total.count}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="eyebrow" style={{ marginTop: 12 }}>Últimos registros</p>
          <table className="routineTable">
            <thead><tr><th>Quando</th><th>Aluna</th><th>Tema</th><th>Situação</th></tr></thead>
            <tbody>
              {data.recent.map((row, index) => (
                <tr key={index}><td>{new Date(row.at).toLocaleString('pt-BR')}</td><td>{row.studentCode ? `${row.studentCode} · ` : ''}{row.studentName ?? '—'}</td><td>{CATEGORY_LABEL[row.category] ?? row.category}</td><td>{row.status === 'sent' ? 'Enviado' : `Barrado${row.reason ? ` (${REASON_LABEL[row.reason] ?? row.reason})` : ''}`}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
