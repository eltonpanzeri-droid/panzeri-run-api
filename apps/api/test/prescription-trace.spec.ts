import { createHash } from 'crypto';
import { PrescriptionAgentService, REASONING_INSTRUCTION } from '../src/training-plans/prescription-agent.service';
import { AI_MODELS } from '../src/common/ai-models.config';
import {
  buildAgentInputRecord, buildEvidenceIndex, buildSessionDecisions, buildWeekDecision, describeSessionForTrace, EvidenceItem, MAX_AGENT_INPUT_CHARS,
  parseRetentionMonths, recordAgentCall, redactEvidenceForProvider, retentionCutoff, sha256,
} from '../src/training-plans/prescription-trace';
import { MethodologyInput } from '../src/training-plans/training-methodology';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';
import { PrescriptionTraceService } from '../src/training-plans/prescription-trace.service';
import { PrescriptionTraceController } from '../src/training-plans/prescription-trace.controller';

// Etapa 1.2a — unidade (sem banco): indice de evidencias, decisoes deterministicas, redacao por provedor, retencao e CONGELAMENTO dos
// prompts/modelos (a subetapa nao pode alterar nenhum dos dois).

describe('prompts e modelos CONGELADOS na 1.2a', () => {
  // Hashes do texto de cada prompt de sistema, calculados no commit 54b5427 (antes da 1.2a). Se alguem alterar um prompt, este teste
  // falha de proposito: a mudanca precisa ser consciente (1.2b atualiza estes hashes junto com o pedido de aprovacao).
  const FROZEN = {
    stable: '0c67d61ad437bd0bdd5f44ad2511780da276bce8c42d2920283bd0cb41021522',
    safetyOff: '90845a73c34035ad1ae2cdd755ff5c3acd966196e01159ca6640f9257e70af58',
    safetyOn: '4d827cdb6a2977afa4cd38e6838bf968b48ff564fe4655b6aec818b5b089c09b',
    safetyRemove: '8e865b48162c93abcc974f533fc525d97abaa53ac555cf5463762fec6907f987',
    run: '857b1ae58a7ce8d54cf4b4dfd71a48b1eed5ff1ea33048a8ed67204ccc41d762',
    strength: '527325c2ae8515610edb7fea1838572e9cbe28bf6c7dea6ca5389a349158c4f9',
  };
  const service = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as Record<string, (...args: unknown[]) => string>;

  // 1.2b (10/10/2026): a UNICA mudanca autorizada nos prompts e' o bloco REASONING_INSTRUCTION. Provado: removendo exatamente esse bloco, cada prompt volta
  // bit a bit ao hash de antes da rastreabilidade; as orientacoes de seguranca nao mudaram nada.
  it('os prompts de sistema so mudam pelo bloco de raciocinio declarado (1.2b): sem ele, voltam bit a bit ao original', () => {
    const without = (prompt: string) => prompt.replace('\n\n' + REASONING_INSTRUCTION, '');
    const stable = service.buildSystemPromptStable();
    const run = service.buildRunSessionSystemPrompt();
    const strength = service.buildSingleStrengthSystemPrompt();
    for (const prompt of [stable, run, strength]) expect(prompt).toContain(REASONING_INSTRUCTION);
    expect(sha256(without(stable))).toBe(FROZEN.stable);
    expect(sha256(without(run))).toBe(FROZEN.run);
    expect(sha256(without(strength))).toBe(FROZEN.strength);
    expect(sha256(service.buildSafetyGuidance(false, false))).toBe(FROZEN.safetyOff);
    expect(sha256(service.buildSafetyGuidance(true, false))).toBe(FROZEN.safetyOn);
    expect(sha256(service.buildSafetyGuidance(true, true))).toBe(FROZEN.safetyRemove);
  });

  it('o bloco de raciocinio e curto e pede limites objetivos (controle de tokens)', () => {
    expect(REASONING_INSTRUCTION.length).toBeLessThan(1000);
    expect(REASONING_INSTRUCTION).toMatch(/160 caracteres/);
    expect(REASONING_INSTRUCTION).toMatch(/ate 3 itens/);
    expect(REASONING_INSTRUCTION).toMatch(/NAO muda nada no treino/);
  });

  it('os modelos continuam os mesmos (nenhum modelo alterado)', () => {
    expect(AI_MODELS).toEqual({ SONNET_5: 'claude-sonnet-5', HAIKU_4_5: 'claude-haiku-4-5-20251001' });
  });

  it('registrar a chamada nao altera o texto: o que foi registrado e exatamente o que o construtor devolve', () => {
    const trace: Parameters<typeof recordAgentCall>[0] = [];
    const input = { goal: 'x', experience: '', answers: {}, availability: [], history: [] } as MethodologyInput;
    const prompt = (service as unknown as { buildUserPrompt: (...a: unknown[]) => string }).buildUserPrompt(input, [], [], false, false, {}, null);
    recordAgentCall(trace, { purpose: 'semana', model: AI_MODELS.SONNET_5, system: 'sys', userPrompt: prompt });
    expect(trace).toEqual([{ purpose: 'semana', model: 'claude-sonnet-5', systemPromptSha256: sha256('sys'), userPrompt: prompt }]);
    recordAgentCall(undefined, { purpose: 'semana', model: 'm', system: 's', userPrompt: 'p' }); // sem trace: no-op
  });
});

describe('injecao e protecao', () => {
  it('a rastreabilidade e a ULTIMA dependencia do TrainingPlansService, OBRIGATORIA (nao-opcional) e a rota e so de treinador/admin', () => {
    const types = Reflect.getMetadata('design:paramtypes', TrainingPlansService) as unknown[];
    expect(types[types.length - 1]).toBe(PrescriptionTraceService);
    expect(Reflect.getMetadata('optional:paramtypes', TrainingPlansService) ?? []).not.toContain(types.length - 1);
    expect(Reflect.getMetadata('__guards__', PrescriptionTraceController)).toHaveLength(2); // JWT + RolesGuard
    expect(Reflect.getMetadata('roles', PrescriptionTraceController)).toEqual(['coach', 'admin']);
    expect(Reflect.getMetadata('path', PrescriptionTraceController)).toBe('coach');
  });
});

describe('registro do contexto enviado a IA', () => {
  const call = (userPrompt: string, purpose: 'semana' | 'reparo_forca' = 'semana') => ({ purpose, model: 'claude-sonnet-5', systemPromptSha256: sha256('sys'), userPrompt });

  it('guarda o TEXTO EXATO (a ordem das chaves do jsonb nao reproduz o texto), com hashes conferiveis, por chamada e do conjunto', () => {
    const text = JSON.stringify({ z: 1, a: { y: 2, b: 3 } }, null, 2);
    const record = buildAgentInputRecord([call(text), call('{"reparo":true}', 'reparo_forca')]);
    const calls = (record.agentInput as { calls: Array<{ userPrompt: string; userPromptSha256: string; attempt: number; purpose: string }> }).calls;
    expect(calls.map((c) => c.attempt)).toEqual([1, 2]);
    expect(calls[0].userPrompt).toBe(text);
    expect(calls[0].userPromptSha256).toBe(sha256(text));
    expect(calls[1].purpose).toBe('reparo_forca');
    expect(record.modelIds).toEqual(['claude-sonnet-5']);
    expect(record.agentInputHash).toBe(sha256(JSON.stringify([['semana', 'claude-sonnet-5', sha256('sys'), text], ['reparo_forca', 'claude-sonnet-5', sha256('sys'), '{"reparo":true}']])));
    expect(record.oversized).toBe(false);
  });

  it('acima do teto o conteudo completo NAO e guardado (so o hash e o indice), de forma explicita', () => {
    const record = buildAgentInputRecord([call('x'.repeat(MAX_AGENT_INPUT_CHARS + 10))]);
    expect(record.oversized).toBe(true);
    expect(record.agentInput).toBeNull();
    expect(record.agentInputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('indice de evidencias: entregue / sem processar / ausente, e como foi guardado', () => {
  const baseInput = {
    goal: 'x', experience: '', answers: { sleep_hours: '7' }, availability: [{ weekday: 2, modalities: ['corrida'], availableMin: 40, modalityDurations: null }], history: [],
  } as unknown as MethodologyInput;

  it('cada origem vira um item com ref estavel, estado de entrega e de armazenamento', () => {
    const long = 'a'.repeat(500);
    const items = buildEvidenceIndex({
      input: {
        ...baseInput,
        studentProfileSummary: 'resumo do prontuario',
        studentReports: [{ data: '2026-03-02', origem: 'observacao', fatos: long, percepcaoDoAluno: null, temas: [], temporalidade: 'PERSISTENTE_ATE_CONTRARIO', relevancia: 'ACOMPANHAR', notaLongitudinal: null, hipotesesDoRelator: [], relatoOriginal: long }],
        pendingStudentReports: [{ data: '2026-10-08', origem: 'feedback', situacao: 'analise_falhou', relatoOriginal: 'curto' }],
        pendingProfileEvents: ['[2026-10-06] PAIN_REPORT: dor'],
        weeklyCheckIn: { checkinVersion: 3, checkinSkipped: false, elaborationSatisfaction: null } as never,
        athleteStateContext: { variables: { 'workout.perceivedEffort': { evidence: { n: 12, lastObservationAt: '2026-10-07T10:00:00Z' } }, 'workout.preSleepQuality': { evidence: { n: 0 } } }, menstrualCycle: { currentDayOfCycle: 3 } } as never,
        history: [{ weekStartDate: '2026-10-05', prescribedSessions: 3, completedSessions: 2, unregisteredSessions: 1 }] as never,
        painTier: 'reduced', painReason: 'dor no joelho',
      },
      directives: [{ id: 'd1', content: 'Evitar quarta', createdAt: new Date('2026-09-01') }],
      observations: [{ id: 'o1', content: 'sem hack squat', createdAt: new Date('2026-09-30') }],
      interpretedReportIds: ['r1'], pendingReportIds: ['p1'], pendingProfileEventIds: ['e1'],
      historyWeeks: [{ startDate: new Date('2026-10-05'), planId: 'plan-1' }],
      checkIn: { id: 'c1' }, targetRaces: [{ id: 't1', name: 'Meia maratona' }], reassessment: { id: 'ra1', completedAt: new Date('2026-09-01') }, evolutionReport: { id: 'ev1', createdAt: new Date('2026-09-02') },
      interviewCompletedAt: new Date('2026-08-01'), paceSource: 'self_report_5k',
      contextGaps: [{ source: 'ciclo_menstrual', severity: 'degradado', reason: 'falhou', effect: 'sem ciclo' }, { source: 'prontuario', severity: 'informativo', reason: 'condensacao falhou', effect: 'bruto' }],
    });
    const get = (ref: string) => items.find((i) => i.ref === ref)!;

    expect(get('report:r1')).toMatchObject({ delivery: 'delivered', storage: 'partial', sourceId: 'r1', provider: null });
    expect(get('report:r1').excerpt!.length).toBeLessThanOrEqual(300);
    expect(get('report_pending:p1')).toMatchObject({ delivery: 'delivered_unprocessed', storage: 'complete' });
    expect(get('profile_event_pending:e1')).toMatchObject({ delivery: 'delivered_unprocessed' });
    expect(get('profile:summary')).toMatchObject({ delivery: 'delivered', storage: 'reference_only' });
    expect(get('directive:d1')).toMatchObject({ delivery: 'delivered', storage: 'complete', excerpt: 'Evitar quarta' });
    expect(get('observation:o1').asOf).toBe('2026-09-30');
    expect(get('history_week:2026-10-05')).toMatchObject({ storage: 'complete', excerpt: 'prescritas 3, concluidas 2, sem registro 1', sourceId: 'plan-1' });
    expect(get('checkin:c1')).toMatchObject({ delivery: 'delivered' });
    expect(get('target_race:t1').excerpt).toBe('Meia maratona');
    expect(get('pain:safety').excerpt).toBe('reduced: dor no joelho');
    expect(get('variable:workout.perceivedEffort')).toMatchObject({ storage: 'reference_only', asOf: '2026-10-07' });
    expect(items.find((i) => i.ref === 'variable:workout.preSleepQuality')).toBeUndefined(); // n=0 nao e evidencia entregue
    expect(get('athlete_state:summary').excerpt).toBe('1 variavel(is) com dados; 1 sem dados');
    expect(get('menstrual_cycle:context')).toBeDefined();
    expect(get('gap:ciclo_menstrual')).toMatchObject({ delivery: 'absent' }); // nao recuperado
    expect(get('gap:prontuario')).toMatchObject({ delivery: 'delivered' }); // pendencia: entregue em texto bruto
    expect(new Set(items.map((i) => i.ref)).size).toBe(items.length); // refs unicas
    expect(items.every((i) => i.provider === null)).toBe(true);
    expect(JSON.stringify(items)).not.toMatch(/strava/i);
  });

  it('contexto minimo: sem itens que nao foram entregues (nada inventado)', () => {
    const items = buildEvidenceIndex({
      input: { ...baseInput, answers: {} }, directives: [], observations: [], interpretedReportIds: [], pendingReportIds: [], pendingProfileEventIds: [], historyWeeks: [],
      checkIn: null, targetRaces: [], reassessment: null, evolutionReport: null, interviewCompletedAt: null, paceSource: null, contextGaps: [],
    });
    expect(items.map((i) => i.ref)).toEqual(['availability:week']);
  });
});

describe('decisoes deterministicas (sem IA)', () => {
  const session = (id: string, weekday: number, modality = 'corrida', sessionType: string | null = 'continuo') => ({ id, weekday, modality, sessionType, durationMin: 40, distanceKm: 5, paceMinSec: '8:00', structure: { type: 'run' } });

  it('resumo da sessao so com o que foi gravado; changeFromPrevious aponta o mesmo dia/modalidade da semana anterior', () => {
    expect(describeSessionForTrace(session('x', 2))).toBe('ter | corrida | continuo | 40min | 5km | pace 8:00/km');
    expect(describeSessionForTrace({ ...session('x', 2), paceMinSec: '8:00/km' })).toBe('ter | corrida | continuo | 40min | 5km | pace 8:00/km'); // formato real gravado pelas prescricoes
    const decisions = buildSessionDecisions({
      sessions: [session('n1', 2), session('n2', 4)],
      previousWeek: { startDate: new Date('2026-10-05'), sessions: [session('p1', 2), session('p2', 3)] },
    });
    expect(decisions[0]).toMatchObject({ kind: 'session', sessionId: 'n1', changeFromPrevious: { previousWeekStart: '2026-10-05', previousSessionId: 'p1' } });
    expect(decisions[1].changeFromPrevious).toBeNull(); // nao havia quinta na semana anterior
  });

  it('decisao da semana guarda a justificativa em texto livre como DECLARADA pela IA (nao e prova de influencia)', () => {
    const week = buildWeekDecision({ weekStart: new Date('2026-10-12'), sessionCount: 3, recommendation: 'rec', rationale: ['a', 'b'], safetyAdjustment: false });
    expect(week).toMatchObject({ kind: 'week', sessionId: null, summary: 'Semana de 2026-10-12: 3 sessao(oes) prescrita(s)', rationale: { rationale: ['a', 'b'] } });
  });
});

describe('exclusao explicita de dados de um provedor (e nunca a desconexao)', () => {
  const item = (ref: string, provider: string | null): EvidenceItem => ({ ref, kind: 'activity', source: 'ActivityLog', sourceId: `id-${ref}`, provider, asOf: '2026-10-01', label: ref, delivery: 'delivered', storage: 'complete', excerpt: 'valor' });

  it('redige so os itens do provedor pedido: remove valor e referencia, mantem o item como marcador', () => {
    const { evidence, redacted } = redactEvidenceForProvider([item('a', 'polar'), item('b', 'wahoo'), item('c', null), item('d', 'polar')], 'polar');
    expect(redacted).toBe(2);
    expect(evidence.filter((e) => e.redacted).map((e) => [e.ref, e.excerpt, e.sourceId])).toEqual([['redacted:polar', null, null], ['redacted:polar', null, null]]);
    expect(evidence.find((e) => e.ref === 'b')).toMatchObject({ excerpt: 'valor', provider: 'wahoo' });
    expect(evidence).toHaveLength(4);
    // idempotente
    expect(redactEvidenceForProvider(evidence, 'polar').redacted).toBe(0);
    expect(redactEvidenceForProvider(null, 'polar')).toEqual({ evidence: [], redacted: 0 });
  });
});

describe('retencao configuravel', () => {
  it('padrao 12 meses; numero positivo; off/0/invalido desligam', () => {
    expect(parseRetentionMonths(undefined)).toBe(12);
    expect(parseRetentionMonths('')).toBe(12);
    expect(parseRetentionMonths('6')).toBe(6);
    expect(parseRetentionMonths('18.9')).toBe(18);
    for (const off of ['off', 'OFF', 'never', '0', '-3', 'abc']) expect(parseRetentionMonths(off)).toBeNull();
  });
  it('corte = N meses antes', () => {
    expect(retentionCutoff(new Date('2026-10-09T00:00:00Z'), 12).toISOString()).toBe('2025-10-09T00:00:00.000Z');
    expect(createHash('sha256').update('x').digest('hex')).toBe(sha256('x'));
  });
});
