import { readFileSync } from 'fs';
import { join } from 'path';
import { AUTO_SEND_STORAGE_KEY, autoSendWeekToAppleWatch, sessionsToAutoSend } from '../../mobile/src/appleWatchDelivery/autoSendWeekToAppleWatch';
import type { AppleEligibility, AppleWatchApi, AppleWatchNative } from '../../mobile/src/appleWatchDelivery/sendSessionToAppleWatch';

// 06/11/2026 — envio AUTOMATICO dos treinos da semana ao Apple Watch ao abrir o Panzeri Run (ordem de Elton). Esteira E corrida: a elegibilidade e decidida pela API.
const TODAY = '2026-11-06';
const mobile = (file: string) => readFileSync(join(__dirname, '..', '..', 'mobile', file), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

const SPEC = { specVersion: 1, translatorVersion: 1, activity: 'running', location: 'outdoor', warmup: null, cooldown: null, blocks: [{ iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 5000 } }] }], source: { canonicalSchemaVersion: 1, trainingSessionId: null }, specHash: 'h' } as never;
function build(options: { eligibility?: Record<string, AppleEligibility>; authorized?: boolean; scheduledPlans?: string[] } = {}) {
  const scheduled: string[] = [...(options.scheduledPlans ?? [])];
  const calls = { prepare: [] as string[], confirm: [] as string[], failure: [] as string[], scheduleCalls: [] as string[] };
  const eligibility = options.eligibility ?? {};
  const api: AppleWatchApi = {
    prepare: async (id) => {
      calls.prepare.push(id);
      return { eligible: true, distanceKm: 5, scheduledDate: TODAY, delivery: { id: `d-${id}`, status: 'pending', planId: `00000000-0000-4000-8000-00000000000${calls.prepare.length}`, outdated: false }, spec: SPEC };
    },
    confirmSent: async (id) => { calls.confirm.push(id); },
    reportFailure: async (id) => { calls.failure.push(id); },
  };
  const native: AppleWatchNative = {
    isSupported: true,
    validateCustomWorkoutSpec: () => ({ valid: true, errors: [], summary: { activity: 'running', location: 'outdoor', blocks: [{ iterations: 1, steps: [{ purpose: 'work', meters: 5000 }] }], totalMeters: 5000, serializedBytes: 100 } }),
    requestAuthorization: async () => (options.authorized === false ? 'denied' : 'authorized'),
    listScheduled: async () => scheduled.map((planId) => ({ planId })),
    scheduleCustomWorkout: async (planId) => { calls.scheduleCalls.push(planId); scheduled.push(planId); return { scheduled: true }; },
  };
  return { api, native, calls, deps: (attempted = new Set<string>()) => ({ api, native, eligibility: async (id: string) => eligibility[id] ?? ({ eligible: false, reason: 'sessao_extra' } as AppleEligibility), todayIso: TODAY, attempted }) };
}
const elegivel = (delivery: AppleEligibility extends infer T ? any : never = null): AppleEligibility => ({ eligible: true, distanceKm: 5, scheduledDate: TODAY, delivery });
const sessao = (id: string, isoDate: string, completion?: unknown) => ({ id, isoDate, completion });

describe('quais treinos entram', () => {
  it('so de hoje ate 7 dias, sem feedback registrado, em ordem de data', () => {
    const list = sessionsToAutoSend([sessao('c', '2026-11-12'), sessao('passado', '2026-11-05'), sessao('feito', '2026-11-07', { status: 'done' }), sessao('a', '2026-11-06'), sessao('longe', '2026-11-14'), { id: 'semdata' }], TODAY);
    expect(list.map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('envio automatico', () => {
  it('envia sozinho os treinos elegiveis ainda nao enviados e nao toca nos demais', async () => {
    const t = build({ eligibility: { a: elegivel(null), b: elegivel({ id: 'd', status: 'sent', planId: 'p', outdated: false }), c: { eligible: false, reason: 'distancia_inconsistente' } } });
    const summary = await autoSendWeekToAppleWatch([sessao('a', '2026-11-06'), sessao('b', '2026-11-07'), sessao('c', '2026-11-08')], t.deps());
    expect(summary).toMatchObject({ considered: 3, sent: 1, skipped: 2, failed: 0 });
    expect(t.calls.scheduleCalls).toHaveLength(1);
  });

  it('nao reenvia o que mudou depois do envio (continua so pelo toque manual)', async () => {
    const t = build({ eligibility: { a: elegivel({ id: 'd', status: 'sent', planId: 'p', outdated: true }) } });
    const summary = await autoSendWeekToAppleWatch([sessao('a', '2026-11-06')], t.deps());
    expect(summary.sent).toBe(0);
    expect(t.calls.scheduleCalls).toEqual([]);
  });

  it('cada treino e tentado no maximo uma vez por abertura (sem laco): a segunda rodada nao repete nada', async () => {
    const t = build({ eligibility: { a: elegivel(null) } });
    const attempted = new Set<string>();
    await autoSendWeekToAppleWatch([sessao('a', '2026-11-06')], t.deps(attempted));
    const again = await autoSendWeekToAppleWatch([sessao('a', '2026-11-06')], t.deps(attempted));
    expect(again.considered).toBe(0);
    expect(t.calls.scheduleCalls).toHaveLength(1);
  });

  it('para na primeira falta de autorizacao do iPhone, sem insistir nos demais', async () => {
    const t = build({ authorized: false, eligibility: { a: elegivel(null), b: elegivel(null), c: elegivel(null) } });
    const summary = await autoSendWeekToAppleWatch([sessao('a', '2026-11-06'), sessao('b', '2026-11-07'), sessao('c', '2026-11-08')], t.deps());
    expect(summary).toMatchObject({ sent: 0, failed: 1, stoppedReason: 'sem_autorizacao' });
    expect(t.calls.prepare).toHaveLength(1);
  });

  it('erro de consulta de um treino nao derruba os outros; fora do iPhone nativo nada acontece', async () => {
    const t = build({ eligibility: { b: elegivel(null) } });
    const deps = t.deps();
    deps.eligibility = async (id: string) => { if (id === 'a') throw new Error('rede'); return elegivel(null); };
    expect(await autoSendWeekToAppleWatch([sessao('a', '2026-11-06'), sessao('b', '2026-11-07')], deps)).toMatchObject({ failed: 1, sent: 1 });
    const off = build();
    expect(await autoSendWeekToAppleWatch([sessao('a', '2026-11-06')], { ...off.deps(), native: { ...off.native, isSupported: false } })).toMatchObject({ considered: 0, sent: 0 });
  });
});

describe('ligacao no Panzeri Run', () => {
  it('so liga depois de um envio manual com sucesso (flag no aparelho) e a tela Semana chama o envio automatico', () => {
    expect(mobile('src/appleWatchDelivery/AppleWatchSendButton.tsx')).toContain("if (result.ok) { try { await AsyncStorage.setItem(AUTO_SEND_STORAGE_KEY, '1')");
    expect(mobile('src/appleWatchDelivery/useAppleWatchAutoSend.ts')).toContain("(await AsyncStorage.getItem(AUTO_SEND_STORAGE_KEY)) !== '1') return");
    expect(mobile('App.tsx')).toContain('useAppleWatchAutoSend(plan?.sessions, accessToken, API_URL);');
    expect(AUTO_SEND_STORAGE_KEY).toBe('panzeri:appleWatchAutoSend:v1');
  });
});
