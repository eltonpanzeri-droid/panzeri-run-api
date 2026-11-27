import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { buildPainReading, PAIN_LEVEL_VALUE } from '../src/pain-reports/pain-reading';
import { READING_CATALOG } from '../src/training-intelligence/evolution-reading-catalog';
import type { PainHistoryEntry } from '../src/pain-reports/pain-history';

// 15/11/2026 — dor: todo treino registrado sem relato de dor vale ZERO (marcado "sem dor" ou sem feedback). Quem nunca relatou dor não pode aparecer como "sem dados".
const math = new MathLayerService();
const now = new Date('2026-11-15T12:00:00Z');
const entry = (day: number, level: PainHistoryEntry['level'], answered = true): PainHistoryEntry => ({ id: `s${day}`, date: new Date(Date.UTC(2026, 9, day)).toISOString().slice(0, 10), modality: 'corrida', level, intensity: ({ none: 0, leve: 3, moderado: 5, forte: 8 } as const)[level], nativeScale: false, answered, timing: null, origin: 'prescrita' });

describe('leitura da dor por treino', () => {
  it('escala 0 a 3: sem dor = 0, leve = 1, moderada = 2, forte = 3', () => {
    expect(PAIN_LEVEL_VALUE).toEqual({ none: 0, leve: 1, moderado: 2, forte: 3 });
  });

  it('todos os treinos sem dor (inclusive os sem feedback): a leitura diz que não há dor, nunca "sem dados"', () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(1 + i, 'none', i % 2 === 0)); // metade sem feedback (zero assumido)
    const result = buildPainReading('pain.perWorkout', { entries, reports: [] }, math, now)!;
    expect(result.status).toBe('ok');
    expect(result.mean).toBe(0);
    expect(result.guide.howYouAre[0]).toContain('não relatou dor em nenhum dos 12 treinos registrados');
    expect(result.guide.howYouAre[0]).toContain('registrado sem feedback, vale zero');
    expect(result.guide.numbers[0].value).toBe('0');
  });

  it('poucos treinos, todos sem dor: ainda assim diz que não há dor (não "registros insuficientes") e mostra média 0', () => {
    const result = buildPainReading('pain.perWorkout', { entries: [entry(1, 'none'), entry(2, 'none', false), entry(3, 'none')], reports: [] }, math, now)!;
    expect(result.status).toBe('insufficient');
    expect(result.guide.howYouAre.join(' ')).toContain('não relatou dor em nenhum dos 3 treinos registrados');
    expect(result.guide.howYouAre.join(' ')).not.toContain('Ainda não temos registros suficientes');
    expect(result.guide.numbers[0]).toMatchObject({ label: 'Sua média', value: '0' });
  });

  it('com dor em alguns treinos: média acima de zero, sem a frase de "nenhuma dor"', () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(1 + i, i >= 8 ? 'moderado' : 'none'));
    const result = buildPainReading('pain.perWorkout', { entries, reports: [] }, math, now)!;
    expect(result.mean).toBeGreaterThan(0);
    expect(result.guide.howYouAre.join(' ')).not.toContain('não relatou dor em nenhum');
  });

  it('treino anterior a 01/08/2026 não entra', () => {
    const old: PainHistoryEntry = { ...entry(1, 'forte'), date: '2026-07-20' };
    const result = buildPainReading('pain.perWorkout', { entries: [old], reports: [] }, math, now)!;
    expect(result.n).toBe(0);
  });
});

describe('leitura dos relatos de dor', () => {
  it('nenhum relato: diz "nenhum relato", não "poucos registros"', () => {
    const result = buildPainReading('pain.reports', { entries: [], reports: [] }, math, now)!;
    expect(result.guide.numbers[0]).toMatchObject({ label: 'Relatos de dor', value: 'nenhum' });
    expect(result.guide.howYouAre[0]).toContain('não fez nenhum relato de dor');
  });
  it('poucos relatos: conta e mostra o último com a data', () => {
    const result = buildPainReading('pain.reports', { entries: [], reports: [{ createdAt: new Date('2026-10-10T10:00:00Z'), intensity: 6 }] }, math, now)!;
    expect(result.guide.howYouAre[0]).toContain('1 relato de dor');
    expect(result.guide.howYouAre[0]).toContain('6/10 em 10/10/2026');
  });
  it('variável desconhecida não tem leitura', () => {
    expect(buildPainReading('pain.nada', { entries: [], reports: [] }, math, now)).toBeNull();
  });
});

describe('indicadores que existiam na tela mas não tinham leitura (diziam "sem registros suficientes" por engano)', () => {
  it('agora todos têm leitura no catálogo', () => {
    const ids = new Set(READING_CATALOG.map((e) => e.variableId));
    for (const id of ['workout.postMentalFatigue', 'workout.emotionalExperienceDuring', 'workout.mentalStateChangePrePost', 'checkin.bodyResponseVsNormal', 'checkin.postWeekMotivation', 'workout.sleepDurationHoursEstimate', 'wearable.sleepLightMin', 'wearable.sleepScore', 'pain.perWorkout', 'pain.reports']) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
