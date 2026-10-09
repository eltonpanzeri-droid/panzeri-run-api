import { FeelingDomain, PatternLite, SnapshotLite, domainSentences } from '../../mobile/home/insights';

// Narrativa deterministica dos quatro dominios (04/10/2026): mesmas saidas do motor, texto corrido,
// priorizado e curto. Nada de LLM, nada de calculo novo — so' selecao e redacao.

type Dir = 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
type Verdict = 'above' | 'below' | 'within' | null;

interface Spec { current: number; pattern?: PatternLite; trend?: Dir; verdict?: Verdict; variability?: 'increased' | 'decreased' | 'unchanged' | 'insufficient_data'; n?: number }

function mk(id: string, spec: Spec): SnapshotLite {
  const isRpe = id === 'workout.perceivedEffort';
  const isHours = id === 'workout.sleepDurationHoursEstimate';
  const verdict = spec.verdict === undefined ? 'within' : spec.verdict;
  return {
    variable: { id, dataType: isHours ? 'numeric_continuous' : 'ordinal_scale', scale: isRpe ? { min: 1, max: 10 } : isHours ? { min: 0, max: 12, unit: 'horas' } : { min: 1, max: 5 } },
    mathApplicable: true,
    current: spec.current,
    movingAverages: null,
    trend: { short_21d: { direction: spec.trend ?? 'stable', n: spec.n ?? 10, ...(spec.pattern ? { pattern: spec.pattern } : {}) } },
    habitualRange: verdict === null ? { lower: null, upper: null, median: null, n: 0 } : { lower: 2, upper: 4, median: 3, n: spec.n ?? 10, isPartialWindow: true },
    persistence: verdict === null ? { currentlyOutsideHabitualRange: null, direction: null } : { currentlyOutsideHabitualRange: verdict !== 'within', direction: verdict === 'above' ? 'above' : verdict === 'below' ? 'below' : null },
    variabilityChange: { direction: spec.variability ?? 'unchanged' },
    observations: [],
    evidence: { n: spec.n ?? 10 },
  };
}

function narrate(domain: FeelingDomain, specs: Record<string, Spec>): string {
  const snaps: Record<string, SnapshotLite> = {};
  for (const [id, spec] of Object.entries(specs)) snaps[id] = mk(id, spec);
  const sentences = domainSentences(domain, snaps);
  expect(sentences.length).toBeLessThanOrEqual(4);
  return sentences.join(' ');
}

const examples: Array<[string, string]> = [];
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(examples.map(([name, text]) => `\n[${name}]\n${text}`).join('\n'));
});
function record(name: string, text: string) { examples.push([name, text]); return text; }

describe('domainSentences — narrativa dos dominios', () => {
  it('SONO: varias tendencias no mesmo bloco viram uma frase; estado atual; dentro da faixa', () => {
    const text = record('sono: multiplas tendencias + dentro do habitual', narrate('sleep', {
      'workout.preSleepQuality': { current: 2, trend: 'decreasing' },
      'workout.sleepDurationHoursEstimate': { current: 5.5, trend: 'decreasing' },
      'workout.sleepInterruption': { current: 3, trend: 'increasing' },
      'workout.sleepDifficulty': { current: 2, trend: 'stable' },
    }));
    expect(text).toContain('A qualidade e a duração do sono vêm diminuindo, enquanto as interrupções do sono vêm aumentando');
    expect(text).toContain('já a dificuldade para pegar no sono permanece estável');
    expect(text).toContain('Na última noite registrada, você dormiu cerca de 5h30 e avaliou a qualidade do sono em 2/5.');
    expect(text).toContain('Apesar dessas mudanças, os valores mais recentes continuam dentro do seu padrão habitual.');
    expect(text).not.toMatch(/piorou|preocupa|causa|por causa/i);
  });

  it('PRONTIDAO: convergencias agrupadas, sem enumerar cada saida do motor', () => {
    const text = record('prontidao: mudancas convergentes', narrate('readiness', {
      'workout.prePhysicalFatigue': { current: 3, trend: 'increasing' },
      'workout.preMentalFatigue': { current: 2, trend: 'decreasing' },
      'workout.preStressLevel': { current: 2, trend: 'decreasing' },
      'workout.preMotivation': { current: 3, trend: 'decreasing' },
    }));
    expect(text).toContain('o cansaço mental antes do treino, o estresse e a vontade de treinar vêm diminuindo');
    expect(text).not.toContain('faixa habitual (');
    expect(text.split('.').length - 1).toBeLessThanOrEqual(4);
  });

  it('fora da faixa habitual tem prioridade e abre o texto', () => {
    const text = record('fora da faixa', narrate('response', {
      'workout.postPhysicalFatigue': { current: 5, trend: 'increasing', verdict: 'above' },
      'workout.postMentalFatigue': { current: 3, trend: 'decreasing', verdict: 'within' },
      'workout.emotionalExperienceDuring': { current: 4, trend: 'stable', verdict: 'within' },
      'workout.mentalStateChangePrePost': { current: 3, trend: 'decreasing', verdict: 'within' },
    }));
    expect(text.startsWith('No último registro, o cansaço físico provocado pelos treinos ficou acima do seu padrão habitual (5/5); os demais valores recentes seguem dentro do padrão habitual.')).toBe(true);
    expect(text).not.toContain('Apesar dessas mudanças'); // o fecho "tudo dentro" nao se aplica
  });

  it('abaixo da faixa tambem e comunicado, sem julgamento', () => {
    const text = narrate('readiness', { 'workout.preMotivation': { current: 1, trend: 'decreasing', verdict: 'below' } });
    expect(text).toContain('a vontade de treinar ficou abaixo do seu padrão habitual');
    expect(text).not.toMatch(/preocupante|ruim|bom/);
  });

  it('tudo dentro do habitual e estavel: texto curto de estabilidade', () => {
    const text = record('estabilidade predominante', narrate('response', {
      'workout.postPhysicalFatigue': { current: 3, trend: 'stable' },
      'workout.postMentalFatigue': { current: 3, trend: 'stable' },
    }));
    expect(text).toContain('permanecem relativamente estáveis nas últimas semanas');
    expect(text).toContain('Os valores mais recentes estão dentro do seu padrão habitual.');
  });

  it('RPE: estavel com maior variacao vira uma frase com "mas"; ultimo registro na escala 1-10 dentro da faixa', () => {
    const text = record('rpe: estavel + mais variacao', narrate('effort', {
      'workout.perceivedEffort': { current: 5, trend: 'stable', variability: 'increased' },
    }));
    expect(text).toBe('O esforço percebido permanece relativamente estável nas últimas semanas, mas tem oscilado mais do que o habitual. Seu último registro foi 5/10, dentro da faixa que costuma aparecer nos seus treinos.');
  });

  it('aumento de variabilidade em bloco com mudancas vira frase propria', () => {
    const text = record('variabilidade aumentou', narrate('readiness', {
      'workout.prePhysicalFatigue': { current: 3, trend: 'increasing', variability: 'increased' },
      'workout.preMotivation': { current: 3, trend: 'stable' },
    }));
    expect(text).toContain('O cansaço físico antes do treino tem oscilado mais do que o habitual recentemente.');
  });

  it('evidencia insuficiente segundo o motor: nao interpreta, diz isso de forma natural', () => {
    const text = record('evidencia insuficiente', narrate('sleep', {
      'workout.preSleepQuality': { current: 3, trend: 'insufficient_data', verdict: null, n: 1 },
      'workout.sleepInterruption': { current: 2, trend: 'insufficient_data', verdict: null, n: 1 },
    }));
    expect(text).toBe('Ainda não existem registros suficientes para identificar uma tendência confiável sobre seu sono.');
  });

  it('variavel sem sustentacao do motor nao entra na narrativa (n e limites nao sao repetidos)', () => {
    const text = narrate('sleep', {
      'workout.preSleepQuality': { current: 3, trend: 'decreasing' },
      'workout.sleepDifficulty': { current: 2, trend: 'insufficient_data', verdict: null, n: 1 },
    });
    expect(text).toContain('A qualidade do sono vem diminuindo');
    expect(text).not.toContain('dificuldade');
    expect(text).not.toMatch(/\d+ registros|histórico ainda curto|2–4/);
  });

  it('sem nenhum registro nao produz texto', () => {
    expect(domainSentences('sleep', {})).toEqual([]);
    expect(domainSentences('sleep', { 'workout.preSleepQuality': { ...mk('workout.preSleepQuality', { current: 3 }), evidence: { n: 0 } } })).toEqual([]);
  });

  it('respeita o limite de 4 frases mesmo com todos os sinais ativos', () => {
    const text = narrate('sleep', {
      'workout.preSleepQuality': { current: 5, trend: 'increasing', verdict: 'above', variability: 'increased' },
      'workout.sleepDurationHoursEstimate': { current: 9, trend: 'increasing', verdict: 'above' },
      'workout.sleepInterruption': { current: 1, trend: 'decreasing', verdict: 'within', variability: 'decreased' },
      'workout.sleepDifficulty': { current: 2, trend: 'stable' },
    });
    expect(text.length).toBeGreaterThan(0);
  });

  it('escala original: nenhuma inversao ("aumentou" nao vira melhor/pior)', () => {
    const text = narrate('response', { 'workout.postPhysicalFatigue': { current: 4, trend: 'increasing' } });
    expect(text).toContain('vem aumentando');
    expect(text).not.toMatch(/melhor|pior|piora|melhora/);
  });
});

// Classificacao individual do motor (10/2026): o texto segue o TIPO de mudanca, nunca so' a inclinacao.
describe('domainSentences — padroes de mudanca do motor', () => {
  const FATIGUE = 'workout.prePhysicalFatigue';
  const pat = (kind: PatternLite['kind'], side: PatternLite['side'] = null, extra: Partial<PatternLite> = {}): PatternLite => ({ kind, side, windowDays: 9, ...extra });
  // direction ja vem corrigida pela API: so' 'sustained_change' vira increasing/decreasing
  const dir = (p: PatternLite): Dir => (p.kind === 'sustained_change' ? (p.side === 'below' ? 'decreasing' : 'increasing') : p.kind === 'insufficient_data' ? 'insufficient_data' : 'stable');
  const say = (p: PatternLite, verdict: Verdict = 'within') => narrate('readiness', { [FATIGUE]: { current: 3, pattern: p, trend: dir(p), verdict } });

  it('estabilidade: registros proximos do padrao habitual (sem "aumentando")', () => {
    const text = say(pat('stable'));
    expect(text).toContain('O cansaço físico antes do treino permanece relativamente estável');
    expect(text).not.toMatch(/aumentando|diminuindo|tendência de/);
  });

  it('oscilacao pontual: registros fora do padrao seguidos de retorno', () => {
    const text = say(pat('isolated_oscillation', 'above'));
    expect(text).toContain('O cansaço físico antes do treino teve registros fora do seu padrão habitual, seguidos de retorno aos valores anteriores.');
    expect(text).not.toMatch(/aumentando|persistente/);
  });

  it('mudanca recente: acima do padrao, mas cedo para afirmar tendencia sustentada', () => {
    const text = say(pat('recent_change', 'above'), 'above');
    expect(text).toContain('Nos registros mais recentes, o cansaço físico antes do treino ficou acima do seu padrão habitual, mas ainda é cedo para afirmar que existe uma tendência sustentada.');
  });

  it('tendencia sustentada: permaneceu acima do padrao anterior, mudanca persistente', () => {
    const text = say(pat('sustained_change', 'above'), 'above');
    expect(text).toContain('Ao longo das últimas semanas, o cansaço físico antes do treino permaneceu acima do padrão anterior, indicando uma mudança persistente');
    const down = narrate('readiness', { 'workout.preMotivation': { current: 2, pattern: pat('sustained_change', 'below'), trend: 'decreasing', verdict: 'below' } });
    expect(down).toContain('a vontade de treinar permaneceu abaixo do padrão anterior');
  });

  it('dados insuficientes: nao interpreta', () => {
    const text = say(pat('insufficient_data'), null);
    expect(text).toContain('Ainda não existem registros suficientes para identificar uma tendência confiável');
  });

  it('um unico registro fora do padrao (sem continuidade) nao vira tendencia nem oscilacao: aparece so no veredito da faixa', () => {
    const text = say(pat('isolated_oscillation', 'above', { ongoing: true }), 'above');
    expect(text).toContain('No último registro, o cansaço físico antes do treino ficou acima do seu padrão habitual');
    expect(text).not.toMatch(/seguidos de retorno|tendência/);
  });
});
