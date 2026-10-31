import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { ConnectorRegistry } from './connector-registry';
import { decryptSecret, encryptSecret, hashState, newState } from './provider-crypto';
import { ProviderInboundEventService } from './provider-inbound-event.service';
import { consentTextHash, isConnectionConsentCurrent, isPurposeCurrent, ProviderConsentService, purposeTextHash } from './provider-consent.service';
import { ConsentCapability, OAuthCapability, ProviderConnector, ProviderDataCategory } from './provider-connector';
import { AiDataEligibility } from '../ai-governance/ai-data-eligibility.service';

// Conexao generica por provedor (Central Universal de Integracoes, Passos 2 e 2b). Faz UMA vez, para todos os provedores novos, o que Polar/Wahoo/Strava fazem
// cada um por conta propria: tentativa OAuth de uso unico (state so' como hash), consentimento explicito por grupo/categoria, cifra dos tokens, renovacao
// serializada por lease, unicidade da conta externa, desconexao local-primeiro, exclusao e auditoria. O conector so' implementa o protocolo (OAuthCapability).
// NAO toca Polar, Wahoo, Strava nem o pipeline de atividades.
//
// Este servico NAO recebe dado de treino/saude: so' conexao. Receber dados (webhook, download, importacao) e' outra etapa, com autorizacao propria.
// O token so' sai daqui por getAccessToken(provider, userId, CATEGORIA): sem a categoria autorizada pelo aluno, nao ha token.

export const STATE_TTL_MS = 10 * 60 * 1000;
export const REFRESH_SKEW_MS = 5 * 60 * 1000;
export const REFRESH_LEASE_MS = 30 * 1000;
// Categorias cujo grupo, ao ser retirado, invalida os artefatos de IA derivados do provedor: atividades e saude/recuperacao (sono, HRV, diario, FC de repouso).
const INVALIDATING_CATEGORIES: readonly string[] = ['activity', 'sleep', 'hrv', 'daily_activity', 'resting_heart_rate'];
const REFRESH_WAIT_ATTEMPTS = 8;
const REFRESH_WAIT_MS = 500;
// Quando o provedor nao informa a validade do token, assume-se uma validade curta: melhor renovar de mais do que usar token vencido.
export const FALLBACK_TOKEN_TTL_SEC = 10 * 60;
const MAX_TOKEN_TTL_SEC = 60 * 60 * 24 * 60;

// Pedido de conexao vindo do cliente. Nada aqui e' presumido: o aceite, a versao e o hash do texto exibido precisam ser enviados.
export interface ConsentRequest { groups: unknown; purposes?: unknown; acknowledged: unknown; version: unknown; textHash: unknown }
export interface ValidConsent {
  groups: string[];
  categories: ProviderDataCategory[];
  // Finalidades obrigatorias + as opcionais que o aluno marcou (nada opcional e' presumido).
  purposes: string[];
  // Versao/hash do texto sobre o qual cada finalidade OPCIONAL concedida na conexao foi aceita (so' as sem tela propria; as com tela propria nao se concedem aqui).
  purposeConsents: Record<string, { version: string; textHash: string }>;
  version: string;
  textHash: string;
}

export type DisconnectResult = {
  status: 'disconnected' | 'already_disconnected' | 'not_connected';
  providerRevocation: 'revoked' | 'not_registered' | 'failed' | 'skipped';
};

// Valida o pedido contra o documento do conector. Seleciona SO' o que o aluno marcou (mais nada e' adicionado por padrao) e recusa selecao incompativel.
export function resolveConsent(consent: ConsentCapability, input: ConsentRequest, options: { isLocked?: (purposeId: string) => boolean } = {}): ValidConsent {
  if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
  const hash = consentTextHash(consent);
  // Texto desatualizado (cliente com versao antiga em cache): o aluno precisa ver o texto vigente antes de autorizar.
  if (input.version !== consent.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
  if (!Array.isArray(input.groups)) throw new BadRequestException('Selecione os grupos de dados autorizados.');
  const selected: string[] = [];
  for (const raw of input.groups) {
    if (typeof raw !== 'string' || !consent.groups.some((g) => g.id === raw)) throw new BadRequestException('Grupo de dados desconhecido.');
    if (!selected.includes(raw)) selected.push(raw);
  }
  for (const group of consent.groups) {
    if (group.required && !selected.includes(group.id)) throw new BadRequestException('Falta um grupo de dados obrigatorio para vincular a conta.');
    if (selected.includes(group.id) && (group.requires ?? []).some((r) => !selected.includes(r))) throw new BadRequestException('Selecao incompativel: um grupo depende de outro nao selecionado.');
  }
  const categories: ProviderDataCategory[] = [];
  for (const group of consent.groups.filter((g) => selected.includes(g.id))) {
    for (const category of group.categories) if (!categories.includes(category)) categories.push(category);
  }
  if (categories.length === 0) throw new BadRequestException('Selecione ao menos um grupo de dados.');
  const optional = resolveOptionalPurposes(consent, input.purposes ?? [], options.isLocked);
  const purposeConsents = Object.fromEntries(optional.map((id) => [id, { version: consent.version, textHash: hash }]));
  return { groups: selected, categories, purposes: [...consent.purposes, ...optional], purposeConsents, version: consent.version, textHash: hash };
}

// Finalidades opcionais marcadas: so' ids que o documento oferece; a que envia dados a fornecedor externo nao pode ser concedida enquanto o provedor estiver
// BLOQUEADO para isso (consentimento dado sobre um uso que ainda nao existe nao seria informado).
function resolveOptionalPurposes(consent: ConsentCapability, raw: unknown, isLocked?: (purposeId: string) => boolean): string[] {
  if (!Array.isArray(raw)) throw new BadRequestException('Finalidades opcionais invalidas.');
  const out: string[] = [];
  for (const id of raw) {
    const option = consent.optionalPurposes.find((p) => p.id === id);
    if (typeof id !== 'string' || !option) throw new BadRequestException('Finalidade opcional desconhecida.');
    // Finalidade com tela propria (envio de treinos ao relogio, analise por IA) NUNCA e' concedida junto com a conexao: o aluno a autoriza depois, na tela dela.
    if (option.screen) throw new BadRequestException('Esta autorizacao tem tela propria e so pode ser concedida depois de conectar.');
    if (option.external && (isLocked?.(id) ?? true)) throw new ConflictException('Esta finalidade ainda nao esta disponivel.');
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// Descricao segura (sem detalhe do provedor) do motivo de uma falha de conexao, para auditoria e para a tela de teste.
export function failureReason(error: unknown): string {
  if (error instanceof ForbiddenException) return 'integracao_indisponivel';
  if (error instanceof ConflictException) return 'conta_ou_conexao_ja_existente';
  if (error instanceof BadRequestException) return 'recusada_pelo_provedor_ou_invalida';
  if (error instanceof HttpException) return 'provedor_indisponivel';
  return 'erro_inesperado';
}

function accountHint(externalAccountId: string): string {
  return externalAccountId.length <= 4 ? '••••' : `••••${externalAccountId.slice(-4)}`;
}

@Injectable()
export class ProviderConnectionService {
  private readonly logger = new Logger(ProviderConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
    private readonly events: ProviderInboundEventService,
    private readonly consent: ProviderConsentService,
    private readonly providerData?: ProviderDataDeletionService,
    // Estado da trava de envio externo (por provedor). Ausente => tratado como TRAVADO (fail-closed).
    private readonly eligibility?: AiDataEligibility,
  ) {}

  private externalLocked(provider: string): (purposeId: string) => boolean {
    return () => !(this.eligibility?.isExternalAiUnlocked(provider) ?? false);
  }

  private oauthFor(provider: string): { connector: ProviderConnector; oauth: OAuthCapability; consent: ConsentCapability } {
    const connector = this.registry.get(provider);
    if (!connector?.oauth || !connector.consent) throw new NotFoundException('Integracao desconhecida.');
    return { connector, oauth: connector.oauth, consent: connector.consent };
  }

  // Para a tela de teste explicar POR QUE nao da para conectar (sem expor valor de configuracao): habilitado para este usuario? configurado no servidor?
  availability(provider: string, userId: string): { enabled: boolean; configured: boolean } {
    const { oauth } = this.oauthFor(provider);
    let configured = true;
    try { oauth.encryptionKey(); } catch { configured = false; }
    return { enabled: oauth.isEnabledFor(userId), configured };
  }

  // Documento de consentimento que o cliente deve exibir (texto, grupos, finalidades e o hash que precisa ser devolvido no pedido).
  consentDocument(provider: string) {
    const { consent } = this.oauthFor(provider);
    return { ...consent, textHash: consentTextHash(consent), purposeHashes: Object.fromEntries(consent.optionalPurposes.map((p) => [p.id, purposeTextHash(p)])), locked: Object.fromEntries(consent.optionalPurposes.filter((p) => p.external).map((p) => [p.id, this.externalLocked(provider)(p.id)])) };
  }

  async begin(provider: string, userId: string, request: ConsentRequest): Promise<{ url: string }> {
    const { oauth, consent: document } = this.oauthFor(provider);
    // Primeiro a porta de habilitacao: quem nao esta liberado nao descobre nem o estado da configuracao.
    if (!oauth.isEnabledFor(userId)) throw new ForbiddenException('Integracao indisponivel no momento.');
    const consent = resolveConsent(document, request, { isLocked: this.externalLocked(provider) });
    oauth.encryptionKey(); // falha cedo (503) se o provedor nao estiver configurado, antes de gravar tentativa
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new BadRequestException('Usuario nao encontrado.');
    const current = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true, accessTokenEncrypted: true } });
    if (current && !current.disconnectedAt && current.accessTokenEncrypted) throw new ConflictException('A integracao ja esta conectada. Desconecte antes de conectar de novo.');

    // O state bruto so' sai na URL de autorizacao; no banco fica apenas o hash.
    const state = newState();
    await this.prisma.providerOAuthAttempt.create({
      data: { stateHash: hashState(state), provider, userId, consent: consent as never, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    return { url: oauth.buildAuthorizationUrl({ state }) };
  }

  async complete(provider: string, query: { state?: unknown; code?: unknown; error?: unknown }): Promise<'connected' | 'cancelled'> {
    const { oauth } = this.oauthFor(provider);
    const { state, code, error } = query;
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new BadRequestException('Autorizacao invalida ou expirada.');
    const stateHash = hashState(state);
    // Consumo atomico e de uso unico: um segundo callback com o mesmo state nao encontra tentativa valida.
    const consumed = await this.prisma.providerOAuthAttempt.updateMany({
      where: { stateHash, provider, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Autorizacao invalida ou ja utilizada.');
    const attempt = await this.prisma.providerOAuthAttempt.findUnique({ where: { stateHash }, select: { userId: true, consent: true } });
    if (!attempt) throw new BadRequestException('Autorizacao invalida.');
    // A partir daqui o dono da tentativa e' conhecido: falhas ficam na auditoria dele (so' o motivo, nunca codigo, state ou token).
    try {
      return await this.finishAuthorization(provider, oauth, attempt.userId, attempt.consent as unknown as ValidConsent, { code, error, state });
    } catch (failure) {
      await this.audit(attempt.userId, provider, 'connect_failed', { reason: failureReason(failure) });
      throw failure;
    }
  }

  private async finishAuthorization(provider: string, oauth: OAuthCapability, attemptUserId: string, consent: ValidConsent, result: { code?: unknown; error?: unknown; state?: unknown }): Promise<'connected' | 'cancelled'> {
    const { code, error } = result;
    const user = await this.prisma.user.findUnique({ where: { id: attemptUserId }, select: { id: true } });
    if (!user) throw new BadRequestException('Usuario Panzeri Run nao encontrado.');
    // A habilitacao pode ter sido retirada depois que o fluxo comecou.
    if (!oauth.isEnabledFor(user.id)) throw new ForbiddenException('Integracao indisponivel no momento.');

    if (error !== undefined) {
      if (typeof error !== 'string' || code !== undefined) throw new BadRequestException('Resposta do provedor invalida.');
      if (error === 'access_denied') {
        await this.audit(user.id, provider, 'connect_cancelled', {});
        return 'cancelled';
      }
      throw new BadRequestException('O provedor nao concluiu a autorizacao.');
    }
    if (typeof code !== 'string' || !code || code.length > 2048) throw new BadRequestException('Codigo de autorizacao ausente ou invalido.');

    // O code e' de uso unico: nunca repetir a troca, inclusive apos erro de rede.
    const key = oauth.encryptionKey();
    const token = await oauth.exchangeCode({ code, state: typeof result.state === 'string' ? result.state : undefined });

    // Nos caminhos de recusa abaixo o token recem-emitido NAO e' revogado (revogar pode derrubar a conexao legitima da mesma conta externa): ele nunca e'
    // gravado e expira sozinho. Revogar fica restrito a desconexao explicita do dono da conexao.
    const owner = await this.prisma.providerConnection.findUnique({ where: { provider_externalAccountId: { provider, externalAccountId: token.externalAccountId } }, select: { userId: true } });
    if (owner && owner.userId !== user.id) throw new ConflictException('Esta conta ja esta vinculada a outro usuario.');
    const current = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId: user.id } }, select: { disconnectedAt: true, accessTokenEncrypted: true } });
    if (current && !current.disconnectedAt && current.accessTokenEncrypted) throw new ConflictException('A integracao ja esta conectada.');

    const now = new Date();
    const data = {
      externalAccountId: token.externalAccountId,
      accessTokenEncrypted: encryptSecret(token.accessToken, key),
      refreshTokenEncrypted: token.refreshToken ? encryptSecret(token.refreshToken, key) : null,
      accessTokenExpiresAt: new Date(now.getTime() + this.ttlSec(token.expiresInSec) * 1000),
      grantedCategories: consent.categories as never,
      grantedPurposes: consent.purposes as never,
      purposeConsents: Object.fromEntries(Object.entries(consent.purposeConsents ?? {}).map(([id, value]) => [id, { ...value, grantedAt: now.toISOString() }])) as never,
      consentVersion: consent.version,
      consentTextHash: consent.textHash,
      consentedAt: now,
      refreshLockUntil: null,
      // Minimizacao: a coleta comeca na conexao, nunca no historico anterior — SALVO se o aluno autorizou, separadamente, importar ate 30 dias anteriores
      // (finalidade opcional history_backfill). A importacao em si e' de outro lote; aqui so' fica registrada a janela autorizada.
      collectFrom: consent.purposes.includes('history_backfill') ? new Date(now.getTime() - 30 * 86_400_000) : now,
      lastSyncCompletedAt: null,
      disconnectedAt: null,
    };
    try {
      await this.prisma.providerConnection.upsert({
        where: { provider_userId: { provider, userId: user.id } },
        create: { userId: user.id, provider, ...data },
        update: data,
      });
    } catch (failure) {
      // Corrida: outra conta gravou a mesma conta externa entre a checagem e a gravacao (unicidade).
      if ((failure as { code?: string }).code === 'P2002') throw new ConflictException('Esta conta ja esta vinculada a outro usuario.');
      throw failure;
    }
    await this.audit(user.id, provider, 'connected', { groups: consent.groups, categories: consent.categories, purposes: consent.purposes, optionalGranted: Object.keys(consent.purposeConsents ?? {}), consentVersion: consent.version, consentTextHash: consent.textHash, decision: 'granted' });
    return 'connected';
  }

  // Concede ou revoga, SEPARADAMENTE e sem reconectar, finalidades opcionais alteraveis depois da conexao (ex.: envio de treinos ao relogio, analise por IA, historico).
  // Revogar vale na hora e nunca exige aceite; conceder exige o aceite expresso sobre o texto VIGENTE DA PROPRIA FINALIDADE (versao + hash da tela dela, ou do documento da conexao
  // quando a finalidade nao tem tela propria) e respeita a trava do provedor. O registro por finalidade (versao, hash, data) fica em purposeConsents e cada decisao na auditoria
  // (aluno, finalidade, versao, data, decisao). Revogar uma finalidade de envio externo invalida os artefatos de IA derivados do provedor.
  async updatePurposes(provider: string, userId: string, input: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const { consent: document } = this.oauthFor(provider);
    const grant = input.grant === undefined ? [] : input.grant;
    const revoke = input.revoke === undefined ? [] : input.revoke;
    if (!Array.isArray(grant) || !Array.isArray(revoke)) throw new BadRequestException('Finalidades invalidas.');
    const changeable = (id: unknown) => document.optionalPurposes.find((p) => p.id === id && p.changeableAfterConnect);
    if ([...grant, ...revoke].some((id) => !changeable(id))) throw new BadRequestException('Finalidade desconhecida ou nao alteravel depois da conexao.');
    if (grant.some((id) => revoke.includes(id))) throw new BadRequestException('Uma finalidade nao pode ser concedida e revogada juntas.');
    const c = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true, grantedPurposes: true, purposeConsents: true, collectFrom: true } });
    if (!c || c.disconnectedAt) throw new ConflictException('A integracao nao esta conectada.');
    let purposes = Array.isArray(c.grantedPurposes) ? [...(c.grantedPurposes as string[])] : [];
    const records: Record<string, { version: string; textHash: string; grantedAt: string }> = { ...((c.purposeConsents as Record<string, { version: string; textHash: string; grantedAt: string }> | null) ?? {}) };
    const granted: string[] = [];
    const now = new Date();
    if (grant.length > 0) {
      if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
      const expectations = (grant as string[]).map((id) => {
        const option = changeable(id)!;
        return option.screen ? { version: option.screen.version, textHash: purposeTextHash(option) } : { version: document.version, textHash: consentTextHash(document) };
      });
      // Uma tela por vez: cada finalidade com tela propria tem o seu texto; misturar versoes de textos diferentes numa so confirmacao nao comprova o que o aluno leu.
      if (expectations.some((e) => e.version !== expectations[0].version || e.textHash !== expectations[0].textHash)) throw new BadRequestException('Autorize uma finalidade por vez, na tela dela.');
      if (input.version !== expectations[0].version || input.textHash !== expectations[0].textHash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
      const locked = this.externalLocked(provider);
      for (const id of grant as string[]) {
        if (changeable(id)?.external && locked(id)) throw new ConflictException('Esta finalidade ainda nao esta disponivel.');
        // Finalidade ja concedida mas sobre texto desatualizado: a nova autorizacao a renova.
        const alreadyCurrent = purposes.includes(id) && isPurposeCurrent(document, id, records);
        if (!alreadyCurrent) {
          if (!purposes.includes(id)) purposes.push(id);
          records[id] = { version: expectations[0].version, textHash: expectations[0].textHash, grantedAt: now.toISOString() };
          granted.push(id);
        }
      }
    }
    const revoked = (revoke as string[]).filter((id) => purposes.includes(id));
    purposes = purposes.filter((id) => !revoked.includes(id));
    for (const id of revoked) delete records[id];
    // Historico autorizado depois de conectar: a janela de coleta passa a incluir ate 30 dias anteriores (nunca mais que isso, nunca reduz uma janela ja existente).
    const backfillFrom = granted.includes('history_backfill') ? new Date(now.getTime() - 30 * 86_400_000) : null;
    const collectFrom = backfillFrom && (!c.collectFrom || c.collectFrom > backfillFrom) ? backfillFrom : undefined;
    const updated = await this.prisma.providerConnection.updateMany({
      where: { provider, userId, disconnectedAt: null },
      data: { grantedPurposes: purposes as never, purposeConsents: records as never, ...(collectFrom ? { collectFrom } : {}) },
    });
    if (updated.count !== 1) throw new ConflictException('A integracao nao esta conectada.');
    for (const id of granted) await this.audit(userId, provider, 'purposes_granted', { purposes: [id], decision: 'granted', consentVersion: records[id].version, consentTextHash: records[id].textHash });
    for (const id of revoked) await this.audit(userId, provider, 'purposes_revoked', { purposes: [id], decision: 'revoked' });
    // Retirar a finalidade que envia dados a fornecedor externo: os artefatos de IA derivados do provedor deixam de valer.
    if (revoked.some((id) => document.optionalPurposes.find((p) => p.id === id)?.external)) await this.invalidateAiArtifacts(userId, provider, 'external_purpose_revoked');
    return { purposes };
  }

  // Concede ou revoga, depois de conectar, GRUPOS de dados (importacao de atividades, sensores, percurso GPS). Conceder exige o aceite expresso sobre o texto vigente da conexao;
  // revogar nunca exige aceite, vale na hora (a fila descarta eventos de categoria retirada) e, se a categoria 'activity' sair, os artefatos de IA derivados do provedor sao invalidados.
  // Revogar um grupo revoga tambem os que dependem dele. O grupo obrigatorio (identificacao da conta) so' sai desconectando.
  async updateGroups(provider: string, userId: string, input: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const { consent: document } = this.oauthFor(provider);
    const grant = input.grant === undefined ? [] : input.grant;
    const revoke = input.revoke === undefined ? [] : input.revoke;
    if (!Array.isArray(grant) || !Array.isArray(revoke)) throw new BadRequestException('Grupos invalidos.');
    const known = (id: unknown) => document.groups.find((g) => g.id === id);
    if ([...grant, ...revoke].some((id) => !known(id))) throw new BadRequestException('Grupo de dados desconhecido.');
    if (grant.some((id) => revoke.includes(id))) throw new BadRequestException('Um grupo nao pode ser concedido e revogado juntos.');
    if ((revoke as string[]).some((id) => known(id)?.required)) throw new BadRequestException('Este grupo e necessario para manter a conexao. Para retira-lo, desconecte a conta.');
    const c = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true, grantedCategories: true } });
    if (!c || c.disconnectedAt) throw new ConflictException('A integracao nao esta conectada.');
    const currentCategories = new Set(Array.isArray(c.grantedCategories) ? (c.grantedCategories as string[]) : []);
    const selected = new Set(document.groups.filter((g) => g.categories.every((category) => currentCategories.has(category))).map((g) => g.id));
    const before = new Set(selected);
    if (grant.length > 0) {
      if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
      const hash = consentTextHash(document);
      if (input.version !== document.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
      for (const id of grant as string[]) selected.add(id);
    }
    for (const id of revoke as string[]) selected.delete(id);
    // Quem depende de um grupo retirado sai junto; quem entrou sem a dependencia e' recusado.
    for (let changed = true; changed;) {
      changed = false;
      for (const group of document.groups) {
        if (selected.has(group.id) && (group.requires ?? []).some((r) => !selected.has(r))) {
          if ((grant as string[]).includes(group.id)) throw new BadRequestException('Selecao incompativel: um grupo depende de outro nao autorizado.');
          selected.delete(group.id);
          changed = true;
        }
      }
    }
    const categories: ProviderDataCategory[] = [];
    for (const group of document.groups.filter((g) => selected.has(g.id))) for (const category of group.categories) if (!categories.includes(category)) categories.push(category);
    const updated = await this.prisma.providerConnection.updateMany({ where: { provider, userId, disconnectedAt: null }, data: { grantedCategories: categories as never } });
    if (updated.count !== 1) throw new ConflictException('A integracao nao esta conectada.');
    const grantedIds = [...selected].filter((id) => !before.has(id));
    const revokedIds = [...before].filter((id) => !selected.has(id));
    if (grantedIds.length > 0) await this.audit(userId, provider, 'groups_updated', { decision: 'granted', groups: grantedIds, consentVersion: document.version, consentTextHash: consentTextHash(document) });
    if (revokedIds.length > 0) await this.audit(userId, provider, 'groups_updated', { decision: 'revoked', groups: revokedIds });
    // Importacao de atividades retirada: eventos pendentes dessas categorias deixam de virar dado (a fila ja' descarta por categoria) e os artefatos de IA derivados saem de validade.
    // Atividades E saude/recuperacao (sono, HRV, diario, FC de repouso): retirar o grupo que alimenta a IA invalida os artefatos de IA derivados do provedor. Sensores e GPS isolados nao (como antes).
    if (revokedIds.some((id) => (known(id)?.categories ?? []).some((category) => INVALIDATING_CATEGORIES.includes(category)))) await this.invalidateAiArtifacts(userId, provider, 'import_revoked');
    return { groups: [...selected], categories };
  }

  // Reconfirmacao do texto da CONEXAO apos uma mudanca material: o aluno le a versao vigente e confirma de novo, SEM mudar o que ja autorizou (nenhum grupo e' adicionado).
  // Enquanto nao reconfirma, as categorias de dados (alem da identificacao da conta) nao valem (ver isConnectionConsentCurrent).
  async reconfirm(provider: string, userId: string, input: { acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const { consent: document } = this.oauthFor(provider);
    if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
    const hash = consentTextHash(document);
    if (input.version !== document.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de confirmar.');
    const now = new Date();
    const updated = await this.prisma.providerConnection.updateMany({ where: { provider, userId, disconnectedAt: null }, data: { consentVersion: document.version, consentTextHash: hash, consentedAt: now } });
    if (updated.count !== 1) throw new ConflictException('A integracao nao esta conectada.');
    await this.audit(userId, provider, 'connected', { reconfirmed: true, decision: 'granted', consentVersion: document.version, consentTextHash: hash });
    return { version: document.version };
  }

  // Painel de permissoes do aluno: o estado de CADA autorizacao, separado, com versao/data e se esta valendo sobre o texto atual — mais o historico auditavel das decisoes.
  async permissions(provider: string, userId: string) {
    const { consent: document } = this.oauthFor(provider);
    const c = await this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider, userId } },
      select: { disconnectedAt: true, accessTokenEncrypted: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true, consentedAt: true },
    });
    const connected = Boolean(c && !c.disconnectedAt && c.accessTokenEncrypted);
    const categories = new Set(connected && Array.isArray(c!.grantedCategories) ? (c!.grantedCategories as string[]) : []);
    const purposes = connected && Array.isArray(c!.grantedPurposes) ? (c!.grantedPurposes as string[]) : [];
    const records = (connected ? c!.purposeConsents : null) as Record<string, { version: string; textHash: string; grantedAt: string }> | null;
    const locked = this.externalLocked(provider);
    return {
      connected,
      // needsReview: o texto da conexao mudou depois da autorizacao — a importacao fica suspensa ate o aluno reconfirmar o texto vigente.
      consent: { version: document.version, textHash: consentTextHash(document), grantedVersion: connected ? c!.consentVersion : null, grantedAt: connected ? c!.consentedAt : null, needsReview: connected && !isConnectionConsentCurrent(document, c!) },
      groups: document.groups.map((group) => ({ id: group.id, label: group.label, required: group.required, requires: group.requires ?? [], granted: connected && group.categories.every((category) => categories.has(category)) && (group.categories.every((category) => category === 'profile') || isConnectionConsentCurrent(document, c!)) })),
      purposes: document.optionalPurposes.map((option) => {
        const listed = purposes.includes(option.id);
        const current = listed && isPurposeCurrent(document, option.id, records);
        return {
          id: option.id,
          label: option.label,
          external: option.external,
          changeableAfterConnect: option.changeableAfterConnect,
          hasOwnScreen: Boolean(option.screen),
          granted: current,
          // Concedida antes de uma mudanca material do texto: nao vale ate nova autorizacao.
          needsNewAuthorization: listed && !current,
          grantedAt: records?.[option.id]?.grantedAt ?? null,
          grantedVersion: records?.[option.id]?.version ?? null,
          currentVersion: option.screen?.version ?? document.version,
          // Disponibilidade operacional (hoje, o envio externo a IA esta travado enquanto o provedor nao for regularizado).
          available: option.external ? !locked(option.id) : true,
        };
      }),
      log: await this.consentLog(provider, userId),
    };
  }

  // Historico auditavel das decisoes do aluno (concedeu/retirou, qual item, qual versao do texto, quando). So' metadados; nunca token nem dado de treino.
  async consentLog(provider: string, userId: string) {
    const rows = await this.prisma.providerConnectionEvent.findMany({
      where: { provider, userId, type: { in: ['connected', 'purposes_granted', 'purposes_revoked', 'groups_updated'] } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { type: true, details: true, createdAt: true },
    }).catch(() => []);
    const out: Array<{ at: Date; decision: 'granted' | 'revoked'; kind: 'connection' | 'purpose' | 'group'; id: string | null; version: string | null }> = [];
    for (const row of rows as Array<{ type: string; details: unknown; createdAt: Date }>) {
      const d = (row.details ?? {}) as { purposes?: unknown; groups?: unknown; decision?: unknown; consentVersion?: unknown };
      const decision = d.decision === 'revoked' || row.type === 'purposes_revoked' ? 'revoked' : 'granted';
      const version = typeof d.consentVersion === 'string' ? d.consentVersion : null;
      if (row.type === 'connected') { out.push({ at: row.createdAt, decision: 'granted', kind: 'connection', id: null, version }); continue; }
      const ids = (row.type === 'groups_updated' ? d.groups : d.purposes) as unknown;
      for (const id of Array.isArray(ids) ? (ids as unknown[]) : []) if (typeof id === 'string') out.push({ at: row.createdAt, decision, kind: row.type === 'groups_updated' ? 'group' : 'purpose', id, version });
    }
    return out;
  }

  // Artefatos de IA derivados do provedor deixam de valer (melhor esforco: nunca desfaz a revogacao ja gravada; a falha fica auditada e registrada em log).
  private async invalidateAiArtifacts(userId: string, provider: string, trigger: string): Promise<void> {
    if (!this.providerData) return;
    try {
      await this.providerData.invalidateAiArtifacts(userId, provider);
    } catch (error) {
      this.logger.error(`Invalidacao dos artefatos de IA (${provider}, ${trigger}) falhou: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
      await this.audit(userId, provider, 'ai_artifacts_invalidation_failed', { trigger });
    }
  }

  // Leitura pura, sem chamada ao provedor. Nunca devolve token, segredo nem o identificador externo completo (so' as ultimas 4 posicoes, mascaradas).
  async status(provider: string, userId: string) {
    this.oauthFor(provider);
    const c = await this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider, userId } },
      select: { createdAt: true, disconnectedAt: true, accessTokenEncrypted: true, externalAccountId: true, grantedCategories: true, grantedPurposes: true, consentVersion: true, consentTextHash: true, consentedAt: true, lastSyncCompletedAt: true },
    });
    const recent = await this.recentEvents(provider, userId);
    if (!c || c.disconnectedAt || !c.accessTokenEncrypted) {
      return { connected: false, connectedAt: null, disconnectedAt: c?.disconnectedAt ?? null, lastSyncCompletedAt: null, account: null, consent: null, recent };
    }
    return {
      connected: true,
      connectedAt: c.createdAt,
      disconnectedAt: null,
      lastSyncCompletedAt: c.lastSyncCompletedAt,
      account: { hint: accountHint(c.externalAccountId) },
      consent: { categories: c.grantedCategories, purposes: c.grantedPurposes, version: c.consentVersion, textHash: c.consentTextHash, consentedAt: c.consentedAt },
      recent,
    };
  }

  private async recentEvents(provider: string, userId: string) {
    const rows = await this.prisma.providerConnectionEvent.findMany({ where: { provider, userId }, orderBy: { createdAt: 'desc' }, take: 10, select: { type: true, details: true, createdAt: true } }).catch(() => []);
    // So' o motivo/resultado de cada evento: auditoria nunca guarda token, e aqui nao sai mais do que isso.
    return rows.map((r: { type: string; details: unknown; createdAt: Date }) => {
      const d = (r.details ?? {}) as Record<string, unknown>;
      return { type: r.type, at: r.createdAt, reason: typeof d.reason === 'string' ? d.reason : null, providerRevocation: typeof d.providerRevocation === 'string' ? d.providerRevocation : null };
    });
  }

  // Token de acesso valido para uso imediato, SOMENTE para uma categoria que o aluno autorizou (o consentimento e' verificado a cada chamada; desconectado
  // ou categoria nao marcada => sem token). Renova so' quando falta menos de REFRESH_SKEW_MS, serializado por conexao com uma trava (lease) no banco.
  async getAccessToken(provider: string, userId: string, category: ProviderDataCategory): Promise<string> {
    const { oauth } = this.oauthFor(provider);
    await this.consent.assertAllowed(provider, userId, category);
    const key = oauth.encryptionKey();
    for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt++) {
      const c = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } } });
      if (!c || c.disconnectedAt || !c.accessTokenEncrypted) throw new ConflictException('A integracao nao esta conectada.');
      if (this.isFresh(c.accessTokenExpiresAt)) return decryptSecret(c.accessTokenEncrypted, key);
      const now = new Date();
      const claimed = await this.prisma.providerConnection.updateMany({
        where: { provider, userId, disconnectedAt: null, OR: [{ refreshLockUntil: null }, { refreshLockUntil: { lt: now } }] },
        data: { refreshLockUntil: new Date(now.getTime() + REFRESH_LEASE_MS) },
      });
      if (claimed.count === 1) return this.refreshHoldingLease(provider, userId, oauth, key);
      await this.sleep(REFRESH_WAIT_MS); // outra renovacao em andamento: espera e le de novo
    }
    throw new ServiceUnavailableException('Nao foi possivel renovar a conexao agora.');
  }

  // Desconexao: PRIMEIRO encerra localmente (fonte canonica de "ainda autorizado?"), descarta tokens e eventos pendentes; DEPOIS avisa o provedor.
  async disconnect(provider: string, userId: string): Promise<DisconnectResult> {
    const { connector, oauth } = this.oauthFor(provider);
    const c = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } } });
    if (!c) return { status: 'not_connected', providerRevocation: 'skipped' };
    if (c.disconnectedAt) return { status: 'already_disconnected', providerRevocation: 'skipped' };
    const closed = await this.closeLocally(provider, userId);
    if (!closed) return { status: 'already_disconnected', providerRevocation: 'skipped' };
    const providerRevocation = await this.revokeRemotely(connector, oauth, c);
    await this.audit(userId, provider, 'disconnected', { providerRevocation, decision: 'revoked' });
    await this.invalidateAiArtifacts(userId, provider, 'disconnected');
    return { status: 'disconnected', providerRevocation };
  }

  // Registro/consulta de eventos de auditoria por conexao (ex.: pedido de historico ja' feito). Nunca guarda token.
  async recordEvent(provider: string, userId: string, type: string, details: Record<string, unknown>): Promise<void> {
    // Propaga a falha (diferente de audit()): quem usa isto como marca de "ja' feito" precisa saber se a marca nao foi gravada.
    await this.prisma.providerConnectionEvent.create({ data: { userId, provider, type, details: details as never } });
  }

  async hasEvent(provider: string, userId: string, type: string): Promise<boolean> {
    const row = await this.prisma.providerConnectionEvent.findFirst({ where: { provider, userId, type }, select: { id: true } });
    return row !== null;
  }

  // O PROVEDOR avisou que o aluno revogou a autorizacao (ex.: Zepp authorizationChange/delete): encerra so' o lado LOCAL (tokens apagados, eventos pendentes descartados).
  // Nao chama o provedor de volta (ele ja' revogou). Idempotente; conta desconhecida ou ja' desconectada => nada a fazer.
  async handleRemoteRevocation(provider: string, externalAccountId: string): Promise<'closed' | 'nothing'> {
    const userId = await this.consent.resolveActiveUserId(provider, externalAccountId);
    if (!userId) return 'nothing';
    const closed = await this.closeLocally(provider, userId);
    if (closed) {
      await this.audit(userId, provider, 'revoked_by_provider', { source: 'authorization_change', decision: 'revoked' });
      await this.invalidateAiArtifacts(userId, provider, 'revoked_by_provider');
    }
    return closed ? 'closed' : 'nothing';
  }

  // Exclusao de conta: encerra todas as conexoes do usuario (falha de um provedor nao bloqueia os demais).
  async disconnectAll(userId: string): Promise<void> {
    const rows = await this.prisma.providerConnection.findMany({ where: { userId, disconnectedAt: null }, select: { provider: true } });
    for (const row of rows) {
      await this.disconnect(row.provider, userId).catch((error: unknown) => this.logger.warn(`Desconexao ${row.provider} na exclusao de conta falhou: ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`));
    }
  }

  // Exclusao dos dados importados do provedor (mesma regra de Polar/Wahoo): exige estar desconectado, senao a proxima coleta reimportaria.
  async deleteData(provider: string, userId: string) {
    const { connector } = this.oauthFor(provider);
    if (!this.providerData) throw new ServiceUnavailableException('Exclusao de dados indisponivel.');
    const c = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true } });
    if (c && !c.disconnectedAt) throw new ConflictException('Desconecte a integracao antes de excluir os dados importados dela.');
    const result = await this.providerData.deleteProviderData(userId, provider);
    await connector.dataDeletion?.deleteUserData({ userId });
    await this.audit(userId, provider, 'data_deleted', {});
    return result;
  }

  // Estado de sincronizacao por PULL (provedores sem webhook, como a COROS). So' leitura/escrita de datas: nunca expoe token (a tabela de conexoes so' e' lida por este servico e pelo de consentimento).
  async syncState(provider: string, userId: string): Promise<{ connected: boolean; lastSyncCompletedAt: Date | null }> {
    const row = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true, lastSyncCompletedAt: true } });
    return { connected: !!row && !row.disconnectedAt, lastSyncCompletedAt: row?.lastSyncCompletedAt ?? null };
  }

  async markSyncCompleted(provider: string, userId: string, at: Date): Promise<void> {
    await this.prisma.providerConnection.updateMany({ where: { provider, userId, disconnectedAt: null }, data: { lastSyncCompletedAt: at } });
  }

  // Alunos com conexao ATIVA no provedor (para as rotinas de consulta periodica).
  async connectedUserIds(provider: string): Promise<string[]> {
    const rows = await this.prisma.providerConnection.findMany({ where: { provider, disconnectedAt: null }, select: { userId: true } });
    return rows.map((row) => row.userId);
  }

  // ── internos ────────────────────────────────────────────────────────────────────────────────────────────────────

  private ttlSec(expiresInSec: number | null): number {
    return typeof expiresInSec === 'number' && Number.isFinite(expiresInSec) && expiresInSec > 0 && expiresInSec <= MAX_TOKEN_TTL_SEC ? expiresInSec : FALLBACK_TOKEN_TTL_SEC;
  }

  private isFresh(expiresAt: Date | null): boolean {
    return !!expiresAt && expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async releaseLease(provider: string, userId: string) {
    await this.prisma.providerConnection.updateMany({ where: { provider, userId }, data: { refreshLockUntil: null } }).catch(() => undefined);
  }

  // Encerra localmente: tokens apagados, eventos pendentes do usuario descartados. Devolve false se outra requisicao concorrente ja' encerrou.
  private async closeLocally(provider: string, userId: string): Promise<boolean> {
    const closed = await this.prisma.providerConnection.updateMany({
      where: { provider, userId, disconnectedAt: null },
      data: { disconnectedAt: new Date(), accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null, refreshLockUntil: null },
    });
    if (closed.count !== 1) return false;
    await this.events.discardPendingForUser(provider, userId).catch(() => undefined);
    return true;
  }

  // Chamado com a trava (lease) ja' obtida.
  private async refreshHoldingLease(provider: string, userId: string, oauth: OAuthCapability, key: Buffer): Promise<string> {
    // Releitura: outra instancia pode ter renovado entre a nossa leitura e a obtencao da trava.
    const c = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } } });
    if (!c || c.disconnectedAt || !c.accessTokenEncrypted) {
      await this.releaseLease(provider, userId);
      throw new ConflictException('A integracao nao esta conectada.');
    }
    if (this.isFresh(c.accessTokenExpiresAt)) {
      await this.releaseLease(provider, userId);
      return decryptSecret(c.accessTokenEncrypted, key);
    }
    if (!c.refreshTokenEncrypted) {
      // Sem refresh token nao ha como se recuperar: o aluno precisa reconectar.
      await this.closeLocally(provider, userId);
      await this.audit(userId, provider, 'token_expired_without_refresh', {});
      throw new ConflictException('A conexao expirou. Conecte novamente.');
    }
    const currentRefresh = decryptSecret(c.refreshTokenEncrypted, key);
    let token;
    try {
      token = await oauth.refreshTokens({ refreshToken: currentRefresh });
    } catch (failure) {
      if (failure instanceof BadRequestException) {
        // O provedor recusou o refresh token (revogado/expirado): a conexao nao se recupera sozinha.
        await this.closeLocally(provider, userId);
        await this.audit(userId, provider, 'token_refresh_rejected', {});
        throw new ConflictException('A conexao expirou. Conecte novamente.');
      }
      await this.releaseLease(provider, userId); // provedor fora do ar/erro transitorio: mantem a conexao e o refresh token
      throw failure;
    }
    // Grava o par NOVO antes de qualquer uso (guarda o refresh token devolvido; se nao veio, mantem o atual). "disconnectedAt: null" faz uma
    // desconexao concorrente vencer.
    const saved = await this.prisma.providerConnection.updateMany({
      where: { provider, userId, disconnectedAt: null },
      data: {
        accessTokenEncrypted: encryptSecret(token.accessToken, key),
        refreshTokenEncrypted: encryptSecret(token.refreshToken ?? currentRefresh, key),
        accessTokenExpiresAt: new Date(Date.now() + this.ttlSec(token.expiresInSec) * 1000),
        refreshLockUntil: null,
      },
    });
    if (saved.count !== 1) throw new ConflictException('A integracao foi desconectada durante a renovacao.');
    return token.accessToken;
  }

  // Revoga no provedor as credenciais que acabaram de ser apagadas localmente. Nunca grava no banco. Melhor esforco.
  private async revokeRemotely(
    connector: ProviderConnector,
    oauth: OAuthCapability,
    c: { accessTokenEncrypted: string | null; refreshTokenEncrypted: string | null; accessTokenExpiresAt: Date | null },
  ): Promise<'revoked' | 'not_registered' | 'failed' | 'skipped'> {
    if (!connector.revocation) return 'skipped';
    if (!c.accessTokenEncrypted) return 'failed';
    try {
      const key = oauth.encryptionKey();
      let accessToken = decryptSecret(c.accessTokenEncrypted, key);
      if (!this.isFresh(c.accessTokenExpiresAt) && c.refreshTokenEncrypted) {
        // Token vencido: renova direto (sem gravar) so' para conseguir revogar.
        accessToken = (await oauth.refreshTokens({ refreshToken: decryptSecret(c.refreshTokenEncrypted, key) })).accessToken;
      }
      return await connector.revocation.revoke({ accessToken });
    } catch {
      return 'failed';
    }
  }

  private async audit(userId: string, provider: string, type: string, details: Record<string, unknown>) {
    try {
      await this.prisma.providerConnectionEvent.create({ data: { userId, provider, type, details: details as never } });
    } catch (error) {
      this.logger.warn(`Auditoria ${provider} nao gravada: ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`);
    }
  }
}
