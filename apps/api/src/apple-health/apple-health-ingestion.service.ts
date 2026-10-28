import { Optional } from '@nestjs/common';
import { DeviceRegistryService } from '../equipment/device-registry.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { normalizeRoutes } from '../health-connect/health-connect-route';
import { APPLE_HEALTH_CHANNEL, APPLE_HEALTH_PAYLOAD_SCHEMA, APPLE_HEALTH_PROVIDER, normalizeAppleHealthWorkout, NormalizedAppleWorkout } from './apple-health-normalizer';

export const MAX_WORKOUTS_PER_BATCH = 50;

export interface AppleHealthImportItemResult {
  uuid: string | null;
  status: 'created' | 'already_imported' | 'rejected';
  activityLogId?: string;
  reason?: string;
  // true quando o treino ja' existia e este envio COMPLETOU campos que estavam ausentes (ex.: frequencia cardiaca); nunca sobrescreve um valor existente.
  enriched?: boolean;
}

export interface AppleHealthImportResult {
  created: number;
  // Dos ja' importados, quantos receberam dados novos neste envio.
  enriched: number;
  alreadyImported: number;
  rejected: number;
  items: AppleHealthImportItemResult[];
}

// Ingestao de HKWorkout (Etapa 1, 06/10/2026): HKWorkout -> normalizer -> RawExternalActivity -> ActivityLog, o mesmo
// caminho canonico da Polar. O userId vem SEMPRE do JWT (nunca do corpo) e entra na chave unica
// (provider+userId+externalId), entao nada e' compartilhado entre usuarios.
//
// Fora do escopo: samples/serie temporal e notificacoes. A reconciliacao com a prescricao (3B) e' por PhysicalEvent: a observacao Apple so'
// carrega vinculo/classificacao quando e' a CANONICA do evento (sem gravador nativo do mesmo evento); caso contrario fica sem classificacao
// e a execucao e' contada uma vez, pela canonica.
@Injectable()
export class AppleHealthIngestionService {
  private readonly logger = new Logger(AppleHealthIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Opcional so' para testes que constroem o servico sem ele; em producao e' sempre injetado.
    private readonly physicalIdentity?: PhysicalActivityIdentityService,
    // 3B: reconciliacao por PhysicalEvent apos a identidade fisica resolvida. Opcional so' para testes que constroem o servico sem ele.
    private readonly sessionExecutionLink?: SessionExecutionLinkService,
    // Registro automatico de dispositivos (23/10/2026). Opcional so' para testes antigos; em producao e' sempre injetado.
    @Optional() private readonly deviceRegistry?: DeviceRegistryService,
  ) {}

  private async reconcileSafely(activityLogId: string): Promise<void> {
    try {
      await this.sessionExecutionLink?.reconcileEvent(activityLogId);
    } catch (error) {
      this.logger.warn(`Falha ao reconciliar evento fisico da atividade ${activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
        // Identidade fisica cross-provider (Etapa 2) e, DEPOIS dela, a reconciliacao do EVENTO com a prescricao (3B): so' a observacao
        // canonica do evento carrega vinculo/classificacao. Best-effort — nunca derruba a ingestao.
        if ((item.status === 'created' || item.enriched) && item.activityLogId) {
          this.deviceRegistry?.scheduleRefresh(userId); // identifica/atualiza o dispositivo desta aluna (proveniencia preservada, agrupado e nao bloqueante)
          const identity = await this.physicalIdentity?.evaluateSafely(item.activityLogId);
          await this.reconcileSafely(item.activityLogId);
          // D2: reconcilia as OUTRAS observacoes cuja identidade/canonica mudou nesta avaliacao (so' o que mudou).
          await this.sessionExecutionLink?.reconcileAffectedByIdentity(identity, item.activityLogId);
        }
      } catch (error) {
        // Falha de um treino nunca derruba o lote inteiro nem vaza detalhe interno ao cliente.
        this.logger.warn(`Falha ao importar treino HealthKit ${normalized.value.externalId}: ${error instanceof Error ? error.message : String(error)}`);
        items.push({ uuid: normalized.value.externalId, status: 'rejected', reason: 'falha_ao_gravar' });
      }
    }
    return {
      created: items.filter((i) => i.status === 'created').length,
      enriched: items.filter((i) => i.status === 'already_imported' && i.enriched).length,
      alreadyImported: items.filter((i) => i.status === 'already_imported').length,
      rejected: items.filter((i) => i.status === 'rejected').length,
      items,
    };
  }

  // Percurso (rota GPS) do HKWorkout, ligado ao treino JA importado (recordId = uuid do HKWorkout). A rota so' chega se a aluna a autorizou na folha do iOS; localizacao e' dado
  // sensivel e fica fora do escopo da IA (series de atividade nao entram no contexto). Refaz o percurso do treino do zero (idempotente).
  async importRoutes(userId: string, body: unknown): Promise<{ stored: number; rejected: number; items: Array<{ recordId: string; status: 'stored' | 'rejected'; reason?: string; points?: number }> }> {
    const normalized = normalizeRoutes(body);
    if (!normalized.ok) throw new BadRequestException(`Percurso invalido: ${normalized.reason}.`);
    const items: Array<{ recordId: string; status: 'stored' | 'rejected'; reason?: string; points?: number }> = [];
    for (const route of normalized.routes) {
      const externalId = route.recordId.toLowerCase();
      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          const log = await tx.activityLog.findUnique({ where: { provider_userId_externalId: { provider: APPLE_HEALTH_PROVIDER, userId, externalId } }, select: { id: true } });
          if (!log) return 'atividade_nao_encontrada';
          await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: log.id, provider: APPLE_HEALTH_PROVIDER, latitude: { not: null } } });
          await tx.activityTimeSeriesPoint.createMany({
            data: route.points.map((p) => ({ activityLogId: log.id, provider: APPLE_HEALTH_PROVIDER, offsetSec: p.offsetSec, normalizationVersion: 1, latitude: p.latitude, longitude: p.longitude, elevationMeters: p.elevationMeters })),
            skipDuplicates: true,
          });
          await tx.activityLog.update({ where: { id: log.id }, data: { hasRoute: true } });
          return 'stored';
        });
        items.push(outcome === 'stored' ? { recordId: externalId, status: 'stored', points: route.points.length } : { recordId: externalId, status: 'rejected', reason: outcome });
      } catch (error) {
        this.logger.warn(`Falha ao gravar percurso HealthKit: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
        items.push({ recordId: externalId, status: 'rejected', reason: 'falha_ao_gravar' });
      }
    }
    return { stored: items.filter((i) => i.status === 'stored').length, rejected: items.filter((i) => i.status === 'rejected').length + normalized.dropped, items };
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
      const existing = await tx.activityLog.findUnique({
        where: key,
        select: { id: true, distanceMeters: true, caloriesKcal: true, avgHeartRateBpm: true, maxHeartRateBpm: true, cadenceAvg: true, powerAvgWatts: true, elevationGainMeters: true, providerMetrics: true },
      });
      if (existing) {
        // Reenvio do mesmo HKWorkout (ex.: depois de o app passar a ler mais medidas): so' COMPLETA o que estava ausente. Valor ja' gravado nunca e' sobrescrito, e o payload bruto
        // original (RawExternalActivity) permanece intacto. Unica correcao de valor: distancia 0 m gravada antes de 28/10/2026 (ausencia registrada como zero) volta a ser ausente.
        const patch: Prisma.ActivityLogUpdateInput = {};
        const a = workout.activity;
        if (existing.caloriesKcal == null && a.caloriesKcal != null) patch.caloriesKcal = a.caloriesKcal;
        if (existing.avgHeartRateBpm == null && a.avgHeartRateBpm != null) patch.avgHeartRateBpm = a.avgHeartRateBpm;
        if (existing.maxHeartRateBpm == null && a.maxHeartRateBpm != null) patch.maxHeartRateBpm = a.maxHeartRateBpm;
        if (existing.cadenceAvg == null && a.cadenceAvg != null) patch.cadenceAvg = a.cadenceAvg;
        if (existing.powerAvgWatts == null && a.powerAvgWatts != null) patch.powerAvgWatts = a.powerAvgWatts;
        if (existing.elevationGainMeters == null && a.elevationGainMeters != null) patch.elevationGainMeters = a.elevationGainMeters;
        if (existing.distanceMeters === 0 && a.distanceMeters !== 0) patch.distanceMeters = a.distanceMeters;
        const currentMetrics = (existing.providerMetrics && typeof existing.providerMetrics === 'object' && !Array.isArray(existing.providerMetrics) ? existing.providerMetrics : {}) as Record<string, unknown>;
        const missingMetrics = Object.entries(workout.providerMetrics).filter(([name, value]) => value !== null && value !== undefined && !(name in currentMetrics) );
        if (missingMetrics.length > 0) patch.providerMetrics = { ...currentMetrics, ...Object.fromEntries(missingMetrics) } as Prisma.InputJsonObject;
        if (Object.keys(patch).length === 0) return { uuid: workout.externalId, status: 'already_imported' as const, activityLogId: existing.id };
        await tx.activityLog.update({ where: { id: existing.id }, data: patch });
        return { uuid: workout.externalId, status: 'already_imported' as const, activityLogId: existing.id, enriched: true };
      }

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
