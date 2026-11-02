// SIMULACAO (so' leitura) de registros do MESMO app de origem que sao o mesmo treino regravado (02/11/2026). Usa EXATAMENTE o comparador da identidade fisica
// (compareObservations): o que esta funcao aponta e' o que a avaliacao de identidade passaria a agrupar. Nao grava nada, nao decide nada.
// Tambem lista, SEM agrupar, os pares do mesmo app com inicio parecido mas nao identico (ate' 90 s) para o treinador enxergar se sobra duplicata.
import { canonicalModality } from './canonical-modality';
import { compareObservations, observerKeyOf, ObservedActivity } from './physical-activity-identity';
import { CanonicalCandidateInput, selectCanonicalObservation } from './physical-canonical';

export interface DuplicateScanRow extends CanonicalCandidateInput {
  userId: string;
  sport: string | null;
  startedAt: Date;
  physicalIdentityStatus: string | null;
}

export interface DuplicateGroup {
  observerKey: string;
  sport: string | null;
  startedAt: string;
  durationSec: number | null;
  members: Array<{ activityLogId: string; distanceMeters: number | null; avgHeartRateBpm: number | null; physicalIdentityStatus: string | null }>;
  canonicalActivityLogId: string;
  // Distancia que hoje conta a mais (copias que deixariam de contar); so' corrida/esteira somam km.
  inflatedKm: number | null;
}

export interface NearMiss {
  observerKey: string;
  sport: string | null;
  activityLogIds: [string, string];
  startDiffSec: number;
  durationSec: [number | null, number | null];
}

export interface DuplicateScan {
  groups: DuplicateGroup[];
  nearMisses: NearMiss[];
}

const NEAR_MISS_WINDOW_SEC = 90;
const RUN_FAMILY = new Set(['corrida', 'esteira']);

export function findSameObserverDuplicates(rows: DuplicateScanRow[]): DuplicateScan {
  const observed = new Map<string, ObservedActivity>(rows.map((r) => [r.id, {
    id: r.id, userId: r.userId, provider: r.provider, sport: r.sport, startedAt: r.startedAt, durationSec: r.durationSec, distanceMeters: r.distanceMeters,
    endedAt: null, observerKey: observerKeyOf(r.provider, r.providerMetrics),
  }]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sorted = [...observed.values()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : 1));

  const parent = new Map(sorted.map((o) => [o.id, o.id]));
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; return root; };
  const nearMisses: NearMiss[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const diffSec = (b.startedAt.getTime() - a.startedAt.getTime()) / 1000;
      if (diffSec > NEAR_MISS_WINDOW_SEC) break; // ordenado por inicio: os seguintes so' ficam mais longe
      if (a.userId !== b.userId || a.observerKey !== b.observerKey) continue;
      const verdict = compareObservations(a, b);
      if (verdict.verdict === 'same') {
        const ra = find(a.id);
        const rb = find(b.id);
        if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
      } else if (canonicalModality(a.sport) && canonicalModality(a.sport) === canonicalModality(b.sport) && canonicalModality(a.sport) !== 'outra') {
        nearMisses.push({ observerKey: a.observerKey, sport: a.sport, activityLogIds: [a.id, b.id], startDiffSec: Math.round(diffSec), durationSec: [a.durationSec, b.durationSec] });
      }
    }
  }

  const components = new Map<string, string[]>();
  for (const o of sorted) components.set(find(o.id), [...(components.get(find(o.id)) ?? []), o.id]);
  const groups: DuplicateGroup[] = [];
  for (const ids of components.values()) {
    if (ids.length < 2) continue;
    const members = ids.map((id) => byId.get(id)!);
    const canonicalId = selectCanonicalObservation(members)!.canonicalId;
    const first = observed.get(ids[0])!;
    const inflated = members.filter((m) => m.id !== canonicalId && RUN_FAMILY.has(canonicalModality(m.sport) ?? '')).map((m) => m.distanceMeters).filter((d): d is number => d != null);
    groups.push({
      observerKey: first.observerKey, sport: first.sport, startedAt: first.startedAt.toISOString(), durationSec: first.durationSec,
      members: members.map((m) => ({ activityLogId: m.id, distanceMeters: m.distanceMeters, avgHeartRateBpm: m.avgHeartRateBpm, physicalIdentityStatus: m.physicalIdentityStatus })),
      canonicalActivityLogId: canonicalId,
      inflatedKm: inflated.length > 0 ? Math.round((inflated.reduce((a, b) => a + b, 0) / 1000) * 100) / 100 : null,
    });
  }
  groups.sort((x, y) => (x.startedAt < y.startedAt ? -1 : 1));
  return { groups, nearMisses };
}
