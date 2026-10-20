import { Module } from '@nestjs/common';
import { ConnectorRegistry } from './connector-registry';

// O registro de conectores em modulo proprio e sem dependencias: o ProviderHubModule (conexoes, fila) e o AiGovernanceModule (elegibilidade para IA) precisam
// enxergar a MESMA instancia sem que um dependa do outro.
@Module({ providers: [ConnectorRegistry], exports: [ConnectorRegistry] })
export class ConnectorRegistryModule {}
