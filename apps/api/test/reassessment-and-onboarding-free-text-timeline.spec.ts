import { ReassessmentService } from '../src/reassessment/reassessment.service';

// Auditoria Astra (29/09/2026), item 14 — Campos livres da reavaliacao. CAUSA RAIZ: 'reassessment_notes'
// e 'pain_other_location' sao campos de texto livre reais do questionario de reavaliacao (ver
// apps/mobile/App.tsx) que ficaram de fora quando a Linha do Tempo de Relatos foi montada
// (28/09/2026) — miss real na lista de campos conectados, nao decisao deliberada. Sem isso, o que
// o aluno escreve neles nunca chegava ao Agente Relator nem ao Prontuario.

function buildService(overrides: { answers?: Record<string, unknown> } = {}) {
  const { answers = {} } = overrides;
  const draft = { id: 'draft-1', answers, currentStep: 5 };
  const prisma = {
    reassessment: {
      findFirst: jest.fn().mockResolvedValue(draft),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'draft-1', completedAt: new Date('2026-09-29T12:00:00.000Z'), answers, reassessmentVersion: 2, ...(data as object) })),
    },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Aluna Teste', preferences: null }) },
    onboardingInterview: { findUnique: jest.fn().mockResolvedValue(null) },
    fitnessTest: { findMany: jest.fn().mockResolvedValue([]) },
    trainingPlan: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const evolutionAgent = { analyze: jest.fn().mockResolvedValue(null) }; // report=null -> complete() retorna cedo, sem tocar em evolutionReport
  const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
  const athleteStateSnapshot = { getSnapshot: jest.fn().mockResolvedValue(null) };
  const reportTimeline = { record: jest.fn() };

  const service = new ReassessmentService(
    prisma as never,
    evolutionAgent as never,
    studentProfile as never,
    athleteStateSnapshot as never,
    reportTimeline as never,
    { evaluateForUser: jest.fn().mockResolvedValue([]) } as never,
  );
  return { service, reportTimeline };
}

describe('ReassessmentService.complete — item 14 da auditoria (reassessment_notes + pain_other_location)', () => {
  it('reassessment_notes preenchido: vira uma entrada na Linha do Tempo de Relatos', async () => {
    const { service, reportTimeline } = buildService({
      answers: { reassessment_notes: 'Quero comentar que tenho sentido mais disposicao nas ultimas semanas' },
    });
    await service.complete('user-1');

    const call = reportTimeline.record.mock.calls.find((c) => c[0].originalText === 'Quero comentar que tenho sentido mais disposicao nas ultimas semanas');
    expect(call).toBeDefined();
    expect(call[0].promptQuestion).toBe('Quer contar mais alguma coisa para o seu treinador?');
  });

  it('pain_other_location preenchido: vira uma entrada separada na Linha do Tempo de Relatos', async () => {
    const { service, reportTimeline } = buildService({
      answers: { pain_other_location: 'Sinto uma pontada no ombro direito depois de nadar' },
    });
    await service.complete('user-1');

    const call = reportTimeline.record.mock.calls.find((c) => c[0].originalText === 'Sinto uma pontada no ombro direito depois de nadar');
    expect(call).toBeDefined();
  });

  it('ambos vazios/ausentes: nenhuma entrada extra e criada pra eles (nao inventa texto)', async () => {
    const { service, reportTimeline } = buildService({ answers: {} });
    await service.complete('user-1');

    const texts = reportTimeline.record.mock.calls.map((c) => c[0].originalText);
    expect(texts).not.toContain(undefined);
    expect(reportTimeline.record).not.toHaveBeenCalledWith(expect.objectContaining({ promptQuestion: 'Quer contar mais alguma coisa para o seu treinador?' }));
  });

  it('campos de saude ja existentes (injury_description) continuam funcionando junto com os 2 novos', async () => {
    const { service, reportTimeline } = buildService({
      answers: {
        injury_description: 'Cirurgia no joelho ha 2 anos',
        reassessment_notes: 'Tudo indo bem',
        pain_other_location: 'Nada alem do que ja relatei',
      },
    });
    await service.complete('user-1');

    const texts = reportTimeline.record.mock.calls.map((c) => c[0].originalText);
    expect(texts).toEqual(expect.arrayContaining([
      'Cirurgia no joelho ha 2 anos',
      'Tudo indo bem',
      'Nada alem do que ja relatei',
    ]));
  });
});
