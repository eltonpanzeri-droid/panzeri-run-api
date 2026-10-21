import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentCapability } from './provider-connector';
import { ConnectorRegistry } from './connector-registry';

// Hash do texto EXATO apresentado (versao, titulo, introducao, secoes, grupos, finalidades e frase de confirmacao). Qualquer mudanca no texto muda o hash:
// um pedido de conexao feito sobre o texto antigo e' recusado, e a conexao registra o hash do que o aluno de fato viu.
export function consentTextHash(consent: ConsentCapability): string {
  const canonical = JSON.stringify({
    version: consent.version, dateLabel: consent.dateLabel, title: consent.title, intro: consent.intro, sections: consent.sections, groups: consent.groups,
    purposes: consent.purposes, optionalPurposes: consent.optionalPurposes, acknowledgementText: consent.acknowledgementText, confirmButtonLabel: consent.confirmButtonLabel,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// Hash do texto EXATO da tela propria de uma finalidade (ou do documento da conexao, quando a finalidade nao tem tela propria). Muda se qualquer palavra mudar.
export function purposeTextHash(option: { id: string; label: string; description: string; external: boolean; screen?: unknown }): string {
  return createHash('sha256').update(JSON.stringify({ id: option.id, label: option.label, description: option.description, external: option.external, screen: option.screen ?? null })).digest('hex');
}

// O consentimento da CONEXAO (importacao dos grupos de dados) so' vale sobre o texto vigente: se a versao/hash do documento da conexao mudou DEPOIS da autorizacao do aluno, as
// categorias de dados (tudo alem da identificacao da conta) deixam de valer ate ele confirmar de novo o texto atual (reconfirmacao). Fail-closed. Linha sem versao registrada
// (conexao anterior ao campo) e' tratada como vigente.
export function isConnectionConsentCurrent(consent: ConsentCapability | undefined, row: { consentVersion?: string | null; consentTextHash?: string | null }): boolean {
  if (!consent || typeof row.consentVersion !== 'string') return true;
  if (row.consentVersion !== consent.version) return false;
  return !row.consentTextHash || row.consentTextHash === consentTextHash(consent);
}

// Registro da autorizacao de UMA finalidade: versao e hash do texto que o aluno viu, e quando.
export interface PurposeConsentRecord { version: string; textHash: string; grantedAt: string }

// Uma finalidade com tela propria so' VALE se foi concedida sobre o texto VIGENTE (mesma versao e mesmo hash). Texto alterado depois => nao vale ate nova autorizacao
// (fail-closed). Finalidades obrigatorias e opcionais sem tela propria valem pela simples presenca na lista (comportamento anterior).
export function isPurposeCurrent(consent: ConsentCapability | undefined, purposeId: string, records: unknown): boolean {
  const option = consent?.optionalPurposes.find((p) => p.id === purposeId);
  if (!option?.screen) return true;
  const record = (records && typeof records === 'object' ? (records as Record<string, PurposeConsentRecord | undefined>)[purposeId] : undefined) ?? null;
  return record !== null && record.version === option.screen.version && record.textHash === purposeTextHash(option);
}

// Ponto UNICO de consulta do consentimento. Toda leitura de token (ProviderConnectionService.getAccessToken) e todo evento da fila passam por aqui antes de
// tocar em dado do provedor. O Zepp (e a maioria dos provedores) nao tem escopos por categoria: a restricao e' aplicada AQUI, no Panzeri Run.
// Fail-closed: sem conexao ativa, sem registro de categorias ou categoria/finalidade ausente => negado. Consentimento revogado (desconectado) => negado.
@Injectable()
export class ProviderConsentService {
  // O registro de conectores permite conferir se a autorizacao de cada finalidade ainda e' sobre o texto vigente. Ausente (so' testes antigos) => valida pela presenca.
  constructor(private readonly prisma: PrismaService, private readonly registry?: ConnectorRegistry) {}

  private async load(provider: string, userId: string) {
    return this.prisma.providerConnection.findUnique({
      where: { provider_userId: { provider, userId } },
      select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, consentVersion: true, consentTextHash: true },
    });
  }

  private connectionCurrent(provider: string, row: { consentVersion?: string | null; consentTextHash?: string | null }): boolean {
    return isConnectionConsentCurrent(this.registry?.get(provider)?.consent, row);
  }

  private purposeValid(provider: string, purposeId: string, records: unknown): boolean {
    return isPurposeCurrent(this.registry?.get(provider)?.consent, purposeId, records);
  }

  async isAllowed(provider: string, userId: string, category: string, purpose?: string): Promise<boolean> {
    const c = await this.load(provider, userId);
    if (!c || c.disconnectedAt) return false;
    const categories = Array.isArray(c.grantedCategories) ? (c.grantedCategories as unknown[]) : [];
    if (!categories.includes(category)) return false;
    if (category !== 'profile' && !this.connectionCurrent(provider, c)) return false; // texto da conexao mudou: precisa reconfirmar
    if (purpose !== undefined) {
      const purposes = Array.isArray(c.grantedPurposes) ? (c.grantedPurposes as unknown[]) : [];
      if (!purposes.includes(purpose) || !this.purposeValid(provider, purpose, c.purposeConsents)) return false;
    }
    return true;
  }

  async assertAllowed(provider: string, userId: string, category: string, purpose?: string): Promise<void> {
    const c = await this.load(provider, userId);
    if (!c || c.disconnectedAt) throw new ConflictException('A integracao nao esta conectada.');
    if (!(await this.isAllowed(provider, userId, category, purpose))) throw new ForbiddenException('Categoria ou finalidade nao autorizada pelo aluno.');
  }

  // Retrato do consentimento VIGENTE (null = sem conexao ativa). Usado antes de baixar/gravar dado: categorias e finalidades autorizadas e a data a partir da qual
  // o Panzeri Run pode coletar (collectFrom: nada anterior e' aceito, exceto o historico de ate 30 dias que o aluno tenha autorizado).
  async snapshot(provider: string, userId: string): Promise<{ categories: string[]; purposes: string[]; collectFrom: Date | null } | null> {
    const c = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true, purposeConsents: true, collectFrom: true, consentVersion: true, consentTextHash: true } });
    if (!c || c.disconnectedAt) return null;
    const current = this.connectionCurrent(provider, c);
    return {
      categories: (Array.isArray(c.grantedCategories) ? (c.grantedCategories as string[]) : []).filter((category) => current || category === 'profile'),
      // So' finalidades cuja autorizacao ainda vale sobre o texto vigente.
      purposes: (Array.isArray(c.grantedPurposes) ? (c.grantedPurposes as string[]) : []).filter((id) => this.purposeValid(provider, id, c.purposeConsents)),
      collectFrom: c.collectFrom ?? null,
    };
  }

  // Executa a GRAVACAO de dado coletado com a linha da conexao travada em modo compartilhado (a desconexao/revogacao espera a escrita terminar e uma escrita
  // que comece depois dela nao encontra conexao ativa). As categorias sao relidas AQUI, dentro da trava: o que o aluno retirou no meio do processamento nao e gravado.
  // Devolve null (nada gravado) se a conexao nao esta mais ativa.
  async writeWhileAuthorized<T>(provider: string, userId: string, write: (tx: Prisma.TransactionClient, granted: { categories: string[]; purposes: string[] }) => Promise<T>): Promise<T | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ grantedCategories: unknown; grantedPurposes: unknown; purposeConsents: unknown; consentVersion: string | null; consentTextHash: string | null }>>`SELECT "grantedCategories", "grantedPurposes", "purposeConsents", "consentVersion", "consentTextHash" FROM "ProviderConnection" WHERE "provider" = ${provider} AND "userId" = ${userId} AND "disconnectedAt" IS NULL FOR SHARE`;
      if (rows.length === 0) return null;
      const current = this.connectionCurrent(provider, rows[0]);
      const categories = (Array.isArray(rows[0].grantedCategories) ? (rows[0].grantedCategories as string[]) : []).filter((category) => current || category === 'profile');
      const purposes = (Array.isArray(rows[0].grantedPurposes) ? (rows[0].grantedPurposes as string[]) : []).filter((id) => this.purposeValid(provider, id, rows[0].purposeConsents));
      return write(tx, { categories, purposes });
    }, { timeout: 60_000 });
  }

  // Alunos com conexao ATIVA que concederam uma finalidade (ex.: rotina de envio de treinos ao relogio). So' ids internos; nenhum token sai daqui.
  async userIdsWithPurpose(provider: string, purpose: string): Promise<string[]> {
    const rows = await this.prisma.providerConnection.findMany({ where: { provider, disconnectedAt: null, grantedPurposes: { array_contains: purpose } }, select: { userId: true } });
    return rows.map((row) => row.userId);
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
