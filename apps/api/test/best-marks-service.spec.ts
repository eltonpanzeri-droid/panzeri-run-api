import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BestMarksController, BestMarksCoachController, BestMarksService, reviewManualCompletion } from '../src/best-marks/best-marks.service';

// 09/11/2026 — Melhores marcas: montagem das fontes (atividade do relogio, manual, teste de 3 km, relato) com banco simulado.
function build() {
  const log = { id: 'l1', userId: 'u1', provider: 'zepp', sport: 'corrida', startedAt: new Date('2026-10-01T10:00:00Z'), distanceMeters: 10000, durationSec: 3900, physicalIdentityStatus: null, physicalEventId: null, physicalCanonicalActivityLogId: null };
  const esteira = { ...log, id: 'l2', sport: 'esteira', distanceMeters: 5000, durationSec: 1500 };
  const bike = { ...log, id: 'l3', sport: 'bike', distanceMeters: 5000, durationSec: 900 };
  const prisma: any = {
    activityLog: { findMany: jest.fn(async () => [log, esteira, bike]) },
    activityTimeSeriesPoint: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    workoutCompletion: { findMany: jest.fn(async () => [
      { id: 'c1', status: 'done', completedAt: new Date('2026-10-03T10:00:00Z'), distanceKm: 5, durationMin: 24, session: { scheduledDate: new Date('2026-10-03T00:00:00Z'), origin: 'student_extra', executionLinks: [] } },
      { id: 'c2', status: 'done', completedAt: new Date('2026-10-04T10:00:00Z'), distanceKm: 21.1, durationMin: 97, session: { scheduledDate: new Date('2026-10-04T00:00:00Z'), origin: null, executionLinks: [{ id: 'l' }] } }, // ligado a atividade do relogio: nao entra
    ]) },
    fitnessTest: { findMany: jest.fn(async () => [{ id: 't1', totalSeconds: 780, performedAt: null, createdAt: new Date('2026-09-01T10:00:00Z') }]) },
    onboardingInterview: { findUnique: jest.fn(async () => ({ answers: { longest_distance: 12, longest_distance_recent_count: 4, longest_distance_recent_time: '1:10:00' } })) },
  };
  return { service: new BestMarksService(prisma), prisma };
}

describe('BestMarksService', () => {
  it('esteira conta como corrida, bike nao; manual e teste entram; relato fica a parte', async () => {
    const { service } = build();
    const result = await service.forUser('u1');
    const by = Object.fromEntries(result.marks.map((m) => [m.distanceId, m]));
    expect(by['10km'].best).toMatchObject({ activityId: 'l1', seconds: 3900, source: 'device' });
    expect(by['5km'].ranking.map((r) => [r.activityId, r.source])).toEqual([['manual:c1', 'manual'], ['l2', 'device'], ['l1', 'device']]); // 24 min manual < 25 min esteira < 10 km em 65 min (corrida maior conta pelo tempo todo); bike (l3) fora
    expect(by['5km'].ranking[2]).toMatchObject({ extraMeters: 5000 });
    expect(by['3km'].best).toMatchObject({ source: 'test', seconds: 780 });
    expect(result.selfReported).toEqual([{ rank: 1, distanceKm: 12, distanceRaw: null, timesRun: 4, timeSeconds: 4200 }]);
    expect(JSON.stringify(result.marks)).not.toContain('selfReported');
  });
  it('lista TODOS os registros manuais de corrida com a decisao e o motivo (inclusive os que ficaram de fora)', async () => {
    const { service } = build();
    const result = await service.forUser('u1');
    expect(result.manualReview).toEqual([
      { localDate: '2026-10-04', distanceKm: 21.1, durationMin: 97, included: false, reason: expect.stringContaining('ligado a uma atividade do relógio') },
      { localDate: '2026-10-03', distanceKm: 5, durationMin: 24, included: true, reason: 'entra nas marcas como registro manual' },
    ]);
    const by = Object.fromEntries(result.marks.map((m) => [m.distanceId, m]));
    expect(by.half.best).toBeNull(); // o registro de 21,1 km ficou de fora (vinculado ao relogio)
  });
  it('consulta sempre so o proprio usuario e decide manual/copia do aparelho/vinculo ativo em codigo (com motivo)', async () => {
    const { service, prisma } = build();
    await service.forUser('u9');
    expect(prisma.activityLog.findMany.mock.calls[0][0].where.userId).toBe('u9');
    const where = prisma.workoutCompletion.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u9');
    expect(where.session.modality).toEqual({ in: ['corrida', 'esteira'] });
    expect(prisma.fitnessTest.findMany.mock.calls[0][0].where).toEqual({ userId: 'u9', testType: '3km' });
    expect(prisma.onboardingInterview.findUnique.mock.calls[0][0].where).toEqual({ userId: 'u9' });
  });
  it('as rotas usam o mesmo servico: aluna pelo JWT, treinador pelo id; so coach/admin na do painel (estatico)', async () => {
    const { service } = build();
    const spy = jest.spyOn(service, 'forUser');
    await new BestMarksController(service).mine({ sub: 'meu-id', email: 'a@b.c', role: 'student' });
    await new BestMarksCoachController(service).forStudent('aluna-7');
    expect(spy.mock.calls).toEqual([['meu-id'], ['aluna-7']]);
    const source = readFileSync(join(__dirname, '..', 'src', 'best-marks', 'best-marks.service.ts'), 'utf8');
    expect(source).toContain("@Roles('coach', 'admin')");
    expect(source).toMatch(/@UseGuards\(AuthGuard\('jwt'\)\)\s+@Get\(\)/);
  });
});

describe('decisao de um registro manual de corrida', () => {
  const base = { status: 'done', distanceKm: 21.1, durationMin: 97.5, sessionOrigin: 'student_extra', activeLinks: 0 };
  it('entra: registro manual normal (a meia de 21,1 km registrada a mao)', () => {
    expect(reviewManualCompletion(base)).toEqual({ included: true, reason: 'entra nas marcas como registro manual' });
    expect(reviewManualCompletion({ ...base, status: 'adjusted' }).included).toBe(true);
  });
  it('fica de fora, sempre com motivo claro', () => {
    expect(reviewManualCompletion({ ...base, status: 'missed' }).reason).toContain('não feito');
    expect(reviewManualCompletion({ ...base, sessionOrigin: 'device_extra' }).reason).toContain('cópia de uma atividade do relógio');
    expect(reviewManualCompletion({ ...base, activeLinks: 1 }).reason).toContain('ligado a uma atividade do relógio');
    expect(reviewManualCompletion({ ...base, distanceKm: null }).reason).toContain('sem distância');
    expect(reviewManualCompletion({ ...base, durationMin: 0 }).reason).toContain('sem tempo');
    expect(reviewManualCompletion({ ...base, distanceKm: 0.8 }).reason).toContain('menos de 1 km');
  });
});
