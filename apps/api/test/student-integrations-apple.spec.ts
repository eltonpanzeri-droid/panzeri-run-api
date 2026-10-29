import { buildStudentIntegrations, IntegrationsRaw } from '../src/coach/student-integrations.service';
import { APPLE_HEALTH_CONSENT } from '../src/apple-health/apple-health-consent';
import { consentTextHash } from '../src/provider-hub/provider-consent.service';

// Painel do treinador: Apple Saúde por grupo, como a Polar e o Health Connect (30/10/2026). Dados SINTÉTICOS.

const NOW = new Date('2026-10-30T20:00:00Z');
const D = (iso: string) => new Date(iso);
const none = { lastAt: null, count: 0 };
const base = (over: Partial<IntegrationsRaw> = {}): IntegrationsRaw => ({
  polar: null, wahoo: null, strava: null, zepp: null, activityByProvider: {},
  zepp_activity_sensors: none, zepp_activity_route: none, zepp_sleep: none, zepp_daily: none, zepp_resting_hr: none, zepp_hrv: none,
  zeppLastProcessedEventAt: null, zeppWorkoutLastAcceptedAt: null, inboundFailures: [], zeppWorkoutFailures: [],
  zeppWatch: { publishingEnabled: false, unitProfileConfirmed: false },
  ...over,
} as IntegrationsRaw);
const apple = (result: ReturnType<typeof buildStudentIntegrations>) => result.integrations.find((i) => i.provider === 'apple_health')!;
const record = (categories: string[], over: Record<string, unknown> = {}) => ({ createdAt: D('2026-10-29T22:00:00Z'), disconnectedAt: null, grantedCategories: categories, consentVersion: APPLE_HEALTH_CONSENT.version, consentTextHash: consentTextHash(APPLE_HEALTH_CONSENT), ...over });

describe('Apple Saúde no painel do treinador', () => {
  it('sem registro de autorização (app antigo): mantém o caso "dados recebidos, sem registro de conexão"', () => {
    const view = apple(buildStudentIntegrations('s1', base({ activityByProvider: { apple_health: { lastAt: D('2026-10-29T19:26:00Z'), count: 24 } } }), NOW, false));
    expect(view.categories.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(view)).not.toContain('Atividade do dia');
  });

  it('com autorização registrada: um item por grupo, com autorizado/não e o que chegou (como a Polar)', () => {
    const raw = base({
      activityByProvider: { apple_health: { lastAt: D('2026-10-30T10:00:00Z'), count: 24 } },
      appleHealth: record(['activity', 'activity_sensors', 'daily_activity', 'sleep']),
      appleReceipts: { activity_sensors: { lastAt: D('2026-10-30T10:00:00Z'), count: 20 }, sleep: { lastAt: D('2026-10-30T07:00:00Z'), count: 90 }, daily_activity: { lastAt: D('2026-10-30T09:00:00Z'), count: 400 } },
    });
    const view = apple(buildStudentIntegrations('s1', raw, NOW, false));
    const by = Object.fromEntries(view.categories.map((c) => [c.id, c]));
    expect(view.categories).toHaveLength(APPLE_HEALTH_CONSENT.groups.length);
    expect(by.workouts).toMatchObject({ authorized: true, count: 24 });
    expect(by.sensors).toMatchObject({ authorized: true, count: 20 });
    expect(by.sleep).toMatchObject({ authorized: true, count: 90 });
    expect(by.daily).toMatchObject({ authorized: true, count: 400 });
    expect(by.route).toMatchObject({ authorized: false, count: 0 });
    expect(by.cycle).toMatchObject({ authorized: false });
    expect(view.state).toBe('connected');
    expect(view.warnings.join(' ')).not.toContain('Autorizados, mas ainda sem dados recebidos'); // todos os autorizados já têm dado
  });

  it('grupo autorizado sem dado aparece como pendente (não como zero); retirada total vira desconectado', () => {
    const view = apple(buildStudentIntegrations('s1', base({ appleHealth: record(['activity', 'sleep']) }), NOW, false));
    expect(view.warnings.join(' ')).toMatch(/Treinos.*Sono|Sono.*Treinos/);
    const withdrawn = apple(buildStudentIntegrations('s1', base({ appleHealth: record([], { disconnectedAt: D('2026-10-30T12:00:00Z') }) }), NOW, false));
    expect(withdrawn.state).toBe('disconnected');
    expect(withdrawn.categories.every((c) => !c.authorized)).toBe(true);
    expect(withdrawn.atlas.authorized).toBe(false);
  });

  it('texto desatualizado suspende (nenhum grupo vale) e a IA não recebe nada', () => {
    const view = apple(buildStudentIntegrations('s1', base({ appleHealth: record(['activity', 'sleep'], { consentVersion: '1.0', consentTextHash: 'antigo' }) }), NOW, false));
    expect(view.categories.every((c) => !c.authorized)).toBe(true);
    expect(view.atlas).toMatchObject({ authorized: false, needsNewAuthorization: true });
  });

  it('dados sensíveis: a nota da IA informa que percurso, pressão, glicemia e ciclo nunca são enviados', () => {
    const view = apple(buildStudentIntegrations('s1', base({ appleHealth: record(['activity']) }), NOW, false));
    expect(view.atlas.note).toContain('nunca são enviados');
  });
});
