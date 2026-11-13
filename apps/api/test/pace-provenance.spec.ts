import 'reflect-metadata';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { EvolutionSummaryService } from '../src/training-intelligence/evolution-summary.service';
import { isImpossiblePace, paceFromEntry, paceProvenanceSentence } from '../src/training-intelligence/pace-plausibility';
import { WorkoutCompletionsService } from '../src/workout-completions/workout-completions.service';

// Ritmo (14/11/2026, ordem de Elton): relógio + treino preenchido à mão (sem relógio), sem ritmo impossível, com a frase de "como foi computado"; e aviso à aluna para confirmar o dado impossível.
const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 10, 12);
const day = (i: number) => new Date(START + i * DAY);

describe('limites e frase de procedência', () => {
  it('ritmo impossível = fora dos limites do registro (2:00 a 20:00 por km); 1:30/km e 25:00/km são impossíveis, 5:00/km não', () => {
    expect(isImpossiblePace(90)).toBe(true);
    expect(isImpossiblePace(1500)).toBe(true);
    expect(isImpossiblePace(300)).toBe(false);
    expect(isImpossiblePace(120)).toBe(false);
    expect(isImpossiblePace(Number.NaN)).toBe(true);
  });

  it('ritmo preenchido = tempo ÷ distância; sem um deles, usa o ritmo informado; sem nada, nulo', () => {
    expect(paceFromEntry(5, 25)).toBe(300);
    expect(paceFromEntry(null, 25, 310)).toBe(310);
    expect(paceFromEntry(null, null, null)).toBeNull();
  });

  it('a frase diz quantos vieram do relógio, quantos preenchidos e quantos ficaram de fora', () => {
    expect(paceProvenanceSentence({ watch: 12, manual: 3, discarded: 0 })).toBe('Base: 12 treinos do relógio e 3 preenchidos por você.');
    expect(paceProvenanceSentence({ watch: 0, manual: 1, discarded: 2 })).toContain('1 preenchido por você');
    expect(paceProvenanceSentence({ watch: 0, manual: 1, discarded: 2 })).toContain('2 treinos ficaram de fora por ritmo impossível');
    expect(paceProvenanceSentence({ watch: 0, manual: 0, discarded: 0 })).toBeNull();
  });
});

describe('leitor dos treinos preenchidos', () => {
  const rows = [
    { id: 'c1', distanceKm: 5, durationMin: 25, session: { modality: 'corrida', scheduledDate: day(1) } },
    { id: 'c2', distanceKm: 5, durationMin: 30, session: { modality: 'esteira', scheduledDate: day(2) } }, // esteira = corrida
    { id: 'c3', distanceKm: 5, durationMin: 30, session: { modality: 'forca', scheduledDate: day(3) } }, // não é corrida
  ];
  it('só corrida (esteira inclusa), sem atividade do relógio vinculada, só preenchidos à mão; devolve tempo ÷ distância', async () => {
    const findMany = jest.fn().mockResolvedValue(rows);
    const reader = new ObservationReaderService({ workoutCompletion: { findMany } } as never, {} as never, {} as never);
    const out = await reader.getManualPaceObservations('u1');
    expect(out.map((o) => o.value)).toEqual([300, 360]);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', source: 'manual', session: { executionLinks: { none: { status: 'active' } } } });
    expect(where.status).toEqual({ in: ['done', 'adjusted'] });
  });
});

describe('Evolução: ritmo com relógio + preenchido, sem impossível', () => {
  it('conta cada origem, descarta o impossível (fora da média) e diz isso à aluna; a série do relógio entregue à IA não é tocada', async () => {
    const watch = Array.from({ length: 30 }, (_, i) => ({ value: 400, timestamp: day(i) }));
    const manual = [...Array.from({ length: 5 }, (_, i) => ({ value: 380, timestamp: day(31 + i) })), { value: 90, timestamp: day(40) }, { value: 95, timestamp: day(41) }];
    const reader = { getObservations: jest.fn(async (_u: string, v: string) => (v === 'activity.avgPaceSecondsKm' ? watch : [])), getManualPaceObservations: jest.fn(async () => manual) };
    const out = await new EvolutionSummaryService(reader as never, new MathLayerService()).forStudent('u1');
    const pace = out.areas.find((a) => a.id === 'training')!.indicators.find((i) => i.variableId === 'activity.avgPaceSecondsKm')!;
    expect(pace.n).toBe(35);
    expect(pace.texts.habitual).toContain('30 treinos do relógio');
    expect(pace.texts.habitual).toContain('5 preenchidos por você');
    expect(pace.texts.habitual).toContain('2 treinos ficaram de fora por ritmo impossível');
    expect(pace.mean).toBeGreaterThan(390); // 1:30/km fora: a média não despenca
    expect(watch).toHaveLength(30);
    expect(reader.getObservations).not.toHaveBeenCalledWith('u1', 'activity.avgPaceSecondsKm', expect.anything());
  });

  it('falha ao ler os preenchidos: segue só com o relógio, sem derrubar o indicador', async () => {
    const watch = Array.from({ length: 12 }, (_, i) => ({ value: 400, timestamp: day(i) }));
    const reader = { getObservations: jest.fn(async (_u: string, v: string) => (v === 'activity.avgPaceSecondsKm' ? watch : [])), getManualPaceObservations: jest.fn(async () => { throw new Error('banco fora'); }) };
    const out = await new EvolutionSummaryService(reader as never, new MathLayerService()).forStudent('u1');
    const pace = out.areas.find((a) => a.id === 'training')!.indicators.find((i) => i.variableId === 'activity.avgPaceSecondsKm')!;
    expect(pace.status).toBe('ok');
    expect(pace.texts.habitual).toContain('12 treinos do relógio');
  });
});

describe('aviso ao salvar o treino com ritmo impossível', () => {
  function build(modality = 'corrida') {
    const session = { id: 's1', userId: 'u1', scheduledDate: day(1), title: 'Corrida', modality, routineMismatchNote: null };
    const prisma = {
      trainingSession: { findFirst: jest.fn().mockResolvedValue(session) },
      workoutCompletion: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'c1', ...create })) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', name: 'Aluna', studentCode: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      userNotification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      nightlySleepLog: { upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'n1', ...create })) },
      stressCheckin: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'st1', ...data })) },
    };
    const notifications = { notifyUserIfNotRecent: jest.fn().mockResolvedValue(true) };
    const service = new WorkoutCompletionsService(prisma as never, { get: jest.fn().mockReturnValue('') } as never, { recordEvent: jest.fn().mockResolvedValue(undefined) } as never, { notifyCoach: jest.fn().mockResolvedValue(undefined) } as never, { linkFirstObservationIfPending: jest.fn().mockResolvedValue(undefined) } as never, { record: jest.fn() } as never, { evaluateForUser: jest.fn().mockResolvedValue([]) } as never, { setUsage: jest.fn() } as never, undefined, notifications as never);
    return { service, notifications };
  }
  const dto = (extra: Record<string, unknown>) => ({ sessionId: 's1', status: 'done', perceivedEffort: 6, satisfactionElaboracao: 'gostei', painFlag: 'none', preSleepQuality: 4, prePhysicalFatigue: 2, preStressLevel: 2, preMotivation: 4, satisfactionCapacidade: 'gostei', postWorkoutFeeling: 4, ...extra }) as never;
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('1:30/km digitado: avisa com o dado que ela registrou, abre o feedback do treino, não altera nada e não repete para os mesmos números', async () => {
    const { service, notifications } = build();
    await service.upsert('u1', dto({ distanceKm: 5, durationMin: 7.5 }));
    await flush();
    expect(notifications.notifyUserIfNotRecent).toHaveBeenCalledTimes(1);
    const [userId, params] = notifications.notifyUserIfNotRecent.mock.calls[0];
    expect(userId).toBe('u1');
    expect(params.title).toBe('Você confirma esse dado?');
    expect(params.message).toContain('5 km em 8 min');
    expect(params.message).toContain('1:30/km');
    expect(params.message).toContain('fica fora da sua média de ritmo');
    expect(params.action).toBe('training_feedback:s1');
    expect(params.externalRef).toBe('pace-check:c1:5:7.5');
  });

  it('ritmo normal, treino não feito e outra modalidade não geram aviso', async () => {
    const normal = build();
    await normal.service.upsert('u1', dto({ distanceKm: 5, durationMin: 25 }));
    const strength = build('forca');
    await strength.service.upsert('u1', dto({ distanceKm: 5, durationMin: 7.5 }));
    await flush();
    expect(normal.notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    expect(strength.notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
  });

  it('falha ao notificar não derruba o salvamento do feedback', async () => {
    const { service, notifications } = build();
    notifications.notifyUserIfNotRecent.mockRejectedValue(new Error('push fora'));
    await expect(service.upsert('u1', dto({ distanceKm: 5, durationMin: 7.5 }))).resolves.toBeTruthy();
    await flush();
  });
});
