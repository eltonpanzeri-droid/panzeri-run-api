import { Injectable, Logger } from '@nestjs/common';
import { ObservationReaderService } from './observation-reader.service';
import { MathLayerService, type SeriesPoint } from './math-layer.service';
import { getVariableDefinition } from './variable-registry';
import { AREA_READING, READING_CATALOG, type AreaId } from './evolution-reading-catalog';
import { EVOLUTION_SUMMARY_META, buildAreaSummary, buildIndicatorResult, type AreaSummary, type IndicatorResult } from './evolution-summary';

// Evolução da aluna: leitura por regra de cada indicador e síntese por área (13/11/2026). SOMENTE LEITURA, sempre com o id da aluna autenticada. Reaproveita o leitor de observações e a camada
// matemática existentes: nenhum cálculo novo de série. Os dados que a IA usa NÃO passam por aqui (a tela pode esconder gráficos sem afetar a IA).
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
      try {
        const observations = await this.reader.getObservations(userId, entry.variableId);
        series = observations.filter((o): o is typeof o & { value: number } => typeof o.value === 'number' && Number.isFinite(o.value)).map((o) => ({ value: o.value, timestamp: o.timestamp }));
      } catch (error) {
        // um indicador que falha ao ler nao derruba a tela: entra como "dados insuficientes"
        this.logger.warn(`Evolucao: leitura de ${entry.variableId} falhou (${error instanceof Error ? error.message : String(error)}).`);
      }
      const result = buildIndicatorResult(entry, definition, series, this.math);
      byArea.set(entry.area, [...(byArea.get(entry.area) ?? []), result]);
    }
    const areas = AREA_READING.map((area) => buildAreaSummary(area.id, byArea.get(area.id) ?? []));
    return {
      ...EVOLUTION_SUMMARY_META,
      areas,
      notes: [
        'A área de dor tem tela própria. Indicadores medidos por relógio (sono, variabilidade cardíaca, frequência de repouso) entram numa próxima etapa, por fonte de dados.',
      ],
    };
  }
}
