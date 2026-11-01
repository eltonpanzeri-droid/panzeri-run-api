import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReferenceSeries } from '../src/training-intelligence/reference-series';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import { buildInternalLoadContext, buildSessionReferences } from '../src/training-intelligence/internal-load-context';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { explorerCategoryOf, explorerInfoOf, TRAINING_SUBGROUPS, trainingSubgroupOf } from '../src/training-intelligence/explorer-catalog';
import { getVariableDefinition, VARIABLE_REGISTRY } from '../src/training-intelligence/variable-registry';
import { INTERNAL_LOAD_VARIABLE_ID, SESSION_DURATION_VARIABLE_ID } from '../src/training-intelligence/internal-load';
import { buildTrainingLoad, classifySessions, compareSessionToReference, loadModalityKey, windowAt, type LoadInputRow } from '../src/coach/training-load';
import { loadInputRows } from '../src/coach/training-load-rows';
import { runWithAiScope } from '../src/ai-governance/ai-scope';
import { INTERNAL_LOAD_INSTRUCTION } from '../src/training-plans/prescription-agent.service';

// 01/11/2026 — Carga interna percebida (PSE x minutos): calculo, referencias so' com sessoes ANTERIORES, separacao por modalidade, janelas de 7 e 28 dias, integridade dos dados e disponibilidade efetiva no contexto
// dos agentes de IA. Dados sinteticos. Os cenarios interpretativos (A a D) so' podem ser provados ate' onde e' deterministico: o contexto entrega PSE/duracao/carga separadas e as regras de leitura estao no prompt;
// a resposta da IA em si nao e' reproduzivel sem chamar o modelo (ver relatorio).

const math = new MathLayerService();
const dynamics = new LongitudinalDynamicsService(math);
const src = (...parts: string[]) => readFileSync(join(__dirname, '..', 'src', ...parts), 'utf8');

const row = (id: string, date: string, rpe: number | null, minutes: number | null, over: Partial<LoadInputRow> = {}): LoadInputRow => ({
  id, sessionId: `s-${id}`, date, dateSource: 'programada', modality: 'corrida', title: `Treino ${id}`, status: 'done', durationMin: minutes, perceivedEffort: rpe, isExtra: false, ...over,
});
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10); // n dias depois de 01/09/2026

function series(loads: number[], daily = true) {
  return loads.map((value, i) => ({ value, timestamp: new Date(`${day(daily ? i : Math.floor(i / 2))}T12:00:00.000Z`) }));
}
const def = { expectedFrequency: 'per_workout' as const };

describe('1. calculo: PSE x duracao, tres variaveis distintas', () => {
  it('carga = PSE x minutos (UA) e a PSE e a duracao continuam disponiveis separadas', () => {
    const { sessions } = classifySessions([row('a', '2026-10-01', 7, 45)]);
    expect(sessions[0]).toMatchObject({ rpe: 7, minutes: 45, load: 315 });
  });

  it('mesma carga, combinacoes diferentes: 60 min a PSE 5 e 30 min a PSE 10 dao 300 UA mas ficam distinguiveis', () => {
    const { sessions } = classifySessions([row('a', '2026-10-01', 5, 60), row('b', '2026-10-02', 10, 30)]);
    expect(sessions.map((s) => s.load)).toEqual([300, 300]);
    expect(sessions.map((s) => [s.rpe, s.minutes])).toEqual([[5, 60], [10, 30]]);
  });

  it('o registro tem TRES variaveis: PSE, duracao usada e carga (a carga nao substitui a PSE)', () => {
    expect(getVariableDefinition('workout.perceivedEffort')).toBeTruthy();
    expect(getVariableDefinition(INTERNAL_LOAD_VARIABLE_ID)).toMatchObject({ source: 'internal_load_session', expectedFrequency: 'per_workout', scale: { unit: 'UA' } });
    expect(getVariableDefinition(SESSION_DURATION_VARIABLE_ID)).toMatchObject({ source: 'internal_load_session', scale: { unit: 'min' } });
    expect(Object.keys(VARIABLE_REGISTRY)).toEqual(expect.arrayContaining(['workout.perceivedEffort', INTERNAL_LOAD_VARIABLE_ID, SESSION_DURATION_VARIABLE_ID]));
  });
});

describe('2 e 3. a sessao investigada fica fora das referencias; calculo cronologico e reproduzivel', () => {
  const loads = [100, 120, 90, 110, 130, 100, 115, 105, 95, 125, 110, 100, 108, 300];
  const ref = buildReferenceSeries(series(loads), def, math, dynamics);

  it('a media historica de cada ponto usa SO as observacoes anteriores (nunca ela mesma nem as futuras)', () => {
    ref.points.forEach((p, i) => {
      expect(p.priorN).toBe(i);
      if (i === 0) expect(p.historicalMean.value).toBeNull();
      else expect(p.historicalMean.value).toBeCloseTo(loads.slice(0, i).reduce((a, b) => a + b, 0) / i, 6);
    });
  });

  it('a ultima sessao (300 UA) NAO puxa a propria media nem a propria faixa: aparece como acima da faixa habitual', () => {
    const last = ref.points[ref.points.length - 1];
    expect(last.historicalMean.n).toBe(13);
    expect(last.historicalMean.value).toBeCloseTo(loads.slice(0, 13).reduce((a, b) => a + b, 0) / 13, 6);
    expect(last.band.upper).toBeLessThan(300);
    expect(last.signal).toBe('above');
    expect(last.band.basis).toBe('individual'); // 13 sessoes anteriores (>= 12)
  });

  it('nao usa dados futuros: acrescentar sessoes DEPOIS nao muda a referencia das anteriores', () => {
    const shorter = buildReferenceSeries(series(loads.slice(0, 10)), def, math, dynamics);
    const longer = buildReferenceSeries(series([...loads, 900, 800]), def, math, dynamics);
    shorter.points.forEach((p, i) => expect(longer.points[i]).toEqual(p));
  });

  it('a media movel das ultimas 7 sessoes anteriores e cronologica (janela por contagem de sessoes)', () => {
    const last = ref.points[ref.points.length - 1];
    const prior7 = loads.slice(6, 13); // as 7 imediatamente anteriores
    expect(last.movingAverages.mm7.value).toBeCloseTo(prior7.reduce((a, b) => a + b, 0) / 7, 6);
    expect(ref.unit).toBe('registros');
    expect(ref.windowKind).toBe('observation_count');
  });

  it('duas sessoes no MESMO instante compartilham a referencia (nenhuma entra na referencia da outra)', () => {
    const same = buildReferenceSeries([
      { value: 100, timestamp: new Date('2026-09-01T12:00:00Z') }, { value: 200, timestamp: new Date('2026-09-02T12:00:00Z') }, { value: 400, timestamp: new Date('2026-09-02T12:00:00Z') },
    ], def, math, dynamics);
    expect(same.points[1].historicalMean.value).toBe(100);
    expect(same.points[2].historicalMean.value).toBe(100); // a de 200 NAO entrou na referencia da de 400
  });

  it('amostra insuficiente: menos de 4 anteriores = SEM faixa (nunca "normal"); 4 a 11 = limitada; 12+ = individual', () => {
    const few = buildReferenceSeries(series([100, 110, 105]), def, math, dynamics);
    expect(few.points[2]).toMatchObject({ signal: 'no_reference' });
    expect(few.points[2].band.basis).toBe('none');
    const limited = buildReferenceSeries(series([100, 110, 105, 95, 102, 400]), def, math, dynamics);
    expect(limited.points[5].band.basis).toBe('limited');
    expect(ref.points[13].band.basis).toBe('individual');
  });

  it('compareSessionToReference expone diferencas absoluta e percentual para a media historica e para a movel de 7', () => {
    const { sessions } = classifySessions([row('z', day(13), 6, 50)]); // 300 UA
    const cmp = compareSessionToReference(sessions[0], ref.points[13], ref);
    expect(cmp.load).toBe(300);
    expect(cmp.vsHistoricalMean?.absolute).toBeCloseTo(300 - ref.points[13].historicalMean.value!, 1);
    expect(cmp.vsHistoricalMean?.percent).not.toBeNull();
    expect(cmp.vsMoving7?.absolute).toBeCloseTo(300 - ref.points[13].movingAverages.mm7.value!, 1);
    expect(cmp.sufficient).toBe(true);
    expect(cmp.signal).toBe('above');
  });
});

describe('4. separacao por modalidade', () => {
  it('chave de modalidade canonica: esteira e corrida sao reconhecidas; valor bruto de provedor vira a modalidade canonica', () => {
    expect(loadModalityKey('RUNNING')).toBe('corrida');
    expect(loadModalityKey('forca')).toBe('forca');
    expect(loadModalityKey(null)).toBe('outra');
  });

  it('as referencias por modalidade nao se misturam: corrida e musculacao tem series proprias', async () => {
    const rows = [
      row('r1', '2026-10-01', 5, 60), row('r2', '2026-10-03', 6, 50), row('r3', '2026-10-05', 5, 60), row('r4', '2026-10-07', 6, 55), row('r5', '2026-10-09', 7, 60),
      row('f1', '2026-10-02', 8, 40, { modality: 'forca' }), row('f2', '2026-10-06', 8, 45, { modality: 'forca' }),
    ];
    const { sessions } = classifySessions(rows);
    const calls: Array<{ variableId: string; modalities?: string[] }> = [];
    const ti = {
      getVariableSnapshot: jest.fn(async (_id: string, variableId: string, modalities?: string[]) => {
        calls.push({ variableId, modalities });
        const own = sessions.filter((s) => (modalities ?? []).includes(loadModalityKey(s.modality)));
        return { reference: buildReferenceSeries(own.map((s) => ({ value: s.load, timestamp: new Date(`${s.date}T12:00:00Z`) })), def, math, dynamics) };
      }),
    };
    const refs = await buildSessionReferences(ti as never, 's1', sessions);
    expect(calls.map((c) => c.modalities)).toEqual([['corrida'], ['forca']]);
    expect(refs?.corrida?.last?.priorN).toBe(4); // so' as outras 4 de corrida
    expect(refs?.forca?.last?.priorN).toBe(1); // so' a outra de forca
    expect(refs?.corrida?.last?.load).toBe(420);
    expect(refs?.forca?.last?.load).toBe(360);
  });
});

describe('5 a 7. carga aguda (7 dias), cronica (28 dias) e razao', () => {
  // 28 dias terminando em 2026-10-28: 14 treinos de 300 UA (um a cada 2 dias) + na ultima semana 3 treinos extra de 300 UA
  const base = Array.from({ length: 14 }, (_, i) => row(`b${i}`, addDays0('2026-10-01', i * 2), 5, 60)); // 300 UA cada, de 01/10 a 27/10
  function addDays0(date: string, n: number) { return new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10); }

  it('aguda = soma dos ultimos 7 dias; cronica = soma de 28 dias / 4; razao = aguda / cronica', () => {
    const { sessions, excluded } = classifySessions(base);
    const w = windowAt('2026-10-28', sessions, excluded);
    // ultimos 7 dias (22/10 a 28/10): treinos em 23, 25 e 27/10 = 3 x 300 = 900
    expect(w.acuteLoad).toBe(900);
    // 28 dias (01/10 a 28/10): 14 treinos = 4200 -> media semanal 1050
    expect(w.chronicLoad).toBe(4200);
    expect(w.chronicWeeklyAverage).toBe(1050);
    expect(w.ratio).toBeCloseTo(900 / 1050, 2);
    expect(w.sessionsInWindow).toBe(14);
  });

  it('a sessao mais recente ENTRA nas janelas (acumulada), embora fique fora da propria referencia (comparacao)', () => {
    const { sessions, excluded } = classifySessions([...base, row('nova', '2026-10-28', 10, 60)]); // + 600 UA hoje
    expect(windowAt('2026-10-28', sessions, excluded).acuteLoad).toBe(1500);
  });

  it('razao so existe com 28 dias de historico, pelo menos 10 treinos e denominador valido; senao null com a explicacao', () => {
    const { sessions, excluded } = classifySessions(base.slice(0, 6));
    const w = windowAt('2026-10-28', sessions, excluded);
    expect(w.ratio).toBeNull();
    expect(w.note).toBeTruthy();
    expect(windowAt('2026-10-03', ...Object.values(classifySessions(base.slice(0, 2))) as [never, never]).ratio).toBeNull(); // historico curto
    const zero = windowAt('2026-12-30', sessions, excluded); // sem carga nos ultimos 28 dias
    expect(zero.ratio).toBeNull();
  });

  it('janelas por modalidade e agregada (geral) vem da mesma conta', () => {
    const rows = [...base, ...base.map((r) => ({ ...r, id: `f${r.id}`, modality: 'forca' }))];
    const result = buildTrainingLoad(rows, { from: '2026-10-01', to: '2026-10-28' }, '2026-10-28');
    expect(result.views.corrida.current.acuteLoad).toBe(900);
    expect(result.views.forca.current.acuteLoad).toBe(900);
    expect(result.views.geral.current.acuteLoad).toBe(1800); // soma agregada, identificada como visao geral
  });
});

describe('8 e 9. correcoes recalculam; sem duplicidade; dados ausentes nunca viram zero', () => {
  it('corrigir PSE ou duracao muda a carga na proxima leitura (calculo puro sobre o registro, sem copia guardada)', () => {
    const before = classifySessions([row('a', '2026-10-01', 5, 60)]).sessions[0].load;
    const after = classifySessions([row('a', '2026-10-01', 8, 60)]).sessions[0].load;
    expect([before, after]).toEqual([300, 480]);
    expect(src('training-intelligence', 'observation-reader.service.ts')).not.toMatch(/internalLoad.*(create|upsert|update)\(/);
  });

  it('treino nao feito nao gera carga; sem PSE ou sem duracao fica de fora com motivo (nunca zero)', () => {
    const { sessions, excluded } = classifySessions([row('m', '2026-10-01', 7, 40, { status: 'missed' }), row('p', '2026-10-02', null, 40), row('d', '2026-10-03', 6, null)]);
    expect(sessions).toEqual([]);
    expect(excluded.map((e) => [e.id, e.reason])).toEqual([['p', 'sem_esforco'], ['d', 'sem_duracao']]);
  });

  function fakePrisma(completions: unknown[], links: unknown[], canonical: Record<string, unknown> = {}) {
    return {
      workoutCompletion: { findMany: jest.fn().mockResolvedValue(completions) },
      sessionExecutionLink: { findMany: jest.fn().mockResolvedValue(links) },
      activityLog: { findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) => args.where.id.in.map((id) => canonical[id]).filter(Boolean)) },
    };
  }
  const completion = (id: string, over: Record<string, unknown> = {}) => ({ id, sessionId: `s-${id}`, source: 'student', completedAt: new Date('2026-10-20T15:00:00Z'), status: 'done', durationMin: 40, perceivedEffort: 6, session: { scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'corrida', title: 'Rodagem', structure: {} }, ...over });
  const activity = (id: string, over: Record<string, unknown> = {}) => ({ id, provider: 'polar', startedAt: new Date('2026-10-20T13:00:00Z'), utcOffsetMinutes: -180, durationSec: 3300, physicalIdentityStatus: null, physicalEventId: null, physicalCanonicalActivityLogId: null, ...over });

  it('a mesma atividade nunca serve a dois treinos (sem duplicidade entre integracoes e treinos)', async () => {
    const act = activity('act1');
    const prisma = fakePrisma([completion('a'), completion('b', { sessionId: 's-b', session: { scheduledDate: new Date('2026-10-22T00:00:00Z'), modality: 'corrida', title: 'Outro', structure: {} } })], [
      { trainingSessionId: 's-a', origin: 'auto', activityLog: act }, { trainingSessionId: 's-b', origin: 'auto', activityLog: act },
    ]);
    const rows = await loadInputRows(prisma as never, 's1');
    const usingActivity = rows.filter((r) => r.activityDurationMin != null);
    expect(usingActivity).toHaveLength(1); // so' um treino fica com a atividade
  });

  it('atividade e feedback manual se complementam no MESMO treino: duracao real da atividade + PSE da aluna', async () => {
    const prisma = fakePrisma([completion('a', { durationMin: 40, perceivedEffort: 7 })], [{ trainingSessionId: 's-a', origin: 'auto', activityLog: activity('act1') }]);
    const { sessions } = classifySessions(await loadInputRows(prisma as never, 's1'));
    expect(sessions[0]).toMatchObject({ rpe: 7, minutes: 55, durationSource: 'atividade_importada', informedMinutes: 40, load: 385 });
  });

  it('sessao extra feita entra quando elegivel (treino extra da aluna)', async () => {
    const prisma = fakePrisma([completion('x', { session: { scheduledDate: new Date('2026-10-21T00:00:00Z'), modality: 'corrida', title: 'Extra', structure: { source: 'student', type: 'extra' } } })], []);
    const { sessions } = classifySessions(await loadInputRows(prisma as never, 's1'));
    expect(sessions[0]).toMatchObject({ isExtra: true, load: 240 });
  });

  it('ESCOPO DE IA: atividade de provedor sem consentimento e tratada como inexistente (duracao e data voltam as informadas pela aluna)', async () => {
    const prisma = fakePrisma([completion('a', { durationMin: 40 })], [{ trainingSessionId: 's-a', origin: 'auto', activityLog: activity('act1', { startedAt: new Date('2026-10-21T13:00:00Z') }) }]);
    const inScope = await runWithAiScope({ userId: 's1', destination: 'external_ai', blocked: ['polar'], blockedHealth: [], computedAt: 0 } as never, () => loadInputRows(prisma as never, 's1'));
    expect(inScope[0]).toMatchObject({ activityDurationMin: null, date: '2026-10-20', dateSource: 'programada' });
    const outside = await loadInputRows(prisma as never, 's1'); // painel do treinador: nada muda
    expect(outside[0]).toMatchObject({ activityDurationMin: 55, date: '2026-10-21', dateSource: 'atividade_vinculada' });
  });

  it('ESCOPO DE IA: sessao extra criada so por atividade de provedor bloqueado nem entra; Strava nunca entra', async () => {
    const deviceExtra = completion('e', { source: 'device_extra', sessionId: 's-e', session: { scheduledDate: new Date('2026-10-22T00:00:00Z'), modality: 'corrida', title: 'Do relogio', structure: { source: 'device', provider: 'polar' } } });
    const prisma = fakePrisma([deviceExtra], []);
    expect(await loadInputRows(prisma as never, 's1')).toHaveLength(1);
    const blocked = await runWithAiScope({ userId: 's1', destination: 'external_ai', blocked: ['polar'], blockedHealth: [], computedAt: 0 } as never, () => loadInputRows(prisma as never, 's1'));
    expect(blocked).toEqual([]);
    expect(src('coach', 'training-load-rows.ts')).toContain("COACH_HIDDEN_PROVIDERS = ['strava']");
  });
});

describe('observacoes do registro (Explorar e IA): uma por sessao elegivel, por modalidade, com os insumos originais', () => {
  it('o leitor emite carga e duracao usada com a modalidade e os insumos (PSE, minutos, origem) no context', async () => {
    const prisma = {
      workoutCompletion: { findMany: jest.fn().mockResolvedValue([
        { id: 'a', sessionId: 's-a', source: 'student', completedAt: new Date('2026-10-20T15:00:00Z'), status: 'done', durationMin: 40, perceivedEffort: 6, session: { scheduledDate: new Date('2026-10-20T00:00:00Z'), modality: 'corrida', title: 'x', structure: {} } },
        { id: 'b', sessionId: 's-b', source: 'student', completedAt: new Date('2026-10-21T15:00:00Z'), status: 'done', durationMin: 30, perceivedEffort: null, session: { scheduledDate: new Date('2026-10-21T00:00:00Z'), modality: 'forca', title: 'y', structure: {} } },
      ]) },
      sessionExecutionLink: { findMany: jest.fn().mockResolvedValue([]) },
      activityLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const reader = new ObservationReaderService(prisma as never, {} as never, math);
    const load = await reader.getObservations('s1', INTERNAL_LOAD_VARIABLE_ID);
    const duration = await reader.getObservations('s1', SESSION_DURATION_VARIABLE_ID);
    expect(load).toHaveLength(1); // a sessao sem PSE nao gera observacao (nao e estimada)
    expect(load[0]).toMatchObject({ value: 240, source: 'internal_load_session', context: { modality: 'corrida', rpe: 6, minutes: 40, durationSource: 'informada', workoutCompletionId: 'a' } });
    expect(duration[0].value).toBe(40);
  });
});

describe('13. disponibilidade no contexto dos agentes + 12. consistencia painel x IA', () => {
  const rows: LoadInputRow[] = Array.from({ length: 14 }, (_, i) => row(`c${i}`, new Date(new Date('2026-10-01T12:00:00Z').getTime() + i * 2 * 86_400_000).toISOString().slice(0, 10), 5 + (i % 3), 50 + i));
  const { sessions } = classifySessions(rows);
  const refs = buildReferenceSeries(sessions.map((s) => ({ value: s.load, timestamp: new Date(`${s.date}T12:00:00Z`) })), def, math, dynamics);
  const ctx = buildInternalLoadContext(rows, '2026-10-28', {
    corrida: { group: 'corrida', modalities: ['corrida'], eligibleSessions: sessions.length, unit: refs.unit, windows: refs.windows, bandPolicy: refs.bandPolicy, last: compareSessionToReference(sessions[sessions.length - 1], refs.points[refs.points.length - 1], refs), points: [] },
  });

  it('o bloco da IA traz PSE, duracao e carga SEPARADAS e a comparacao so com sessoes anteriores', () => {
    const corrida = (ctx!.porModalidade as Record<string, { ultimaSessao: Record<string, unknown> }>).corrida;
    const last = sessions[sessions.length - 1];
    expect(corrida.ultimaSessao).toMatchObject({ pse: last.rpe, duracaoMin: last.minutes, cargaUA: last.load, sessoesAnterioresDaModalidade: sessions.length - 1 });
    expect(corrida.ultimaSessao).toHaveProperty('faixaHabitualUA');
    expect(corrida.ultimaSessao).toHaveProperty('posicaoNaFaixa');
    expect(ctx!.metodo.comparacaoDaSessao).toMatch(/ANTERIORES/);
  });

  it('o painel e a IA mostram os MESMOS numeros (mesma funcao de calculo): aguda, cronica, razao e ultima sessao', () => {
    const panel = buildTrainingLoad(rows, { from: '2026-10-01', to: '2026-10-28' }, '2026-10-28');
    const corrida = (ctx!.porModalidade as Record<string, { cargaAcumulada: Record<string, unknown>; ultimaSessao: { cargaUA: number } }>).corrida;
    expect(corrida.cargaAcumulada).toMatchObject({ aguda7dUA: panel.views.corrida.current.acuteLoad, cronicaMediaSemanal28dUA: panel.views.corrida.current.chronicWeeklyAverage, razaoAgudaCronica: panel.views.corrida.current.ratio });
    expect(corrida.ultimaSessao.cargaUA).toBe(panel.sessions[panel.sessions.length - 1].load);
  });

  it('modalidades nao se misturam no contexto e o agregado vem identificado como soma', () => {
    const mixed = buildInternalLoadContext([...rows, row('f1', '2026-10-27', 8, 40, { modality: 'forca' })], '2026-10-28', null)!;
    expect(Object.keys(mixed.porModalidade)).toEqual(expect.arrayContaining(['corrida', 'musculacao_e_forca']));
    expect(mixed.agregadoGeral.aviso).toMatch(/nao substitui a leitura por modalidade/);
  });

  it('sem sessao elegivel ou excluida nao ha bloco; com so excluidas o bloco existe e mostra a qualidade dos dados (nunca zero)', () => {
    expect(buildInternalLoadContext([], '2026-10-28', null)).toBeNull();
    const onlyExcluded = buildInternalLoadContext([row('p', '2026-10-02', null, 40)], '2026-10-28', null)!;
    expect(onlyExcluded.qualidadeDosDados.treinosFeitosSemPseOuDuracaoNoPeriodo).toBe(1);
    expect(onlyExcluded.porModalidade).toEqual({});
  });

  it('sem comparacao disponivel a ultima sessao sai sem inventar referencia', () => {
    const noRef = buildInternalLoadContext(rows, '2026-10-28', null)!;
    const corrida = (noRef.porModalidade as Record<string, { ultimaSessao: Record<string, unknown> }>).corrida;
    expect(corrida.ultimaSessao.comparacao).toBe('indisponivel');
    expect(corrida.ultimaSessao).not.toHaveProperty('faixaHabitualUA');
  });

  it('nada no contexto vira score, nota, faixa de risco ou veredito', () => {
    const text = JSON.stringify(ctx).toLowerCase();
    for (const forbidden of ['risco', 'prontidao', 'readiness', 'score', 'perigo', 'sofrimento', 'experiencia_ruim']) expect(text).not.toContain(forbidden);
    expect(text).toMatch(/acima_da_faixa_habitual|dentro_da_faixa_habitual|abaixo_da_faixa_habitual|sem_referencia_suficiente/);
  });

  it('a variavel de carga entra no pool do Athlete State (com modalidade) e o bloco chega ao contexto compacto e ao Agente de Evolucao', () => {
    expect(src('training-intelligence', 'athlete-state-snapshot.service.ts')).toMatch(/INTERNAL_LOAD_VARIABLE_ID,\s*\n\s*\/\/ Etapa 2\.1/);
    expect(src('training-intelligence', 'compact-agent-context.ts')).toContain('cargaInternaPercebida: snapshot.internalLoad');
    expect(src('reassessment', 'reassessment.service.ts')).toContain('cargaInternaPercebida: snapshot?.internalLoad');
    expect(src('reassessment', 'evolution-agent.service.ts')).toContain('"cargaInternaPercebida" (quando presente)');
  });
});

describe('14. o prompt de prescricao usa a carga como UM componente, com as regras de interpretacao (cenarios A a D)', () => {
  const text = INTERNAL_LOAD_INSTRUCTION;
  it('descreve PSE, duracao e carga separadas, por modalidade, comparacao so com sessoes anteriores e faixa insuficiente != normal', () => {
    expect(text).toMatch(/SEPARADAS/);
    expect(text).toMatch(/POR MODALIDADE/);
    expect(text).toMatch(/SOMENTE com sessoes ANTERIORES/);
    expect(text).toMatch(/NAO ha faixa e NAO significa "normal"/);
    expect(text).toMatch(/training\.acwr e uma razao de VOLUME em km/);
  });
  it('regras duras: PSE/carga alta nao e emocao negativa nem recuperacao insuficiente nem risco comprovado; carga baixa nao e prontidao; nao ha regra automatica', () => {
    expect(text).toMatch(/NAO e experiencia emocional/);
    expect(text).toMatch(/NUNCA escreva "sofrimento excessivo"/);
    expect(text).toMatch(/Carga alta NAO significa recuperacao insuficiente/);
    expect(text).toMatch(/carga baixa NAO significa que a aluna esta pronta para mais treino/);
    expect(text).toMatch(/NAO e, sozinha, aumento comprovado do risco de lesao/);
    expect(text).toMatch(/NUNCA crie regra automatica/);
    expect(text).toMatch(/NAO existe faixa segura\/de risco codificada/);
  });
  it('combina com sono, recuperacao, dor, fadiga, FC, motivacao, satisfacao e superacao; nao exige todos os dados; admite evidencias divergentes', () => {
    for (const term of ['sono', 'recuperacao', 'dor e desconforto', 'fadiga relatada', 'frequencia cardiaca', 'motivacao', 'satisfacao', 'superacao']) expect(text).toContain(term);
    expect(text).toMatch(/Nao exija que todos os dados existam/);
    expect(text).toMatch(/evidencias CONVERGEM/);
    expect(text).toMatch(/diga a limitacao em vez de concluir/);
  });
  it('cenarios interpretativos A a D estao descritos: desafio bem vivido, moderada com fadiga, alta estavel e reduzida com recuperacao ruim', () => {
    expect(text).toMatch(/PSE\/carga muito alta com satisfacao elevada e relato de superacao = desafio bem vivido, nao alarme/);
    expect(text).toMatch(/carga moderada com fadiga, sono ruim e relato negativo = merece atencao mesmo sem carga alta/);
    expect(text).toMatch(/carga recente elevada com respostas fisiologicas e comportamentais estaveis = nao e motivo automatico para reduzir/);
    expect(text).toMatch(/carga recente reduzida com recuperacao subjetiva desfavoravel = nao e motivo automatico para aumentar/);
  });
  it('o bloco esta no prompt do treino da semana; o contexto das emocoes/satisfacao continua em variaveis proprias (nao se funde com a carga)', () => {
    expect(src('training-plans', 'prescription-agent.service.ts')).toContain('INTERNAL_LOAD_INSTRUCTION,');
    for (const id of ['workout.emotionalExperienceDuring', 'workout.satisfactionElaboracao', 'workout.mentalStateChangePrePost']) expect(getVariableDefinition(id)).toBeTruthy();
    expect(getVariableDefinition(INTERNAL_LOAD_VARIABLE_ID)?.notes).toMatch(/não mede risco, fadiga, prontidão nem experiência emocional/);
  });
});

describe('11. filtros, gráficos e organização do Explorar → Treinos', () => {
  it('a carga e a duracao estao em "Esforço percebido e carga interna"; o volume em "Volume e consistência"; cada indicador em UM so grupo', () => {
    expect(trainingSubgroupOf(getVariableDefinition(INTERNAL_LOAD_VARIABLE_ID)!)).toBe('esforco_carga');
    expect(trainingSubgroupOf(getVariableDefinition(SESSION_DURATION_VARIABLE_ID)!)).toBe('esforco_carga');
    expect(trainingSubgroupOf(getVariableDefinition('workout.perceivedEffort')!)).toBe('esforco_carga');
    expect(trainingSubgroupOf(getVariableDefinition('training.volumeCompletedTotalKm')!)).toBe('volume_consistencia');
    expect(trainingSubgroupOf(getVariableDefinition('activity.avgPaceSecondsKm')!)).toBe('intensidade_resposta');
    expect(trainingSubgroupOf(getVariableDefinition('activity.cadenceAvg')!)).toBe('mecanica_eficiencia');
    expect(trainingSubgroupOf(getVariableDefinition('workout.executionVsPrescribed')!)).toBe('execucao_experiencia');
  });
  it('todo indicador da categoria Treinos cai em um dos cinco grupos (nenhum fica sem grupo, nenhum e excluido); nas demais categorias nao ha grupo', () => {
    const ids = new Set(TRAINING_SUBGROUPS.map((g) => g.id));
    for (const definition of Object.values(VARIABLE_REGISTRY)) {
      const info = explorerInfoOf(definition);
      if (explorerCategoryOf(definition) === 'treinos') expect(ids.has(info.subgroup!)).toBe(true);
      else expect(info.subgroup).toBeNull();
    }
    expect(TRAINING_SUBGROUPS).toHaveLength(5);
  });
  it('o espelho de grupos do painel tem os mesmos ids e a mesma ordem do servidor', () => {
    const panel = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'ti', 'explorer-data.ts'), 'utf8');
    const ids = [...panel.matchAll(/\{ id: '(\w+)', label: '[^']+', hint:/g)].map((m) => m[1]);
    expect(ids).toEqual(TRAINING_SUBGROUPS.map((g) => g.id));
  });
});

describe('12. painel: uma so implementacao da metrica', () => {
  const admin = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'admin', 'app', ...parts), 'utf8');
  it('a antiga aba "Carga (própria)" foi consolidada em Evolução > Explorar; o painel nao recalcula PSE x minutos', () => {
    const page = admin('page.tsx');
    expect(page).not.toContain("setDetailTab('carga')");
    expect(page).toContain('<StudentTrainingLoad studentId={student.id}');
    const component = admin('student-training-load.tsx');
    expect(component).not.toMatch(/rpe\s*\*\s*minutes|s\.rpe\s*\*\s*s\.minutes/); // so' MOSTRA a conta, nao a faz
    expect(component).toContain('/training-load?from=');
  });
  it('as tres visoes (Sessoes, Carga acumulada, Semanas) existem e Sessoes e a principal', () => {
    const component = admin('student-training-load.tsx');
    expect(component).toContain("useState<Mode>('sessoes')");
    for (const label of ['Sessões', 'Carga acumulada', 'Semanas']) expect(component).toContain(label);
    expect(component).toContain('SessionsChart');
  });
});
