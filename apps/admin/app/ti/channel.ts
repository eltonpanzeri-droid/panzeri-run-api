// Canal de tendencia (regra unica do app, 15/10/2026, pedido de Elton): faixa que ACOMPANHA a serie, no estilo das bandas de Bollinger.
// Para cada instante: janela = observacoes numericas dos ultimos 21 dias; se houver menos de 8, a janela se estende para tras ate
// reunir as 8 observacoes mais recentes (no maximo 120 dias, para series semanais). Sem 8 observacoes, nao ha canal naquele ponto.
// Centro = media da janela; limites = centro ± 2 desvios padrao (populacao) da mesma janela, cortados na escala do indicador.
// So' apresentacao: nao altera nem grava dado.
export type ChannelPoint = { at: number; lower: number; upper: number; mean: number };

const DAY_MS = 86400000;
export const CHANNEL_MIN_OBSERVATIONS = 8;

export function adaptiveChannel(
  observations: Array<{ timestamp: string; value: number | string }>,
  times: number[],
  scale?: { min: number; max: number } | null,
): ChannelPoint[] {
  const numeric = observations
    .filter((observation) => typeof observation.value === 'number')
    .map((observation) => ({ at: Date.parse(observation.timestamp), value: observation.value as number }))
    .filter((observation) => !Number.isNaN(observation.at))
    .sort((a, b) => a.at - b.at);
  const points: ChannelPoint[] = [];
  for (const at of [...times].sort((a, b) => a - b)) {
    const upTo = numeric.filter((observation) => observation.at <= at);
    let windowValues = upTo.filter((observation) => observation.at > at - 21 * DAY_MS).map((observation) => observation.value);
    if (windowValues.length < CHANNEL_MIN_OBSERVATIONS) {
      windowValues = upTo.filter((observation) => observation.at > at - 120 * DAY_MS).slice(-CHANNEL_MIN_OBSERVATIONS).map((observation) => observation.value);
    }
    if (windowValues.length < CHANNEL_MIN_OBSERVATIONS) continue;
    const mean = windowValues.reduce((sum, value) => sum + value, 0) / windowValues.length;
    const deviation = Math.sqrt(windowValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / windowValues.length);
    points.push({
      at,
      mean,
      lower: Math.max(scale?.min ?? -Infinity, mean - 2 * deviation),
      upper: Math.min(scale?.max ?? Infinity, mean + 2 * deviation),
    });
  }
  return points;
}
