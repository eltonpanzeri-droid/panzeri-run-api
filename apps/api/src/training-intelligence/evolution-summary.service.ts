import { Injectable, Logger } from '@nestjs/common';
import { ObservationReaderService } from './observation-reader.service';
import { MathLayerService, type SeriesPoint } from './math-layer.service';
import { getVariableDefinition } from './variable-registry';
import { AREA_READING, EVOLUTION_SINCE, READING_CATALOG, type AreaId } from './evolution-reading-catalog';
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

@Injectable()
export class EvolutionSummaryService {
  private readonly logger = new Logger(EvolutionSummaryService.name);

  constructor(private readonly reader: ObservationReaderService, private readonly math: MathLayerService) {}

  async forStudent(userId: string): Promise<{ version: string; status: string; since: string; areas: AreaSummary[]; notes: string[] }> {
    const byArea = new Map<AreaId, IndicatorResult[]>();
    for (const entry of READING_CATALOG) {
      const definition = getVariableDefinition(entry.variableId);
      if (!definition) continue;
      let series: SeriesPoint[] = [];
      let provenanceNote: string | null = null;
      try {
        const observations = await this.reader.getObservations(userId, entry.variableId);
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
      } catch (error) {
        // um indicador que falha ao ler nao derruba a tela: entra como "dados insuficientes"
        this.logger.warn(`Evolucao: leitura de ${entry.variableId} falhou (${error instanceof Error ? error.message : String(error)}).`);
      }
      const result = buildIndicatorResult(entry, definition, series, this.math, new Date(), provenanceNote);
      byArea.set(entry.area, [...(byArea.get(entry.area) ?? []), result]);
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
}
