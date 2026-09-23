import { WeeklyCheckInService } from '../src/training-plans/weekly-checkin.service';

// 24/09/2026 — regressao da reestruturacao do check-in semanal (9 perguntas, v3). Garante:
// (1) um envio v3 e' detectado corretamente mesmo reaproveitando colunas que a v2 tambem usa;
// (2) os campos retirados na v3 (perceivedExecution, weeklySleep, etc.) ficam null;
// (3) um envio v2 antigo (app nao atualizado) continua funcionando sem regressao;
// (4) skip() carimba a versao vigente (3).
describe('WeeklyCheckInService.submit/skip — versionamento v3', () => {
  function buildService() {
    const plan = { id: 'plan-1', startDate: new Date('2026-09-21T00:00:00.000Z') };
    const created: any[] = [];
    const prisma = {
      trainingPlan: { findFirst: jest.fn().mockResolvedValue(plan) },
      weeklyCheckIn: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => {
          created.push(data);
          return Promise.resolve({ id: 'checkin-1', ...data });
        }),
      },
    };
    const strava = { report: jest.fn().mockResolvedValue({ summary: null }) };
    const service = new WeeklyCheckInService(prisma as never, strava as never);
    return { service, created };
  }

  const counts = { asPrescribedSessions: 4, changedModalitySessions: 0, differentSessions: 0, missedSessions: 1 };

  it('detecta v3 mesmo quando reaproveita campos que a v2 tambem preenche', async () => {
    const { service, created } = buildService();
    await service.submit('user-1', {
      ...counts,
      prescriptionLiking: 4,
      prescriptionSuitability: 4,
      executionSatisfaction: 3,
      weekDemandVsNormal: 3,
      bodyResponseVsNormal: 4,
      postWeekMotivation: 4,
      expectedRoutineInterference: 2,
      preferredNextWeekTraining: 'seguir_planejamento',
      freeTextObservation: 'Tudo tranquilo essa semana.',
    } as never);

    expect(created[0].checkinVersion).toBe(3);
    expect(created[0].weekDemandVsNormal).toBe(3);
    expect(created[0].expectedRoutineInterference).toBe(2);
    expect(created[0].freeTextObservation).toBe('Tudo tranquilo essa semana.');
    // Campos retirados na v3 devem ficar null, nunca herdar lixo de outra chamada.
    expect(created[0].perceivedExecution).toBeNull();
    expect(created[0].weeklySleep).toBeNull();
    expect(created[0].currentPhysicalFatigue).toBeNull();
    expect(created[0].weeklyStress).toBeNull();
    expect(created[0].routineInterference).toBeNull();
    expect(created[0].nextWeekConfidence).toBeNull();
    expect(created[0].expectedScheduleFeasibility).toBeNull();
    expect(created[0].expectedPhysicalState).toBeNull();
    expect(created[0].nextWeekMotivation).toBeNull();
  });

  it('um envio v2 antigo (sem nenhum campo v3) continua sendo gravado como v2, sem regressao', async () => {
    const { service, created } = buildService();
    await service.submit('user-1', {
      ...counts,
      prescriptionLiking: 4,
      prescriptionSuitability: 4,
      perceivedExecution: 4,
      executionSatisfaction: 3,
      postWeekMotivation: 4,
      weeklySleep: 3,
      currentPhysicalFatigue: 3,
      weeklyStress: 2,
      routineInterference: 4,
      bodyResponseVsNormal: 4,
      nextWeekMotivation: 4,
      nextWeekConfidence: 4,
      expectedScheduleFeasibility: 4,
      expectedPhysicalState: 4,
      preferredNextWeekTraining: 'semana_normal',
    } as never);

    expect(created[0].checkinVersion).toBe(2);
    expect(created[0].perceivedExecution).toBe(4);
    expect(created[0].weeklySleep).toBe(3);
    expect(created[0].weekDemandVsNormal).toBeNull();
    expect(created[0].expectedRoutineInterference).toBeNull();
  });

  it('skip() carimba checkinVersion 3 (versao vigente do questionario)', async () => {
    const { service, created } = buildService();
    await service.skip('user-1');
    expect(created[0].checkinVersion).toBe(3);
    expect(created[0].checkinSkipped).toBe(true);
  });
});
