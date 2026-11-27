import { PHASE_IDS, PHASE_LABEL, phaseOfDate, type PhaseId } from '../menstrual-cycle/cycle-phases';
import {
  DISTANCE_BANDS, addDays, classify, pooledPaceOf, protect, reportMetrics, painLevelMetrics, type PainLevelMetrics, type ReportMetrics,
} from './observatory-core';
import type { ObsFacts, ObsFilters, ObsParticipant, ObsRow, ObsTraining, TrainingGroup } from './observatory.types';

// Observatorio Panzeri Run — ANALISE AMPLIADA (26/11/2026, ordem de Elton). Funcoes puras sobre os fatos ja' deduplicados; so' agregados protegidos, nunca nome, e-mail ou id.
//   1) dor por treino em TODAS as modalidades (corrida, forca, outras): por 100 treinos, por nivel (leve/moderado/forte) e, para corrida, por 1.000 km;
//   2) corridas por faixa de distancia (ate' 5 km, 5 a 10 km...) com pace e dor;
//   3) "Relatar dor" ANALISADO A PARTE (nunca colado a treino): nota 1-10, regiao e taxa geral por 1.000 km;
//   4) fases do ciclo: treinos, dor do feedback, pace da corrida e relatos de dor por fase, separando quem usa anticoncepcional hormonal (fase so' estimada).
// Estatistica DESCRITIVA: associacao nao e' causa; fase do ciclo e' estimativa a partir do que a aluna registrou.

type PaceLite = { label: string; secondsPerKm: number; runs: number } | null;
export interface DistanceRow { runs: number; km: number; participants: number; pace: PaceLite; participantsWithPace: number | null; pain: PainLevelMetrics }
export interface RegionRow { reports: number; meanIntensity: number | null }
export interface CycleRow {
  participants: number; participantDays: number; trainings: number; pain: PainLevelMetrics; runPace: PaceLite; participantsWithPace: number | null;
  reports: number; meanReportIntensity: number | null; reportsPer100ParticipantDays: number | null;
}

export interface Insights {
  scopeNote: string;
  byModality: { rows: Array<ObsRow<PainLevelMetrics>>; total: PainLevelMetrics | null };
  runsByDistance: { rows: Array<ObsRow<DistanceRow>>; runsWithoutDistance: number };
  standaloneReports: {
    note: string;
    overall: ReportMetrics | null;
    runKm: number;
    reportsPer1000RunKm: number | null; // taxa GERAL: relatos do "Relatar dor" / km corridos do mesmo grupo (nao e' "dor da corrida")
    regions: Array<ObsRow<RegionRow>>;
  };
  cycle: {
    notes: string[];
    participantsWithCycle: number;
    participantsWithEstimatedPhases: number; // ao menos um ciclo com duracao declarada/padrao/mediana: fase estimada
    trainingsOutsideCycle: number;
    natural: Array<{ phase: PhaseId; label: string; row: ObsRow<CycleRow> }>;
    hormonal: Array<{ phase: PhaseId; label: string; row: ObsRow<CycleRow> }>;
  };
}

const GROUP_LABEL: Record<TrainingGroup, string> = { corrida: 'Corrida (inclui esteira)', forca: 'Força e fortalecimento', outras: 'Outras modalidades' };
const paceOf = (items: Array<{ km: number | null; seconds: number | null; participant: string }>, min: number): { pace: PaceLite; participantsWithPace: number | null } => {
  const byP = new Map<string, Array<{ km: number | null; seconds: number | null }>>();
  for (const i of items) byP.set(i.participant, [...(byP.get(i.participant) ?? []), i]);
  const withPace = [...byP.values()].filter((list) => pooledPaceOf(list) != null).length;
  if (withPace < min) return { pace: null, participantsWithPace: withPace > 0 ? null : 0 }; // pace de menos de `min` pessoas nao e' divulgado
  const pooled = pooledPaceOf(items);
  return { pace: pooled ? { label: pooled.label, secondsPerKm: pooled.secondsPerKm, runs: pooled.events } : null, participantsWithPace: withPace };
};
const people = (items: Array<{ participant: string }>) => new Set(items.map((i) => i.participant)).size;

export function computeInsights(input: { facts: ObsFacts; scope: Set<string>; runKeys: Set<string>; runKm: number; filters: ObsFilters; participants: Map<string, ObsParticipant> }): Insights {
  const { facts, scope, runKeys, filters: f, participants } = input;
  const min = f.minParticipants;
  const inPeriod = (day: string) => day >= f.from && day <= f.to;
  // Corrida: exatamente os treinos das semanas incluidas (mesma base do restante da tela). Demais modalidades: participantes do escopo, dentro do periodo.
  const trainings: ObsTraining[] = (facts.trainings ?? []).filter((t) => (t.group === 'corrida' ? runKeys.has(t.eventKey) : scope.has(t.participant) && inPeriod(t.day)));
  const reports = (facts.painReports ?? []).filter((r) => scope.has(r.participant) && inPeriod(r.day));

  // 1) dor por treino, por modalidade
  const modalityRows = protect(
    (['corrida', 'forca', 'outras'] as TrainingGroup[]).map((group) => { const items = trainings.filter((t) => t.group === group); return { key: group, label: GROUP_LABEL[group], participants: people(items), data: painLevelMetrics(items) }; }),
    min,
  );

  // 2) corridas por faixa de distancia
  const runs = trainings.filter((t) => t.group === 'corrida');
  const withKm = runs.filter((t) => t.km != null && t.km > 0);
  const distanceRows = protect(
    DISTANCE_BANDS.map((band) => {
      const items = withKm.filter((t) => classify(t.km, [band]) !== null);
      const { pace, participantsWithPace } = paceOf(items, min);
      return { key: band.id, label: band.label, participants: people(items), data: { runs: items.length, km: Math.round(items.reduce((s, t) => s + (t.km ?? 0), 0) * 100) / 100, participants: people(items), pace, participantsWithPace, pain: painLevelMetrics(items) } };
    }),
    min,
  );

  // 3) "Relatar dor", a parte
  const regionMap = new Map<string, Array<{ participant: string; intensity: number }>>();
  for (const r of reports) for (const region of r.regions.length > 0 ? r.regions : ['sem_regiao']) regionMap.set(region, [...(regionMap.get(region) ?? []), { participant: r.participant, intensity: r.intensity }]);
  const regionRows = protect(
    [...regionMap.entries()].sort((a, b) => b[1].length - a[1].length).map(([region, list]) => ({ key: region, label: region, participants: people(list), data: { reports: list.length, meanIntensity: reportMetrics(list).meanIntensity } })),
    min,
  );
  const overallReports = people(reports) >= min || reports.length === 0 ? reportMetrics(reports) : null;
  const runKm = Math.round(input.runKm * 100) / 100;

  // 4) fases do ciclo
  const days: string[] = [];
  for (let d = f.from; d <= f.to && d <= f.today; d = addDays(d, 1)) days.push(d);
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  const phaseOf = (participant: string, day: string): PhaseId | null => {
    const cycle = participants.get(participant)?.cycle;
    return cycle ? phaseOfDate(at(day), cycle.cycles)?.phase ?? null : null;
  };
  const withCycle = [...scope].filter((p) => participants.get(p)?.cycle);
  const estimated = withCycle.filter((p) => participants.get(p)!.cycle!.cycles.some((c) => c.lengthSource !== 'observed')).length;
  let outside = 0;
  const phased = trainings.map((t) => ({ t, phase: participants.get(t.participant)?.cycle ? phaseOf(t.participant, t.day) : null, has: Boolean(participants.get(t.participant)?.cycle) }));
  for (const x of phased) if (x.has && x.phase == null) outside += 1;
  const phasedReports = reports.map((r) => ({ r, phase: participants.get(r.participant)?.cycle ? phaseOf(r.participant, r.day) : null }));
  // Dias-pessoa por fase (exposicao): so' dias que caem num ciclo registrado.
  const exposure = new Map<string, number>(); // `${participant}|${phase}` -> dias
  for (const p of withCycle) for (const day of days) { const ph = phaseOf(p, day); if (ph) exposure.set(`${p}|${ph}`, (exposure.get(`${p}|${ph}`) ?? 0) + 1); }

  const build = (hormonalGroup: boolean) => {
    const members = withCycle.filter((p) => (participants.get(p)!.cycle!.hormonal === true) === hormonalGroup);
    const memberSet = new Set(members);
    const rows = PHASE_IDS.map((phase) => {
      const inPhase = members.filter((p) => (exposure.get(`${p}|${phase}`) ?? 0) > 0);
      const ts = phased.filter((x) => x.phase === phase && memberSet.has(x.t.participant)).map((x) => x.t);
      const rs = phasedReports.filter((x) => x.phase === phase && memberSet.has(x.r.participant)).map((x) => x.r);
      const participantDays = inPhase.reduce((s, p) => s + (exposure.get(`${p}|${phase}`) ?? 0), 0);
      const { pace, participantsWithPace } = paceOf(ts.filter((t) => t.group === 'corrida' && t.km != null && t.km > 0), min);
      const data: CycleRow = {
        participants: inPhase.length, participantDays, trainings: ts.length, pain: painLevelMetrics(ts), runPace: pace, participantsWithPace,
        reports: rs.length, meanReportIntensity: reportMetrics(rs).meanIntensity,
        reportsPer100ParticipantDays: participantDays > 0 ? Math.round((rs.length / participantDays) * 10000) / 100 : null,
      };
      return { key: phase, label: PHASE_LABEL[phase], participants: inPhase.length, data };
    });
    const protectedRows = protect(rows, min).rows;
    return PHASE_IDS.map((phase, i) => ({ phase, label: PHASE_LABEL[phase], row: protectedRows[i] }));
  };

  return {
    scopeNote: 'Participantes com corrida nas semanas incluídas pelos filtros; força e outras modalidades dentro do período. A dor por treino vem só do feedback do treino (sem dor, leve, moderada ou forte). Treino registrado sem relato vale zero; a cobertura do feedback aparece à parte.',
    byModality: { rows: modalityRows.rows, total: modalityRows.totalAllowed ? painLevelMetrics(trainings) : null },
    runsByDistance: { rows: distanceRows.rows, runsWithoutDistance: runs.length - withKm.length },
    standaloneReports: {
      note: 'O “Relatar dor” (nota de 1 a 10 e região) é analisado à parte: não é ligado a nenhum treino. A taxa por 1.000 km é geral (relatos ÷ km corridos pelo mesmo grupo) e não significa dor causada pela corrida.',
      overall: overallReports,
      runKm,
      reportsPer1000RunKm: overallReports && runKm > 0 ? Math.round((reports.length / runKm) * 100000) / 100 : null,
      regions: regionRows.rows,
    },
    cycle: {
      notes: [
        'Só entram alunas que registraram o ciclo. A fase de cada dia é uma ESTIMATIVA feita a partir do que a aluna registrou (ovulação ≈ 14 dias antes da próxima menstruação); não é exame.',
        'Quem usa anticoncepcional hormonal fica em grupo separado: as fases dela não refletem o ciclo natural.',
        'Descritivo: diferença entre fases não prova causa. Fases com poucos dias ou poucas alunas têm números pouco firmes.',
      ],
      participantsWithCycle: withCycle.length,
      participantsWithEstimatedPhases: estimated,
      trainingsOutsideCycle: outside,
      natural: build(false),
      hormonal: build(true),
    },
  };
}
