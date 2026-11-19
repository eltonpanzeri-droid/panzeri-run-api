import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../billing/telegram.service';

// Lembrete semanal para Elton (19/11/2026): preparar o Marketplace dentro do Panzeri Run. Ideia dele: vender o espaco a lojistas, que vendem produtos com pelo menos 5% de desconto sobre o preco praticado no mercado; a receita
// vem da venda do espaco + comissao por venda. Ainda precisa ser estudado. Toda quarta-feira as 9h (Sao Paulo) manda UMA mensagem no Telegram do treinador, ate existir o marco 'marketplace_planning_done' (gravado quando ele
// decidir encerrar o lembrete). Nao envia dado de aluna nenhuma.
export const MARKETPLACE_REMINDER_MILESTONE = 'marketplace_planning_done';

export const MARKETPLACE_REMINDER_TEXT = [
  '🔔 Lembrete semanal (pedido seu): preparar o Marketplace dentro do Panzeri Run.',
  '',
  'A ideia: vender o espaço a lojistas, que vendem produtos com pelo menos 5% de desconto sobre o preço praticado no mercado. Receita: venda do espaço + comissão por venda.',
  '',
  'Ainda a estudar: (1) como comprovar o preço de mercado e fiscalizar o desconto mínimo de 5%; (2) modelo do contrato com o lojista, preço do espaço e percentual da comissão; (3) como a venda e o pagamento acontecem (e quem responde por entrega, troca e garantia); (4) regras das lojas (Apple e Google) para vender produto físico dentro do aplicativo; (5) privacidade: o lojista não pode receber dado de saúde nem de treino das alunas; (6) a parte tributária e jurídica, com advogado.',
  '',
  'Quando quiser retomar, peça ao Claude: "planejar o Marketplace". Para parar este lembrete, peça: "encerrar o lembrete do Marketplace".',
].join('\n');

@Injectable()
export class MarketplaceReminderService {
  private readonly logger = new Logger(MarketplaceReminderService.name);

  constructor(private readonly prisma: PrismaService, private readonly telegram: TelegramService) {}

  @Cron('0 9 * * 3', { timeZone: 'America/Sao_Paulo' })
  async weekly() {
    try {
      await this.run();
    } catch (error) {
      this.logger.warn(`Lembrete semanal do Marketplace falhou: ${(error as Error).message}`);
    }
  }

  async run(): Promise<{ sent: boolean }> {
    const done = await this.prisma.coachMilestone.findUnique({ where: { key: MARKETPLACE_REMINDER_MILESTONE } });
    if (done) return { sent: false };
    await this.telegram.notifyCoach(MARKETPLACE_REMINDER_TEXT);
    return { sent: true };
  }
}
