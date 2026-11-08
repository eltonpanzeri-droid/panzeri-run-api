import { createHash } from 'node:crypto';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GarminOAuth, GarminRevocation, GARMIN_API_BASE, GARMIN_AUTHORIZE_URL, GARMIN_TOKEN_URL, garminSettings, pkceChallengeOf, pkceVerifierFor } from '../src/garmin/garmin-oauth';
import { GARMIN_CONSENT } from '../src/garmin/garmin-consent';
import { buildGarminConnector, GARMIN_PROVIDER_ID } from '../src/garmin/garmin.connector';
import { GarminController } from '../src/garmin/garmin.controller';
import { consentTextHash } from '../src/provider-hub/provider-consent.service';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';

// 08/11/2026 — Garmin, lote 1: conexao OAuth2 PKCE, consentimento, desconexao e aviso de desregistro. Formatos conferidos em "OAuth2PKCE 2.0.pdf" (pasta "Documentação Garmin").
const KEY = 'a'.repeat(64);
const configOf = (values: Record<string, string | undefined>) => ({ get: (name: string) => values[name] }) as any;
const FULL = {
  GARMIN_CLIENT_ID: 'client-123', GARMIN_CLIENT_SECRET: 'secret-xyz', GARMIN_REDIRECT_URI: 'https://api.exemplo.com/garmin/callback', GARMIN_TOKEN_ENCRYPTION_KEY: KEY, GARMIN_ENABLED_USER_IDS: 'u1,u2',
};

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });
const jsonResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('configuracao e porta de habilitacao (fail-closed)', () => {
  it('sem credenciais a Garmin nao esta configurada', () => {
    expect(() => garminSettings(configOf({}))).toThrow(ServiceUnavailableException);
    expect(() => garminSettings(configOf({ ...FULL, GARMIN_CLIENT_SECRET: undefined }))).toThrow(ServiceUnavailableException);
  });
  it('o redirect precisa ser HTTPS e terminar em /garmin/callback', () => {
    expect(() => garminSettings(configOf({ ...FULL, GARMIN_REDIRECT_URI: 'http://api.exemplo.com/garmin/callback' }))).toThrow(ServiceUnavailableException);
    expect(() => garminSettings(configOf({ ...FULL, GARMIN_REDIRECT_URI: 'https://api.exemplo.com/outro' }))).toThrow(ServiceUnavailableException);
    expect(garminSettings(configOf(FULL)).redirectUri).toBe('https://api.exemplo.com/garmin/callback');
  });
  it('a chave de cifra precisa ser exclusiva (nao pode ser a de outra integracao)', () => {
    expect(() => garminSettings(configOf({ ...FULL, COROS_TOKEN_ENCRYPTION_KEY: KEY }))).toThrow(ServiceUnavailableException);
  });
  it('so quem esta em GARMIN_ENABLED_USER_IDS pode conectar; vazio = ninguem', () => {
    const oauth = new GarminOAuth(configOf(FULL));
    expect(oauth.isEnabledFor('u1')).toBe(true);
    expect(oauth.isEnabledFor('u3')).toBe(false);
    expect(new GarminOAuth(configOf({ ...FULL, GARMIN_ENABLED_USER_IDS: undefined })).isEnabledFor('u1')).toBe(false);
  });
});

describe('autorizacao (PKCE S256)', () => {
  it('monta a URL da Garmin com os parametros exigidos e o desafio do verifier derivado do state', () => {
    const oauth = new GarminOAuth(configOf(FULL));
    const url = new URL(oauth.buildAuthorizationUrl({ state: 'estado-1' }));
    expect(`${url.origin}${url.pathname}`).toBe(GARMIN_AUTHORIZE_URL);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.exemplo.com/garmin/callback');
    expect(url.searchParams.get('state')).toBe('estado-1');
    const verifier = pkceVerifierFor('estado-1', Buffer.from(KEY, 'hex'));
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallengeOf(verifier));
  });
  it('o verifier tem entre 43 e 128 caracteres validos e muda com o state', () => {
    const key = Buffer.from(KEY, 'hex');
    const a = pkceVerifierFor('a', key);
    expect(a).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(pkceVerifierFor('b', key)).not.toBe(a);
    expect(pkceChallengeOf(a)).toBe(createHash('sha256').update(a).digest('base64url'));
  });
  it('nenhum dado da aluna nem o segredo vai na URL', () => {
    const url = new GarminOAuth(configOf(FULL)).buildAuthorizationUrl({ state: 's' });
    expect(url).not.toContain('secret-xyz');
  });
});

describe('troca do codigo e renovacao', () => {
  it('troca o codigo NO SERVIDOR (corpo com segredo e verifier), le o identificador da conta e devolve os tokens', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url) === GARMIN_TOKEN_URL) return jsonResponse(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 86400, scope: 'x' });
      return jsonResponse(200, { userId: 'garmin-user-1' });
    }) as any;
    const result = await new GarminOAuth(configOf(FULL)).exchangeCode({ code: 'codigo', state: 'estado-1' });
    expect(result).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresInSec: 86400, externalAccountId: 'garmin-user-1' });
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_secret')).toBe('secret-xyz');
    expect(body.get('code')).toBe('codigo');
    expect(body.get('code_verifier')).toBe(pkceVerifierFor('estado-1', Buffer.from(KEY, 'hex')));
    expect(calls[1].url).toBe(`${GARMIN_API_BASE}/user/id`);
    expect(calls[1].init.headers.Authorization).toBe('Bearer AT');
  });
  it('sem state, recusa (nao ha como derivar o verifier)', async () => {
    await expect(new GarminOAuth(configOf(FULL)).exchangeCode({ code: 'c' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('recusa definitiva da Garmin (4xx) vira BadRequest; indisponibilidade vira erro transitorio', async () => {
    global.fetch = jest.fn(async () => jsonResponse(400, {})) as any;
    await expect(new GarminOAuth(configOf(FULL)).exchangeCode({ code: 'c', state: 's' })).rejects.toBeInstanceOf(BadRequestException);
    global.fetch = jest.fn(async () => jsonResponse(503, {})) as any;
    await expect(new GarminOAuth(configOf(FULL)).exchangeCode({ code: 'c', state: 's' })).rejects.not.toBeInstanceOf(BadRequestException);
  });
  it('conta sem identificador valido nao conecta', async () => {
    global.fetch = jest.fn(async (url: any) => (String(url) === GARMIN_TOKEN_URL ? jsonResponse(200, { access_token: 'AT', expires_in: 86400 }) : jsonResponse(200, { userId: '' }))) as any;
    await expect(new GarminOAuth(configOf(FULL)).exchangeCode({ code: 'c', state: 's' })).rejects.toThrow();
  });
  it('renovacao: devolve o refresh token NOVO; se o corpo for recusado, tenta uma vez com o cabecalho Basic', async () => {
    const seen: any[] = [];
    global.fetch = jest.fn(async (_url: any, init: any) => {
      seen.push(init);
      return seen.length === 1 ? jsonResponse(401, {}) : jsonResponse(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 86400 });
    }) as any;
    const result = await new GarminOAuth(configOf(FULL)).refreshTokens({ refreshToken: 'RT' });
    expect(result).toEqual({ accessToken: 'AT2', refreshToken: 'RT2', expiresInSec: 86400 });
    expect(seen).toHaveLength(2);
    expect(seen[1].headers.Authorization).toBe(`Basic ${Buffer.from('client-123:secret-xyz').toString('base64')}`);
  });
});

describe('desconexao: DELETE /user/registration (obrigatorio pela Garmin)', () => {
  it('chama o DELETE com o token da aluna', async () => {
    let seen: any;
    global.fetch = jest.fn(async (url: any, init: any) => { seen = { url: String(url), init }; return jsonResponse(204, {}); }) as any;
    expect(await new GarminRevocation(configOf(FULL)).revoke({ accessToken: 'AT' })).toBe('revoked');
    expect(seen.url).toBe(`${GARMIN_API_BASE}/user/registration`);
    expect(seen.init.method).toBe('DELETE');
    expect(seen.init.headers.Authorization).toBe('Bearer AT');
  });
  it('token ja invalido = nao registrada; falha de rede nunca lanca', async () => {
    global.fetch = jest.fn(async () => jsonResponse(401, {})) as any;
    expect(await new GarminRevocation(configOf(FULL)).revoke({ accessToken: 'AT' })).toBe('not_registered');
    global.fetch = jest.fn(async () => { throw new Error('rede'); }) as any;
    expect(await new GarminRevocation(configOf(FULL)).revoke({ accessToken: 'AT' })).toBe('failed');
  });
});

describe('texto de autorizacao (coerente com a Politica, secao 5D)', () => {
  const all = JSON.stringify(GARMIN_CONSENT);
  it('tres autorizacoes separadas: conexao + envio de treinos + Atlas, nenhuma presumida', () => {
    expect(GARMIN_CONSENT.optionalPurposes.map((p) => p.id)).toEqual(['watch_delivery', 'ai_external']);
    expect(GARMIN_CONSENT.optionalPurposes.every((p) => p.screen && p.changeableAfterConnect)).toBe(true);
    expect(GARMIN_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')?.external).toBe(true);
    expect(GARMIN_CONSENT.purposes).not.toContain('ai_external');
    expect(GARMIN_CONSENT.purposes).not.toContain('watch_delivery');
  });
  it('sem percurso GPS, sem ciclo menstrual e sem historico (o Starter nao traz historico)', () => {
    const categories = GARMIN_CONSENT.groups.flatMap((g) => g.categories);
    expect(categories).not.toContain('activity_route');
    expect(categories).not.toContain('menstrual_cycle');
    expect(GARMIN_CONSENT.optionalPurposes.map((p) => p.id)).not.toContain('history_backfill');
    expect(all).toContain('não guarda coordenadas');
  });
  it('declara que dados Garmin nao treinam modelos de IA e que nao ha venda', () => {
    expect(all).toContain('não usa dados da Garmin');
    expect(all).toContain('treinar, avaliar ou melhorar modelos');
    expect(all).toContain('não são vendidos');
  });
  it('so a conta e obrigatoria; o texto tem hash estavel', () => {
    expect(GARMIN_CONSENT.groups.filter((g) => g.required).map((g) => g.id)).toEqual(['account']);
    expect(consentTextHash(GARMIN_CONSENT)).toBe(consentTextHash(GARMIN_CONSENT));
  });
  it('linguagem do projeto: "Panzeri Run" e "programa de treino", sem "plano de treino"', () => {
    expect(all).not.toMatch(/plano de treino/i);
    expect(all).not.toMatch(/\bapp\b/i);
  });
});

describe('conector', () => {
  it('declara oauth, consent e revogacao e e aceito pelo registro', () => {
    const connector = buildGarminConnector(configOf(FULL));
    expect(connector.id).toBe(GARMIN_PROVIDER_ID);
    expect(connector.oauth && connector.consent && connector.revocation).toBeTruthy();
    expect(() => new ConnectorRegistry().register(connector)).not.toThrow();
  });
});

describe('aviso de desregistro (webhook sem assinatura: chave secreta no endereco)', () => {
  const KEY32 = 'k'.repeat(40);
  function controller(keyValue: string | undefined, revocation = jest.fn(async (_p: string, id: string) => (id === 'garmin-user-1' ? 'closed' : 'nothing'))) {
    const connections: any = { handleRemoteRevocation: revocation };
    return { ctrl: new GarminController(connections, configOf({ GARMIN_WEBHOOK_KEY: keyValue }), {} as any, {} as any), revocation };
  }
  it('sem chave configurada (ou fraca) a rota nao existe', async () => {
    await expect(controller(undefined).ctrl.deregistrations('x', { deregistrations: [] })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller('curta').ctrl.deregistrations('curta', { deregistrations: [] })).rejects.toBeInstanceOf(NotFoundException);
  });
  it('chave errada = 404 e nada e encerrado', async () => {
    const { ctrl, revocation } = controller(KEY32);
    await expect(ctrl.deregistrations('errada', { deregistrations: [{ userId: 'garmin-user-1' }] })).rejects.toBeInstanceOf(NotFoundException);
    expect(revocation).not.toHaveBeenCalled();
  });
  it('chave certa: encerra a conexao de quem desregistrou e ignora identificadores invalidos', async () => {
    const { ctrl, revocation } = controller(KEY32);
    const result = await ctrl.deregistrations(KEY32, { deregistrations: [{ userId: 'garmin-user-1' }, { userId: 'com espaco' }, { userId: 123 }, null, { userId: 'desconhecido' }] });
    expect(result).toEqual({ ok: true, closed: 1 });
    expect(revocation.mock.calls.map((c) => c[1])).toEqual(['garmin-user-1', 'desconhecido']);
    expect(revocation.mock.calls[0][0]).toBe('garmin');
  });
  it('corpo sem a lista nao quebra', async () => {
    expect(await controller(KEY32).ctrl.deregistrations(KEY32, {})).toEqual({ ok: true, closed: 0 });
  });
});
