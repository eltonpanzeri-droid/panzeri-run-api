import { createHash } from 'node:crypto';

// Autorizacao por categoria para SAUDE E RECUPERACAO da Polar (23/10/2026). A conexao Polar existente (OAuth, so' exercicios) NAO muda e NAO exige nova autenticacao: a aluna ja' conectada decide
// aqui, no app, quais grupos de dados de saude quer compartilhar. O registro mora em ProviderConnection com provider 'polar_health' (linha PROPRIA, separada da decisao sobre o Atlas, que usa
// provider 'polar'): assim uma decisao nunca apaga nem confunde a outra. SEM registro = nada de saude e' importado (fail-closed; a regra de nao-perda vale so' para as atividades).
// Nada daqui vai para a IA: o Atlas continua BLOQUEADO para saude da Polar (ver AiDataEligibility) ate' haver uma autorizacao propria.
export const POLAR_HEALTH_PROVIDER_ID = 'polar_health';
export const POLAR_WEARABLE_PROVIDER = 'polar'; // valor gravado em Wearable*.provider (a fonte dos dados)

export const POLAR_HEALTH_CATEGORIES = ['sleep', 'hrv', 'daily_activity'] as const;
export type PolarHealthCategory = (typeof POLAR_HEALTH_CATEGORIES)[number];
export const isPolarHealthCategory = (value: unknown): value is PolarHealthCategory => typeof value === 'string' && (POLAR_HEALTH_CATEGORIES as readonly string[]).includes(value);

export const POLAR_HEALTH_PURPOSES = ['history', 'tracking', 'indicators', 'coach_view'] as const;

export interface PolarHealthGroup { id: PolarHealthCategory; label: string; description: string }

export const POLAR_HEALTH_CONSENT = {
  version: '1.0',
  dateLabel: '23/10/2026',
  title: 'Saúde e recuperação da sua Polar',
  paragraphs: [
    'Você já conectou a Polar ao Panzeri Run para importar seus treinos, e isso continua valendo. Agora você pode escolher, à parte, compartilhar também dados de saúde e recuperação medidos pelo seu relógio Polar.',
    'Com sua autorização, o Panzeri Run poderá receber da Polar o seu sono (duração e etapas), a sua recuperação noturna (Nightly Recharge, incluindo a variabilidade da frequência cardíaca, o HRV, da noite) e a sua atividade diária (passos, distância e calorias). Nem todos os dados existem em todos os relógios.',
    'Esses dados serão usados para acompanhar sua recuperação e sua evolução, e seu treinador os verá no painel dele para acompanhar seu treino. Esta autorização não inclui o envio desses dados à inteligência artificial (Atlas). Eles não substituem avaliação médica.',
    'Ao autorizar, importamos o que a Polar disponibilizar, normalmente os últimos 28 dias, e passamos a importar os dados novos. A origem de cada dado (Polar) é sempre preservada.',
    'Você escolhe cada grupo. Ao retirar um grupo, a importação dele para e os dados já importados desse grupo são apagados do Panzeri Run. Desconectar a Polar também interrompe a importação. Os detalhes estão na Política de Privacidade.',
  ],
  groups: [
    { id: 'sleep', label: 'Sono', description: 'Duração e etapas do sono de cada noite.' },
    { id: 'hrv', label: 'Recuperação noturna (Nightly Recharge e HRV)', description: 'HRV médio da noite e indicadores de recuperação noturna.' },
    { id: 'daily_activity', label: 'Atividade diária', description: 'Passos, distância e calorias do dia.' },
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

/** Tabela de dados importados (Wearable*) por categoria — usada para apagar quando a aluna retira o grupo. */
export const POLAR_HEALTH_TABLE: Record<PolarHealthCategory, 'wearableSleepSummary' | 'wearableHrvSummary' | 'wearableDailySummary'> = {
  sleep: 'wearableSleepSummary',
  hrv: 'wearableHrvSummary',
  daily_activity: 'wearableDailySummary',
};
