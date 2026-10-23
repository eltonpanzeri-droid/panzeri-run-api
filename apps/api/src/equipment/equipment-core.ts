// Equipamentos (23/10/2026) — NUCLEO PURO (sem banco, sem Nest): faixas de distancia, pace por totais, deteccao de prova, normalizacao de nomes e extracao de dispositivo.
// Estatistica DESCRITIVA e aritmetica de integridade; nada aqui prescreve treino nem sugere causalidade entre equipamento e desempenho.

// ── Faixas de distancia (exclusivas: uma corrida cai em UMA so') ───────────────────────────────────────────────────
export const DISTANCE_BANDS = [
  { key: 'ate_5', label: 'Até 5 km', min: 0, max: 5 },
  { key: '5_10', label: 'De 5 a 10 km', min: 5, max: 10 },
  { key: '10_15', label: 'De 10 a 15 km', min: 10, max: 15 },
  { key: '15_25', label: 'De 15 a 25 km', min: 15, max: 25 },
  { key: '25_30', label: 'De 25 a 30 km', min: 25, max: 30 },
  { key: '30_40', label: 'De 30 a 40 km', min: 30, max: 40 },
  { key: 'acima_40', label: 'Acima de 40 km', min: 40, max: Infinity },
] as const;
export type DistanceBandKey = (typeof DISTANCE_BANDS)[number]['key'];
export const DISTANCE_BAND_KEYS: DistanceBandKey[] = DISTANCE_BANDS.map((b) => b.key);

// Intervalos (min, max]: o limite superior pertence a faixa de baixo ("até 5" inclui 5,00; 5,01 e' "de 5 a 10"). Distancia ausente/invalida/<=0 => null (nunca vira zero nem cai numa faixa).
export function bandOf(distanceKm: number | null | undefined): DistanceBandKey | null {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  return DISTANCE_BANDS.find((band) => distanceKm > band.min && distanceKm <= band.max)?.key ?? 'acima_40';
}

export interface BandCount { key: DistanceBandKey; label: string; count: number; distanceKm: number }
export function emptyBands(): BandCount[] {
  return DISTANCE_BANDS.map((band) => ({ key: band.key, label: band.label, count: 0, distanceKm: 0 }));
}
export function addToBands(bands: BandCount[], distanceKm: number | null | undefined): void {
  const key = bandOf(distanceKm);
  if (!key || distanceKm == null) return;
  const band = bands.find((b) => b.key === key)!;
  band.count += 1;
  band.distanceKm = round2(band.distanceKm + distanceKm);
}

export const round2 = (value: number) => Math.round(value * 100) / 100;

// ── Pace correto: tempo TOTAL / distancia TOTAL (nunca a media aritmetica dos paces) ──────────────────────────────
// So' entram corridas com distancia E tempo conhecidos (ausencia nao e' zero). Devolve null sem nenhuma corrida utilizavel.
export interface PaceInput { distanceKm: number | null; durationSec: number | null }
export interface PaceResult { secondsPerKm: number; runs: number; distanceKm: number; durationSec: number }
export function pooledPace(items: PaceInput[]): PaceResult | null {
  let distance = 0;
  let seconds = 0;
  let runs = 0;
  for (const item of items) {
    if (item.distanceKm == null || item.durationSec == null) continue;
    if (!Number.isFinite(item.distanceKm) || !Number.isFinite(item.durationSec) || item.distanceKm <= 0 || item.durationSec <= 0) continue;
    distance += item.distanceKm;
    seconds += item.durationSec;
    runs += 1;
  }
  if (runs === 0 || distance <= 0) return null;
  return { secondsPerKm: Math.round(seconds / distance), runs, distanceKm: round2(distance), durationSec: Math.round(seconds) };
}
export function formatPace(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return minutes + ':' + String(seconds).padStart(2, '0') + '/km';
}

// ── Maratona / meia-maratona: so' com EVIDENCIA ───────────────────────────────────────────────────────────────────
// Evidencia = uma prova cadastrada pela propria aluna (TargetRace) no MESMO dia local da corrida, da mesma modalidade de distancia (maratona ~42,195; meia ~21,0975) e a corrida
// tem pelo menos aquela distancia (menos que isso nao completou a prova). Uma corrida longa SEM prova cadastrada NAO e' contada como prova: vira "candidata" (informacao a parte).
export interface RaceRef { raceDate: string; distanceKm: number }
export type RaceKind = 'maratona' | 'meia' | null;
const MARATHON = { raceMin: 41, raceMax: 44, runMin: 40, candMin: 41.5, candMax: 44 };
const HALF = { raceMin: 20.5, raceMax: 22, runMin: 20, candMin: 20.8, candMax: 22 };

export function raceKindOf(distanceKm: number | null | undefined, localDate: string, races: RaceRef[]): { confirmed: RaceKind; candidate: RaceKind } {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) return { confirmed: null, candidate: null };
  const sameDay = races.filter((race) => race.raceDate === localDate);
  // Confirma so' dentro de uma faixa plausivel da distancia da prova (piso e teto): 50 km num dia de meia nao e' a meia, e 20 km de aquecimento no dia da maratona nao e' a maratona.
  const confirm = (spec: typeof MARATHON) => sameDay.some((race) => race.distanceKm >= spec.raceMin && race.distanceKm <= spec.raceMax) && distanceKm >= spec.runMin && distanceKm <= spec.raceMax * 1.05;
  if (confirm(MARATHON)) return { confirmed: 'maratona', candidate: null };
  if (confirm(HALF)) return { confirmed: 'meia', candidate: null };
  if (distanceKm >= MARATHON.candMin && distanceKm <= MARATHON.candMax) return { confirmed: null, candidate: 'maratona' };
  if (distanceKm >= HALF.candMin && distanceKm <= HALF.candMax) return { confirmed: null, candidate: 'meia' };
  return { confirmed: null, candidate: null };
}

// ── Nomes: chave de comparacao (ASICS = Asics = asics) e rotulo mais frequente ─────────────────────────────────────
export function normalizeKey(text: string | null | undefined): string {
  if (!text) return '';
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
// Rotulo de exibicao de um grupo de grafias: a mais frequente (empate: a primeira em ordem alfabetica). Nao "corrige" ortografia.
export function dominantLabel(spellings: string[]): string {
  const counts = new Map<string, number>();
  for (const spelling of spellings) { const trimmed = spelling.trim(); if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
}

// ── Retrospectiva ao aposentar: so' fatos que existem ──────────────────────────────────────────────────────────────
export interface RetroInput { totalDistanceKm: number; runs: number; marathons: number; halfMarathons: number; runsOver30: number }
export function retrospectiveText(input: RetroInput): string | null {
  if (input.runs <= 0 || input.totalDistanceKm <= 0) return null;
  const km = Number.isInteger(input.totalDistanceKm) ? String(input.totalDistanceKm) : String(round2(input.totalDistanceKm)).replace('.', ',');
  const includes: string[] = [];
  if (input.marathons > 0) includes.push(input.marathons + (input.marathons === 1 ? ' maratona' : ' maratonas'));
  if (input.halfMarathons > 0) includes.push(input.halfMarathons + (input.halfMarathons === 1 ? ' meia-maratona' : ' meias-maratonas'));
  if (input.runsOver30 > 0) includes.push(input.runsOver30 + (input.runsOver30 === 1 ? ' corrida acima de 30 km' : ' corridas acima de 30 km'));
  const base = 'Você correu ' + km + ' km com este tênis em ' + input.runs + (input.runs === 1 ? ' corrida' : ' corridas');
  if (includes.length === 0) return base + '.';
  const list = includes.length === 1 ? includes[0] : includes.slice(0, -1).join(', ') + ' e ' + includes[includes.length - 1];
  return base + ', incluindo ' + list + '.';
}

// ── Dispositivos: fabricante != modelo != plataforma ───────────────────────────────────────────────────────────────
export const DEVICE_PLATFORMS = ['polar', 'health_connect', 'apple_health', 'zepp', 'wahoo'] as const;
export const PLATFORM_LABEL: Record<string, string> = { polar: 'Polar', health_connect: 'Health Connect (Android)', apple_health: 'Apple Saúde', zepp: 'Zepp / Amazfit', wahoo: 'Wahoo', manual: 'Informado por você' };

const MANUFACTURER_ALIASES: Record<string, string> = {
  apple: 'Apple', appleinc: 'Apple',
  samsung: 'Samsung', samsungelectronics: 'Samsung', samsungelectronicsco: 'Samsung',
  garmin: 'Garmin', garminltd: 'Garmin', garmininternational: 'Garmin',
  polar: 'Polar', polarelectro: 'Polar', polarelectrooy: 'Polar',
  amazfit: 'Zepp / Amazfit', zepp: 'Zepp / Amazfit', zepphealth: 'Zepp / Amazfit', huami: 'Zepp / Amazfit', zhuhaihuamitechnology: 'Zepp / Amazfit',
  coros: 'Coros', suunto: 'Suunto', huawei: 'Huawei', xiaomi: 'Xiaomi', fitbit: 'Fitbit', google: 'Google', wahoo: 'Wahoo', whoop: 'Whoop', oura: 'Oura', ouraring: 'Oura',
};
export const MANUFACTURER_GROUP_LABEL = { zepp: 'Zepp / Amazfit' } as const;
// Nome canonico do fabricante quando a grafia e' conhecida; senao a propria grafia informada (sem inventar).
export function canonicalManufacturer(raw: string | null | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  return MANUFACTURER_ALIASES[normalizeKey(text)] ?? text;
}

// Plataformas/apps que atendem UM so' fabricante (evidencia suficiente para afirmar o fabricante). Samsung Health, Google Fit e Strava NAO entram: aceitam aparelhos de outras marcas.
const EXCLUSIVE_PROVIDER_MANUFACTURER: Record<string, string> = { polar: 'Polar', wahoo: 'Wahoo', zepp: 'Zepp / Amazfit' };
const EXCLUSIVE_PACKAGE_PREFIX: Array<[string, string]> = [['fi.polar.', 'Polar'], ['com.polar.', 'Polar'], ['com.garmin.', 'Garmin'], ['com.suunto.', 'Suunto'], ['com.coros.', 'Coros'], ['com.huami.', 'Zepp / Amazfit'], ['com.fitbit.', 'Fitbit'], ['com.wahoofitness.', 'Wahoo']];

const HC_DEVICE_TYPE: Record<number, string> = { 1: 'relogio', 2: 'telefone', 6: 'pulseira', 7: 'cinta', 4: 'anel', 3: 'outro', 5: 'outro', 8: 'outro' };

export interface DerivedDevice {
  sourceProvider: string;
  sourceDetail: string;
  deviceKey: string;
  manufacturer: string | null;
  model: string | null;
  name: string | null;
  deviceType: string | null;
  manufacturerBasis: 'dispositivo_informou' | 'plataforma_exclusiva' | null;
}

const asText = (value: unknown, max = 80): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const asObject = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

// Extrai o dispositivo de UMA atividade a partir do que a PROPRIA fonte informou (providerMetrics). Strava (inclusive via canal de saude) devolve null: nunca entra. Sem evidencia = campos null.
export function deriveDevice(provider: string, providerMetrics: unknown): DerivedDevice | null {
  if (provider === 'strava') return null;
  const metrics = asObject(providerMetrics) ?? {};
  let manufacturer: string | null = null;
  let model: string | null = null;
  let name: string | null = null;
  let deviceType: string | null = null;
  let sourceDetail = '';
  let basis: DerivedDevice['manufacturerBasis'] = null;

  if (provider === 'health_connect' || provider === 'apple_health') {
    const source = asObject(metrics.source);
    const sourceId = asText(source?.packageName) ?? asText(source?.bundleId) ?? '';
    if (sourceId === 'com.strava' || sourceId.startsWith('com.strava.')) return null; // chegou via Strava: nao entra
    sourceDetail = sourceId.slice(0, 120);
    const device = asObject(metrics.device);
    manufacturer = canonicalManufacturer(asText(device?.manufacturer));
    model = asText(device?.model);
    name = asText(device?.name);
    if (provider === 'health_connect' && typeof device?.type === 'number') deviceType = HC_DEVICE_TYPE[device.type] ?? null;
    if (manufacturer) basis = 'dispositivo_informou';
    else {
      const exclusive = EXCLUSIVE_PACKAGE_PREFIX.find(([prefix]) => sourceId.startsWith(prefix));
      if (exclusive) { manufacturer = exclusive[1]; basis = 'plataforma_exclusiva'; }
    }
  } else if (provider === 'polar') {
    const raw = asText(metrics.device);
    name = raw;
    model = raw ? raw.replace(/^polar\s+/i, '') : null;
    manufacturer = EXCLUSIVE_PROVIDER_MANUFACTURER.polar; basis = 'plataforma_exclusiva';
  } else if (provider === 'zepp') {
    const zepp = asObject(metrics.zepp);
    name = asText(zepp?.deviceName);
    model = name;
    manufacturer = EXCLUSIVE_PROVIDER_MANUFACTURER.zepp; basis = 'plataforma_exclusiva';
  } else if (provider === 'wahoo') {
    manufacturer = EXCLUSIVE_PROVIDER_MANUFACTURER.wahoo; basis = 'plataforma_exclusiva';
  } else {
    return null;
  }
  const brandPart = manufacturer && basis === 'dispositivo_informou' ? normalizeKey(manufacturer) : '';
  const deviceKey = model || name ? brandPart + ':' + normalizeKey((model ?? name) as string) : '';
  return { sourceProvider: provider, sourceDetail, deviceKey: deviceKey.slice(0, 80), manufacturer, model, name, deviceType, manufacturerBasis: basis };
}

// Valor EFETIVO exibido/analisado = a correcao manual da aluna quando existe, senao o observado. O observado nunca e' apagado (colunas separadas).
export function effectiveDevice(row: { observedManufacturer: string | null; observedModel: string | null; manualManufacturer: string | null; manualModel: string | null; manufacturerBasis: string | null }) {
  const manufacturer = row.manualManufacturer ? canonicalManufacturer(row.manualManufacturer) : canonicalManufacturer(row.observedManufacturer);
  const model = row.manualModel ?? row.observedModel;
  return {
    manufacturer,
    model,
    manufacturerSource: row.manualManufacturer ? ('manual' as const) : manufacturer ? ((row.manufacturerBasis as 'dispositivo_informou' | 'plataforma_exclusiva' | null) ?? 'dispositivo_informou') : null,
    modelSource: row.manualModel ? ('manual' as const) : row.observedModel ? ('dispositivo_informou' as const) : null,
  };
}
