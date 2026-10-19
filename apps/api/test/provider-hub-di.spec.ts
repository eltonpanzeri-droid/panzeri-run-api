import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProviderHubModule } from '../src/provider-hub/provider-hub.module';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { ProviderConnectionService } from '../src/provider-hub/provider-connection.service';
import { ProviderInboundEventService } from '../src/provider-hub/provider-inbound-event.service';
import { ZeppModule } from '../src/zepp/zepp.module';

// Injecao de dependencias dos modulos novos (a unica coisa que so aparecia no boot real). O Prisma e' substituido: nada conecta a banco algum.
describe('injecao de dependencias da Central Universal', () => {
  it('ProviderHubModule + ZeppModule resolvem; o conector Zepp e registrado so com oauth e revogacao', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), ProviderHubModule, ZeppModule],
    })
      .overrideProvider(PrismaService).useClass(class FakePrisma {})
      .compile();
    await moduleRef.init();

    expect(moduleRef.get(ProviderConnectionService, { strict: false })).toBeDefined();
    expect(moduleRef.get(ProviderInboundEventService, { strict: false })).toBeDefined();
    const connector = moduleRef.get(ConnectorRegistry, { strict: false }).get('zepp');
    expect(connector).toBeDefined();
    expect(Object.keys(connector!).filter((k) => ['oauth', 'webhook', 'events', 'sync', 'revocation', 'dataDeletion'].includes(k)).sort()).toEqual(['oauth', 'revocation']);
    await moduleRef.close();
  }, 60_000);
});
