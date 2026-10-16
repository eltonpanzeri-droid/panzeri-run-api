// Canal de tendencia dos graficos da aluna (15/10/2026, pedido de Elton): faixa que ACOMPANHA a serie, no lugar da faixa fixa.
// Mesma regra do painel do treinador, mas na linguagem da aluna ("sua faixa habitual"): media da janela ± 2 desvios padrao da MESMA
// janela, so quando a janela esta completa. So apresentacao: nao altera nem grava nada.

export type ChannelPoint = { index: number; lower: number; upper: number; mean: number };

/** Canal sobre uma serie ordenada no tempo (semanas): media dos ultimos `size` valores validos ± 2 desvios; exige `size` valores. */
export function trailingChannel(values: Array<number | null>, size: number, bounds?: { min?: number; max?: number }): Array<ChannelPoint | null> {
  return values.map((value, index) => {
    if (value == null) return null;
    const windowValues: number[] = [];
    for (let j = Math.max(0, index - size + 1); j <= index; j += 1) {
      const other = values[j];
      if (other != null) windowValues.push(other);
    }
    if (windowValues.length < size) return null;
    const mean = windowValues.reduce((sum, v) => sum + v, 0) / windowValues.length;
    const deviation = Math.sqrt(windowValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / windowValues.length);
    return {
      index,
      mean,
      lower: Math.max(bounds?.min ?? 0, mean - 2 * deviation),
      upper: Math.min(bounds?.max ?? Infinity, mean + 2 * deviation),
    };
  });
}

/** Media das ultimas 3 semanas (21 dias exatos), nula enquanto nao ha 3 semanas validas. */
export function threeWeekMean(values: Array<number | null>): Array<number | null> {
  return values.map((_, index) => {
    if (index < 2) return null;
    const window = [values[index], values[index - 1], values[index - 2]];
    if (window.some((v) => v == null)) return null;
    return (window as number[]).reduce((sum, v) => sum + v, 0) / 3;
  });
}

/** Canal por DIA (serie de registros com x em dias): janela de 21 dias; se houver menos de 8 registros, estende ate os 8 ultimos
 *  (no maximo 120 dias, para series semanais). Sem 8 registros, nao ha canal naquele ponto. */
export function dayChannel(
  points: Array<{ x: number; y: number }>,
  bounds?: { min?: number; max?: number },
): Array<{ x: number; lower: number; upper: number; mean: number }> {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const result: Array<{ x: number; lower: number; upper: number; mean: number }> = [];
  for (const point of sorted) {
    const upTo = sorted.filter((p) => p.x <= point.x);
    let windowValues = upTo.filter((p) => p.x > point.x - 21).map((p) => p.y);
    if (windowValues.length < 8) windowValues = upTo.filter((p) => p.x > point.x - 120).slice(-8).map((p) => p.y);
    if (windowValues.length < 8) continue;
    const mean = windowValues.reduce((sum, v) => sum + v, 0) / windowValues.length;
    const deviation = Math.sqrt(windowValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / windowValues.length);
    result.push({ x: point.x, mean, lower: Math.max(bounds?.min ?? -Infinity, mean - 2 * deviation), upper: Math.min(bounds?.max ?? Infinity, mean + 2 * deviation) });
  }
  return result;
}

/** A semana (segunda a domingo, a partir de `weekStart` AAAA-MM-DD) ainda esta em andamento em `todayIso`? */
export function isWeekInProgress(weekStart: string, todayIso: string): boolean {
  const start = weekStart.slice(0, 10);
  const end = new Date(`${start}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return start <= todayIso && end.toISOString().slice(0, 10) >= todayIso;
}
