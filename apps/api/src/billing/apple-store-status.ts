import { createPrivateKey, sign } from 'crypto';

// 18/10/2026: consulta DIRETA a Apple (App Store Server API) para confirmar se uma assinatura da loja ainda esta vigente. O RevenueCat continua sendo o
// caminho principal; esta consulta so' REFINA o resultado dele e so' tem poder de CONFIRMAR EXPIRACAO (a Apple e' a fonte da verdade quando o RevenueCat
// esta desatualizado, como no caso real do aluno de teste em que cancelamento e expiracao nunca chegaram ao RevenueCat). Nao concede acesso por conta propria.
//
// Credenciais (somente variaveis de ambiente do servidor; nunca no app, no repositorio ou em log):
//   APPLE_IAP_KEY_ID       id da chave "In-App Purchase" (App Store Connect > Usuarios e Acesso > Integracoes > In-App Purchase)
//   APPLE_IAP_ISSUER_ID    issuer id da mesma pagina
//   APPLE_IAP_PRIVATE_KEY  conteudo do arquivo .p8 (aceita quebras de linha reais ou "\n" literais)
//   APPLE_BUNDLE_ID        opcional; padrao com.panzerirun.app

export type AppleSubscriptionVerdict = 'active' | 'expired' | 'unknown';

type AppleStatusResponse = {
  data?: Array<{ lastTransactions?: Array<{ originalTransactionId?: string; status?: number; signedTransactionInfo?: string }> }>;
};

const PRODUCTION_BASE = 'https://api.storekit.itunes.apple.com';
const SANDBOX_BASE = 'https://api.storekit-sandbox.itunes.apple.com';
const APPLE_TIMEOUT_MS = 8_000;

export type AppleCredentials = { keyId: string; issuerId: string; privateKey: string; bundleId: string };

// Normaliza a chave .p8 vinda de variavel de ambiente: aceita quebras de linha reais, "\n" literais, aspas ao redor e quebras viradas em espacos, e reconstroi o PEM
// PKCS#8 (corpo base64 em linhas de 64 caracteres). Devolve null se nao houver corpo. (Caso real 18/10/2026: DECODER routines::unsupported com a chave colada no EasyPanel.)
export function normalizeApplePrivateKey(raw: string): string | null {
  const body = raw
    .replace(/-----BEGIN [A-Z ]*-----/g, '')
    .replace(/-----END [A-Z ]*-----/g, '')
    .replace(/\\n/g, '')
    .replace(/["'\s]/g, '');
  if (!body) return null;
  return `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PRIVATE KEY-----`;
}

export function readAppleCredentials(get: (key: string) => string | undefined): AppleCredentials | null {
  const keyId = get('APPLE_IAP_KEY_ID')?.trim();
  const issuerId = get('APPLE_IAP_ISSUER_ID')?.trim();
  const rawKey = get('APPLE_IAP_PRIVATE_KEY');
  if (!keyId || !issuerId || !rawKey?.trim()) return null;
  const privateKey = normalizeApplePrivateKey(rawKey);
  if (!privateKey) return null;
  return { keyId, issuerId, privateKey, bundleId: get('APPLE_BUNDLE_ID')?.trim() || 'com.panzerirun.app' };
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

// JWT ES256 exigido pela App Store Server API (validade maxima de 60 min; usamos 10).
export function buildAppleJwt(credentials: AppleCredentials, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: credentials.issuerId, iat: nowSeconds, exp: nowSeconds + 600, aud: 'appstoreconnect-v1', bid: credentials.bundleId }));
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: createPrivateKey(credentials.privateKey), dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}

function decodeJwsPayload(jws: string | undefined): Record<string, unknown> | null {
  const part = jws?.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Interpreta a resposta: status 1 (ativa), 3 (nova tentativa de cobranca) e 4 (periodo de tolerancia) preservam o acesso; 2 (expirada) e 5 (revogada) confirmam
// expiracao. Qualquer outra coisa ou resposta sem transacoes e' "unknown" (nunca expiracao).
export function interpretAppleStatuses(body: AppleStatusResponse, transactionId: string): AppleSubscriptionVerdict {
  const transactions = (body.data ?? []).flatMap((group) => group.lastTransactions ?? []);
  if (transactions.length === 0) return 'unknown';
  // Prefere a transacao da propria assinatura consultada (mesmo originalTransactionId do JWS); se nada casar, considera todas do grupo.
  const matching = transactions.filter((tx) => {
    const info = decodeJwsPayload(tx.signedTransactionInfo);
    return info && (String(info.transactionId) === transactionId || String(info.originalTransactionId) === transactionId || tx.originalTransactionId === transactionId);
  });
  const considered = matching.length > 0 ? matching : transactions;
  const statuses = considered.map((tx) => tx.status);
  if (statuses.some((status) => status === 1 || status === 3 || status === 4)) return 'active';
  if (statuses.length > 0 && statuses.every((status) => status === 2 || status === 5)) return 'expired';
  return 'unknown';
}

// Consulta a Apple. Lanca erro em falha de rede/HTTP/credencial (o chamador preserva o estado). isSandbox: true/false quando o RevenueCat informa; undefined tenta
// producao e, se a Apple disser que a transacao nao existe la (404), tenta o Sandbox.
export async function fetchAppleSubscriptionVerdict(credentials: AppleCredentials, transactionId: string, isSandbox: boolean | undefined): Promise<AppleSubscriptionVerdict> {
  const bases = isSandbox === true ? [SANDBOX_BASE] : isSandbox === false ? [PRODUCTION_BASE] : [PRODUCTION_BASE, SANDBOX_BASE];
  const token = buildAppleJwt(credentials);
  let lastStatus = 0;
  for (const base of bases) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), APPLE_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      lastStatus = response.status;
      if (response.status === 404 && bases.length > 1 && base === PRODUCTION_BASE) continue; // pode estar no Sandbox
      if (response.status === 404) return 'unknown';
      if (!response.ok) throw new Error(`Apple HTTP ${response.status}`);
      return interpretAppleStatuses((await response.json()) as AppleStatusResponse, transactionId);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastStatus === 404) return 'unknown';
  throw new Error('Consulta a Apple sem resposta.');
}
