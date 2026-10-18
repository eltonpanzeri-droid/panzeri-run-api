import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from './billing.service';

// Bug real corrigido 16/08 (aluna Eduarda) — a sincronizacao com o Asaas so acontecia quando a
// PROPRIA aluna abria a aba de pagamento (getMine()) ou quando o treinador clicava em
// "Sincronizar" no painel. Sem nenhuma dessas duas coisas acontecendo, um pagamento que falhou
// (cartao recusado, etc.) nunca era descoberto pelo sistema — o status "Pagamento confirmado"
// antigo ficava congelado indefinidamente, dando acesso completo ao app pra quem na verdade
// parou de pagar. Essa varredura diaria fecha essa janela: reaproveita a mesma
// refreshAllPendingStudents() que ja existe pro botao "Sincronizar todos" do painel, agora
// rodando sozinha todo dia, sem precisar ninguem lembrar de clicar.
@Injectable()
export class BillingSyncSchedulerService {
  private readonly logger = new Logger(BillingSyncSchedulerService.name);

  constructor(private readonly billing: BillingService) {}

  // 04/09: achado numa revisao pensando em escala — sem essa trava, se a varredura de um dia
  // demorasse mais de 24h (nunca aconteceu ainda, mas fica mais provavel com mais assinantes e
  // mais chamadas ao Asaas), o cron do dia seguinte comecaria por cima do anterior ainda rodando,
  // processando os mesmos alunos 2x ao mesmo tempo.
  private isRunning = false;

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async syncAllStudents() {
    if (this.isRunning) {
      this.logger.warn('Sincronizacao diaria de pagamentos ainda estava rodando quando o horario de hoje chegou — pulando esta execucao.');
      return;
    }
    this.isRunning = true;
    try {
      const result = await this.billing.refreshAllPendingStudents();
      this.logger.log(`Sincronizacao diaria de pagamentos: ${result.checked} verificado(s), ${result.changed} status alterado(s), ${result.failed} falha(s).`);
    } catch (error) {
      this.logger.warn(`Falha na sincronizacao diaria de pagamentos: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  // 18/10/2026: assinaturas da loja (Apple/Google) tem varredura propria, separada do Asaas — o webhook do RevenueCat pode falhar/atrasar e, sem isto,
  // uma assinatura vencida ficava como ativa ate o aluno abrir o app. Mesma trava contra execucao sobreposta.
  private isRunningStore = false;

  @Cron(CronExpression.EVERY_6_HOURS)
  async syncStoreSubscribers() {
    if (this.isRunningStore) {
      this.logger.warn('Reconciliacao de assinaturas da loja ainda estava rodando — pulando esta execucao.');
      return;
    }
    this.isRunningStore = true;
    try {
      await this.billing.refreshAllStoreSubscriptions();
    } catch (error) {
      this.logger.warn(`Falha na reconciliacao periodica de assinaturas da loja: ${(error as Error).message}`);
    } finally {
      this.isRunningStore = false;
    }
  }
}
