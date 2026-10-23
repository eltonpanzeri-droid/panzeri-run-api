import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  grantedPolarHealthCategories, isPolarHealthCategory, isPolarHealthConsentCurrent, polarHealthTextHash, POLAR_HEALTH_CATEGORIES, POLAR_HEALTH_CONSENT, POLAR_HEALTH_PROVIDER_ID,
  POLAR_HEALTH_PURPOSES, POLAR_HEALTH_TABLE, POLAR_WEARABLE_PROVIDER, type PolarHealthCategory, type PolarHealthRow,
} from './polar-health-consent';

// Decisao da aluna sobre os dados de SAUDE da Polar (23/10/2026). Sempre do PROPRIO usuario (o id vem do token). Nao toca na conexao Polar nem na decisao sobre o Atlas.
@Injectable()
export class PolarHealthConsentService {
  private readonly logger = new Logger(PolarHealthConsentService.name);

  constructor(private readonly prisma: PrismaService) {}

  document() {
    return { ...POLAR_HEALTH_CONSENT, textHash: polarHealthTextHash() };
  }

  private load(userId: string): Promise<(PolarHealthRow & { consentedAt: Date }) | null> {
    return this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider: POLAR_HEALTH_PROVIDER_ID, userId } },
      select: { disconnectedAt: true, grantedCategories: true, consentVersion: true, consentTextHash: true, consentedAt: true },
    }) as Promise<(PolarHealthRow & { consentedAt: Date }) | null>;
  }

  private async polarConnected(userId: string): Promise<boolean> {
    const row = await this.prisma.polarConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } });
    return Boolean(row && !row.disconnectedAt);
  }

  private async audit(userId: string, type: string, details: Record<string, unknown>) {
    try { await this.prisma.providerConnectionEvent.create({ data: { userId, provider: POLAR_HEALTH_PROVIDER_ID, type, details: details as never } }); }
    catch (error) { this.logger.warn(`Auditoria do consentimento de saude Polar falhou (${type}): ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`); }
  }

  async permissions(userId: string) {
    const row = await this.load(userId);
    const granted = grantedPolarHealthCategories(row);
    return {
      connected: await this.polarConnected(userId),
      decided: Boolean(row),
      granted,
      // Texto mudou depois da autorizacao: nada e' importado ate' a aluna confirmar de novo.
      needsNewAuthorization: Boolean(row && !row.disconnectedAt && !isPolarHealthConsentCurrent(row) && (Array.isArray(row.grantedCategories) ? row.grantedCategories.length : 0) > 0),
      grantedAt: row && granted.length > 0 ? row.consentedAt.toISOString() : null,
    };
  }

  // categories: os grupos que a aluna MARCOU (vazio = retira tudo). Retirar um grupo apaga os dados ja' importados dele, na MESMA transacao da mudanca de autorizacao.
  async set(userId: string, input: { categories: unknown; acknowledged?: unknown; version?: unknown; textHash?: unknown }) {
    if (!Array.isArray(input.categories) || !input.categories.every(isPolarHealthCategory)) throw new BadRequestException('Escolha apenas grupos de dados validos.');
    const categories = POLAR_HEALTH_CATEGORIES.filter((category) => (input.categories as string[]).includes(category));
    if (categories.length > 0) {
      if (!(await this.polarConnected(userId))) throw new ConflictException('Conecte a Polar antes de escolher os dados de saúde.');
      if (input.acknowledged !== true) throw new BadRequestException('É necessário confirmar expressamente a autorização.');
      if (input.version !== POLAR_HEALTH_CONSENT.version || input.textHash !== polarHealthTextHash()) throw new ConflictException('O texto de consentimento mudou. Leia a versão atual antes de autorizar.');
    }
    const now = new Date();
    const before = await this.load(userId);
    const previous = grantedPolarHealthCategories(before);
    const removed = previous.filter((category) => !categories.includes(category)); // so' para a auditoria
    const data = {
      externalAccountId: userId, accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null,
      grantedCategories: categories as never, grantedPurposes: (categories.length > 0 ? [...POLAR_HEALTH_PURPOSES] : []) as never, purposeConsents: {} as never,
      consentVersion: POLAR_HEALTH_CONSENT.version, consentTextHash: polarHealthTextHash(), consentedAt: now, refreshLockUntil: null, collectFrom: null, lastSyncCompletedAt: null,
      disconnectedAt: categories.length > 0 ? null : now,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.providerConnection.upsert({ where: { provider_userId: { provider: POLAR_HEALTH_PROVIDER_ID, userId } }, create: { userId, provider: POLAR_HEALTH_PROVIDER_ID, ...data }, update: data });
      // SEMPRE apaga o que NAO esta selecionado, sem depender do que valia antes (texto mudou, desconexao/reconexao, linha antiga): nenhum dado fica guardado sem autorizacao. Idempotente.
      const toErase = POLAR_HEALTH_CATEGORIES.filter((category) => !categories.includes(category));
      for (const category of toErase) await (tx as never as Record<string, { deleteMany(args: unknown): Promise<unknown> }>)[POLAR_HEALTH_TABLE[category]].deleteMany({ where: { userId, provider: POLAR_WEARABLE_PROVIDER } });
    });
    await this.audit(userId, categories.length > 0 ? 'purposes_granted' : 'purposes_revoked', { categories, removed, consentVersion: POLAR_HEALTH_CONSENT.version });
    return this.permissions(userId);
  }

  /** Desconectar a Polar encerra a autorizacao de saude (reconectar exige escolher de novo). Nao apaga o historico — isso e' a exclusao de dados. */
  async revokeOnDisconnect(userId: string): Promise<void> {
    await this.prisma.providerConnection.updateMany({ where: { provider: POLAR_HEALTH_PROVIDER_ID, userId, disconnectedAt: null }, data: { disconnectedAt: new Date() } });
  }

  /** Exclusao dos dados da Polar do proprio usuario: a saude importada sai junto. */
  async eraseImportedData(userId: string): Promise<void> {
    for (const category of POLAR_HEALTH_CATEGORIES) {
      await (this.prisma as never as Record<string, { deleteMany(args: unknown): Promise<unknown> }>)[POLAR_HEALTH_TABLE[category]].deleteMany({ where: { userId, provider: POLAR_WEARABLE_PROVIDER } });
    }
  }

  /** Categorias que podem ser importadas AGORA (conexao Polar ativa + texto vigente + grupo concedido). */
  async importable(userId: string): Promise<PolarHealthCategory[]> {
    if (!(await this.polarConnected(userId))) return [];
    return grantedPolarHealthCategories(await this.load(userId));
  }
}
