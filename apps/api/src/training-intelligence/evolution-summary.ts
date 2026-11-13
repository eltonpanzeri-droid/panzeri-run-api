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
// Séries SEMANAIS (volume, razão, extras): as janelas de 7 e 28 registros virariam 28 semanas, que ainda não existem desde 01/08. Usa as MESMAS janelas que o gráfico já mostra: média das últimas 3 semanas
// (aguda) contra a média das últimas 8 semanas completas (crônica), e o longo prazo = crônica contra as semanas anteriores (>= 4).
export const WEEKLY_ACUTE_SIZE = 3;
export const WEEKLY_CHRONIC_SIZE = 8;
export const MIN_BEFORE_FOR_LONG_TREND_WEEKLY = 4;
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
  if (variableId === 'training.volumeRatioCompletedPrescribed') return `${Math.round(value * 100)}%`;
  if (unit === 'min') {
    const total = Math.round(value);
    return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
  }
  if (unit === 'bpm') return `${Math.round(value)} bpm`;
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

export function verdictOf(delta: number, reference: number, scale: { min: number; max: number } | undefined, trendGoodWhen: 'up' | 'down' | null, relative = false): Verdict {
  const threshold = !relative && scale && scale.max > scale.min ? (scale.max - scale.min) * CHANGE_FRACTION : Math.abs(reference) * CHANGE_FRACTION;
  if (!(Math.abs(delta) >= threshold) || threshold === 0) return 'stable';
  if (!trendGoodWhen) return delta > 0 ? 'above' : 'below';
  return (delta > 0) === (trendGoodWhen === 'up') ? 'improved' : 'worsened';
}

const VERDICT_PHRASE: Record<Verdict, string> = {
  improved: 'melhora', worsened: 'piora', stable: 'estabilidade', above: 'valores acima do habitual', below: 'valores abaixo do habitual',
};

export function trendSentence(short: TrendReading | null, long: TrendReading | null, phrases?: { above: string; below: string }): string | null {
  if (!short && !long) return null;
  const word = (verdict: Verdict) => (phrases && verdict === 'above' ? phrases.above : phrases && verdict === 'below' ? phrases.below : VERDICT_PHRASE[verdict]);
  if (short && long) {
    if (short.verdict === long.verdict) return short.verdict === 'stable' ? 'A tendência é estável, tanto no curto quanto no longo prazo.' : `A tendência mostra ${word(short.verdict)}, tanto no curto quanto no longo prazo.`;
    return `A tendência mostra ${word(short.verdict)} no curto prazo e ${word(long.verdict)} no longo prazo.`;
  }
  return short ? `A tendência de curto prazo mostra ${word(short.verdict)} (ainda não há registros suficientes para o longo prazo).` : `A tendência de longo prazo mostra ${word((long as TrendReading).verdict)} (ainda não há registros suficientes para o curto prazo).`;
}

// Esforço percebido e afins: o texto depende da POSIÇÃO da média na escala (alta/intermediária/baixa), sem chamar de bom ou ruim.
export const POSITION_HIGH = 0.65;
export const POSITION_LOW = 0.4;
export function positionBand(value: number, scale: { min: number; max: number } | undefined): 'high' | 'middle' | 'low' | null {
  if (!scale || scale.max <= scale.min) return null;
  const position = (value - scale.min) / (scale.max - scale.min);
  return position >= POSITION_HIGH ? 'high' : position <= POSITION_LOW ? 'low' : 'middle';
}

// Última semana observável contra o padrão (volume): só descreve; nunca qualifica.
export function lastWeekSentence(last: number, baseline: number, format: (value: number) => string): string {
  const threshold = Math.abs(baseline) * CHANGE_FRACTION;
  const diff = last - baseline;
  const where = Math.abs(diff) < threshold || threshold === 0 ? 'em linha com o seu padrão' : diff > 0 ? 'acima do seu padrão' : 'abaixo do seu padrão';
  return `A última semana observável teve ${format(last)}, ${where} de ${format(baseline)} por semana.`;
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

function weeklyWindows(math: MathLayerService, recent: SeriesPoint[]) {
  const acute = math.movingAverage(recent, { kind: 'observation_count', size: WEEKLY_ACUTE_SIZE });
  const chronic = math.movingAverage(recent, { kind: 'observation_count', size: WEEKLY_CHRONIC_SIZE });
  const acuteOk = !acute.isPartialWindow && acute.n > 0 && acute.value != null;
  const chronicOk = !chronic.isPartialWindow && chronic.n > 0 && chronic.value != null;
  return {
    acute: { complete: acuteOk, value: acute.value },
    chronic: { complete: chronicOk, value: chronic.value, windowStart: chronic.windowStart ? chronic.windowStart.toISOString() : null },
    difference: acuteOk && chronicOk ? (acute.value as number) - (chronic.value as number) : null,
  };
}

export function buildIndicatorResult(entry: IndicatorReading, definition: Pick<VariableDefinition, 'variableId' | 'scale' | 'expectedFrequency'>, series: SeriesPoint[], math: MathLayerService, now: Date = new Date(), provenanceNote: string | null = null): IndicatorResult {
  const whatItMeasures = `${entry.scaleText} ${entry.why}`;
  // Série semanal: a semana em curso é incompleta e fica fora (regra de Elton, 05/11/2026).
  const cutoff = entry.weekly ? now.getTime() - 7 * 86_400_000 : Infinity;
  const recent = series.filter((p) => Number.isFinite(p.value) && p.timestamp.getTime() >= EVOLUTION_SINCE.getTime() && p.timestamp.getTime() <= cutoff).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (recent.length < MIN_OBSERVATIONS) {
    return { variableId: entry.variableId, name: entry.name, status: 'insufficient', bucket: 'insufficient', level: null, mean: null, n: recent.length, short: null, long: null,
      texts: { whatItMeasures, habitual: 'Ainda não há registros suficientes para mostrar o seu padrão neste indicador.', trend: null, meaning: null } };
  }
  const overall = mean(recent.map((p) => p.value));
  const scale = definition.scale;
  const directional = entry.levelGoodWhen !== null;
  const level = levelOf(overall, scale, entry.levelGoodWhen);

  const ac = entry.weekly ? weeklyWindows(math, recent) : buildAcuteChronic(math, recent, definition, null);
  let short: TrendReading | null = null;
  if (ac.acute.complete && ac.chronic.complete && ac.difference != null && ac.chronic.value != null) {
    short = { delta: ac.difference, verdict: verdictOf(ac.difference, ac.chronic.value, scale, entry.trendGoodWhen, entry.relativeChange) };
  }
  let long: TrendReading | null = null;
  if (ac.chronic.complete && ac.chronic.value != null && ac.chronic.windowStart) {
    const start = new Date(ac.chronic.windowStart).getTime();
    const before = recent.filter((p) => p.timestamp.getTime() < start).map((p) => p.value);
    if (before.length >= (entry.weekly ? MIN_BEFORE_FOR_LONG_TREND_WEEKLY : MIN_BEFORE_FOR_LONG_TREND)) {
      const baseline = mean(before);
      long = { delta: ac.chronic.value - baseline, verdict: verdictOf(ac.chronic.value - baseline, baseline, scale, entry.trendGoodWhen, entry.relativeChange) };
    }
  }

  const bucket = bucketOf(level, short, directional);
  const band = entry.positionMeaning ? positionBand(overall, scale) : null;
  // "O que isso indica": o texto do nível (ou da posição na escala) + o que a TENDÊNCIA representa + o rodapé neutro (só quando não há texto de nível). Tendência mais recente primeiro; sem ela, a de longo prazo.
  // a mudança mais recente, se houve; senão a de longo prazo; senão "estável" (se houve leitura)
  const trendVerdict = short && short.verdict !== 'stable' ? short.verdict : long && long.verdict !== 'stable' ? long.verdict : (short ?? long)?.verdict;
  const trendKey = trendVerdict === 'above' ? 'above' : trendVerdict === 'below' ? 'below' : trendVerdict === 'stable' ? 'stable' : null;
  const levelText = level ? (entry.meaning[level] ?? null) : band && entry.positionMeaning ? entry.positionMeaning[band] : null;
  const meaningParts = [levelText, trendKey && entry.trendMeaning ? entry.trendMeaning[trendKey] : null, levelText ? null : (entry.meaning.neutral ?? null)].filter((part): part is string => !!part);
  const meaning = meaningParts.length > 0 ? meaningParts.join(' ') : null;
  const unit = scale && 'unit' in scale ? (scale as { unit?: string }).unit : undefined;
  const meanText = formatValue(overall, entry.variableId, unit);
  let habitual = entry.habitualTemplate ? entry.habitualTemplate(meanText, recent.length) : `O seu caso mostra uma média de ${meanText} (${recent.length} registros desde 01/08/2026).`;
  if (provenanceNote) habitual += ` ${provenanceNote}`;
  if (entry.weekly) habitual += ` ${lastWeekSentence(recent[recent.length - 1].value, overall, (value) => formatValue(value, entry.variableId, unit))}`;
  return {
    variableId: entry.variableId, name: entry.name, status: 'ok', bucket, level, mean: overall, n: recent.length, short, long,
    texts: { whatItMeasures, habitual, trend: trendSentence(short, long, entry.phrases), meaning },
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
