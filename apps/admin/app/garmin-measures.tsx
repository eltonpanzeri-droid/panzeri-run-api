'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Link2, Unlink } from 'lucide-react';

// Aluno > Integrações > cartão da Garmin (08/11/2026; padronizado em 16/11/2026 com o molde dos demais cartões: logo, nome, selo de estado, resumo e "Ver detalhes"). Só LEITURA:
// GET /coach/students/:id/garmin-measures. Mostra se a conta Garmin está conectada, quais grupos a aluna autorizou e, por tipo, quantas medidas já chegaram, a data da última e um texto curto
// do último valor. Não interpreta nem julga nenhum valor; nada aqui conecta, desconecta ou concede autorização.
interface Row { id: string; label: string; count: number; lastAt: string | null; lastCalendarDate: string | null; text: string | null }
interface Result { connected: boolean; grantedCategories: string[]; grantedPurposes: string[]; measures: Row[] }

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

function Shell({ tone, label, children }: { tone: 'ok' | 'neutral' | 'warn'; label: string; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? Link2 : Unlink;
  return (
    <article className={`integrationCard ${tone === 'ok' ? 'live' : ''} tone-${tone}`}>
      <header>
        <span className="integrationLogo" style={{ background: '#007cc3' }} aria-hidden="true">G</span>
        <div className="integrationTitle">
          <h3>Garmin</h3>
          <span className={`integrationBadge ${tone}`}><Icon size={13} />{label}</span>
        </div>
      </header>
      {children}
    </article>
  );
}

export default function GarminMeasures({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState(false);

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

  if (state === 'loading' && !data) return <Shell tone="neutral" label="Carregando"><p className="integrationQuiet">Carregando a Garmin...</p></Shell>;
  if (state === 'error' || !data) return <Shell tone="warn" label="Sem leitura"><p className="integrationAlert bad" role="alert"><span>Não foi possível carregar os dados da Garmin agora.</span></p></Shell>;

  const received = data.measures.filter((row) => row.count > 0);
  const waiting = data.measures.filter((row) => row.count === 0);
  if (!data.connected && received.length === 0) {
    return <Shell tone="neutral" label="Nunca conectou"><p className="integrationQuiet">Esta aluna ainda não usa esta integração.</p></Shell>;
  }
  const lastDate = received.map((row) => row.lastCalendarDate ?? row.lastAt).filter((v): v is string => Boolean(v)).sort().pop() ?? null;
  const purposes = data.grantedPurposes.map((id) => (id === 'watch_delivery' ? 'envio de treinos ao relógio' : id === 'ai_external' ? 'análise com o Atlas' : id));
  return (
    <Shell tone={data.connected ? 'ok' : 'neutral'} label={data.connected ? 'Conectada' : 'Desconectada'}>
      <div className="integrationSummary">
        <div><small>Último dado recebido</small><strong>{dmy(lastDate)}</strong><em>{received.length === 0 ? 'nenhum dado recebido ainda' : 'data do dado mais recente'}</em></div>
        <div><small>Dados recebidos</small><strong>{received.length} de {data.measures.length}</strong><em>tipos de medida</em></div>
      </div>
      <button type="button" className="integrationToggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Ocultar detalhes' : 'Ver detalhes'} <ChevronDown size={15} className={open ? 'flip' : ''} />
      </button>
      {open ? (
        <div className="integrationDetails">
          {data.connected && purposes.length > 0 ? <p className="integrationQuiet">Autorizações opcionais ativas: {purposes.join(', ')}.</p> : null}
          {received.length === 0 ? <p className="integrationQuiet">Nenhum dado da Garmin recebido ainda.</p> : (
            <div className="extTableWrap">
              <table className="dataTable">
                <thead><tr><th>Tipo</th><th>Medidas recebidas</th><th>Última</th><th>Último valor</th></tr></thead>
                <tbody>{received.map((row) => (
                  <tr key={row.id}><td>{row.label}</td><td>{row.count}</td><td>{dmy(row.lastCalendarDate ?? row.lastAt)}</td><td>{row.text ?? '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {waiting.length > 0 ? <p className="integrationQuiet">Sem dados ainda: {waiting.map((row) => row.label).join('; ')}. Pode ser que a aluna não tenha autorizado o grupo ou que o relógio não meça.</p> : null}
          <p className="integrationFooter"><button type="button" onClick={() => void load()}>Atualizar</button></p>
        </div>
      ) : null}
    </Shell>
  );
}
