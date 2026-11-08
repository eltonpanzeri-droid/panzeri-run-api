import { ConfigService } from '@nestjs/config';
import { DataDeletionCapability, ProviderConnector } from '../provider-hub/provider-connector';
import { GarminOAuth, GarminRevocation } from './garmin-oauth';
import { GARMIN_CONSENT } from './garmin-consent';

export const GARMIN_PROVIDER_ID = 'garmin';

// Conector Garmin (08/11/2026) — LOTE 1: conexao OAuth2 PKCE, consentimento por grupo/finalidade, desconexao com DELETE /user/registration e aviso de desregistro. Ainda NAO importa dados
// (lote 2: Activity e Health por push) nem envia treinos (lote 3: Training API). Fica inerte ate: GARMIN_CLIENT_ID + GARMIN_CLIENT_SECRET + GARMIN_REDIRECT_URI + GARMIN_TOKEN_ENCRYPTION_KEY
// definidos e GARMIN_ENABLED_USER_IDS (quem pode conectar, fail-closed). "categories" declara o que o conector PODE entregar; nao autoriza uso (a aluna autoriza por grupo).
export interface GarminConnectorDeps {
  dataDeletion?: DataDeletionCapability;
}

export function buildGarminConnector(config: ConfigService, deps: GarminConnectorDeps = {}): ProviderConnector {
  return {
    id: GARMIN_PROVIDER_ID,
    displayName: 'Garmin',
    categories: ['activity', 'activity_sensors', 'sleep', 'hrv', 'daily_activity', 'resting_heart_rate', 'lifestyle_load', 'profile'],
    consent: GARMIN_CONSENT,
    oauth: new GarminOAuth(config),
    revocation: new GarminRevocation(config),
    ...(deps.dataDeletion ? { dataDeletion: deps.dataDeletion } : {}),
  };
}
