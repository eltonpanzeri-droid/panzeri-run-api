import { activityLocalDate as sharedActivityLocalDate } from '../common/local-date';
import { PrismaService } from '../prisma/prisma.service';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { aiBlockedProviders } from '../ai-governance/ai-scope';
import type { LoadInputRow } from './training-load';

// FONTE ÚNICA dos registros que alimentam a carga interna percebida (PSE × minutos) — 01/11/2026. Antes, esta montagem morava dentro do serviço do painel (StudentTrainingLoadService); agora
// o painel, o Explorar (variáveis do registro) e o contexto da IA leem TODOS daqui, para que nunca existam duas contas da mesma métrica. SOMENTE LEITURA.
//
// Atividade importada só vale quando: (a) o vínculo com o treino está ativo; (b) é UMA atividade (vários eventos físicos distintos no mesmo treino = ambíguo, nada é usado); (c) vale a observação
// CANÔNICA do evento (a mesma regra do resto do sistema: um evento físico = uma observação, sem duplicar); (d) a mesma atividade nunca serve a dois treinos; (e) nunca Strava.
// Salvaguarda de vínculo (decisão de Elton, 23/10/2026): a partir de 3 dias de diferença a aluna é PERGUNTADA se foi um treino extra ou um treino programado para outro dia; portanto um vínculo
// AUTOMÁTICO a mais de 3 dias do dia programado é suspeito e a atividade NÃO é usada (vale a data programada, com aviso). Um vínculo confirmado por PESSOA (aluna ou treinador, origem
// 'student'/'coach') foi uma decisão consciente e vale até 6 dias (o limite do vínculo manual); além disso também é ignorado. O dia programado já reflete um reagendamento feito pela aluna.
//
// Dentro de um escopo de IA (runWithAiScope), atividade de relógio/provedor SEM consentimento da aluna é tratada como inexistente: o vínculo é ignorado (a duração e a data voltam às
// informadas/programadas pela aluna) e a sessão extra criada só a partir dessa atividade nem entra. Fora do escopo (painel do treinador) nada muda.
export const AUTOMATIC_LINK_MAX_SHIFT_DAYS = 3;
export const CONFIRMED_LINK_MAX_SHIFT_DAYS = 6;
export const COACH_HIDDEN_PROVIDERS = ['strava']; // dados do Strava nao sao exibidos ao treinador (Politica de Privacidade) nem usados na carga

const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const spDay = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const ACTIVITY_SELECT = {
  id: true, provider: true, startedAt: true, utcOffsetMinutes: true, durationSec: true,
  physicalIdentityStatus: true, physicalEventId: true, physicalCanonicalActivityLogId: true,
} as const;
interface ActivityRow {
  id: string; provider: string; startedAt: Date; utcOffsetMinutes: number | null; durationSec: number | null;
  physicalIdentityStatus: string | null; physicalEventId: string | null; physicalCanonicalActivityLogId: string | null;
}
interface LinkedActivity { activity: ActivityRow; confirmedByPerson: boolean }

// Dia LOCAL da atividade: instante UTC + o deslocamento informado pela fonte; sem deslocamento, o horario de Sao Paulo (nunca se presume outro fuso).
export function activityLocalDate(startedAt: Date, utcOffsetMinutes: number | null): string {
  return sharedActivityLocalDate(startedAt, utcOffsetMinutes);
}
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);

// sessionId -> observacao CANONICA da atividade confirmada. So' entra quando ha exatamente UM evento fisico confirmado para o treino (e nunca Strava, nem provedor bloqueado para a IA no escopo atual).
async function linkedActivities(prisma: PrismaService, userId: string, sessionIds: string[]): Promise<Map<string, LinkedActivity>> {
  const result = new Map<string, LinkedActivity>();
  if (sessionIds.length === 0) return result;
  const blocked = aiBlockedProviders();
  const links = await prisma.sessionExecutionLink.findMany({
    where: { userId, status: 'active', trainingSessionId: { in: sessionIds } },
    select: { trainingSessionId: true, origin: true, activityLog: { select: ACTIVITY_SELECT } },
  });
  const rows = links.map((l) => l.activityLog as ActivityRow);
  const picks = await pickCanonicalPerEvent(rows, (ids) => prisma.activityLog.findMany({ where: { userId, id: { in: ids } }, select: ACTIVITY_SELECT }) as Promise<ActivityRow[]>);
  const canonicalOf = new Map<string, ActivityRow>();
  for (const pick of picks) for (const member of pick.members) canonicalOf.set(member.id, pick.row);
  const bySession = new Map<string, Map<string, LinkedActivity>>();
  for (const link of links) {
    const canonical = canonicalOf.get(link.activityLog.id);
    if (!canonical || COACH_HIDDEN_PROVIDERS.includes(canonical.provider) || blocked.includes(canonical.provider)) continue;
    const confirmed = link.origin === 'student' || link.origin === 'coach';
    const events = bySession.get(link.trainingSessionId) ?? new Map<string, LinkedActivity>();
    const previous = events.get(canonical.id);
    events.set(canonical.id, { activity: canonical, confirmedByPerson: confirmed || previous?.confirmedByPerson === true }); // se algum vinculo do evento foi de uma pessoa, vale como confirmado
    bySession.set(link.trainingSessionId, events);
  }
  for (const [sessionId, events] of bySession) if (events.size === 1) result.set(sessionId, [...events.values()][0]); // 2+ eventos distintos = ambiguo: nada e' usado
  return result;
}

/** Todos os treinos feitos (done/adjusted) da aluna, já com a data e a duração a usar na carga. A classificação (entra/fica de fora) é feita por classifySessions, em training-load.ts. */
export async function loadInputRows(prisma: PrismaService, studentId: string): Promise<LoadInputRow[]> {
  const blocked = aiBlockedProviders();
  const completions = await prisma.workoutCompletion.findMany({
    where: { userId: studentId, status: { in: ['done', 'adjusted'] } },
    orderBy: { completedAt: 'asc' },
    select: { id: true, sessionId: true, source: true, completedAt: true, status: true, durationMin: true, perceivedEffort: true, session: { select: { scheduledDate: true, modality: true, title: true, structure: true } } },
  });
  const activityBySession = await linkedActivities(prisma, studentId, completions.map((c) => c.sessionId).filter((id): id is string => Boolean(id)));

  type Completion = (typeof completions)[number];
  const structureOf = (c: Completion) => (c.session?.structure ?? null) as { source?: unknown; type?: unknown; provider?: unknown } | null;
  // Sessao EXTRA materializada de uma atividade importada (source 'device_extra'): ela nasce da propria atividade — o dia e a duracao ja sao os da atividade.
  const isDeviceExtra = (c: Completion) => c.source === 'device_extra' || structureOf(c)?.source === 'device';
  const programmedOf = (c: Completion) => (c.session?.scheduledDate ? isoDay(c.session.scheduledDate) : spDay(c.completedAt));
  // Em escopo de IA, a sessao extra que so' existe por causa de uma atividade de provedor bloqueado nao entra (a aluna nao autorizou aquele dado).
  const isBlockedDeviceExtra = (c: Completion) => {
    if (!isDeviceExtra(c) || blocked.length === 0) return false;
    const provider = structureOf(c)?.provider;
    return typeof provider === 'string' && blocked.includes(provider);
  };

  // 1) candidata de cada treino (atividade confirmada, canonica, unica, nunca Strava) e salvaguarda de vinculo distante
  const candidates = new Map<string, { activity: ActivityRow; date: string; shift: number }>();
  const notes = new Map<string, 'vinculo_distante' | 'vinculo_confirmado' | 'atividade_ja_usada'>();
  const dropped = new Set<string>(); // treinos que perderam a atividade para outro (a mesma atividade nao serve a dois)
  for (const c of completions) {
    if (isDeviceExtra(c)) continue;
    const linked = c.sessionId ? activityBySession.get(c.sessionId) ?? null : null;
    if (!linked) continue;
    const activity = linked.activity;
    const date = activityLocalDate(activity.startedAt, activity.utcOffsetMinutes);
    const shift = c.session?.scheduledDate ? dayDiff(programmedOf(c), date) : 0;
    const limit = linked.confirmedByPerson ? CONFIRMED_LINK_MAX_SHIFT_DAYS : AUTOMATIC_LINK_MAX_SHIFT_DAYS;
    if (Math.abs(shift) > limit) { notes.set(c.id, 'vinculo_distante'); continue; }
    if (linked.confirmedByPerson && Math.abs(shift) > AUTOMATIC_LINK_MAX_SHIFT_DAYS) notes.set(c.id, 'vinculo_confirmado'); // aviso informativo: foi confirmado por uma pessoa
    candidates.set(c.id, { activity, date, shift });
  }
  // 2) a mesma atividade nunca serve a dois treinos: fica com o treino cujo dia programado esta mais perto do dia da atividade (empate: o registrado primeiro, depois o id)
  const byActivity = new Map<string, Completion[]>();
  for (const c of completions) { const cand = candidates.get(c.id); if (cand) byActivity.set(cand.activity.id, [...(byActivity.get(cand.activity.id) ?? []), c]); }
  for (const group of byActivity.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => Math.abs(candidates.get(a.id)!.shift) - Math.abs(candidates.get(b.id)!.shift) || a.completedAt.getTime() - b.completedAt.getTime() || (a.id < b.id ? -1 : 1));
    for (const loser of ranked.slice(1)) { dropped.add(loser.id); notes.set(loser.id, 'atividade_ja_usada'); }
  }

  return completions.filter((c) => !isBlockedDeviceExtra(c)).map((c) => {
    const structure = structureOf(c);
    const programmed = programmedOf(c);
    const deviceExtra = isDeviceExtra(c);
    const cand = dropped.has(c.id) ? null : candidates.get(c.id) ?? null;
    const minutes = cand?.activity.durationSec != null && cand.activity.durationSec > 0 ? cand.activity.durationSec / 60 : null;
    return {
      id: c.id,
      sessionId: c.sessionId ?? null,
      activityLogId: cand?.activity.id ?? null,
      // Data REAL (a da atividade) quando existe; senao a PROGRAMADA (ou, sem sessao, o dia do registro) — marcada na tela. Nada e' inventado.
      date: cand ? cand.date : programmed,
      dateSource: deviceExtra || cand ? 'atividade_vinculada' : c.session?.scheduledDate ? 'programada' : 'registro',
      scheduledDate: c.session?.scheduledDate ? programmed : null,
      dateZoneAssumed: cand ? cand.activity.utcOffsetMinutes == null : false,
      modality: c.session?.modality ?? null,
      title: c.session?.title ?? null,
      status: c.status,
      durationMin: c.durationMin,
      durationOrigin: deviceExtra ? 'atividade_importada' : 'informada',
      activityDurationMin: minutes,
      activityProvider: cand?.activity.provider ?? (deviceExtra && typeof structure?.provider === 'string' ? structure.provider : null),
      activityNote: notes.get(c.id) ?? null,
      perceivedEffort: c.perceivedEffort,
      isExtra: (structure?.source === 'student' && structure?.type === 'extra') || deviceExtra, // mesma deteccao de sessao extra usada na evolucao (+ extras vindas do relogio)
    } satisfies LoadInputRow;
  });
}
