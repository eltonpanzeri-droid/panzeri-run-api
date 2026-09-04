import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { EmailService } from '../messaging/email.service';
import { TelegramService } from '../billing/telegram.service';

const execAsync = promisify(exec);

// 04/09: achado numa revisao pensando em escala — o backup e enviado como ANEXO de e-mail (Resend),
// que tem um limite real de tamanho (a maioria dos provedores fica entre 25-40MB). Conforme o banco
// cresce com mais assinantes/mais historico, o dump pode ultrapassar isso um dia e o backup diario
// comecaria a falhar silenciosamente — antes disso, uma falha so ficava num log de servidor que
// ninguem olha. Nao mudei a forma de guardar o backup (mudar pra armazenamento em nuvem e' uma
// decisao de infraestrutura maior, fora do escopo de uma correcao de codigo sozinha), mas agora
// qualquer falha avisa o treinador no Telegram no mesmo dia, sem esperar precisar restaurar algo
// pra descobrir que os backups pararam.
const BACKUP_SIZE_WARNING_BYTES = 20 * 1024 * 1024;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly telegram: TelegramService,
  ) {}

  // 07:00 UTC = 04:00 no horario de Sao Paulo (UTC-3), fora do horario de uso do app.
  @Cron('0 7 * * *')
  async runScheduledBackup() {
    const result = await this.runBackup();
    if (!result.ok) {
      this.logger.error(`Backup diario falhou: ${result.error}`);
      await this.telegram.notifyCoach(`Falha no backup diario do banco de dados!\n\nMotivo: ${result.error}\n\nIsso precisa de atencao — sem backup de hoje, um problema no banco perderia dados mais recentes.`).catch(() => undefined);
    } else if (result.sizeBytes && result.sizeBytes > BACKUP_SIZE_WARNING_BYTES) {
      await this.telegram.notifyCoach(`Aviso: o backup diario de hoje ficou grande (${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB). Se continuar crescendo, pode um dia passar do limite de anexo do e-mail e o backup comecar a falhar sem aviso — vale considerar mudar pra armazenamento em nuvem antes disso acontecer.`).catch(() => undefined);
    }
  }

  async runBackup(): Promise<{ ok: boolean; error?: string; sizeBytes?: number }> {
    const databaseUrl = this.config.get<string>('DATABASE_URL');
    const backupEmailTo = this.config.get<string>('BACKUP_EMAIL_TO');

    if (!databaseUrl) {
      return { ok: false, error: 'DATABASE_URL nao configurado.' };
    }
    if (!backupEmailTo) {
      return { ok: false, error: 'BACKUP_EMAIL_TO nao configurado.' };
    }

    const today = new Date().toISOString().slice(0, 10);
    let tempDir: string | null = null;

    try {
      tempDir = await mkdtemp(join(tmpdir(), 'panzeri-backup-'));
      const dumpPath = join(tempDir, `panzeri-run-${today}.dump`);

      await execAsync(`pg_dump "${databaseUrl}" --format=custom --file="${dumpPath}"`);

      const content = await readFile(dumpPath);
      const result = await this.email.send(
        backupEmailTo,
        `Backup do banco Panzeri Run - ${today}`,
        `Backup automatico do banco de dados gerado em ${today}.\n\nPara restaurar: pg_restore --clean --if-exists -d SEU_BANCO ${`panzeri-run-${today}.dump`}\n\nGuarde este e-mail em local seguro.`,
        [{ filename: `panzeri-run-${today}.dump`, content }],
      );

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      this.logger.log(`Backup do banco enviado por e-mail (${content.length} bytes).`);
      return { ok: true, sizeBytes: content.length };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Falha ao gerar backup do banco: ${message}`);
      return { ok: false, error: message };
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}
