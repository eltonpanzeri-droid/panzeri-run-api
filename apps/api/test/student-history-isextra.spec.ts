import { TrainingPlansService } from '../src/training-plans/training-plans.service';

// Correcao 02/10/2026: getStudentHistory() (consumido por HistoryCalendar no mobile) tinha
// isExtra reconhecendo so structure.source==='student' — uma TrainingSession sintetica
// 'device_extra' (materializada por SessionExecutionLinkService.materializeExtraActivity a
// partir de uma atividade 'alternative' do Motor de Reconciliacao) passava por prescricao normal
// no calendario, mesmo ja sendo corretamente excluida de `sessions` em presentPlan(). Cobre os 3
// casos pedidos: prescricao normal, student_extra (comportamento preservado) e device_extra
// (agora tambem reconhecida como isExtra).
function buildService(sessions: unknown[]) {
  const prisma = {
    trainingSession: {
      findMany: jest.fn().mockResolvedValue(sessions),
    },
  };
  const noop = {} as never;
  const service = new TrainingPlansService(
    prisma as never, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop, noop,
  );
  return { service, prisma };
}

function baseSession(overrides: Partial<any> = {}) {
  return {
    id: 'session-1',
    scheduledDate: new Date('2026-10-01T00:00:00.000Z'),
    weekday: 4,
    modality: 'corrida',
    title: 'Corrida',
    structure: {},
    origin: 'agent',
    completion: { status: 'done', distanceKm: 8 },
    plan: { status: 'active' },
    ...overrides,
  };
}

describe('TrainingPlansService.getStudentHistory — isExtra', () => {
  it('sessao prescrita normal (origin agent, structure sem type extra) -> isExtra false', async () => {
    const { service } = buildService([baseSession()]);
    const result = await service.getStudentHistory('user-1');
    expect(result[0].sessions[0].isExtra).toBe(false);
  });

  it('student_extra (structure.source=student, type=extra) -> isExtra true (comportamento preservado)', async () => {
    const { service } = buildService([
      baseSession({ origin: 'student_extra', structure: { type: 'extra', source: 'student', modality: 'corrida' } }),
    ]);
    const result = await service.getStudentHistory('user-1');
    expect(result[0].sessions[0].isExtra).toBe(true);
  });

  it('device_extra (structure.source=device, type=extra) -> isExtra true (corrigido — nao aparece mais como prescricao real)', async () => {
    const { service } = buildService([
      baseSession({ origin: 'device_extra', structure: { type: 'extra', source: 'device', provider: 'polar', modality: 'bike', activityLogId: 'activity-1' } }),
    ]);
    const result = await service.getStudentHistory('user-1');
    expect(result[0].sessions[0].isExtra).toBe(true);
  });
});
