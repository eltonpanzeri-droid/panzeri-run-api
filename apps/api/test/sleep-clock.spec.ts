import { shiftScoreOf, sleepClockDeviations, SHIFT_SCORE, type SleepClockRow } from '../src/training-intelligence/sleep-clock';
import { SLEEP_SHIFT_DIRECTIONS } from '../src/workout-completions/dto/upsert-workout-completion.dto';

// 15/11/2026 — horário de dormir/acordar: relato em -3..+3 e desvio do relógio em minutos (positivo = mais cedo).
const BRT = -3 * 3600;
// Noite que começa às hh:mm (horário local de Brasília) do dia 'day' e termina às wh:wm do dia seguinte.
function night(id: string, day: number, bed: [number, number], wake: [number, number], extra: Partial<SleepClockRow> = {}): SleepClockRow {
  const base = Date.UTC(2026, 9, day) / 1000;
  const start = base + bed[0] * 3600 + bed[1] * 60 - BRT; // local -> UTC
  const end = base + 86400 + wake[0] * 3600 + wake[1] * 60 - BRT;
  return { id, sourceKey: 'zepp', role: 'principal', startTimeSec: start, startOffsetSec: BRT, endTimeSec: end, ...extra };
}

describe('relato em escala -3..+3', () => {
  it('cada uma das 7 faixas tem valor, positivo = mais cedo, 0 = habitual, teto em mais de 1 hora', () => {
    for (const direction of SLEEP_SHIFT_DIRECTIONS) expect(typeof SHIFT_SCORE[direction]).toBe('number');
    expect(shiftScoreOf('much_earlier')).toBe(3);
    expect(shiftScoreOf('on_time')).toBe(0);
    expect(shiftScoreOf('much_later')).toBe(-3);
    expect(shiftScoreOf('nao_existe')).toBeUndefined();
    expect(shiftScoreOf(null)).toBeUndefined();
  });
});

describe('desvio do relógio em relação ao padrão da própria aluna', () => {
  const usual = Array.from({ length: 6 }, (_, i) => night('n' + i, 1 + i, [23, 0], [6, 30]));
  it('sem padrão ainda (menos de 5 noites anteriores) não gera valor: nunca zero', () => {
    const result = sleepClockDeviations(usual);
    expect(result.get('n0')).toEqual({ bedtimeMin: null, wakeMin: null });
    expect(result.get('n4')?.bedtimeMin).toBeNull();
    expect(result.get('n5')?.bedtimeMin).toBe(0); // 5 noites anteriores no mesmo horário = padrão, desvio zero
  });
  it('mais cedo = positivo, mais tarde = negativo, em minutos; cruza a meia-noite sem erro', () => {
    const early = night('e', 10, [22, 15], [5, 45]); // 45 min antes de 23:00 e 45 min antes de 06:30
    const late = night('l', 11, [1, 0], [8, 0]); // 01:00 do dia seguinte = 2h depois de 23:00 (cruza a meia-noite)
    const result = sleepClockDeviations([...usual, early, late]);
    expect(result.get('e')).toEqual({ bedtimeMin: 45, wakeMin: 45 });
    expect(result.get('l')?.bedtimeMin).toBe(-120);
    expect(result.get('l')?.wakeMin).toBe(-90);
  });
  it('sessão adicional (cochilo) fica fora e fontes diferentes nunca se misturam', () => {
    const nap = night('nap', 12, [14, 0], [15, 0], { role: 'additional' });
    const other = usual.map((row) => ({ ...row, id: 'o' + row.id, sourceKey: 'apple' }));
    const result = sleepClockDeviations([...usual, nap, ...other, night('x', 12, [22, 0], [6, 0], { sourceKey: 'apple' })]);
    expect(result.has('nap')).toBe(false);
    expect(result.get('x')?.bedtimeMin).toBe(60); // contra o padrão do apple, não do zepp
  });
  it('fim do sono ausente: o horário de acordar fica sem valor, o de dormir segue', () => {
    const noEnd = night('ne', 10, [22, 0], [6, 0], { endTimeSec: null });
    const result = sleepClockDeviations([...usual, noEnd]);
    expect(result.get('ne')?.wakeMin).toBeNull();
    expect(result.get('ne')?.bedtimeMin).toBe(60);
  });
});
