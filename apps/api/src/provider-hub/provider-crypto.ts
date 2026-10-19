import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Cifragem generica dos segredos de provedores da Central (AES-256-GCM, formato v1:iv:tag:dados — o mesmo formato da Wahoo).
// A CHAVE e' sempre a propria do provedor, fornecida pelo conector; este arquivo nao conhece nenhuma chave.

export function encryptSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Credencial armazenada em formato invalido.');
  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function newState(): string {
  return randomBytes(32).toString('base64url');
}

// Valida uma chave hexadecimal de 32 bytes (64 caracteres) e a converte em Buffer.
export function parseHexKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  return value && /^[\da-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : null;
}
