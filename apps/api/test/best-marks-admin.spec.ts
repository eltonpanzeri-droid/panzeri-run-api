import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mark, DistanceMarks, chartPoints, fmtPace, fmtTime, howCollected, markTags, selfDistance, selfLine, summaryOf } from '../../admin/app/best-marks-lib';

// 09/11/2026 — Melhores marcas no painel: formatadores e explicacoes puros + ligacao no menu da Evolucao.
const mark = (over: Partial<Mark> = {}): Mark => ({ distanceId: '5km', seconds: 1500, paceSecondsKm: 300, extraMeters: 0, activityId: 'a', startedAt: '2026-10-05T10:00:00.000Z', localDate: '2026-10-05', runMeters: 5000, windowStartMeters: null, windowEndMeters: null, source: 'device', provider: 'polar', method: 'whole', timeBasis: 'series_clock', ...over });

describe('formatadores e explicacoes do painel', () => {
  it('tempo, pace e etiquetas de origem', () => {
    expect(fmtTime(3900)).toBe('1:05:00');
    expect(fmtTime(228)).toBe('3:48');
    expect(fmtPace(228)).toBe('3:48 /km');
    expect(markTags(mark({ method: 'segment' }))).toEqual(['relógio (polar)', 'trecho de corrida maior']);
    expect(markTags(mark({ source: 'manual', provider: null }))).toEqual(['registro manual']);
    expect(markTags(mark({ extraMeters: 500, timeBasis: 'duration', provider: 'apple_health' }))).toEqual(['relógio (apple_health)', 'tempo da corrida inteira (maior que a distância)', 'sem série para conferir paradas']);
  });
  it('como a marca foi coletada: trecho com km de inicio e fim, manual, teste, sem serie', () => {
    const segment = howCollected(mark({ method: 'segment', runMeters: 12300, windowStartMeters: 3200, windowEndMeters: 8200 }), '5 km').join(' ');
    expect(segment).toContain('do km 3,2 ao km 8,2');
    expect(segment).toContain('sem pausa do relógio dentro do trecho');
    expect(howCollected(mark({ source: 'manual', provider: null, extraMeters: 100, runMeters: 21100 }), 'Meia maratona').join(' ')).toContain('Registro manual feito pela aluna');
    expect(howCollected(mark({ source: 'test', provider: null }), '3 km').join(' ')).toContain('Teste de 3 km');
    expect(howCollected(mark({ timeBasis: 'duration' }), '5 km').join(' ')).toContain('não dá para conferir se houve paradas');
  });
  it('grafico: marca batida so quando mais rapida que todas as anteriores; resumo das distancias', () => {
    const points = chartPoints([mark({ activityId: 'a', localDate: '2026-01-10', seconds: 1700 }), mark({ activityId: 'b', localDate: '2026-03-10', seconds: 1800 }), mark({ activityId: 'c', localDate: '2026-06-10', seconds: 1600 })]);
    expect(points.map((p) => [p.mark.activityId, p.isRecord])).toEqual([['a', true], ['b', false], ['c', true]]);
    const entry = (label: string, localDate: string | null): DistanceMarks => ({ distanceId: label, label, meters: 1, best: localDate ? mark({ localDate }) : null, ranking: [] });
    expect(summaryOf([entry('1 km', '2026-02-01'), entry('5 km', '2026-08-09'), entry('10 km', null)])).toEqual({ withMark: 2, total: 3, latest: { label: '5 km', localDate: '2026-08-09' } });
  });
  it('relato da entrevista com "nao informado" onde faltar', () => {
    expect(selfLine({ rank: 2, distanceKm: 42, distanceRaw: null, timesRun: 5, timeSeconds: null })).toBe('5 vezes nos últimos 6 meses · tempo não informado');
    expect(selfDistance({ rank: 1, distanceKm: 50, distanceRaw: null, timesRun: 1, timeSeconds: 19020 })).toBe('50 km');
  });
});

describe('ligacao no painel', () => {
  it('Melhores marcas e Relatorio mensal sao botoes do menu da Evolucao, ao lado de Registros', () => {
    const hub = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'evolution-hub.tsx'), 'utf8');
    expect(hub).toContain("{ id: 'registros', label: 'Registros' },\n  { id: 'marcas', label: 'Melhores marcas' }, { id: 'relatorio', label: 'Relatório mensal' }");
  });
  it('estilos presentes (os dois blocos usam as mesmas classes)', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'styles.css'), 'utf8');
    for (const selector of ['.bm-hero', '.bm-dist', '.bm-split', '.mr-split', '.mr-frame']) expect(css).toContain(selector);
  });
});
