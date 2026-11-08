'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Aluno > Integrações > "O que a Garmin trouxe" (08/11/2026). Só LEITURA: GET /coach/students/:id/garmin-measures. Mostra se a conta Garmin está conectada, quais grupos a aluna autorizou e, por tipo,
// quantas medidas já chegaram, a data da última e um texto curto do último valor. Não interpreta nem julga nenhum valor; nada aqui conecta, desconecta ou concede autorização.
interface Row { id: string; label: string; count: number; lastAt: string | null; lastCalendarDate: string | null; text: string | null }
interface Result { connected: boolean; grantedCategories: string[]; grantedPurposes: string[]; measures: Row[] }

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

export default function GarminMeasures({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/garmin-measures`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('falhou');
      setData((await response.json()) as Result);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [apiUrl, studentId, accessToken]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading' && !data) return <section className="integrationsWrap"><p>Carregando a Garmin...</p></section>;
  if (state === 'error' || !data) return <section className="integrationsWrap"><p role="alert">Não foi possível carregar os dados da Garmin agora.</p></section>;
  const received = data.measures.filter((row) => row.count > 0);
  const waiting = data.measures.filter((row) => row.count === 0);
  return (
    <section className="integrationsWrap" aria-label="O que a Garmin trouxe">
      <header className="integrationsHeader"><div><h3>Garmin: o que já chegou</h3><p>{data.connected ? 'Conta Garmin conectada.' : 'Conta Garmin não conectada (ou desconectada).'} Somente leitura.</p></div></header>
      {data.connected && data.grantedPurposes.length > 0 ? <p className="eqFine">Autorizações opcionais ativas: {data.grantedPurposes.map((id) => (id === 'watch_delivery' ? 'envio de treinos ao relógio' : id === 'ai_external' ? 'análise com o Atlas' : id)).join(', ')}.</p> : null}
      {received.length === 0 ? <p>Nenhum dado da Garmin recebido ainda.</p> : (
        <div className="extTableWrap">
          <table className="dataTable">
            <thead><tr><th>Tipo</th><th>Medidas recebidas</th><th>Última</th><th>Último valor</th></tr></thead>
            <tbody>{received.map((row) => (
              <tr key={row.id}><td>{row.label}</td><td>{row.count}</td><td>{dmy(row.lastCalendarDate ?? row.lastAt)}</td><td>{row.text ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {waiting.length > 0 ? <p className="eqFine">Sem dados ainda: {waiting.map((row) => row.label).join('; ')}. Pode ser que a aluna não tenha autorizado o grupo ou que o relógio não meça.</p> : null}
      <p className="integrationsFooter"><button type="button" onClick={() => void load()}>Atualizar</button></p>
    </section>
  );
}
