import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// Pareamento do relogio Wear OS por codigo curto (17/11/2026, fase 1 do Wear OS). A aluna nunca digita senha no relogio: o relogio mostra um codigo, ela confirma no Panzeri Run (logada) e o relogio
// recebe uma credencial PROPRIA, so' de leitura dos treinos dela. Nada de segredo e' guardado em claro: codigo, segredo de consulta e credencial ficam so' como hash SHA-256.

export const PAIRING_CODE_LENGTH = 8;
// sem 0/O, 1/I/L (confundiveis ao digitar); 31 simbolos ^ 8 = ~8,5e11 combinacoes, validos por 10 minutos e confirmados so' por aluna logada com limite de tentativas
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_TTL_MS = 10 * 60_000;
export const MAX_ACTIVE_WEAR_DEVICES = 5;

export function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  return code;
}

// "abcd-efgh", " ABCD EFGH " -> "ABCDEFGH". Devolve null quando o formato nao e' de um codigo.
export function normalizePairingCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== PAIRING_CODE_LENGTH) return null;
  for (const char of cleaned) if (!PAIRING_ALPHABET.includes(char)) return null;
  return cleaned;
}

export const displayPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
export const generateSecret = () => randomBytes(32).toString('base64url');

export function secretsMatch(secret: string, expectedHash: string | null): boolean {
  if (!expectedHash) return false;
  const given = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
