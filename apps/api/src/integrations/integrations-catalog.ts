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

// Perfil PADRAO de cada integracao (30/10/2026): o app mostra o mesmo roteiro para todas (o que pode ser compartilhado, uso, envio de treinos, quem pede a autorizacao) e so'
// os valores mudam por fabricante. Fonte unica: nada disso e' escrito no app. So' entra aqui o que e' FATO conferido; o que a fabricante nao confirmou fica como 'not_available'
// com a nota dizendo isso, e nunca como promessa.
export type DataGroupId = 'activities' | 'performance' | 'sleep' | 'recovery' | 'daily' | 'route' | 'other_health';
export type WorkoutDeliveryStatus = 'available' | 'preparing' | 'not_available';
export interface IntegrationProfile {
  // grupos de informacao que a integracao pode oferecer (a aluna escolhe quando a integracao permitir essa escolha)
  dataGroups: DataGroupId[];
  workoutDelivery: WorkoutDeliveryStatus;
  // frase curta e verdadeira sobre o envio de treinos ao relogio desta integracao (motivo, estado ou limite)
  workoutDeliveryNote: string;
  // quem pede a autorizacao: o fabricante/sistema (OAuth, permissao do Android/iOS), o Panzeri Run (consentimento proprio) ou os dois
  authorizedBy: 'manufacturer' | 'panzeri' | 'both';
  // uso dos dados dessa integracao pela IA: 'allowed' = indicadores podem entrar nas analises; 'with_consent' = so' com autorizacao propria da aluna; 'not_used' = nunca (ex.: regra do Strava)
  aiUse: 'allowed' | 'with_consent' | 'not_used';
}

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
  // Integracao em validacao: so' aparece como disponivel para quem foi habilitado (ou ja esta conectado, para poder desconectar).
  requiresAllowlist?: boolean;
  profile: IntegrationProfile;
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
    profile: { dataGroups: ['activities', 'performance', 'sleep', 'recovery'], workoutDelivery: 'not_available', workoutDeliveryNote: 'A Polar não aceita receber treinos do Panzeri Run.', authorizedBy: 'both', aiUse: 'allowed' },
  },
  {
    id: 'strava',
    name: 'Strava',
    summary: 'Importa suas atividades do Strava.',
    availability: 'available',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: true, sendWorkouts: false },
    requiresEnv: 'STRAVA_CLIENT_ID',
    profile: { dataGroups: ['activities', 'performance'], workoutDelivery: 'not_available', workoutDeliveryNote: 'O Strava não recebe treinos prescritos.', authorizedBy: 'manufacturer', aiUse: 'not_used' },
  },
  {
    id: 'apple_watch',
    name: 'Apple Watch',
    summary: 'Importa as suas corridas do app Saúde do iPhone, com as medidas e o percurso que você autorizar (no iPhone e no Panzeri Run). O envio de treinos ao Apple Watch segue em validação.',
    availability: 'preparing',
    platforms: ['ios_native'],
    capabilities: { receiveActivities: true, sendWorkouts: true },
    profile: { dataGroups: ['activities', 'performance', 'route', 'sleep', 'recovery', 'daily'], workoutDelivery: 'preparing', workoutDeliveryNote: 'O envio de treinos ao Apple Watch está em validação.', authorizedBy: 'both', aiUse: 'allowed' },
  },
  {
    id: 'health_connect',
    name: 'Health Connect',
    // Canal de entrada de atividades no Android (nao e' fabricante nem dispositivo): importa o que os aplicativos que o aluno ja' usa (Polar Flow, Samsung
    // Health, entre outros) compartilham com o Health Connect, so' com a autorizacao do aluno. Nenhuma marca especifica e' prometida.
    summary: 'Importa suas atividades dos aplicativos que compartilham dados com o Health Connect do Android, só com a sua autorização. A origem de cada atividade é preservada.',
    availability: 'available',
    platforms: ['android'],
    capabilities: { receiveActivities: true, sendWorkouts: false },
    profile: { dataGroups: ['activities', 'performance', 'route', 'sleep', 'recovery', 'daily'], workoutDelivery: 'not_available', workoutDeliveryNote: 'O Health Connect não permite enviar treinos ao relógio.', authorizedBy: 'both', aiUse: 'allowed' },
  },
  {
    id: 'samsung',
    name: 'Samsung / Galaxy Watch',
    // 22/10/2026: os dados do Samsung Health e do Galaxy Watch chegam pelo Health Connect (confirmado pela Samsung). Este cartao leva a aluna para a MESMA tela do Health Connect.
    summary: 'Os dados do seu Galaxy Watch e do Samsung Health chegam ao Panzeri Run pelo Health Connect do Android. Conecte por aqui e, no app Samsung Health, ligue o compartilhamento com o Health Connect.',
    availability: 'available',
    platforms: ['android'],
    capabilities: { receiveActivities: true, sendWorkouts: false },
    // Os dados chegam pelo Health Connect (confirmado pela Samsung em 22/10/2026), entao os grupos sao os mesmos dele. A Samsung respondeu (23/10/2026) que o acesso direto ao Samsung Health
    // exige o programa de parceiros dela e que nem todos os tipos de dado sincronizam com o Health Connect; o envio de treinos ao Galaxy Watch NAO foi confirmado.
    profile: { dataGroups: ['activities', 'performance', 'sleep', 'recovery', 'daily'], workoutDelivery: 'not_available', workoutDeliveryNote: 'O envio de treinos ao Galaxy Watch ainda não está disponível: a Samsung exige um programa de parceria para o acesso direto, que ainda não foi concluído.', authorizedBy: 'both', aiUse: 'allowed' },
  },
  {
    id: 'garmin',
    name: 'Garmin',
    summary: 'Integração ainda não disponível.',
    availability: 'unavailable',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: false, sendWorkouts: false },
    profile: { dataGroups: [], workoutDelivery: 'not_available', workoutDeliveryNote: 'Integração ainda não disponível.', authorizedBy: 'manufacturer', aiUse: 'with_consent' },
  },
  {
    id: 'coros',
    name: 'COROS',
    // 30/10/2026: a COROS liberou o COROS MCP (OAuth 2.0, autoatendimento, sem aprovacao): le atividades (com FIT), sono, saude diaria e condicionamento e ESCREVE treinos e planos
    // (corrida de rua, trilha e ciclismo) no calendario do atleta. Ainda NAO ha conexao no Panzeri Run: nenhum dado e' pedido hoje. Webhook so' pela Partner API (em fila).
    summary: 'Integração em preparação: ainda não é possível conectar o COROS, e nenhum dado seu é solicitado.',
    availability: 'unavailable',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: false, sendWorkouts: false },
    profile: { dataGroups: ['activities', 'performance', 'route', 'sleep', 'recovery', 'daily'], workoutDelivery: 'preparing', workoutDeliveryNote: 'A COROS permite enviar treinos de corrida e ciclismo ao calendário do atleta. O Panzeri Run ainda não usa esse recurso.', authorizedBy: 'manufacturer', aiUse: 'with_consent' },
  },
  {
    id: 'wahoo',
    name: 'Wahoo',
    // Etapa 5: le os treinos gravados por dispositivos/apps da Wahoo. O envio de treinos (Etapa 4) ainda nao existe.
    summary: 'Importa suas atividades gravadas em dispositivos e aplicativos Wahoo. Recurso novo, ainda em validação com atividades reais. O envio de treinos ainda não está disponível.',
    availability: 'available',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: true, sendWorkouts: false },
    profile: { dataGroups: ['activities', 'performance'], workoutDelivery: 'not_available', workoutDeliveryNote: 'O envio de treinos à Wahoo ainda não está disponível.', authorizedBy: 'manufacturer', aiUse: 'allowed' },
    requiresEnv: ['WAHOO_CLIENT_ID', 'WAHOO_CLIENT_SECRET', 'WAHOO_REDIRECT_URI', 'WAHOO_TOKEN_ENCRYPTION_KEY'],
    requiresAllowlist: true,
  },
  {
    id: 'zepp',
    name: 'Zepp / Amazfit',
    // Recebe as atividades do Amazfit (FIT) e, se o aluno autorizar, envia treinos de corrida ao relogio. Em validacao: so' aparece para quem foi habilitado.
    summary: 'Conecte seu Amazfit para acompanhar seus treinos, seu sono e sua recuperação e, se quiser, receber seus treinos de corrida no relógio. Cada autorização é opcional e separada. Recurso em validação.',
    availability: 'available',
    platforms: ALL_PLATFORMS,
    capabilities: { receiveActivities: true, sendWorkouts: true },
    profile: { dataGroups: ['activities', 'performance', 'route', 'sleep', 'recovery', 'daily'], workoutDelivery: 'available', workoutDeliveryNote: 'Treinos de corrida podem ser enviados à sua conta Zepp, com autorização própria.', authorizedBy: 'panzeri', aiUse: 'with_consent' },
    requiresEnv: ['ZEPP_CLIENT_ID', 'ZEPP_CLIENT_SECRET', 'ZEPP_REDIRECT_URI', 'ZEPP_TOKEN_ENCRYPTION_KEY'],
    requiresAllowlist: true,
  },
];

export interface IntegrationCatalogEntry extends Omit<IntegrationProvider, 'requiresEnv' | 'requiresAllowlist'> {
  connection: { state: IntegrationConnectionState };
}

export interface CatalogInputs {
  // Variaveis de ambiente configuradas (apenas presenca; o valor nunca sai do servidor).
  configuredEnv: ReadonlySet<string>;
  // Provedores em que ESTE aluno esta conectado agora.
  connectedProviderIds: ReadonlySet<string>;
  // Provedores em validacao liberados para ESTE aluno (porta de habilitacao do servidor). Ausente = nenhum.
  allowedProviderIds?: ReadonlySet<string>;
}

export function buildIntegrationsCatalog(inputs: CatalogInputs): IntegrationCatalogEntry[] {
  return INTEGRATION_PROVIDERS.map((provider) => {
    const { requiresEnv, requiresAllowlist, ...rest } = provider;
    // Disponibilidade real: se exige configuracao no servidor e ela esta ausente, nao e oferecida.
    const required = requiresEnv === undefined ? [] : Array.isArray(requiresEnv) ? requiresEnv : [requiresEnv];
    const allowed = !requiresAllowlist || (inputs.allowedProviderIds?.has(provider.id) ?? false) || inputs.connectedProviderIds.has(provider.id);
    const operational = provider.availability === 'available' && allowed && required.every((name) => inputs.configuredEnv.has(name));
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
