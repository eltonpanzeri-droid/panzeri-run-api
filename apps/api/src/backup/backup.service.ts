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
// Wahoo (08/10/2026): tokens OAuth rotativos (o refresh token de um backup ja' foi invalidado pela rotacao) e verifiers PKCE
// nao entram nos dumps; apos uma restauracao o aluno reconecta (mesmo estado do fail-closed abaixo).
// ProviderInboundEvent (19/10/2026): fila transitoria de eventos de provedores novos; restaurar eventos antigos reprocessaria dado possivelmente ja' excluido.
// ProviderConnection/ProviderOAuthAttempt (19/10/2026): tokens cifrados e states da Central Universal; apos restauracao o aluno reconecta (mesma regra da Wahoo).
export const BACKUP_EXCLUDED_TABLE_DATA = ['StravaActivity', 'StravaConnection', 'StravaAnalysisCache', 'TrainingExecutionInsight', 'StravaOAuthAttempt', 'StravaWebhookEvent', 'WahooConnection', 'WahooOAuthAttempt', 'ProviderInboundEvent', 'ProviderConnection', 'ProviderOAuthAttempt'];
// 09/11/2026 (ordem do Elton: "aumentar o tamanho do backup, sem comprometer financeiramente e sem risco de perder dados"): o backup NAO tem limite de tamanho no codigo — o unico limite era o AVISO de 20 MB, que ja'
// disparava todo dia. Agora o aviso so' sobe por degraus (100, 250, 500, 1000, 2000 MB) e avisa UMA vez ao cruzar cada degrau, dizendo o custo estimado. Nada disso altera o que e' copiado, o formato, a
// criptografia nem a retencao de 14 dias.
export const BACKUP_SIZE_TIERS_MB = [100, 250, 500, 1000, 2000];
// Preco de tabela do Cloudflare R2 (armazenamento Standard) em US$ por GB-mes: valor de referencia para a estimativa do aviso; conferir no painel da Cloudflare (a Cloudflare costuma ter faixa gratuita).
export const R2_STORAGE_USD_PER_GB_MONTH = 0.015;

export function backupSizeAlert(sizeBytes: number, previousSizeBytes: number | null): { shouldAlert: boolean; tierMb: number | null; message: string } {
  const sizeMb = sizeBytes / 1024 / 1024;
  const tierMb = [...BACKUP_SIZE_TIERS_MB].reverse().find((tier) => sizeMb >= tier) ?? null;
  if (tierMb === null) return { shouldAlert: false, tierMb: null, message: '' };
  const previousMb = previousSizeBytes === null ? 0 : previousSizeBytes / 1024 / 1024;
  if (previousMb >= tierMb) return { shouldAlert: false, tierMb, message: '' };
  const totalGb = (sizeBytes * (BACKUP_RETENTION_DAYS + 1)) / 1024 ** 3;
  const usd = totalGb * R2_STORAGE_USD_PER_GB_MONTH;
  const nextTier = BACKUP_SIZE_TIERS_MB.find((tier) => tier > tierMb);
  return {
    shouldAlert: true,
    tierMb,
    message: [
      `Aviso de acompanhamento: o backup diario passou de ${tierMb} MB (hoje: ${sizeMb.toFixed(1)} MB).`,
      `O armazenamento guarda ${BACKUP_RETENTION_DAYS} dias de copias: cerca de ${totalGb.toFixed(2)} GB no total, estimado em US$ ${usd.toFixed(2)} por mes pelo preco de tabela do R2 (a Cloudflare costuma dar uma faixa gratuita; confira no painel dela).`,
      'Nenhum dado esta em risco: o backup nao tem limite de tamanho, isto e so um acompanhamento do crescimento do banco.',
      nextTier ? `Novo aviso so quando passar de ${nextTier} MB.` : 'Este e o ultimo degrau de aviso configurado.',
    ].join('\n'),
  };
}

export interface BackupResult {
  ok: boolean;
  error?: string;
  sizeBytes?: number;
  objectKey?: string;
  prunedObjects?: number;
  // Tamanho do backup anterior (o mais recente antes deste); null se nao havia. Usado so' pelo aviso de crescimento.
  previousSizeBytes?: number | null;
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
    } else if (result.sizeBytes) {
      const alert = backupSizeAlert(result.sizeBytes, result.previousSizeBytes ?? null);
      if (alert.shouldAlert) await this.telegram.notifyCoach(alert.message).catch(() => undefined);
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

      const pruned = await this.pruneOldBackups(client, objectKey, secrets);
      this.logger.log(`Backup criptografado enviado ao R2 (${info.size} bytes; ${pruned.removed} antigo(s) removido(s) pela retencao de ${BACKUP_RETENTION_DAYS} dias).`);
      return { ok: true, sizeBytes: info.size, objectKey, prunedObjects: pruned.removed, previousSizeBytes: pruned.previousSizeBytes };
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
  private async pruneOldBackups(client: R2Client, justUploaded: string, secrets: Array<string | undefined>): Promise<{ removed: number; previousSizeBytes: number | null }> {
    try {
      const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const objects = await client.listObjects(BACKUP_PREFIX);
      // Backup anterior = o mais recente entre os que nao sao o recem-enviado (so' para o aviso de crescimento; nunca decide exclusao).
      const previous = objects.filter((object) => object.key !== justUploaded && object.key.startsWith(BACKUP_PREFIX)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())[0];
      let removed = 0;
      for (const object of objects) {
        if (object.key === justUploaded || !object.key.startsWith(BACKUP_PREFIX) || object.lastModified.getTime() >= cutoff) continue;
        await client.deleteObject(object.key);
        removed++;
      }
      return { removed, previousSizeBytes: previous ? previous.size : null };
    } catch (error) {
      this.logger.warn(`Retencao de backups nao concluida: ${redactSecrets(error, secrets)}`);
      return { removed: 0, previousSizeBytes: null };
    }
  }
}
