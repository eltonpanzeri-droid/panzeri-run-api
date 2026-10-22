import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorRegistry, LEGACY_PROVIDER_IDS } from '../provider-hub/connector-registry';
import { ConsentCapability } from '../provider-hub/provider-connector';
import { HEALTH_CONNECT_CONSENT, HEALTH_CONNECT_PROVIDER_ID } from '../health-connect/health-connect-consent';
import { isConnectionConsentCurrent, isPurposeCurrent } from '../provider-hub/provider-consent.service';
import { AiDestination, AiScope } from './ai-scope';

// Elegibilidade de dados para IA (Central Universal de Integracoes, Lote 1). UMA regra, universal, por (usuario, provedor, categoria, destino):
//
//  - Provedores LEGADOS (Polar, Wahoo, Strava, Apple Health, Health Connect): comportamento atual preservado (elegiveis). Eles NAO tem consentimento de
//    finalidade "IA" por provedor; isso e' um achado registrado para a revisao juridica, fora do escopo desta mudanca.
//  - Provedores da Central (conector com documento de consentimento): so' elegiveis quando TODAS as condicoes valem:
//      1. (destino externo) o provedor foi LIBERADO para envio a IA externa — trava dupla: constante no codigo (EXTERNAL_AI_APPROVED_PROVIDERS, hoje VAZIA)
//         E variavel de ambiente <ID>_EXTERNAL_AI_ENABLED=true. Liberar exige uma mudanca de codigo revisada, nao so' uma variavel esquecida;
//      2. existe conexao ATIVA do aluno com o provedor;
//      3. a categoria dos dados foi autorizada pelo aluno;
//      4. a finalidade especifica ('ai_external' ou 'ai_internal') foi autorizada pelo aluno, separadamente.
//  - Provedor desconhecido (nem legado nem conector registrado) aparecendo no historico do aluno: BLOQUEADO (fail-closed).
//
// Revogar a finalidade tem efeito imediato: o escopo e' recalculado a cada geracao e reconferido na hora da chamada (AiEgressGuard).

// Provedores da Central cujo envio a fornecedores externos de IA foi liberado. 'zepp' foi LIBERADO por Elton em 21/10/2026 ("manda ver no Atlas"; condicoes do provedor,
// politica de privacidade e consentimento tratados como resolvidos por ele). Continua valendo a SEGUNDA trava: a variavel ZEPP_EXTERNAL_AI_ENABLED precisa estar ligada no servidor, e cada aluno
// so' entra com a autorizacao propria, separada, sobre o texto vigente. Alterar esta lista e' uma decisao de produto/juridica.
// 'health_connect' LIBERADO por Elton em 22/10/2026 (Atlas com a autorizacao propria do aluno, tambem para o Health Connect); a segunda trava continua sendo HEALTH_CONNECT_EXTERNAL_AI_ENABLED.
export const EXTERNAL_AI_APPROVED_PROVIDERS: readonly string[] = ['zepp', 'health_connect'];

// Provedores cuja conexao e' do APARELHO (sem OAuth/conector na Central) mas que tem consentimento por categoria/finalidade gravado em ProviderConnection. Para estes, o antigo atalho
// "provedor legado = elegivel como antes" NAO vale: a IA so' recebe o que o aluno autorizou (Health Connect, 22/10/2026).
export const DEVICE_CONSENT_PROVIDERS: Readonly<Record<string, ConsentCapability>> = { [HEALTH_CONNECT_PROVIDER_ID]: HEALTH_CONNECT_CONSENT };

// Trava dupla do envio externo, reutilizavel fora do servico de elegibilidade (ex.: tela de autorizacoes).
export function externalAiUnlockedFor(provider: string, config: { get<T = string>(key: string): T | undefined }): boolean {
  if (!EXTERNAL_AI_APPROVED_PROVIDERS.includes(provider)) return false;
  return config.get<string>(`${provider.toUpperCase()}_EXTERNAL_AI_ENABLED`)?.trim().toLowerCase() === 'true';
}

// Categorias de saude e recuperacao (autorizadas uma a uma pelo aluno). Cada par provedor:categoria e' avaliado separadamente no escopo de IA.
export const HEALTH_AI_CATEGORIES = ['sleep', 'hrv', 'daily_activity', 'resting_heart_rate', 'vo2_max', 'body_composition', 'pulse_ox', 'skin_temperature', 'respiratory_rate', 'nutrition'] as const;

export const AI_PURPOSE_BY_DESTINATION: Record<AiDestination, string> = { internal_ai: 'ai_internal', external_ai: 'ai_external' };

export type EligibilityReason =
  | 'legacy_provider_unchanged'
  | 'unknown_provider'
  | 'provider_locked'
  | 'not_connected'
  | 'category_not_granted'
  | 'purpose_not_granted'
  | 'allowed';

export interface EligibilityDecision { allowed: boolean; reason: EligibilityReason }

@Injectable()
export class AiDataEligibility {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
    private readonly config: ConfigService,
  ) {}

  // Trava dupla do envio externo (ver cabecalho). Lida a cada decisao.
  isExternalAiUnlocked(provider: string): boolean {
    return externalAiUnlockedFor(provider, this.config);
  }

  async decide(userId: string, provider: string, options: { category: string; destination: AiDestination }): Promise<EligibilityDecision> {
    const deviceConsent = DEVICE_CONSENT_PROVIDERS[provider];
    if (!deviceConsent && LEGACY_PROVIDER_IDS.includes(provider)) return { allowed: true, reason: 'legacy_provider_unchanged' };
    const connector = deviceConsent ? { consent: deviceConsent } : this.registry.get(provider);
    if (!connector?.consent) return { allowed: false, reason: 'unknown_provider' };
    if (options.destination === 'external_ai' && !this.isExternalAiUnlocked(provider)) return { allowed: false, reason: 'provider_locked' };
    const connection = await this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider, userId } },
      select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true },
    });
    if (!connection || connection.disconnectedAt) return { allowed: false, reason: 'not_connected' };
    const categories = Array.isArray(connection.grantedCategories) ? (connection.grantedCategories as unknown[]) : [];
    if (!categories.includes(options.category) || (options.category !== 'profile' && !isConnectionConsentCurrent(connector.consent, connection))) return { allowed: false, reason: 'category_not_granted' };
    const purposes = Array.isArray(connection.grantedPurposes) ? (connection.grantedPurposes as unknown[]) : [];
    const purposeId = AI_PURPOSE_BY_DESTINATION[options.destination];
    // A autorizacao so' vale sobre o texto vigente: texto alterado depois => nova autorizacao (fail-closed).
    if (!purposes.includes(purposeId) || !isPurposeCurrent(connector.consent, purposeId, connection.purposeConsents)) return { allowed: false, reason: 'purpose_not_granted' };
    return { allowed: true, reason: 'allowed' };
  }

  // Conjunto de provedores que NAO podem alimentar a IA deste aluno agora. Considera os conectores da Central e qualquer provedor desconhecido que ja
  // tenha gravado atividades para o aluno (fail-closed).
  async scopeFor(userId: string, destination: AiDestination = 'external_ai', category = 'activity'): Promise<AiScope> {
    const blocked = new Set<string>();
    const consentProviders = [...this.registry.list().filter((c) => c.consent).map((c) => ({ id: c.id, categories: c.categories as readonly string[] | undefined })), ...Object.entries(DEVICE_CONSENT_PROVIDERS).map(([id, consent]) => ({ id, categories: consent.groups.flatMap((g) => g.categories as readonly string[]) as readonly string[] | undefined }))];
    for (const connector of consentProviders) {
      if (!(await this.decide(userId, connector.id, { category, destination })).allowed) blocked.add(connector.id);
    }
    const seen = await this.prisma.activityLog.findMany({ where: { userId }, distinct: ['provider'], select: { provider: true } });
    for (const { provider } of seen) {
      if ((LEGACY_PROVIDER_IDS.includes(provider) && !DEVICE_CONSENT_PROVIDERS[provider]) || blocked.has(provider)) continue;
      if (!(await this.decide(userId, provider, { category, destination })).allowed) blocked.add(provider);
    }
    // Saude e recuperacao: cada categoria exige a propria autorizacao do aluno (alem da finalidade de IA e da liberacao do provedor).
    const blockedHealth = new Set<string>();
    for (const connector of consentProviders) {
      for (const healthCategory of HEALTH_AI_CATEGORIES) {
        if (!(connector.categories ?? []).includes(healthCategory)) continue;
        if (!(await this.decide(userId, connector.id, { category: healthCategory, destination })).allowed) blockedHealth.add(`${connector.id}:${healthCategory}`);
      }
    }
    return { userId, destination, blocked: [...blocked].sort(), blockedHealth: [...blockedHealth].sort(), computedAt: Date.now() };
  }
}
