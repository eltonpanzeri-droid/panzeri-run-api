// Fontes de dados de saude medidos por aparelho (22/10/2026). Modulo PURO: nao conhece banco nem prescricao.
//
// Por que existe: sono, HRV e indicadores diarios podem chegar por mais de uma fonte (Zepp direto, Health Connect — que por sua vez recebe de varios apps, Samsung Health etc.).
// Metodos de medicao diferentes NAO sao comparaveis; por isso a matematica (media, linha de base, tendencia, faixa habitual, excursoes) e' calculada SEPARADAMENTE por fonte
// (ver TrainingIntelligenceQueryService). Nenhum registro original e' alterado ou descartado: aqui so' se NOMEIA a fonte e se escolhe qual delas e' a serie PRINCIPAL mostrada
// ao Atlas. As demais fontes continuam disponiveis, com a sua propria estatistica.
//
// Nao importa nada de activity-execution/ai-governance de proposito: o incidente de 22/10/2026 (dependencia circular na subida da API) veio de importacoes cruzadas.

export const WEARABLE_SOURCE_SEGMENTATION_ENV = 'WEARABLE_SOURCE_SEGMENTATION_ENABLED';

/** Ligado por padrao. Desliga a separacao por fonte (volta ao comportamento anterior) com WEARABLE_SOURCE_SEGMENTATION_ENABLED=false (ou 0/off/no). */
export function isSourceSegmentationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env[WEARABLE_SOURCE_SEGMENTATION_ENV] ?? '').trim().toLowerCase();
  return !(value === 'false' || value === '0' || value === 'off' || value === 'no');
}

// Valores iniciais, a calibrar com dados reais:
//  - ATIVA: a fonte enviou ao menos um valor nos ultimos 7 dias. Fonte com dado mais antigo NAO prevalece sobre outra que esta sincronizando.
//  - COBERTURA: dias distintos com valor nos ultimos 60 dias (desempate entre fontes ativas).
export const SOURCE_ACTIVE_WINDOW_DAYS = 7;
export const SOURCE_COVERAGE_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export const UNKNOWN_SOURCE = 'origem_desconhecida';

/** Health Connect recebe de varios apps: o app de origem (dataOrigin) faz parte da fonte. providerSummaryId do Health Connect = "<appOrigem>|<identidade>". */
export function sourceKeyOf(provider: string, providerSummaryId: string | null | undefined): string {
  if (provider !== 'health_connect') return provider;
  const origin = (providerSummaryId ?? '').split('|')[0].trim();
  return `health_connect:${origin || UNKNOWN_SOURCE}`;
}

export function providerOfSourceKey(sourceKey: string): string {
  return sourceKey.split(':')[0];
}

// Ecossistema da fonte, para casar com AthletePrimarySource (mesmo vocabulario de physical-canonical.ts / ecosystemKeyOf; o teste de equivalencia garante que nao divergem).
export function ecosystemOfSourceKey(sourceKey: string): string {
  const provider = providerOfSourceKey(sourceKey);
  if (provider !== 'health_connect') return provider;
  const origin = sourceKey.slice('health_connect:'.length).toLowerCase();
  if (origin === 'com.sec.android.app.shealth') return 'samsung';
  if (origin.startsWith('fi.polar.') || origin.startsWith('com.polar.')) return 'polar';
  if (origin.startsWith('com.garmin.')) return 'garmin';
  if (origin === 'com.strava' || origin.startsWith('com.strava.')) return 'strava';
  return 'health_connect';
}

export interface SourceActivity {
  key: string;
  timestamps: Date[];
}

const matchesPreference = (key: string, preferred: string) => preferred === key || preferred === providerOfSourceKey(key) || preferred === ecosystemOfSourceKey(key);

/**
 * Escolhe a fonte PRINCIPAL (a serie que o Atlas ve como a da aluna). Deterministico e independente da ordem das fontes:
 *  1. Fonte ATIVA = enviou valor nos ultimos 7 dias. Se existir alguma ativa, so' as ativas concorrem (dado antigo nunca prevalece sobre quem sincroniza).
 *     Se nenhuma estiver ativa, concorrem todas e vence a de dado MAIS RECENTE.
 *  2. Preferencia explicita da aluna (AthletePrimarySource) desempata a favor da fonte correspondente — mas so' se ela concorre (ativa e com dado nesta variavel).
 *  3. Mais dias com valor nos ultimos 60 dias; depois dado mais recente; depois ordem alfabetica da chave.
 */
export function rankSources(sources: SourceActivity[], preferred: string | null, now: Date): string[] {
  const nowMs = now.getTime();
  const stats = sources
    .filter((source) => source.timestamps.length > 0)
    .map((source) => {
      // Relogio com data no FUTURO nao pode ganhar por "mais recente": toda data e' limitada ao agora (e fica fora da cobertura).
      const times = source.timestamps.map((t) => Math.min(t.getTime(), nowMs));
      const lastMs = times.reduce((max, t) => (t > max ? t : max), -Infinity);
      const coverage = new Set(
        source.timestamps.filter((t) => t.getTime() <= nowMs && nowMs - t.getTime() <= SOURCE_COVERAGE_WINDOW_DAYS * DAY_MS).map((t) => t.toISOString().slice(0, 10)),
      ).size;
      return { key: source.key, lastMs, coverage, active: nowMs - lastMs <= SOURCE_ACTIVE_WINDOW_DAYS * DAY_MS };
    });
  if (stats.length === 0) return [];
  const anyActive = stats.some((s) => s.active);
  const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  // Ativas primeiro; dentro de cada grupo: (preferencia explicita, so' entre ATIVAS) > cobertura > mais recente > chave. Sem ativa nenhuma: mais recente primeiro.
  const rank = (s: (typeof stats)[number]) => (s.active ? 0 : 1);
  const preferredFirst = (s: (typeof stats)[number]) => (anyActive && s.active && preferred && matchesPreference(s.key, preferred) ? 0 : 1);
  return [...stats]
    .sort((a, b) =>
      anyActive
        ? rank(a) - rank(b) || preferredFirst(a) - preferredFirst(b) || b.coverage - a.coverage || b.lastMs - a.lastMs || byKey(a, b)
        : b.lastMs - a.lastMs || b.coverage - a.coverage || byKey(a, b),
    )
    .map((s) => s.key);
}

export function chooseMainSource(sources: SourceActivity[], preferred: string | null, now: Date): string | null {
  return rankSources(sources, preferred, now)[0] ?? null;
}

/** Teto de fontes SECUNDARIAS detalhadas no contexto (alem da principal). As demais ficam so' contadas. */
export const MAX_SECONDARY_SOURCES = 3;

export type SleepSessionRole = 'principal' | 'additional';

export interface SleepSessionInput {
  id: string;
  sourceKey: string;
  calendarDate: string;
  durationSec: number | null;
  startTimeSec: number;
}

/**
 * Papel de cada sessao de sono DENTRO da mesma fonte e do mesmo dia. NENHUMA sessao e' descartada nem fundida.
 * LIMITACAO EXPLICITA (decisao de Elton, 22/10/2026): 'principal' = a MAIOR sessao da fonte naquele dia — NAO e' a duracao total da noite. Sono dividido entre sessoes
 * so' sera interpretado depois que houver dado real do Health Connect. Sessoes de fontes diferentes nunca se comparam aqui.
 */
export function sleepSessionRoles(rows: SleepSessionInput[]): Map<string, SleepSessionRole> {
  const groups = new Map<string, SleepSessionInput[]>();
  for (const row of rows) {
    const groupKey = `${row.sourceKey}|${row.calendarDate}`;
    const list = groups.get(groupKey);
    if (list) list.push(row);
    else groups.set(groupKey, [row]);
  }
  const roles = new Map<string, SleepSessionRole>();
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => (b.durationSec ?? -1) - (a.durationSec ?? -1) || a.startTimeSec - b.startTimeSec || (a.id < b.id ? -1 : 1));
    ordered.forEach((row, index) => roles.set(row.id, index === 0 ? 'principal' : 'additional'));
  }
  return roles;
}
