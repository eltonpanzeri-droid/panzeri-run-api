import { buildIntegrationsCatalog, INTEGRATION_PROVIDERS } from '../src/integrations/integrations-catalog';

const ENV_OK = new Set(['POLAR_CLIENT_ID', 'STRAVA_CLIENT_ID']);
const none = new Set<string>();
const byId = (list: ReturnType<typeof buildIntegrationsCatalog>, id: string) => list.find((entry) => entry.id === id)!;

describe('catalogo de dispositivos e integracoes', () => {
  it('lista os 7 fabricantes, sem ids duplicados', () => {
    const ids = INTEGRATION_PROVIDERS.map((provider) => provider.id);
    expect(ids).toEqual(['polar', 'strava', 'apple_watch', 'samsung', 'garmin', 'coros', 'wahoo']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Polar e Strava: disponiveis e desconectados por padrao', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: none });
    for (const id of ['polar', 'strava']) {
      expect(byId(catalog, id).availability).toBe('available');
      expect(byId(catalog, id).connection.state).toBe('disconnected');
      expect(byId(catalog, id).capabilities).toEqual({ receiveActivities: true, sendWorkouts: false });
    }
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

  it('Apple Watch nunca e anunciado como disponivel; so iOS nativo', () => {
    const apple = byId(buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: none }), 'apple_watch');
    expect(apple.availability).toBe('preparing');
    expect(apple.platforms).toEqual(['ios_native']);
    expect(apple.connection.state).toBe('not_applicable');
  });

  it('Samsung, Garmin, COROS e Wahoo: indisponiveis, sem capacidades nem conexao', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: new Set(['wahoo', 'garmin']) });
    for (const id of ['samsung', 'garmin', 'coros', 'wahoo']) {
      const entry = byId(catalog, id);
      expect(entry.availability).toBe('unavailable');
      expect(entry.connection.state).toBe('not_applicable');
      expect(entry.capabilities).toEqual({ receiveActivities: false, sendWorkouts: false });
    }
  });

  it('nao vaza o nome da variavel de ambiente', () => {
    const catalog = buildIntegrationsCatalog({ configuredEnv: ENV_OK, connectedProviderIds: none });
    expect(JSON.stringify(catalog)).not.toContain('CLIENT_ID');
  });
});
