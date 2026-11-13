import 'reflect-metadata';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { getVariableDefinition } from '../src/training-intelligence/variable-registry';
import { AREA_READING, READING_CATALOG } from '../src/training-intelligence/evolution-reading-catalog';
import { MIN_OBSERVATIONS, buildAreaSummary, buildIndicatorResult, levelOf, verdictOf } from '../src/training-intelligence/evolution-summary';
import { EvolutionSummaryService, mainSourceOnly } from '../src/training-intelligence/evolution-summary.service';

// Evolução por REGRA (13/11/2026): textos que refletem a escala de cada indicador, nível, tendência e síntese por área. Séries sintéticas (uma observação por noite).
const math = new MathLayerService();
const entry = (id: string) => READING_CATALOG.find((e) => e.variableId === id)!;
const definition = (id: string) => getVariableDefinition(id)!;
const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 10, 12); // 10/09/2026
const nights = (values: number[]) => values.map((value, i) => ({ value, timestamp: new Date(START + i * DAY) }));
const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);
const result = (id: string, values: number[]) => buildIndicatorResult(entry(id), definition(id), nights(values), math);

describe('regras de nível e tendência', () => {
  it('nível pela posição na escala: 1–5 com 5 = bom: 4 é bom, 3 é intermediário, 2 é ruim; com 1 = bom, o inverso; sem polaridade, nenhum nível', () => {
    const scale = { min: 1, max: 5 };
    expect(levelOf(4.2, scale, 'high')).toBe('good');
    expect(levelOf(3, scale, 'high')).toBe('middle');
    expect(levelOf(2, scale, 'high')).toBe('poor');
    expect(levelOf(1.5, scale, 'low')).toBe('good');
    expect(levelOf(4, scale, 'low')).toBe('poor');
    expect(levelOf(3, scale, null)).toBeNull();
  });

  it('mudança so conta acima de 10% da escala; polaridade decide melhora/piora; sem polaridade so acima/abaixo do habitual', () => {
    const scale = { min: 1, max: 5 };
    expect(verdictOf(0.3, 3, scale, 'up')).toBe('stable');
    expect(verdictOf(0.5, 3, scale, 'up')).toBe('improved');
    expect(verdictOf(0.5, 3, scale, 'down')).toBe('worsened');
    expect(verdictOf(-0.5, 3, scale, 'down')).toBe('improved');
    expect(verdictOf(0.9, 5, scale, null)).toBe('above');
    expect(verdictOf(-0.9, 5, scale, null)).toBe('below');
  });
});

describe('leitura de um indicador (exemplo de Elton: qualidade do sono, média 2, estável)', () => {
  it('média 2 estável: texto diz a escala, por que importa, a média, a tendência estável (curto e longo) e que há menos prontidão; vai para "atenção"', () => {
    const r = result('workout.preSleepQuality', repeat(2, 60));
    expect(r.status).toBe('ok');
    expect(r.level).toBe('poor');
    expect(r.bucket).toBe('attention');
    expect(r.texts.whatItMeasures).toContain('números mais perto de 5 significam que você tende a dormir bem');
    expect(r.texts.whatItMeasures).toContain('recuperação, a prontidão e a possibilidade de evoluir');
    expect(r.texts.habitual).toBe('O seu caso mostra uma média de 2 (60 registros desde 01/08/2026).');
    expect(r.texts.trend).toBe('A tendência é estável, tanto no curto quanto no longo prazo.');
    expect(r.texts.meaning).toContain('menos prontidão para treinar');
    expect(r.texts.meaning).toContain('menor tolerância ao esforço');
  });

  it('média alta e estável: "bom"; escala invertida (interrupções do sono) com média alta: "atenção" e texto próprio da escala', () => {
    expect(result('workout.preSleepQuality', repeat(4.5, 60)).bucket).toBe('good');
    const interrupted = result('workout.sleepInterruption', repeat(4, 60));
    expect(interrupted.level).toBe('poor');
    expect(interrupted.bucket).toBe('attention');
    expect(interrupted.texts.whatItMeasures).toContain('mais perto de 1 significam que o seu sono quase não é interrompido');
    expect(result('workout.sleepInterruption', repeat(1.2, 60)).bucket).toBe('good');
  });

  it('melhora recente: nível intermediário + melhora no curto e no longo prazo = "bom"; texto cita melhora', () => {
    const r = result('workout.preSleepQuality', [...repeat(2.5, 50), ...repeat(4.5, 10)]);
    expect(r.level).toBe('middle');
    expect(r.short?.verdict).toBe('improved');
    expect(r.long?.verdict).toBe('improved');
    expect(r.bucket).toBe('good');
    expect(r.texts.trend).toBe('A tendência mostra melhora, tanto no curto quanto no longo prazo.');
  });

  it('piora recente (fadiga sobe): nivel ainda bom vira "estavel" (a piora e citada no texto); nivel intermediario com piora vira "atencao"', () => {
    const stillGood = result('workout.prePhysicalFatigue', [...repeat(1.5, 50), ...repeat(3.6, 10)]);
    expect(stillGood.level).toBe('good');
    expect(stillGood.short?.verdict).toBe('worsened');
    expect(stillGood.bucket).toBe('steady');
    expect(stillGood.texts.trend).toContain('piora');
    const middle = result('workout.prePhysicalFatigue', [...repeat(2.5, 50), ...repeat(4.5, 10)]);
    expect(middle.level).toBe('middle');
    expect(middle.bucket).toBe('attention');
  });

  it('poucos registros: "dados insuficientes", nada afirmado sobre o padrão; sem polaridade (esforço): nunca melhora/piora, só acompanhado', () => {
    const few = result('workout.preSleepQuality', repeat(2, MIN_OBSERVATIONS - 1));
    expect(few.status).toBe('insufficient');
    expect(few.mean).toBeNull();
    expect(few.texts.habitual).toContain('Ainda não há registros suficientes');
    expect(few.texts.meaning).toBeNull();
    const effort = result('workout.perceivedEffort', [...repeat(4, 50), ...repeat(8, 10)]);
    expect(effort.bucket).toBe('tracked');
    expect(effort.level).toBeNull();
    expect(effort.short?.verdict).toBe('above');
    expect(effort.texts.meaning).toContain('esforço intermediário');
  });

  it('só registros desde 01/08/2026 entram', () => {
    const old = Array.from({ length: 40 }, (_, i) => ({ value: 1, timestamp: new Date(Date.UTC(2026, 5, 1) + i * DAY) }));
    const recent = nights(repeat(5, 12));
    const r = buildIndicatorResult(entry('workout.preSleepQuality'), definition('workout.preSleepQuality'), [...old, ...recent], math);
    expect(r.n).toBe(12);
    expect(r.mean).toBe(5);
  });
});

describe('síntese da área (exemplo de Elton: "6 dos 10 indicadores…")', () => {
  it('conta melhora/padrão bom, intermediário/estável e atenção, separa os apenas acompanhados e escolhe o texto pelo predomínio', () => {
    const ok = (id: string, values: number[]) => result(id, values);
    const indicators = [
      ok('workout.preSleepQuality', repeat(4.6, 60)),
      ok('workout.sleepInterruption', repeat(1.2, 60)),
      ok('workout.sleepDifficulty', repeat(3, 60)),
      ok('workout.preMotivation', repeat(1.5, 60)),
    ];
    const summary = buildAreaSummary('sleep', indicators);
    expect(summary.counts).toMatchObject({ good: 2, steady: 1, attention: 1, evaluated: 4 });
    expect(summary.text).toBe('Nesse quesito (sono e recuperação), dos 4 indicadores avaliados, 2 apresentam melhora ou padrão bom; 1 está em nível intermediário ou estável; 1 apresentam piora ou padrão que merece atenção.');
    expect(summary.meaning).toBe(AREA_READING.find((a) => a.id === 'sleep')!.meaning.mixed);
    const favorable = buildAreaSummary('sleep', [ok('workout.preSleepQuality', repeat(4.6, 60)), ok('workout.sleepInterruption', repeat(1.2, 60))]);
    expect(favorable.meaning).toBe(AREA_READING.find((a) => a.id === 'sleep')!.meaning.favorable);
    const attention = buildAreaSummary('sleep', [ok('workout.preSleepQuality', repeat(1.8, 60)), ok('workout.sleepInterruption', repeat(4.4, 60))]);
    expect(attention.meaning).toBe(AREA_READING.find((a) => a.id === 'sleep')!.meaning.attention);
  });

  it('area sem dados suficientes e area so com indicadores acompanhados nao inventam avaliacao', () => {
    const none = buildAreaSummary('sleep', [result('workout.preSleepQuality', repeat(2, 3))]);
    expect(none.counts.evaluated).toBe(0);
    expect(none.text).toContain('ainda não há registros suficientes');
    expect(none.meaning).toBeNull();
    const tracked = buildAreaSummary('training', [result('training.volumeCompletedTotalKm', repeat(30, 20))]);
    expect(tracked.counts.tracked).toBe(1);
    expect(tracked.meaning).toBeNull();
    expect(tracked.text).toContain('acompanhado');
  });
});

describe('catálogo: coerência com o registro de variáveis e regras de redação', () => {
  it('todo indicador existe no VariableRegistry; os com polaridade têm escala e as três leituras; os sem têm a leitura neutra', () => {
    for (const e of READING_CATALOG) {
      const def = getVariableDefinition(e.variableId);
      expect(def).toBeDefined();
      if (e.levelGoodWhen) {
        expect(def!.scale).toBeDefined();
        expect(e.meaning.good && e.meaning.middle && e.meaning.poor).toBeTruthy();
        expect(e.trendGoodWhen).not.toBeNull();
      } else {
        expect(!!(e.meaning.neutral || e.positionMeaning || e.phrases)).toBe(true);
      }
    }
  });

  it('sem causa direta nem diagnostico nos textos, e cada area existe com os tres textos de sintese', () => {
    const all = READING_CATALOG.flatMap((e) => [e.scaleText, e.why, ...Object.values(e.meaning)]).concat(AREA_READING.flatMap((a) => Object.values(a.meaning))).join(' ').toLowerCase();
    for (const banned of ['causa direta', 'vai se lesionar', 'você vai se lesionar', 'diagnóstico de', 'doença', 'depress']) expect(all).not.toContain(banned);
    expect(AREA_READING.map((a) => a.id).sort()).toEqual(['adherence', 'load', 'sleep', 'training', 'wellbeing']);
    for (const a of AREA_READING) expect(a.meaning.favorable && a.meaning.mixed && a.meaning.attention).toBeTruthy();
  });
});

describe('serviço', () => {
  it('monta as areas com a leitura de cada indicador; um indicador que falha ao ler vira "dados insuficientes" sem derrubar a tela', async () => {
    const reader = {
      getObservations: jest.fn(async (_id: string, variableId: string) => {
        if (variableId === 'workout.sleepDifficulty') throw new Error('falhou');
        return nights(repeat(2, 60)).map((p) => ({ ...p, value: p.value }));
      }),
    };
    const service = new EvolutionSummaryService(reader as never, math);
    const out = await service.forStudent('u1');
    expect(out.areas.map((a) => a.id)).toEqual(['sleep', 'wellbeing', 'load', 'adherence', 'training']);
    const sleep = out.areas.find((a) => a.id === 'sleep')!;
    expect(sleep.indicators.find((i) => i.variableId === 'workout.sleepDifficulty')?.status).toBe('insufficient');
    expect(sleep.indicators.find((i) => i.variableId === 'workout.preSleepQuality')?.bucket).toBe('attention');
    expect(out.status).toBe('rascunho_a_revisar');
    expect(out.since).toBe('2026-08-01');
  });
});

// Regras de Elton (14/11/2026): esforço, volume, ritmo e medidas do relógio.
describe('esforço, volume, ritmo e relógio', () => {
  const NOW = new Date(START + 130 * DAY);
  const weeks = (values: number[]) => values.map((value, i) => ({ value, timestamp: new Date(START + i * 7 * DAY) }));

  it('esforço percebido sempre alto: texto de boa tolerância E de intensidade sempre forte (risco de lesão, abandono); iniciantes; nunca "bom/ruim"', () => {
    const r = result('workout.perceivedEffort', repeat(8.5, 40));
    expect(r.bucket).toBe('tracked');
    expect(r.texts.whatItMeasures).toContain('Quem está começando');
    expect(r.texts.meaning).toContain('boa tolerância ao esforço');
    expect(r.texts.meaning).toContain('intensidade está sempre muito forte');
    expect(r.texts.meaning).toContain('risco de lesões');
    expect(r.texts.meaning).toContain('abandono');
    expect(result('workout.perceivedEffort', repeat(5, 40)).texts.meaning).toContain('esforço intermediário');
    expect(result('workout.perceivedEffort', repeat(2, 40)).texts.meaning).toContain('esforço baixo');
  });

  it('volume: padrão de longo prazo, última semana observável contra o padrão, tendência recente e texto sem qualificar; a semana em curso fica fora', () => {
    const base = [...repeat(30, 14), ...repeat(40, 4)];
    const series = [...weeks(base), { value: 3, timestamp: new Date(NOW.getTime() - 2 * DAY) }]; // semana em curso, incompleta: ignorada
    const r = buildIndicatorResult(entry('training.volumeCompletedTotalKm'), definition('training.volumeCompletedTotalKm'), series, math, new Date(START + 18 * 7 * DAY + 2 * DAY));
    expect(r.n).toBe(18);
    expect(r.texts.habitual).toContain('A sua tendência de longo prazo é de cerca de');
    expect(r.texts.habitual).toContain('A última semana observável teve 40 km, acima do seu padrão');
    expect(r.texts.whatItMeasures).toContain('maior risco de lesões e de sobrecarga');
    expect(r.bucket).toBe('tracked');
    // professor: diz o que a tendência representa (aumento de volume = mais resultado, mais risco), sem qualificar o volume
    expect(r.texts.meaning).toContain('O seu volume semanal vem aumentando');
    expect(r.texts.meaning).toContain('risco de lesões e de sobrecarga');
    expect(r.texts.trend ?? '').not.toMatch(/melhora|piora/);
  });

  it('ritmo: só métrica e tendência com as palavras de ritmo (mais lento/mais rápido), sem melhora/piora e com a nota de que o ganho vem no longo prazo', () => {
    const faster = result('activity.avgPaceSecondsKm', [...repeat(400, 60), ...repeat(340, 30)]);
    expect(faster.texts.trend).toContain('ritmo médio mais rápido');
    expect(faster.texts.trend).not.toMatch(/melhora|piora/);
    expect(faster.texts.whatItMeasures).toContain('principalmente no longo prazo');
    expect(faster.texts.whatItMeasures).toContain('sem avaliar capacidade');
    expect(faster.bucket).toBe('tracked');
    // professor: explica o que o ritmo mais rápido representa e que a melhora vem no longo prazo
    expect(faster.texts.meaning).toContain('O seu ritmo médio vem ficando mais rápido');
    expect(faster.texts.meaning).toContain('principalmente no longo prazo');
    expect(result('activity.avgPaceSecondsKm', repeat(330, 90)).texts.meaning).toContain('O seu ritmo médio está estável');
    expect(result('activity.avgPaceSecondsKm', [...repeat(330, 60), ...repeat(400, 30)]).texts.meaning).toContain('mais lento');
    expect(faster.texts.habitual).toMatch(/\d:\d\d\/km/);
  });

  it('relógio: sono em horas e minutos, tendência por aumento/queda, texto de "parte de um todo" e sem julgar o nível', () => {
    const deep = result('wearable.sleepDeepMin', [...repeat(80, 60), ...repeat(50, 30)]);
    expect(deep.bucket).toBe('tracked');
    expect(deep.texts.habitual).toContain('1 h');
    expect(deep.texts.trend).toContain('queda do sono profundo');
    expect(deep.texts.meaning).toContain('parte de um todo');
    expect(deep.texts.meaning).toContain('Não é diagnóstico');
    expect(result('wearable.restingHeartRateBpm', repeat(52, 40)).texts.habitual).toContain('52 bpm');
  });

  it('relógio: só a fonte principal (a ativa e mais constante) e só a sessão principal da noite; sem fonte identificada usa tudo', async () => {
    const mk = (days: number, value: number, sourceKey: string, sessionRole: 'principal' | 'additional' = 'principal') =>
      Array.from({ length: days }, (_, i) => ({ value, timestamp: new Date(NOW.getTime() - (days - i) * DAY), context: { sourceKey, sessionRole } }));
    const rows = [...mk(40, 400, 'garmin'), ...mk(6, 300, 'health_connect:app.x'), ...mk(40, 90, 'garmin', 'additional')];
    const kept = mainSourceOnly(rows, NOW);
    expect(kept.length).toBe(40);
    expect(kept.every((r) => r.value === 400)).toBe(true);
    const semFonte = [{ value: 1, timestamp: NOW, context: {} }];
    expect(mainSourceOnly(semFonte, NOW)).toEqual(semFonte);
    expect(mainSourceOnly([{ value: 1, timestamp: NOW } as never], NOW).length).toBe(1);
  });
});

describe('volume prescrito, razão e extras (14/11/2026)', () => {
  const T0 = Date.UTC(2026, 8, 10, 12);
  const weekly = (values: number[]) => values.map((value, i) => ({ value, timestamp: new Date(T0 + i * 7 * 86_400_000) }));
  it('razão aparece em % e o prescrito descreve o que o programa pediu, sem qualificar', () => {
    const entryOf = (id: string) => READING_CATALOG.find((x) => x.variableId === id)!;
    const ratio = buildIndicatorResult(entryOf('training.volumeRatioCompletedPrescribed'), getVariableDefinition('training.volumeRatioCompletedPrescribed')!, weekly([...Array.from({ length: 14 }, () => 1), ...Array.from({ length: 4 }, () => 0.8)]), new MathLayerService(), new Date(T0 + 18 * 7 * 86_400_000 + 2 * 86_400_000));
    expect(ratio.texts.habitual).toContain('Em média, você realizou 96% do volume prescrito');
    expect(ratio.texts.habitual).toContain('A última semana observável teve 80%');
    expect(ratio.bucket).toBe('tracked');
    const prescribed = buildIndicatorResult(entryOf('training.volumePrescribedKm'), getVariableDefinition('training.volumePrescribedKm')!, weekly(Array.from({ length: 12 }, () => 40)), new MathLayerService(), new Date(T0 + 130 * 86_400_000));
    expect(prescribed.texts.habitual).toContain('O seu programa tem pedido cerca de 40 km por semana');
    expect(prescribed.texts.whatItMeasures).toContain('não o que você fez');
  });
});
