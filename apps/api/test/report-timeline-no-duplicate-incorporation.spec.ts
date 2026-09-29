import { ObservationsService } from '../src/observations/observations.service';
import { PainReportsService } from '../src/pain-reports/pain-reports.service';
import { WorkoutCompletionsService } from '../src/workout-completions/workout-completions.service';

// Auditoria Astra (29/09/2026), item 10 — Duplicacao Relator -> Prontuario. Antes desta correcao,
// texto livre do aluno (comentario de dor, feedback de treino, comentario de falta, observacao
// registrada) alimentava DUAS incorporacoes narrativas independentes no Prontuario para o MESMO
// acontecimento: uma crua, via studentProfile.recordEvent() direto no proprio service; outra via
// reportTimeline.record() -> Agente Relator -> studentProfile.recordEvent(STUDENT_REPORT_ANALYZED)
// (quando relevance != PONTUAL). O texto original SEMPRE continua preservado na Timeline
// (StudentReportEntry.originalText) — o que estes testes garantem e' que o evento DIRETO no
// Prontuario nunca repete o texto livre que o Relator tambem vai processar.

describe('ObservationsService.create — item 10', () => {
  function buildService() {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Aluna', email: 'a@a.com', studentCode: 1 }) },
      studentObservation: { create: jest.fn().mockResolvedValue({ id: 'obs-1', content: 'Estou sentindo o joelho estranho hoje', createdAt: new Date() }) },
    };
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const reportTimeline = { record: jest.fn() };
    const service = new ObservationsService(prisma as never, telegram as never, reportTimeline as never);
    return { service, prisma, reportTimeline };
  }

  it('nao chama mais studentProfile.recordEvent diretamente — a observacao e 100% texto livre, unica incorporacao e via reportTimeline/Relator', async () => {
    const { service, reportTimeline } = buildService();
    await service.create('user-1', { content: 'Estou sentindo o joelho estranho hoje' } as never);

    expect(reportTimeline.record).toHaveBeenCalledTimes(1);
    expect(reportTimeline.record).toHaveBeenCalledWith(expect.objectContaining({
      originalText: 'Estou sentindo o joelho estranho hoje',
      sourceId: 'obs-1',
    }));
  });
});

describe('PainReportsService.create — item 10', () => {
  function buildService() {
    const prisma = {
      painReport: { create: jest.fn().mockResolvedValue({ id: 'pain-1', createdAt: new Date() }) },
    };
    const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    const reportTimeline = { record: jest.fn() };
    const service = new PainReportsService(prisma as never, studentProfile as never, reportTimeline as never);
    return { service, prisma, studentProfile, reportTimeline };
  }

  const baseDto = {
    regions: ['Joelho direito'],
    intensity: 6,
    onsetPattern: 'gradual',
    persistencePattern: 'constante',
    worseningTrend: 'piorando',
    dailyLifeImpact: 'atrapalha um pouco',
    comment: 'Comeca a doer depois de 20 minutos de corrida, principalmente descendo escada',
    otherLocation: 'Tambem sinto um pouco no tornozelo esquerdo',
  };

  it('profileText (recordEvent direto) mantem os campos ESTRUTURADOS mas nunca repete comment/otherLocation (texto livre)', async () => {
    const { service, studentProfile } = buildService();
    await service.create('user-1', baseDto as never);

    expect(studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    const profileText = studentProfile.recordEvent.mock.calls[0][2] as string;
    expect(profileText).toContain('Joelho direito');
    expect(profileText).toContain('intensidade 6/10');
    expect(profileText).toContain('piorando');
    // O texto livre do aluno NAO pode aparecer aqui — so' via reportTimeline/Relator.
    expect(profileText).not.toContain('Comeca a doer depois de 20 minutos');
    expect(profileText).not.toContain('Tambem sinto um pouco no tornozelo esquerdo');
  });

  it('reportTimeline.record continua recebendo o texto livre ORIGINAL (comment e otherLocation), preservado pra sempre na Timeline', async () => {
    const { service, reportTimeline } = buildService();
    await service.create('user-1', baseDto as never);

    expect(reportTimeline.record).toHaveBeenCalledTimes(2);
    const originalTexts = reportTimeline.record.mock.calls.map((call) => call[0].originalText);
    expect(originalTexts).toContain(baseDto.comment);
    expect(originalTexts).toContain(baseDto.otherLocation);
  });
});

describe('WorkoutCompletionsService.upsert — item 10', () => {
  function buildService() {
    const session = {
      id: 'session-1', userId: 'user-1', scheduledDate: new Date('2026-09-01T00:00:00.000Z'),
      title: 'Corrida leve', modality: 'corrida', routineMismatchNote: null,
    };
    const prisma = {
      trainingSession: { findFirst: jest.fn().mockResolvedValue(session) },
      workoutCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'completion-1', ...create })),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Aluna Teste', studentCode: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      userNotification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const config = { get: jest.fn().mockReturnValue('') };
    const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const contextEvents = { linkFirstObservationIfPending: jest.fn().mockResolvedValue(undefined) };
    const reportTimeline = { record: jest.fn() };
    const service = new WorkoutCompletionsService(prisma as never, config as never, studentProfile as never, telegram as never, contextEvents as never, reportTimeline as never);
    return { service, studentProfile, reportTimeline };
  }

  it('profileParts (recordEvent direto) nunca repete dto.notes (texto livre) — so campos estruturados', async () => {
    const { service, studentProfile } = buildService();
    await service.upsert('user-1', {
      sessionId: 'session-1',
      status: 'done',
      perceivedEffort: 6,
      satisfactionElaboracao: 'gostei',
      satisfactionCapacidade: 'gostei',
      postWorkoutFeeling: 4,
      painFlag: 'none',
      notes: 'Hoje o treino foi incrivelmente dificil, quase desisti no meio do percurso',
    } as never);

    expect(studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    const profileParts = studentProfile.recordEvent.mock.calls[0][2] as string;
    expect(profileParts).toContain('Esforco percebido');
    expect(profileParts).not.toContain('Hoje o treino foi incrivelmente dificil');
  });

  it('reportTimeline.record continua recebendo dto.notes ORIGINAL — unica incorporacao narrativa fica a cargo do Relator', async () => {
    const { service, reportTimeline } = buildService();
    await service.upsert('user-1', {
      sessionId: 'session-1',
      status: 'done',
      perceivedEffort: 6,
      satisfactionElaboracao: 'gostei',
      satisfactionCapacidade: 'gostei',
      postWorkoutFeeling: 4,
      painFlag: 'none',
      notes: 'Hoje o treino foi incrivelmente dificil, quase desisti no meio do percurso',
    } as never);

    const feedbackNotesCall = reportTimeline.record.mock.calls.find(
      (call) => call[0].originalText === 'Hoje o treino foi incrivelmente dificil, quase desisti no meio do percurso',
    );
    expect(feedbackNotesCall).toBeDefined();
  });

  it('missedComment (texto livre de falta, dentro de dto.details) segue o mesmo padrao: fora do recordEvent direto, presente no reportTimeline', async () => {
    const { service, studentProfile, reportTimeline } = buildService();
    await service.upsert('user-1', {
      sessionId: 'session-1',
      status: 'missed',
      details: {
        missedReasons: ['cansaco'],
        missedComment: 'Fiquei ate tarde trabalhando ontem e nao consegui acordar cedo',
      },
    } as never);

    const profileParts = studentProfile.recordEvent.mock.calls[0][2] as string;
    expect(profileParts).not.toContain('Fiquei ate tarde trabalhando');
    const missedCommentCall = reportTimeline.record.mock.calls.find(
      (call) => call[0].originalText === 'Fiquei ate tarde trabalhando ontem e nao consegui acordar cedo',
    );
    expect(missedCommentCall).toBeDefined();
  });
});
