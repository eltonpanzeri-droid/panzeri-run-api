import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { externalAiUnlockedFor } from '../ai-governance/ai-data-eligibility.service';
import { consentTextHash, isConnectionConsentCurrent, isPurposeCurrent, purposeTextHash } from '../provider-hub/provider-consent.service';
import { HEALTH_CONNECT_CONSENT, HEALTH_CONNECT_PROVIDER_ID } from './health-connect-consent';

// Autorizacoes do aluno para o Health Connect (22/10/2026). O Health Connect e' uma conexao do APARELHO (sem OAuth, sem token, sem conta externa): aqui o servidor guarda SO' o consentimento
// por categoria e por finalidade, na mesma linha ProviderConnection usada pelos outros provedores (provider 'health_connect', externalAccountId = o proprio aluno, sem credenciais), e exige
// que o app e a ingestao respeitem esse registro. Mesma semantica da Zepp: nada marcado de antemao, texto vigente (versao + hash), Atlas separado, revogacao vale na hora e e' auditada.
// Nunca cria um segundo sistema de conexao: a Central continua sendo a referencia; o que muda e' que este provedor nao precisa de token.
const INVALIDATING_CATEGORIES: readonly string[] = ['activity', 'activity_sensors', 'activity_route', 'sleep', 'hrv', 'daily_activity', 'resting_heart_rate', 'vo2_max', 'body_composition', 'pulse_ox', 'skin_temperature', 'respiratory_rate', 'nutrition'];

type Row = { disconnectedAt: Date | null; grantedCategories: unknown; grantedPurposes: unknown; purposeConsents: unknown; consentVersion: string; consentTextHash: string | null; consentedAt: Date };
type PurposeRecords = Record<string, { version: string; textHash: string; grantedAt: string }>;

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : []);

@Injectable()
export class HealthConnectConsentService {
  private readonly logger = new Logger(HealthConnectConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // Opcional so' para testes; em producao e' sempre injetado.
    @Optional() private readonly providerData?: ProviderDataDeletionService,
  ) {}

  private externalLocked(purposeId: string): boolean {
    return purposeId === 'ai_external' ? !externalAiUnlockedFor(HEALTH_CONNECT_PROVIDER_ID, this.config) : false;
  }

  private load(userId: string): Promise<Row | null> {
    return this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider: HEALTH_CONNECT_PROVIDER_ID, userId } },
      select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true, consentedAt: true },
    }) as Promise<Row | null>;
  }

  private async audit(userId: string, type: string, details: Record<string, unknown>) {
    try {
      await this.prisma.providerConnectionEvent.create({ data: { userId, provider: HEALTH_CONNECT_PROVIDER_ID, type, details: details as never } });
    } catch (error) {
      this.logger.warn(`Auditoria Health Connect falhou (${type}): ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`);
    }
  }

  // Texto, grupos e finalidades que o cliente DEVE exibir (o pedido devolve versao + hash do que foi exibido).
  document() {
    return {
      ...HEALTH_CONNECT_CONSENT,
      textHash: consentTextHash(HEALTH_CONNECT_CONSENT),
      purposeHashes: Object.fromEntries(HEALTH_CONNECT_CONSENT.optionalPurposes.map((p) => [p.id, purposeTextHash(p)])),
      locked: Object.fromEntries(HEALTH_CONNECT_CONSENT.optionalPurposes.filter((p) => p.external).map((p) => [p.id, this.externalLocked(p.id)])),
    };
  }

  // O consentimento esta ativo E o texto da conexao ainda e' o que o aluno aceitou? (isAllowed/permissions usam o mesmo criterio.)
  private active(row: Row | null): row is Row {
    return Boolean(row && !row.disconnectedAt);
  }

  // Categoria autorizada AGORA (conexao ativa, texto vigente). Fail-closed.
  async isAllowed(userId: string, category: string): Promise<boolean> {
    const row = await this.load(userId);
    if (!this.active(row)) return false;
    return asStrings(row.grantedCategories).includes(category) && isConnectionConsentCurrent(HEALTH_CONNECT_CONSENT, row);
  }

  // Conjunto de categorias autorizadas agora (uma leitura so', para a ingestao decidir o que guardar).
  async allowedCategories(userId: string): Promise<Set<string>> {
    const row = await this.load(userId);
    if (!this.active(row) || !isConnectionConsentCurrent(HEALTH_CONNECT_CONSENT, row)) return new Set();
    return new Set(asStrings(row.grantedCategories));
  }

  // Estado de cada autorizacao (para a tela do aluno) + historico auditavel.
  async permissions(userId: string) {
    const row = await this.load(userId);
    const connected = this.active(row);
    const categories = new Set(connected ? asStrings(row.grantedCategories) : []);
    const purposes = connected ? asStrings(row.grantedPurposes) : [];
    const records = (connected ? row.purposeConsents : null) as PurposeRecords | null;
    const current = connected && isConnectionConsentCurrent(HEALTH_CONNECT_CONSENT, row);
    return {
      connected,
      consent: { version: HEALTH_CONNECT_CONSENT.version, textHash: consentTextHash(HEALTH_CONNECT_CONSENT), grantedVersion: connected ? row.consentVersion : null, grantedAt: connected ? row.consentedAt : null, needsReview: connected && !current },
      groups: HEALTH_CONNECT_CONSENT.groups.map((g) => ({ id: g.id, label: g.label, required: g.required, requires: g.requires ?? [], granted: current && g.categories.every((c) => categories.has(c)) })),
      purposes: HEALTH_CONNECT_CONSENT.optionalPurposes.map((option) => {
        const listed = purposes.includes(option.id);
        const valid = listed && isPurposeCurrent(HEALTH_CONNECT_CONSENT, option.id, records);
        return {
          id: option.id, label: option.label, external: option.external, changeableAfterConnect: option.changeableAfterConnect, hasOwnScreen: Boolean(option.screen),
          granted: valid, needsNewAuthorization: listed && !valid, grantedAt: records?.[option.id]?.grantedAt ?? null, grantedVersion: records?.[option.id]?.version ?? null,
          currentVersion: option.screen?.version ?? HEALTH_CONNECT_CONSENT.version, available: option.external ? !this.externalLocked(option.id) : true,
        };
      }),
      log: await this.log(userId),
    };
  }

  private async log(userId: string) {
    const rows = await this.prisma.providerConnectionEvent.findMany({
      where: { provider: HEALTH_CONNECT_PROVIDER_ID, userId, type: { in: ['connected', 'purposes_granted', 'purposes_revoked', 'groups_updated', 'disconnected'] } },
      orderBy: { createdAt: 'desc' }, take: 40, select: { type: true, details: true, createdAt: true },
    }).catch(() => []);
    const out: Array<{ at: Date; decision: 'granted' | 'revoked'; kind: 'connection' | 'purpose' | 'group'; id: string | null; version: string | null }> = [];
    for (const row of rows as Array<{ type: string; details: unknown; createdAt: Date }>) {
      const d = (row.details ?? {}) as { purposes?: unknown; groups?: unknown; decision?: unknown; consentVersion?: unknown };
      const decision = d.decision === 'revoked' || row.type === 'purposes_revoked' || row.type === 'disconnected' ? 'revoked' : 'granted';
      const version = typeof d.consentVersion === 'string' ? d.consentVersion : null;
      if (row.type === 'connected' || row.type === 'disconnected') { out.push({ at: row.createdAt, decision, kind: 'connection', id: null, version }); continue; }
      for (const id of asStrings(row.type === 'groups_updated' ? d.groups : d.purposes)) out.push({ at: row.createdAt, decision, kind: row.type === 'groups_updated' ? 'group' : 'purpose', id, version });
    }
    return out;
  }

  // Concede/revoga GRUPOS de dados. A primeira concessao cria o registro (o aluno "conecta" ao escolher o que compartilha); revogar nao exige aceite e vale na hora; conceder exige o aceite
  // expresso sobre o texto VIGENTE. Quem depende de um grupo retirado sai junto.
  async updateGroups(userId: string, input: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const document = HEALTH_CONNECT_CONSENT;
    const grant = input.grant === undefined ? [] : input.grant;
    const revoke = input.revoke === undefined ? [] : input.revoke;
    if (!Array.isArray(grant) || !Array.isArray(revoke)) throw new BadRequestException('Grupos invalidos.');
    const known = (id: unknown) => document.groups.find((g) => g.id === id);
    if ([...grant, ...revoke].some((id) => !known(id))) throw new BadRequestException('Grupo de dados desconhecido.');
    if (grant.some((id) => revoke.includes(id))) throw new BadRequestException('Um grupo nao pode ser concedido e revogado juntos.');
    const row = await this.load(userId);
    const connected = this.active(row);
    const currentCategories = new Set(connected ? asStrings(row.grantedCategories) : []);
    const selected = new Set(document.groups.filter((g) => g.categories.every((c) => currentCategories.has(c))).map((g) => g.id));
    const before = new Set(selected);
    const hash = consentTextHash(document);
    if (grant.length > 0) {
      if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
      if (input.version !== document.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
      for (const id of grant as string[]) selected.add(id);
    }
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
    if (!connected) {
      // Sem registro ativo: so' faz sentido conceder (revogar o que nao existe nao muda nada).
      if (grant.length === 0) return { groups: [], categories: [] };
      const data = {
        externalAccountId: userId, accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null,
        grantedCategories: categories as never, grantedPurposes: [...document.purposes] as never, purposeConsents: {} as never,
        consentVersion: document.version, consentTextHash: hash, consentedAt: now, refreshLockUntil: null, collectFrom: now, lastSyncCompletedAt: null, disconnectedAt: null,
      };
      await this.prisma.providerConnection.upsert({ where: { provider_userId: { provider: HEALTH_CONNECT_PROVIDER_ID, userId } }, create: { userId, provider: HEALTH_CONNECT_PROVIDER_ID, ...data }, update: data });
      await this.audit(userId, 'connected', { groups: [...selected], categories, purposes: document.purposes, consentVersion: document.version, consentTextHash: hash, decision: 'granted' });
      return { groups: [...selected], categories };
    }
    const grantedIds = [...selected].filter((id) => !before.has(id));
    const revokedIds = [...before].filter((id) => !selected.has(id));
    // Apagar ANTES de gravar a revogacao: se o apagamento falhar, a revogacao nao fica registrada e a nova tentativa refaz tudo (nunca sobra localizacao/sensor sem autorizacao).
    // Retirar os SENSORES (FC, potencia, cadencia, elevacao) apaga esses campos ja' guardados: eles ficam dentro de atividades que continuam autorizadas e, sem isto, seguiriam alcancando a IA.
    if (revokedIds.some((id) => (known(id)?.categories ?? []).includes('activity_sensors'))) await this.scrubSensorData(userId);
    // Retirar o PERCURSO GPS (ou os exercicios, de que ele depende) apaga os pontos de localizacao ja guardados.
    if (revokedIds.some((id) => (known(id)?.categories ?? []).some((c) => c === 'activity_route' || c === 'activity'))) await this.scrubRouteData(userId);
    // Atualizacao CONDICIONAL ao que foi lido: duas alteracoes simultaneas nao se sobrescrevem (a segunda recebe conflito e refaz), entao uma revogacao nunca se perde.
    const updated = await this.prisma.providerConnection.updateMany({ where: { provider: HEALTH_CONNECT_PROVIDER_ID, userId, disconnectedAt: null, grantedCategories: { equals: (row as Row).grantedCategories as Prisma.InputJsonValue } }, data: { grantedCategories: categories as never } });
    if (updated.count !== 1) throw new ConflictException('Suas autorizacoes mudaram ao mesmo tempo. Tente de novo.');
    if (grantedIds.length > 0) await this.audit(userId, 'groups_updated', { decision: 'granted', groups: grantedIds, consentVersion: document.version, consentTextHash: hash });
    if (revokedIds.length > 0) await this.audit(userId, 'groups_updated', { decision: 'revoked', groups: revokedIds });
    if (revokedIds.some((id) => (known(id)?.categories ?? []).some((c) => INVALIDATING_CATEGORIES.includes(c)))) await this.invalidateAi(userId, 'import_revoked');
    return { groups: [...selected], categories };
  }

  // Finalidades opcionais (historico anterior, Atlas): cada uma com o seu texto/versao/hash; uma por vez; Atlas so' quando o sistema o libera.
  async updatePurposes(userId: string, input: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const document = HEALTH_CONNECT_CONSENT;
    const grant = input.grant === undefined ? [] : input.grant;
    const revoke = input.revoke === undefined ? [] : input.revoke;
    if (!Array.isArray(grant) || !Array.isArray(revoke)) throw new BadRequestException('Finalidades invalidas.');
    const changeable = (id: unknown) => document.optionalPurposes.find((p) => p.id === id && p.changeableAfterConnect);
    if ([...grant, ...revoke].some((id) => !changeable(id))) throw new BadRequestException('Finalidade desconhecida ou nao alteravel.');
    if (grant.some((id) => revoke.includes(id))) throw new BadRequestException('Uma finalidade nao pode ser concedida e revogada juntas.');
    const row = await this.load(userId);
    if (!this.active(row)) throw new ConflictException('Autorize primeiro ao menos um grupo de dados.');
    let purposes = asStrings(row.grantedPurposes);
    const records: PurposeRecords = { ...((row.purposeConsents as PurposeRecords | null) ?? {}) };
    const granted: string[] = [];
    const now = new Date();
    if (grant.length > 0) {
      if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
      const expectations = (grant as string[]).map((id) => {
        const option = changeable(id)!;
        return option.screen ? { version: option.screen.version, textHash: purposeTextHash(option) } : { version: document.version, textHash: consentTextHash(document) };
      });
      if (expectations.some((e) => e.version !== expectations[0].version || e.textHash !== expectations[0].textHash)) throw new BadRequestException('Autorize uma finalidade por vez, na tela dela.');
      if (input.version !== expectations[0].version || input.textHash !== expectations[0].textHash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
      for (const id of grant as string[]) {
        if (changeable(id)?.external && this.externalLocked(id)) throw new ConflictException('Esta finalidade ainda nao esta disponivel.');
        if (!(purposes.includes(id) && isPurposeCurrent(document, id, records))) {
          if (!purposes.includes(id)) purposes.push(id);
          records[id] = { version: expectations[0].version, textHash: expectations[0].textHash, grantedAt: now.toISOString() };
          granted.push(id);
        }
      }
    }
    const revoked = (revoke as string[]).filter((id) => purposes.includes(id));
    purposes = purposes.filter((id) => !revoked.includes(id));
    for (const id of revoked) delete records[id];
    const updated = await this.prisma.providerConnection.updateMany({
      where: { provider: HEALTH_CONNECT_PROVIDER_ID, userId, disconnectedAt: null, grantedPurposes: { equals: row.grantedPurposes as Prisma.InputJsonValue }, purposeConsents: { equals: (row.purposeConsents ?? {}) as Prisma.InputJsonValue } },
      data: { grantedPurposes: purposes as never, purposeConsents: records as never },
    });
    if (updated.count !== 1) throw new ConflictException('Suas autorizacoes mudaram ao mesmo tempo. Tente de novo.');
    if (granted.length > 0) await this.audit(userId, 'purposes_granted', { decision: 'granted', purposes: granted, consentVersion: document.version, consentTextHash: consentTextHash(document) });
    if (revoked.length > 0) {
      await this.audit(userId, 'purposes_revoked', { decision: 'revoked', purposes: revoked });
      if (revoked.some((id) => changeable(id)?.external)) await this.invalidateAi(userId, 'purpose_revoked');
    }
    return { purposes };
  }

  // Reconfirma o texto da conexao apos mudanca material, sem alterar o que ja foi autorizado.
  async reconfirm(userId: string, input: { acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const document = HEALTH_CONNECT_CONSENT;
    if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
    const hash = consentTextHash(document);
    if (input.version !== document.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de confirmar.');
    const updated = await this.prisma.providerConnection.updateMany({ where: { provider: HEALTH_CONNECT_PROVIDER_ID, userId, disconnectedAt: null }, data: { consentVersion: document.version, consentTextHash: hash, consentedAt: new Date() } });
    if (updated.count !== 1) throw new ConflictException('A autorizacao nao esta ativa.');
    await this.audit(userId, 'connected', { reconfirmed: true, decision: 'granted', consentVersion: document.version, consentTextHash: hash });
    return { version: document.version };
  }

  // Retira TODAS as autorizacoes de uma vez. Nao apaga o que ja foi importado (a exclusao e' outro pedido) e invalida os artefatos de IA derivados.
  async withdrawAll(userId: string) {
    // Retirar tudo tambem apaga a LOCALIZACAO (percurso GPS) ja' guardada, antes de gravar a retirada (retry seguro).
    const row = await this.load(userId);
    if (this.active(row)) await this.scrubRouteData(userId);
    const updated = await this.prisma.providerConnection.updateMany({
      where: { provider: HEALTH_CONNECT_PROVIDER_ID, userId, disconnectedAt: null },
      data: { disconnectedAt: new Date(), grantedCategories: [] as never, grantedPurposes: [] as never, purposeConsents: {} as never },
    });
    if (updated.count === 1) {
      await this.audit(userId, 'disconnected', { decision: 'revoked' });
      await this.invalidateAi(userId, 'withdrawn');
    }
    return { withdrawn: updated.count === 1 };
  }

  // Lock de leitura na linha de autorizacao: durante a gravacao, uma revogacao concorrente espera, e as categorias sao RELIDAS aqui dentro (o que foi retirado no meio nao e' gravado).
  // Devolve null se a autorizacao nao esta mais ativa. Mesmo padrao usado pela Zepp.
  async writeWhileAuthorized<T>(userId: string, write: (tx: Prisma.TransactionClient, allowed: Set<string>) => Promise<T>): Promise<T | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<Row>>`SELECT "disconnectedAt", "grantedCategories", "grantedPurposes", "purposeConsents", "consentVersion", "consentTextHash", "consentedAt" FROM "ProviderConnection" WHERE "provider" = ${HEALTH_CONNECT_PROVIDER_ID} AND "userId" = ${userId} AND "disconnectedAt" IS NULL FOR SHARE`;
      if (rows.length === 0) return null;
      const current = isConnectionConsentCurrent(HEALTH_CONNECT_CONSENT, rows[0]);
      return write(tx, current ? new Set(asStrings(rows[0].grantedCategories)) : new Set<string>());
    }, { timeout: 60_000 });
  }

  // Apaga os pontos de localizacao (percurso GPS) das atividades do Health Connect e marca as atividades como sem percurso.
  async scrubRouteData(userId: string): Promise<void> {
    await this.prisma.activityTimeSeriesPoint.deleteMany({ where: { provider: HEALTH_CONNECT_PROVIDER_ID, latitude: { not: null }, activityLog: { userId } } });
    await this.prisma.activityLog.updateMany({ where: { userId, provider: HEALTH_CONNECT_PROVIDER_ID, hasRoute: true }, data: { hasRoute: false } });
    await this.audit(userId, 'route_data_scrubbed', {});
  }

  // Apaga dos registros do Health Connect os campos de SENSOR (FC, potencia, cadencia, elevacao): nas colunas da atividade, no resumo do provedor e no bruto recebido.
  async scrubSensorData(userId: string): Promise<void> {
    await this.prisma.activityLog.updateMany({ where: { userId, provider: HEALTH_CONNECT_PROVIDER_ID }, data: { avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null } });
    // A altitude dos pontos do percurso e' sensor (categoria propria): sai junto.
    await this.prisma.activityTimeSeriesPoint.updateMany({ where: { provider: HEALTH_CONNECT_PROVIDER_ID, elevationMeters: { not: null }, activityLog: { userId } }, data: { elevationMeters: null } });
    const logs = await this.prisma.activityLog.findMany({ where: { userId, provider: HEALTH_CONNECT_PROVIDER_ID, providerMetrics: { not: Prisma.DbNull } }, select: { id: true, providerMetrics: true } });
    for (const log of logs) {
      const metrics = log.providerMetrics && typeof log.providerMetrics === 'object' && !Array.isArray(log.providerMetrics) ? { ...(log.providerMetrics as Record<string, unknown>) } : null;
      if (!metrics || (!('sensors' in metrics) && !('heartRate' in metrics))) continue;
      delete metrics.sensors;
      delete metrics.heartRate;
      await this.prisma.activityLog.update({ where: { id: log.id }, data: { providerMetrics: metrics as Prisma.InputJsonObject } });
    }
    const SENSOR_KEYS = ['avgHeartRateBpm', 'maxHeartRateBpm', 'heartRateSampleCount', 'powerAvgWatts', 'powerMaxWatts', 'cadenceAvgPerMin', 'elevationGainMeters'];
    const raws = await this.prisma.rawExternalActivity.findMany({ where: { userId, provider: HEALTH_CONNECT_PROVIDER_ID }, select: { id: true, payload: true } });
    for (const raw of raws) {
      const payload = raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload) ? { ...(raw.payload as Record<string, unknown>) } : null;
      if (!payload || !SENSOR_KEYS.some((key) => payload[key] != null)) continue;
      for (const key of SENSOR_KEYS) if (key in payload) payload[key] = null;
      await this.prisma.rawExternalActivity.update({ where: { id: raw.id }, data: { payload: payload as Prisma.InputJsonObject } });
    }
    await this.audit(userId, 'sensor_data_scrubbed', {});
  }

  // Exclusao dos dados IMPORTADOS do Health Connect (a pedido da aluna). Como nos demais provedores, exige estar sem autorizacao ativa (senao a proxima sincronizacao reimportaria).
  async deleteImportedData(userId: string) {
    if (!this.providerData) throw new ConflictException('Exclusao de dados indisponivel.');
    const row = await this.load(userId);
    if (this.active(row)) throw new ConflictException('Retire as autorizacoes antes de excluir os dados importados.');
    const result = await this.providerData.deleteProviderData(userId, HEALTH_CONNECT_PROVIDER_ID);
    const where = { userId, provider: HEALTH_CONNECT_PROVIDER_ID };
    await this.prisma.wearableSleepSummary.deleteMany({ where });
    await this.prisma.wearableDailySummary.deleteMany({ where });
    await this.prisma.wearableHrvSummary.deleteMany({ where });
    await this.prisma.wearableMetricRecord.deleteMany({ where });
    await this.audit(userId, 'data_deleted', {});
    return result;
  }

  private async invalidateAi(userId: string, trigger: string) {
    if (!this.providerData) return;
    try {
      await this.providerData.invalidateAiArtifacts(userId, HEALTH_CONNECT_PROVIDER_ID);
    } catch (error) {
      this.logger.error(`Invalidacao dos artefatos de IA (health_connect, ${trigger}) falhou: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
      await this.audit(userId, 'ai_artifacts_invalidation_failed', { trigger });
    }
  }
}
