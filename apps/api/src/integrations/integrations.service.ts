import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { buildIntegrationsCatalog, INTEGRATION_PROVIDERS } from './integrations-catalog';

// Somente leitura. Nao chama Polar/Strava, nao renova token, nao cria webhook (diferente de StravaService.status).
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async catalog(userId: string) {
    const [polar, strava] = await Promise.all([
      this.prisma.polarConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } }),
      this.prisma.stravaConnection.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    const connectedProviderIds = new Set<string>();
    if (polar && !polar.disconnectedAt) connectedProviderIds.add('polar');
    if (strava) connectedProviderIds.add('strava');

    const configuredEnv = new Set<string>();
    for (const provider of INTEGRATION_PROVIDERS) {
      if (provider.requiresEnv && this.config.get<string>(provider.requiresEnv)?.trim()) configuredEnv.add(provider.requiresEnv);
    }
    return { providers: buildIntegrationsCatalog({ configuredEnv, connectedProviderIds }) };
  }
}
