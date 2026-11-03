import type { AcuteChronic } from './acute-chronic';
import { HR_DECOUPLING_CATEGORIES, HR_DECOUPLING_CATEGORY_LABELS, type HrDecouplingCategory } from './hr-decoupling';
import type { ReferencePoint, ReferenceSeries } from './reference-series';

// Contexto da IA para "o que vem acontecendo recentemente" (03/11/2026, Lote 3 da ordem do desacoplamento da FC). Funções PURAS que montam, sem calcular nada novo, texto curto sobre:
//   (a) desacoplamento da FC por faixa de duração, só nas corridas dos últimos 7 dias (comparação com as corridas ANTERIORES da mesma faixa; mínimo de 5 anteriores);
//   (b) aguda (7 registros) × crônica (28 registros) dos indicadores que já estão no contexto, só quando existe mudança de lado.
// A matemática é do servidor (hr-decoupling.ts, reference-series.ts, acute-chronic.ts); a IA recebe a leitura pronta e INTERPRETA junto com o conjunto. Nada aqui decide treino, carga ou risco.

export const AI_RECENT_DAYS = 7;
/** Mesma regra da tela da aluna (apps/mobile/home/hrDecouplingInfo.ts): menos corridas anteriores na faixa, a comparação com o histórico não existe. */
export const HR_DECOUPLING_MIN_PRIOR_RUNS = 5;
/**
 * A leitura cadastrada (variable-reading-guide.ts) ainda está em `rascunho_a_revisar` por Elton. Enquanto estiver, ela chega à IA só como HIPÓTESE, marcada como tal, e só nos indicadores cuja média
 * aguda saiu da faixa habitual do próprio aluno. Colocar false tira a leitura do contexto da IA (os números continuam).
 */
export const AI_INCLUDES_READING_GUIDE = true;

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const pt = (value: number) => round(value, 1).toString().replace('.', ',');

const SIGNAL_TEXT: Record<ReferencePoint['signal'], string> = { above: 'acima_da_faixa_habitual', below: 'abaixo_da_faixa_habitual', within: 'dentro_da_faixa_habitual', no_reference: 'sem_referencia' };
const BASIS_TEXT: Record<ReferencePoint['band']['basis'], string> = { individual: 'individual', limited: 'limitada_poucas_corridas', none: 'sem_faixa' };

export interface HrDecouplingBandInput {
  category: HrDecouplingCategory;
  reference: Pick<ReferenceSeries, 'points'> | null | undefined;
  acuteChronic: Pick<AcuteChronic, 'direction'> | null | undefined;
}

function runBlock(point: ReferencePoint) {
  const base = { data: point.timestamp.slice(0, 10), desacoplamentoPct: round(point.value, 1), corridasAnterioresNaFaixa: point.priorN };
  if (point.priorN < HR_DECOUPLING_MIN_PRIOR_RUNS) {
    return { ...base, comparacao: `indisponivel: so ha ${point.priorN} corrida(s) anterior(es) na faixa; a comparacao comeca com ${HR_DECOUPLING_MIN_PRIOR_RUNS}` };
  }
  const { lower, upper, basis } = point.band;
  return {
    ...base,
    posicaoNaFaixaHabitual: SIGNAL_TEXT[point.signal],
    faixaHabitualPct: basis === 'none' || lower == null || upper == null ? null : { inferior: round(lower, 1), superior: round(upper, 1), base: BASIS_TEXT[basis] },
    mediaHistoricaAnteriorPct: point.historicalMean.value == null ? null : round(point.historicalMean.value, 1),
  };
}

function bandSummary(label: string, points: ReferencePoint[], direction: AcuteChronic['direction'] | undefined): string {
  const count = `${points.length} ${points.length === 1 ? 'corrida' : 'corridas'}`;
  const parts = points.map((point) => {
    if (point.priorN < HR_DECOUPLING_MIN_PRIOR_RUNS) return `${pt(point.value)}% (sem base para comparar: ${point.priorN} anterior(es))`;
    const side = point.signal === 'above' ? 'acima do habitual' : point.signal === 'below' ? 'abaixo do habitual' : point.signal === 'within' ? 'dentro do habitual' : 'sem faixa habitual';
    return `${pt(point.value)}% (${side})`;
  });
  const trend =
    direction === 'acute_above' ? 'media dos 7 registros mais recentes da faixa acima da dos 28'
    : direction === 'acute_below' ? 'media dos 7 registros mais recentes da faixa abaixo da dos 28'
    : direction === 'equal' ? 'media dos 7 mais recentes igual a dos 28'
    : 'sem comparacao de tendencia (menos de 28 corridas na faixa)';
  return `${label}: ${count} na semana — ${parts.join('; ')}. Tendencia: ${trend}.`;
}

/** Bloco `desacoplamentoFC`. null = nenhuma corrida elegível (com série suficiente) nos últimos 7 dias; ausência nunca vira zero nem bloco vazio. */
export function buildHrDecouplingContext(bands: HrDecouplingBandInput[], now: Date) {
  const since = now.getTime() - AI_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const faixas: Array<Record<string, unknown>> = [];
  for (const category of HR_DECOUPLING_CATEGORIES) {
    const band = bands.find((b) => b.category === category);
    const points = (band?.reference?.points ?? []).filter((p) => { const time = Date.parse(p.timestamp); return time >= since && time <= now.getTime(); });
    if (!band || points.length === 0) continue;
    const label = HR_DECOUPLING_CATEGORY_LABELS[category];
    faixas.push({
      faixaDeDuracao: label,
      corridasNaSemana: points.map(runBlock),
      tendenciaAgudaCronica: band.acuteChronic?.direction ?? 'insufficient',
      resumo: bandSummary(label, points, band.acuteChronic?.direction),
    });
  }
  if (faixas.length === 0) return null;
  return {
    metodo: 'Desacoplamento da FC = 100 x (1 - R2/R1), R = velocidade/FC media de cada metade (mesma duracao) da corrida; so entram corridas com ritmo estavel (CV da velocidade <= 10% e diferenca entre metades <= 5%), calculadas pelo sistema. Positivo = a FC subiu mais na segunda metade para o mesmo ritmo.',
    janela: `corridas dos ultimos ${AI_RECENT_DAYS} dias ate ${now.toISOString().slice(0, 10)}; cada uma comparada SO com as corridas ANTERIORES da MESMA faixa de duracao (a propria corrida nao entra na referencia)`,
    faixas,
    aviso: `faixas de duracao nunca se comparam entre si; a comparacao so existe com ${HR_DECOUPLING_MIN_PRIOR_RUNS} ou mais corridas anteriores na faixa; faixa sem corrida na semana nao aparece (ausencia nao e zero); posicao na faixa e DESCRITIVA, nao e melhora, piora nem risco`,
  };
}

export type HrDecouplingContext = NonNullable<ReturnType<typeof buildHrDecouplingContext>>;

export interface AcuteChronicIndicatorInput {
  variableId: string;
  acuteChronic: AcuteChronic | null | undefined;
}

const DIRECTION_TEXT: Record<'acute_above' | 'acute_below', string> = { acute_above: 'aguda_acima_da_cronica', acute_below: 'aguda_abaixo_da_cronica' };
const RANGE_TEXT: Record<AcuteChronic['acuteVsHabitualRange'], string> = { above: 'acima_da_faixa_habitual', below: 'abaixo_da_faixa_habitual', within: 'dentro_da_faixa_habitual', no_reference: 'sem_faixa' };

/** Bloco `agudaCronica7x28`. Só os indicadores com as duas janelas completas E mudança de lado; os demais não ocupam espaço (ausência de linha = sem 28 registros ou sem diferença). null = nenhum. */
export function buildAcuteChronicContext(indicators: AcuteChronicIndicatorInput[]) {
  const itens: Array<Record<string, unknown>> = [];
  for (const { variableId, acuteChronic: ac } of indicators) {
    if (!ac || (ac.direction !== 'acute_above' && ac.direction !== 'acute_below') || ac.acute.value == null || ac.chronic.value == null) continue;
    const outsideRange = ac.acuteVsHabitualRange === 'above' || ac.acuteVsHabitualRange === 'below';
    itens.push({
      id: variableId,
      aguda: round(ac.acute.value),
      cronica: round(ac.chronic.value),
      ...(ac.relativeDifferencePct != null ? { diferencaPct: round(ac.relativeDifferencePct, 1) } : {}),
      direcao: DIRECTION_TEXT[ac.direction],
      mediaAgudaVsFaixaHabitual: RANGE_TEXT[ac.acuteVsHabitualRange],
      ...(AI_INCLUDES_READING_GUIDE && outsideRange && ac.reading ? { hipoteseCadastrada: ac.reading.text } : {}),
    });
  }
  if (itens.length === 0) return null;
  return {
    comoLer: 'aguda = media dos 7 registros mais recentes (7 dias nos indicadores diarios); cronica = media dos 28 (28 dias); contam REGISTROS, independentemente do tempo que cobrem, e a aguda esta contida na cronica. Aguda acima ou abaixo da cronica indica MUDANCA DE TENDENCIA recente em relacao ao habito mais longo do proprio aluno: nao e melhora nem piora; o significado depende do indicador (mais desgaste, mais desempenho ou mais risco) e so se confirma com o conjunto. hipoteseCadastrada (quando presente, so se a media aguda saiu da faixa habitual) e uma leitura do treinador ainda em revisao: use como hipotese, nunca como conclusao.',
    ausenciaDeLinha: 'indicador que nao aparece aqui nao tem 28 registros completos ou nao tem diferenca entre aguda e cronica: nao e zero e nao e "normal"',
    indicadores: itens,
  };
}

export type AcuteChronicContext = NonNullable<ReturnType<typeof buildAcuteChronicContext>>;
