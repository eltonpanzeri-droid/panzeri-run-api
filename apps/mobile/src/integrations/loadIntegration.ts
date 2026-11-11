// Carregamento do consentimento e das permissoes de uma integracao de relogio (Zepp, COROS, Garmin). Funcao PURA (recebe o fetch), para poder ser executada em teste com respostas reais.
// 11/11/2026: antes cada tela repetia este bloco e uma leitura duplicada do corpo da resposta ("body already read") derrubava o carregamento das tres (caso Thais, Garmin). Cada corpo e lido UMA vez, aqui.
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface LoadedIntegration<D, P> { blocked: boolean; doc: D | null; permissions: P | null }

export async function fetchConsentAndPermissions<D, P>(fetchFn: FetchLike, apiUrl: string, provider: string, headers: Record<string, string>): Promise<LoadedIntegration<D, P>> {
  const [consentResponse, permissionsResponse] = await Promise.all([
    fetchFn(`${apiUrl}/${provider}/consent`, { headers }),
    fetchFn(`${apiUrl}/${provider}/permissions`, { headers }),
  ]);
  if (consentResponse.status === 403 || permissionsResponse.status === 403) return { blocked: true, doc: null, permissions: null };
  const doc = consentResponse.ok ? ((await consentResponse.json()) as D) : null;
  const permissions = permissionsResponse.ok ? ((await permissionsResponse.json()) as P) : null;
  return { blocked: false, doc, permissions };
}
