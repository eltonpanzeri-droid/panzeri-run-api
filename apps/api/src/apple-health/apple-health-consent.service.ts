import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { consentTextHash, isConnectionConsentCurrent } from '../provider-hub/provider-consent.service';
import { APPLE_HEALTH_CONSENT, APPLE_HEALTH_PROVIDER_ID } from './apple-health-consent';
import { APPLE_HEALTH_RECORD_CATEGORIES, metricKindsOfCategory } from './apple-health-records';

// Autorizacoes do aluno para o Apple Saude (28/10/2026). Mesmo modelo do HealthConnectConsentService (ver la' o raciocinio): o servidor guarda SO' o consentimento por categoria, na linha
// ProviderConnection (provider 'apple_health', sem credenciais), e a ingestao respeita esse registro. A permissao do iOS (HealthKit, no aparelho) NAO e' este consentimento.
//
// Compatibilidade com o aplicativo ja' publicado: SEM registro (nunca houve conexao), a importacao basica de treinos segue aceita (`mode: 'legacy'`); com registro ativo e texto vigente vale
// o que foi autorizado (`mode: 'recorded'`); com registro retirado ou texto desatualizado nada novo e' aceito (`mode: 'blocked'`) — retirar vale na hora.
const INVALIDATING_CATEGORIES: readonly string[] = ['activity', 'activity_sensors', 'activity_route', ...APPLE_HEALTH_RECORD_CATEGORIES];

type Row = { disconnectedAt: Date | null; grantedCategories: unknown; grantedPurposes: unknown; purposeConsents: unknown; consentVersion: string; consentTextHash: string | null; consentedAt: Date };

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : []);

export type AppleConsentAccess = { mode: 'legacy' | 'recorded' | 'blocked'; allowed: Set<string> };

// Chaves de medidas de sensor guardadas em providerMetrics / payload bruto: saem quando o grupo e' retirado.
export const APPLE_SENSOR_KEYS = ['avgHeartRateBpm', 'maxHeartRateBpm', 'heartRateBasis', 'stepCount', 'cadenceBasis', 'powerAvgWatts', 'elevationGainMeters', 'avgStrideLengthMeters', 'avgGroundContactTimeMs', 'avgVerticalOscillationCm'] as const;

@Injectable()
export class AppleHealthConsentService {
  private readonly logger = new Logger(AppleHealthConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Opcional so' para testes; em producao e' sempre injetado.
    @Optional() private readonly providerData?: ProviderDataDeletionService,
  ) {}

  private load(userId: string): Promise<Row | null> {
    return this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider: APPLE_HEALTH_PROVIDER_ID, userId } },
      select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true, consentedAt: true },
    }) as Promise<Row | null>;
  }

  private async audit(userId: string, type: string, details: Record<string, unknown>) {
    try {
      await this.prisma.providerConnectionEvent.create({ data: { userId, provider: APPLE_HEALTH_PROVIDER_ID, type, details: details as never } });
    } catch (error) {
      this.logger.warn(`Auditoria Apple Saude falhou (${type}): ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`);
    }
  }

  document() {
    return { ...APPLE_HEALTH_CONSENT, textHash: consentTextHash(APPLE_HEALTH_CONSENT), purposeHashes: {}, locked: {} };
  }

  private active(row: Row | null): row is Row {
    return Boolean(row && !row.disconnectedAt);
  }

  // O que a ingestao pode aceitar AGORA para esta aluna (uma leitura so').
  async access(userId: string): Promise<AppleConsentAccess> {
    return this.accessOf(await this.load(userId));
  }

  private accessOf(row: Row | null): AppleConsentAccess {
    if (!row) return { mode: 'legacy', allowed: new Set() };
    if (!this.active(row) || !isConnectionConsentCurrent(APPLE_HEALTH_CONSENT, row)) return { mode: 'blocked', allowed: new Set() };
    return { mode: 'recorded', allowed: new Set(asStrings(row.grantedCategories)) };
  }

  async permissions(userId: string) {
    const row = await this.load(userId);
    const connected = this.active(row);
    const categories = new Set(connected ? asStrings(row.grantedCategories) : []);
    const current = connected && isConnectionConsentCurrent(APPLE_HEALTH_CONSENT, row);
    return {
      connected,
      consent: { version: APPLE_HEALTH_CONSENT.version, textHash: consentTextHash(APPLE_HEALTH_CONSENT), grantedVersion: connected ? row.consentVersion : null, grantedAt: connected ? row.consentedAt : null, needsReview: connected && !current },
      groups: APPLE_HEALTH_CONSENT.groups.map((g) => ({ id: g.id, label: g.label, required: g.required, requires: g.requires ?? [], granted: current && g.categories.every((c) => categories.has(c)) })),
      // Chave estavel e nao reversivel desta aluna para o estado de cobertura do historico guardado NO APARELHO (duas contas no mesmo iPhone nao compartilham cobertura).
      syncKey: createHash('sha256').update(`apple-health-sync:${userId}`).digest('hex').slice(0, 16),
      purposes: [] as never[],
      // Importacao feita antes deste registro (aplicativo anterior): nao ha consentimento por categoria gravado.
      legacyImport: row === null,
      log: await this.log(userId),
    };
  }

  private async log(userId: string) {
    const rows = await this.prisma.providerConnectionEvent.findMany({
      where: { provider: APPLE_HEALTH_PROVIDER_ID, userId, type: { in: ['connected', 'groups_updated', 'disconnected'] } },
      orderBy: { createdAt: 'desc' }, take: 40, select: { type: true, details: true, createdAt: true },
    }).catch(() => []);
    const out: Array<{ at: Date; decision: 'granted' | 'revoked'; kind: 'connection' | 'group'; id: string | null; version: string | null }> = [];
    for (const row of rows as Array<{ type: string; details: unknown; createdAt: Date }>) {
      const d = (row.details ?? {}) as { groups?: unknown; decision?: unknown; consentVersion?: unknown };
      const decision = d.decision === 'revoked' || row.type === 'disconnected' ? 'revoked' : 'granted';
      const version = typeof d.consentVersion === 'string' ? d.consentVersion : null;
      if (row.type === 'connected' || row.type === 'disconnected') { out.push({ at: row.createdAt, decision, kind: 'connection', id: null, version }); continue; }
      for (const id of asStrings(d.groups)) out.push({ at: row.createdAt, decision, kind: 'group', id, version });
    }
    return out;
  }

  // COORDENACAO ENTRE REVOGACAO E GRAVACAO (28/10/2026). Toda gravacao de dado sujeito a consentimento (treinos, medidas de sensor, percurso) roda em writeWhileAuthorized: transacao com
  // `SELECT ... FOR SHARE` na linha de autorizacao e as categorias RELIDAS ali dentro. Toda alteracao/retirada de autorizacao roda em UMA transacao que toma `SELECT ... FOR UPDATE` na mesma
  // linha, grava a nova autorizacao E apaga os dados das categorias retiradas antes de confirmar. O FOR UPDATE espera todas as gravacoes em andamento terminarem (e a limpeza dentro da
  // transacao apaga o que elas gravaram); gravacoes que chegam durante a revogacao esperam a confirmacao e, ao reler as categorias, ja' veem a retirada e nao gravam. Resultado: depois de a
  // revogacao terminar, nenhum dado das categorias retiradas permanece nem pode ser regravado com uma autorizacao consultada antes.
  private async lockRow(tx: Prisma.TransactionClient, userId: string): Promise<Row | null> {
    const rows = await tx.$queryRaw<Array<Row>>`SELECT "disconnectedAt", "grantedCategories", "grantedPurposes", "purposeConsents", "consentVersion", "consentTextHash", "consentedAt" FROM "ProviderConnection" WHERE "provider" = ${APPLE_HEALTH_PROVIDER_ID} AND "userId" = ${userId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  // Concede/revoga GRUPOS. A primeira concessao cria o registro; revogar nao exige aceite e vale na hora; conceder exige o aceite expresso do texto VIGENTE. Quem depende de um grupo retirado sai junto.
  async updateGroups(userId: string, input: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const document = APPLE_HEALTH_CONSENT;
    const grant = input.grant === undefined ? [] : input.grant;
    const revoke = input.revoke === undefined ? [] : input.revoke;
    if (!Array.isArray(grant) || !Array.isArray(revoke)) throw new BadRequestException('Grupos invalidos.');
    const known = (id: unknown) => document.groups.find((g) => g.id === id);
    if ([...grant, ...revoke].some((id) => !known(id))) throw new BadRequestException('Grupo de dados desconhecido.');
    if (grant.some((id) => revoke.includes(id))) throw new BadRequestException('Um grupo nao pode ser concedido e revogado juntos.');
    const hash = consentTextHash(document);
    if (grant.length > 0) {
      if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
      if (input.version !== document.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockRow(tx, userId);
      const connected = this.active(row);
      const currentCategories = new Set(connected ? asStrings(row.grantedCategories) : []);
      const selected = new Set(document.groups.filter((g) => g.categories.every((c) => currentCategories.has(c))).map((g) => g.id));
      const before = new Set(selected);
      for (const id of grant as string[]) selected.add(id);
      for (const id of revoke as string[]) selected.delete(id);
      for (let changed = true; changed;) {
        changed = false;
        for (const group of document.groups) {
          if (selected.has(group.id) && (group.requires ?? []).some((r) => !selected.has(r))) {
            if ((grant as string[]).includes(group.id)) throw new BadRequestException('Selecao incompativel: um grupo depende de outro nao autorizado.');
            selected.delete(group.id);
            changed = true;
          }
        }
      }
      const categories: string[] = [];
      for (const group of document.groups.filter((g) => selected.has(g.id))) for (const category of group.categories) if (!categories.includes(category)) categories.push(category);
      const now = new Date();
      const audits: Array<{ type: string; details: Record<string, unknown> }> = [];
      if (!connected) {
        // Sem registro ativo: so' faz sentido conceder (revogar o que nao existe nao muda nada).
        if (grant.length === 0) return { groups: [] as string[], categories: [] as string[], audits, invalidate: false };
        const data = {
          externalAccountId: userId, accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null,
          grantedCategories: categories as never, grantedPurposes: [...document.purposes] as never, purposeConsents: {} as never,
          consentVersion: document.version, consentTextHash: hash, consentedAt: now, refreshLockUntil: null, collectFrom: now, lastSyncCompletedAt: null, disconnectedAt: null,
        };
        await tx.providerConnection.upsert({ where: { provider_userId: { provider: APPLE_HEALTH_PROVIDER_ID, userId } }, create: { userId, provider: APPLE_HEALTH_PROVIDER_ID, ...data }, update: data });
        audits.push({ type: 'connected', details: { groups: [...selected], categories, purposes: document.purposes, consentVersion: document.version, consentTextHash: hash, decision: 'granted' } });
        return { groups: [...selected], categories, audits, invalidate: false };
      }
      const grantedIds = [...selected].filter((id) => !before.has(id));
      const revokedIds = [...before].filter((id) => !selected.has(id));
      // Limpeza e retirada na MESMA transacao, com a linha travada: se qualquer passo falhar, nada fica pela metade; se terminar, nada das categorias retiradas permanece.
      if (revokedIds.some((id) => (known(id)?.categories ?? []).includes('activity_sensors'))) { await this.scrubSensorData(userId, tx); audits.push({ type: 'sensor_data_scrubbed', details: {} }); }
      if (revokedIds.some((id) => (known(id)?.categories ?? []).some((c) => c === 'activity_route' || c === 'activity'))) { await this.scrubRouteData(userId, tx); audits.push({ type: 'route_data_scrubbed', details: {} }); }
      const revokedHealth = [...new Set(revokedIds.flatMap((id) => [...(known(id)?.categories ?? [])]).filter((c) => APPLE_HEALTH_RECORD_CATEGORIES.includes(c)))];
      if (revokedHealth.length > 0) { await this.scrubHealthData(userId, revokedHealth, tx); audits.push({ type: 'health_data_scrubbed', details: { categories: revokedHealth } }); }
      const updated = await tx.providerConnection.updateMany({ where: { provider: APPLE_HEALTH_PROVIDER_ID, userId, disconnectedAt: null }, data: { grantedCategories: categories as never } });
      if (updated.count !== 1) throw new ConflictException('Suas autorizacoes mudaram ao mesmo tempo. Tente de novo.');
      if (grantedIds.length > 0) audits.push({ type: 'groups_updated', details: { decision: 'granted', groups: grantedIds, consentVersion: document.version, consentTextHash: hash } });
      if (revokedIds.length > 0) audits.push({ type: 'groups_updated', details: { decision: 'revoked', groups: revokedIds } });
      const invalidate = revokedIds.some((id) => (known(id)?.categories ?? []).some((c) => INVALIDATING_CATEGORIES.includes(c)));
      return { groups: [...selected], categories, audits, invalidate };
    }, { timeout: 60_000 });
    for (const entry of outcome.audits) await this.audit(userId, entry.type, entry.details);
    if (outcome.invalidate) await this.invalidateAi(userId, 'import_revoked');
    return { groups: outcome.groups, categories: outcome.categories };
  }

  // Reconfirma o texto vigente apos mudanca material, sem alterar o que ja foi autorizado.
  async reconfirm(userId: string, input: { acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const document = APPLE_HEALTH_CONSENT;
    if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
    const hash = consentTextHash(document);
    if (input.version !== document.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de confirmar.');
    const updated = await this.prisma.providerConnection.updateMany({ where: { provider: APPLE_HEALTH_PROVIDER_ID, userId, disconnectedAt: null }, data: { consentVersion: document.version, consentTextHash: hash, consentedAt: new Date() } });
    if (updated.count !== 1) throw new ConflictException('A autorizacao nao esta ativa.');
    await this.audit(userId, 'connected', { reconfirmed: true, decision: 'granted', consentVersion: document.version, consentTextHash: hash });
    return { version: document.version };
  }

  // Retira TODAS as autorizacoes: numa unica transacao, com a linha travada, apaga percurso e medidas de sensor e grava a retirada. Nao apaga os treinos importados (exclusao e' outro pedido).
  async withdrawAll(userId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockRow(tx, userId);
      if (!this.active(row)) return { withdrawn: false };
      await this.scrubRouteData(userId, tx);
      await this.scrubSensorData(userId, tx);
      await this.scrubHealthData(userId, [...APPLE_HEALTH_RECORD_CATEGORIES], tx);
      const updated = await tx.providerConnection.updateMany({
        where: { provider: APPLE_HEALTH_PROVIDER_ID, userId, disconnectedAt: null },
        data: { disconnectedAt: new Date(), grantedCategories: [] as never, grantedPurposes: [] as never, purposeConsents: {} as never },
      });
      return { withdrawn: updated.count === 1 };
    }, { timeout: 60_000 });
    if (outcome.withdrawn) {
      await this.audit(userId, 'route_data_scrubbed', {});
      await this.audit(userId, 'sensor_data_scrubbed', {});
      await this.audit(userId, 'health_data_scrubbed', { categories: [...APPLE_HEALTH_RECORD_CATEGORIES] });
      await this.audit(userId, 'disconnected', { decision: 'revoked' });
      await this.invalidateAi(userId, 'withdrawn');
    }
    return outcome;
  }

  // Lock de leitura na linha de autorizacao durante a gravacao: uma revogacao concorrente espera e as categorias sao RELIDAS aqui dentro. Fail-closed para rotas/sensores.
  async writeWhileAuthorized<T>(userId: string, write: (tx: Prisma.TransactionClient, access: AppleConsentAccess) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<Row>>`SELECT "disconnectedAt", "grantedCategories", "grantedPurposes", "purposeConsents", "consentVersion", "consentTextHash", "consentedAt" FROM "ProviderConnection" WHERE "provider" = ${APPLE_HEALTH_PROVIDER_ID} AND "userId" = ${userId} FOR SHARE`;
      return write(tx, this.accessOf(rows[0] ?? null));
    }, { timeout: 60_000 });
  }

  // Apagam apenas dados da PROPRIA aluna e do provedor apple_health (outras fontes e categorias autorizadas nao sao tocadas). Sempre dentro da transacao que tem a linha travada.
  private async scrubRouteData(userId: string, db: Prisma.TransactionClient): Promise<void> {
    await db.activityTimeSeriesPoint.deleteMany({ where: { provider: APPLE_HEALTH_PROVIDER_ID, latitude: { not: null }, activityLog: { userId } } });
    await db.activityLog.updateMany({ where: { userId, provider: APPLE_HEALTH_PROVIDER_ID, hasRoute: true }, data: { hasRoute: false } });
  }

  // Apaga a SAUDE DO DIA A DIA (tabelas Wearable*, provedor apple_health, so' desta aluna) das categorias retiradas. Sempre dentro da transacao que tem a linha travada. Outras fontes (Zepp, Health
  // Connect, Polar) e categorias ainda autorizadas nao sao tocadas. O registro diario mistura duas categorias: retirar so' uma zera apenas as colunas dela e remove a linha se nada sobrar.
  private async scrubHealthData(userId: string, categories: readonly string[], db: Prisma.TransactionClient): Promise<void> {
    const where = { userId, provider: APPLE_HEALTH_PROVIDER_ID };
    if (categories.includes('sleep')) await db.wearableSleepSummary.deleteMany({ where });
    if (categories.includes('hrv')) await db.wearableHrvSummary.deleteMany({ where });
    const dailyCleared = categories.includes('daily_activity');
    const restingCleared = categories.includes('resting_heart_rate');
    if (dailyCleared) await db.wearableDailySummary.updateMany({ where, data: { steps: null, distanceMeters: null, activeKilocalories: null, stepsGoal: null } });
    if (restingCleared) await db.wearableDailySummary.updateMany({ where, data: { restingHeartRateBpm: null } });
    if (dailyCleared || restingCleared) {
      await db.wearableDailySummary.deleteMany({ where: { ...where, steps: null, distanceMeters: null, activeKilocalories: null, restingHeartRateBpm: null } });
    }
    const kinds = [...new Set(categories.flatMap((category) => metricKindsOfCategory(category)))];
    if (kinds.length > 0) await db.wearableMetricRecord.deleteMany({ where: { ...where, metricKind: { in: kinds } } });
  }

  // Apaga FC, cadencia, potencia e elevacao (colunas da atividade), a altitude dos pontos e as chaves de sensor do resumo do provedor e do bruto recebido.
  private async scrubSensorData(userId: string, db: Prisma.TransactionClient): Promise<void> {
    await db.activityLog.updateMany({ where: { userId, provider: APPLE_HEALTH_PROVIDER_ID }, data: { avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null } });
    await db.activityTimeSeriesPoint.updateMany({ where: { provider: APPLE_HEALTH_PROVIDER_ID, elevationMeters: { not: null }, activityLog: { userId } }, data: { elevationMeters: null } });
    const strip = (value: unknown): Record<string, unknown> | null => {
      const object = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : null;
      if (!object || !APPLE_SENSOR_KEYS.some((key) => object[key] != null)) return null;
      for (const key of APPLE_SENSOR_KEYS) if (key in object) object[key] = null;
      return object;
    };
    const logs = await db.activityLog.findMany({ where: { userId, provider: APPLE_HEALTH_PROVIDER_ID, providerMetrics: { not: Prisma.DbNull } }, select: { id: true, providerMetrics: true } });
    for (const log of logs) {
      const next = strip(log.providerMetrics);
      if (next) await db.activityLog.update({ where: { id: log.id }, data: { providerMetrics: next as Prisma.InputJsonObject } });
    }
    const raws = await db.rawExternalActivity.findMany({ where: { userId, provider: APPLE_HEALTH_PROVIDER_ID }, select: { id: true, payload: true } });
    for (const raw of raws) {
      const next = strip(raw.payload);
      if (next) await db.rawExternalActivity.update({ where: { id: raw.id }, data: { payload: next as Prisma.InputJsonObject } });
    }
  }

  // Exclusao dos treinos IMPORTADOS (a pedido da aluna). Exige estar sem autorizacao ativa (senao a proxima sincronizacao reimportaria).
  async deleteImportedData(userId: string) {
    if (!this.providerData) throw new ConflictException('Exclusao de dados indisponivel.');
    const row = await this.load(userId);
    if (this.active(row)) throw new ConflictException('Retire as autorizacoes antes de excluir os dados importados.');
    const result = await this.providerData.deleteProviderData(userId, APPLE_HEALTH_PROVIDER_ID);
    await this.scrubHealthData(userId, [...APPLE_HEALTH_RECORD_CATEGORIES], this.prisma as unknown as Prisma.TransactionClient);
    await this.audit(userId, 'data_deleted', {});
    return result;
  }

  private async invalidateAi(userId: string, trigger: string) {
    if (!this.providerData) return;
    try {
      await this.providerData.invalidateAiArtifacts(userId, APPLE_HEALTH_PROVIDER_ID);
    } catch (error) {
      this.logger.error(`Invalidacao dos artefatos de IA (apple_health, ${trigger}) falhou: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
      await this.audit(userId, 'ai_artifacts_invalidation_failed', { trigger });
    }
  }
}
