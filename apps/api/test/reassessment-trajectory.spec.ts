import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { ReassessmentService, REASSESSMENT_DUE_AFTER_DAYS, REASSESSMENT_WARNING_AFTER_DAYS } from '../src/reassessment/reassessment.service';
import { buildReassessmentTrajectories, buildFitnessTestTrajectory, REASSESSMENT_INSTRUMENT_VERSION } from '../src/reassessment/reassessment-trajectory';

// 25/09/2026 — Passo 3 (reavaliacao de 15 semanas + Evolution Report). Cobre as propriedades
// pedidas: trajetoria INITIAL->R1->R2->R3 comparavel, missing != zero, ciclo = 105 dias, ancora
// correta, aviso na semana 14, e o gate de geracao quando a reavaliacao esta due. NENHUM teste
// aqui afirma "trajetoria X -> prescricao Y" — sao propriedades de integridade de dados.

function noop() {
  return {} as never;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400000);
}

describe('reassessment-trajectory — comparabilidade longitudinal (secoes 6, 7, 8, 9, 10, 29, 30)', () => {
  it('L/M. os 17 ratings sao DIRECT e preservam INITIAL -> R1 -> R2 sem reduzir ao ultimo ponto', () => {
    const onboarding = { answers: { rating_energy: 5 }, completedAt: new Date('2026-01-01T00:00:00Z'), interviewVersion: 1 };
    const reassessments = [
      { id: 'r1', answers: { rating_energy: 7 }, completedAt: new Date('2026-04-15T00:00:00Z'), reassessmentVersion: REASSESSMENT_INSTRUMENT_VERSION },
      { id: 'r2', answers: { rating_energy: 6 }, completedAt: new Date('2026-07-29T00:00:00Z'), reassessmentVersion: REASSESSMENT_INSTRUMENT_VERSION },
    ];
    const trajectories = buildReassessmentTrajectories(onboarding, reassessments);
    const energy = trajectories.find((t) => t.variableId === 'reassessment.rating_energy')!;
    expect(energy.comparability).toBe('DIRECT');
    expect(energy.points.map((p) => p.value)).toEqual([5, 7, 6]);
    expect(energy.n).toBe(3);
  });

  it('O. missing (versao antiga sem o campo) nunca vira zero', () => {
    const onboarding = { answers: { rating_sleep: 8 }, completedAt: new Date(), interviewVersion: 1 };
    const legacyReassessment = { id: 'r1', answers: { reassessment_satisfaction: 'satisfeito' }, completedAt: new Date(), reassessmentVersion: null };
    const trajectories = buildReassessmentTrajectories(onboarding, [legacyReassessment]);
    const sleep = trajectories.find((t) => t.variableId === 'reassessment.rating_sleep')!;
    expect(sleep.points[1].value).toBeNull();
    expect(sleep.points[1].value).not.toBe(0);
    expect(sleep.n).toBe(1);
  });

  it('P. peso gera serie DIRECT correta (mesma unidade kg nos dois instrumentos)', () => {
    const onboarding = { answers: { personal_weight: '82,5' }, completedAt: new Date(), interviewVersion: 1 };
    const reassessments = [{ id: 'r1', answers: { reassessment_weight: 80 }, completedAt: new Date(), reassessmentVersion: REASSESSMENT_INSTRUMENT_VERSION }];
    const trajectories = buildReassessmentTrajectories(onboarding, reassessments);
    const weight = trajectories.find((t) => t.variableId === 'reassessment.weight')!;
    expect(weight.comparability).toBe('DIRECT');
    expect(weight.points.map((p) => p.value)).toEqual([82.5, 80]);
  });

  it('Q. km semanal normaliza o campo legado (reassessment_weekly_km_now) para a mesma serie, sem reescrever o valor original', () => {
    const onboarding = { answers: { weekly_running_km: 20 }, completedAt: new Date(), interviewVersion: 1 };
    const legacy = { id: 'r1', answers: { reassessment_weekly_km_now: '28' }, completedAt: new Date(), reassessmentVersion: null };
    const current = { id: 'r2', answers: { weekly_running_km: 36 }, completedAt: new Date(), reassessmentVersion: REASSESSMENT_INSTRUMENT_VERSION };
    const trajectories = buildReassessmentTrajectories(onboarding, [legacy, current]);
    const km = trajectories.find((t) => t.variableId === 'reassessment.weekly_running_km')!;
    expect(km.points.map((p) => p.value)).toEqual([20, 28, 36]);
    expect(km.points[1].normalized).toBe(true);
    expect(legacy.answers.reassessment_weekly_km_now).toBe('28'); // nunca reescrito
  });

  it('R. objetivo preserva trajetoria categorica e e PARTIAL (legado nao e convertido automaticamente)', () => {
    const onboarding = { answers: { objective: 'Completar 5 km' }, completedAt: new Date(), interviewVersion: 1 };
    const legacy = { id: 'r1', answers: { reassessment_goal_change: 'changed', reassessment_goal_new: 'quero correr mais' }, completedAt: new Date(), reassessmentVersion: null };
    const current = { id: 'r2', answers: { objective: 'Completar 21 km' }, completedAt: new Date(), reassessmentVersion: REASSESSMENT_INSTRUMENT_VERSION };
    const trajectories = buildReassessmentTrajectories(onboarding, [legacy, current]);
    const objective = trajectories.find((t) => t.variableId === 'reassessment.objective')!;
    expect(objective.comparability).toBe('PARTIAL');
    expect(objective.points.map((p) => p.value)).toEqual(['Completar 5 km', null, 'Completar 21 km']);
  });

  it('S/T. dor sem dor produz ponto "no"; dor presente abre estrutura regional separada', () => {
    const onboarding = { answers: { current_pain: 'no' }, completedAt: new Date(), interviewVersion: 1 };
    const withPain = { id: 'r1', answers: { current_pain: 'yes', pain_regions: ['Joelho direito'] }, completedAt: new Date(), reassessmentVersion: REASSESSMENT_INSTRUMENT_VERSION };
    const trajectories = buildReassessmentTrajectories(onboarding, [withPain]);
    const pain = trajectories.find((t) => t.variableId === 'reassessment.current_pain')!;
    const regions = trajectories.find((t) => t.variableId === 'reassessment.pain_regions')!;
    expect(pain.points.map((p) => p.value)).toEqual(['no', 'yes']);
    expect(pain.comparability).toBe('DIRECT');
    expect(regions.points[1].value).toEqual(['Joelho direito']);
    expect(regions.comparability).toBe('PARTIAL');
  });

  it('U. dor historica antiga (formato legado "dor nova") continua preservada no answers, mas nao entra na serie current_pain', () => {
    const legacy = { id: 'r1', answers: { reassessment_new_pain: 'yes', reassessment_new_pain_detail: 'joelho direito' }, completedAt: new Date(), reassessmentVersion: null };
    const trajectories = buildReassessmentTrajectories(null, [legacy]);
    const pain = trajectories.find((t) => t.variableId === 'reassessment.current_pain')!;
    expect(pain.points[1].value).toBeNull();
    expect(legacy.answers.reassessment_new_pain).toBe('yes');
  });

  it('X/Y. FitnessTest preserva trajetoria inteira (nao reduz ao ultimo) e nao inventa quando vazio', () => {
    const tests = [
      { createdAt: new Date('2026-06-01'), paceSecondsPerKm: 360, totalSeconds: 1080, vo2maxEstimated: 40 },
      { createdAt: new Date('2026-03-01'), paceSecondsPerKm: 400, totalSeconds: 1200, vo2maxEstimated: 35 },
    ];
    const trajectory = buildFitnessTestTrajectory(tests);
    expect(trajectory.map((t) => t.paceSecondsPerKm)).toEqual([400, 360]); // ordenado cronologicamente
    expect(buildFitnessTestTrajectory([])).toEqual([]);
  });
});

describe('ReassessmentService — ciclo de 105 dias e ancora (secoes 3, 4)', () => {
  function buildService(prisma: Record<string, unknown>) {
    return new ReassessmentService(prisma as never, noop(), noop(), noop());
  }

  it('D. ciclo oficial e 105 dias (15 semanas), nao 90', () => {
    expect(REASSESSMENT_DUE_AFTER_DAYS).toBe(105);
  });

  it('G. semana 14 (98-104 dias) marca warning=true, due=false', async () => {
    const prisma = {
      reassessment: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(null) // draft
          .mockResolvedValueOnce(null), // lastCompleted
      },
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ completedAt: daysAgo(100) }) },
    };
    const service = buildService(prisma);
    const state = await service.state('u1');
    expect(state.warning).toBe(true);
    expect(state.due).toBe(false);
  });

  it('H. 105 dias completos marca due=true', async () => {
    const prisma = {
      reassessment: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null) },
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ completedAt: daysAgo(106) }) },
    };
    const service = buildService(prisma);
    expect(await service.isReassessmentDue('u1')).toBe(true);
  });

  it('E/F. ancora e onboarding.completedAt sem reavaliacao; passa a ser a ultima Reassessment concluida depois de R1', async () => {
    const prisma = {
      reassessment: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(null) // draft
          .mockResolvedValueOnce({ completedAt: daysAgo(10) }), // lastCompleted = R1, recente
      },
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ completedAt: daysAgo(200) }) }, // muito antigo, nao deveria ser usado
    };
    const service = buildService(prisma);
    const state = await service.state('u1');
    expect(state.due).toBe(false); // usa R1 (10 dias), nao onboarding (200 dias)
    expect(state.daysSinceLast).toBe(10);
  });

  it('AE. reopen() invalida o Evolution Report associado', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      reassessment: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'r1', userId: 'u1' }) // target
          .mockResolvedValueOnce(null), // otherDraft
        update: jest.fn().mockResolvedValue({ id: 'r1', completedAt: null }),
      },
      evolutionReport: { updateMany },
    };
    const service = buildService(prisma);
    await service.reopen('u1', 'r1');
    expect(updateMany).toHaveBeenCalledWith({ where: { reassessmentId: 'r1', invalidatedAt: null }, data: { invalidatedAt: expect.any(Date) } });
  });
});

describe('TrainingPlansService.generateWeek — gate de reavaliacao necessaria (secao 5)', () => {
  it('I/J. reavaliacao due bloqueia geracao da proxima semana, sem tocar nenhuma sessao existente', async () => {
    const prisma = { trainingSession: {}, trainingPlan: {} };
    const reassessmentService = { isReassessmentDue: jest.fn().mockResolvedValue(true) };
    const service = new TrainingPlansService(
      prisma as never, noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(), noop(),
      reassessmentService as never,
    );
    await expect(service.generateWeek('u1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'reassessment_required' }),
    });
    expect(prisma.trainingPlan).not.toHaveProperty('create');
  });
});
