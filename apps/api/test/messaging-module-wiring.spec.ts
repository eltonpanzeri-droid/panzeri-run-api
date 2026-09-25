import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { MessagingModule } from '../src/messaging/messaging.module';

// 25/09/2026 — smoke test de DI: garante que o grafo de dependencias do MessagingModule resolve
// (NotificationTriggersService agora injeta MenstrualCycleService, que por sua vez injeta
// MathLayerService/LongitudinalDynamicsService via TrainingIntelligenceModule) sem tentar conectar
// no banco real — PrismaService e' sobrescrito por um mock, e .compile() nao chama onModuleInit.
// ConfigModule.forRoot({isGlobal:true}) e' necessario so' porque em producao ele vem do AppModule
// (global) — nao e' parte do grafo real que estamos validando aqui.
describe('MessagingModule (smoke de DI)', () => {
  it('resolve todos os providers sem erro de dependencia circular/faltante', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), MessagingModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef).toBeDefined();
  });
});
