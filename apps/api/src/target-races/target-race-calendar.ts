// Prova alvo no calendario de treinos (29/10/2026). A prova cadastrada pela aluna entra SOZINHA no programa da semana em que cai, em qualquer dia (inclusive fora da rotina), e tem prioridade sobre
// a rotina:
//   - dia com corrida prescrita: a prova SUBSTITUI a corrida (so' ela);
//   - dia com outra modalidade: a prova e' adicionada e a outra modalidade permanece;
//   - dia sem treino: a prova aparece normalmente.
// Funcoes PURAS (sem banco) para decidir o que criar/atualizar/remover; a aplicacao no banco fica em TargetRaceCalendarService. A sessao da prova e' identificada pelo vinculo com a meta
// (`structure.targetRaceId`, origem `target_race`), nunca por titulo/data: regenerar a semana, editar a data/distancia ou excluir a meta nao duplica nem deixa sessao orfa.
export const RACE_SESSION_ORIGIN = 'target_race';
export const RACE_SESSION_TYPE = 'prova';

export interface CalendarRace { id: string; name: string; raceDate: Date; distanceKm: number; targetSeconds: number | null }
export interface CalendarSession {
  id: string;
  scheduledDate: Date;
  modality: string;
  origin: string | null;
  // tem execucao, vinculo de atividade ou entrega a relogio: nunca e' apagada
  hasDependents: boolean;
  structure: unknown;
}

export interface RaceSessionData {
  targetRaceId: string;
  scheduledDate: Date;
  weekday: number;
  modality: 'corrida';
  title: string;
  sessionType: string;
  distanceKm: number;
  durationMin: number | null;
  structure: { type: 'run'; blocks: never[]; race: { targetRaceId: string; name: string; distanceKm: number; targetSeconds: number | null } };
  origin: string;
}

export interface RaceCalendarChanges {
  create: RaceSessionData[];
  update: Array<{ sessionId: string; data: RaceSessionData }>;
  deleteSessionIds: string[];
  // corridas que deveriam ser substituidas mas tem execucao/entrega: ficam, e o painel/log avisa
  kept: string[];
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const isRun = (modality: string) => modality === 'corrida' || modality === 'esteira';
// So' sessoes do programa (agente ou treinador) sao substituiveis; sessoes extras do aluno/dispositivo sao execucao real e nunca saem.
const REPLACEABLE_ORIGINS = new Set<string | null>(['agent', 'coach_manual', null]);

export function raceTargetIdOf(structure: unknown): string | null {
  const id = structure && typeof structure === 'object' ? (structure as { targetRaceId?: unknown; race?: { targetRaceId?: unknown } }).race?.targetRaceId ?? (structure as { targetRaceId?: unknown }).targetRaceId : null;
  return typeof id === 'string' ? id : null;
}

export function buildRaceSession(race: CalendarRace): RaceSessionData {
  const date = new Date(Date.UTC(race.raceDate.getUTCFullYear(), race.raceDate.getUTCMonth(), race.raceDate.getUTCDate()));
  return {
    targetRaceId: race.id,
    scheduledDate: date,
    weekday: date.getUTCDay(),
    modality: 'corrida',
    title: race.name,
    sessionType: RACE_SESSION_TYPE,
    distanceKm: race.distanceKm,
    // tempo-alvo informado pela aluna vira a duracao prevista; sem meta de tempo, fica em aberto (nada e estimado)
    durationMin: race.targetSeconds ? Math.round(race.targetSeconds / 60) : null,
    structure: { type: 'run', blocks: [], race: { targetRaceId: race.id, name: race.name, distanceKm: race.distanceKm, targetSeconds: race.targetSeconds } },
    origin: RACE_SESSION_ORIGIN,
  };
}

export function planRaceCalendarChanges(input: { planStart: Date; planEnd: Date; races: CalendarRace[]; sessions: CalendarSession[] }): RaceCalendarChanges {
  const from = dayKey(input.planStart);
  const to = dayKey(input.planEnd);
  const desired = input.races.filter((race) => { const key = dayKey(race.raceDate); return key >= from && key <= to; }).map(buildRaceSession);
  const changes: RaceCalendarChanges = { create: [], update: [], deleteSessionIds: [], kept: [] };
  const handled = new Set<string>();

  const existingRaceSessions = input.sessions.filter((s) => s.origin === RACE_SESSION_ORIGIN);
  for (const session of existingRaceSessions) {
    const raceId = raceTargetIdOf(session.structure);
    const match = desired.find((d) => d.targetRaceId === raceId && dayKey(d.scheduledDate) === dayKey(session.scheduledDate));
    if (match && !handled.has(match.targetRaceId)) { changes.update.push({ sessionId: session.id, data: match }); handled.add(match.targetRaceId); continue; }
    // meta excluida, arquivada, concluida, ou data/semana alterada: a sessao da prova antiga sai (se ja tiver execucao, fica)
    if (session.hasDependents) changes.kept.push(session.id); else changes.deleteSessionIds.push(session.id);
  }

  for (const race of desired) {
    if (handled.has(race.targetRaceId)) continue;
    changes.create.push(race);
  }

  // a prova substitui SO' a corrida do programa naquele dia; outras modalidades permanecem
  for (const race of desired) {
    for (const session of input.sessions) {
      if (session.origin === RACE_SESSION_ORIGIN || !isRun(session.modality) || !REPLACEABLE_ORIGINS.has(session.origin)) continue;
      if (dayKey(session.scheduledDate) !== dayKey(race.scheduledDate)) continue;
      if (session.hasDependents) changes.kept.push(session.id); else if (!changes.deleteSessionIds.includes(session.id)) changes.deleteSessionIds.push(session.id);
    }
  }
  return changes;
}
