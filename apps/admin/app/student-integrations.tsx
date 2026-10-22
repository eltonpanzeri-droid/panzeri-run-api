'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, AlertTriangle, ChevronDown, Footprints, HeartPulse, Info, Link2, Moon, Plug, Route, Send, ShieldCheck, Smartphone, Unlink } from 'lucide-react';

// Aluno > Integracoes (21/10/2026). So' LEITURA: GET /coach/students/:id/integrations. Mostra todos os provedores disponiveis (os nunca conectados em estado neutro) e, para cada um, o
// estado REAL (conta conectada x dado de fato recebido), ultima sincronizacao, categorias autorizadas x recebidas, falhas em linguagem compreensivel e a autorizacao do Atlas
// (separada da importacao). Nada aqui conecta, desconecta ou concede consentimento — isso so' o aluno faz, no app; nenhum token ou segredo chega a este componente.

type State = 'connected' | 'disconnected' | 'expired' | 'error' | 'not_connected' | 'data_only';
interface Check { label: string; ok: boolean | null; detail: string }
interface Category { id: string; label: string; direction: 'recebe' | 'envia'; authorized: boolean | null; lastAt: string | null; count: number | null; note?: string; checks?: Check[] }
interface Failure { at: string; message: string; count: number; status: 'retrying' | 'gave_up' }
interface Atlas { applies: boolean; authorized: boolean | null; needsNewAuthorization: boolean; since: string | null; systemEnabled: boolean | null; note: string }
interface Integration {
  provider: string; name: string; state: State; stateLabel: string; connectedSince: string | null; disconnectedAt: string | null;
  lastSyncAt: string | null; lastSyncBasis: 'sincronizacao_concluida' | 'ultimo_evento_processado' | 'ultimo_dado_recebido' | null;
  categories: Category[]; atlas: Atlas; failures: Failure[]; warnings: string[];
}
interface Result { studentId: string; generatedAt: string; integrations: Integration[] }

// Provedores oferecidos ao aluno (ordem de exibicao). O que o servidor nao devolver aparece como "nunca conectou" — nunca como conectado.
const PROVIDERS: Array<{ id: string; name: string; short: string; color: string; neverLabel: string }> = [
  { id: 'zepp', name: 'Zepp / Amazfit', short: 'Z', color: '#0b6bcb', neverLabel: 'Nunca conectou' },
  { id: 'polar', name: 'Polar', short: 'P', color: '#d6001c', neverLabel: 'Nunca conectou' },
  { id: 'wahoo', name: 'Wahoo', short: 'W', color: '#0a74da', neverLabel: 'Nunca conectou' },
  { id: 'strava', name: 'Strava', short: 'S', color: '#fc4c02', neverLabel: 'Nunca conectou' },
  { id: 'apple_health', name: 'Apple Saúde', short: 'A', color: '#ff2d55', neverLabel: 'Sem dados recebidos' },
  { id: 'health_connect', name: 'Health Connect', short: 'H', color: '#34a853', neverLabel: 'Sem dados recebidos' },
];

// Logotipos oficiais: coloque o arquivo em apps/admin/public/integration-logos/ e informe o caminho aqui (sem arquivo, o cartao usa o monograma da marca; nenhum logo e' baixado ou
// redesenhado sem a autorizacao de uso do arquivo oficial). Ex.: zepp: '/integration-logos/zepp.svg'.
const OFFICIAL_LOGO: Record<string, string | undefined> = {};

const BASIS_LABEL: Record<NonNullable<Integration['lastSyncBasis']>, string> = {
  sincronizacao_concluida: 'sincronização concluída',
  ultimo_evento_processado: 'último evento processado',
  ultimo_dado_recebido: 'último dado recebido',
};
const STATE_TONE: Record<State, 'ok' | 'neutral' | 'warn' | 'bad'> = { connected: 'ok', disconnected: 'neutral', expired: 'warn', error: 'bad', not_connected: 'neutral', data_only: 'warn' };
const CATEGORY_ICON: Record<string, LucideIcon> = {
  activity: Footprints, activity_sensors: HeartPulse, activity_route: Route, sleep: Moon, daily: Activity, resting_heart_rate: HeartPulse, hrv: HeartPulse, watch_delivery: Send,
};

function when(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function placeholder(id: string, name: string): Integration {
  const meta = PROVIDERS.find((p) => p.id === id);
  return {
    provider: id, name, state: 'not_connected', stateLabel: meta?.neverLabel ?? 'Nunca conectou', connectedSince: null, disconnectedAt: null, lastSyncAt: null, lastSyncBasis: null,
    categories: [], atlas: { applies: false, authorized: null, needsNewAuthorization: false, since: null, systemEnabled: null, note: '' }, failures: [], warnings: [],
  };
}

function Logo({ id, name, color, short }: { id: string; name: string; color: string; short: string }) {
  const official = OFFICIAL_LOGO[id];
  return (
    <span className="integrationLogo" style={official ? undefined : { background: color }} aria-hidden="true">
      {official ? <img src={official} alt={name} /> : short}
    </span>
  );
}

function IntegrationCard({ item, meta }: { item: Integration; meta: (typeof PROVIDERS)[number] }) {
  const [open, setOpen] = useState(false);
  const tone = STATE_TONE[item.state];
  const live = item.state === 'connected' || item.state === 'error' || item.state === 'expired';
  const received = item.categories.filter((c) => c.direction === 'recebe' && c.count && c.lastAt).length;
  const authorized = item.categories.filter((c) => c.direction === 'recebe' && c.authorized === true).length;
  const receivable = item.categories.filter((c) => c.direction === 'recebe').length;
  const StateIcon = item.state === 'connected' ? Link2 : item.state === 'not_connected' || item.state === 'disconnected' ? Unlink : AlertTriangle;
  const hasDetails = item.categories.length > 0 || item.atlas.applies || item.failures.length > 0 || item.warnings.length > 1 || item.connectedSince != null;
  const mainWarning = item.warnings[0];

  return (
    <article className={`integrationCard ${live ? 'live' : ''} tone-${tone}`}>
      <header>
        <Logo id={meta.id} name={item.name} color={meta.color} short={meta.short} />
        <div className="integrationTitle">
          <h3>{item.name}</h3>
          <span className={`integrationBadge ${tone}`}><StateIcon size={13} />{item.stateLabel}</span>
        </div>
      </header>

      {item.state === 'not_connected' ? (
        <p className="integrationQuiet">Esta aluna ainda não usa esta integração.</p>
      ) : (
        item.lastSyncAt || receivable > 0 ? <div className="integrationSummary">
          <div><small>Última sincronização</small><strong>{when(item.lastSyncAt)}</strong>{item.lastSyncBasis ? <em>{BASIS_LABEL[item.lastSyncBasis]}</em> : <em>nenhuma registrada</em>}</div>
          {receivable > 0 ? (
            <div><small>Dados recebidos</small><strong>{received} de {receivable}</strong><em>{authorized} categoria(s) autorizada(s)</em></div>
          ) : null}
        </div> : null
      )}

      {mainWarning ? <p className="integrationAlert"><Info size={14} /><span>{mainWarning}</span></p> : null}
      {item.failures.length > 0 ? <p className="integrationAlert bad"><AlertTriangle size={14} /><span>{item.failures.length} tipo(s) de falha recente — veja os detalhes.</span></p> : null}

      {hasDetails ? (
        <>
          <button type="button" className="integrationToggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Ocultar detalhes' : 'Ver detalhes'} <ChevronDown size={15} className={open ? 'flip' : ''} />
          </button>
          {open ? (
            <div className="integrationDetails">
              <dl className="integrationFacts">
                <div><dt>Conectada desde</dt><dd>{when(item.connectedSince)}</dd></div>
                {item.disconnectedAt ? <div><dt>Desconectada em</dt><dd>{when(item.disconnectedAt)}</dd></div> : null}
              </dl>

              {item.warnings.length > 1 ? <ul className="integrationWarnings">{item.warnings.slice(1).map((w) => <li key={w}>{w}</li>)}</ul> : null}

              {item.categories.length > 0 ? (
                <ul className="integrationCategories">
                  {item.categories.map((c) => {
                    const Icon = CATEGORY_ICON[c.id] ?? (c.direction === 'envia' ? Send : Smartphone);
                    const has = c.direction === 'recebe' ? Boolean(c.count && c.lastAt) : Boolean(c.lastAt);
                    const authText = c.authorized === true ? 'Autorizada' : c.authorized === false ? (c.direction === 'envia' ? 'Sem autorização da aluna' : 'Não autorizada') : 'Sem registro por categoria';
                    return (
                      <li key={c.id} className={has ? 'has' : ''}>
                        <span className="catIcon"><Icon size={16} /></span>
                        <div>
                          <strong>{c.label}{c.direction === 'envia' ? <small> · envio ao relógio</small> : null}</strong>
                          <span className={`integrationBadge ${c.authorized === true ? 'ok' : 'neutral'}`}>{authText}</span>
                          <span className="catReceived">
                            {c.direction === 'envia'
                              ? (c.lastAt ? `Último envio aceito: ${when(c.lastAt)}` : 'Nenhum envio aceito')
                              : (has ? `${c.count} registro(s) · último em ${when(c.lastAt)}` : 'Nada recebido')}
                          </span>
                          {c.note ? <em>{c.note}</em> : null}
                          {c.checks ? (
                            <ul className="integrationChecks">
                              {c.checks.map((k) => (
                                <li key={k.label} className={k.ok === true ? 'ok' : k.ok === false ? 'bad' : 'unknown'}>
                                  <span aria-hidden="true">{k.ok === true ? '✓' : k.ok === false ? '✕' : '?'}</span>
                                  <span><strong>{k.label}</strong><small>{k.detail}</small></span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {item.atlas.applies ? (
                <div className="integrationAtlas">
                  <span className="catIcon"><ShieldCheck size={16} /></span>
                  <div>
                    <strong>Uso pelo Atlas <small>· autorização separada da importação</small></strong>
                    <span className={`integrationBadge ${item.atlas.authorized === true ? 'ok' : 'neutral'}`}>{item.atlas.authorized === true ? 'Autorizado' : item.atlas.authorized === false ? 'Não autorizado' : 'Sem autorização específica'}</span>
                    {item.atlas.since ? <em>desde {when(item.atlas.since)}</em> : null}
                    <p>{item.atlas.note}</p>
                  </div>
                </div>
              ) : item.atlas.note ? <p className="integrationQuiet"><ShieldCheck size={14} /> {item.atlas.note}</p> : null}

              {item.failures.length > 0 ? (
                <div className="integrationFailures">
                  <strong>Falhas recentes</strong>
                  <ul>
                    {item.failures.map((f) => (
                      <li key={`${f.status}-${f.message}`}>
                        <span className={`integrationBadge ${f.status === 'gave_up' ? 'bad' : 'warn'}`}>{f.status === 'gave_up' ? 'Desistiu' : 'Tentando de novo'}</span>
                        <span>{f.message}{f.count > 1 ? ` (${f.count}×)` : ''} <small>— última em {when(f.at)}</small></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
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

  const byProvider = new Map(data.integrations.map((i) => [i.provider, i]));
  const items = PROVIDERS.map((meta) => ({ meta, item: byProvider.get(meta.id) ?? placeholder(meta.id, meta.name) }));
  const connected = items.filter(({ item }) => item.state === 'connected').length;
  const attention = items.filter(({ item }) => item.state === 'error' || item.state === 'expired' || item.failures.length > 0).length;

  return (
    <div className="integrationsTab">
      <div className="integrationsHead">
        <div>
          <h3><Plug size={18} /> Integrações do aluno</h3>
          <p>Consulta somente leitura. “Conectada” indica só que a conta está vinculada; o que vale é o que de fato <strong>chegou</strong>. Quem conecta, desconecta e autoriza é o aluno, no app.</p>
        </div>
        <div className="integrationsCounters">
          <span><strong>{connected}</strong> conectada(s)</span>
          <span className={attention > 0 ? 'attn' : ''}><strong>{attention}</strong> com atenção</span>
        </div>
      </div>

      <div className="integrationsGrid">
        {items.map(({ meta, item }) => <IntegrationCard key={meta.id} item={item} meta={meta} />)}
      </div>

      <p className="integrationsFooter">Atualizado em {when(data.generatedAt)} · <button type="button" onClick={() => void load()}>Atualizar</button></p>
    </div>
  );
}
