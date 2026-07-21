import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { EmailService } from '../messaging/email.service';

const execAsync = promisify(exec);

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // 07:00 UTC = 04:00 no horario de Sao Paulo (UTC-3), fora do horario de uso do app.
  @Cron('0 7 * * *')
  async runScheduledBackup() {
    const result = await this.runBackup();
    if (!result.ok) {
      this.logger.error(`Backup diario falhou: ${result.error}`);
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
