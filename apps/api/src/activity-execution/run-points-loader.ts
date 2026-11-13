import { PrismaService } from '../prisma/prisma.service';
import { estimatePointsFromRoute } from './gps-estimated-pace';

// Pontos de serie de uma corrida para o grafico e para a analise da faixa (13/11/2026). Le o MEDIDO; so' quando o relogio NAO entregou distancia/ritmo ao longo do treino e o percurso (GPS) existe,
// devolve o ritmo ESTIMADO (calculado aqui, na leitura, NUNCA gravado). Quem le a coluna de velocidade/distancia diretamente (recordes, desacoplamento da FC, carga) continua vendo so' o medido.
export type PaceSource = 'measured' | 'gps_estimated';
export interface RunPoint { offsetSec: number; distanceMeters: number | null; heartRateBpm: number | null; speedKmh: number | null; cadenceSpm: number | null }

// Texto mostrado a aluna e ao treinador (aprovado por Elton em 13/11/2026) e a versao curta para a IA.
export const ESTIMATED_PACE_STUDENT_NOTE = 'Ritmo estimado: o seu relógio não entregou o ritmo ao longo do treino, então nós o calculamos de forma indireta, pelo percurso de GPS. Esse cálculo pode apresentar mais erros do que a medição do relógio. Por isso ele aparece só como referência no gráfico e na análise da faixa, e não é usado para contabilizar recordes pessoais.';
export const ESTIMATED_PACE_AI_NOTE = 'Ritmo estimado pelo GPS (o relogio nao entregou a serie de ritmo): calculo indireto, menos preciso que a medicao do relogio; nao usar para decisoes finas nem para recordes pessoais.';

export async function loadRunPoints(
  prisma: PrismaService,
  activityLogId: string,
  normalizationVersion: number,
  measuredTotalMeters: number | null,
  options: { allowEstimate: boolean },
): Promise<{ points: RunPoint[]; paceSource: PaceSource | null }> {
  const rows = await prisma.activityTimeSeriesPoint.findMany({
    where: { activityLogId, normalizationVersion },
    orderBy: { offsetSec: 'asc' },
    select: { offsetSec: true, distanceMeters: true, heartRateBpm: true, speedKmh: true, cadenceSpm: true, latitude: true, longitude: true },
  });
  const plain: RunPoint[] = rows.map(({ offsetSec, distanceMeters, heartRateBpm, speedKmh, cadenceSpm }) => ({ offsetSec, distanceMeters, heartRateBpm, speedKmh, cadenceSpm }));
  if (rows.length === 0) return { points: plain, paceSource: null };
  const hasMeasuredPace = rows.some((row) => row.distanceMeters != null || row.speedKmh != null);
  if (hasMeasuredPace) return { points: plain, paceSource: 'measured' };
  if (!options.allowEstimate) return { points: plain, paceSource: null };

  const route = rows.filter((row) => row.latitude != null && row.longitude != null).map((row) => ({ offsetSec: row.offsetSec, latitude: row.latitude as number, longitude: row.longitude as number }));
  const estimated = estimatePointsFromRoute(route, { measuredTotalMeters });
  if (!estimated) return { points: plain, paceSource: null };
  // FC e cadencia MEDIDAS (se o relogio mandou so' elas) acompanham o estimado, por segundo
  const hr = new Map<number, number>();
  const cadence = new Map<number, number>();
  for (const row of rows) {
    if (row.heartRateBpm != null) hr.set(Math.round(row.offsetSec), row.heartRateBpm);
    if (row.cadenceSpm != null) cadence.set(Math.round(row.offsetSec), row.cadenceSpm);
  }
  return { points: estimated.map((point) => ({ ...point, heartRateBpm: hr.get(point.offsetSec) ?? null, cadenceSpm: cadence.get(point.offsetSec) ?? null })), paceSource: 'gps_estimated' };
}
