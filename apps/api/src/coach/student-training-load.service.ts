import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { parseDay, validatePeriod } from './health-recovery';
import { addDays, buildTrainingLoad, type LoadInputRow, type TrainingLoadResult } from './training-load';

// Painel do treinador > Aluno > Carga (própria) (23/10/2026). SOMENTE LEITURA: lê os registros de treino que a aluna já informou (esforço percebido e duração) e, para a DATA REAL e a duração
// que faltar, a atividade importada CONFIRMADA (vínculo 'active') para o treino. Devolve a carga com TODA a conta à vista (ver training-load.ts). Não grava nada e não alimenta o Atlas.
//
// Atividade importada só vale quando: (a) o vínculo com o treino está ativo; (b) é UMA atividade (vários eventos físicos distintos no mesmo treino = ambíguo, nada é usado); (c) vale a observação
// CANÔNICA do evento (a mesma regra do resto do sistema: um evento físico = uma observação, sem duplicar); (d) a mesma atividade nunca serve a dois treinos; (e) nunca Strava.
// Salvaguarda de vinculo: se o dia da atividade vinculada fica a mais de 6 dias do dia programado (o mesmo limite do vinculo manual da aluna), o vinculo e' tratado como suspeito e a atividade
// NAO e' usada (vale a data programada, com aviso na tela). Evita mover a carga por semanas por causa de um vinculo errado.
const LINK_MAX_SHIFT_DAYS = 6;
const COACH_HIDDEN_PROVIDERS = ['strava']; // dados do Strava nao sao exibidos ao treinador (Politica de Privacidade)

const spToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
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

// Dia LOCAL da atividade: instante UTC + o deslocamento informado pela fonte; sem deslocamento, o horario de Sao Paulo (nunca se presume outro fuso).
export function activityLocalDate(startedAt: Date, utcOffsetMinutes: number | null): string {
  return utcOffsetMinutes != null ? isoDay(new Date(startedAt.getTime() + utcOffsetMinutes * 60_000)) : spDay(startedAt);
}
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);

@Injectable()
export class StudentTrainingLoadService {
  constructor(private readonly prisma: PrismaService) {}

  async forStudent(studentId: string, query: { from?: string; to?: string }): Promise<TrainingLoadResult> {
    const exists = await this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Aluno nao encontrado.');
    const today = spToday();
    const parsed = (value: string | undefined, label: string) => {
      if (value === undefined || value === '') return null;
      const day = parseDay(value);
      if (!day) throw new BadRequestException(`Data inválida em ${label}. Use o formato AAAA-MM-DD.`);
      return day;
    };
    const requestedTo = parsed(query.to, 'data final') ?? today;
    const to = requestedTo > today ? today : requestedTo; // nao ha carga no futuro: o periodo termina, no maximo, hoje
    const from = parsed(query.from, 'data inicial') ?? addDays(to, -83); // 12 semanas por padrão
    const problem = validatePeriod(from, to);
    if (problem) throw new BadRequestException(problem);

    const completions = await this.prisma.workoutCompletion.findMany({
      where: { userId: studentId, status: { in: ['done', 'adjusted'] } },
      orderBy: { completedAt: 'asc' },
      select: { id: true, sessionId: true, source: true, completedAt: true, status: true, durationMin: true, perceivedEffort: true, session: { select: { scheduledDate: true, modality: true, title: true, structure: true } } },
    });
    const activityBySession = await this.linkedActivities(studentId, completions.map((c) => c.sessionId).filter((id): id is string => Boolean(id)));

    type Completion = (typeof completions)[number];
    const structureOf = (c: Completion) => (c.session?.structure ?? null) as { source?: unknown; type?: unknown; provider?: unknown } | null;
    // Sessao EXTRA materializada de uma atividade importada (source 'device_extra'): ela nasce da propria atividade — o dia e a duracao ja sao os da atividade.
    const isDeviceExtra = (c: Completion) => c.source === 'device_extra' || structureOf(c)?.source === 'device';
    const programmedOf = (c: Completion) => (c.session?.scheduledDate ? isoDay(c.session.scheduledDate) : spDay(c.completedAt));

    // 1) candidata de cada treino (atividade confirmada, canonica, unica, nunca Strava) e salvaguarda de vinculo distante
    const candidates = new Map<string, { activity: ActivityRow; date: string; shift: number }>();
    const notes = new Map<string, 'vinculo_distante' | 'atividade_ja_usada'>();
    const dropped = new Set<string>(); // treinos que perderam a atividade para outro (a mesma atividade nao serve a dois)
    for (const c of completions) {
      if (isDeviceExtra(c)) continue;
      const activity = c.sessionId ? activityBySession.get(c.sessionId) ?? null : null;
      if (!activity) continue;
      const date = activityLocalDate(activity.startedAt, activity.utcOffsetMinutes);
      const shift = c.session?.scheduledDate ? dayDiff(programmedOf(c), date) : 0;
      if (Math.abs(shift) > LINK_MAX_SHIFT_DAYS) { notes.set(c.id, 'vinculo_distante'); continue; }
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

    const rows: LoadInputRow[] = completions.map((c) => {
      const structure = structureOf(c);
      const programmed = programmedOf(c);
      const deviceExtra = isDeviceExtra(c);
      const cand = dropped.has(c.id) ? null : candidates.get(c.id) ?? null;
      const minutes = cand?.activity.durationSec != null && cand.activity.durationSec > 0 ? cand.activity.durationSec / 60 : null;
      return {
        id: c.id,
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
      };
    });
    return buildTrainingLoad(rows, { from, to }, today);
  }

  // sessionId -> observacao CANONICA da atividade confirmada. So' entra quando ha exatamente UM evento fisico confirmado para o treino (e nunca Strava).
  private async linkedActivities(userId: string, sessionIds: string[]): Promise<Map<string, ActivityRow>> {
    const result = new Map<string, ActivityRow>();
    if (sessionIds.length === 0) return result;
    const links = await this.prisma.sessionExecutionLink.findMany({
      where: { userId, status: 'active', trainingSessionId: { in: sessionIds } },
      select: { trainingSessionId: true, activityLog: { select: ACTIVITY_SELECT } },
    });
    const rows = links.map((l) => l.activityLog as ActivityRow);
    const picks = await pickCanonicalPerEvent(rows, (ids) => this.prisma.activityLog.findMany({ where: { userId, id: { in: ids } }, select: ACTIVITY_SELECT }) as Promise<ActivityRow[]>);
    const canonicalOf = new Map<string, ActivityRow>();
    for (const pick of picks) for (const member of pick.members) canonicalOf.set(member.id, pick.row);
    const bySession = new Map<string, Map<string, ActivityRow>>();
    for (const link of links) {
      const canonical = canonicalOf.get(link.activityLog.id);
      if (!canonical || COACH_HIDDEN_PROVIDERS.includes(canonical.provider)) continue;
      const events = bySession.get(link.trainingSessionId) ?? new Map<string, ActivityRow>();
      events.set(canonical.id, canonical);
      bySession.set(link.trainingSessionId, events);
    }
    for (const [sessionId, events] of bySession) if (events.size === 1) result.set(sessionId, [...events.values()][0]); // 2+ eventos distintos = ambiguo: nada e' usado
    return result;
  }
}
