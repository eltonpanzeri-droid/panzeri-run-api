import { buildIntegrationsCatalog, INTEGRATION_PROVIDERS } from '../src/integrations/integrations-catalog';

const WAHOO_ENV = ['WAHOO_CLIENT_ID', 'WAHOO_CLIENT_SECRET', 'WAHOO_REDIRECT_URI', 'WAHOO_TOKEN_ENCRYPTION_KEY'];
const ENV_OK = new Set(['POLAR_CLIENT_ID', 'STRAVA_CLIENT_ID', ...WAHOO_ENV]);
const none = new Set<string>();
const byId = (list: ReturnType<typeof buildIntegrationsCatalog>, id: string) => list.find((entry) => entry.id === id)!;

describe('catalogo de dispositivos e integracoes', () => {
  it('lista os 9 provedores, sem ids duplicados', () => {
    const ids = INTEGRATION_PROVIDERS.map((provider) => provider.id);
    expect(ids).toEqual(['polar', 'strava', 'apple_watch', 'health_connect', 'samsung', 'garmin', 'coros', 'wahoo', 'zepp']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Polar: disponivel e desconectada por padrao; Strava: INDISPONIVEL para novos alunos (30/10/2026) e disponivel so para quem ja esta conectado', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: none });
    expect(byId(catalog, 'polar')).toMatchObject({ availability: 'available', connection: { state: 'disconnected' }, capabilities: { receiveActivities: true, sendWorkouts: false } });
    expect(byId(catalog, 'strava')).toMatchObject({ availability: 'unavailable', summary: 'Indisponível para novos alunos.', connection: { state: 'not_applicable' }, capabilities: { receiveActivities: false, sendWorkouts: false } });
    const connected = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set(['strava']) }), 'strava');
    expect(connected).toMatchObject({ availability: 'available', connection: { state: 'connected' } });
    expect(connected.summary).toContain('quem já conectou continua com o acesso');
  });

  it('conexao e individual: so o provedor conectado do aluno aparece conectado', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set(['strava']) });
    expect(byId(catalog, 'strava').connection.state).toBe('connected');
    expect(byId(catalog, 'polar').connection.state).toBe('disconnected');
  });

  it('sem configuracao no servidor, a integracao deixa de ser oferecida (sem fingir disponibilidade)', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: none, connectedProviderIds: new Set(['polar']) });
    const polar = byId(catalog, 'polar');
    expect(polar.availability).toBe('unavailable');
    expect(polar.connection.state).toBe('not_applicable');
    expect(polar.capabilities).toEqual({ receiveActivities: false, sendWorkouts: false });
    expect(polar.summary).toBe('Integração indisponível no momento.');
  });

  it('Apple Watch: sem selo de validacao (30/10/2026, decisao de Elton); so iOS nativo', () => {
    const apple = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: none }), 'apple_watch');
    expect(apple.availability).toBe('available');
    expect(apple.platforms).toEqual(['ios_native']);
    expect(apple.summary).not.toMatch(/valida/i);
  });

  it('Samsung / Galaxy Watch: disponivel no Android e leva ao Health Connect (os dados da Samsung chegam por ele)', () => {
    const entry = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set() }), 'samsung');
    expect(entry.availability).toBe('available');
    expect(entry.platforms).toEqual(['android']);
    expect(entry.capabilities).toEqual({ receiveActivities: true, sendWorkouts: false });
    expect(entry.summary).toContain('Health Connect');
  });

  it('Garmin: indisponivel, sem capacidades nem conexao (mantido assim por decisao de Elton em 22/10/2026; a COROS passou a ser integrada em 30/10/2026)', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set(['garmin']) });
    for (const id of ['garmin']) {
      const entry = byId(catalog, id);
      expect(entry.availability).toBe('unavailable');
      expect(entry.connection.state).toBe('not_applicable');
      expect(entry.capabilities).toEqual({ receiveActivities: false, sendWorkouts: false });
    }
  });

  it('Wahoo em validacao: credenciais configuradas NAO liberam; so quem esta habilitado (ou ja conectado, para poder desconectar) a ve disponivel', () => {
    const none = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set() }), 'wahoo');
    expect(none.availability).toBe('unavailable');
    expect(none.summary).toBe('Integração indisponível no momento.');
    const allowed = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set(), allowedProviderIds: new Set(['wahoo']) }), 'wahoo');
    expect(allowed.availability).toBe('available');
    expect(allowed.connection.state).toBe('disconnected');
    const connectedOnly = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set(['wahoo']) }), 'wahoo');
    expect(connectedOnly.availability).toBe('available');
    const noEnv = byId(buildIntegrationsCatalog({ configuredEnv: new Set(), connectedProviderIds: new Set(), allowedProviderIds: new Set(['wahoo']) }), 'wahoo');
    expect(noEnv.availability).toBe('unavailable'); // habilitado, mas sem credenciais
    expect(byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set() }), 'polar').availability).toBe('available'); // Polar/Strava nao dependem da lista
  });

  it('Wahoo (Etapa 5): disponivel so com as 4 variaveis; recebe atividades e NAO envia treino', () => {
    const on = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set(['wahoo']), allowedProviderIds: new Set(['wahoo']) }), 'wahoo');
    expect(on.availability).toBe('available');
    expect(on.connection.state).toBe('connected');
    expect(on.capabilities).toEqual({ receiveActivities: true, sendWorkouts: false });
    for (const missing of WAHOO_ENV) {
      const env = new Set([...ENV_OK].filter((name) => name !== missing));
      const off = byId(buildIntegrationsCatalog({ configuredEnv: env, connectedProviderIds: new Set(['wahoo']), allowedProviderIds: new Set(['wahoo']) }), 'wahoo');
      expect(off.availability).toBe('unavailable');
      expect(off.connection.state).toBe('not_applicable');
    }
  });

  it('nao vaza o nome da variavel de ambiente', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: none });
    expect(JSON.stringify(catalog)).not.toContain('CLIENT_ID');
  });
});

describe('GET /me/integrations: autenticacao e escopo', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { IntegrationsController } = require('../src/integrations/integrations.controller');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { IntegrationsService } = require('../src/integrations/integrations.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path');

  it('rota protegida por JWT e sem @Public', () => {
    const guards = Reflect.getMetadata('__guards__', IntegrationsController) as unknown[];
    expect(guards?.length).toBeGreaterThan(0);
    expect(Reflect.getMetadata('path', IntegrationsController)).toBe('me/integrations');
  });

  it('le somente o estado da conexao do proprio aluno, nunca token/segredo/dado esportivo', async () => {
    const calls: Array<{ model: string; args: any }> = [];
    const prisma = {
      polarConnection: { findUnique: async (args: any) => { calls.push({ model: 'polar', args }); return { disconnectedAt: null }; } },
      stravaConnection: { findUnique: async (args: any) => { calls.push({ model: 'strava', args }); return { id: 'x' }; } },
      wahooConnection: { findUnique: async (args: any) => { calls.push({ model: 'wahoo', args }); return { disconnectedAt: null }; } },
      providerConnection: { findUnique: async (args: any) => { calls.push({ model: 'zepp', args }); return { disconnectedAt: null }; } },
    };
    const config = { get: (key: string) => (key.endsWith('CLIENT_ID') ? 'segredo-nao-pode-sair' : undefined) };
    const service = new IntegrationsService(prisma, config);
    const result = await service.catalog('aluno-A');
    expect(calls.map((call) => call.args.where)).toEqual([{ userId: 'aluno-A' }, { userId: 'aluno-A' }, { userId: 'aluno-A' }, { provider_userId: { provider: 'zepp', userId: 'aluno-A' } }, { provider_userId: { provider: 'polar', userId: 'aluno-A' } }, { provider_userId: { provider: 'wahoo', userId: 'aluno-A' } }, { provider_userId: { provider: 'coros', userId: 'aluno-A' } }]); // + decisoes sobre o Atlas (Polar/Wahoo), so' estado
    expect(calls[0].args.select).toEqual({ disconnectedAt: true });
    expect(calls[1].args.select).toEqual({ id: true });
    expect(calls[2].args.select).toEqual({ disconnectedAt: true });
    expect(calls[3].args.select).toEqual({ disconnectedAt: true, grantedPurposes: true, purposeConsents: true }); // Zepp: so' estado e autorizacoes (para destacar o que falta), nunca token
    const body = JSON.stringify(result);
    expect(body).not.toContain('segredo-nao-pode-sair');
    expect(body).not.toMatch(/token|secret|aluno-A|athleteId|polarUserId/i);
  });

  it('WAHOO_ENABLED_USER_IDS=* + credenciais completas: a Wahoo fica disponivel para QUALQUER aluno; sem a lista ou sem credencial, nao', async () => {
    const prisma = { polarConnection: { findUnique: async () => null }, stravaConnection: { findUnique: async () => null }, wahooConnection: { findUnique: async () => null }, providerConnection: { findUnique: async () => null } };
    const full: Record<string, string> = { POLAR_CLIENT_ID: 'p', STRAVA_CLIENT_ID: 's', WAHOO_CLIENT_ID: 'w', WAHOO_CLIENT_SECRET: 'w', WAHOO_REDIRECT_URI: 'w', WAHOO_TOKEN_ENCRYPTION_KEY: 'w' };
    const wahooFor = async (env: Record<string, string>, user: string) => {
      const service = new IntegrationsService(prisma, { get: (k: string) => env[k] });
      return (await service.catalog(user)).providers.find((p: { id: string }) => p.id === 'wahoo');
    };
    for (const user of ['aluno-1', 'aluno-2', 'qualquer-outro']) {
      expect((await wahooFor({ ...full, WAHOO_ENABLED_USER_IDS: '*' }, user)).availability).toBe('available');
    }
    expect((await wahooFor(full, 'aluno-1')).availability).toBe('unavailable');
    expect((await wahooFor({ ...full, WAHOO_ENABLED_USER_IDS: '*', WAHOO_CLIENT_SECRET: '' }, 'aluno-1')).availability).toBe('unavailable');
    const summary = (await wahooFor({ ...full, WAHOO_ENABLED_USER_IDS: '*' }, 'aluno-1')).summary as string;
    expect(summary).toContain('ainda em validação com atividades reais');
  });

  it('o servico nao referencia campos sensiveis das tabelas de conexao', () => {
    const source = readFileSync(join(__dirname, '../src/integrations/integrations.service.ts'), 'utf8');
    expect(source).not.toMatch(/accessToken|refreshToken|athleteId|polarUserId|wahooUserId|stravaActivity|rawExternalActivity/);
  });
});

describe('GET /me/integrations: destaca autorizacoes opcionais pendentes (22/10/2026)', () => {
  const { IntegrationsService } = require('../src/integrations/integrations.service');
  const env = { ZEPP_CLIENT_ID: 'x', ZEPP_CLIENT_SECRET: 'x', ZEPP_REDIRECT_URI: 'x', ZEPP_TOKEN_ENCRYPTION_KEY: 'x', ZEPP_ENABLED_USER_IDS: '*' } as Record<string, string>;
  const catalogFor = async (zepp: unknown) => {
    const prisma = { polarConnection: { findUnique: async () => null }, stravaConnection: { findUnique: async () => null }, wahooConnection: { findUnique: async () => null }, providerConnection: { findUnique: async () => zepp } };
    return (await new IntegrationsService(prisma, { get: (k: string) => env[k] }).catalog('aluno-A')).providers.find((p: any) => p.id === 'zepp');
  };

  it('conectada sem as telas proprias: lista o que falta; nao conectada: nada pendente', async () => {
    expect((await catalogFor({ disconnectedAt: null, grantedPurposes: ['history', 'tracking'], purposeConsents: null })).pendingAuthorizations).toEqual(['envio de treinos ao relógio', 'análise com o Atlas']);
    expect((await catalogFor(null)).pendingAuthorizations).toBeUndefined();
    expect((await catalogFor({ disconnectedAt: new Date(), grantedPurposes: [], purposeConsents: null })).pendingAuthorizations).toBeUndefined();
  });

  it('autorizacao dada sobre o texto vigente sai da lista; texto antigo volta a ser pendente', async () => {
    const { ZEPP_CONSENT } = require('../src/zepp/zepp-consent');
    const { purposeTextHash } = require('../src/provider-hub/provider-consent.service');
    const watch = ZEPP_CONSENT.optionalPurposes.find((p: any) => p.id === 'watch_delivery');
    const record = { version: watch.screen.version, textHash: purposeTextHash(watch), grantedAt: '2026-10-22T12:00:00.000Z' };
    expect((await catalogFor({ disconnectedAt: null, grantedPurposes: ['watch_delivery'], purposeConsents: { watch_delivery: record } })).pendingAuthorizations).toEqual(['análise com o Atlas']);
    expect((await catalogFor({ disconnectedAt: null, grantedPurposes: ['watch_delivery'], purposeConsents: { watch_delivery: { ...record, version: '0.1' } } })).pendingAuthorizations).toEqual(['envio de treinos ao relógio', 'análise com o Atlas']);
  });
});

describe('perfil padrao de cada integracao (30/10/2026)', () => {
  const byId = (id: string) => INTEGRATION_PROVIDERS.find((p) => p.id === id)!;

  it('toda integracao tem perfil com nota de envio de treinos nao vazia, e o perfil nunca promete o que a capacidade nega', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(provider.profile.workoutDeliveryNote.trim().length).toBeGreaterThan(10);
      if (provider.profile.workoutDelivery === 'available') expect(provider.capabilities.sendWorkouts).toBe(true);
      if (!provider.capabilities.sendWorkouts) expect(provider.profile.workoutDelivery).not.toBe('available');
    }
  });

  it('Samsung usa os mesmos canais do Health Connect e NAO afirma envio de treinos ao Galaxy Watch', () => {
    expect(byId('samsung').profile.workoutDelivery).toBe('not_available');
    expect(byId('samsung').profile.workoutDeliveryNote).toContain('parceria');
    expect(byId('samsung').capabilities.sendWorkouts).toBe(false);
  });

  it('COROS (30/10/2026): em validacao como a Zepp: so' + "'" + ' aparece disponivel com as variaveis COROS_* no servidor E a aluna habilitada; envia treinos, mas avisa que nao consegue apagar', () => {
    const coros = byId('coros');
    expect(coros.requiresAllowlist).toBe(true);
    expect(coros.requiresEnv).toEqual(['COROS_CLIENT_ID', 'COROS_REDIRECT_URI', 'COROS_TOKEN_ENCRYPTION_KEY']);
    expect(coros.capabilities).toEqual({ receiveActivities: true, sendWorkouts: true });
    expect(coros.profile.workoutDelivery).toBe('available');
    expect(coros.profile.workoutDeliveryNote).toContain('não permite que o Panzeri Run apague');
    expect(coros.profile.aiUse).toBe('with_consent');
    const closed = buildIntegrationsCatalog({ configuredEnv: new Set(coros.requiresEnv as string[]), connectedProviderIds: new Set() }).find((entry) => entry.id === 'coros')!;
    expect(closed.availability).toBe('unavailable'); // sem a porta de habilitacao
    const open = buildIntegrationsCatalog({ configuredEnv: new Set(coros.requiresEnv as string[]), connectedProviderIds: new Set(), allowedProviderIds: new Set(['coros']) }).find((entry) => entry.id === 'coros')!;
    expect(open.availability).toBe('available');
  });

  it('Strava nunca alimenta a IA; Zepp so com autorizacao propria', () => {
    expect(byId('strava').profile.aiUse).toBe('not_used');
    expect(byId('zepp').profile.aiUse).toBe('with_consent');
  });

  it('o catalogo entregue ao app leva o perfil de cada integracao', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: new Set(), connectedProviderIds: new Set() });
    for (const entry of catalog) expect(entry.profile).toBeDefined();
  });
});

describe('roteiro padrao no app (StandardDeviceInfo)', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'mobile', 'src', 'integrations', 'StandardDeviceInfo.tsx'), 'utf8') as string;

  it('o app tem texto para todos os grupos de dados que o catalogo pode oferecer', () => {
    const used = new Set(INTEGRATION_PROVIDERS.flatMap((p) => p.profile.dataGroups));
    for (const group of used) expect(source).toContain(`  ${group}: { label:`);
  });

  it('o roteiro cobre as secoes combinadas, inclusive o envio de treinos e a regra do Strava (nunca na IA)', () => {
    for (const phrase of ['Quais informações podem ser compartilhadas', 'Como utilizamos essas informações', 'Envio de treinos ao dispositivo', 'Suas autorizações', 'não são enviados à inteligência artificial', 'Nenhum dado seu é solicitado enquanto ela não for liberada']) {
      expect(source).toContain(phrase);
    }
  });

  it('o hub mostra o roteiro para qualquer integracao e abre sozinho quando nao ha tela propria ou a integracao nao esta disponivel', () => {
    const hub = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'mobile', 'src', 'integrations', 'IntegrationsHub.tsx'), 'utf8') as string;
    expect(hub).toContain('<StandardDeviceInfo');
    expect(hub).toContain("defaultOpen={!render || selected.availability !== 'available'}");
  });
});
