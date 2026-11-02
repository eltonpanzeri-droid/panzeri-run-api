import { SnapshotLite, completeWeekPoints, recentVsLastSentences, sessionMeanSentences, weeklySentences } from '../../mobile/home/insights';

// 02/11/2026 (lote 4): indicadores semanais do treinamento (diferenca e razao realizado x prescrito) e frases por treino. Tudo vem do servidor; aqui so' se testa a LEITURA:
// a semana em andamento (parcial) nunca entra, e nada e' inventado quando falta historico.
const W1 = '2026-10-05T12:00:00.000Z';
const W2 = '2026-10-12T12:00:00.000Z';
const W3 = '2026-10-19T12:00:00.000Z';
const W4 = '2026-10-26T12:00:00.000Z'; // semana em andamento

const fmt = (v: number) => `${Math.round(v * 100)}%`;
const descriptor = { fmt, lastLine: (v: number) => `você realizou ${Math.round(v * 100)}% do volume prescrito` };

function snap(over: Partial<SnapshotLite> = {}): SnapshotLite {
  return {
    variable: {},
    mathApplicable: true,
    current: 0.3,
    trend: null,
    evidence: { n: 4 },
    observations: [
      { timestamp: W1, value: 0.9, context: { modality: 'global', isPartialWeek: false } },
      { timestamp: W2, value: 1.1, context: { modality: 'global', isPartialWeek: false } },
      { timestamp: W3, value: 1.0, context: { modality: 'global', isPartialWeek: false } },
      { timestamp: W4, value: 0.3, context: { modality: 'global', isPartialWeek: true } },
    ],
    movingAverageSeries: { short_21d: [{ timestamp: W1, value: 0.9 }, { timestamp: W2, value: 1.0 }, { timestamp: W3, value: 1.0 }, { timestamp: W4, value: 0.8 }] },
    reference: {
      points: [
        { timestamp: W3, value: 1.0, signal: 'within', band: { lower: 0.9, upper: 1.1, median: 1.0, n: 5, basis: 'individual' } },
        { timestamp: W4, value: 0.3, signal: 'below', band: { lower: 0.9, upper: 1.1, median: 1.0, n: 6, basis: 'individual' } },
      ],
    },
    ...over,
  };
}

describe('completeWeekPoints', () => {
  it('a semana em andamento (parcial) fica de fora; as completas ficam em ordem', () => {
    expect(completeWeekPoints(snap()).map((p) => p.timestamp)).toEqual([W1, W2, W3]);
  });
  it('sem snapshot ou com matematica nao aplicavel devolve vazio', () => {
    expect(completeWeekPoints(null)).toEqual([]);
    expect(completeWeekPoints(snap({ mathApplicable: false }))).toEqual([]);
  });
});

describe('weeklySentences', () => {
  it('descreve a ULTIMA SEMANA COMPLETA (nunca a parcial), a media de 3 semanas ate ela e o lado da faixa', () => {
    const lines = weeklySentences(snap(), descriptor);
    expect(lines[0]).toBe('Na última semana completa (semana de 19/10), você realizou 100% do volume prescrito.');
    expect(lines[1]).toBe('A média das últimas 3 semanas, até essa semana, é 100%.');
    expect(lines[2]).toBe('Esse valor ficou dentro da sua faixa habitual (90% a 110%).');
    expect(lines[3]).toBe('A semana em andamento fica de fora até terminar.');
    // o valor parcial (30%) e a faixa do ponto parcial nunca aparecem no texto
    expect(lines.join(' ')).not.toContain('30%');
  });

  it('usa o lado da faixa devolvido pelo servidor (acima/abaixo), sem comparar nada no app', () => {
    const above = snap({ reference: { points: [{ timestamp: W3, signal: 'above', band: { lower: 0.5, upper: 0.8, median: 0.6, n: 3, basis: 'limited' } }] } });
    expect(weeklySentences(above, descriptor)[2]).toBe('Esse valor ficou acima da sua faixa habitual (50% a 80%, histórico ainda curto).');
  });

  it('sem faixa sustentada pelo servidor: diz que falta historico, nunca chama de "normal"', () => {
    const none = snap({ reference: { points: [{ timestamp: W3, signal: 'no_reference', band: { lower: null, upper: null, median: null, n: 1, basis: 'none' } }] } });
    expect(weeklySentences(none, descriptor)[2]).toBe('Ainda não há histórico suficiente para uma faixa habitual.');
  });

  it('sem nenhuma semana completa: mensagem unica, sem numero', () => {
    const onlyPartial = snap({ observations: [{ timestamp: W4, value: 0.3, context: { isPartialWeek: true } }] });
    expect(weeklySentences(onlyPartial, descriptor)).toEqual(['Ainda não há semanas completas com este dado.']);
  });

  it('sem semana em andamento na serie, nao ha aviso de semana parcial', () => {
    const closed = snap({ observations: snap().observations.filter((o) => o.context?.isPartialWeek !== true) });
    expect(weeklySentences(closed, descriptor).join(' ')).not.toContain('em andamento');
  });
});

describe('frases por treino', () => {
  const run = snap({ current: 80, movingAverages: { short_21d: { value: 72, n: 4 } } });
  it('sessionMeanSentences: media das 3 semanas x ultimo treino, sem genero fixo', () => {
    expect(sessionMeanSentences(run, { subject: 'o tempo dentro da faixa de ritmo prescrita', fmt: (v) => `${Math.round(v)}%` })).toEqual([
      'Nas últimas 3 semanas (4 treinos), o tempo dentro da faixa de ritmo prescrita teve média de 72%. No último treino com esse dado, foi 80%.',
    ]);
  });
  it('sessionMeanSentences: sem media do servidor, so o ultimo treino', () => {
    const s = snap({ current: 80, movingAverages: { short_21d: { value: null, n: 1 } } });
    expect(sessionMeanSentences(s, { subject: 'o tempo na faixa', fmt: (v) => `${v}%` })[0]).toContain('Não há treinos suficientes');
  });
  it('recentVsLastSentences concorda o genero: "Seu ritmo médio" (antes saia "Sua ritmo média")', () => {
    const pace = snap({ current: 315, movingAverages: { short_21d: { value: 314, n: 10 } } });
    expect(recentVsLastSentences(pace, { noun: 'ritmo', fmt: (v) => `${v}s`, masculine: true })[0]).toBe('Seu ritmo médio nas últimas 3 semanas (10 treinos) é 314s. No último treino registrado, foi 315s.');
    expect(recentVsLastSentences(pace, { noun: 'cadência', fmt: (v) => `${v}s` })[0]).toMatch(/^Sua cadência média/);
  });
});
