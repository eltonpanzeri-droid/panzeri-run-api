import {
  buildSessionVersions, canonicalJson, packageMayContainProvider, redactAgentInputForProvider, redactEvidenceForProvider, sha256, snapshotOfSession,
  sourceProvidersOf, VersionDecisionInput, providersForVariable, classifyLoadProvenance, isProviderDerivedVariable, LOAD_VARIABLE_DERIVATION,
} from '../src/training-plans/prescription-trace';
import type { EvidenceItem } from '../src/training-plans/prescription-trace';
import type { MethodologyInput } from '../src/training-plans/training-methodology';

// Correcoes da revisao do Astra (10/10/2026) — unidade: exclusao de dados de provedor (evidencias E texto enviado a IA), proveniencia e versoes de sessao.

// Contexto longitudinal REALISTA (mesma forma do CompactAgentContext): agregados de atividade de dispositivo + agregados de outras fontes.
function athleteStateContext() {
  const evidence = (n: number, last: string) => ({ n, observedSpan: { from: '2026-04-01', to: last.slice(0, 10) }, lastObservationAt: last, instrumentVersions: [1], comparabilityWarning: null, isPartialWindow: false });
  return {
    athleteId: 'atleta-1', generatedAt: '2026-10-12T15:00:00.000Z',
    variableLegend: {
      'activity.avgPaceSecondsKm': { constructLabel: 'ritmo medio da corrida', scale: { min: 120, max: 1200, unit: 's/km' }, direction: 'not_directional' },
      'activity.cadenceAvg': { constructLabel: 'cadencia media', scale: { min: 60, max: 260, unit: 'spm' }, direction: 'not_directional' },
      'workout.perceivedEffort': { constructLabel: 'esforco percebido', scale: { min: 1, max: 10 }, direction: 'higher_is_more' },
    },
    variables: {
      'activity.avgPaceSecondsKm': { current: 437.25, baseline: 441.5, trend: { recent: 'melhorando', mediumTerm: 'estavel' }, byModality: { corrida: { current: 437.25, evidence: evidence(14, '2026-10-09T08:00:00.000Z') } }, evidence: evidence(14, '2026-10-09T08:00:00.000Z') },
      'activity.cadenceAvg': { current: 171.6, baseline: 169.2, evidence: evidence(9, '2026-10-08T08:00:00.000Z') },
      'workout.perceivedEffort': { current: 6.4, baseline: 6.1, evidence: evidence(11, '2026-10-10T08:00:00.000Z') },
    },
    trainingLoad: { availability: 'available', variableIds: ['activity.avgPaceSecondsKm', 'workout.perceivedEffort'] },
    behavior: { availability: 'available', variableIds: ['activity.cadenceAvg'], checkinsSubmittedAllTime: 4 },
    evidenceQuality: { variablesWithData: 3, variablesWithoutData: 0, mostRecentObservationAt: '2026-10-10T08:00:00.000Z', variablesWithComparabilityWarning: ['activity.cadenceAvg', 'workout.perceivedEffort'] },
  };
}

function promptWith(context: unknown) {
  return JSON.stringify({
    relatosEstruturadosDoAluno: [{ fatos: 'A esteira do aluno vai so ate 12 km/h' }],
    studentDirectives: ['Evitar corrida na quarta'],
    athleteStateContext: context,
  });
}

const realisticInput = (): MethodologyInput => ({ athleteStateContext: athleteStateContext() } as unknown as MethodologyInput);

describe('proveniencia dos agregados', () => {
  it('registra os provedores so quando o contexto TEM agregado derivado de atividade com dados (n > 0)', () => {
    expect(sourceProvidersOf(realisticInput(), { activity: ['wahoo', 'polar', 'polar'], extra: [], prescribedCopy: [] })).toEqual(['polar', 'wahoo']);
    expect(sourceProvidersOf({} as MethodologyInput, { activity: ['polar'], extra: [], prescribedCopy: [] })).toEqual([]);
    const semAtividade = athleteStateContext();
    delete (semAtividade.variables as Record<string, unknown>)['activity.avgPaceSecondsKm'];
    delete (semAtividade.variables as Record<string, unknown>)['activity.cadenceAvg'];
    expect(sourceProvidersOf({ athleteStateContext: semAtividade } as unknown as MethodologyInput, { activity: ['polar'], extra: [], prescribedCopy: [] })).toEqual([]);
  });

  it('pacote envolve o provedor quando consta na proveniencia, quando um item o cita, ou quando a proveniencia e desconhecida (null)', () => {
    expect(packageMayContainProvider(['polar'], 'polar')).toBe(true);
    expect(packageMayContainProvider(['wahoo'], 'polar')).toBe(false);
    expect(packageMayContainProvider([], 'polar')).toBe(false);
    expect(packageMayContainProvider(null, 'polar')).toBe(true);
    expect(packageMayContainProvider([], 'polar', [{ provider: 'polar' }])).toBe(true);
    expect(packageMayContainProvider(['wahoo'], 'polar', [{ providers: ['polar', 'wahoo'] }])).toBe(true);
  });
});

describe('exclusao de dados de provedor: texto enviado a IA (agentInput)', () => {
  const buildInput = () => ({ calls: [{ attempt: 1, purpose: 'semana', model: 'claude-sonnet-5', systemPromptSha256: 'abc', userPromptSha256: sha256(promptWith(athleteStateContext())), userPrompt: promptWith(athleteStateContext()) }] });

  it('remove SO os agregados derivados de atividade (variavel, legenda, referencias de dominio) e preserva todo o resto', () => {
    const { agentInput, redaction } = redactAgentInputForProvider(buildInput(), 'polar', new Date('2026-10-12T16:00:00Z'));
    const call = (agentInput as { calls: Array<Record<string, unknown>> }).calls[0];
    const prompt = JSON.parse(call.userPrompt as string);
    const state = prompt.athleteStateContext;
    expect(Object.keys(state.variables)).toEqual(['workout.perceivedEffort']);
    expect(Object.keys(state.variableLegend)).toEqual(['workout.perceivedEffort']);
    expect(state.trainingLoad.variableIds).toEqual(['workout.perceivedEffort']);
    expect(state.behavior.variableIds).toEqual([]);
    expect(state.evidenceQuality.variablesWithComparabilityWarning).toEqual(['workout.perceivedEffort']);
    // nenhum valor agregado de atividade sobrou em lugar nenhum do texto guardado
    for (const leaked of ['437.25', '441.5', '171.6', '169.2', 'activity.avgPaceSecondsKm', 'activity.cadenceAvg', '2026-10-09T08:00', '2026-10-08T08:00']) expect(call.userPrompt as string).not.toContain(leaked);
    // fontes de OUTROS tipos permanecem intactas
    expect(state.variables['workout.perceivedEffort'].current).toBe(6.4);
    expect(prompt.relatosEstruturadosDoAluno[0].fatos).toBe('A esteira do aluno vai so ate 12 km/h');
    expect(prompt.studentDirectives).toEqual(['Evitar corrida na quarta']);
    // marcador auditavel: so metadados, jamais o conteudo removido
    expect(redaction).toEqual({ provider: 'polar', at: '2026-10-12T16:00:00.000Z', reason: 'provider_data_deleted', removedVariableIds: ['activity.avgPaceSecondsKm', 'activity.cadenceAvg'], callsChanged: 1, callsUnparseableRemoved: 0 });
    expect(JSON.stringify(redaction)).not.toMatch(/437|171\.6/);
    // hashes: o original fica (prova de que existiu) e o do texto atual e' gravado
    expect(call.userPromptSha256).toBe(sha256(promptWith(athleteStateContext())));
    expect(call.userPromptSha256AfterRedaction).toBe(sha256(call.userPrompt as string));
    expect(call.userPromptRedacted).toBe(true);
  });

  it('e idempotente: uma segunda exclusao nao muda nada nem cria novo marcador', () => {
    const first = redactAgentInputForProvider(buildInput(), 'polar').agentInput;
    const second = redactAgentInputForProvider(first, 'wahoo');
    expect(second.redaction).toBeNull();
    expect(second.agentInput).toBe(first);
  });

  it('prompt sem agregados de atividade nao e alterado', () => {
    const clean = athleteStateContext();
    delete (clean.variables as Record<string, unknown>)['activity.avgPaceSecondsKm'];
    delete (clean.variables as Record<string, unknown>)['activity.cadenceAvg'];
    const input = { calls: [{ userPrompt: promptWith(clean) }] };
    expect(redactAgentInputForProvider(input, 'polar').redaction).toBeNull();
  });

  it('prompt que nao e JSON valido nao pode ser editado com seguranca: o texto daquela chamada e removido por inteiro e marcado', () => {
    const { agentInput, redaction } = redactAgentInputForProvider({ calls: [{ userPrompt: 'texto livre com ritmo 437.25' }] }, 'polar');
    expect((agentInput as { calls: Array<Record<string, unknown>> }).calls[0]).toEqual({ userPrompt: null, userPromptRedacted: 'removed_unparseable' });
    expect(redaction).toMatchObject({ callsUnparseableRemoved: 1, callsChanged: 0 });
  });

  it('agentInput ausente (ja expurgado pela retencao) ou em outra forma: nada a fazer', () => {
    expect(redactAgentInputForProvider(null, 'polar').redaction).toBeNull();
    expect(redactAgentInputForProvider({ outra: 1 }, 'polar').redaction).toBeNull();
  });
});

describe('exclusao de dados de provedor: indice de evidencias', () => {
  const item = (overrides: Partial<EvidenceItem>): EvidenceItem => ({ ref: 'x', kind: 'k', source: 's', sourceId: null, provider: null, asOf: '2026-10-09', label: 'l', delivery: 'delivered', storage: 'complete', excerpt: 'conteudo', ...overrides });
  const evidence = [
    item({ ref: 'activity:polar-1', provider: 'polar', sourceId: 'a1', excerpt: '5 km' }),
    item({ ref: 'variable:activity.avgPaceSecondsKm', kind: 'athlete_state_variable', providers: ['polar', 'wahoo'], storage: 'reference_only', excerpt: null }),
    item({ ref: 'variable:activity.cadenceAvg', kind: 'athlete_state_variable', providers: ['wahoo'], storage: 'reference_only', excerpt: null }),
    item({ ref: 'variable:workout.perceivedEffort', kind: 'athlete_state_variable', providers: undefined, storage: 'reference_only', excerpt: null }),
    item({ ref: 'report:r1', kind: 'report', excerpt: 'A esteira vai so ate 12 km/h' }),
  ];

  it('redige itens diretos E agregados que incluem o provedor; preserva os demais e deixa marcador no lugar', () => {
    const result = redactEvidenceForProvider(evidence, 'polar');
    expect(result.redacted).toBe(2);
    expect(result.evidence).toHaveLength(evidence.length);
    expect(result.evidence.filter((e) => e.redacted).map((e) => e.ref)).toEqual(['redacted:polar', 'redacted:polar']);
    expect(result.evidence.filter((e) => e.redacted).every((e) => e.sourceId === null && e.asOf === null && e.excerpt === null)).toBe(true);
    expect(result.evidence.map((e) => e.ref)).toEqual(['redacted:polar', 'redacted:polar', 'variable:activity.cadenceAvg', 'variable:workout.perceivedEffort', 'report:r1']);
    expect(result.evidence[4].excerpt).toBe('A esteira vai so ate 12 km/h');
  });

  it('proveniencia desconhecida (pacote antigo): tambem redige os agregados de atividade, por seguranca', () => {
    const legacy = [item({ ref: 'variable:activity.cadenceAvg', kind: 'athlete_state_variable', excerpt: null }), item({ ref: 'variable:workout.perceivedEffort', kind: 'athlete_state_variable', excerpt: null })];
    const result = redactEvidenceForProvider(legacy, 'polar');
    expect(result.redacted).toBe(1);
    expect(result.evidence[1].ref).toBe('variable:workout.perceivedEffort');
  });
});

describe('versoes de uma sessao regenerada', () => {
  const at = (iso: string) => new Date(iso);
  const strength = (distance: number) => snapshotOfSession({ weekday: 3, modality: 'corrida', title: 'Corrida', notes: null, sessionType: 'continuo', durationMin: 40, distanceKm: distance, paceMinSec: '8:00/km', structure: { type: 'run', parts: [{ kind: 'continua', distanceKm: distance }] } });
  const decision = (id: string, createdAt: string, distance: number, extra: Partial<VersionDecisionInput> = {}): VersionDecisionInput => {
    const { snapshot, sha256: hash } = strength(distance);
    return { decisionId: id, packageId: `p-${id}`, packageKind: 'weekly', createdAt: at(createdAt), summary: `corrida ${distance}km`, sessionSnapshot: snapshot, sessionSnapshotSha256: hash, changeFromPrevious: null, ...extra };
  };
  const noExecution = { sessionCreatedAt: at('2026-10-12T09:00:00Z'), completion: null, coachEditsAfterRegistration: 0, objectiveActivities: [] };

  it('hash da versao independe da ordem das chaves (jsonb reordena)', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
    const a = snapshotOfSession({ weekday: 1, modality: 'corrida', sessionType: null, durationMin: 30, distanceKm: 5, paceMinSec: null, structure: { x: 1, y: 2 } });
    const b = snapshotOfSession({ weekday: 1, modality: 'corrida', sessionType: null, durationMin: 30, distanceKm: 5, paceMinSec: null, structure: { y: 2, x: 1 } });
    expect(a.sha256).toBe(b.sha256);
  });

  it('regenerada ANTES da execucao: duas versoes com vigencia encadeada; o registro pertence so a ultima', () => {
    const { versions, outsideVersions } = buildSessionVersions(
      [decision('d1', '2026-10-12T10:00:00Z', 5), decision('d2', '2026-10-12T12:00:00Z', 7, { packageKind: 'day_regeneration' })],
      { ...noExecution, completion: { status: 'done', distanceKm: 7.1 } },
    );
    expect(versions.map((v) => [v.version, v.validFrom, v.validUntil, v.supersededBy])).toEqual([
      [1, '2026-10-12T10:00:00.000Z', '2026-10-12T12:00:00.000Z', 'd2'],
      [2, '2026-10-12T12:00:00.000Z', null, null],
    ]);
    expect((versions[0].snapshot as { distanceKm: number }).distanceKm).toBe(5);
    expect((versions[1].snapshot as { distanceKm: number }).distanceKm).toBe(7);
    expect(versions[0].outcome).toMatchObject({ status: 'no_record', completion: null });
    expect(versions[1].outcome).toMatchObject({ status: 'executed', completionAttribution: 'recorded_after_last_regeneration' });
    expect(outsideVersions.completion).toBeNull();
  });

  it('atividade objetiva e atribuida a versao vigente quando COMECOU (nunca retroativamente)', () => {
    const early = { startedAt: at('2026-10-12T11:00:00Z'), id: 'a-cedo' };
    const late = { startedAt: at('2026-10-12T13:00:00Z'), id: 'a-tarde' };
    const before = { startedAt: at('2026-10-12T09:30:00Z'), id: 'a-antes-de-tudo' };
    const { versions, outsideVersions } = buildSessionVersions(
      [decision('d1', '2026-10-12T10:00:00Z', 5), decision('d2', '2026-10-12T12:00:00Z', 7, { packageKind: 'day_regeneration' })],
      { ...noExecution, objectiveActivities: [before, early, late] },
    );
    expect(versions[0].outcome.objectiveActivities.map((a) => a.id)).toEqual(['a-cedo']);
    expect(versions[0].outcome.status).toBe('objective_only');
    expect(versions[1].outcome.objectiveActivities.map((a) => a.id)).toEqual(['a-tarde']);
    expect(outsideVersions.objectiveActivities.map((a) => a.id)).toEqual(['a-antes-de-tudo']); // anterior a toda prescricao registrada: nao e atribuida a nenhuma
  });

  it('sessao SEM trilha anterior, regenerada: reconstroi a versao anterior a partir do estado preservado e marca como nao rastreada', () => {
    const previous = strength(5);
    const { versions } = buildSessionVersions(
      [decision('d2', '2026-10-12T12:00:00Z', 7, { packageKind: 'day_regeneration', changeFromPrevious: { previousSnapshot: previous.snapshot, previousSnapshotSha256: previous.sha256, previousVersionTraced: false, untracedChangeSincePreviousVersion: null } })],
      noExecution,
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, traced: false, decisionId: null, validFrom: '2026-10-12T09:00:00.000Z', validUntil: '2026-10-12T12:00:00.000Z', supersededBy: 'd2' });
    expect((versions[0].snapshot as { distanceKm: number }).distanceKm).toBe(5);
    expect(versions[1]).toMatchObject({ version: 2, traced: true, decisionId: 'd2' });
  });

  it('propaga a marca de mudanca fora da trilha (edicao manual) e as edicoes do treinador apos o registro', () => {
    const { versions } = buildSessionVersions(
      [decision('d1', '2026-10-12T10:00:00Z', 5), decision('d2', '2026-10-12T12:00:00Z', 7, { packageKind: 'day_regeneration', changeFromPrevious: { untracedChangeSincePreviousVersion: true } })],
      { ...noExecution, completion: { status: 'done' }, coachEditsAfterRegistration: 2 },
    );
    expect(versions[1].untracedChangeBefore).toBe(true);
    expect(versions[1].outcome.coachEditsAfterRegistration).toBe(2);
    expect(versions[0].untracedChangeBefore).toBeNull();
  });

  it('sem nenhuma decisao nao ha versoes; o registro (se existir) fica fora de qualquer versao', () => {
    const { versions, outsideVersions } = buildSessionVersions([], { ...noExecution, completion: { status: 'done' } });
    expect(versions).toEqual([]);
    expect(outsideVersions.completion).toEqual({ status: 'done' });
  });
});
