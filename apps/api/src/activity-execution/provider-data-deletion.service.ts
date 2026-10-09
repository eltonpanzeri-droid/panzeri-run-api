import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TombstoneLedger } from '../backup/tombstone-ledger';
import { AgentInputRedaction, EvidenceItem, executionActionsFor, invalidateDeclaredForProvider, isProviderDerivedVariable, packageMayContainProvider, redactAgentInputForProvider, redactEvidenceForProvider } from '../training-plans/prescription-trace';

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
// Sessao sintetica ENRIQUECIDA pelo aluno (RPE, dor, sono, notas, tenis, valor editado por ele...) —
//   decisao de produto de 04/10/2026: a sessao e o feedback PERMANECEM (pertencem ao historico do
//   aluno), mas tudo que tem o provider como proveniencia exclusiva e' removido:
//     * WorkoutCompletion: distanceKm, durationMin, avgHeartRate, maxHeartRate sao anulados quando
//       ainda sao a copia do que a atividade tinha (comparacao com a propria ActivityLog antes de
//       apaga-la); avgPaceSecondsKm so' quando e' derivado dessas copias; completedAt volta ao dia da
//       sessao (a hora exata veio do relogio). Valor que o aluno editou nao bate com a copia e fica.
//     * TrainingSession: title, structure (activityLogId/provider/source) e origin deixam de apontar
//       para a atividade; passa a ser um treino extra registrado pelo aluno (origin 'student_extra').
//   Nada e' substituido por zero ou valor inventado: ausencia continua null.
// Prescricoes (TrainingSession de programa) nunca sao tocadas: perdem apenas o vinculo com a atividade.

// Colunas de WorkoutCompletion que uma sessao sintetica recebe do proprio relogio (ver
// SessionExecutionLinkService.materializeExtraActivity) + colunas de sistema. Qualquer OUTRA coluna
// preenchida significa dado do aluno. Lista por exclusao de proposito: coluna nova no futuro cai no
// lado seguro (preservar) em vez de ser apagada sem querer.
const SYSTEM_OR_DEVICE_COMPLETION_FIELDS = new Set([
  'id', 'userId', 'sessionId', 'completedAt', 'status', 'durationMin', 'distanceKm', 'avgPaceSecondsKm',
  'avgHeartRate', 'maxHeartRate', 'source', 'feedbackVersion', 'createdAt', 'updatedAt', 'shoeUsage',
]);

// Tolerancias de ARREDONDAMENTO (nao de decisao) para reconhecer que o valor do feedback ainda e' a
// copia do que o relogio mediu: o formulario do aluno trabalha em metros (0,001 km) e segundos.
const DISTANCE_COPY_TOLERANCE_KM = 0.005;
const DURATION_COPY_TOLERANCE_MIN = 0.02;

export interface ProviderDataDeletionResult {
  provider: string;
  activities: number;
  rawActivities: number;
  samples: number;
  timeSeriesPoints: number;
  executionLinks: number;
  notifications: number;
  syntheticSessions: number;
  // Sessoes sinteticas mantidas porque o aluno as enriqueceu; "clearedFields" lista (so' os nomes) o que
  // foi removido de proveniencia do provider.
  preservedMaterialized: Array<{ sessionId: string; reason: 'student_input' | 'not_done' | 'shoe_usage'; clearedFields: string[] }>;
  // Etapa 1.2a (rastreabilidade das prescricoes): itens de evidencia derivados de atividades deste provedor (diretos E agregados), com valores,
  // datas e referencias removidos, e pacotes cujo texto enviado a IA (agentInput) teve os agregados do provedor removidos. Fontes de outros
  // provedores e o restante do contexto (relatos, diretrizes, entrevista...) permanecem. Cada pacote afetado ganha um marcador auditavel.
  evidenceRedacted?: number;
  agentInputsRedacted?: number;
  // Etapa 1.2b: decisoes cujo raciocinio declarado pela IA (objetivo, esperado, fundamentos) se apoiava em evidencia derivada do provedor; os textos saem.
  declaredReasoningInvalidated?: number;
}

interface ActivityCopySource {
  startedAt: Date;
  distanceMeters: number | null;
  durationSec: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
}

// Ids das variaveis longitudinais do indice que derivam do provedor (ainda nao redigidas). Item sem lista de provedores = proveniencia desconhecida.
function providerVariableIds(evidence: unknown, provider: string): Set<string> {
  const ids = new Set<string>();
  for (const entry of Array.isArray(evidence) ? (evidence as EvidenceItem[]) : []) {
    if (!entry || entry.redacted || typeof entry.ref !== 'string' || !entry.ref.startsWith('variable:')) continue;
    const id = entry.ref.slice('variable:'.length);
    if (!isProviderDerivedVariable(id)) continue;
    if (entry.providers === undefined || entry.providers.includes(provider) || entry.providers.includes('?')) ids.add(id);
  }
  return ids;
}

const near = (a: number | null | undefined, b: number | null | undefined, tolerance: number) =>
  a != null && b != null && Math.abs(a - b) <= tolerance;

// Separa, num feedback de sessao sintetica, o que ainda e' copia do relogio (a anular) do que e' do aluno
// (a manter). Exportada para teste.
export function classifyMaterializedCompletion(completion: Record<string, any>, activity: ActivityCopySource) {
  const clear: Record<string, null> = {};
  let studentInput = false;

  const distanceCopy = completion.distanceKm != null && near(completion.distanceKm, activity.distanceMeters == null ? null : activity.distanceMeters / 1000, DISTANCE_COPY_TOLERANCE_KM);
  const durationCopy = completion.durationMin != null && near(completion.durationMin, activity.durationSec == null ? null : activity.durationSec / 60, DURATION_COPY_TOLERANCE_MIN);
  const avgHrCopy = completion.avgHeartRate != null && completion.avgHeartRate === activity.avgHeartRateBpm;
  const maxHrCopy = completion.maxHeartRate != null && completion.maxHeartRate === activity.maxHeartRateBpm;
  const metric = (field: string, isCopy: boolean) => {
    if (completion[field] == null) return;
    if (isCopy) clear[field] = null; else studentInput = true;
  };
  metric('distanceKm', distanceCopy);
  metric('durationMin', durationCopy);
  metric('avgHeartRate', avgHrCopy);
  metric('maxHeartRate', maxHrCopy);
  // Ritmo medio: derivado de distancia e tempo; so' e' do relogio se ambos eram copias.
  if (completion.avgPaceSecondsKm != null) {
    if (distanceCopy && durationCopy) clear.avgPaceSecondsKm = null; else studentInput = true;
  }

  for (const [key, value] of Object.entries(completion)) {
    if (SYSTEM_OR_DEVICE_COMPLETION_FIELDS.has(key) || value == null) continue;
    if (Array.isArray(value) ? value.length > 0 : true) studentInput = true;
  }
  if (completion.status !== 'done') studentInput = true;
  return { clear, studentInput };
}

@Injectable()
export class ProviderDataDeletionService {
  private readonly logger = new Logger(ProviderDataDeletionService.name);

  // ledger: ausente so' na CLI de restauracao, que chama executeProviderDataDeletion (reaplicacao) sem gravar tombstone.
  constructor(private readonly prisma: PrismaService, private readonly ledger?: TombstoneLedger) {}

  // Fluxo de producao (05/10/2026): tombstone externo CONFIRMADO -> exclusao local. Se o R2 nao confirmar, o
  // ledger lanca 503 e NADA e' apagado. Se a exclusao local falhar depois, o tombstone fica (seguro para
  // restauracao), o evento e' auditado e um alerta e' enviado.
  async deleteProviderData(userId: string, provider: string): Promise<ProviderDataDeletionResult> {
    if (!this.ledger) throw new InternalServerErrorException('Exclusao indisponivel: ledger de tombstones nao configurado.');
    await this.ledger.record({ type: 'provider_data_deleted', userId, provider });
    try {
      return await this.executeProviderDataDeletion(userId, provider);
    } catch (error) {
      this.logger.error(`Exclusao de dados do provider falhou apos o tombstone (${provider}): ${(error as Error).message?.slice(0, 200)}`);
      await this.prisma.providerConnectionEvent.create({
        data: { userId, provider, type: 'data_deletion_failed', details: { tombstoneKept: true } },
      }).catch(() => undefined);
      await this.ledger.alert(`ALERTA: a exclusao de dados do provider ${provider} falhou DEPOIS de gravar o tombstone (o tombstone foi mantido). Usuario interno: ${userId}. Reexecutar a exclusao.`);
      throw new InternalServerErrorException('A exclusao nao foi concluida. O registro de seguranca foi mantido; tente novamente.');
    }
  }

  // A exclusao propriamente dita (idempotente). Tambem usada pela restauracao para reaplicar tombstones.
  async executeProviderDataDeletion(userId: string, provider: string): Promise<ProviderDataDeletionResult> {
    return this.prisma.$transaction(async (tx) => {
      const activities = await tx.activityLog.findMany({
        where: { userId, provider },
        select: { id: true, startedAt: true, distanceMeters: true, durationSec: true, avgHeartRateBpm: true, maxHeartRateBpm: true },
      });
      const activityIds = activities.map((a) => a.id);
      const activityById = new Map(activities.map((a) => [a.id, a]));
      const activityIdSet = new Set(activityIds);

      // Sessoes sinteticas materializadas a partir destas atividades (structure.activityLogId).
      const deviceExtras = activityIds.length === 0 ? [] : await tx.trainingSession.findMany({
        where: { userId, origin: 'device_extra' },
        include: { completion: { include: { shoeUsage: true } } },
      });
      const preservedMaterialized: ProviderDataDeletionResult['preservedMaterialized'] = [];
      const sessionsToDelete: string[] = [];
      const completionsToDelete: string[] = [];
      const sessionsToSanitize: Array<{ sessionId: string; modality: string; completionId: string | null; clear: Record<string, null>; completedAtReset: Date | null }> = [];
      for (const session of deviceExtras) {
        const ref = (session.structure as { activityLogId?: string } | null)?.activityLogId;
        if (!ref || !activityIdSet.has(ref)) continue;
        const completion = session.completion;
        if (completion) {
          const { shoeUsage, ...fields } = completion as typeof completion & { shoeUsage: unknown };
          const { clear, studentInput } = classifyMaterializedCompletion(fields as Record<string, any>, activityById.get(ref)!);
          const reason = shoeUsage ? 'shoe_usage' : completion.status !== 'done' ? 'not_done' : studentInput ? 'student_input' : null;
          if (reason) {
            // Hora exata de inicio veio do relogio: volta ao dia da sessao (mesma data, sem a hora medida).
            const resetCompletedAt = completion.completedAt.getTime() === activityById.get(ref)!.startedAt.getTime() ? session.scheduledDate : null;
            sessionsToSanitize.push({ sessionId: session.id, modality: session.modality, completionId: completion.id, clear, completedAtReset: resetCompletedAt });
            preservedMaterialized.push({ sessionId: session.id, reason, clearedFields: [...Object.keys(clear), ...(resetCompletedAt ? ['completedAt(hora)'] : [])] });
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

      // Sessoes enriquecidas pelo aluno: ficam, sem nenhuma referencia nem valor do provider.
      for (const item of sessionsToSanitize) {
        if (item.completionId) {
          await tx.workoutCompletion.update({
            where: { id: item.completionId },
            data: { ...item.clear, ...(item.completedAtReset ? { completedAt: item.completedAtReset } : {}), source: 'manual' },
          });
        }
        await tx.trainingSession.update({
          where: { id: item.sessionId },
          data: { title: `${item.modality} (extra)`, structure: { type: 'extra', source: 'student' }, origin: 'student_extra' },
        });
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

      // So' na exclusao EXPLICITA de dados (nunca na desconexao, que nao passa por aqui): remove, nos pacotes de rastreabilidade, tudo que deriva
      // das atividades deste provedor — itens do indice de evidencias E os agregados dentro do texto enviado a IA (agentInput). Registros e decisoes
      // permanecem; um marcador auditavel (sem o conteudo removido) fica no pacote. Pacotes sem proveniencia registrada sao tratados como "podem conter".
      let evidenceRedacted = 0;
      let agentInputsRedacted = 0;
      const packages = await tx.prescriptionEvidencePackage?.findMany({
        where: { userId }, select: { id: true, schemaVersion: true, evidence: true, agentInput: true, sourceProviders: true, agentInputRedactions: true },
      }) ?? [];
      for (const pkg of packages) {
        // Pacote de versao < 2 nao registra a derivacao dos valores de execucao (historico semanal, recorde, narrativas): proveniencia desconhecida.
        const legacy = pkg.schemaVersion < 2 || !Array.isArray(pkg.sourceProviders);
        if (!legacy && !packageMayContainProvider(pkg.sourceProviders, provider, pkg.evidence)) continue;
        const { evidence, redacted } = redactEvidenceForProvider(pkg.evidence, provider, { assumeAll: legacy });
        // Variaveis a remover do texto guardado: as que o INDICE do pacote liga ao provedor (providers inclui o provedor ou o desconhecido '?') e as de
        // proveniencia nao registrada. Pacote sem proveniencia (anterior ao campo) => todas as derivaveis de dispositivo (null).
        const variableIds = Array.isArray(pkg.sourceProviders) ? providerVariableIds(pkg.evidence, provider) : null;
        const input = pkg.agentInput === null ? { agentInput: null, redaction: null } : redactAgentInputForProvider(pkg.agentInput, provider, new Date(), variableIds, legacy ? 'all' : executionActionsFor(pkg.evidence, provider));
        if (redacted === 0 && input.redaction === null) continue;
        const marker: AgentInputRedaction & { evidenceItemsRedacted: number; agentInputAlreadyPurged: boolean } = {
          ...(input.redaction ?? { provider, at: new Date().toISOString(), reason: 'provider_data_deleted' as const, removedVariableIds: [], removedExecutionFields: [], callsChanged: 0, callsUnparseableRemoved: 0 }),
          evidenceItemsRedacted: redacted,
          agentInputAlreadyPurged: pkg.agentInput === null,
        };
        const previousMarkers = Array.isArray(pkg.agentInputRedactions) ? pkg.agentInputRedactions : [];
        await tx.prescriptionEvidencePackage.update({
          where: { id: pkg.id },
          data: {
            evidence: evidence as unknown as Prisma.InputJsonValue,
            ...(input.redaction ? { agentInput: input.agentInput as Prisma.InputJsonValue } : {}),
            agentInputRedactions: [...previousMarkers, marker] as unknown as Prisma.InputJsonValue,
          },
        });
        evidenceRedacted += redacted;
        if (input.redaction) agentInputsRedacted++;
      }

      // Raciocinio declarado pela IA (1.2b) que se apoiou em evidencia derivada deste provedor: o texto (que pode citar os valores) sai; fica o marcador.
      let declaredReasoningInvalidated = 0;
      const declaredDecisions = await tx.prescriptionDecision?.findMany({ where: { userId, NOT: { basis: { equals: Prisma.DbNull } } }, select: { id: true, basis: true } }) ?? [];
      for (const decision of declaredDecisions) {
        const outcome = invalidateDeclaredForProvider(decision.basis, provider);
        if (!outcome.changed) continue;
        await tx.prescriptionDecision.update({
          where: { id: decision.id },
          data: { basis: outcome.basis as unknown as Prisma.InputJsonValue, intent: null, expected: Prisma.DbNull, traceStatus: 'partial' },
        });
        declaredReasoningInvalidated++;
      }

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
        evidenceRedacted,
        agentInputsRedacted,
        declaredReasoningInvalidated,
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
