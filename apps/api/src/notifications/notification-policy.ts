// Politica de avisos proativos (19/11/2026, ordem de Elton). Funcoes PURAS: decidem se um aviso pode sair AGORA para esta aluna, pelas preferencias dela. Nao escolhem o que dizer nem quando disparar (isso e' de
// cada regra); so' impedem excesso. Ideia central: o limite diario e' um TETO (padrao 36 = 6 temas x 6), nunca uma meta; a aluna gerencia categorias, quantidade por dia e horario.
export const NOTIFICATION_CATEGORIES = [
  { id: 'novidades', label: 'Novidades do Panzeri Run' },
  { id: 'instrucoes', label: 'Instruções de uso do Panzeri Run' },
  { id: 'relatorios', label: 'Relatórios' },
  { id: 'saude', label: 'Dicas de saúde' },
  { id: 'educacao_treino', label: 'Educação para o treino' },
  { id: 'mundo_corrida', label: 'Dicas gerais sobre o mundo das corridas e treinos' },
] as const;
export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORIES)[number]['id'];

// Faixas por dia, por categoria. O valor e' o MAXIMO da faixa (a faixa "1 a 2" permite ate 2 no dia).
export const NOTIFICATION_BANDS = [
  { id: '1-2', label: '1 a 2 por dia', maxPerDay: 2 },
  { id: '3-4', label: '3 a 4 por dia', maxPerDay: 4 },
  { id: '5-6', label: '5 a 6 por dia', maxPerDay: 6 },
] as const;
export type NotificationBandId = (typeof NOTIFICATION_BANDS)[number]['id'];

export const DEFAULT_DAILY_CAP = 36; // 6 temas x 6 por dia: a aluna que libera o maximo em todos os temas pode receber ate 36 (ordem de Elton, 19/11/2026)
export const MAX_DAILY_CAP = 36;
export const DEFAULT_WINDOW_START_HOUR = 6;
export const DEFAULT_WINDOW_END_HOUR = 20;
export const DEFAULT_BAND: NotificationBandId = '5-6'; // padrao: maximo em cada tema; a aluna reduz em Preferencias de notificacoes
// Fuso padrao (Sao Paulo, sem horario de verao). Mesma regra de dia local usada no resto do Panzeri Run.
export const DEFAULT_TZ_OFFSET_MINUTES = -180;

export interface CategoryPreference { enabled: boolean; band: NotificationBandId }
export interface NotificationPreferences {
  dailyCap: number;
  windowStartHour: number;
  windowEndHour: number;
  categories: Record<NotificationCategoryId, CategoryPreference>;
}

const categoryIds = NOTIFICATION_CATEGORIES.map((item) => item.id) as readonly string[];
const bandIds = NOTIFICATION_BANDS.map((item) => item.id) as readonly string[];
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

export function defaultPreferences(): NotificationPreferences {
  return {
    dailyCap: DEFAULT_DAILY_CAP,
    windowStartHour: DEFAULT_WINDOW_START_HOUR,
    windowEndHour: DEFAULT_WINDOW_END_HOUR,
    categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map((item) => [item.id, { enabled: true, band: DEFAULT_BAND }])) as Record<NotificationCategoryId, CategoryPreference>,
  };
}

// Aceita o que vier do banco ou do app e devolve SEMPRE uma preferencia valida (valor invalido cai no padrao; nunca lanca). Teto diario entre 0 e 20; horas 0 a 23 com inicio antes do fim.
export function normalizePreferences(raw: unknown): NotificationPreferences {
  const base = defaultPreferences();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as { dailyCap?: unknown; windowStartHour?: unknown; windowEndHour?: unknown; categories?: unknown };
  const dailyCap = isInt(input.dailyCap) ? Math.min(Math.max(input.dailyCap, 0), MAX_DAILY_CAP) : base.dailyCap;
  let start = isInt(input.windowStartHour) && input.windowStartHour >= 0 && input.windowStartHour <= 23 ? input.windowStartHour : base.windowStartHour;
  let end = isInt(input.windowEndHour) && input.windowEndHour >= 1 && input.windowEndHour <= 24 ? input.windowEndHour : base.windowEndHour;
  if (start >= end) { start = base.windowStartHour; end = base.windowEndHour; }
  const categories = { ...base.categories };
  if (input.categories && typeof input.categories === 'object') {
    for (const [key, value] of Object.entries(input.categories as Record<string, unknown>)) {
      if (!categoryIds.includes(key) || !value || typeof value !== 'object') continue;
      const item = value as { enabled?: unknown; band?: unknown };
      categories[key as NotificationCategoryId] = {
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        band: typeof item.band === 'string' && bandIds.includes(item.band) ? (item.band as NotificationBandId) : DEFAULT_BAND,
      };
    }
  }
  return { dailyCap, windowStartHour: start, windowEndHour: end, categories };
}

export const bandMaxPerDay = (band: NotificationBandId): number => NOTIFICATION_BANDS.find((item) => item.id === band)?.maxPerDay ?? 2;

export type BlockReason = 'unknown_category' | 'category_off' | 'outside_window' | 'daily_cap' | 'category_cap';

export interface PolicyInput {
  prefs: NotificationPreferences;
  category: string;
  now: Date;
  sentTodayTotal: number;
  sentTodayInCategory: number;
  tzOffsetMinutes?: number;
}

// Hora local (0 a 23) no fuso informado.
export function localHour(now: Date, tzOffsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES): number {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).getUTCHours();
}

// Inicio do dia local (em UTC) que contem `now`: a base para contar quantos avisos ja saíram HOJE.
export function localDayStartUtc(now: Date, tzOffsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES): Date {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tzOffsetMinutes * 60_000);
}

export function decideNotification(input: PolicyInput): { allow: true } | { allow: false; reason: BlockReason } {
  if (!categoryIds.includes(input.category)) return { allow: false, reason: 'unknown_category' };
  const category = input.prefs.categories[input.category as NotificationCategoryId];
  if (!category.enabled) return { allow: false, reason: 'category_off' };
  const hour = localHour(input.now, input.tzOffsetMinutes);
  if (hour < input.prefs.windowStartHour || hour >= input.prefs.windowEndHour) return { allow: false, reason: 'outside_window' };
  if (input.sentTodayTotal >= input.prefs.dailyCap) return { allow: false, reason: 'daily_cap' };
  if (input.sentTodayInCategory >= bandMaxPerDay(category.band)) return { allow: false, reason: 'category_cap' };
  return { allow: true };
}
