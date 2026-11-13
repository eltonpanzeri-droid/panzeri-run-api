import { MathLayerService, type SeriesPoint } from './math-layer.service';
import { buildAcuteChronic } from './acute-chronic';
import type { VariableDefinition } from './variable-registry';
import { AREA_INFO, AREA_READING, EVOLUTION_READING_STATUS, EVOLUTION_READING_VERSION, EVOLUTION_SINCE, READING_CATALOG, type AreaId, type IndicatorReading } from './evolution-reading-catalog';

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

// Os blocos do desenho de Elton (14/11/2026): "O que é?", "Como interpretar?", "Quais são os seus números?", "Como você está?" e "Limitações desse dado". Tudo por regra, sem IA.
export interface GuideRow { label: string; value: string; note?: string }
export interface IndicatorGuide { whatIs: string; howToRead: string; numbers: GuideRow[]; howYouAre: string[]; limitations: string[] }
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
  guide: IndicatorGuide;
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

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const fmtNum = (value: number) => String(round1(value)).replace('.', ',').replace(',0', '');
// Dia local do Brasil (os instantes de atividade vêm em UTC).
const dateBr = (date: Date) => {
  const local = new Date(date.getTime() - 3 * 3600 * 1000);
  return `${String(local.getUTCDate()).padStart(2, '0')}/${String(local.getUTCMonth() + 1).padStart(2, '0')}/${local.getUTCFullYear()}`;
};
const LEVEL_WORD: Record<Level, string> = { good: 'bom', middle: 'intermediário', poor: 'de atenção' };
const SELF_REPORTED_PREFIXES = ['workout.', 'checkin.', 'cycle.'];

function howToReadText(entry: IndicatorReading, scale: { min: number; max: number } | undefined, weekly: boolean): string {
  const unitWord = weekly ? 'semanas' : 'registros';
  const direction = `Depois olhamos para onde você está indo: comparamos a média dos ${unitWord} mais recentes com a de mais longo prazo.`;
  if (entry.levelGoodWhen && scale && scale.max > scale.min) {
    const range = scale.max - scale.min;
    const high = entry.levelGoodWhen === 'high';
    const goodFrom = high ? scale.min + GOOD_FRACTION * range : scale.max - GOOD_FRACTION * range;
    const poorLimit = high ? scale.min + POOR_FRACTION * range : scale.max - POOR_FRACTION * range;
    const side = high ? `quanto mais perto de ${fmtNum(scale.max)}, melhor` : `quanto mais perto de ${fmtNum(scale.min)}, melhor`;
    const bands = high
      ? `a partir de ${fmtNum(goodFrom)} é um bom nível e até ${fmtNum(poorLimit)} pede atenção`
      : `até ${fmtNum(goodFrom)} é um bom nível e a partir de ${fmtNum(poorLimit)} pede atenção`;
    return `Neste indicador, ${side}. Olhamos a sua média na escala: ${bands}; entre os dois é um nível intermediário. ${direction} Uma mudança só conta quando passa de ${fmtNum(range * CHANGE_FRACTION)} na escala; abaixo disso, consideramos estabilidade.`;
  }
  return `Este indicador não é "bom" nem "ruim" por si só: o que importa é a direção. ${direction} Uma mudança só conta quando passa de 10% do seu próprio valor; abaixo disso, consideramos estabilidade.`;
}

function limitationsText(entry: IndicatorReading, n: number, extra: { weekly: boolean; insufficient: boolean; provenanceNote: string | null }): string[] {
  const out: string[] = [
    'Isto não é diagnóstico e não substitui a avaliação de um médico.',
    'Um dado sozinho não define o seu estado: aqui olhamos tendências, sempre junto com os demais dados.',
    'Só entram registros desde 01/08/2026.',
  ];
  if (extra.insufficient) out.push(`Ainda não há registros suficientes (${n} de ${MIN_OBSERVATIONS} necessários) para esta leitura: ela ganha força conforme você registra.`);
  else if (n < 20) out.push(`Ainda são poucos registros (${n}): a leitura vai ficando mais firme com o tempo.`);
  if (extra.weekly) out.push('A semana em curso fica fora até terminar.');
  if (SELF_REPORTED_PREFIXES.some((prefix) => entry.variableId.startsWith(prefix))) out.push('Este dado é informado por você, então reflete a sua percepção no momento do registro.');
  if (entry.wearable) {
    out.push('É uma estimativa do relógio, não uma medida clínica, e muda de uma marca para outra: usamos só a fonte principal do seu relógio.');
    out.push('Cada dado é uma parte de um todo e pode ajudar mais ou atrapalhar mais conforme o número: mostramos o seu padrão de longo prazo e para onde a tendência aponta, lidos junto com os demais dados.');
  }
  if (entry.levelGoodWhen === null && !entry.wearable) out.push('Este indicador não é bom nem ruim por si só: depende da intenção dos seus treinos e do momento da preparação.');
  if (entry.variableId === 'activity.avgPaceSecondsKm') {
    out.push('O ritmo médio depende do tipo de treino do dia (leve, longo ou intenso). Ritmo estimado pelo GPS não entra nesta média, e treinos com ritmo impossível ficam de fora.');
    if (extra.provenanceNote) out.push(extra.provenanceNote);
  }
  if (entry.variableId === 'training.volumeRatioCompletedPrescribed') out.push('O realizado inclui os treinos extras; semana sem volume prescrito não entra.');
  if (entry.variableId === 'activity.avgPaceSecondsKm' || entry.variableId.startsWith('training.volume')) out.push('Só corrida entra nos quilômetros.');
  return out;
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
    const lastPoint = recent[recent.length - 1];
    return { variableId: entry.variableId, name: entry.name, status: 'insufficient', bucket: 'insufficient', level: null, mean: null, n: recent.length, short: null, long: null,
      texts: { whatItMeasures, habitual: 'Ainda não há registros suficientes para mostrar o seu padrão neste indicador.', trend: null, meaning: null },
      guide: {
        whatIs: whatItMeasures,
        howToRead: howToReadText(entry, definition.scale, !!entry.weekly),
        numbers: [
          { label: 'Sua média', value: '—', note: `${recent.length} ${entry.weekly ? 'semanas completas' : 'registros'} desde 01/08/2026` },
          { label: 'Tendência de longo prazo', value: '—', note: 'média móvel longa: ainda sem registros suficientes' },
          { label: 'Tendência de curto prazo', value: '—', note: 'média móvel curta: ainda sem registros suficientes' },
          { label: 'Seu último registro', value: lastPoint ? formatValue(lastPoint.value, entry.variableId, definition.scale && 'unit' in definition.scale ? (definition.scale as { unit?: string }).unit : undefined) : '—', note: lastPoint ? dateBr(lastPoint.timestamp) : undefined },
        ],
        howYouAre: [`Ainda não temos registros suficientes de ${entry.name} para dizer como você está (são necessários pelo menos ${MIN_OBSERVATIONS}). Continue registrando: assim que houver o bastante, esta leitura aparece aqui.`],
        limitations: limitationsText(entry, recent.length, { weekly: !!entry.weekly, insufficient: true, provenanceNote }),
      } };
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
  const meaningParts = [levelText, trendKey && entry.trendMeaning ? entry.trendMeaning[trendKey] : null].filter((part): part is string => !!part);
  const meaning = meaningParts.length > 0 ? meaningParts.join(' ') : null;
  const unit = scale && 'unit' in scale ? (scale as { unit?: string }).unit : undefined;
  const meanText = formatValue(overall, entry.variableId, unit);
  let habitual = entry.habitualTemplate ? entry.habitualTemplate(meanText, recent.length) : `O seu caso mostra uma média de ${meanText} (${recent.length} registros desde 01/08/2026).`;
  if (entry.weekly) habitual += ` ${lastWeekSentence(recent[recent.length - 1].value, overall, (value) => formatValue(value, entry.variableId, unit))}`;
  const trendText = trendSentence(short, long, entry.phrases);
  const fmt = (value: number) => formatValue(value, entry.variableId, unit);
  const lastPoint = recent[recent.length - 1];
  const acuteOk = ac.acute.complete && ac.acute.value != null;
  const chronicOk = ac.chronic.complete && ac.chronic.value != null;
  const acuteSize = entry.weekly ? WEEKLY_ACUTE_SIZE : 7;
  const chronicSize = entry.weekly ? WEEKLY_CHRONIC_SIZE : 28;
  const unitWord = entry.weekly ? 'semanas' : 'registros';
  const numbers: GuideRow[] = [
    { label: 'Sua média', value: meanText, note: `média aritmética de ${recent.length} ${entry.weekly ? 'semanas completas' : 'registros'} desde 01/08/2026` },
    { label: 'Tendência de longo prazo', value: chronicOk ? fmt(ac.chronic.value as number) : '—', note: `média móvel longa: média dos ${chronicSize} ${unitWord} mais recentes${chronicOk ? '' : ' (ainda sem registros suficientes)'}` },
    { label: 'Tendência de curto prazo', value: acuteOk ? fmt(ac.acute.value as number) : '—', note: `média móvel curta: média dos ${acuteSize} ${unitWord} mais recentes${acuteOk ? '' : ' (ainda sem registros suficientes)'}` },
    { label: 'Seu último registro', value: fmt(lastPoint.value), note: entry.weekly ? `semana de ${dateBr(lastPoint.timestamp)}` : dateBr(lastPoint.timestamp) },
  ];

  // "Como você está?": análise detalhada deste indicador, em parágrafos (onde você está, para onde vai, o que isso quer dizer, último registro).
  const scaleText = scale && scale.max > scale.min ? ` (escala de ${fmtNum(scale.min)} a ${fmtNum(scale.max)})` : '';
  const where = level
    ? `${cap(entry.name)}: a sua média é ${meanText}${scaleText}, o que coloca esse indicador num nível ${LEVEL_WORD[level]}.`
    : band
      ? `${cap(entry.name)}: a sua média é ${meanText}${scaleText}, uma posição ${band === 'high' ? 'alta' : band === 'low' ? 'baixa' : 'intermediária'} na escala.`
      : `${cap(entry.name)}: a sua média é ${meanText}.`;
  const compareWord = (value: number, base: number) => {
    const threshold = Math.abs(base) * CHANGE_FRACTION;
    return Math.abs(value - base) < threshold || threshold === 0 ? 'praticamente igual' : value > base ? 'acima' : 'abaixo';
  };
  const going = acuteOk && chronicOk
    ? `Para onde você está indo: a média dos ${acuteSize} ${unitWord} mais recentes é ${fmt(ac.acute.value as number)}, contra ${fmt(ac.chronic.value as number)} na média dos ${chronicSize} mais recentes. A recente está ${compareWord(ac.acute.value as number, ac.chronic.value as number)} da de longo prazo.${trendText ? ` ${trendText}` : ''}`
    : `Para onde você está indo: ainda não há registros suficientes para comparar o curto e o longo prazo.${trendText ? ` ${trendText}` : ''}`;
  const lastVsMean = compareWord(lastPoint.value, overall);
  const lastLine = `O seu último registro foi ${fmt(lastPoint.value)} (${dateBr(lastPoint.timestamp)}), ${lastVsMean === 'praticamente igual' ? 'em linha com a sua média' : `${lastVsMean} da sua média`}.`;
  const howYouAre = [where, going, ...(meaning ? [meaning] : []), lastLine, 'Esse é um dos dados que cruzamos com os demais para ajustar os seus treinos.'];

  return {
    variableId: entry.variableId, name: entry.name, status: 'ok', bucket, level, mean: overall, n: recent.length, short, long,
    texts: { whatItMeasures, habitual, trend: trendText, meaning },
    guide: { whatIs: whatItMeasures, howToRead: howToReadText(entry, scale, !!entry.weekly), numbers, howYouAre, limitations: limitationsText(entry, recent.length, { weekly: !!entry.weekly, insufficient: false, provenanceNote }) },
  };
}

export interface AreaGuide { whatIs: string[]; howToRead: string; numbers: GuideRow[]; howYouAre: string[]; limitations: string[] }

export interface AreaSummary {
  id: AreaId;
  title: string;
  counts: { good: number; steady: number; attention: number; tracked: number; insufficient: number; evaluated: number };
  text: string;
  meaning: string | null;
  indicators: IndicatorResult[];
  guide: AreaGuide;
}

const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`);

// Card da ÁREA (14/11/2026, desenho de Elton): "O que é?", "Como interpretar?", "Quais são os seus números?", "Como você está?" (análise detalhada e CRUZADA dos indicadores) e "Limitações".
function buildAreaGuide(id: AreaId, indicators: IndicatorResult[], text: string, meaning: string | null, counts: AreaSummary['counts']): AreaGuide {
  const info = AREA_INFO[id];
  const catalog = (variableId: string) => READING_CATALOG.find((entry) => entry.variableId === variableId);
  const whatIs = [info.whatIs, ...indicators.map((indicator) => catalog(indicator.variableId)?.scaleText).filter((line): line is string => !!line)];

  const numbers: GuideRow[] = indicators.map((indicator) => {
    const byLabel = (label: string) => indicator.guide.numbers.find((row) => row.label === label)?.value ?? '—';
    if (indicator.status !== 'ok') return { label: cap(indicator.name), value: 'poucos registros', note: 'ainda não há registros suficientes' };
    return { label: cap(indicator.name), value: `média ${byLabel('Sua média')}`, note: `curto prazo ${byLabel('Tendência de curto prazo')} · longo prazo ${byLabel('Tendência de longo prazo')} · último ${byLabel('Seu último registro')}` };
  });

  const ok = indicators.filter((indicator) => indicator.status === 'ok');
  const good = ok.filter((indicator) => indicator.bucket === 'good').map((indicator) => indicator.name);
  const attention = ok.filter((indicator) => indicator.bucket === 'attention').map((indicator) => indicator.name);
  const steady = ok.filter((indicator) => indicator.bucket === 'steady').map((indicator) => indicator.name);
  const tracked = ok.filter((indicator) => indicator.bucket === 'tracked');
  const missing = indicators.filter((indicator) => indicator.status !== 'ok').map((indicator) => indicator.name);

  const howYouAre: string[] = [text];
  for (const indicator of ok) {
    const lead = indicator.texts.meaning ?? indicator.texts.trend ?? indicator.texts.habitual;
    howYouAre.push(`${cap(indicator.name)} (${indicator.guide.numbers[0].value}): ${lead}`);
  }
  // cruzamento entre indicadores (regra): o que vários sinais juntos dizem
  if (counts.evaluated >= 2 && attention.length >= 2) {
    howYouAre.push(`Lendo em conjunto: ${joinNames(attention)} apontam para a mesma direção de atenção. Quando mais de um sinal aponta para o mesmo lado, a leitura ganha peso: não é um número isolado, é um padrão.`);
  } else if (counts.evaluated >= 2 && good.length >= 2 && attention.length === 0) {
    howYouAre.push(`Lendo em conjunto: ${joinNames(good)} vão bem ao mesmo tempo. Um reforça o outro, o que dá mais firmeza à leitura de que esta área está favorecendo o seu treino.`);
  } else if (good.length >= 1 && attention.length >= 1) {
    howYouAre.push(`Lendo em conjunto: ${joinNames(good)} vão bem, enquanto ${joinNames(attention)} pedem atenção. A sua situação tem pontos fortes e pontos a cuidar, e é esse cruzamento que usamos para decidir onde ajustar.`);
  } else if (steady.length > 0 && attention.length === 0 && good.length === 0) {
    howYouAre.push(`Lendo em conjunto: ${joinNames(steady)} estão num nível intermediário ou estável, sem sinal forte para nenhum dos lados neste momento.`);
  }
  const worsening = tracked.filter((indicator) => indicator.short?.verdict === 'above' || indicator.short?.verdict === 'below' || indicator.long?.verdict === 'above' || indicator.long?.verdict === 'below');
  if (tracked.length > 0) {
    const moving = worsening.map((indicator) => `${indicator.name} (${indicator.texts.trend?.replace(/^A tendência (mostra )?/, '').replace(/\.$/, '') ?? 'em mudança'})`);
    howYouAre.push(moving.length > 0
      ? `Entre os indicadores que apenas acompanhamos, há mudança em: ${joinNames(moving)}. Eles não são bons nem ruins por si só, mas ajudam a entender o contexto dos demais.`
      : `Os indicadores que apenas acompanhamos (${joinNames(tracked.map((indicator) => indicator.name))}) estão estáveis, o que ajuda a dar contexto aos demais.`);
  }
  if (missing.length > 0) howYouAre.push(`Ainda sem leitura por falta de registros: ${joinNames(missing)}.`);
  if (meaning) howYouAre.push(meaning);
  howYouAre.push('É assim que cruzamos os seus dados para montar treinos mais assertivos: cada indicador é uma parte de um todo, e o conjunto diz mais do que qualquer número sozinho.');

  const limitations = [
    'Isto não é diagnóstico e não substitui a avaliação de um médico.',
    'Um dado sozinho não define o seu estado: aqui olhamos tendências, sempre junto com os demais dados.',
    'Só entram registros desde 01/08/2026.',
    ...(missing.length > 0 ? [`Alguns indicadores ainda não têm registros suficientes: ${joinNames(missing)}.`] : []),
    ...(tracked.length > 0 ? ['Alguns indicadores são apenas acompanhados, porque dependem da intenção dos seus treinos.'] : []),
    ...(indicators.some((indicator) => READING_CATALOG.find((entry) => entry.variableId === indicator.variableId)?.wearable) ? ['Os dados do relógio são estimativas do aparelho, não medidas clínicas, e muda de uma marca para outra.'] : []),
    ...(indicators.some((indicator) => SELF_REPORTED_PREFIXES.some((prefix) => indicator.variableId.startsWith(prefix))) ? ['Boa parte dos dados desta área é informada por você, então reflete a sua percepção no momento do registro.'] : []),
  ];
  return { whatIs, howToRead: info.howToRead, numbers, howYouAre, limitations };
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
    const earlyText = `Nesse quesito (${area.title.toLowerCase()}), ainda não há registros suficientes para avaliar o seu padrão.${tracked}`;
    return { id, title: area.title, counts, text: earlyText, meaning: null, indicators, guide: buildAreaGuide(id, indicators, earlyText, null, counts) };
  }
  const parts: string[] = [];
  if (counts.good > 0) parts.push(`${counts.good} ${plural(counts.good, 'apresenta', 'apresentam')} melhora ou padrão bom`);
  if (counts.steady > 0) parts.push(`${counts.steady} ${plural(counts.steady, 'está', 'estão')} em nível intermediário ou estável`);
  if (counts.attention > 0) parts.push(`${counts.attention} ${plural(counts.attention, 'apresenta', 'apresentam')} piora ou padrão que merece atenção`);
  const tracked = counts.tracked > 0 ? ` ${counts.tracked === 1 ? 'Outro' : 'Outros'} ${counts.tracked} ${plural(counts.tracked, 'indicador é apenas acompanhado', 'indicadores são apenas acompanhados')}, porque ${counts.tracked === 1 ? 'depende' : 'dependem'} da intenção dos treinos.` : '';
  const missing = counts.insufficient > 0 ? ` ${counts.insufficient} ${plural(counts.insufficient, 'indicador ainda não tem', 'indicadores ainda não têm')} registros suficientes.` : '';
  const text = `Nesse quesito (${area.title.toLowerCase()}), dos ${counts.evaluated} ${plural(counts.evaluated, 'indicador avaliado', 'indicadores avaliados')}, ${parts.join('; ')}.${tracked}${missing}`;
  const meaning = counts.good / counts.evaluated >= 0.6 ? area.meaning.favorable : counts.attention / counts.evaluated >= 0.4 ? area.meaning.attention : area.meaning.mixed;
  return { id, title: area.title, counts, text, meaning, indicators, guide: buildAreaGuide(id, indicators, text, meaning, counts) };
}

export const EVOLUTION_SUMMARY_META = { version: EVOLUTION_READING_VERSION, status: EVOLUTION_READING_STATUS, since: EVOLUTION_SINCE.toISOString().slice(0, 10) } as const;
export { READING_CATALOG };
