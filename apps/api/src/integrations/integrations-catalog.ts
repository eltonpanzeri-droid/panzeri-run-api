// Catalogo central de "Dispositivos e integracoes" (Etapa 2, 08/10/2026).
// Fonte unica de DISPONIBILIDADE e CAPACIDADES por fabricante. O app apenas exibe; nao decide nada sozinho.
// Tres conceitos separados de proposito:
//  - availability: a integracao existe e esta operacional? (available | preparing | unavailable)
//  - capabilities: o que ela faz quando operacional (receber atividades; enviar treino estruturado)
//  - connection: estado INDIVIDUAL do aluno (so faz sentido se available)
// Adicionar fabricante = uma entrada em INTEGRATION_PROVIDERS (e, se houver conexao, uma leitura em IntegrationsService).
// Somente leitura: nenhum OAuth, tabela de conexao ou sincronizacao e tocado aqui.

export type IntegrationAvailability = 'available' | 'preparing' | 'unavailable';
export type IntegrationPlatform = 'web' | 'android' | 'ios_native';
export type IntegrationConnectionState = 'connected' | 'disconnected' | 'not_applicable';

export interface IntegrationProvider {
  id: string;
  name: string;
  // Texto curto para o aluno (pt-BR); nao promete o que nao existe.
  summary: string;
  availability: IntegrationAvailability;
  // Plataformas onde a integracao pode ser usada pelo aluno.
  platforms: IntegrationPlatform[];
  capabilities: { receiveActivities: boolean; sendWorkouts: boolean };
  // Variavel(is) de ambiente que precisam estar configuradas para a integracao estar available (opcional).
  requiresEnv?: string | string[];
}

const ALL_PLATFORMS: IntegrationPlatform[] = ['web', 'android', 'ios_native'];

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    id: 'polar',
    name: 'Polar',
    summary: 'Importa suas corridas do Polar Flow. A Polar não aceita receber treinos do Panzeri Run.',
    availability: 'available',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: true, sendWorkouts: false },
    requiresEnv: 'POLAR_CLIENT_ID',
  },
  {
    id: 'strava',
    name: 'Strava',
    summary: 'Importa suas atividades do Strava.',
    availability: 'available',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: true, sendWorkouts: false },
    requiresEnv: 'STRAVA_CLIENT_ID',
  },
  {
    id: 'apple_watch',
    name: 'Apple Watch',
    summary: 'Envio de treinos ao Apple Watch em validação. Ainda não está disponível para os alunos.',
    availability: 'preparing',
    platforms: ['ios_native'],
    capabilities: { receiveActivities: false, sendWorkouts: true },
  },
  {
    id: 'samsung',
    name: 'Samsung / Galaxy Watch',
    summary: 'Integração ainda não disponível.',
    availability: 'unavailable',
    platforms: ['android'],
    capabilities: { receiveActivities: false, sendWorkouts: false },
  },
  {
    id: 'garmin',
    name: 'Garmin',
    summary: 'Integração ainda não disponível.',
    availability: 'unavailable',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: false, sendWorkouts: false },
  },
  {
    id: 'coros',
    name: 'COROS',
    summary: 'Integração ainda não disponível.',
    availability: 'unavailable',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: false, sendWorkouts: false },
  },
  {
    id: 'wahoo',
    name: 'Wahoo',
    // Etapa 3: so' a conexao da conta. Sem treino enviado nem atividade recebida (Etapas 4 e 5).
    summary: 'Conecte sua conta Wahoo. O envio de treinos ainda não está ativo.',
    availability: 'available',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: false, sendWorkouts: false },
    requiresEnv: ['WAHOO_CLIENT_ID', 'WAHOO_CLIENT_SECRET', 'WAHOO_REDIRECT_URI', 'WAHOO_TOKEN_ENCRYPTION_KEY'],
  },
];

export interface IntegrationCatalogEntry extends Omit<IntegrationProvider, 'requiresEnv'> {
  connection: { state: IntegrationConnectionState };
}

export interface CatalogInputs {
  // Variaveis de ambiente configuradas (apenas presenca; o valor nunca sai do servidor).
  configuredEnv: ReadonlySet<string>;
  // Provedores em que ESTE aluno esta conectado agora.
  connectedProviderIds: ReadonlySet<string>;
}

export function buildIntegrationsCatalog(inputs: CatalogInputs): IntegrationCatalogEntry[] {
  return INTEGRATION_PROVIDERS.map((provider) => {
    const { requiresEnv, ...rest } = provider;
    // Disponibilidade real: se exige configuracao no servidor e ela esta ausente, nao e oferecida.
    const required = requiresEnv === undefined ? [] : Array.isArray(requiresEnv) ? requiresEnv : [requiresEnv];
    const operational = provider.availability === 'available' && required.every((name) => inputs.configuredEnv.has(name));
    const availability: IntegrationAvailability = operational
      ? 'available'
      : provider.availability === 'available' ? 'unavailable' : provider.availability;
    const capabilities = availability === 'available' ? provider.capabilities : { receiveActivities: false, sendWorkouts: false };
    const summary = availability === 'unavailable' && provider.availability === 'available'
      ? 'Integração indisponível no momento.'
      : provider.summary;
    const state: IntegrationConnectionState = availability !== 'available'
      ? 'not_applicable'
      : inputs.connectedProviderIds.has(provider.id) ? 'connected' : 'disconnected';
    return { ...rest, summary, availability, capabilities, connection: { state } };
  });
}
