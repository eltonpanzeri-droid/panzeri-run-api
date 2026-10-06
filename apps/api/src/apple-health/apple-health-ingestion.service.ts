import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { APPLE_HEALTH_CHANNEL, APPLE_HEALTH_PAYLOAD_SCHEMA, APPLE_HEALTH_PROVIDER, normalizeAppleHealthWorkout, NormalizedAppleWorkout } from './apple-health-normalizer';

export const MAX_WORKOUTS_PER_BATCH = 50;

export interface AppleHealthImportItemResult {
  uuid: string | null;
  status: 'created' | 'already_imported' | 'rejected';
  activityLogId?: string;
  reason?: string;
}

export interface AppleHealthImportResult {
  created: number;
  alreadyImported: number;
  rejected: number;
  items: AppleHealthImportItemResult[];
}

// Ingestao de HKWorkout (Etapa 1, 06/10/2026): HKWorkout -> normalizer -> RawExternalActivity -> ActivityLog, o mesmo
// caminho canonico da Polar. O userId vem SEMPRE do JWT (nunca do corpo) e entra na chave unica
// (provider+userId+externalId), entao nada e' compartilhado entre usuarios.
//
// Fora do escopo desta etapa (de proposito): deduplicacao cross-provider, Motor de Reconciliacao (classify), notificacoes,
// samples/serie temporal. ActivityLog nasce com executionClassification=null — os consumidores de Training Intelligence e
// evolucao so' leem 'corresponding'/'alternative', entao uma atividade Apple ainda nao classificada nao alimenta nada
// (e nao pode contar em dobro com a mesma corrida vinda de outro provider antes da Etapa 2).
@Injectable()
export class AppleHealthIngestionService {
  private readonly logger = new Logger(AppleHealthIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Opcional so' para testes que constroem o servico sem ele; em producao e' sempre injetado.
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
  ) {}

  async importWorkouts(userId: string, body: unknown): Promise<AppleHealthImportResult> {
    const workouts = (body as { workouts?: unknown } | null)?.workouts;
    if (!Array.isArray(workouts) || workouts.length === 0) throw new BadRequestException('Informe workouts (lista nao vazia).');
    if (workouts.length > MAX_WORKOUTS_PER_BATCH) throw new BadRequestException(`No maximo ${MAX_WORKOUTS_PER_BATCH} treinos por envio.`);

    const items: AppleHealthImportItemResult[] = [];
    for (const input of workouts) {
      const normalized = normalizeAppleHealthWorkout(input);
      if (!normalized.ok) {
        const uuid = typeof (input as { uuid?: unknown })?.uuid === 'string' ? (input as { uuid: string }).uuid : null;
        items.push({ uuid, status: 'rejected', reason: normalized.reason });
        continue;
      }
      try {
        const item = await this.persist(userId, normalized.value);
        items.push(item);
        // Identidade fisica cross-provider (Etapa 2): so' agrupa; nunca classifica nem reconcilia. Best-effort.
        if (item.status === 'created' && item.activityLogId) await this.physicalIdentity?.evaluateSafely(item.activityLogId);
      } catch (error) {
        // Falha de um treino nunca derruba o lote inteiro nem vaza detalhe interno ao cliente.
        this.logger.warn(`Falha ao importar treino HealthKit ${normalized.value.externalId}: ${error instanceof Error ? error.message : String(error)}`);
        items.push({ uuid: normalized.value.externalId, status: 'rejected', reason: 'falha_ao_gravar' });
      }
    }
    return {
      created: items.filter((i) => i.status === 'created').length,
      alreadyImported: items.filter((i) => i.status === 'already_imported').length,
      rejected: items.filter((i) => i.status === 'rejected').length,
      items,
    };
  }

  private async persist(userId: string, workout: NormalizedAppleWorkout): Promise<AppleHealthImportItemResult> {
    const key = { provider_userId_externalId: { provider: APPLE_HEALTH_PROVIDER, userId, externalId: workout.externalId } };
    try {
      return await this.write(userId, workout, key);
    } catch (error) {
      // Dois envios simultaneos do mesmo HKWorkout.uuid: o perdedor da corrida bate na chave unica; a segunda tentativa
      // enxerga o registro do vencedor e vira "already_imported" — nunca cria duplicata.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.write(userId, workout, key);
      throw error;
    }
  }

  private write(
    userId: string,
    workout: NormalizedAppleWorkout,
    key: { provider_userId_externalId: { provider: string; userId: string; externalId: string } },
  ): Promise<AppleHealthImportItemResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.activityLog.findUnique({ where: key, select: { id: true } });
      if (existing) return { uuid: workout.externalId, status: 'already_imported' as const, activityLogId: existing.id };

      const raw = await tx.rawExternalActivity.upsert({
        where: key,
        create: {
          userId,
          provider: APPLE_HEALTH_PROVIDER,
          externalId: workout.externalId,
          payload: workout.raw as Prisma.InputJsonObject,
          payloadSchemaVersion: APPLE_HEALTH_PAYLOAD_SCHEMA,
          ingestionMeta: { channel: APPLE_HEALTH_CHANNEL, receivedAt: new Date().toISOString() },
        },
        update: {},
      });
      const activityLog = await tx.activityLog.create({
        data: {
          userId,
          provider: APPLE_HEALTH_PROVIDER,
          externalId: workout.externalId,
          rawActivityId: raw.id,
          ...workout.activity,
          providerMetrics: workout.providerMetrics as Prisma.InputJsonObject,
        },
        select: { id: true },
      });
      return { uuid: workout.externalId, status: 'created' as const, activityLogId: activityLog.id };
    });
  }
}
