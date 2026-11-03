import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_INCLUDES_READING_GUIDE, AI_RECENT_DAYS, HR_DECOUPLING_MIN_PRIOR_RUNS, buildAcuteChronicContext, buildHrDecouplingContext,
} from '../src/training-intelligence/ai-recent-trend-context';
import { HR_DECOUPLING_MIN_PRIOR } from '../../mobile/home/hrDecouplingInfo';
import { limitCompactAgentContext, type CompactAgentContext } from '../src/training-intelligence/compact-agent-context';
import type { AcuteChronic } from '../src/training-intelligence/acute-chronic';
import type { ReferencePoint } from '../src/training-intelligence/reference-series';
import { RECENT_TREND_INSTRUCTION } from '../src/training-plans/prescription-agent.service';
import { READING_GUIDE } from '../src/training-intelligence/variable-reading-guide';

// 03/11/2026 (Lote 3) — o que a IA recebe sobre "o que vem acontecendo recentemente": desacoplamento da FC por faixa (corridas dos ultimos 7 dias) e aguda x cronica 7x28.
const NOW = new Date('2026-11-03T15:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const point = (days: number, value: number, over: Partial<ReferencePoint> = {}): ReferencePoint => ({
  timestamp: daysAgo(days),
  value,
  priorN: 12,
  historicalMean: { value: 3, n: 12 },
  movingAverages: { mm7: { value: 3, n: 7, isPartialWindow: false }, mm21: { value: 3, n: 12, isPartialWindow: true }, mm60: { value: 3, n: 12, isPartialWindow: true }, mm200: { value: 3, n: 12, isPartialWindow: true } },
  band: { lower: 1, upper: 5, median: 3, n: 12, basis: 'individual', isPartialWindow: true },
  signal: 'within',
  outsideBy: null,
  ...over,
});

const ac = (over: Partial<AcuteChronic> = {}): AcuteChronic => ({
  version: 1, unit: 'registros', windowKind: 'observation_count',
  acute: { value: 7, n: 7, size: 7, windowStart: null, windowEnd: null, complete: true },
  chronic: { value: 5, n: 28, size: 28, windowStart: null, windowEnd: null, complete: true },
  difference: 2, relativeDifferencePct: 40, direction: 'acute_above', acuteVsHabitualRange: 'above',
  reading: { text: 'leitura cadastrada de teste', status: 'rascunho_a_revisar' }, note: 'x', ...over,
});

describe('desacoplamentoFC para a IA', () => {
  it('so entram corridas dos ultimos 7 dias, por faixa; faixa sem corrida na semana nao aparece', () => {
    const block = buildHrDecouplingContext([
      { category: 'd30', reference: { points: [point(20, 9), point(2, 2.1)] }, acuteChronic: { direction: 'insufficient' } },
      { category: 'd60', reference: { points: [point(30, 4)] }, acuteChronic: { direction: 'insufficient' } },
      { category: 'd90', reference: { points: [] }, acuteChronic: null },
    ], NOW);
    expect(AI_RECENT_DAYS).toBe(7);
    expect(block?.faixas).toHaveLength(1);
    const band = block!.faixas[0] as { faixaDeDuracao: string; corridasNaSemana: Array<Record<string, unknown>>; resumo: string };
    expect(band.faixaDeDuracao).toBe('30 a 60 min');
    expect(band.corridasNaSemana).toHaveLength(1);
    expect(band.corridasNaSemana[0]).toMatchObject({ data: daysAgo(2).slice(0, 10), desacoplamentoPct: 2.1, corridasAnterioresNaFaixa: 12, posicaoNaFaixaHabitual: 'dentro_da_faixa_habitual', mediaHistoricaAnteriorPct: 3 });
    expect(band.resumo).toContain('1 corrida na semana');
    expect(band.resumo).toContain('2,1% (dentro do habitual)');
  });

  it('nenhuma corrida elegivel na semana: sem bloco (nunca bloco vazio nem zero)', () => {
    expect(buildHrDecouplingContext([{ category: 'd30', reference: { points: [point(10, 2)] }, acuteChronic: null }], NOW)).toBeNull();
    expect(buildHrDecouplingContext([], NOW)).toBeNull();
    expect(buildHrDecouplingContext([{ category: 'd30', reference: null, acuteChronic: null }], NOW)).toBeNull();
  });

  it('corrida no futuro (relogio adiantado) nao entra', () => {
    expect(buildHrDecouplingContext([{ category: 'd30', reference: { points: [point(-1, 2)] }, acuteChronic: null }], NOW)).toBeNull();
  });

  it('menos de 5 corridas anteriores na faixa: a comparacao NAO existe (nem faixa, nem posicao)', () => {
    expect(HR_DECOUPLING_MIN_PRIOR_RUNS).toBe(5);
    expect(HR_DECOUPLING_MIN_PRIOR_RUNS).toBe(HR_DECOUPLING_MIN_PRIOR); // a mesma regra da tela da aluna
    const block = buildHrDecouplingContext([{ category: 'd60', reference: { points: [point(1, 8, { priorN: 4, signal: 'above' })] }, acuteChronic: null }], NOW);
    const band = block!.faixas[0] as { corridasNaSemana: Array<Record<string, unknown>>; resumo: string };
    expect(band.corridasNaSemana[0].posicaoNaFaixaHabitual).toBeUndefined();
    expect(band.corridasNaSemana[0].faixaHabitualPct).toBeUndefined();
    expect(String(band.corridasNaSemana[0].comparacao)).toContain('indisponivel');
    expect(band.resumo).toContain('sem base para comparar');
    expect(band.resumo).not.toContain('habitual)');
  });

  it('exatamente 5 anteriores ja compara; acima e abaixo da faixa sao descritos sem julgamento', () => {
    const above = buildHrDecouplingContext([{ category: 'd90', reference: { points: [point(3, 9, { priorN: 5, signal: 'above', outsideBy: 4 })] }, acuteChronic: null }], NOW);
    expect((above!.faixas[0] as { resumo: string }).resumo).toContain('9% (acima do habitual)');
    const below = buildHrDecouplingContext([{ category: 'd90', reference: { points: [point(3, -2, { priorN: 5, signal: 'below', outsideBy: -3 })] }, acuteChronic: null }], NOW);
    expect((below!.faixas[0] as { resumo: string }).resumo).toContain('-2% (abaixo do habitual)');
    const all = JSON.stringify([above!.faixas, below!.faixas]); // so os dados da semana; o aviso do metodo nega esses termos de proposito
    expect(all).not.toMatch(/piora|melhora|risco de|les[aã]o|desgaste|sistema nervoso|prontid/i);
  });

  it('tendencia da faixa vem da aguda x cronica do servidor (7 x 28 corridas); sem 28 corridas diz isso', () => {
    const withTrend = buildHrDecouplingContext([{ category: 'd30', reference: { points: [point(1, 3)] }, acuteChronic: { direction: 'acute_above' } }], NOW);
    expect((withTrend!.faixas[0] as { resumo: string }).resumo).toContain('acima da dos 28');
    const without = buildHrDecouplingContext([{ category: 'd30', reference: { points: [point(1, 3)] }, acuteChronic: { direction: 'insufficient' } }], NOW);
    expect((without!.faixas[0] as { resumo: string }).resumo).toContain('menos de 28 corridas');
  });

  it('o metodo diz que faixas nao se comparam entre si e que a posicao e descritiva', () => {
    const block = buildHrDecouplingContext([{ category: 'd30', reference: { points: [point(1, 3)] }, acuteChronic: null }], NOW)!;
    expect(block.aviso).toMatch(/nunca se comparam entre si/);
    expect(block.aviso).toMatch(/DESCRITIVA/);
  });
});

describe('agudaCronica7x28 para a IA', () => {
  it('lista so quem tem as duas janelas completas E mudou de lado; igual, insuficiente e sem dado nao ocupam espaco', () => {
    const block = buildAcuteChronicContext([
      { variableId: 'workout.perceivedEffort', acuteChronic: ac() },
      { variableId: 'workout.preSleepQuality', acuteChronic: ac({ direction: 'acute_below', acute: { value: 3, n: 7, size: 7, windowStart: null, windowEnd: null, complete: true }, difference: -2, relativeDifferencePct: -40 }) },
      { variableId: 'workout.preStressLevel', acuteChronic: ac({ direction: 'equal', difference: 0 }) },
      { variableId: 'workout.preMotivation', acuteChronic: ac({ direction: 'insufficient', difference: null, relativeDifferencePct: null }) },
      { variableId: 'checkin.weekDemandVsNormal', acuteChronic: undefined },
      { variableId: 'checkin.prescriptionLiking', acuteChronic: null },
    ]);
    expect(block?.indicadores.map((i) => i.id)).toEqual(['workout.perceivedEffort', 'workout.preSleepQuality']);
    expect(block?.indicadores[0]).toMatchObject({ aguda: 7, cronica: 5, diferencaPct: 40, direcao: 'aguda_acima_da_cronica', mediaAgudaVsFaixaHabitual: 'acima_da_faixa_habitual' });
    expect(block?.indicadores[1].direcao).toBe('aguda_abaixo_da_cronica');
    expect(block?.ausenciaDeLinha).toMatch(/nao e zero/);
  });

  it('nenhum indicador com mudanca: sem bloco', () => {
    expect(buildAcuteChronicContext([{ variableId: 'a', acuteChronic: ac({ direction: 'equal' }) }])).toBeNull();
    expect(buildAcuteChronicContext([])).toBeNull();
  });

  it('a hipotese cadastrada (rascunho) so acompanha o indicador cuja media aguda saiu da faixa habitual', () => {
    expect(AI_INCLUDES_READING_GUIDE).toBe(true);
    const block = buildAcuteChronicContext([
      { variableId: 'a', acuteChronic: ac({ acuteVsHabitualRange: 'above' }) },
      { variableId: 'b', acuteChronic: ac({ acuteVsHabitualRange: 'within' }) },
      { variableId: 'c', acuteChronic: ac({ acuteVsHabitualRange: 'no_reference' }) },
      { variableId: 'd', acuteChronic: ac({ acuteVsHabitualRange: 'below', reading: null }) },
    ])!;
    const byId = Object.fromEntries(block.indicadores.map((i) => [i.id, i]));
    expect(byId.a.hipoteseCadastrada).toBe('leitura cadastrada de teste');
    expect(byId.b.hipoteseCadastrada).toBeUndefined();
    expect(byId.c.hipoteseCadastrada).toBeUndefined();
    expect(byId.d.hipoteseCadastrada).toBeUndefined();
    expect(block.comoLer).toMatch(/MUDANCA DE TENDENCIA/);
    expect(block.comoLer).toMatch(/nao e melhora nem piora/);
    expect(block.comoLer).toMatch(/hipotese/);
  });

  it('quase nada de texto fixo por indicador: cada linha sem hipotese tem menos de 260 caracteres', () => {
    const block = buildAcuteChronicContext([{ variableId: 'workout.perceivedEffort', acuteChronic: ac({ acuteVsHabitualRange: 'within' }) }])!;
    expect(JSON.stringify(block.indicadores[0]).length).toBeLessThan(260);
  });

  it('o cadastro de leitura continua valendo para a IA: cada texto cadastrado tem tamanho que cabe no contexto', () => {
    const longest = Math.max(...Object.values(READING_GUIDE).flatMap((entry) => [entry.above.length, entry.below.length]));
    expect(longest).toBeLessThanOrEqual(330);
  });
});

describe('contexto compacto e teto de tamanho', () => {
  const baseContext = (extra: Partial<CompactAgentContext> = {}): CompactAgentContext => ({
    athleteId: 's1', generatedAt: NOW.toISOString(), variableLegend: {}, variables: { 'wearable.hrvLastNightAvg': { evidence: { n: 1, observedSpan: { from: null, to: null }, lastObservationAt: null, instrumentVersions: [], comparabilityWarning: null, isPartialWindow: false } } },
    training: { availability: 'available', dataAvailableSince: null, totalWeeksWithPlan: 1, adherence: null, consistency: null },
    trainingLoad: { availability: 'available', variableIds: [] }, sleepRecovery: { availability: 'available', variableIds: [] }, physicalState: { availability: 'available', variableIds: [] },
    psychologicalState: { availability: 'available', variableIds: [] }, trainingResponse: { availability: 'available', variableIds: [] },
    painHealth: {} as never, performanceCapacity: {} as never, behavior: { availability: 'available', variableIds: [] } as never, lifeContext: {} as never, systemDynamics: {} as never,
    evidenceQuality: { variablesWithData: 1, variablesWithoutData: 0, mostRecentObservationAt: null, variablesWithComparabilityWarning: [] },
    ...extra,
  });
  const decoupling = buildHrDecouplingContext([{ category: 'd30', reference: { points: [point(1, 3)] }, acuteChronic: null }], NOW)!;
  const trend = buildAcuteChronicContext([{ variableId: 'wearable.hrvLastNightAvg', acuteChronic: ac() }, { variableId: 'workout.perceivedEffort', acuteChronic: ac() }])!;

  it('dentro do teto: os dois blocos seguem inteiros', () => {
    const limited = limitCompactAgentContext(baseContext({ desacoplamentoFC: decoupling, agudaCronica7x28: trend }), 1_000_000);
    expect(limited.integrationDataOmitted).toBe(false);
    expect(limited.context.desacoplamentoFC).toBeDefined();
    expect(limited.context.agudaCronica7x28?.indicadores).toHaveLength(2);
  });

  it('estourou o teto: o desacoplamento (serie do relogio) e os indicadores de relogio saem; os do proprio aluno ficam', () => {
    const limited = limitCompactAgentContext(baseContext({ desacoplamentoFC: decoupling, agudaCronica7x28: trend }), 100);
    expect(limited.integrationDataOmitted).toBe(true);
    expect(limited.context.desacoplamentoFC).toBeUndefined();
    expect(limited.context.agudaCronica7x28?.indicadores.map((i) => i.id)).toEqual(['workout.perceivedEffort']);
  });

  it('estourou o teto so com indicadores de relogio na aguda x cronica: o bloco inteiro sai (nunca lista vazia)', () => {
    const onlyWatch = buildAcuteChronicContext([{ variableId: 'wearable.hrvLastNightAvg', acuteChronic: ac() }])!;
    const limited = limitCompactAgentContext(baseContext({ agudaCronica7x28: onlyWatch }), 100);
    expect(limited.context.agudaCronica7x28).toBeUndefined();
  });
});

describe('regra no prompt da IA', () => {
  it('ensina a leitura sem criar regra automatica, sem culpar o desacoplamento e sem usar termos proibidos', () => {
    const text = RECENT_TREND_INSTRUCTION;
    expect(text).toMatch(/NAO calcula/);
    expect(text).toMatch(/menos de 5 corridas anteriores/);
    expect(text).toMatch(/NAO significa, sozinho, piora de desempenho/);
    expect(text).toMatch(/MUDANCA DE TENDENCIA/);
    expect(text).toMatch(/HIPOTESE/);
    expect(text).toMatch(/nao crie regra automatica/i);
    expect(text).toMatch(/Faixas nunca se comparam entre si/);
    expect(text).not.toMatch(/\bmotor\b|plano de treino|desacoplamento aerobio/i);
  });

  it('esta nos prompts do prescritor e nos do agente de evolucao; a leitura chega pela reavaliacao', () => {
    const root = join(__dirname, '..', 'src');
    expect(readFileSync(join(root, 'training-plans', 'prescription-agent.service.ts'), 'utf8')).toContain('RECENT_TREND_INSTRUCTION,');
    const evolution = readFileSync(join(root, 'reassessment', 'evolution-agent.service.ts'), 'utf8');
    expect(evolution).toContain('"desacoplamentoFC" e "agudaCronica7x28"');
    const reassessment = readFileSync(join(root, 'reassessment', 'reassessment.service.ts'), 'utf8');
    expect(reassessment).toContain('desacoplamentoFC: snapshot?.hrDecoupling');
    expect(reassessment).toContain('agudaCronica7x28: snapshot?.acuteChronicContext');
  });

  it('o snapshot pede a aguda x cronica sem a serie de referencia pesada e monta o desacoplamento so com escopo de IA do chamador', () => {
    const snapshot = readFileSync(join(__dirname, '..', 'src', 'training-intelligence', 'athlete-state-snapshot.service.ts'), 'utf8');
    expect(snapshot).toContain('{ withAcuteChronic: true }');
    expect(snapshot).toContain('buildHrDecouplingContext(athleteId, now).catch(() => null)');
    const compact = readFileSync(join(__dirname, '..', 'src', 'training-intelligence', 'compact-agent-context.ts'), 'utf8');
    expect(compact).toContain('desacoplamentoFC: snapshot.hrDecoupling');
    expect(compact).toContain('agudaCronica7x28: snapshot.acuteChronicContext');
  });
});
