import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Cifragem dos segredos Wahoo (AES-256-GCM, formato v1:iv:tag:dados). A chave e' SEMPRE a propria da Wahoo
// (WAHOO_TOKEN_ENCRYPTION_KEY); nunca a da Polar nem a do Strava.

export function encryptSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Credencial Wahoo armazenada em formato invalido.');
  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

// PKCE S256 (RFC 7636): challenge = BASE64URL(SHA256(verifier)). O verifier tem 43 caracteres (32 bytes aleatorios).
export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
