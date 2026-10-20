'use client';

import React, { useCallback, useEffect, useState } from 'react';

// PAGINA TEMPORARIA DE TESTE — conexao Zepp/Amazfit (Central Universal de Integracoes, Passo 2b, 19/10/2026).
// Usa SOMENTE as rotas genericas ja existentes (/zepp/*) com o login do proprio painel: nao ha segunda logica de autenticacao, nao ha atalho para conectar a
// conta de outro aluno (a conta conectada e sempre a do usuario logado — o servidor ignora qualquer id vindo daqui) e nenhum token, segredo ou chave passa
// pelo navegador (o status devolve so' o final mascarado do identificador da conta). Nesta fase NADA e' importado da Zepp: so' se testa a autenticacao.
// Para remover depois dos testes: apagar este arquivo e a linha <ZeppTestPanel /> em page.tsx.

interface ConsentGroup { id: string; label: string; description: string; required: boolean; requires?: string[] }
interface ConsentSection { heading: string | null; paragraphs?: string[]; bullets?: string[] }
interface PurposeOption { id: string; label: string; description: string; external: boolean; changeableAfterConnect: boolean }
interface ConsentDocument {
  version: string; dateLabel: string; title: string; intro: string; sections: ConsentSection[]; groups: ConsentGroup[]; purposes: string[];
  optionalPurposes: PurposeOption[]; locked: Record<string, boolean>;
  acknowledgementText: string; confirmButtonLabel: string; textHash: string;
}
interface RecentEvent { type: string; at: string; reason: string | null; providerRevocation: string | null }
interface ZeppStatus {
  connected: boolean; connectedAt: string | null; disconnectedAt: string | null;
  account: { hint: string } | null;
  consent: { categories: string[]; purposes: string[] | null; version: string; consentedAt: string } | null;
  recent: RecentEvent[];
  availability: { enabled: boolean; configured: boolean };
}

const CATEGORY_LABELS: Record<string, string> = {
  profile: 'Dados básicos da conta', activity: 'Atividades físicas', activity_sensors: 'Sensores das atividades', activity_route: 'Percursos e GPS', sleep: 'Sono e recuperação',
};
const PURPOSE_LABELS: Record<string, string> = {
  history: 'Histórico de atividades', tracking: 'Acompanhar evolução e treinamento', plan_comparison: 'Comparar com os treinos prescritos', indicators: 'Indicadores', coach_view: 'Acompanhamento pelo treinador',
  history_backfill: 'Importar até 30 dias anteriores à conexão', ai_external: 'Análises por IA com fornecedores externos', ai_internal: 'Análises por IA internas',
};
const EVENT_LABELS: Record<string, string> = {
  purposes_granted: 'Finalidade opcional autorizada', purposes_revoked: 'Finalidade opcional retirada',
  connected: 'Conta conectada', disconnected: 'Conta desconectada', connect_cancelled: 'Autorização cancelada na Zepp', connect_failed: 'Falha ao conectar',
  token_refresh_rejected: 'A Zepp recusou a renovação — conexão encerrada', token_expired_without_refresh: 'Conexão expirou sem renovação possível', data_deleted: 'Dados importados excluídos',
};
const REASON_LABELS: Record<string, string> = {
  integracao_indisponivel: 'integração indisponível para este usuário',
  conta_ou_conexao_ja_existente: 'conta Zepp já vinculada (a outro usuário ou a este)',
  recusada_pelo_provedor_ou_invalida: 'a Zepp recusou a autorização, ou o retorno era inválido/expirado',
  provedor_indisponivel: 'a Zepp está fora do ar ou respondeu algo inesperado',
  erro_inesperado: 'erro inesperado',
};
const REVOCATION_LABELS: Record<string, string> = { revoked: 'revogado na Zepp', not_registered: 'a Zepp já não reconhecia a autorização', failed: 'não foi possível avisar a Zepp (a desconexão local vale)', skipped: 'sem aviso à Zepp' };

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR') : '—');

export default function ZeppTestPanel({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [status, setStatus] = useState<ZeppStatus | null>(null);
  const [doc, setDoc] = useState<ConsentDocument | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  // Finalidades OPCIONAIS marcadas ao conectar (nada e' marcado por padrao) e aceite separado para autorizar IA depois de conectado.
  const [selectedPurposes, setSelectedPurposes] = useState<string[]>([]);
  const [purposeAck, setPurposeAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>('');

  const call = useCallback(async (path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: unknown = null;
    try { data = await response.json(); } catch { /* sem corpo */ }
    return { ok: response.ok, status: response.status, data };
  }, [apiUrl, token]);

  const explain = (status: number, data: unknown): string => {
    const apiMessage = typeof (data as { message?: unknown } | null)?.message === 'string' ? (data as { message: string }).message : '';
    if (status === 401) return 'Sessão expirada. Entre novamente no painel.';
    if (status === 403) return 'Sem permissão: esta página é só para administradores, e o seu usuário precisa estar liberado no servidor.';
    if (status === 503) return 'A Zepp ainda não está configurada no servidor (faltam variáveis de ambiente).';
    return apiMessage || `Não foi possível concluir (código ${status}).`;
  };

  const refresh = useCallback(async () => {
    if (!token) return;
    const [s, c] = await Promise.all([call('/zepp/status'), call('/zepp/consent')]);
    if (s.ok) setStatus(s.data as ZeppStatus); else setMessage(explain(s.status, s.data));
    if (c.ok) {
      const document = c.data as ConsentDocument;
      setDoc(document);
      // Marca so' o obrigatorio; nada mais e' presumido.
      setSelected((current) => (current.length ? current : document.groups.filter((g) => g.required).map((g) => g.id)));
    }
  }, [call, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = (group: ConsentGroup) => {
    if (group.required) return;
    setSelected((current) => {
      if (current.includes(group.id)) {
        // Desmarcar um grupo desmarca os que dependem dele (nao existe selecao incompativel).
        const dependents = (doc?.groups ?? []).filter((g) => g.requires?.includes(group.id)).map((g) => g.id);
        return current.filter((id) => id !== group.id && !dependents.includes(id));
      }
      return [...current, group.id];
    });
  };
  const missingDependency = (group: ConsentGroup) => (group.requires ?? []).some((id) => !selected.includes(id));

  const connect = async () => {
    if (!doc || !acknowledged) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await call('/zepp/connect', 'POST', { groups: selected, purposes: selectedPurposes, acknowledged: true, consentVersion: doc.version, consentTextHash: doc.textHash });
      if (!r.ok) { setMessage(explain(r.status, r.data)); return; }
      const url = (r.data as { url?: string }).url;
      if (!url) { setMessage('A API não devolveu o endereço de autorização.'); return; }
      window.open(url, '_blank', 'noopener,noreferrer');
      setMessage('Autorize na janela da Zepp que se abriu. Depois volte aqui e clique em “Atualizar status”.');
    } catch {
      setMessage('Não consegui falar com a API.');
    } finally {
      setBusy(false);
    }
  };

  const changePurpose = async (id: string, action: 'grant' | 'revoke') => {
    if (!doc) return;
    if (action === 'revoke' && !window.confirm('Retirar esta autorização? O envio futuro cessa; o que já foi enviado não pode ser desfeito junto ao fornecedor.')) return;
    setBusy(true);
    try {
      const r = await call('/zepp/purposes', 'POST', action === 'grant'
        ? { grant: [id], acknowledged: true, consentVersion: doc.version, consentTextHash: doc.textHash }
        : { revoke: [id] });
      setMessage(r.ok ? (action === 'grant' ? 'Autorização registrada.' : 'Autorização retirada.') : explain(r.status, r.data));
      setPurposeAck(false);
      await refresh();
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm('Desconectar a conta Zepp/Amazfit? A coleta futura para; dados já importados continuam até você excluí-los.')) return;
    setBusy(true);
    try {
      const r = await call('/zepp/disconnect', 'POST');
      const result = r.data as { providerRevocation?: string } | null;
      setMessage(r.ok ? `Desconectada (${REVOCATION_LABELS[result?.providerRevocation ?? 'skipped'] ?? 'ok'}).` : explain(r.status, r.data));
      await refresh();
    } finally { setBusy(false); }
  };

  const deleteData = async () => {
    if (!window.confirm('Excluir os dados importados da Zepp? Esta ação não pode ser desfeita.')) return;
    setBusy(true);
    try {
      const r = await call('/zepp/data', 'DELETE');
      const result = r.data as { activities?: number } | null;
      setMessage(r.ok ? `Dados importados excluídos (${result?.activities ?? 0} atividade(s)).` : explain(r.status, r.data));
      await refresh();
    } finally { setBusy(false); }
  };

  const availabilityNote = status && !status.availability.configured
    ? 'A Zepp ainda não está configurada no servidor (variáveis ZEPP_* ausentes ou inválidas).'
    : status && !status.availability.enabled
      ? 'O seu usuário não está liberado para a Zepp (ZEPP_ENABLED_USER_IDS no servidor).'
      : '';

  return (
    <section className="miniSection zeppPanel">
      <h3>Teste de conexão Zepp/Amazfit</h3>
      <p className="formHintText">
        Página temporária de teste, só para administradores. Conecta a <strong>sua própria</strong> conta. Nesta fase <strong>nenhum treino ou dado de saúde é importado</strong>:
        só se testa a autorização. A minuta de consentimento abaixo não é um documento juridicamente aprovado.
      </p>
      {availabilityNote ? <p className="zeppAlert">{availabilityNote}</p> : null}
      {message ? <p className="zeppMessage" role="status">{message}</p> : null}

      <div className="zeppActions">
        <button className="secondaryButton" type="button" disabled={busy} onClick={() => void refresh()}>Atualizar status</button>
      </div>

      {status?.connected ? (
        <div className="zeppStatusBox">
          <p><strong>Conectada</strong> desde {formatDate(status.connectedAt)}</p>
          <p>Conta Zepp: {status.account?.hint ?? '—'} <span className="formHintText">(identificador mascarado)</span></p>
          <p>Autorização: versão {status.consent?.version} em {formatDate(status.consent?.consentedAt ?? null)}</p>
          <p>Categorias autorizadas: {(status.consent?.categories ?? []).map((c) => CATEGORY_LABELS[c] ?? c).join(', ') || '—'}</p>
          <p>Finalidades: {(status.consent?.purposes ?? []).map((p) => PURPOSE_LABELS[p] ?? p).join(', ') || '—'}. <strong>Inteligência artificial: não autorizada.</strong></p>
          {doc ? (
            <div className="zeppGroups">
              <h5>Finalidades opcionais</h5>
              {doc.optionalPurposes.filter((p) => p.changeableAfterConnect).map((option) => {
                const granted = (status.consent?.purposes ?? []).includes(option.id);
                const locked = option.external && doc.locked?.[option.id] !== false;
                return (
                  <div key={option.id} className="zeppGroup">
                    <span>
                      <strong>{option.label}</strong> — {granted ? 'autorizada' : 'não autorizada'}
                      <br /><span className="formHintText">{option.description}</span>
                      {locked && !granted ? <><br /><em>Indisponível por enquanto: nenhum dado da Zepp é enviado a fornecedores externos de IA.</em></> : null}
                      <br />
                      {granted ? (
                        <button className="secondaryButton" type="button" disabled={busy} onClick={() => void changePurpose(option.id, 'revoke')}>Retirar autorização</button>
                      ) : (
                        <>
                          <label><input type="checkbox" checked={purposeAck} disabled={busy || locked} onChange={(event) => setPurposeAck(event.target.checked)} /> Li a seção 2.3 do texto e autorizo.</label>{' '}
                          <button className="secondaryButton" type="button" disabled={busy || locked || !purposeAck} onClick={() => void changePurpose(option.id, 'grant')}>Autorizar</button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          <button className="secondaryButton" type="button" disabled={busy} onClick={() => void disconnect()}>Desconectar</button>
        </div>
      ) : (
        <div className="zeppStatusBox">
          <p><strong>Não conectada</strong>{status?.disconnectedAt ? ` (desconectada em ${formatDate(status.disconnectedAt)})` : ''}</p>
          {doc ? (
            <>
              <h4>{doc.title}</h4>
              <p className="formHintText">Versão {doc.version} — {doc.dateLabel}</p>
              <div className="zeppConsentText">
                <p>{doc.intro}</p>
                {doc.sections.map((section, index) => (
                  <div key={index}>
                    {section.heading ? <h5>{section.heading}</h5> : null}
                    {(section.paragraphs ?? []).map((p, i) => <p key={i}>{p}</p>)}
                    {section.bullets?.length ? <ul>{section.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
                  </div>
                ))}
              </div>
              <h5>Categorias</h5>
              <div className="zeppGroups">
                {doc.groups.map((group) => {
                  const blocked = missingDependency(group);
                  return (
                    <label key={group.id} className="zeppGroup">
                      <input type="checkbox" checked={selected.includes(group.id)} disabled={group.required || blocked || busy} onChange={() => toggle(group)} />
                      <span>
                        <strong>{group.label}</strong> {group.required ? <em>(obrigatório para vincular a conta)</em> : <em>(opcional)</em>}
                        <br /><span className="formHintText">{group.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <h5>Finalidades opcionais</h5>
              <div className="zeppGroups">
                {doc.optionalPurposes.map((option) => {
                  const locked = option.external && doc.locked?.[option.id] !== false;
                  return (
                    <label key={option.id} className="zeppGroup">
                      <input
                        type="checkbox"
                        checked={selectedPurposes.includes(option.id)}
                        disabled={busy || locked}
                        onChange={() => setSelectedPurposes((current) => (current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id]))}
                      />
                      <span>
                        <strong>{option.label}</strong> <em>(opcional)</em>
                        <br /><span className="formHintText">{option.description}</span>
                        {locked ? <><br /><em>Indisponível por enquanto: nenhum dado da Zepp é enviado a fornecedores externos de IA.</em></> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <label className="zeppGroup">
                <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>{doc.acknowledgementText}</span>
              </label>
              <button className="primaryButton" type="button" disabled={!acknowledged || busy || !status?.availability.enabled || !status?.availability.configured} onClick={() => void connect()}>
                {doc.confirmButtonLabel}
              </button>
            </>
          ) : <p className="formHintText">Carregando o texto de consentimento…</p>}
          {status && !status.connected ? (
            <p><button className="secondaryButton" type="button" disabled={busy} onClick={() => void deleteData()}>Excluir dados importados da Zepp</button></p>
          ) : null}
        </div>
      )}

      {status?.recent?.length ? (
        <div className="zeppRecent">
          <h5>Últimos eventos</h5>
          <ul>
            {status.recent.map((event, index) => (
              <li key={index}>
                {formatDate(event.at)} — {EVENT_LABELS[event.type] ?? event.type}
                {event.reason ? `: ${REASON_LABELS[event.reason] ?? event.reason}` : ''}
                {event.providerRevocation ? ` (${REVOCATION_LABELS[event.providerRevocation] ?? event.providerRevocation})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
