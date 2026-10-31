import { ConfigService } from '@nestjs/config';
import { DataDeletionCapability, ProviderConnector, SyncCapability } from '../provider-hub/provider-connector';
import { CorosOAuth, CorosRevocation } from './coros-oauth';
import { COROS_CONSENT } from './coros-consent';

export const COROS_PROVIDER_ID = 'coros';

// Conector COROS (30/10/2026): conexao OAuth (COROS MCP), consentimento por grupo/finalidade, revogacao, importacao de atividades por CONSULTA periodica (a COROS so' tem webhook na
// Partner API, que segue em analise) e envio de treinos ao calendario (publicador proprio). Fica inerte ate: COROS_CLIENT_ID + COROS_REDIRECT_URI + COROS_TOKEN_ENCRYPTION_KEY definidos,
// COROS_ENABLED_USER_IDS (quem pode conectar, fail-closed), COROS_SYNC_ENABLED=true (importa atividades) e COROS_WORKOUT_PUBLISH_ENABLED=true (envia treinos).
// "categories" declara o que o conector PODE entregar hoje; nao autoriza uso (a aluna autoriza por grupo, ver coros-consent.ts).
export interface CorosConnectorDeps {
  sync?: SyncCapability;
  dataDeletion?: DataDeletionCapability;
}

export function buildCorosConnector(config: ConfigService, deps: CorosConnectorDeps = {}): ProviderConnector {
  return {
    id: COROS_PROVIDER_ID,
    displayName: 'COROS',
    categories: ['activity', 'activity_route', 'activity_sensors', 'profile'],
    consent: COROS_CONSENT,
    oauth: new CorosOAuth(config),
    revocation: new CorosRevocation(config),
    ...(deps.sync ? { sync: deps.sync } : {}),
    ...(deps.dataDeletion ? { dataDeletion: deps.dataDeletion } : {}),
  };
}
