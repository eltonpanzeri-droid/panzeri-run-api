/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { buildAppleJwt, readAppleCredentials } from '../billing/apple-store-status';
import { normalizeReviewEmail, refreshReviewContent, reviewAccountStatus, reviewUserId, seedReviewAccount } from './review-accounts';

// Contas de demonstracao da App Store (24/10/2026). Ver RUNBOOKS/2026-10-24-CONTAS-REVISAO-APPLE.md.
//   node dist/app-review/cli.js status                 (somente leitura)
//   node dist/app-review/cli.js check-store            (somente leitura: credenciais presentes? RevenueCat aceita a chave secreta? -- nunca imprime valores)
//   node dist/app-review/cli.js seed --yes             (cria as contas; se ja existem, restaura SO' o conteudo e PRESERVA assinatura/acesso)
//   node dist/app-review/cli.js seed --yes --reset-access   (tambem devolve a assinatura ao estado inicial: A ativa, B expirada)
//   node dist/app-review/cli.js refresh                (renova o conteudo se a semana virou; a API ja faz isso sozinha todo dia as 4h)
// Variaveis (nunca gravadas em arquivo nem impressas): REVIEW_ACTIVE_EMAIL, REVIEW_ACTIVE_PASSWORD, REVIEW_EXPIRED_EMAIL, REVIEW_EXPIRED_PASSWORD.
// E-mails precisam comecar com "revisao-apple-". Nenhuma chamada de IA, cobranca ou escrita no RevenueCat/Apple.

const env = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Variavel ${name} ausente.`); return value; };
const present = (name: string) => Boolean(process.env[name]?.trim());

async function checkStore(expiredEmail: string) {
  const report: Record<string, unknown> = {
    REVENUECAT_SECRET_API_KEY: present('REVENUECAT_SECRET_API_KEY'),
    REVENUECAT_WEBHOOK_SECRET: present('REVENUECAT_WEBHOOK_SECRET'),
    APPLE_IAP_KEY_ID: present('APPLE_IAP_KEY_ID'),
    APPLE_IAP_ISSUER_ID: present('APPLE_IAP_ISSUER_ID'),
    APPLE_IAP_PRIVATE_KEY: present('APPLE_IAP_PRIVATE_KEY'),
    APPLE_BUNDLE_ID: present('APPLE_BUNDLE_ID'),
  };
  const credentials = readAppleCredentials((key) => process.env[key]);
  if (!credentials) report.appleCredentialsUsable = false;
  else { try { buildAppleJwt(credentials); report.appleCredentialsUsable = true; report.appleBundleId = credentials.bundleId; } catch { report.appleCredentialsUsable = false; } }
  if (present('REVENUECAT_SECRET_API_KEY')) {
    try {
      const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(reviewUserId(expiredEmail))}`, { headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET_API_KEY}`, 'Content-Type': 'application/json' } });
      const body = response.ok ? ((await response.json()) as { subscriber?: { subscriptions?: Record<string, unknown> } }) : null;
      report.revenueCatSecretKeyAccepted = response.ok;
      report.revenueCatHttpStatus = response.status;
      if (body) report.revenueCatSubscriptionsOfDemoExpiredAccount = Object.keys(body.subscriber?.subscriptions ?? {}).length;
    } catch { report.revenueCatSecretKeyAccepted = false; report.revenueCatHttpStatus = 'sem resposta'; }
  }
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const command = process.argv[2];
  const prisma = new PrismaClient();
  try {
    if (command === 'refresh') { console.log(JSON.stringify(await refreshReviewContent(prisma))); return; }
    const activeEmail = normalizeReviewEmail(env('REVIEW_ACTIVE_EMAIL'));
    const expiredEmail = normalizeReviewEmail(env('REVIEW_EXPIRED_EMAIL'));
    if (activeEmail === expiredEmail) throw new Error('Os dois e-mails precisam ser diferentes.');
    if (command === 'status') { console.log(JSON.stringify(await reviewAccountStatus(prisma, [activeEmail, expiredEmail]), null, 2)); return; }
    if (command === 'check-store') { await checkStore(expiredEmail); return; }
    if (command === 'seed') {
      if (!process.argv.includes('--yes')) throw new Error('Confirme com --yes (cria/restaura as contas de demonstracao).');
      const resetAccess = process.argv.includes('--reset-access');
      for (const spec of [
        { kind: 'active' as const, email: activeEmail, password: env('REVIEW_ACTIVE_PASSWORD') },
        { kind: 'expired' as const, email: expiredEmail, password: env('REVIEW_EXPIRED_PASSWORD') },
      ]) {
        const result = await seedReviewAccount(prisma, spec, new Date(), { resetAccess });
        console.log(`${result.kind}: ${result.created ? 'criada' : 'conteudo restaurado'}${resetAccess ? ' (assinatura redefinida)' : ''} (${result.email})`);
      }
      console.log(JSON.stringify(await reviewAccountStatus(prisma, [activeEmail, expiredEmail]), null, 2));
      return;
    }
    throw new Error('Use: status | check-store | seed --yes [--reset-access] | refresh');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
