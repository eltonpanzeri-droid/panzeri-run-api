import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BestMark, DistanceMarks, HOW_COLLECTED_STEPS, MARKS_EXPLANATION, howCollected, markChartPoints, marksSummary, mondayOf, SELF_REPORT_EXPLANATION, formatMarkDate, formatMarkPace, formatMarkTime, markTags, selfReportedDistanceLabel, selfReportedLine } from '../../mobile/home/bestMarks';

// 09/11/2026 — Melhores marcas, Lote 2: textos e formatadores puros da tela + ligacao das telas (aluna e painel).
const mark = (over: Partial<BestMark> = {}): BestMark => ({ distanceId: '5km', seconds: 1500, paceSecondsKm: 300, extraMeters: 0, activityId: 'a', startedAt: '2026-10-05T10:00:00.000Z', localDate: '2026-10-05', runMeters: 5000, windowStartMeters: null, windowEndMeters: null, source: 'device', provider: 'zepp', method: 'whole', timeBasis: 'series_clock', ...over });

describe('formatadores das melhores marcas', () => {
  it('tempo em h:mm:ss ou m:ss, pace m:ss /km e data dd/mm/aaaa', () => {
    expect(formatMarkTime(3900)).toBe('1:05:00');
    expect(formatMarkTime(1500)).toBe('25:00');
    expect(formatMarkTime(59)).toBe('0:59');
    expect(formatMarkPace(390)).toBe('6:30 /km');
    expect(formatMarkDate('2026-10-05T10:00:00.000Z')).toBe('05/10/2026');
  });
});

describe('etiquetas de origem (a aluna sempre ve de onde veio o tempo)', () => {
  it('relogio, manual, teste, trecho e tempo sem serie', () => {
    expect(markTags(mark())).toEqual(['relógio']);
    expect(markTags(mark({ source: 'manual', provider: null }))).toEqual(['registro manual']);
    expect(markTags(mark({ source: 'test', provider: null }))).toEqual(['teste de 3 km']);
    expect(markTags(mark({ method: 'segment' }))).toEqual(['relógio', 'trecho de uma corrida maior']);
    expect(markTags(mark({ extraMeters: 2000 }))).toEqual(['relógio', 'tempo da corrida inteira, que foi maior que esta distância']);
    expect(markTags(mark({ timeBasis: 'duration' }))).toEqual(['relógio', 'tempo informado pelo relógio, sem série para conferir paradas']);
    expect(markTags(mark({ source: 'manual', provider: null, timeBasis: 'duration' }))).toEqual(['registro manual']); // manual nao recebe o aviso de relogio
  });
});

describe('relato da entrevista', () => {
  it('mostra "nao informado" onde faltar e nunca inventa valor', () => {
    expect(selfReportedLine({ rank: 2, distanceKm: 16, distanceRaw: null, timesRun: 3, timeSeconds: null })).toBe('3 vezes · tempo não informado');
    expect(selfReportedLine({ rank: 1, distanceKm: 21, distanceRaw: null, timesRun: 1, timeSeconds: 6630 })).toBe('1 vez · tempo 1:50:30');
    expect(selfReportedLine({ rank: 3, distanceKm: 10, distanceRaw: null, timesRun: null, timeSeconds: null })).toBe('quantidade de vezes não informada · tempo não informado');
    expect(selfReportedDistanceLabel({ rank: 1, distanceKm: 10.5, distanceRaw: null, timesRun: null, timeSeconds: null })).toBe('10,5 km');
    expect(selfReportedDistanceLabel({ rank: 1, distanceKm: null, distanceRaw: 'entre_10_e_15', timesRun: null, timeSeconds: null })).toBe('entre_10_e_15');
  });
  it('os textos explicam o criterio e que o relato nao e comprovado', () => {
    expect(MARKS_EXPLANATION).toContain('tempo total da atividade, incluindo paradas');
    expect(MARKS_EXPLANATION).toContain('registro manual');
    expect(SELF_REPORT_EXPLANATION).toContain('relatos seus');
    expect(SELF_REPORT_EXPLANATION).toContain('não entram nas melhores marcas registradas');
    expect(`${MARKS_EXPLANATION} ${SELF_REPORT_EXPLANATION}`).not.toMatch(/motor|plano de treino|Strava/i);
  });
});

describe('como a marca foi coletada (explicacao por marca)', () => {
  it('trecho do relogio diz onde comeca e termina e que nao houve pausa', () => {
    const lines = howCollected(mark({ method: 'segment', runMeters: 12300, windowStartMeters: 3200, windowEndMeters: 8200 }), '5 km');
    expect(lines.join(' ')).toContain('Atividade do relógio (zepp) de 05/10/2026 com 12,3 km');
    expect(lines.join(' ')).toContain('melhor trecho de 5 km dentro dela: do km 3,2 ao km 8,2');
    expect(lines.join(' ')).toContain('sem nenhuma pausa do relógio dentro do trecho');
  });
  it('corrida inteira com serie, sem serie, manual e teste', () => {
    expect(howCollected(mark(), '5 km').join(' ')).toContain('Tempo total da atividade pelo relógio corrido, incluindo paradas');
    expect(howCollected(mark({ timeBasis: 'duration' }), '5 km').join(' ')).toContain('não dá para conferir se houve paradas');
    expect(howCollected(mark({ extraMeters: 2000, runMeters: 7000 }), '5 km').join(' ')).toContain('vale o tempo da atividade toda');
    const manual = howCollected(mark({ source: 'manual', provider: null, extraMeters: 100, runMeters: 21100 }), 'Meia maratona').join(' ');
    expect(manual).toContain('Registro manual feito por você em 05/10/2026 com 21,1 km');
    expect(manual).toContain('não confere esse dado com o relógio');
    expect(howCollected(mark({ source: 'test', provider: null, runMeters: 3000 }), '3 km').join(' ')).toContain('Teste de 3 km feito em 05/10/2026');
  });
  it('nunca usa termos proibidos e a explicacao geral cobre as regras', () => {
    const all = [...HOW_COLLECTED_STEPS, ...howCollected(mark(), '5 km')].join(' ');
    expect(all).not.toMatch(/motor|plano de treino/i);
    expect(HOW_COLLECTED_STEPS.join(' ')).toContain('Corrida menor que a distância não conta');
    expect(HOW_COLLECTED_STEPS.join(' ')).toContain('Dados do Strava não são usados');
  });
});

describe('grafico, resumo e abertura da semana', () => {
  it('"marca batida" so quando ficou mais rapido que todas as anteriores, em ordem de data', () => {
    const marks = [
      mark({ activityId: 'a', localDate: '2026-01-10', seconds: 1700 }),
      mark({ activityId: 'b', localDate: '2026-03-10', seconds: 1800 }),
      mark({ activityId: 'c', localDate: '2026-06-10', seconds: 1600 }),
    ];
    const points = markChartPoints(marks);
    expect(points.map((p) => [p.mark.activityId, p.isRecord])).toEqual([['a', true], ['b', false], ['c', true]]);
    expect(markChartPoints([])).toEqual([]);
  });
  it('resumo: quantas distancias tem marca e qual a mais recente', () => {
    const entry = (label: string, localDate: string | null): DistanceMarks => ({ distanceId: label, label, meters: 1, best: localDate ? mark({ localDate }) : null, ranking: [] });
    expect(marksSummary([entry('1 km', '2026-02-01'), entry('5 km', '2026-08-09'), entry('10 km', null)])).toEqual({ withMark: 2, total: 3, latest: { label: '5 km', localDate: '2026-08-09' } });
    expect(marksSummary([entry('1 km', null)])).toEqual({ withMark: 0, total: 1, latest: null });
  });
  it('mondayOf devolve a segunda-feira da semana do dia (domingo pertence a semana que termina nele)', () => {
    expect(mondayOf('2026-08-09')).toBe('2026-08-03'); // domingo
    expect(mondayOf('2026-08-03')).toBe('2026-08-03'); // segunda
    expect(mondayOf('2026-08-05')).toBe('2026-08-03'); // quarta
  });
});

describe('ligacao das telas', () => {
  it('a aluna abre "Melhores marcas" pela Evolução e o painel mostra o bloco na aba Evolução', () => {
    const hub = readFileSync(join(__dirname, '..', '..', 'mobile', 'home', 'EvolutionHub.tsx'), 'utf8');
    const screen = readFileSync(join(__dirname, '..', '..', 'mobile', 'home', 'BestMarksScreen.tsx'), 'utf8');
    const admin = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8');
    expect(hub).toContain('<BestMarksScreen accessToken={accessToken}');
    expect(hub).toContain('onOpenActivity={onOpenActivity} onOpenWeekOfDate={onOpenWeekOfDate}');
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('onOpenActivity={(activityLogId) => setMarksActivityId(activityLogId)}');
    expect(app).toContain('computeWeekOffsetMobile(mondayOf(localDate))');
    expect(app).toContain('<ActivityDetailModal activityLogId={marksActivityId}');
    expect(screen).toContain('/me/best-marks');
    expect(admin).toContain('marcas: <BestMarks studentId={student.id} accessToken={token} apiUrl={API_URL} />');
    const adminHub = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'evolution-hub.tsx'), 'utf8');
    expect(adminHub).toContain("{ id: 'marcas', label: 'Melhores marcas' }, { id: 'relatorio', label: 'Relatório mensal' }");
  });
});
