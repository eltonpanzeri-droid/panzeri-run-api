import { LoadWindowLite, loadWindowSentences } from '../../mobile/home/insights';

// 02/11/2026 (lote 5): carga interna percebida (esforco x minutos) na tela da aluna. O servidor calcula; aqui so' se formata a janela de 7 e 28 dias — a razao so' aparece quando o servidor a sustenta.

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
