import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PRColors } from '../../theme/tokens';

// Zepp/Amazfit (consentimento 2.0, 20/10/2026) — telas de conexao, de cada autorizacao opcional e de "Privacidade e permissoes".
// O app so' EXIBE: textos, versoes e hashes vem do servidor (GET /zepp/consent) e sao devolvidos em cada autorizacao, para o servidor registrar o que o aluno de fato viu.
// Regras: nenhuma caixa vem marcada; cada autorizacao e' independente e tem a propria tela; revogar e' sempre possivel e vale na hora; confirmacoes sao DENTRO do app
// (nada de janela nativa de confirmacao no PWA do iPhone).

interface ConsentSection { heading: string | null; paragraphs?: string[]; bullets?: string[] }
interface PurposeScreen { version: string; dateLabel: string; title: string; paragraphs: string[]; checkboxText: string; buttonLabel: string }
interface PurposeOption { id: string; label: string; description: string; external: boolean; changeableAfterConnect: boolean; screen?: PurposeScreen }
interface ConsentGroup { id: string; label: string; description: string; required: boolean; requires?: string[] }
interface ConsentDocument {
  version: string;
  dateLabel: string;
  title: string;
  intro: string;
  sections: ConsentSection[];
  groups: ConsentGroup[];
  optionalPurposes: PurposeOption[];
  acknowledgementText: string;
  confirmButtonLabel: string;
  textHash: string;
  purposeHashes: Record<string, string>;
}
interface PermissionPurpose { id: string; label: string; granted: boolean; needsNewAuthorization: boolean; grantedAt: string | null; grantedVersion: string | null; currentVersion: string; available: boolean; hasOwnScreen: boolean }
interface PermissionGroup { id: string; label: string; required: boolean; requires: string[]; granted: boolean }
interface Permissions {
  connected: boolean;
  consent: { version: string; needsReview: boolean };
  groups: PermissionGroup[];
  purposes: PermissionPurpose[];
  log: Array<{ at: string; decision: 'granted' | 'revoked'; kind: 'connection' | 'purpose' | 'group'; id: string | null; version: string | null }>;
}

const WATCH = 'watch_delivery';
const ATLAS = 'ai_external';
const HISTORY = 'history_backfill';

const ITEM_LABEL: Record<string, string> = {
  activity: 'Importação de atividades',
  sensors: 'Frequência cardíaca, cadência, potência e elevação',
  route: 'Percurso GPS',
  sleep: 'Sono e recuperação',
  daily: 'Saúde diária',
  hrv: 'Variabilidade da frequência cardíaca (HRV)',
  [HISTORY]: 'Importação do histórico (30 dias)',
  [WATCH]: 'Envio de treinos ao relógio',
  [ATLAS]: 'Análise pelo Atlas com a Anthropic',
};

const REVOKE_EFFECT: Record<string, string> = {
  activity: 'Os novos dados de atividades (e os grupos que dependem delas) deixam de ser importados. O que já foi importado continua guardado até você pedir a exclusão. Os resultados de inteligência artificial feitos com esses dados serão invalidados ou atualizados.',
  sensors: 'Frequência cardíaca, cadência, potência e elevação das novas atividades deixam de ser guardadas. O que já foi importado continua guardado até você pedir a exclusão.',
  route: 'O percurso GPS das novas atividades deixa de ser guardado. O que já foi importado continua guardado até você pedir a exclusão.',
  sleep: 'Os novos dados de sono (etapas, horários, cochilos e pontuação) deixam de ser guardados. O que já foi importado continua guardado até você pedir a exclusão. Os resultados de inteligência artificial feitos com esses dados serão invalidados ou atualizados.',
  daily: 'Passos, distância, calorias ativas e frequência cardíaca de repouso dos novos dias deixam de ser guardados. O que já foi importado continua guardado até você pedir a exclusão. Os resultados de inteligência artificial feitos com esses dados serão invalidados ou atualizados.',
  hrv: 'Os novos dados de HRV deixam de ser guardados. O que já foi importado continua guardado até você pedir a exclusão. Os resultados de inteligência artificial feitos com esses dados serão invalidados ou atualizados.',
  [HISTORY]: 'Não será feita nova importação de atividades anteriores. O que já foi importado continua guardado até você pedir a exclusão.',
  [WATCH]: 'O Panzeri Run deixa de enviar treinos e remove da sua conta Zepp os treinos já enviados. Seus treinos continuam disponíveis no aplicativo.',
  [ATLAS]: 'Seus dados Zepp deixam de ser usados pelo Atlas, e os resultados de inteligência artificial já gerados com eles serão invalidados ou atualizados, respeitadas as obrigações legais de conservação. O que já foi enviado à Anthropic não pode ser desfeito junto a ela.',
};

function Check({ checked, onPress, disabled, label }: { checked: boolean; onPress: () => void; disabled?: boolean; label: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: Boolean(disabled) }} style={[styles.checkRow, disabled && { opacity: 0.5 }]}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? PRColors.ocean : PRColors.slate} />
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  );
}

function Primary({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const off = Boolean(disabled || busy);
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" style={[styles.primary, off && { opacity: 0.45 }]}>
      <Text style={styles.primaryText}>{busy ? 'Aguarde…' : label}</Text>
    </Pressable>
  );
}

function Outline({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[styles.outline, danger && { borderColor: PRColors.danger }, disabled && { opacity: 0.45 }]}>
      <Text style={[styles.outlineText, danger && { color: PRColors.danger }]}>{label}</Text>
    </Pressable>
  );
}

// Cartao "Treinos no relogio" (22/10/2026): mostra o que foi (ou nao) enviado a Zepp e o motivo, e permite sincronizar agora (POST /zepp/workouts/sync, rota que ja existia).
// A aceitacao pela Zepp NAO confirma que o relogio ja' recebeu: a aluna precisa sincronizar o relogio no app da Zepp.
interface WorkoutStatus { publishingEnabled: boolean; connected: boolean; watchDeliveryAuthorized: boolean; eligible: number; skipped: Array<{ reason: string }>; acceptedByZepp: number; lastAcceptedAt: string | null }
const SKIP_TEXT: Record<string, string> = {
  sessao_extra: 'treinos extras não são enviados', modalidade_nao_suportada: 'só treinos de corrida são enviados', estrutura_nao_suportada: 'treino sem a estrutura de corrida',
  sessao_ja_realizada: 'treino que você já fez',
};
function WatchWorkoutsCard({ accessToken, apiUrl, grantedAt }: { accessToken: string; apiUrl: string; grantedAt: string | null }) {
  const [status, setStatus] = useState<WorkoutStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/zepp/workouts/status`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) setStatus((await response.json()) as WorkoutStatus);
    } catch { /* sem o estado, o cartao mostra so' o botao */ }
  }, [apiUrl, accessToken]);
  useEffect(() => { void load(); }, [load]);

  async function syncNow() {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/zepp/workouts/sync`, { method: 'POST', headers });
      if (!response.ok) { setMessage({ ok: false, text: 'Não foi possível sincronizar agora. Tente de novo em alguns minutos.' }); return; }
      const result = (await response.json()) as { status: string; workouts?: number };
      const text = result.status === 'published' || result.status === 'republished' ? `${result.workouts ?? 0} treino(s) enviado(s) à Zepp. Abra o app da Zepp e sincronize o relógio para recebê-los.`
        : result.status === 'unchanged' ? 'Tudo já estava enviado à Zepp. Se o relógio ainda não mostra, sincronize-o no app da Zepp.'
        : result.status === 'disabled' ? 'O envio de treinos ainda não está disponível.'
        : result.status === 'failed' ? 'A Zepp não aceitou o envio agora. Tente de novo em alguns minutos.'
        : 'Nada para enviar agora.';
      setMessage({ ok: result.status !== 'failed' && result.status !== 'disabled', text });
      await load();
    } catch {
      setMessage({ ok: false, text: 'Não foi possível sincronizar agora. Verifique a conexão e tente de novo.' });
    } finally {
      setBusy(false);
    }
  }

  const reasons = status ? [...new Set(status.skipped.map((s) => SKIP_TEXT[s.reason]).filter(Boolean))] : [];
  const summary = !status ? null
    : !status.publishingEnabled ? 'O envio de treinos ainda não está disponível.'
    : status.acceptedByZepp > 0 ? `${status.acceptedByZepp} treino(s) enviado(s) à Zepp${status.lastAcceptedAt ? `. Último envio: ${dateBr(status.lastAcceptedAt)}` : ''}. Sincronize o relógio no app da Zepp para recebê-los.`
    : status.eligible > 0 ? `${status.eligible} treino(s) de corrida aguardando envio. Toque em “Sincronizar agora”.`
    : 'Nenhum treino enviado ainda: não há treino de corrida programado para enviar agora.';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Treinos no relógio</Text>
      <Text style={styles.body}>Envio de treinos autorizado desde {dateBr(grantedAt)}. Você pode retirar em “Privacidade e permissões”.</Text>
      {summary ? <Text style={styles.body}>{summary}</Text> : null}
      {reasons.length > 0 && status && status.eligible === 0 ? <Text style={styles.hint}>Não enviados: {reasons.join('; ')}.</Text> : null}
      {message ? <Text style={[styles.hint, { color: message.ok ? PRColors.success : PRColors.danger }]}>{message.text}</Text> : null}
      <Primary label="Sincronizar agora" onPress={() => void syncNow()} busy={busy} />
    </View>
  );
}

function dateBr(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
}

export function ZeppIntegration({ accessToken, apiUrl, variant = 'screen', privacyUrl, termsUrl }: {
  accessToken: string;
  apiUrl: string;
  // 'screen' = conexao + autorizacoes + permissoes (Integracoes); 'manage' = so' "Privacidade e permissoes" (Privacidade e dados)
  variant?: 'screen' | 'manage';
  privacyUrl: string;
  termsUrl: string;
}) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const [doc, setDoc] = useState<ConsentDocument | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // conexao
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [history, setHistory] = useState(false);
  // autorizacoes por tela propria / grupos (uma aberta por vez); confirmacoes de retirada, desconexao e exclusao
  const [open, setOpen] = useState<string | null>(null);
  const [openAck, setOpenAck] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try {
      const [consentResponse, permissionsResponse] = await Promise.all([
        fetch(`${apiUrl}/zepp/consent`, { headers }),
        fetch(`${apiUrl}/zepp/permissions`, { headers }),
      ]);
      if (consentResponse.status === 403 || permissionsResponse.status === 403) { setBlocked(true); return; }
      if (consentResponse.ok) setDoc((await consentResponse.json()) as ConsentDocument);
      if (permissionsResponse.ok) setPermissions((await permissionsResponse.json()) as Permissions);
      setBlocked(false);
    } catch {
      setMessage({ ok: false, text: 'Não consegui consultar a integração agora. Tente novamente em instantes.' });
    } finally {
      setLoading(false);
    }
  }, [apiUrl, accessToken]);

  useEffect(() => {
    void load();
    // O retorno da Zepp acontece fora do app: ao voltar, o estado e' consultado de novo.
    const timer = setInterval(() => void load(), 6000);
    return () => clearInterval(timer);
  }, [load]);

  async function call(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<{ ok: boolean; data: any; status: number }> {
    try {
      const response = await fetch(`${apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, data, status: response.status };
    } catch {
      return { ok: false, data: {}, status: 0 };
    }
  }
  const failure = (result: { data: any; status: number }, fallback: string) => {
    if (result.status === 409) return 'O texto desta autorização foi atualizado. Leia a versão atual e tente de novo.';
    if (result.status === 403) return 'Esta integração está indisponível no momento.';
    return typeof result.data?.message === 'string' ? result.data.message : fallback;
  };

  async function connect() {
    if (!doc) return;
    setBusy('connect');
    setMessage(null);
    const result = await call('/zepp/connect', 'POST', {
      groups: ['account', ...selectedGroups],
      purposes: history ? [HISTORY] : [],
      acknowledged,
      consentVersion: doc.version,
      consentTextHash: doc.textHash,
    });
    setBusy('');
    if (!result.ok || typeof result.data?.url !== 'string') {
      if (result.status === 409) void load();
      setMessage({ ok: false, text: failure(result, 'Não foi possível iniciar a conexão agora.') });
      return;
    }
    setMessage({ ok: true, text: 'Abrindo a Zepp para você autorizar. Depois, volte ao Panzeri Run.' });
    void Linking.openURL(result.data.url);
  }

  async function grantPurpose(option: PurposeOption) {
    if (!doc) return;
    setBusy(`grant:${option.id}`);
    setMessage(null);
    const result = await call('/zepp/purposes', 'POST', {
      grant: [option.id],
      acknowledged: true,
      consentVersion: option.screen ? option.screen.version : doc.version,
      consentTextHash: option.screen ? doc.purposeHashes[option.id] : doc.textHash,
    });
    setBusy('');
    if (!result.ok) { if (result.status === 409) void load(); setMessage({ ok: false, text: failure(result, 'Não foi possível registrar a autorização agora.') }); return; }
    setOpen(null); setOpenAck(false);
    setMessage({ ok: true, text: 'Autorização registrada.' });
    await load();
  }

  async function grantGroup(id: string) {
    if (!doc) return;
    setBusy(`grant:${id}`);
    setMessage(null);
    const result = await call('/zepp/groups', 'POST', { grant: [id], acknowledged: true, consentVersion: doc.version, consentTextHash: doc.textHash });
    setBusy('');
    if (!result.ok) { if (result.status === 409) void load(); setMessage({ ok: false, text: failure(result, 'Não foi possível registrar a autorização agora.') }); return; }
    setOpen(null); setOpenAck(false);
    setMessage({ ok: true, text: 'Autorização registrada.' });
    await load();
  }

  async function revoke(id: string, kind: 'group' | 'purpose') {
    setBusy(`revoke:${id}`);
    setMessage(null);
    const result = kind === 'group' ? await call('/zepp/groups', 'POST', { revoke: [id] }) : await call('/zepp/purposes', 'POST', { revoke: [id] });
    setBusy('');
    setConfirmRevoke(null);
    if (!result.ok) { setMessage({ ok: false, text: failure(result, 'Não foi possível retirar a autorização agora.') }); return; }
    setMessage({ ok: true, text: 'Autorização retirada.' });
    await load();
  }

  async function reconfirm() {
    if (!doc) return;
    setBusy('reconfirm');
    const result = await call('/zepp/reconfirm', 'POST', { acknowledged: true, consentVersion: doc.version, consentTextHash: doc.textHash });
    setBusy('');
    if (!result.ok) { if (result.status === 409) void load(); setMessage({ ok: false, text: failure(result, 'Não foi possível confirmar agora.') }); return; }
    setOpenAck(false);
    setMessage({ ok: true, text: 'Texto atualizado confirmado.' });
    await load();
  }

  async function disconnect() {
    setBusy('disconnect');
    const result = await call('/zepp/disconnect', 'POST');
    setBusy('');
    setConfirmDisconnect(false);
    setMessage(result.ok ? { ok: true, text: 'Conta Zepp desconectada. Novas importações e envios foram interrompidos.' } : { ok: false, text: failure(result, 'Não foi possível desconectar agora.') });
    await load();
  }

  async function requestDeletion() {
    setBusy('delete');
    if (permissions?.connected) {
      const disconnected = await call('/zepp/disconnect', 'POST');
      if (!disconnected.ok) { setBusy(''); setMessage({ ok: false, text: failure(disconnected, 'Não foi possível desconectar a conta antes de excluir.') }); return; }
    }
    const result = await call('/zepp/data', 'DELETE');
    setBusy('');
    setConfirmDelete(false);
    setMessage(result.ok ? { ok: true, text: 'Os dados da Zepp foram excluídos.' } : { ok: false, text: failure(result, 'Não foi possível excluir os dados agora. A conta foi desconectada; tente excluir de novo.') });
    await load();
  }

  if (loading) return <ActivityIndicator />;
  // Em Privacidade e dados o bloco so' aparece para quem tem a integracao disponivel E conectada (nao polui a tela de quem nao usa a Zepp).
  if (blocked) return variant === 'manage' ? null : <Text style={styles.hint}>Esta integração está indisponível no momento.</Text>;
  if (!doc || !permissions) return variant === 'manage' ? null : <Text style={styles.hint}>{message?.text ?? 'Não consegui carregar a integração agora.'}</Text>;
  if (variant === 'manage' && !permissions.connected) return null;

  const optionById = (id: string) => doc.optionalPurposes.find((option) => option.id === id);
  const purposeState = (id: string) => permissions.purposes.find((item) => item.id === id);
  const groupState = (id: string) => permissions.groups.find((item) => item.id === id);
  const messageView = message ? <Text style={[styles.hint, { color: message.ok ? PRColors.success : PRColors.danger }]}>{message.text}</Text> : null;

  // ── Tela de uma autorizacao com texto proprio (envio de treinos / Atlas) ─────────────────────────────────────────────────────────────────────────
  const purposeCard = (id: string) => {
    const option = optionById(id);
    const state = purposeState(id);
    if (!option?.screen || !state) return null;
    const unavailable = !state.available;
    return (
      <View style={styles.card} key={`card-${id}`}>
        <Text style={styles.cardTitle}>{option.screen.title}</Text>
        {state.needsNewAuthorization ? <Text style={[styles.hint, { color: PRColors.warning }]}>O texto desta autorização mudou. Leia a nova versão e autorize novamente para continuar usando.</Text> : null}
        {option.screen.paragraphs.map((paragraph, index) => <Text key={index} style={styles.body}>{paragraph}</Text>)}
        <Text style={styles.hint}>Versão {option.screen.version} de {option.screen.dateLabel}. <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text></Text>
        {unavailable ? <Text style={[styles.hint, { color: PRColors.warning }]}>Esta autorização ainda não está disponível. Você será avisado quando puder concedê-la; enquanto isso, nada é enviado.</Text> : null}
        <Check checked={open === id && openAck} onPress={() => { setOpen(id); setOpenAck(open === id ? !openAck : true); }} disabled={unavailable} label={option.screen.checkboxText} />
        <Primary label={option.screen.buttonLabel} onPress={() => void grantPurpose(option)} disabled={unavailable || !(open === id && openAck)} busy={busy === `grant:${id}`} />
      </View>
    );
  };

  // ── Linha do painel de permissoes ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const row = (key: string, kind: 'group' | 'purpose', granted: boolean, extra?: { sub?: string; available?: boolean; needsNew?: boolean; indent?: boolean }) => {
    const label = ITEM_LABEL[key] ?? key;
    const askingGrant = open === key;
    const option = kind === 'purpose' ? optionById(key) : undefined;
    const group = kind === 'group' ? doc.groups.find((item) => item.id === key) : undefined;
    return (
      <View key={`row-${key}`} style={[styles.permRow, extra?.indent && { marginLeft: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name={granted ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={granted ? PRColors.success : PRColors.slate} />
          <View style={{ flex: 1 }}>
            <Text style={styles.permLabel}>{label}</Text>
            <Text style={[styles.permStatus, { color: granted ? PRColors.success : PRColors.slate }]}>
              {granted ? 'Autorizada' : extra?.needsNew ? 'Precisa de nova autorização' : 'Não autorizada'}{extra?.sub ? ` · ${extra.sub}` : ''}
            </Text>
          </View>
        </View>
        {granted ? (
          confirmRevoke === key ? (
            <View style={styles.confirmBox}>
              <Text style={styles.body}>{REVOKE_EFFECT[key]}</Text>
              <Primary label="Confirmar retirada" onPress={() => void revoke(key, kind)} busy={busy === `revoke:${key}`} />
              <Outline label="Cancelar" onPress={() => setConfirmRevoke(null)} />
            </View>
          ) : (
            <Outline label="Retirar autorização" danger onPress={() => { setConfirmRevoke(key); setOpen(null); }} />
          )
        ) : extra?.available === false ? (
          <Text style={styles.hint}>Ainda não disponível.</Text>
        ) : askingGrant ? (
          <View style={styles.confirmBox}>
            {kind === 'purpose' && option?.screen ? (
              purposeCard(key)
            ) : (
              <>
                <Text style={styles.body}>{kind === 'group' ? group?.description : option?.description}</Text>
                <Check checked={openAck} onPress={() => setOpenAck(!openAck)} label={kind === 'group' ? doc.acknowledgementText : option!.label} />
                <Primary label="Autorizar" onPress={() => void (kind === 'group' ? grantGroup(key) : grantPurpose(option!))} disabled={!openAck} busy={busy === `grant:${key}`} />
              </>
            )}
            <Outline label="Cancelar" onPress={() => { setOpen(null); setOpenAck(false); }} />
          </View>
        ) : (
          <Outline label="Autorizar" onPress={() => { setOpen(key); setOpenAck(false); setConfirmRevoke(null); }} disabled={kind === 'group' && (group?.requires ?? []).some((required) => !groupState(required)?.granted)} />
        )}
      </View>
    );
  };

  const history2 = purposeState(HISTORY);
  const watch = purposeState(WATCH);
  const atlas = purposeState(ATLAS);

  // O texto da conexao mudou de forma relevante depois da autorizacao: a importacao fica suspensa ate o aluno ler e confirmar de novo (sem adicionar nada ao que ja autorizou).
  const reviewCard = permissions.connected && permissions.consent.needsReview ? (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>O texto da conexão foi atualizado</Text>
      <Text style={styles.body}>Houve uma mudança relevante no texto da conexão com a Zepp. Enquanto você não confirmar o texto atual, a importação das suas atividades fica suspensa. A confirmação não adiciona nenhuma autorização nova.</Text>
      {doc.sections.map((section, index) => (
        <View key={index} style={{ gap: 6 }}>
          {section.heading ? <Text style={styles.permLabel}>{section.heading}</Text> : null}
          {(section.paragraphs ?? []).map((paragraph, i) => <Text key={i} style={styles.body}>{paragraph}</Text>)}
        </View>
      ))}
      <Check checked={openAck} onPress={() => setOpenAck(!openAck)} label={doc.acknowledgementText} />
      <Primary label="Confirmar o texto atualizado" onPress={() => void reconfirm()} disabled={!openAck} busy={busy === 'reconfirm'} />
    </View>
  ) : null;

  const permissionsSection = (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Privacidade e permissões</Text>
      <Text style={styles.body}>
        Você controla como seus dados Amazfit são utilizados no Panzeri Run. Pode retirar uma autorização quando desejar. A revogação interrompe os novos tratamentos relacionados àquela finalidade e será aplicada aos dados e resultados já existentes conforme a Política de Privacidade e as obrigações legais.
      </Text>
      {!permissions.connected ? <Text style={styles.hint}>Conecte sua conta Zepp para ver e gerenciar as autorizações.</Text> : (
        <>
          {row('activity', 'group', groupState('activity')?.granted ?? false)}
          {groupState('activity')?.granted ? (
            <>
              {row('sensors', 'group', groupState('sensors')?.granted ?? false, { indent: true })}
              {row('route', 'group', groupState('route')?.granted ?? false, { indent: true })}
            </>
          ) : null}
          {row('sleep', 'group', groupState('sleep')?.granted ?? false)}
          {row('daily', 'group', groupState('daily')?.granted ?? false)}
          {row('hrv', 'group', groupState('hrv')?.granted ?? false)}
          {row(HISTORY, 'purpose', history2?.granted ?? false, { sub: history2?.grantedAt ? `desde ${dateBr(history2.grantedAt)}` : undefined })}
          {row(WATCH, 'purpose', watch?.granted ?? false, { sub: watch?.grantedAt ? `desde ${dateBr(watch.grantedAt)} · versão ${watch.grantedVersion}` : undefined, needsNew: watch?.needsNewAuthorization, available: watch?.available })}
          {row(ATLAS, 'purpose', atlas?.granted ?? false, { sub: atlas?.grantedAt ? `desde ${dateBr(atlas.grantedAt)} · versão ${atlas.grantedVersion}` : undefined, needsNew: atlas?.needsNewAuthorization, available: atlas?.available })}

          <Pressable onPress={() => setShowLog(!showLog)} accessibilityRole="button"><Text style={styles.link}>{showLog ? 'Ocultar' : 'Ver'} histórico das minhas autorizações</Text></Pressable>
          {showLog ? (permissions.log.length === 0 ? <Text style={styles.hint}>Nenhuma decisão registrada ainda.</Text> : permissions.log.map((entry, index) => (
            <Text key={index} style={styles.hint}>
              {dateBr(entry.at)} · {entry.kind === 'connection' ? 'Conexão da conta Zepp' : ITEM_LABEL[entry.id ?? ''] ?? entry.id} · {entry.decision === 'granted' ? 'autorizada' : 'retirada'}{entry.version ? ` · texto v${entry.version}` : ''}
            </Text>
          ))) : null}

          {confirmDisconnect ? (
            <View style={styles.confirmBox}>
              <Text style={styles.body}>Desconectar interrompe novas importações e envios, revoga a autorização na Zepp (o que remove da sua conta Zepp os treinos que o Panzeri Run havia enviado) e invalida os resultados de IA feitos com esses dados. Não apaga o que já foi importado: para isso use “Solicitar exclusão dos meus dados Zepp”.</Text>
              <Primary label="Confirmar desconexão" onPress={() => void disconnect()} busy={busy === 'disconnect'} />
              <Outline label="Cancelar" onPress={() => setConfirmDisconnect(false)} />
            </View>
          ) : <Outline label="Desconectar minha conta Zepp" danger onPress={() => { setConfirmDisconnect(true); setConfirmDelete(false); }} />}
        </>
      )}

      {confirmDelete ? (
        <View style={styles.confirmBox}>
          <Text style={styles.permLabel}>Antes de excluir, saiba o que acontece</Text>
          <Text style={styles.body}>O que será apagado: o registro das atividades recebidas da Zepp, as amostras e séries (inclusive o percurso GPS), os vínculos dessas atividades com os seus treinos, os resumos de sono, saúde diária e HRV, o registro dos treinos enviados ao relógio e os indicadores e relatórios derivados desses dados. Se a conta estiver conectada, ela será desconectada primeiro.</Text>
          <Text style={styles.body}>O que pode ser mantido: as informações que você mesmo registrou (como esforço percebido, dor e observações, sem os valores que vieram da Zepp); registros de pagamento e de auditoria, sem identificação direta; um registro mínimo e criptografado da exclusão, guardado por 1 ano; e as cópias de segurança, que são substituídas pela nossa rotina sem prazo exato (conforme a Política de Privacidade).</Text>
          <Text style={styles.body}>Consequências: as atividades da Zepp deixam de aparecer no seu histórico, na comparação entre treinos planejados e realizados e nos gráficos de volume e aderência. Treinos que estavam vinculados a elas voltam a aparecer como sem registro. Não é possível desfazer.</Text>
          <Primary label="Excluir os dados da Zepp" onPress={() => void requestDeletion()} busy={busy === 'delete'} />
          <Outline label="Cancelar" onPress={() => setConfirmDelete(false)} />
        </View>
      ) : <Outline label="Solicitar exclusão dos meus dados Zepp" danger onPress={() => { setConfirmDelete(true); setConfirmDisconnect(false); }} />}

      <Text style={styles.hint}>
        <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text>{'  ·  '}<Text style={styles.link} onPress={() => void Linking.openURL(termsUrl)}>Termos de Uso</Text>
      </Text>
      {messageView}
    </View>
  );

  if (variant === 'manage') return <>{reviewCard}{permissionsSection}</>;

  // ── Conexao ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (!permissions.connected) {
    const selectableGroupIds = doc.groups.filter((group) => !group.required).map((group) => group.id);
    const toggle = (id: string) => setSelectedGroups((current) => {
      if (current.includes(id)) {
        // retirar "Atividades" retira sensores e GPS, que dependem dela
        return current.filter((item) => item !== id && !(id === 'activity' && ['sensors', 'route'].includes(item)));
      }
      return [...current, id];
    });
    return (
      <View style={{ gap: 16 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{doc.title}</Text>
          <Text style={styles.body}>{doc.intro}</Text>
          {doc.sections.map((section, index) => (
            <View key={index} style={{ gap: 6 }}>
              {section.heading ? <Text style={styles.permLabel}>{section.heading}</Text> : null}
              {(section.paragraphs ?? []).map((paragraph, i) => <Text key={i} style={styles.body}>{paragraph}</Text>)}
              {(section.bullets ?? []).map((bullet, i) => <Text key={`b${i}`} style={styles.body}>• {bullet}</Text>)}
            </View>
          ))}
          <Text style={styles.permLabel}>Quais dados você quer compartilhar?</Text>
          <Text style={styles.hint}>A identificação da conta é necessária apenas para vincular a conexão. Os demais grupos são opcionais e começam desmarcados.</Text>
          {/* Atalho do ALUNO (nada vem marcado): marca ou desmarca todos os grupos disponiveis de uma vez. As autorizacoes do relogio e do Atlas continuam separadas, depois de conectar. */}
          <Pressable
            onPress={() => setSelectedGroups(selectedGroups.length === selectableGroupIds.length ? [] : selectableGroupIds)}
            accessibilityRole="button"
          >
            <Text style={styles.link}>{selectedGroups.length === selectableGroupIds.length ? 'Desmarcar todos os grupos' : 'Marcar todos os grupos'}</Text>
          </Pressable>
          {doc.groups.filter((group) => !group.required).map((group) => {
            const dependsOn = group.requires ?? [];
            const blockedBy = dependsOn.some((id) => !selectedGroups.includes(id));
            return <Check key={group.id} checked={selectedGroups.includes(group.id)} onPress={() => toggle(group.id)} disabled={blockedBy} label={`${group.label}, ${group.description}`} />;
          })}
          <Text style={styles.permLabel}>Autorização obrigatória para importar os dados selecionados</Text>
          <Check checked={acknowledged} onPress={() => setAcknowledged(!acknowledged)} label={doc.acknowledgementText} />
          <Text style={styles.permLabel}>Autorização opcional para histórico</Text>
          <Check checked={history} onPress={() => setHistory(!history)} label={optionById(HISTORY)?.label ?? ''} />
          <Text style={styles.hint}>Versão {doc.version} de {doc.dateLabel}. <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text></Text>
          <Primary label={doc.confirmButtonLabel} onPress={() => void connect()} disabled={!acknowledged} busy={busy === 'connect'} />
          {messageView}
        </View>
        {permissionsSection}
      </View>
    );
  }

  // ── Conectado ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const pendingOptional = [!watch?.granted ? 'envio de treinos ao relógio' : null, !atlas?.granted ? 'análise com o Atlas' : null].filter((x): x is string => x !== null);
  return (
    <View style={{ gap: 16 }}>
      {pendingOptional.length > 0 ? (
        <View style={[styles.card, { borderColor: PRColors.warning }]}>
          <Text style={[styles.cardTitle, { color: PRColors.warning }]}>Falta pouco para terminar</Text>
          <Text style={styles.body}>Sua conta está conectada. Ainda faltam duas autorizações opcionais, cada uma na sua tela logo abaixo: {pendingOptional.join(' e ')}. Sem elas, o Panzeri Run não envia treinos ao seu relógio nem usa seus dados na análise personalizada.</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        {reviewCard}
        <Text style={styles.cardTitle}>Conta Zepp conectada</Text>
        <Text style={styles.body}>
          {['activity', 'sleep', 'daily', 'hrv'].some((id) => groupState(id)?.granted)
            ? 'Os dados do seu Amazfit que você autorizou chegam ao Panzeri Run conforme as autorizações abaixo.'
            : 'Sua conta está conectada, mas nenhum grupo de dados está autorizado. Autorize em “Privacidade e permissões” quando quiser.'}
        </Text>
        {messageView}
      </View>
      {!watch?.granted ? purposeCard(WATCH) : <WatchWorkoutsCard accessToken={accessToken} apiUrl={apiUrl} grantedAt={watch.grantedAt} />}
      {!atlas?.granted ? purposeCard(ATLAS) : <View style={styles.card}><Text style={styles.cardTitle}>Atlas</Text><Text style={styles.body}>Análise com o Atlas autorizada desde {dateBr(atlas.grantedAt)}. Você pode retirar em “Privacidade e permissões”.</Text></View>}
      {permissionsSection}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10 },
  cardTitle: { color: '#111827', fontSize: 18, fontWeight: '800' },
  body: { color: '#1f2937', fontSize: 14, lineHeight: 20 },
  hint: { color: '#475569', fontSize: 13, lineHeight: 18 },
  link: { color: PRColors.ocean, fontWeight: '700' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  checkText: { flex: 1, color: '#1f2937', fontSize: 14, lineHeight: 20 },
  primary: { minHeight: 48, borderRadius: 8, backgroundColor: PRColors.ocean, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: '#ffffff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  outline: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: PRColors.ocean, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  outlineText: { color: PRColors.ocean, fontWeight: '800', fontSize: 14, textAlign: 'center' },
  permRow: { gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#e5edf2' },
  permLabel: { color: '#111827', fontSize: 14, fontWeight: '800' },
  permStatus: { fontSize: 12, fontWeight: '700' },
  confirmBox: { gap: 10, borderRadius: 8, backgroundColor: '#f8fafc', padding: 12 },
});
