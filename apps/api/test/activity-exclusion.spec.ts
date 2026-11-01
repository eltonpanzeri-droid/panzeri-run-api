import { applyActivityExclusionFilter, includeExcludedActivities, installActivityExclusionFilter, isActivityExcluded, isIncludingExcludedActivities } from '../src/prisma/activity-exclusion-scope';
import { EXCLUSION_MODES, EXCLUSION_REASONS, exclusionProfileNote, isExclusionMode, isExclusionReason, tombstoneMetricsPatch } from '../src/activity-execution/activity-exclusion';
import { ZeppActivityIngestionService } from '../src/zepp/zepp-activity-ingestion.service';
import { CorosActivityIngestionService } from '../src/coros/coros-activity-ingestion.service';

// 01/11/2026 — excluir/ignorar atividade do relogio (aluna e treinador). O fluxo completo (vinculos, sessao sintetica, feedback guardado, marca minima, desfazer, ingestao) foi
// provado num Postgres real em memoria (35 verificacoes); aqui ficam as regras que nao dependem de banco.

describe('filtro central de atividades excluidas', () => {
  const where = { userId: 'u1' };

  it('esconde as excluidas das leituras de ActivityLog (find*, count, aggregate, groupBy)', () => {
    for (const action of ['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']) {
      const out = applyActivityExclusionFilter({ model: 'ActivityLog', action, args: { where } });
      expect(out.args?.where).toEqual({ userId: 'u1', exclusionMode: null });
    }
  });

  it('mantem a chave unica no topo (findUnique exige) e funciona sem where', () => {
    expect(applyActivityExclusionFilter({ model: 'ActivityLog', action: 'findUnique', args: { where: { id: 'a1' } } }).args?.where).toEqual({ id: 'a1', exclusionMode: null });
    expect(applyActivityExclusionFilter({ model: 'ActivityLog', action: 'findMany', args: {} }).args?.where).toEqual({ exclusionMode: null });
    expect(applyActivityExclusionFilter({ model: 'ActivityLog', action: 'count' }).args?.where).toEqual({ exclusionMode: null });
  });

  it('nao mexe em outros modelos nem em escritas', () => {
    const other = { model: 'TrainingSession', action: 'findMany', args: { where } };
    expect(applyActivityExclusionFilter(other)).toBe(other);
    for (const action of ['create', 'update', 'upsert', 'updateMany', 'delete', 'deleteMany']) {
      const write = { model: 'ActivityLog', action, args: { where } };
      expect(applyActivityExclusionFilter(write)).toBe(write);
    }
  });

  it('dentro de includeExcludedActivities as excluidas ficam visiveis', async () => {
    expect(isIncludingExcludedActivities()).toBe(false);
    await includeExcludedActivities(async () => {
      expect(isIncludingExcludedActivities()).toBe(true);
      const params = { model: 'ActivityLog', action: 'findMany', args: { where } };
      expect(applyActivityExclusionFilter(params)).toBe(params);
    });
    expect(isIncludingExcludedActivities()).toBe(false);
  });

  // Defeito real achado no teste ponta a ponta: a consulta do Prisma so' roda quando e' AGUARDADA. O contexto precisa estar ativo nesse momento.
  it('a consulta preguicosa (PrismaPromise) roda DENTRO do contexto', async () => {
    let flagWhenExecuted: boolean | null = null;
    const lazy = { then: (resolve: (v: string) => void) => { flagWhenExecuted = isIncludingExcludedActivities(); resolve('ok'); } } as unknown as PromiseLike<string>;
    await expect(includeExcludedActivities(() => lazy)).resolves.toBe('ok');
    expect(flagWhenExecuted).toBe(true);
  });

  it('o filtro e instalado como middleware e repassa os params ajustados', async () => {
    let installed: ((params: never, next: (p: never) => Promise<unknown>) => Promise<unknown>) | undefined;
    installActivityExclusionFilter({ $use: (middleware) => { installed = middleware; } });
    const next = jest.fn().mockResolvedValue([]);
    await installed!({ model: 'ActivityLog', action: 'findMany', args: { where } } as never, next);
    expect(next).toHaveBeenCalledWith({ model: 'ActivityLog', action: 'findMany', args: { where: { userId: 'u1', exclusionMode: null } } });
  });

  it('cliente sem $use (teste/CLI) nao quebra', () => {
    expect(() => installActivityExclusionFilter({})).not.toThrow();
  });
});

describe('guarda das ingestoes', () => {
  const clientWith = (exclusionMode: string | null | undefined) => ({ activityLog: { findFirst: jest.fn().mockResolvedValue(exclusionMode === undefined ? null : { exclusionMode }) } });

  it('so bloqueia quando a atividade esta ignorada ou excluida', async () => {
    expect(await isActivityExcluded(clientWith('ignored'), 'u1', 'zepp', 'e1')).toBe(true);
    expect(await isActivityExcluded(clientWith('deleted'), 'u1', 'zepp', 'e1')).toBe(true);
    expect(await isActivityExcluded(clientWith(null), 'u1', 'zepp', 'e1')).toBe(false);
    expect(await isActivityExcluded(clientWith(undefined), 'u1', 'zepp', 'e1')).toBe(false);
  });

  it('a consulta olha provedor + id externo da aluna e enxerga as excluidas', async () => {
    const client = clientWith('deleted');
    client.activityLog.findFirst.mockImplementation(async () => (isIncludingExcludedActivities() ? { exclusionMode: 'deleted' } : null));
    expect(await isActivityExcluded(client, 'u1', 'polar', 'x9')).toBe(true);
    expect(client.activityLog.findFirst).toHaveBeenCalledWith({ where: { userId: 'u1', provider: 'polar', externalId: 'x9' }, select: { exclusionMode: true } });
  });

  it('Zepp e COROS nao regravam nada de uma atividade excluida (o relogio nao traz de volta)', async () => {
    const prisma = clientWith('deleted');
    const consent = { writeWhileAuthorized: jest.fn() };
    const zepp = new ZeppActivityIngestionService(prisma as never, consent as never, {} as never, {} as never);
    const coros = new CorosActivityIngestionService(prisma as never, consent as never, {} as never, {} as never);
    await expect(zepp.ingest('u1', { summaryId: 's1' } as never, {} as never)).resolves.toEqual({ written: false, reason: 'excluded' });
    await expect(coros.ingest('u1', { labelId: 'l1' } as never, {} as never)).resolves.toEqual({ written: false, reason: 'excluded' });
    expect(consent.writeWhileAuthorized).not.toHaveBeenCalled();
  });
});

describe('regras da exclusao', () => {
  it('modos e motivos validos', () => {
    expect([...EXCLUSION_MODES]).toEqual(['ignored', 'deleted']);
    expect(EXCLUSION_REASONS.length).toBe(4);
    expect(isExclusionMode('ignored')).toBe(true);
    expect(isExclusionMode('apagar')).toBe(false);
    expect(isExclusionMode(undefined)).toBe(false);
    expect(isExclusionReason('same_workout_registered')).toBe(true);
    expect(isExclusionReason('qualquer coisa')).toBe(false);
  });

  it('a marca minima zera tudo que mede o treino (defesa extra se um leitor esquecesse o filtro)', () => {
    const patch = tombstoneMetricsPatch();
    expect(patch).toMatchObject({ durationSec: null, distanceMeters: null, caloriesKcal: null, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: false });
    expect(Object.keys(patch)).not.toEqual(expect.arrayContaining(['provider', 'externalId', 'startedAt', 'sport']));
  });

  it('o aviso ao Prontuario diz QUE foi retirada, sem repetir os numeros, e nao confunde ausencia com falta de treino', () => {
    const base = { sport: 'corrida', startedAt: new Date('2026-11-01T09:27:21.000Z'), utcOffsetMinutes: -180, reason: 'same_workout_registered' as const, count: 1 };
    const ignored = exclusionProfileNote({ ...base, mode: 'ignored', actorRole: 'student' });
    expect(ignored.header).toContain('pela própria aluna');
    expect(ignored.body).toContain('Uma corrida do dia 01/11/2026 foi ignorada');
    expect(ignored.body).toContain('é o mesmo treino que já está registrado');
    expect(ignored.body).toContain('não indica falta de treino');
    expect(ignored.body).not.toMatch(/\d+(,\d+)? ?km|bpm|min\b/);
    const deleted = exclusionProfileNote({ ...base, mode: 'deleted', actorRole: 'coach', count: 2 });
    expect(deleted.header).toContain('pelo treinador');
    expect(deleted.body).toContain('2 registros da mesma corrida');
    expect(deleted.body).toContain('excluída');
    expect(exclusionProfileNote({ ...base, mode: 'ignored', actorRole: 'student', sport: null }).body).toContain('Uma atividade do dia');
  });
});
