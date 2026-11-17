import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WearModule } from '../src/wear/wear.module';
import { WearController, WearMeController } from '../src/wear/wear.controller';
import { WearActivityService } from '../src/wear/wear-activity.service';
import { WearConsentService } from '../src/wear/wear-consent.service';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';

// O modulo do relogio sobe de verdade no Nest (injecao de dependencias completa) e registra o conector. Banco simulado: nenhuma consulta e feita.
describe('WearModule no Nest', () => {
  it('compila com todas as dependencias do pipeline de atividades e registra o conector wear_os', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, WearModule] })
      .overrideProvider(PrismaService).useValue({})
      .compile();
    await moduleRef.init();
    expect(moduleRef.get(WearController)).toBeDefined();
    expect(moduleRef.get(WearMeController)).toBeDefined();
    expect(moduleRef.get(WearActivityService)).toBeDefined();
    expect(moduleRef.get(WearConsentService)).toBeDefined();
    expect(moduleRef.get(ConnectorRegistry).get('wear_os')?.displayName).toBe('Relógio Wear OS');
    await moduleRef.close();
  }, 120_000);
});
