import {
  classifyLoadProvenance, isProviderDerivedVariable, LOAD_VARIABLE_DERIVATION, packageMayContainProvider, providersForVariable, redactAgentInputForProvider,
  redactEvidenceForProvider, SessionForLoadProvenance,
} from '../src/training-plans/prescription-trace';
import type { EvidenceItem } from '../src/training-plans/prescription-trace';
import { classifyMaterializedCompletion } from '../src/activity-execution/provider-data-deletion.service';

// Carga semanal (weekly_training_load) na exclusao de dados de um provedor — decisoes D1-D4 de Elton (10/10/2026), unidade.

const activity = (provider: string, distanceMeters: number, durationSec: number) => ({ provider, startedAt: new Date('2026-10-06T08:00:00Z'), distanceMeters, durationSec, avgHeartRateBpm: null, maxHeartRateBpm: null });
const completion = (distanceKm: number, durationMin: number) => ({ status: 'done', distanceKm, durationMin, avgHeartRate: null, maxHeartRate: null, avgPaceSecondsKm: null, perceivedEffort: null });
const copiesOf = (c: Record<string, unknown>, a: SessionForLoadProvenance['links'][number]['activity']) => Object.keys(classifyMaterializedCompletion(c, a).clear);

describe('quais variaveis podem derivar de dispositivo', () => {
  it('volume prescrito NUNCA deriva; as demais variaveis de carga e as de atividade derivam', () => {
    expect(isProviderDerivedVariable('training.volumePrescribedKm')).toBe(false);
    expect(providersForVariable('training.volumePrescribedKm', { activity: ['a'], extra: ['b'], prescribedCopy: ['c'] })).toBeNull();
    for (const id of Object.keys(LOAD_VARIABLE_DERIVATION)) expect(isProviderDerivedVariable(id)).toBe(true);
    expect(isProviderDerivedVariable('workout.perceivedEffort')).toBe(false);
    expect(isProviderDerivedVariable('activity.cadenceAvg')).toBe(true);
  });

  it('cada variavel liga so aos tipos de contribuicao de que depende (ACWR = qualquer componente da janela — D3)', () => {
    const p = { activity: ['garmin'], extra: ['polar'], prescribedCopy: ['wahoo'] };
    expect(providersForVariable('training.volumeExtraKm', p)).toEqual(['polar']);
    expect(providersForVariable('training.adherencePercent', p)).toEqual(['wahoo']);
    expect(providersForVariable('training.volumeCompletedPrescribedOnlyKm', p)).toEqual(['wahoo']);
    for (const id of ['training.volumeCompletedTotalKm', 'training.volumeDiffAbsoluteKm', 'training.volumeRatioCompletedPrescribed', 'training.acwr']) expect(providersForVariable(id, p)).toEqual(['polar', 'wahoo']);
    expect(providersForVariable('activity.avgPaceSecondsKm', p)).toEqual(['garmin']);
    expect(providersForVariable('training.acwr')).toEqual([]); // proveniencia conhecida e sem contribuicao
  });
});

describe('classificacao da contribuicao de dispositivo na janela (sem formula de treino)', () => {
  it('sessao extra do relogio e sempre derivada; valor copiado do relogio e derivado mesmo sem edicao (D2); valor diferente e do aluno', () => {
    const sessions: SessionForLoadProvenance[] = [
      { origin: 'device_extra', structure: { activityLogId: 'a1' }, completion: completion(5, 40), links: [] },
      { origin: 'agent', structure: {}, completion: completion(5.1, 41), links: [{ activity: activity('wahoo', 5100, 2460) }] }, // copia exata
      { origin: 'agent', structure: {}, completion: completion(10, 70), links: [{ activity: activity('garmin', 5000, 2400) }] }, // aluno informou outro valor
      { origin: 'agent', structure: {}, completion: null, links: [{ activity: activity('coros', 5000, 2400) }] }, // so' evidencia objetiva, sem registro
      { origin: 'agent', structure: {}, completion: completion(6, 45), links: [] }, // registro do aluno sem vinculo
    ];
    const result = classifyLoadProvenance(sessions, copiesOf, (id) => (id === 'a1' ? 'polar' : null));
    expect(result).toEqual({ extra: ['polar'], prescribedCopy: ['wahoo'] });
  });

  it('extra do relogio com provedor impossivel de resolver fica ligada a "?" (casa com qualquer exclusao)', () => {
    const result = classifyLoadProvenance([{ origin: 'device_extra', structure: { activityLogId: 'sumiu' }, completion: null, links: [] }], copiesOf, () => null);
    expect(result.extra).toEqual(['?']);
    expect(packageMayContainProvider(['?'], 'polar')).toBe(true);
    const item = { ref: 'variable:training.volumeExtraKm', providers: ['?'], kind: 'k', source: 's', sourceId: null, provider: null, asOf: null, label: 'l', delivery: 'delivered', storage: 'reference_only', excerpt: null } as EvidenceItem;
    expect(redactEvidenceForProvider([item], 'polar').redacted).toBe(1);
  });
});

describe('invalidacao no indice e no texto guardado', () => {
  const ev = (id: string, providers: string[] | undefined): EvidenceItem => ({ ref: `variable:${id}`, kind: 'athlete_state_variable', source: 's', sourceId: null, provider: null, asOf: '2026-10-05', label: 'l', delivery: 'delivered', storage: 'reference_only', excerpt: null, ...(providers ? { providers } : {}) });

  it('invalida so as variaveis ligadas ao provedor; preserva prescrito, aderencia independente e outras fontes; item sem lista de provedores (antigo) e invalidado', () => {
    const evidence = [
      ev('training.volumePrescribedKm', undefined),
      ev('training.volumeExtraKm', ['polar']),
      ev('training.adherencePercent', ['wahoo']),
      ev('training.acwr', ['polar', 'wahoo']),
      ev('training.volumeCompletedTotalKm', []),
      ev('workout.perceivedEffort', undefined),
      ev('training.volumeDiffAbsoluteKm', undefined), // antigo: proveniencia desconhecida
    ];
    const result = redactEvidenceForProvider(evidence, 'polar');
    expect(result.evidence.map((e) => e.ref)).toEqual([
      'variable:training.volumePrescribedKm', 'redacted:polar', 'variable:training.adherencePercent', 'redacted:polar', 'variable:training.volumeCompletedTotalKm', 'variable:workout.perceivedEffort', 'redacted:polar',
    ]);
    expect(result.redacted).toBe(3);
  });

  it('texto guardado: so os ids indicados saem (com legenda e referencias de dominio); o prescrito e as outras fontes permanecem', () => {
    const ctx = {
      variableLegend: { 'training.volumePrescribedKm': {}, 'training.acwr': {}, 'training.volumeExtraKm': {}, 'workout.perceivedEffort': {} },
      variables: { 'training.volumePrescribedKm': { current: 31.5 }, 'training.acwr': { current: 1.37 }, 'training.volumeExtraKm': { current: 9.75 }, 'workout.perceivedEffort': { current: 6.4 } },
      trainingLoad: { variableIds: ['training.volumePrescribedKm', 'training.acwr', 'training.volumeExtraKm', 'workout.perceivedEffort'] },
    };
    const input = { calls: [{ userPrompt: JSON.stringify({ athleteStateContext: ctx, relato: 'esteira' }) }] };
    const { agentInput, redaction } = redactAgentInputForProvider(input, 'polar', new Date('2026-10-12T00:00:00Z'), new Set(['training.acwr', 'training.volumeExtraKm']));
    const text = (agentInput as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt;
    expect(text).not.toMatch(/1\.37|9\.75|training\.acwr|volumeExtraKm/);
    expect(text).toContain('31.5');
    expect(text).toContain('6.4');
    expect(text).toContain('esteira');
    expect(JSON.parse(text).athleteStateContext.trainingLoad.variableIds).toEqual(['training.volumePrescribedKm', 'workout.perceivedEffort']);
    expect(redaction).toMatchObject({ removedVariableIds: ['training.acwr', 'training.volumeExtraKm'], callsChanged: 1 });
    // sem lista (proveniencia desconhecida): todas as derivaveis de dispositivo saem, o prescrito nunca
    const legacy = redactAgentInputForProvider(input, 'polar').agentInput as { calls: Array<{ userPrompt: string }> };
    expect(legacy.calls[0].userPrompt).toContain('31.5');
    expect(legacy.calls[0].userPrompt).not.toMatch(/1\.37|9\.75/);
  });
});
