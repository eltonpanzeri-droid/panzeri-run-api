// Horário de dormir e de acordar medidos pelo relógio (15/11/2026, pedido de Elton). Função PURA. Para cada noite PRINCIPAL de uma fonte, compara o horário do relógio com o padrão da própria aluna
// (mediana das noites anteriores da MESMA fonte): positivo = mais cedo que o padrão, negativo = mais tarde, em minutos; zero = padrão. Fontes diferentes nunca se misturam. Sem padrão ainda
// (menos de MIN_USUAL_NIGHTS noites anteriores) a noite não gera valor (nunca zero, nunca estimativa).
export const USUAL_NIGHTS = 14;
export const MIN_USUAL_NIGHTS = 5;

export interface SleepClockRow {
  id: string;
  sourceKey: string;
  role?: 'principal' | 'additional';
  startTimeSec: number;
  startOffsetSec: number;
  endTimeSec: number | null;
}
export interface SleepClockDeviation { bedtimeMin: number | null; wakeMin: number | null }

const minutesOfDay = (utcSec: number, offsetSec: number) => {
  const local = utcSec + offsetSec;
  return Math.floor((((local % 86400) + 86400) % 86400) / 60);
};
// Dormir: o relógio do dia começa ao meio-dia, para que 23:30 e 00:30 fiquem lado a lado (e não a 23 horas de distância).
const bedtimeClock = (row: SleepClockRow) => (minutesOfDay(row.startTimeSec, row.startOffsetSec) - 720 + 1440) % 1440;
const wakeClock = (row: SleepClockRow) => (row.endTimeSec == null ? null : minutesOfDay(row.endTimeSec, row.startOffsetSec));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function sleepClockDeviations(rows: SleepClockRow[]): Map<string, SleepClockDeviation> {
  const out = new Map<string, SleepClockDeviation>();
  const bySource = new Map<string, SleepClockRow[]>();
  for (const row of rows) {
    if (row.role === 'additional') continue; // cochilo ou segunda sessão: não é a noite
    bySource.set(row.sourceKey, [...(bySource.get(row.sourceKey) ?? []), row]);
  }
  for (const list of bySource.values()) {
    const nights = [...list].sort((a, b) => a.startTimeSec - b.startTimeSec);
    nights.forEach((row, index) => {
      const previous = nights.slice(Math.max(0, index - USUAL_NIGHTS), index);
      const prevBed = previous.map(bedtimeClock);
      const prevWake = previous.map(wakeClock).filter((v): v is number => v !== null);
      const bedtimeMin = prevBed.length >= MIN_USUAL_NIGHTS ? Math.round(median(prevBed) - bedtimeClock(row)) : null;
      const wake = wakeClock(row);
      const wakeMin = wake !== null && prevWake.length >= MIN_USUAL_NIGHTS ? Math.round(median(prevWake) - wake) : null;
      out.set(row.id, { bedtimeMin, wakeMin });
    });
  }
  return out;
}

// Relato da aluna (7 faixas) em escala de -3 a +3 (positivo = mais cedo, 0 = habitual). Degraus desiguais e teto em "mais de 1 hora": é ordinal, a média é aproximada.
export const SHIFT_SCORE: Record<string, number> = {
  much_earlier: 3, moderately_earlier: 2, slightly_earlier: 1, on_time: 0, slightly_later: -1, moderately_later: -2, much_later: -3,
};
export function shiftScoreOf(raw: unknown): number | undefined {
  return typeof raw === 'string' && raw in SHIFT_SCORE ? SHIFT_SCORE[raw] : undefined;
}
