import { readdirSync, readFileSync } from 'fs';
import { join, sep } from 'path';
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
    expect(capabilitiesOf(connector)).toEqual(['consent', 'oauth', 'revocation']);
    expect(() => new ConnectorRegistry().register(connector)).not.toThrow();
  });

  it('so os servicos de gravacao e de vinculo exato da Zepp tocam o pipeline de atividades (ActivityLog, raw, serie, vinculo); o FIT original nunca e gravado', () => {
    const dir = join(__dirname, '..', 'src', 'zepp');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !['zepp-activity-ingestion.service.ts'].includes(f))) {
      expect(readFileSync(join(dir, file), 'utf8')).not.toMatch(/activityLog|rawExternalActivity|rawActivitySample|activityTimeSeries|SessionExecutionLink|\bwebhook\(/i);
    }
  });

  it('Polar, Wahoo, Strava e o pipeline de atividades nao dependem da Zepp nem da conexao generica', () => {
    for (const d of ['polar', 'wahoo', 'strava', 'activity-execution', 'apple-health', 'health-connect']) {
      const base = join(__dirname, '..', 'src', d);
      for (const file of readdirSync(base).filter((f) => f.endsWith('.ts') && !(d === 'health-connect' && /^health-connect-(consent|health)/.test(f)) && !(d === 'polar' && /^polar-health/.test(f)))) {
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

describe('Zepp: textos de consentimento 2.0, grupos e telas por finalidade', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ZEPP_CONSENT } = require('../src/zepp/zepp-consent');
  const { consentTextHash, purposeTextHash } = require('../src/provider-hub/provider-consent.service');
  const all = JSON.stringify(ZEPP_CONSENT);
  const optional = Object.fromEntries(ZEPP_CONSENT.optionalPurposes.map((p: any) => [p.id, p]));

  it('tela da conexao 2.0: titulo, descricao, frase obrigatoria e botao exatamente como aprovados; nada vem marcado', () => {
    expect(ZEPP_CONSENT.version).toBe('2.1');
    expect(ZEPP_CONSENT.dateLabel).toBe('21/10/2026');
    expect(ZEPP_CONSENT.title).toBe('Conecte seu Amazfit ao Panzeri Run');
    expect(ZEPP_CONSENT.intro).toBe('Conecte sua conta Zepp ao Panzeri Run para acompanhar seus treinos em um só lugar.');
    expect(all).toContain('Com sua autorização, poderemos receber informações das atividades registradas pelo seu Amazfit (como distância, duração, ritmo, frequência cardíaca, cadência, potência, elevação e percurso GPS), do seu sono e recuperação (etapas do sono, cochilos, pontuação de sono e variabilidade da frequência cardíaca, a HRV) e da sua saúde diária (passos, distância, calorias ativas e frequência cardíaca de repouso), conforme os dados disponíveis no dispositivo e as permissões concedidas.');
    expect(all).toContain('Essas informações serão utilizadas para acompanhar sua evolução, comparar os treinos planejados com os realizados, entender como você se recupera e personalizar seu treinamento. Elas não substituem avaliação médica.');
    expect(ZEPP_CONSENT.acknowledgementText).toBe('Autorizo o Panzeri Run a acessar e utilizar os dados que eu selecionar na conexão com a Zepp, para acompanhamento e gestão do meu treinamento e da minha recuperação.');
    expect(optional.history_backfill.label).toBe('Autorizo a importação das minhas atividades anteriores, limitada aos últimos 30 dias e ao período permitido pela Zepp.');
    expect(ZEPP_CONSENT.confirmButtonLabel).toBe('Conectar minha conta Zepp');
    expect(all).toMatch(/sono/i); // 2.1: sono, saude diaria e HRV agora existem (grupos proprios, independentes das atividades)
    expect(consentTextHash(ZEPP_CONSENT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tela do envio de treinos ao relogio: texto, caixa e botao aprovados; versao e hash proprios', () => {
    const screen = optional.watch_delivery.screen;
    expect(screen).toMatchObject({ version: '1.0', title: 'Receba seus treinos no relógio', buttonLabel: 'Autorizar envio de treinos' });
    expect(screen.checkboxText).toBe('Autorizo o Panzeri Run a enviar e atualizar meus treinos programados na minha conta Zepp para sincronização com meu Amazfit.');
    expect(screen.paragraphs[0]).toBe('O Panzeri Run pode enviar seus treinos de corrida para o aplicativo Zepp, permitindo sincronizá-los com um relógio Amazfit compatível.');
    expect(screen.paragraphs.join(' ')).toContain('Quando seu treinador atualizar uma prescrição, o Panzeri Run poderá atualizar os treinos enviados à Zepp.');
    expect(screen.paragraphs.join(' ')).toContain('não é presumida a partir da conexão com a Zepp');
    expect(optional.watch_delivery).toMatchObject({ external: false, changeableAfterConnect: true });
    expect(purposeTextHash(optional.watch_delivery)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tela do Atlas: Anthropic nomeada, transferencia internacional, limitacoes, recusa sem prejuizo e proibicao de uso derivado; autorizacao propria e externa', () => {
    const screen = optional.ai_external.screen;
    const text = screen.paragraphs.join(' ');
    expect(screen).toMatchObject({ version: '1.1', title: 'Personalize seus treinos com o Atlas', buttonLabel: 'Autorizar análise com Atlas' });
    expect(screen.checkboxText).toBe('Autorizo o Panzeri Run a utilizar meus dados Zepp/Amazfit autorizados para análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic para processamento por inteligência artificial, conforme a Política de Privacidade.');
    expect(text).toContain('Anthropic');
    expect(text).toContain('transferência internacional de dados, conforme descrito na Política de Privacidade');
    expect(text).toContain('não substituem avaliação médica');
    expect(text).toContain('A recusa desta autorização não impede você de conectar o Amazfit');
    expect(text).toContain('nem diretamente nem por meio de relatórios ou informações derivados deles');
    expect(optional.ai_external).toMatchObject({ external: true, changeableAfterConnect: true });
    expect(purposeTextHash(optional.ai_external)).not.toBe(purposeTextHash(optional.watch_delivery));
  });

  it('as finalidades obrigatorias NAO incluem IA, envio de treinos, treinamento de modelos nem nada alem do descrito; mudar o texto de uma tela muda o hash dela', () => {
    expect([...ZEPP_CONSENT.purposes].sort()).toEqual(['coach_view', 'history', 'indicators', 'plan_comparison', 'tracking']);
    for (const forbidden of ['ai', 'ia', 'ai_external', 'ai_internal', 'model_training', 'atlas', 'watch_delivery']) expect(ZEPP_CONSENT.purposes).not.toContain(forbidden);
    expect(Object.keys(optional).sort()).toEqual(['ai_external', 'history_backfill', 'watch_delivery']);
    expect(optional.history_backfill).toMatchObject({ external: false, changeableAfterConnect: true });
    expect(optional.history_backfill.screen).toBeUndefined(); // o texto do historico faz parte da tela da conexao
    const changed = { ...optional.ai_external, screen: { ...optional.ai_external.screen, paragraphs: [...optional.ai_external.screen.paragraphs, 'novo'] } };
    expect(purposeTextHash(changed)).not.toBe(purposeTextHash(optional.ai_external));
  });

  it('grupos: so a identificacao da conta e obrigatoria; sensores e GPS dependem de atividades; nenhum grupo concede categoria fora do conector', () => {
    const byId = Object.fromEntries(ZEPP_CONSENT.groups.map((g: any) => [g.id, g]));
    expect(byId.account).toMatchObject({ required: true, categories: ['profile'] });
    expect(byId.activity).toMatchObject({ required: false, categories: ['activity'] });
    expect(byId.route).toMatchObject({ required: false, categories: ['activity_route'], requires: ['activity'] });
    expect(byId.sensors).toMatchObject({ required: false, categories: ['activity_sensors'], requires: ['activity'] });
    expect(byId.sleep).toMatchObject({ required: false, categories: ['sleep'] });
    expect(byId.daily).toMatchObject({ required: false, categories: ['daily_activity', 'resting_heart_rate'] });
    expect(byId.hrv).toMatchObject({ required: false, categories: ['hrv'] });
    for (const id of ['sleep', 'daily', 'hrv']) expect(byId[id].requires).toBeUndefined(); // independentes das atividades
    expect(ZEPP_CONSENT.groups.filter((g: any) => g.required).map((g: any) => g.id)).toEqual(['account']);
    expect(() => new ConnectorRegistry().register(buildZeppConnector(config()))).not.toThrow(); // o registro valida categorias dos grupos
  });
});

describe('Zepp: acesso restrito e unico ponto de acesso a conexao', () => {
  it('toda rota autenticada exige o JWT do proprio usuario (aluno inclusive; a porta ZEPP_ENABLED_USER_IDS continua fail-closed); so o callback e publico', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'zepp', 'zepp.controller.ts'), 'utf8');
    const guarded = source.match(/@UseGuards\(AuthGuard\('jwt'\)\)/g) ?? [];
    expect(guarded).toHaveLength(12); // connect, purposes, groups, reconfirm, permissions, consent, status, disconnect, data + workouts/status, workouts/sync, workouts/clear
    const routes = source.match(/@(Get|Post|Delete)\('/g) ?? [];
    expect(routes).toHaveLength(guarded.length + 1); // + callback
    expect(source).not.toMatch(/user\.sub\s*=|body\??\.userId|query\.userId/); // nenhum userId vem do cliente
    expect(source.indexOf("@Get('callback')")).toBeGreaterThan(-1);
    expect(source.slice(source.indexOf("@Get('callback')") - 120, source.indexOf("@Get('callback')"))).not.toContain('AuthGuard');
  });

  it('apenas o servico de conexao e o de consentimento leem a tabela de conexoes (tokens nao saem por outro caminho)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && /\.providerConnection\./.test(readFileSync(full, 'utf8')) && !/(provider-hub\/(provider-connection|provider-consent)\.service\.ts|ai-governance\/ai-data-eligibility\.service\.ts|integrations\/integrations\.service\.ts|health-connect\/health-connect-consent\.service\.ts|coach\/student-integrations\.service\.ts|legacy-consent\/legacy-consent\.service\.ts|polar\/polar-health-consent\.service\.ts|polar\/polar-health-ingestion\.service\.ts)$/.test(full.split(sep).join('/'))) offenders.push(full);
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});
