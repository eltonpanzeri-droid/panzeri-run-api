import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { canonicalizeEmail } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PolarService } from '../polar/polar.service';
import { TombstoneLedger } from '../backup/tombstone-ledger';

// Exclusao de conta (05/10/2026 — Bloco pre-Garmin 4). Decisao de Elton: ANONIMIZACAO IRREVERSIVEL do User +
// exclusao dos dados pessoais e operacionais; registros financeiros ficam ligados so' a um identificador tecnico.
//
// MAPA DE CLASSIFICACAO (cada tabela com FK ou userId em exatamente UMA categoria; ha teste que falha se um
// modelo novo com userId nao for classificado aqui):
//   A = APAGAR   B = PRESERVAR ANONIMIZADO   (nenhum item em "C/revisao": todos decididos pela finalidade existente)
//
// Fluxo (deleteAccount): identificar -> confirmar -> pre-condicao financeira -> tombstone account_deleted CONFIRMADO no R2
//   -> revogar integracoes (Polar; falha externa nao bloqueia) -> executeAccountDeletion (UMA transacao: apaga A, anonimiza
//   User, scrub de BillingSubscription, preserva B, audita). Sem tombstone confirmado nada e' apagado. Falha local apos o
//   tombstone: rollback da transacao, tombstone mantido, evento auditado e alerta (sem PII).
// executeAccountDeletion e' idempotente e SO' LOCAL — e' o que a restauracao reaplica a partir do tombstone.

// ── A: apagar (ordem respeita as FKs: filhos antes dos pais) ───────────────────────────────────────────────────────
export const ACCOUNT_DELETE_ORDER = [
  'shoeUsage', 'workoutDelivery', 'sessionExecutionLink', 'workoutCompletion', 'trainingSession', 'weeklyCheckIn',
  'trainingExecutionInsight', 'trainingPlan', 'trainingPlanGenerationLock', 'nightlySleepLog', 'stressCheckin', 'contextEvent',
  'rawActivitySample', 'activityTimeSeriesPoint', 'activityLog', 'rawExternalActivity', 'evolutionReport', 'reassessment',
  'studentDirective', 'studentObservation', 'coachChatMessage', 'passwordResetToken', 'loginLinkToken', 'userNotification',
  'messageLog', 'healthProfile', 'userPreferences', 'weeklyAvailability', 'fitnessTest', 'targetRace', 'painReport',
  'menstrualProfile', 'menstrualCycleLog', 'menstrualDailyLog', 'userAchievement', 'challengeProgress', 'coachReport',
  'studentProfileEvent', 'studentProfile', 'studentReportEntry', 'onboardingInterview', 'shoe', 'stravaConnection',
  'stravaActivity', 'stravaAnalysisCache', 'stravaOAuthAttempt', 'polarConnection', 'polarOAuthAttempt', 'funnelEvent', 'freeTesterEmail',
] as const;

// ── B: preservar anonimizado (so' o necessario para registro financeiro/auditoria; nenhum dado de identificacao) ─────
//   User (linha tecnica anonimizada), BillingEvent (valor/datas/refs de pagamento), BillingSubscription (ids e datas
//   do pagamento; URLs, cliente externo e proxima cobranca anulados), CouponRedemption (qual beneficio foi concedido;
//   Coupon.usageCount e' contador separado), ProviderConnectionEvent (auditoria sem PII).
export const ACCOUNT_PRESERVED = ['user', 'billingEvent', 'billingSubscription', 'couponRedemption', 'providerConnectionEvent'] as const;

export interface AccountDeletionResult {
  status: 'deleted' | 'already_deleted' | 'user_not_found';
  deleted: Record<string, number>;
}

type Row = Record<string, any>;

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  // ledger/polar ausentes so' na CLI de restauracao (reaplicacao local: sem novo tombstone e sem chamadas externas).
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger?: TombstoneLedger,
    private readonly polar?: PolarService,
  ) {}

  async deleteAccount(studentId: string, confirmation: { confirmUserId?: string; confirmText?: string }, actor: { id: string; role: string }): Promise<AccountDeletionResult> {
    if (!this.ledger) throw new InternalServerErrorException('Exclusao indisponivel: ledger de tombstones nao configurado.');
    // 1. Identificar inequivocamente + 2. confirmacao explicita (id repetido e frase fixa).
    if (confirmation.confirmUserId !== studentId || confirmation.confirmText !== 'EXCLUIR CONTA') {
      throw new BadRequestException('Confirmacao ausente: envie confirmUserId igual ao id da conta e confirmText "EXCLUIR CONTA".');
    }
    const user = await this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true, role: true, accountStatus: true, subscriptionStatus: true, subscriptionManualOverride: true } });
    if (!user) throw new NotFoundException('Conta nao encontrada.');
    if (user.accountStatus === 'deleted') return { status: 'already_deleted', deleted: {} };
    if (user.role !== 'student') throw new BadRequestException('Somente contas de aluno podem ser excluidas por esta operacao.');
    // Pre-condicao: o sistema nunca executa acao financeira — assinatura recorrente viva precisa ser cancelada antes.
    if ((user.subscriptionStatus === 'active' || user.subscriptionStatus === 'grace') && !user.subscriptionManualOverride) {
      throw new ConflictException('A assinatura ainda esta ativa. Cancele a assinatura no Asaas/loja antes de excluir a conta (a exclusao nao executa acao financeira).');
    }

    // 3. Tombstone externo CONFIRMADO antes de qualquer exclusao (R2 fora => 503 e nada e' apagado).
    await this.ledger.record({ type: 'account_deleted', userId: studentId });

    // 4. Revogar integracoes. Polar: mecanismo existente (revoga local primeiro; falha externa nao bloqueia).
    if (this.polar) {
      await this.polar.disconnect(studentId).catch(() => undefined);
    }

    // 5-7. Apagar A, anonimizar, preservar B, auditar — uma transacao.
    try {
      const result = await this.executeAccountDeletion(studentId);
      this.logger.log(`Conta excluida (anonimizada). actor=${actor.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Exclusao de conta falhou apos o tombstone: ${(error as Error).message?.slice(0, 200)}`);
      await this.prisma.providerConnectionEvent.create({ data: { userId: studentId, provider: 'account', type: 'account_deletion_failed', details: { tombstoneKept: true } } }).catch(() => undefined);
      await this.ledger.alert(`ALERTA: a exclusao de conta falhou DEPOIS de gravar o tombstone (mantido; transacao revertida). Usuario interno: ${studentId}. Reexecutar a exclusao.`);
      throw new InternalServerErrorException('A exclusao nao foi concluida. O registro de seguranca foi mantido; tente novamente.');
    }
  }

  // Idempotente e local. Usada tambem pela restauracao (reaplicacao de tombstone account_deleted).
  async executeAccountDeletion(userId: string): Promise<AccountDeletionResult> {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as Record<string, any>;
      const user: Row | null = await db.user.findUnique({ where: { id: userId } });
      if (!user) return { status: 'user_not_found', deleted: {} };
      const alreadyDeleted = user.accountStatus === 'deleted';
      const deleted: Record<string, number> = {};
      const count = (name: string, result: { count: number }) => { deleted[name] = result.count; };

      // Ids para apagar filhos sem filtro aninhado.
      const sessions: Row[] = await db.trainingSession.findMany({ where: { userId }, select: { id: true } });
      const logs: Row[] = await db.activityLog.findMany({ where: { userId }, select: { id: true } });
      const sessionIds = sessions.map((s) => s.id);
      const logIds = logs.map((l) => l.id);
      // Jornada de funil ligada a esta conta (eventos pre-cadastro carregam so' o journeyId).
      const funnel: Row[] = await db.funnelEvent.findMany({ where: { userId }, select: { journeyId: true } });
      const journeyIds = new Set<string>(funnel.map((f) => f.journeyId).filter((j: unknown): j is string => typeof j === 'string'));
      const attributionJourney = (user.acquisitionAttribution as Row | null)?.journeyId;
      if (typeof attributionJourney === 'string') journeyIds.add(attributionJourney);
      // Lista de testadores gratuitos e' por e-mail (nao por userId): compara com a forma canonica.
      const testers: Row[] = alreadyDeleted ? [] : await db.freeTesterEmail.findMany({});
      const canonical = alreadyDeleted ? '' : canonicalizeEmail(String(user.email).toLowerCase());
      const testerIds = testers.filter((t) => canonicalizeEmail(String(t.email).toLowerCase()) === canonical).map((t) => t.id);

      for (const model of ACCOUNT_DELETE_ORDER) {
        let where: Row;
        switch (model) {
          case 'workoutDelivery': where = { trainingSessionId: { in: sessionIds } }; break;
          case 'rawActivitySample':
          case 'activityTimeSeriesPoint': where = { activityLogId: { in: logIds } }; break;
          case 'funnelEvent': where = journeyIds.size > 0 ? { OR: [{ userId }, { journeyId: { in: [...journeyIds] } }] } : { userId }; break;
          case 'freeTesterEmail': where = { id: { in: testerIds } }; break;
          default: where = { userId };
        }
        count(model, await db[model].deleteMany({ where }));
      }

      // B: assinatura preserva so' ids/datas de pagamento; remove o que liga a pessoa ou gera nova cobranca/contato.
      await db.billingSubscription.updateMany({
        where: { userId },
        data: { externalCustomerId: null, checkoutUrl: null, overdueInvoiceUrl: null, lastNotificationToken: null, nextChargeAt: null },
      });

      if (!alreadyDeleted) {
        // Identidade tecnica: e-mail aleatorio e irreversivel (nao derivado do original), dominio .invalid.
        await db.user.update({
          where: { id: userId },
          data: {
            email: `deleted-${randomBytes(16).toString('hex')}@deleted.invalid`,
            // Hash bcrypt valido de um segredo aleatorio descartado: ninguem conhece a senha (compare simplesmente falha)
            // e o login ainda recusa accountStatus 'deleted'.
            passwordHash: bcrypt.hashSync(randomBytes(32).toString('hex'), 4),
            name: 'Conta excluida',
            cpf: null, phone: null, birthDate: null, sex: null, heightCm: null, weightKg: null, address: null, education: null,
            studentCode: null, accountStatus: 'deleted',
            cancelReason: null, cancelFeedbackText: null, cancelWouldReturn: null, subscriptionCancelRequestedAt: null,
            refreshTokenHash: null, expoPushToken: null, acquisitionAttribution: null,
            // Aceite juridico (termos, privacidade, aptidao fisica): sem finalidade de retencao definida, nao e' preservado.
            acceptedTermsAt: null, acceptedPrivacyAt: null, acceptedTermsVersion: null, acceptedPrivacyVersion: null, acceptedExerciseResponsibilityAt: null,
            lastRoutineChangeAt: null, lastPlanGenerationFailedAt: null, generationWeekStart: null, lastGenerationAttemptAt: null,
          },
        });
      }
      // Auditoria (so' contagens, sem PII).
      await db.providerConnectionEvent.create({
        data: { userId, provider: 'account', type: 'account_deleted', details: { deleted, anonymizedNow: !alreadyDeleted } },
      });
      return { status: alreadyDeleted ? 'already_deleted' : 'deleted', deleted } as AccountDeletionResult;
    }, { timeout: 120_000, maxWait: 10_000 });
  }
}
