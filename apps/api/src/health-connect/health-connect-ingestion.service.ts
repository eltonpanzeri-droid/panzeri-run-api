import { Optional } from '@nestjs/common';
import { DeviceRegistryService } from '../equipment/device-registry.service';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { HealthConnectConsentService } from './health-connect-consent.service';
import { HEALTH_CONNECT_CHANNEL, HEALTH_CONNECT_PAYLOAD_SCHEMA, HEALTH_CONNECT_PROVIDER, normalizeHealthConnectExercise, NormalizedHealthConnectExercise } from './health-connect-normalizer';

export const MAX_EXERCISES_PER_BATCH = 50;

export type HealthConnectItemStatus = 'created' | 'updated' | 'already_imported' | 'rejected';

export interface HealthConnectImportItemResult {
  recordId: string | null;
  status: HealthConnectItemStatus;
  activityLogId?: string;
  reason?: string;
}

export interface HealthConnectImportResult {
  created: number;
  updated: number;
  alreadyImported: number;
  rejected: number;
  items: HealthConnectImportItemResult[];
}

type ExistingLog = {
  id: string;
  startedAt: Date;
  utcOffsetMinutes: number | null;
  durationSec: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  sport: string | null;
  providerMetrics: Prisma.JsonValue | null;
};

// Ingestao de ExerciseSession do Health Connect (Android): app -> normalizer -> RawExternalActivity -> ActivityLog, o MESMO caminho canonico da Polar e
// do Apple Health. O userId vem SEMPRE do JWT (nunca do corpo) e entra na chave unica (provider+userId+externalId): nada e' compartilhado entre alunos.
// Nao ha logica propria de identidade, deduplicacao ou classificacao aqui: a identidade fisica, a escolha da canonica, a reconciliacao com as
// prescricoes e a confirmacao de ambiguidades sao os servicos existentes (PhysicalActivityIdentityService / SessionExecutionLinkService).
//
// Idempotencia e sincronizacao incremental: o app reenvia o que foi lido numa janela com sobreposicao; aqui o registro e'
//  - criado se novo;
//  - atualizado se a origem o MODIFICOU (lastModifiedTime mais novo ou valores diferentes) — a identidade e' reavaliada;
//  - ignorado se igual ou se a versao recebida e' MAIS ANTIGA que a ja' gravada (chegada fora de ordem).
// Nunca notifica o aluno: o primeiro sync traz historico de varios dias e geraria uma enxurrada de avisos (mesma regra do Apple Health).
@Injectable()
export class HealthConnectIngestionService {
  private readonly logger = new Logger(HealthConnectIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Opcionais so' para testes que constroem o servico sem eles; em producao sao sempre injetados.
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
    private readonly sessionExecutionLink?: SessionExecutionLinkService,
    // Autorizacoes do aluno (22/10/2026). Opcional so' para testes antigos; em producao e' sempre injetado e a ingestao e' fail-closed.
    private readonly consent?: HealthConnectConsentService,
    // Registro automatico de dispositivos (23/10/2026). Opcional so' para testes antigos; em producao e' sempre injetado.
    @Optional() private readonly deviceRegistry?: DeviceRegistryService,
  ) {}

  async importExercises(userId: string, body: unknown): Promise<HealthConnectImportResult> {
    const exercises = (body as { exercises?: unknown } | null)?.exercises;
    if (!Array.isArray(exercises) || exercises.length === 0) throw new BadRequestException('Informe exercises (lista nao vazia).');
    if (exercises.length > MAX_EXERCISES_PER_BATCH) throw new BadRequestException(`No maximo ${MAX_EXERCISES_PER_BATCH} registros por envio.`);

    // Sem a categoria "Exercicios" autorizada nada e' guardado. Sensores (FC, potencia, cadencia, elevacao) sao categoria propria: sem ela esses campos nao entram.
    let sensorsAllowed = true;
    if (this.consent) {
      const allowed = await this.consent.allowedCategories(userId);
      if (!allowed.has('activity')) throw new ForbiddenException('Autorizacao de exercicios ausente: o aluno ainda nao autorizou este compartilhamento.');
      sensorsAllowed = allowed.has('activity_sensors');
    }

    const items: HealthConnectImportItemResult[] = [];
    for (const rawInput of exercises) {
      const input = sensorsAllowed || !rawInput || typeof rawInput !== 'object'
        ? rawInput
        : { ...(rawInput as Record<string, unknown>), avgHeartRateBpm: null, maxHeartRateBpm: null, heartRateSampleCount: null, powerAvgWatts: null, powerMaxWatts: null, cadenceAvgPerMin: null, elevationGainMeters: null };
      // Retirada no meio do lote: a autorizacao de exercicios e' relida antes de cada registro (janela minima).
      if (this.consent && !(await this.consent.isAllowed(userId, 'activity'))) {
        items.push({ recordId: typeof (input as { recordId?: unknown })?.recordId === 'string' ? (input as { recordId: string }).recordId : null, status: 'rejected', reason: 'autorizacao_encerrada' });
        continue;
      }
      const normalized = normalizeHealthConnectExercise(input);
      if (!normalized.ok) {
        const recordId = typeof (input as { recordId?: unknown })?.recordId === 'string' ? (input as { recordId: string }).recordId : null;
        items.push({ recordId, status: 'rejected', reason: normalized.reason });
        continue;
      }
      try {
        const item = await this.persist(userId, normalized.value);
        items.push(item);
        if ((item.status === 'created' || item.status === 'updated') && item.activityLogId) await this.afterWrite(item.status, item.activityLogId, userId);
      } catch (error) {
        // Falha de um registro nunca derruba o lote inteiro nem vaza detalhe interno ao cliente.
        this.logger.warn(`Falha ao importar registro Health Connect ${normalized.value.externalId}: ${error instanceof Error ? error.message : String(error)}`);
        items.push({ recordId: normalized.value.externalId, status: 'rejected', reason: 'falha_ao_gravar' });
      }
    }
    return {
      created: items.filter((i) => i.status === 'created').length,
      updated: items.filter((i) => i.status === 'updated').length,
      alreadyImported: items.filter((i) => i.status === 'already_imported').length,
      rejected: items.filter((i) => i.status === 'rejected').length,
      items,
    };
  }

  // Identidade fisica cross-provider e, DEPOIS dela, a reconciliacao com a prescricao: so' a observacao canonica do evento carrega vinculo/classificacao.
  // Melhor esforco — nunca derruba a ingestao (o registro ja' esta gravado). Novo: classify (mesmo gatilho da Polar/Wahoo); alterado: reconcileEvent, que
  // recalcula os estados automaticos nao vinculados sem tocar em decisao humana. As OUTRAS observacoes afetadas pela mudanca de identidade (D2) tambem.
  private async afterWrite(status: 'created' | 'updated', activityLogId: string, userId: string): Promise<void> {
    this.deviceRegistry?.scheduleRefresh(userId); // identifica/atualiza o dispositivo desta aluna (proveniencia preservada, agrupado e nao bloqueante)
    const identity = await this.physicalIdentity?.evaluateSafely(activityLogId);
    try {
      if (status === 'created') await this.sessionExecutionLink?.classify(activityLogId);
      else await this.sessionExecutionLink?.reconcileEvent(activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao classificar atividade Health Connect ${activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.sessionExecutionLink?.reconcileAffectedByIdentity(identity, activityLogId);
  }

  private async persist(userId: string, exercise: NormalizedHealthConnectExercise): Promise<HealthConnectImportItemResult> {
    try {
      return await this.write(userId, exercise);
    } catch (error) {
      // Dois envios simultaneos do mesmo registro: o perdedor da corrida bate na chave unica; a segunda tentativa enxerga o registro do vencedor
      // e vira "ja' importado"/"atualizado" — nunca cria duplicata.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.write(userId, exercise);
      throw error;
    }
  }

  // Subconjunto da proveniencia cuja mudanca (app de origem, dispositivo, metodo de gravacao, tipo) conta como "mudou na origem".
  private provenanceOf(providerMetrics: unknown): string {
    const m = (providerMetrics ?? {}) as { source?: unknown; device?: unknown; recordingMethod?: unknown; exerciseType?: unknown };
    return JSON.stringify([m.source ?? null, m.device ?? null, m.recordingMethod ?? null, m.exerciseType ?? null]);
  }

  private write(userId: string, exercise: NormalizedHealthConnectExercise): Promise<HealthConnectImportItemResult> {
    const key = { provider_userId_externalId: { provider: HEALTH_CONNECT_PROVIDER, userId, externalId: exercise.externalId } };
    return this.prisma.$transaction(async (tx) => {
      const existing = (await tx.activityLog.findUnique({
        where: key,
        select: { id: true, startedAt: true, utcOffsetMinutes: true, durationSec: true, distanceMeters: true, avgHeartRateBpm: true, maxHeartRateBpm: true, sport: true, providerMetrics: true },
      })) as ExistingLog | null;
      const a = exercise.activity;
      const rawData = {
        payload: exercise.raw as Prisma.InputJsonObject,
        payloadSchemaVersion: HEALTH_CONNECT_PAYLOAD_SCHEMA,
        ingestionMeta: { channel: HEALTH_CONNECT_CHANNEL, receivedAt: new Date().toISOString() } as Prisma.InputJsonObject,
      };

      if (!existing) {
        const raw = await tx.rawExternalActivity.upsert({
          where: key,
          create: { userId, provider: HEALTH_CONNECT_PROVIDER, externalId: exercise.externalId, ...rawData },
          update: {},
        });
        const created = await tx.activityLog.create({
          data: { userId, provider: HEALTH_CONNECT_PROVIDER, externalId: exercise.externalId, rawActivityId: raw.id, ...a, providerMetrics: exercise.providerMetrics as Prisma.InputJsonObject },
          select: { id: true },
        });
        return { recordId: exercise.externalId, status: 'created' as const, activityLogId: created.id };
      }

      // Versao mais ANTIGA que a gravada (chegada fora de ordem): ignora, nunca regride o dado.
      const storedModifiedRaw = (existing.providerMetrics as { lastModifiedTime?: unknown } | null)?.lastModifiedTime;
      const storedModified = typeof storedModifiedRaw === 'string' ? new Date(storedModifiedRaw) : null;
      if (exercise.lastModifiedAt && storedModified && !Number.isNaN(storedModified.getTime()) && exercise.lastModifiedAt.getTime() < storedModified.getTime()) {
        return { recordId: exercise.externalId, status: 'already_imported' as const, activityLogId: existing.id };
      }
      const unchanged =
        existing.startedAt.getTime() === a.startedAt.getTime() &&
        existing.utcOffsetMinutes === a.utcOffsetMinutes &&
        existing.durationSec === a.durationSec &&
        existing.distanceMeters === a.distanceMeters &&
        existing.avgHeartRateBpm === a.avgHeartRateBpm &&
        existing.maxHeartRateBpm === a.maxHeartRateBpm &&
        existing.sport === a.sport &&
        this.provenanceOf(existing.providerMetrics) === this.provenanceOf(exercise.providerMetrics);
      if (unchanged) return { recordId: exercise.externalId, status: 'already_imported' as const, activityLogId: existing.id };

      // Modificado na origem: atualiza a observacao (e o bruto) no mesmo registro — nunca cria outro. A identidade e' reavaliada depois (afterWrite).
      await tx.rawExternalActivity.update({ where: key, data: rawData });
      await tx.activityLog.update({ where: { id: existing.id }, data: { ...a, providerMetrics: exercise.providerMetrics as Prisma.InputJsonObject } });
      return { recordId: exercise.externalId, status: 'updated' as const, activityLogId: existing.id };
    });
  }
}
