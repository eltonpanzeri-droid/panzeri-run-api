// Local e horario da prova alvo (09/11/2026, ordem do Elton): a aluna informa cidade, UF (opcional) e horario da largada, alem da data. Dado guardado para uso futuro (indice de temperatura
// bulbo umido / WBGT na hora e no local da prova). Nao entra em nenhuma regra de treino: so' e' guardado e mostrado. Funcoes puras.

export interface RaceLocationInput { city?: string | null; state?: string | null; startTime?: string | null }
export interface RaceLocationData { city?: string | null; state?: string | null; startTime?: string | null }

export const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Normaliza so' o que foi enviado (undefined = nao mexe; null/vazio = limpa).
export function normalizeRaceLocation(input: RaceLocationInput): RaceLocationData {
  const out: RaceLocationData = {};
  if (input.city !== undefined) {
    const city = (input.city ?? '').replace(/\s+/g, ' ').trim();
    out.city = city ? city.slice(0, 80) : null;
  }
  if (input.state !== undefined) {
    const state = (input.state ?? '').trim().toUpperCase();
    out.state = state || null;
  }
  if (input.startTime !== undefined) {
    const time = (input.startTime ?? '').trim();
    out.startTime = time && START_TIME_PATTERN.test(time) ? time : null;
  }
  return out;
}

// "Contagem/MG, largada 06:00" | "Contagem, largada 06:00" | "largada 06:00" | null
export function formatRaceWhere(race: RaceLocationInput): string | null {
  const city = race.city?.trim();
  const state = race.state?.trim();
  const place = city ? (state ? `${city}/${state}` : city) : null;
  const time = race.startTime?.trim() ? `largada ${race.startTime.trim()}` : null;
  const parts = [place, time].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}
