import { getVariableDefinition } from './variable-registry';

// Ritmo IMPOSSÍVEL (14/11/2026, ordem de Elton): um ritmo fora dos limites do próprio registro de variáveis (2:00 a 20:00 por km) é tratado como erro de registro, nunca como dado.
// Não é uma conta sobre o treino nem uma fórmula de prescrição: só barra o que fisicamente não acontece (ex.: 1:30/km digitado por engano). O valor NUNCA é alterado: o treino fica fora da média
// de ritmo da Evolução e a aluna é avisada para confirmar. Os limites vêm do registro (fonte única), não são repetidos aqui.
export function plausiblePaceRange(): { min: number; max: number } {
  const scale = getVariableDefinition('activity.avgPaceSecondsKm')?.scale;
  return { min: scale?.min ?? 120, max: scale?.max ?? 1200 };
}

export function isImpossiblePace(paceSecondsKm: number): boolean {
  const { min, max } = plausiblePaceRange();
  return !Number.isFinite(paceSecondsKm) || paceSecondsKm < min || paceSecondsKm > max;
}

/** Ritmo médio de um treino preenchido: tempo ÷ distância (o mesmo cálculo das atividades do relógio). Sem distância ou tempo válidos, usa o ritmo informado, se houver. */
export function paceFromEntry(distanceKm: number | null | undefined, durationMin: number | null | undefined, informedPace?: number | null): number | null {
  if (distanceKm != null && distanceKm > 0 && durationMin != null && durationMin > 0) return Math.round((durationMin * 60) / distanceKm);
  return informedPace != null && informedPace > 0 ? informedPace : null;
}

export function formatPaceText(paceSecondsKm: number): string {
  const total = Math.round(paceSecondsKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`;
}

export interface PaceProvenance { watch: number; manual: number; discarded: number }

/** Nota curta de procedência (no fim do texto; o professor explica o que o número significa, não a conta): quantos treinos vieram do relógio, quantos foram preenchidos e quantos ficaram de fora por ritmo impossível. */
export function paceProvenanceSentence(p: PaceProvenance): string | null {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const parts: string[] = [];
  if (p.watch > 0) parts.push(`${p.watch} ${plural(p.watch, 'treino do relógio', 'treinos do relógio')}`);
  if (p.manual > 0) parts.push(`${p.manual} ${plural(p.manual, 'preenchido', 'preenchidos')} por você`);
  if (parts.length === 0 && p.discarded === 0) return null;
  const used = parts.length ? `Base: ${parts.join(' e ')}.` : 'Nenhum treino válido entrou nesse ritmo.';
  const out = p.discarded > 0 ? ` ${p.discarded} ${plural(p.discarded, 'treino ficou de fora', 'treinos ficaram de fora')} por ritmo impossível: confira distância e tempo no registro.` : '';
  return `${used}${out}`;
}
