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

// 11/11/2026 (REGRESSAO real: Thais nao conseguiu conectar a Garmin): o corpo da resposta so pode ser lido UMA vez. A leitura duplicada fazia a 2a falhar ("Body already read"), caia no catch e a tela
// mostrava "Nao consegui consultar a integracao agora" sem nunca carregar. tsc nao pega isso: o teste confere cada leitura do corpo no carregamento das telas de conexao.
describe('carregamento das telas de conexao: cada resposta e lida uma unica vez', () => {
  for (const file of ['zepp/ZeppIntegration.tsx', 'coros/CorosIntegration.tsx', 'garmin/GarminIntegration.tsx']) {
    it(`${file}: consentimento e permissoes lidos uma vez cada`, () => {
      const src = read(file);
      const load = src.slice(src.indexOf('const load = useCallback(async () => {', src.indexOf('export function')), src.indexOf("setMessage({ ok: false, text: 'Não consegui consultar a integração agora."));
      expect((load.match(/consentResponse\.json\(\)/g) ?? []).length).toBe(1);
      expect((load.match(/permissionsResponse\.json\(\)/g) ?? []).length).toBe(1);
    });
  }
});
