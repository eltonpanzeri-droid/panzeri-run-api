// AMBIENTE LOCAL DE VALIDACAO MANUAL da exclusao de conta (nao e' teste automatizado nem roda em producao).
// Sobe a API REAL (grafo completo de modulos, JWT, guards, limite de tentativas, regras de exclusao) contra o PostgreSQL LOCAL de teste. Recusa qualquer banco
// que nao seja loopback e terminado em _test (pg-guard). So' dois pontos externos sao simulados, para NUNCA tocar em servico real:
//   - TombstoneLedger (R2): em memoria;
//   - situacao/cancelamento da assinatura (Asaas): conforme o CENARIO escolhido.
// Uso: veja tools/validacao-exclusao-iphone/LEIA-ME.md
import 'reflect-metadata';
import { BadGatewayException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { TombstoneLedger } from '../../src/backup/tombstone-ledger';
import { BillingService } from '../../src/billing/billing.service';
import { assertSafeTestDatabaseUrl, createTestPrisma } from '../integration/pg-guard';

type Exposure = { channel: 'asaas' | 'store' | 'none'; live: 'yes' | 'no' | 'unknown'; pendingCharges: 'yes' | 'no' | 'unknown'; asaasSubscriptionId: string | null };
const SCENARIOS: Record<string, { exposure: Exposure; cancelWorks: boolean; about: string }> = {
  'sem-assinatura': { exposure: { channel: 'none', live: 'no', pendingCharges: 'no', asaasSubscriptionId: null }, cancelWorks: true, about: 'sem cobranca recorrente: exclusao direta' },
  'asaas-ativa': { exposure: { channel: 'asaas', live: 'yes', pendingCharges: 'yes', asaasSubscriptionId: 'sub_TESTE_LOCAL' }, cancelWorks: true, about: 'assinatura Asaas ativa; "cancelar junto" funciona' },
  'asaas-ativa-cancelamento-falha': { exposure: { channel: 'asaas', live: 'yes', pendingCharges: 'yes', asaasSubscriptionId: 'sub_TESTE_LOCAL' }, cancelWorks: false, about: 'assinatura Asaas ativa; o cancelamento FALHA (conta deve ficar intacta)' },
  'asaas-suspensa-com-cobranca': { exposure: { channel: 'asaas', live: 'no', pendingCharges: 'yes', asaasSubscriptionId: 'sub_TESTE_LOCAL' }, cancelWorks: true, about: 'assinatura SUSPENSA no Asaas, mas com cobranca ja emitida em aberto' },
  'asaas-indisponivel': { exposure: { channel: 'asaas', live: 'unknown', pendingCharges: 'unknown', asaasSubscriptionId: 'sub_TESTE_LOCAL' }, cancelWorks: false, about: 'Asaas fora do ar: situacao desconhecida' },
  'asaas-cancelada': { exposure: { channel: 'asaas', live: 'no', pendingCharges: 'no', asaasSubscriptionId: 'sub_TESTE_LOCAL' }, cancelWorks: true, about: 'assinatura Asaas ja cancelada' },
  loja: { exposure: { channel: 'store', live: 'yes', pendingCharges: 'no', asaasSubscriptionId: null }, cancelWorks: false, about: 'assinatura pela loja (Google Play)' },
};

async function main() {
  // Trava de seguranca: so' banco local de teste.
  const url = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  createTestPrisma(url);
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-local-de-teste-nao-usar-em-producao';
  const name = process.env.CENARIO ?? 'sem-assinatura';
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`CENARIO invalido: ${name}. Opcoes: ${Object.keys(SCENARIOS).join(', ')}`);

  const ledger = { record: async () => 'tombstone-local-de-teste', alert: async () => undefined };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TombstoneLedger).useValue(ledger).compile();
  const app = moduleRef.createNestApplication();
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();

  const billing = app.get(BillingService, { strict: false });
  billing.getSubscriptionExposure = async () => scenario.exposure;
  billing.cancelAsaasSubscriptionForAccountDeletion = async () => {
    if (!scenario.cancelWorks) throw new BadGatewayException('(simulado) cancelamento recusado pelo Asaas');
    console.log('[simulado] assinatura Asaas cancelada');
  };

  const port = Number(process.env.PORT ?? 3333);
  await app.listen(port, '0.0.0.0');
  console.log(`\nAPI LOCAL DE TESTE no ar na porta ${port}. Cenario: ${name} (${scenario.about}).\nBanco: ${new URL(url).host}${new URL(url).pathname} (somente teste). Asaas e R2 SIMULADOS.\n`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
