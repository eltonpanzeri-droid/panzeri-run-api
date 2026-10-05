import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Cifra de tokens OAuth em repouso (05/10/2026). Mesmo formato seguro ja usado para os tokens da Polar
// (AES-256-GCM, "v1:iv:tag:dado" em base64url), mas com chave PROPRIA por provider — o Strava usa
// STRAVA_TOKEN_ENCRYPTION_KEY (64 hex), nunca a chave da Polar. Sem a chave nenhum token novo e' gravado.

export function parseTokenKey(raw: string | undefined | null): Buffer {
  const value = raw?.trim();
  if (!value || !/^[\da-fA-F]{64}$/.test(value)) throw new Error('Chave de cifra de tokens ausente ou invalida (esperado: 64 hexadecimais).');
  return Buffer.from(value, 'hex');
}

export const isEncryptedToken = (value: string) => value.startsWith('v1:') && value.split(':').length === 4;

export function encryptToken(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptToken(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Token armazenado em formato invalido.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
}
