import { MeService } from '../src/me/me.service';

// Auditoria Astra (29/09/2026), item 14 — mesmo miss da reavaliacao, do lado da entrevista inicial:
// 'pain_other_location' e texto livre real (apps/mobile/App.tsx) que ja era lido em outro lugar
// deste arquivo (painSummary, pra compor o HealthProfile) mas nunca alimentava a Linha do Tempo de
// Relatos / Agente Relator com o texto ORIGINAL do aluno.

function buildService(extraAnswers: Record<string, unknown> = {}) {
  const answers = {
    personal_name: 'Aluna Teste',
    personal_phone: '11999999999',
    personal_cpf: '52998224725', // CPF valido (algoritmo) usado em outros testes do projeto
    personal_address_city: 'Sao Paulo',
    personal_address_state: 'SP',
    personal_birth_date: '1995-05-20',
    personal_sex: 'Feminino',
    personal_height: 165,
    personal_weight: 60,
    ...extraAnswers,
  };

  const tx = {
    user: { update: jest.fn().mockResolvedValue({}) },
    healthProfile: { upsert: jest.fn().mockResolvedValue({}) },
    userPreferences: { upsert: jest.fn().mockResolvedValue({}) },
    menstrualProfile: { upsert: jest.fn().mockResolvedValue({}) },
    onboardingInterview: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    onboardingInterview: { findUnique: jest.fn().mockResolvedValue({ answers }) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Aluna Teste', studentCode: 1, subscriptionStatus: 'pending' }) },
    weeklyAvailability: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  };
  const trainingPlans = { generateFirstWeekIfNeeded: jest.fn().mockResolvedValue(undefined) };
  const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
  const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
  const reportTimeline = { record: jest.fn() };

  const service = new MeService(prisma as never, trainingPlans as never, studentProfile as never, telegram as never, reportTimeline as never);
  return { service, reportTimeline };
}

describe('MeService.completeOnboarding — item 14 da auditoria (pain_other_location)', () => {
  it('pain_other_location preenchido: vira uma entrada na Linha do Tempo de Relatos', async () => {
    const { service, reportTimeline } = buildService({ pain_other_location: 'Sinto uma leve pontada no tornozelo esquerdo as vezes' });
    await service.completeOnboarding('user-1');

    const call = reportTimeline.record.mock.calls.find((c) => c[0].originalText === 'Sinto uma leve pontada no tornozelo esquerdo as vezes');
    expect(call).toBeDefined();
    expect(call[0].promptQuestion).toBe('Sente dor em algum outro local que nao esta na lista acima?');
  });

  it('vazio/ausente: nenhuma entrada e criada pra este campo especifico', async () => {
    const { service, reportTimeline } = buildService();
    await service.completeOnboarding('user-1');

    expect(reportTimeline.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ promptQuestion: 'Sente dor em algum outro local que nao esta na lista acima?' }),
    );
  });
});
