import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BestMarksController, BestMarksCoachController, BestMarksService } from '../src/best-marks/best-marks.service';

// 09/11/2026 — Melhores marcas: montagem das fontes (atividade do relogio, manual, teste de 3 km, relato) com banco simulado.
function build() {
  const log = { id: 'l1', userId: 'u1', provider: 'zepp', sport: 'corrida', startedAt: new Date('2026-10-01T10:00:00Z'), distanceMeters: 10000, durationSec: 3900, physicalIdentityStatus: null, physicalEventId: null, physicalCanonicalActivityLogId: null };
  const esteira = { ...log, id: 'l2', sport: 'esteira', distanceMeters: 5000, durationSec: 1500 };
  const bike = { ...log, id: 'l3', sport: 'bike', distanceMeters: 5000, durationSec: 900 };
  const prisma: any = {
    activityLog: { findMany: jest.fn(async () => [log, esteira, bike]) },
    activityTimeSeriesPoint: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    workoutCompletion: { findMany: jest.fn(async () => [{ id: 'c1', completedAt: new Date('2026-10-03T10:00:00Z'), distanceKm: 5, durationMin: 24, session: { scheduledDate: new Date('2026-10-03T00:00:00Z') } }]) },
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
  it('consulta sempre so o proprio usuario e exclui copia do aparelho e sessao com vinculo ativo no manual', async () => {
    const { service, prisma } = build();
    await service.forUser('u9');
    expect(prisma.activityLog.findMany.mock.calls[0][0].where.userId).toBe('u9');
    const where = prisma.workoutCompletion.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u9');
    expect(where.session.origin).toEqual({ not: 'device_extra' });
    expect(where.session.executionLinks).toEqual({ none: { status: 'active' } });
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
