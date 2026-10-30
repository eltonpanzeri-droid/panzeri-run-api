import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { PhysiologyModule } from '../src/physiology/physiology.module';
import { OperationalReferenceService } from '../src/physiology/operational-reference.service';
import { TrainingPlansModule } from '../src/training-plans/training-plans.module';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { TechnicalManagerModule } from '../src/technical-manager/technical-manager.module';
import { ReassessmentModule } from '../src/reassessment/reassessment.module';
import { FitnessTestsModule } from '../src/fitness-tests/fitness-tests.module';

// Testes físicos, Lote 4: a referência operacional realmente chega (por injeção de dependência) à IA de prescrição, ao Gerente Técnico, ao Agente de Evolução
// e ao resumo do atleta. PrismaService é simulado; compile() não conecta no banco.
describe('Testes físicos (smoke de DI)', () => {
  it('os módulos que consomem a referência resolvem sem dependência faltante ou circular, e o serviço é injetado (não fica undefined)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PhysiologyModule, FitnessTestsModule, TrainingPlansModule, TechnicalManagerModule, ReassessmentModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    const reference = moduleRef.get(OperationalReferenceService);
    expect(reference).toBeDefined();
    const plans = moduleRef.get(TrainingPlansService) as unknown as { operationalReference?: OperationalReferenceService };
    expect(plans.operationalReference).toBe(reference);
  }, 60_000);
});
