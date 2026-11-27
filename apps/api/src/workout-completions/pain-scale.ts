// Escala unica de dor do feedback do treino (28/11/2026, ordem de Elton). Pergunta: "sentiu dor?" Nao => 0; Sim => nota de 1 (dor muito leve) a 10 (dor extremamente forte).
// O dado ANTIGO (painFlag leve/moderado/forte) e CONVERTIDO por leitura, nunca reescrito no banco: leve = 3, moderado = 5, forte = 8 (decisao de Elton). 'none' = 0.
// painFlag continua gravado (derivado da nota) para a IA de prescricao, a analista, a Evolucao, o Telegram e o relatorio de ciclo seguirem funcionando sem mudanca.
// Funcoes puras, sem banco.

export const PAIN_INTENSITY_FROM_FLAG: Record<string, number> = { none: 0, leve: 3, moderado: 5, forte: 8 };
// Primeiro dia da escala nova (o corte "desde 30/11" do Observatorio usa o dado NATIVO, i.e. painIntensity preenchido).
export const PAIN_SCALE_START = '2026-11-30';

export type PainFlagValue = 'none' | 'leve' | 'moderado' | 'forte';

// Faixas para leitura em palavras: 1-3 leve, 4-6 moderada, 7-10 forte (as notas convertidas 3/5/8 caem uma em cada faixa).
export function painFlagFromIntensity(intensity: number): Exclude<PainFlagValue, 'none'> {
  return intensity <= 3 ? 'leve' : intensity <= 6 ? 'moderado' : 'forte';
}

export interface EffectivePain { value: number | null; native: boolean }
// Intensidade 0-10 de um feedback: a nota nova quando existe (native); senao a conversao do painFlag antigo (native=false); sem resposta => null (nunca presumir zero).
export function effectivePainIntensity(input: { painFlag?: string | null; painIntensity?: number | null }): EffectivePain {
  if (input.painIntensity != null) return { value: input.painIntensity, native: true };
  if (input.painFlag && input.painFlag in PAIN_INTENSITY_FROM_FLAG) return { value: PAIN_INTENSITY_FROM_FLAG[input.painFlag], native: false };
  return { value: null, native: false };
}

// Normaliza o que o cliente mandou. Cliente novo: painIntensity 1-10 (painFlag e derivado) ou painFlag 'none'. Cliente antigo (PWA em cache): so painFlag. Conflitos viram erro (pt-BR).
export function normalizePain(input: { painFlag?: string | null; painIntensity?: number | null }): { painFlag: string | null; painIntensity: number | null; error?: string } {
  const { painFlag, painIntensity } = input;
  if (painIntensity != null) {
    if (!Number.isInteger(painIntensity) || painIntensity < 1 || painIntensity > 10) return { painFlag: null, painIntensity: null, error: 'A nota da dor precisa ser um número de 1 a 10.' };
    if (painFlag === 'none') return { painFlag: null, painIntensity: null, error: 'Resposta de dor inconsistente: "não senti dor" e uma nota ao mesmo tempo.' };
    return { painFlag: painFlagFromIntensity(painIntensity), painIntensity };
  }
  return { painFlag: painFlag ?? null, painIntensity: null };
}
