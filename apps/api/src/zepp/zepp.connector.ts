import { ConfigService } from '@nestjs/config';
import { DataDeletionCapability, EventProcessingCapability, ProviderConnector, SyncCapability } from '../provider-hub/provider-connector';
import { ZeppOAuth, ZeppRevocation } from './zepp-oauth';
import { ZEPP_CONSENT } from './zepp-consent';

export const ZEPP_PROVIDER_ID = 'zepp';

// Conector Zepp/Amazfit. Passo 2: conexao (oauth), consentimento e revogacao. Lote 3 (20/10/2026): processamento dos eventos da fila (activity_file e authorization_change) e,
// no Lote 4, o pedido de historico (sync/backfill). NUNCA declara a capacidade "webhook" generica: o recebimento e' o controlador proprio (zepp-webhook.controller.ts) com
// segredo no caminho, porque a Zepp nao assina as requisicoes. Tudo fica inerte ate: ZEPP_WEBHOOK_SECRET definido (senao a rota responde 404), PROVIDER_HUB_WORKER_ENABLED=true
// (processa a fila), ZEPP_ENABLED_USER_IDS (quem pode conectar) e, para historico, ZEPP_BACKFILL_ENABLED=true.
// "categories" declara o que o conector PODE entregar; nao autoriza uso (o aluno autoriza por grupo, ver zepp-consent.ts).
export interface ZeppConnectorDeps {
  // Lote 3: processamento dos eventos da fila (download do FIT, leitura, gravacao) e pedido de historico (backfill). Opcionais: sem eles o conector so' conecta.
  events?: EventProcessingCapability;
  sync?: SyncCapability;
  dataDeletion?: DataDeletionCapability;
}

export function buildZeppConnector(config: ConfigService, deps: ZeppConnectorDeps = {}): ProviderConnector {
  return {
    id: ZEPP_PROVIDER_ID,
    displayName: 'Zepp / Amazfit',
    categories: ['activity', 'activity_route', 'activity_sensors', 'sleep', 'profile'],
    consent: ZEPP_CONSENT,
    oauth: new ZeppOAuth(config),
    revocation: new ZeppRevocation(),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.sync ? { sync: deps.sync } : {}),
    ...(deps.dataDeletion ? { dataDeletion: deps.dataDeletion } : {}),
  };
}
