import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { localCalendarDate } from '../activity-execution/session-execution-link.service';
import { modalityGroup } from '../coach/training-load';
import { addDays } from './observatory-core';
import type { ObsFacts, ObsParticipant, ObsQuality, ObsRunEvent, ObsStrengthEvent } from './observatory.types';

// Observatorio Panzeri Run (24/10/2026) — BASE CANONICA de treinos realizados. Funcao de transformacao (linhas lidas em lote -> fatos); nenhuma consulta por aluno aqui.
// Regras: so' atividade fisica valida e elegivel; um evento fisico = uma observacao (canonica); a data da semana e' o DIA LOCAL DA EXECUCAO (nao o programado); extra nunca soma duas
// vezes; identidade fisica ambigua fica fora dos totais (e e' contada na qualidade); procedencia Strava (direta ou indireta) NUNCA entra; ausencia de registro nao e' ausencia de atividade.

export interface RawActivity {
  id: string; userId: string; provider: string; startedAt: Date; utcOffsetMinutes: number | null; durationSec: number | null; distanceMeters: number | null; sport: string | null;
  providerMetrics: unknown; physicalIdentityStatus: string | null; physicalEventId: string | null; physicalCanonicalActivityLogId: string | null;
}
export interface RawCompletion {
  id: string; userId: string; sessionId: string | null; status: string; completedAt: Date; distanceKm: number | null; durationMin: number | null; painFlag: string | null; perceivedEffort: number | null;
  session: { modality: string | null; origin: string | null; structure: unknown } | null;
}
export interface RawLink { trainingSessionId: string; activityLogId: string }
export interface RawPain { id: string; userId: string; createdAt: Date; intensity: number }
export interface RawUser { id: string; birthDate: Date | null; sex: string | null }
export interface RawRows { users: RawUser[]; activities: RawActivity[]; completions: RawCompletion[]; links: RawLink[]; pains: RawPain[] }

const spDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// Procedencia Strava: provedor direto OU origem indireta identificavel (canal de saude cujo app/bundle de origem e' o Strava). Nao e' resolvido por anonimizacao posterior.
export function isStravaProvenance(provider: string, providerMetrics: unknown): boolean {
  if (provider === 'strava') return true;
  const source = obj(obj(providerMetrics)?.source);
  const id = String(source?.packageName ?? source?.bundleId ?? '').toLowerCase();
  const name = String(source?.name ?? '').toLowerCase();
  return id === 'com.strava' || id.startsWith('com.strava.') || name === 'strava';
}

const validKm = (m: number | null) => (m != null && Number.isFinite(m) && m > 0 ? m / 1000 : null);
const validSec = (s: number | null) => (s != null && Number.isFinite(s) && s > 0 ? s : null);

export async function buildFactsFromRows(
  rows: RawRows,
  loadActivitiesByIds: (ids: string[]) => Promise<RawActivity[]>,
  window: { since: string; to: string },
): Promise<ObsFacts> {
  const quality: ObsQuality = { stravaExcludedEvents: 0, ambiguousIdentityEvents: 0, unevaluatedIdentityEvents: 0, invalidDistanceEvents: 0, duplicateManualEvents: 0, painReportsWithoutTraining: 0, painConflicts: 0 };
  const runEvents: ObsRunEvent[] = [];
  const strengthEvents: ObsStrengthEvent[] = [];
  const inWindow = (day: string) => day >= window.since && day <= window.to;

  // ── 1) atividades importadas: procedencia, identidade, observacao canonica ──
  const usable: RawActivity[] = [];
  for (const a of rows.activities) {
    if (isStravaProvenance(a.provider, a.providerMetrics)) { quality.stravaExcludedEvents += 1; continue; }
    usable.push(a);
  }
  const blocked = new Set<string>(); // ids de observacoes excluidas (Strava/ambiguas): a completion vinculada a elas NAO pode virar "treino manual"
  for (const a of rows.activities) if (isStravaProvenance(a.provider, a.providerMetrics)) blocked.add(a.id);
  const picks = await pickCanonicalPerEvent(usable, loadActivitiesByIds);
  const eventOfActivity = new Map<string, string>(); // id de QUALQUER observacao -> chave do evento
  const activityEvents: Array<{ key: string; row: RawActivity; userId: string; day: string; group: ReturnType<typeof modalityGroup> }> = [];
  for (const pick of picks) {
    // o representante nao pode ser de procedencia Strava (a canonica buscada fora da leitura pode ser): usa outro membro permitido, ou exclui o evento
    let row = pick.row;
    if (isStravaProvenance(row.provider, row.providerMetrics)) {
      const alt = pick.members.find((m) => !isStravaProvenance(m.provider, m.providerMetrics));
      if (!alt) { quality.stravaExcludedEvents += 1; for (const m of pick.members) blocked.add(m.id); blocked.add(pick.row.id); continue; }
      row = alt;
    }
    const status = row.physicalIdentityStatus;
    if (status === 'ambiguous') { quality.ambiguousIdentityEvents += 1; for (const m of pick.members) blocked.add(m.id); blocked.add(row.id); continue; }
    if (status == null) quality.unevaluatedIdentityEvents += 1;
    const key = `a:${row.id}`;
    for (const m of pick.members) eventOfActivity.set(m.id, key);
    eventOfActivity.set(row.id, key);
    const day = localCalendarDate(row.startedAt, row.utcOffsetMinutes);
    if (!inWindow(day)) continue;
    activityEvents.push({ key, row, userId: row.userId, day, group: modalityGroup(row.sport) });
  }

  // ── 2) completions por sessao e por evento (dor e feedback ficam no treino) ──
  const linkBySession = new Map<string, string>();
  for (const l of rows.links) linkBySession.set(l.trainingSessionId, l.activityLogId);
  const completionsByEvent = new Map<string, RawCompletion[]>();
  const manualCandidates: RawCompletion[] = [];
  const strengthCompletions: RawCompletion[] = [];
  for (const c of rows.completions) {
    if (c.status !== 'done' && c.status !== 'adjusted') continue;
    const group = modalityGroup(c.session?.modality);
    const linkedActivity = c.sessionId ? linkBySession.get(c.sessionId) : undefined;
    const eventKey = linkedActivity ? eventOfActivity.get(linkedActivity) : undefined;
    if (eventKey) {
      completionsByEvent.set(eventKey, [...(completionsByEvent.get(eventKey) ?? []), c]);
      continue;
    }
    if (linkedActivity) continue; // vinculada a uma atividade excluida (Strava/ambigua) ou fora da janela: a execucao existe e nao pode ser recontada como treino manual
    if (c.session?.origin === 'device_extra') continue; // copia da atividade: nunca um segundo treino
    if (group === 'corrida') manualCandidates.push(c);
    else if (group === 'forca') strengthCompletions.push(c);
  }

  // ── 3) eventos de corrida por atividade ──
  const eventsByDay = new Map<string, ObsRunEvent[]>(); // `${userId}|${day}` -> eventos (para atribuir dor e deduplicar manuais)
  const push = (e: ObsRunEvent) => { runEvents.push(e); const k = `${e.participant}|${e.day}`; eventsByDay.set(k, [...(eventsByDay.get(k) ?? []), e]); };
  const painFrom = (cs: RawCompletion[]) => {
    const flags = cs.map((x) => x.painFlag).filter((x): x is string => x != null);
    const painful = flags.find((x) => x !== 'none');
    if (painful && flags.includes('none')) quality.painConflicts += 1;
    const answered = cs.some((x) => x.painFlag != null || x.perceivedEffort != null);
    return { answered, flag: painful ?? (flags.length > 0 ? 'none' : null) };
  };
  for (const ev of activityEvents) {
    if (ev.group === 'forca') {
      strengthEvents.push({ participant: ev.userId, eventKey: ev.key, day: ev.day }); // sessao de forca vinculada ou nao: conta UMA vez, pelo evento da atividade
      continue;
    }
    if (ev.group !== 'corrida') continue;
    const km = validKm(ev.row.distanceMeters);
    if (km == null) quality.invalidDistanceEvents += 1;
    const { answered, flag } = painFrom(completionsByEvent.get(ev.key) ?? []);
    push({
      participant: ev.userId, eventKey: ev.key, day: ev.day, km, seconds: km == null ? null : validSec(ev.row.durationSec), source: 'activity', isExtra: false,
      feedbackAnswered: answered, pain: flag === 'none' ? { origin: 'explicit_no_pain', intensity: 0 } : flag ? { origin: 'reported_pain', intensity: null } : { origin: 'no_pain_report', intensity: 0 },
    });
  }

  // ── 4) treinos manuais (sem atividade importada): extra nunca soma duas vezes ──
  for (const c of manualCandidates) {
    const day = spDay(c.completedAt);
    if (!inWindow(day)) continue;
    const km = c.distanceKm != null && c.distanceKm > 0 ? c.distanceKm : null;
    const sameDay = eventsByDay.get(`${c.userId}|${day}`) ?? [];
    // mesma corrida ja' contada (importada OU outro registro manual igual) — ou registro manual sem distancia no mesmo dia de outro treino: nao e' um treino a mais
    const same = sameDay.find((e) => (km == null ? true : e.km != null && Math.abs(e.km - km) <= Math.max(0.5, km * 0.1)));
    const { answered, flag } = painFrom([c]);
    if (same) {
      // mesma corrida ja' importada: nao conta de novo; o feedback da aluna passa para o evento importado
      quality.duplicateManualEvents += 1;
      if (answered) same.feedbackAnswered = true;
      if (same.pain.origin === 'no_pain_report') same.pain = flag === 'none' ? { origin: 'explicit_no_pain', intensity: 0 } : flag ? { origin: 'reported_pain', intensity: null } : same.pain;
      continue;
    }
    if (km == null) quality.invalidDistanceEvents += 1;
    const structure = obj(c.session?.structure);
    push({
      participant: c.userId, eventKey: `m:${c.id}`, day, km, seconds: km != null && c.durationMin != null && c.durationMin > 0 ? c.durationMin * 60 : null, source: 'manual',
      isExtra: structure?.type === 'extra', feedbackAnswered: answered,
      pain: flag === 'none' ? { origin: 'explicit_no_pain', intensity: 0 } : flag ? { origin: 'reported_pain', intensity: null } : { origin: 'no_pain_report', intensity: 0 },
    });
  }
  for (const c of strengthCompletions) {
    const day = spDay(c.completedAt);
    if (inWindow(day)) strengthEvents.push({ participant: c.userId, eventKey: `m:${c.id}`, day });
  }

  // ── 5) relatos de dor (PainReport 1–10): atribuidos ao treino do mesmo dia (ou do dia anterior); um relato nunca vira duas ocorrencias ──
  const attached = new Map<ObsRunEvent, number>();
  for (const p of rows.pains) {
    const day = spDay(p.createdAt);
    if (!inWindow(day)) continue;
    const sameDay = eventsByDay.get(`${p.userId}|${day}`);
    const prevDay = eventsByDay.get(`${p.userId}|${addDays(day, -1)}`);
    const target = (sameDay && sameDay[sameDay.length - 1]) || (prevDay && prevDay[prevDay.length - 1]);
    if (!target) { quality.painReportsWithoutTraining += 1; continue; }
    const note = Math.min(10, Math.max(1, Math.round(p.intensity)));
    attached.set(target, Math.max(attached.get(target) ?? 0, note));
  }
  for (const [event, intensity] of attached) {
    if (event.pain.origin === 'explicit_no_pain') quality.painConflicts += 1;
    event.pain = { origin: 'reported_pain', intensity }; // uma ocorrencia por treino: a nota numerica prevalece sobre a marcacao categorica
    event.feedbackAnswered = true;
  }

  const hasEvents = new Set([...runEvents.map((e) => e.participant), ...strengthEvents.map((e) => e.participant)]);
  const participants: ObsParticipant[] = rows.users
    .filter((u) => hasEvents.has(u.id))
    .map((u) => ({ key: u.id, birthDate: u.birthDate ? u.birthDate.toISOString().slice(0, 10) : null, sex: u.sex }));
  return { dataset: 'real', dataAsOf: new Date().toISOString(), participants, runEvents, strengthEvents, quality };
}
