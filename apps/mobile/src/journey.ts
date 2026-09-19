// journeyId — identidade LONGITUDINAL anonima do Panzeri Run (19/09/2026).
//
// Regra pura (sem React Native, sem rede) para decidir qual jornada este dispositivo usa:
//  1. Se a URL trouxe journey_id (clique na Landing), essa e' a jornada — Landing e PWA sao origens
//     diferentes (nao compartilham storage), entao o link e' o unico elo comprovado.
//  2. Senao, reaproveita a jornada ja guardada neste dispositivo.
//  3. Senao, cria uma nova. NUNCA funde jornadas sem elo explicito (sem inferencia probabilistica).
// Se a URL trouxer uma jornada DIFERENTE da guardada, o elo e' comprovado (este mesmo dispositivo viu
// as duas): adota a da URL e devolve a anterior em aliasFrom (registrada em app_opened).

export const JOURNEY_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface JourneyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface JourneyResolution {
  journeyId: string;
  // Jornada anterior deste dispositivo, quando a URL trouxe outra (elo deterministico). Senao null.
  aliasFrom: string | null;
  adoptedFromUrl: boolean;
}

export function parseJourneyFromSearch(search: string | undefined | null): string | null {
  if (!search) return null;
  const raw = new URLSearchParams(search).get('journey_id');
  const value = raw?.trim();
  return value && JOURNEY_ID_PATTERN.test(value) ? value : null;
}

export async function resolveJourney(
  storage: JourneyStorage,
  storageKey: string,
  urlJourney: string | null,
  newId: () => string,
): Promise<JourneyResolution> {
  const stored = await storage.getItem(storageKey);
  const storedValid = stored && JOURNEY_ID_PATTERN.test(stored) ? stored : null;
  if (urlJourney) {
    if (storedValid !== urlJourney) await storage.setItem(storageKey, urlJourney);
    return { journeyId: urlJourney, aliasFrom: storedValid && storedValid !== urlJourney ? storedValid : null, adoptedFromUrl: true };
  }
  if (storedValid) return { journeyId: storedValid, aliasFrom: null, adoptedFromUrl: false };
  const generated = newId();
  await storage.setItem(storageKey, generated);
  return { journeyId: generated, aliasFrom: null, adoptedFromUrl: false };
}
