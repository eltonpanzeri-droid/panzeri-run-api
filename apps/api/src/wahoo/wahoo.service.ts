import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { decryptSecret, encryptSecret, hashState, newPkcePair } from './wahoo-crypto';

// Wahoo Cloud API — Etapa 3 (08/10/2026): SOMENTE conexao (OAuth), status, renovacao de token e desconexao.
// Nenhum treino e' enviado e nenhuma atividade e' lida aqui (Etapas 4 e 5, com autorizacao propria).
//
// Fatos da documentacao oficial (cloud-api.wahooligan.com) e decisoes:
//  - Autorizacao: GET /oauth/authorize (client_id, redirect_uri, scope, response_type=code). A documentacao NAO cita o
//    parametro "state"; foi verificado empiricamente em 08/10/2026 que a Wahoo o devolve intacto no redirect.
//  - PKCE S256 e' documentado e e' usado como segunda camada, JUNTO com o client_secret (cliente confidencial).
//  - Troca do code e renovacao: POST /oauth/token. Parametros vao no CORPO (JSON), nunca na URL, para o segredo nao
//    aparecer em logs de proxy.
//  - Access token vale 2 h. O refresh token ROTACIONA a cada renovacao; o novo par e' gravado antes de qualquer uso.
//    A documentacao manda renovar so' imediatamente antes de usar o token.
//  - Revogacao: DELETE /v1/permissions (Bearer). Limite de 10 tokens nao revogados por usuario.
//  - Identidade: GET /v1/user (escopo user_read) -> id da conta Wahoo (uma conta Wahoo so' pode ligar a um aluno).

const AUTHORIZATION_URL = 'https://api.wahooligan.com/oauth/authorize';
const TOKEN_URL = 'https://api.wahooligan.com/oauth/token';
const API_BASE = 'https://api.wahooligan.com';
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const REFRESH_LEASE_MS = 30 * 1000;
const REFRESH_WAIT_ATTEMPTS = 8;
const REFRESH_WAIT_MS = 500;
// Menor privilegio: so' leitura do usuario nesta etapa. Escopos de treino (workouts_*, plans_*) e offline_data entram
// na Etapa 4/5, com WAHOO_SCOPES e nova autorizacao do aluno.
const DEFAULT_SCOPES = 'user_read';

interface CallbackQuery {
  state?: unknown;
  code?: unknown;
  error?: unknown;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

type WahooSettings = ReturnType<WahooService['settings']>;

export type WahooDisconnectResult = {
  status: 'disconnected' | 'already_disconnected' | 'not_connected';
  providerRevocation: 'revoked' | 'not_registered' | 'failed' | 'skipped';
};

@Injectable()
export class WahooService {
  private readonly logger = new Logger(WahooService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly providerData?: ProviderDataDeletionService,
  ) {}

  async connectUrl(userId: string) {
    const settings = this.settings();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new BadRequestException('Usuario nao encontrado.');

    // O state bruto so' sai na URL de autorizacao; no banco ficam seu hash e o verifier PKCE cifrado.
    const state = randomBytes(32).toString('base64url');
    const pkce = newPkcePair();
    await this.prisma.wahooOAuthAttempt.create({
      data: {
        stateHash: hashState(state),
        userId,
        codeVerifierEncrypted: encryptSecret(pkce.verifier, settings.key),
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    const url = new URL(AUTHORIZATION_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      scope: settings.scopes,
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString() };
  }

  async callback(query: CallbackQuery): Promise<'connected' | 'cancelled'> {
    const { state, code, error } = query;
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new BadRequestException('Autorizacao Wahoo invalida ou expirada.');
    }
    const stateHash = hashState(state);
    // Consumo atomico e de uso unico: um segundo callback com o mesmo state nao encontra tentativa valida.
    const consumed = await this.prisma.wahooOAuthAttempt.updateMany({
      where: { stateHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Autorizacao Wahoo invalida ou ja utilizada.');

    const attempt = await this.prisma.wahooOAuthAttempt.findUnique({
      where: { stateHash }, select: { userId: true, codeVerifierEncrypted: true },
    });
    if (!attempt) throw new BadRequestException('Autorizacao Wahoo invalida.');
    const user = await this.prisma.user.findUnique({ where: { id: attempt.userId }, select: { id: true } });
    if (!user) throw new BadRequestException('Usuario Panzeri Run nao encontrado.');

    if (error !== undefined) {
      if (typeof error !== 'string' || code !== undefined) throw new BadRequestException('Resposta Wahoo invalida.');
      if (error === 'access_denied') return 'cancelled';
      throw new BadRequestException('A Wahoo nao concluiu a autorizacao.');
    }
    if (typeof code !== 'string' || !code || code.length > 2048) {
      throw new BadRequestException('Codigo de autorizacao Wahoo ausente ou invalido.');
    }

    // O code e' de uso unico: nunca repetir a troca, inclusive apos erro de rede.
    const settings = this.settings();
    let verifier: string;
    try { verifier = decryptSecret(attempt.codeVerifierEncrypted, settings.key); }
    catch { throw new BadRequestException('Autorizacao Wahoo invalida.'); }
    const token = await this.requestToken({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: settings.redirectUri,
      code_verifier: verifier,
    }, 'exchange');

    let wahooUserId: string;
    try {
      wahooUserId = await this.fetchWahooUserId(token.accessToken);
    } catch (failure) {
      await this.revokeToken(token.accessToken); // nao deixa token orfao contando no limite de 10 por usuario
      throw failure;
    }
    const owner = await this.prisma.wahooConnection.findUnique({ where: { wahooUserId }, select: { userId: true, disconnectedAt: true } });
    if (owner && owner.userId !== user.id) {
      await this.revokeToken(token.accessToken);
      throw new ConflictException('Esta conta Wahoo ja esta vinculada a outro usuario.');
    }

    const data = {
      wahooUserId,
      accessTokenEncrypted: encryptSecret(token.accessToken, settings.key),
      refreshTokenEncrypted: encryptSecret(token.refreshToken, settings.key),
      accessTokenExpiresAt: new Date(Date.now() + token.expiresInSec * 1000),
      grantedScopes: settings.scopes,
      refreshLockUntil: null,
      disconnectedAt: null,
    };
    try {
      await this.prisma.wahooConnection.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...data },
        update: data,
      });
    } catch (failure) {
      // Corrida: outro aluno gravou a mesma conta Wahoo entre a checagem e a gravacao (unicidade de wahooUserId).
      await this.revokeToken(token.accessToken);
      if ((failure as { code?: string }).code === 'P2002') throw new ConflictException('Esta conta Wahoo ja esta vinculada a outro usuario.');
      throw failure;
    }
    await this.audit(user.id, 'connected', { scopes: settings.scopes });
    return 'connected';
  }

  // Leitura pura, sem chamada a Wahoo: o app so' precisa saber se mostra "Conectar" ou "Conectado".
  async status(userId: string) {
    const connection = await this.prisma.wahooConnection.findUnique({
      where: { userId }, select: { createdAt: true, disconnectedAt: true, accessTokenEncrypted: true },
    });
    if (!connection) return { connected: false, connectedAt: null, disconnectedAt: null };
    if (connection.disconnectedAt || !connection.accessTokenEncrypted) {
      return { connected: false, connectedAt: null, disconnectedAt: connection.disconnectedAt };
    }
    return { connected: true, connectedAt: connection.createdAt, disconnectedAt: null };
  }

  // Token de acesso valido para uso imediato (Etapas 4/5). Renova so' quando falta menos de REFRESH_SKEW_MS.
  // A renovacao e' serializada por aluno com uma trava (lease) no banco — sem transacao em volta da chamada de rede
  // e segura entre varias instancias — porque o refresh token rotaciona: duas renovacoes com o mesmo refresh token
  // invalidariam a conexao.
  async getAccessToken(userId: string): Promise<string> {
    const settings = this.settings();
    for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt++) {
      const connection = await this.prisma.wahooConnection.findUnique({ where: { userId } });
      if (!connection || connection.disconnectedAt || !connection.accessTokenEncrypted || !connection.refreshTokenEncrypted) {
        throw new ConflictException('A Wahoo nao esta conectada.');
      }
      if (this.isFresh(connection.accessTokenExpiresAt)) return decryptSecret(connection.accessTokenEncrypted, settings.key);

      const now = new Date();
      const claimed = await this.prisma.wahooConnection.updateMany({
        where: { userId, disconnectedAt: null, OR: [{ refreshLockUntil: null }, { refreshLockUntil: { lt: now } }] },
        data: { refreshLockUntil: new Date(now.getTime() + REFRESH_LEASE_MS) },
      });
      if (claimed.count === 1) return this.refreshHoldingLease(userId, settings);
      await this.sleep(REFRESH_WAIT_MS); // outra renovacao em andamento: espera e le de novo
    }
    throw new ServiceUnavailableException('Nao foi possivel renovar a conexao com a Wahoo agora.');
  }

  // Desconexao. Ordem deliberada (igual a Polar): PRIMEIRO revoga localmente (fonte canonica de "ainda autorizado?")
  // e descarta os tokens, DEPOIS avisa a Wahoo. A conexao local e' encerrada na hora mesmo que a Wahoo esteja fora do ar.
  async disconnect(userId: string): Promise<WahooDisconnectResult> {
    const connection = await this.prisma.wahooConnection.findUnique({ where: { userId } });
    if (!connection) return { status: 'not_connected', providerRevocation: 'skipped' };
    if (connection.disconnectedAt) return { status: 'already_disconnected', providerRevocation: 'skipped' };

    const revoked = await this.prisma.wahooConnection.updateMany({
      where: { userId, disconnectedAt: null },
      data: { disconnectedAt: new Date(), accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null, refreshLockUntil: null },
    });
    // Outra requisicao concorrente venceu a corrida: o efeito ja ocorreu.
    if (revoked.count !== 1) return { status: 'already_disconnected', providerRevocation: 'skipped' };

    const providerRevocation = await this.revokeStoredCredentials(connection);
    await this.providerData?.recordDisconnection(userId, 'wahoo', { providerRevocation });
    return { status: 'disconnected', providerRevocation };
  }

  studentAppUrl(): string | null {
    const configured = this.config.get<string>('STUDENT_APP_URL')?.trim();
    if (!configured) return null;
    try {
      const url = new URL(configured);
      return url.protocol === 'https:' ? url.toString() : null;
    } catch { return null; }
  }

  // ── internos ────────────────────────────────────────────────────────────────────────────────────────────────────

  private isFresh(expiresAt: Date | null): boolean {
    return !!expiresAt && expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async releaseLease(userId: string) {
    await this.prisma.wahooConnection.updateMany({ where: { userId }, data: { refreshLockUntil: null } }).catch(() => undefined);
  }

  // Chamado com a trava (lease) ja' obtida.
  private async refreshHoldingLease(userId: string, settings: WahooSettings): Promise<string> {
    // Releitura: outra instancia pode ter renovado entre a nossa leitura e a obtencao da trava.
    const connection = await this.prisma.wahooConnection.findUnique({ where: { userId } });
    if (!connection || connection.disconnectedAt || !connection.accessTokenEncrypted || !connection.refreshTokenEncrypted) {
      await this.releaseLease(userId);
      throw new ConflictException('A Wahoo nao esta conectada.');
    }
    if (this.isFresh(connection.accessTokenExpiresAt)) {
      await this.releaseLease(userId);
      return decryptSecret(connection.accessTokenEncrypted, settings.key);
    }

    let token: TokenPair;
    try {
      token = await this.requestToken({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: decryptSecret(connection.refreshTokenEncrypted, settings.key),
      }, 'refresh');
    } catch (failure) {
      if (failure instanceof BadRequestException) {
        // A Wahoo recusou o refresh token (revogado/expirado): a conexao nao tem mais como se recuperar sozinha.
        await this.prisma.wahooConnection.updateMany({
          where: { userId, disconnectedAt: null },
          data: { disconnectedAt: new Date(), accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null, refreshLockUntil: null },
        });
        await this.audit(userId, 'token_refresh_rejected', {});
        throw new ConflictException('A conexao com a Wahoo expirou. Conecte novamente.');
      }
      await this.releaseLease(userId); // Wahoo fora do ar/erro transitorio: mantem a conexao e o refresh token
      throw failure;
    }

    // Grava o par NOVO antes de qualquer uso. "disconnectedAt: null" garante que uma desconexao concorrente vence.
    const saved = await this.prisma.wahooConnection.updateMany({
      where: { userId, disconnectedAt: null },
      data: {
        accessTokenEncrypted: encryptSecret(token.accessToken, settings.key),
        refreshTokenEncrypted: encryptSecret(token.refreshToken, settings.key),
        accessTokenExpiresAt: new Date(Date.now() + token.expiresInSec * 1000),
        refreshLockUntil: null,
      },
    });
    if (saved.count !== 1) {
      await this.revokeToken(token.accessToken);
      throw new ConflictException('A Wahoo foi desconectada durante a renovacao.');
    }
    return token.accessToken;
  }

  // Revoga na Wahoo as credenciais que acabaram de ser apagadas localmente. Nunca grava no banco.
  private async revokeStoredCredentials(connection: { accessTokenEncrypted: string | null; refreshTokenEncrypted: string | null; accessTokenExpiresAt: Date | null }): Promise<'revoked' | 'not_registered' | 'failed'> {
    if (!connection.accessTokenEncrypted) return 'failed';
    try {
      const settings = this.settings();
      let accessToken = decryptSecret(connection.accessTokenEncrypted, settings.key);
      if (!this.isFresh(connection.accessTokenExpiresAt) && connection.refreshTokenEncrypted) {
        // Token vencido: renova direto (sem gravar) so' para conseguir revogar.
        const renewed = await this.requestToken({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: decryptSecret(connection.refreshTokenEncrypted, settings.key),
        }, 'refresh');
        accessToken = renewed.accessToken;
      }
      const response = await fetch(`${API_BASE}/v1/permissions`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      if (response.ok) return 'revoked';
      if (response.status === 404) return 'not_registered';
      return 'failed';
    } catch {
      return 'failed';
    }
  }

  private async revokeToken(accessToken: string) {
    try {
      await fetch(`${API_BASE}/v1/permissions`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    } catch { /* melhor esforco */ }
  }

  private async fetchWahooUserId(accessToken: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/v1/user`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    } catch {
      throw new BadGatewayException('Nao foi possivel contatar a Wahoo. Inicie outra conexao.');
    }
    if (!response.ok) throw new BadGatewayException('A Wahoo nao liberou a identificacao da conta. Inicie outra conexao.');
    let payload: { id?: unknown };
    try { payload = await response.json() as { id?: unknown }; }
    catch { throw new BadGatewayException('Resposta de identificacao Wahoo invalida.'); }
    const id = payload.id;
    if (!(typeof id === 'number' && Number.isSafeInteger(id) && id > 0) && !(typeof id === 'string' && /^\d{1,20}$/.test(id))) {
      throw new BadGatewayException('Resposta de identificacao Wahoo invalida.');
    }
    return String(id);
  }

  // 4xx do endpoint de token => BadRequestException (definitivo); rede/5xx/corpo invalido => BadGatewayException.
  private async requestToken(body: Record<string, string>, kind: 'exchange' | 'refresh'): Promise<TokenPair> {
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel contatar a Wahoo.');
    }
    if (response.status >= 400 && response.status < 500) {
      throw new BadRequestException(kind === 'exchange' ? 'A Wahoo recusou a autorizacao. Inicie outra conexao.' : 'A Wahoo recusou a renovacao da conexao.');
    }
    if (!response.ok) throw new BadGatewayException('A Wahoo esta indisponivel no momento.');
    let payload: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    try { payload = await response.json() as typeof payload; }
    catch { throw new BadGatewayException('Resposta de autorizacao Wahoo invalida.'); }
    const expiresIn = Number(payload.expires_in);
    if (typeof payload.access_token !== 'string' || !payload.access_token ||
        typeof payload.refresh_token !== 'string' || !payload.refresh_token ||
        !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 60 * 60 * 24 * 60) {
      throw new BadGatewayException('Resposta de autorizacao Wahoo invalida.');
    }
    return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresInSec: expiresIn };
  }

  private async audit(userId: string, type: string, details: Record<string, unknown>) {
    try {
      await this.prisma.providerConnectionEvent.create({ data: { userId, provider: 'wahoo', type, details: details as never } });
    } catch (error) {
      this.logger.warn(`Auditoria Wahoo nao gravada: ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`);
    }
  }

  private settings() {
    const clientId = this.config.get<string>('WAHOO_CLIENT_ID')?.trim();
    const clientSecret = this.config.get<string>('WAHOO_CLIENT_SECRET')?.trim();
    const redirectUri = this.config.get<string>('WAHOO_REDIRECT_URI')?.trim();
    const rawKey = this.config.get<string>('WAHOO_TOKEN_ENCRYPTION_KEY')?.trim();
    if (!clientId || !clientSecret || !redirectUri || !rawKey || !/^[\da-fA-F]{64}$/.test(rawKey)) {
      throw new ServiceUnavailableException('Wahoo ainda nao configurada no servidor.');
    }
    // Chave PROPRIA: reutilizar a da Polar ou do Strava ligaria o vazamento de uma integracao ao das outras.
    for (const other of ['POLAR_TOKEN_ENCRYPTION_KEY', 'STRAVA_TOKEN_ENCRYPTION_KEY']) {
      if (this.config.get<string>(other)?.trim().toLowerCase() === rawKey.toLowerCase()) {
        throw new ServiceUnavailableException('A chave de criptografia da Wahoo precisa ser exclusiva.');
      }
    }
    let redirect: URL;
    try { redirect = new URL(redirectUri); }
    catch { throw new ServiceUnavailableException('Redirect Wahoo invalido no servidor.'); }
    if (redirect.protocol !== 'https:' || redirect.pathname !== '/wahoo/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) {
      throw new ServiceUnavailableException('Redirect Wahoo invalido no servidor.');
    }
    const scopes = (this.config.get<string>('WAHOO_SCOPES')?.trim() || DEFAULT_SCOPES);
    if (!/^[a-z_]+( [a-z_]+)*$/.test(scopes) || !scopes.split(' ').includes('user_read')) {
      throw new ServiceUnavailableException('Escopos Wahoo invalidos no servidor.');
    }
    return { clientId, clientSecret, redirectUri, scopes, key: Buffer.from(rawKey, 'hex') };
  }
}
