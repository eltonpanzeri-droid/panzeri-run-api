import { ConfigService } from '@nestjs/config';
import { ProviderConnector } from '../provider-hub/provider-connector';
import { ZeppOAuth, ZeppRevocation } from './zepp-oauth';

export const ZEPP_PROVIDER_ID = 'zepp';

// Conector Zepp/Amazfit — Passo 2: SOMENTE conexao (oauth) e revogacao. DELIBERADAMENTE sem "webhook", "events" e "sync": receber dados de treino so' sera
// habilitado depois da resposta oficial da Zepp (contrato FIT/legado, autenticacao do webhook, campos autorizados, retencao). Sem essas capacidades o
// registro nao aceita webhook e a fila nao processa nada deste provedor.
// "categories" declara o que o conector PODE vir a entregar; nao autoriza uso. 'activity_route' (GPS) so' vale se a Zepp confirmar o escopo "Sport Detail: GPS".
export function buildZeppConnector(config: ConfigService): ProviderConnector {
  return {
    id: ZEPP_PROVIDER_ID,
    displayName: 'Zepp / Amazfit',
    categories: ['activity', 'activity_route'],
    oauth: new ZeppOAuth(config),
    revocation: new ZeppRevocation(),
  };
}
