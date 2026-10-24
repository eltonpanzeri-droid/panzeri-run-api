import { DISTANCE_BAND_KEYS, DISTANCE_BANDS, addToBands, bandOf, dominantLabel, emptyBands, formatPace, normalizeKey, pooledPace, round2, type BandCount, type DistanceBandKey } from './equipment-core';
import type { ShoeUsageFact } from './shoe-facts';

// Inteligencia de Equipamentos (23/10/2026) — NUCLEO PURO da analise exploratoria da base. Recebe dados ja' lidos (alunos, dispositivos, tenis, fatos de uso, presenca de atividade) e os
// filtros combinaveis; devolve so' AGREGADOS (nenhum nome, id, e-mail ou dado individual de saude sai daqui). Estatistica descritiva: associacao entre equipamento e pace NAO e' causalidade.
// Contagem de alunos sempre por alunos UNICOS. Ausencia de informacao nunca vira zero (pace sem dado = null). Pace de um grupo so' aparece com amostra minima (MIN_PACE_STUDENTS).

export const MIN_PACE_STUDENTS = 3;
// Privacidade (alunos unicos): as CONTAGENS (alunos, equipamentos, marcas, modelos) saem sempre, exatas — nenhum nome, id ou dado individual sai daqui. O que e' desempenho/volume
// (km, corridas, pace, faixas de distancia, km acumulado) de um grupo so' sai com pelo menos esta quantidade de alunos nele; abaixo disso o grupo mostra so' a contagem. Vale tambem para os
// totais de desempenho do resultado inteiro (cruzamentos muito especificos). Evita expor o desempenho de uma aluna sem esconder as contagens administrativas.
export const MIN_GROUP_STUDENTS = 3;
export const SHOE_KM_BUCKETS = [
  { key: 'sem_corridas', label: 'Sem corridas registradas', min: -1, max: 0 },
  { key: 'ate_100', label: 'Até 100 km', min: 0, max: 100 },
  { key: '100_300', label: '100 a 300 km', min: 100, max: 300 },
  { key: '300_500', label: '300 a 500 km', min: 300, max: 500 },
  { key: '500_800', label: '500 a 800 km', min: 500, max: 800 },
  { key: 'acima_800', label: 'Acima de 800 km', min: 800, max: Infinity },
] as const;

export interface AnalysisFilters {
  from: string;
  to: string;
  watchBrands: string[];
  watchModels: string[];
  platforms: string[];
  shoeBrands: string[];
  shoeModels: string[];
  shoeStatus: 'all' | 'active' | 'retired';
  shoeKmMin: number | null;
  shoeKmMax: number | null;
  runnerKmMin: number | null;
  runnerKmMax: number | null;
  studentStatuses: string[];
  bands: DistanceBandKey[];
}

export interface AnalysisStudent { id: string; subscriptionStatus: string }
export interface AnalysisDevice {
  userId: string; platform: string; manufacturer: string | null; model: string | null; deviceType: string | null;
  firstSeenAt: Date | null; lastSeenAt: Date | null; activityCount: number;
}
export interface AnalysisShoe { id: string; userId: string; brand: string; model: string; status: string }
export interface AnalysisData {
  students: AnalysisStudent[];
  devices: AnalysisDevice[];
  shoes: AnalysisShoe[];
  facts: ShoeUsageFact[];
  // provedor -> alunos com ao menos uma atividade recebida no PERIODO ("efetivamente enviando dados").
  activeByProvider: Map<string, Set<string>>;
  // Volume de corrida por aluno no periodo (km, atividades importadas canonicas); null quando nenhum filtro de volume foi pedido.
  runnerKm: Map<string, number> | null;
}

export const modelOptionValue = (brand: string, model: string) => normalizeKey(brand) + '|' + normalizeKey(model);
const unidentified = 'Não identificado';

const inRange = (value: number, min: number | null, max: number | null) => (min == null || value >= min) && (max == null || value <= max);

interface GroupAcc { spellingsBrand: string[]; spellingsModel: string[]; shoes: number; active: number; retired: number; students: Set<string>; facts: ShoeUsageFact[]; accumulated: number[] }

export function analyzeEquipment(data: AnalysisData, f: AnalysisFilters, minStudents: number = MIN_GROUP_STUDENTS) {
  const eligible = data.students.filter((student) => f.studentStatuses.length === 0 || f.studentStatuses.includes(student.subscriptionStatus));
  const eligibleIds = new Set(eligible.map((student) => student.id));

  // ── dispositivos que casam com os filtros de relogio/plataforma e com o periodo ──
  const deviceFilterActive = f.watchBrands.length > 0 || f.watchModels.length > 0 || f.platforms.length > 0;
  const from = new Date(f.from + 'T00:00:00Z');
  const to = new Date(f.to + 'T23:59:59Z');
  const deviceMatches = (device: AnalysisDevice) => {
    if (f.watchBrands.length > 0 && !f.watchBrands.includes(normalizeKey(device.manufacturer) || 'naoidentificado')) return false;
    if (f.watchModels.length > 0 && !f.watchModels.includes(modelOptionValue(device.manufacturer ?? '', device.model ?? ''))) return false;
    if (f.platforms.length > 0 && !f.platforms.includes(device.platform)) return false;
    // Atividade observada por esse aparelho dentro do periodo (datas desconhecidas = informado manualmente: segue).
    if (device.firstSeenAt && device.lastSeenAt && (device.lastSeenAt < from || device.firstSeenAt > to)) return false;
    return true;
  };
  const devicesByUser = new Map<string, AnalysisDevice[]>();
  for (const device of data.devices) {
    if (!eligibleIds.has(device.userId)) continue;
    if (deviceFilterActive && !deviceMatches(device)) continue;
    devicesByUser.set(device.userId, [...(devicesByUser.get(device.userId) ?? []), device]);
  }

  // ── tenis que casam com os filtros de marca/modelo/situacao/km e com faixas e periodo ──
  const shoeFilterActive = f.shoeBrands.length > 0 || f.shoeModels.length > 0 || f.shoeStatus !== 'all' || f.shoeKmMin != null || f.shoeKmMax != null || f.bands.length > 0;
  const factsByShoe = new Map<string, ShoeUsageFact[]>();
  for (const fact of data.facts) factsByShoe.set(fact.shoeId, [...(factsByShoe.get(fact.shoeId) ?? []), fact]);
  const bandsActive = f.bands.length > 0 && f.bands.length < DISTANCE_BAND_KEYS.length;
  const periodFacts = (shoeId: string) => (factsByShoe.get(shoeId) ?? []).filter((fact) => {
    if (fact.localDate < f.from || fact.localDate > f.to) return false;
    if (bandsActive) { const band = bandOf(fact.distanceKm); return band != null && f.bands.includes(band); }
    return true;
  });
  const accumulatedKm = (shoeId: string) => (factsByShoe.get(shoeId) ?? []).filter((fact) => fact.localDate <= f.to).reduce((sum, fact) => sum + (fact.distanceKm ?? 0), 0);
  const matchedShoes: Array<{ shoe: AnalysisShoe; facts: ShoeUsageFact[]; accumulated: number }> = [];
  for (const shoe of data.shoes) {
    if (!eligibleIds.has(shoe.userId)) continue;
    if (f.shoeBrands.length > 0 && !f.shoeBrands.includes(normalizeKey(shoe.brand))) continue;
    if (f.shoeModels.length > 0 && !f.shoeModels.includes(modelOptionValue(shoe.brand, shoe.model))) continue;
    if (f.shoeStatus !== 'all' && shoe.status !== f.shoeStatus) continue;
    const accumulated = round2(accumulatedKm(shoe.id));
    if (!inRange(accumulated, f.shoeKmMin, f.shoeKmMax)) continue;
    const facts = periodFacts(shoe.id);
    if (bandsActive && facts.length === 0) continue;
    matchedShoes.push({ shoe, facts, accumulated });
  }
  const shoesByUser = new Map<string, typeof matchedShoes>();
  for (const entry of matchedShoes) shoesByUser.set(entry.shoe.userId, [...(shoesByUser.get(entry.shoe.userId) ?? []), entry]);

  // ── alunos incluidos: todos os filtros combinados (E) ──
  const runnerFilterActive = f.runnerKmMin != null || f.runnerKmMax != null;
  const included = eligible.filter((student) => {
    if (deviceFilterActive && !devicesByUser.has(student.id)) return false;
    if (shoeFilterActive && !shoesByUser.has(student.id)) return false;
    if (runnerFilterActive) {
      const km = data.runnerKm?.get(student.id);
      if (km == null || !inRange(km, f.runnerKmMin, f.runnerKmMax)) return false;
    }
    return true;
  });
  const includedIds = new Set(included.map((student) => student.id));

  // ── dispositivos (agregados sobre alunos incluidos) ──
  const manufacturerAcc = new Map<string, { labels: string[]; students: Set<string>; devices: number; activities: number }>();
  const modelAcc = new Map<string, { manufacturerLabels: string[]; modelLabels: string[]; manufacturerKey: string; students: Set<string>; activities: number }>();
  const platformAcc = new Map<string, { students: Set<string>; devices: number; activities: number }>();
  const studentsWithDevice = new Set<string>();
  for (const [userId, devices] of devicesByUser) {
    if (!includedIds.has(userId)) continue;
    for (const device of devices) {
      studentsWithDevice.add(userId);
      const brandKey = normalizeKey(device.manufacturer) || 'naoidentificado';
      const m = manufacturerAcc.get(brandKey) ?? { labels: [], students: new Set<string>(), devices: 0, activities: 0 };
      if (device.manufacturer) m.labels.push(device.manufacturer);
      m.students.add(userId); m.devices += 1; m.activities += device.activityCount;
      manufacturerAcc.set(brandKey, m);
      const modelKey = brandKey + '|' + (normalizeKey(device.model) || 'naoidentificado');
      const md = modelAcc.get(modelKey) ?? { manufacturerLabels: [], modelLabels: [], manufacturerKey: brandKey, students: new Set<string>(), activities: 0 };
      if (device.manufacturer) md.manufacturerLabels.push(device.manufacturer);
      if (device.model) md.modelLabels.push(device.model);
      md.students.add(userId); md.activities += device.activityCount;
      modelAcc.set(modelKey, md);
      if (device.platform !== 'manual') {
        const p = platformAcc.get(device.platform) ?? { students: new Set<string>(), devices: 0, activities: 0 };
        p.students.add(userId); p.devices += 1; p.activities += device.activityCount;
        platformAcc.set(device.platform, p);
      }
    }
  }
  const sendingAny = new Set<string>();
  for (const students of data.activeByProvider.values()) for (const id of students) if (includedIds.has(id)) sendingAny.add(id);

  // ── tenis (agregados sobre tenis dos alunos incluidos) ──
  const shoeEntries = matchedShoes.filter((entry) => includedIds.has(entry.shoe.userId));
  const brandAcc = new Map<string, GroupAcc>();
  const shoeModelAcc = new Map<string, GroupAcc>();
  const bump = (map: Map<string, GroupAcc>, key: string, entry: (typeof matchedShoes)[number]) => {
    const g = map.get(key) ?? { spellingsBrand: [], spellingsModel: [], shoes: 0, active: 0, retired: 0, students: new Set<string>(), facts: [], accumulated: [] };
    g.spellingsBrand.push(entry.shoe.brand); g.spellingsModel.push(entry.shoe.model);
    g.shoes += 1; if (entry.shoe.status === 'active') g.active += 1; else if (entry.shoe.status === 'retired') g.retired += 1;
    g.students.add(entry.shoe.userId); g.facts.push(...entry.facts); g.accumulated.push(entry.accumulated);
    map.set(key, g);
  };
  const overallBands = emptyBands();
  const kmBuckets = SHOE_KM_BUCKETS.map((bucket) => ({ key: bucket.key as string, label: bucket.label as string, shoes: 0 }));
  for (const entry of shoeEntries) {
    bump(brandAcc, normalizeKey(entry.shoe.brand) || 'naoinformado', entry);
    bump(shoeModelAcc, modelOptionValue(entry.shoe.brand, entry.shoe.model), entry);
    for (const fact of entry.facts) addToBands(overallBands, fact.distanceKm);
    // Faixa de quilometragem ACUMULADA do par (ate a data final do periodo); sem nenhuma corrida com distancia fica a parte.
    const bucket = entry.accumulated <= 0 ? kmBuckets[0] : kmBuckets[SHOE_KM_BUCKETS.findIndex((candidate, index) => index > 0 && entry.accumulated > candidate.min && entry.accumulated <= candidate.max)];
    bucket.shoes += 1;
  }
  const shoeGroup = (g: GroupAcc) => {
    const runsWithDistance = g.facts.filter((fact) => fact.distanceKm != null);
    const km = round2(runsWithDistance.reduce((sum, fact) => sum + (fact.distanceKm as number), 0));
    const bands = emptyBands();
    for (const fact of g.facts) addToBands(bands, fact.distanceKm);
    // Pace do grupo: tempo total / distancia total das corridas com os dois dados; so' com amostra minima de ALUNOS (evita expor um aluno).
    const paceStudents = new Set(g.facts.filter((fact) => fact.distanceKm != null && fact.durationSec != null).map((fact) => fact.userId));
    const pace = paceStudents.size >= MIN_PACE_STUDENTS ? pooledPace(g.facts.map((fact) => ({ distanceKm: fact.distanceKm, durationSec: fact.durationSec }))) : null;
    // Contagens sempre exatas; desempenho (corridas, km, pace, faixas) so' com amostra minima de alunas COM CORRIDA no grupo (nao basta ter tres donas de tenis se so' uma correu com ele).
    const runStudents = new Set(g.facts.map((fact) => fact.userId));
    if (runStudents.size < minStudents) {
      return { shoes: g.shoes, active: g.active, retired: g.retired, students: g.students.size, performanceHidden: true as boolean, runs: null as number | null, km: null as number | null, avgKmPerShoe: null as number | null, pace: null as { secondsPerKm: number; label: string; runs: number } | null, paceHidden: false, bands: [] as BandCount[] };
    }
    return {
      shoes: g.shoes, active: g.active, retired: g.retired, students: g.students.size, performanceHidden: false as boolean,
      runs: g.facts.length as number | null, km: km as number | null,
      avgKmPerShoe: (g.accumulated.length > 0 ? round2(g.accumulated.reduce((a, b) => a + b, 0) / g.accumulated.length) : null) as number | null,
      pace: (pace ? { secondsPerKm: pace.secondsPerKm, label: formatPace(pace.secondsPerKm), runs: pace.runs } : null) as { secondsPerKm: number; label: string; runs: number } | null,
      paceHidden: paceStudents.size > 0 && paceStudents.size < MIN_PACE_STUDENTS,
      bands: bands as BandCount[],
    };
  };
  const byStudentsThenLabel = <T extends { students: number }>(a: T & { label: string }, b: T & { label: string }) => b.students - a.students || (a.label < b.label ? -1 : 1);

  const shoeBrandRows = [...brandAcc.entries()].map(([key, g]) => ({ key, label: dominantLabel(g.spellingsBrand) || unidentified, ...shoeGroup(g) })).sort(byStudentsThenLabel);
  const shoeModelRows = [...shoeModelAcc.entries()].map(([key, g]) => ({ key, brand: dominantLabel(g.spellingsBrand), label: dominantLabel(g.spellingsModel) || unidentified, ...shoeGroup(g) })).sort(byStudentsThenLabel);
  const studentsWithShoe = new Set(shoeEntries.map((entry) => entry.shoe.userId));

  return {
    period: { from: f.from, to: f.to },
    population: {
      studentsEligible: eligible.length,
      studentsIncluded: included.length,
      studentsWithDevice: studentsWithDevice.size,
      studentsWithShoe: studentsWithShoe.size,
      studentsSendingData: sendingAny.size,
    },
    devices: {
      byManufacturer: [...manufacturerAcc.entries()].map(([key, v]) => ({ key, label: key === 'naoidentificado' ? unidentified : dominantLabel(v.labels), students: v.students.size, devices: v.devices, activities: v.students.size >= minStudents ? v.activities : null })).sort(byStudentsThenLabel),
      byModel: [...modelAcc.entries()].map(([key, v]) => ({
        key, manufacturer: v.manufacturerKey === 'naoidentificado' ? unidentified : dominantLabel(v.manufacturerLabels), label: dominantLabel(v.modelLabels) || 'Modelo não identificado', students: v.students.size, activities: v.students.size >= minStudents ? v.activities : null,
      })).sort(byStudentsThenLabel).slice(0, 200),
      byPlatform: [...platformAcc.entries()].map(([key, v]) => ({
        key, label: key, students: v.students.size, devices: v.devices, activities: v.students.size >= minStudents ? v.activities : null,
        studentsSendingData: [...v.students].filter((id) => data.activeByProvider.get(key)?.has(id)).length,
      })).sort((a, b) => b.students - a.students || (a.key < b.key ? -1 : 1)),
      studentsWithoutDevice: included.length - studentsWithDevice.size,
    },
    shoes: {
      totals: { shoes: shoeEntries.length, active: shoeEntries.filter((e) => e.shoe.status === 'active').length, retired: shoeEntries.filter((e) => e.shoe.status === 'retired').length, students: studentsWithShoe.size, studentsWithoutShoe: included.length - studentsWithShoe.size },
      byBrand: shoeBrandRows,
      byModel: shoeModelRows.slice(0, 200),
      // Desempenho agregado do resultado inteiro: so' com amostra minima de alunos (cruzamentos muito especificos nao expoem uma aluna).
      performanceHidden: included.length < minStudents,
      kmDistribution: included.length < minStudents ? [] : kmBuckets,
      distanceBands: included.length < minStudents ? [] : overallBands.map((band) => ({ key: band.key, label: DISTANCE_BANDS.find((candidate) => candidate.key === band.key)!.label, runs: band.count, km: band.distanceKm })),
    },
    notes: [
      'Estatística descritiva da base de alunos: relação entre equipamento e pace/volume NÃO indica que o equipamento causa o resultado.',
      'Alunos contados uma única vez (alunos únicos), mesmo com vários tênis ou dispositivos.',
      'Quilometragem usa só corridas que a aluna associou ao tênis, uma observação por evento físico (Polar + Health Connect do mesmo treino valem uma vez). Musculação não entra.',
      'Pace por tênis é tempo total ÷ distância total das corridas com os dois dados, e só aparece com pelo menos ' + MIN_PACE_STUDENTS + ' alunos na amostra.',
      'As contagens (alunos, equipamentos, marcas e modelos) são sempre exatas. Desempenho (km, corridas, pace, faixas de distância) só aparece para grupos com pelo menos ' + MIN_GROUP_STUDENTS + ' alunos, para não expor uma aluna em cruzamentos muito específicos.',
      '"Atividades" dos relógios é o histórico total de atividades recebidas por aquele aparelho (todas as fontes), não só do período; o mesmo treino recebido por dois caminhos aparece nos dois.',
      'Dispositivos e tênis só têm histórico a partir de quando passaram a ser registrados; ausência de dado não é zero.',
    ],
  };
}

export type EquipmentAnalysis = ReturnType<typeof analyzeEquipment>;
