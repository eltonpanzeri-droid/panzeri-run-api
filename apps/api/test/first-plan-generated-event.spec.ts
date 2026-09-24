import { TrainingPlansService } from '../src/training-plans/training-plans.service';

// generateFirstWeekIfNeeded() e' o UNICO gate real de "primeira semana" (roda em varios gatilhos:
// pagamento confirmado, rotina configurada, anamnese) — por isso first_plan_generated e' disparado
// aqui (servidor), nao pelo cliente. generateWeek() e' mockado via spyOn: o que se testa aqui e'
// exclusivamente a logica de quando o funil dispara, nao a geracao de treino em si.

function buildService(overrides: {
  existingPlan?: unknown;
  interviewCompletedAt?: Date | null;
  availabilityCount?: number;
  subscriptionStatus?: string;
} = {}) {
  const {
    existingPlan = null,
    interviewCompletedAt = new Date('2026-09-01'),
    availabilityCount = 3,
    subscriptionStatus = 'active',
  } = overrides;

  const funnelEventCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    trainingPlan: { findFirst: jest.fn().mockResolvedValue(existingPlan) },
    onboardingInterview: { findUnique: jest.fn().mockResolvedValue(interviewCompletedAt ? { completedAt: interviewCompletedAt } : null) },
    weeklyAvailability: { findMany: jest.fn().mockResolvedValue(Array.from({ length: availabilityCount }, (_, i) => ({ id: `a${i}` }))) },
    user: { findUnique: jest.fn().mockResolvedValue({ subscriptionStatus }) },
    funnelEvent: { create: funnelEventCreate },
  };

  const noop = {} as never;
  const service = new TrainingPlansService(
    prisma as never, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop,
  );
  return { service, prisma, funnelEventCreate };
}

describe('first_plan_generated — disparado so no gate real de primeira semana', () => {
  it('generateWeek com sucesso: dispara first_plan_generated com userId direto e dedupeKey estavel', async () => {
    const { service, funnelEventCreate } = buildService();
    jest.spyOn(service, 'generateWeek').mockResolvedValue({} as never);

    await service.generateFirstWeekIfNeeded('user-1');

    expect(funnelEventCreate).toHaveBeenCalledTimes(1);
    expect(funnelEventCreate.mock.calls[0][0].data).toMatchObject({
      sessionId: 'backend:user-1',
      userId: 'user-1',
      event: 'first_plan_generated',
      dedupeKey: 'first_plan_generated:user-1',
    });
  });

  it('generateWeek falha (IA): NAO dispara o evento', async () => {
    const { service, funnelEventCreate } = buildService();
    jest.spyOn(service, 'generateWeek').mockRejectedValue(new Error('falha da IA'));

    await expect(service.generateFirstWeekIfNeeded('user-2')).rejects.toThrow('falha da IA');
    expect(funnelEventCreate).not.toHaveBeenCalled();
  });

  it('ja existe plano (nao e primeira vez): retorna cedo, nunca chama generateWeek nem dispara evento', async () => {
    const { service, funnelEventCreate } = buildService({ existingPlan: { id: 'plan-1' } });
    const generateWeekSpy = jest.spyOn(service, 'generateWeek').mockResolvedValue({} as never);

    await service.generateFirstWeekIfNeeded('user-3');

    expect(generateWeekSpy).not.toHaveBeenCalled();
    expect(funnelEventCreate).not.toHaveBeenCalled();
  });

  it('sem rotina configurada ainda: retorna cedo, sem gerar nem disparar evento', async () => {
    const { service, funnelEventCreate } = buildService({ availabilityCount: 0 });
    const generateWeekSpy = jest.spyOn(service, 'generateWeek').mockResolvedValue({} as never);

    await service.generateFirstWeekIfNeeded('user-4');

    expect(generateWeekSpy).not.toHaveBeenCalled();
    expect(funnelEventCreate).not.toHaveBeenCalled();
  });

  it('falha ao gravar o evento de funil NUNCA propaga (analytics nao derruba o fluxo principal)', async () => {
    const { service, funnelEventCreate } = buildService();
    jest.spyOn(service, 'generateWeek').mockResolvedValue({} as never);
    funnelEventCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(service.generateFirstWeekIfNeeded('user-5')).resolves.toBeUndefined();
  });
});
