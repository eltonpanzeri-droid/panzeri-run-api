import { buildPhasedCycles, cycleLimitations, phaseOfDate, phaseOfDay } from '../src/menstrual-cycle/cycle-phases';
import { summarizeDailyLogs } from '../src/menstrual-cycle/cycle-daily-summary';
import { normalizeSymptoms } from '../src/menstrual-cycle/cycle-symptoms';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('fases do ciclo por aluna (regra aprovada por Elton em 19/11/2026)', () => {
  it('ciclo real de 30 dias com 5 de sangramento: menstrual 0-4, folicular ate a vespera da ovulacao, ovulatoria em 3 dias ao redor do dia 16, lutea depois', () => {
    const cycle = { lengthDays: 30, periodDays: 5 };
    expect(phaseOfDay(0, cycle)).toBe('menstruacao');
    expect(phaseOfDay(4, cycle)).toBe('menstruacao');
    expect(phaseOfDay(5, cycle)).toBe('folicular');
    expect(phaseOfDay(14, cycle)).toBe('folicular');
    expect([15, 16, 17].map((day) => phaseOfDay(day, cycle))).toEqual(['ovulatoria', 'ovulatoria', 'ovulatoria']);
    expect(phaseOfDay(18, cycle)).toBe('lutea');
    expect(phaseOfDay(29, cycle)).toBe('lutea');
  });

  it('usa a duracao REAL de cada ciclo fechado e a mediana no ciclo em curso', () => {
    const cycles = buildPhasedCycles([{ start: d('2026-08-01'), end: d('2026-08-05') }, { start: d('2026-08-31'), end: d('2026-09-04') }, { start: d('2026-09-28'), end: null }], null);
    expect(cycles.map((cycle) => [cycle.lengthDays, cycle.lengthSource, cycle.open])).toEqual([[30, 'observed', false], [28, 'observed', false], [29, 'median', true]]);
    expect(cycles[0].periodDays).toBe(5);
  });

  it('sem ciclos fechados: usa a duracao declarada; sem nada, 28 dias como padrao, e a limitacao e dita', () => {
    const declared = buildPhasedCycles([{ start: d('2026-10-01'), end: null }], { cycleLengthDays: 32 });
    expect([declared[0].lengthDays, declared[0].lengthSource]).toEqual([32, 'declared']);
    const unknown = buildPhasedCycles([{ start: d('2026-10-01'), end: null }], null);
    expect([unknown[0].lengthDays, unknown[0].lengthSource]).toEqual([28, 'default28']);
    expect(cycleLimitations(unknown, null).join(' ')).toContain('padrão de 28 dias');
    expect(cycleLimitations(declared, null).join(' ')).toContain('você informou');
  });

  it('anticoncepcional hormonal: o aviso de fase estimada acompanha; sem ciclo registrado, nao ha fases', () => {
    const cycles = buildPhasedCycles([{ start: d('2026-10-01'), end: null }], { usesHormonalContraceptive: true });
    expect(cycleLimitations(cycles, { usesHormonalContraceptive: true }).join(' ')).toContain('anticoncepcional hormonal');
    expect(cycleLimitations([], null)[0]).toContain('Ainda não há ciclos');
  });

  it('fase de uma data: dentro do ciclo, antes do primeiro e muito depois do ultimo', () => {
    const cycles = buildPhasedCycles([{ start: d('2026-10-01'), end: d('2026-10-05') }, { start: d('2026-10-29'), end: null }], null);
    expect(phaseOfDate(d('2026-10-03'), cycles)).toMatchObject({ phase: 'menstruacao', cycleIndex: 0, dayOfCycle: 2 });
    expect(phaseOfDate(d('2026-10-30'), cycles)).toMatchObject({ cycleIndex: 1, dayOfCycle: 1 });
    expect(phaseOfDate(d('2026-09-20'), cycles)).toBeNull();
    expect(phaseOfDate(d('2026-12-30'), cycles)).toBeNull();
  });

  it('ciclo muito curto nunca gera fase com tamanho negativo', () => {
    const cycle = { lengthDays: 18, periodDays: 6 };
    const phases = Array.from({ length: 18 }, (_, day) => phaseOfDay(day, cycle));
    expect(phases[0]).toBe('menstruacao');
    expect(phases).toContain('lutea');
  });
});

describe('resumo dos registros diarios para a IA', () => {
  const now = d('2026-11-19');
  const logs = [
    { date: d('2026-11-02'), crampsLevel: 4, energyLevel: 2, moodLevel: 3, symptoms: ['inchaco', 'dor_de_cabeca'] },
    { date: d('2026-11-03'), crampsLevel: 3, energyLevel: 2, moodLevel: 4, symptoms: ['inchaco'] },
    { date: d('2026-11-12'), crampsLevel: 1, energyLevel: 5, moodLevel: 5, symptoms: [] },
    { date: d('2026-05-01'), crampsLevel: 5, energyLevel: 1, moodLevel: 1, symptoms: ['acne'] }, // fora da janela de 90 dias
  ];
  it('medias, sintomas mais frequentes e por fase; fora da janela nao conta; relato livre nunca entra', () => {
    const summary = summarizeDailyLogs(logs.map((log) => ({ ...log, notes: 'texto livre' } as never)), [{ start: d('2026-11-01'), end: d('2026-11-05') }], null, now)!;
    expect(summary.diasComRegistro).toBe(3);
    expect(summary.mediaColica).toBe(2.7);
    expect(summary.sintomasMaisFrequentes[0]).toEqual({ sintoma: 'Inchaço', dias: 2 });
    expect(summary.porFase.find((phase) => phase.fase === 'Fase menstrual')).toMatchObject({ dias: 2, mediaColica: 3.5 });
    expect(JSON.stringify(summary)).not.toContain('texto livre');
  });
  it('sem registro recente: nada a enviar', () => {
    expect(summarizeDailyLogs([logs[3]], [], null, now)).toBeNull();
  });
  it('lista de sintomas aceita so ids validos e sem repeticao', () => {
    expect(normalizeSymptoms(['acne', 'acne', 'inventado', 3, 'inchaco'])).toEqual(['acne', 'inchaco']);
    expect(normalizeSymptoms('x')).toEqual([]);
  });
});
