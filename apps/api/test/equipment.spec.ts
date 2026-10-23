import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { DISTANCE_BAND_KEYS, bandOf, canonicalManufacturer, deriveDevice, effectiveDevice, emptyBands, addToBands, formatPace, normalizeKey, pooledPace, raceKindOf, retrospectiveText } from '../src/equipment/equipment-core';
import { analyzeEquipment, MIN_PACE_STUDENTS, type AnalysisData, type AnalysisFilters } from '../src/equipment/equipment-analysis';
import { buildShoeStats } from '../src/equipment/shoe-stats';
import { parseEquipmentFilters } from '../src/equipment/equipment-intelligence.service';
import { DevicesService } from '../src/equipment/devices.service';
import { ShoesService } from '../src/shoes/shoes.service';
import type { ShoeUsageFact } from '../src/equipment/shoe-facts';

// 23/10/2026 — Equipamentos: nucleo puro (faixas, pace, provas, nomes, dispositivos), analise do painel (filtros combinados, alunos unicos, privacidade) e ciclo de vida do tenis. Dados sinteticos.

const fact = (over: Partial<ShoeUsageFact> & { shoeId: string; userId: string }): ShoeUsageFact => ({
  usageId: 'u-' + Math.random(), completionId: 'c-' + Math.random(), completedAt: new Date('2026-10-01T10:00:00Z'), localDate: '2026-10-01', distanceKm: 10, durationSec: 3000, activityId: null, provider: null, ...over,
});

describe('faixas de distancia: exclusivas e sem lacunas', () => {
  it('limites: o superior pertence a faixa de baixo; ausente/zero/invalido nao cai em nenhuma', () => {
    expect([5, 5.01, 10, 10.01, 15, 15.01, 25, 25.01, 30, 30.01, 40, 40.01, 0.1, 42.195, 100].map(bandOf)).toEqual(
      ['ate_5', '5_10', '5_10', '10_15', '10_15', '15_25', '15_25', '25_30', '25_30', '30_40', '30_40', 'acima_40', 'ate_5', 'acima_40', 'acima_40'],
    );
    expect([null, undefined, 0, -3, NaN].map((v) => bandOf(v as number))).toEqual([null, null, null, null, null]);
  });

  it('uma corrida entra em UMA so faixa: a soma das contagens e igual ao numero de corridas com distancia', () => {
    const bands = emptyBands();
    const distances = [3, 5, 5.5, 9.99, 10, 12, 21.1, 25, 27, 30, 35, 40, 42.2, 55, null];
    for (const d of distances) addToBands(bands, d);
    expect(bands.reduce((s, b) => s + b.count, 0)).toBe(distances.filter((d) => d != null).length);
    expect(bands.map((b) => b.key)).toEqual(DISTANCE_BAND_KEYS);
  });
});

describe('pace por totais (nunca media dos paces)', () => {
  it('tempo total / distancia total: corrida longa pesa mais que a curta', () => {
    // 5 km em 25:00 (5:00/km) + 20 km em 120:00 (6:00/km). Media dos paces = 5:30; correto = 145 min / 25 km = 5:48.
    const pace = pooledPace([{ distanceKm: 5, durationSec: 1500 }, { distanceKm: 20, durationSec: 7200 }]);
    expect(pace?.secondsPerKm).toBe(348);
    expect(formatPace(pace!.secondsPerKm)).toBe('5:48/km');
  });
  it('corrida sem tempo ou sem distancia nao entra (ausencia nao e zero); sem nenhuma, null', () => {
    expect(pooledPace([{ distanceKm: 10, durationSec: null }, { distanceKm: null, durationSec: 3000 }])).toBeNull();
    expect(pooledPace([{ distanceKm: 10, durationSec: 3000 }, { distanceKm: 8, durationSec: null }])).toMatchObject({ runs: 1, distanceKm: 10 });
  });
});

describe('maratona e meia: so com evidencia', () => {
  const races = [{ raceDate: '2026-09-20', distanceKm: 42.195 }, { raceDate: '2026-05-10', distanceKm: 21.0975 }];
  it('prova cadastrada no mesmo dia e distancia compativel confirma; corrida longa sem prova e so candidata', () => {
    expect(raceKindOf(42.3, '2026-09-20', races)).toEqual({ confirmed: 'maratona', candidate: null });
    expect(raceKindOf(21.2, '2026-05-10', races)).toEqual({ confirmed: 'meia', candidate: null });
    expect(raceKindOf(42.2, '2026-08-01', races)).toEqual({ confirmed: null, candidate: 'maratona' }); // treino longo, sem prova
    expect(raceKindOf(21.1, '2026-08-01', [])).toEqual({ confirmed: null, candidate: 'meia' });
  });
  it('prova no dia mas a corrida ficou muito aquem da distancia: nao confirma', () => {
    expect(raceKindOf(30, '2026-09-20', races).confirmed).toBeNull();
    expect(raceKindOf(null, '2026-09-20', races)).toEqual({ confirmed: null, candidate: null });
  });
  it('estatisticas separam provas confirmadas de candidatas', () => {
    const facts = [
      fact({ shoeId: 's', userId: 'u', distanceKm: 42.3, localDate: '2026-09-20' }), fact({ shoeId: 's', userId: 'u', distanceKm: 42.2, localDate: '2026-08-01' }),
      fact({ shoeId: 's', userId: 'u', distanceKm: 21.2, localDate: '2026-05-10' }), fact({ shoeId: 's', userId: 'u', distanceKm: 10, localDate: '2026-06-01' }),
    ];
    const stats = buildShoeStats(facts, races);
    expect(stats.marathons).toEqual({ confirmed: 1, candidates: 1 });
    expect(stats.halfMarathons).toEqual({ confirmed: 1, candidates: 0 });
    expect(stats.runsOver30Km).toBe(2);
    expect(stats.totalDistanceKm).toBe(115.7);
  });
});

describe('estatisticas do tenis', () => {
  it('corrida sem distancia conta como corrida mas nao inventa km; km por mes e pace por totais', () => {
    const stats = buildShoeStats([
      fact({ shoeId: 's', userId: 'u', distanceKm: 5, durationSec: 1500, localDate: '2026-09-02' }),
      fact({ shoeId: 's', userId: 'u', distanceKm: 20, durationSec: 7200, localDate: '2026-10-03' }),
      fact({ shoeId: 's', userId: 'u', distanceKm: null, durationSec: 1800, localDate: '2026-10-05' }),
    ], []);
    expect(stats).toMatchObject({ runsCount: 3, runsWithDistance: 2, runsWithoutDistance: 1, totalDistanceKm: 25, firstRunDate: '2026-09-02', lastRunDate: '2026-10-05' });
    expect(stats.avgPace?.label).toBe('5:48/km');
    expect(stats.kmByMonth).toEqual([{ month: '2026-09', km: 5, runs: 1 }, { month: '2026-10', km: 20, runs: 1 }]);
  });
  it('retrospectiva so cita o que existe', () => {
    expect(retrospectiveText({ totalDistanceKm: 823, runs: 91, marathons: 1, halfMarathons: 0, runsOver30: 4 })).toBe('Você correu 823 km com este tênis em 91 corridas, incluindo 1 maratona e 4 corridas acima de 30 km.');
    expect(retrospectiveText({ totalDistanceKm: 120.5, runs: 1, marathons: 0, halfMarathons: 0, runsOver30: 0 })).toBe('Você correu 120,5 km com este tênis em 1 corrida.');
    expect(retrospectiveText({ totalDistanceKm: 0, runs: 0, marathons: 0, halfMarathons: 0, runsOver30: 0 })).toBeNull();
  });
});

describe('nomes e dispositivos', () => {
  it('ASICS = Asics = asics; acentos e simbolos nao separam o mesmo modelo', () => {
    expect(normalizeKey('ASICS')).toBe(normalizeKey(' Asics '));
    expect(normalizeKey('Novablast 5')).toBe(normalizeKey('novablast-5'));
    expect(canonicalManufacturer('Apple Inc.')).toBe('Apple');
    expect(canonicalManufacturer('Samsung Electronics')).toBe('Samsung');
    expect(canonicalManufacturer('Marca Desconhecida')).toBe('Marca Desconhecida'); // nao inventa
    expect(canonicalManufacturer('  ')).toBeNull();
  });

  it('fabricante != modelo != plataforma: Samsung Galaxy Watch via Health Connect', () => {
    const d = deriveDevice('health_connect', { source: { packageName: 'com.sec.android.app.shealth' }, device: { manufacturer: 'samsung', model: 'Galaxy Watch6', type: 1 } });
    expect(d).toMatchObject({ sourceProvider: 'health_connect', manufacturer: 'Samsung', model: 'Galaxy Watch6', deviceType: 'relogio', manufacturerBasis: 'dispositivo_informou', sourceDetail: 'com.sec.android.app.shealth' });
  });
  it('nao infere fabricante sem evidencia: Samsung Health sem dispositivo informado fica sem fabricante', () => {
    const d = deriveDevice('health_connect', { source: { packageName: 'com.sec.android.app.shealth' }, device: null });
    expect(d).toMatchObject({ manufacturer: null, model: null, manufacturerBasis: null });
  });
  it('plataforma exclusiva de um fabricante e evidencia (Polar, Garmin Connect); Google Fit nao e', () => {
    expect(deriveDevice('polar', { device: 'Polar Vantage V2' })).toMatchObject({ manufacturer: 'Polar', model: 'Vantage V2', manufacturerBasis: 'plataforma_exclusiva' });
    expect(deriveDevice('health_connect', { source: { packageName: 'com.garmin.android.apps.connectmobile' }, device: null })).toMatchObject({ manufacturer: 'Garmin', manufacturerBasis: 'plataforma_exclusiva' });
    expect(deriveDevice('health_connect', { source: { packageName: 'com.google.android.apps.fitness' }, device: null })?.manufacturer).toBeNull();
    expect(deriveDevice('zepp', { zepp: { deviceName: 'Amazfit Balance' } })).toMatchObject({ manufacturer: 'Zepp / Amazfit', model: 'Amazfit Balance' });
  });
  it('Strava nunca entra, nem direto nem via canal de saude', () => {
    expect(deriveDevice('strava', { device: 'x' })).toBeNull();
    expect(deriveDevice('health_connect', { source: { packageName: 'com.strava' }, device: { manufacturer: 'Garmin', model: 'Forerunner' } })).toBeNull();
    expect(deriveDevice('apple_health', { source: { bundleId: 'com.strava.stravaride' }, device: { name: 'Apple Watch' } })).toBeNull();
  });
  it('valor efetivo: a correcao manual vale, mas o observado e a origem continuam disponiveis', () => {
    const row = { observedManufacturer: null, observedModel: 'Vantage V2', manualManufacturer: 'Polar', manualModel: null, manufacturerBasis: null };
    expect(effectiveDevice(row)).toMatchObject({ manufacturer: 'Polar', manufacturerSource: 'manual', model: 'Vantage V2', modelSource: 'dispositivo_informou' });
  });
});

describe('filtros do painel: leitura e validacao', () => {
  it('periodo livre, datas validas, futuro limitado a hoje, padrao de 180 dias', () => {
    const f = parseEquipmentFilters({ from: '2026-01-01', to: '2026-03-31' }, '2026-10-23');
    expect(f).toMatchObject({ from: '2026-01-01', to: '2026-03-31', shoeStatus: 'all' });
    expect(parseEquipmentFilters({ to: '2030-01-01' }, '2026-10-23').to).toBe('2026-10-23');
    expect(parseEquipmentFilters({}, '2026-10-23').from).toBe('2026-04-27');
    expect(() => parseEquipmentFilters({ from: 'ontem' }, '2026-10-23')).toThrow(BadRequestException);
    expect(() => parseEquipmentFilters({ from: '2026-05-01', to: '2026-01-01' }, '2026-10-23')).toThrow(BadRequestException);
    expect(() => parseEquipmentFilters({ shoeKmMin: '500', shoeKmMax: '100' }, '2026-10-23')).toThrow(BadRequestException);
    expect(() => parseEquipmentFilters({ runnerKmMin: '-1' }, '2026-10-23')).toThrow(BadRequestException);
  });
  it('listas, faixas validas e situacao do tenis', () => {
    const f = parseEquipmentFilters({ watchBrands: 'garmin, polar', bands: '5_10,xx,acima_40', shoeStatus: 'retired', studentStatuses: 'active' }, '2026-10-23');
    expect(f.watchBrands).toEqual(['garmin', 'polar']);
    expect(f.bands).toEqual(['5_10', 'acima_40']);
    expect(f.shoeStatus).toBe('retired');
    expect(f.studentStatuses).toEqual(['active']);
  });
});

describe('analise do painel: filtros combinados, alunos unicos e privacidade', () => {
  // A logica dos filtros e testada com piso 1 (poucos alunos sinteticos); o piso real (3) tem testes proprios mais abaixo.
  const analyze1 = (d: AnalysisData, f: AnalysisFilters) => analyzeEquipment(d, f, 1);
  const base = (): AnalysisFilters => ({ from: '2026-01-01', to: '2026-10-31', watchBrands: [], watchModels: [], platforms: [], shoeBrands: [], shoeModels: [], shoeStatus: 'all', shoeKmMin: null, shoeKmMax: null, runnerKmMin: null, runnerKmMax: null, studentStatuses: [], bands: [] });
  const dev = (userId: string, platform: string, manufacturer: string | null, model: string | null, activityCount = 10) => ({ userId, platform, manufacturer, model, deviceType: null, firstSeenAt: new Date('2026-02-01'), lastSeenAt: new Date('2026-10-01'), activityCount });
  const data = (): AnalysisData => ({
    students: [{ id: 'a', subscriptionStatus: 'active' }, { id: 'b', subscriptionStatus: 'active' }, { id: 'c', subscriptionStatus: 'active' }, { id: 'd', subscriptionStatus: 'active' }, { id: 'e', subscriptionStatus: 'canceled' }],
    devices: [
      dev('a', 'polar', 'Polar', 'Vantage V2'), dev('a', 'health_connect', 'Samsung', 'Galaxy Watch6'), // aluno a: dois dispositivos
      dev('b', 'health_connect', 'Garmin', 'Forerunner 255'), dev('c', 'health_connect', 'Garmin', 'Forerunner 255'), dev('d', 'zepp', 'Zepp / Amazfit', 'Amazfit Balance'),
      dev('e', 'polar', 'Polar', 'Vantage V2'),
    ],
    shoes: [
      { id: 's1', userId: 'a', brand: 'ASICS', model: 'Novablast 5', status: 'active' }, { id: 's2', userId: 'a', brand: 'Asics', model: 'novablast 5', status: 'retired' },
      { id: 's3', userId: 'b', brand: 'ASICS', model: 'Novablast 5', status: 'active' }, { id: 's4', userId: 'c', brand: 'Nike', model: 'Pegasus', status: 'active' }, { id: 's5', userId: 'd', brand: 'ASICS', model: 'Novablast 5', status: 'active' },
      { id: 's6', userId: 'e', brand: 'ASICS', model: 'Novablast 5', status: 'active' },
    ],
    facts: [
      fact({ shoeId: 's1', userId: 'a', distanceKm: 10, durationSec: 3000, localDate: '2026-03-01' }), fact({ shoeId: 's1', userId: 'a', distanceKm: 21, durationSec: 7000, localDate: '2026-04-01' }),
      fact({ shoeId: 's2', userId: 'a', distanceKm: 8, durationSec: 2400, localDate: '2026-02-01' }),
      fact({ shoeId: 's3', userId: 'b', distanceKm: 10, durationSec: 3300, localDate: '2026-05-01' }), fact({ shoeId: 's5', userId: 'd', distanceKm: 12, durationSec: 3600, localDate: '2026-06-01' }),
      fact({ shoeId: 's4', userId: 'c', distanceKm: 5, durationSec: 1500, localDate: '2026-05-05' }), fact({ shoeId: 's6', userId: 'e', distanceKm: 30, durationSec: 9000, localDate: '2026-05-05' }),
    ],
    activeByProvider: new Map([['polar', new Set(['a'])], ['health_connect', new Set(['a', 'b'])], ['zepp', new Set<string>()]]),
    runnerKm: null,
  });

  it('alunos unicos: aluno com dois dispositivos e dois tenis conta uma vez; situacao do aluno filtra', () => {
    const r = analyze1(data(), base());
    expect(r.population).toMatchObject({ studentsEligible: 5, studentsIncluded: 5, studentsWithDevice: 5, studentsWithShoe: 5 });
    const onlyActive = analyze1(data(), { ...base(), studentStatuses: ['active'] });
    expect(onlyActive.population.studentsIncluded).toBe(4);
    expect(onlyActive.devices.byManufacturer.find((m) => m.label === 'Polar')?.students).toBe(1); // 'e' (cancelado) fora
    expect(onlyActive.devices.byManufacturer.find((m) => m.label === 'Samsung')).toMatchObject({ students: 1, devices: 1 });
  });

  it('ASICS/Asics e Novablast 5/novablast 5 viram UM grupo; contagem de tenis ativos e aposentados', () => {
    const r = analyze1(data(), { ...base(), studentStatuses: ['active'] });
    const asics = r.shoes.byBrand.find((b) => b.key === 'asics')!;
    expect(asics).toMatchObject({ shoes: 4, active: 3, retired: 1, students: 3 });
    expect(r.shoes.byModel.filter((m) => m.key === 'asics|novablast5')).toHaveLength(1);
    expect(r.shoes.totals).toMatchObject({ shoes: 5, active: 4, retired: 1 });
  });

  it('filtros combinados (E): alunos ativos com Garmin que usam ASICS; o resultado so tem quem cumpre tudo', () => {
    const r = analyze1(data(), { ...base(), studentStatuses: ['active'], watchBrands: ['garmin'], shoeBrands: ['asics'] });
    expect(r.population.studentsIncluded).toBe(1); // b (Garmin + ASICS); c tem Garmin mas Nike
    expect(r.devices.byManufacturer.map((m) => m.label)).toEqual(['Garmin']);
    expect(r.shoes.byBrand.map((b) => b.key)).toEqual(['asics']);
    expect(r.shoes.totals.shoes).toBe(1);
  });

  it('filtro por plataforma, modelo do relogio e situacao/km do tenis funcionam juntos', () => {
    const polar = analyze1(data(), { ...base(), platforms: ['polar'], studentStatuses: ['active'] });
    expect(polar.population.studentsIncluded).toBe(1);
    const model = analyze1(data(), { ...base(), watchModels: ['garmin|forerunner255'] });
    expect(model.population.studentsIncluded).toBe(2);
    const retired = analyze1(data(), { ...base(), shoeStatus: 'retired' });
    expect(retired.shoes.totals).toMatchObject({ shoes: 1, retired: 1 });
    const km = analyze1(data(), { ...base(), shoeKmMin: 25 }); // s1 (31 km) e s6 (30 km)
    expect(km.shoes.totals.shoes).toBe(2);
  });

  it('periodo livre: so entram corridas dentro do intervalo; km acumulado vai ate a data final', () => {
    const r = analyze1(data(), { ...base(), from: '2026-05-01', to: '2026-05-31', studentStatuses: ['active'] });
    const asics = r.shoes.byBrand.find((b) => b.key === 'asics')!;
    expect(asics.runs).toBe(1); // so a corrida de b em 01/05
    expect(asics.km).toBe(10);
  });

  it('faixas de distancia: filtro restringe as corridas contadas e tira tenis sem corrida nelas', () => {
    const r = analyze1(data(), { ...base(), studentStatuses: ['active'], bands: ['15_25'] }); // so a de 21 km (aluno a, tenis s1)
    expect(r.shoes.totals.shoes).toBe(1);
    expect(r.shoes.distanceBands.find((b) => b.key === '15_25')).toMatchObject({ runs: 1, km: 21 });
    expect(r.shoes.distanceBands.filter((b) => b.key !== '15_25').every((b) => b.runs === 0)).toBe(true);
  });

  it('volume do aluno (so quando informado): ausencia de dado exclui, nunca vira zero', () => {
    const d = data();
    d.runnerKm = new Map([['a', 120], ['b', 40]]);
    const r = analyze1(d, { ...base(), studentStatuses: ['active'], runnerKmMin: 100 });
    expect(r.population.studentsIncluded).toBe(1);
    const low = analyze1(d, { ...base(), studentStatuses: ['active'], runnerKmMax: 50 });
    expect(low.population.studentsIncluded).toBe(1); // b; c e d nao tem volume conhecido e nao entram
  });

  it('pace do grupo so aparece com amostra minima de alunos (privacidade) e e calculado por totais', () => {
    const r = analyze1(data(), { ...base(), studentStatuses: ['active'] });
    const asics = r.shoes.byBrand.find((b) => b.key === 'asics')!;
    expect(MIN_PACE_STUDENTS).toBe(3);
    expect(asics.pace).not.toBeNull(); // a, b, d = 3 alunos
    // total: (10+21+8+10+12) km em (3000+7000+2400+3300+3600) s = 61 km / 19300 s = 316 s/km
    expect(asics.pace?.secondsPerKm).toBe(316);
    const nike = r.shoes.byBrand.find((b) => b.key === 'nike')!;
    expect(nike.pace).toBeNull();
    expect(nike.paceHidden).toBe(true);
  });

  it('dispositivos: por plataforma com quem efetivamente envia dados no periodo; aluno sem dispositivo contado a parte', () => {
    const r = analyze1(data(), { ...base(), studentStatuses: ['active'] });
    const hc = r.devices.byPlatform.find((p) => p.key === 'health_connect')!;
    expect(hc).toMatchObject({ students: 3, studentsSendingData: 2 });
    const polar = r.devices.byPlatform.find((p) => p.key === 'polar')!;
    expect(polar).toMatchObject({ students: 1, studentsSendingData: 1 });
    expect(r.population.studentsSendingData).toBe(2);
    expect(r.devices.studentsWithoutDevice).toBe(0);
  });

  it('nao expoe individuo: o resultado nao contem ids de alunos nem de dispositivos', () => {
    const text = JSON.stringify(analyze1(data(), base()));
    for (const id of ['"a"', '"b"', '"userId"', 'email', 'nome']) expect(text).not.toContain(id);
  });
});

describe('privacidade: piso de alunos e prova com teto', () => {
  const filters = (): AnalysisFilters => ({ from: '2026-01-01', to: '2026-10-31', watchBrands: [], watchModels: [], platforms: [], shoeBrands: [], shoeModels: [], shoeStatus: 'all', shoeKmMin: null, shoeKmMax: null, runnerKmMin: null, runnerKmMax: null, studentStatuses: [], bands: [] });
  const world = (n: number): AnalysisData => ({
    students: Array.from({ length: n }, (_, i) => ({ id: 's' + i, subscriptionStatus: 'active' })),
    devices: Array.from({ length: n }, (_, i) => ({ userId: 's' + i, platform: 'polar', manufacturer: i === 0 ? 'Raro' : 'Polar', model: 'M', deviceType: null, firstSeenAt: null, lastSeenAt: null, activityCount: 1 })),
    shoes: Array.from({ length: n }, (_, i) => ({ id: 'h' + i, userId: 's' + i, brand: i === 0 ? 'Marca Rara' : 'ASICS', model: 'X', status: 'active' })),
    facts: Array.from({ length: n }, (_, i) => fact({ shoeId: 'h' + i, userId: 's' + i, distanceKm: 10 + i })),
    activeByProvider: new Map(), runnerKm: null,
  });
  it('com menos de 3 alunos no resultado nada e devolvido (so o aviso): filtros estreitos nao isolam uma aluna', () => {
    const r = analyzeEquipment(world(2), filters());
    expect(r).toMatchObject({ belowMinimum: true, population: { studentsIncluded: null }, shoes: { byBrand: [], byModel: [] }, devices: { byManufacturer: [] } });
    expect(JSON.stringify(r)).not.toMatch(/"km":\s*\d/);
  });
  it('grupos com menos de 3 alunos nao sao listados (so o contador de grupos ocultos); os grandes seguem', () => {
    const r = analyzeEquipment(world(5), filters());
    expect(r.shoes.byBrand.map((b) => b.label)).toEqual(['ASICS']);
    expect(r.shoes.smallGroupsHidden).toBeGreaterThan(0);
    expect(r.devices.byManufacturer.map((m) => m.label)).toEqual(['Polar']);
  });
  it('maratona/meia: tem teto — 50 km num dia de meia nao confirma a meia; aquecimento de 20 km no dia da maratona nao confirma', () => {
    const half = [{ raceDate: '2026-05-10', distanceKm: 21.0975 }];
    const full = [{ raceDate: '2026-09-20', distanceKm: 42.195 }];
    expect(raceKindOf(50, '2026-05-10', half).confirmed).toBeNull();
    expect(raceKindOf(42.2, '2026-05-10', half)).toEqual({ confirmed: null, candidate: 'maratona' });
    expect(raceKindOf(20, '2026-09-20', full).confirmed).toBeNull();
    expect(raceKindOf(42.4, '2026-09-20', full).confirmed).toBe('maratona');
  });
});

describe('ciclo de vida do tenis: eventos, aposentar, reativar (nada e apagado)', () => {
  function service() {
    const row = { id: 'shoe-1', userId: 'u1', brand: 'ASICS', model: 'Novablast 5', version: null, nickname: null, photoUrl: null, status: 'active', startedUsingAt: new Date('2026-01-01'), retiredAt: null as Date | null };
    const updates: any[] = [];
    const created: any[] = [];
    const events: any[] = [];
    const prisma: any = {
      shoe: {
        create: jest.fn(async ({ data }: any) => { created.push(data); return { ...row, ...data, id: 'shoe-1', events: undefined }; }),
        findFirst: jest.fn(async () => ({ ...row })),
        update: jest.fn(async ({ data }: any) => { updates.push(data); const next = { ...row, ...data, events: undefined }; Object.assign(row, { status: next.status, retiredAt: next.retiredAt, brand: next.brand ?? row.brand, model: next.model ?? row.model, version: next.version ?? row.version }); return { ...row }; }),
        updateMany: jest.fn(async ({ where, data }: any) => { if (row.status !== where.status) return { count: 0 }; updates.push(data); Object.assign(row, data); return { count: 1 }; }),
        findMany: jest.fn(async () => [{ ...row }]),
      },
      shoeUsage: { findMany: jest.fn(async () => []) },
      shoePhoto: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), upsert: jest.fn(async () => ({ updatedAt: new Date() })), deleteMany: jest.fn() },
      shoeEvent: { findMany: jest.fn(async () => []), create: jest.fn(async ({ data }: any) => { events.push(data); return data; }) },
      $transaction: async (fn: any) => fn(prisma),
      targetRace: { findMany: jest.fn(async () => []) },
      sessionExecutionLink: { findMany: jest.fn(async () => []) },
      activityLog: { findMany: jest.fn(async () => []) },
    };
    return { svc: new ShoesService(prisma as never), prisma, updates, created, row, events };
  }

  it('cadastrar grava o evento registered junto, na mesma operacao, e aceita versao', async () => {
    const { svc, created } = service();
    await svc.create('u1', { brand: 'ASICS', model: 'Novablast', version: ' 5 ', startedUsingAt: '2026-01-01' });
    expect(created[0]).toMatchObject({ version: '5', events: { create: { type: 'registered', userId: 'u1' } } });
  });
  it('aposentar muda o estado e grava retired; reativar volta a ativo e grava reactivated (a aposentadoria fica nos eventos)', async () => {
    const { svc, updates, events } = service();
    const retired = await svc.retire('u1', 'shoe-1');
    expect(updates[0]).toMatchObject({ status: 'retired' });
    expect(events.map((e) => e.type)).toEqual(['retired']);
    expect(retired.status).toBe('retired');
    const back = await svc.reactivate('u1', 'shoe-1');
    expect(updates[1]).toMatchObject({ status: 'active', retiredAt: null });
    expect(events.map((e) => e.type)).toEqual(['retired', 'reactivated']);
    expect(back.status).toBe('active');
  });
  it('aposentar duas vezes (toque duplo) gera UM evento e nao sobrescreve a data', async () => {
    const { svc, events, row } = service();
    await svc.retire('u1', 'shoe-1');
    const firstRetiredAt = row.retiredAt;
    await svc.retire('u1', 'shoe-1');
    expect(events.filter((e) => e.type === 'retired')).toHaveLength(1);
    expect(row.retiredAt).toBe(firstRetiredAt);
  });
  it('editar registra so o que mudou; salvar igual nao cria evento', async () => {
    const { svc, updates } = service();
    await svc.update('u1', 'shoe-1', { brand: 'ASICS', model: 'Novablast 5', version: '6', startedUsingAt: '2026-01-01T00:00:00.000Z' });
    expect(updates[0].events.create).toMatchObject({ type: 'edited', details: { version: { from: null, to: '6' } } });
    await svc.update('u1', 'shoe-1', { brand: 'ASICS', model: 'Novablast 5', version: '6', startedUsingAt: '2026-01-01T00:00:00.000Z' });
    expect(updates[1].events).toBeUndefined();
  });
  it('tenis sem corridas: aposentar nao inventa retrospectiva', async () => {
    const { svc } = service();
    expect((await svc.retire('u1', 'shoe-1')).retrospective).toBeNull();
  });
});

describe('fatos de uso: musculacao fora, mesmo evento uma vez, Strava fora do painel', () => {
  async function facts(opts: { hide?: string[]; usages: any[]; links?: any[]; acts?: any[] }) {
    const { loadShoeUsageFacts } = await import('../src/equipment/shoe-facts');
    const acts = opts.acts ?? [];
    const prisma = {
      shoeUsage: { findMany: jest.fn(async () => opts.usages) },
      sessionExecutionLink: { findMany: jest.fn(async () => opts.links ?? []) },
      activityLog: { findMany: jest.fn(async ({ where }: any) => acts.filter((a) => where.id.in.includes(a.id))) },
    };
    return loadShoeUsageFacts(prisma as never, { where: {}, hideProviders: opts.hide });
  }
  const usage = (id: string, completionId: string, sessionId: string | null, modality: string | null, over: any = {}) => ({ id, shoeId: 's1', userId: 'u1', workoutCompletion: { id: completionId, sessionId, completedAt: new Date('2026-10-02T10:00:00Z'), distanceKm: 10, durationMin: 50, status: 'done', session: modality ? { modality } : null, ...over } });
  const act = (id: string, over: any = {}) => ({ id, provider: 'polar', startedAt: new Date('2026-10-02T09:00:00Z'), utcOffsetMinutes: -180, durationSec: 3000, distanceMeters: 10100, physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null, ...over });

  it('musculacao associada ao tenis nao entra na quilometragem de corrida; modalidade desconhecida segue', async () => {
    const result = await facts({ usages: [usage('1', 'c1', 'sa', 'forca', { distanceKm: 3 }), usage('2', 'c2', 'sb', 'corrida'), usage('3', 'c3', null, null)] });
    expect(result.map((r) => r.completionId).sort()).toEqual(['c2', 'c3']);
  });
  it('o mesmo evento fisico recebido de duas fontes nao soma duas vezes (duas execucoes ligadas a mesma observacao canonica)', async () => {
    const polar = act('p1', { physicalIdentityStatus: 'matched', physicalEventId: 'e1', physicalCanonicalActivityLogId: 'p1' });
    const apple = act('a1', { provider: 'apple_health', distanceMeters: 10300, physicalIdentityStatus: 'matched', physicalEventId: 'e1', physicalCanonicalActivityLogId: 'p1' });
    const result = await facts({
      usages: [usage('1', 'c1', 'sa', 'corrida'), usage('2', 'c2', 'sb', 'corrida', { completedAt: new Date('2026-10-03T10:00:00Z') })],
      links: [{ trainingSessionId: 'sa', userId: 'u1', activityLog: polar }, { trainingSessionId: 'sb', userId: 'u1', activityLog: apple }],
      acts: [polar, apple],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ distanceKm: 10.1, provider: 'polar', activityId: 'p1' });
  });
  it('distancia/tempo vem da atividade canonica; sem atividade, do que a aluna digitou; localDate usa o fuso da atividade', async () => {
    const a = act('x1', { startedAt: new Date('2026-10-03T01:30:00Z'), utcOffsetMinutes: -180 });
    const result = await facts({ usages: [usage('1', 'c1', 'sa', 'corrida'), usage('2', 'c2', 'sb', 'corrida')], links: [{ trainingSessionId: 'sa', userId: 'u1', activityLog: a }], acts: [a] });
    const byId = Object.fromEntries(result.map((r) => [r.completionId, r]));
    expect(byId.c1).toMatchObject({ distanceKm: 10.1, durationSec: 3000, localDate: '2026-10-02' });
    expect(byId.c2).toMatchObject({ distanceKm: 10, durationSec: 3000 });
  });
  it('Strava oculto no painel: cai no valor digitado, mas o evento ainda nao duplica', async () => {
    const strava = act('st1', { provider: 'strava', distanceMeters: 99000 });
    const result = await facts({ hide: ['strava'], usages: [usage('1', 'c1', 'sa', 'corrida')], links: [{ trainingSessionId: 'sa', userId: 'u1', activityLog: strava }], acts: [strava] });
    expect(result[0]).toMatchObject({ distanceKm: 10, provider: null, activityId: 'st1' });
  });
  it('dedupe por aluno: o detalhe de um tenis nao conta de novo o treino que a lista atribuiu a outro tenis', async () => {
    const a = act('dd1');
    const u1 = { ...usage('1', 'c1', 'sa', 'corrida'), shoeId: 's1' };
    const u2 = { ...usage('2', 'c2', 'sb', 'corrida', { completedAt: new Date('2026-10-03T10:00:00Z') }), shoeId: 's2' };
    const links = [{ trainingSessionId: 'sa', userId: 'u1', activityLog: a }, { trainingSessionId: 'sb', userId: 'u1', activityLog: a }];
    const { loadShoeUsageFacts } = await import('../src/equipment/shoe-facts');
    const prisma = { shoeUsage: { findMany: jest.fn(async () => [u1, u2]) }, sessionExecutionLink: { findMany: jest.fn(async () => links) }, activityLog: { findMany: jest.fn(async () => [a]) } };
    expect(await loadShoeUsageFacts(prisma as never, { where: { userId: 'u1', shoeId: 's2' } })).toHaveLength(0); // s2 nao recebe o treino ja contado em s1
    expect(await loadShoeUsageFacts(prisma as never, { where: { userId: 'u1', shoeId: 's1' } })).toHaveLength(1);
  });
  it('sem distancia em nenhuma fonte: null (nao zero)', async () => {
    const result = await facts({ usages: [usage('1', 'c1', null, 'corrida', { distanceKm: null, durationMin: null })] });
    expect(result[0]).toMatchObject({ distanceKm: null, durationSec: null });
  });
});

describe('volume do aluno no painel: Strava canonica nao conta', () => {
  it('evento cuja observacao canonica e do Strava nao fornece volume, mesmo a leitura excluindo Strava', async () => {
    const { EquipmentIntelligenceService } = await import('../src/equipment/equipment-intelligence.service');
    const row = { id: 'p1', userId: 'u1', provider: 'polar', sport: 'corrida', distanceMeters: 10000, physicalIdentityStatus: 'matched', physicalEventId: 'e1', physicalCanonicalActivityLogId: 'st1' };
    const strava = { id: 'st1', userId: 'u1', provider: 'strava', sport: 'corrida', distanceMeters: 99000, physicalIdentityStatus: 'matched', physicalEventId: 'e1', physicalCanonicalActivityLogId: 'st1' };
    const other = { id: 'p2', userId: 'u2', provider: 'polar', sport: 'corrida', distanceMeters: 8000, physicalIdentityStatus: 'unique', physicalEventId: null, physicalCanonicalActivityLogId: null };
    const prisma = { activityLog: { findMany: jest.fn(async (args: any) => (args.where.id ? [strava] : [row, other])) } };
    const volume = await (new EquipmentIntelligenceService(prisma as never) as any).runnerVolume(new Date('2026-01-01'), new Date('2026-12-31'));
    expect(volume.get('u1')).toBeUndefined();
    expect(volume.get('u2')).toBe(8);
  });
});

describe('dispositivos do aluno: reconstrucao idempotente e proveniencia', () => {
  function build(activities: any[], existing: any[] = []) {
    const upserts: any[] = [];
    const prisma = {
      activityLog: { findMany: jest.fn(async () => activities), groupBy: jest.fn(async () => []) },
      userDevice: {
        upsert: jest.fn(async (args: any) => { upserts.push(args); return { id: 'd1', ...args.create }; }),
        findMany: jest.fn(async () => existing),
        findFirst: jest.fn(async ({ where }: any) => existing.find((d) => d.id === where.id && d.userId === where.userId) ?? null),
        update: jest.fn(async ({ data }: any) => ({ ...existing[0], ...data })),
      },
    };
    const integrations = { forStudent: jest.fn(async () => ({ integrations: [] })) };
    return { svc: new DevicesService(prisma as never, integrations as never), prisma, upserts };
  }
  const hc = (day: string, manufacturer = 'samsung', model = 'Galaxy Watch6') => ({ provider: 'health_connect', startedAt: new Date(day), providerMetrics: { source: { packageName: 'com.sec.android.app.shealth' }, device: { manufacturer, model, type: 1 } } });

  it('agrupa por caminho+aparelho, conta, guarda primeira/ultima vez e NAO mexe na correcao manual no update', async () => {
    const { svc, upserts } = build([hc('2026-09-01T10:00:00Z'), hc('2026-10-01T10:00:00Z'), { provider: 'strava', startedAt: new Date('2026-10-02'), providerMetrics: { device: 'x' } }]);
    expect(await svc.refreshForUser('u1')).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].create).toMatchObject({ sourceProvider: 'health_connect', observedManufacturer: 'Samsung', observedModel: 'Galaxy Watch6', activityCount: 2 });
    expect(upserts[0].create.firstSeenAt.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(upserts[0].update).not.toHaveProperty('manualManufacturer');
    expect(upserts[0].update).not.toHaveProperty('manualModel');
  });
  it('rodar de novo repete o mesmo upsert (mesma chave unica): nao duplica', async () => {
    const { svc, upserts } = build([hc('2026-09-01T10:00:00Z')]);
    await svc.refreshForUser('u1'); await svc.refreshForUser('u1');
    expect(upserts[0].where).toEqual(upserts[1].where);
  });
  it('correcao manual grava so nas colunas manual*; o observado permanece na resposta', async () => {
    const existing = [{ id: 'd1', userId: 'u1', sourceProvider: 'health_connect', sourceDetail: '', deviceKey: '', observedManufacturer: null, observedModel: null, observedName: null, deviceType: null, manufacturerBasis: null, firstSeenAt: null, lastSeenAt: null, activityCount: 3, manualManufacturer: null, manualModel: null }];
    const { svc, prisma } = build([], existing);
    const view = await svc.correct('u1', 'd1', { manufacturer: ' Garmin ', model: 'Forerunner 265' });
    const data = (prisma.userDevice.update as jest.Mock).mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['manualManufacturer', 'manualModel', 'manualUpdatedAt']);
    expect(view).toMatchObject({ manufacturer: 'Garmin', manufacturerSource: 'manual', corrected: true, observed: { manufacturer: null } });
    await expect(svc.correct('u1', 'd1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.correct('u1', 'd1', { model: 'x'.repeat(61) })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('aparelho informado so pelo aluno fica com plataforma "manual"', async () => {
    const { svc, prisma } = build([]);
    (prisma.userDevice.upsert as jest.Mock).mockImplementationOnce(async (args: any) => ({ id: 'd2', userId: 'u1', observedManufacturer: null, observedModel: null, observedName: null, deviceType: null, manufacturerBasis: null, firstSeenAt: null, lastSeenAt: null, activityCount: 0, sourceDetail: '', ...args.create }));
    const view = await svc.addManual('u1', { manufacturer: 'Coros', model: 'Pace 3' });
    expect(view).toMatchObject({ platform: 'manual', manufacturer: 'Coros', manufacturerSource: 'manual', model: 'Pace 3' });
    await expect(svc.addManual('u1', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('estrutura: somente leitura no painel, so agregados, sem tocar na IA', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', 'src', ...parts), 'utf8');
  it('a rota do painel e restrita a coach/admin e a reconstrucao so a admin', () => {
    const controller = read('equipment', 'equipment-coach.controller.ts');
    expect(controller).toMatch(/@Roles\('coach', 'admin'\)/);
    expect(controller).toMatch(/@Roles\('admin'\)\s*@Post\('refresh-devices'\)/);
    expect(controller).toMatch(/@Controller\('coach\/equipment'\)/);
  });
  it('a analise e a leitura do painel nao gravam nada e nenhum arquivo de IA importa equipamentos', () => {
    const service = read('equipment', 'equipment-intelligence.service.ts');
    expect(service).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany)\(/);
    expect(read('equipment', 'equipment-analysis.ts')).not.toMatch(/prisma/i);
    for (const file of ['training-plans/prescription-agent.service.ts', 'training-intelligence/athlete-state-snapshot.service.ts', 'training-intelligence/compact-agent-context.ts']) {
      expect(read(...file.split('/'))).not.toMatch(/equipment\//);
    }
  });
  it('aluno nao e identificado: o servico do painel nao seleciona nome, e-mail, cpf ou telefone', () => {
    const service = read('equipment', 'equipment-intelligence.service.ts');
    expect(service).not.toMatch(/\b(email|cpf|phone|name:)\b/);
  });
});
