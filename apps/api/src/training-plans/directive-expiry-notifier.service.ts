import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';

// Aviso puramente informativo pro treinador quando uma diretiva com prazo vence — nenhuma
// chamada de IA envolvida, so uma comparacao de data (expiresAt < agora), entao nao gasta token
// nenhum. Diferente do "no_silent_regen_rule": isso nao decide nada sobre o treino do aluno nem
// regenera nada sozinho, so avisa; mesma categoria ja aceita de outros crons diarios existentes
// (NotificationTriggersService, StravaAnalysisSchedulerService, BackupService).
@Injectable()
export class DirectiveExpiryNotifierService {
  private readonly logger = new Logger(DirectiveExpiryNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async notifyExpiredDirectives() {
    // active:true + expiresAt no passado: a diretiva ja para de valer pra IA e some do painel
    // "Diretrizes ativas" sozinha (ambos os lugares ja filtram por expiresAt, ver
    // training-plans.service.ts e technical-manager-agent.service.ts) — o "active" aqui vira so
    // um marcador de "ja avisei o treinador sobre essa", pra nao repetir o aviso todo dia. Marcar
    // active:false depois de avisar e seguro: nao muda nada pra ninguem, ja estava sendo ignorada.
    const expired = await this.prisma.studentDirective.findMany({
      where: { active: true, expiresAt: { lt: new Date() } },
      include: { user: { select: { name: true, studentCode: true } } },
    });

    for (const directive of expired) {
      try {
        await this.telegram.notifyCoach(
          `⏳ Uma diretriz venceu no Panzeri Run.\nAluno: ${directive.user.name} (Cod. ${formatStudentCode(directive.user.studentCode)})\nDiretriz: ${directive.content}\nVencida em: ${directive.expiresAt?.toISOString().slice(0, 10)}\n\nEla ja parou de valer para a geracao de treinos. Se quiser, converse com o gerente tecnico para renovar ou substituir.`,
        );
        await this.prisma.studentDirective.update({ where: { id: directive.id }, data: { active: false } });
      } catch (error) {
        this.logger.warn(`Falha ao avisar sobre diretiva vencida ${directive.id}: ${(error as Error).message}`);
      }
    }
  }
}
