import { TrainingIntelligenceQueryService } from '../src/training-intelligence/training-intelligence-query.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';
import type { Observation } from '../src/training-intelligence/observation-reader.service';
import { compactVariable } from '../src/training-intelligence/compact-agent-context';
import { buildPairedEvidence } from '../src/training-intelligence/paired-evidence';
import { chooseMainSource, MAX_SECONDARY_SOURCES, rankSources } from '../src/training-intelligence/wearable-source';

// 22/10/2026 — achados da revisao independente da Etapa 1 (fontes de dados de relogio): rollback fiel da evidencia pareada, dia sem a fonte principal, teto de fontes, fonte pedida,
// relogio com data no futuro.

const NOW = new Date('2026-10-22T12:00:00.000Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);
const ZEPP = 'zepp';
const SHEALTH = 'health_connect:com.sec.android.app.shealth';
const SLEEP = 'wearable.sleepDurationMin';

beforeAll(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

function obs(sourceKey: string, daysAgo: number, value: number): Observation {
  return { athleteId: 'a1', variableId: SLEEP, value, timestamp: day(-daysAgo), source: 'wearable_health', instrumentVersion: 1, context: { sourceKey } };
}
function service(observations: Observation[]) {
  const reader = { getObservations: jest.fn().mockResolvedValue(observations), preferredSourceProvider: jest.fn().mockResolvedValue(null) };
  const mathLayer = new MathLayerService();
  return new TrainingIntelligenceQueryService(reader as never, mathLayer, new LongitudinalDynamicsService(mathLayer));
}
const nights = (key: string, from: number, to: number, base: number) => { const list: Observation[] = []; for (let d = from; d <= to; d += 1) list.push(obs(key, d, base + (d % 3))); return list; };

describe('fonte pedida e ordem de relevancia', () => {
  it('fonte pedida SEMPRE filtra, mesmo quando so resta um grupo (nunca devolve a serie inteira como se fosse dela)', async () => {
    const svc = service(nights(ZEPP, 1, 10, 400));
    const missing = await svc.getVariableSnapshot('a1', SLEEP, undefined, SHEALTH);
    expect(missing.evidence.n).toBe(0);
    expect(missing.selectedSource).toBe(SHEALTH);
    const own = await svc.getVariableSnapshot('a1', SLEEP, undefined, ZEPP);
    expect(own.evidence.n).toBe(10);
  });

  it('availableSources vem em ordem de relevancia (principal primeiro) e as secundarias levam aviso curto', async () => {
    const svc = service([...nights(ZEPP, 1, 20, 400), ...nights(SHEALTH, 1, 5, 480), ...nights('health_connect:com.example.a', 1, 3, 450)]);
    const main = await svc.getVariableSnapshot('a1', SLEEP);
    expect(main.availableSources!.map((s) => s.key)).toEqual([ZEPP, SHEALTH, 'health_connect:com.example.a']);
    expect(main.mainSource).toBe(ZEPP);
    expect(main.evidence.comparabilityWarning).toMatch(/3 fontes diferentes/);
    const secondary = await svc.getVariableSnapshot('a1', SLEEP, undefined, SHEALTH);
    expect(secondary.evidence.comparabilityWarning).toMatch(/Fonte secundaria/);
    expect(secondary.evidence.comparabilityWarning).not.toMatch(/3 fontes diferentes/);
  });
});

describe('ranking de fontes', () => {
  const activity = (key: string, daysAgo: number[]) => ({ key, timestamps: daysAgo.map((d) => day(-d)) });

  it('rankSources e a mesma ordem de chooseMainSource e independe da ordem de entrada', () => {
    const list = [activity(SHEALTH, [1, 2, 3]), activity(ZEPP, [1]), activity('health_connect:com.example.a', [40, 41])];
    const ranked = rankSources(list, null, NOW);
    expect(ranked).toEqual([SHEALTH, ZEPP, 'health_connect:com.example.a']);
    expect(rankSources([...list].reverse(), null, NOW)).toEqual(ranked);
    expect(chooseMainSource(list, null, NOW)).toBe(ranked[0]);
  });

  it('relogio com data no FUTURO nao ganha por "mais recente" nem por cobertura', () => {
    const future = activity('health_connect:com.example.clockwrong', [-30, -29, -28, -27]); // 30 dias NO FUTURO
    const real = activity(ZEPP, [1, 2]);
    expect(chooseMainSource([future, real], null, NOW)).toBe(ZEPP); // datas futuras valem no maximo 'agora' e nao contam como cobertura: vence quem tem dado real
    expect(chooseMainSource([real, future], null, NOW)).toBe(ZEPP);
  });

  it('teto de fontes secundarias detalhadas e uma constante pequena e positiva', () => {
    expect(MAX_SECONDARY_SOURCES).toBeGreaterThan(0);
    expect(MAX_SECONDARY_SOURCES).toBeLessThanOrEqual(5);
  });

  it('contexto compacto informa quantas fontes secundarias ficaram sem detalhe', async () => {
    const svc = service([...nights(ZEPP, 1, 10, 400), ...nights(SHEALTH, 1, 10, 480)]);
    const { observations: _a, ...main } = await svc.getVariableSnapshot('a1', SLEEP);
    const compact = compactVariable({ ...main, omittedSecondarySources: 2 });
    expect(compact.omittedOtherSources).toBeUndefined(); // sem bySource nada e' anunciado
    const { observations: _b, ...second } = await svc.getVariableSnapshot('a1', SLEEP, undefined, SHEALTH);
    const withOthers = compactVariable({ ...main, bySource: { [SHEALTH]: second }, omittedSecondarySources: 2 });
    expect(withOthers.omittedOtherSources).toBe(2);
    expect(Object.keys(withOthers.otherSources!)).toEqual([SHEALTH]);
  });
});

describe('evidencia pareada: rollback fiel e nunca troca de fonte num dia', () => {
  const summary = (id: string, provider: string, summaryId: string, date: string, start: number, durationSec: number) => ({
    id, provider, providerSummaryId: summaryId, calendarDate: date, startTimeSec: start, durationSec,
    deepSleepSec: null, lightSleepSec: null, remSleepSec: null, awakeSec: null, scoreValue: null,
  });
  const db = (rows: unknown[], dates: string[]) => ({
    workoutCompletion: { findMany: async () => [] },
    nightlySleepLog: { findMany: async () => dates.map((d) => ({ nightDate: new Date(`${d}T00:00:00.000Z`), sleepQuality: 4, sleepDurationCategory: null })) },
    wearableSleepSummary: { findMany: async () => rows },
  });
  const withEnv = async <T>(value: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const previous = process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED;
    if (value === undefined) delete process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED; else process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED = value;
    try { return await fn(); } finally { if (previous === undefined) delete process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED; else process.env.WEARABLE_SOURCE_SEGMENTATION_ENABLED = previous; }
  };
  const t = (d: string) => Math.floor(Date.parse(`${d}T00:00:00.000Z`) / 1000);

  it('separacao DESLIGADA: comportamento anterior — maior duracao do dia entre todas as fontes, sem campos novos', async () => {
    const rows = [summary('z', 'zepp', 'zepp-1', '2026-10-21', t('2026-10-21'), 8 * 3600), summary('h', 'health_connect', 'com.sec.android.app.shealth|1', '2026-10-21', t('2026-10-21'), 6 * 3600)];
    const result = await withEnv('false', () => buildPairedEvidence(db(rows, ['2026-10-21']) as never, 'a1', NOW, { sleepSourceKey: SHEALTH }));
    const device = result.sleepPerceivedVsDevice[0].device;
    expect(device.provider).toBe('zepp'); // a maior duracao, ignorando a fonte
    expect(device).not.toHaveProperty('sourceKey');
    expect(device).not.toHaveProperty('additionalSessions');
  });

  it('separacao desligada com uma fonte e duas sessoes: formato antigo (sem additionalSessions/durationScope)', async () => {
    const rows = [summary('a', 'zepp', 'z1', '2026-10-21', 1, 4 * 3600), summary('b', 'zepp', 'z2', '2026-10-21', 2, 3 * 3600)];
    const result = await withEnv('false', () => buildPairedEvidence(db(rows, ['2026-10-21']) as never, 'a1', NOW));
    expect(result.sleepPerceivedVsDevice[0].device).not.toHaveProperty('additionalSessions');
    expect(result.sleepPerceivedVsDevice[0].device.durationMin).toBe(240);
  });

  it('dia SEM linha da fonte principal e pulado (nunca substituido por outra fonte) e a fonte vai rotulada quando ha mais de uma', async () => {
    const rows = [
      summary('z1', 'zepp', 'zepp-1', '2026-10-20', t('2026-10-20'), 7 * 3600), // dia 20: so' Zepp
      summary('h2', 'health_connect', 'com.sec.android.app.shealth|2', '2026-10-21', t('2026-10-21'), 6 * 3600), // dia 21: Health Connect
      summary('z2', 'zepp', 'zepp-2', '2026-10-21', t('2026-10-21'), 5 * 3600),
    ];
    const result = await buildPairedEvidence(db(rows, ['2026-10-20', '2026-10-21']) as never, 'a1', NOW, { sleepSourceKey: SHEALTH });
    expect(result.sleepPerceivedVsDevice.map((p) => p.date)).toEqual(['2026-10-21']); // o dia 20 (so' Zepp) NAO aparece
    expect(result.sleepPerceivedVsDevice[0].device).toMatchObject({ provider: 'health_connect', sourceKey: SHEALTH });
  });

  it('uma fonte so e separacao ligada: nenhum rotulo de fonte; sono dividido avisa a limitacao', async () => {
    const rows = [summary('a', 'zepp', 'z1', '2026-10-21', 1, 4 * 3600), summary('b', 'zepp', 'z2', '2026-10-21', 2, 3 * 3600)];
    const result = await buildPairedEvidence(db(rows, ['2026-10-21']) as never, 'a1', NOW);
    const device = result.sleepPerceivedVsDevice[0].device;
    expect(device).not.toHaveProperty('sourceKey');
    expect(device.additionalSessions).toBe(1);
    expect(device.durationScope).toMatch(/NAO e necessariamente a duracao total da noite/);
  });
});

describe('prompt de prescricao: regra de comparabilidade entre fontes (texto aprovado por Elton em 23/10/2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrescriptionAgentService } = require('../src/training-plans/prescription-agent.service');
  const weekly = (): string => (new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as never, { enqueue: jest.fn() } as never) as any).buildSystemPromptStable();

  it('ensina a nao comparar fontes, a nao ler troca de aparelho como mudanca do corpo e a manter a fonte identificada', () => {
    const text = weekly();
    expect(text).toContain('otherSources');
    expect(text).toContain('mainSource');
    expect(text).toContain('NAO sao comparaveis');
    expect(text).toContain('NUNCA compare nem some valores entre fontes');
    expect(text).toContain('troca de aparelho ou de app');
    expect(text).toContain('mantenha a fonte identificada');
    expect(text).toContain('omittedOtherSources');
    expect(text).toContain('nao ha dado dela disponivel e autorizado, nunca que o valor e zero'); // ancora unica (a frase solta tambem existe no item de byModality)
  });

  it('AJUSTE 1: nao presume historico curto na fonte recem-selecionada; avalia n, periodo observado e atualidade', () => {
    const text = weekly();
    expect(text).toContain('NAO presuma que a mainSource tem historico curto');
    expect(text).toContain('evidence.n, evidence.observedSpan');
    expect(text).toContain('evidence.lastObservationAt');
    expect(text).not.toContain('a serie dela ainda e curta');
  });

  it('AJUSTE 2: sessao principal de sono nao e o sono total da noite e sessao curta nao prova privacao de sono', () => {
    const text = weekly();
    expect(text).toContain('SONO medido por aparelho (vale mesmo com uma fonte so)');
    expect(text).toContain('de UMA sessao de sono registrada pela fonte, NAO necessariamente o sono total da noite');
    expect(text).toContain('uma noite dividida pode aparecer como mais de uma observacao');
    expect(text).toContain('device.durationMin e a duracao da sessao principal da fonte (a maior do dia)');
    expect(text).toContain('additionalSessions');
    expect(text).toContain('NAO conclua privacao de sono apenas porque uma sessao, ou a sessao principal, foi curta');
  });

  it('a regra do sono vale FORA da condicional de varias fontes (item proprio)', () => {
    const text = weekly();
    const multiSourceItem = text.slice(text.indexOf('Quando uma entrada em athleteStateContext.variables tiver "otherSources"'), text.indexOf('SONO medido por aparelho'));
    expect(multiSourceItem.length).toBeGreaterThan(500);
    expect(multiSourceItem).not.toContain('privacao de sono');
  });

  it('o prompt estavel e identico entre chamadas (cache nao depende de aluno)', () => {
    expect(weekly()).toBe(weekly());
  });
});
