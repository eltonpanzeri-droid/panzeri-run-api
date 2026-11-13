import { MathLayerService, type SeriesPoint } from './math-layer.service';
import { buildAcuteChronic } from './acute-chronic';
import type { VariableDefinition } from './variable-registry';
import { AREA_READING, EVOLUTION_READING_STATUS, EVOLUTION_READING_VERSION, EVOLUTION_SINCE, READING_CATALOG, type AreaId, type IndicatorReading } from './evolution-reading-catalog';

// Leitura da Evolução da aluna por REGRA (13/11/2026, decisão de Elton: sem IA). Funções puras e testáveis; o serviço só busca as séries. Toda média e janela aqui vem da camada matemática existente
// (MathLayerService/buildAcuteChronic: "uma matemática só"); este arquivo só CLASSIFICA e monta o texto. Regras (rascunho a revisar por Elton):
//  - só observações desde EVOLUTION_SINCE; menos de MIN_OBSERVATIONS registros = "dados insuficientes" (nada é dito sobre o padrão);
//  - nível (bom/intermediário/ruim) só para indicadores com polaridade conhecida: posição da média na escala (>= 75% do lado bom = bom; <= 37,5% = ruim). Escala 1–5: média 4 é bom, 2,5 é ruim;
//  - tendência: curto prazo = aguda (7) × crônica (28) da camada matemática; longo prazo = crônica × tudo o que veio antes dela (>= 14 registros antes). Mudança só conta se passa de 10% da escala
//    (sem escala: 10% do valor de referência); abaixo disso, "estável";
//  - indicador SEM polaridade (esforço, volume, ritmo) nunca vira "melhora" ou "piora": só "acima/abaixo do habitual", e fica fora da contagem de bom/ruim da síntese.
export const MIN_OBSERVATIONS = 8;
export const MIN_BEFORE_FOR_LONG_TREND = 14;
export const CHANGE_FRACTION = 0.1;
export const GOOD_FRACTION = 0.75;
export const POOR_FRACTION = 0.375;

export type Level = 'good' | 'middle' | 'poor';
export type Verdict = 'improved' | 'worsened' | 'stable' | 'above' | 'below';
export type Bucket = 'good' | 'steady' | 'attention' | 'tracked' | 'insufficient';

export interface TrendReading { verdict: Verdict; delta: number }
export interface IndicatorResult {
  variableId: string;
  name: string;
  status: 'ok' | 'insufficient';
  bucket: Bucket;
  level: Level | null;
  mean: number | null;
  n: number;
  short: TrendReading | null;
  long: TrendReading | null;
  texts: { whatItMeasures: string; habitual: string; trend: string | null; meaning: string | null };
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const round1 = (value: number) => Math.round(value * 10) / 10;

export function formatValue(value: number, variableId: string, unit?: string): string {
  if (variableId === 'activity.avgPaceSecondsKm') {
    const total = Math.round(value);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`;
  }
  const text = String(round1(value)).replace('.', ',');
  if (unit === '%') return `${text.replace(',0', '')}%`;
  if (unit === 'km') return `${text.replace(',0', '')} km`;
  return text.replace(',0', '');
}

export function levelOf(value: number, scale: { min: number; max: number } | undefined, goodWhen: 'high' | 'low' | null): Level | null {
  if (!goodWhen || !scale || scale.max <= scale.min) return null;
  const position = (value - scale.min) / (scale.max - scale.min);
  const goodSide = goodWhen === 'high' ? position : 1 - position;
  return goodSide >= GOOD_FRACTION ? 'good' : goodSide <= POOR_FRACTION ? 'poor' : 'middle';
}

export function verdictOf(delta: number, reference: number, scale: { min: number; max: number } | undefined, trendGoodWhen: 'up' | 'down' | null): Verdict {
  const threshold = scale && scale.max > scale.min ? (scale.max - scale.min) * CHANGE_FRACTION : Math.abs(reference) * CHANGE_FRACTION;
  if (!(Math.abs(delta) >= threshold) || threshold === 0) return 'stable';
  if (!trendGoodWhen) return delta > 0 ? 'above' : 'below';
  return (delta > 0) === (trendGoodWhen === 'up') ? 'improved' : 'worsened';
}

const VERDICT_PHRASE: Record<Verdict, string> = {
  improved: 'melhora', worsened: 'piora', stable: 'estabilidade', above: 'valores acima do habitual', below: 'valores abaixo do habitual',
};

export function trendSentence(short: TrendReading | null, long: TrendReading | null): string | null {
  if (!short && !long) return null;
  if (short && long) {
    if (short.verdict === long.verdict) return short.verdict === 'stable' ? 'A tendência é estável, tanto no curto quanto no longo prazo.' : `A tendência mostra ${VERDICT_PHRASE[short.verdict]}, tanto no curto quanto no longo prazo.`;
    return `A tendência mostra ${VERDICT_PHRASE[short.verdict]} no curto prazo e ${VERDICT_PHRASE[long.verdict]} no longo prazo.`;
  }
  return short ? `A tendência de curto prazo mostra ${VERDICT_PHRASE[short.verdict]} (ainda não há registros suficientes para o longo prazo).` : `A tendência de longo prazo mostra ${VERDICT_PHRASE[(long as TrendReading).verdict]} (ainda não há registros suficientes para o curto prazo).`;
}

export function bucketOf(level: Level | null, short: TrendReading | null, directional: boolean): Bucket {
  if (!directional) return 'tracked';
  const verdict = short?.verdict ?? null;
  if (level === 'poor') return 'attention';
  if (level === 'good') return verdict === 'worsened' ? 'steady' : 'good';
  // nível intermediário (ou sem escala): decide a tendência de curto prazo
  if (verdict === 'improved') return 'good';
  if (verdict === 'worsened') return 'attention';
  return 'steady';
}

export function buildIndicatorResult(entry: IndicatorReading, definition: Pick<VariableDefinition, 'variableId' | 'scale' | 'expectedFrequency'>, series: SeriesPoint[], math: MathLayerService): IndicatorResult {
  const whatItMeasures = `${entry.scaleText} ${entry.why}`;
  const recent = series.filter((p) => Number.isFinite(p.value) && p.timestamp.getTime() >= EVOLUTION_SINCE.getTime()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (recent.length < MIN_OBSERVATIONS) {
    return { variableId: entry.variableId, name: entry.name, status: 'insufficient', bucket: 'insufficient', level: null, mean: null, n: recent.length, short: null, long: null,
      texts: { whatItMeasures, habitual: 'Ainda não há registros suficientes para mostrar o seu padrão neste indicador.', trend: null, meaning: null } };
  }
  const overall = mean(recent.map((p) => p.value));
  const scale = definition.scale;
  const directional = entry.levelGoodWhen !== null;
  const level = levelOf(overall, scale, entry.levelGoodWhen);

  const ac = buildAcuteChronic(math, recent, definition, null);
  let short: TrendReading | null = null;
  if (ac.acute.complete && ac.chronic.complete && ac.difference != null && ac.chronic.value != null) {
    short = { delta: ac.difference, verdict: verdictOf(ac.difference, ac.chronic.value, scale, entry.trendGoodWhen) };
  }
  let long: TrendReading | null = null;
  if (ac.chronic.complete && ac.chronic.value != null && ac.chronic.windowStart) {
    const start = new Date(ac.chronic.windowStart).getTime();
    const before = recent.filter((p) => p.timestamp.getTime() < start).map((p) => p.value);
    if (before.length >= MIN_BEFORE_FOR_LONG_TREND) {
      const baseline = mean(before);
      long = { delta: ac.chronic.value - baseline, verdict: verdictOf(ac.chronic.value - baseline, baseline, scale, entry.trendGoodWhen) };
    }
  }

  const bucket = bucketOf(level, short, directional);
  const meaning = level ? (entry.meaning[level] ?? null) : (entry.meaning.neutral ?? null);
  return {
    variableId: entry.variableId, name: entry.name, status: 'ok', bucket, level, mean: overall, n: recent.length, short, long,
    texts: {
      whatItMeasures,
      habitual: `O seu caso mostra uma média de ${formatValue(overall, entry.variableId, scale && 'unit' in scale ? (scale as { unit?: string }).unit : undefined)} (${recent.length} registros desde 01/08/2026).`,
      trend: trendSentence(short, long),
      meaning,
    },
  };
}

export interface AreaSummary {
  id: AreaId;
  title: string;
  counts: { good: number; steady: number; attention: number; tracked: number; insufficient: number; evaluated: number };
  text: string;
  meaning: string | null;
  indicators: IndicatorResult[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildAreaSummary(id: AreaId, indicators: IndicatorResult[]): AreaSummary {
  const area = AREA_READING.find((a) => a.id === id) as (typeof AREA_READING)[number];
  const counts = { good: 0, steady: 0, attention: 0, tracked: 0, insufficient: 0, evaluated: 0 };
  for (const indicator of indicators) {
    counts[indicator.bucket] += 1;
    if (indicator.bucket === 'good' || indicator.bucket === 'steady' || indicator.bucket === 'attention') counts.evaluated += 1;
  }
  if (counts.evaluated === 0) {
    const tracked = counts.tracked > 0 ? ` ${counts.tracked} ${plural(counts.tracked, 'indicador é acompanhado', 'indicadores são acompanhados')}, sem julgamento de bom ou ruim.` : '';
    return { id, title: area.title, counts, text: `Nesse quesito (${area.title.toLowerCase()}), ainda não há registros suficientes para avaliar o seu padrão.${tracked}`, meaning: null, indicators };
  }
  const parts: string[] = [];
  if (counts.good > 0) parts.push(`${counts.good} apresentam melhora ou padrão bom`);
  if (counts.steady > 0) parts.push(`${counts.steady} ${plural(counts.steady, 'está', 'estão')} em nível intermediário ou estável`);
  if (counts.attention > 0) parts.push(`${counts.attention} apresentam piora ou padrão que merece atenção`);
  const tracked = counts.tracked > 0 ? ` Outros ${counts.tracked} ${plural(counts.tracked, 'indicador é', 'indicadores são')} apenas acompanhados, porque dependem da intenção dos treinos.` : '';
  const missing = counts.insufficient > 0 ? ` ${counts.insufficient} ${plural(counts.insufficient, 'indicador ainda não tem', 'indicadores ainda não têm')} registros suficientes.` : '';
  const text = `Nesse quesito (${area.title.toLowerCase()}), dos ${counts.evaluated} ${plural(counts.evaluated, 'indicador avaliado', 'indicadores avaliados')}, ${parts.join('; ')}.${tracked}${missing}`;
  const meaning = counts.good / counts.evaluated >= 0.6 ? area.meaning.favorable : counts.attention / counts.evaluated >= 0.4 ? area.meaning.attention : area.meaning.mixed;
  return { id, title: area.title, counts, text, meaning, indicators };
}

export const EVOLUTION_SUMMARY_META = { version: EVOLUTION_READING_VERSION, status: EVOLUTION_READING_STATUS, since: EVOLUTION_SINCE.toISOString().slice(0, 10) } as const;
export { READING_CATALOG };
