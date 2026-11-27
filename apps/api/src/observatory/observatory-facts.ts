import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { localCalendarDate } from '../activity-execution/session-execution-link.service';
import { modalityGroup } from '../coach/training-load';
import { buildPhasedCycles } from '../menstrual-cycle/cycle-phases';
import { canonicalModality } from '../activity-execution/canonical-modality';
import type { ObsFacts, ObsParticipant, ObsPainReport, ObsQuality, ObsRunEvent, ObsScheduled, ObsStrengthEvent, ObsTraining, PainLevel, TrainingGroup, TrainingSegment } from './observatory.types';

// Observatorio Panzeri Run (24/10/2026) — BASE CANONICA de treinos realizados. Funcao de transformacao (linhas lidas em lote -> fatos); nenhuma consulta por aluno aqui.
// Regras: so' atividade fisica valida e elegivel; um evento fisico = uma observacao (canonica); a data da semana e' o DIA LOCAL DA EXECUCAO (nao o programado); extra nunca soma duas
// vezes; identidade fisica ambigua fica fora dos totais (e e' contada na qualidade); procedencia Strava (direta ou indireta) NUNCA entra; ausencia de registro nao e' ausencia de atividade.

export interface RawActivity {
  id: string; userId: string; provider: string; startedAt: Date; utcOffsetMinutes: number | null; durationSec: number | null; distanceMeters: number | null; sport: string | null;
  providerMetrics: unknown; physicalIdentityStatus: string | null; physicalEventId: string | null; physicalCanonicalActivityLogId: string | null; executionClassification?: string | null;
}
export interface RawCompletion {
  id: string; userId: string; sessionId: string | null; status: string; completedAt: Date; distanceKm: number | null; durationMin: number | null; painFlag: string | null; painIntensity?: number | null; painTiming?: string | null; perceivedEffort: number | null;
  session: { modality: string | null; origin: string | null; structure: unknown } | null;
}
export interface RawLink { trainingSessionId: string; activityLogId: string }
export interface RawPain { id: string; userId: string; createdAt: Date; intensity: number; regions?: string[]; hasOtherLocation?: boolean }
export interface RawSession { userId: string; scheduledDate: Date; modality: string | null; origin: string | null; completionStatus: string | null; linked: boolean }
export interface RawUser { id: string; birthDate: Date | null; sex: string | null }
export interface RawCycleLog { userId: string; cycleStartDate: Date; cycleEndDate: Date | null }
export interface RawMenstrualProfile { userId: string; cycleLengthDays: number | null; periodLengthDays: number | null; usesHormonalContraceptive: boolean | null }
export interface RawRows { users: RawUser[]; activities: RawActivity[]; completions: RawCompletion[]; links: RawLink[]; pains: RawPain[]; cycleLogs?: RawCycleLog[]; menstrualProfiles?: RawMenstrualProfile[]; sessions?: RawSession[] }

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

// Tipo de treino para as taxas (ordem de Elton, 26/11/2026). Extra = sessao criada pela aluna ou pelo relogio (nao programada) ou atividade classificada como 'alternative'.
export function isExtraSession(origin: string | null | undefined, structure: unknown): boolean {
  if (origin === 'device_extra' || origin === 'student_extra') return true;
  const type = structure && typeof structure === 'object' && !Array.isArray(structure) ? (structure as Record<string, unknown>).type : null;
  return type === 'extra';
}
export function segmentOf(modality: string | null | undefined, isExtra: boolean): TrainingSegment {
  const raw = (modality ?? '').trim().toLowerCase();
  const key = canonicalModality(raw) ?? raw;
  const run = key === 'corrida' || key === 'esteira';
  if (isExtra) return run ? 'extra_corrida' : 'extra_geral';
  if (run) return 'corrida';
  if (key === 'fortalecimento_corredores') return 'fortalecimento';
  if (key === 'forca') return 'musculacao';
  return 'outras';
}

// Local da dor do "Relatar dor": junta os lados ('Joelho direito' e 'Joelho esquerdo' = joelho) e guarda o lado a parte. Valor desconhecido vira 'outros'; "Nao sei responder" vira 'nao_informado'.
const deaccent = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const REGION_GROUP_LABEL: Record<string, string> = {
  joelho: 'Joelho', tornozelo: 'Tornozelo', pe: 'Pé', canela: 'Canela', panturrilha: 'Panturrilha', coxa: 'Coxa', quadril: 'Quadril', gluteo: 'Glúteo',
  lombar_coluna: 'Lombar / coluna', ombro: 'Ombro', outros: 'Outros', nao_informado: 'Não soube informar',
};
export function regionOf(label: string): { group: string; side: 'direito' | 'esquerdo' | null } | null {
  const text = deaccent(label);
  if (!text) return null;
  const side = /\b(direit[oa])\b/.test(text) ? 'direito' : /\b(esquerd[oa])\b/.test(text) ? 'esquerdo' : null;
  const base = text.replace(/\b(direit[oa]|esquerd[oa])\b/g, '').replace(/\s+/g, ' ').trim();
  if (base.startsWith('nao sei')) return { group: 'nao_informado', side: null };
  const known: Array<[string, string]> = [['joelho', 'joelho'], ['tornozelo', 'tornozelo'], ['pe', 'pe'], ['canela', 'canela'], ['panturrilha', 'panturrilha'], ['coxa', 'coxa'], ['quadril', 'quadril'], ['gluteo', 'gluteo'], ['lombar', 'lombar_coluna'], ['coluna', 'lombar_coluna'], ['ombro', 'ombro']];
  const hit = known.find(([prefix]) => base === prefix || base.startsWith(prefix + ' ') || base.startsWith(prefix + '/'));
  return { group: hit ? hit[1] : 'outros', side };
}

const validKm = (m: number | null) => (m != null && Number.isFinite(m) && m > 0 ? m / 1000 : null);
const validSec = (s: number | null) => (s != null && Number.isFinite(s) && s > 0 ? s : null);

export async function buildFactsFromRows(
  rows: RawRows,
  loadActivitiesByIds: (ids: string[]) => Promise<RawActivity[]>,
  window: { since: string; to: string },
): Promise<ObsFacts> {
  const quality: ObsQuality = { stravaExcludedEvents: 0, ambiguousIdentityEvents: 0, unevaluatedIdentityEvents: 0, invalidDistanceEvents: 0, duplicateManualEvents: 0, painConflicts: 0 };
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
  const activityEvents: Array<{ key: string; row: RawActivity; userId: string; day: string; group: ReturnType<typeof modalityGroup>; classifiedExtra: boolean }> = [];
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
    activityEvents.push({ key, row, userId: row.userId, day, group: modalityGroup(row.sport), classifiedExtra: pick.members.some((m) => m.executionClassification === 'alternative') || row.executionClassification === 'alternative' });
  }

  // ── 2) completions por sessao e por evento (dor e feedback ficam no treino) ──
  const linkBySession = new Map<string, string>();
  for (const l of rows.links) linkBySession.set(l.trainingSessionId, l.activityLogId);
  const completionsByEvent = new Map<string, RawCompletion[]>();
  const manualCandidates: RawCompletion[] = [];
  const strengthCompletions: RawCompletion[] = [];
  const otherCompletions: RawCompletion[] = [];
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
    else otherCompletions.push(c);
  }

  // ── 3) eventos de corrida por atividade ──
  const eventsByDay = new Map<string, ObsRunEvent[]>(); // `${userId}|${day}` -> eventos (para atribuir dor e deduplicar manuais)
  const push = (e: ObsRunEvent) => { runEvents.push(e); const k = `${e.participant}|${e.day}`; eventsByDay.set(k, [...(eventsByDay.get(k) ?? []), e]); };
  const painFrom = (cs: RawCompletion[]) => {
    const flags = cs.map((x) => x.painFlag).filter((x): x is string => x != null);
    const painful = flags.find((x) => x !== 'none');
    if (painful && flags.includes('none')) quality.painConflicts += 1;
    const answered = cs.some((x) => x.painFlag != null || x.perceivedEffort != null);
    const timing = painful ? cs.find((x) => x.painFlag === painful)?.painTiming ?? null : null;
    // nota 1-10 da escala nova (maior entre os feedbacks do evento); sem nota = dado antigo (convertido na leitura)
    const notes = cs.filter((x) => x.painFlag !== 'none' && x.painIntensity != null).map((x) => x.painIntensity as number);
    return { answered, flag: painful ?? (flags.length > 0 ? 'none' : null), timing, intensity: notes.length > 0 ? Math.max(...notes) : null };
  };
  const levelOf = (flag: string | null): PainLevel | null => (flag === 'leve' || flag === 'moderado' || flag === 'forte' ? flag : null);
  const trainings: ObsTraining[] = [];
  const painOf = (flag: string | null, timing: string | null, intensity: number | null = null) => ({ origin: (flag === 'none' ? 'explicit_no_pain' : flag ? 'reported_pain' : 'no_pain_report') as ObsTraining['pain']['origin'], level: levelOf(flag), timing: flag && flag !== 'none' ? timing : null, intensity: flag && flag !== 'none' ? intensity : null });
  const trainingsByDay = new Map<string, ObsTraining[]>(); // `${userId}|${day}|${group}` -> treinos (para nao contar duas vezes o registro manual de um treino ja' importado)
  const addTraining = (t: ObsTraining) => { trainings.push(t); const k = `${t.participant}|${t.day}|${t.group}`; trainingsByDay.set(k, [...(trainingsByDay.get(k) ?? []), t]); };
  for (const ev of activityEvents) {
    if (ev.group !== 'corrida') {
      const group: TrainingGroup = ev.group === 'forca' ? 'forca' : 'outras';
      if (group === 'forca') strengthEvents.push({ participant: ev.userId, eventKey: ev.key, day: ev.day }); // sessao de forca vinculada ou nao: conta UMA vez, pelo evento da atividade
      const linked = completionsByEvent.get(ev.key) ?? [];
      const painInfo = painFrom(linked);
      const extra = ev.classifiedExtra || linked.some((c) => isExtraSession(c.session?.origin, c.session?.structure));
      addTraining({ participant: ev.userId, eventKey: ev.key, day: ev.day, group, segment: segmentOf(ev.row.sport, extra), km: validKm(ev.row.distanceMeters), seconds: validSec(ev.row.durationSec), feedbackAnswered: painInfo.answered, pain: painOf(painInfo.flag, painInfo.timing, painInfo.intensity) });
      continue;
    }
    const km = validKm(ev.row.distanceMeters);
    if (km == null) quality.invalidDistanceEvents += 1;
    const linkedRun = completionsByEvent.get(ev.key) ?? [];
    const { answered, flag, timing, intensity } = painFrom(linkedRun);
    const runExtra = ev.classifiedExtra || linkedRun.some((c) => isExtraSession(c.session?.origin, c.session?.structure));
    push({
      participant: ev.userId, eventKey: ev.key, day: ev.day, km, seconds: km == null ? null : validSec(ev.row.durationSec), source: 'activity', isExtra: runExtra,
      feedbackAnswered: answered, painLevel: levelOf(flag), painTiming: flag && flag !== 'none' ? timing : null, pain: flag === 'none' ? { origin: 'explicit_no_pain', intensity: 0 } : flag ? { origin: 'reported_pain', intensity } : { origin: 'no_pain_report', intensity: 0 },
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
    const { answered, flag, timing, intensity } = painFrom([c]);
    if (same) {
      // mesma corrida ja' importada: nao conta de novo; o feedback da aluna passa para o evento importado
      quality.duplicateManualEvents += 1;
      if (answered) same.feedbackAnswered = true;
      if (same.pain.origin === 'no_pain_report') { same.pain = flag === 'none' ? { origin: 'explicit_no_pain', intensity: 0 } : flag ? { origin: 'reported_pain', intensity } : same.pain; same.painLevel = levelOf(flag); same.painTiming = flag && flag !== 'none' ? timing : null; }
      continue;
    }
    if (km == null) quality.invalidDistanceEvents += 1;
    push({
      participant: c.userId, eventKey: `m:${c.id}`, day, km, seconds: km != null && c.durationMin != null && c.durationMin > 0 ? c.durationMin * 60 : null, source: 'manual',
      isExtra: isExtraSession(c.session?.origin, c.session?.structure), feedbackAnswered: answered, painLevel: levelOf(flag), painTiming: flag && flag !== 'none' ? timing : null,
      pain: flag === 'none' ? { origin: 'explicit_no_pain', intensity: 0 } : flag ? { origin: 'reported_pain', intensity } : { origin: 'no_pain_report', intensity: 0 },
    });
  }
  // Forca e outras modalidades registradas SO' pelo feedback (sem atividade importada): entram como treino; se ja' ha' um treino importado do mesmo grupo no dia, o registro e' a mesma sessao (o feedback passa para ela).
  const addManualTraining = (c: RawCompletion, group: TrainingGroup) => {
    const day = spDay(c.completedAt);
    if (!inWindow(day)) return;
    const { answered, flag, timing, intensity } = painFrom([c]);
    const same = (trainingsByDay.get(`${c.userId}|${day}|${group}`) ?? [])[0];
    if (same) {
      quality.duplicateManualEvents += 1;
      if (answered) same.feedbackAnswered = true;
      if (same.pain.origin === 'no_pain_report' && flag) same.pain = painOf(flag, timing, intensity);
      return;
    }
    const km = c.distanceKm != null && c.distanceKm > 0 ? c.distanceKm : null;
    addTraining({ participant: c.userId, eventKey: `m:${c.id}`, day, group, segment: segmentOf(c.session?.modality, isExtraSession(c.session?.origin, c.session?.structure)), km, seconds: c.durationMin != null && c.durationMin > 0 ? c.durationMin * 60 : null, feedbackAnswered: answered, pain: painOf(flag, timing, intensity) });
  };
  for (const c of strengthCompletions) {
    const day = spDay(c.completedAt);
    if (inWindow(day)) strengthEvents.push({ participant: c.userId, eventKey: `m:${c.id}`, day });
    addManualTraining(c, 'forca');
  }
  for (const c of otherCompletions) addManualTraining(c, 'outras');
  for (const e of runEvents) trainings.push({ participant: e.participant, eventKey: e.eventKey, day: e.day, group: 'corrida', segment: e.isExtra ? 'extra_corrida' : 'corrida', km: e.km, seconds: e.seconds, feedbackAnswered: e.feedbackAnswered, pain: { origin: e.pain.origin, level: e.painLevel ?? null, timing: e.painTiming ?? null, intensity: e.pain.origin === 'reported_pain' ? e.pain.intensity : null } });

  // ── 5) "Relatar dor" (1–10 + regioes): analisado SEPARADO, nunca colado a treino (ordem de Elton, 26/11/2026). Fica so' como lista de relatos avulsos. ──
  const painReports: ObsPainReport[] = [];
  for (const p of rows.pains) {
    const day = spDay(p.createdAt);
    if (!inWindow(day)) continue;
    const parsed = (p.regions ?? []).map(regionOf).filter((r): r is NonNullable<ReturnType<typeof regionOf>> => r != null);
    const groups = [...new Set([...parsed.map((r) => r.group), ...(p.hasOtherLocation ? ['outros'] : [])])];
    painReports.push({ participant: p.userId, day, intensity: Math.min(10, Math.max(1, Math.round(p.intensity))), regions: groups, regionSides: [...new Set(parsed.filter((r) => r.side).map((r) => `${r.group}:${r.side}`))] });
  }

  // ── 6) ciclo: so' de quem registrou ciclos (a fase de cada dia e' calculada no motor, com as mesmas regras do relatorio da aluna) ──
  const logsByUser = new Map<string, RawCycleLog[]>();
  for (const l of rows.cycleLogs ?? []) logsByUser.set(l.userId, [...(logsByUser.get(l.userId) ?? []), l]);
  const profileByUser = new Map((rows.menstrualProfiles ?? []).map((m) => [m.userId, m]));

  // ── 7) treinos PROGRAMADOS (adesao): extras nao entram; registrado = feedback feito/ajustado ou atividade vinculada ──
  const scheduled: ObsScheduled[] = [];
  for (const s of rows.sessions ?? []) {
    if (isExtraSession(s.origin, null)) continue;
    const day = s.scheduledDate.toISOString().slice(0, 10);
    if (!inWindow(day)) continue;
    const segment = segmentOf(s.modality, false) as ObsScheduled['segment'];
    scheduled.push({ participant: s.userId, day, segment, registered: s.completionStatus === 'done' || s.completionStatus === 'adjusted' || (s.completionStatus == null && s.linked) });
  }

  const hasEvents = new Set([...runEvents.map((e) => e.participant), ...strengthEvents.map((e) => e.participant), ...trainings.map((t) => t.participant), ...painReports.map((r) => r.participant), ...scheduled.map((s) => s.participant)]);
  const participants: ObsParticipant[] = rows.users
    .filter((u) => hasEvents.has(u.id))
    .map((u): ObsParticipant => {
      const logs = logsByUser.get(u.id) ?? [];
      const profile = profileByUser.get(u.id) ?? null;
      const cycles = logs.length > 0 ? buildPhasedCycles(logs.map((l) => ({ start: l.cycleStartDate, end: l.cycleEndDate })), profile) : [];
      return { key: u.id, birthDate: u.birthDate ? u.birthDate.toISOString().slice(0, 10) : null, sex: u.sex, ...(cycles.length > 0 ? { cycle: { cycles, hormonal: profile?.usesHormonalContraceptive ?? null } } : {}) };
    });
  return { dataset: 'real', dataAsOf: new Date().toISOString(), participants, runEvents, strengthEvents, trainings, painReports, scheduled, quality };
}
