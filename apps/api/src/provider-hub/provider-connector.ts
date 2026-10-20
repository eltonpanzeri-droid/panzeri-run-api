// Central Universal de Integracoes — contrato de conector (Passo 1, 19/10/2026).
//
// Principio: um conector DECLARA so' o que o provedor de fato oferece. Todas as capacidades sao OPCIONAIS — nem todo provedor tem OAuth, webhook ou sync
// pull, e alguns so' recebem dados empurrados. O restante do app nunca depende do formato de um fabricante: o conector converte para o dominio canonico
// (RawExternalActivity/ActivityLog para atividades; futuramente observacoes de saude) e o resto do pipeline continua como esta.
//
// Fora de escopo deste contrato (de proposito): decidir o que PODE ser guardado. Cada conector filtra o payload ao que o contrato do provedor autoriza ANTES
// de entregar o evento (webhook.extract) — a fila nao armazena campo nao aprovado. Consentimento do aluno nao elimina restricao contratual do provedor.

// Categorias de dado que um conector pode trazer. A permissao/consentimento por categoria (futuro) se apoia neste vocabulario; declarar uma categoria
// aqui NAO autoriza seu uso — so' informa o que o conector e' capaz de entregar.
export const PROVIDER_DATA_CATEGORIES = ['activity', 'activity_route', 'activity_sensors', 'sleep', 'resting_heart_rate', 'daily_activity', 'profile'] as const;
export type ProviderDataCategory = (typeof PROVIDER_DATA_CATEGORIES)[number];

// ── Consentimento (Passo 2b) ────────────────────────────────────────────────────────────────────────────────────────
// Um provedor com OAuth NAO conecta sem um documento de consentimento: o texto, os grupos selecionaveis e as finalidades vem do conector, sao servidos ao
// cliente e o pedido de conexao precisa devolver versao + hash do texto exibido (nada de consentimento presumido). Cada grupo mapeia para categorias do
// vocabulario PROVIDER_DATA_CATEGORIES; a categoria autorizada e' o que o resto do sistema consulta (ProviderConsentService) antes de acessar ou processar.
export interface ConsentSection { heading: string | null; paragraphs?: string[]; bullets?: string[] }
export interface ConsentGroup {
  id: string;
  label: string;
  description: string;
  // Dado minimo tecnicamente necessario para vincular a conta: aparece marcado e nao pode ser desmarcado (mas precisa ser enviado explicitamente).
  required: boolean;
  categories: readonly ProviderDataCategory[];
  // Grupos que precisam estar selecionados junto (ex.: percurso GPS depende de atividades). Selecao incompativel e' recusada pelo servidor.
  requires?: readonly string[];
}
// Finalidade OPCIONAL e especifica, escolhida separadamente das obrigatorias. "external" = envio a fornecedor externo (ex.: IA). "changeableAfterConnect" =
// pode ser concedida/revogada depois de conectado, sem reconectar (as demais so' no momento da conexao).
export interface ConsentPurposeOption {
  id: string;
  label: string;
  description: string;
  external: boolean;
  changeableAfterConnect: boolean;
}
export interface ConsentCapability {
  version: string;
  dateLabel: string;
  title: string;
  intro: string;
  sections: ConsentSection[];
  groups: ConsentGroup[];
  // Finalidades OBRIGATORIAS que o texto descreve (a lista e' o teto: o que nao esta aqui, como IA, NAO esta autorizado).
  purposes: readonly string[];
  // Finalidades opcionais, cada uma com autorizacao propria (ex.: ai_external, history_backfill).
  optionalPurposes: readonly ConsentPurposeOption[];
  acknowledgementText: string;
  confirmButtonLabel: string;
}

// Evento ja' autenticado e filtrado, pronto para entrar na fila.
export interface InboundEventDraft {
  // Categoria do dado do evento. Evento de categoria nao autorizada pelo aluno e' descartado sem chegar ao conector.
  category: ProviderDataCategory;
  // Estavel e deterministico para o MESMO evento reenviado pelo provedor (ex.: id do resumo + tipo). Reenvio com a mesma chave nao vira dois trabalhos.
  dedupeKey: string;
  eventType: string;
  // Identificador do usuario no provedor (nao e' o userId interno).
  externalAccountId?: string | null;
  // Payload JA' FILTRADO pelo conector ao que o contrato autoriza guardar.
  payload: Record<string, unknown>;
}

// Evento como o processador o entrega ao conector.
export interface InboundEventView {
  id: string;
  provider: string;
  eventType: string;
  userId: string | null;
  externalAccountId: string | null;
  payload: unknown;
  attempt: number;
}

export type EventOutcome =
  | { status: 'done' }
  // Evento valido, mas que nao deve gerar dado (ex.: conexao revogada, usuario desconhecido, fora do escopo autorizado).
  | { status: 'discard'; reason: string }
  // Falha transitoria declarada: tenta de novo com espera crescente. Lancar excecao tem o mesmo efeito.
  | { status: 'retry'; reason: string };

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  // Corpo EXATAMENTE como recebido (necessario para qualquer verificacao de assinatura).
  rawBody: string;
}
export type WebhookVerdict = { ok: true } | { ok: false; reason: string };

export interface ProviderTokens {
  accessToken: string;
  // Null = o provedor nao devolveu (na renovacao, mantem o refresh token ja' guardado).
  refreshToken: string | null;
  // Null = o provedor nao informou a validade; o servico assume uma validade curta e conservadora.
  expiresInSec: number | null;
}

// Protocolo OAuth do provedor (Passo 2). O conector so' fala o protocolo; state de uso unico, consentimento, cifra dos tokens, trava de renovacao,
// unicidade da conta externa, desconexao e auditoria sao feitos UMA vez pelo ProviderConnectionService (para todos os provedores novos).
// Erros: lance BadRequestException para recusa DEFINITIVA do provedor (codigo/refresh token invalido) e BadGatewayException para falha transitoria.
export interface OAuthCapability {
  // Porta de habilitacao do provedor (fail-closed). O userId vem sempre do JWT.
  isEnabledFor(userId: string): boolean;
  // Chave de cifra PROPRIA do provedor (32 bytes). Lanca ServiceUnavailableException se o provedor nao estiver configurado.
  encryptionKey(): Buffer;
  // URL de autorizacao ja' com o state. Nenhum dado do aluno entra na URL.
  buildAuthorizationUrl(input: { state: string }): string;
  // Troca o codigo (de uso unico: nunca repetir) e identifica a conta externa.
  exchangeCode(input: { code: string }): Promise<ProviderTokens & { externalAccountId: string }>;
  // Renovacao. Nao e' chamada para provedores sem refresh token.
  refreshTokens(input: { refreshToken: string }): Promise<ProviderTokens>;
}

export interface WebhookCapability {
  // Autentica a requisicao. Fail-closed: sem prova de origem, { ok: false }. A fila so' recebe eventos de requisicoes aprovadas aqui.
  verify(request: WebhookRequest): WebhookVerdict;
  // Extrai e FILTRA os eventos da requisicao ja' autenticada. Nao faz chamada de rede nem processamento pesado (o provedor exige resposta rapida).
  extract(request: WebhookRequest): InboundEventDraft[];
}

export interface EventProcessingCapability {
  // Processa um evento da fila (download, normalizacao, gravacao no pipeline). Deve revalidar a conexao do aluno antes de gravar qualquer dado e ser
  // idempotente (o mesmo evento pode ser entregue mais de uma vez).
  handle(event: InboundEventView): Promise<EventOutcome>;
}

export interface SyncCapability {
  // Busca ativa (pull): botao manual, rotina de seguranca ou backfill.
  sync(input: { userId: string }): Promise<{ status: 'ok' | 'in_progress' | 'rate_limited' | 'not_connected'; imported?: number }>;
}

export interface RevocationCapability {
  // Avisa o provedor DEPOIS de a conexao local ja' ter sido encerrada (o servico apaga os tokens locais primeiro). Melhor esforco: nunca lanca.
  revoke(input: { accessToken: string }): Promise<'revoked' | 'not_registered' | 'failed'>;
}

export interface DataDeletionCapability {
  // Limpeza ADICIONAL especifica do provedor (opcional). A exclusao padrao de atividades/series/vinculos por provedor ja' e' feita pelo
  // ProviderDataDeletionService; isto cobre so' o que for exclusivo deste conector (ex.: tabelas de saude proprias, no futuro).
  deleteUserData(input: { userId: string }): Promise<void>;
}

export interface ProviderConnector {
  // Slug minusculo estavel ('zepp'). E' a coluna "provider" em todo o dominio.
  readonly id: string;
  readonly displayName: string;
  readonly categories?: readonly ProviderDataCategory[];
  readonly consent?: ConsentCapability;
  readonly oauth?: OAuthCapability;
  readonly webhook?: WebhookCapability;
  readonly events?: EventProcessingCapability;
  readonly sync?: SyncCapability;
  readonly revocation?: RevocationCapability;
  readonly dataDeletion?: DataDeletionCapability;
}

export const CONNECTOR_CAPABILITY_KEYS = ['consent', 'oauth', 'webhook', 'events', 'sync', 'revocation', 'dataDeletion'] as const;
export type ConnectorCapabilityKey = (typeof CONNECTOR_CAPABILITY_KEYS)[number];

export function capabilitiesOf(connector: ProviderConnector): ConnectorCapabilityKey[] {
  return CONNECTOR_CAPABILITY_KEYS.filter((key) => connector[key] !== undefined);
}
