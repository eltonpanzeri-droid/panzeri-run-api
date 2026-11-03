// Aguda × crônica (03/11/2026, ordem de Elton): para qualquer indicador numérico, compara a média das 7 observações MAIS RECENTES (aguda) com a média das 28 mais recentes (crônica). Mesma
// função de média móvel da camada longitudinal (MathLayerService.movingAverage), só com a janela de 28 que o padrão (7/21/60/200) não tinha. Descritiva: não define limite de risco, não diz se
// a mudança é boa ou ruim e não decide carga. O significado de "agudo acima/abaixo do crônico" em cada indicador vem do cadastro variable-reading-guide.ts (metodologia de Elton).
//
// Janelas por NÚMERO de registros (sessões, semanas, ciclos), independentemente do tempo que cobrem: a data de início e de fim de cada janela acompanha o resultado para quem lê saber o quanto
// "recente" realmente é. Indicadores diários/noturnos usam 7 e 28 DIAS corridos. A aguda está contida na crônica (as janelas se sobrepõem) e isso é dito no texto metodológico.
// "Quantidade suficiente" = as duas janelas completas (7 e 28 registros; ou janelas de dias que não começam antes do primeiro dado); senão nada é comparado e o motivo é explícito.

import { MathLayerService, SeriesPoint, WindowSpec } from './math-layer.service';
import { referenceUnitOf, type ReferenceUnit } from './reference-series';
import type { VariableDefinition } from './variable-registry';
import { readingFor, type ReadingGuideStatus } from './variable-reading-guide';

export const ACUTE_SIZE = 7;
export const CHRONIC_SIZE = 28;

export interface AcuteChronicWindow {
  value: number | null;
  n: number;
  size: number;
  windowStart: string | null;
  windowEnd: string | null;
  complete: boolean;
}

export type AcuteChronicDirection = 'acute_above' | 'acute_below' | 'equal' | 'insufficient';
export type AcuteVsHabitualRange = 'above' | 'below' | 'within' | 'no_reference';

export interface AcuteChronic {
  version: 1;
  unit: ReferenceUnit;
  windowKind: WindowSpec['kind'];
  acute: AcuteChronicWindow;
  chronic: AcuteChronicWindow;
  /** aguda − crônica (mesma unidade do indicador). Null sem janelas completas. */
  difference: number | null;
  /** (aguda − crônica) ÷ |crônica| × 100. Null sem janelas completas ou com crônica igual a zero. */
  relativeDifferencePct: number | null;
  direction: AcuteChronicDirection;
  /** Onde a média aguda fica em relação à faixa habitual do próprio aluno (P10–P90). Posição, não julgamento. */
  acuteVsHabitualRange: AcuteVsHabitualRange;
  /** Cadastro de leitura do indicador para a direção atual (null quando o indicador não tem cadastro ou a direção é 'equal'/'insufficient'). */
  reading: { text: string; status: ReadingGuideStatus } | null;
  note: string;
}

const NOTE =
  'Aguda = média dos 7 registros mais recentes; crônica = média dos 28 mais recentes (a aguda está contida na crônica). Compara o que vem acontecendo recentemente com o hábito mais longo do próprio aluno; descreve, não classifica em bom ou ruim.';

function windowOf(math: MathLayerService, series: SeriesPoint[], spec: WindowSpec): AcuteChronicWindow {
  const result = math.movingAverage(series, spec);
  return {
    value: result.value,
    n: result.n,
    size: spec.size,
    windowStart: result.windowStart ? result.windowStart.toISOString() : null,
    windowEnd: result.windowEnd ? result.windowEnd.toISOString() : null,
    complete: !result.isPartialWindow && result.n > 0,
  };
}

export function buildAcuteChronic(
  math: MathLayerService,
  series: SeriesPoint[],
  definition: Pick<VariableDefinition, 'variableId' | 'expectedFrequency'>,
  habitualRange: { lower: number | null; upper: number | null } | null | undefined,
): AcuteChronic {
  const unit = referenceUnitOf(definition);
  const kind: WindowSpec['kind'] = unit === 'dias' || unit === 'noites' ? 'calendar_days' : 'observation_count';
  const acute = windowOf(math, series, { kind, size: ACUTE_SIZE });
  const chronic = windowOf(math, series, { kind, size: CHRONIC_SIZE });
  const sufficient = acute.complete && chronic.complete && acute.value != null && chronic.value != null;

  const difference = sufficient ? (acute.value as number) - (chronic.value as number) : null;
  const relativeDifferencePct = difference != null && (chronic.value as number) !== 0 ? (100 * difference) / Math.abs(chronic.value as number) : null;
  const direction: AcuteChronicDirection = difference == null ? 'insufficient' : difference > 0 ? 'acute_above' : difference < 0 ? 'acute_below' : 'equal';

  let acuteVsHabitualRange: AcuteVsHabitualRange = 'no_reference';
  if (acute.value != null && habitualRange?.lower != null && habitualRange.upper != null) {
    acuteVsHabitualRange = acute.value > habitualRange.upper ? 'above' : acute.value < habitualRange.lower ? 'below' : 'within';
  }

  const reading = direction === 'acute_above' || direction === 'acute_below' ? readingFor(definition.variableId, direction) : null;
  return { version: 1, unit, windowKind: kind, acute, chronic, difference, relativeDifferencePct, direction, acuteVsHabitualRange, reading, note: NOTE };
}
