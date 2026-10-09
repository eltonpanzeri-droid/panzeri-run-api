import { analyzeRunExecution, RunInputs, SeriesSample } from '../src/activity-execution/execution-analysis';
import { buildWeeklyExecutionIndicators } from '../src/activity-execution/execution-report';
import {
  AnalysisRow, analyzeLongitudinal, analyzeSessionInContext, analyzeWeekInContext, FeedbackInput, stimulusClass, toPrescriberEvidence, VariableTrend,
} from '../src/training-plans/training-analyst';

// Etapa 2.2 — Analista de Treinos (deterministico). Comportamentos esperados, definidos antes dos testes:
//  - Reconhece o ESTIMULO que ocorreu (nao o prescrito) e o confronta com o historico; nao presume motivo (lacuna quando o aluno nao explicou).
//  - Formatos de treino sao comparados VARIAVEL A VARIAVEL (distancia por repeticao, quantidade, velocidade, volume rapido, recuperacao, regularidade, FC, RPE).
//  - Capacidade recente (21 d) x historica separadas; longo com trechos rapidos e' outra familia que o intervalado regular.
//  - Historico curto/ausente => lacuna, nunca conclusao. Fontes contraditorias => achado de contradicao com sustentacao baixa, nada descartado.
//  - Atividade sem prescricao correspondente e' analisada como tal. Nenhum texto manda prescrever nada.

type Leg = { km?: number; pace?: number; stopSec?: number };

function series(legs: Leg[]): SeriesSample[] {
  const points: SeriesSample[] = [{ offsetSec: 0, distanceMeters: 0, heartRateBpm: 140, cadenceSpm: 170 }];
  let t = 0; let d = 0;
  for (const leg of legs) {
    if (leg.stopSec) { for (let i = 0; i < leg.stopSec; i++) { t += 1; points.push({ offsetSec: t, distanceMeters: d, heartRateBpm: 150, cadenceSpm: 0 }); } continue; }
    const end = d + (leg.km as number) * 1000;
    while (d < end - 1e-6) { t += 1; d = Math.min(end, d + 1000 / (leg.pace as number)); points.push({ offsetSec: t, distanceMeters: d, heartRateBpm: 155, cadenceSpm: 172 }); }
  }
  return points;
}
const block = (label: string, km: number, range: string) => ({ label, distanceValue: km, distanceUnit: 'km', paceRange: range });
const intervalStructure = { blocks: [block('Aquecimento', 1, '6:30/km a 7:00/km'), { label: 'Tiros', repeatCount: 6, steps: [block('Forte', 0.4, '4:00/km a 4:20/km'), block('Leve', 0.2, '6:00/km a 6:30/km')] }, block('Desaquecimento', 1, '6:30/km a 7:00/km')] };
const reps = (n: number, km: number, fast: number, easyKm: number, easy: number): Leg[] => Array.from({ length: n }, () => [{ km, pace: fast }, { km: easyKm, pace: easy }]).flat();

function run(points: SeriesSample[], structure: unknown, prescribedKm: number | null = 5.6): ReturnType<typeof analyzeRunExecution> {
  const last = points[points.length - 1];
  const inputs: RunInputs = { structure, prescribedDistanceKm: prescribedKm, prescribedDurationMin: 40, points, activity: { distanceMeters: last.distanceMeters, durationSec: last.offsetSec, avgHeartRateBpm: 155, cadenceAvg: 172 }, completion: null };
  return analyzeRunExecution(inputs);
}
let seq = 0;
const row = (date: string, analysis: ReturnType<typeof analyzeRunExecution>, extra: Partial<AnalysisRow> = {}): AnalysisRow => ({ sessionId: `s${++seq}`, scheduledDate: date, modality: 'corrida', isExtra: false, activityLogId: `a${seq}`, provider: 'polar', analysis, ...extra });
const days = (end: string, back: number) => new Date(Date.parse(end) - back * 86_400_000).toISOString().slice(0, 10);
const fb = (over: Partial<FeedbackInput> = {}): FeedbackInput => ({ perceivedEffort: null, painFlag: null, executionBehavior: null, adjustmentReasons: [], hasFreeText: false, status: 'done', ...over });

const intervalRun = () => run(series([{ km: 1, pace: 405 }, ...reps(6, 0.4, 250, 0.2, 375), { km: 1, pace: 405 }]), intervalStructure);
const continuousAccel = () => run(series([{ km: 1, pace: 405 }, { km: 3.4, pace: 330 }, { km: 1.1, pace: 262 }]), intervalStructure);
const fastIntervalRun = () => run(series([{ km: 1, pace: 405 }, ...reps(6, 0.4, 215, 0.2, 375), { km: 1, pace: 405 }]), intervalStructure);

describe('individual: estimulo executado x prescrito, historico e relatos', () => {
  it('intervalado prescrito e CONTINUO com aceleracao final executado: reconhece o estimulo real, confronta com o historico e NAO presume motivo', () => {
    const current = row('2026-10-10', continuousAccel());
    const history = [row('2026-09-20', intervalRun()), row('2026-09-30', continuousAccel())];
    const c = analyzeSessionInContext({ row: current, prescription: { structureKind: 'intervalado', intent: 'Sustentar esforcos de 400 m', expected: 'Concluir 6 repeticoes', traceStatus: 'complete' }, feedback: fb({ perceivedEffort: 6 }), history });
    const f = c.findings.find((x) => x.code === 'estrutura_executada_difere_da_prescrita')!;
    expect(f).toMatchObject({ source: 'technical', kind: 'divergencia', horizon: 'pontual' });
    expect(f.statement).toMatch(/previa 6 alternâncias/);
    expect(f.statement).toMatch(/contínuo com aceleração final/);
    expect(f.statement).toMatch(/ocorreu 1 vez\(es\) no histórico/);
    expect(f.statement).toMatch(/última sessão com esforços intervalados reconhecidos foi há 20 dias/);
    expect(c.gaps.map((g) => g.code)).toContain('motivo_da_diferenca_nao_informado'); // o relogio nao diz o motivo
    expect(JSON.stringify(c)).not.toMatch(/tentou|fracass|não conseguiu/i); // nao presume intencao nem falha
    expect(c.facts.map((x) => x.code)).toEqual(expect.arrayContaining(['intencao_prescrita', 'estimulo_executado']));
    expect(c.reported.map((x) => x.code)).toContain('esforco_percebido');
  });

  it('feedback que explica a alteracao entra como RELATADO (separado do medido) e substitui a lacuna', () => {
    const c = analyzeSessionInContext({ row: row('2026-10-10', continuousAccel()), prescription: null, feedback: fb({ executionBehavior: 'different_workout', adjustmentReasons: ['preferi fazer outro treino'], hasFreeText: true }), history: [] });
    expect(c.reported.map((x) => x.code)).toEqual(expect.arrayContaining(['comportamento_declarado', 'motivos_de_ajuste_declarados', 'texto_livre_registrado']));
    expect(c.findings.find((x) => x.code === 'diferenca_com_declaracao_do_aluno')).toMatchObject({ support: 'baixa' });
    expect(c.gaps.map((g) => g.code)).not.toContain('motivo_da_diferenca_nao_informado');
    expect(c.gaps.map((g) => g.code)).toContain('intencao_da_prescricao_indisponivel');
  });

  it('intensidade acima das faixas com recorrencia no historico comparavel (horizonte pontual -> recente -> consolidado)', () => {
    const history = [row('2026-09-01', fastIntervalRun()), row('2026-09-10', fastIntervalRun()), row('2026-09-20', fastIntervalRun()), row('2026-09-28', fastIntervalRun())];
    const c = analyzeSessionInContext({ row: row('2026-10-06', fastIntervalRun()), prescription: null, feedback: fb(), history });
    const f = c.findings.find((x) => x.code === 'intensidade_acima_da_faixa')!;
    expect(f).toMatchObject({ horizon: 'consolidado', support: 'media', data: { recurrence: 4, comparable60: 4 } });
    const alone = analyzeSessionInContext({ row: row('2026-10-06', fastIntervalRun()), prescription: null, feedback: fb(), history: [] });
    expect(alone.findings.find((x) => x.code === 'intensidade_acima_da_faixa')).toMatchObject({ horizon: 'pontual', support: 'baixa' });
    expect(alone.gaps.map((g) => g.code)).toContain('historico_insuficiente');
  });

  it('FC em ritmo comparavel: so compara com >=3 sessoes na mesma faixa e nunca afirma adaptacao', () => {
    const steady = (hr: number) => { const r = run(series([{ km: 6, pace: 340 }]).map((p) => ({ ...p, heartRateBpm: hr })), { blocks: [block('Principal', 6, '5:30/km a 5:50/km')] }, 6); return r; };
    const hist = [row('2026-09-01', steady(160)), row('2026-09-08', steady(161)), row('2026-09-15', steady(159)), row('2026-09-22', steady(160))];
    const c = analyzeSessionInContext({ row: row('2026-10-06', steady(150)), prescription: null, feedback: fb(), history: hist });
    const f = c.findings.find((x) => x.code === 'fc_em_ritmo_comparavel_mudou')!;
    expect(f.kind).toBe('melhora');
    expect(f.statement).toMatch(/não prova isolada de adaptação/);
    expect(f.support).toBe('baixa');
    const thin = analyzeSessionInContext({ row: row('2026-10-06', steady(150)), prescription: null, feedback: fb(), history: hist.slice(0, 2) });
    expect(thin.findings.find((x) => x.code === 'fc_em_ritmo_comparavel_mudou')).toBeUndefined();
    expect(thin.gaps.map((g) => g.code)).toContain('historico_comparavel_insuficiente_para_fc');
  });

  it('atividade SEM prescricao correspondente: analisada como iniciativa do aluno, com a assinatura do estimulo', () => {
    const extra = row('2026-10-09', run(series([{ km: 1, pace: 400 }, ...reps(5, 1, 240, 0.4, 400), { km: 1, pace: 400 }]), null, null), { isExtra: true });
    const c = analyzeSessionInContext({ row: extra, prescription: null, feedback: null, history: [] });
    expect(c.findings.find((x) => x.code === 'atividade_sem_prescricao')!.statement).toMatch(/por iniciativa do aluno.*intervalado/);
    expect(c.gaps.map((g) => g.code)).not.toContain('intencao_da_prescricao_indisponivel'); // extra nao tem prescricao: nao e lacuna
  });

  it('informacoes contraditorias sao sinalizadas (sustentacao baixa) sem descartar nenhuma fonte', () => {
    const c = analyzeSessionInContext({ row: row('2026-10-10', fastIntervalRun()), prescription: null, feedback: fb({ perceivedEffort: 2 }), history: [] });
    expect(c.findings.find((x) => x.code === 'informacoes_contraditorias')).toMatchObject({ kind: 'contradicao', support: 'baixa' });
    const missed = analyzeSessionInContext({ row: row('2026-10-10', intervalRun()), prescription: null, feedback: fb({ status: 'missed' }), history: [] });
    expect(missed.findings.map((x) => x.code)).toContain('informacoes_contraditorias');
  });

  it('dados ausentes: so resumo do relogio => lacuna explicita; sessao nao realizada => fato, sem analise', () => {
    const summary = row('2026-10-10', analyzeRunExecution({ structure: intervalStructure, prescribedDistanceKm: 5.6, prescribedDurationMin: 40, points: [], activity: { distanceMeters: 5000, durationSec: 2000, avgHeartRateBpm: 150, cadenceAvg: null }, completion: null }));
    expect(analyzeSessionInContext({ row: summary, prescription: null, feedback: null, history: [] }).gaps.map((g) => g.code)).toContain('sem_serie_temporal');
    const notDone = row('2026-10-10', { kind: 'not_done', version: 1, modality: 'corrida', reason: 'sem_registro', prescribedKm: 5, prescribedDurationMin: 40 } as never);
    expect(analyzeSessionInContext({ row: notDone, prescription: null, feedback: null, history: [] }).facts.map((x) => x.code)).toContain('sessao_nao_realizada');
  });
});

describe('estimulo executado: classificacao', () => {
  it('intervalado / contínuo / aceleração final vêm da série, não da prescrição', () => {
    expect(stimulusClass(intervalRun())).toBe('intervalado');
    expect(stimulusClass(continuousAccel())).toBe('continuo_com_aceleracao_final');
    expect(stimulusClass(run(series([{ km: 5, pace: 340 }]), null, null))).toBe('continuo');
  });
});

describe('longitudinal: capacidades demonstradas e mudancas variavel a variavel', () => {
  const asOf = '2026-10-12';
  // oito semanas de 1 km forte (~4:00) / 1 km leve (~5:30); numa sessao 10 repeticoes
  const oneKm = (n: number, fast = 240) => run(series([{ km: 1, pace: 360 }, ...reps(n, 1, fast, 0.5, 330), { km: 1, pace: 360 }]), null, null);

  it('reconhece o formato recorrente, a melhor marca recente x historica e separa o longo com trechos rapidos', () => {
    const rows: AnalysisRow[] = [];
    [56, 49, 42, 35, 28, 21, 14, 7].forEach((back, i) => rows.push(row(days(asOf, back), oneKm(i === 6 ? 10 : 6 + (i % 2), 242 - i))));
    const longo = run(series([{ km: 10, pace: 360 }, ...reps(3, 1, 270, 4, 360), { km: 8, pace: 360 }]), null, null); // ~30 km com trechos de 1 km a 4:30
    rows.push(row(days(asOf, 3), longo));
    const c = analyzeLongitudinal({ asOf, rows, trends: [] });
    const fmt = c.capabilities.filter((x) => x.kind === 'formato_recorrente');
    expect(fmt.length).toBeGreaterThanOrEqual(1);
    expect(fmt[0].statement).toMatch(/Formato recorrente \(~1 km · sessão regular\): 8 sessões/);
    const best = c.capabilities.filter((x) => x.kind === 'melhor_marca' && x.data.axis === 'quantidade_de_esforcos');
    expect(best.find((x) => x.id.includes('recente'))).toMatchObject({ data: { value: 10, reps: 10 } }); // 10 alternancias demonstradas na janela de 21 dias
    expect(c.capabilities.some((x) => x.family.includes('dentro de longo'))).toBe(false); // so 1 sessao longa: nao vira "formato recorrente"
    const families = new Set(c.capabilities.map((x) => x.family));
    expect([...families].every((f) => f.includes('~1 km · sessão regular'))).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/prescrever|na próxima semana/i); // o Analista nao decide a proxima prescricao
  });

  it('10 x 300 m com recuperacao passiva de 3 min: mudancas separadas por variavel (reps, velocidade, volume rapido, recuperacao)', () => {
    const base = (n: number, fast: number, restSec: number) => run(series([{ km: 2, pace: 360 }, ...Array.from({ length: n }, () => [{ km: 0.3, pace: fast }, { stopSec: restSec }]).flat(), { km: 2, pace: 360 }]), null, null);
    const first = row(days(asOf, 40), base(10, 180, 180));
    const second = row(days(asOf, 5), base(12, 172, 120));
    const sig1 = (first.analysis as { signature: { recovery: { mode: string }; boutCount: number } }).signature;
    expect(sig1.recovery.mode).toBe('passiva');
    expect(sig1.boutCount).toBe(10);
    const c = analyzeLongitudinal({ asOf, rows: [first, second], trends: [], rpeBySession: new Map([[first.sessionId, 6], [second.sessionId, 8]]) });
    const byVar = Object.fromEntries(c.changes.map((x) => [x.variable, x]));
    expect(byVar.quantidade_de_repeticoes).toMatchObject({ from: 10, to: 12 });
    expect(byVar.velocidade_mediana_dos_esforcos.deltaPct!).toBeLessThan(0); // pace menor = mais rapido
    // 300 m nominais: a delimitacao pela serie subestima em poucos % (suavizacao); o que importa e' a mudanca relativa entre as sessoes
    expect(byVar.volume_rapido_acumulado.from as number).toBeGreaterThan(2.5); expect(byVar.volume_rapido_acumulado.from as number).toBeLessThan(3.2);
    expect(byVar.volume_rapido_acumulado.to as number).toBeGreaterThan(3.0); expect(byVar.volume_rapido_acumulado.to as number).toBeLessThan(3.9);
    expect(byVar.volume_rapido_acumulado.deltaPct!).toBeGreaterThan(10);
    expect(byVar.duracao_da_recuperacao.deltaPct!).toBeLessThan(-15);
    expect(byVar.esforco_percebido).toMatchObject({ from: 6, to: 8 });
    expect(byVar.distancia_por_repeticao).toBeUndefined(); // 300 m nas duas: nao mudou, nao entra
    expect(Object.keys(byVar)).not.toContain('modo_da_recuperacao'); // passiva nas duas
  });

  it('intensidade recorrentemente acima das faixas em intervalados prescritos e intervalado executado como continuo (60 d)', () => {
    const fastRows = [50, 38, 26, 14, 4].map((b) => row(days(asOf, b), fastIntervalRun()));
    const c = analyzeLongitudinal({ asOf, rows: fastRows, trends: [], rpeBySession: new Map(fastRows.map((r, i) => [r.sessionId, 5 + Math.min(i, 3)])) });
    const f = c.findings.find((x) => x.code === 'intensidade_acima_da_faixa_recorrente')!;
    expect(f).toMatchObject({ kind: 'padrao', support: 'media', horizon: 'consolidado' });
    expect(f.statement).toMatch(/5 de 5 intervalados prescritos/);
    const mixed = analyzeLongitudinal({ asOf, rows: [row(days(asOf, 30), intervalRun()), row(days(asOf, 20), continuousAccel()), row(days(asOf, 10), continuousAccel())], trends: [] });
    expect(mixed.findings.find((x) => x.code === 'intervalado_executado_como_continuo')).toMatchObject({ support: 'baixa', data: { count: 2 } });
  });

  it('usa as janelas 21/60/200 ja calculadas: tendencia recente x consolidada x oscilacao pontual; historico curto vira lacuna', () => {
    const t = (over: Partial<VariableTrend>): VariableTrend => ({ variableId: 'execution.timeInBandPct', label: 'Tempo na faixa (%)', unit: '%', current: 50, ma21: 50, ma60: 70, ma200: 80, trendRecent: 'decreasing', trendMedium: 'decreasing', outsideHabitualRange: false, n: 20, ...over });
    const c = analyzeLongitudinal({ asOf, rows: [], trends: [t({}), t({ variableId: 'workout.perceivedEffort', label: 'Esforço percebido', ma21: 6, ma60: 6.1, ma200: 6, current: 9, outsideHabitualRange: true }), t({ variableId: 'execution.distanceCompletionRatio', label: 'Razão de distância', n: 3 })] });
    expect(c.findings.find((x) => x.id === 'trend:execution.timeInBandPct')).toMatchObject({ code: 'tendencia_recente', horizon: 'consolidado' });
    expect(c.findings.find((x) => x.id === 'trend:workout.perceivedEffort')).toMatchObject({ code: 'oscilacao_pontual', horizon: 'pontual' });
    expect(c.gaps.map((g) => g.id)).toContain('trend:execution.distanceCompletionRatio:thin');
    expect(c.gaps.map((g) => g.code)).toContain('sem_sessoes_com_esforcos_reconhecidos');
  });
});

describe('semana', () => {
  it('compara volume e esforcos com as semanas anteriores, registra atividades sem prescricao e so sinaliza co-ocorrencia (nunca causa)', () => {
    const interval = row('2026-10-06', intervalRun());
    const extra = row('2026-10-08', run(series([{ km: 8, pace: 340 }]), null, null), { isExtra: true });
    const indicators = buildWeeklyExecutionIndicators('2026-10-05', [{ sessionId: interval.sessionId, scheduledDate: '2026-10-06', modality: 'corrida', kind: 'run', analysis: interval.analysis, activityLogId: interval.activityLogId, provider: 'polar' }]);
    const c = analyzeWeekInContext({
      weekStart: '2026-10-05', indicators, rows: [interval, extra],
      previousWeeks: [{ weekStart: '2026-09-28', realizedKm: 10, fastVolumeKm: 1.2, frequencyPct: 100, rpeAvg: 4, hrInBand: 150 }, { weekStart: '2026-09-21', realizedKm: 11, fastVolumeKm: 1.2, frequencyPct: 100, rpeAvg: 4, hrInBand: 151 }, { weekStart: '2026-09-14', realizedKm: 9, fastVolumeKm: 1.1, frequencyPct: 100, rpeAvg: 4, hrInBand: 152 }],
      trends: [{ variableId: 'workout.preSleepQuality', label: 'Qualidade do sono', unit: '/5', current: 2, ma21: 3.5, ma60: 3.8, ma200: 3.9, trendRecent: 'decreasing', trendMedium: 'stable', outsideHabitualRange: true, n: 30 }],
      feedbackBySession: new Map([[interval.sessionId, fb({ perceivedEffort: 7 })]]),
    });
    expect(c.facts.map((f) => f.code)).toEqual(expect.arrayContaining(['frequencia_e_adesao', 'volume_de_corrida', 'distribuicao_nas_faixas', 'fidelidade_de_execucao', 'volume_rapido_da_semana']));
    expect(c.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['atividades_sem_prescricao', 'indicador_fora_da_faixa_habitual']));
    expect(c.findings.find((f) => f.code === 'volume_acima_das_semanas_anteriores')).toBeDefined();
    const co = c.findings.find((f) => f.code === 'co_ocorrencia_volume_e_esforco')!;
    expect(co.support).toBe('baixa');
    expect(co.statement).toMatch(/sem evidência de que uma coisa causou a outra/);
    expect(c.reported.map((f) => f.code)).toContain('esforco_percebido_da_semana');
  });

  it('semana com historico curto e sem dados: lacunas explicitas', () => {
    const empty = analyzeWeekInContext({ weekStart: '2026-10-05', indicators: null, rows: [], previousWeeks: [], trends: [], feedbackBySession: new Map() });
    expect(empty.gaps.map((g) => g.code)).toEqual(['semana_sem_dados']);
    const interval = row('2026-10-06', intervalRun());
    const thin = analyzeWeekInContext({ weekStart: '2026-10-05', indicators: null, rows: [interval], previousWeeks: [{ weekStart: '2026-09-28', realizedKm: 10, fastVolumeKm: null, frequencyPct: null, rpeAvg: null, hrInBand: null }], trends: [], feedbackBySession: new Map() });
    expect(thin.gaps.map((g) => g.code)).toContain('historico_insuficiente');
  });
});

describe('evidencias para o Prescritor', () => {
  it('seleciona poucos achados por sustentacao e horizonte, sem decidir nada; vazio => null', () => {
    const asOf = '2026-10-12';
    const fastRows = [50, 38, 26, 14, 4].map((b) => row(days(asOf, b), fastIntervalRun()));
    const longitudinal = analyzeLongitudinal({ asOf, rows: fastRows, trends: [] });
    const session = analyzeSessionInContext({ row: row('2026-10-10', continuousAccel()), prescription: null, feedback: fb(), history: [] });
    const evidence = toPrescriberEvidence({ week: null, longitudinal, sessions: [session] })!;
    const text = JSON.stringify(evidence);
    expect(text.length).toBeLessThan(6000);
    expect(JSON.stringify(evidence)).toMatch(/Nao sao prescricao nem prova de causa/);
    expect(text).not.toMatch(/prescrev|próxima semana|aumentar|reduzir/i);
    expect((evidence.evolucao as { achados: unknown[] }).achados.length).toBeLessThanOrEqual(5);
    expect(toPrescriberEvidence({ week: null, longitudinal: null, sessions: [] })).toBeNull();
  });
});
