// Selecao da OBSERVACAO CANONICA de um evento fisico — funcao PURA (Apple Etapa 3A, revisada em 06/10/2026: regra v2).
// Responde "qual observacao real representa este evento?" e nada alem disso: nao funde metricas (a canonica continua sendo um ActivityLog
// real e o que faltar nela NAO e' preenchido com dado de outro provider), nao reconcilia com TrainingSession, nao classifica execucao.
//
// PRINCIPIO: a escolha e' automatica e POR EVENTO, pelo PAPEL de cada observacao naquele evento — nunca por marca, por preferencia do
// atleta ou por configuracao. O aluno so' conecta o que usa; o Panzeri Run decide.
//  - native_recorder: ha evidencia de que ESTA observacao foi gravada pelo proprio dispositivo/app/ecossistema que a entregou;
//  - relay: ha evidencia SUFICIENTE de que e' uma copia de uma gravacao nativa presente no MESMO evento;
//  - unknown: a proveniencia disponivel nao permite afirmar nenhum dos dois (nao se inventa origem; os dados ficam preservados).
// Regra v2: native_recorder vence; sem nativa, a melhor observacao disponivel (nao e' erro); relay/unknown nunca sao promovidos sem evidencia.
// Independe da ordem de chegada: depende so' do CONJUNTO de observacoes do evento.

export type ProvenanceRole = 'native_recorder' | 'relay' | 'unknown';
export type CanonicalRule = 'sole_observation' | 'native_recorder' | 'best_available';
export type CanonicalTieBreak = 'completeness' | 'explicit_override' | 'id' | null;

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

export interface ProvenanceProfile {
  role: ProvenanceRole;
  // Ecossistema da ORIGEM informada (quando da' para afirmar), nunca inventado.
  ecosystem: string | null;
  // Por que o papel foi atribuido (auditoria).
  basis: string;
}

export interface CanonicalReason {
  version: 2;
  rule: CanonicalRule;
  nativeObservationPresent: boolean;
  tieBreak: CanonicalTieBreak;
  // Override excepcional (AthletePrimarySource explicito) usado SO' para desempatar entre gravadores nativos; null no fluxo normal.
  overrideEcosystem: string | null;
  // Outras gravacoes nativas do mesmo evento (ex.: dois relogios) — preservadas, so' nao escolhidas.
  nativeAlternatives: string[];
  candidates: Array<{ activityLogId: string; provider: string; ecosystem: string | null; role: ProvenanceRole; roleBasis: string; valid: boolean; completeness: number }>;
}

export interface CanonicalSelection {
  canonicalId: string;
  reason: CanonicalReason;
}

// Providers diretos que NAO sao gravadores por si so' (agregadores: recebem de varios dispositivos). Hoje o Strava nao e' provider de
// ActivityLog (isolamento), mas a regra fica pronta para quando/se houver observacao direta.
const AGGREGATOR_PROVIDERS = new Set(['strava']);

// Ecossistema da origem de uma observacao HealthKit, pelo bundle id (so' o que a provenance permite afirmar).
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

function deviceOf(providerMetrics: unknown): { name?: unknown; manufacturer?: unknown } | null {
  const device = (providerMetrics as { device?: unknown } | null)?.device;
  return device && typeof device === 'object' ? (device as { name?: unknown; manufacturer?: unknown }) : null;
}

// Hardware da Apple como gravador: fabricante Apple ou nome de Apple Watch/iPhone no device informado pelo HealthKit.
function isAppleRecordingDevice(providerMetrics: unknown): boolean {
  const device = deviceOf(providerMetrics);
  if (!device) return false;
  const manufacturer = typeof device.manufacturer === 'string' ? device.manufacturer.toLowerCase() : '';
  const name = typeof device.name === 'string' ? device.name.toLowerCase() : '';
  return manufacturer.startsWith('apple') || /apple watch|iphone/.test(name);
}

// Perfil de proveniencia de UMA observacao, so' com o que ela mesma informa (1a passada). A promocao a 'relay' depende do evento (ver
// provenanceProfiles).
export function baseProvenanceProfile(provider: string, providerMetrics: unknown): ProvenanceProfile {
  if (provider !== 'apple_health') {
    if (AGGREGATOR_PROVIDERS.has(provider)) return { role: 'unknown', ecosystem: provider, basis: 'aggregator_cannot_tell_recorder' };
    return { role: 'native_recorder', ecosystem: provider, basis: 'direct_provider_integration' };
  }
  const ecosystem = ecosystemKeyOf(provider, providerMetrics);
  if (ecosystem === 'apple_health') {
    return isAppleRecordingDevice(providerMetrics)
      ? { role: 'native_recorder', ecosystem, basis: 'apple_device_recorded' }
      : { role: 'unknown', ecosystem, basis: 'apple_source_without_recording_device' };
  }
  // App de terceiro escrevendo no HealthKit (Strava, Polar Flow, Garmin Connect...): pode ter gravado ou so' copiado — indeterminado.
  return { role: 'unknown', ecosystem, basis: 'third_party_app_source' };
}

// Perfis de todas as observacoes do evento. 2a passada: uma observacao HealthKit de app de terceiros so' vira 'relay' quando ha, NO MESMO
// evento, uma gravacao nativa direta do mesmo ecossistema (ex.: Polar Flow no HealthKit + Polar direto) — evidencia suficiente de copia.
// Origem Strava nunca e' promovida (agregador: nao prova de quem veio).
export function provenanceProfiles(members: CanonicalCandidateInput[]): Map<string, ProvenanceProfile> {
  const profiles = new Map(members.map((m) => [m.id, baseProvenanceProfile(m.provider, m.providerMetrics)]));
  const nativeDirectEcosystems = new Set(
    members.filter((m) => m.provider !== 'apple_health' && profiles.get(m.id)!.role === 'native_recorder').map((m) => profiles.get(m.id)!.ecosystem),
  );
  for (const m of members) {
    const profile = profiles.get(m.id)!;
    if (m.provider === 'apple_health' && profile.basis === 'third_party_app_source' && profile.ecosystem && profile.ecosystem !== 'strava' && nativeDirectEcosystems.has(profile.ecosystem)) {
      profiles.set(m.id, { role: 'relay', ecosystem: profile.ecosystem, basis: 'copy_of_native_in_same_event' });
    }
  }
  return profiles;
}

function completenessOf(c: CanonicalCandidateInput): number {
  return [c.durationSec, c.distanceMeters, c.caloriesKcal, c.avgHeartRateBpm, c.maxHeartRateBpm, c.cadenceAvg, c.powerAvgWatts, c.elevationGainMeters, c.hasRoute]
    .filter((value) => value !== null && value !== undefined).length;
}

// Observacao valida = tem ao menos duracao ou distancia (senao nao representa uma execucao mensuravel).
function isValid(c: CanonicalCandidateInput): boolean {
  return c.durationSec !== null || c.distanceMeters !== null;
}

const ROLE_RANK: Record<ProvenanceRole, number> = { native_recorder: 2, unknown: 1, relay: 0 };

export function selectCanonicalObservation(members: CanonicalCandidateInput[], options: { overrideEcosystem?: string | null } = {}): CanonicalSelection | null {
  if (members.length === 0) return null;
  const profiles = provenanceProfiles(members);
  const candidates = members
    .map((m) => ({ m, profile: profiles.get(m.id)!, valid: isValid(m), completeness: completenessOf(m) }))
    .sort((a, b) => (a.m.id < b.m.id ? -1 : 1));
  const overrideEcosystem = options.overrideEcosystem ?? null;
  const summary = candidates.map((c) => ({
    activityLogId: c.m.id, provider: c.m.provider, ecosystem: c.profile.ecosystem, role: c.profile.role, roleBasis: c.profile.basis, valid: c.valid, completeness: c.completeness,
  }));
  const nativeValid = candidates.filter((c) => c.profile.role === 'native_recorder' && c.valid);
  const nativePresent = candidates.some((c) => c.profile.role === 'native_recorder');
  const done = (id: string, rule: CanonicalRule, tieBreak: CanonicalTieBreak, alternatives: string[]): CanonicalSelection => ({
    canonicalId: id,
    reason: { version: 2, rule, nativeObservationPresent: nativePresent, tieBreak, overrideEcosystem: tieBreak === 'explicit_override' ? overrideEcosystem : null, nativeAlternatives: alternatives, candidates: summary },
  });

  if (candidates.length === 1) return done(candidates[0].m.id, 'sole_observation', null, []);

  // 1) gravador nativo vence. Entre varios nativos (ex.: dois relogios): o override excepcional (se houver), depois o registro mais completo, depois id.
  if (nativeValid.length > 0) {
    const others = (winnerId: string) => nativeValid.filter((c) => c.m.id !== winnerId).map((c) => c.m.id);
    if (nativeValid.length === 1) return done(nativeValid[0].m.id, 'native_recorder', null, []);
    const overridden = overrideEcosystem ? nativeValid.filter((c) => c.profile.ecosystem === overrideEcosystem) : [];
    if (overridden.length > 0 && overridden.length < nativeValid.length) {
      const winner = [...overridden].sort((a, b) => b.completeness - a.completeness || (a.m.id < b.m.id ? -1 : 1))[0];
      return done(winner.m.id, 'native_recorder', 'explicit_override', others(winner.m.id));
    }
    const sorted = [...nativeValid].sort((a, b) => b.completeness - a.completeness || (a.m.id < b.m.id ? -1 : 1));
    const tie = sorted[0].completeness === sorted[1].completeness ? 'id' : 'completeness';
    return done(sorted[0].m.id, 'native_recorder', tie, others(sorted[0].m.id));
  }

  // 2) sem gravador nativo valido: melhor observacao disponivel (NAO e' erro). 'unknown' antes de 'relay'; depois completude; depois id.
  const pool = candidates.some((c) => c.valid) ? candidates.filter((c) => c.valid) : candidates;
  const sorted = [...pool].sort((a, b) => ROLE_RANK[b.profile.role] - ROLE_RANK[a.profile.role] || b.completeness - a.completeness || (a.m.id < b.m.id ? -1 : 1));
  const tie: CanonicalTieBreak = sorted.length === 1 ? null : sorted[0].profile.role === sorted[1].profile.role && sorted[0].completeness === sorted[1].completeness ? 'id' : 'completeness';
  return done(sorted[0].m.id, 'best_available', tie, []);
}
