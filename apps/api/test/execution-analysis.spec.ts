import {
  analyzeRunExecution, analyzeStrengthExecution, buildIntervals, EXECUTION_THRESHOLDS, extractPrescribedBlocks, mergeTimeInBand, RunInputs, SeriesSample,
} from '../src/activity-execution/execution-analysis';
import { buildWeeklyExecutionIndicators, renderSessionReport, renderWeeklyReport } from '../src/activity-execution/execution-report';

// Etapa 2.1 — comportamentos ESPERADOS (definidos antes dos testes), com series sinteticas controladas de 1 amostra por segundo:
//  Cenarios (intervalado prescrito): A = alternancias presentes, ritmos fora da faixa | B = ritmo continuo no lugar do intervalado | C = parte das repeticoes
//   reconhecivel (estrutura mudou/interrompeu) | D = continuo com aceleracao final sustentada | E = compativel | F = dados insuficientes (indeterminado).
//  Percentuais = TEMPO observavel; buraco de GPS/pausa NAO e' classificado (so' reduz a cobertura); parado fora do denominador.
//  Corrida interrompida: nao inventa o que nao ocorreu (blocos sem dados => null). Somente resumo => sem percentuais. Sem relogio => so' o registro manual.
//  Musculacao: duracao +-5% (configuravel), nada de series/repeticoes inferidas. Nao realizada => sem analise de execucao. Prescricao por tempo => limitacao explicita.

type Leg = { km: number; pace: number };

// Gera a serie por segundo (distancia acumulada) para trechos {km, pace}. gaps: janelas [offsetIni, offsetFim) sem amostras (falha/pausa).
function series(legs: Leg[], options: { gaps?: Array<[number, number]>; hrOf?: (offset: number) => number | null; stopAt?: number; stepSec?: number } = {}): SeriesSample[] {
  const points: SeriesSample[] = [{ offsetSec: 0, distanceMeters: 0, heartRateBpm: 140, cadenceSpm: 170 }];
  let t = 0; let d = 0;
  const step = options.stepSec ?? 1;
  for (const leg of legs) {
    const speed = 1000 / leg.pace; // m/s
    const end = d + leg.km * 1000;
    while (d < end - 1e-6) {
      t += step; d = Math.min(end, d + speed * step);
      if (options.stopAt != null && t > options.stopAt) return points;
      if (options.gaps?.some(([a, b]) => t >= a && t < b)) continue;
      points.push({ offsetSec: t, distanceMeters: d, heartRateBpm: options.hrOf ? options.hrOf(t) : 150, cadenceSpm: 170 });
    }
  }
  return points;
}

const block = (label: string, km: number, range: string) => ({ label, distanceValue: km, distanceUnit: 'km', paceRange: range });
// 1 km aquecimento + 6 x (400 m forte 4:00-4:20 / 200 m leve 6:00-6:30) + 1 km desaquecimento = 5,6 km
const intervalStructure = {
  blocks: [
    block('Aquecimento', 1, '6:30/km a 7:00/km'),
    { label: 'Tiros', repeatCount: 6, steps: [block('Forte', 0.4, '4:00/km a 4:20/km'), block('Leve', 0.2, '6:00/km a 6:30/km')] },
    block('Desaquecimento', 1, '6:30/km a 7:00/km'),
  ],
};
const continuousStructure = { blocks: [block('Principal', 5, '5:30/km a 5:50/km')] };
const WARM: Leg = { km: 1, pace: 405 };
const COOL: Leg = { km: 1, pace: 405 };
const reps = (n: number, forte: number, leve: number): Leg[] => Array.from({ length: n }, () => [{ km: 0.4, pace: forte }, { km: 0.2, pace: leve }]).flat();

const base = (structure: unknown, points: SeriesSample[], extra: Partial<RunInputs> = {}): RunInputs => ({
  structure, prescribedDistanceKm: 5.6, prescribedDurationMin: 40, points,
  activity: { distanceMeters: points[points.length - 1]?.distanceMeters ?? null, durationSec: points[points.length - 1]?.offsetSec ?? null, avgHeartRateBpm: 150, cadenceAvg: 170 }, completion: null, ...extra,
});

describe('percentuais pelo tempo observavel (denominadores corretos)', () => {
  it('50 s dentro, 25 s mais rapido, 25 s mais lento (1 amostra/s) => 50% / 25% / 25% exatos', () => {
    // faixa 5:30-5:50 (330-350). Dentro: 340 s/km por ~50 s; rapido: 300 por ~25 s; lento: 400 por ~25 s.
    const legs: Leg[] = [{ km: 50 / 340, pace: 340 }, { km: 25 / 300, pace: 300 }, { km: 25 / 400, pace: 400 }];
    const analysis = analyzeRunExecution(base({ blocks: [block('Principal', 0.5, '5:30/km a 5:50/km')] }, series(legs), { prescribedDistanceKm: 0.5 }));
    const tib = analysis.blocks![0].timeInBand!;
    // a suavizacao de 15 s desloca a transicao em ate ~15 s: confere os totais e a ordem de grandeza, nao so a forma
    expect(tib.classifiedSec).toBeGreaterThan(95);
    expect(tib.inPct! + tib.fastPct! + tib.slowPct!).toBeGreaterThanOrEqual(99.9);
    expect(tib.inSec + tib.fastSec + tib.slowSec).toBeCloseTo(tib.classifiedSec, 0);
    expect(tib.inPct!).toBeGreaterThan(35); expect(tib.inPct!).toBeLessThan(60);
    expect(tib.fastPct!).toBeGreaterThan(10); expect(tib.slowPct!).toBeGreaterThan(10);
  });

  it('buraco de GPS NAO e classificado: reduz a cobertura e fica fora do denominador', () => {
    const points = series([{ km: 3, pace: 340 }], { gaps: [[300, 400]] }); // 100 s sem amostras
    const analysis = analyzeRunExecution(base({ blocks: [block('Principal', 3, '5:30/km a 5:50/km')] }, points, { prescribedDistanceKm: 3 }));
    expect(analysis.coverage!.unreliableSec).toBeGreaterThan(90);
    expect(analysis.coverage!.coveragePct!).toBeLessThan(95);
    const tib = analysis.blocks![0].timeInBand!;
    expect(tib.classifiedSec).toBeLessThan(analysis.coverage!.elapsedSec - 90); // o tempo do buraco nao entrou
    expect(tib.inPct).toBe(100); // todo o tempo CONFIAVEL esta dentro da faixa; o buraco nao vira "fora"
  });

  it('tempo parado (pausa com relogio ligado) fica fora do denominador e declarado', () => {
    const legs: Leg[] = [{ km: 1, pace: 340 }];
    const points = series(legs);
    const last = points[points.length - 1];
    for (let i = 1; i <= 60; i++) points.push({ offsetSec: last.offsetSec + i, distanceMeters: last.distanceMeters, heartRateBpm: 120, cadenceSpm: 0 });
    const analysis = analyzeRunExecution(base({ blocks: [block('Principal', 1, '5:30/km a 5:50/km')] }, points, { prescribedDistanceKm: 1 }));
    expect(analysis.coverage!.stoppedSec).toBeGreaterThanOrEqual(59);
    expect(analysis.blocks![0].timeInBand!.inPct).toBe(100);
  });

  it('amostras IRREGULARES (1 a 5 s) e pausa longa: continua valido e usa a duracao real dos intervalos', () => {
    const points: SeriesSample[] = [{ offsetSec: 0, distanceMeters: 0, heartRateBpm: 140, cadenceSpm: 170 }];
    let t = 0; let d = 0; let i = 0;
    while (d < 1000) { const dt = [1, 3, 5, 2][i++ % 4]; t += dt; d += dt * (1000 / 340); points.push({ offsetSec: t, distanceMeters: d, heartRateBpm: 150, cadenceSpm: 170 }); }
    const intervals = buildIntervals(points);
    expect(intervals.every((x) => x.validity === 'valid')).toBe(true);
    const analysis = analyzeRunExecution(base({ blocks: [block('Principal', 1, '5:30/km a 5:50/km')] }, points, { prescribedDistanceKm: 1 }));
    expect(analysis.blocks![0].timeInBand!.inPct).toBeGreaterThan(95);
  });

  it('soma de SEGUNDOS entre sessoes (nao media de percentuais): 100 s (50% dentro) + 300 s (100% dentro) => 87,5%', () => {
    const a = { classifiedSec: 100, inSec: 50, fastSec: 25, slowSec: 25, inPct: 50, fastPct: 25, slowPct: 25 };
    const b = { classifiedSec: 300, inSec: 300, fastSec: 0, slowSec: 0, inPct: 100, fastPct: 0, slowPct: 0 };
    expect(mergeTimeInBand([a, b])!.inPct).toBe(87.5);
    expect(mergeTimeInBand([null, undefined])).toBeNull();
  });
});

describe('cenarios de estrutura (intervalado prescrito)', () => {
  const run = (legs: Leg[], options = {}) => analyzeRunExecution(base(intervalStructure, series([WARM, ...legs, COOL], options)));

  it('E — execucao compativel: alternancias reconhecidas e ritmos dentro das faixas', () => {
    const a = run(reps(6, 250, 375));
    expect(a.structure).toMatchObject({ prescribed: 'intervalado', executed: 'intervalado', scenario: 'E' });
    expect(a.structure.evidence).toMatchObject({ repsPrescribed: 6, repsEvaluated: 6, repsRecognized: 6 });
    expect(a.intensity.status).toBe('dentro');
    expect(a.intensity.byRole.estimulo!.inPct!).toBeGreaterThanOrEqual(EXECUTION_THRESHOLDS.intensityOkPct);
  });

  it('A — intervalado com INTENSIDADE diferente: alternancias presentes, ritmos fora das faixas', () => {
    const a = run(reps(6, 300, 450)); // forte 5:00 (mais lento que 4:00-4:20), leve 7:30 (mais lento que 6:00-6:30)
    expect(a.structure).toMatchObject({ executed: 'intervalado', scenario: 'A' });
    expect(a.intensity.status).toBe('mais_lento');
    expect(a.intensity.byRole.estimulo!.slowPct!).toBeGreaterThan(50);
  });

  it('B — continuo no lugar do intervalado: ritmo estavel, sem alternancias', () => {
    const a = run(Array.from({ length: 6 }, () => [{ km: 0.6, pace: 330 }]).flat());
    expect(a.structure).toMatchObject({ executed: 'continuo', scenario: 'B' });
    expect(a.structure.evidence!.repsRecognized).toBeLessThanOrEqual(1);
  });

  it('C — parcialmente executado: 3 primeiras repeticoes boas, depois ritmo continuo', () => {
    const a = run([...reps(3, 250, 375), ...Array.from({ length: 3 }, () => [{ km: 0.6, pace: 330 }]).flat()]);
    expect(a.structure).toMatchObject({ executed: 'parcial', scenario: 'C' });
    expect(a.structure.evidence).toMatchObject({ repsRecognized: 3, recognizedFirstHalf: 3, recognizedSecondHalf: 0 });
  });

  it('D — continuo com aceleracao final sustentada, sem as alternancias previstas', () => {
    const legs: Leg[] = [{ km: 2.5, pace: 330 }, { km: 0.8, pace: 270 }];
    const a = analyzeRunExecution(base(intervalStructure, series([{ km: 1, pace: 405 }, ...legs, { km: 1.3, pace: 330 }].slice(0, 2).concat([{ km: 2.2, pace: 330 }, { km: 0.9, pace: 262 }]))));
    expect(a.structure).toMatchObject({ executed: 'continuo_com_aceleracao_final', scenario: 'D' });
    expect(a.structure.evidence!.finalAcceleration).toMatchObject({ detected: true });
  });

  it('F — dados insuficientes: so uma repeticao avaliavel => indeterminado (sem inventar conclusao)', () => {
    const a = analyzeRunExecution(base(intervalStructure, series([WARM, ...reps(6, 250, 375)], { stopAt: 560 }))); // treino interrompido logo no inicio
    expect(a.structure.scenario).toBe('F');
    expect(a.structure.executed).toBe('indeterminado');
    expect(a.structure.reason).toBe('repeticoes_avaliaveis_insuficientes');
    expect(a.totals.completionRatio!).toBeLessThan(0.5);
  });

  it('F — cobertura baixa (falha longa de GPS): nao classifica a estrutura nem o tempo perdido', () => {
    const a = run(reps(6, 250, 375), { gaps: [[60, 1200]] });
    expect(a.coverage!.coveragePct!).toBeLessThan(60);
    expect(a.structure).toMatchObject({ executed: 'indeterminado', scenario: 'F', reason: 'cobertura_insuficiente' });
    expect(a.intensity.status).toBe('indeterminado');
  });

  it('corrida INTERROMPIDA no fim: os blocos nao alcancados ficam sem dados (nao ha invencao) e a conclusao e parcial, nao B', () => {
    const a = run(reps(6, 250, 375), { stopAt: 1100 });
    expect(a.blocks!.slice(-3).every((b) => b.realizedKm == null || b.observedSec < 15 || b.realizedKm < b.prescribedKm)).toBe(true);
    expect(a.totals.completionRatio!).toBeLessThan(1);
    expect(['C', 'E', 'A']).toContain(a.structure.scenario);
  });

  it('uma oscilacao isolada de GPS (1 amostra com salto) nao muda a classificacao', () => {
    const clean = series([WARM, ...reps(6, 250, 375), COOL]);
    const noisy = clean.map((p, i) => (i === 700 ? { ...p, distanceMeters: (p.distanceMeters as number) + 40 } : p)); // salto de 40 m em uma amostra
    const b = analyzeRunExecution(base(intervalStructure, noisy));
    expect(b.structure.scenario).toBe('E');
  });
});

describe('prescricao continua, por tempo e niveis de dado', () => {
  it('continuo compativel: scenario E (nao ha alternancia prescrita); mais lento => intensidade mais_lento, sem cenario', () => {
    expect(analyzeRunExecution(base(continuousStructure, series([{ km: 5, pace: 340 }]), { prescribedDistanceKm: 5 })).structure).toMatchObject({ prescribed: 'continuo', executed: 'continuo', scenario: 'E' });
    const slow = analyzeRunExecution(base(continuousStructure, series([{ km: 5, pace: 420 }]), { prescribedDistanceKm: 5 }));
    expect(slow.intensity.status).toBe('mais_lento');
    expect(slow.structure.scenario).toBeNull();
  });

  it('prescricao POR TEMPO: apresenta a limitacao e nao inventa blocos nem percentuais por bloco', () => {
    const a = analyzeRunExecution(base({ blocks: [{ label: 'Principal', durationMin: 30, paceRange: '5:30/km a 5:50/km' }] }, series([{ km: 5, pace: 340 }]), { prescribedDistanceKm: null }));
    expect(a.blocks).toBeNull();
    expect(a.blocksLimitation).toBe('prescricao_sem_blocos_por_distancia');
    expect(a.structure).toMatchObject({ executed: 'indeterminado', reason: 'prescricao_sem_blocos_por_distancia' });
    expect(renderSessionReport(a).join(' ')).toMatch(/prescrição deste treino é por tempo/);
  });

  it('relogio com SO resumo: distancia/duracao/FC, sem percentuais nem classificacao', () => {
    const a = analyzeRunExecution({ ...base(intervalStructure, []), activity: { distanceMeters: 5400, durationSec: 2200, avgHeartRateBpm: 151, cadenceAvg: 168 } });
    expect(a.dataLevel).toBe('summary_only');
    expect(a.blocks).toBeNull();
    expect(a.intensity.status).toBe('indeterminado');
    expect(a.totals).toMatchObject({ realizedKm: 5.4, avgHeartRateBpm: 151 });
    const text = renderSessionReport(a).join(' ');
    expect(text).toMatch(/5,4 dos 5,6 km previstos/);
    expect(text).toMatch(/apenas o resumo/);
    expect(text).not.toMatch(/dentro da faixa/);
  });

  it('sem atividade do relogio, com feedback manual: usa so o registro e diz isso', () => {
    const a = analyzeRunExecution({ ...base(intervalStructure, []), activity: null, completion: { status: 'done', distanceKm: 5, durationMin: 38, avgHeartRate: null, perceivedEffort: 7 } });
    expect(a.dataLevel).toBe('manual_only');
    expect(renderSessionReport(a).join(' ')).toMatch(/registro manual/);
    expect(a.totals.perceivedEffort).toBe(7);
  });

  it('estrutura por blocos: papeis (estimulo/recuperacao) vem da prescricao, nao de rotulos', () => {
    const blocks = extractPrescribedBlocks(intervalStructure)!;
    expect(blocks.filter((b) => b.role === 'estimulo')).toHaveLength(6);
    expect(blocks.filter((b) => b.role === 'recuperacao')).toHaveLength(6);
    expect(blocks[0].role).toBe('continuo');
  });
});

describe('FC na faixa e relatorio da sessao', () => {
  it('FC media enquanto o aluno estava dentro da faixa (esforco comparavel) so existe com >= 60 s dentro dela', () => {
    const points = series([{ km: 3, pace: 340 }], { hrOf: (t) => 140 + Math.floor(t / 100) });
    const a = analyzeRunExecution(base({ blocks: [block('Principal', 3, '5:30/km a 5:50/km')] }, points, { prescribedDistanceKm: 3 }));
    expect(a.avgHeartRateInBandBpm).not.toBeNull();
    const short = analyzeRunExecution(base({ blocks: [block('Principal', 0.1, '5:30/km a 5:50/km')] }, series([{ km: 0.1, pace: 340 }]), { prescribedDistanceKm: 0.1 }));
    expect(short.avgHeartRateInBandBpm).toBeNull();
  });

  it('texto condicionado aos resultados (exemplo do pedido: contínuo no lugar de intervalado)', () => {
    const a = analyzeRunExecution(base(intervalStructure, series([WARM, ...Array.from({ length: 6 }, () => [{ km: 0.6, pace: 330 }]).flat(), COOL])));
    const text = renderSessionReport(a).join(' ');
    expect(text).toMatch(/Você percorreu 5,6 dos 5,6 km previstos/);
    expect(text).toMatch(/permaneceu \d+% do tempo dentro da faixa prescrita, \d+% mais lento e \d+% mais rápido/);
    expect(text).toMatch(/ritmo predominantemente contínuo, embora a prescrição previsse 6 alternâncias/);
    expect(text).not.toMatch(/porque|intenção|decidiu/i); // nao atribui intencao ao aluno
  });
});

describe('musculacao', () => {
  const s = (realized: number | null, tolerance?: number) => analyzeStrengthExecution({ prescribedDurationMin: 50, completion: { status: 'done', durationMin: realized, avgHeartRate: null, perceivedEffort: 6 }, activity: null, tolerance });
  it('duracao +-5% (configuravel): 47,5 e 52,5 proximas; 47 mais curta; 53 mais longa; 10% aceita 54', () => {
    expect(s(47.5).durationClass).toBe('proxima');
    expect(s(52.5).durationClass).toBe('proxima');
    expect(s(47).durationClass).toBe('mais_curta');
    expect(s(53).durationClass).toBe('mais_longa');
    expect(s(54, 0.1).durationClass).toBe('proxima');
  });

  it('usa so o que existe: FC/calorias do relogio quando ha atividade; nunca infere series, repeticoes ou exercicios', () => {
    const a = analyzeStrengthExecution({ prescribedDurationMin: 50, completion: { status: 'done', durationMin: 49, avgHeartRate: null, perceivedEffort: 5, details: { exerciseFeedback: [{}, {}, {}] } }, activity: { durationSec: 2900, avgHeartRateBpm: 112, caloriesKcal: 280 } });
    expect(a).toMatchObject({ dataLevel: 'device_and_manual', avgHeartRateBpm: 112, caloriesKcal: 280, exerciseFeedbackCount: 3 });
    expect(JSON.stringify(a)).not.toMatch(/series|repeti/i.test('') ? '' : /"(sets|reps|repetitions)"/);
    expect(a.limitations[0]).toMatch(/nao sao inferidos/);
    expect(renderSessionReport(a).join(' ')).toMatch(/gasto energético estimado pelo relógio de 280 kcal/);
  });

  it('sem duracao registrada: nao compara; sessao nao realizada: sem analise de execucao', () => {
    expect(s(null).durationClass).toBeNull();
    const weekly = buildWeeklyExecutionIndicators('2026-10-05', [{ sessionId: 'x', scheduledDate: '2026-10-06', modality: 'forca', kind: 'strength', analysis: { kind: 'not_done', version: 1, modality: 'forca', reason: 'marcada_como_nao_feita', prescribedKm: null, prescribedDurationMin: 50 }, activityLogId: null, provider: null }]);
    expect(weekly.overview).toMatchObject({ prescribed: 1, performed: 0, notPerformed: 1, noRecord: 0, frequencyPct: 0 });
    expect(weekly.strength).toMatchObject({ prescribed: 1, performed: 0 });
  });
});

describe('consolidacao semanal', () => {
  const sessionRun = (id: string, analysis: ReturnType<typeof analyzeRunExecution> | null, prescribedKm = 10, provider: string | null = 'polar') => ({
    sessionId: id, scheduledDate: '2026-10-06', modality: 'corrida', kind: 'run' as const,
    analysis: analysis ?? ({ kind: 'not_done', version: 1, modality: 'corrida', reason: 'sem_registro', prescribedKm, prescribedDurationMin: 60 } as const),
    activityLogId: analysis ? `a-${id}` : null, provider: analysis ? provider : null,
  });
  const strengthDone = (id: string, minutes: number, effort: number, kcal: number | null) => ({
    sessionId: id, scheduledDate: '2026-10-07', modality: 'forca', kind: 'strength' as const,
    analysis: analyzeStrengthExecution({ prescribedDurationMin: 50, completion: { status: 'done', durationMin: minutes, avgHeartRate: null, perceivedEffort: effort }, activity: kcal != null ? { durationSec: minutes * 60, avgHeartRateBpm: null, caloriesKcal: kcal } : null }),
    activityLogId: null, provider: null,
  });

  it('frequencia separada de fidelidade; km previsto inclui o treino sem registro; musculacao com duracoes e esforco; intensidade pela SOMA de tempo por papel', () => {
    const interval = analyzeRunExecution(base(intervalStructure, series([WARM, ...reps(6, 250, 375), COOL])));
    const slow = analyzeRunExecution(base(intervalStructure, series([WARM, ...reps(6, 300, 450), COOL])));
    const weekly = buildWeeklyExecutionIndicators('2026-10-05', [
      sessionRun('r1', interval), sessionRun('r2', slow), sessionRun('r3', null, 8),
      strengthDone('s1', 49, 2, 200), strengthDone('s2', 47, 8, null), strengthDone('s3', 55, 5, 250),
    ]);
    expect(weekly.overview).toMatchObject({ prescribed: 6, performed: 5, noRecord: 1, frequencyPct: 83 });
    expect(weekly.run).toMatchObject({ prescribed: 3, performed: 2, prescribedKmAll: 5.6 + 5.6 + 8 });
    expect(weekly.run!.fidelity).toMatchObject({ analyzable: 2, intensityWithin: 1, structureCompatible: 1 }); // 2 sessoes feitas, so 1 fiel
    expect(weekly.run!.structure.scenarios).toMatchObject({ E: 1, A: 1 });
    const stim = weekly.run!.intensityByRole.estimulo!;
    expect(stim.inSec + stim.fastSec + stim.slowSec).toBeCloseTo(stim.classifiedSec, 0);
    expect(stim.inPct!).toBeGreaterThan(30); expect(stim.inPct!).toBeLessThan(70); // meio dentro (sessao 1), meio lento (sessao 2)
    expect(weekly.strength).toMatchObject({ performed: 3, effortAvg: 5, effortMin: 2, effortMax: 8, caloriesTotalKcal: 450, caloriesN: 2 });
    expect(weekly.strength!.durationClasses).toMatchObject({ proxima: 1, mais_curta: 1, mais_longa: 1 });
    expect(weekly.sources.providers).toEqual(['polar']);
    const text = renderWeeklyReport(weekly).join(' ');
    expect(text).toMatch(/Você realizou 5 dos 6 treinos previstos/);
    expect(text).toMatch(/esforço percebido médio foi 5\/10, com registros de 2 e 8/);
    expect(text).toMatch(/Percorreu 11,2 dos 19,2 km previstos/);
  });

  it('semana com informacoes incompletas: declara o que faltou, sem inventar', () => {
    const summary = analyzeRunExecution({ ...base(intervalStructure, []), activity: { distanceMeters: 5000, durationSec: 2000, avgHeartRateBpm: null, cadenceAvg: null } });
    const weekly = buildWeeklyExecutionIndicators('2026-10-05', [sessionRun('r1', summary), sessionRun('r2', null)]);
    expect(weekly.run!.sessionsWithBands).toBe(0);
    expect(weekly.run!.intensityByRole).toEqual({});
    expect(weekly.completeness.notes.join(' ')).toMatch(/só com o resumo do relógio/);
    expect(weekly.completeness.notes.join(' ')).toMatch(/sem registro/);
    expect(renderWeeklyReport(weekly).join(' ')).not.toMatch(/dentro da faixa/);
  });

  it('semana sem treinos prescritos: mensagem neutra', () => {
    expect(renderWeeklyReport(buildWeeklyExecutionIndicators('2026-10-05', []))).toEqual(['Não havia treinos prescritos na semana anterior.']);
  });
});
