import { addToBands, emptyBands, formatPace, pooledPace, raceKindOf, round2, type BandCount, type RaceRef } from './equipment-core';
import type { ShoeUsageFact } from './shoe-facts';

// Estatisticas DESCRITIVAS de um conjunto de fatos de uso (um tenis, ou varios para a visao do painel). Funcao pura: calcula so' o que os fatos sustentam; ausencia nao vira zero.

export interface ShoeStats {
  runsCount: number;
  runsWithDistance: number;
  runsWithoutDistance: number;
  totalDistanceKm: number;
  avgPace: { secondsPerKm: number; label: string; runs: number; distanceKm: number; durationSec: number } | null;
  // 'confirmed' = prova cadastrada pela aluna no mesmo dia e distancia compativel; 'candidates' = corridas longas SEM prova cadastrada (nao contam como prova).
  marathons: { confirmed: number; candidates: number };
  halfMarathons: { confirmed: number; candidates: number };
  bands: BandCount[];
  runsOver30Km: number;
  kmByMonth: Array<{ month: string; km: number; runs: number }>;
  firstRunDate: string | null;
  lastRunDate: string | null;
}

export function buildShoeStats(facts: ShoeUsageFact[], races: RaceRef[]): ShoeStats {
  const bands = emptyBands();
  const months = new Map<string, { km: number; runs: number }>();
  const marathons = { confirmed: 0, candidates: 0 };
  const halves = { confirmed: 0, candidates: 0 };
  let total = 0;
  let withDistance = 0;
  for (const fact of facts) {
    if (fact.distanceKm != null) {
      withDistance += 1;
      total += fact.distanceKm;
      addToBands(bands, fact.distanceKm);
      const month = fact.localDate.slice(0, 7);
      const entry = months.get(month) ?? { km: 0, runs: 0 };
      entry.km += fact.distanceKm;
      entry.runs += 1;
      months.set(month, entry);
    }
    const kind = raceKindOf(fact.distanceKm, fact.localDate, races);
    if (kind.confirmed === 'maratona') marathons.confirmed += 1;
    else if (kind.confirmed === 'meia') halves.confirmed += 1;
    else if (kind.candidate === 'maratona') marathons.candidates += 1;
    else if (kind.candidate === 'meia') halves.candidates += 1;
  }
  const pace = pooledPace(facts.map((fact) => ({ distanceKm: fact.distanceKm, durationSec: fact.durationSec })));
  const dates = facts.map((fact) => fact.localDate).sort();
  return {
    runsCount: facts.length,
    runsWithDistance: withDistance,
    runsWithoutDistance: facts.length - withDistance,
    totalDistanceKm: round2(total),
    avgPace: pace ? { ...pace, label: formatPace(pace.secondsPerKm) } : null,
    marathons,
    halfMarathons: halves,
    bands,
    runsOver30Km: bands.filter((band) => band.key === '30_40' || band.key === 'acima_40').reduce((sum, band) => sum + band.count, 0),
    kmByMonth: [...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, value]) => ({ month, km: round2(value.km), runs: value.runs })),
    firstRunDate: dates[0] ?? null,
    lastRunDate: dates[dates.length - 1] ?? null,
  };
}
