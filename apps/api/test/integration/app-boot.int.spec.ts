import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrescriptionTraceService } from '../../src/training-plans/prescription-trace.service';
import { TrainingPlansService } from '../../src/training-plans/training-plans.service';
import { createTestPrisma, testDatabaseUrl } from './pg-guard';

// A API SOBE com o grafo real de modulos contra o PostgreSQL local de teste (migrations aplicadas): a injecao das novas pecas
// (rastreabilidade) esta correta e nenhum provedor falha na inicializacao. Sem chaves de IA/pagamento: tudo cai nos caminhos "nao configurado".
describe('inicializacao da API (grafo real de modulos, banco local de teste)', () => {
  it('sobe, injeta a rastreabilidade no TrainingPlansService e responde a consultas no banco local', async () => {
    createTestPrisma(); // fixa DATABASE_URL e valida que e' banco local de teste
    process.env.DATABASE_URL = testDatabaseUrl();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-local';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const plans = app.get(TrainingPlansService) as unknown as { trace?: PrescriptionTraceService };
      expect(plans.trace).toBeInstanceOf(PrescriptionTraceService);
      expect(app.get(PrescriptionTraceService).retentionMonths()).toBe(12);
    } finally {
      await app.close();
    }
  });
});
