import { createHash } from 'node:crypto';

// Autorizacao por categoria para SAUDE E RECUPERACAO da Polar (23/10/2026). A conexao Polar existente (OAuth, so' exercicios) NAO muda e NAO exige nova autenticacao: a aluna ja' conectada decide
// aqui, no app, quais grupos de dados de saude quer compartilhar. O registro mora em ProviderConnection com provider 'polar_health' (linha PROPRIA, separada da decisao sobre o Atlas, que usa
// provider 'polar'): assim uma decisao nunca apaga nem confunde a outra. SEM registro = nada de saude e' importado (fail-closed; a regra de nao-perda vale so' para as atividades).
// 01/11/2026 (ordem de Elton): a saude da Polar PASSA a poder alimentar a IA — mas so' quando a aluna autorizou o ATLAS para a Polar (a mesma decisao que cobre os treinos, em
// legacy-consent.ts) E marcou o grupo aqui. Os dois pedidos aparecem no MESMO cartao do app (uma tela, um "Salvar"); nenhum dos dois texto contradiz o outro. A regra do servidor esta em AiDataEligibility.
export const POLAR_HEALTH_PROVIDER_ID = 'polar_health';
export const POLAR_WEARABLE_PROVIDER = 'polar'; // valor gravado em Wearable*.provider (a fonte dos dados)

// PERCURSO GPS (19/11/2026, ordem de Elton): grupo opcional 'activity_route'. ESCONDIDO ate POLAR_ROUTE_ENABLED=true (lido ao iniciar o servidor): desligado, o texto e' o 1.2 de antes (ninguem reconfirma) e o percurso
// continua descartado (polar-location-filter.ts). Ligado, vale o texto 1.3 e quem ja' autorizou outros grupos reconfirma uma vez. A licenca da Polar exige autorizacao explicita, aviso claro e credito "Polar".
export const POLAR_ROUTE_ON = process.env.POLAR_ROUTE_ENABLED?.trim().toLowerCase() === 'true';
export type PolarHealthCategory = 'sleep' | 'hrv' | 'daily_activity' | 'heart_rate' | 'activity_route';
export const POLAR_HEALTH_CATEGORIES: readonly PolarHealthCategory[] = POLAR_ROUTE_ON ? ['sleep', 'hrv', 'daily_activity', 'heart_rate', 'activity_route'] : ['sleep', 'hrv', 'daily_activity', 'heart_rate'];
export const isPolarHealthCategory = (value: unknown): value is PolarHealthCategory => typeof value === 'string' && (POLAR_HEALTH_CATEGORIES as readonly string[]).includes(value);

export const POLAR_HEALTH_PURPOSES = ['history', 'tracking', 'indicators', 'coach_view'] as const;

export interface PolarHealthGroup { id: PolarHealthCategory; label: string; description: string }

export const POLAR_HEALTH_CONSENT = {
  version: POLAR_ROUTE_ON ? '1.3' : '1.2',
  dateLabel: POLAR_ROUTE_ON ? '19/11/2026' : '10/11/2026',
  title: 'Saúde e recuperação da sua Polar',
  paragraphs: [
    'Você já conectou a Polar ao Panzeri Run para importar seus treinos, e isso continua valendo. Agora você pode escolher, à parte, compartilhar também dados de saúde e recuperação medidos pelo seu relógio Polar.',
    'Com sua autorização, o Panzeri Run poderá receber da Polar o seu sono (duração e etapas e, no SleepWise, o estado de alerta e o horário ideal para dormir), a sua recuperação noturna (Nightly Recharge, incluindo a variabilidade da frequência cardíaca, o HRV, da noite), a sua atividade diária (passos, distância e calorias e a carga de treino, o Cardio Load) e a sua frequência cardíaca ao longo do dia. Nem todos os dados existem em todos os relógios.',
    'Esses dados serão usados para acompanhar sua recuperação e sua evolução, e seu treinador os verá no painel dele para acompanhar seu treino. Se você também autorizar o Atlas (nossa inteligência artificial) nesta mesma página, ele poderá usar os grupos que você marcar aqui para personalizar seus treinos; sem essa autorização, eles ficam só para você e para o seu treinador. Eles não substituem avaliação médica.',
    'Ao autorizar, importamos o que a Polar disponibilizar, normalmente os últimos 28 dias, e passamos a importar os dados novos. A origem de cada dado (Polar) é sempre preservada.',
    ...(POLAR_ROUTE_ON ? [
      'Percurso GPS (opcional): se você marcar esse grupo, o Panzeri Run guarda o trajeto (latitude, longitude e altitude) dos seus treinos que a Polar disponibilizar, para mostrar o percurso e entender onde você treina. O trajeto é um dado sensível, vem da Polar e é identificado como tal. Sem marcar, nenhum trajeto é guardado.',
    ] : []),
    'Você escolhe cada grupo. Ao retirar um grupo, a importação dele para e os dados já importados desse grupo são apagados do Panzeri Run. Desconectar a Polar também interrompe a importação. Os detalhes estão na Política de Privacidade.',
  ],
  groups: [
    { id: 'sleep', label: 'Sono', description: 'Duração e etapas do sono de cada noite e, quando existir, o SleepWise (estado de alerta e horário ideal para dormir).' },
    { id: 'hrv', label: 'Recuperação noturna (Nightly Recharge e HRV)', description: 'HRV médio da noite e indicadores de recuperação noturna.' },
    { id: 'daily_activity', label: 'Atividade diária', description: 'Passos, distância e calorias do dia e a carga de treino (Cardio Load).' },
    { id: 'heart_rate', label: 'Frequência cardíaca ao longo do dia', description: 'Frequência cardíaca medida pelo relógio ao longo do dia (mínima, média e máxima de cada dia).' },
    ...(POLAR_ROUTE_ON ? [{ id: 'activity_route' as const, label: 'Percurso GPS dos treinos', description: 'Trajeto (latitude, longitude e altitude) dos treinos que a Polar disponibilizar. Dado sensível. Origem: Polar.' }] : []),
  ] as PolarHealthGroup[],
  checkboxText: 'Autorizo o Panzeri Run a importar da Polar os grupos de dados que marquei, para acompanhamento da minha recuperação e do meu treino, inclusive pelo meu treinador.',
  buttonLabel: 'Salvar minha escolha',
} as const;

// Hash do texto EXATO apresentado (versao, textos, grupos, aceite). Muda se qualquer palavra mudar: a autorizacao so' vale sobre o texto vigente.
export function polarHealthTextHash(): string {
  return createHash('sha256').update(JSON.stringify(POLAR_HEALTH_CONSENT)).digest('hex');
}

export interface PolarHealthRow {
  disconnectedAt: Date | null;
  grantedCategories: unknown;
  consentVersion: string | null;
  consentTextHash: string | null;
}

export function isPolarHealthConsentCurrent(row: Pick<PolarHealthRow, 'consentVersion' | 'consentTextHash'>): boolean {
  return row.consentVersion === POLAR_HEALTH_CONSENT.version && row.consentTextHash === polarHealthTextHash();
}

/** Categorias de saude hoje autorizadas: linha ativa, texto vigente e categoria concedida. Qualquer outra situacao = nenhuma (fail-closed). */
export function grantedPolarHealthCategories(row: PolarHealthRow | null | undefined): PolarHealthCategory[] {
  if (!row || row.disconnectedAt || !isPolarHealthConsentCurrent(row)) return [];
  const granted = Array.isArray(row.grantedCategories) ? (row.grantedCategories as unknown[]) : [];
  return POLAR_HEALTH_CATEGORIES.filter((category) => granted.includes(category));
}

/** Tabela de dados importados (Wearable*) por categoria — usada para apagar quando a aluna retira o grupo. null = a categoria so' tem registros de metrica (ver POLAR_HEALTH_METRIC_KINDS). */
export const POLAR_HEALTH_TABLE: Record<PolarHealthCategory, 'wearableSleepSummary' | 'wearableHrvSummary' | 'wearableDailySummary' | null> = {
  sleep: 'wearableSleepSummary',
  hrv: 'wearableHrvSummary',
  daily_activity: 'wearableDailySummary',
  heart_rate: null,
  activity_route: null, // o percurso mora na serie temporal da atividade (apagado em eraseCategory)
};

/** Tipos de registro (WearableMetricRecord) de cada categoria: tambem saem quando a aluna retira o grupo ou exclui os dados da Polar. */
export const POLAR_HEALTH_METRIC_KINDS: Record<PolarHealthCategory, readonly string[]> = {
  sleep: ['sleepwise_alertness', 'sleepwise_circadian'],
  hrv: ['recovery_nightly'],
  daily_activity: ['cardio_load'],
  heart_rate: ['heart_rate_continuous'],
  activity_route: [],
};
