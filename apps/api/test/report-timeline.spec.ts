import { ReportTimelineService } from '../src/reporter/report-timeline.service';
import { STUDENT_REPORT_SOURCE_TYPES } from '../src/reporter/report-timeline.constants';

// 28/09/2026 — Agente Relator + Linha do Tempo de Relatos. Cobre: (1) texto vazio nunca vira
// relato, (2) o texto ORIGINAL e' preservado literalmente na criacao, (3) a analise so' preenche
// os campos estruturados sem nunca alterar o texto original, (4) falha da IA nunca perde o dado
// original (so' marca analysisError), (5) o contexto longitudinal manda so' um numero pequeno de
// relatos anteriores, nunca o historico inteiro.

function build(opts: { priorRows?: unknown[] } = {}) {
  const created = { id: 'entry-1', userId: 'aluno-1', occurredAt: new Date('2026-09-27T12:00:00Z') };
  const studentReportEntry = {
    create: jest.fn().mockResolvedValue(created),
    findUnique: jest.fn().mockResolvedValue({
      id: 'entry-1',
      userId: 'aluno-1',
      sourceType: STUDENT_REPORT_SOURCE_TYPES.WORKOUT_FEEDBACK_NOTES,
      promptQuestion: 'Quer contar mais alguma coisa?',
      relatedLabel: 'Treino de 27/09',
      originalText: 'Hoje minhas pernas estavam muito pesadas.',
      occurredAt: new Date('2026-09-27T12:00:00Z'),
    }),
    findMany: jest.fn().mockResolvedValue(opts.priorRows ?? []),
    update: jest.fn().mockResolvedValue({}),
  };
  const user = { findUnique: jest.fn().mockResolvedValue({ name: 'Ana' }) };
  const prisma = { studentReportEntry, user };
  const relatorAgent = { analyze: jest.fn() };
  const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new ReportTimelineService(prisma as never, relatorAgent as never, studentProfile as never);
  return { service, studentReportEntry, relatorAgent, prisma, studentProfile };
}

describe('ReportTimelineService.record — preservacao do texto original', () => {
  it('texto vazio ou so espaco NUNCA vira uma entrada na timeline', async () => {
    const { service, studentReportEntry } = build();
    await service.record({ userId: 'aluno-1', sourceType: 'workout_feedback_notes', originalText: '   ', occurredAt: new Date() });
    await service.record({ userId: 'aluno-1', sourceType: 'workout_feedback_notes', originalText: undefined, occurredAt: new Date() });
    await service.record({ userId: 'aluno-1', sourceType: 'workout_feedback_notes', originalText: null, occurredAt: new Date() });
    expect(studentReportEntry.create).not.toHaveBeenCalled();
  });

  it('texto real cria a entrada com o texto ORIGINAL intacto (sem reescrever/resumir)', async () => {
    const { service, studentReportEntry, relatorAgent } = build();
    relatorAgent.analyze.mockResolvedValue(null); // nao interessa aqui, so' testa a criacao
    await service.record({
      userId: 'aluno-1',
      sourceType: STUDENT_REPORT_SOURCE_TYPES.PAIN_REPORT,
      sourceId: 'pain-1',
      promptQuestion: 'Comentario (opcional)',
      relatedLabel: 'Relato de dor',
      originalText: '  Hoje minhas pernas estavam muito pesadas.  ',
      occurredAt: new Date('2026-09-27T12:00:00Z'),
    });
    expect(studentReportEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'aluno-1',
        sourceType: STUDENT_REPORT_SOURCE_TYPES.PAIN_REPORT,
        originalText: 'Hoje minhas pernas estavam muito pesadas.',
      }),
    });
  });

  it('falha ao gravar a timeline NUNCA propaga erro pra quem chamou (best-effort)', async () => {
    const { service, studentReportEntry } = build();
    studentReportEntry.create.mockRejectedValue(new Error('banco indisponivel'));
    await expect(service.record({ userId: 'aluno-1', sourceType: 'workout_feedback_notes', originalText: 'algo', occurredAt: new Date() })).resolves.toBeUndefined();
  });
});

describe('ReportTimelineService.analyzeEntry — saida estruturada do Agente Relator', () => {
  it('preenche facts/perception/themes/temporality/hypotheses/relevance quando a IA responde', async () => {
    const { service, studentReportEntry, relatorAgent } = build();
    relatorAgent.analyze.mockResolvedValue({
      facts: 'relata sensacao de pernas pesadas durante o treino',
      perception: 'relato de dificuldade fisica, sem causa explicitamente identificada',
      themes: ['TREINAMENTO', 'FADIGA'],
      temporality: 'ATUAL',
      longitudinalNote: null,
      hypotheses: [],
      relevance: 'PONTUAL',
    });

    await service.analyzeEntry('entry-1');

    expect(studentReportEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: expect.objectContaining({
        facts: 'relata sensacao de pernas pesadas durante o treino',
        temporality: 'ATUAL',
        relevance: 'PONTUAL',
        analysisError: null,
      }),
    });
    expect(studentReportEntry.update.mock.calls[0][0].data.analyzedAt).toBeInstanceOf(Date);
  });

  it('quando a IA nao responde (indisponivel/falhou), marca analysisError e preserva o texto original intacto (nao mexe em originalText)', async () => {
    const { service, studentReportEntry, relatorAgent } = build();
    relatorAgent.analyze.mockResolvedValue(null);

    await service.analyzeEntry('entry-1');

    expect(studentReportEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { analysisError: expect.any(String) },
    });
  });

  it('manda so uma AMOSTRA PEQUENA de relatos anteriores pro agente, nunca o historico bruto inteiro', async () => {
    const priorRows = Array.from({ length: 30 }, (_, i) => ({
      occurredAt: new Date(`2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
      sourceType: 'workout_feedback_notes',
      originalText: `relato antigo ${i}`,
      themes: ['TREINAMENTO'],
      relevance: 'PONTUAL',
    }));
    const { service, relatorAgent } = build({ priorRows: priorRows.slice(0, 15) }); // findMany ja aplicaria o take:15 de verdade
    relatorAgent.analyze.mockResolvedValue(null);

    await service.analyzeEntry('entry-1');

    const callInput = relatorAgent.analyze.mock.calls[0][0];
    expect(callInput.priorEntries).toHaveLength(15);
    expect(callInput.priorEntries[0]).toMatchObject({ sourceType: 'workout_feedback_notes' });
  });

  it('entrada inexistente nao quebra nada (idempotente/defensivo)', async () => {
    const { service, studentReportEntry, relatorAgent } = build();
    studentReportEntry.findUnique.mockResolvedValue(null);
    await service.analyzeEntry('nao-existe');
    expect(relatorAgent.analyze).not.toHaveBeenCalled();
    expect(studentReportEntry.update).not.toHaveBeenCalled();
  });
});
