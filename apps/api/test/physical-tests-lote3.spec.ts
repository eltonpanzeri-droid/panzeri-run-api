import { NotificationTriggersService } from '../src/messaging/notification-triggers.service';
import { reminderDecision, nextReassessmentDue } from '../src/physiology/reference-selection';
import {
  brDateFromIso, buildSeries, describeRawResults, formatIndicatorValue, formatMinSec, formatRange, isoFromBrDate, maskBrDate, nextDueText, paceLabelFromKmh, parseDecimal, parseMinSec, parseMinSecParts,
  RAW_THREE_KM_TIME, todayBrDate, xPositions, type HistoryRow,
} from '../../mobile/src/physicalTests/format';

// Testes físicos, Lote 3 (30/10/2026): helpers da tela (PWA) e lembrete de reavaliação.
describe('formatação e leitura de campos', () => {
  it('km/h e min/km: conversão correta nos dois sentidos de exibição', () => {
    expect(paceLabelFromKmh(12)).toBe('5:00/km');
    expect(paceLabelFromKmh(15.1)).toBe('3:58/km');
    expect(formatIndicatorValue('l2_speed_kmh', 13.15, 'kmh')).toBe('13,2 km/h');
    expect(formatIndicatorValue('l2_speed_kmh', 12, 'pace')).toBe('5:00/km');
    expect(formatIndicatorValue('hrmax_bpm', 185.6, 'pace')).toBe('186 bpm');
    expect(formatIndicatorValue('vo2max', 47.94, 'pace')).toBe('47,9 ml/kg/min');
    expect(formatRange('l2_speed_kmh', 12, 15, 'pace')).toBe('4:00/km a 5:00/km'); // do mais rápido ao mais lento
    expect(formatRange('l2_hr_bpm', 169, 178, 'kmh')).toBe('169 a 178 bpm');
    expect(formatRange('l2_hr_bpm', null, 178, 'kmh')).toBeNull();
    expect(formatMinSec(1235)).toBe('20:35');
  });

  it('tempo: minutos e segundos, vazios e inválidos', () => {
    expect(parseMinSec('20:35')).toBe(1235);
    expect(parseMinSec('20.35')).toBe(1235);
    expect(parseMinSec('20:75')).toBeNull();
    expect(parseMinSec('abc')).toBeNull();
    expect(parseMinSecParts('12', '')).toBe(720);
    expect(parseMinSecParts('12', '35')).toBe(755);
    expect(parseMinSecParts('12', '75')).toBeNull();
    expect(parseDecimal('17,5')).toBe(17.5);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('x')).toBeNull();
  });

  it('data: máscara, conversão para ISO, datas inexistentes e dia atual no horário de Brasília', () => {
    expect(maskBrDate('30102026')).toBe('30/10/2026');
    expect(maskBrDate('3010')).toBe('30/10');
    expect(isoFromBrDate('30/10/2026')).toBe('2026-10-30');
    expect(isoFromBrDate('31/02/2026')).toBeNull();
    expect(isoFromBrDate('2026-10-30')).toBeNull();
    expect(brDateFromIso('2026-10-30')).toBe('30/10/2026');
    expect(todayBrDate(new Date('2026-10-31T01:30:00Z'))).toBe('30/10/2026'); // ainda é dia 30 em Brasília
  });

  it('resultado original descrito como foi informado', () => {
    expect(describeRawResults('three_km', { totalSeconds: 720, maxHeartRate: 186 })).toBe('12:00 para 3 km | FC máxima 186 bpm');
    expect(describeRawResults('cooper_12min', { distanceMeters: 2800 })).toBe('2800 m em 12 min');
    expect(describeRawResults('ergospirometry', { vo2max: 55, hrmax_bpm: 188 })).toBe('2 resultados informados');
    expect(describeRawResults('other', null)).toBe('Resultado informado');
  });

  it('próxima avaliação: texto antes e depois da data sugerida', () => {
    expect(nextDueText('2027-02-20', '2026-10-30')).toBe('Sugerimos repetir seus testes a partir de 20/02/2027.');
    expect(nextDueText('2026-10-01', '2026-10-30')).toBe('Já é um bom momento para repetir seus testes.');
    expect(nextDueText(null, '2026-10-30')).toBeNull();
  });
});

describe('série do gráfico de evolução', () => {
  const row = (id: string, performedAt: string, method: string, raw: any, inds: Array<[string, number, string]>): HistoryRow => ({ assessmentId: id, performedAt, method, methodLabel: method, rawResults: raw, isReference: false, indicators: inds.map(([key, value, origin]) => ({ key, value, unit: '', origin, confidence: 'moderada' })) });
  const rows = [
    row('3', '2026-10-20', 'three_km', { totalSeconds: 720 }, [['vo2max', 47.9, 'estimated']]),
    row('1', '2026-06-02', 'ergospirometry', { vo2max: 51.2 }, [['vo2max', 51.2, 'measured'], ['vvo2max_kmh', 16.5, 'measured']]),
    row('2', '2026-08-10', 'three_km', { totalSeconds: 750 }, [['vo2max', 45.5, 'estimated']]),
    row('4', '2026-09-01', 'other', { hrmax_bpm: 190 }, [['hrmax_bpm', 190, 'reported']]),
  ];

  it('todos os métodos em ordem cronológica, só com pontos que existem (sem ponto artificial)', () => {
    const s = buildSeries(rows, 'all', 'vo2max');
    expect(s.map((p) => p.assessmentId)).toEqual(['1', '2', '3']);
    expect(buildSeries(rows, 'all', 'vvo2max_kmh').map((p) => p.assessmentId)).toEqual(['1']);
    expect(buildSeries(rows, 'all', 'l2_speed_kmh')).toEqual([]);
  });

  it('filtro por método, e tempo bruto dos 3 km quando há testes repetidos', () => {
    expect(buildSeries(rows, 'three_km', 'vo2max').map((p) => p.value)).toEqual([45.5, 47.9]);
    expect(buildSeries(rows, 'all', RAW_THREE_KM_TIME).map((p) => p.value)).toEqual([750, 720]);
    expect(buildSeries(rows, 'ergospirometry', RAW_THREE_KM_TIME)).toEqual([]);
  });

  it('posição horizontal proporcional à data real, não ao número de pontos', () => {
    const xs = xPositions(['2026-01-01', '2026-01-11', '2026-02-10'], 100);
    expect(xs[0]).toBe(0);
    expect(xs[2]).toBe(100);
    expect(xs[1]).toBeCloseTo((10 / 40) * 100, 5);
    expect(xPositions(['2026-01-01'], 100)).toEqual([50]);
    expect(xPositions([], 100)).toEqual([]);
  });
});

describe('lembrete de reavaliação (4 meses)', () => {
  const due = new Date('2026-10-10');
  it('só dispara quando chega a data e dentro da janela; antes não e muito depois também não', () => {
    expect(reminderDecision(due, new Date('2026-10-09T12:00:00Z'))).toBe('ainda_nao');
    expect(reminderDecision(due, new Date('2026-10-10T12:00:00Z'))).toBe('enviar');
    expect(reminderDecision(due, new Date('2026-11-09T12:00:00Z'))).toBe('enviar');
    expect(reminderDecision(due, new Date('2026-11-12T12:00:00Z'))).toBe('fora_da_janela');
    expect(reminderDecision(null, new Date())).toBe('sem_avaliacao');
  });

  function setup(latest: any, student: any = { id: 'u1', expoPushToken: null }) {
    const sent: any[] = [];
    const prisma: any = { physiologicalAssessment: { findFirst: async () => latest } };
    const notifications: any = { notifyUserIfNotRecent: async (userId: string, params: any, hours: number) => { sent.push({ userId, params, hours }); return true; } };
    const svc: any = new NotificationTriggersService(prisma, {} as any, notifications, {} as any);
    return { run: () => svc.checkPhysicalTestReminder(student), sent };
  }
  const assessment = (performedAt: string) => ({ id: 'a1', method: 'three_km', performedAt: new Date(performedAt), createdAt: new Date('2026-06-10T10:00:00Z') });
  const withMode = async (mode: string | undefined, fn: () => Promise<void>) => { const old = process.env.PHYSICAL_TESTS_REMINDERS; if (mode === undefined) delete process.env.PHYSICAL_TESTS_REMINDERS; else process.env.PHYSICAL_TESTS_REMINDERS = mode; try { await fn(); } finally { if (old === undefined) delete process.env.PHYSICAL_TESTS_REMINDERS; else process.env.PHYSICAL_TESTS_REMINDERS = old; } };

  it('desligado por padrão (a seção só existe no PWA): nada é enviado', async () => {
    await withMode(undefined, async () => {
      const t = setup(assessment('2026-01-01'));
      await t.run();
      expect(t.sent).toHaveLength(0);
    });
  });

  it('ligado: avisa uma vez por avaliação, com a identidade da avaliação para não repetir', async () => {
    await withMode('all', async () => {
      const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 4); d.setUTCDate(d.getUTCDate() - 2);
      const t = setup(assessment(d.toISOString().slice(0, 10)));
      await t.run();
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0].params).toMatchObject({ type: 'physical_test_reminder', externalRef: 'physical-test-reminder:a1' });
      expect(t.sent[0].params.message).not.toMatch(/bloque|obrigat|perde/i);
    });
  });

  it('sem avaliação, ou avaliação recente, ou muito antiga: não envia', async () => {
    await withMode('all', async () => {
      for (const latest of [null, assessment(new Date().toISOString().slice(0, 10)), assessment('2025-01-01')]) {
        const t = setup(latest);
        await t.run();
        expect(t.sent).toHaveLength(0);
      }
    });
  });

  it('modo "web": não envia a quem tem o aplicativo nativo (onde a seção está oculta)', async () => {
    await withMode('web', async () => {
      const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 4); d.setUTCDate(d.getUTCDate() - 2);
      const native = setup(assessment(d.toISOString().slice(0, 10)), { id: 'u2', expoPushToken: 'ExponentPushToken[x]' });
      await native.run();
      expect(native.sent).toHaveLength(0);
      const web = setup(assessment(d.toISOString().slice(0, 10)));
      await web.run();
      expect(web.sent).toHaveLength(1);
    });
  });

  it('nova avaliação reinicia a contagem', () => {
    expect(nextReassessmentDue([assessment('2026-06-10')])).toEqual(new Date('2026-10-10'));
    expect(nextReassessmentDue([assessment('2026-06-10'), { ...assessment('2026-09-01'), id: 'a2' }])).toEqual(new Date('2027-01-01'));
  });
});

describe('seção oculta nos aplicativos nativos e sem resquício do teste incremental', () => {
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const mobile = (file: string) => readFileSync(join(__dirname, '..', '..', 'mobile', file), 'utf8');

  it('a configuração libera só o PWA e o menu e a tela dependem dela', () => {
    expect(mobile('src/physicalTests/config.ts')).toContain("Platform.OS === 'web'");
    const app = mobile('App.tsx');
    expect(app).toContain('PHYSICAL_TESTS_ENABLED ? [{ id: \'physicalTests\'');
    expect(app).toContain("activeTab === 'physicalTests' && PHYSICAL_TESTS_ENABLED");
  });

  it('a tela antiga do 3 km (equação 483/t + 3,5 e percentuais fixos de zona) saiu do aplicativo', () => {
    const app = mobile('App.tsx');
    expect(app).not.toContain('function ThreeKmTest');
    expect(app).not.toContain('483 / timeMinutes');
    expect(app).not.toContain('vvo2 * 0.55');
  });

  it('o teste incremental não tem tela, texto nem cálculo nesta etapa', () => {
    const screen = mobile('src/physicalTests/PhysicalTestsScreen.tsx') + mobile('src/physicalTests/texts.ts');
    expect(screen).not.toMatch(/incremental na esteira|estágio de 2 minutos/i);
    expect(readFileSync(join(__dirname, '..', 'src', 'physiology', 'physiology-models.ts'), 'utf8')).not.toMatch(/kuipers|vpico/i);
  });

  it('os textos aprovados da seção estão presentes e sem travessão no lugar de vírgula', () => {
    const texts = mobile('src/physicalTests/texts.ts');
    expect(texts).toContain('Recomendamos repetir seus testes físicos a cada quatro meses.');
    expect(texts).toContain('O Panzeri Run enviará uma notificação quando chegar o momento de realizar uma nova avaliação.');
    expect(texts).not.toContain(' — ');
    expect(texts).not.toMatch(/o que acontece (caso|se) (o aluno|você) deixe/i);
  });
});
