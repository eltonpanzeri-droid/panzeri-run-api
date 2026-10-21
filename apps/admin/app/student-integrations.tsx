'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Aluno > Integracoes (21/10/2026). So' LEITURA: GET /coach/students/:id/integrations. Mostra o estado REAL de cada integracao (conta conectada x dado de fato recebido), as categorias
// autorizadas pela aluna, a ultima sincronizacao, falhas em linguagem compreensivel e a autorizacao do Atlas (separada da importacao). Nada aqui conecta, desconecta ou concede
// consentimento; nenhum token ou segredo chega a este componente.

type State = 'connected' | 'disconnected' | 'expired' | 'error' | 'not_connected' | 'data_only';
interface Category { id: string; label: string; direction: 'recebe' | 'envia'; authorized: boolean | null; lastAt: string | null; count: number | null; note?: string }
interface Failure { at: string; message: string; count: number; status: 'retrying' | 'gave_up' }
interface Atlas { applies: boolean; authorized: boolean | null; needsNewAuthorization: boolean; since: string | null; systemEnabled: boolean | null; note: string }
interface Integration {
  provider: string; name: string; state: State; stateLabel: string; connectedSince: string | null; disconnectedAt: string | null;
  lastSyncAt: string | null; lastSyncBasis: 'sincronizacao_concluida' | 'ultimo_evento_processado' | 'ultimo_dado_recebido' | null;
  categories: Category[]; atlas: Atlas; failures: Failure[]; warnings: string[];
}
interface Result { studentId: string; generatedAt: string; integrations: Integration[] }

const BASIS_LABEL: Record<NonNullable<Integration['lastSyncBasis']>, string> = {
  sincronizacao_concluida: 'sincronização concluída',
  ultimo_evento_processado: 'último evento processado',
  ultimo_dado_recebido: 'último dado recebido',
};
const STATE_CLASS: Record<State, string> = { connected: 'ok', disconnected: 'neutral', expired: 'warn', error: 'bad', not_connected: 'neutral', data_only: 'warn' };

function when(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function authorizedLabel(value: boolean | null): { text: string; cls: string } {
  if (value === true) return { text: 'Autorizada', cls: 'ok' };
  if (value === false) return { text: 'Não autorizada', cls: 'neutral' };
  return { text: 'Sem registro por categoria', cls: 'neutral' };
}

export default function StudentIntegrations({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/integrations`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) { setError(true); return; }
      setData((await response.json()) as Result);
    } catch { setError(true); }
  }, [apiUrl, studentId, accessToken]);

  useEffect(() => { setData(null); void load(); }, [load]);

  if (error) return <div className="integrationsTab"><p className="integrationsEmpty">Não foi possível carregar as integrações agora. <button type="button" onClick={() => void load()}>Tentar de novo</button></p></div>;
  if (!data) return <div className="integrationsTab"><p className="integrationsEmpty">Carregando integrações…</p></div>;

  return (
    <div className="integrationsTab">
      <p className="integrationsIntro">Consulta somente leitura. “Conectada” só indica que a conta está vinculada; o que importa é o que de fato <strong>chegou</strong> (coluna “Recebido”). O treinador não concede nem altera autorizações por aqui.</p>
      {data.integrations.length === 0 ? <p className="integrationsEmpty">Esta aluna não tem nenhuma integração conectada e nenhum dado externo recebido.</p> : null}
      {data.integrations.map((item) => (
        <section key={item.provider} className="integrationCard">
          <header>
            <h3>{item.name}</h3>
            <span className={`integrationBadge ${STATE_CLASS[item.state]}`}>{item.stateLabel}</span>
          </header>
          <dl className="integrationFacts">
            <div><dt>Conectada desde</dt><dd>{when(item.connectedSince)}</dd></div>
            {item.disconnectedAt ? <div><dt>Desconectada em</dt><dd>{when(item.disconnectedAt)}</dd></div> : null}
            <div><dt>Última sincronização</dt><dd>{when(item.lastSyncAt)}{item.lastSyncBasis ? <small> ({BASIS_LABEL[item.lastSyncBasis]})</small> : <small> (nenhuma registrada)</small>}</dd></div>
          </dl>

          {item.warnings.length > 0 ? <ul className="integrationWarnings">{item.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}

          {item.categories.length > 0 ? (
            <div className="integrationTableWrap">
              <table className="integrationTable">
                <thead><tr><th>Categoria</th><th>Autorização da aluna</th><th>Recebido / enviado</th></tr></thead>
                <tbody>
                  {item.categories.map((c) => {
                    const auth = authorizedLabel(c.authorized);
                    const received = c.direction === 'envia'
                      ? (c.lastAt ? `Último envio aceito: ${when(c.lastAt)}` : 'Nenhum envio aceito')
                      : (c.count && c.lastAt ? `${c.count} registro(s) · último em ${when(c.lastAt)}` : 'Nada recebido');
                    return (
                      <tr key={c.id}>
                        <td>{c.label}{c.direction === 'envia' ? <small> (envio ao relógio)</small> : null}{c.note ? <small className="integrationNote">{c.note}</small> : null}</td>
                        <td><span className={`integrationBadge ${auth.cls}`}>{auth.text}</span></td>
                        <td className={c.direction === 'recebe' && !c.lastAt ? 'integrationNone' : ''}>{received}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {item.atlas.applies ? (
            <div className="integrationAtlas">
              <strong>Uso pelo Atlas (autorização separada da importação)</strong>
              <span className={`integrationBadge ${item.atlas.authorized === true ? 'ok' : 'neutral'}`}>{item.atlas.authorized === true ? 'Autorizado' : item.atlas.authorized === false ? 'Não autorizado' : 'Sem autorização específica'}</span>
              {item.atlas.since ? <small> desde {when(item.atlas.since)}</small> : null}
              <p>{item.atlas.note}</p>
            </div>
          ) : item.atlas.note ? <p className="integrationNote">{item.atlas.note}</p> : null}

          {item.failures.length > 0 ? (
            <div className="integrationFailures">
              <strong>Falhas recentes</strong>
              <ul>
                {item.failures.map((f) => (
                  <li key={`${f.status}-${f.message}`}>
                    <span className={`integrationBadge ${f.status === 'gave_up' ? 'bad' : 'warn'}`}>{f.status === 'gave_up' ? 'Desistiu' : 'Tentando de novo'}</span>{' '}
                    {f.message}{f.count > 1 ? ` (${f.count}×)` : ''} <small>— última em {when(f.at)}</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ))}
      <p className="integrationsFooter">Atualizado em {when(data.generatedAt)} · <button type="button" onClick={() => void load()}>Atualizar</button></p>
    </div>
  );
}
