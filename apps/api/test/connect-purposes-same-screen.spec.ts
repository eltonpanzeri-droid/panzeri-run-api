import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 10/11/2026 (decisao de Elton de 31/10): envio de treinos ao relogio e analise por IA (Atlas) sao pedidos NA MESMA TELA da conexao, desmarcados, cada um com o texto proprio.
// Zepp/COROS/Garmin: a escolha fica guardada ate a conexao aparecer ativa e e' enviada uma finalidade por vez; Health Connect: o Atlas e' registrado junto do "Salvar".
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'mobile', 'src', ...parts), 'utf8');

describe('autorizacoes do relogio e da IA na tela da conexao', () => {
  for (const [name, file, provider] of [['Zepp', 'zepp/ZeppIntegration.tsx', 'zepp'], ['COROS', 'coros/CorosIntegration.tsx', 'coros'], ['Garmin', 'garmin/GarminIntegration.tsx', 'garmin']] as const) {
    it(`${name}: caixas desmarcadas com texto proprio, guardadas antes de abrir o fabricante e concedidas uma por vez apos conectar`, () => {
      const src = read(file);
      expect(src).toMatch(/const \[wantedPurposes, setWantedPurposes\] = useState<Record<string, boolean>>\(\{\}\)/); // nada nasce marcado
      expect(src).toContain("['watch_delivery', 'ai_external'].map((purposeId)");
      expect(src).toContain('option.screen.paragraphs');
      expect(src).toContain('option.screen.checkboxText');
      expect(src).toContain(`savePendingPurposeGrants('${provider}', ['watch_delivery', 'ai_external'].filter((id) => wantedPurposes[id] === true))`);
      expect(src.indexOf('savePendingPurposeGrants(')).toBeLessThan(src.indexOf('void Linking.openURL(result.data.url)'));
      expect(src).toContain(`takePendingPurposeGrants('${provider}')`);
      // cada concessao usa a versao e o hash do PROPRIO texto, uma por chamada
      expect(src).toContain(`call('/${provider}/purposes', 'POST', { grant: [id], acknowledged: true, consentVersion: option.screen.version, consentTextHash: loadedDoc.purposeHashes[id] })`);
    });
  }
  it('o armazenamento da escolha expira (2 horas) e nunca concede nada sozinho', () => {
    const src = read('integrations/pendingPurposeGrants.ts');
    expect(src).toContain('2 * 60 * 60 * 1000');
    expect(src).toContain('removeItem');
    expect(src).not.toContain('fetch(');
  });
  it('Health Connect: o Atlas marcado e registrado junto do Salvar, sobre o texto proprio, e so com a autorizacao disponivel', () => {
    const src = read('healthConnect/HealthConnectConsent.tsx');
    expect(src).toContain("atlas?.screen && atlasAck && !atlasState?.granted && !doc!.locked.ai_external");
    expect(src).toContain("consentVersion: atlas.screen.version, consentTextHash: doc!.purposeHashes.ai_external");
    expect(src).toMatch(/const \[atlasAck, setAtlasAck\] = useState\(false\)/);
  });
});

// 11/11/2026 (REGRESSAO real: Thais nao conseguiu conectar a Garmin): o corpo da resposta so pode ser lido UMA vez. A leitura duplicada fazia a 2a falhar ("Body already read"), caia no catch e a tela mostrava
// "Nao consegui consultar a integracao agora" sem nunca carregar. tsc e teste de texto nao pegam isso: aqui o carregamento e EXECUTADO com objetos Response de verdade (que lancam se o corpo for lido duas vezes).
import { fetchConsentAndPermissions } from '../../mobile/src/integrations/loadIntegration';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch = (routes: Record<string, () => Response>) => (async (url: string) => {
  const key = Object.keys(routes).find((route) => url.endsWith(route));
  if (!key) throw new Error('rota inesperada ' + url);
  return routes[key]();
}) as never;

describe('carregamento das telas de conexao: executado com respostas reais', () => {
  it('consentimento e permissoes carregam (cada corpo lido uma vez); um Response lido duas vezes realmente falha', async () => {
    const response = json({ x: 1 });
    await response.json();
    await expect(response.json()).rejects.toThrow(); // prova de que o teste detecta a leitura duplicada
    const loaded = await fetchConsentAndPermissions<{ version: string }, { connected: boolean }>(fakeFetch({ '/garmin/consent': () => json({ version: '1.1' }), '/garmin/permissions': () => json({ connected: false }) }), 'https://api', 'garmin', {});
    expect(loaded).toEqual({ blocked: false, doc: { version: '1.1' }, permissions: { connected: false } });
  });
  it('403 em qualquer das duas rotas = integracao bloqueada para a aluna (sem erro)', async () => {
    const blocked = await fetchConsentAndPermissions(fakeFetch({ '/zepp/consent': () => json({}, 403), '/zepp/permissions': () => json({}) }), 'https://api', 'zepp', {});
    expect(blocked).toEqual({ blocked: true, doc: null, permissions: null });
  });
  it('permissoes com erro 500 nao derrubam o carregamento do consentimento', async () => {
    const loaded = await fetchConsentAndPermissions(fakeFetch({ '/coros/consent': () => json({ version: '1' }), '/coros/permissions': () => json({ message: 'erro' }, 500) }), 'https://api', 'coros', {});
    expect(loaded).toEqual({ blocked: false, doc: { version: '1' }, permissions: null });
  });
  it('as tres telas usam a funcao unica e nao leem o corpo por conta propria', () => {
    for (const [file, provider] of [['zepp/ZeppIntegration.tsx', 'zepp'], ['coros/CorosIntegration.tsx', 'coros'], ['garmin/GarminIntegration.tsx', 'garmin']] as const) {
      const src = read(file);
      expect(src).toContain(`fetchConsentAndPermissions<ConsentDocument, Permissions>(fetch as unknown as FetchLike, apiUrl, '${provider}', headers)`);
      expect(src).not.toContain('consentResponse');
      expect(src).not.toContain('permissionsResponse.json()');
    }
  });
});
