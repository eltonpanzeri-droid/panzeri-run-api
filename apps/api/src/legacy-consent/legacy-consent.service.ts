import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { consentTextHash, isPurposeCurrent, purposeTextHash } from '../provider-hub/provider-consent.service';
import { isLegacyConsentProvider, LEGACY_CONSENT_DOCUMENTS, LegacyConsentProvider } from './legacy-consent';

type Row = { disconnectedAt: Date | null; grantedPurposes: unknown; purposeConsents: unknown };
type Records = Record<string, { version: string; textHash: string; grantedAt: string }>;
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : []);

// Decisao da aluna sobre o ATLAS para Polar/Wahoo ja' conectadas (22/10/2026). Registro em ProviderConnection (provider 'polar'|'wahoo', externalAccountId = a propria aluna, SEM credenciais;
// as credenciais da Polar/Wahoo continuam nas tabelas proprias, intocadas). So' existe depois que a aluna DECIDE: sem registro, o comportamento anterior segue (regra de nao-perda).
// Nada aqui altera a importacao de atividades.
@Injectable()
export class LegacyConsentService {
  private readonly logger = new Logger(LegacyConsentService.name);

  constructor(private readonly prisma: PrismaService, @Optional() private readonly providerData?: ProviderDataDeletionService) {}

  private provider(value: string): LegacyConsentProvider {
    if (!isLegacyConsentProvider(value)) throw new NotFoundException('Integracao desconhecida.');
    return value;
  }

  private load(provider: LegacyConsentProvider, userId: string): Promise<Row | null> {
    return this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true, grantedPurposes: true, purposeConsents: true } }) as Promise<Row | null>;
  }

  private async audit(userId: string, provider: string, type: string, details: Record<string, unknown>) {
    try { await this.prisma.providerConnectionEvent.create({ data: { userId, provider, type, details: details as never } }); }
    catch (error) { this.logger.warn(`Auditoria de consentimento falhou (${type}): ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`); }
  }

  // A aluna esta conectada ao provedor AGORA? (so' o estado; nenhuma credencial e' lida). O pedido sobre o Atlas so' faz sentido para quem esta conectada.
  private async isConnected(provider: LegacyConsentProvider, userId: string): Promise<boolean> {
    const row = provider === 'polar'
      ? await this.prisma.polarConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } })
      : await this.prisma.wahooConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } });
    return Boolean(row && !row.disconnectedAt);
  }

  document(providerInput: string) {
    const provider = this.provider(providerInput);
    const doc = LEGACY_CONSENT_DOCUMENTS[provider];
    const atlas = doc.optionalPurposes.find((p) => p.id === 'ai_external')!;
    return { provider, ...doc, textHash: consentTextHash(doc), purposeHashes: { ai_external: purposeTextHash(atlas) }, locked: { ai_external: false } };
  }

  async permissions(providerInput: string, userId: string) {
    const provider = this.provider(providerInput);
    const doc = LEGACY_CONSENT_DOCUMENTS[provider];
    const row = await this.load(provider, userId);
    // Linha perdida (a tabela nao entra no backup) mas a ultima decisao registrada foi RECUSA: a recusa continua valendo (ver AiDataEligibility).
    const lastRevoked = !row ? (await this.prisma.providerConnectionEvent?.findFirst?.({ where: { userId, provider, type: { in: ['purposes_granted', 'purposes_revoked'] } }, orderBy: { createdAt: 'desc' }, select: { type: true } }))?.type === 'purposes_revoked' : false;
    const listed = Boolean(row && !row.disconnectedAt && asStrings(row.grantedPurposes).includes('ai_external'));
    const records = (row?.purposeConsents ?? null) as Records | null;
    const current = listed && isPurposeCurrent(doc, 'ai_external', records);
    return {
      provider,
      connected: await this.isConnected(provider, userId),
      // decided: a aluna ja' respondeu (autorizou ou nao) — ate la vale o comportamento anterior.
      decided: Boolean(row && !row.disconnectedAt) || lastRevoked,
      atlas: { granted: current, needsNewAuthorization: listed && !current, grantedAt: records?.ai_external?.grantedAt ?? null, declined: Boolean(row && !row.disconnectedAt && !listed) || lastRevoked },
    };
  }

  // grant=true: autoriza o Atlas (exige aceite sobre o texto VIGENTE da tela); grant=false: nao autoriza / retira. Em ambos a aluna "decidiu": passa a valer a escolha dela.
  async setAtlas(providerInput: string, userId: string, input: { grant: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    const provider = this.provider(providerInput);
    if (typeof input.grant !== 'boolean') throw new BadRequestException('Informe se autoriza ou nao.');
    const doc = LEGACY_CONSENT_DOCUMENTS[provider];
    const atlas = doc.optionalPurposes.find((p) => p.id === 'ai_external')!;
    const now = new Date();
    let purposes = [...doc.purposes];
    let records: Records = {};
    if (input.grant) {
      if (input.acknowledged !== true) throw new BadRequestException('E necessario confirmar expressamente a autorizacao.');
      if (input.version !== atlas.screen!.version || input.textHash !== purposeTextHash(atlas)) throw new ConflictException('O texto de consentimento mudou. Leia a versao atual antes de autorizar.');
      purposes = [...purposes, 'ai_external'];
      records = { ai_external: { version: atlas.screen!.version, textHash: purposeTextHash(atlas), grantedAt: now.toISOString() } };
    }
    const before = await this.load(provider, userId);
    const hadAtlas = Boolean(before && !before.disconnectedAt && asStrings(before.grantedPurposes).includes('ai_external'));
    const data = {
      externalAccountId: userId, accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null,
      grantedCategories: ['activity'] as never, grantedPurposes: purposes as never, purposeConsents: records as never,
      consentVersion: doc.version, consentTextHash: consentTextHash(doc), consentedAt: now, refreshLockUntil: null, collectFrom: now, lastSyncCompletedAt: null, disconnectedAt: null,
    };
    await this.prisma.providerConnection.upsert({ where: { provider_userId: { provider, userId } }, create: { userId, provider, ...data }, update: data });
    await this.audit(userId, provider, input.grant ? 'purposes_granted' : 'purposes_revoked', { decision: input.grant ? 'granted' : 'revoked', purposes: ['ai_external'], consentVersion: input.grant ? atlas.screen!.version : null });
    // Nao autorizou ou retirou: os resultados de IA derivados desse provedor saem de validade.
    if (!input.grant && this.providerData && (hadAtlas || !before)) {
      try { await this.providerData.invalidateAiArtifacts(userId, provider); }
      catch (error) {
        this.logger.error(`Invalidacao dos artefatos de IA (${provider}) falhou: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
        await this.audit(userId, provider, 'ai_artifacts_invalidation_failed', { trigger: 'atlas_declined' });
      }
    }
    return this.permissions(provider, userId);
  }
}
