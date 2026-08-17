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

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async syncAllStudents() {
    try {
      const result = await this.billing.refreshAllPendingStudents();
      this.logger.log(`Sincronizacao diaria de pagamentos: ${result.checked} verificado(s), ${result.changed} status alterado(s), ${result.failed} falha(s).`);
    } catch (error) {
      this.logger.warn(`Falha na sincronizacao diaria de pagamentos: ${(error as Error).message}`);
    }
  }
}
