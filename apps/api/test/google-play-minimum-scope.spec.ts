import { readFileSync } from 'fs';
import { join } from 'path';
import { HEALTH_CONNECT_CONSENT } from '../src/health-connect/health-connect-consent';

// 03/11/2026 — Google Play recusou a versao 15 por "acesso excessivo a dados (escopo minimo) do Health Connect". Guarda: toda permissao de saude do manifesto tem um tipo que o app realmente pede
// (e todo tipo pedido esta no manifesto), e os tipos retirados por decisao de Elton nao voltam sem o teste falhar. Ciclo menstrual NAO e' pedido no Android (decisao de Elton, 03/11/2026).

const mobile = (...parts: string[]) => join(__dirname, '..', '..', 'mobile', ...parts);
const manifest = JSON.parse(readFileSync(mobile('app.json'), 'utf8')) as { expo: { android: { permissions: string[] } } };
const healthPermissions = manifest.expo.android.permissions.filter((p) => p.startsWith('android.permission.health.')).map((p) => p.replace('android.permission.health.', ''));

// tipo de registro do app -> permissao do Health Connect que ele exige
const PERMISSION_OF_RECORD_TYPE: Record<string, string> = {
  ExerciseSession: 'READ_EXERCISE',
  Distance: 'READ_DISTANCE',
  Speed: 'READ_SPEED',
  ActiveCaloriesBurned: 'READ_ACTIVE_CALORIES_BURNED',
  HeartRate: 'READ_HEART_RATE',
  Power: 'READ_POWER',
  StepsCadence: 'READ_STEPS',
  Steps: 'READ_STEPS',
  ElevationGained: 'READ_ELEVATION_GAINED',
  SleepSession: 'READ_SLEEP',
  RestingHeartRate: 'READ_RESTING_HEART_RATE',
  HeartRateVariabilityRmssd: 'READ_HEART_RATE_VARIABILITY',
  Vo2Max: 'READ_VO2_MAX',
};
const EXTRA_PERMISSIONS = ['READ_HEALTH_DATA_HISTORY', 'READ_HEALTH_DATA_IN_BACKGROUND']; // recursos do app, nao tipos de dado

function requestedRecordTypes(): string[] {
  const source = readFileSync(mobile('src', 'healthConnect', 'categories.ts'), 'utf8');
  const start = source.indexOf('export const HC_CATEGORY_RECORD_TYPES');
  const end = source.indexOf('};', start);
  const body = source.slice(start, end).split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  return [...new Set([...body.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]).filter((name) => /^[A-Z]/.test(name)))];
}

describe('Google Play: escopo minimo do Health Connect', () => {
  it('toda permissao de saude do manifesto corresponde a um tipo que o app pede (ou a um recurso declarado)', () => {
    const mapped = new Set(Object.values(PERMISSION_OF_RECORD_TYPE));
    const orphan = healthPermissions.filter((p) => !mapped.has(p) && !EXTRA_PERMISSIONS.includes(p));
    expect(orphan).toEqual([]);
  });

  it('todo tipo que o app pede ao Android esta no manifesto e no mapa (nenhum pedido sem declaracao)', () => {
    const types = requestedRecordTypes();
    expect(types.length).toBeGreaterThan(5);
    expect(types.filter((t) => !PERMISSION_OF_RECORD_TYPE[t])).toEqual([]);
    expect(types.filter((t) => !healthPermissions.includes(PERMISSION_OF_RECORD_TYPE[t]))).toEqual([]);
  });

  it('permissoes retiradas em 03/11/2026 nao voltam: calorias totais, saturacao, frequencia respiratoria, nutricao, hidratacao; e ciclo menstrual nao e pedido no Android', () => {
    for (const removed of ['READ_TOTAL_CALORIES_BURNED', 'READ_OXYGEN_SATURATION', 'READ_RESPIRATORY_RATE', 'READ_NUTRITION', 'READ_HYDRATION', 'READ_MENSTRUATION']) {
      expect(healthPermissions).not.toContain(removed);
    }
    expect(healthPermissions).toContain('READ_VO2_MAX'); // decisao de Elton: VO2 max fica
  });

  it('o texto de consentimento do Health Connect nao oferece mais grupos de dado que o app nao pede', () => {
    const groupIds = HEALTH_CONNECT_CONSENT.groups.map((g) => g.id);
    expect(groupIds).not.toContain('vitals');
    expect(groupIds).not.toContain('nutrition');
    expect(HEALTH_CONNECT_CONSENT.version).toBe('1.4');
  });
});
