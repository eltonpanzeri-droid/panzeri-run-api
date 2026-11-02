import { LoadWeekLite, LoadWindowLite, loadChartWeeks, loadWeekSentences, loadWindowSentences } from '../../mobile/home/insights';

// 02/11/2026 (lote 5): carga interna percebida (esforco x minutos) na tela da aluna. O servidor calcula; aqui so' se formata — semana em andamento e cortada ficam fora do grafico,
// semana sem treino com carga vira lacuna (nunca zero) e a razao so' aparece quando o servidor a sustenta.
const week = (weekStart: string, over: Partial<LoadWeekLite> = {}): LoadWeekLite => ({ weekStart, inProgress: false, clipped: false, load: 1200, sessions: 3, excluded: 0, ...over });

describe('loadChartWeeks', () => {
  it('descarta semana em andamento e semana cortada pelo periodo; semana sem treino com carga vira lacuna (null), nunca zero', () => {
    const points = loadChartWeeks([
      week('2026-09-28', { clipped: true }),
      week('2026-10-05'),
      week('2026-10-12', { sessions: 0, load: 0 }),
      week('2026-10-19', { load: 800, sessions: 2 }),
      week('2026-10-26', { inProgress: true }),
    ]);
    expect(points).toEqual([
      { weekStart: '2026-10-05', load: 1200 },
      { weekStart: '2026-10-12', load: null },
      { weekStart: '2026-10-19', load: 800 },
    ]);
  });
});

describe('loadWeekSentences', () => {
  it('descreve a ultima semana completa COM treinos e a semana em andamento separadamente', () => {
    const lines = loadWeekSentences([
      week('2026-10-12', { load: 950.5, sessions: 1 }),
      week('2026-10-19', { load: 1200, sessions: 3, excluded: 1 }),
      week('2026-10-26', { inProgress: true, load: 300, sessions: 1 }),
    ]);
    expect(lines).toEqual([
      'Na última semana completa com treinos (semana de 19/10), a carga foi de 1200 UA, em 3 treinos.',
      '1 treino dessa semana ficou de fora do cálculo por falta de esforço percebido ou de duração.',
      'Nesta semana, até agora: 300 UA em 1 treino (fora do gráfico até a semana terminar).',
    ]);
  });

  it('sem semana completa com treinos: mensagem unica, sem numero inventado', () => {
    expect(loadWeekSentences([week('2026-10-26', { inProgress: true, sessions: 0, load: 0 })])).toEqual(['Ainda não há semanas completas com carga registrada.']);
  });
});

describe('loadWindowSentences', () => {
  const base: LoadWindowLite = { acuteLoad: 1300, chronicWeeklyAverage: 1100.4, ratio: 1.18, sessionsInWindow: 14, minSessions: 10, note: null };
  it('com razao: aguda, cronica e razao com virgula decimal', () => {
    expect(loadWindowSentences(base)).toEqual([
      'Carga dos últimos 7 dias (aguda): 1300 UA.',
      'Média semanal dos últimos 28 dias (crônica): 1100,4 UA.',
      'Razão aguda ÷ crônica: 1,18.',
    ]);
  });
  it('sem razao (historico curto ou poucos treinos): usa a explicacao do servidor, nunca inventa a razao', () => {
    const lines = loadWindowSentences({ ...base, ratio: null, note: 'Histórico curto: só 12 de 28 dias — a razão ainda não existe.' });
    expect(lines[2]).toBe('Histórico curto: só 12 de 28 dias — a razão ainda não existe.');
    expect(lines.join(' ')).not.toContain('Razão aguda');
  });
  it('com razao e aviso do servidor (treinos de fora), o aviso acompanha', () => {
    expect(loadWindowSentences({ ...base, note: '2 treino(s) dos últimos 28 dias ficaram de fora.' })[3]).toBe('2 treino(s) dos últimos 28 dias ficaram de fora.');
  });
  it('sem nenhum treino na janela de 28 dias: so a explicacao, sem "0 UA" enganoso', () => {
    expect(loadWindowSentences({ ...base, sessionsInWindow: 0, acuteLoad: 0, chronicWeeklyAverage: 0, ratio: null, note: 'Sem carga registrada nos últimos 28 dias — a razão não existe.' })).toEqual(['Sem carga registrada nos últimos 28 dias — a razão não existe.']);
  });
});
