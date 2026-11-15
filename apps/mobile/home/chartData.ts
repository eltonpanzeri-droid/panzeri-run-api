import type { SnapshotLite } from './insights';

// Conversao de observacoes do motor longitudinal em pontos de grafico. Eixo X = dias (fracionario)
// desde a epoca Unix, para o DetailChart gerar rotulos de data legiveis. Valores nao numericos
// (categoricos) e ausentes nunca viram ponto — e' ausencia, nunca zero.

const DAY_MS = 86400000;

export function dayFromIso(iso: string): number {
  return new Date(iso).getTime() / DAY_MS;
}

export function formatDayLabel(day: number): string {
  const d = new Date(Math.round(day * DAY_MS));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatDayLong(day: number): string {
  const d = new Date(Math.round(day * DAY_MS));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function observationPoints(snapshot: SnapshotLite): Array<{ x: number; y: number }> {
  return snapshot.observations
    .filter((o): o is typeof o & { value: number } => typeof o.value === 'number' && Number.isFinite(o.value))
    .map((o) => ({ x: dayFromIso(o.timestamp), y: o.value }))
    .sort((a, b) => a.x - b.x);
}

/**
 * Faixa habitual para o grafico: vem da serie de referencias do SERVIDOR (P10-P90 so' dos registros anteriores a cada ponto), a mesma do painel do treinador e a
 * mesma funcao de faixa habitual usada no texto. Nada e' calculado aqui. Ponto sem faixa sustentada (basis 'none') nao desenha faixa: ausencia nunca vira "normal".
 */
export function referenceChannelPoints(snapshot: SnapshotLite | null | undefined): Array<{ x: number; lower: number; upper: number; mean: number }> {
  const points = snapshot?.reference?.points ?? [];
  const out: Array<{ x: number; lower: number; upper: number; mean: number }> = [];
  for (const p of points) {
    const { lower, upper, median, basis } = p.band;
    if (basis === 'none' || lower == null || upper == null) continue;
    out.push({ x: dayFromIso(p.timestamp), lower, upper, mean: median ?? (lower + upper) / 2 });
  }
  return out.sort((a, b) => a.x - b.x);
}

const MODALITY_NAMES: Record<string, string> = { corrida: 'Corrida', forca: 'Força', fortalecimento_corredores: 'Fortalecimento' };

// Cor de cada modalidade (15/11/2026, pedido de Elton): a aluna vê que o texto muda com a modalidade. null = todas juntas.
const MODALITY_TINTS: Record<string, string> = { corrida: '#1769AA', forca: '#7C3AED', fortalecimento_corredores: '#0F766E' };
const EXTRA_TINTS = ['#C2410C', '#BE185D', '#4D7C0F', '#0E7490'];
export function modalityTint(modality: string | null): string {
  if (!modality) return '#0B2A4A';
  if (MODALITY_TINTS[modality]) return MODALITY_TINTS[modality];
  let hash = 0;
  for (const ch of modality) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return EXTRA_TINTS[hash % EXTRA_TINTS.length];
}

export function modalityName(modality: string): string {
  return MODALITY_NAMES[modality] ?? modality.charAt(0).toUpperCase() + modality.slice(1).replace(/_/g, ' ');
}

export function movingAveragePoints(snapshot: SnapshotLite, key = 'short_21d'): Array<{ x: number; y: number | null }> {
  const series = snapshot.movingAverageSeries?.[key] ?? [];
  return series.map((p) => ({ x: dayFromIso(p.timestamp), y: p.value })).sort((a, b) => a.x - b.x);
}
