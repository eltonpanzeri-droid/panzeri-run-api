import { ConfigService } from '@nestjs/config';
import { ProviderConnector } from '../provider-hub/provider-connector';
import { ZeppOAuth, ZeppRevocation } from './zepp-oauth';
import { ZEPP_CONSENT } from './zepp-consent';

export const ZEPP_PROVIDER_ID = 'zepp';

// Conector Zepp/Amazfit — Passo 2: SOMENTE conexao (oauth) e revogacao. DELIBERADAMENTE sem "webhook", "events" e "sync": receber dados de treino so' sera
// habilitado depois da resposta oficial da Zepp (contrato FIT/legado, autenticacao do webhook, campos autorizados, retencao). Sem essas capacidades o
// registro nao aceita webhook e a fila nao processa nada deste provedor.
// "categories" declara o que o conector PODE vir a entregar; nao autoriza uso (o aluno autoriza por grupo, ver zepp-consent.ts). 'activity_route' (GPS) so' vale se a Zepp
// confirmar o escopo "Sport Detail: GPS"; sono/FC de repouso idem (transporte e contrato ainda nao confirmados).
export function buildZeppConnector(config: ConfigService): ProviderConnector {
  return {
    id: ZEPP_PROVIDER_ID,
    displayName: 'Zepp / Amazfit',
    categories: ['activity', 'activity_route', 'activity_sensors', 'sleep', 'profile'],
    consent: ZEPP_CONSENT,
    oauth: new ZeppOAuth(config),
    revocation: new ZeppRevocation(),
  };
}
