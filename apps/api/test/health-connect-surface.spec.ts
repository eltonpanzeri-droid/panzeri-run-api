import { readFileSync } from 'fs';
import { join } from 'path';

// Superficie do app (verificacao estatica do codigo-fonte; nao ha renderizador RN no jest): botoes, estados, registro no hub e escopo das permissoes.
const mobile = join(__dirname, '..', '..', 'mobile');
const read = (p: string) => readFileSync(join(mobile, p), 'utf8');

describe('superficie Health Connect no app', () => {
  const card = read('src/healthConnect/HealthConnectCard.tsx');

  it('tem Conectar, Sincronizar agora e Desconectar, e exibe a ultima sincronizacao', () => {
    expect(card).toContain('Permitir no Android');
    expect(card).toContain('HealthConnectConsent'); // as autorizacoes do Panzeri Run vem antes do pedido ao Android
    expect(card).toContain('Sincronizar agora');
    expect(card).toContain('Desconectar');
    expect(card).toContain('Última sincronização');
  });

  it('"Sincronizar agora" chama a sincronizacao manual e fica desabilitado enquanto sincroniza (sem duplo toque)', () => {
    expect(card).toMatch(/onPress=\{runSync\}/);
    expect(card).toMatch(/disabled=\{busy \|\| status === 'syncing'\}/);
    expect(card).toContain('sync.syncNow()');
  });

  it('esta registrado no hub de integracoes e a sincronizacao automatica roda no app', () => {
    const app = read('App.tsx');
    expect(app).toContain('health_connect: () => <HealthConnectCard');
    expect(app).toContain('useHealthConnectAutoSync(accessToken, API_URL)');
  });

  it('o Android so e acionado depois das autorizacoes e so para as categorias autorizadas; manifesto: leitura de todas as categorias do consentimento, SEM escrita, rota GPS nem segundo plano (pendencias registradas)', () => {
    const sync = read('src/healthConnect/sync.ts');
    expect(sync).toContain('getAuthorizedCategories');
    expect(sync).toContain('recordTypesFor(auth.categories)');
    const app = JSON.parse(read('app.json')) as { expo: { android: { permissions: string[] } } };
    const hc = app.expo.android.permissions.filter((p) => p.startsWith('android.permission.health.'));
    for (const required of ['READ_EXERCISE', 'READ_DISTANCE', 'READ_HEART_RATE', 'READ_SLEEP', 'READ_STEPS', 'READ_VO2_MAX', 'READ_WEIGHT', 'READ_HEALTH_DATA_HISTORY']) expect(hc).toContain('android.permission.health.' + required);
    // Ainda NAO: escrita, rota GPS (permissao propria por sessao) e leitura em segundo plano — esta ultima so entra depois do primeiro dado real (obrigacao registrada no prontuario).
    expect(JSON.stringify(app)).not.toMatch(/WRITE_|READ_HEALTH_DATA_IN_BACKGROUND|READ_EXERCISE_ROUTES/);
  });

  it('nao usa servicos em segundo plano permanentes', () => {
    const files = ['sync.ts', 'useHealthConnect.ts', 'gateway.ts'].map((f) => read(`src/healthConnect/${f}`)).join('\n');
    expect(files).not.toMatch(/BackgroundFetch|TaskManager|registerTaskAsync|setInterval/);
  });
});
