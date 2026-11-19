import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../billing/telegram.service';

// Lembrete semanal para Elton (19/11/2026): a analise AGREGADA e anonima do ciclo da comunidade foi adiada de proposito, e ele pediu um aviso por semana para nao esquecer. Toda segunda-feira as 9h (Sao Paulo) manda
// UMA mensagem no Telegram do treinador, ate existir o marco 'cycle_community_analysis_done' (gravado quando a analise for implementada ou ele decidir encerrar o lembrete). Nao envia dado de aluna nenhuma.
export const CYCLE_COMMUNITY_ANALYSIS_MILESTONE = 'cycle_community_analysis_done';

export const COMMUNITY_REMINDER_TEXT = [
  '🔔 Lembrete semanal (pedido seu): análise do ciclo da comunidade, sem identificação individual.',
  '',
  'Está adiada. Antes de fazer, precisa de: (1) finalidade e aceite próprios da aluna (o aceite atual só cobre "prescrições melhores para você"); (2) regra de anonimato (grupos mínimos, sem dado individual); (3) decidir o que olhar (por exemplo, como as alunas rendem em cada fase).',
  '',
  'Quando quiser retomar, peça ao Claude: "planejar a análise do ciclo da comunidade". Para parar este lembrete, peça: "encerrar o lembrete da análise do ciclo da comunidade".',
].join('\n');

@Injectable()
export class CommunityAnalysisReminderService {
  private readonly logger = new Logger(CommunityAnalysisReminderService.name);

  constructor(private readonly prisma: PrismaService, private readonly telegram: TelegramService) {}

  @Cron('0 9 * * 1', { timeZone: 'America/Sao_Paulo' })
  async weekly() {
    try {
      await this.run();
    } catch (error) {
      this.logger.warn(`Lembrete semanal da analise do ciclo da comunidade falhou: ${(error as Error).message}`);
    }
  }

  async run(): Promise<{ sent: boolean }> {
    const done = await this.prisma.coachMilestone.findUnique({ where: { key: CYCLE_COMMUNITY_ANALYSIS_MILESTONE } });
    if (done) return { sent: false };
    await this.telegram.notifyCoach(COMMUNITY_REMINDER_TEXT);
    return { sent: true };
  }
}
