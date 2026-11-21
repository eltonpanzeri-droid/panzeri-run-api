import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RunRecordingModule } from '../src/run-recording/run-recording.module';
import { RunRecordingController } from '../src/run-recording/run-recording.controller';
import { RunActivityService } from '../src/run-recording/run-activity.service';
import { RunConsentService } from '../src/run-recording/run-consent.service';

// O modulo de gravacao no Panzeri Run sobe de verdade no Nest (injecao de dependencias completa, incluindo o pipeline de atividades e a exclusao de dados do provedor). Banco simulado.
describe('RunRecordingModule no Nest', () => {
  it('compila com todas as dependencias e injeta a exclusao de dados do provedor no consentimento (nao fica undefined)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, RunRecordingModule] })
      .overrideProvider(PrismaService).useValue({})
      .compile();
    await moduleRef.init();
    expect(moduleRef.get(RunRecordingController)).toBeDefined();
    expect(moduleRef.get(RunActivityService)).toBeDefined();
    const consent = moduleRef.get(RunConsentService) as unknown as { providerData?: unknown };
    expect(consent.providerData).toBeDefined();
    await moduleRef.close();
  }, 120_000);
});
