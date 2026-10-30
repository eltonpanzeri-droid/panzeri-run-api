import { composeIndicators, compareAssessments, nextReassessmentDue, selectReference } from '../src/physiology/reference-selection';

// Testes físicos, Lote 2 (30/10/2026): regra de prioridade entre avaliações, pela data REAL do teste.
const a = (id: string, method: string, performedAt: string, createdAt = '2026-10-30T12:00:00Z') => ({ id, method, performedAt: new Date(performedAt), createdAt: new Date(createdAt) });

describe('seleção da avaliação de referência', () => {
  it('sem avaliações: nada; com uma só: ela', () => {
    expect(selectReference([])).toBeNull();
    expect(selectReference([a('1', 'three_km', '2026-10-01')])?.reference.id).toBe('1');
  });

  it('sem ergoespirometria: a mais recente, qualquer método', () => {
    const r = selectReference([a('1', 'three_km', '2026-06-01'), a('2', 'cooper_12min', '2026-09-01'), a('3', 'five_km', '2026-03-01')]);
    expect(r?.reference.id).toBe('2');
    expect(r?.reason).toBe('mais_recente');
  });

  it('diferença menor que 60 dias: a ergoespirometria vence o teste mais recente', () => {
    const r = selectReference([a('ergo', 'ergospirometry', '2026-09-01'), a('t', 'three_km', '2026-10-15')]);
    expect(r?.reference.id).toBe('ergo');
    expect(r?.gapDays).toBe(44);
  });

  it('diferença EXATAMENTE de 60 dias: a ergoespirometria ainda vence', () => {
    const r = selectReference([a('ergo', 'ergospirometry', '2026-08-01'), a('t', 'three_km', '2026-09-30')]);
    expect(r?.gapDays).toBe(60);
    expect(r?.reference.id).toBe('ergo');
  });

  it('diferença de 61 dias ou mais: vence a mais recente', () => {
    const r = selectReference([a('ergo', 'ergospirometry', '2026-08-01'), a('t', 'three_km', '2026-10-01')]);
    expect(r?.gapDays).toBe(61);
    expect(r?.reference.id).toBe('t');
    expect(r?.reason).toBe('mais_recente_ergoespirometria_antiga');
  });

  it('ergoespirometria antiga e teste recente: a antiga perde', () => {
    expect(selectReference([a('ergo', 'ergospirometry', '2025-01-10'), a('t', 'three_km', '2026-10-20')])?.reference.id).toBe('t');
  });

  it('três ou mais avaliações: compara a ergoespirometria MAIS RECENTE com a avaliação MAIS RECENTE (não com a do meio)', () => {
    const list = [a('ergoVelha', 'ergospirometry', '2026-01-01'), a('ergoNova', 'ergospirometry', '2026-08-15'), a('meio', 'five_km', '2026-09-01'), a('recente', 'three_km', '2026-10-10')];
    const r = selectReference(list);
    expect(r?.reference.id).toBe('ergoNova'); // 56 dias até a mais recente
    // a mesma lista sem a ergoespirometria nova: a antiga está a 282 dias, então vence a mais recente
    expect(selectReference(list.filter((x) => x.id !== 'ergoNova'))?.reference.id).toBe('recente');
  });

  it('usa a data real do teste, não a de cadastro', () => {
    // cadastrada hoje, mas feita há 5 meses: perde para o teste feito há 1 mês, mesmo cadastrado antes
    const r = selectReference([a('antiga', 'three_km', '2026-05-30', '2026-10-30T10:00:00Z'), a('nova', 'three_km', '2026-09-30', '2026-10-01T10:00:00Z')]);
    expect(r?.reference.id).toBe('nova');
  });

  it('mesma data: ergoespirometria primeiro; entre métodos iguais, o cadastro mais recente; por fim o id (ordem determinística)', () => {
    expect(selectReference([a('t', 'three_km', '2026-10-01'), a('e', 'ergospirometry', '2026-10-01')])?.reference.id).toBe('e');
    expect(selectReference([a('x', 'three_km', '2026-10-01', '2026-10-01T09:00:00Z'), a('y', 'three_km', '2026-10-01', '2026-10-01T10:00:00Z')])?.reference.id).toBe('y');
    const same = [a('b', 'three_km', '2026-10-01'), a('a', 'three_km', '2026-10-01')];
    expect(selectReference(same)?.reference.id).toBe('a');
    expect(selectReference([...same].reverse())?.reference.id).toBe('a');
    expect([a('b', 'other', '2026-10-01'), a('a', 'lactate', '2026-10-01')].sort(compareAssessments)[0].id).toBe('a');
  });

  it('complementação: o indicador ausente vem de outra avaliação, com método, data e procedência', () => {
    const list = [a('ergo', 'ergospirometry', '2026-10-01'), a('t', 'three_km', '2026-09-20')];
    const choice = selectReference(list)!;
    const map = new Map([
      ['ergo', [{ key: 'vo2max', value: 58, origin: 'measured' }]],
      ['t', [{ key: 'vo2max', value: 51, origin: 'estimated' }, { key: 'l1_hr_bpm', value: 150, origin: 'estimated' }]],
    ]);
    const merged = composeIndicators(choice, list, map);
    expect(merged.find((i) => i.key === 'vo2max')).toMatchObject({ value: 58, assessmentId: 'ergo', fromReference: true });
    expect(merged.find((i) => i.key === 'l1_hr_bpm')).toMatchObject({ value: 150, assessmentId: 't', method: 'three_km', fromReference: false });
    expect(merged.find((i) => i.key === 'l1_hr_bpm')?.performedAt).toEqual(new Date('2026-09-20'));
  });
});

describe('lembrete de reavaliação a cada 4 meses', () => {
  it('conta 4 meses da avaliação aeróbia mais recente; nova avaliação antes do prazo reinicia a contagem', () => {
    expect(nextReassessmentDue([a('1', 'three_km', '2026-06-10')])).toEqual(new Date('2026-10-10'));
    expect(nextReassessmentDue([a('1', 'three_km', '2026-06-10'), a('2', 'ergospirometry', '2026-09-01')])).toEqual(new Date('2027-01-01'));
  });
  it('dia 31 que não existe no mês de destino cai no último dia do mês', () => {
    expect(nextReassessmentDue([a('1', 'three_km', '2026-10-31')])).toEqual(new Date('2027-02-28'));
    expect(nextReassessmentDue([a('1', 'three_km', '2026-02-28')])).toEqual(new Date('2026-06-28'));
  });
  it('sem avaliações: sem lembrete; sem reavaliação, a data só fica no passado (nada bloqueia)', () => {
    expect(nextReassessmentDue([])).toBeNull();
    expect(nextReassessmentDue([a('1', 'three_km', '2025-01-01')])!.getTime()).toBeLessThan(Date.now());
  });
});
