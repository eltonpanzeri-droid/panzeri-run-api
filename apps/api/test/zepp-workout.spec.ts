import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCanonicalWorkout } from '../src/training-plans/canonical-workout';
import { translateToZeppWorkout, zeppWorkoutName, ZEPP_PROFILE_UNCONFIRMED, ZeppWorkoutProfile } from '../src/zepp/zepp-workout-spec';
import { buildZeppWindowBody, EmptyZeppWindowRefused, zeppWindow } from '../src/zepp/zepp-workout-window';
import { profileIsConfirmed, ZeppWorkoutPublisherService, WATCH_DELIVERY_PURPOSE, ZEPP_WORKOUT_PROVIDER } from '../src/zepp/zepp-workout-publisher.service';
import { WorkoutDeliveryService } from '../src/workout-delivery/workout-delivery.service';
import { ZEPP_WORKOUT_PROFILE } from '../src/zepp/zepp-workout-profile';
import { ZeppController } from '../src/zepp/zepp.controller';
import { ZeppPublishResult } from '../src/zepp/zepp-workout-client';

// PERFIL HIPOTETICO, so' para testar as conversoes de outras unidades e do que a Zepp NAO confirmou (passo sem meta, pace unico). O perfil REAL (confirmado pela Zepp em
// 21/10/2026: metros e velocidade em m/s) fica em zepp-workout-profile.ts e tem testes proprios abaixo.
const HYPOTHETICAL: ZeppWorkoutProfile = { distanceUnit: 'm', paceUnit: 'sec_per_km', noTargetType: 'NO_TARGET_HYPOTHETICAL', singlePaceAsEqualBounds: true, maxNameLength: null, maxStepsPerWorkout: null };

const continuous = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 8, distanceUnit: 'km', paceRange: '5:30/km a 5:45/km' }] };
const interval = {
  type: 'run',
  blocks: [{ repeatCount: 4, steps: [
    { durationType: 'distance', distanceValue: 400, distanceUnit: 'm', paceRange: '4:00/km' },
    { durationType: 'distance', distanceValue: 200, distanceUnit: 'm', pausaType: 'ativa', paceRange: '6:30/km a 7:00/km' },
  ] }],
};
const timeBased = { type: 'run', blocks: [{ durationType: 'time', durationMin: 30, paceRange: '6:00/km a 6:20/km' }] };
const ctx = { workoutId: 123456, distanceKm: 8 as number | null, scheduledDate: '2026-10-22' };
const canonical = (structure: unknown) => buildCanonicalWorkout({ id: 's1', modality: 'corrida', structure });

describe('tradutor Zepp (CanonicalWorkout -> Workout V2)', () => {
  it('perfil sem confirmacao: passo por distancia e por pace e recusado, sem enviar valor inventado', () => {
    const result = translateToZeppWorkout(canonical(continuous), ctx, ZEPP_PROFILE_UNCONFIRMED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((r) => r.code)).toEqual(expect.arrayContaining(['distance_unit_unconfirmed', 'pace_unit_unconfirmed']));
    expect(result.refusals.every((r) => r.pendingZeppAnswer)).toBe(true);
    expect(profileIsConfirmed(ZEPP_PROFILE_UNCONFIRMED)).toBe(false);
  });

  it('perfil REAL (Zepp, 21/10/2026): distancia em metros inteiros, tempo em segundos inteiros e pace como VELOCIDADE em m/s (maior = mais rapido)', () => {
    expect(profileIsConfirmed(ZEPP_WORKOUT_PROFILE)).toBe(true);
    const distance = translateToZeppWorkout(canonical(continuous), ctx, ZEPP_WORKOUT_PROFILE);
    expect(distance.ok).toBe(true);
    if (!distance.ok) return;
    // 5:30/km = 3,0303... m/s ; 5:45/km = 2,8985... m/s => faixa baixa = ritmo mais lento = MENOR velocidade (valores exatos, sem arredondar)
    expect(distance.workout.steps[0]).toEqual({ type: 'WorkoutStep', stepOrder: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 8000, targetType: 'PACE_LAP', targetValueLow: 1000 / 345, targetValueHigh: 1000 / 330 });
    const time = translateToZeppWorkout(canonical(timeBased), ctx, ZEPP_WORKOUT_PROFILE);
    expect(time.ok && time.workout.steps[0]).toMatchObject({ durationType: 'TIME', durationValue: 1800, targetType: 'PACE_LAP' });
    const odd = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 0.4106, distanceUnit: 'km', paceRange: '5:30/km a 5:45/km' }, { durationType: 'time', durationMin: 12.34, paceRange: '6:00/km a 6:20/km' }] };
    const rounded = translateToZeppWorkout(canonical(odd), ctx, ZEPP_WORKOUT_PROFILE);
    if (rounded.ok) for (const step of rounded.workout.steps as any[]) expect(Number.isInteger(step.durationValue)).toBe(true);
  });

  it('m/s e so unidade de comunicacao: 5:00/km vira ~3,333 m/s SEM arredondar e volta exatamente a 5:00/km (nenhuma diferenca artificial entre prescrito e enviado)', () => {
    const exact = { type: 'run', blocks: [{ durationType: 'time', durationMin: 30, paceRange: '4:30/km a 5:00/km' }] };
    const result = translateToZeppWorkout(canonical(exact), ctx, ZEPP_WORKOUT_PROFILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.workout.steps[0] as any;
    expect(step.targetValueLow).toBe(1000 / 300); // 5:00/km = 3,3333333333333335 m/s, cheio
    expect(step.targetValueHigh).toBe(1000 / 270); // 4:30/km
    expect(step.targetValueLow).not.toBe(3.333);
    // ida e volta: o ritmo que o aluno le (s/km) e' recuperado sem erro mensuravel
    expect(Math.abs(1000 / step.targetValueLow - 300)).toBeLessThan(1e-9);
    expect(Math.abs(1000 / step.targetValueHigh - 270)).toBeLessThan(1e-9);
    // o ritmo prescrito NAO e' alterado pela traducao (continua s/km no CanonicalWorkout)
    const canon = canonical(exact) as any;
    expect(canon.items[0].pace.prescribed).toMatchObject({ fastSecPerKm: 270, slowSecPerKm: 300 });
  });

  it('perfil real: o que a Zepp NAO confirmou segue recusado (pace unico, passo sem meta) — nenhum valor inventado', () => {
    expect(ZEPP_WORKOUT_PROFILE).toEqual({ ...ZEPP_PROFILE_UNCONFIRMED, distanceUnit: 'm', paceUnit: 'm_per_s' });
    const single = translateToZeppWorkout(canonical(interval), ctx, ZEPP_WORKOUT_PROFILE);
    expect(single.ok).toBe(false);
    if (!single.ok) expect(single.refusals.map((r) => r.code)).toContain('single_pace_bounds_unconfirmed');
  });

  it('por tempo, a duracao e documentada em segundos, mas a meta de pace ainda depende da unidade (recusa)', () => {
    const result = translateToZeppWorkout(canonical(timeBased), ctx, ZEPP_PROFILE_UNCONFIRMED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals.map((r) => r.code)).toContain('pace_unit_unconfirmed');
    const withPace = translateToZeppWorkout(canonical(timeBased), ctx, { ...ZEPP_PROFILE_UNCONFIRMED, paceUnit: 'sec_per_km' });
    expect(withPace.ok).toBe(true);
    if (withPace.ok) expect(withPace.workout.steps[0]).toMatchObject({ durationType: 'TIME', durationValue: 1800, targetType: 'PACE_LAP', targetValueLow: 360, targetValueHigh: 380 });
  });

  it('corrida continua com perfil hipotetico: um passo ACTIVE por distancia com a faixa de pace prescrita', () => {
    const result = translateToZeppWorkout(canonical(continuous), ctx, HYPOTHETICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout).toMatchObject({ workoutId: 123456, workoutDate: '2026-10-22', sport: 'RUNNING', workoutName: 'Corrida 8 km · 22/10' });
    expect(result.workout.steps).toEqual([
      { type: 'WorkoutStep', stepOrder: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 8000, targetType: 'PACE_LAP', targetValueLow: 330, targetValueHigh: 345 },
    ]);
  });

  it('intervalado: WorkoutRepeatStep com ordem propria, INTERVAL/RECOVERY, pace unico como limites iguais e a banda de +-20 s NUNCA e usada', () => {
    const result = translateToZeppWorkout(canonical(interval), ctx, HYPOTHETICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout.steps).toEqual([
      {
        type: 'WorkoutRepeatStep', stepOrder: 1, repeatType: 'REPEAT_UNTIL_STEPS_CMPLT', repeatValue: 4,
        steps: [
          { type: 'WorkoutStep', stepOrder: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 400, targetType: 'PACE_LAP', targetValueLow: 240, targetValueHigh: 240 },
          { type: 'WorkoutStep', stepOrder: 2, intensity: 'RECOVERY', durationType: 'DISTANCE', durationValue: 200, targetType: 'PACE_LAP', targetValueLow: 390, targetValueHigh: 420 },
        ],
      },
    ]);
  });

  it('pace unico sem confirmacao de limites iguais: recusa (nao inventa uma faixa)', () => {
    const result = translateToZeppWorkout(canonical(interval), ctx, { ...HYPOTHETICAL, singlePaceAsEqualBounds: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals.map((r) => r.code)).toContain('single_pace_bounds_unconfirmed');
  });

  it('conversoes de unidade ficam isoladas no perfil: min/km, m/s e distancia em km', () => {
    const km = translateToZeppWorkout(canonical(continuous), ctx, { ...HYPOTHETICAL, distanceUnit: 'km', paceUnit: 'min_per_km' });
    expect(km.ok && km.workout.steps[0]).toMatchObject({ durationValue: 8, targetValueLow: 5.5, targetValueHigh: 5.75 });
    const speed = translateToZeppWorkout(canonical(continuous), ctx, { ...HYPOTHETICAL, paceUnit: 'm_per_s' });
    expect(speed.ok && speed.workout.steps[0]).toMatchObject({ targetValueLow: 1000 / 345, targetValueHigh: 1000 / 330 }); // numericamente ascendente, sem arredondar
  });

  it('caminhada FORA de uma etapa de recuperacao e passo sem pace (sem tipo de "sem meta" confirmado) sao recusados, nunca enviados como corrida', () => {
    const walk = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 1, distanceUnit: 'km', activityType: 'caminhada', paceRange: '9:00/km' }] };
    const walkResult = translateToZeppWorkout(canonical(walk), ctx, HYPOTHETICAL);
    expect(walkResult.ok).toBe(false);
    if (!walkResult.ok) expect(walkResult.refusals.map((r) => r.code)).toContain('walk_outside_recovery');
    const passive = { type: 'run', blocks: [{ repeatCount: 3, steps: [
      { durationType: 'distance', distanceValue: 400, distanceUnit: 'm', paceRange: '4:10/km a 4:20/km' },
      { durationType: 'time', durationMin: 1, pausaType: 'passiva' },
    ] }] };
    expect(translateToZeppWorkout(canonical(passive), ctx, { ...HYPOTHETICAL, noTargetType: null }).ok).toBe(false);
    const ok = translateToZeppWorkout(canonical(passive), ctx, HYPOTHETICAL);
    expect(ok.ok && (ok.workout.steps[0] as any).steps[1]).toMatchObject({ intensity: 'REST', durationType: 'TIME', durationValue: 60, targetType: 'NO_TARGET_HYPOTHETICAL' });
  });

  it('recuperacao CAMINHANDO dentro de treino de corrida vira etapa RECOVERY (perfil real); sem pace prescrito continua dependendo do "sem meta" nao confirmado', () => {
    const withPace = { type: 'run', blocks: [{ repeatCount: 4, steps: [
      { durationType: 'distance', distanceValue: 400, distanceUnit: 'm', paceRange: '4:00/km a 4:10/km' },
      { durationType: 'distance', distanceValue: 200, distanceUnit: 'm', pausaType: 'ativa', activityType: 'caminhada', paceRange: '9:00/km a 10:00/km' },
    ] }] };
    const ok = translateToZeppWorkout(canonical(withPace), ctx, ZEPP_WORKOUT_PROFILE);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const repeat = ok.workout.steps[0] as any;
      expect(repeat.steps.map((s: any) => s.intensity)).toEqual(['INTERVAL', 'RECOVERY']);
      expect(repeat.steps[1]).toMatchObject({ durationType: 'DISTANCE', durationValue: 200, targetType: 'PACE_LAP' });
    }
    const noPace = { type: 'run', blocks: [{ repeatCount: 4, steps: [
      { durationType: 'distance', distanceValue: 400, distanceUnit: 'm', paceRange: '4:00/km a 4:10/km' },
      { durationType: 'time', durationMin: 2, pausaType: 'ativa', activityType: 'caminhada' },
    ] }] };
    const refused = translateToZeppWorkout(canonical(noPace), ctx, ZEPP_WORKOUT_PROFILE);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusals.map((r) => r.code)).toContain('no_target_unconfirmed');
  });

  it('so corrida: musculacao e estrutura nao-corrida sao recusadas; nome longo e encurtado; specHash muda com o conteudo mas nao com o workoutId', () => {
    expect(translateToZeppWorkout(buildCanonicalWorkout({ id: 'x', modality: 'forca', structure: { type: 'strength' } }), ctx, HYPOTHETICAL).ok).toBe(false);
    const long = translateToZeppWorkout(canonical(continuous), ctx, { ...HYPOTHETICAL, maxNameLength: 10 });
    expect(long.ok && long.workout.workoutName.length).toBe(10);
    const a = translateToZeppWorkout(canonical(continuous), ctx, HYPOTHETICAL);
    const b = translateToZeppWorkout(canonical(continuous), { ...ctx, workoutId: 999 }, HYPOTHETICAL);
    const c = translateToZeppWorkout(canonical({ ...continuous, blocks: [{ ...continuous.blocks[0], distanceValue: 9 }] }), ctx, HYPOTHETICAL);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) { expect(a.specHash).toBe(b.specHash); expect(a.specHash).not.toBe(c.specHash); }
  });

  it('limite de passos so vale quando confirmado', () => {
    const result = translateToZeppWorkout(canonical(interval), ctx, { ...HYPOTHETICAL, maxStepsPerWorkout: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals.map((r) => r.code)).toContain('too_many_steps');
  });
});

describe('janela de 7 dias', () => {
  const workout = (id: number, date: string) => ({ workoutId: id, workoutDate: date, sport: 'RUNNING' as const, workoutName: 't', steps: [] });

  it('endDate e exatamente 6 dias depois e so entram treinos dentro da janela, ordenados', () => {
    expect(zeppWindow('2026-10-20')).toEqual({ startDate: '2026-10-20', endDate: '2026-10-26' });
    expect(zeppWindow('2026-12-29')).toEqual({ startDate: '2026-12-29', endDate: '2027-01-04' });
    const body = buildZeppWindowBody('2026-10-20', [workout(3, '2026-10-27'), workout(2, '2026-10-22'), workout(1, '2026-10-20'), workout(4, '2026-10-19')]);
    expect(body.workouts.map((w) => w.workoutId)).toEqual([1, 2]);
  });

  it('lista vazia (apagaria tudo na Zepp) so com permissao explicita; workoutId repetido e recusado', () => {
    expect(() => buildZeppWindowBody('2026-10-20', [])).toThrow(EmptyZeppWindowRefused);
    expect(() => buildZeppWindowBody('2026-10-20', [workout(1, '2026-10-30')])).toThrow(EmptyZeppWindowRefused); // tudo fora da janela
    expect(buildZeppWindowBody('2026-10-20', [], { allowEmpty: true }).workouts).toEqual([]);
    expect(() => buildZeppWindowBody('2026-10-20', [workout(1, '2026-10-21'), workout(1, '2026-10-22')])).toThrow(/repetido/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Publicador: banco em memoria, cliente Zepp falso, consentimento falso.
type Row = Record<string, any>;
function makePublisher(options: { enabled?: boolean; profile?: ZeppWorkoutProfile; publish?: (body: any) => ZeppPublishResult; connected?: boolean; authorized?: boolean; today?: string } = {}) {
  const sessions: Row[] = [];
  const deliveries: Row[] = [];
  let seq = 1000;
  const prisma: any = {
    trainingSession: {
      findMany: async ({ where }: any) => sessions
        .filter((s) => s.userId === where.userId && s.scheduledDate >= where.scheduledDate.gte && s.scheduledDate <= where.scheduledDate.lte && s.plan.status === 'active')
        .sort((a, b) => a.scheduledDate - b.scheduledDate || a.id.localeCompare(b.id)),
      findUnique: async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null,
    },
    workoutDelivery: {
      create: async ({ data }: any) => { const row = { id: `d${deliveries.length + 1}`, requestedAt: new Date(2026, 9, 20, 0, 0, deliveries.length), sentAt: null, ...data }; deliveries.push(row); return row; },
      findUnique: async ({ where }: any) => deliveries.find((d) => d.id === where.id) ?? null,
      update: async ({ where, data }: any) => { const row = deliveries.find((d) => d.id === where.id)!; Object.assign(row, data); return row; },
      findMany: async ({ where }: any) => deliveries
        .filter((d) => (!where.provider || d.provider === where.provider)
          && (!where.status || (typeof where.status === 'string' ? d.status === where.status : where.status.in.includes(d.status)))
          && (!where.trainingSessionId || where.trainingSessionId.in.includes(d.trainingSessionId))
          && (!where.externalWorkoutId || d.externalWorkoutId != null)
          && (!where.trainingSession || sessions.find((s) => s.id === d.trainingSessionId)?.userId === where.trainingSession.userId))
        .sort((a, b) => b.requestedAt - a.requestedAt),
    },
  };
  const posts: any[] = [];
  const client = { publish: jest.fn(async (_token: string, body: any): Promise<ZeppPublishResult> => { posts.push(JSON.parse(JSON.stringify(body))); return options.publish ? options.publish(body) : { ok: true }; }) };
  const state = { connected: options.connected ?? true, authorized: options.authorized ?? true, today: options.today ?? '2026-10-20' };
  const consent = { isAllowed: jest.fn(async (_p: string, _u: string, _c: string, purpose?: string) => (purpose === WATCH_DELIVERY_PURPOSE ? state.connected && state.authorized : state.connected)) };
  const connections = { getAccessToken: jest.fn(async () => 'token-secreto') };
  const config = { get: (key: string) => (key === 'ZEPP_WORKOUT_PUBLISH_ENABLED' ? ((options.enabled ?? true) ? 'true' : 'false') : undefined) };
  const service = new ZeppWorkoutPublisherService(prisma, new WorkoutDeliveryService(prisma), connections as any, consent as any, client as any, config as any, {
    profile: options.profile ?? HYPOTHETICAL, today: () => state.today, nextWorkoutId: async () => seq++,
  });
  const addSession = (id: string, date: string, structure: unknown = continuous, extra: Row = {}) => {
    const row = { id, userId: 'u1', scheduledDate: new Date(`${date}T00:00:00Z`), modality: 'corrida', origin: null, title: `Treino ${id}`, distanceKm: null, structure, plan: { status: 'active' }, completion: null, executionLinks: [], ...extra };
    sessions.push(row);
    return row;
  };
  return { service, sessions, deliveries, posts, client, state, consent, connections, addSession };
}

describe('publicador Zepp (reconciliacao da janela)', () => {
  it('desligado (ZEPP_WORKOUT_PUBLISH_ENABLED != true): nao faz nada', async () => {
    const t = makePublisher({ enabled: false });
    t.addSession('a', '2026-10-21');
    expect(await t.service.reconcile('u1')).toEqual({ status: 'disabled' });
    expect(t.posts).toHaveLength(0);
    expect(t.deliveries).toHaveLength(0);
  });

  it('perfil NAO confirmado: nenhum treino e enviado e o motivo fica visivel ("aguardando resposta da Zepp")', async () => {
    const t = makePublisher({ profile: ZEPP_PROFILE_UNCONFIRMED });
    t.addSession('a', '2026-10-21');
    const result = await t.service.reconcile('u1');
    expect(result).toMatchObject({ status: 'unchanged', workouts: 0 });
    expect(t.posts).toHaveLength(0);
    const status = await t.service.status('u1');
    expect(status.unitProfileConfirmed).toBe(false);
    expect(status.skipped[0]).toMatchObject({ sessionId: 'a', pendingZeppAnswer: true });
  });

  it('publica a janela inteira, grava entregas "sent" com id inteiro estavel e nao reenvia se nada mudou', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    t.addSession('b', '2026-10-23', interval);
    t.addSession('fora', '2026-10-30'); // fora da janela de 7 dias
    t.addSession('forca', '2026-10-22', { type: 'strength' }, { modality: 'forca' });
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', workouts: 2 });
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]).toMatchObject({ startDate: '2026-10-20', endDate: '2026-10-26' });
    expect(t.posts[0].workouts.map((w: any) => [w.workoutId, w.workoutDate])).toEqual([[1000, '2026-10-21'], [1001, '2026-10-23']]);
    expect(t.deliveries.map((d) => [d.provider, d.status, d.externalWorkoutId])).toEqual([[ZEPP_WORKOUT_PROVIDER, 'sent', '1000'], [ZEPP_WORKOUT_PROVIDER, 'sent', '1001']]);
    expect(t.deliveries.some((d) => d.status === 'delivered_to_device')).toBe(false);
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'unchanged', workouts: 2 });
    expect(t.posts).toHaveLength(1);
  });

  it('edicao de um treino: reenvia a janela COMPLETA (os dois treinos), reaproveita o workoutId e cancela a entrega antiga', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    t.addSession('b', '2026-10-23', interval);
    await t.service.reconcile('u1');
    t.sessions[0].structure = { type: 'run', blocks: [{ ...continuous.blocks[0], distanceValue: 10 }] };
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', workouts: 2 });
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1].workouts.map((w: any) => w.workoutId)).toEqual([1000, 1001]);
    expect(t.posts[1].workouts[0].steps[0].durationValue).toBe(10000);
    const forA = t.deliveries.filter((d) => d.trainingSessionId === 'a');
    expect(forA.map((d) => d.status)).toEqual(['canceled', 'sent']);
    expect(new Set(forA.map((d) => d.externalWorkoutId)).size).toBe(1);
  });

  it('treino concluido sai da janela (reenvio so com o restante); se TUDO sair, NAO envia lista vazia: pede decisao explicita', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    t.addSession('b', '2026-10-23');
    await t.service.reconcile('u1');
    t.sessions[0].completion = { status: 'done' };
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', workouts: 1 });
    expect(t.posts[1].workouts.map((w: any) => w.workoutId)).toEqual([1001]);
    t.sessions[1].plan = { status: 'archived' };
    const result = await t.service.reconcile('u1');
    expect(result).toMatchObject({ status: 'clear_required' });
    expect(t.posts).toHaveLength(2); // nenhuma janela vazia enviada
    expect(t.deliveries.filter((d) => d.status === 'sent')).toHaveLength(1); // o que esta no relogio continua registrado
  });

  it('retirada EXPLICITA envia a janela vazia e cancela as entregas; exige conexao', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    expect(await t.service.clearWindow('u1')).toMatchObject({ status: 'cleared' });
    expect(t.posts[1]).toEqual({ startDate: '2026-10-20', endDate: '2026-10-26', workouts: [] });
    expect(t.deliveries.every((d) => d.status === 'canceled')).toBe(true);
  });

  it('aluno retira a autorizacao COM a conexao ativa: os treinos saem da Zepp; desconectado: so cancela localmente, SEM lista vazia', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.state.authorized = false;
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'cleared', reason: 'autorizacao_retirada' });
    expect(t.posts[1].workouts).toEqual([]);

    const d = makePublisher();
    d.addSession('a', '2026-10-21');
    await d.service.reconcile('u1');
    d.state.connected = false;
    expect(await d.service.reconcile('u1')).toEqual({ status: 'not_connected' });
    expect(d.posts).toHaveLength(1); // nenhum envio na desconexao
    expect(d.deliveries.every((row) => row.status === 'canceled')).toBe(true);
  });

  it('sem autorizacao desde o inicio: nada enviado', async () => {
    const t = makePublisher({ authorized: false });
    t.addSession('a', '2026-10-21');
    expect(await t.service.reconcile('u1')).toEqual({ status: 'not_connected' });
    expect(t.posts).toHaveLength(0);
  });

  it('falha da Zepp: entrega marcada "failed" com motivo (sem token), nada vira "sent" e a proxima rodada tenta de novo', async () => {
    let fail = true;
    const t = makePublisher({ publish: () => (fail ? { ok: false, kind: 'server', httpStatus: 500, code: -99, message: 'A Zepp nao processou o envio agora.' } : { ok: true }) });
    t.addSession('a', '2026-10-21');
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'failed', kind: 'server' });
    expect(t.deliveries[0]).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(t.deliveries)).not.toContain('token-secreto');
    fail = false;
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', workouts: 1 });
    expect(t.deliveries.map((d) => d.status)).toEqual(['failed', 'sent']);
    expect(new Set(t.deliveries.map((d) => d.externalWorkoutId)).size).toBe(1); // mesmo workoutId na nova tentativa
  });

  it('duas reconciliacoes simultaneas do mesmo aluno: uma unica publicacao', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    const [x, y] = await Promise.all([t.service.reconcile('u1'), t.service.reconcile('u1')]);
    expect([x.status, y.status].sort()).toEqual(['published', 'unchanged']);
    expect(t.posts).toHaveLength(1);
  });

  it('a Zepp NAO estende a janela sozinha: mesmo sem mudanca, a janela COMPLETA e republicada uma vez por dia (mesmos workoutIds, sem entregas novas)', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    t.addSession('b', '2026-10-23', interval);
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', workouts: 2 });
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'unchanged', workouts: 2 }); // mesmo dia: nada a fazer
    expect(t.posts).toHaveLength(1);
    t.state.today = '2026-10-21'; // virou o dia local
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'republished', workouts: 2 });
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1]).toMatchObject({ startDate: '2026-10-21', endDate: '2026-10-27' });
    expect(t.posts[1].workouts.map((w: any) => w.workoutId)).toEqual([1000, 1001]); // a janela inteira, com os mesmos ids
    expect(t.deliveries).toHaveLength(2); // nenhuma entrega nova: so' o carimbo do novo aceite
    expect(t.deliveries.every((d) => d.status === 'sent' && d.providerMetadata.windowAcceptedDate === '2026-10-21' && typeof d.providerMetadata.windowAcceptedAt === 'string')).toBe(true);
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'unchanged', workouts: 2 }); // no mesmo dia nao republica de novo
    expect(t.posts).toHaveLength(2);
  });

  it('republicacao diaria: falha da Zepp nao marca como aceito (tenta de novo); sem treinos elegiveis nunca envia lista vazia', async () => {
    let fail = false;
    const t = makePublisher({ publish: () => (fail ? { ok: false, kind: 'server', httpStatus: 500, code: -99, message: 'falhou' } : { ok: true }) });
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.state.today = '2026-10-21';
    fail = true;
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'failed', kind: 'server' });
    expect(t.deliveries[0].providerMetadata.windowAcceptedDate).toBe('2026-10-20'); // continua o ultimo aceite real
    fail = false;
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'republished' });
    // dia seguinte, o unico treino ja passou: nada elegivel => nao envia janela vazia
    t.state.today = '2026-10-22';
    const before = t.posts.length;
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'unchanged', workouts: 0 });
    expect(t.posts).toHaveLength(before);
  });

  it('o aceite da API fica registrado como "enviado" e NUNCA como recebido no relogio', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.state.today = '2026-10-21';
    await t.service.reconcile('u1');
    expect(t.deliveries.some((d) => d.status === 'delivered_to_device')).toBe(false);
    const status = await t.service.status('u1');
    expect(status).toMatchObject({ acceptedByZepp: 1, windowAcceptedToday: true });
    expect(status).not.toHaveProperty('onWatch');
  });

  it('sessao ja realizada, extra do relogio e distancia inconsistente nao sao enviadas', async () => {
    const t = makePublisher();
    t.addSession('feita', '2026-10-21', continuous, { executionLinks: [{ id: 'l' }] });
    t.addSession('extra', '2026-10-22', continuous, { origin: 'device_extra' });
    t.addSession('dist', '2026-10-23', continuous, { distanceKm: 12 }); // estrutura diz 8 km
    t.addSession('ok', '2026-10-24', continuous, { distanceKm: 8 });
    const result = await t.service.reconcile('u1');
    expect(result).toMatchObject({ status: 'published', workouts: 1 });
    const status = await t.service.status('u1');
    expect(status.skipped.map((s) => s.reason).sort()).toEqual(['distancia_inconsistente', 'sessao_extra', 'sessao_ja_realizada']);
  });
});

describe('protecoes estruturais do envio', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', 'src', file), 'utf8');

  it('janela vazia so e permitida em UM lugar do publicador (retirada explicita) e a rota exige confirmacao', async () => {
    expect(read('zepp/zepp-workout-publisher.service.ts').match(/allowEmpty:\s*true/g)).toHaveLength(1);
    const controller = new ZeppController({} as any, {} as any, { clearWindow: jest.fn() } as any);
    expect(() => controller.workoutsClear({ sub: 'u1' } as any, {} as any)).toThrow(/Confirme/);
  });

  it('o cliente da Zepp so e usado pelo publicador e o adaptador nao importa nada de outro provedor', () => {
    const publisher = read('zepp/zepp-workout-publisher.service.ts');
    expect(publisher).not.toMatch(/polar|wahoo|strava|apple/i);
    const translator = read('zepp/zepp-workout-spec.ts');
    expect(translator).not.toMatch(/from '@nestjs|from '\.\.\/prisma|fetch\(/);
  });

  it('m/s nunca aparece em interface: nenhuma tela do app do aluno nem do painel do treinador escreve velocidade em m/s (o aluno ve sempre min/km)', () => {
    const roots = [join(__dirname, '..', '..', 'mobile'), join(__dirname, '..', '..', 'admin', 'app')];
    const skip = new Set(['node_modules', '.next', '.next-build', 'dist', 'android', 'ios', '.expo']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\bm\/s\b|\bm_per_s\b|PACE_LAP|targetValue(Low|High)/.test(readFileSync(path, 'utf8'))) offenders.push(path);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });

  it('o app do aluno mostra ritmo SEMPRE em min/km: nenhum texto de interface em km/h (prescricao so com velocidade e convertida para pace)', () => {
    const mobile = join(__dirname, '..', '..', 'mobile');
    const skip = new Set(['node_modules', '.expo', 'android', 'ios', 'dist']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const code = readFileSync(path, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
        if (code.includes('km/h')) offenders.push(path);
      }
    };
    walk(mobile);
    expect(offenders).toEqual([]);
  });

  it('o perfil real so tem o que a Zepp confirmou (metros e m/s); o resto continua nulo e nenhuma enumeracao foi inventada', () => {
    expect(ZEPP_WORKOUT_PROFILE).toEqual({ ...ZEPP_PROFILE_UNCONFIRMED, distanceUnit: 'm', paceUnit: 'm_per_s' });
    const translator = read('zepp/zepp-workout-spec.ts');
    // intensities do schema publicado; nenhum valor fora da lista documentada
    expect(translator).toMatch(/ZEPP_DOCUMENTED_INTENSITIES = \['WARMUP', 'COOLDOWN', 'INTERVAL', 'REST', 'RECOVERY', 'ACTIVE'\]/);
  });
});

describe('nome do treino no relogio: Corrida + km + data (22/10/2026)', () => {
  it('formata tipo, distancia prescrita e data; sem distancia, so a data; nunca estima', () => {
    expect(zeppWorkoutName(11, '2026-10-25')).toBe('Corrida 11 km · 25/10');
    expect(zeppWorkoutName(10.5, '2026-10-25')).toBe('Corrida 10,5 km · 25/10');
    expect(zeppWorkoutName(6.04, '2026-10-23')).toBe('Corrida 6 km · 23/10');
    for (const none of [null, undefined, 0, -3, NaN]) expect(zeppWorkoutName(none as never, '2026-10-23')).toBe('Corrida · 23/10');
  });

  it('a data do nome e a mesma enviada em workoutDate; nome novo muda a identidade do conteudo (republica uma vez)', () => {
    const a = translateToZeppWorkout(canonical(continuous), ctx, HYPOTHETICAL);
    const b = translateToZeppWorkout(canonical(continuous), { ...ctx, distanceKm: 9 }, HYPOTHETICAL);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.workout.workoutName.endsWith('22/10')).toBe(true);
      expect(a.workout.workoutDate).toBe('2026-10-22');
      expect(a.specHash).not.toBe(b.specHash);
    }
  });
});
