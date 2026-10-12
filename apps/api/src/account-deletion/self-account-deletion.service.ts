import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { TelegramService } from '../billing/telegram.service';
import { AccountDeletionResult, AccountDeletionService } from './account-deletion.service';

export const SELF_DELETE_PHRASE = 'EXCLUIR CONTA';
export type ExternalChargesChoice = 'cancel' | 'keep';

export interface SelfDeletionInfo {
  phrase: string;
  subscription: { channel: 'asaas' | 'store' | 'none'; live: 'yes' | 'no' | 'unknown'; pendingCharges: 'yes' | 'no' | 'unknown' };
  // true quando pode haver cobranca recorrente fora do Panzeri Run: o aluno precisa escolher (cancelar agora ou seguir ciente). NUNCA bloqueia.
  requiresChargesChoice: boolean;
}

// Exclusao de conta feita pelo PROPRIO aluno, dentro do aplicativo (Apple App Store 5.1.1(v) / LGPD). Reaproveita o motor existente
// (AccountDeletionService: tombstone no R2 antes de apagar, anonimizacao irreversivel, transacao unica). Diferencas deliberadas em relacao a rota do admin:
//  - exige a SENHA atual e a frase "EXCLUIR CONTA" (o id vem do token, nunca do corpo);
//  - NAO bloqueia por assinatura ativa: o direito de excluir nao pode depender de uma cobranca. Em vez disso, consulta a situacao REAL no Asaas e
//    exige uma escolha explicita — cancelar a assinatura junto (a pedido dele) ou seguir ciente de que a cobranca externa continua;
//  - se seguir sem cancelar uma assinatura Asaas possivelmente viva, o treinador e' avisado (sem dado pessoal) para nao deixar cobranca orfa.
@Injectable()
export class SelfAccountDeletionService {
  private readonly logger = new Logger(SelfAccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly billing: BillingService,
    private readonly telegram: TelegramService,
  ) {}

  async info(userId: string): Promise<SelfDeletionInfo> {
    const exposure = await this.billing.getSubscriptionExposure(userId);
    return { phrase: SELF_DELETE_PHRASE, subscription: { channel: exposure.channel, live: exposure.live, pendingCharges: exposure.pendingCharges }, requiresChargesChoice: this.requiresChoice(exposure) };
  }

  // Ha' escolha a fazer quando pode haver cobranca fora do Panzeri Run: assinatura viva/incerta OU cobrancas ja' emitidas em aberto (uma assinatura
  // suspensa no Asaas mantem as cobrancas existentes validas).
  private requiresChoice(exposure: { channel: string; live: string; pendingCharges: string }) {
    return exposure.channel !== 'none' && (exposure.live !== 'no' || exposure.pendingCharges !== 'no');
  }

  async deleteOwnAccount(userId: string, body: { password?: string; confirmText?: string; externalCharges?: string; chargesAcknowledged?: boolean } | null | undefined): Promise<AccountDeletionResult & { externalCharges: { channel: string; action: 'cancelled' | 'kept' | 'not_applicable' } }> {
    const input = body ?? {};
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, accountStatus: true, passwordHash: true, studentCode: true } });
    if (!user) throw new NotFoundException('Conta nao encontrada.');
    if (user.accountStatus === 'deleted') return { status: 'already_deleted', deleted: {}, externalCharges: { channel: 'none', action: 'not_applicable' } };
    if (user.role !== 'student') throw new BadRequestException('Somente contas de aluno podem ser excluidas por aqui.');
    if (input.confirmText !== SELF_DELETE_PHRASE) throw new BadRequestException(`Digite exatamente ${SELF_DELETE_PHRASE} para confirmar.`);
    // 403 (nao 401): o app trata 401 como sessao expirada e deslogaria o aluno por uma senha digitada errada.
    if (typeof input.password !== 'string' || input.password === '' || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new ForbiddenException('Senha incorreta.');
    }

    const exposure = await this.billing.getSubscriptionExposure(userId);
    let action: 'cancelled' | 'kept' | 'not_applicable' = 'not_applicable';
    if (this.requiresChoice(exposure)) {
      if (input.externalCharges !== 'cancel' && input.externalCharges !== 'keep') {
        throw new ConflictException({ code: 'external_charges_choice_required', message: 'Escolha o que fazer com a assinatura antes de excluir a conta.', subscription: { channel: exposure.channel, live: exposure.live, pendingCharges: exposure.pendingCharges } });
      }
      if (input.externalCharges === 'cancel' && exposure.channel === 'asaas') {
        try {
          await this.billing.cancelAsaasSubscriptionForAccountDeletion(userId);
          action = 'cancelled';
        } catch (error) {
          // Nao exclui sem saber se a cobranca parou: o aluno pode tentar de novo ou escolher seguir sem cancelar.
          this.logger.warn(`Cancelamento Asaas falhou na exclusao de conta: ${(error as Error).message?.slice(0, 160)}`);
          throw new BadGatewayException({ code: 'asaas_cancel_failed', message: 'Nao foi possivel cancelar a assinatura agora. Tente novamente ou escolha excluir sem cancelar.' });
        }
      } else {
        // Seguir sem cancelar exige um ACEITE ESPECIFICO, separado da escolha: as cobrancas podem continuar mesmo sem acesso ao app.
        if (input.chargesAcknowledged !== true) {
          throw new ConflictException({ code: 'charges_acknowledgement_required', message: 'Confirme que entende que as cobrancas podem continuar depois da exclusao.', subscription: { channel: exposure.channel, live: exposure.live, pendingCharges: exposure.pendingCharges } });
        }
        action = 'kept';
      }
    }

    const result = await this.accountDeletion.deleteAccount(userId, { confirmUserId: userId, confirmText: SELF_DELETE_PHRASE }, { id: userId, role: user.role }, { skipSubscriptionGuard: true });

    if (action === 'kept' && exposure.channel === 'asaas') {
      await this.telegram.notifyCoach(
        `AVISO: o aluno de codigo ${user.studentCode ?? 'sem codigo'} excluiu a conta SEM cancelar a assinatura no Asaas (situacao: ${exposure.live === 'yes' ? 'ativa' : exposure.live === 'unknown' ? 'nao confirmada' : 'nao ativa, mas com cobrancas emitidas em aberto'}; cobrancas pendentes/vencidas: ${exposure.pendingCharges === 'yes' ? 'sim' : exposure.pendingCharges === 'unknown' ? 'nao confirmado' : 'nao'}; id ${exposure.asaasSubscriptionId ?? 'desconhecido'}). Verifique no Asaas se a cobranca deve ser cancelada. Nenhuma acao foi tomada automaticamente.`,
      ).catch(() => undefined);
    }
    return { ...result, externalCharges: { channel: exposure.channel, action } };
  }
}
