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
});
