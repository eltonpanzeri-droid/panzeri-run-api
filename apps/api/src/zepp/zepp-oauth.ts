import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthCapability, ProviderTokens, RevocationCapability } from '../provider-hub/provider-connector';
import { isEnabledFor } from '../provider-hub/provider-access';
import { parseHexKey } from '../provider-hub/provider-crypto';

// Protocolo OAuth da Zepp/Amazfit (Central Universal de Integracoes, Passo 2, 19/10/2026) — SOMENTE conexao, renovacao e revogacao.
// Nenhum dado de treino ou saude e' solicitado, recebido ou guardado aqui.
//
// Fatos da documentacao oficial (devopen.zepp.com, lida em 19/10/2026) e decisoes:
//  - Autorizacao: https://user.zepp.com/oauth2/index.html#/login?client_id&response_type=code&state&token=["access","refresh"]. O "redirect_uri" NAO e' parametro
//    da URL (e' cadastrado no console da Zepp); "scope" NAO existe e PKCE NAO e' documentado — por isso nao ha escopo nem verifier. Sem escopos do provedor,
//    o registro autoritativo do que o aluno aceitou e' o consentimento por categoria do proprio Panzeri Run (ProviderConnection.grantedCategories).
//  - Troca do code: POST https://auth.zepp.com/v2/oauth2/access_token (form: client_id, client_secret, grant_type=authorization_code, redirect_uri, code).
//    Resposta: access_token, token_type, expires_in, refresh_token, user_id (identifica a conta; nenhuma chamada extra).
//  - Renovacao: POST https://auth.zepp.com/v2/oauth2/refresh_token com "Authorization: Bearer <REFRESH token>" (nunca o access token) e o form
//    client_id, client_secret, grant_type=refresh_token, refresh_token. Hoje a Zepp devolve o MESMO refresh token; guardamos o devolvido por seguranca.
//  - Revogacao: POST https://api-open.zepp.com/users/-/thirdparty/unauthorize com Bearer <access token>, sem corpo.
//
// DESCONHECIDO (aguarda a Zepp; nada abaixo assume o contrario): formato de erro dos endpoints de token; nome do campo de validade na RENOVACAO (so' se aceita
// "expires_in"; ausente => o servico assume validade curta); se a resposta de erro pode vir com HTTP 200; limites de chamadas; formato da resposta da revogacao.
export const ZEPP_AUTHORIZATION_URL = 'https://user.zepp.com/oauth2/index.html';
export const ZEPP_TOKEN_URL = 'https://auth.zepp.com/v2/oauth2/access_token';
export const ZEPP_REFRESH_URL = 'https://auth.zepp.com/v2/oauth2/refresh_token';
export const ZEPP_REVOKE_URL = 'https://api-open.zepp.com/users/-/thirdparty/unauthorize';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_EXPIRES_IN_SEC = 60 * 60 * 24 * 60;

export function zeppSettings(config: ConfigService) {
  const clientId = config.get<string>('ZEPP_CLIENT_ID')?.trim();
  const clientSecret = config.get<string>('ZEPP_CLIENT_SECRET')?.trim();
  const redirectUri = config.get<string>('ZEPP_REDIRECT_URI')?.trim();
  const key = parseHexKey(config.get<string>('ZEPP_TOKEN_ENCRYPTION_KEY'));
  if (!clientId || !clientSecret || !redirectUri || !key) throw new ServiceUnavailableException('Zepp ainda nao configurada no servidor.');
  // Chave PROPRIA: reutilizar a de outra integracao ligaria o vazamento de uma ao das outras.
  const rawKey = config.get<string>('ZEPP_TOKEN_ENCRYPTION_KEY')!.trim().toLowerCase();
  for (const other of ['POLAR_TOKEN_ENCRYPTION_KEY', 'STRAVA_TOKEN_ENCRYPTION_KEY', 'WAHOO_TOKEN_ENCRYPTION_KEY']) {
    if (config.get<string>(other)?.trim().toLowerCase() === rawKey) throw new ServiceUnavailableException('A chave de criptografia da Zepp precisa ser exclusiva.');
  }
  let redirect: URL;
  try { redirect = new URL(redirectUri); }
  catch { throw new ServiceUnavailableException('Redirect Zepp invalido no servidor.'); }
  if (redirect.protocol !== 'https:' || redirect.pathname !== '/zepp/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new ServiceUnavailableException('Redirect Zepp invalido no servidor.');
  }
  return { clientId, clientSecret, redirectUri, key };
}

async function post(url: string, headers: Record<string, string>, body?: URLSearchParams): Promise<Response> {
  try {
    return await fetch(url, { method: 'POST', headers, body: body?.toString(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new BadGatewayException('Nao foi possivel contatar a Zepp.');
  }
}

// 4xx do endpoint de token => BadRequestException (recusa definitiva); rede/5xx/corpo invalido => BadGatewayException (transitorio).
async function readTokens(response: Response, kind: 'exchange' | 'refresh'): Promise<ProviderTokens & { userId: unknown }> {
  if (response.status >= 400 && response.status < 500) {
    throw new BadRequestException(kind === 'exchange' ? 'A Zepp recusou a autorizacao. Inicie outra conexao.' : 'A Zepp recusou a renovacao da conexao.');
  }
  if (!response.ok) throw new BadGatewayException('A Zepp esta indisponivel no momento.');
  let payload: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; user_id?: unknown };
  try { payload = await response.json() as typeof payload; }
  catch { throw new BadGatewayException('Resposta de autorizacao Zepp invalida.'); }
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new BadGatewayException('Resposta de autorizacao Zepp invalida.');
  const expires = Number(payload.expires_in);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token ? payload.refresh_token : null,
    expiresInSec: Number.isFinite(expires) && expires > 0 && expires <= MAX_EXPIRES_IN_SEC ? expires : null,
    userId: payload.user_id,
  };
}

export class ZeppOAuth implements OAuthCapability {
  constructor(private readonly config: ConfigService) {}

  isEnabledFor(userId: string): boolean {
    return isEnabledFor(this.config.get<string>('ZEPP_ENABLED_USER_IDS'), userId);
  }

  encryptionKey(): Buffer {
    return zeppSettings(this.config).key;
  }

  buildAuthorizationUrl({ state }: { state: string }): string {
    const { clientId } = zeppSettings(this.config);
    // A parte depois do "#" e' rota do app da Zepp; "token" pede o refresh token alem do access token.
    const query = `client_id=${encodeURIComponent(clientId)}&response_type=code&state=${encodeURIComponent(state)}&token=${encodeURIComponent('["access","refresh"]').replace(/%2C/g, ',')}`;
    return `${ZEPP_AUTHORIZATION_URL}#/login?${query}`;
  }

  async exchangeCode({ code }: { code: string }) {
    const s = zeppSettings(this.config);
    const response = await post(ZEPP_TOKEN_URL, { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, new URLSearchParams({
      client_id: s.clientId, client_secret: s.clientSecret, grant_type: 'authorization_code', redirect_uri: s.redirectUri, code,
    }));
    const tokens = await readTokens(response, 'exchange');
    const id = tokens.userId;
    const externalAccountId = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : typeof id === 'string' ? id : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(externalAccountId)) throw new BadGatewayException('A Zepp nao identificou a conta. Inicie outra conexao.');
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresInSec: tokens.expiresInSec, externalAccountId };
  }

  async refreshTokens({ refreshToken }: { refreshToken: string }): Promise<ProviderTokens> {
    const s = zeppSettings(this.config);
    // A documentacao exige o REFRESH token no Bearer e tambem no formulario; mandar o access token no lugar falha.
    const response = await post(ZEPP_REFRESH_URL, { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${refreshToken}`, Accept: 'application/json' }, new URLSearchParams({
      client_id: s.clientId, client_secret: s.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken,
    }));
    const { accessToken, refreshToken: next, expiresInSec } = await readTokens(response, 'refresh');
    return { accessToken, refreshToken: next, expiresInSec };
  }
}

export class ZeppRevocation implements RevocationCapability {
  async revoke({ accessToken }: { accessToken: string }): Promise<'revoked' | 'not_registered' | 'failed'> {
    try {
      const response = await post(ZEPP_REVOKE_URL, { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` });
      if (response.ok) return 'revoked';
      if (response.status === 401 || response.status === 404) return 'not_registered';
      return 'failed';
    } catch {
      return 'failed';
    }
  }
}
