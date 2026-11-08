import { createHash, createHmac } from 'node:crypto';
import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthCapability, ProviderTokens, RevocationCapability } from '../provider-hub/provider-connector';
import { isEnabledFor } from '../provider-hub/provider-access';
import { parseHexKey } from '../provider-hub/provider-crypto';

// OAuth 2.0 PKCE da Garmin (Connect Developer Program), 08/11/2026. Fonte: "OAuth2PKCE 2.0.pdf" (pasta "Documentação Garmin" do repositorio), lido por inteiro:
//  - autorizacao (GET, navegador): https://connect.garmin.com/oauth2Confirm  (response_type=code, client_id, code_challenge S256, redirect_uri, state);
//  - troca do codigo e renovacao (POST, SO' no servidor, form): https://diauth.garmin.com/di-oauth2-service/oauth/token — a Garmin NAO tem fluxo sem segredo (client_secret obrigatorio);
//  - access token 86400 s; refresh token vale 3 meses e CADA renovacao devolve um refresh token novo (o hub guarda o devolvido);
//  - o escopo e' fixo (nao vai na URL): o que a aluna compartilha ela controla na tela da Garmin;
//  - identificador da conta: GET https://apis.garmin.com/partner-gateway/rest/user/id (Bearer) -> {"userId"}; e' estavel mesmo se a aluna desconectar e reconectar;
//  - desconexao no Panzeri Run => DELETE https://apis.garmin.com/partner-gateway/rest/user/registration (OBRIGATORIO pela Garmin).
// PKCE sem tabela nova (mesmo desenho da COROS): o verifier e' derivado do `state` com HMAC-SHA256 usando a chave de cifra PROPRIA da Garmin; o state e' de uso unico.
// NAO validado com a Garmin real ainda: a documentacao mostra o cabecalho Basic nos exemplos e client_id/client_secret no corpo na lista de parametros; o codigo envia no CORPO e,
// so' na renovacao, tenta uma vez com o cabecalho Basic se a Garmin recusar (400/401).
export const GARMIN_AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
export const GARMIN_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
export const GARMIN_API_BASE = 'https://apis.garmin.com/partner-gateway/rest';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_EXPIRES_IN_SEC = 60 * 60 * 24 * 7;

export function garminSettings(config: ConfigService) {
  const clientId = config.get<string>('GARMIN_CLIENT_ID')?.trim();
  const clientSecret = config.get<string>('GARMIN_CLIENT_SECRET')?.trim();
  const redirectUri = config.get<string>('GARMIN_REDIRECT_URI')?.trim();
  const key = parseHexKey(config.get<string>('GARMIN_TOKEN_ENCRYPTION_KEY'));
  if (!clientId || !clientSecret || !redirectUri || !key) throw new ServiceUnavailableException('Garmin ainda nao configurada no servidor.');
  // Chave PROPRIA: reutilizar a de outra integracao ligaria o vazamento de uma ao das outras.
  const rawKey = config.get<string>('GARMIN_TOKEN_ENCRYPTION_KEY')!.trim().toLowerCase();
  for (const other of ['POLAR_TOKEN_ENCRYPTION_KEY', 'STRAVA_TOKEN_ENCRYPTION_KEY', 'WAHOO_TOKEN_ENCRYPTION_KEY', 'ZEPP_TOKEN_ENCRYPTION_KEY', 'COROS_TOKEN_ENCRYPTION_KEY']) {
    if (config.get<string>(other)?.trim().toLowerCase() === rawKey) throw new ServiceUnavailableException('A chave de criptografia da Garmin precisa ser exclusiva.');
  }
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { throw new ServiceUnavailableException('Redirect Garmin invalido no servidor.'); }
  if (redirect.protocol !== 'https:' || redirect.pathname !== '/garmin/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) throw new ServiceUnavailableException('Redirect Garmin invalido no servidor.');
  return { clientId, clientSecret, redirectUri, key };
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// 43 caracteres (SHA-256 em base64url): dentro do intervalo 43–128 exigido pela Garmin.
export const pkceVerifierFor = (state: string, key: Buffer) => b64url(createHmac('sha256', key).update(`garmin-pkce:${state}`).digest());
export const pkceChallengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

async function post(url: string, body: URLSearchParams, basic?: { id: string; secret: string }): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${basic.id}:${basic.secret}`).toString('base64')}`;
  try {
    return await fetch(url, { method: 'POST', headers, body: body.toString(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
  } catch {
    throw new BadGatewayException('Nao foi possivel contatar a Garmin.');
  }
}

// 4xx do endpoint de token => recusa definitiva (BadRequest); rede/5xx/corpo invalido => transitorio (BadGateway).
async function readTokens(response: Response, kind: 'exchange' | 'refresh'): Promise<ProviderTokens> {
  if (response.status >= 400 && response.status < 500) throw new BadRequestException(kind === 'exchange' ? 'A Garmin recusou a autorizacao. Inicie outra conexao.' : 'A Garmin recusou a renovacao da conexao.');
  if (!response.ok) throw new BadGatewayException('A Garmin esta indisponivel no momento.');
  let payload: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  try { payload = await response.json() as typeof payload; } catch { throw new BadGatewayException('Resposta de autorizacao Garmin invalida.'); }
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new BadGatewayException('Resposta de autorizacao Garmin invalida.');
  const expires = Number(payload.expires_in);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token ? payload.refresh_token : null,
    expiresInSec: Number.isFinite(expires) && expires > 0 && expires <= MAX_EXPIRES_IN_SEC ? expires : null,
  };
}

export class GarminOAuth implements OAuthCapability {
  constructor(private readonly config: ConfigService) {}

  isEnabledFor(userId: string): boolean {
    return isEnabledFor(this.config.get<string>('GARMIN_ENABLED_USER_IDS'), userId);
  }

  encryptionKey(): Buffer {
    return garminSettings(this.config).key;
  }

  buildAuthorizationUrl({ state }: { state: string }): string {
    const { clientId, redirectUri, key } = garminSettings(this.config);
    const params = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
      code_challenge: pkceChallengeOf(pkceVerifierFor(state, key)), code_challenge_method: 'S256', state,
    });
    return `${GARMIN_AUTHORIZE_URL}?${params}`;
  }

  async exchangeCode({ code, state }: { code: string; state?: string }) {
    const s = garminSettings(this.config);
    if (!state) throw new BadRequestException('Autorizacao invalida ou expirada.');
    const response = await post(GARMIN_TOKEN_URL, new URLSearchParams({
      grant_type: 'authorization_code', client_id: s.clientId, client_secret: s.clientSecret, code, code_verifier: pkceVerifierFor(state, s.key), redirect_uri: s.redirectUri,
    }));
    const tokens = await readTokens(response, 'exchange');
    const externalAccountId = await this.fetchUserId(tokens.accessToken);
    return { ...tokens, externalAccountId };
  }

  async refreshTokens({ refreshToken }: { refreshToken: string }): Promise<ProviderTokens> {
    const s = garminSettings(this.config);
    const body = () => new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    let response = await post(GARMIN_TOKEN_URL, new URLSearchParams({ grant_type: 'refresh_token', client_id: s.clientId, client_secret: s.clientSecret, refresh_token: refreshToken }));
    // Os exemplos da Garmin usam o cabecalho Basic: se o formato no corpo for recusado, tenta UMA vez com ele (uma falha nao gira o refresh token).
    if (response.status === 400 || response.status === 401) response = await post(GARMIN_TOKEN_URL, body(), { id: s.clientId, secret: s.clientSecret });
    // Cada renovacao devolve um refresh token NOVO: o servico de conexao guarda o devolvido (o antigo deixa de valer).
    return readTokens(response, 'refresh');
  }

  // Identificador estavel da conta Garmin (o mesmo vem nos avisos que a Garmin envia): liga os dados recebidos a aluna certa.
  private async fetchUserId(accessToken: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${GARMIN_API_BASE}/user/id`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
    } catch {
      throw new BadGatewayException('Nao foi possivel contatar a Garmin.');
    }
    if (!response.ok) throw new BadGatewayException('A Garmin nao identificou a conta. Inicie outra conexao.');
    let userId: unknown;
    try { userId = ((await response.json()) as { userId?: unknown }).userId; } catch { userId = null; }
    if (typeof userId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(userId)) throw new BadGatewayException('A Garmin nao identificou a conta. Inicie outra conexao.');
    return userId;
  }
}

export class GarminRevocation implements RevocationCapability {
  constructor(private readonly config: ConfigService) {}

  // DELETE /user/registration e' OBRIGATORIO quando a aluna desconecta ou exclui a conta pelo Panzeri Run (spec da Garmin, secao 6). Melhor esforco: nunca lanca.
  async revoke({ accessToken }: { accessToken: string }): Promise<'revoked' | 'not_registered' | 'failed'> {
    try {
      const response = await fetch(`${GARMIN_API_BASE}/user/registration`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
      if (response.ok) return 'revoked';
      if (response.status === 401 || response.status === 403 || response.status === 404) return 'not_registered';
      return 'failed';
    } catch {
      return 'failed';
    }
  }
}
