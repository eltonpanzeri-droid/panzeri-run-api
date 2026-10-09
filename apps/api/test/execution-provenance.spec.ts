import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import {
  applyExecutionActions, classifyExecutionProvenance, executionActionsFor, EvidenceItem, PROMPT_FIELD_CLASSIFICATION, redactAgentInputForProvider,
  redactEvidenceForProvider, REMOVED_LINE, SessionForLoadProvenance,
} from '../src/training-plans/prescription-trace';
import { classifyMaterializedCompletion } from '../src/activity-execution/provider-data-deletion.service';

// Valores de EXECUCAO enviados a IA (historico semanal, recorde, narrativas) na exclusao de dados de um provedor — unidade.

const activity = (provider: string, distanceMeters: number, durationSec: number) => ({ provider, startedAt: new Date('2026-09-29T08:00:00Z'), distanceMeters, durationSec, avgHeartRateBpm: null, maxHeartRateBpm: null });
const completion = (distanceKm: number, durationMin: number) => ({ status: 'done', distanceKm, durationMin, avgHeartRate: null, maxHeartRate: null, avgPaceSecondsKm: null });
const copiesOf = (c: Record<string, unknown>, a: SessionForLoadProvenance['links'][number]['activity']) => Object.keys(classifyMaterializedCompletion(c, a).clear);
const resolve = (id: string) => (id === 'a-polar' ? 'polar' : null);

const copyWahoo: SessionForLoadProvenance = { origin: 'agent', structure: {}, completion: completion(5.1, 41), links: [{ activity: activity('wahoo', 5100, 2460) }] };
const extraPolar: SessionForLoadProvenance = { origin: 'device_extra', structure: { activityLogId: 'a-polar' }, completion: completion(5, 40), links: [] };
const independent: SessionForLoadProvenance = { origin: 'agent', structure: {}, completion: completion(10, 70), links: [{ activity: activity('garmin', 5000, 2400) }] };
const unrecorded: SessionForLoadProvenance = { origin: 'agent', structure: {}, completion: null, links: [] };

function provenance() {
  return classifyExecutionProvenance({
    weeks: [{ weekStartDate: '2026-09-28', sessions: [copyWahoo, extraPolar, independent, unrecorded], recorded: [copyWahoo, extraPolar, independent] }],
    longestRun: copyWahoo,
    nearRecord: [copyWahoo, independent, extraPolar],
    narrativeProviders: ['wahoo', 'polar', 'garmin', 'polar'],
    profile: { summaryMayCarryEvolutionNarrative: true, pendingEventCodes: ['WORKOUT_COMPLETED', 'REASSESSMENT_COMPLETED'] },
  }, copiesOf, resolve);
}

function promptText() {
  return JSON.stringify({
    objetivo: 'Correr 10km',
    prontuarioDoAluno: 'Resumo com a evolucao SENTINELA',
    eventosDoProntuarioAindaNaoCondensados: ['evento independente', 'Reavaliacao concluida. Resumo de evolucao: SENTINELA'],
    reavaliacaoMaisRecente: { concluidaEm: 'x', respostas: { a: 1 }, resumoDeEvolucaoGeradoPeloAgenteDeReavaliacao: 'SENTINELA', pontosPositivos: ['x'], pontosDeAtencao: ['y'] },
    relatorioDeEvolucao: { summary: 'SENTINELA' },
    historicoSemanal: [{ runMinutes: 80, completedRunMinutes: 86, longestRunMinutes: 70, prescribedSessions: 4, completedSessions: 3, unregisteredSessions: 1, weekStartDate: '2026-09-28', longestRunDate: '2026-10-01', recordedSessions: ['linha wahoo', 'linha polar', 'linha independente'] }],
    maiorLongaoJaRegistrado: { distanciaKm: 5.1 },
    sessoesRecentesPertoDoRecorde: [{ distanciaKm: 5.1 }, { distanciaKm: 10 }, { distanciaKm: 5 }],
  });
}

describe('proveniencia dos valores de execucao', () => {
  it('sessao do relogio contamina contagens e minutos; copia do relogio contamina os valores realizados; registro diferente do relogio e independente', () => {
    const result = provenance();
    const week = result.weeks[0];
    expect(week.fields.prescribedSessions).toEqual(['polar']);
    expect(week.fields.runMinutes).toEqual(['polar']);
    expect(week.fields.completedSessions).toEqual(['polar', 'wahoo']);
    expect(week.fields.longestRunDate).toEqual(['polar', 'wahoo']);
    expect(week.fields.unregisteredSessions).toBeUndefined(); // ausencia de registro nao deriva de dispositivo
    expect(week.recordedSessions).toEqual([{ index: 0, providers: ['wahoo'] }, { index: 1, providers: ['polar'] }]); // a 3a linha (garmin, valor diferente) e do aluno
    expect(result.longestRun).toEqual(['wahoo']);
    expect(result.nearRecord).toEqual([{ index: 0, providers: ['wahoo'] }, { index: 2, providers: ['polar'] }]);
    expect(result.evolutionReport).toEqual(['garmin', 'polar', 'wahoo']);
    expect(result.profileSummary).toEqual(['garmin', 'polar', 'wahoo']);
    expect(result.pendingProfileEvents).toEqual([{ index: 1, providers: ['garmin', 'polar', 'wahoo'] }]);
  });
});

describe('aplicacao ao texto enviado a IA', () => {
  const evidenceFor = () => {
    const base = { kind: 'k', source: 's', sourceId: null, provider: null, asOf: null, label: 'l', delivery: 'delivered', storage: 'reference_only', excerpt: 'valor' } as const;
    const exec = provenance();
    return [
      { ...base, ref: 'history_week:2026-09-28', kind: 'history_week', providers: ['polar', 'wahoo'], derivation: { kind: 'history_week', weekStartDate: '2026-09-28', fields: exec.weeks[0].fields, entries: exec.weeks[0].recordedSessions } },
      { ...base, ref: 'record:longest_run', providers: ['wahoo'], derivation: { kind: 'longest_run' } },
      { ...base, ref: 'record:near_record', providers: ['polar', 'wahoo'], derivation: { kind: 'near_record', entries: exec.nearRecord } },
      { ...base, ref: 'evolution_report:1', providers: exec.evolutionReport, derivation: { kind: 'evolution_report' } },
      { ...base, ref: 'reassessment:1', providers: exec.reassessmentEvolution, derivation: { kind: 'reassessment_evolution' } },
      { ...base, ref: 'profile:summary', providers: exec.profileSummary, derivation: { kind: 'profile_summary' } },
      { ...base, ref: 'profile_event_pending:e2', providers: ['garmin', 'polar', 'wahoo'], derivation: { kind: 'pending_profile_events', entries: [{ index: 1, providers: ['garmin', 'polar', 'wahoo'] }] } },
    ] as unknown as EvidenceItem[];
  };
  const run = (provider: string, evidence = evidenceFor(), text = promptText()) => {
    const actions = executionActionsFor(evidence, provider);
    const out = redactAgentInputForProvider({ calls: [{ userPrompt: text }] }, provider, new Date('2026-10-12T00:00:00Z'), new Set(), actions);
    return { actions, parsed: out.agentInput ? JSON.parse((out.agentInput as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt) : null, redaction: out.redaction };
  };

  it('excluir a WAHOO: campos que ela contamina saem, os so da Polar ficam, linha do aluno fica, narrativas saem, indices preservados com marcador', () => {
    const { parsed, redaction } = run('wahoo');
    const week = parsed.historicoSemanal[0];
    for (const field of ['completedSessions', 'completedRunMinutes', 'longestRunMinutes', 'longestRunDate']) expect(week).not.toHaveProperty(field);
    expect(week.prescribedSessions).toBe(4); // so da Polar: permanece ate a Polar ser excluida
    expect(week.runMinutes).toBe(80);
    expect(week.unregisteredSessions).toBe(1);
    expect(week.weekStartDate).toBe('2026-09-28');
    expect(week.recordedSessions).toEqual([REMOVED_LINE, 'linha polar', 'linha independente']);
    expect(parsed.maiorLongaoJaRegistrado).toBeNull();
    expect(parsed.sessoesRecentesPertoDoRecorde).toEqual([{ removido: true }, { distanciaKm: 10 }, { distanciaKm: 5 }]);
    expect(parsed.prontuarioDoAluno).toBeNull();
    expect(parsed.eventosDoProntuarioAindaNaoCondensados).toEqual(['evento independente', REMOVED_LINE]);
    expect(parsed.relatorioDeEvolucao).toBeNull();
    for (const field of ['resumoDeEvolucaoGeradoPeloAgenteDeReavaliacao', 'pontosPositivos', 'pontosDeAtencao']) expect(parsed.reavaliacaoMaisRecente).not.toHaveProperty(field);
    expect(parsed.reavaliacaoMaisRecente.respostas).toEqual({ a: 1 }); // resposta do aluno permanece
    expect(parsed.objetivo).toBe('Correr 10km');
    expect(JSON.stringify(parsed)).not.toContain('SENTINELA');
    expect(redaction?.removedExecutionFields).toContain('historicoSemanal[2026-09-28].completedRunMinutes');
    expect(JSON.stringify(redaction)).not.toMatch(/linha|SENTINELA|5\.1/); // marcador: nomes e indices, nunca valores
  });

  it('exclusoes sucessivas (Wahoo depois Polar): os indices continuam validos e o registro independente do aluno sobrevive', () => {
    const evidence = evidenceFor();
    const first = run('wahoo', evidence);
    // o indice e atualizado pela exclusao da Wahoo (derivacao restante) e a Polar age sobre o texto ja redigido
    const afterWahoo = redactEvidenceForProvider(evidence, 'wahoo').evidence;
    const second = redactAgentInputForProvider({ calls: [{ userPrompt: JSON.stringify(first.parsed) }] }, 'polar', new Date(), new Set(), executionActionsFor(afterWahoo, 'polar'));
    const parsed = JSON.parse((second.agentInput as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt);
    const week = parsed.historicoSemanal[0];
    expect(week).not.toHaveProperty('prescribedSessions');
    expect(week).not.toHaveProperty('runMinutes');
    expect(week.recordedSessions).toEqual([REMOVED_LINE, REMOVED_LINE, 'linha independente']);
    expect(week.unregisteredSessions).toBe(1);
    expect(parsed.sessoesRecentesPertoDoRecorde).toEqual([{ removido: true }, { distanciaKm: 10 }, { removido: true }]);
    // terceira exclusao (Garmin): nada derivado dela sobrou
    const third = executionActionsFor(redactEvidenceForProvider(afterWahoo, 'polar').evidence, 'garmin');
    expect(third).toEqual([]);
  });

  it('indice: a derivacao de OUTRO provedor continua registrada depois da exclusao de um provedor', () => {
    const after = redactEvidenceForProvider(evidenceFor(), 'wahoo').evidence;
    const week = after.find((e) => e.ref === 'history_week:2026-09-28')!;
    expect(week.derivation?.fields).toEqual({ prescribedSessions: ['polar'], runMinutes: ['polar'] });
    expect(week.derivation?.entries).toEqual([{ index: 1, providers: ['polar'] }]);
    expect(week.invalidatedProviders).toEqual(['wahoo']);
    expect(week.excerpt).toBeNull(); // contagens derivadas do resumo saem junto
    expect(after.find((e) => e.ref === 'record:longest_run')).toMatchObject({ providers: [], invalidatedProviders: ['wahoo'] });
  });

  it('proveniencia desconhecida (pacote antigo): todo valor de execucao derivavel e invalidado; o que e do aluno por natureza fica', () => {
    const out = redactAgentInputForProvider({ calls: [{ userPrompt: promptText() }] }, 'qualquer', new Date(), null, 'all');
    const parsed = JSON.parse((out.agentInput as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt);
    const week = parsed.historicoSemanal[0];
    expect(week.recordedSessions).toEqual([REMOVED_LINE, REMOVED_LINE, REMOVED_LINE]);
    expect(week).not.toHaveProperty('completedRunMinutes');
    expect(week.unregisteredSessions).toBe(1);
    expect(parsed.maiorLongaoJaRegistrado).toBeNull();
    expect(parsed.objetivo).toBe('Correr 10km');
    expect(applyExecutionActions({ nada: 1 }, 'all')).toEqual([]);
  });
});

describe('cobertura: todo campo do texto enviado a IA esta classificado', () => {
  const agent = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as Record<string, (...args: unknown[]) => string>;
  const input = {
    goal: 'g', experience: 'e', answers: {}, availability: [], history: [], recentReassessment: { completedAt: 'x', answers: {}, evolutionSummary: 's', evolutionWins: [], evolutionConcerns: [] },
    weeklyCheckIn: null, longestRunEver: { distanceKm: 1, date: 'd', satisfaction: null, pacingMode: null }, recentSessionsNearRecord: [], targetRaces: [], evolutionReport: null,
  };
  const runParams = { durationMin: 40, evidence: { testPace: null, selfReportedPace: null }, studentDirectives: [], activeObservations: [], painTier: 'normal', painReason: null, answers: {}, studentReports: [], pendingStudentReports: [], pendingProfileEvents: [], contextGaps: [], studentProfileSummary: null };

  it('prompt da semana, do dia de corrida e do dia de forca: nenhum campo novo escapa da classificacao (e nenhuma classificacao esta obsoleta)', () => {
    const weekly = Object.keys(JSON.parse(agent.buildUserPrompt(input, [], [], false, false, { testPace: null, selfReportedPace: null }, null)));
    const run = Object.keys(JSON.parse(agent.buildRunSessionUserPrompt(runParams)));
    const strength = Object.keys(JSON.parse(agent.buildSingleStrengthUserPrompt(input, { weekday: 1, modality: 'forca', durationMin: 40 })));
    const seen = new Set([...weekly, ...run, ...strength]);
    const unclassified = [...seen].filter((key) => !(key in PROMPT_FIELD_CLASSIFICATION));
    expect(unclassified).toEqual([]); // campo novo no prompt => classifique-o em PROMPT_FIELD_CLASSIFICATION e trate a exclusao de provedor
    const stale = Object.keys(PROMPT_FIELD_CLASSIFICATION).filter((key) => !seen.has(key));
    expect(stale).toEqual([]);
  });

  it('todo campo classificado como derivado de dispositivo tem tratamento na redacao', () => {
    // um prompt com TODOS os campos derivados preenchidos, redigido em modo "desconhecido", fica sem nenhum valor derivado
    const derived = Object.entries(PROMPT_FIELD_CLASSIFICATION).filter(([, kind]) => kind !== 'independent').map(([key]) => key);
    expect([...derived].sort()).toEqual(['athleteStateContext', 'eventosDoProntuarioAindaNaoCondensados', 'historicoSemanal', 'maiorLongaoJaRegistrado', 'prontuarioDoAluno', 'reavaliacaoMaisRecente', 'relatorioDeEvolucao', 'relatorioDeExecucaoDaSemanaAnterior', 'sessoesRecentesPertoDoRecorde'].sort());
    const out = redactAgentInputForProvider({ calls: [{ userPrompt: promptText() }] }, 'x', new Date(), null, 'all');
    const text = (out.agentInput as { calls: Array<{ userPrompt: string }> }).calls[0].userPrompt;
    expect(text).not.toContain('SENTINELA');
    expect(JSON.parse(text).maiorLongaoJaRegistrado).toBeNull();
  });
});
