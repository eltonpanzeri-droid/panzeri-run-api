// Selecao da OBSERVACAO CANONICA de um evento fisico (Apple Etapa 3A, 06/10/2026) — funcao PURA.
// Responde "qual observacao real representa este evento?" e nada alem disso: nao funde metricas (a canonica continua sendo um ActivityLog
// real e o que faltar nela NAO e' preenchido com dado de outro provider), nao reconcilia com TrainingSession, nao classifica execucao.
//
// Regra (independente da ordem de chegada — depende so' do CONJUNTO de observacoes e do ecossistema primario vigente na data do evento):
//  1. se o atleta tem ecossistema primario e ha observacao VALIDA dele -> escolhe entre as do primario;
//  2. senao, fallback deterministico entre as observacoes validas (ou todas, se nenhuma for valida);
//  3. sempre registra regra, primario usado, motivo do fallback e a lista de candidatas.
// Nao existe hierarquia universal de provider: a prioridade vem do atleta. Os desempates sao neutros e documentados.

export type CanonicalRule = 'primary_ecosystem' | 'fallback_deterministic' | 'sole_observation';
export type FallbackReason = 'no_primary_defined' | 'primary_absent' | 'primary_has_no_valid_observation';
export type PrimaryOrigin = 'explicit' | 'delivery_history';

export interface CanonicalCandidateInput {
  id: string;
  provider: string;
  providerMetrics: unknown;
  durationSec: number | null;
  distanceMeters: number | null;
  // Demais metricas objetivas do ActivityLog, so' para medir completude do registro (nunca para compor valores).
  caloriesKcal: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  cadenceAvg: number | null;
  powerAvgWatts: number | null;
  elevationGainMeters: number | null;
  hasRoute: boolean | null;
}

export interface CanonicalReason {
  version: 1;
  rule: CanonicalRule;
  primarySource: string | null;
  primarySourceOrigin: PrimaryOrigin | null;
  fallbackReason: FallbackReason | null;
  candidates: Array<{ activityLogId: string; provider: string; ecosystem: string | null; channel: 'direct' | 'relay'; valid: boolean; completeness: number }>;
}

export interface CanonicalSelection {
  canonicalId: string;
  reason: CanonicalReason;
}

// Ecossistema de execucao a que a observacao pertence — SO' o que a provenance permite afirmar. Provider direto = ele mesmo. Para
// HealthKit, so' quando o bundle identifier da ORIGEM informada pertence a um ecossistema conhecido (Polar Flow, Garmin Connect,
// Strava, apps da Apple); qualquer outro fica null (nao elegivel como primario — nunca se inventa o dispositivo original).
export function ecosystemKeyOf(provider: string, providerMetrics: unknown): string | null {
  if (provider !== 'apple_health') return provider;
  const bundle = (providerMetrics as { source?: { bundleId?: unknown } } | null)?.source?.bundleId;
  if (typeof bundle !== 'string') return null;
  const id = bundle.toLowerCase();
  if (id.startsWith('com.apple.')) return 'apple_health';
  if (id.startsWith('com.polar.')) return 'polar';
  if (id.startsWith('com.garmin.')) return 'garmin';
  if (id.startsWith('com.strava.')) return 'strava';
  return null;
}

function completenessOf(c: CanonicalCandidateInput): number {
  return [c.durationSec, c.distanceMeters, c.caloriesKcal, c.avgHeartRateBpm, c.maxHeartRateBpm, c.cadenceAvg, c.powerAvgWatts, c.elevationGainMeters, c.hasRoute]
    .filter((value) => value !== null && value !== undefined).length;
}

// Observacao valida = tem ao menos duracao ou distancia (senao nao representa uma execucao mensuravel).
function isValid(c: CanonicalCandidateInput): boolean {
  return c.durationSec !== null || c.distanceMeters !== null;
}

export function selectCanonicalObservation(
  members: CanonicalCandidateInput[],
  primary: { key: string; origin: PrimaryOrigin } | null,
): CanonicalSelection | null {
  if (members.length === 0) return null;
  const candidates = members
    .map((m) => ({
      m,
      ecosystem: ecosystemKeyOf(m.provider, m.providerMetrics),
      channel: (m.provider === 'apple_health' ? 'relay' : 'direct') as 'direct' | 'relay',
      valid: isValid(m),
      completeness: completenessOf(m),
    }))
    .sort((a, b) => (a.m.id < b.m.id ? -1 : 1));

  const summary = candidates.map((c) => ({ activityLogId: c.m.id, provider: c.m.provider, ecosystem: c.ecosystem, channel: c.channel, valid: c.valid, completeness: c.completeness }));
  const done = (id: string, rule: CanonicalRule, fallbackReason: FallbackReason | null): CanonicalSelection => ({
    canonicalId: id,
    reason: { version: 1, rule, primarySource: primary?.key ?? null, primarySourceOrigin: primary?.origin ?? null, fallbackReason, candidates: summary },
  });

  if (candidates.length === 1) return done(candidates[0].m.id, 'sole_observation', null);

  // 1) ecossistema primario do atleta, se houver observacao valida dele. Dentro do mesmo ecossistema: canal direto antes de relay
  //    (mais perto da fonte), depois registro mais completo, depois id (so' para desempate estavel).
  let fallbackReason: FallbackReason;
  if (primary) {
    const ofPrimary = candidates.filter((c) => c.ecosystem === primary.key);
    const validOfPrimary = ofPrimary.filter((c) => c.valid);
    if (validOfPrimary.length > 0) {
      const sorted = [...validOfPrimary].sort((a, b) => (a.channel === b.channel ? 0 : a.channel === 'direct' ? -1 : 1) || b.completeness - a.completeness || (a.m.id < b.m.id ? -1 : 1));
      return done(sorted[0].m.id, 'primary_ecosystem', null);
    }
    fallbackReason = ofPrimary.length > 0 ? 'primary_has_no_valid_observation' : 'primary_absent';
  } else {
    fallbackReason = 'no_primary_defined';
  }

  // 2) fallback deterministico, sem hierarquia de provider: registro valido mais completo, depois canal direto, depois id.
  const pool = candidates.some((c) => c.valid) ? candidates.filter((c) => c.valid) : candidates;
  const sorted = [...pool].sort((a, b) => b.completeness - a.completeness || (a.channel === b.channel ? 0 : a.channel === 'direct' ? -1 : 1) || (a.m.id < b.m.id ? -1 : 1));
  return done(sorted[0].m.id, 'fallback_deterministic', fallbackReason);
}
