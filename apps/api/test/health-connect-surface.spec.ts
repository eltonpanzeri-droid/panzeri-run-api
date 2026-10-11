import { readFileSync } from 'fs';
import { join } from 'path';

// Superficie do app (verificacao estatica do codigo-fonte; nao ha renderizador RN no jest): botoes, estados, registro no hub e escopo das permissoes.
const mobile = join(__dirname, '..', '..', 'mobile');
const read = (p: string) => readFileSync(join(mobile, p), 'utf8');

describe('superficie Health Connect no app', () => {
  const card = read('src/healthConnect/HealthConnectCard.tsx');

  it('tem Conectar, Sincronizar agora e Desconectar, e exibe a ultima sincronizacao', () => {
    expect(card).toContain('Conectar Health Connect');
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

  it('pede SOMENTE leitura de sessoes, distancia e FC (nada de GPS, sono, passos, calorias, peso, nutricao nem historico/segundo plano)', () => {
    const contract = read('src/healthConnect/contract.ts');
    expect(contract).toContain("['ExerciseSession', 'Distance', 'HeartRate']");
    const app = JSON.parse(read('app.json')) as { expo: { android: { permissions: string[] } } };
    const hc = app.expo.android.permissions.filter((p) => p.startsWith('android.permission.health.'));
    expect(hc.sort()).toEqual(['android.permission.health.READ_DISTANCE', 'android.permission.health.READ_EXERCISE', 'android.permission.health.READ_HEART_RATE']);
    expect(JSON.stringify(app)).not.toMatch(/WRITE_|READ_HEALTH_DATA_HISTORY|BACKGROUND|READ_EXERCISE_ROUTES|SLEEP|STEPS|CALORIES|WEIGHT|NUTRITION/);
  });

  it('nao usa servicos em segundo plano permanentes', () => {
    const files = ['sync.ts', 'useHealthConnect.ts', 'gateway.ts'].map((f) => read(`src/healthConnect/${f}`)).join('\n');
    expect(files).not.toMatch(/BackgroundFetch|TaskManager|registerTaskAsync|setInterval/);
  });
});
