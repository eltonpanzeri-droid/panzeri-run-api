import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { consentTextHash, isConnectionConsentCurrent } from '../provider-hub/provider-consent.service';
import { WEAR_OS_CONSENT, WEAR_OS_PROVIDER_ID } from './wear-consent';

// Autorizacoes da aluna para o relogio Wear OS (17/11/2026). Mesmo modelo do Apple Saude: o servidor guarda SO' o consentimento por categoria, na linha ProviderConnection (provider 'wear_os', sem
// credenciais), e a ingestao respeita esse registro. A permissao do Android (GPS e sensores no relogio) NAO e' este consentimento. Sem registro ativo e vigente nada e' aceito (fail-closed: o aplicativo
// do relogio e' novo, nao ha compatibilidade anterior a preservar).
//
// COORDENACAO ENTRE REVOGACAO E GRAVACAO: toda gravacao roda em writeWhileAuthorized (transacao com a linha em modo compartilhado, categorias RELIDAS ali dentro); toda alteracao/retirada roda em UMA
// transacao com a linha travada para escrita, que grava a nova autorizacao E apaga os dados das categorias retiradas antes de confirmar.

type Row = { disconnectedAt: Date | null; grantedCategories: unknown; grantedPurposes: unknown; purposeConsents: unknown; consentVersion: string; consentTextHash: string | null; consentedAt: Date };

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : []);

export type WearConsentAccess = { allowed: Set<string>; ai: boolean };
const NONE: WearConsentAccess = { allowed: new Set(), ai: false };

@Injectable()
export class WearConsentService {
  private readonly logger = new Logger(WearConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly providerData?: ProviderDataDeletionService,
  ) {}

  private load(userId: string): Promise<Row | null> {
    return this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider: WEAR_OS_PROVIDER_ID, userId } },
      select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true, consentedAt: true },
    }) as Promise<Row | null>;
  }

  private async audit(userId: string, type: string, details: Record<string, unknown>) {
    try {
      await this.prisma.providerConnectionEvent.create({ data: { userId, provider: WEAR_OS_PROVIDER_ID, type, details: details as never } });
    } catch (error) {
      this.logger.warn(`Auditoria Wear OS falhou (${type}): ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`);
    }
  }

  document() {
    return { ...WEAR_OS_CONSENT, textHash: consentTextHash(WEAR_OS_CONSENT) };
  }

  private accessOf(row: Row | null): WearConsentAccess {
    if (!row || row.disconnectedAt || !isConnectionConsentCurrent(WEAR_OS_CONSENT, row)) return NONE;
    return { allowed: new Set(asStrings(row.grantedCategories)), ai: asStrings(row.grantedPurposes).includes('ai_external') };
  }

  async access(userId: string): Promise<WearConsentAccess> {
    return this.accessOf(await this.load(userId));
  }

  // Estado para a tela da aluna: texto vigente, o que esta autorizado e se precisa reconfirmar.
  async state(userId: string) {
    const row = await this.load(userId);
    const connected = Boolean(row && !row.disconnectedAt);
    const current = connected && isConnectionConsentCurrent(WEAR_OS_CONSENT, row!);
    const categories = new Set(connected ? asStrings(row!.grantedCategories) : []);
    return {
      connected,
      consent: { version: WEAR_OS_CONSENT.version, textHash: consentTextHash(WEAR_OS_CONSENT), grantedVersion: connected ? row!.consentVersion : null, grantedAt: connected ? row!.consentedAt : null, needsReview: connected && !current },
      groups: WEAR_OS_CONSENT.groups.map((g) => ({ id: g.id, label: g.label, description: g.description, requires: g.requires ?? [], granted: current && g.categories.every((c) => categories.has(c)) })),
      ai: current && asStrings(row!.grantedPurposes).includes('ai_external'),
    };
  }

  // Define EXATAMENTE quais grupos ficam autorizados (lista completa). Conceder exige o aceite expresso do texto VIGENTE; so' retirar nao exige. Lista vazia = retira tudo. A IA acompanha a autorizacao
  // (ja' esta no texto): `ai` so' precisa ser enviado para DESLIGAR (false) o uso pela IA; omitido ou true na primeira concessao liga.
  async update(userId: string, input: { groups?: unknown; ai?: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const document = WEAR_OS_CONSENT;
    if (!Array.isArray(input.groups)) throw new BadRequestException('Informe a lista de grupos.');
    const selected = new Set<string>(input.groups as string[]);
    const known = new Map(document.groups.map((g) => [g.id, g]));
    if ([...selected].some((id) => typeof id !== 'string' || !known.has(id))) throw new BadRequestException('Grupo de dados desconhecido.');
    for (const id of selected) if ((known.get(id)!.requires ?? []).some((required) => !selected.has(required))) throw new BadRequestException('Um grupo selecionado depende de outro que nao foi selecionado.');
    if (input.ai !== undefined && typeof input.ai !== 'boolean') throw new BadRequestException('Valor invalido para o uso pela IA.');
    const hash = consentTextHash(document);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<Row>>`SELECT "disconnectedAt", "grantedCategories", "grantedPurposes", "purposeConsents", "consentVersion", "consentTextHash", "consentedAt" FROM "ProviderConnection" WHERE "provider" = ${WEAR_OS_PROVIDER_ID} AND "userId" = ${userId} FOR UPDATE`;
      const row = rows[0] ?? null;
      const active = Boolean(row && !row.disconnectedAt);
      const currentBefore = active && isConnectionConsentCurrent(document, row!);
      const before = new Set<string>(currentBefore ? document.groups.filter((g) => g.categories.every((c) => asStrings(row!.grantedCategories).includes(c))).map((g) => g.id) : []);
      const granting = [...selected].filter((id) => !before.has(id));
      if (granting.length > 0) {
        if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
        if (input.version !== document.version || input.textHash !== hash) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
      }
      const revoked = [...before].filter((id) => !selected.has(id));
      const categories = [...new Set([...selected].flatMap((id) => known.get(id)!.categories as readonly string[]))];
      const aiBefore = currentBefore && asStrings(row!.grantedPurposes).includes('ai_external');
      const ai = selected.size === 0 ? false : input.ai === undefined ? (active && currentBefore ? aiBefore : true) : input.ai;
      const audits: Array<{ type: string; details: Record<string, unknown> }> = [];
      if (selected.size === 0) {
        if (!active) return { withdrawn: false, audits, aiChanged: false };
        await this.scrubRoute(userId, tx);
        await this.scrubSensors(userId, tx);
        await tx.providerConnection.updateMany({ where: { provider: WEAR_OS_PROVIDER_ID, userId, disconnectedAt: null }, data: { disconnectedAt: new Date(), grantedCategories: [] as never, grantedPurposes: [] as never, purposeConsents: {} as never } });
        audits.push({ type: 'route_data_scrubbed', details: {} }, { type: 'sensor_data_scrubbed', details: {} }, { type: 'disconnected', details: { decision: 'revoked' } });
        return { withdrawn: true, audits, aiChanged: aiBefore };
      }
      if (revoked.some((id) => (known.get(id)!.categories as readonly string[]).includes('activity_route'))) { await this.scrubRoute(userId, tx); audits.push({ type: 'route_data_scrubbed', details: {} }); }
      if (revoked.some((id) => (known.get(id)!.categories as readonly string[]).includes('activity_sensors'))) { await this.scrubSensors(userId, tx); audits.push({ type: 'sensor_data_scrubbed', details: {} }); }
      const now = new Date();
      const textChanged = granting.length > 0 || !currentBefore;
      const data = {
        externalAccountId: `wear:${userId}`, grantedCategories: categories as never, grantedPurposes: (ai ? ['ai_external'] : []) as never, purposeConsents: {} as never,
        // a versao/hash gravadas sao as do texto que ela confirmou agora; so' retirar (sem novo aceite) mantem o registro anterior
        ...(textChanged ? { consentVersion: document.version, consentTextHash: hash, consentedAt: now } : {}),
        disconnectedAt: null, ...(active ? {} : { collectFrom: now }),
      };
      await tx.providerConnection.upsert({
        where: { provider_userId: { provider: WEAR_OS_PROVIDER_ID, userId } },
        create: { userId, provider: WEAR_OS_PROVIDER_ID, externalAccountId: `wear:${userId}`, grantedCategories: categories as never, grantedPurposes: (ai ? ['ai_external'] : []) as never, purposeConsents: {} as never, consentVersion: document.version, consentTextHash: hash, consentedAt: now, collectFrom: now },
        update: data as never,
      });
      audits.push({ type: active && currentBefore ? 'groups_updated' : 'connected', details: { groups: [...selected], granted: granting, revoked, ai, consentVersion: document.version, consentTextHash: hash, decision: granting.length > 0 ? 'granted' : 'revoked' } });
      return { withdrawn: false, audits, aiChanged: aiBefore && !ai };
    }, { timeout: 60_000 });

    for (const entry of outcome.audits) await this.audit(userId, entry.type, entry.details);
    if (outcome.withdrawn || outcome.aiChanged) await this.invalidateAi(userId, outcome.withdrawn ? 'withdrawn' : 'ai_off');
    return this.state(userId);
  }

  // Gravacao de dado coletado com a linha em modo compartilhado: uma revogacao concorrente espera e as categorias sao RELIDAS aqui dentro (fail-closed).
  async writeWhileAuthorized<T>(userId: string, write: (tx: Prisma.TransactionClient, access: WearConsentAccess) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<Row>>`SELECT "disconnectedAt", "grantedCategories", "grantedPurposes", "purposeConsents", "consentVersion", "consentTextHash", "consentedAt" FROM "ProviderConnection" WHERE "provider" = ${WEAR_OS_PROVIDER_ID} AND "userId" = ${userId} FOR SHARE`;
      return write(tx, this.accessOf(rows[0] ?? null));
    }, { timeout: 60_000 });
  }

  // Apagam so' dados da PROPRIA aluna e do provedor wear_os, sempre dentro da transacao que tem a linha travada.
  private async scrubRoute(userId: string, db: Prisma.TransactionClient): Promise<void> {
    await db.activityTimeSeriesPoint.deleteMany({ where: { provider: WEAR_OS_PROVIDER_ID, latitude: { not: null }, activityLog: { userId } } });
    await db.activityLog.updateMany({ where: { userId, provider: WEAR_OS_PROVIDER_ID, hasRoute: true }, data: { hasRoute: false } });
  }

  private async scrubSensors(userId: string, db: Prisma.TransactionClient): Promise<void> {
    await db.activityLog.updateMany({ where: { userId, provider: WEAR_OS_PROVIDER_ID }, data: { avgHeartRateBpm: null, maxHeartRateBpm: null } });
    await db.activityTimeSeriesPoint.updateMany({ where: { provider: WEAR_OS_PROVIDER_ID, heartRateBpm: { not: null }, activityLog: { userId } }, data: { heartRateBpm: null } });
  }

  // Exclusao dos treinos RECEBIDOS do relogio (a pedido da aluna). Exige estar sem autorizacao ativa.
  async deleteReceivedData(userId: string) {
    if (!this.providerData) throw new ConflictException('Exclusao de dados indisponivel.');
    const row = await this.load(userId);
    if (row && !row.disconnectedAt) throw new ConflictException('Retire as autorizacoes antes de excluir os treinos recebidos do relogio.');
    const result = await this.providerData.deleteProviderData(userId, WEAR_OS_PROVIDER_ID);
    await this.audit(userId, 'data_deleted', {});
    return result;
  }

  private async invalidateAi(userId: string, trigger: string) {
    if (!this.providerData) return;
    try {
      await this.providerData.invalidateAiArtifacts(userId, WEAR_OS_PROVIDER_ID);
    } catch (error) {
      this.logger.error(`Invalidacao dos artefatos de IA (wear_os, ${trigger}) falhou: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
      await this.audit(userId, 'ai_artifacts_invalidation_failed', { trigger });
    }
  }
}
