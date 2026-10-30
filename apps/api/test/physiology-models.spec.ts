import { ageOn, danielsFromPerformance, danielsOxygenCost, danielsSustainedFraction, estimateFromPerformance, estimateThresholdsAndZones, formatPaceSeconds, kmhToPaceSeconds, levelFor, normalizeSex, paceSecondsToKmh, predictedMaxHeartRate } from '../src/physiology/physiology-models';

// Testes físicos, Lote 2 (30/10/2026). Valores conferidos contra exemplos publicados de Daniels e Gilbert e contra os artigos citados.
const ind = (estimate: ReturnType<typeof estimateFromPerformance>, key: string) => estimate.indicators.find((i) => i.key === key);

describe('Daniels e Gilbert (1979)', () => {
  it('reproduz os exemplos publicados: 10 km em 40:00 dá 51,9 e em 55:00 dá 35,77', () => {
    expect(danielsFromPerformance(10000, 2400).vdot).toBeCloseTo(51.95, 1);
    expect(danielsFromPerformance(10000, 3300).vdot).toBeCloseTo(35.77, 1);
  });
  it('3 km em 12:00 dá VDOT 47,9 e velocidade no VO2máx de 15,1 km/h', () => {
    const r = danielsFromPerformance(3000, 720);
    expect(r.vdot).toBeCloseTo(47.9, 1);
    expect(r.vvo2Kmh).toBeCloseTo(15.1, 1);
    expect(r.inDomain).toBe(true);
  });
  it('o custo de oxigênio na velocidade no VO2máx devolve o próprio VDOT (inversão coerente)', () => {
    const r = danielsFromPerformance(3000, 900);
    expect(danielsOxygenCost((r.vvo2Kmh * 1000) / 60)).toBeCloseTo(r.vdot, 5);
    expect(danielsSustainedFraction(12)).toBeGreaterThan(0.98);
  });
  it('fora do domínio (VDOT abaixo de 30) é sinalizado, não escondido', () => {
    expect(danielsFromPerformance(3000, 1200).inDomain).toBe(false);
  });
});

describe('conversões km/h e min/km', () => {
  it('ida e volta sem perda e formato correto', () => {
    expect(kmhToPaceSeconds(12)).toBe(300);
    expect(paceSecondsToKmh(300)).toBe(12);
    expect(paceSecondsToKmh(kmhToPaceSeconds(13.37))).toBeCloseTo(13.37, 10);
    expect(formatPaceSeconds(238.4)).toBe('3:58');
    expect(formatPaceSeconds(359.6)).toBe('6:00');
  });
});

describe('FC máxima por idade', () => {
  it('Tanaka para homens e sexo não informado; Gulati para mulheres', () => {
    expect(predictedMaxHeartRate('M', 40)).toBe(180);
    expect(predictedMaxHeartRate(null, 40)).toBe(180);
    expect(predictedMaxHeartRate('F', 40)).toBeCloseTo(170.8, 5);
  });
  it('idade na data do teste, sem erro de aniversário, e idade absurda vira desconhecida', () => {
    expect(ageOn(new Date('1985-10-31'), new Date('2026-10-30'))).toBe(40);
    expect(ageOn(new Date('1985-10-30'), new Date('2026-10-30'))).toBe(41);
    expect(ageOn(null, new Date())).toBeNull();
    expect(ageOn(new Date('2026-01-01'), new Date('2026-10-30'))).toBeNull();
    expect(normalizeSex('Feminino')).toBe('F');
    expect(normalizeSex('masculino')).toBe('M');
    expect(normalizeSex('prefiro_nao_informar')).toBeNull();
  });
});

describe('Esteve-Lanao: nível pelo VO2 e limites', () => {
  it('classifica pelos limites do artigo', () => {
    expect(levelFor('M', 76)).toBe('elite');
    expect(levelFor('M', 75.4)).toBe('high');
    expect(levelFor('M', 62.2)).toBe('moderate');
    expect(levelFor('M', 54.2)).toBe('lowModerate');
    expect(levelFor('M', 54.1)).toBe('low');
    expect(levelFor('F', 49.7)).toBe('lowModerate');
    expect(levelFor('F', 49.6)).toBe('low');
  });
});

describe('estimativa a partir dos 3 km', () => {
  const base = { distanceMeters: 3000, totalSeconds: 720, sex: 'M' as const, age: 40 };

  it('com FC informada: VO2, vVO2, FCmáx observada (rótulo "informada"), L1, L2 e zonas por ritmo e FC', () => {
    const e = estimateFromPerformance({ ...base, observedMaxHeartRate: 185 });
    expect(ind(e, 'vo2max')).toMatchObject({ value: 47.9, origin: 'estimated', confidence: 'moderada' });
    expect(ind(e, 'vvo2max_kmh')?.value).toBeCloseTo(15.1, 1);
    expect(ind(e, 'hrmax_bpm')).toMatchObject({ value: 185, origin: 'reported' });
    // homem, VO2 47,9 = nível "baixo": L2 = 87,1% e L1 = 72,9% da vVO2máx; FC no L2 = 93,4% e no L1 = 84,8% da FCmáx
    expect(ind(e, 'l2_speed_kmh')?.value).toBeCloseTo(15.1 * 0.871, 1);
    expect(ind(e, 'l1_speed_kmh')?.value).toBeCloseTo(15.1 * 0.729, 1);
    expect(ind(e, 'l2_hr_bpm')?.value).toBe(Math.round(185 * 0.934));
    expect(ind(e, 'l1_hr_bpm')?.value).toBe(Math.round(185 * 0.848));
    expect(ind(e, 'l1_speed_kmh')?.confidence).toBe('baixa');
    expect(ind(e, 'l2_speed_kmh')?.confidence).toBe('moderada');
    expect(ind(e, 'l2_speed_kmh')?.rangeLow).toBeLessThan(ind(e, 'l2_speed_kmh')!.value);
    expect(e.zones.map((z) => z.id)).toEqual(['Z1-Z2', 'Z3', 'Z4', 'Z5', 'Z6']);
    expect(e.zones[1].speedKmh[0]).toBe(ind(e, 'l1_speed_kmh')?.value);
    expect(e.zones[1].speedKmh[1]).toBe(ind(e, 'l2_speed_kmh')?.value);
    expect(e.zones[2].heartRate?.[1]).toBe(185);
    expect(e.zones[0].paceSecondsPerKm[1]).toBeNull();
  });

  it('SEM FC informada: usa a idade, rotula como estimada e com confiança baixa; as zonas de FC existem mas dizem que são estimadas', () => {
    const e = estimateFromPerformance(base);
    expect(ind(e, 'hrmax_bpm')).toMatchObject({ value: 180, origin: 'estimated', confidence: 'baixa' });
    expect(ind(e, 'l2_hr_bpm')?.confidence).toBe('baixa');
    expect(e.limitations.join(' ')).toContain('estimada pela idade');
  });

  it('sem FC e sem idade: não inventa FC nem zonas de FC', () => {
    const e = estimateFromPerformance({ ...base, age: null });
    expect(ind(e, 'hrmax_bpm')).toBeUndefined();
    expect(ind(e, 'l2_hr_bpm')).toBeUndefined();
    expect(e.zones.every((z) => z.heartRate === undefined)).toBe(true);
    expect(ind(e, 'l2_speed_kmh')).toBeDefined();
  });

  it('mulher usa Gulati e as tabelas femininas; sexo não informado usa a amostra inteira', () => {
    const f = estimateFromPerformance({ ...base, sex: 'F' });
    expect(ind(f, 'hrmax_bpm')?.value).toBe(171);
    expect(ind(f, 'l2_speed_kmh')?.basis).toMatchObject({ percentualDaVelocidadeNoVo2: 88.4 });
    const n = estimateFromPerformance({ ...base, sex: null });
    expect(ind(n, 'l2_speed_kmh')?.basis).toMatchObject({ percentualDaVelocidadeNoVo2: 87.6 });
    expect(ind(n, 'l1_speed_kmh')?.basis).toMatchObject({ percentualDaVelocidadeNoVo2: 73.9 });
  });

  it('desempenho abaixo do domínio de Daniels: tudo com confiança baixa e a limitação aparece', () => {
    const e = estimateFromPerformance({ ...base, totalSeconds: 1500, observedMaxHeartRate: 170 });
    expect(ind(e, 'vo2max')?.confidence).toBe('baixa');
    expect(ind(e, 'l2_speed_kmh')?.confidence).toBe('baixa');
    expect(e.limitations.join(' ')).toContain('VDOT 30');
  });

  it('a maior FC do teste é guardada com a FC prevista pela idade ao lado, sem trocar o valor informado', () => {
    const e = estimateFromPerformance({ ...base, observedMaxHeartRate: 150 });
    expect(ind(e, 'hrmax_bpm')?.value).toBe(150);
    expect(ind(e, 'hrmax_bpm')?.basis).toMatchObject({ previstaPelaIdade: 180, diferencaBpm: -30 });
  });

  it('valores já informados (ergoespirometria) nunca são sobrescritos por estimativa', () => {
    const e = estimateFromPerformance({ ...base, provided: { vo2max: 55, vvo2max_kmh: 18, hrmax_bpm: 190 } });
    expect(ind(e, 'vo2max')).toBeUndefined();
    expect(ind(e, 'vvo2max_kmh')).toBeUndefined();
    expect(ind(e, 'hrmax_bpm')).toBeUndefined();
    // L1 e L2 vêm da velocidade informada (18 km/h), nível pelo VO2 informado (55 = baixo-moderado para homens)
    expect(ind(e, 'l2_speed_kmh')?.value).toBeCloseTo(18 * 0.867, 1);
  });

  it('thresholds a partir de uma vVO2 medida', () => {
    const r = estimateThresholdsAndZones({ vvo2: 18, vo2: 60, hrMax: 190, hrIsReal: true, sex: 'M', lowBase: false });
    expect(r.indicators.map((i) => i.key).sort()).toEqual(['l1_hr_bpm', 'l1_speed_kmh', 'l2_hr_bpm', 'l2_speed_kmh']);
    expect(r.zones[3].speedKmh).toEqual([17.46, 18.54]); // Z5: 3% para menos e para mais da velocidade no VO2max
  });
});
