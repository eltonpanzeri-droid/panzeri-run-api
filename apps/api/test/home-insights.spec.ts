import {
  FEELING_DOMAINS,
  SnapshotLite,
  describeVariable,
  domainSentences,
  habitualBand,
  habitualRangeSentence,
  formatPaceSeconds,
  rangeChip,
  recentVsLastSentences,
  trendChip,
  trendSentence,
  volumeSentences,
} from '../../mobile/home/insights';
import { observationPoints } from '../../mobile/home/chartData';

// Interpretacao textual deterministica (04/10/2026): frases saem exclusivamente dos calculos que o
// motor longitudinal ja' entrega. Sem tendencia inventada, sem zero para ausencia, escala original.

function snap(overrides: Partial<SnapshotLite> = {}): SnapshotLite {
  return {
    variable: { id: 'workout.preSleepQuality', dataType: 'ordinal_scale', scale: { min: 1, max: 5 } },
    mathApplicable: true,
    current: 4,
    movingAverages: { short_21d: { value: 3.5, n: 6 } },
    trend: { short_21d: { direction: 'increasing', n: 6 }, medium_60d: { direction: 'stable', n: 12 } },
    habitualRange: { lower: 2, upper: 4, median: 3, n: 12, isPartialWindow: true },
    persistence: { currentlyOutsideHabitualRange: false, direction: null },
    variabilityChange: { direction: 'unchanged' },
    observations: [],
    evidence: { n: 12 },
    ...overrides,
  };
}
const D = { label: 'Qualidade do sono', fmt: (v: number) => String(v) };

describe('trendSentence / trendChip', () => {
  it('descreve a direcao calculada pelo motor, sem causalidade', () => {
    expect(trendSentence(snap(), D)).toBe('Qualidade do sono apresenta tendência de aumento nas últimas 3 semanas.');
    expect(trendChip(snap())).toBe('em aumento');
    expect(trendSentence(snap({ trend: { short_21d: { direction: 'decreasing', n: 5 } } }), D)).toContain('queda');
    expect(trendSentence(snap({ trend: { short_21d: { direction: 'stable', n: 5 } } }), D)).toContain('estável');
  });

  it('E: evidencia insuficiente nao inventa tendencia', () => {
    expect(trendSentence(snap({ trend: { short_21d: { direction: 'insufficient_data', n: 1 } } }), D)).toBeNull();
    expect(trendChip(snap({ trend: null }))).toBeNull();
    expect(trendSentence(snap({ mathApplicable: false }), D)).toBeNull();
  });

  it('cai para a janela de 60 dias quando a de 21 nao tem evidencia', () => {
    const s = snap({ trend: { short_21d: { direction: 'insufficient_data', n: 1 }, medium_60d: { direction: 'decreasing', n: 9 } } });
    expect(trendSentence(s, D)).toBe('Qualidade do sono apresenta tendência de queda nos últimos 2 meses.');
  });
});

describe('faixa habitual — veredito do motor (persistence), sem limite proprio de n', () => {
  const outside = (direction: 'above' | 'below') => ({ currentlyOutsideHabitualRange: true, direction });

  it('apresenta o veredito calculado pelo motor, sem julgar', () => {
    expect(rangeChip(snap({ current: 5, persistence: outside('above') }))).toBe('acima da faixa habitual');
    expect(rangeChip(snap({ current: 1, persistence: outside('below') }))).toBe('abaixo da faixa habitual');
    expect(rangeChip(snap({ current: 3 }))).toBe('na faixa habitual');
    expect(describeVariable(snap({ current: 5, persistence: outside('above') }), D).join(' ')).toContain('acima da sua faixa habitual (2–4, calculada com 12 registros, histórico ainda curto)');
  });

  it('a Home nao recompara current com os limites: o veredito vem so do motor', () => {
    // current=5 esta fora de 2-4, mas o motor disse "dentro" => a Home nao contradiz o motor.
    expect(rangeChip(snap({ current: 5, persistence: { currentlyOutsideHabitualRange: false, direction: null } }))).toBe('na faixa habitual');
  });

  it('E: motor sem faixa sustentada (persistence null) => sem frase de faixa; fala de insuficiencia', () => {
    const s = snap({ trend: null, persistence: { currentlyOutsideHabitualRange: null, direction: null }, habitualRange: { lower: null, upper: null, median: null, n: 0 }, evidence: { n: 1 } });
    expect(rangeChip(s)).toBeNull();
    expect(describeVariable(s, D)[0]).toContain('ainda não há evidência suficiente');
  });

  it('motor que sustenta a faixa com poucos registros: a Home mostra e informa o n (nao inventa um minimo)', () => {
    const s = snap({ habitualRange: { lower: 3, upper: 3, median: 3, n: 1, isPartialWindow: true }, evidence: { n: 1 }, trend: null });
    expect(habitualRangeSentence(s, D)).toContain('calculada com 1 registro, histórico ainda curto');
  });

  it('F: sem registros nao produz frase nenhuma (nunca zero)', () => {
    expect(describeVariable(snap({ evidence: { n: 0 }, current: null }), D)).toEqual([]);
    expect(describeVariable(null, D)).toEqual([]);
  });
});

describe('dominios — escalas e semantica originais', () => {
  it('G: RPE continua 1-10 e H: as demais 1-5, cada variavel no seu dominio (sem fusao)', () => {
    expect(FEELING_DOMAINS.effort.variables).toHaveLength(1);
    expect(FEELING_DOMAINS.effort.subtitle).toContain('1–10');
    const ids = Object.values(FEELING_DOMAINS).flatMap((d) => d.variables.map((v) => v.id));
    expect(new Set(ids).size).toBe(ids.length); // nenhuma variavel em dois dominios
    expect(FEELING_DOMAINS.sleep.variables.find((v) => v.id === 'workout.preSleepQuality')?.scaleHint).toContain('5 = excelente');
    expect(FEELING_DOMAINS.readiness.variables.find((v) => v.id === 'workout.prePhysicalFatigue')?.scaleHint).toContain('5 = muito alto');
  });

  it('observationPoints ignora categoricos e nao numericos (ausencia nunca vira zero)', () => {
    const s = snap({ observations: [
      { timestamp: '2026-10-01T12:00:00Z', value: 3 },
      { timestamp: '2026-10-02T12:00:00Z', value: 'on_time' },
      { timestamp: '2026-10-03T12:00:00Z', value: 5 },
    ] });
    expect(observationPoints(s).map((p) => p.y)).toEqual([3, 5]);
  });
});

describe('volumeSentences', () => {
  const weeks = [
    { weekStart: '2026-09-07', kmPercorridos: 30, kmPrescritos: 32, kmExtras: null },
    { weekStart: '2026-09-14', kmPercorridos: 34, kmPrescritos: 34, kmExtras: null },
    { weekStart: '2026-09-21', kmPercorridos: 40, kmPrescritos: 40, kmExtras: null },
    { weekStart: '2026-09-28', kmPercorridos: 46.1, kmPrescritos: 50.7, kmExtras: null },
  ];

  it('media das semanas completas, semana atual x prescrito e semana anterior, com numeros', () => {
    const lines = volumeSentences(weeks, '2026-10-04');
    expect(lines[0]).toContain('volume médio foi de 34,7 km por semana');
    expect(lines.join(' ')).toContain('realizou 46,1 km (prescrito: 50,7 km) — 4,6 km abaixo do prescrito');
    expect(lines.join(' ')).toContain('semana anterior fechou em 40 km');
  });

  it('semana sem km registrado nao entra na media (ausencia, nunca zero)', () => {
    const lines = volumeSentences([{ weekStart: '2026-09-14', kmPercorridos: null, kmPrescritos: null, kmExtras: null }, ...weeks.slice(2)], '2026-10-04');
    expect(lines.join(' ')).not.toContain('volume médio');
  });

  it('inclui a tendencia do motor quando ha evidencia', () => {
    const lines = volumeSentences(weeks, '2026-10-04', snap({ variable: { id: 'training.volumeCompletedTotalKm' } }));
    expect(lines.some((l) => l.includes('O volume semanal realizado apresenta tendência de aumento'))).toBe(true);
  });
});

describe('faixa no grafico', () => {
  it('habitualBand so existe quando o motor sustenta a faixa', () => {
    expect(habitualBand(snap())).toEqual({ lower: 2, upper: 4, label: 'faixa habitual' });
    expect(habitualBand(snap({ persistence: { currentlyOutsideHabitualRange: null, direction: null } }))).toBeUndefined();
  });
});

describe('pace e cadencia', () => {
  it('formata pace em min:ss/km', () => {
    expect(formatPaceSeconds(311)).toBe('5:11/km');
    expect(formatPaceSeconds(299.6)).toBe('5:00/km');
  });

  it('compara a media das ultimas 3 semanas com o ultimo treino (cadencia 160 x 170 spm)', () => {
    const s = snap({ current: 170, movingAverages: { short_21d: { value: 160, n: 4 } } });
    const [line] = recentVsLastSentences(s, { noun: 'cadência', fmt: (v) => `${Math.round(v)} spm` });
    expect(line).toBe('Sua cadência média nas últimas 3 semanas (4 treinos) é 160 spm. No último treino registrado, foi 170 spm.');
  });

  it('I: media movel que o motor nao sustenta (value null) nao e fabricada', () => {
    const s = snap({ current: 170, movingAverages: { short_21d: { value: null, n: 0 } } });
    const [line] = recentVsLastSentences(s, { noun: 'cadência', fmt: (v) => `${Math.round(v)} spm` });
    expect(line).toContain('Não há treinos suficientes nas últimas 3 semanas');
  });

  it('sem valor atual nao produz frase', () => {
    expect(recentVsLastSentences(snap({ current: null }), { noun: 'cadência', fmt: String })).toEqual([]);
  });
});
