import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { buildIntegrationsCatalog, INTEGRATION_PROVIDERS } from './integrations-catalog';
import { isWahooEnabledFor } from '../wahoo/wahoo-access';
import { isEnabledFor } from '../provider-hub/provider-access';
import { isPurposeCurrent } from '../provider-hub/provider-consent.service';
import { ZEPP_CONSENT } from '../zepp/zepp-consent';

// Autorizacoes OPCIONAIS (tela propria) que a aluna ainda nao deu — para o app destacar o que falta logo na lista de integracoes (22/10/2026: alunas conectavam e nunca chegavam a essas telas).
const ZEPP_PENDING_LABELS: Record<string, string> = { watch_delivery: 'envio de treinos ao relógio', ai_external: 'análise com o Atlas' };

// Somente leitura. Nao chama Polar/Strava, nao renova token, nao cria webhook (diferente de StravaService.status).
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async catalog(userId: string) {
    const [polar, strava, wahoo, zepp] = await Promise.all([
      this.prisma.polarConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } }),
      this.prisma.stravaConnection.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.wahooConnection.findUnique({ where: { userId }, select: { disconnectedAt: true } }),
      this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider: 'zepp', userId } }, select: { disconnectedAt: true, grantedPurposes: true, purposeConsents: true } }),
    ]);
    const connectedProviderIds = new Set<string>();
    if (polar && !polar.disconnectedAt) connectedProviderIds.add('polar');
    if (strava) connectedProviderIds.add('strava');
    if (wahoo && !wahoo.disconnectedAt) connectedProviderIds.add('wahoo');
    if (zepp && !zepp.disconnectedAt) connectedProviderIds.add('zepp');

    const configuredEnv = new Set<string>();
    for (const provider of INTEGRATION_PROVIDERS) {
      const names = provider.requiresEnv === undefined ? [] : Array.isArray(provider.requiresEnv) ? provider.requiresEnv : [provider.requiresEnv];
      for (const name of names) if (this.config.get<string>(name)?.trim()) configuredEnv.add(name);
    }
    // Porta de habilitacao (validacao real): o id vem do JWT; a lista fica so' no servidor.
    const allowedProviderIds = new Set<string>();
    if (isWahooEnabledFor(this.config.get<string>('WAHOO_ENABLED_USER_IDS'), userId)) allowedProviderIds.add('wahoo');
    if (isEnabledFor(this.config.get<string>('ZEPP_ENABLED_USER_IDS'), userId)) allowedProviderIds.add('zepp');
    const granted = new Set<string>(zepp && !zepp.disconnectedAt && Array.isArray(zepp.grantedPurposes) ? (zepp.grantedPurposes as unknown[]).filter((p): p is string => typeof p === 'string') : []);
    const zeppPending = zepp && !zepp.disconnectedAt ? Object.keys(ZEPP_PENDING_LABELS).filter((id) => !(granted.has(id) && isPurposeCurrent(ZEPP_CONSENT, id, zepp.purposeConsents))).map((id) => ZEPP_PENDING_LABELS[id]) : [];
    const providers = buildIntegrationsCatalog({ configuredEnv, connectedProviderIds, allowedProviderIds }).map((entry) => (entry.id === 'zepp' && zeppPending.length > 0 ? { ...entry, pendingAuthorizations: zeppPending } : entry));
    return { providers };
  }
}
