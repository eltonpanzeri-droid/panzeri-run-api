import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { buildIntegrationsCatalog, INTEGRATION_PROVIDERS } from './integrations-catalog';
import { isWahooEnabledFor } from '../wahoo/wahoo-access';

// Somente leitura. Nao chama Polar/Strava, nao renova token, nao cria webhook (diferente de StravaService.status).
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async catalog(userId: string) {
    const [polar, strava, wahoo] = await Promise.all([
      this.prisma.polarConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } }),
      this.prisma.stravaConnection.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.wahooConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } }),
    ]);
    const connectedProviderIds = new Set<string>();
    if (polar && !polar.disconnectedAt) connectedProviderIds.add('polar');
    if (strava) connectedProviderIds.add('strava');
    if (wahoo && !wahoo.disconnectedAt) connectedProviderIds.add('wahoo');

    const configuredEnv = new Set<string>();
    for (const provider of INTEGRATION_PROVIDERS) {
      const names = provider.requiresEnv === undefined ? [] : Array.isArray(provider.requiresEnv) ? provider.requiresEnv : [provider.requiresEnv];
      for (const name of names) if (this.config.get<string>(name)?.trim()) configuredEnv.add(name);
    }
    // Porta de habilitacao (validacao real): o id vem do JWT; a lista fica so' no servidor.
    const allowedProviderIds = new Set<string>();
    if (isWahooEnabledFor(this.config.get<string>('WAHOO_ENABLED_USER_IDS'), userId)) allowedProviderIds.add('wahoo');
    return { providers: buildIntegrationsCatalog({ configuredEnv, connectedProviderIds, allowedProviderIds }) };
  }
}
