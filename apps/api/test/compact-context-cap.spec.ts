import { aiContextMaxChars, DEFAULT_AI_CONTEXT_MAX_CHARS, limitCompactAgentContext, type CompactAgentContext } from '../src/training-intelligence/compact-agent-context';

// 22/10/2026 — teto de tamanho do contexto da IA: dados de integracoes saem POR INTEIRO se estourar; o resto nunca e' removido por este teto.
const ref = (ids: string[]) => ({ availability: 'available', variableIds: ids });
function context(filler = ''): CompactAgentContext {
  return {
    athleteId: 'a1',
    generatedAt: '2026-10-22T00:00:00.000Z',
    variableLegend: { 'wearable.sleepDurationMin': {}, 'workout.prePhysicalFatigue': {} },
    variables: { 'wearable.sleepDurationMin': { evidence: { n: 3, filler } }, 'workout.prePhysicalFatigue': { evidence: { n: 5 } } },
    trainingLoad: ref([]),
    sleepRecovery: ref(['wearable.sleepDurationMin']),
    physicalState: ref(['workout.prePhysicalFatigue']),
    psychologicalState: ref([]),
    trainingResponse: ref([]),
    behavior: ref([]),
    pairedEvidence: { effortVsDevice: [], sleepPerceivedVsDevice: [], notes: [] },
  } as unknown as CompactAgentContext;
}

describe('limitCompactAgentContext', () => {
  it('abaixo do teto devolve o contexto intacto', () => {
    const input = context();
    const result = limitCompactAgentContext(input, 50_000);
    expect(result.integrationDataOmitted).toBe(false);
    expect(result.context).toBe(input);
  });

  it('acima do teto remove so os dados de integracoes e preserva o restante', () => {
    const result = limitCompactAgentContext(context('x'.repeat(6_000)), 5_000);
    expect(result.integrationDataOmitted).toBe(true);
    expect(Object.keys(result.context.variables)).toEqual(['workout.prePhysicalFatigue']);
    expect(Object.keys(result.context.variableLegend)).toEqual(['workout.prePhysicalFatigue']);
    expect(result.context.sleepRecovery.variableIds).toEqual([]);
    expect(result.context.physicalState.variableIds).toEqual(['workout.prePhysicalFatigue']);
    expect(result.context.pairedEvidence).toBeUndefined();
  });

  it('grande por outro motivo (sem dado de integracao) nao mexe em nada', () => {
    const input = context('x'.repeat(6_000));
    delete (input as { pairedEvidence?: unknown }).pairedEvidence;
    delete (input.variables as Record<string, unknown>)['wearable.sleepDurationMin'];
    const result = limitCompactAgentContext(input, 5_000);
    expect(result.integrationDataOmitted).toBe(false);
    expect(result.context).toBe(input);
  });

  it('aiContextMaxChars usa o padrao e ignora valor invalido', () => {
    expect(aiContextMaxChars({})).toBe(DEFAULT_AI_CONTEXT_MAX_CHARS);
    expect(aiContextMaxChars({ AI_CONTEXT_MAX_CHARS: 'abc' })).toBe(DEFAULT_AI_CONTEXT_MAX_CHARS);
    expect(aiContextMaxChars({ AI_CONTEXT_MAX_CHARS: '80000' })).toBe(80_000);
  });
});
