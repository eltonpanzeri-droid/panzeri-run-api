// Identidade FISICA cross-provider (Apple Etapa 2, 06/10/2026) — funcao PURA que compara duas observacoes de atividade e diz
// se representam o MESMO evento fisico. Nao conhece banco, TrainingSession, classificacao de execucao nem prioridade de
// provider. Mantem separados: idempotencia (mesmo registro do mesmo provider), deduplicacao cross-provider (este arquivo),
// reconciliacao (SessionExecutionLink) e classificacao de execucao.
//
// Resultado semantico, nunca um score numerico unico:
//  - 'same'      — evidencia suficientemente forte e sem nenhum criterio contrario;
//  - 'distinct'  — evidencia contraria decisiva (outro atleta, modalidade incompativel, mesmo observador, tempo diferente);
//  - 'ambiguous' — ha proximidade, mas a evidencia nao basta (ou ha divergencia de metrica com o mesmo horario). Nunca forca match.
// Cada criterio devolve matched: true | false | null (null = dado ausente — NUNCA incompatibilidade), no mesmo estilo de
// SessionExecutionLink.evidence. As tolerancias sao graduadas (forte/fraca) e escalam com a duracao; nenhuma e' "verdade universal".

import { canonicalModality } from './canonical-modality';

export type IdentityVerdict = 'same' | 'ambiguous' | 'distinct';
export type EvidenceLevel = 'strong' | 'weak' | 'no';

export interface ObservedActivity {
  id: string;
  userId: string;
  provider: string;
  sport: string | null;
  startedAt: Date;
  durationSec: number | null;
  distanceMeters: number | null;
  // Fim explicito quando o provider informou (HealthKit); senao deriva de start + duracao.
  endedAt?: Date | null;
  // Quem OBSERVOU/produziu o registro (ver observerKeyOf) — dois registros do mesmo observador nunca sao o mesmo evento.
  observerKey: string;
}

export interface IdentityEvidence {
  criterion: string;
  matched: boolean | null;
  level?: EvidenceLevel;
  detail?: Record<string, number | string | null>;
}

export interface IdentityComparison {
  verdict: IdentityVerdict;
  reason: string;
  evidence: IdentityEvidence[];
}

// Observador = canal + origem informada. HealthKit pode relatar varias origens (Apple Watch, Strava...): cada bundle e' um
// observador distinto. Provider direto (polar, garmin...) e' ele mesmo o observador.
export function observerKeyOf(provider: string, providerMetrics: unknown): string {
  if (provider !== 'apple_health') return provider;
  const source = (providerMetrics as { source?: { bundleId?: unknown; name?: unknown } } | null)?.source;
  const bundle = typeof source?.bundleId === 'string' && source.bundleId ? source.bundleId : null;
  const name = typeof source?.name === 'string' && source.name ? source.name : null;
  return `apple_health:${(bundle ?? name ?? 'desconhecido').toLowerCase()}`;
}

const RUNNING_SPORTS = new Set(['corrida', 'esteira']);

type SportCompatibility = 'compatible' | 'incompatible' | 'unknown';

// Compara a modalidade CANONICA (nao o valor bruto do provider): 'corrida' e 'RUNNING' sao o mesmo conceito. O valor original segue em
// ObservedActivity.sport e e' registrado na evidencia.
function sportCompatibility(rawA: string | null, rawB: string | null): SportCompatibility {
  const a = canonicalModality(rawA);
  const b = canonicalModality(rawB);
  if (!a || !b || a === 'outra' || b === 'outra') return 'unknown';
  if (a === b) return 'compatible';
  if (RUNNING_SPORTS.has(a) && RUNNING_SPORTS.has(b)) return 'compatible';
  return 'incompatible';
}

function grade(diff: number, strongTolerance: number, weakTolerance: number): EvidenceLevel {
  if (diff <= strongTolerance) return 'strong';
  if (diff <= weakTolerance) return 'weak';
  return 'no';
}

function endOf(activity: ObservedActivity): Date | null {
  if (activity.endedAt) return activity.endedAt;
  if (activity.durationSec != null) return new Date(activity.startedAt.getTime() + activity.durationSec * 1000);
  return null;
}

export function compareObservations(a: ObservedActivity, b: ObservedActivity): IdentityComparison {
  const evidence: IdentityEvidence[] = [];
  const done = (verdict: IdentityVerdict, reason: string): IdentityComparison => ({ verdict, reason, evidence });

  const sameAthlete = a.userId === b.userId;
  evidence.push({ criterion: 'same_athlete', matched: sameAthlete });
  if (!sameAthlete) return done('distinct', 'different_athlete');

  const sport = sportCompatibility(a.sport, b.sport);
  evidence.push({
    criterion: 'compatible_modality', matched: sport === 'unknown' ? null : sport === 'compatible',
    detail: { a: a.sport, b: b.sport, canonicalA: canonicalModality(a.sport), canonicalB: canonicalModality(b.sport) },
  });
  if (sport === 'incompatible') return done('distinct', 'incompatible_modality');

  const sameObserver = a.observerKey === b.observerKey;
  evidence.push({ criterion: 'different_observer', matched: !sameObserver, detail: { a: a.observerKey, b: b.observerKey } });
  if (sameObserver) return done('distinct', 'same_observer_two_records');

  const referenceDuration = Math.max(a.durationSec ?? 0, b.durationSec ?? 0);

  // Inicio: tolerancia cresce um pouco com a duracao (relogios/pausas/auto-start), com piso absoluto.
  const startDiffSec = Math.abs(a.startedAt.getTime() - b.startedAt.getTime()) / 1000;
  const startLevel = grade(startDiffSec, Math.max(90, referenceDuration * 0.005), Math.max(600, referenceDuration * 0.05));
  evidence.push({ criterion: 'start_proximity', matched: startLevel === 'no' ? false : true, level: startLevel, detail: { diffSec: Math.round(startDiffSec) } });

  // Sobreposicao dos intervalos [inicio, fim] — sinal independente do "inicio isolado".
  const endA = endOf(a);
  const endB = endOf(b);
  let overlapLevel: EvidenceLevel | null = null;
  if (endA && endB) {
    const overlapMs = Math.min(endA.getTime(), endB.getTime()) - Math.max(a.startedAt.getTime(), b.startedAt.getTime());
    const shorterMs = Math.min(endA.getTime() - a.startedAt.getTime(), endB.getTime() - b.startedAt.getTime());
    const ratio = shorterMs > 0 ? Math.max(0, overlapMs) / shorterMs : 0;
    overlapLevel = ratio >= 0.9 ? 'strong' : ratio >= 0.6 ? 'weak' : 'no';
    evidence.push({ criterion: 'time_overlap', matched: overlapLevel !== 'no', level: overlapLevel, detail: { ratio: Number(ratio.toFixed(3)) } });
  } else {
    evidence.push({ criterion: 'time_overlap', matched: null });
  }

  let durationLevel: EvidenceLevel | null = null;
  if (a.durationSec != null && b.durationSec != null) {
    const diff = Math.abs(a.durationSec - b.durationSec);
    const largest = Math.max(a.durationSec, b.durationSec);
    durationLevel = grade(diff, Math.max(60, largest * 0.01), Math.max(300, largest * 0.05));
    evidence.push({ criterion: 'duration_compatible', matched: durationLevel !== 'no', level: durationLevel, detail: { diffSec: Math.round(diff) } });
  } else {
    evidence.push({ criterion: 'duration_compatible', matched: null });
  }

  let distanceLevel: EvidenceLevel | null = null;
  if (a.distanceMeters != null && b.distanceMeters != null) {
    const diff = Math.abs(a.distanceMeters - b.distanceMeters);
    const largest = Math.max(a.distanceMeters, b.distanceMeters);
    distanceLevel = grade(diff, Math.max(50, largest * 0.01), Math.max(200, largest * 0.03));
    evidence.push({ criterion: 'distance_compatible', matched: distanceLevel !== 'no', level: distanceLevel, detail: { diffMeters: Math.round(diff) } });
  } else {
    evidence.push({ criterion: 'distance_compatible', matched: null });
  }

  // Tempo diferente e' decisivo: mesma distancia em outro horario NAO e' o mesmo evento.
  if (startLevel === 'no') return done('distinct', 'different_time');
  if (overlapLevel === 'no') return done('distinct', 'no_time_overlap');

  // Divergencia de metrica com o MESMO horario (ex.: esteira x GPS) nao e' prova de eventos distintos nem de igualdade.
  if (durationLevel === 'no' || distanceLevel === 'no') return done('ambiguous', 'metric_divergence_at_same_time');

  const levels = [startLevel, overlapLevel, durationLevel, distanceLevel];
  const strong = levels.filter((level) => level === 'strong').length;
  if (sport === 'compatible' && strong >= 3) return done('same', 'strong_multi_evidence');
  return done('ambiguous', sport === 'unknown' ? 'modality_unknown' : 'insufficient_evidence');
}
