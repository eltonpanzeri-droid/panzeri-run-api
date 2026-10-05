import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { TelegramService } from '../billing/telegram.service';
import { encryptFile, parseBackupKey } from './backup-crypto';
import { pgEnvFromUrl, redactSecrets, secretsFromDatabaseUrl } from './backup-sanitize';
import { R2Client, R2Config } from './r2-client';

const execFileAsync = promisify(execFile);

// Backup do banco (reescrito em 05/10/2026 — Bloco pre-Garmin 4).
// Fluxo: PostgreSQL -> pg_dump temporario -> AES-256-GCM (chave BACKUP_ENCRYPTION_KEY) -> upload no
// Cloudflare R2 -> conferencia (tamanho + ETag/MD5) -> remocao do temporario. O dump em claro nunca sai do
// servidor e NAO e mais enviado por e-mail (o Resend ficou so' com os e-mails normais do produto).
// Seguranca do pg_dump: sem shell e sem URL em argumento — a DATABASE_URL vira variaveis PG* do processo
// filho; toda mensagem de erro passa por redactSecrets antes de log/Telegram/HTTP.
// Retencao: 14 dias, aplicada AQUI por exclusao dos objetos antigos apos cada backup bem-sucedido (prefixo
// proprio, nunca toca em outros objetos). Recomenda-se TAMBEM uma Lifecycle Rule no bucket (ver runbook).

export const BACKUP_PREFIX = 'panzeri-backups/db/';
export const BACKUP_RETENTION_DAYS = 14;
// Dados de proveniencia Strava (cache de 7 dias, tokens e derivados) NAO entram nos dumps: as copias duram 14 dias e a
// regra Strava permite no maximo 7. So' a ESTRUTURA dessas tabelas vai no dump; o conteudo e' omitido na origem.
export const BACKUP_EXCLUDED_TABLE_DATA = ['StravaActivity', 'StravaConnection', 'StravaAnalysisCache', 'TrainingExecutionInsight', 'StravaOAuthAttempt', 'StravaWebhookEvent'];
const BACKUP_SIZE_WARNING_BYTES = 20 * 1024 * 1024;

export interface BackupResult {
  ok: boolean;
  error?: string;
  sizeBytes?: number;
  objectKey?: string;
  prunedObjects?: number;
}

export function backupObjectKey(now: Date = new Date(), suffix: string = randomBytes(4).toString('hex')): string {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return `${BACKUP_PREFIX}${stamp}-${suffix}.dump.enc`;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly config: ConfigService,
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
      await this.telegram.notifyCoach(`Aviso: o backup diario de hoje ficou grande (${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB). Acompanhe o crescimento do banco e o custo do armazenamento.`).catch(() => undefined);
    }
  }

  // Pontos de extensao (testes): nada de logica de negocio aqui.
  protected createR2(config: R2Config): R2Client { return new R2Client(config); }

  protected async runPgDump(env: Record<string, string>, dumpPath: string): Promise<void> {
    // execFile = SEM shell; nenhum argumento contem a URL (conexao vem das variaveis PG* do ambiente).
    await execFileAsync('pg_dump', ['--format=custom', '--file', dumpPath, ...BACKUP_EXCLUDED_TABLE_DATA.map((table) => `--exclude-table-data="${table}"`)], {
      env: { PATH: process.env.PATH ?? '', ...env },
      maxBuffer: 1024 * 1024,
    });
  }

  async runBackup(): Promise<BackupResult> {
    const databaseUrl = this.config.get<string>('DATABASE_URL');
    const encryptionKeyRaw = this.config.get<string>('BACKUP_ENCRYPTION_KEY');
    const r2 = {
      accountId: this.config.get<string>('R2_ACCOUNT_ID'),
      bucket: this.config.get<string>('R2_BUCKET'),
      accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID'),
      secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY'),
    };
    const secrets = [...secretsFromDatabaseUrl(databaseUrl), encryptionKeyRaw, r2.secretAccessKey, r2.accessKeyId];

    // Lista so' os NOMES das variaveis que faltam, nunca valores.
    const missing = [
      ['DATABASE_URL', databaseUrl], ['BACKUP_ENCRYPTION_KEY', encryptionKeyRaw], ['R2_ACCOUNT_ID', r2.accountId],
      ['R2_BUCKET', r2.bucket], ['R2_ACCESS_KEY_ID', r2.accessKeyId], ['R2_SECRET_ACCESS_KEY', r2.secretAccessKey],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) return { ok: false, error: `Backup nao configurado. Variaveis ausentes: ${missing.join(', ')}.` };

    let tempDir: string | null = null;
    try {
      const key = parseBackupKey(encryptionKeyRaw);
      const pgEnv = pgEnvFromUrl(databaseUrl as string);
      tempDir = await mkdtemp(join(tmpdir(), 'panzeri-backup-'));
      const dumpPath = join(tempDir, 'dump.pgcustom');
      const encPath = join(tempDir, 'dump.enc');

      // Instante de INICIO do dump = data confiavel do snapshot (o pg_dump enxerga o estado desse momento).
      const snapshotStartedAt = new Date();
      await this.runPgDump(pgEnv, dumpPath);
      const info = await encryptFile(dumpPath, encPath, key);
      // O dump em claro some assim que o cifrado existe — antes de qualquer envio.
      await rm(dumpPath, { force: true });

      const objectKey = backupObjectKey();
      const client = this.createR2(r2 as R2Config);
      await client.putObjectFromFile(objectKey, encPath, info, { format: 'pzbk1', created: snapshotStartedAt.toISOString() });

      // Confirmacao: o objeto existe com o tamanho e o MD5 esperados (ETag de PUT simples = MD5 do corpo).
      const head = await client.headObject(objectKey);
      if (!head || head.size !== info.size || (head.etag && head.etag.toLowerCase() !== info.md5)) {
        await client.deleteObject(objectKey).catch(() => undefined);
        return { ok: false, error: 'Falha ao confirmar o upload do backup no armazenamento (tamanho/ETag divergentes).' };
      }

      const prunedObjects = await this.pruneOldBackups(client, objectKey, secrets);
      this.logger.log(`Backup criptografado enviado ao R2 (${info.size} bytes; ${prunedObjects} antigo(s) removido(s) pela retencao de ${BACKUP_RETENTION_DAYS} dias).`);
      return { ok: true, sizeBytes: info.size, objectKey, prunedObjects };
    } catch (error) {
      const message = redactSecrets(error, secrets);
      this.logger.error(`Falha ao gerar backup do banco: ${message}`);
      return { ok: false, error: message };
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // Retencao de 14 dias: so' objetos com o nosso prefixo; nunca o objeto recem-enviado; falha aqui nao
  // invalida o backup (so' avisa no log, ja sanitizado).
  private async pruneOldBackups(client: R2Client, justUploaded: string, secrets: Array<string | undefined>): Promise<number> {
    try {
      const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const objects = await client.listObjects(BACKUP_PREFIX);
      let removed = 0;
      for (const object of objects) {
        if (object.key === justUploaded || !object.key.startsWith(BACKUP_PREFIX) || object.lastModified.getTime() >= cutoff) continue;
        await client.deleteObject(object.key);
        removed++;
      }
      return removed;
    } catch (error) {
      this.logger.warn(`Retencao de backups nao concluida: ${redactSecrets(error, secrets)}`);
      return 0;
    }
  }
}
