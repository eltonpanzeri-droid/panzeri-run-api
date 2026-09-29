import { StudentReporterAgentService } from '../src/reporter/student-reporter-agent.service';

// 28/09/2026 — guardas defensivas do Agente Relator (a chamada real ao modelo nao e' testada aqui,
// mesmo padrao ja usado pros outros agentes desta arquitetura — ver evolution-agent/strava-analysis).

describe('StudentReporterAgentService.analyze — guardas defensivas', () => {
  it('sem ANTHROPIC_API_KEY configurada, retorna null sem tentar chamar a IA (mesmo padrao dos outros agentes)', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const aiQueue = { run: jest.fn() };
    const service = new StudentReporterAgentService(config as never, aiQueue as never);

    const result = await service.analyze({
      studentName: 'Ana',
      sourceType: 'workout_feedback_notes',
      promptQuestion: null,
      relatedLabel: null,
      occurredAt: new Date().toISOString(),
      originalText: 'Hoje minhas pernas estavam muito pesadas.',
      priorEntries: [],
    });

    expect(result).toBeNull();
    expect(aiQueue.run).not.toHaveBeenCalled();
  });

  it('texto original vazio nunca gasta uma chamada de IA', async () => {
    const config = { get: jest.fn().mockReturnValue('fake-key') };
    const aiQueue = { run: jest.fn() };
    const service = new StudentReporterAgentService(config as never, aiQueue as never);

    const result = await service.analyze({
      studentName: 'Ana',
      sourceType: 'workout_feedback_notes',
      promptQuestion: null,
      relatedLabel: null,
      occurredAt: new Date().toISOString(),
      originalText: '   ',
      priorEntries: [],
    });

    expect(result).toBeNull();
    expect(aiQueue.run).not.toHaveBeenCalled();
  });
});
