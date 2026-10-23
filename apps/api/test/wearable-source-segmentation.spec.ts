import { TrainingIntelligenceQueryService } from '../src/training-intelligence/training-intelligence-query.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import { Observation, ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { compactVariable } from '../src/training-intelligence/compact-agent-context';
import { buildPairedEvidence } from '../src/training-intelligence/paired-evidence';
import { VARIABLE_REGISTRY } from '../src/training-intelligence/variable-registry';
import {
  chooseMainSource,
  ecosystemOfSourceKey,
  isSourceSegmentationEnabled,
  sleepSessionRoles,
  sourceKeyOf,
  type SourceActivity,
} from '../src/training-intelligence/wearable-source';
import { ecosystemKeyOf } from '../src/activity-execution/physical-canonical';
import { runWithAiScope } from '../src/ai-governance/ai-scope';

// 22/10/2026 — Etapa 1: matematica de dados de relogio SEPARADA POR FONTE. Dados sinteticos; nenhum banco.

const NOW = new Date('2026-10-22T12:00:00.000Z');
const day = (offsetFromNow: number) => new Date(NOW.getTime() + offsetFromNow * 86_400_000);
const ZEPP = 'zepp';
const SHEALTH = 'health_connect:com.sec.android.app.shealth';
const OTHER_APP = 'health_connect:com.example.sleepapp';

function obs(variableId: string, sourceKey: string, daysAgo: number, value: number, extra: Partial<Observation['context']> = {}): Observation {
  return { athleteId: 'a1', variableId, value, timestamp: day(-daysAgo), source: 'wearable_health', instrumentVersion: 1, context: { sourceKey, provider: sourceKey.split(':')[0], ...extra } };
}

function service(observations: Observation[], preferred: string | null = null) {
  const reader = { getObservations: jest.fn().mockResolvedValue(observations), preferredSourceProvider: jest.fn().mockResolvedValue(preferred) };
  const mathLayer = new MathLayerService();
  return new TrainingIntelligenceQueryService(reader as never, mathLayer, new LongitudinalDynamicsService(mathLayer));
}

const SLEEP = 'wearable.sleepDurationMin';
const HRV = 'wearable.hrvLastNightAvg';

beforeAll(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

describe('wearable-source: funcoes puras', () => {
  it('chave da fonte: Zepp = provedor; Health Connect inclui o app de origem; origem ausente nao quebra', () => {
    expect(sourceKeyOf('zepp', 'abc123')).toBe('zepp');
    expect(sourceKeyOf('health_connect', 'com.sec.android.app.shealth|sleep:2026-10-21')).toBe(SHEALTH);
    expect(sourceKeyOf('health_connect', null)).toBe('health_connect:origem_desconhecida');
    expect(sourceKeyOf('health_connect', '|x')).toBe('health_connect:origem_desconhecida');
  });

  it('o ecossistema da fonte e o mesmo vocabulario de physical-canonical.ecosystemKeyOf (nao divergem)', () => {
    for (const pkg of ['com.sec.android.app.shealth', 'fi.polar.polarflow', 'com.garmin.android.apps.connectmobile', 'com.strava', 'com.example.sleepapp']) {
      const expected = ecosystemKeyOf('health_connect', { source: { packageName: pkg } }) ?? 'health_connect';
      expect(ecosystemOfSourceKey(`health_connect:${pkg}`)).toBe(expected);
    }
    expect(ecosystemOfSourceKey('zepp')).toBe('zepp');
  });

  it('a separacao por fonte vem ligada e desliga por variavel de ambiente', () => {
    expect(isSourceSegmentationEnabled({})).toBe(true);
    for (const off of ['false', '0', 'off', 'no', 'FALSE']) expect(isSourceSegmentationEnabled({ WEARABLE_SOURCE_SEGMENTATION_ENABLED: off })).toBe(false);
    expect(isSourceSegmentationEnabled({ WEARABLE_SOURCE_SEGMENTATION_ENABLED: 'true' })).toBe(true);
  });

  const activity = (key: string, daysAgo: number[]): SourceActivity => ({ key, timestamps: daysAgo.map((d) => day(-d)) });

  it('fonte unica e vazio', () => {
    expect(chooseMainSource([activity(ZEPP, [1, 2])], null, NOW)).toBe(ZEPP);
    expect(chooseMainSource([], null, NOW)).toBeNull();
  });

  it('ATUALIDADE: fonte com dado antigo nao prevalece sobre a que sincroniza, nem com preferencia explicita', () => {
    const stale = activity(ZEPP, [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]); // muito dado, mas parou ha 30 dias
    const fresh = activity(SHEALTH, [1, 2]);
    expect(chooseMainSource([stale, fresh], null, NOW)).toBe(SHEALTH);
    expect(chooseMainSource([stale, fresh], 'zepp', NOW)).toBe(SHEALTH); // preferencia nao resgata fonte inativa
    expect(chooseMainSource([fresh, stale], 'zepp', NOW)).toBe(SHEALTH); // independe da ordem
  });

  it('preferencia explicita desempata entre fontes ATIVAS, por provedor ou por ecossistema', () => {
    const a = activity(ZEPP, [1, 2, 3, 4, 5, 6]);
    const b = activity(SHEALTH, [1]);
    expect(chooseMainSource([a, b], null, NOW)).toBe(ZEPP); // mais cobertura
    expect(chooseMainSource([a, b], 'samsung', NOW)).toBe(SHEALTH); // ecossistema
    expect(chooseMainSource([a, b], 'health_connect', NOW)).toBe(SHEALTH); // provedor
    expect(chooseMainSource([a, b], 'polar', NOW)).toBe(ZEPP); // preferencia sem dado nesta variavel: ignorada
  });

  it('ninguem ativo: vence o dado MAIS recente; desempate final alfabetico e estavel; ordem das fontes e irrelevante', () => {
    const a = activity(ZEPP, [20, 21]);
    const b = activity(SHEALTH, [15]);
    expect(chooseMainSource([a, b], null, NOW)).toBe(SHEALTH);
    const x = activity(OTHER_APP, [2]);
    const y = activity(SHEALTH, [2]);
    expect(chooseMainSource([x, y], null, NOW)).toBe(OTHER_APP); // empate total -> chave menor
    expect(chooseMainSource([y, x], null, NOW)).toBe(OTHER_APP);
  });

  it('sono: sessoes da mesma fonte e dia viram principal + adicional, NENHUMA e descartada; fontes diferentes nao se comparam', () => {
    const rows = [
      { id: 'n', sourceKey: SHEALTH, calendarDate: '2026-10-21', durationSec: 4 * 3600, startTimeSec: 100 },
      { id: 'm', sourceKey: SHEALTH, calendarDate: '2026-10-21', durationSec: 3 * 3600, startTimeSec: 50 },
      { id: 'z', sourceKey: ZEPP, calendarDate: '2026-10-21', durationSec: 60, startTimeSec: 10 },
      { id: 'o', sourceKey: SHEALTH, calendarDate: '2026-10-20', durationSec: 8 * 3600, startTimeSec: 1 },
    ];
    const roles = sleepSessionRoles(rows);
    expect(roles.size).toBe(rows.length);
    expect(roles.get('n')).toBe('principal');
    expect(roles.get('m')).toBe('additional');
    expect(roles.get('z')).toBe('principal'); // outra fonte: papel proprio, mesmo sendo curta
    expect(roles.get('o')).toBe('principal');
    expect([...sleepSessionRoles([...rows].reverse())]).toEqual(expect.arrayContaining([...roles]));
  });
});

describe('leitor: registros preservados e etiquetados', () => {
  const sleep = (id: string, provider: string, summaryId: string | null, date: string, start: number, durationSec: number) => ({
    id, userId: 'a1', provider, providerSummaryId: summaryId, calendarDate: date, startTimeSec: start, durationSec,
    deepSleepSec: null, lightSleepSec: null, remSleepSec: null, awakeSec: null, napTotalSec: null, scoreValue: null,
  });
  const reader = (rows: unknown[]) => {
    const r = Object.create(ObservationReaderService.prototype) as any;
    r.prisma = { wearableSleepSummary: { findMany: async () => rows } };
    return r;
  };

  it('duas sessoes na mesma fonte e dia continuam duas observacoes, com papeis; a fonte vai no contexto', async () => {
    const rows = [
      sleep('s1', 'health_connect', 'com.sec.android.app.shealth|a', '2026-10-21', 100, 4 * 3600),
      sleep('s2', 'health_connect', 'com.sec.android.app.shealth|b', '2026-10-21', 50, 3 * 3600),
      sleep('z1', 'zepp', 'zepp-1', '2026-10-21', 10, 7 * 3600),
    ];
    const result = await reader(rows).readWearableHealthVariable('a1', VARIABLE_REGISTRY[SLEEP]);
    expect(result).toHaveLength(3);
    const byId = Object.fromEntries(result.map((o: Observation) => [o.context.wearableRecordId, o.context]));
    expect(byId.s1).toMatchObject({ sourceKey: SHEALTH, sessionRole: 'principal' });
    expect(byId.s2).toMatchObject({ sourceKey: SHEALTH, sessionRole: 'additional' });
    expect(byId.z1).toMatchObject({ sourceKey: ZEPP, sessionRole: 'principal' });
  });

  it('fonte bloqueada pela aluna nao aparece nem influencia os papeis', async () => {
    const rows = [sleep('s1', 'zepp', 'z', '2026-10-21', 100, 3600), sleep('h1', 'health_connect', 'com.sec.android.app.shealth|a', '2026-10-21', 50, 7200)];
    await runWithAiScope({ userId: 'a1', destination: 'external_ai', blocked: [], blockedHealth: ['health_connect:sleep'], computedAt: Date.now() } as never, async () => {
      const result = await reader(rows).readWearableHealthVariable('a1', VARIABLE_REGISTRY[SLEEP]);
      expect(result.map((o: Observation) => o.context.wearableRecordId)).toEqual(['s1']);
    });
  });

  it('todas as variaveis wearable.* sao declaradas nao comparaveis entre fontes, sem excecao', () => {
    const ids = Object.keys(VARIABLE_REGISTRY).filter((id) => id.startsWith('wearable.'));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(VARIABLE_REGISTRY[id].crossSourceComparability).toBe('not_comparable');
    // e nenhuma outra variavel foi tocada
    for (const [id, def] of Object.entries(VARIABLE_REGISTRY)) if (!id.startsWith('wearable.')) expect(def.crossSourceComparability).toBeUndefined();
  });
});

describe('matematica separada por fonte', () => {
  const nights = (key: string, from: number, to: number, base: number) => {
    const list: Observation[] = [];
    for (let d = from; d <= to; d += 1) list.push(obs(SLEEP, key, d, base + (d % 3)));
    return list;
  };

  it('DOURADO: com uma fonte so, o resultado e identico ao da separacao desligada e nao ha campos novos', async () => {
    const data = nights(ZEPP, 1, 40, 420);
    const on = await service(data).getVariableSnapshot('a1', SLEEP);
    const previous = process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED;
    process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED = 'false';
    const off = await service(data).getVariableSnapshot('a1', SLEEP);
    if (previous === undefined) delete process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED;
    else process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED = previous;
    expect(on).toEqual(off);
    expect(on.availableSources).toBeUndefined();
    expect(on.mainSource).toBeUndefined();
    expect(on.evidence.comparabilityWarning).toBeNull();
    expect(on.evidence.n).toBe(40);
  });

  it('duas fontes na mesma noite: cada uma tem a sua serie; nenhuma noite e contada em dobro; a principal alimenta o resultado', async () => {
    const data = [...nights(ZEPP, 1, 20, 400), ...nights(SHEALTH, 1, 20, 480)];
    const svc = service(data);
    const main = await svc.getVariableSnapshot('a1', SLEEP);
    expect(main.availableSources).toHaveLength(2);
    expect(main.availableSources!.map((s) => s.n)).toEqual([20, 20]);
    expect(main.evidence.n).toBe(20); // nunca 40
    expect(main.mainSource).toBe(main.selectedSource);
    const other = main.selectedSource === ZEPP ? SHEALTH : ZEPP;
    const second = await svc.getVariableSnapshot('a1', SLEEP, undefined, other);
    expect(second.evidence.n).toBe(20);
    expect(second.selectedSource).toBe(other);
    // medias nunca misturadas: cada fonte so' enxerga os proprios valores
    const meanOf = (r: typeof main) => r.mean!.value!;
    expect(Math.abs(meanOf(main) - meanOf(second))).toBeGreaterThan(70);
    expect(main.evidence.comparabilityWarning).toMatch(/NAO sao comparaveis/);
    expect(main.evidence.comparabilityWarning).toMatch(/mudanca fisiologica/);
  });

  it('troca de dispositivo: a linha de base e a tendencia da fonte nova NAO herdam a antiga', async () => {
    const data = [...nights(ZEPP, 30, 60, 300), ...nights(SHEALTH, 1, 15, 480)]; // Zepp parou ha 30 dias, Health Connect sincroniza
    const result = await service(data).getVariableSnapshot('a1', SLEEP);
    expect(result.selectedSource).toBe(SHEALTH);
    expect(result.evidence.n).toBe(15);
    expect(result.baseline!.n).toBe(15);
    expect(result.baseline!.value!).toBeGreaterThan(470); // nenhum valor de 300 contamina a linha de base
    const old = await service(data).getVariableSnapshot('a1', SLEEP, undefined, ZEPP);
    expect(old.evidence.n).toBe(31);
    expect(old.baseline!.value!).toBeLessThan(310);
  });

  it('alternancia A,B,A: cada fonte mantem a serie continua, sem reinicio', async () => {
    const data = [...nights(ZEPP, 20, 40, 400), ...nights(SHEALTH, 10, 19, 480), ...nights(ZEPP, 1, 9, 400)];
    const svc = service(data);
    expect((await svc.getVariableSnapshot('a1', SLEEP, undefined, ZEPP)).evidence.n).toBe(21 + 9);
    expect((await svc.getVariableSnapshot('a1', SLEEP, undefined, SHEALTH)).evidence.n).toBe(10);
    expect((await svc.getVariableSnapshot('a1', SLEEP)).selectedSource).toBe(ZEPP); // volta a ser a ativa com mais cobertura
  });

  it('preferencia explicita da aluna e respeitada quando a fonte esta ativa e ignorada quando parada', async () => {
    const active = [...nights(ZEPP, 1, 30, 400), ...nights(SHEALTH, 1, 5, 480)];
    expect((await service(active, 'samsung').getVariableSnapshot('a1', SLEEP)).selectedSource).toBe(SHEALTH);
    const stalePref = [...nights(ZEPP, 1, 30, 400), ...nights(SHEALTH, 20, 25, 480)];
    expect((await service(stalePref, 'samsung').getVariableSnapshot('a1', SLEEP)).selectedSource).toBe(ZEPP);
  });

  it('HRV de metodos incompativeis (noite Zepp x dia Health Connect) nunca se misturam, mesmo com valores numericamente parecidos', async () => {
    const hrv: Observation[] = [];
    for (let d = 1; d <= 10; d += 1) { hrv.push(obs(HRV, ZEPP, d, 48)); hrv.push(obs(HRV, 'health_connect:com.sec.android.app.shealth', d, 48)); }
    const result = await service(hrv).getVariableSnapshot('a1', HRV);
    expect(result.evidence.n).toBe(10);
    expect(result.availableSources).toHaveLength(2);
    expect(result.evidence.comparabilityWarning).toMatch(/NAO sao comparaveis/);
  });

  it('separacao desligada: volta ao comportamento anterior (series juntas, sem aviso de fonte)', async () => {
    const data = [...nights(ZEPP, 1, 10, 400), ...nights(SHEALTH, 1, 10, 480)];
    const previous = process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED;
    process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED = 'false';
    try {
      const result = await service(data).getVariableSnapshot('a1', SLEEP);
      expect(result.evidence.n).toBe(20);
      expect(result.availableSources).toBeUndefined();
      expect(result.evidence.comparabilityWarning).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED;
      else process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED = previous;
    }
  });

  it('sono dividido: as sessoes adicionais da mesma fonte continuam na serie (nada descartado); o papel fica no rastro', async () => {
    const data = [obs(SLEEP, SHEALTH, 1, 300, { sessionRole: 'principal' }), obs(SLEEP, SHEALTH, 1, 120, { sessionRole: 'additional' })];
    data[1].timestamp = new Date(data[1].timestamp.getTime() + 1000);
    const result = await service(data).getVariableSnapshot('a1', SLEEP);
    expect(result.evidence.n).toBe(2);
    expect(result.observations.map((o) => o.context.sessionRole)).toEqual(['principal', 'additional']);
  });

  it('contexto compacto: com mais de uma fonte traz mainSource + otherSources; com uma so e identico ao anterior', async () => {
    const svc = service([...nights(ZEPP, 1, 20, 400), ...nights(SHEALTH, 1, 20, 480)]);
    const main = await svc.getVariableSnapshot('a1', SLEEP);
    const other = main.selectedSource === ZEPP ? SHEALTH : ZEPP;
    const { observations: _a, ...mainRest } = main;
    const { observations: _b, ...otherRest } = await svc.getVariableSnapshot('a1', SLEEP, undefined, other);
    const compact = compactVariable({ ...mainRest, bySource: { [other]: otherRest } });
    expect(compact.mainSource).toBe(main.selectedSource);
    expect(Object.keys(compact.otherSources!)).toEqual([other]);
    expect(compact.otherSources![other].evidence.n).toBe(20);
    expect(compact.evidence.comparabilityWarning).toMatch(/NAO sao comparaveis/);

    const single = await service(nights(ZEPP, 1, 20, 400)).getVariableSnapshot('a1', SLEEP);
    const { observations: _c, ...singleRest } = single;
    const singleCompact = compactVariable(singleRest);
    expect(singleCompact.mainSource).toBeUndefined();
    expect(singleCompact.otherSources).toBeUndefined();
  });
});

describe('evidencia pareada de sono usa a fonte principal e deixa a limitacao explicita', () => {
  const summary = (id: string, provider: string, summaryId: string, date: string, start: number, durationSec: number) => ({
    id, provider, providerSummaryId: summaryId, calendarDate: date, startTimeSec: start, durationSec,
    deepSleepSec: null, lightSleepSec: null, remSleepSec: null, awakeSec: null, scoreValue: null,
  });
  const db = (rows: unknown[]) => ({
    workoutCompletion: { findMany: async () => [] },
    nightlySleepLog: { findMany: async () => [{ nightDate: new Date('2026-10-21T00:00:00.000Z'), sleepQuality: 4, sleepDurationCategory: null }] },
    wearableSleepSummary: { findMany: async () => rows },
  });

  it('com duas fontes no dia, usa a principal informada; sem informacao, a de chave menor (ordem fixa)', async () => {
    const rows = [summary('z', 'zepp', 'zepp-1', '2026-10-21', 10, 7 * 3600), summary('h', 'health_connect', 'com.sec.android.app.shealth|1', '2026-10-21', 20, 6 * 3600)];
    const withKey = await buildPairedEvidence(db(rows) as never, 'a1', NOW, { sleepSourceKey: SHEALTH });
    expect(withKey.sleepPerceivedVsDevice[0].device.provider).toBe('health_connect');
    const withoutKey = await buildPairedEvidence(db(rows) as never, 'a1', NOW);
    expect(withoutKey.sleepPerceivedVsDevice[0].device.provider).toBe('health_connect'); // 'health_connect:...' < 'zepp'
    const zeppMain = await buildPairedEvidence(db(rows) as never, 'a1', NOW, { sleepSourceKey: ZEPP });
    expect(zeppMain.sleepPerceivedVsDevice[0].device.provider).toBe('zepp');
  });

  it('sono dividido na fonte escolhida: usa a maior sessao e AVISA que nao e a noite inteira; uma sessao so: nenhum campo novo', async () => {
    const split = [summary('a', 'health_connect', 'com.sec.android.app.shealth|1', '2026-10-21', 100, 4 * 3600), summary('b', 'health_connect', 'com.sec.android.app.shealth|2', '2026-10-21', 50, 3 * 3600)];
    const result = await buildPairedEvidence(db(split) as never, 'a1', NOW, { sleepSourceKey: SHEALTH });
    const device = result.sleepPerceivedVsDevice[0].device;
    expect(device.durationMin).toBe(240);
    expect(device.additionalSessions).toBe(1);
    expect(device.durationScope).toMatch(/NAO e necessariamente a duracao total da noite/);

    const single = await buildPairedEvidence(db([split[0]]) as never, 'a1', NOW, { sleepSourceKey: SHEALTH });
    expect(single.sleepPerceivedVsDevice[0].device).not.toHaveProperty('additionalSessions');
    expect(single.sleepPerceivedVsDevice[0].device).not.toHaveProperty('durationScope');
  });
});
