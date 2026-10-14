import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { VARIABLE_REGISTRY } from '../src/training-intelligence/variable-registry';

// 14/10/2026 — feedback V3 (01/10/2026) so' trocou a pergunta 12 (executionVsPrescribed -> executionBehavior). O leitor descartava TODOS os completions V3 das
// demais variaveis (cansaco, resposta pos-treino...) porque o registro so' declarava as versoes 1 e 2: os graficos paravam em 01/10. Estes testes garantem que
// V2 e V3 sao lidos com a MESMA correspondencia pergunta -> coluna -> escala, sem duplicar nem alterar valores.

function buildReader(sessions: unknown[]) {
  const prisma = {
    trainingSession: { findMany: jest.fn().mockResolvedValue(sessions) },
    weeklyCheckIn: { findMany: jest.fn().mockResolvedValue([]) },
    nightlySleepLog: { findMany: jest.fn().mockResolvedValue([]) },
    stressCheckin: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return new ObservationReaderService(prisma as never, {} as never, {} as never);
}

const session = (id: string, date: string, completion: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  id, userId: 'aluno-1', modality: 'corrida', scheduledDate: new Date(`${date}T00:00:00.000Z`), structure: {}, plan: { status: 'active' }, ...extra,
  completion: completion && { id: `c-${id}`, completedAt: new Date(`${date}T20:00:00.000Z`), details: {}, ...completion },
});

// Valores DIFERENTES por coluna: qualquer troca de correspondencia pergunta -> coluna quebra o teste.
const FEEDBACK = { prePhysicalFatigue: 2, preMentalFatigue: 1, preMotivation: 4, perceivedEffort: 7, postPhysicalFatigue: 3, postMentalFatigue: 5, emotionalExperienceDuring: 4, mentalStateChangePrePost: 2 };

describe('feedback V3 volta a aparecer nos indicadores', () => {
  it.each(Object.entries(FEEDBACK))('%s: sessao V3 gera a MESMA observacao que a V2 (valor da propria coluna, data do treino, versao 3)', async (field, value) => {
    const reader = buildReader([
      session('v2', '2026-09-30', { feedbackVersion: 2, ...FEEDBACK }),
      session('v3', '2026-10-13', { feedbackVersion: 3, ...FEEDBACK }),
    ]);
    const obs = await reader.getObservations('aluno-1', `workout.${field}`);
    expect(obs.map((o) => [o.timestamp.toISOString().slice(0, 10), o.value, o.instrumentVersion])).toEqual([
      ['2026-09-30', value, 2],
      ['2026-10-13', value, 3],
    ]);
  });

  it('serie mista V2 + V3: ordem cronologica, uma observacao por sessao (sem duplicar) e valores intactos', async () => {
    const sessions = [
      session('a', '2026-10-02', { feedbackVersion: 3, postPhysicalFatigue: 4 }),
      session('b', '2026-09-28', { feedbackVersion: 2, postPhysicalFatigue: 2 }),
      session('c', '2026-10-10', { feedbackVersion: 3, postPhysicalFatigue: 1 }),
      session('d', '2026-10-14', { feedbackVersion: 3, postPhysicalFatigue: 5 }),
    ];
    const obs = await buildReader(sessions).getObservations('aluno-1', 'workout.postPhysicalFatigue');
    expect(obs.map((o) => [o.timestamp.toISOString().slice(0, 10), o.value])).toEqual([['2026-09-28', 2], ['2026-10-02', 4], ['2026-10-10', 1], ['2026-10-14', 5]]);
    expect(new Set(obs.map((o) => o.context?.sessionId)).size).toBe(4);
  });

  it('sessao V3 SEM a resposta (nula) continua sem observacao — ausencia nunca vira zero', async () => {
    const obs = await buildReader([session('x', '2026-10-12', { feedbackVersion: 3, postMentalFatigue: null })]).getObservations('aluno-1', 'workout.postMentalFatigue');
    expect(obs).toEqual([]);
  });

  it('pergunta 12: executionBehavior so e lida no V3 e executionVsPrescribed (congelada) so no V2 — nunca misturadas', async () => {
    const sessions = [
      session('v2', '2026-09-30', { feedbackVersion: 2, executionVsPrescribed: 3, executionBehavior: null }),
      session('v3', '2026-10-13', { feedbackVersion: 3, executionVsPrescribed: null, executionBehavior: 'as_planned' }),
    ];
    const reader = buildReader(sessions);
    const legacy = await reader.getObservations('aluno-1', 'workout.executionVsPrescribed');
    expect(legacy.map((o) => [o.instrumentVersion, o.value])).toEqual([[2, 3]]);
    const behavior = await reader.getObservations('aluno-1', 'workout.executionBehavior');
    expect(behavior.map((o) => [o.instrumentVersion, o.value])).toEqual([[3, 'as_planned']]);
  });

  it('V1 continua lendo experiencia emocional de details.postWorkoutMood (sem regressao)', async () => {
    const obs = await buildReader([session('old', '2026-09-10', { feedbackVersion: 1, details: { postWorkoutMood: 4 } })]).getObservations('aluno-1', 'workout.emotionalExperienceDuring');
    expect(obs.map((o) => [o.instrumentVersion, o.value])).toEqual([[1, 4]]);
  });

  it('registro: toda variavel de treino do V2 declara tambem a versao 3, exceto as congeladas/substituidas', () => {
    const exceptions = new Set(['workout.executionVsPrescribed', 'workout.sleepScheduleIrregularity']); // congelada / substituida em 01/10/2026
    const missing = Object.values(VARIABLE_REGISTRY)
      .filter((definition) => definition.variableId.startsWith('workout.') && definition.versions.some((spec) => spec.version === 2) && !exceptions.has(definition.variableId))
      .filter((definition) => !definition.versions.some((spec) => spec.version === 3))
      .map((definition) => definition.variableId);
    expect(missing).toEqual([]);
    // a versao 3 usa exatamente o mesmo campo/local de armazenamento da 2 (mesma correspondencia pergunta -> coluna)
    for (const definition of Object.values(VARIABLE_REGISTRY).filter((d) => d.variableId.startsWith('workout.'))) {
      const v2 = definition.versions.find((spec) => spec.version === 2);
      const v3 = definition.versions.find((spec) => spec.version === 3);
      if (v2 && v3 && definition.variableId !== 'workout.executionBehavior') expect({ ...v3, version: 2 }).toEqual(v2);
    }
  });
});
