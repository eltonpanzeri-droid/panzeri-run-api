import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PhysiologyService } from '../src/physiology/physiology.service';
import { MODEL_VERSION } from '../src/physiology/physiology-models';

// Testes físicos, Lote 2 (30/10/2026): gravação, camadas, referência, isolamento entre alunos e recálculo do legado. Banco em memória.
let seq = 0;
const id = () => `id${++seq}`;

function fakeDb(users: Record<string, { birthDate: Date | null; sex: string | null }>) {
  const t = { fitness: [] as any[], assess: [] as any[], ind: [] as any[], ref: [] as any[] };
  const match = (row: any, where: any = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as any[]).some((w) => match(row, w));
    if (v && typeof v === 'object' && 'not' in (v as any)) return row[k] !== (v as any).not;
    return row[k] === v;
  });
  const db: any = {
    user: { findUnique: async ({ where }: any) => users[where.id] ?? null },
    fitnessTest: {
      findFirst: async ({ where }: any) => t.fitness.find((r) => match(r, where)) ?? null,
      findMany: async ({ where }: any) => t.fitness.filter((r) => match(r, where)),
      create: async ({ data }: any) => { const row = { id: id(), createdAt: new Date('2026-10-30T12:00:00Z'), ...data }; t.fitness.push(row); return row; },
      update: async ({ where, data }: any) => { const row = t.fitness.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    },
    physiologicalAssessment: {
      findMany: async ({ where, include }: any) => t.assess.filter((r) => match(r, where)).map((r) => ({ ...r, indicators: t.ind.filter((i) => i.assessmentId === r.id && match(i, include?.indicators?.where)) })),
      findUnique: async ({ where }: any) => t.assess.find((r) => r.fitnessTestId === where.fitnessTestId) ?? null,
      create: async ({ data }: any) => { const row = { id: id(), domain: 'aerobic', createdAt: new Date('2026-10-30T12:00:00Z'), ...data }; t.assess.push(row); return row; },
      update: async ({ where, data }: any) => { const row = t.assess.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    },
    physiologicalIndicator: {
      deleteMany: async ({ where }: any) => { t.ind = t.ind.filter((i) => i.assessmentId !== where.assessmentId); },
      createMany: async ({ data }: any) => { t.ind.push(...data.map((d: any) => ({ id: id(), ...d }))); },
    },
    operationalReference: {
      findFirst: async ({ where }: any) => [...t.ref].filter((r) => match(r, where)).sort((a, b) => b.version - a.version)[0] ?? null,
      create: async ({ data }: any) => { const row = { id: id(), createdAt: new Date(), ...data }; t.ref.push(row); return row; },
    },
    operationalReferenceFindAll: () => t.ref,
    $transaction: async (fn: any) => fn(db),
  };
  return { db, t };
}

const A = 'alunoA', B = 'alunoB', COACH = { id: 'treinador', role: 'coach' };
const users = { [A]: { birthDate: new Date('1985-05-10'), sex: 'masculino' }, [B]: { birthDate: new Date('1990-01-01'), sex: 'feminino' } };
const ind = (t: any, userId: string, key: string) => t.ind.find((i: any) => i.userId === userId && i.key === key);

describe('serviço de testes físicos', () => {
  it('primeiro teste de 3 km COM FC: resultado original preservado, indicadores estimados, FC informada e referência operacional criada', async () => {
    const { db, t } = fakeDb(users);
    const svc = new PhysiologyService(db);
    const test = await svc.saveThreeKm(A, { totalSeconds: 720, maxHeartRate: 186, environment: 'rua', performedAt: '2026-10-20' });
    expect(test.vo2maxEstimated).toBe(47.9);
    const fitness = t.fitness[0];
    expect(fitness).toMatchObject({ totalSeconds: 720, maxHeartRate: 186, modelVersion: MODEL_VERSION });
    expect(t.assess[0]).toMatchObject({ method: 'three_km', source: 'student', fitnessTestId: fitness.id });
    expect(t.assess[0].rawResults).toMatchObject({ totalSeconds: 720, maxHeartRate: 186, environment: 'rua' });
    expect(ind(t, A, 'hrmax_bpm')).toMatchObject({ value: 186, origin: 'reported' });
    expect(ind(t, A, 'l2_hr_bpm')).toBeDefined();
    expect(t.ref).toHaveLength(1);
    expect(t.ref[0]).toMatchObject({ source: 'tests', version: 1, userId: A });
    expect(t.ref[0].payload.zones).toHaveLength(5);
    expect(t.ref[0].payload.reference.label).toBe('Avaliação de referência atual: Teste de 3 km | 20/10/2026');
  });

  it('teste de 3 km SEM FC: FCmáx pela idade na data do teste (Tanaka, 41 anos), confiança baixa; sem data de nascimento não inventa FC', async () => {
    const { db, t } = fakeDb(users);
    await new PhysiologyService(db).saveThreeKm(A, { totalSeconds: 780, environment: 'rua', performedAt: '2026-10-20' });
    expect(ind(t, A, 'hrmax_bpm')?.value).toBe(Math.round(208 - 0.7 * 41));
    const x = fakeDb({ C: { birthDate: null, sex: null } });
    await new PhysiologyService(x.db).saveThreeKm('C', { totalSeconds: 780, environment: 'rua', performedAt: '2026-10-20' });
    expect(ind(x.t, 'C', 'hrmax_bpm')).toBeUndefined();
    expect(ind(x.t, 'C', 'l2_speed_kmh')).toBeDefined();
  });

  it('datas inválidas são recusadas: futura, inexistente e formato errado', async () => {
    const { db } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await expect(svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2999-01-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-02-31' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.recordExternal(A, { method: 'ergospirometry', performedAt: '20/10/2026', results: { vo2max: 50 } }, { id: A, role: 'student' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ergoespirometria registrada pelo treinador: origem "medida", confiança alta, sem estimar VO₂; L1 e L2 estimados a partir da vVO₂ medida', async () => {
    const { db, t } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { vo2max: 56.2, vvo2max_kmh: 17.5, hrmax_bpm: 188 } }, COACH);
    expect(ind(t, A, 'vo2max')).toMatchObject({ value: 56.2, origin: 'measured', confidence: 'alta' });
    expect(ind(t, A, 'vvo2max_kmh')).toMatchObject({ value: 17.5, origin: 'measured' });
    expect(ind(t, A, 'l2_speed_kmh')).toMatchObject({ origin: 'estimated' });
    expect(t.assess[0]).toMatchObject({ source: 'coach', method: 'ergospirometry', enteredByUserId: 'treinador' });
  });

  it('o mesmo resultado informado pelo próprio aluno vira "informado pelo aluno", nunca "medido"', async () => {
    const { db, t } = fakeDb(users);
    await new PhysiologyService(db).recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { vo2max: 56.2 } }, { id: A, role: 'student' });
    expect(ind(t, A, 'vo2max')).toMatchObject({ origin: 'reported', confidence: 'moderada' });
    expect(t.assess[0].source).toBe('student');
  });

  it('outro método com nome livre e avaliação com indicadores incompletos: só o informado é gravado, nada é inventado', async () => {
    const { db, t } = fakeDb(users);
    await new PhysiologyService(db).recordExternal(A, { method: 'other', methodLabel: 'Teste da academia X', performedAt: '2026-09-01', results: { hrmax_bpm: 190 } }, { id: A, role: 'student' });
    expect(t.assess[0]).toMatchObject({ method: 'other', methodLabel: 'Teste da academia X' });
    expect(t.ind.map((i: any) => i.key)).toEqual(['hrmax_bpm']);
  });

  it('prova externa (5 km, Cooper) com resultado bruto: calcula as estimativas que faltam; valores informados nunca são sobrescritos', async () => {
    const { db, t } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.recordExternal(A, { method: 'five_km', performedAt: '2026-10-01', results: { totalSeconds: 1500, vo2max: 50 } }, { id: A, role: 'student' });
    expect(ind(t, A, 'vo2max')).toMatchObject({ value: 50, origin: 'reported' });
    expect(ind(t, A, 'vvo2max_kmh')).toMatchObject({ origin: 'estimated' });
    await svc.recordExternal(A, { method: 'cooper_12min', performedAt: '2026-10-05', results: { distanceMeters: 3000 } }, { id: A, role: 'student' });
    expect(t.ind.filter((i: any) => i.assessmentId === t.assess[1].id && i.key === 'vo2max')[0].value).toBeCloseTo(47.9, 1);
  });

  it('valores inválidos ou impossíveis são recusados com mensagens em português; nada é gravado', async () => {
    const { db, t } = fakeDb(users);
    const svc = new PhysiologyService(db);
    const student = { id: A, role: 'student' };
    await expect(svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { vo2max: 400 } }, student)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { l1_speed_kmh: 14, l2_speed_kmh: 12 } }, student)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: {} }, student)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.recordExternal(A, { method: 'inventado', performedAt: '2026-10-10', results: { vo2max: 50 } }, student)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.assess).toHaveLength(0);
  });

  it('pace e velocidade são a mesma informação: pace informado vira km/h canônico; pace e velocidade que não conferem são recusados', async () => {
    const { db, t } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { vvo2max_pace_seconds: 240, l2_pace_seconds: 270 } }, COACH);
    expect(ind(t, A, 'vvo2max_kmh')?.value).toBe(15);
    expect(ind(t, A, 'l2_speed_kmh')?.value).toBeCloseTo(13.33, 2);
    await expect(svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-11', results: { vvo2max_kmh: 15, vvo2max_pace_seconds: 300 } }, COACH)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dois testes no mesmo dia: a ergoespirometria é a referência; a referência operacional só muda quando algo muda (idempotente)', async () => {
    const { db, t } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-10-10' });
    await svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { vo2max: 55, vvo2max_kmh: 17 } }, COACH);
    const profile = await svc.profile(A);
    expect(profile.reference?.method).toBe('ergospirometry');
    expect(profile.reference?.label).toContain('Ergoespirometria | 10/10/2026');
    expect(t.ref).toHaveLength(2);
    await db.$transaction((tx: any) => svc.refreshReference(tx, A));
    expect(t.ref).toHaveLength(2); // nada mudou: nenhuma versão nova
  });

  it('ergoespirometria antiga (mais de 60 dias) e 3 km recente: o 3 km vira a referência, a ergoespirometria continua no histórico', async () => {
    const { db } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-03-01', results: { vo2max: 55, vvo2max_kmh: 17 } }, COACH);
    await svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-10-10' });
    const profile = await svc.profile(A);
    expect(profile.reference?.method).toBe('three_km');
    expect(profile.assessments.map((a: any) => a.method).sort()).toEqual(['ergospirometry', 'three_km']);
    expect(profile.nextReassessmentDueAt).toBe('2027-02-10');
  });

  it('complementação: indicador que a referência não tem vem de outra avaliação, com método e data de procedência', async () => {
    const { db } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-09-20', maxHeartRate: 185 });
    await svc.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-01', results: { vo2max: 58 } }, COACH);
    const profile = await svc.profile(A);
    const vvo2 = profile.indicators.find((i: any) => i.key === 'vvo2max_kmh');
    expect(vvo2?.from).toMatchObject({ method: 'three_km', performedAt: '2026-09-20', fromReference: false });
    expect(profile.indicators.find((i: any) => i.key === 'vo2max')?.from).toMatchObject({ method: 'ergospirometry', fromReference: true });
  });

  it('isolamento entre alunos: o perfil, o histórico e as referências de um aluno nunca trazem dados do outro', async () => {
    const { db, t } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-10-10' });
    await svc.saveThreeKm(B, { totalSeconds: 900, environment: 'rua', performedAt: '2026-10-11' });
    expect((await svc.profile(A)).assessments).toHaveLength(1);
    expect((await svc.profile(B)).assessments).toHaveLength(1);
    expect((await svc.history(A, {})).every((h: any) => h.assessmentId === t.assess.find((x: any) => x.userId === A).id)).toBe(true);
    expect(t.ref.filter((r: any) => r.userId === B)).toHaveLength(1);
    expect(t.ref.find((r: any) => r.userId === B).payload.reference.assessmentId).not.toBe(t.ref.find((r: any) => r.userId === A).payload.reference.assessmentId);
  });

  it('editar um teste que não é do aluno falha', async () => {
    const { db } = fakeDb(users);
    const svc = new PhysiologyService(db);
    const test = await svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua' });
    await expect(svc.saveThreeKm(B, { totalSeconds: 700, environment: 'rua' }, test.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('histórico por método, só com pontos reais (indicador ausente não vira ponto)', async () => {
    const { db } = fakeDb(users);
    const svc = new PhysiologyService(db);
    await svc.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-08-01' });
    await svc.recordExternal(A, { method: 'other', performedAt: '2026-09-01', results: { hrmax_bpm: 190 } }, { id: A, role: 'student' });
    const onlyThreeKm = await svc.history(A, { method: 'three_km', indicator: 'vo2max' });
    expect(onlyThreeKm).toHaveLength(1);
    const all = await svc.history(A, { indicator: 'vo2max' });
    expect(all.find((h: any) => h.method === 'other')?.indicators).toEqual([]);
  });

  it('recálculo do legado: preserva tempo, FC e data originais, troca só o derivado e é idempotente; dry-run não grava', async () => {
    const { db, t } = fakeDb(users);
    t.fitness.push({ id: 'legado1', userId: A, testType: '3km', totalSeconds: 720, avgHeartRate: 170, maxHeartRate: 184, environment: 'rua', vo2maxEstimated: 43.8, vvo2Kmh: 15, paceSecondsPerKm: 240, notes: 'antigo', createdAt: new Date('2026-07-10T15:00:00Z'), performedAt: null, modelVersion: null });
    const svc = new PhysiologyService(db);
    const dry = await svc.recomputeLegacy({ dryRun: true });
    expect(dry).toMatchObject({ candidates: 1, updated: 0 });
    expect(dry.sample[0]).toMatchObject({ vo2Before: 43.8, vo2After: 47.9 });
    expect(t.fitness[0].vo2maxEstimated).toBe(43.8);
    const done = await svc.recomputeLegacy({ dryRun: false });
    expect(done).toMatchObject({ candidates: 1, updated: 1 });
    expect(t.fitness[0]).toMatchObject({ totalSeconds: 720, avgHeartRate: 170, maxHeartRate: 184, notes: 'antigo', vo2maxEstimated: 47.9, modelVersion: MODEL_VERSION });
    expect(t.fitness[0].createdAt).toEqual(new Date('2026-07-10T15:00:00Z'));
    expect(t.fitness[0].performedAt).toEqual(new Date('2026-07-10T00:00:00.000Z'));
    expect(t.assess).toHaveLength(1);
    expect(t.assess[0].createdAt).toEqual(new Date('2026-07-10T15:00:00Z'));
    const again = await svc.recomputeLegacy({ dryRun: false });
    expect(again).toMatchObject({ candidates: 0, updated: 0 });
    expect(t.assess).toHaveLength(1);
    expect(t.ref).toHaveLength(1);
  });
});
