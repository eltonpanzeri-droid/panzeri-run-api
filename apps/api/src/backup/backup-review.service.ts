import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from '../billing/telegram.service';
import { BACKUP_PREFIX } from './backup.service';
import { redactSecrets } from './backup-sanitize';
import { buildBackupReviewMessage } from './backup-review';
import { R2Client, R2Config } from './r2-client';

// Revisao mensal do backup (09/11/2026): dia 2 de cada mes, 09:00 em Sao Paulo (12:00 UTC), manda no Telegram os numeros reais das copias e o que conferir. So' le e avisa; nunca altera copias.
// Se o armazenamento nao puder ser lido, o proprio aviso diz isso (e' um achado).
@Injectable()
export class BackupReviewService {
  private readonly logger = new Logger(BackupReviewService.name);

  constructor(private readonly config: ConfigService, private readonly telegram: TelegramService) {}

  protected createR2(config: R2Config): R2Client { return new R2Client(config); }

  @Cron('0 12 2 * *')
  async sendMonthlyReview() {
    const r2 = {
      accountId: this.config.get<string>('R2_ACCOUNT_ID'),
      bucket: this.config.get<string>('R2_BUCKET'),
      accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID'),
      secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY'),
    };
    let message: string;
    if (!r2.accountId || !r2.bucket || !r2.accessKeyId || !r2.secretAccessKey) {
      message = '📋 Revisão mensal do backup\n\n⚠️ O armazenamento do backup não está configurado neste servidor, então não consegui ler as cópias. Isso precisa de atenção: peça ao Claude para conferir as variáveis do backup.';
    } else {
      try {
        const objects = await this.createR2(r2 as R2Config).listObjects(BACKUP_PREFIX);
        message = buildBackupReviewMessage(objects);
      } catch (error) {
        const detail = redactSecrets(error, [r2.secretAccessKey, r2.accessKeyId]);
        this.logger.warn(`Revisao mensal do backup: nao consegui listar as copias: ${detail}`);
        message = `📋 Revisão mensal do backup\n\n⚠️ Não consegui ler as cópias no armazenamento agora (${String(detail).slice(0, 160)}). Peça ao Claude para investigar.`;
      }
    }
    await this.telegram.notifyCoach(message).catch((error) => this.logger.warn(`Revisao mensal do backup: Telegram indisponivel: ${(error as Error).message}`));
  }
}
