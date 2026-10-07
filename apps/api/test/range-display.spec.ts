import { collapseEqualRange, runPaceHeaderLabel } from '../src/training-plans/range-display';

// Caso real de 06/10 (Lucelane): 4 partes de 2 km alternando 5:45 e 6:45 (50:00 no total). O cabecalho mostrava "Tempo 50:00 a 50:00 - 5:45/km":
// faixa degenerada e um unico pace que so' valia para metade das partes.
const LUCELANE = {
  type: 'run',
  blocks: [
    { label: 'Parte 1', paceRange: '5:45/km a 5:45/km' },
    { label: 'Parte 2', paceRange: '6:45/km a 6:45/km' },
    { label: 'Parte 3', paceRange: '5:45/km a 5:45/km' },
    { label: 'Parte 4', paceRange: '6:45/km a 6:45/km' },
  ],
};

describe('apresentacao de faixas da prescricao', () => {
  it('collapseEqualRange: faixa degenerada vira valor unico; faixa real e preservada', () => {
    expect(collapseEqualRange('50:00 a 50:00')).toBe('50:00');
    expect(collapseEqualRange('11:30 a 11:30')).toBe('11:30');
    expect(collapseEqualRange('5:45/km a 5:45/km')).toBe('5:45/km');
    expect(collapseEqualRange('10.4 a 10.4 km/h')).toBe('10.4 km/h');
    expect(collapseEqualRange('10,4 a 10,4 km/h')).toBe('10,4 km/h');
    expect(collapseEqualRange('5:45/km a 6:15/km')).toBe('5:45/km a 6:15/km');
    expect(collapseEqualRange('50:00 a 52:30')).toBe('50:00 a 52:30');
    expect(collapseEqualRange('-')).toBe('-');
    expect(collapseEqualRange('1:00:00 a 1:00:00')).toBe('1:00:00');
  });

  it('cabecalho da sessao com partes de paces diferentes mostra a faixa real (5:45 a 6:45/km), nao so o pace de uma parte', () => {
    expect(runPaceHeaderLabel(LUCELANE, '5:45/km')).toBe('5:45 a 6:45/km');
  });

  it('partes com o mesmo pace mostram um valor unico; uma parte so ou intervalada mantem o pace representativo gravado', () => {
    const same = { type: 'run', blocks: [{ paceRange: '6:00/km a 6:00/km' }, { paceRange: '6:00/km a 6:00/km' }] };
    expect(runPaceHeaderLabel(same, '6:00/km')).toBe('6:00/km');
    expect(runPaceHeaderLabel({ type: 'run', blocks: [{ paceRange: '5:00/km a 5:30/km' }] }, '5:15/km')).toBe('5:15/km');
    const interval = { type: 'run', blocks: [{ repeatCount: 6, steps: [{ paceRange: '4:00/km a 4:40/km' }, { paceRange: '6:00/km a 7:00/km' }] }, { paceRange: '6:30/km a 6:30/km' }] };
    expect(runPaceHeaderLabel(interval, '4:20/km')).toBe('4:20/km');
  });

  it('sem paces legiveis ou sem estrutura: devolve o valor gravado (nunca inventa)', () => {
    expect(runPaceHeaderLabel({ type: 'run', blocks: [{ label: 'a' }, { label: 'b' }] }, '6:00/km')).toBe('6:00/km');
    expect(runPaceHeaderLabel(null, null)).toBeNull();
    expect(runPaceHeaderLabel({ type: 'strength' }, null)).toBeNull();
  });
});
