import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { ConnectorRegistry } from './connector-registry';
import { decryptSecret, encryptSecret, hashState, newState } from './provider-crypto';
import { ProviderInboundEventService } from './provider-inbound-event.service';
import { OAuthCapability, PROVIDER_DATA_CATEGORIES, ProviderConnector, ProviderDataCategory } from './provider-connector';

// Conexao generica por provedor (Central Universal de Integracoes, Passo 2). Faz UMA vez, para todos os provedores novos, o que Polar/Wahoo/Strava fazem
// cada um por conta propria: tentativa OAuth de uso unico (state so' como hash), consentimento por categoria, cifra dos tokens, renovacao serializada por
// lease, unicidade da conta externa, desconexao local-primeiro, exclusao e auditoria. O conector so' implementa o protocolo (OAuthCapability).
// NAO toca Polar, Wahoo, Strava nem o pipeline de atividades.
//
// Este servico NAO recebe dado de treino/saude: so' conexao. Receber dados (webhook, download, importacao) e' outra etapa, com autorizacao propria.

export const STATE_TTL_MS = 10 * 60 * 1000;
export const REFRESH_SKEW_MS = 5 * 60 * 1000;
export const REFRESH_LEASE_MS = 30 * 1000;
const REFRESH_WAIT_ATTEMPTS = 8;
const REFRESH_WAIT_MS = 500;
// Quando o provedor nao informa a validade do token, assume-se uma validade curta: melhor renovar de mais do que usar token vencido.
export const FALLBACK_TOKEN_TTL_SEC = 10 * 60;
const MAX_TOKEN_TTL_SEC = 60 * 60 * 24 * 60;
const CONSENT_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

export interface ConsentInput { categories: unknown; version: unknown }
export interface ValidConsent { categories: ProviderDataCategory[]; version: string }

export type DisconnectResult = {
  status: 'disconnected' | 'already_disconnected' | 'not_connected';
  providerRevocation: 'revoked' | 'not_registered' | 'failed' | 'skipped';
};

export function validateConsent(connector: ProviderConnector, input: ConsentInput): ValidConsent {
  const allowed = connector.categories ?? [];
  if (!Array.isArray(input.categories) || input.categories.length === 0) throw new BadRequestException('Informe ao menos uma categoria de dado autorizada.');
  const categories: ProviderDataCategory[] = [];
  for (const raw of input.categories) {
    if (typeof raw !== 'string' || !(PROVIDER_DATA_CATEGORIES as readonly string[]).includes(raw)) throw new BadRequestException('Categoria de dado desconhecida.');
    if (!allowed.includes(raw as ProviderDataCategory)) throw new BadRequestException('Esta integracao nao oferece uma das categorias informadas.');
    if (!categories.includes(raw as ProviderDataCategory)) categories.push(raw as ProviderDataCategory);
  }
  if (typeof input.version !== 'string' || !CONSENT_VERSION_PATTERN.test(input.version)) throw new BadRequestException('Versao do termo de consentimento invalida.');
  return { categories, version: input.version };
}

@Injectable()
export class ProviderConnectionService {
  private readonly logger = new Logger(ProviderConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
    private readonly events: ProviderInboundEventService,
    private readonly providerData?: ProviderDataDeletionService,
  ) {}

  private oauthFor(provider: string): { connector: ProviderConnector; oauth: OAuthCapability } {
    const connector = this.registry.get(provider);
    if (!connector?.oauth) throw new NotFoundException('Integracao desconhecida.');
    return { connector, oauth: connector.oauth };
  }

  async begin(provider: string, userId: string, consentInput: ConsentInput): Promise<{ url: string }> {
    const { connector, oauth } = this.oauthFor(provider);
    // Primeiro a porta de habilitacao: quem nao esta liberado nao descobre nem o estado da configuracao.
    if (!oauth.isEnabledFor(userId)) throw new ForbiddenException('Integracao indisponivel no momento.');
    const consent = validateConsent(connector, consentInput);
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
    const user = await this.prisma.user.findUnique({ where: { id: attempt.userId }, select: { id: true } });
    if (!user) throw new BadRequestException('Usuario Panzeri Run nao encontrado.');
    // A habilitacao pode ter sido retirada depois que o fluxo comecou.
    if (!oauth.isEnabledFor(user.id)) throw new ForbiddenException('Integracao indisponivel no momento.');

    if (error !== undefined) {
      if (typeof error !== 'string' || code !== undefined) throw new BadRequestException('Resposta do provedor invalida.');
      if (error === 'access_denied') return 'cancelled';
      throw new BadRequestException('O provedor nao concluiu a autorizacao.');
    }
    if (typeof code !== 'string' || !code || code.length > 2048) throw new BadRequestException('Codigo de autorizacao ausente ou invalido.');
    const consent = attempt.consent as unknown as ValidConsent;

    // O code e' de uso unico: nunca repetir a troca, inclusive apos erro de rede.
    const key = oauth.encryptionKey();
    const token = await oauth.exchangeCode({ code });

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
      consentVersion: consent.version,
      consentedAt: now,
      refreshLockUntil: null,
      // Minimizacao: a coleta comeca na conexao, nunca no historico anterior. Ampliar a janela e' decisao de produto futura (e depende do provedor).
      collectFrom: now,
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
    await this.audit(user.id, provider, 'connected', { categories: consent.categories, consentVersion: consent.version });
    return 'connected';
  }

  // Leitura pura, sem chamada ao provedor.
  async status(provider: string, userId: string) {
    this.oauthFor(provider);
    const c = await this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider, userId } },
      select: { createdAt: true, disconnectedAt: true, accessTokenEncrypted: true, grantedCategories: true, consentVersion: true, consentedAt: true, lastSyncCompletedAt: true },
    });
    if (!c || c.disconnectedAt || !c.accessTokenEncrypted) {
      return { connected: false, connectedAt: null, disconnectedAt: c?.disconnectedAt ?? null, lastSyncCompletedAt: null, consent: null };
    }
    return { connected: true, connectedAt: c.createdAt, disconnectedAt: null, lastSyncCompletedAt: c.lastSyncCompletedAt, consent: { categories: c.grantedCategories, version: c.consentVersion, consentedAt: c.consentedAt } };
  }

  // Token de acesso valido para uso imediato. Renova so' quando falta menos de REFRESH_SKEW_MS, serializado por conexao com uma trava (lease) no banco
  // (sem transacao em volta da chamada de rede e segura entre instancias).
  async getAccessToken(provider: string, userId: string): Promise<string> {
    const { oauth } = this.oauthFor(provider);
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
    await this.audit(userId, provider, 'disconnected', { providerRevocation });
    return { status: 'disconnected', providerRevocation };
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
    return result;
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

