import { addDays, weekStartOf } from './observatory-core';
import type { ObsFacts, ObsParticipant, ObsRunEvent, ObsStrengthEvent, PainOrigin } from './observatory.types';

// Observatorio Panzeri Run (24/10/2026) — DADOS SINTETICOS deterministicos. Servem para testar a estrutura, a interface e os calculos SEM tocar em dados reais. Os padroes embutidos
// (ex.: dor um pouco maior com mais volume, menos com forca) sao inventados so' para os graficos terem o que mostrar; nao representam a comunidade.

export function buildSyntheticFacts(today: string, options: { participants?: number; weeks?: number; seed?: number } = {}): ObsFacts {
  let seed = options.seed ?? 20261024;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = <T,>(list: Array<[T, number]>): T => { let x = rnd() * list.reduce((s, [, w]) => s + w, 0); for (const [v, w] of list) { x -= w; if (x <= 0) return v; } return list[0][0]; };
  const n = options.participants ?? 140;
  const weeks = options.weeks ?? 40;
  const lastWeek = addDays(weekStartOf(today), -7); // ultima semana inteira encerrada
  const participants: ObsParticipant[] = [];
  const runEvents: ObsRunEvent[] = [];
  const strengthEvents: ObsStrengthEvent[] = [];
  let eventSeq = 0;

  for (let i = 0; i < n; i += 1) {
    const key = `synthetic-${i}`;
    const age = 22 + Math.floor(rnd() * 48);
    participants.push({ key, birthDate: `${new Date(today).getUTCFullYear() - age}-06-15`, sex: pick<string | null>([['F', 5], ['M', 5], [null, 0.4]]) });
    const target = pick<number>([[12, 35], [30, 30], [50, 18], [75, 10], [105, 4], [140, 2], [180, 0.7], [220, 0.3]]);
    const startWeek = Math.floor(rnd() * 6);
    const basePace = 330 + rnd() * 120 - target * 0.25; // mais volume tende a pace menor (so' no sintetico)
    const trend = -(0.05 + rnd() * 0.15); // melhora lenta por semana
    const strengthRate = rnd() < 0.55 ? 1.6 : 0.4;
    for (let w = startWeek; w < weeks; w += 1) {
      const weekStart = addDays(lastWeek, -7 * (weeks - 1 - w));
      if (rnd() < 0.06) continue; // semana sem registro
      const km = Math.max(3, target * (0.75 + rnd() * 0.5));
      const sessions = Math.max(1, Math.min(7, Math.round(km / (8 + rnd() * 6))));
      let remaining = km;
      for (let s = 0; s < sessions; s += 1) {
        const part = s === sessions - 1 ? remaining : Math.max(2, (remaining / (sessions - s)) * (0.7 + rnd() * 0.6));
        remaining = Math.max(0, remaining - part);
        const dist = Math.round(part * 10) / 10;
        const pace = basePace + trend * (w - startWeek) + (rnd() - 0.5) * 20;
        const hasTime = rnd() > 0.08;
        const answered = rnd() < 0.7;
        const riskUp = target * 0.00018 - (strengthRate > 1 ? 0.007 : 0);
        const reported = rnd() < Math.max(0.004, 0.018 + riskUp);
        const hasIntensity = rnd() > 0.07;
        const intensity = Math.min(10, Math.max(1, Math.round(1 + Math.pow(rnd(), 1.6) * 9)));
        const origin: PainOrigin = reported ? 'reported_pain' : answered && rnd() < 0.6 ? 'explicit_no_pain' : 'no_pain_report';
        runEvents.push({
          participant: key, eventKey: `e${eventSeq++}`, day: addDays(weekStart, Math.min(6, Math.floor((s * 7) / sessions))), km: dist > 0 ? dist : null,
          seconds: hasTime && dist > 0 ? Math.round(dist * pace) : null, source: rnd() < 0.1 ? 'manual' : 'activity', isExtra: rnd() < 0.08, feedbackAnswered: answered || reported,
          pain: { origin, intensity: origin === 'reported_pain' ? (hasIntensity ? intensity : null) : 0 },
        });
      }
      const strengthSessions = Math.min(4, Math.round(strengthRate * (0.5 + rnd())));
      for (let s = 0; s < strengthSessions; s += 1) strengthEvents.push({ participant: key, eventKey: `f${eventSeq++}`, day: addDays(weekStart, 1 + s * 2) });
    }
  }
  return {
    dataset: 'synthetic',
    dataAsOf: new Date().toISOString(),
    participants,
    runEvents,
    strengthEvents,
    quality: { stravaExcludedEvents: 37, ambiguousIdentityEvents: 11, unevaluatedIdentityEvents: 0, invalidDistanceEvents: runEvents.filter((e) => e.km == null).length, duplicateManualEvents: 14, painReportsWithoutTraining: 9, painConflicts: 3 },
  };
}
