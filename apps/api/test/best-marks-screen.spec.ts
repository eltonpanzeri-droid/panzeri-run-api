import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BestMark, MARKS_EXPLANATION, SELF_REPORT_EXPLANATION, formatMarkDate, formatMarkPace, formatMarkTime, markTags, selfReportedDistanceLabel, selfReportedLine } from '../../mobile/home/bestMarks';

// 09/11/2026 — Melhores marcas, Lote 2: textos e formatadores puros da tela + ligacao das telas (aluna e painel).
const mark = (over: Partial<BestMark> = {}): BestMark => ({ distanceId: '5km', seconds: 1500, paceSecondsKm: 300, activityId: 'a', startedAt: '2026-10-05T10:00:00.000Z', source: 'device', provider: 'zepp', method: 'whole', timeBasis: 'series_clock', ...over });

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

describe('ligacao das telas', () => {
  it('a aluna abre "Melhores marcas" pela Evolução e o painel mostra o bloco na aba Evolução', () => {
    const hub = readFileSync(join(__dirname, '..', '..', 'mobile', 'home', 'EvolutionHub.tsx'), 'utf8');
    const screen = readFileSync(join(__dirname, '..', '..', 'mobile', 'home', 'BestMarksScreen.tsx'), 'utf8');
    const admin = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8');
    expect(hub).toContain('<BestMarksScreen accessToken={accessToken}');
    expect(screen).toContain('/me/best-marks');
    expect(admin).toContain('<BestMarks studentId={student.id} accessToken={token} apiUrl={API_URL} />');
  });
});
