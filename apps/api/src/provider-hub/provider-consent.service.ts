import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentCapability } from './provider-connector';

// Hash do texto EXATO apresentado (versao, titulo, introducao, secoes, grupos, finalidades e frase de confirmacao). Qualquer mudanca no texto muda o hash:
// um pedido de conexao feito sobre o texto antigo e' recusado, e a conexao registra o hash do que o aluno de fato viu.
export function consentTextHash(consent: ConsentCapability): string {
  const canonical = JSON.stringify({
    version: consent.version, dateLabel: consent.dateLabel, title: consent.title, intro: consent.intro, sections: consent.sections, groups: consent.groups,
    purposes: consent.purposes, acknowledgementText: consent.acknowledgementText, confirmButtonLabel: consent.confirmButtonLabel,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// Ponto UNICO de consulta do consentimento. Toda leitura de token (ProviderConnectionService.getAccessToken) e todo evento da fila passam por aqui antes de
// tocar em dado do provedor. O Zepp (e a maioria dos provedores) nao tem escopos por categoria: a restricao e' aplicada AQUI, no Panzeri Run.
// Fail-closed: sem conexao ativa, sem registro de categorias ou categoria/finalidade ausente => negado. Consentimento revogado (desconectado) => negado.
@Injectable()
export class ProviderConsentService {
  constructor(private readonly prisma: PrismaService) {}

  private async load(provider: string, userId: string) {
    return this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider, userId } },
      select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true },
    });
  }

  async isAllowed(provider: string, userId: string, category: string, purpose?: string): Promise<boolean> {
    const c = await this.load(provider, userId);
    if (!c || c.disconnectedAt) return false;
    const categories = Array.isArray(c.grantedCategories) ? (c.grantedCategories as unknown[]) : [];
    if (!categories.includes(category)) return false;
    if (purpose !== undefined) {
      const purposes = Array.isArray(c.grantedPurposes) ? (c.grantedPurposes as unknown[]) : [];
      if (!purposes.includes(purpose)) return false;
    }
    return true;
  }

  async assertAllowed(provider: string, userId: string, category: string, purpose?: string): Promise<void> {
    const c = await this.load(provider, userId);
    if (!c || c.disconnectedAt) throw new ConflictException('A integracao nao esta conectada.');
    if (!(await this.isAllowed(provider, userId, category, purpose))) throw new ForbiddenException('Categoria ou finalidade nao autorizada pelo aluno.');
  }

  // Eventos de provedor chegam com o id EXTERNO da conta; so' conexoes ativas resolvem para um usuario.
  async resolveActiveUserId(provider: string, externalAccountId: string): Promise<string | null> {
    const c = await this.prisma.providerConnection.findUnique({
      where: { provider_externalAccountId: { provider, externalAccountId } },
      select: { userId: true, disconnectedAt: true },
    });
    return c && !c.disconnectedAt ? c.userId : null;
  }
}
