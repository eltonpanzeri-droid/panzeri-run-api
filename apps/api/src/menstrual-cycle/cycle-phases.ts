// Fases do ciclo por aluna (19/11/2026, decisao de Elton). Funcoes PURAS: so' separam os dias em fases a partir do que a aluna registrou; nao decidem treino.
// Regra (aprovada por Elton): menstrual = dias de sangramento; ovulatoria = 3 dias ao redor de (duracao do ciclo - 14); folicular = o que fica entre os dois; lutea = do fim da ovulatoria ate o proximo ciclo.
// Duracao do ciclo: a REAL (ciclo ja fechado) > a mediana dos ciclos fechados > a declarada no perfil > 28 dias como padrao, sempre com a limitacao registrada e dita a aluna. Anticoncepcional hormonal: fases sao
// estimativa e o aviso acompanha. Dia 0 = primeiro dia do sangramento.
export const PHASE_IDS = ['menstruacao', 'folicular', 'ovulatoria', 'lutea'] as const;
export type PhaseId = (typeof PHASE_IDS)[number];
export const PHASE_LABEL: Record<PhaseId, string> = { menstruacao: 'Fase menstrual', folicular: 'Fase folicular', ovulatoria: 'Fase ovulatória', lutea: 'Fase lútea' };

export const DEFAULT_CYCLE_LENGTH_DAYS = 28;
export const DEFAULT_PERIOD_LENGTH_DAYS = 5;
export const LUTEAL_LENGTH_DAYS = 14; // referencia usada para localizar a ovulacao: duracao do ciclo - 14

export type LengthSource = 'observed' | 'median' | 'declared' | 'default28';

export interface CycleLogLite { start: Date; end: Date | null }
export interface ProfileLite { cycleLengthDays?: number | null; periodLengthDays?: number | null; usesHormonalContraceptive?: boolean | null }

export interface PhasedCycle {
  index: number;
  start: Date;
  lengthDays: number;
  lengthSource: LengthSource;
  periodDays: number;
  open: boolean; // ciclo em curso (ainda sem proxima menstruacao)
}

const DAY = 86_400_000;
const dayStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
export const daysBetweenDates = (from: Date, to: Date) => Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function buildPhasedCycles(logs: CycleLogLite[], profile: ProfileLite | null | undefined): PhasedCycle[] {
  const sorted = [...logs].sort((a, b) => a.start.getTime() - b.start.getTime());
  const closedLengths = sorted.slice(0, -1).map((log, i) => daysBetweenDates(log.start, sorted[i + 1].start)).filter((length) => length >= 15 && length <= 60);
  const medianLength = median(closedLengths);
  const closedPeriods = sorted.filter((log) => log.end).map((log) => daysBetweenDates(log.start, log.end as Date) + 1).filter((days) => days >= 1 && days <= 14);
  const medianPeriod = median(closedPeriods);
  return sorted.map((log, index) => {
    const next = sorted[index + 1];
    const observed = next ? daysBetweenDates(log.start, next.start) : null;
    let lengthDays: number;
    let lengthSource: LengthSource;
    if (observed != null && observed >= 15 && observed <= 60) { lengthDays = observed; lengthSource = 'observed'; }
    else if (medianLength != null) { lengthDays = medianLength; lengthSource = 'median'; }
    else if (profile?.cycleLengthDays && profile.cycleLengthDays >= 15) { lengthDays = profile.cycleLengthDays; lengthSource = 'declared'; }
    else { lengthDays = DEFAULT_CYCLE_LENGTH_DAYS; lengthSource = 'default28'; }
    const ownPeriod = log.end ? daysBetweenDates(log.start, log.end) + 1 : null;
    const periodDays = Math.min(Math.max(ownPeriod ?? medianPeriod ?? profile?.periodLengthDays ?? DEFAULT_PERIOD_LENGTH_DAYS, 1), Math.max(lengthDays - 8, 1));
    return { index, start: dayStart(log.start), lengthDays, lengthSource, periodDays, open: !next };
  });
}

// Fase do dia de numero `day` (0 = primeiro dia) dentro de um ciclo.
export function phaseOfDay(day: number, cycle: Pick<PhasedCycle, 'lengthDays' | 'periodDays'>): PhaseId {
  if (day < cycle.periodDays) return 'menstruacao';
  const ovulation = cycle.lengthDays - LUTEAL_LENGTH_DAYS; // dia (0-based) da ovulacao estimada
  const ovulatoryStart = Math.max(ovulation - 1, cycle.periodDays);
  if (day < ovulatoryStart) return 'folicular';
  if (day <= ovulation + 1) return 'ovulatoria';
  return 'lutea';
}

export interface PhasedDate { phase: PhaseId; cycleIndex: number; dayOfCycle: number; lengthSource: LengthSource }

// Fase de uma data. null = a data nao pertence a nenhum ciclo registrado (antes do primeiro ou depois do fim esperado do ultimo, com folga de 7 dias).
export function phaseOfDate(date: Date, cycles: PhasedCycle[]): PhasedDate | null {
  let found: PhasedCycle | null = null;
  for (const cycle of cycles) { if (cycle.start.getTime() <= dayStart(date).getTime()) found = cycle; else break; }
  if (!found) return null;
  const day = daysBetweenDates(found.start, date);
  if (found.open && day > found.lengthDays + 7) return null;
  if (!found.open && day >= found.lengthDays) return null;
  return { phase: phaseOfDay(day, found), cycleIndex: found.index, dayOfCycle: day, lengthSource: found.lengthSource };
}

// Limitacoes que o relatorio e a tela precisam dizer a aluna (texto claro, sem alarme).
export function cycleLimitations(cycles: PhasedCycle[], profile: ProfileLite | null | undefined): string[] {
  const notes: string[] = [];
  if (cycles.length === 0) notes.push('Ainda não há ciclos registrados, então não é possível separar as fases.');
  if (cycles.some((cycle) => cycle.lengthSource === 'default28')) notes.push('Em parte do histórico a duração do seu ciclo é desconhecida e foi usado o padrão de 28 dias. As fases desses períodos são uma estimativa.');
  else if (cycles.some((cycle) => cycle.lengthSource === 'declared')) notes.push('Em parte do histórico foi usada a duração de ciclo que você informou, porque ainda não há ciclos completos registrados.');
  else if (cycles.some((cycle) => cycle.lengthSource === 'median')) notes.push('No ciclo em curso a duração foi estimada pela mediana dos seus ciclos anteriores.');
  if (profile?.usesHormonalContraceptive) notes.push('Você usa anticoncepcional hormonal: as fases são uma estimativa e podem não refletir o seu ciclo natural.');
  notes.push('A ovulação é estimada (cerca de 14 dias antes da próxima menstruação); não é um exame.');
  return notes;
}
