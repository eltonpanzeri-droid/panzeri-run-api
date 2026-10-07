import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutDeliveryService } from './workout-delivery.service';
import { appleWorkoutEligibility } from './apple-workout-eligibility';
import { AppleCustomWorkoutSpec, APPLE_TRANSLATOR_VERSION } from './apple-custom-workout-spec';

// Apple Watch via WorkoutKit — adaptador de entrega. Reutiliza o WorkoutDelivery existente (sem estrutura concorrente):
//   TrainingSession (prescricao) -> CanonicalWorkout -> AppleCustomWorkoutSpec (tradutor Apple) -> WorkoutDelivery (provider 'apple_workoutkit',
//   UMA entrega ativa por sessao) -> WorkoutPlan.id do WorkoutKit (UUID gerado AQUI, persistido em WorkoutDelivery.externalWorkoutId e
//   providerMetadata.workoutPlanId) -> Swift CustomWorkout -> agendamento Apple.
// Esse UUID e' a identidade que o HealthKit devolve depois em HKWorkout.workoutPlan.id (retorno futuro: relacionar a execucao a prescricao).
//
// O que a entrega GUARDA (sem migration, so' os campos JSON existentes):
//   - WorkoutDelivery.canonicalWorkout = o CanonicalWorkout efetivamente enviado (snapshot, nao referencia viva a TrainingSession.structure);
//   - WorkoutDelivery.providerMetadata = { channel, workoutKitType: 'CustomWorkout', workoutPlanId, scheduledDate, specHash, translatorVersion,
//     appleSpec (o spec enviado ao Swift), losses, canonicalWarningCodes, schedulingEvidence }.
// A identidade do CONTEUDO e' o specHash (so' o que e' enviado: ordem, distancias, repeticoes, work/recovery) + a data: mudar so' o pace (que nao e'
// enviado) NAO desatualiza a entrega; mudar um passo, uma distancia ou o repeatCount, sim.
//
// Estados (so' o que a evidencia permite afirmar): 'pending' = identidade reservada, nada agendado ainda; 'sent' = o app confirmou que o
// WorkoutKit ACEITOU o agendamento (o plano consta na lista de agendados do app); 'failed' = a chamada falhou. NUNCA 'delivered_to_device'
// (nao ha confirmacao de que o relogio recebeu) e nunca nada sobre execucao: nenhum PhysicalEvent/ActivityLog e' criado por aqui.
export const APPLE_WORKOUTKIT_PROVIDER = 'apple_workoutkit';
const ACTIVE_STATUSES = ['pending', 'sent', 'delivered_to_device'];

export interface AppleDeliveryView {
  id: string;
  status: string;
  planId: string;
  // A prescricao mudou depois que esta entrega foi criada (conteudo enviado ou data diferentes do snapshot).
  outdated: boolean;
}

export type AppleEligibilityResult =
  | { eligible: false; reason: string }
  | { eligible: true; distanceKm: number; scheduledDate: string; delivery: AppleDeliveryView | null };

export type ApplePrepareResult =
  | { eligible: false; reason: string }
  // spec = o AppleCustomWorkoutSpec da entrega (o snapshot enviado); null so' para entrega antiga (SingleGoalWorkout) sem spec gravado.
  | { eligible: true; distanceKm: number; scheduledDate: string; delivery: AppleDeliveryView; spec: AppleCustomWorkoutSpec | null };

interface AppleDeliveryMetadata {
  specHash?: string;
  scheduledDate?: string;
  appleSpec?: AppleCustomWorkoutSpec;
  [key: string]: unknown;
}

function todayInSaoPauloIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

@Injectable()
export class AppleWatchDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: WorkoutDeliveryService,
  ) {}

  async eligibility(userId: string, sessionId: string): Promise<AppleEligibilityResult> {
    const { result } = await this.evaluate(userId, sessionId);
    if (!result.eligible) return { eligible: false, reason: result.reason };
    const active = await this.activeDelivery(sessionId);
    return {
      eligible: true,
      distanceKm: result.distanceKm,
      scheduledDate: result.scheduledDate,
      delivery: active ? this.view(active, { specHash: result.spec.specHash, scheduledDate: result.scheduledDate }) : null,
    };
  }

  // Cria ou REUTILIZA a identidade persistente da entrega. Idempotente e serializada por sessao (advisory lock): dois toques simultaneos ou
  // fechar/reabrir o app devolvem a MESMA entrega e o MESMO planId.
  async prepare(userId: string, sessionId: string): Promise<ApplePrepareResult> {
    if (typeof (this.prisma as { $transaction?: unknown }).$transaction !== 'function') return this.prepareUnlocked(userId, sessionId);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'apple-workoutkit-delivery:' + sessionId}))`;
        const scoped = new AppleWatchDeliveryService(tx as unknown as PrismaService, new WorkoutDeliveryService(tx as unknown as PrismaService));
        return scoped.prepareUnlocked(userId, sessionId);
      },
      { timeout: 15_000 },
    );
  }

  private async prepareUnlocked(userId: string, sessionId: string): Promise<ApplePrepareResult> {
    const { result } = await this.evaluate(userId, sessionId);
    if (!result.eligible) return { eligible: false, reason: result.reason };
    const current = { specHash: result.spec.specHash, scheduledDate: result.scheduledDate };

    let active = await this.activeDelivery(sessionId);
    if (active && this.isOutdated(active, current) && active.status === 'pending') {
      // Reserva ainda nao agendada com snapshot defasado (ou de uma versao antiga do envio): retira e recria (nada foi enviado ao WorkoutKit).
      await this.deliveries.markCanceled(active.id);
      active = null;
    }
    if (!active) {
      const planId = randomUUID();
      const metadata: AppleDeliveryMetadata = {
        channel: 'workoutkit',
        workoutKitType: 'CustomWorkout',
        workoutPlanId: planId,
        scheduledDate: result.scheduledDate,
        specHash: result.spec.specHash,
        translatorVersion: APPLE_TRANSLATOR_VERSION,
        appleSpec: result.spec,
        losses: result.losses,
        canonicalWarningCodes: result.canonicalWarningCodes,
        schedulingEvidence: 'none',
      };
      active = await this.deliveries.recordAttempt({
        trainingSessionId: sessionId,
        provider: APPLE_WORKOUTKIT_PROVIDER,
        canonicalWorkout: result.canonicalWorkout as unknown as Prisma.InputJsonValue,
        externalWorkoutId: planId,
        providerMetadata: metadata as unknown as Prisma.InputJsonValue,
      });
    }
    const stored = ((active.providerMetadata as AppleDeliveryMetadata | null)?.appleSpec ?? null) as AppleCustomWorkoutSpec | null;
    return { eligible: true, distanceKm: result.distanceKm, scheduledDate: result.scheduledDate, delivery: this.view(active, current), spec: stored };
  }

  // O app chama DEPOIS de confirmar que o WorkoutKit aceitou o agendamento. 'sent' e' o maximo que isto prova.
  async confirmSent(userId: string, deliveryId: string): Promise<AppleDeliveryView> {
    const delivery = await this.ownedDelivery(userId, deliveryId);
    if (delivery.status === 'sent' || delivery.status === 'delivered_to_device') return this.view(delivery, null);
    if (delivery.status !== 'pending') throw new BadRequestException(`Entrega em estado ${delivery.status}; nao pode ser marcada como enviada.`);
    const updated = await this.deliveries.markSent(deliveryId, { externalWorkoutId: delivery.externalWorkoutId });
    await this.prisma.workoutDelivery.update({
      where: { id: deliveryId },
      data: { providerMetadata: { ...((delivery.providerMetadata as object | null) ?? {}), schedulingEvidence: 'listed_in_workoutkit_scheduled' } as unknown as Prisma.InputJsonValue },
    });
    return this.view(updated, null);
  }

  // Falha na validacao/agendamento do WorkoutKit: registra a falha com o erro nativo REAL (nunca como sucesso). Uma entrega ja 'sent' nao e' rebaixada.
  async reportFailure(userId: string, deliveryId: string, message: string): Promise<AppleDeliveryView> {
    const delivery = await this.ownedDelivery(userId, deliveryId);
    if (delivery.status !== 'pending') return this.view(delivery, null);
    const updated = await this.deliveries.markFailed(deliveryId, String(message ?? 'falha').slice(0, 500));
    return this.view(updated, null);
  }

  // ---- helpers ----
  private async evaluate(userId: string, sessionId: string) {
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, userId },
      include: { completion: { select: { status: true } } },
    });
    if (!session) throw new NotFoundException('Sessao de treino nao encontrada.');
    const result = appleWorkoutEligibility(
      {
        id: session.id,
        modality: session.modality,
        origin: session.origin ?? null,
        scheduledDate: session.scheduledDate,
        distanceKm: session.distanceKm ?? null,
        structure: session.structure,
        completionStatus: session.completion?.status ?? null,
      },
      todayInSaoPauloIso(),
    );
    return { session, result };
  }

  private async activeDelivery(sessionId: string) {
    const rows = await this.prisma.workoutDelivery.findMany({
      where: { trainingSessionId: sessionId, provider: APPLE_WORKOUTKIT_PROVIDER },
      orderBy: { requestedAt: 'desc' },
    });
    return rows.find((row) => ACTIVE_STATUSES.includes(row.status)) ?? null;
  }

  private async ownedDelivery(userId: string, deliveryId: string) {
    const delivery = await this.prisma.workoutDelivery.findUnique({ where: { id: deliveryId }, include: { trainingSession: { select: { userId: true } } } });
    if (!delivery || delivery.trainingSession.userId !== userId || delivery.provider !== APPLE_WORKOUTKIT_PROVIDER) {
      throw new NotFoundException('Entrega nao encontrada.');
    }
    return delivery;
  }

  // Identidade do conteudo: hash do spec enviado + data. Entrega sem specHash gravado (versao antiga do envio) conta como desatualizada.
  private isOutdated(delivery: { providerMetadata: unknown }, current: { specHash: string; scheduledDate: string } | null): boolean {
    if (!current) return false;
    const metadata = (delivery.providerMetadata ?? {}) as AppleDeliveryMetadata;
    return metadata.specHash !== current.specHash || metadata.scheduledDate !== current.scheduledDate;
  }

  private view(delivery: { id: string; status: string; externalWorkoutId: string | null; providerMetadata: unknown }, current: { specHash: string; scheduledDate: string } | null): AppleDeliveryView {
    return { id: delivery.id, status: delivery.status, planId: delivery.externalWorkoutId ?? '', outdated: this.isOutdated(delivery, current) };
  }
}
