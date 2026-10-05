import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { WorkoutCompletionsService } from '../src/workout-completions/workout-completions.service';
import { MethodologyInput, SessionPartDecision } from '../src/training-plans/training-methodology';
import { describeSessionShape, formatDirectiveForAgent, formatRecordedSession } from '../src/training-plans/agent-context-format';

// 05/10/2026 — caso Eduarda: diretriz de progressao ("caminhada progressiva -> corrida continua") e tres
// sabados de corrida continua ja executados, mas o Treinador voltou a prescrever caminhada. Estes testes
// verificam a QUALIDADE DO CONTEXTO entregue ao Treinador (fatos sessao a sessao, forma da sessao,
// diretriz datada) — nunca obrigam a IA a prescrever uma distancia especifica.

// Constroi structure/sessionType exatamente como o generateWeek faz (runPrescription + deriveSessionTypeLabel).
function prescriptionFor(parts: SessionPartDecision[]) {
  const proto = TrainingPlansService.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const self = Object.create(TrainingPlansService.prototype);
  const prescription = proto.runPrescription.call(self, 40, 'corrida', { parts }) as { distanceKm: number; durationMin: number; representativePaceSecondsPerKm: number };
  const sessionType = proto.deriveSessionTypeLabel.call(self, { parts }) as string;
  return { prescription, sessionType };
}

const continuous5km: SessionPartDecision[] = [{ kind: 'continua', distanceKm: 5, paceSecondsPerKmMin: 450, paceSecondsPerKmMax: 450 }];
const continuous6km: SessionPartDecision[] = [{ kind: 'continua', distanceKm: 6, paceSecondsPerKmMin: 450, paceSecondsPerKmMax: 450 }];
const walkRun: SessionPartDecision[] = [{
  kind: 'intervalada', repeatCount: 6,
  stimulusLabel: 'Correr', stimulusStepKm: 0.4, stimulusPaceSecondsPerKm: 450,
  recoveryLabel: 'Caminhar', recoveryStepKm: 0.3, recoveryPaceSecondsPerKm: 720,
}];

function saturdayRow(date: string, parts: SessionPartDecision[], completion: Record<string, unknown>) {
  const { prescription, sessionType } = prescriptionFor(parts);
  return {
    scheduledDate: new Date(`${date}T00:00:00.000Z`),
    weekday: 6,
    modality: 'corrida',
    sessionType,
    structure: prescription,
    distanceKm: prescription.distanceKm,
    durationMin: prescription.durationMin,
    paceMinSec: '7:30',
    completion: { status: 'done', distanceKm: null, durationMin: null, avgPaceSecondsKm: null, details: {}, ...completion },
  };
}

function prescriptionService() {
  return new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as never, { enqueue: jest.fn() } as never);
}

function buildPayload(input: MethodologyInput) {
  return JSON.parse((prescriptionService() as unknown as { buildUserPrompt: (...a: unknown[]) => string }).buildUserPrompt(input, [], [], false, false, {}, null));
}

describe('Caso Eduarda — contexto de execucao recente entregue ao Treinador', () => {
  const DIRETRIZ = 'Sabado: caminhada progressiva e, posteriormente, migrar para corrida continua. Terca e quinta: intervalado.';
  const rows = [
    saturdayRow('2026-09-19', continuous5km, { distanceKm: 5, durationMin: 38, avgPaceSecondsKm: 456, details: { pacingMode: 'correu_tudo' } }),
    saturdayRow('2026-09-26', continuous5km, { distanceKm: 5, durationMin: 37, avgPaceSecondsKm: 444, details: { pacingMode: 'correu_tudo' } }),
    saturdayRow('2026-10-03', continuous6km, { distanceKm: 6, durationMin: 45, avgPaceSecondsKm: 450, details: { pacingMode: 'correu_tudo' } }),
  ];

  function eduardaInput(): MethodologyInput {
    const weeks = rows.map((row, index) => ({
      runMinutes: 40, completedRunMinutes: 40, longestRunMinutes: 40, prescribedSessions: 4, completedSessions: 4, unregisteredSessions: 0,
      weekStartDate: ['2026-09-14', '2026-09-21', '2026-09-28'][index], longestRunDate: row.scheduledDate.toISOString().slice(0, 10),
      recordedSessions: [formatRecordedSession(row)],
    }));
    return {
      goal: 'Correr 10km', experience: 'iniciante', answers: {},
      availability: [{ weekday: 6, modalities: ['corrida'], availableMin: 60, modalityDurations: null }],
      history: weeks,
      studentDirectives: [formatDirectiveForAgent({ content: DIRETRIZ, createdAt: new Date('2026-09-05T12:00:00.000Z') })],
      activeObservations: [],
    };
  }

  it('o payload entregue ao Treinador mostra, sessao a sessao, que os 3 ultimos sabados foram de corrida continua concluida', () => {
    const payload = buildPayload(eduardaInput());
    const lines = (payload.historicoSemanal as Array<{ recordedSessions: string[] }>).flatMap((week) => week.recordedSessions);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^sabado 2026-09-19 \| corrida \| continuo \| prescrito 5km .* \| concluido: 5km 38min 7:36\/km, correu tudo sem caminhar\/parar \(autorrelato\)$/);
    expect(lines[1]).toMatch(/^sabado 2026-09-26 \| corrida \| continuo \| .* \| concluido: 5km 37min 7:24\/km, correu tudo/);
    expect(lines[2]).toMatch(/^sabado 2026-10-03 \| corrida \| continuo \| .* \| concluido: 6km 45min 7:30\/km, correu tudo/);
    // nenhuma das tres e descrita como caminhada, caminhada/corrida ou intervalado
    for (const line of lines) expect(line.split(' | ')[2]).toBe('continuo');
  });

  it('a diretriz chega datada, e a trajetoria dela aparece junto das execucoes posteriores a data de criacao', () => {
    const payload = buildPayload(eduardaInput());
    const diretrizes = payload.diretrizesEspecificasDoTreinadorParaEsteAluno as string[];
    expect(diretrizes).toEqual([`[criada em 2026-09-05] ${DIRETRIZ}`]);
    const lines = (payload.historicoSemanal as Array<{ recordedSessions: string[] }>).flatMap((week) => week.recordedSessions);
    const criadaEm = diretrizes[0].match(/criada em (\d{4}-\d{2}-\d{2})/)![1];
    for (const line of lines) expect(line.split(' | ')[0].split(' ')[1] > criadaEm).toBe(true);
  });

  it('uma sessao caminhada/corrida aparece de forma DISTINTA da corrida continua', () => {
    const walkRow = saturdayRow('2026-09-12', walkRun, { distanceKm: 3.5, durationMin: 40, details: { pacingMode: 'caminhou_sim' } });
    const line = formatRecordedSession(walkRow);
    expect(line).toContain('intervalado: 6x(Correr/Caminhar)');
    expect(line).toContain('caminhou/parou em algum trecho (autorrelato)');
    expect(line).not.toContain('continuo');
  });

  it('ausencia continua ausencia: sem estrutura confiavel nao inventa forma, sem dado realizado nao escreve zero', () => {
    expect(describeSessionShape(null, null)).toBeNull();
    expect(describeSessionShape('corrida', {})).toBeNull(); // rotulo legado, nao permite afirmar a forma
    expect(describeSessionShape('forca', {})).toBeNull();
    const line = formatRecordedSession({
      scheduledDate: new Date('2026-09-19T00:00:00.000Z'), weekday: 6, modality: 'corrida', sessionType: null, structure: null,
      distanceKm: null, durationMin: null, paceMinSec: null,
      completion: { status: 'done', distanceKm: null, durationMin: null, avgPaceSecondsKm: null, details: {} },
    });
    expect(line).toBe('sabado 2026-09-19 | corrida | concluido');
    expect(line).not.toMatch(/\b0km|\b0min/);
    // "nao feito" e' dito como tal, sem inventar distancia
    expect(formatRecordedSession({ ...rows[0], completion: { status: 'missed', distanceKm: null, durationMin: null, avgPaceSecondsKm: null, details: {} } }))
      .toContain('marcado como nao feito pelo aluno');
  });

  it('diretriz sem createdAt continua chegando como antes (so o texto)', () => {
    expect(formatDirectiveForAgent({ content: 'x' })).toBe('x');
  });

  it('o prompt do Treinador manda interpretar diretrizes de progressao junto das execucoes, sem regra mecanica', () => {
    const system = (prescriptionService() as unknown as { buildSystemPromptStable: () => string }).buildSystemPromptStable();
    expect(system).toContain('Diretrizes que descrevem progressoes ou trajetorias devem ser interpretadas em conjunto com as execucoes posteriores registradas');
    expect(system).toContain('Nao presuma que o aluno permanece ou retorna a etapa inicial quando o historico recente demonstra avanco');
    expect(system).toContain('nao pode ser justificada por uma afirmacao factual contraditoria com o historico');
    expect(system).toContain('autonomia para avancar, manter ou regredir');
  });
});

describe('Prontuario — WORKOUT_COMPLETED guarda data, forma da sessao e como foi feito', () => {
  it('registra "corrida, continuo" e o autorrelato de ter corrido tudo', async () => {
    const { prescription, sessionType } = prescriptionFor(continuous5km);
    const session = {
      id: 'session-1', userId: 'user-1', scheduledDate: new Date('2026-09-19T00:00:00.000Z'), title: 'Corrida', modality: 'corrida',
      sessionType, structure: prescription, routineMismatchNote: null,
    };
    const prisma = {
      trainingSession: { findFirst: jest.fn().mockResolvedValue(session) },
      workoutCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'completion-1', ...create })),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Aluna', studentCode: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      userNotification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      nightlySleepLog: { upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'night-1', ...create })) },
      stressCheckin: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 's', ...data })) },
    };
    const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkoutCompletionsService(
      prisma as never, { get: jest.fn().mockReturnValue('') } as never, studentProfile as never,
      { notifyCoach: jest.fn().mockResolvedValue(undefined) } as never,
      { linkFirstObservationIfPending: jest.fn().mockResolvedValue(undefined) } as never,
      { record: jest.fn() } as never, { evaluateForUser: jest.fn().mockResolvedValue([]) } as never, { setUsage: jest.fn() } as never,
    );
    await service.upsert('user-1', {
      sessionId: 'session-1', status: 'done', distanceKm: 5, durationMin: 38, avgPaceSecondsKm: 456,
      details: { pacingMode: 'correu_tudo' },
      perceivedEffort: 6, executionBehavior: 'as_planned', preSleepQuality: 4, sleepDurationCategory: '7_a_8h', bedtimeShiftDirection: 'on_time',
      wakeTimeShiftDirection: 'on_time', sleepInterruption: 2, sleepDifficulty: 1, prePhysicalFatigue: 2, preMentalFatigue: 2, preStressLevel: 2,
      preMotivation: 4, satisfactionElaboracao: 'gostei', painFlag: 'none', postPhysicalFatigue: 2, postMentalFatigue: 2,
      emotionalExperienceDuring: 4, mentalStateChangePrePost: 4,
    } as never);

    const call = studentProfile.recordEvent.mock.calls.find((c) => c[1] === 'WORKOUT_COMPLETED');
    expect(call).toBeDefined();
    const content = call![2] as string;
    expect(content).toContain('Aluno concluiu o treino "Corrida" (2026-09-19, corrida, continuo).');
    expect(content).toContain('Distancia: 5km.');
    expect(content).toContain('Como foi feito: correu tudo sem caminhar/parar (autorrelato).');
  });
});

describe('WEEK_GENERATED — forma da sessao a partir da estrutura gravada', () => {
  it('descreve continuo e caminhada/corrida de forma distinta, e nao classifica o que a estrutura nao permite', () => {
    const cont = prescriptionFor(continuous5km);
    const wr = prescriptionFor(walkRun);
    const mixed = prescriptionFor([...continuous5km, ...walkRun]);
    expect(describeSessionShape(cont.sessionType, cont.prescription)).toBe('continuo');
    expect(describeSessionShape(wr.sessionType, wr.prescription)).toBe('intervalado: 6x(Correr/Caminhar)');
    expect(describeSessionShape(mixed.sessionType, mixed.prescription)).toBe('misto: continua + 6x(Correr/Caminhar)');
    expect(describeSessionShape('corrida', {})).toBeNull();
  });
});
