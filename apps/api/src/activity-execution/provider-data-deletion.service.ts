import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Exclusao dos dados atribuiveis a UM provider de UM usuario (04/10/2026). Provider-agnostico: so'
// conhece o dominio canonico (RawExternalActivity / ActivityLog / samples / series / vinculos) e a
// coluna "provider" — nada de Polar/Garmin. Conectar/desconectar fica no adapter de cada provider;
// este servico e' o que o futuro Garmin reaproveita.
//
// Escopo = (userId, provider). Nao e' exclusao de conta e nao e' "desconectar": desconectar para a
// coleta futura e preserva historico; este servico apaga o historico ja' coletado.
//
// O que e' apagado (tudo dentro de uma unica transacao, idempotente — segunda chamada devolve zeros):
//   RawActivitySample, ActivityTimeSeriesPoint, SessionExecutionLink (das atividades do provider),
//   ActivityLog, RawExternalActivity, notificacoes de reconciliacao dessas atividades e as sessoes
//   sinteticas 'device_extra' (TrainingSession + WorkoutCompletion) que existiam SO' por causa da
//   atividade e nao receberam nada do aluno.
// O que NAO e' apagado: a sessao sintetica cujo feedback tem QUALQUER informacao propria do aluno
//   (RPE, dor, sono, notas, tenis...). Esse caso e' semanticamente ambiguo (os numeros copiados do
//   relogio e o relato do aluno convivem na mesma linha) e e' devolvido em "preservedMaterialized"
//   para decisao de produto — nenhuma regra e' inventada aqui.
// Prescricoes (TrainingSession de programa) nunca sao tocadas: perdem apenas o vinculo com a atividade.

// Colunas de WorkoutCompletion que uma sessao sintetica recebe do proprio relogio (ver
// SessionExecutionLinkService.materializeExtraActivity) + colunas de sistema. Qualquer OUTRA coluna
// preenchida significa dado do aluno. Lista por exclusao de proposito: coluna nova no futuro cai no
// lado seguro (preservar) em vez de ser apagada sem querer.
const DEVICE_OR_SYSTEM_COMPLETION_FIELDS = new Set([
  'id', 'userId', 'sessionId', 'completedAt', 'status', 'durationMin', 'distanceKm', 'avgPaceSecondsKm',
  'avgHeartRate', 'maxHeartRate', 'source', 'feedbackVersion', 'createdAt', 'updatedAt',
]);

export interface ProviderDataDeletionResult {
  provider: string;
  activities: number;
  rawActivities: number;
  samples: number;
  timeSeriesPoints: number;
  executionLinks: number;
  notifications: number;
  syntheticSessions: number;
  preservedMaterialized: Array<{ sessionId: string; reason: 'student_input' | 'not_done' | 'shoe_usage' }>;
}

export function completionHasStudentInput(completion: Record<string, unknown>): boolean {
  return Object.entries(completion).some(([key, value]) => {
    if (DEVICE_OR_SYSTEM_COMPLETION_FIELDS.has(key)) return false;
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

@Injectable()
export class ProviderDataDeletionService {
  constructor(private readonly prisma: PrismaService) {}

  async deleteProviderData(userId: string, provider: string): Promise<ProviderDataDeletionResult> {
    return this.prisma.$transaction(async (tx) => {
      const activities = await tx.activityLog.findMany({ where: { userId, provider }, select: { id: true } });
      const activityIds = activities.map((a) => a.id);
      const activityIdSet = new Set(activityIds);

      // Sessoes sinteticas materializadas a partir destas atividades (structure.activityLogId).
      const deviceExtras = activityIds.length === 0 ? [] : await tx.trainingSession.findMany({
        where: { userId, origin: 'device_extra' },
        include: { completion: { include: { shoeUsage: true } } },
      });
      const preservedMaterialized: ProviderDataDeletionResult['preservedMaterialized'] = [];
      const sessionsToDelete: string[] = [];
      const completionsToDelete: string[] = [];
      for (const session of deviceExtras) {
        const ref = (session.structure as { activityLogId?: string } | null)?.activityLogId;
        if (!ref || !activityIdSet.has(ref)) continue;
        const completion = session.completion;
        if (completion) {
          const { shoeUsage, ...fields } = completion as typeof completion & { shoeUsage: unknown };
          if (shoeUsage) { preservedMaterialized.push({ sessionId: session.id, reason: 'shoe_usage' }); continue; }
          if (completion.status !== 'done') { preservedMaterialized.push({ sessionId: session.id, reason: 'not_done' }); continue; }
          if (completionHasStudentInput(fields as Record<string, unknown>)) {
            preservedMaterialized.push({ sessionId: session.id, reason: 'student_input' });
            continue;
          }
          completionsToDelete.push(completion.id);
        }
        sessionsToDelete.push(session.id);
      }

      // Vinculos: o historico de substituicao aponta de uma linha para outra; solta as referencias
      // que apontam para linhas que serao apagadas antes de apagar (evita violar a FK).
      const links = activityIds.length === 0 ? [] : await tx.sessionExecutionLink.findMany({
        where: { activityLogId: { in: activityIds } }, select: { id: true },
      });
      const linkIds = links.map((l) => l.id);
      if (linkIds.length > 0) {
        await tx.sessionExecutionLink.updateMany({ where: { supersededByLinkId: { in: linkIds } }, data: { supersededByLinkId: null } });
        await tx.sessionExecutionLink.deleteMany({ where: { id: { in: linkIds } } });
      }

      if (completionsToDelete.length > 0) await tx.workoutCompletion.deleteMany({ where: { id: { in: completionsToDelete } } });
      if (sessionsToDelete.length > 0) await tx.trainingSession.deleteMany({ where: { id: { in: sessionsToDelete } } });

      const samples = activityIds.length === 0 ? { count: 0 } : await tx.rawActivitySample.deleteMany({ where: { activityLogId: { in: activityIds } } });
      const points = activityIds.length === 0 ? { count: 0 } : await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: { in: activityIds } } });

      // Notificacoes geradas pela reconciliacao (externalRef 'activity-reconciled:<activityLogId>:...').
      const candidates = activityIds.length === 0 ? [] : await tx.userNotification.findMany({
        where: { userId, externalRef: { startsWith: 'activity-reconciled:' } }, select: { id: true, externalRef: true },
      });
      const notificationIds = candidates
        .filter((n) => activityIdSet.has((n.externalRef ?? '').split(':')[1]))
        .map((n) => n.id);
      if (notificationIds.length > 0) await tx.userNotification.deleteMany({ where: { id: { in: notificationIds } } });

      const logs = await tx.activityLog.deleteMany({ where: { userId, provider } });
      const raws = await tx.rawExternalActivity.deleteMany({ where: { userId, provider } });

      const result: ProviderDataDeletionResult = {
        provider,
        activities: logs.count,
        rawActivities: raws.count,
        samples: samples.count,
        timeSeriesPoints: points.count,
        executionLinks: linkIds.length,
        notifications: notificationIds.length,
        syntheticSessions: sessionsToDelete.length,
        preservedMaterialized,
      };
      await tx.providerConnectionEvent.create({
        data: { userId, provider, type: 'data_deleted', details: result as unknown as Prisma.InputJsonValue },
      });
      return result;
    }, { timeout: 60_000, maxWait: 10_000 });
  }

  // Trilha de auditoria da desconexao (usada pelo adapter do provider).
  async recordDisconnection(userId: string, provider: string, details: Prisma.InputJsonValue) {
    await this.prisma.providerConnectionEvent.create({ data: { userId, provider, type: 'disconnected', details } });
  }
}
