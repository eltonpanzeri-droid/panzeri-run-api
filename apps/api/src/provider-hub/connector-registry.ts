import { Injectable } from '@nestjs/common';
import { capabilitiesOf, ConnectorCapabilityKey, ProviderConnector } from './provider-connector';

// Provedores que JA' tem fluxo proprio em producao. A Central Universal nao os assume (decisao de 19/10/2026: so' provedores novos usam a estrutura
// generica por enquanto) — registrar um conector com um destes ids e' recusado, para nunca haver dois caminhos gravando o mesmo provedor.
export const LEGACY_PROVIDER_IDS: readonly string[] = ['polar', 'wahoo', 'strava', 'apple_health', 'health_connect'];

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<string, ProviderConnector>();

  register(connector: ProviderConnector): void {
    const id = connector.id;
    if (typeof id !== 'string' || !PROVIDER_ID_PATTERN.test(id)) throw new Error(`Id de conector invalido: "${String(id)}" (use minusculas, numeros e _).`);
    if (LEGACY_PROVIDER_IDS.includes(id)) throw new Error(`O provedor "${id}" ja' tem fluxo proprio e nao usa a Central Universal.`);
    if (this.connectors.has(id)) throw new Error(`Conector "${id}" ja' registrado.`);
    // Webhook sem processador deixaria eventos parados na fila para sempre.
    if (connector.webhook && !connector.events) throw new Error(`Conector "${id}" declara webhook sem a capacidade "events" para processar o que chega.`);
    this.connectors.set(id, connector);
  }

  get(id: string): ProviderConnector | undefined {
    return this.connectors.get(id);
  }

  list(): ProviderConnector[] {
    return [...this.connectors.values()];
  }

  // Conectores que oferecem uma capacidade especifica (ex.: todos que tem OAuth).
  withCapability(key: ConnectorCapabilityKey): ProviderConnector[] {
    return this.list().filter((connector) => capabilitiesOf(connector).includes(key));
  }
}
