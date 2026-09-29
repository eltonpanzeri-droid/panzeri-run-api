import { ReportTimelineService } from '../src/reporter/report-timeline.service';
import { StudentProfileService, ProfileEventCode } from '../src/training-plans/student-profile.service';

// 28/09/2026 — Fechamento do circuito Relator -> Prontuario -> Treinador (item 8 do pedido: teste
// de ponta a ponta). Cobre o exemplo literal dado pelo treinador:
// "Estou ficando desanimada porque nas ultimas semanas parece que nao estou evoluindo. O trabalho
// tambem esta muito puxado e estou chegando cansada para treinar."
// Verifica: (1) original preservado, (2) Relator interpreta sem virar fato, (3) Prontuario recebe
// a informacao (evento gravado), (4) relato PONTUAL nao infla o prontuario, (5) condensacao usa
// evolutionAgent.condenseProfile (mesmo agente, nao um novo) preservando a separacao de registro.

describe('Circuito Relator -> Prontuario — teste de ponta a ponta', () => {
  const EXEMPLO_DO_TREINADOR = 'Estou ficando desanimada porque nas ultimas semanas parece que nao estou evoluindo. O trabalho tambem esta muito puxado e estou chegando cansada para treinar.';

  function buildTimeline(relatorResult: unknown) {
    const created = { id: 'entry-1', userId: 'aluno-1', occurredAt: new Date('2026-09-28T12:00:00Z') };
    const studentReportEntry = {
      create: jest.fn().mockResolvedValue(created),
      findUnique: jest.fn().mockResolvedValue({
        id: 'entry-1',
        userId: 'aluno-1',
        sourceType: 'student_observation',
        promptQuestion: 'Escreva aqui o que quer avisar...',
        relatedLabel: 'Observacao registrada pelo aluno',
        originalText: EXEMPLO_DO_TREINADOR,
        occurredAt: created.occurredAt,
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    };
    const user = { findUnique: jest.fn().mockResolvedValue({ name: 'Aluna Teste' }) };
    const prisma = { studentReportEntry, user };
    const relatorAgent = { analyze: jest.fn().mockResolvedValue(relatorResult) };
    const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new ReportTimelineService(prisma as never, relatorAgent as never, studentProfile as never);
    return { service, studentReportEntry, relatorAgent, studentProfile, created };
  }

  it('1-3: texto original preservado, Relator interpreta sem virar fato, Prontuario recebe a informacao (relevancia MUDANCA_IMPORTANTE)', async () => {
    const relatorOutput = {
      facts: 'A aluna relata desanimo por perceber falta de evolucao nas ultimas semanas e relata chegar cansada para treinar devido ao trabalho.',
      perception: 'O relato parece expressar desmotivacao associada a percepcao de estagnacao e a fadiga acumulada do trabalho.',
      themes: ['MOTIVACAO', 'TRABALHO', 'DESEMPENHO'],
      temporality: 'ATUAL',
      longitudinalNote: null,
      hypotheses: ['A aluna pode estar associando a falta de percepcao de evolucao ao cansaco gerado pela rotina de trabalho.'],
      relevance: 'MUDANCA_IMPORTANTE',
    };
    // (1) original preservado literalmente na criacao da StudentReportEntry — testado isoladamente
    // (record() dispara analyzeEntry() sozinho, fire-and-forget; chamamos analyzeEntry() de novo
    // abaixo pra testar o restante do circuito de forma deterministica, sem depender de timing).
    const { service: recordOnlyService, studentReportEntry: recordOnlyEntry } = buildTimeline(relatorOutput);
    await recordOnlyService.record({
      userId: 'aluno-1',
      sourceType: 'student_observation',
      promptQuestion: 'Escreva aqui o que quer avisar...',
      relatedLabel: 'Observacao registrada pelo aluno',
      originalText: EXEMPLO_DO_TREINADOR,
      occurredAt: new Date('2026-09-28T12:00:00Z'),
    });
    expect(recordOnlyEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ originalText: EXEMPLO_DO_TREINADOR }),
    });

    const { service, studentReportEntry, studentProfile } = buildTimeline(relatorOutput);
    await service.analyzeEntry('entry-1');

    // (2) a analise fica gravada separando fato de percepcao/hipotese — nunca reescreve originalText
    expect(studentReportEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: expect.objectContaining({ facts: relatorOutput.facts, perception: relatorOutput.perception, relevance: 'MUDANCA_IMPORTANTE' }),
    });
    expect(studentReportEntry.update.mock.calls[0][0].data).not.toHaveProperty('originalText');

    // (3) Prontuario recebe a informacao: evento gravado com o codigo certo
    expect(studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    const [userId, code, content] = studentProfile.recordEvent.mock.calls[0];
    expect(userId).toBe('aluno-1');
    expect(code).toBe(ProfileEventCode.STUDENT_REPORT_ANALYZED);
    // Conteudo enviado ao prontuario preserva a separacao FATO vs PERCEPCAO/HIPOTESE explicitamente
    // — nunca funde as duas numa afirmacao so, pra o agente de condensacao nao confundir registro.
    expect(content).toContain('FATO:');
    expect(content).toContain('PERCEPCAO (interpretacao do Relator, nunca fato confirmado):');
    expect(content).toContain('HIPOTESES (nao confirmadas):');
    expect(content).not.toContain(EXEMPLO_DO_TREINADOR); // manda a INTERPRETACAO, nao o texto bruto de novo
  });

  it('relato PONTUAL nao infla o prontuario (fica so na Linha do Tempo)', async () => {
    const relatorOutput = {
      facts: 'A aluna comenta que o treino de hoje foi tranquilo.',
      perception: null,
      themes: ['TREINAMENTO'],
      temporality: 'ATUAL',
      longitudinalNote: null,
      hypotheses: [],
      relevance: 'PONTUAL',
    };
    const { service, studentProfile } = buildTimeline(relatorOutput);
    await service.analyzeEntry('entry-1');
    expect(studentProfile.recordEvent).not.toHaveBeenCalled();
  });

  it('ACOMPANHAR e LONGITUDINAL tambem alimentam o prontuario (so PONTUAL fica de fora)', async () => {
    for (const relevance of ['ACOMPANHAR', 'LONGITUDINAL']) {
      const { service, studentProfile } = buildTimeline({
        facts: 'fato generico', perception: null, themes: [], temporality: 'ATUAL',
        longitudinalNote: null, hypotheses: [], relevance,
      });
      await service.analyzeEntry('entry-1');
      expect(studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    }
  });
});

describe('StudentProfileService.refreshProfile — condensacao incremental via EvolutionAgentService (mesmo agente, nao um novo)', () => {
  function build(opts: { pendingEvents?: unknown[]; existingSummary?: string | null } = {}) {
    const pendingEvents = opts.pendingEvents ?? [
      { id: 'evt-1', code: ProfileEventCode.STUDENT_REPORT_ANALYZED, content: 'FATO: relata desanimo. PERCEPCAO (interpretacao do Relator, nunca fato confirmado): parece desmotivada.', createdAt: new Date('2026-09-28T12:00:00Z') },
    ];
    const studentProfile = {
      findUnique: jest.fn().mockResolvedValue(opts.existingSummary !== undefined ? (opts.existingSummary ? { summary: opts.existingSummary } : null) : null),
      upsert: jest.fn().mockResolvedValue({}),
    };
    const studentProfileEvent = {
      findMany: jest.fn().mockResolvedValue(pendingEvents),
      updateMany: jest.fn().mockResolvedValue({ count: pendingEvents.length }),
    };
    const prisma = { studentProfile, studentProfileEvent, $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)) };
    const evolutionAgent = { condenseProfile: jest.fn() };
    const service = new StudentProfileService(prisma as never, evolutionAgent as never);
    return { service, prisma, studentProfile, studentProfileEvent, evolutionAgent };
  }

  it('4: quando ha evento pendente, condensa via evolutionAgent.condenseProfile (reaproveita o Evolution Agent) e persiste o resumo atualizado', async () => {
    const condensedSummary = '1) QUEM E: ... 2) DE ONDE VEIO: ... 3) TRAJETORIA: ... 4) ESTADO ATUAL: aluna relatou desanimo recente (interpretacao do Relator). 5) PARA ONDE ESTA INDO: ...';
    const { service, evolutionAgent, studentProfile, studentProfileEvent } = build();
    evolutionAgent.condenseProfile.mockResolvedValue(condensedSummary);

    const result = await service.refreshProfile('aluno-1');

    expect(evolutionAgent.condenseProfile).toHaveBeenCalledWith(expect.objectContaining({
      newEvents: expect.arrayContaining([expect.objectContaining({ code: ProfileEventCode.STUDENT_REPORT_ANALYZED })]),
    }));
    expect(result).toBe(condensedSummary);
    expect(studentProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'aluno-1' },
      update: { summary: condensedSummary },
    }));
    expect(studentProfileEvent.updateMany).toHaveBeenCalled();
  });

  it('sem evento pendente, nunca chama a IA (zero custo) e devolve o resumo existente', async () => {
    const { service, evolutionAgent } = build({ pendingEvents: [], existingSummary: 'resumo antigo' });
    const result = await service.refreshProfile('aluno-1');
    expect(evolutionAgent.condenseProfile).not.toHaveBeenCalled();
    expect(result).toBe('resumo antigo');
  });

  it('falha na condensacao nunca perde o resumo anterior (best-effort)', async () => {
    const { service, evolutionAgent } = build({ existingSummary: 'resumo antigo' });
    evolutionAgent.condenseProfile.mockResolvedValue(null);
    const result = await service.refreshProfile('aluno-1');
    expect(result).toBe('resumo antigo');
  });
});
