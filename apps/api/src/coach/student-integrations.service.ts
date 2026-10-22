import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isConnectionConsentCurrent, isPurposeCurrent } from '../provider-hub/provider-consent.service';
import { ZEPP_CONSENT } from '../zepp/zepp-consent';
import { EXTERNAL_AI_APPROVED_PROVIDERS } from '../ai-governance/ai-data-eligibility.service';
import { profileIsConfirmed } from '../zepp/zepp-workout-publisher.service';
import { ZEPP_WORKOUT_PROFILE } from '../zepp/zepp-workout-profile';
import { HEALTH_CONNECT_CONSENT } from '../health-connect/health-connect-consent';
import { LEGACY_CONSENT_DOCUMENTS } from '../legacy-consent/legacy-consent';

// Painel do treinador — Aluno > Integracoes (21/10/2026). SOMENTE CONSULTA do estado REAL das integracoes da aluna, reaproveitando as tabelas de conexao e de recebimento que ja existem
// (nenhum segundo sistema de integracoes, nenhum fluxo de conexao alterado). Distingue CONTA CONECTADA de DADO EFETIVAMENTE RECEBIDO: "conectada" vem da conexao; "recebeu dados" vem dos
// registros que de fato chegaram (com data do ultimo recebimento). Nada e' inventado: sem registro = "nunca recebeu"/"nao ha". O treinador nunca concede consentimento aqui.
//
// SEGURANCA: nenhum token, segredo, identificador de conta do provedor, URL de download ou texto bruto de erro sai daqui. A consulta seleciona so' colunas de estado; mensagens de falha
// sao TRADUZIDAS para texto compreensivel (o erro bruto da fila nunca e' exibido). Strava: por regra da propria politica de dados, o treinador ve' so' que a conta esta conectada.

export type IntegrationState = 'connected' | 'disconnected' | 'expired' | 'error' | 'not_connected' | 'data_only';

export const STATE_LABEL: Record<IntegrationState, string> = {
  connected: 'Conectada',
  disconnected: 'Desconectada',
  expired: 'Autorização expirada',
  error: 'Com erro',
  not_connected: 'Nunca conectou',
  data_only: 'Dados recebidos, sem registro de conexão',
};

export interface IntegrationCategoryView {
  id: string;
  label: string;
  // 'recebe' = dado que chega do provedor; 'envia' = o Panzeri Run envia ao provedor (treinos).
  direction: 'recebe' | 'envia';
  // true/false = autorizacao registrada pela aluna; null = a integracao nao tem autorizacao por categoria registrada no servidor.
  authorized: boolean | null;
  // Recebimento efetivo (direction 'recebe') ou ultimo envio ACEITO pela plataforma (direction 'envia'; nao significa que o relogio recebeu).
  lastAt: string | null;
  count: number | null;
  note?: string;
  // Diagnostico por camadas (hoje so' no envio de treinos ao relogio): cada verificacao com o seu proprio resultado (true/false; null = nao verificavel pelo painel).
  checks?: IntegrationCheckView[];
}

export interface IntegrationCheckView {
  label: string;
  ok: boolean | null;
  detail: string;
}

export interface IntegrationFailureView {
  at: string;
  message: string;
  // Quantos eventos com a mesma causa, e se o sistema ainda esta tentando ('retrying') ou desistiu ('gave_up').
  count: number;
  status: 'retrying' | 'gave_up';
}

export interface IntegrationAtlasView {
  applies: boolean;
  // true/false = autorizacao SEPARADA da importacao; null = integracao anterior ao consentimento por finalidade (sem autorizacao especifica registrada).
  authorized: boolean | null;
  needsNewAuthorization: boolean;
  since: string | null;
  systemEnabled: boolean | null;
  note: string;
}

export interface StudentIntegrationView {
  provider: string;
  name: string;
  state: IntegrationState;
  stateLabel: string;
  connectedSince: string | null;
  disconnectedAt: string | null;
  lastSyncAt: string | null;
  // De onde vem a "ultima sincronizacao": conclusao registrada pela integracao ou o ultimo dado/evento processado (nunca uma data presumida).
  lastSyncBasis: 'sincronizacao_concluida' | 'ultimo_evento_processado' | 'ultimo_dado_recebido' | null;
  categories: IntegrationCategoryView[];
  atlas: IntegrationAtlasView;
  failures: IntegrationFailureView[];
  warnings: string[];
}

export interface StudentIntegrationsResult {
  studentId: string;
  generatedAt: string;
  integrations: StudentIntegrationView[];
}

// ── Dados brutos (so' colunas de estado) ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ReceiptStat { lastAt: Date | null; count: number }
export interface IntegrationsRaw {
  polar: { createdAt: Date; disconnectedAt: Date | null; lastSyncCompletedAt: Date | null } | null;
  wahoo: { createdAt: Date; disconnectedAt: Date | null; lastSyncCompletedAt: Date | null; accessTokenExpiresAt: Date | null; hasRefreshToken: boolean } | null;
  strava: { createdAt: Date } | null;
  zepp: {
    createdAt: Date; disconnectedAt: Date | null; lastSyncCompletedAt: Date | null; accessTokenExpiresAt: Date | null; hasRefreshToken: boolean;
    grantedCategories: unknown; grantedPurposes: unknown; purposeConsents: unknown; consentVersion: string | null; consentTextHash: string | null;
  } | null;
  // Recebimento de atividades por provedor (RawExternalActivity).
  activityByProvider: Record<string, ReceiptStat>;
  zepp_activity_sensors: ReceiptStat;
  zepp_activity_route: ReceiptStat;
  zepp_sleep: ReceiptStat;
  zepp_daily: ReceiptStat;
  zepp_resting_hr: ReceiptStat;
  zepp_hrv: ReceiptStat;
  // Configuracao tecnica do publicador de treinos (servidor), lida do ambiente; ausente (testes antigos) => nao informada.
  zeppWatch?: { publishingEnabled: boolean; unitProfileConfirmed: boolean };
  // Health Connect (22/10/2026): autorizacoes gravadas no servidor (a conexao em si e' do aparelho) e o que chegou, por CATEGORIA de consentimento. Ausente => so' o que ja' existia (dados sem registro).
  healthConnect?: { createdAt: Date; disconnectedAt: Date | null; grantedCategories: unknown; grantedPurposes: unknown; purposeConsents: unknown; consentVersion: string | null; consentTextHash: string | null } | null;
  hcReceipts?: Record<string, ReceiptStat>;
  // Decisao da aluna sobre o Atlas para Polar/Wahoo ja' conectadas (so' existe depois que ela responde).
  legacyConsent?: Partial<Record<'polar' | 'wahoo', { disconnectedAt: Date | null; grantedPurposes: unknown; purposeConsents: unknown } | null>>;
  zeppLastProcessedEventAt: Date | null;
  zeppWorkoutLastAcceptedAt: Date | null;
  inboundFailures: Array<{ provider: string; eventType: string; status: string; lastError: string | null; updatedAt: Date }>;
  zeppWorkoutFailures: Array<{ errorMessage: string | null; failedAt: Date | null; requestedAt: Date }>;
}

const EMPTY: ReceiptStat = { lastAt: null, count: 0 };
const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const stat = (value: ReceiptStat | undefined): ReceiptStat => value ?? EMPTY;
const PROVIDER_NAME: Record<string, string> = { zepp: 'Zepp / Amazfit', strava: 'Strava', polar: 'Polar', wahoo: 'Wahoo', apple_health: 'Apple Saúde', health_connect: 'Health Connect (Android)' };
const EVENT_LABEL: Record<string, string> = { activity_file: 'uma atividade', sleep_summary: 'um registro de sono', daily_summary: 'um resumo diário', hrv_summary: 'um registro de HRV', metric_summary: 'um indicador de saúde', authorization_change: 'um aviso de autorização' };

// Traducao do motivo tecnico (texto interno da fila) para algo que o treinador entende. O texto bruto NUNCA e' exibido.
export function describeFailure(eventType: string, lastError: string | null): string {
  const what = EVENT_LABEL[eventType] ?? 'um evento';
  const reason = (lastError ?? '').toLowerCase();
  if (reason.includes('token')) return `Não foi possível renovar a autorização com a plataforma ao processar ${what}. A aluna pode precisar reconectar.`;
  if (reason.includes('download falhou')) return `Falha temporária ao baixar o arquivo de ${what} na plataforma.`;
  if (reason.includes('arquivo indisponivel') || reason.includes('expired') || reason.includes('not_found')) return `O arquivo de ${what} expirou na plataforma antes de ser baixado.`;
  if (reason.includes('fit nao aproveitavel')) return `O arquivo de ${what} veio num formato que não pôde ser lido.`;
  if (reason.includes('recuperacao pelo backfill')) return `O arquivo de ${what} expirou e a recuperação pela plataforma não pôde ser concluída agora.`;
  if (reason.includes('nenhum conector')) return `Não há processamento disponível para ${what}.`;
  return `Falha ao processar ${what}. O sistema registra o evento para análise técnica.`;
}

function describeDeliveryFailure(message: string | null): string {
  const text = (message ?? '').toLowerCase();
  if (text.startsWith('auth') || text.includes('token')) return 'O envio do treino ao relógio falhou: a autorização com a Zepp precisa ser renovada.';
  if (text.startsWith('server') || text.includes('500')) return 'O envio do treino ao relógio falhou: a Zepp não processou o pedido agora.';
  if (text.startsWith('network')) return 'O envio do treino ao relógio falhou: sem comunicação com a Zepp.';
  return 'O envio de um treino ao relógio falhou.';
}

function groupFailures(provider: string, raw: IntegrationsRaw): IntegrationFailureView[] {
  const groups = new Map<string, IntegrationFailureView>();
  for (const failure of raw.inboundFailures.filter((f) => f.provider === provider)) {
    const message = describeFailure(failure.eventType, failure.lastError);
    const status = failure.status === 'dead' ? 'gave_up' : 'retrying';
    const key = `${status}|${message}`;
    const existing = groups.get(key);
    if (existing) { existing.count += 1; if (failure.updatedAt.toISOString() > existing.at) existing.at = failure.updatedAt.toISOString(); }
    else groups.set(key, { at: failure.updatedAt.toISOString(), message, count: 1, status });
  }
  return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

const noAtlasRule = (note: string): IntegrationAtlasView => ({ applies: true, authorized: null, needsNewAuthorization: false, since: null, systemEnabled: null, note });
const LEGACY_ATLAS_NOTE = 'Esta integração é anterior ao consentimento por finalidade: não há autorização específica para o Atlas registrada. Resumos derivados das atividades podem fazer parte do contexto da IA, como informado na Política de Privacidade.';

function stateFor(opts: { connected: boolean; disconnected: boolean; hasData: boolean; expired: boolean; gaveUp: boolean }): IntegrationState {
  if (opts.disconnected) return 'disconnected';
  if (!opts.connected) return opts.hasData ? 'data_only' : 'not_connected';
  if (opts.expired) return 'expired';
  if (opts.gaveUp) return 'error';
  return 'connected';
}

function tokenExpired(now: Date, expiresAt: Date | null, hasRefresh: boolean): boolean {
  // Expirada = o token de acesso venceu e NAO ha como renova-lo sozinho. Token vencido com renovacao disponivel e' normal (renova ao usar).
  return expiresAt !== null && expiresAt.getTime() < now.getTime() && !hasRefresh;
}

function legacyEntry(provider: 'polar' | 'wahoo' | 'apple_health' | 'health_connect', raw: IntegrationsRaw, now: Date): StudentIntegrationView | null {
  const receipt = stat(raw.activityByProvider[provider]);
  const connection = provider === 'polar' ? raw.polar : provider === 'wahoo' ? raw.wahoo : null;
  if (!connection && receipt.count === 0) return null; // sem conexao e sem nenhum dado: nao ha o que mostrar (nada inventado)
  const failures = groupFailures(provider, raw);
  const expired = provider === 'wahoo' && raw.wahoo ? tokenExpired(now, raw.wahoo.accessTokenExpiresAt, raw.wahoo.hasRefreshToken) : false;
  const state = stateFor({ connected: Boolean(connection) && !connection!.disconnectedAt, disconnected: Boolean(connection?.disconnectedAt), hasData: receipt.count > 0, expired, gaveUp: failures.some((f) => f.status === 'gave_up') });
  const warnings: string[] = [];
  if (state === 'connected' && receipt.count === 0) warnings.push('Conta conectada, mas nenhuma atividade foi recebida ainda.');
  if (state === 'data_only') warnings.push('Não há registro de conexão no servidor (a autorização é feita no próprio celular da aluna); só é possível ver o que já chegou.');
  const completed = connection && 'lastSyncCompletedAt' in connection ? connection.lastSyncCompletedAt : null;
  return {
    provider,
    name: PROVIDER_NAME[provider],
    state,
    stateLabel: STATE_LABEL[state],
    connectedSince: iso(connection?.createdAt),
    disconnectedAt: iso(connection?.disconnectedAt),
    lastSyncAt: iso(completed ?? receipt.lastAt),
    lastSyncBasis: completed ? 'sincronizacao_concluida' : receipt.lastAt ? 'ultimo_dado_recebido' : null,
    categories: [{ id: 'activity', label: 'Atividades (corridas e treinos)', direction: 'recebe', authorized: connection ? !connection.disconnectedAt : null, lastAt: iso(receipt.lastAt), count: receipt.count, ...(connection ? {} : { note: 'Sem registro de autorização no servidor.' }) }],
    atlas: legacyAtlasView(provider, raw),
    failures,
    warnings,
  };
}

// Atlas para Polar/Wahoo: sem decisao da aluna = comportamento anterior; com decisao = o que ela escolheu (autorizou, nao autorizou/retirou, ou texto desatualizado).
function legacyAtlasView(provider: 'polar' | 'wahoo' | 'apple_health' | 'health_connect', raw: IntegrationsRaw): IntegrationAtlasView {
  if (provider !== 'polar' && provider !== 'wahoo') return noAtlasRule(LEGACY_ATLAS_NOTE);
  const row = raw.legacyConsent?.[provider];
  if (!row || row.disconnectedAt) {
    return { ...noAtlasRule(LEGACY_ATLAS_NOTE), note: 'A aluna ainda não respondeu sobre o uso pelo Atlas. Enquanto isso vale o comportamento anterior (resumos derivados das atividades podem compor o contexto da IA, como informado na Política). Ela vê o pedido em Dispositivos e integrações.' };
  }
  const doc = LEGACY_CONSENT_DOCUMENTS[provider];
  const purposes = Array.isArray(row.grantedPurposes) ? (row.grantedPurposes as unknown[]) : [];
  const listed = purposes.includes('ai_external');
  const current = listed && isPurposeCurrent(doc, 'ai_external', row.purposeConsents);
  const record = (row.purposeConsents as Record<string, { grantedAt?: string }> | null)?.ai_external;
  return {
    applies: true, authorized: current, needsNewAuthorization: listed && !current, since: current && record?.grantedAt ? record.grantedAt : null, systemEnabled: null,
    note: current ? 'A aluna autorizou o uso das atividades pelo Atlas (autorização separada da importação).'
      : listed ? 'A autorização do Atlas foi dada sobre uma versão anterior do texto e precisa ser renovada: hoje não vale.'
      : 'A aluna NÃO autorizou o uso pelo Atlas: as atividades desse provedor não são enviadas à IA (a importação continua).',
  };
}

function zeppEntry(raw: IntegrationsRaw, now: Date, externalAiUnlocked: boolean): StudentIntegrationView | null {
  const z = raw.zepp;
  const activity = stat(raw.activityByProvider.zepp);
  const hasData = activity.count > 0 || [raw.zepp_sleep, raw.zepp_daily, raw.zepp_hrv].some((s) => s.count > 0);
  if (!z && !hasData) return null;
  const failures = groupFailures('zepp', raw);
  for (const failed of raw.zeppWorkoutFailures) failures.push({ at: (failed.failedAt ?? failed.requestedAt).toISOString(), message: describeDeliveryFailure(failed.errorMessage), count: 1, status: 'gave_up' });
  failures.sort((a, b) => (a.at < b.at ? 1 : -1));
  const granted = new Set<string>(Array.isArray(z?.grantedCategories) ? (z!.grantedCategories as unknown[]).filter((c): c is string => typeof c === 'string') : []);
  const purposes = new Set<string>(Array.isArray(z?.grantedPurposes) ? (z!.grantedPurposes as unknown[]).filter((c): c is string => typeof c === 'string') : []);
  const active = Boolean(z) && !z!.disconnectedAt;
  const consentCurrent = z ? isConnectionConsentCurrent(ZEPP_CONSENT, z) : true;
  // Texto da conexao mudou: as categorias deixam de valer (so' a conta segue) ate a aluna confirmar de novo.
  const effective = (id: string) => active && consentCurrent && granted.has(id);
  const expired = z ? tokenExpired(now, z.accessTokenExpiresAt, z.hasRefreshToken) : false;
  const state = stateFor({ connected: active, disconnected: Boolean(z?.disconnectedAt), hasData, expired, gaveUp: failures.some((f) => f.status === 'gave_up') });

  const category = (id: string, label: string, categoryIds: string[], receipt: ReceiptStat): IntegrationCategoryView => ({
    id, label, direction: 'recebe',
    authorized: z ? categoryIds.every((c) => effective(c)) : null,
    lastAt: iso(receipt.lastAt), count: receipt.count,
  });
  const watchAuthorized = active && purposes.has('watch_delivery') && isPurposeCurrent(ZEPP_CONSENT, 'watch_delivery', z!.purposeConsents);
  // Envio de treinos ao relogio: camadas SEPARADAS. A Zepp nao usa escopos no OAuth (so' o login da aluna); a autorizacao de enviar treinos e' a finalidade propria
  // 'watch_delivery' (tela separada, depois de conectar) — a conexao sozinha NUNCA a concede.
  const watchPurposeGranted = purposes.has('watch_delivery');
  const watchChecks: IntegrationCheckView[] = [
    { label: 'Aplicativo habilitado pela Zepp', ok: null, detail: 'Habilitação do Panzeri Run junto à Zepp (contrato). O painel não consegue consultá-la; o primeiro envio real a confirma.' },
    { label: 'Publicador ligado no servidor', ok: raw.zeppWatch ? raw.zeppWatch.publishingEnabled : null, detail: raw.zeppWatch ? (raw.zeppWatch.publishingEnabled ? 'ZEPP_WORKOUT_PUBLISH_ENABLED está ligada.' : 'ZEPP_WORKOUT_PUBLISH_ENABLED está desligada: nenhum treino é enviado a ninguém.') : 'Não informado.' },
    { label: 'Perfil de unidades da Workout V2', ok: raw.zeppWatch ? raw.zeppWatch.unitProfileConfirmed : null, detail: raw.zeppWatch ? (raw.zeppWatch.unitProfileConfirmed ? 'Confirmado.' : 'Não confirmado: o envio permanece bloqueado.') : 'Não informado.' },
    { label: 'Conexão da aluna ativa', ok: active && !expired, detail: !z ? 'A aluna não conectou a Zepp.' : !active ? 'A aluna desconectou a Zepp.' : expired ? 'A autorização com a Zepp expirou; a aluna precisa reconectar.' : 'Conectada.' },
    {
      label: 'Autorização da aluna para enviar treinos', ok: z ? watchAuthorized : null,
      detail: !z ? 'Sem conexão.' : watchAuthorized ? 'A aluna autorizou “Enviar meus treinos ao relógio”.'
        : !watchPurposeGranted ? 'A aluna ainda não concedeu a autorização própria “Enviar meus treinos ao relógio” (tela separada, oferecida depois de conectar). Conectar a Zepp, por si só, não autoriza o envio.'
          : 'A autorização foi dada sobre um texto antigo; a aluna precisa autorizar de novo na tela atual.',
    },
  ];
  const categories: IntegrationCategoryView[] = [
    category('activity', 'Atividades', ['activity'], activity),
    category('activity_sensors', 'Frequência cardíaca, cadência, potência e elevação', ['activity_sensors'], stat(raw.zepp_activity_sensors)),
    category('activity_route', 'Percurso GPS', ['activity_route'], stat(raw.zepp_activity_route)),
    category('sleep', 'Sono e recuperação', ['sleep'], stat(raw.zepp_sleep)),
    category('daily', 'Saúde diária (passos, distância e calorias do dia)', ['daily_activity'], stat(raw.zepp_daily)),
    category('resting_heart_rate', 'Frequência cardíaca de repouso', ['resting_heart_rate'], stat(raw.zepp_resting_hr)),
    category('hrv', 'Variabilidade da frequência cardíaca (HRV)', ['hrv'], stat(raw.zepp_hrv)),
    {
      id: 'watch_delivery', label: 'Envio de treinos ao relógio', direction: 'envia', authorized: z ? watchAuthorized : null,
      lastAt: iso(raw.zeppWorkoutLastAcceptedAt), count: null, note: 'Mostra o último envio aceito pela Zepp; isso não confirma que o relógio já recebeu o treino.', checks: watchChecks,
    },
  ];

  const warnings: string[] = [];
  if (z && active && !consentCurrent) warnings.push('O texto da conexão mudou: a importação está suspensa até a aluna confirmar o texto atualizado no aplicativo.');
  if (z && active && consentCurrent && !['activity', 'activity_sensors', 'activity_route', 'sleep', 'daily_activity', 'resting_heart_rate', 'hrv'].some((c) => granted.has(c))) warnings.push('Conta conectada, mas a aluna não autorizou nenhuma categoria de dados: nada é importado.');
  for (const c of categories) if (c.direction === 'recebe' && c.authorized && c.count === 0) warnings.push(`Autorizada, mas ainda sem dados recebidos: ${c.label}.`);
  if (state === 'data_only') warnings.push('Há dados da Zepp, mas não há conexão ativa registrada.');

  const record = z && purposes.has('ai_external') ? (z.purposeConsents as Record<string, { grantedAt?: string; version?: string }> | null)?.ai_external : undefined;
  const aiGranted = active && purposes.has('ai_external');
  const aiCurrent = aiGranted && isPurposeCurrent(ZEPP_CONSENT, 'ai_external', z!.purposeConsents);
  const atlas: IntegrationAtlasView = {
    applies: true,
    authorized: z ? aiCurrent : null,
    needsNewAuthorization: Boolean(aiGranted && !aiCurrent),
    since: aiCurrent && record?.grantedAt ? record.grantedAt : null,
    systemEnabled: externalAiUnlocked,
    note: !z ? 'Sem conexão registrada.'
      : aiCurrent ? (externalAiUnlocked ? 'A aluna autorizou o uso dos dados Zepp pelo Atlas (autorização separada da importação).' : 'A aluna autorizou o uso pelo Atlas, mas o envio a IA externa ainda não está ligado no sistema: nada é enviado.')
      : aiGranted ? 'A autorização do Atlas foi dada sobre uma versão anterior do texto e precisa ser renovada: hoje não vale.'
      : 'A aluna não autorizou o uso dos dados Zepp pelo Atlas: esses dados não são enviados à IA.',
  };

  const lastSyncAt = z?.lastSyncCompletedAt ?? raw.zeppLastProcessedEventAt ?? null;
  return {
    provider: 'zepp', name: PROVIDER_NAME.zepp, state, stateLabel: STATE_LABEL[state],
    connectedSince: iso(z?.createdAt), disconnectedAt: iso(z?.disconnectedAt),
    lastSyncAt: iso(lastSyncAt),
    lastSyncBasis: z?.lastSyncCompletedAt ? 'sincronizacao_concluida' : raw.zeppLastProcessedEventAt ? 'ultimo_evento_processado' : null,
    categories, atlas, failures, warnings,
  };
}

// Health Connect: so' aparece com as autorizacoes quando o aluno ja' registrou alguma (senao segue o caso "dados sem registro de conexao"). Conectada = autorizacoes ativas no servidor.
function healthConnectEntry(raw: IntegrationsRaw, externalAiUnlocked: boolean): StudentIntegrationView | null {
  const h = raw.healthConnect;
  if (!h) return null;
  const active = !h.disconnectedAt;
  const granted = new Set<string>(Array.isArray(h.grantedCategories) ? (h.grantedCategories as unknown[]).filter((c): c is string => typeof c === 'string') : []);
  const purposes = new Set<string>(Array.isArray(h.grantedPurposes) ? (h.grantedPurposes as unknown[]).filter((c): c is string => typeof c === 'string') : []);
  const consentCurrent = isConnectionConsentCurrent(HEALTH_CONNECT_CONSENT, h);
  const receipts = raw.hcReceipts ?? {};
  const activity = raw.activityByProvider.health_connect ?? EMPTY;
  const categories: IntegrationCategoryView[] = HEALTH_CONNECT_CONSENT.groups.map((group) => {
    const stats = group.categories.map((c) => (c === 'activity' ? activity : stat(receipts[c])));
    const lastAt = stats.reduce<Date | null>((latest, st) => (st.lastAt && (!latest || st.lastAt > latest) ? st.lastAt : latest), null);
    return {
      id: group.id, label: group.label, direction: 'recebe' as const,
      authorized: active && consentCurrent && group.categories.every((c) => granted.has(c)),
      lastAt: iso(lastAt), count: stats.reduce((sum, st) => sum + st.count, 0),
    };
  });
  const lastAt = categories.reduce<string | null>((latest, c) => (c.lastAt && (!latest || c.lastAt > latest) ? c.lastAt : latest), null);
  const warnings: string[] = ['A conexão com o Health Connect fica no celular da aluna: aqui aparecem as autorizações registradas no servidor e os dados que de fato chegaram.'];
  if (active && !consentCurrent) warnings.push('O texto das autorizações mudou: o compartilhamento está suspenso até a aluna confirmar o texto atualizado no aplicativo.');
  if (active && consentCurrent && !categories.some((c) => c.authorized)) warnings.push('A aluna não autorizou nenhuma categoria de dados: nada é recebido.');
  const pending = categories.filter((c) => c.authorized && c.count === 0).map((c) => c.label);
  if (pending.length > 0) warnings.push(`Autorizadas, mas ainda sem dados recebidos: ${pending.join('; ')}. Isso é esperado enquanto o aplicativo, o relógio ou o Android ainda não disponibilizam ou sincronizam essas categorias.`);
  const record = (h.purposeConsents as Record<string, { grantedAt?: string }> | null)?.ai_external;
  const aiListed = active && purposes.has('ai_external');
  const aiCurrent = aiListed && isPurposeCurrent(HEALTH_CONNECT_CONSENT, 'ai_external', h.purposeConsents);
  const state: IntegrationState = active ? 'connected' : 'disconnected';
  return {
    provider: 'health_connect', name: PROVIDER_NAME.health_connect, state, stateLabel: active ? 'Autorizações registradas' : STATE_LABEL.disconnected,
    connectedSince: iso(h.createdAt), disconnectedAt: iso(h.disconnectedAt), lastSyncAt: lastAt, lastSyncBasis: lastAt ? 'ultimo_dado_recebido' : null,
    categories,
    atlas: {
      applies: true, authorized: aiCurrent, needsNewAuthorization: Boolean(aiListed && !aiCurrent), since: aiCurrent && record?.grantedAt ? record.grantedAt : null, systemEnabled: externalAiUnlocked,
      note: aiCurrent ? (externalAiUnlocked ? 'A aluna autorizou o uso dos dados do Health Connect pelo Atlas (autorização separada).' : 'A aluna autorizou o uso pelo Atlas, mas o envio a IA externa ainda não está ligado no sistema: nada é enviado.')
        : aiListed ? 'A autorização do Atlas foi dada sobre uma versão anterior do texto e precisa ser renovada: hoje não vale.'
        : 'A aluna não autorizou o uso dos dados do Health Connect pelo Atlas: esses dados não são enviados à IA.',
    },
    failures: [], warnings,
  };
}

function stravaEntry(raw: IntegrationsRaw): StudentIntegrationView | null {
  if (!raw.strava) return null;
  return {
    provider: 'strava', name: PROVIDER_NAME.strava, state: 'connected', stateLabel: STATE_LABEL.connected,
    connectedSince: iso(raw.strava.createdAt), disconnectedAt: null, lastSyncAt: null, lastSyncBasis: null,
    categories: [],
    atlas: { applies: false, authorized: null, needsNewAuthorization: false, since: null, systemEnabled: null, note: 'Dados do Strava nunca são enviados à IA.' },
    failures: [],
    warnings: ['Por regra de privacidade, os dados do Strava aparecem só para a aluna: o painel mostra apenas que a conta está conectada.'],
  };
}

export function buildStudentIntegrations(studentId: string, raw: IntegrationsRaw, now: Date, externalAiUnlocked: boolean, healthConnectAiUnlocked = false): StudentIntegrationsResult {
  const entries = [zeppEntry(raw, now, externalAiUnlocked), stravaEntry(raw), legacyEntry('polar', raw, now), legacyEntry('wahoo', raw, now), legacyEntry('apple_health', raw, now), healthConnectEntry(raw, healthConnectAiUnlocked) ?? legacyEntry('health_connect', raw, now)]
    .filter((entry): entry is StudentIntegrationView => entry !== null);
  return { studentId, generatedAt: now.toISOString(), integrations: entries };
}

@Injectable()
export class StudentIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async forStudent(studentId: string): Promise<StudentIntegrationsResult> {
    const user = await this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!user) throw new NotFoundException('Aluno nao encontrado.');
    const now = new Date();
    const userId = studentId;
    const since30 = new Date(now.getTime() - 30 * 86_400_000);
    const since7 = new Date(now.getTime() - 7 * 86_400_000);

    const agg = async (query: Promise<{ _max: { receivedAt: Date | null }; _count: number }>): Promise<ReceiptStat> => {
      const result = await query;
      return { lastAt: result._max.receivedAt, count: result._count };
    };
    const zeppWhere = { userId, provider: 'zepp' };
    const [polar, wahoo, strava, zepp, raws, sensorsRow, sensorsCount, routeRow, routeCount, sleep, daily, restingHr, hrv, lastEvent, lastDelivery, failedEvents, failedDeliveries] = await Promise.all([
      // Somente colunas de ESTADO: nenhum token, segredo ou id da conta do provedor e' lido para ser exibido.
      this.prisma.polarConnection.findUnique({ where: { userId }, select: { createdAt: true, disconnectedAt: true, lastSyncCompletedAt: true } }),
      this.prisma.wahooConnection.findUnique({ where: { userId }, select: { createdAt: true, disconnectedAt: true, lastSyncCompletedAt: true, accessTokenExpiresAt: true, refreshTokenEncrypted: true } }),
      this.prisma.stravaConnection.findUnique({ where: { userId }, select: { createdAt: true } }),
      this.prisma.providerConnection.findUnique({
        where: { provider_userId: { provider: 'zepp', userId } },
        select: { createdAt: true, disconnectedAt: true, lastSyncCompletedAt: true, accessTokenExpiresAt: true, refreshTokenEncrypted: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true },
      }),
      this.prisma.rawExternalActivity.groupBy({ by: ['provider'], where: { userId }, _max: { receivedAt: true }, _count: { _all: true } }),
      this.prisma.activityLog.findFirst({ where: { userId, provider: 'zepp', OR: [{ avgHeartRateBpm: { not: null } }, { cadenceAvg: { not: null } }, { powerAvgWatts: { not: null } }, { elevationGainMeters: { not: null } }] }, orderBy: { startedAt: 'desc' }, select: { rawActivity: { select: { receivedAt: true } } } }),
      this.prisma.activityLog.count({ where: { userId, provider: 'zepp', OR: [{ avgHeartRateBpm: { not: null } }, { cadenceAvg: { not: null } }, { powerAvgWatts: { not: null } }, { elevationGainMeters: { not: null } }] } }),
      this.prisma.activityLog.findFirst({ where: { userId, provider: 'zepp', hasRoute: true }, orderBy: { startedAt: 'desc' }, select: { rawActivity: { select: { receivedAt: true } } } }),
      this.prisma.activityLog.count({ where: { userId, provider: 'zepp', hasRoute: true } }),
      agg(this.prisma.wearableSleepSummary.aggregate({ where: zeppWhere, _max: { receivedAt: true }, _count: true })),
      agg(this.prisma.wearableDailySummary.aggregate({ where: { ...zeppWhere, OR: [{ steps: { not: null } }, { distanceMeters: { not: null } }, { activeKilocalories: { not: null } }] }, _max: { receivedAt: true }, _count: true })),
      agg(this.prisma.wearableDailySummary.aggregate({ where: { ...zeppWhere, restingHeartRateBpm: { not: null } }, _max: { receivedAt: true }, _count: true })),
      agg(this.prisma.wearableHrvSummary.aggregate({ where: zeppWhere, _max: { receivedAt: true }, _count: true })),
      this.prisma.providerInboundEvent.findFirst({ where: { userId, provider: 'zepp', status: 'done' }, orderBy: { processedAt: 'desc' }, select: { processedAt: true } }),
      this.prisma.workoutDelivery.findFirst({ where: { provider: 'zepp_workout_v2', status: 'sent', trainingSession: { userId } }, orderBy: { requestedAt: 'desc' }, select: { providerMetadata: true, sentAt: true } }),
      this.prisma.providerInboundEvent.findMany({ where: { userId, OR: [{ status: 'dead', updatedAt: { gte: since30 } }, { status: 'failed', updatedAt: { gte: since7 } }] }, orderBy: { updatedAt: 'desc' }, take: 100, select: { provider: true, eventType: true, status: true, lastError: true, updatedAt: true } }),
      this.prisma.workoutDelivery.findMany({ where: { provider: 'zepp_workout_v2', status: 'failed', requestedAt: { gte: since7 }, trainingSession: { userId } }, orderBy: { requestedAt: 'desc' }, take: 20, select: { errorMessage: true, failedAt: true, requestedAt: true } }),
    ]);

    // Health Connect: autorizacoes (so' colunas de estado) e o que chegou por categoria.
    const hcWhere = { userId, provider: 'health_connect' };
    const hcSensorsWhere = { userId, provider: 'health_connect', OR: [{ avgHeartRateBpm: { not: null } }, { cadenceAvg: { not: null } }, { powerAvgWatts: { not: null } }, { elevationGainMeters: { not: null } }] };
    const [hcRow, hcSensorsRow, hcSensorsCount, hcSleep, hcDaily, hcResting, hcHrv, hcMetrics] = await Promise.all([
      this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider: 'health_connect', userId } }, select: { createdAt: true, disconnectedAt: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true } }),
      this.prisma.activityLog.findFirst({ where: hcSensorsWhere, orderBy: { startedAt: 'desc' }, select: { rawActivity: { select: { receivedAt: true } } } }),
      this.prisma.activityLog.count({ where: hcSensorsWhere }),
      agg(this.prisma.wearableSleepSummary.aggregate({ where: hcWhere, _max: { receivedAt: true }, _count: true })),
      agg(this.prisma.wearableDailySummary.aggregate({ where: { ...hcWhere, OR: [{ steps: { not: null } }, { distanceMeters: { not: null } }, { activeKilocalories: { not: null } }] }, _max: { receivedAt: true }, _count: true })),
      agg(this.prisma.wearableDailySummary.aggregate({ where: { ...hcWhere, restingHeartRateBpm: { not: null } }, _max: { receivedAt: true }, _count: true })),
      agg(this.prisma.wearableHrvSummary.aggregate({ where: hcWhere, _max: { receivedAt: true }, _count: true })),
      this.prisma.wearableMetricRecord.groupBy({ by: ['metricKind'], where: hcWhere, _max: { receivedAt: true }, _count: { _all: true } }),
    ]);
    const metricStat = (...kinds: string[]): ReceiptStat => {
      const rows = hcMetrics.filter((m) => kinds.includes(m.metricKind));
      return { lastAt: rows.reduce<Date | null>((latest, m) => (m._max.receivedAt && (!latest || m._max.receivedAt > latest) ? m._max.receivedAt : latest), null), count: rows.reduce((sum, m) => sum + m._count._all, 0) };
    };
    const hcReceipts: Record<string, ReceiptStat> = {
      activity_sensors: { lastAt: hcSensorsRow?.rawActivity.receivedAt ?? null, count: hcSensorsCount }, sleep: hcSleep, daily_activity: hcDaily, resting_heart_rate: hcResting, hrv: hcHrv,
      vo2_max: metricStat('vo2_max'), body_composition: metricStat('body_composition'), pulse_ox: metricStat('pulse_ox'), skin_temperature: metricStat('skin_temperature'), respiratory_rate: metricStat('respiratory_rate'), nutrition: metricStat('nutrition', 'hydration'),
    };

    // Decisao sobre o Atlas (so' colunas de estado): existe apenas depois que a aluna respondeu.
    const [polarConsentRow, wahooConsentRow] = await Promise.all([
      this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider: 'polar', userId } }, select: { disconnectedAt: true, grantedPurposes: true, purposeConsents: true } }),
      this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider: 'wahoo', userId } }, select: { disconnectedAt: true, grantedPurposes: true, purposeConsents: true } }),
    ]);

    const accepted = (lastDelivery?.providerMetadata as { windowAcceptedAt?: unknown } | null)?.windowAcceptedAt;
    const acceptedAt = typeof accepted === 'string' && !Number.isNaN(new Date(accepted).getTime()) ? new Date(accepted) : lastDelivery?.sentAt ?? null;
    const raw: IntegrationsRaw = {
      polar,
      wahoo: wahoo ? { createdAt: wahoo.createdAt, disconnectedAt: wahoo.disconnectedAt, lastSyncCompletedAt: wahoo.lastSyncCompletedAt, accessTokenExpiresAt: wahoo.accessTokenExpiresAt, hasRefreshToken: Boolean(wahoo.refreshTokenEncrypted) } : null,
      strava,
      zepp: zepp ? {
        createdAt: zepp.createdAt, disconnectedAt: zepp.disconnectedAt, lastSyncCompletedAt: zepp.lastSyncCompletedAt, accessTokenExpiresAt: zepp.accessTokenExpiresAt, hasRefreshToken: Boolean(zepp.refreshTokenEncrypted),
        grantedCategories: zepp.grantedCategories, grantedPurposes: zepp.grantedPurposes, purposeConsents: zepp.purposeConsents, consentVersion: zepp.consentVersion, consentTextHash: zepp.consentTextHash,
      } : null,
      activityByProvider: Object.fromEntries(raws.map((row) => [row.provider, { lastAt: row._max.receivedAt, count: row._count._all }])),
      zepp_activity_sensors: { lastAt: sensorsRow?.rawActivity.receivedAt ?? null, count: sensorsCount },
      zepp_activity_route: { lastAt: routeRow?.rawActivity.receivedAt ?? null, count: routeCount },
      zepp_sleep: sleep, zepp_daily: daily, zepp_resting_hr: restingHr, zepp_hrv: hrv,
      healthConnect: hcRow, hcReceipts, legacyConsent: { polar: polarConsentRow, wahoo: wahooConsentRow },
      zeppLastProcessedEventAt: lastEvent?.processedAt ?? null,
      zeppWorkoutLastAcceptedAt: acceptedAt,
      inboundFailures: failedEvents,
      zeppWorkoutFailures: failedDeliveries,
      zeppWatch: { publishingEnabled: this.config.get<string>('ZEPP_WORKOUT_PUBLISH_ENABLED')?.trim().toLowerCase() === 'true', unitProfileConfirmed: profileIsConfirmed(ZEPP_WORKOUT_PROFILE) },
    };
    const externalAiUnlocked = EXTERNAL_AI_APPROVED_PROVIDERS.includes('zepp') && this.config.get<string>('ZEPP_EXTERNAL_AI_ENABLED')?.trim().toLowerCase() === 'true';
    const healthConnectAiUnlocked = EXTERNAL_AI_APPROVED_PROVIDERS.includes('health_connect') && this.config.get<string>('HEALTH_CONNECT_EXTERNAL_AI_ENABLED')?.trim().toLowerCase() === 'true';
    return buildStudentIntegrations(studentId, raw, now, externalAiUnlocked, healthConnectAiUnlocked);
  }
}
