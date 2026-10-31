import { createHash, createHmac } from 'node:crypto';
import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthCapability, ProviderTokens, RevocationCapability } from '../provider-hub/provider-connector';
import { isEnabledFor } from '../provider-hub/provider-access';
import { parseHexKey } from '../provider-hub/provider-crypto';

// OAuth 2.0 da COROS MCP (30/10/2026). Fatos CONFERIDOS em 30/10/2026 (descoberta publica em https://mcp.coros.com/.well-known/openid-configuration + sonda real com uma conta de teste):
//  - emissor regional (o endereco unificado devolve o emissor da regiao; para Brasil/outros e' o dos EUA): https://mcpus.coros.com;
//  - cliente PUBLICO (sem segredo, token_endpoint_auth_method "none"), registrado uma vez por registro dinamico (RFC 7591) em /connect/register -> COROS_CLIENT_ID;
//  - authorization code + PKCE S256 (unico metodo aceito), parametro `resource` = URL do MCP, escopos "openid offline_access mcp.tools";
//  - token: POST /oauth2/token (form), access token 30 dias, refresh 180 dias e CADA renovacao devolve um refresh token novo (o hub guarda o devolvido);
//  - revogacao: POST /oauth2/revoke; a conta externa e' o `sub` do id_token.
// PKCE sem tabela nova: o verifier e' derivado do `state` com HMAC-SHA256 usando a chave de cifra PROPRIA da COROS. Quem nao tem a chave nao reconstroi o verifier, e o state e' de uso unico.
export const COROS_ISSUER_DEFAULT = 'https://mcpus.coros.com';
export const COROS_SCOPE = 'openid offline_access mcp.tools';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_EXPIRES_IN_SEC = 60 * 60 * 24 * 60;

export function corosIssuer(config: ConfigService): string {
  const raw = config.get<string>('COROS_ISSUER')?.trim() || COROS_ISSUER_DEFAULT;
  let url: URL;
  try { url = new URL(raw); } catch { throw new ServiceUnavailableException('Emissor da COROS invalido no servidor.'); }
  if (url.protocol !== 'https:' || !/(^|\.)coros\.com$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash) throw new ServiceUnavailableException('Emissor da COROS invalido no servidor.');
  return url.origin;
}

export const corosEndpoints = (issuer: string) => ({
  authorize: `${issuer}/oauth2/authorize`,
  token: `${issuer}/oauth2/token`,
  revoke: `${issuer}/oauth2/revoke`,
  register: `${issuer}/connect/register`,
  mcp: `${issuer}/mcp`,
});

export function corosSettings(config: ConfigService) {
  const clientId = config.get<string>('COROS_CLIENT_ID')?.trim();
  const redirectUri = config.get<string>('COROS_REDIRECT_URI')?.trim();
  const key = parseHexKey(config.get<string>('COROS_TOKEN_ENCRYPTION_KEY'));
  if (!clientId || !redirectUri || !key) throw new ServiceUnavailableException('COROS ainda nao configurada no servidor.');
  // Chave PROPRIA: reutilizar a de outra integracao ligaria o vazamento de uma ao das outras.
  const rawKey = config.get<string>('COROS_TOKEN_ENCRYPTION_KEY')!.trim().toLowerCase();
  for (const other of ['POLAR_TOKEN_ENCRYPTION_KEY', 'STRAVA_TOKEN_ENCRYPTION_KEY', 'WAHOO_TOKEN_ENCRYPTION_KEY', 'ZEPP_TOKEN_ENCRYPTION_KEY']) {
    if (config.get<string>(other)?.trim().toLowerCase() === rawKey) throw new ServiceUnavailableException('A chave de criptografia da COROS precisa ser exclusiva.');
  }
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { throw new ServiceUnavailableException('Redirect COROS invalido no servidor.'); }
  if (redirect.protocol !== 'https:' || redirect.pathname !== '/coros/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) throw new ServiceUnavailableException('Redirect COROS invalido no servidor.');
  return { clientId, redirectUri, key, issuer: corosIssuer(config) };
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const pkceVerifierFor = (state: string, key: Buffer) => b64url(createHmac('sha256', key).update(`coros-pkce:${state}`).digest());
export const pkceChallengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

async function post(url: string, body: URLSearchParams): Promise<Response> {
  try {
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
  } catch {
    throw new BadGatewayException('Nao foi possivel contatar a COROS.');
  }
}

// 4xx do endpoint de token => recusa definitiva (BadRequest); rede/5xx/corpo invalido => transitorio (BadGateway).
async function readTokens(response: Response, kind: 'exchange' | 'refresh'): Promise<ProviderTokens & { idToken: string | null }> {
  if (response.status >= 400 && response.status < 500) throw new BadRequestException(kind === 'exchange' ? 'A COROS recusou a autorizacao. Inicie outra conexao.' : 'A COROS recusou a renovacao da conexao.');
  if (!response.ok) throw new BadGatewayException('A COROS esta indisponivel no momento.');
  let payload: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; id_token?: unknown };
  try { payload = await response.json() as typeof payload; } catch { throw new BadGatewayException('Resposta de autorizacao COROS invalida.'); }
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new BadGatewayException('Resposta de autorizacao COROS invalida.');
  const expires = Number(payload.expires_in);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token ? payload.refresh_token : null,
    expiresInSec: Number.isFinite(expires) && expires > 0 && expires <= MAX_EXPIRES_IN_SEC ? expires : null,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : null,
  };
}

// `sub` do id_token (recebido DIRETO do endpoint de token por TLS, na mesma resposta do code; por isso nao exige validar a assinatura aqui).
export function subjectOf(idToken: string | null): string {
  if (!idToken) return '';
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof claims.sub === 'string' ? claims.sub : '';
  } catch { return ''; }
}

export class CorosOAuth implements OAuthCapability {
  constructor(private readonly config: ConfigService) {}

  isEnabledFor(userId: string): boolean {
    return isEnabledFor(this.config.get<string>('COROS_ENABLED_USER_IDS'), userId);
  }

  encryptionKey(): Buffer {
    return corosSettings(this.config).key;
  }

  buildAuthorizationUrl({ state }: { state: string }): string {
    const { clientId, redirectUri, key, issuer } = corosSettings(this.config);
    const endpoints = corosEndpoints(issuer);
    const params = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: COROS_SCOPE,
      code_challenge: pkceChallengeOf(pkceVerifierFor(state, key)), code_challenge_method: 'S256', resource: endpoints.mcp, state,
    });
    return `${endpoints.authorize}?${params}`;
  }

  async exchangeCode({ code, state }: { code: string; state?: string }) {
    const s = corosSettings(this.config);
    if (!state) throw new BadRequestException('Autorizacao invalida ou expirada.');
    const response = await post(corosEndpoints(s.issuer).token, new URLSearchParams({
      grant_type: 'authorization_code', client_id: s.clientId, code, redirect_uri: s.redirectUri, code_verifier: pkceVerifierFor(state, s.key),
    }));
    const tokens = await readTokens(response, 'exchange');
    const externalAccountId = subjectOf(tokens.idToken);
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(externalAccountId)) throw new BadGatewayException('A COROS nao identificou a conta. Inicie outra conexao.');
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresInSec: tokens.expiresInSec, externalAccountId };
  }

  async refreshTokens({ refreshToken }: { refreshToken: string }): Promise<ProviderTokens> {
    const s = corosSettings(this.config);
    const response = await post(corosEndpoints(s.issuer).token, new URLSearchParams({ grant_type: 'refresh_token', client_id: s.clientId, refresh_token: refreshToken }));
    const { accessToken, refreshToken: next, expiresInSec } = await readTokens(response, 'refresh');
    // Cada renovacao devolve um refresh token NOVO: o servico de conexao guarda o devolvido (o antigo deixa de valer).
    return { accessToken, refreshToken: next, expiresInSec };
  }
}

export class CorosRevocation implements RevocationCapability {
  constructor(private readonly config: ConfigService) {}

  async revoke({ accessToken }: { accessToken: string }): Promise<'revoked' | 'not_registered' | 'failed'> {
    try {
      const s = corosSettings(this.config);
      const response = await post(corosEndpoints(s.issuer).revoke, new URLSearchParams({ token: accessToken, token_type_hint: 'access_token', client_id: s.clientId }));
      if (response.ok) return 'revoked';
      if (response.status === 400 || response.status === 401 || response.status === 404) return 'not_registered';
      return 'failed';
    } catch {
      return 'failed';
    }
  }
}
