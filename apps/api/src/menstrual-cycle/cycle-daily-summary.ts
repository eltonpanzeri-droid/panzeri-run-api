import { buildPhasedCycles, phaseOfDate, PHASE_IDS, PHASE_LABEL, type CycleLogLite, type PhaseId, type ProfileLite } from './cycle-phases';
import { cycleSymptomLabel, normalizeSymptoms } from './cycle-symptoms';

// Resumo COMPACTO dos registros diarios da aluna para a IA (19/11/2026, ordem de Elton: os registros diarios precisam chegar a IA de forma resumida). So' medias, contagens e os sintomas mais frequentes;
// nunca o calendario bruto nem o relato livre. So' sai com o aceite vigente do ciclo (quem chama confere). Funcao pura.
export const DAILY_SUMMARY_WINDOW_DAYS = 90;
const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) => (values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null);

export interface DailyLogLite { date: Date; crampsLevel: number | null; energyLevel: number | null; moodLevel: number | null; symptoms?: unknown }

export interface DailyLogSummary {
  janelaDias: number;
  diasComRegistro: number;
  mediaColica: number | null; // 1 sem colica ... 5 muito intensa
  mediaEnergia: number | null; // 1 muito baixa ... 5 alta
  mediaHumor: number | null; // 1 muito instavel ... 5 muito estavel
  sintomasMaisFrequentes: Array<{ sintoma: string; dias: number }>;
  porFase: Array<{ fase: string; dias: number; mediaColica: number | null; mediaEnergia: number | null; mediaHumor: number | null }>;
  observacao: string;
}

export function summarizeDailyLogs(logs: DailyLogLite[], cycleLogs: CycleLogLite[], profile: ProfileLite | null | undefined, now: Date = new Date()): DailyLogSummary | null {
  const since = now.getTime() - DAILY_SUMMARY_WINDOW_DAYS * 86_400_000;
  const recent = logs.filter((log) => log.date.getTime() >= since && log.date.getTime() <= now.getTime() + 86_400_000);
  if (recent.length === 0) return null;
  const nums = (pick: (log: DailyLogLite) => number | null) => recent.map(pick).filter((value): value is number => typeof value === 'number');
  const counts = new Map<string, number>();
  for (const log of recent) for (const id of normalizeSymptoms(log.symptoms)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const cycles = buildPhasedCycles(cycleLogs, profile);
  const byPhase = new Map<PhaseId, DailyLogLite[]>();
  for (const log of recent) {
    const phased = phaseOfDate(log.date, cycles);
    if (phased) byPhase.set(phased.phase, [...(byPhase.get(phased.phase) ?? []), log]);
  }
  return {
    janelaDias: DAILY_SUMMARY_WINDOW_DAYS,
    diasComRegistro: recent.length,
    mediaColica: mean(nums((log) => log.crampsLevel)),
    mediaEnergia: mean(nums((log) => log.energyLevel)),
    mediaHumor: mean(nums((log) => log.moodLevel)),
    sintomasMaisFrequentes: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([id, dias]) => ({ sintoma: cycleSymptomLabel(id), dias })),
    porFase: PHASE_IDS.filter((phase) => byPhase.has(phase)).map((phase) => {
      const list = byPhase.get(phase) as DailyLogLite[];
      const pick = (fn: (log: DailyLogLite) => number | null) => mean(list.map(fn).filter((value): value is number => typeof value === 'number'));
      return { fase: PHASE_LABEL[phase], dias: list.length, mediaColica: pick((log) => log.crampsLevel), mediaEnergia: pick((log) => log.energyLevel), mediaHumor: pick((log) => log.moodLevel) };
    }),
    observacao: 'Registros opcionais da aluna (escala 1 a 5), resumidos; as fases sao estimadas a partir dos ciclos que ela registrou e podem ser imprecisas. Ausencia de registro nao significa ausencia de sintoma.',
  };
}
