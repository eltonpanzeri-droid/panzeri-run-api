import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { TelegramService } from '../billing/telegram.service';
import { decryptBuffer, encryptBuffer, parseBackupKey } from './backup-crypto';
import { redactSecrets } from './backup-sanitize';
import { R2Client, R2Config } from './r2-client';

// Ledger de tombstones (05/10/2026) — registro EXTERNO ao PostgreSQL das exclusoes que uma restauracao nao pode
// desfazer. Vive no mesmo bucket do R2, em prefixo proprio (a regra de ciclo de vida de 14 dias dos dumps
// cobre SO' panzeri-backups/db/; a de 365 dias cobre SO' panzeri-backups/tombstones/).
//
// Regra de consistencia: o tombstone e' gravado e CONFIRMADO (HEAD: tamanho + MD5) ANTES da exclusao local. Se
// nao puder ser confirmado, a operacao destrutiva falha antes de apagar qualquer coisa e um alerta e' enviado.
// Conteudo: JSON cifrado (AES-256-GCM, BACKUP_ENCRYPTION_KEY) com v, type, userId, provider?, at — sem nome,
// e-mail, CPF nem conteudo. Nome do objeto sem PII. Nao e' banco de historico: so' o minimo para reaplicar.
// Desconexao simples NAO gera tombstone: o fail-closed global pos-restauracao ja' desconecta todas as
// conexoes restauradas, entao o tombstone nao acrescentaria nada.

export const TOMBSTONE_PREFIX = 'panzeri-backups/tombstones/';
export const TOMBSTONE_RETENTION_DAYS = 365; // aplicado por Lifecycle Rule no R2 (ver runbook); nunca apagado pelo codigo

export type TombstoneType = 'provider_data_deleted' | 'account_deleted';

export interface Tombstone {
  v: 1;
  type: TombstoneType;
  userId: string;
  provider?: string;
  at: string; // ISO
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PROVIDER_PATTERN = /^[a-z0-9_-]{1,32}$/;
const TYPES: TombstoneType[] = ['provider_data_deleted', 'account_deleted'];

export class TombstoneUnavailableError extends ServiceUnavailableException {
  constructor() {
    super('Nao foi possivel registrar a exclusao com seguranca; nada foi apagado. Tente novamente mais tarde.');
  }
}

export function buildTombstone(input: { type: TombstoneType; userId: string; provider?: string }, now: Date = new Date()): Tombstone {
  if (!TYPES.includes(input.type)) throw new Error('Tipo de tombstone invalido.');
  if (!ID_PATTERN.test(input.userId)) throw new Error('userId invalido para tombstone.');
  if (input.provider !== undefined && !PROVIDER_PATTERN.test(input.provider)) throw new Error('provider invalido para tombstone.');
  const tombstone: Tombstone = { v: 1, type: input.type, userId: input.userId, at: now.toISOString() };
  if (input.provider !== undefined) tombstone.provider = input.provider;
  return tombstone;
}

export function parseTombstone(raw: unknown): Tombstone {
  const t = raw as Partial<Tombstone> | null;
  if (!t || t.v !== 1 || !TYPES.includes(t.type as TombstoneType) || typeof t.userId !== 'string' || !ID_PATTERN.test(t.userId)
    || typeof t.at !== 'string' || Number.isNaN(Date.parse(t.at))
    || (t.provider !== undefined && !(typeof t.provider === 'string' && PROVIDER_PATTERN.test(t.provider)))) {
    throw new Error('Tombstone com formato invalido.');
  }
  return t as Tombstone;
}

export function tombstoneObjectKey(now: Date = new Date(), suffix: string = randomBytes(4).toString('hex')): string {
  return `${TOMBSTONE_PREFIX}${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}-${suffix}.tomb.enc`;
}

@Injectable()
export class TombstoneLedger {
  private readonly logger = new Logger(TombstoneLedger.name);

  constructor(private readonly config: ConfigService, private readonly telegram: TelegramService) {}

  protected createR2(config: R2Config): R2Client { return new R2Client(config); }

  private settings() {
    const r2 = {
      accountId: this.config.get<string>('R2_ACCOUNT_ID'), bucket: this.config.get<string>('R2_BUCKET'),
      accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID'), secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY'),
    };
    const keyRaw = this.config.get<string>('BACKUP_ENCRYPTION_KEY');
    const secrets = [keyRaw, r2.secretAccessKey, r2.accessKeyId];
    if (!r2.accountId || !r2.bucket || !r2.accessKeyId || !r2.secretAccessKey || !keyRaw) {
      throw Object.assign(new Error('Ledger de tombstones nao configurado (variaveis R2_* / BACKUP_ENCRYPTION_KEY ausentes).'), { secrets });
    }
    return { client: this.createR2(r2 as R2Config), key: parseBackupKey(keyRaw), secrets };
  }

  async alert(text: string) {
    await this.telegram.notifyCoach(text).catch(() => undefined);
  }

  // Grava e CONFIRMA o tombstone. Qualquer falha => alerta + TombstoneUnavailableError (HTTP 503), sem vazar credencial.
  async record(input: { type: TombstoneType; userId: string; provider?: string }): Promise<string> {
    let secrets: Array<string | undefined> = [];
    try {
      const tombstone = buildTombstone(input);
      const settings = this.settings();
      secrets = settings.secrets;
      const body = encryptBuffer(Buffer.from(JSON.stringify(tombstone), 'utf8'), settings.key);
      const objectKey = tombstoneObjectKey(new Date(tombstone.at));
      await settings.client.putObjectBuffer(objectKey, body, { format: 'pztb1' });
      const head = await settings.client.headObject(objectKey);
      const md5 = createHash('md5').update(body).digest('hex');
      if (!head || head.size !== body.length || (head.etag && head.etag.toLowerCase() !== md5)) {
        throw new Error('Tombstone nao confirmado no armazenamento (tamanho/ETag divergentes).');
      }
      return objectKey;
    } catch (error) {
      const reason = redactSecrets(error, [...secrets, ...((error as { secrets?: string[] }).secrets ?? [])]);
      this.logger.error(`Tombstone nao confirmado (${input.type}): ${reason}`);
      await this.alert(`ALERTA: exclusao BLOQUEADA — o tombstone externo nao pode ser confirmado, nada foi apagado.\nOperacao: ${input.type}${input.provider ? ` (${input.provider})` : ''}\nMotivo: ${reason}`);
      throw new TombstoneUnavailableError();
    }
  }

  // Carrega TODOS os tombstones (usado na restauracao). Qualquer falha (R2 fora, chave errada, objeto corrompido)
  // propaga: a restauracao nao pode ser declarada concluida com o ledger incompleto.
  async loadAll(): Promise<Tombstone[]> {
    const { client, key } = this.settings();
    const objects = await client.listObjects(TOMBSTONE_PREFIX);
    const tombstones: Tombstone[] = [];
    for (const object of objects) {
      if (!object.key.startsWith(TOMBSTONE_PREFIX)) continue;
      tombstones.push(parseTombstone(JSON.parse(decryptBuffer(await client.getObjectBuffer(object.key), key).toString('utf8'))));
    }
    return tombstones.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
}
