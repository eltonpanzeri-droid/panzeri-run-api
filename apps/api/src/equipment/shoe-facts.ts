import { activityLocalDate as sharedActivityLocalDate } from '../common/local-date';
import { PrismaService } from '../prisma/prisma.service';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { modalityGroup } from '../coach/training-load';

// Equipamentos (23/10/2026) — FATOS de uso de tenis: uma linha por (tenis x corrida), lida em LOTE. Fonte unica para a tela do aluno e para a inteligencia do painel, para os dois nunca
// divergirem. Regras (todas de integridade, nenhuma prescreve nada):
//  - so' execucoes feitas ('done'/'adjusted') ASSOCIADAS pela aluna ao tenis (ShoeUsage); nunca se associa sozinho;
//  - modalidade conhecida e NAO-corrida (ex.: musculacao) fica de fora; modalidade desconhecida segue (o seletor de tenis so' aparece em formularios de corrida);
//  - distancia/tempo: observacao CANONICA da atividade confirmada (um evento fisico = uma observacao); sem atividade, o que a aluna digitou; ausente = null (nunca zero);
//  - o mesmo evento fisico nunca conta duas vezes (dedupe pelo id da observacao canonica);
//  - provedores ocultos (Strava) nao fornecem distancia/tempo quando `hideProviders` os lista: cai no valor digitado.

const VALID_COMPLETION_STATUSES = ['done', 'adjusted'];

const ACTIVITY_SELECT = {
  id: true, provider: true, startedAt: true, utcOffsetMinutes: true, durationSec: true, distanceMeters: true,
  physicalIdentityStatus: true, physicalEventId: true, physicalCanonicalActivityLogId: true,
} as const;
interface ActivityRow {
  id: string; provider: string; startedAt: Date; utcOffsetMinutes: number | null; durationSec: number | null; distanceMeters: number | null;
  physicalIdentityStatus: string | null; physicalEventId: string | null; physicalCanonicalActivityLogId: string | null;
}

export interface ShoeUsageFact {
  usageId: string;
  shoeId: string;
  userId: string;
  completionId: string;
  completedAt: Date;
  // Dia LOCAL da corrida (YYYY-MM-DD): o da atividade quando ha, senao o do registro (Sao Paulo).
  localDate: string;
  distanceKm: number | null;
  durationSec: number | null;
  activityId: string | null;
  provider: string | null;
}

const spDay = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export function activityLocalDay(startedAt: Date, utcOffsetMinutes: number | null): string {
  return sharedActivityLocalDate(startedAt, utcOffsetMinutes);
}

export interface ShoeFactsOptions {
  where: { userId?: string; shoeId?: string; shoeIds?: string[] };
  hideProviders?: string[];
}

export async function loadShoeUsageFacts(prisma: PrismaService, options: ShoeFactsOptions): Promise<ShoeUsageFact[]> {
  const { userId, shoeId, shoeIds } = options.where;
  const hidden = options.hideProviders ?? [];
  // Com aluno informado, le TODOS os usos dele e so' filtra por tenis no fim: o dedupe por evento fisico precisa enxergar todos os tenis do aluno, senao o mesmo treino
  // contaria no tenis A na lista e de novo no tenis B no detalhe.
  const filterShoes = userId ? new Set([...(shoeId ? [shoeId] : []), ...(shoeIds ?? [])]) : null;
  const usages = await prisma.shoeUsage.findMany({
    where: userId ? { userId } : { ...(shoeId ? { shoeId } : {}), ...(shoeIds ? { shoeId: { in: shoeIds } } : {}) },
    select: {
      id: true, shoeId: true, userId: true,
      workoutCompletion: { select: { id: true, sessionId: true, completedAt: true, distanceKm: true, durationMin: true, status: true, session: { select: { modality: true } } } },
    },
  });
  const valid = usages.filter((usage) => {
    const completion = usage.workoutCompletion;
    if (!completion || !VALID_COMPLETION_STATUSES.includes(completion.status)) return false;
    const modality = completion.session?.modality;
    return !modality || modalityGroup(modality) === 'corrida'; // musculacao e demais modalidades conhecidas nao entram na quilometragem de corrida
  });

  // vinculo ATIVO de cada sessao (o mais antigo primeiro, como o resto do app) -> observacao canonica do evento
  const sessionIds = [...new Set(valid.map((usage) => usage.workoutCompletion.sessionId).filter((id): id is string => Boolean(id)))];
  const linkBySession = new Map<string, ActivityRow>();
  if (sessionIds.length > 0) {
    const links = await prisma.sessionExecutionLink.findMany({
      where: { status: 'active', trainingSessionId: { in: sessionIds } },
      orderBy: { createdAt: 'asc' },
      select: { trainingSessionId: true, userId: true, activityLog: { select: ACTIVITY_SELECT } },
    });
    for (const link of links) if (!linkBySession.has(link.trainingSessionId)) linkBySession.set(link.trainingSessionId, link.activityLog as ActivityRow);
  }
  const canonicalOf = new Map<string, ActivityRow>();
  const linked = [...linkBySession.values()];
  if (linked.length > 0) {
    const picks = await pickCanonicalPerEvent(linked, (ids) => prisma.activityLog.findMany({ where: { id: { in: ids } }, select: ACTIVITY_SELECT }) as Promise<ActivityRow[]>);
    for (const pick of picks) for (const member of pick.members) canonicalOf.set(member.id, pick.row);
  }

  const ordered = [...valid].sort((a, b) => a.workoutCompletion.completedAt.getTime() - b.workoutCompletion.completedAt.getTime() || (a.id < b.id ? -1 : 1));
  const seenActivities = new Set<string>();
  const facts: ShoeUsageFact[] = [];
  for (const usage of ordered) {
    const completion = usage.workoutCompletion;
    const link = completion.sessionId ? linkBySession.get(completion.sessionId) ?? null : null;
    const canonical = link ? canonicalOf.get(link.id) ?? link : null;
    if (canonical) {
      if (seenActivities.has(canonical.id)) continue; // o mesmo evento fisico nunca soma duas vezes
      seenActivities.add(canonical.id);
    }
    const usable = canonical && !hidden.includes(canonical.provider) ? canonical : null;
    const typedDistance = completion.distanceKm != null && completion.distanceKm > 0 ? completion.distanceKm : null;
    const typedSeconds = completion.durationMin != null && completion.durationMin > 0 ? completion.durationMin * 60 : null;
    const activityKm = usable?.distanceMeters != null && usable.distanceMeters > 0 ? usable.distanceMeters / 1000 : null;
    facts.push({
      usageId: usage.id, shoeId: usage.shoeId, userId: usage.userId, completionId: completion.id, completedAt: completion.completedAt,
      localDate: usable ? activityLocalDay(usable.startedAt, usable.utcOffsetMinutes) : spDay(completion.completedAt),
      distanceKm: activityKm ?? typedDistance,
      durationSec: usable?.durationSec != null && usable.durationSec > 0 ? usable.durationSec : typedSeconds,
      activityId: canonical?.id ?? null,
      provider: usable?.provider ?? null,
    });
  }
  return filterShoes && filterShoes.size > 0 ? facts.filter((fact) => filterShoes.has(fact.shoeId)) : facts;
}
