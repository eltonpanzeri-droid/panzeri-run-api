import { Injectable, Logger } from '@nestjs/common';
import { ObservationReaderService } from './observation-reader.service';
import { MathLayerService, type SeriesPoint } from './math-layer.service';
import { getVariableDefinition } from './variable-registry';
import { AREA_READING, EVOLUTION_SINCE, READING_CATALOG, VOLUME_INCREASE_ID, type AreaId, type IndicatorReading } from './evolution-reading-catalog';
import { chooseMainSource } from './wearable-source';
import { isImpossiblePace, paceProvenanceSentence, type PaceProvenance } from './pace-plausibility';
import { EVOLUTION_SUMMARY_META, buildAreaSummary, buildIndicatorResult, type AreaSummary, type IndicatorResult } from './evolution-summary';

// Evolução da aluna: leitura por regra de cada indicador e síntese por área (13/11/2026). SOMENTE LEITURA, sempre com o id da aluna autenticada. Reaproveita o leitor de observações e a camada
// matemática existentes: nenhum cálculo novo de série. Os dados que a IA usa NÃO passam por aqui (a tela pode esconder gráficos sem afetar a IA).
// Dados do relógio: só a fonte PRINCIPAL da aluna (a ativa e mais constante; nunca mistura marcas) e, no sono, só a sessão principal de cada noite. Sem fonte identificada = tudo, como já era.
export function mainSourceOnly<T extends { timestamp: Date; context: { sourceKey?: string; sessionRole?: 'principal' | 'additional' } }>(rows: T[], now: Date = new Date()): T[] {
  const keys = new Set(rows.map((r) => r.context?.sourceKey).filter((k): k is string => !!k));
  if (keys.size === 0) return rows;
  const main = chooseMainSource([...keys].map((key) => ({ key, timestamps: rows.filter((r) => r.context?.sourceKey === key).map((r) => r.timestamp) })), null, now);
  return rows.filter((r) => r.context?.sourceKey === main && r.context?.sessionRole !== 'additional');
}

// Modalidade (15/11/2026, bug de Elton: o RPE não mudava ao trocar de modalidade): a MESMA regra do gráfico (getVariableSnapshot). Com modalidade pedida, só as observações dela; sem pedido,
// se a variável traz a série combinada marcada 'global' (carga semanal, aderência...), só ela, para nunca misturar o total com as modalidades; senão, tudo.
export function filterByModality<T extends { context: { modality?: string } }>(rows: T[], modality: string | null | undefined): T[] {
  if (modality) return rows.filter((o) => o.context?.modality === modality);
  return rows.some((o) => o.context?.modality === 'global') ? rows.filter((o) => o.context?.modality === 'global') : rows;
}

export type VolumeIncreaseBand = 'safe' | 'attention' | 'high';
// Faixas de cor do aumento semanal (ordem de Elton, 15/11/2026: verde para aumentos mais seguros, vermelho para os maiores). Referência geral de cor: não decide treino nem prescrição.
export const VOLUME_INCREASE_SAFE_UP_TO = 10;
export const VOLUME_INCREASE_ATTENTION_UP_TO = 20;
export const VOLUME_INCREASE_LEGEND: Array<{ band: VolumeIncreaseBand; label: string }> = [
  { band: 'safe', label: 'até +10% (ou redução)' },
  { band: 'attention', label: '+10% a +20%' },
  { band: 'high', label: 'acima de +20%' },
];
export function volumeIncreaseBand(pct: number | null): VolumeIncreaseBand | null {
  if (pct == null) return null;
  return pct <= VOLUME_INCREASE_SAFE_UP_TO ? 'safe' : pct <= VOLUME_INCREASE_ATTENTION_UP_TO ? 'attention' : 'high';
}
export interface VolumeIncreaseBar { weekStart: string; km: number; pct: number | null; band: VolumeIncreaseBand | null }

/** Aumento semanal do volume REALIZADO (semanas fechadas): variação % de cada semana sobre a anterior; semana anterior sem km não gera porcentagem. */
export function volumeIncreaseFromWeeks(weeks: Array<{ timestamp: Date; value: number }>): { points: SeriesPoint[]; bars: VolumeIncreaseBar[] } {
  const sorted = [...weeks].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const points: SeriesPoint[] = [];
  const bars: VolumeIncreaseBar[] = [];
  sorted.forEach((week, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    const pct = previous && previous.value > 0 ? ((week.value - previous.value) / previous.value) * 100 : null;
    bars.push({ weekStart: week.timestamp.toISOString().slice(0, 10), km: week.value, pct, band: volumeIncreaseBand(pct) });
    if (pct != null) points.push({ value: pct, timestamp: week.timestamp });
  });
  return { points, bars };
}

@Injectable()
export class EvolutionSummaryService {
  private readonly logger = new Logger(EvolutionSummaryService.name);

  constructor(private readonly reader: ObservationReaderService, private readonly math: MathLayerService) {}

  private definitionOf(entry: IndicatorReading) {
    if (entry.variableId === VOLUME_INCREASE_ID) return { variableId: VOLUME_INCREASE_ID, scale: undefined, expectedFrequency: 'per_week' as const };
    return getVariableDefinition(entry.variableId);
  }

  // Lê a série de UM indicador (opcionalmente filtrada por modalidade) e devolve o resultado por regra. Falha na leitura = "dados insuficientes", nunca derruba a tela.
  private async resultFor(userId: string, entry: IndicatorReading, modality: string | null): Promise<{ result: IndicatorResult; bars?: VolumeIncreaseBar[] } | null> {
    const definition = this.definitionOf(entry);
    if (!definition) return null;
    let series: SeriesPoint[] = [];
    let provenanceNote: string | null = null;
    let bars: VolumeIncreaseBar[] | undefined;
    try {
      if (entry.variableId === VOLUME_INCREASE_ID) {
        const base = await this.reader.getObservations(userId, 'training.volumeCompletedTotalKm');
        const cutoff = Date.now() - 7 * 86_400_000; // a semana em curso fica fora
        const weeks = filterByModality(base, null)
          .filter((o): o is typeof o & { value: number } => typeof o.value === 'number' && Number.isFinite(o.value))
          .filter((o) => o.timestamp.getTime() >= EVOLUTION_SINCE.getTime() && o.timestamp.getTime() <= cutoff)
          .map((o) => ({ timestamp: o.timestamp, value: o.value }));
        const built = volumeIncreaseFromWeeks(weeks);
        series = built.points;
        bars = built.bars;
      } else {
        const observations = filterByModality(await this.reader.getObservations(userId, entry.variableId), modality);
        let usable = observations.filter((o): o is typeof o & { value: number } => typeof o.value === 'number' && Number.isFinite(o.value));
        if (entry.wearable) usable = mainSourceOnly(usable);
        let points = usable.map((o) => ({ value: o.value, timestamp: o.timestamp }));
        if (entry.variableId === 'activity.avgPaceSecondsKm') {
          // Ritmo: relógio + treinos preenchidos pela aluna (sem relógio), sem ritmo impossível; a frase diz de onde veio cada parte. Falha na leitura dos preenchidos = só o relógio.
          let manual: SeriesPoint[] = [];
          try {
            manual = ((await this.reader.getManualPaceObservations?.(userId)) ?? []).filter((o): o is typeof o & { value: number } => typeof o.value === 'number').map((o) => ({ value: o.value, timestamp: o.timestamp }));
          } catch (error) {
            this.logger.warn(`Evolucao: leitura do ritmo preenchido falhou (${error instanceof Error ? error.message : String(error)}).`);
          }
          const since = EVOLUTION_SINCE.getTime();
          const counts: PaceProvenance = { watch: 0, manual: 0, discarded: 0 };
          const kept: SeriesPoint[] = [];
          for (const [list, key] of [[points, 'watch'], [manual, 'manual']] as const) {
            for (const p of list) {
              if (p.timestamp.getTime() < since) continue;
              if (isImpossiblePace(p.value)) counts.discarded += 1; else { counts[key] += 1; kept.push(p); }
            }
          }
          points = kept;
          provenanceNote = paceProvenanceSentence(counts);
        }
        series = points;
      }
    } catch (error) {
      this.logger.warn(`Evolucao: leitura de ${entry.variableId} falhou (${error instanceof Error ? error.message : String(error)}).`);
    }
    return { result: buildIndicatorResult(entry, definition, series, this.math, new Date(), provenanceNote), bars };
  }

  async forStudent(userId: string): Promise<{ version: string; status: string; since: string; areas: AreaSummary[]; notes: string[] }> {
    const byArea = new Map<AreaId, IndicatorResult[]>();
    for (const entry of READING_CATALOG) {
      if (entry.virtual) continue; // lidos por endpoint próprio (ex.: dor)
      const out = await this.resultFor(userId, entry, null);
      if (!out) continue;
      byArea.set(entry.area, [...(byArea.get(entry.area) ?? []), out.result]);
    }
    const areas = AREA_READING.map((area) => buildAreaSummary(area.id, byArea.get(area.id) ?? []));
    return {
      ...EVOLUTION_SUMMARY_META,
      areas,
      notes: [
        'A área de dor tem tela própria. Número de ciclos de sono e pontuação do sono ainda não entram: o relógio não envia o número de ciclos.',
      ],
    };
  }

  /** Um indicador, opcionalmente só de UMA modalidade (os cinco blocos sob o gráfico acompanham a modalidade escolhida). Indicador fora do catálogo = null. */
  async forIndicator(userId: string, variableId: string, modality: string | null): Promise<IndicatorResult | null> {
    const entry = READING_CATALOG.find((candidate) => candidate.variableId === variableId);
    if (!entry) return null;
    return (await this.resultFor(userId, entry, modality))?.result ?? null;
  }

  /** Aumento semanal do volume realizado: as barras (últimas semanas fechadas) e a leitura por regra desse indicador. */
  async volumeIncrease(userId: string): Promise<{ bars: VolumeIncreaseBar[]; legend: typeof VOLUME_INCREASE_LEGEND; indicator: IndicatorResult | null }> {
    const entry = READING_CATALOG.find((candidate) => candidate.variableId === VOLUME_INCREASE_ID);
    if (!entry) return { bars: [], legend: VOLUME_INCREASE_LEGEND, indicator: null };
    const out = await this.resultFor(userId, entry, null);
    return { bars: (out?.bars ?? []).slice(-12), legend: VOLUME_INCREASE_LEGEND, indicator: out?.result ?? null };
  }
}
