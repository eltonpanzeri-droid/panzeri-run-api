import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZEPP_AUTHORIZATION_URL, ZEPP_REFRESH_URL, ZEPP_REVOKE_URL, ZEPP_TOKEN_URL, ZeppOAuth, ZeppRevocation, zeppSettings } from '../src/zepp/zepp-oauth';
import { buildZeppConnector } from '../src/zepp/zepp.connector';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { capabilitiesOf } from '../src/provider-hub/provider-connector';
import { ACCOUNT_DELETE_ORDER } from '../src/account-deletion/account-deletion.service';
import { BACKUP_EXCLUDED_TABLE_DATA } from '../src/backup/backup.service';

const KEY = 'a'.repeat(64);
const env: Record<string, string> = {
  ZEPP_CLIENT_ID: 'client-123', ZEPP_CLIENT_SECRET: 'segredo-zepp', ZEPP_REDIRECT_URI: 'https://api.exemplo.com/zepp/callback', ZEPP_TOKEN_ENCRYPTION_KEY: KEY,
};
const config = (over: Record<string, string | undefined> = {}) => ({ get: (k: string) => ({ ...env, ...over })[k] }) as unknown as ConfigService;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: jest.SpyInstance;
beforeEach(() => { fetchMock = jest.spyOn(global, 'fetch'); });
afterEach(() => { fetchMock.mockRestore(); });

describe('Zepp: URL de autorizacao (conforme a documentacao oficial)', () => {
  it('usa user.zepp.com, response_type=code, state e token=["access","refresh"]; sem scope, redirect_uri nem PKCE', () => {
    const url = new ZeppOAuth(config()).buildAuthorizationUrl({ state: 'ESTADO_ABC-123' });
    expect(url).toBe(`${ZEPP_AUTHORIZATION_URL}#/login?client_id=client-123&response_type=code&state=ESTADO_ABC-123&token=%5B%22access%22,%22refresh%22%5D`);
    expect(url).not.toMatch(/scope|redirect_uri|code_challenge|segredo-zepp/);
  });
});

describe('Zepp: troca do codigo', () => {
  it('POST form em auth.zepp.com com client_id/secret, authorization_code, redirect_uri e code; identifica a conta por user_id', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT', user_id: 987654 }));
    const result = await new ZeppOAuth(config()).exchangeCode({ code: 'CODIGO' });
    expect(result).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresInSec: 3600, externalAccountId: '987654' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ZEPP_TOKEN_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_id: 'client-123', client_secret: 'segredo-zepp', grant_type: 'authorization_code', redirect_uri: 'https://api.exemplo.com/zepp/callback', code: 'CODIGO',
    });
    expect(url).not.toContain('segredo');
  });

  it('user_id como texto e aceito; ausente ou com caracteres estranhos => 502 (nao grava conta desconhecida)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'AT', user_id: 'abc-123' }));
    expect((await new ZeppOAuth(config()).exchangeCode({ code: 'C' })).externalAccountId).toBe('abc-123');
    for (const user_id of [undefined, '', 'a b', '../x', {}]) {
      fetchMock.mockResolvedValueOnce(json(200, { access_token: 'AT', user_id }));
      await expect(new ZeppOAuth(config()).exchangeCode({ code: 'C' })).rejects.toThrow(BadGatewayException);
    }
  });

  it('4xx => recusa definitiva (400); 5xx, rede e corpo invalido => transitorio (502); sem access_token => 502', async () => {
    const oauth = new ZeppOAuth(config());
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
    await expect(oauth.exchangeCode({ code: 'C' })).rejects.toThrow(BadRequestException);
    fetchMock.mockResolvedValueOnce(json(401, {}));
    await expect(oauth.exchangeCode({ code: 'C' })).rejects.toThrow(BadRequestException);
    fetchMock.mockResolvedValueOnce(json(503, {}));
    await expect(oauth.exchangeCode({ code: 'C' })).rejects.toThrow(BadGatewayException);
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(oauth.exchangeCode({ code: 'C' })).rejects.toThrow(BadGatewayException);
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(oauth.exchangeCode({ code: 'C' })).rejects.toThrow(BadGatewayException);
    fetchMock.mockResolvedValueOnce(json(200, { user_id: '1' }));
    await expect(oauth.exchangeCode({ code: 'C' })).rejects.toThrow(BadGatewayException);
  });
});

describe('Zepp: renovacao', () => {
  it('manda o REFRESH token no Bearer e no formulario (nunca o access token) e le a resposta', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT2', refresh_token: 'RT-IGUAL', expires_in: 7200 }));
    const result = await new ZeppOAuth(config()).refreshTokens({ refreshToken: 'RT-ATUAL' });
    expect(result).toEqual({ accessToken: 'AT2', refreshToken: 'RT-IGUAL', expiresInSec: 7200 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ZEPP_REFRESH_URL);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer RT-ATUAL', 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ client_id: 'client-123', client_secret: 'segredo-zepp', grant_type: 'refresh_token', refresh_token: 'RT-ATUAL' });
  });

  it('campo de validade desconhecido na renovacao: nao inventa (null) e refresh token ausente vira null', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT2', expires_at: 123 }));
    expect(await new ZeppOAuth(config()).refreshTokens({ refreshToken: 'RT' })).toEqual({ accessToken: 'AT2', refreshToken: null, expiresInSec: null });
  });

  it('4xx na renovacao => recusa definitiva (o servico desconecta); 5xx => transitorio', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {}));
    await expect(new ZeppOAuth(config()).refreshTokens({ refreshToken: 'RT' })).rejects.toThrow(BadRequestException);
    fetchMock.mockResolvedValueOnce(json(500, {}));
    await expect(new ZeppOAuth(config()).refreshTokens({ refreshToken: 'RT' })).rejects.toThrow(BadGatewayException);
  });
});

describe('Zepp: revogacao', () => {
  it('POST sem corpo com Bearer do access token; 2xx = revogado, 401/404 = nao registrado, outros/rede = falhou', async () => {
    const revocation = new ZeppRevocation();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    expect(await revocation.revoke({ accessToken: 'AT' })).toBe('revoked');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ZEPP_REVOKE_URL);
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer AT' } });
    expect(init.body).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    expect(await revocation.revoke({ accessToken: 'AT' })).toBe('not_registered');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await revocation.revoke({ accessToken: 'AT' })).toBe('failed');
    fetchMock.mockRejectedValueOnce(new Error('rede'));
    expect(await revocation.revoke({ accessToken: 'AT' })).toBe('failed');
  });
});

describe('Zepp: configuracao e habilitacao (fail-closed)', () => {
  it('sem qualquer variavel obrigatoria => 503 e nenhuma chamada externa', () => {
    for (const name of Object.keys(env)) {
      expect(() => zeppSettings(config({ [name]: undefined }))).toThrow(ServiceUnavailableException);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chave fora do formato, repetida de outra integracao, ou redirect que nao seja https /zepp/callback => 503', () => {
    expect(() => zeppSettings(config({ ZEPP_TOKEN_ENCRYPTION_KEY: 'curta' }))).toThrow(ServiceUnavailableException);
    for (const other of ['POLAR_TOKEN_ENCRYPTION_KEY', 'STRAVA_TOKEN_ENCRYPTION_KEY', 'WAHOO_TOKEN_ENCRYPTION_KEY']) {
      expect(() => zeppSettings(config({ [other]: KEY.toUpperCase() }))).toThrow(/exclusiva/);
    }
    for (const redirect of ['http://api.exemplo.com/zepp/callback', 'https://api.exemplo.com/wahoo/callback', 'https://api.exemplo.com/zepp/callback?x=1', 'https://u:p@api.exemplo.com/zepp/callback', 'nao-e-url']) {
      expect(() => zeppSettings(config({ ZEPP_REDIRECT_URI: redirect }))).toThrow(ServiceUnavailableException);
    }
    expect(zeppSettings(config()).key).toHaveLength(32);
  });

  it('ninguem habilitado por padrao; so os ids listados (ou *)', () => {
    expect(new ZeppOAuth(config()).isEnabledFor('u1')).toBe(false);
    expect(new ZeppOAuth(config({ ZEPP_ENABLED_USER_IDS: '' })).isEnabledFor('u1')).toBe(false);
    expect(new ZeppOAuth(config({ ZEPP_ENABLED_USER_IDS: 'u1, u2' })).isEnabledFor('u2')).toBe(true);
    expect(new ZeppOAuth(config({ ZEPP_ENABLED_USER_IDS: 'u1' })).isEnabledFor('u3')).toBe(false);
    expect(new ZeppOAuth(config({ ZEPP_ENABLED_USER_IDS: '*' })).isEnabledFor('qualquer')).toBe(true);
  });
});

describe('Zepp: conector (nada de recebimento de dados ativado)', () => {
  it('declara SOMENTE oauth e revogacao: sem webhook, events nem sync', () => {
    const connector = buildZeppConnector(config());
    expect(connector.id).toBe('zepp');
    expect(capabilitiesOf(connector)).toEqual(['oauth', 'revocation']);
    expect(() => new ConnectorRegistry().register(connector)).not.toThrow();
  });

  it('o codigo da Zepp nao grava atividade nem saude: nenhuma referencia ao pipeline de atividades', () => {
    const dir = join(__dirname, '..', 'src', 'zepp');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      expect(readFileSync(join(dir, file), 'utf8')).not.toMatch(/activityLog|rawExternalActivity|rawActivitySample|activityTimeSeries|SessionExecutionLink|webhook\(/i);
    }
  });

  it('Polar, Wahoo, Strava e o pipeline de atividades nao dependem da Zepp nem da conexao generica', () => {
    for (const d of ['polar', 'wahoo', 'strava', 'activity-execution', 'apple-health', 'health-connect', 'integrations']) {
      const base = join(__dirname, '..', 'src', d);
      for (const file of readdirSync(base).filter((f) => f.endsWith('.ts'))) {
        expect(readFileSync(join(base, file), 'utf8')).not.toMatch(/zepp|ProviderConnection\b|provider-connection/i);
      }
    }
  });
});

describe('exclusao de conta e backup cobrem a conexao generica', () => {
  it('as tabelas novas entram na exclusao de conta, e a exclusao encerra as conexoes (revoga local primeiro)', () => {
    expect(ACCOUNT_DELETE_ORDER).toEqual(expect.arrayContaining(['providerConnection', 'providerOAuthAttempt', 'providerInboundEvent']));
    const source = readFileSync(join(__dirname, '..', 'src', 'account-deletion', 'account-deletion.service.ts'), 'utf8');
    expect(source).toContain('this.providerHub.disconnectAll(studentId)');
  });

  it('tokens cifrados e states nao entram nos dumps de backup', () => {
    expect(BACKUP_EXCLUDED_TABLE_DATA).toEqual(expect.arrayContaining(['ProviderConnection', 'ProviderOAuthAttempt']));
  });
});
