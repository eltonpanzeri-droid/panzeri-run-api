import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { buildCorosConnector } from '../src/coros/coros.connector';
import { buildZeppConnector } from '../src/zepp/zepp.connector';

// 30/10/2026: o conector COROS usava a categoria "profile" no grupo "account" sem declara-la; o registro recusa isso em onModuleInit e a API INTEIRA
// caiu ao subir em producao (bolinha amarela no EasyPanel). Este teste registra cada conector REAL no registro REAL, como a subida faz.
describe('registro dos conectores reais (o que a API faz ao subir)', () => {
  const config = new ConfigService({});
  it.each([
    ['zepp', () => buildZeppConnector(config)],
    ['coros', () => buildCorosConnector(config)],
  ])('conector %s e aceito pelo registro', (_id, build) => {
    expect(() => new ConnectorRegistry().register(build())).not.toThrow();
  });
});
