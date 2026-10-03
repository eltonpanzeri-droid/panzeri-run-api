import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { WeekReconciliation } from '../src/activity-execution/session-execution-link.service';

// Visualizacao Prescrito x Realizado (02/10/2026) — presentPlan() e' o serializador compartilhado
// por current()/getWeekByOffset() (ja' usado pelo mobile pra montar a tela de semana). Estes
// testes cobrem o contrato do campo novo `realized` por sessao e do novo `alternativeActivities`/
// `pendingActivities` — em particular a regra de nao duplicar uma TrainingSession sintetica
// 'device_extra' como se fosse prescricao real (pedido explicito: "nao trate uma TrainingSession
// sintetica device_extra como se fosse uma prescricao real feita pelo treinador").
function buildService() {
  const noop = {} as never;
  return new TrainingPlansService(
    noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop,
  );
}

function emptyReconciliation(): WeekReconciliation {
  return { activeLinkBySessionId: new Map(), alternativeActivities: [], pendingActivities: [] };
}

function basePlan(sessions: any[]) {
  return {
    id: 'plan-1',
    planCode: 42,
    name: 'Semana 1',
    goal: 'base',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-07T00:00:00.000Z'),
    createdAt: new Date('2026-09-30T00:00:00.000Z'),
    aiRecommendation: null,
    sessions,
  };
}

function baseSession(overrides: Partial<any> = {}) {
  return {
    id: 'session-1',
    scheduledDate: new Date('2026-10-01T00:00:00.000Z'),
    weekday: 4,
    modality: 'corrida',
    title: 'Corrida',
    durationMin: 45,
    intensityZone: null,
    paceMinSec: null,
    distanceKm: 8,
    structure: {},
    notes: null,
    recommendations: null,
    routineMismatchNote: null,
    origin: 'agent',
    completion: null,
    ...overrides,
  };
}

describe('TrainingPlansService.presentPlan — Prescrito x Realizado', () => {
  it('sessao com vinculo ativo ganha campo `realized` com os dados objetivos da atividade', () => {
    const service = buildService();
    const plan = basePlan([baseSession({ id: 'session-1' })]);
    const reconciliation: WeekReconciliation = {
      activeLinkBySessionId: new Map([
        [
          'session-1',
          {
            matchMethod: 'automatic_single_candidate',
            activityLog: {
              id: 'activity-1',
              provider: 'polar',
              startedAt: new Date('2026-10-01T10:00:00Z'),
              isoDate: '2026-10-01',
              distanceMeters: 10020,
              durationSec: 3058,
              avgPaceSecondsKm: 305,
              avgHeartRateBpm: 150,
              maxHeartRateBpm: 172,
              cadenceAvg: 162,
            },
          },
        ],
      ]),
      alternativeActivities: [],
      pendingActivities: [],
    };

    const result = service['presentPlan'](plan, true, true, reconciliation);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].distanceKm).toBe(8); // prescrito, intocado
    expect(result.sessions[0].realized).toMatchObject({
      activityLogId: 'activity-1',
      provider: 'polar',
      distanceKm: 10.02,
      avgPaceSecondsKm: 305,
      cadenceAvg: 162,
    });
  });

  it('sessao sem vinculo ativo tem `realized` null (nao inferida como nao realizada)', () => {
    const service = buildService();
    const plan = basePlan([baseSession({ id: 'session-1' })]);

    const result = service['presentPlan'](plan, true, true, emptyReconciliation());

    expect(result.sessions[0].realized).toBeNull();
  });

  it('TrainingSession sintetica device_extra NUNCA aparece em `sessions` (nao e prescricao real)', () => {
    const service = buildService();
    const deviceExtraSession = baseSession({
      id: 'synthetic-1',
      origin: 'device_extra',
      modality: 'bike',
      title: 'bike (extra · polar)',
      structure: { type: 'extra', source: 'device', provider: 'polar', modality: 'bike', activityLogId: 'activity-2' },
      completion: {
        status: 'done',
        completedAt: new Date('2026-10-02T09:00:00Z'),
        durationMin: 90,
        distanceKm: 42,
        avgPaceSecondsKm: null,
        avgHeartRate: 140,
        maxHeartRate: 160,
      },
    });
    const prescribedSession = baseSession({ id: 'session-1' });
    const plan = basePlan([prescribedSession, deviceExtraSession]);

    const result = service['presentPlan'](plan, true, true, emptyReconciliation());

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe('session-1');
    expect(result.sessions.some((s: any) => s.id === 'synthetic-1')).toBe(false);
  });

  it('TrainingSession sintetica device_extra aparece em `alternativeActivities`, nao duplicada', () => {
    const service = buildService();
    const deviceExtraSession = baseSession({
      id: 'synthetic-1',
      origin: 'device_extra',
      modality: 'bike',
      structure: { type: 'extra', source: 'device', provider: 'polar', modality: 'bike', activityLogId: 'activity-2' },
      completion: {
        status: 'done',
        completedAt: new Date('2026-10-02T09:00:00Z'),
        durationMin: 90,
        distanceKm: 42,
        avgPaceSecondsKm: null,
        avgHeartRate: 140,
        maxHeartRate: 160,
      },
    });
    const plan = basePlan([deviceExtraSession]);

    const result = service['presentPlan'](plan, true, true, emptyReconciliation());

    expect(result.alternativeActivities).toHaveLength(1);
    expect(result.alternativeActivities[0]).toMatchObject({
      activityLogId: 'activity-2',
      provider: 'polar',
      modality: 'bike',
      distanceKm: 42,
      durationMin: 90,
    });
  });

  it('atividade alternative ainda nao materializada (vinda do read model) aparece em alternativeActivities', () => {
    const service = buildService();
    const plan = basePlan([baseSession({ id: 'session-1' })]);
    const reconciliation: WeekReconciliation = {
      activeLinkBySessionId: new Map(),
      alternativeActivities: [
        {
          id: 'activity-3',
          provider: 'polar',
          startedAt: new Date('2026-10-03T08:00:00Z'),
          isoDate: '2026-10-03',
          distanceMeters: null,
          durationSec: 4800,
          avgPaceSecondsKm: null,
          avgHeartRateBpm: null,
          maxHeartRateBpm: null,
          cadenceAvg: null,
        },
      ],
      pendingActivities: [],
    };

    const result = service['presentPlan'](plan, true, true, reconciliation);

    expect(result.alternativeActivities).toHaveLength(1);
    expect(result.alternativeActivities[0]).toMatchObject({ activityLogId: 'activity-3', durationMin: 80, distanceKm: null });
  });

  it('corrida prescrita + corrida correspondente + ciclismo: corrida ganha `realized`, ciclismo vira alternativeActivities, nenhuma desaparece', () => {
    const service = buildService();
    const corridaSession = baseSession({ id: 'session-1', modality: 'corrida' });
    const plan = basePlan([corridaSession]);
    const reconciliation: WeekReconciliation = {
      activeLinkBySessionId: new Map([
        [
          'session-1',
          {
            matchMethod: 'automatic_single_candidate',
            activityLog: {
              id: 'activity-corrida',
              provider: 'polar',
              startedAt: new Date('2026-10-01T07:00:00Z'),
              isoDate: '2026-10-01',
              distanceMeters: 10000,
              durationSec: 3000,
              avgPaceSecondsKm: 300,
              avgHeartRateBpm: 150,
              maxHeartRateBpm: 170,
              cadenceAvg: null,
            },
          },
        ],
      ]),
      alternativeActivities: [
        {
          id: 'activity-bike',
          provider: 'polar',
          startedAt: new Date('2026-10-01T18:00:00Z'),
          isoDate: '2026-10-01',
          distanceMeters: 20000,
          durationSec: 3600,
          avgPaceSecondsKm: null,
          avgHeartRateBpm: 130,
          maxHeartRateBpm: 145,
          cadenceAvg: null,
        },
      ],
      pendingActivities: [],
    };

    const result = service['presentPlan'](plan, true, true, reconciliation);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].realized?.activityLogId).toBe('activity-corrida');
    expect(result.alternativeActivities).toHaveLength(1);
    expect(result.alternativeActivities[0].activityLogId).toBe('activity-bike');
  });

  it('pendingActivities expoe as opcoes de candidatos pro aluno confirmar', () => {
    const service = buildService();
    const plan = basePlan([baseSession({ id: 'session-1' })]);
    const reconciliation: WeekReconciliation = {
      activeLinkBySessionId: new Map(),
      alternativeActivities: [],
      pendingActivities: [
        {
          activityLog: {
            id: 'activity-4',
            provider: 'polar',
            startedAt: new Date('2026-10-04T07:00:00Z'),
            isoDate: '2026-10-04',
            distanceMeters: 8000,
            durationSec: 2700,
            avgPaceSecondsKm: 337,
            avgHeartRateBpm: null,
            maxHeartRateBpm: null,
            cadenceAvg: null,
          },
          candidates: [
            { linkId: 'link-1', trainingSessionId: 'session-x', sessionTitle: 'Corrida X', sessionModality: 'corrida', sessionDate: '2026-10-04' },
            { linkId: 'link-2', trainingSessionId: 'session-y', sessionTitle: 'Corrida Y', sessionModality: 'corrida', sessionDate: '2026-10-04' },
          ],
        },
      ],
    };

    const result = service['presentPlan'](plan, true, true, reconciliation);

    expect(result.pendingActivities).toHaveLength(1);
    expect(result.pendingActivities[0].candidates).toHaveLength(2);
    expect(result.pendingActivities[0].candidates[0]).toMatchObject({ linkId: 'link-1', sessionTitle: 'Corrida X' });
  });

  it('sessao com completion real traz executionBehavior de volta (bug corrigido 02/10/2026 — campo faltava na resposta)', () => {
    const service = buildService();
    const plan = basePlan([
      baseSession({
        id: 'session-1',
        completion: {
          status: 'done',
          completedAt: new Date('2026-10-01T10:00:00Z'),
          durationMin: 45,
          distanceKm: 8,
          avgPaceSecondsKm: 337,
          perceivedEffort: 7,
          satisfaction: null,
          satisfactionElaboracao: 'otima',
          satisfactionCapacidade: null,
          satisfactionCarga: null,
          painFlag: 'none',
          painTiming: null,
          notes: null,
          details: null,
          preSleepQuality: 4,
          prePhysicalFatigue: 2,
          preStressLevel: 2,
          preMotivation: 4,
          postWorkoutFeeling: null,
          sleepDurationCategory: '7_a_8h',
          sleepScheduleIrregularity: null,
          sleepInterruption: 2,
          sleepDifficulty: 1,
          preMentalFatigue: 2,
          executionVsPrescribed: null,
          executionBehavior: 'as_planned',
          postPhysicalFatigue: 2,
          postMentalFatigue: 2,
          emotionalExperienceDuring: 4,
          mentalStateChangePrePost: 4,
          feedbackVersion: 3,
          avgHeartRate: null,
          maxHeartRate: null,
        },
      }),
    ]);

    const result = service['presentPlan'](plan, true, true, emptyReconciliation());

    expect(result.sessions[0].completion?.executionBehavior).toBe('as_planned');
  });

  it('Feedback de Atividade Alternativa: device_extra com feedback real (perceivedEffort preenchido) -> hasFeedback true, completion exposto', () => {
    const service = buildService();
    const deviceExtraSession = baseSession({
      id: 'synthetic-1',
      origin: 'device_extra',
      modality: 'bike',
      structure: { type: 'extra', source: 'device', provider: 'polar', modality: 'bike', activityLogId: 'activity-2' },
      completion: {
        status: 'done',
        completedAt: new Date('2026-10-02T09:00:00Z'),
        durationMin: 90,
        distanceKm: 42,
        avgPaceSecondsKm: null,
        perceivedEffort: 8,
        satisfaction: null,
        satisfactionElaboracao: null,
        satisfactionCapacidade: null,
        satisfactionCarga: null,
        painFlag: 'none',
        painTiming: null,
        notes: 'pedalei tranquilo',
        details: null,
        preSleepQuality: null,
        prePhysicalFatigue: null,
        preStressLevel: null,
        preMotivation: null,
        postWorkoutFeeling: null,
        sleepDurationCategory: null,
        sleepScheduleIrregularity: null,
        sleepInterruption: null,
        sleepDifficulty: null,
        preMentalFatigue: null,
        executionVsPrescribed: null,
        executionBehavior: null,
        postPhysicalFatigue: 2,
        postMentalFatigue: 2,
        emotionalExperienceDuring: 4,
        mentalStateChangePrePost: 4,
        feedbackVersion: 3,
        avgHeartRate: 140,
        maxHeartRate: 160,
      },
    });
    const plan = basePlan([deviceExtraSession]);

    const result = service['presentPlan'](plan, true, true, emptyReconciliation());

    expect(result.alternativeActivities).toHaveLength(1);
    expect(result.alternativeActivities[0]).toMatchObject({ sessionId: 'synthetic-1', hasFeedback: true });
    expect((result.alternativeActivities[0] as any).completion).toMatchObject({ perceivedEffort: 8, notes: 'pedalei tranquilo', executionBehavior: null });
  });

  it('Feedback de Atividade Alternativa: device_extra SEM feedback real (so o stub da materializacao) -> hasFeedback false', () => {
    const service = buildService();
    const deviceExtraSession = baseSession({
      id: 'synthetic-1',
      origin: 'device_extra',
      modality: 'bike',
      structure: { type: 'extra', source: 'device', provider: 'polar', modality: 'bike', activityLogId: 'activity-2' },
      completion: {
        status: 'done',
        completedAt: new Date('2026-10-02T09:00:00Z'),
        durationMin: 90,
        distanceKm: 42,
        avgPaceSecondsKm: null,
        perceivedEffort: null,
        satisfaction: null,
        satisfactionElaboracao: null,
        satisfactionCapacidade: null,
        satisfactionCarga: null,
        painFlag: null,
        painTiming: null,
        notes: null,
        details: null,
        preSleepQuality: null,
        prePhysicalFatigue: null,
        preStressLevel: null,
        preMotivation: null,
        postWorkoutFeeling: null,
        sleepDurationCategory: null,
        sleepScheduleIrregularity: null,
        sleepInterruption: null,
        sleepDifficulty: null,
        preMentalFatigue: null,
        executionVsPrescribed: null,
        executionBehavior: null,
        postPhysicalFatigue: null,
        postMentalFatigue: null,
        emotionalExperienceDuring: null,
        mentalStateChangePrePost: null,
        feedbackVersion: 1,
        avgHeartRate: 140,
        maxHeartRate: 160,
      },
    });
    const plan = basePlan([deviceExtraSession]);

    const result = service['presentPlan'](plan, true, true, emptyReconciliation());

    expect(result.alternativeActivities[0]).toMatchObject({ sessionId: 'synthetic-1', hasFeedback: false });
  });

  it('atividade ainda nao materializada: sessionId null, hasFeedback false, completion null (so pode registrar feedback depois de materializar)', () => {
    const service = buildService();
    const plan = basePlan([baseSession({ id: 'session-1' })]);
    const reconciliation: WeekReconciliation = {
      activeLinkBySessionId: new Map(),
      alternativeActivities: [
        {
          id: 'activity-3',
          provider: 'polar',
          isoDate: '2026-10-03',
          startedAt: new Date('2026-10-03T08:00:00Z'),
          distanceMeters: null,
          durationSec: 4800,
          avgPaceSecondsKm: null,
          avgHeartRateBpm: null,
          maxHeartRateBpm: null,
          cadenceAvg: null,
        },
      ],
      pendingActivities: [],
    };

    const result = service['presentPlan'](plan, true, true, reconciliation);

    expect(result.alternativeActivities[0]).toMatchObject({ sessionId: null, hasFeedback: false, completion: null });
  });

  it('cenario K: atividade alternativa materializada que foi DEPOIS vinculada (active) a uma prescricao real nao aparece mais como alternativa orfa', () => {
    const service = buildService();
    const realSession = baseSession({ id: 'session-real', modality: 'corrida' });
    const deviceExtraSession = baseSession({
      id: 'synthetic-1',
      origin: 'device_extra',
      modality: 'corrida',
      structure: { type: 'extra', source: 'device', provider: 'polar', modality: 'corrida', activityLogId: 'activity-corrigida' },
      completion: {
        status: 'done',
        completedAt: new Date('2026-10-01T10:00:00Z'),
        durationMin: 45,
        distanceKm: 8,
        avgPaceSecondsKm: null,
        perceivedEffort: 7,
        satisfaction: null,
        satisfactionElaboracao: null,
        satisfactionCapacidade: null,
        satisfactionCarga: null,
        painFlag: 'none',
        painTiming: null,
        notes: null,
        details: null,
        preSleepQuality: null,
        prePhysicalFatigue: null,
        preStressLevel: null,
        preMotivation: null,
        postWorkoutFeeling: null,
        sleepDurationCategory: null,
        sleepScheduleIrregularity: null,
        sleepInterruption: null,
        sleepDifficulty: null,
        preMentalFatigue: null,
        executionVsPrescribed: null,
        executionBehavior: null,
        postPhysicalFatigue: null,
        postMentalFatigue: null,
        emotionalExperienceDuring: null,
        mentalStateChangePrePost: null,
        feedbackVersion: 1,
        avgHeartRate: null,
        maxHeartRate: null,
      },
    });
    const plan = basePlan([realSession, deviceExtraSession]);
    // A mesma ActivityLog ('activity-corrigida') foi depois corrigida/vinculada a 'session-real'.
    const reconciliation: WeekReconciliation = {
      activeLinkBySessionId: new Map([
        [
          'session-real',
          {
            matchMethod: 'manual',
            activityLog: {
              id: 'activity-corrigida',
              provider: 'polar',
              startedAt: new Date('2026-10-01T10:00:00Z'),
              isoDate: '2026-10-01',
              distanceMeters: 8000,
              durationSec: 2700,
              avgPaceSecondsKm: 337,
              avgHeartRateBpm: null,
              maxHeartRateBpm: null,
              cadenceAvg: null,
            },
          },
        ],
      ]),
      alternativeActivities: [],
      pendingActivities: [],
    };

    const result = service['presentPlan'](plan, true, true, reconciliation);

    expect(result.sessions.find((s: any) => s.id === 'session-real')?.realized?.activityLogId).toBe('activity-corrigida');
    // A sessao sintetica orfa NAO aparece mais como alternativa (evita duplicidade/contradicao) —
    // o feedback que ela guardava continua no banco, so nao e' mais exibido aqui.
    expect(result.alternativeActivities.find((a: any) => a.sessionId === 'synthetic-1')).toBeUndefined();
  });
});
