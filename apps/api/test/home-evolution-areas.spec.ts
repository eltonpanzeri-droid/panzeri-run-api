import { FEELING_DOMAINS, SnapshotLite, WEARABLE_SLEEP_VARIABLES, domainSentences, weeklySentences } from '../../mobile/home/insights';

// 02/11/2026 (lote 6): Sono (relogio), Bem-estar (itens do check-in) e Aderencia por semana. Aqui so' se testa a configuracao e as frases; os numeros vem do servidor.
describe('areas da Evolucao — configuracao', () => {
  it('Bem-estar: estresse por frequencia entra em Prontidao e o check-in semanal (resposta do corpo, motivacao) vira um bloco proprio', () => {
    expect(FEELING_DOMAINS.readiness.variables.map((v) => v.id)).toContain('workout.stressEventFrequency');
    expect(FEELING_DOMAINS.weekly.variables.map((v) => v.id)).toEqual(['checkin.bodyResponseVsNormal', 'checkin.postWeekMotivation']);
    expect(FEELING_DOMAINS.weekly.primary).toBe('checkin.bodyResponseVsNormal');
  });

  it('Sono do relogio: duracao e fases em horas legiveis, pontuacao e HRV com aviso de que dependem do aparelho', () => {
    const byId = Object.fromEntries(WEARABLE_SLEEP_VARIABLES.map((v) => [v.id, v]));
    expect(Object.keys(byId)).toEqual(['wearable.sleepDurationMin', 'wearable.sleepDeepMin', 'wearable.sleepLightMin', 'wearable.sleepRemMin', 'wearable.sleepScore', 'wearable.hrvLastNightAvg']);
    expect(byId['wearable.sleepDurationMin'].format?.(450)).toBe('7h30');
    expect(byId['wearable.sleepDeepMin'].format?.(420)).toBe('7h');
    expect(byId['wearable.sleepDeepMin'].scaleHint).toContain('estimativas');
    expect(byId['wearable.sleepScore'].scaleHint).toContain('mesma fonte');
    expect(byId['wearable.hrvLastNightAvg'].scaleHint).toContain('mesma fonte');
  });
});

describe('domainSentences — check-in semanal', () => {
  const snap = (over: Partial<SnapshotLite> = {}) => ({
    variable: { dataType: 'ordinal_scale', scale: { min: 1, max: 5 } },
    mathApplicable: true,
    current: 3,
    trend: { short_21d: { direction: 'stable', pattern: { kind: 'stable', side: null, ongoing: false, windowDays: 10 } } },
    habitualRange: { lower: 2, upper: 4, median: 3, n: 6 },
    persistence: { currentlyOutsideHabitualRange: false },
    observations: [],
    evidence: { n: 6 },
    ...over,
  }) as unknown as SnapshotLite;

  it('sem dado, sem frase (e sem erro)', () => {
    expect(domainSentences('weekly', {})).toEqual([]);
  });

  it('com dado, o resumo fala da resposta do corpo e da vontade de continuar treinando (nao some por falta de sujeito)', () => {
    const text = domainSentences('weekly', { 'checkin.bodyResponseVsNormal': snap(), 'checkin.postWeekMotivation': snap() }).join(' ');
    expect(text).toContain('resposta do corpo');
    expect(text).toContain('vontade de continuar treinando');
  });
});

describe('weeklySentences — aderencia com numerador e denominador', () => {
  const W = '2026-10-19T12:00:00.000Z';
  const adherence = (partial = false) => ({
    variable: {},
    mathApplicable: true,
    current: 75,
    trend: null,
    evidence: { n: 3 },
    observations: [
      { timestamp: W, value: 75, context: { isPartialWeek: partial, numerator: 3, denominator: 4 } },
    ],
  }) as unknown as SnapshotLite;
  const descriptor = {
    fmt: (v: number) => `${Math.round(v)}%`,
    lastLine: (v: number, c?: { numerator?: number | null; denominator?: number | null } | null) => (c?.numerator != null && c?.denominator != null ? `você fez ${c.numerator} de ${c.denominator} treinos registrados (${Math.round(v)}%)` : `sua aderência foi de ${Math.round(v)}%`),
  };

  it('a frase traz quantos treinos foram feitos de quantos registrados', () => {
    expect(weeklySentences(adherence(), descriptor)[0]).toBe('Na última semana completa (semana de 19/10), você fez 3 de 4 treinos registrados (75%).');
  });

  it('a semana em andamento nao e descrita como completa', () => {
    expect(weeklySentences(adherence(true), descriptor)).toEqual(['Ainda não há semanas completas com este dado.']);
  });
});
