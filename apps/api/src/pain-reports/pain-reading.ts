import type { MathLayerService, SeriesPoint } from '../training-intelligence/math-layer.service';
import { EVOLUTION_SINCE, READING_CATALOG } from '../training-intelligence/evolution-reading-catalog';
import { buildIndicatorResult, type IndicatorResult } from '../training-intelligence/evolution-summary';
import type { PainHistoryEntry, PainLevel } from './pain-history';

// Leitura por regra da DOR para os cinco botões sob os gráficos da área Dor (15/11/2026). Regra de Elton: todo treino registrado vale 0 de dor quando não houve relato — marcado como "sem dor"
// ou sem feedback (ver pain-history.ts). Escala 0 a 10 (28/11/2026): sem dor = 0, nota de 1 (muito leve) a 10 (extremamente forte); o dado antigo leve/moderada/forte vale 3/5/8. Quem nunca relatou dor NÃO fica "sem dados": a leitura diz que não há dor.
export const PAIN_LEVEL_VALUE: Record<PainLevel, number> = { none: 0, leve: 1, moderado: 2, forte: 3 };
const SINCE = EVOLUTION_SINCE.getTime();

export interface PainHistoryInput { entries: PainHistoryEntry[]; reports: Array<{ createdAt: Date; intensity: number }> }

const dmy = (date: Date) => `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildPainReading(variableId: string, history: PainHistoryInput, math: MathLayerService, now: Date = new Date()): IndicatorResult | null {
  const entry = READING_CATALOG.find((candidate) => candidate.variableId === variableId && candidate.virtual);
  if (!entry) return null;

  if (variableId === 'pain.perWorkout') {
    const series: SeriesPoint[] = history.entries
      .map((e) => ({ value: e.intensity, timestamp: new Date(`${e.date}T12:00:00Z`) }))
      .filter((p) => p.timestamp.getTime() >= SINCE);
    const result = buildIndicatorResult(entry, { variableId, scale: { min: 0, max: 10 }, expectedFrequency: 'per_workout' }, series, math, now);
    const total = series.length;
    if (total > 0 && series.every((p) => p.value === 0)) {
      const noPain = `Você não relatou dor em nenhum dos ${total} ${plural(total, 'treino registrado', 'treinos registrados')} desde 01/08/2026. Treino marcado como sem dor, ou registrado sem feedback, vale zero: ${plural(total, 'ele aparece', 'eles aparecem')} no gráfico como sem dor.`;
      result.guide.howYouAre = result.status === 'ok'
        ? [noPain, 'Treinar sem dor, de forma sustentada, indica que o corpo vem tolerando bem a carga dos treinos.']
        : [`${noPain} Ainda são poucos treinos para falar de tendência.`];
      if (result.status !== 'ok') {
        result.guide.numbers = [
          { label: 'Sua média', value: '0', note: `${total} ${plural(total, 'treino registrado', 'treinos registrados')}, todos sem dor` },
          { label: 'Tendência de longo prazo', value: '—', note: 'ainda sem treinos suficientes' },
          { label: 'Tendência de curto prazo', value: '—', note: 'ainda sem treinos suficientes' },
          { label: 'Seu último registro', value: '0', note: 'sem dor' },
        ];
      }
    }
    return result;
  }

  if (variableId === 'pain.reports') {
    const reports = history.reports.filter((r) => r.createdAt.getTime() >= SINCE).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const series: SeriesPoint[] = reports.map((r) => ({ value: r.intensity, timestamp: r.createdAt }));
    const result = buildIndicatorResult(entry, { variableId, scale: { min: 1, max: 10 }, expectedFrequency: 'per_workout' }, series, math, now);
    if (result.status !== 'ok') {
      const last = reports[reports.length - 1];
      if (reports.length === 0) {
        result.guide.numbers = [{ label: 'Relatos de dor', value: 'nenhum', note: 'você não fez relatos de dor desde 01/08/2026' }];
        result.guide.howYouAre = ['Você não fez nenhum relato de dor desde 01/08/2026. Quando sentir dor, use "Relatar dor" para que possamos acompanhar.'];
      } else {
        result.guide.numbers = [
          { label: 'Relatos de dor', value: String(reports.length), note: 'desde 01/08/2026' },
          { label: 'Seu último relato', value: `${last.intensity}/10`, note: dmy(last.createdAt) },
        ];
        result.guide.howYouAre = [`Você fez ${reports.length} ${plural(reports.length, 'relato', 'relatos')} de dor; o último foi de intensidade ${last.intensity}/10 em ${dmy(last.createdAt)}. Ainda são poucos relatos para falar de tendência.`];
      }
    }
    return result;
  }
  return null;
}
