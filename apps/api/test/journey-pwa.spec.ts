import { JourneyStorage, parseJourneyFromSearch, resolveJourney } from '../../mobile/src/journey';

// Regra de continuidade da jornada no PWA (modulo puro compartilhado com apps/mobile/App.tsx).

const memoryStorage = (initial: Record<string, string> = {}): JourneyStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k) => (data.has(k) ? data.get(k)! : null),
    setItem: async (k, v) => { data.set(k, v); },
  };
};
const KEY = 'panzeri-run-journey-id';
let counter = 0;
const newId = () => `generated-${++counter}-aaaaaaaa`;

describe('PWA: continuidade da jornada (G/H)', () => {
  it('journey_id vindo da URL (clique na Landing) e adotado e persistido', async () => {
    const storage = memoryStorage();
    const r = await resolveJourney(storage, KEY, parseJourneyFromSearch('?utm_source=instagram&journey_id=landing-journey-1'), newId);
    expect(r).toEqual({ journeyId: 'landing-journey-1', aliasFrom: null, adoptedFromUrl: true });
    expect(storage.data.get(KEY)).toBe('landing-journey-1');
  });

  it('reabrir o app depois (sem journey_id na URL): mesma jornada, nada novo criado', async () => {
    const storage = memoryStorage({ [KEY]: 'landing-journey-1' });
    const r = await resolveJourney(storage, KEY, null, newId);
    expect(r).toEqual({ journeyId: 'landing-journey-1', aliasFrom: null, adoptedFromUrl: false });
  });

  it('entrada direta no PWA (sem Landing): cria uma jornada propria e a reaproveita depois', async () => {
    const storage = memoryStorage();
    const first = await resolveJourney(storage, KEY, null, newId);
    const second = await resolveJourney(storage, KEY, null, newId);
    expect(first.journeyId).toMatch(/^generated-/);
    expect(second.journeyId).toBe(first.journeyId);
  });

  it('URL traz jornada DIFERENTE da guardada: adota a da URL e preserva a anterior como alias (elo comprovado)', async () => {
    const storage = memoryStorage({ [KEY]: 'pwa-own-journey-9' });
    const r = await resolveJourney(storage, KEY, 'landing-journey-2', newId);
    expect(r).toEqual({ journeyId: 'landing-journey-2', aliasFrom: 'pwa-own-journey-9', adoptedFromUrl: true });
    expect(storage.data.get(KEY)).toBe('landing-journey-2');
  });

  it('mesma jornada na URL e no storage: sem alias', async () => {
    const storage = memoryStorage({ [KEY]: 'same-journey-1' });
    const r = await resolveJourney(storage, KEY, 'same-journey-1', newId);
    expect(r.aliasFrom).toBeNull();
  });

  it('journey_id malformado/curto/com caracteres invalidos e IGNORADO (nunca vira identidade)', () => {
    expect(parseJourneyFromSearch('?journey_id=abc')).toBeNull();                 // curto demais
    expect(parseJourneyFromSearch('?journey_id=<script>alert(1)</script>')).toBeNull();
    expect(parseJourneyFromSearch('?journey_id=' + 'a'.repeat(65))).toBeNull();
    expect(parseJourneyFromSearch('?journey_id=valid-id_12345')).toBe('valid-id_12345');
    expect(parseJourneyFromSearch('')).toBeNull();
    expect(parseJourneyFromSearch(undefined)).toBeNull();
  });

  it('valor invalido guardado no storage e descartado (gera nova, nao reutiliza lixo)', async () => {
    const storage = memoryStorage({ [KEY]: 'x' });
    const r = await resolveJourney(storage, KEY, null, newId);
    expect(r.journeyId).toMatch(/^generated-/);
  });
});
