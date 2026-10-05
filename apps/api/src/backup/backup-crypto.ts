import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { open, rm } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';

// Criptografia do backup (05/10/2026): AES-256-GCM em streaming, com chave INDEPENDENTE
// (BACKUP_ENCRYPTION_KEY, 64 hex = 32 bytes — mesmo formato das demais chaves do projeto, mas nunca a
// POLAR_TOKEN_ENCRYPTION_KEY). Formato do arquivo (.dump.enc):
//   [ "PZBK1\n" (6 bytes, tambem usado como AAD) ][ IV (12 bytes) ][ ciphertext ][ tag GCM (16 bytes) ]
// A chave nunca entra no arquivo, no nome nem nos metadados. Sem a chave o backup e' irrecuperavel.

export const BACKUP_MAGIC = Buffer.from('PZBK1\n', 'utf8');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = BACKUP_MAGIC.length + IV_LENGTH;

export function parseBackupKey(raw: string | undefined | null): Buffer {
  const value = raw?.trim();
  if (!value || !/^[\da-fA-F]{64}$/.test(value)) {
    throw new Error('BACKUP_ENCRYPTION_KEY ausente ou invalida (esperado: 64 caracteres hexadecimais).');
  }
  return Buffer.from(value, 'hex');
}

export interface EncryptedFileInfo {
  size: number;
  sha256: string;
  md5: string;
}

// Criptografa src -> dest. Devolve tamanho, sha256 e md5 do ARQUIVO CIFRADO (para conferir o upload).
export async function encryptFile(src: string, dest: string, key: Buffer): Promise<EncryptedFileInfo> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(BACKUP_MAGIC);
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  let size = 0;
  let headerSent = false;
  const emit = (stream: Transform, chunk: Buffer) => { sha256.update(chunk); md5.update(chunk); size += chunk.length; stream.push(chunk); };
  const sink = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!headerSent) { headerSent = true; emit(this, Buffer.concat([BACKUP_MAGIC, iv])); }
      emit(this, chunk);
      callback();
    },
    flush(callback) {
      if (!headerSent) { headerSent = true; emit(this, Buffer.concat([BACKUP_MAGIC, iv])); }
      emit(this, cipher.getAuthTag());
      callback();
    },
  });
  try {
    await pipeline(createReadStream(src), cipher, sink, createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    await rm(dest, { force: true }).catch(() => undefined);
    throw error;
  }
  return { size, sha256: sha256.digest('hex'), md5: md5.digest('hex') };
}

// Descriptografa src -> dest, verificando a tag GCM. Chave errada ou arquivo alterado => erro e dest removido.
export async function decryptFile(src: string, dest: string, key: Buffer): Promise<void> {
  const handle = await open(src, 'r');
  let header: Buffer;
  let tag: Buffer;
  let total: number;
  try {
    total = (await handle.stat()).size;
    if (total < HEADER_LENGTH + TAG_LENGTH) throw new Error('Arquivo de backup invalido (muito curto).');
    header = Buffer.alloc(HEADER_LENGTH);
    await handle.read(header, 0, HEADER_LENGTH, 0);
    tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(tag, 0, TAG_LENGTH, total - TAG_LENGTH);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new Error('Formato de backup desconhecido.');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(BACKUP_MAGIC.length));
  decipher.setAAD(BACKUP_MAGIC);
  decipher.setAuthTag(tag);
  try {
    const body = total - HEADER_LENGTH - TAG_LENGTH;
    const source = body > 0 ? createReadStream(src, { start: HEADER_LENGTH, end: HEADER_LENGTH + body - 1 }) : Readable.from([]);
    await pipeline(source, decipher, createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
  } catch {
    await rm(dest, { force: true }).catch(() => undefined);
    throw new Error('Nao foi possivel descriptografar: chave incorreta ou backup corrompido.');
  }
}
