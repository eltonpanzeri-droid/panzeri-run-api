import { Optional } from '@nestjs/common';
import { DeviceRegistryService } from '../equipment/device-registry.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhysicalActivityIdentityService } from '../activity-execution/physical-activity-identity.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ForbiddenException } from '@nestjs/common';
import { normalizeRoutes } from '../health-connect/health-connect-route';
import { AppleHealthConsentService, type AppleConsentAccess } from './apple-health-consent.service';
import { APPLE_HEALTH_CHANNEL, APPLE_HEALTH_PAYLOAD_SCHEMA, APPLE_HEALTH_PROVIDER, normalizeAppleHealthWorkout, NormalizedAppleWorkout } from './apple-health-normalizer';

export const MAX_WORKOUTS_PER_BATCH = 50;

// Limites do envio de percurso (28/10/2026). O corpo JSON da API aceita ~100 KB por requisicao: o limite de bytes abaixo fica com folga (60 KB) e o app monta lotes por BYTES,
// reduzindo pontos de uma rota grande ate caber; a API nao teve o limite de corpo aumentado. Os valores sao devolvidos ao app em /apple-health/routes/pending.
export const APPLE_ROUTE_LIMITS = { maxRoutesPerRequest: 3, maxPointsPerRoute: 1200, maxRequestBytes: 60_000, maxPendingIds: 200 } as const;

export interface AppleHealthImportItemResult {
  uuid: string | null;
  status: 'created' | 'already_imported' | 'rejected';
  activityLogId?: string;
  reason?: string;
  // true quando o treino ja' existia e este envio COMPLETOU campos que estavam ausentes (ex.: frequencia cardiaca); nunca sobrescreve um valor existente.
  enriched?: boolean;
  // true quando o reenvio completou a DISTANCIA (insumo da identidade fisica): so' nesse caso a identidade e' reavaliada. Completar FC/calorias/etc. nao toca identidade nem classificacao.
  distanceCompleted?: boolean;
}

export type AppleRouteItemResult = { recordId: string; status: 'stored' | 'rejected'; reason?: string; points?: number };

export interface AppleHealthImportResult {
  // Como o servidor tratou o consentimento nesta chamada: 'legacy' = sem registro (aplicativo antigo, so' o basico), 'recorded' = vale o que foi autorizado. `sensors` = medidas de sensor aceitas.
  consent?: { mode: 'legacy' | 'recorded'; sensors: boolean };
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
    // Consentimento por categoria (28/10/2026). Opcional so' para testes antigos: sem ele a importacao se comporta como o modo 'legacy'.
    @Optional() private readonly consent?: AppleHealthConsentService,
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

    const access: AppleConsentAccess = this.consent ? await this.consent.access(userId) : { mode: 'legacy', allowed: new Set() };
    // Retirada registrada (ou texto desatualizado) bloqueia; com registro ativo e sem o grupo de treinos tambem.
    if (access.mode === 'blocked' || (access.mode === 'recorded' && !access.allowed.has('activity'))) throw new ForbiddenException('A importacao de treinos do Apple Saude nao esta autorizada. Revise suas autorizacoes.');
    // Medidas de sensor (FC, passos, potencia, biomecanica, elevacao) so' com o grupo autorizado e registrado; o aplicativo antigo nunca as envia.
    const sensors = access.mode === 'recorded' && access.allowed.has('activity_sensors');
    const items: AppleHealthImportItemResult[] = [];
    for (const input of workouts) {
      const normalized = normalizeAppleHealthWorkout(input, { sensors });
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
        if ((item.status === 'created' || item.distanceCompleted) && item.activityLogId) {
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
      consent: { mode: access.mode === 'recorded' ? 'recorded' : 'legacy', sensors },
      created: items.filter((i) => i.status === 'created').length,
      enriched: items.filter((i) => i.status === 'already_imported' && i.enriched).length,
      alreadyImported: items.filter((i) => i.status === 'already_imported').length,
      rejected: items.filter((i) => i.status === 'rejected').length,
      items,
    };
  }

  // Quais treinos JA importados ainda nao tem percurso (28/10/2026). Independe de o treino ter sido criado ou enriquecido agora: o app pergunta, le so' o que falta e envia. Devolve tambem os
  // limites que o app deve respeitar. Nao exige consentimento (so' identifica treinos da propria aluna, sem localizacao).
  async pendingRoutes(userId: string, body: unknown): Promise<{ pending: string[]; complete: string[]; notImported: string[]; limits: typeof APPLE_ROUTE_LIMITS }> {
    const ids = (body as { recordIds?: unknown } | null)?.recordIds;
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('Informe recordIds (lista nao vazia).');
    if (ids.length > APPLE_ROUTE_LIMITS.maxPendingIds) throw new BadRequestException(`No maximo ${APPLE_ROUTE_LIMITS.maxPendingIds} treinos por consulta.`);
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim().toLowerCase().slice(0, 64)))];
    const rows = await this.prisma.activityLog.findMany({ where: { userId, provider: APPLE_HEALTH_PROVIDER, externalId: { in: wanted } }, select: { externalId: true, hasRoute: true } });
    const known = new Map(rows.map((row) => [row.externalId as string, row.hasRoute === true]));
    return {
      pending: wanted.filter((id) => known.get(id) === false),
      complete: wanted.filter((id) => known.get(id) === true),
      notImported: wanted.filter((id) => !known.has(id)),
      limits: APPLE_ROUTE_LIMITS,
    };
  }

  // Percurso (rota GPS) do HKWorkout, ligado ao treino JA importado (recordId = uuid do HKWorkout). Localizacao e' dado sensivel: exige consentimento REGISTRADO no servidor para
  // 'activity_route' (e 'activity'), checado DENTRO da transacao que grava (retirada concorrente espera). A autorizacao do iOS NAO substitui esse registro. A altitude so' e' guardada
  // com 'activity_sensors'. Refaz o percurso do treino do zero (idempotente). Percurso nao entra no escopo da IA.
  async importRoutes(userId: string, body: unknown): Promise<{ stored: number; rejected: number; items: AppleRouteItemResult[] }> {
    const normalized = normalizeRoutes(body, { maxRoutes: APPLE_ROUTE_LIMITS.maxRoutesPerRequest, maxPoints: APPLE_ROUTE_LIMITS.maxPointsPerRoute });
    if (!normalized.ok) throw new BadRequestException(`Percurso invalido: ${normalized.reason}.`);
    const access: AppleConsentAccess = this.consent ? await this.consent.access(userId) : { mode: 'legacy', allowed: new Set() };
    if (access.mode !== 'recorded' || !access.allowed.has('activity_route') || !access.allowed.has('activity')) throw new ForbiddenException('Autorizacao do percurso GPS ausente para este aluno.');
    const items: AppleRouteItemResult[] = [];
    for (const route of normalized.routes) {
      const externalId = route.recordId.toLowerCase();
      try {
        const outcome = await this.consent!.writeWhileAuthorized(userId, async (tx, granted) => {
          if (granted.mode !== 'recorded' || !granted.allowed.has('activity_route') || !granted.allowed.has('activity')) return 'categoria_nao_autorizada';
          const log = await tx.activityLog.findUnique({ where: { provider_userId_externalId: { provider: APPLE_HEALTH_PROVIDER, userId, externalId } }, select: { id: true } });
          if (!log) return 'atividade_nao_encontrada';
          const withAltitude = granted.allowed.has('activity_sensors');
          await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: log.id, provider: APPLE_HEALTH_PROVIDER, latitude: { not: null } } });
          await tx.activityTimeSeriesPoint.createMany({
            data: route.points.map((p) => ({ activityLogId: log.id, provider: APPLE_HEALTH_PROVIDER, offsetSec: p.offsetSec, normalizationVersion: 1, latitude: p.latitude, longitude: p.longitude, elevationMeters: withAltitude ? p.elevationMeters : null })),
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
        // Reenvio do mesmo HKWorkout (ex.: depois de o app passar a ler mais medidas): so' COMPLETA o que estava ausente. Valor ja' gravado nunca e' sobrescrito, o payload bruto
        // original (RawExternalActivity) permanece intacto e a identidade/classificacao da atividade nao e' tocada por esta logica.
        const patch: Prisma.ActivityLogUpdateInput = {};
        const a = workout.activity;
        if (existing.caloriesKcal == null && a.caloriesKcal != null) patch.caloriesKcal = a.caloriesKcal;
        if (existing.avgHeartRateBpm == null && a.avgHeartRateBpm != null) patch.avgHeartRateBpm = a.avgHeartRateBpm;
        if (existing.maxHeartRateBpm == null && a.maxHeartRateBpm != null) patch.maxHeartRateBpm = a.maxHeartRateBpm;
        if (existing.cadenceAvg == null && a.cadenceAvg != null) patch.cadenceAvg = a.cadenceAvg;
        if (existing.powerAvgWatts == null && a.powerAvgWatts != null) patch.powerAvgWatts = a.powerAvgWatts;
        if (existing.elevationGainMeters == null && a.elevationGainMeters != null) patch.elevationGainMeters = a.elevationGainMeters;
        // Distancia: so' preenche a que esta AUSENTE (null) com um valor valido (> 0). Um 0 ja' gravado e' informacao da origem e NAO e' substituido nem apagado (sem correcao retroativa).
        if (existing.distanceMeters == null && a.distanceMeters != null && a.distanceMeters > 0) patch.distanceMeters = a.distanceMeters;
        const currentMetrics = (existing.providerMetrics && typeof existing.providerMetrics === 'object' && !Array.isArray(existing.providerMetrics) ? existing.providerMetrics : {}) as Record<string, unknown>;
        // providerMetrics: completa chave ausente OU com valor null quando o envio traz um valor; valor ja' preenchido nunca e' trocado.
        const missingMetrics = Object.entries(workout.providerMetrics).filter(([name, value]) => value !== null && value !== undefined && (currentMetrics[name] === undefined || currentMetrics[name] === null));
        if (missingMetrics.length > 0) patch.providerMetrics = { ...currentMetrics, ...Object.fromEntries(missingMetrics) } as Prisma.InputJsonObject;
        if (Object.keys(patch).length === 0) return { uuid: workout.externalId, status: 'already_imported' as const, activityLogId: existing.id };
        await tx.activityLog.update({ where: { id: existing.id }, data: patch });
        return { uuid: workout.externalId, status: 'already_imported' as const, activityLogId: existing.id, enriched: true, distanceCompleted: patch.distanceMeters !== undefined };
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
