import { PrismaClient } from '@prisma/client';
import { PhysicalActivityIdentityService } from '../../src/activity-execution/physical-activity-identity.service';
import { SessionExecutionLinkService } from '../../src/activity-execution/session-execution-link.service';
import { IdentityConfirmationService } from '../../src/activity-execution/identity-confirmation.service';
import { HealthConnectIngestionService } from '../../src/health-connect/health-connect-ingestion.service';
import { EvolutionMetricService } from '../../src/evolution/evolution-metric.service';
import { createTestPrisma } from './pg-guard';
import { cleanupStudents, seedStudent } from './synthetic';

// Health Connect ponta a ponta em PostgreSQL REAL e dados sinteticos: ingestao -> RawExternalActivity/ActivityLog -> identidade fisica ->
// classificacao -> volume. Nada de aparelho real aqui (isso e' validacao fisica, listada no contrato).

describe('Health Connect (PostgreSQL real)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const link = new SessionExecutionLinkService(prisma as never);
  const identity = new PhysicalActivityIdentityService(prisma as never);
  const confirmation = new IdentityConfirmationService(prisma as never, identity, link);
  const ingestion = new HealthConnectIngestionService(prisma as never, identity, link);
  const userIds: string[] = [];
  let seq = 0;

  afterAll(async () => { await cleanupStudents(prisma, userIds); await prisma.$disconnect(); });

  async function student(label: string) {
    const s = await seedStudent(prisma, label, { startDate: new Date(Date.now() - 3 * 86_400_000) });
    userIds.push(s.userId);
    await prisma.workoutCompletion.deleteMany({ where: { userId: s.userId } });
    return s;
  }
  const baseStart = () => { const d = new Date(Date.now() - 2 * 86_400_000); d.setUTCHours(10, 0, 0, 0); return d; };
  const hcItem = (over: Record<string, unknown> = {}) => {
    seq += 1;
    const start = baseStart();
    return {
      recordId: `hc-int-${seq}-${Math.random().toString(36).slice(2, 8)}`, dataOrigin: 'fi.polar.polarflow', lastModifiedTime: new Date().toISOString(), exerciseType: 56,
      startTime: start.toISOString(), endTime: new Date(start.getTime() + 58 * 60000).toISOString(), startZoneOffsetSeconds: -10800, distanceMeters: 10350,
      avgHeartRateBpm: 150, maxHeartRateBpm: 170, recordingMethod: 1, device: { manufacturer: 'Polar', model: 'Vantage', type: 1 }, ...over,
    };
  };
  async function polar(userId: string, startedAt: Date, minutes: number, km: number) {
    seq += 1;
    const externalId = `polar-int-${seq}`;
    const raw = await prisma.rawExternalActivity.create({ data: { userId, provider: 'polar', externalId, payload: { origem: 'sintetico' } } });
    const log = await prisma.activityLog.create({ data: { userId, provider: 'polar', externalId, rawActivityId: raw.id, startedAt, utcOffsetMinutes: -180, sport: 'corrida', durationSec: minutes * 60, distanceMeters: km * 1000, providerMetrics: { endedAt: new Date(startedAt.getTime() + minutes * 60000).toISOString() } } as never });
    const result = await identity.evaluateSafely(log.id);
    await link.classify(log.id);
    await link.reconcileAffectedByIdentity(result, log.id);
    return log;
  }
  const counting = (userId: string) => prisma.activityLog.count({ where: { userId, executionClassification: { in: ['corresponding', 'alternative'] } } });
  const logs = (userId: string, provider = 'health_connect') => prisma.activityLog.findMany({ where: { userId, provider }, orderBy: { createdAt: 'asc' } });
  const sessionsSnapshot = async (userId: string) => JSON.stringify(await prisma.trainingSession.findMany({ where: { userId }, orderBy: { id: 'asc' } }));
  const completions = async (userId: string) => JSON.stringify(await prisma.workoutCompletion.findMany({ where: { userId }, orderBy: { id: 'asc' } }));
  const km = async (userId: string) => (await new EvolutionMetricService(prisma as never).getSeries(userId)).weeks.reduce((sum, w) => sum + (w.kmPercorridos ?? 0), 0);

  it('grava RawExternalActivity + ActivityLog preservando canal, app de origem, dispositivo, metodo, fuso e payload bruto', async () => {
    const s = await student('grava');
    const item = hcItem();
    const result = await ingestion.importExercises(s.userId, { exercises: [item] });
    expect(result).toMatchObject({ created: 1, rejected: 0 });
    const [log] = await logs(s.userId);
    expect(log).toMatchObject({ provider: 'health_connect', externalId: item.recordId, sport: 'corrida', durationSec: 3480, distanceMeters: 10350, avgHeartRateBpm: 150, utcOffsetMinutes: -180 });
    const metrics = log.providerMetrics as Record<string, any>;
    expect(metrics).toMatchObject({ channel: 'health_connect', source: { packageName: 'fi.polar.polarflow' }, device: { manufacturer: 'Polar', model: 'Vantage' }, recordingMethod: 'actively_recorded', hcRecordId: item.recordId });
    const raw = await prisma.rawExternalActivity.findFirstOrThrow({ where: { userId: s.userId, provider: 'health_connect' } });
    expect(raw.payloadSchemaVersion).toBe('health-connect-exercise-v1');
    expect((raw.payload as any).dataOrigin).toBe('fi.polar.polarflow');
    expect(log.physicalIdentityStatus).toBe('unique');
  });

  it('sem distancia e sem FC: nulos no banco (nada inventado); forca/outra modalidade registradas', async () => {
    const s = await student('nulos');
    const noMetrics = hcItem({ distanceMeters: undefined, avgHeartRateBpm: undefined, maxHeartRateBpm: undefined });
    const strength = hcItem({ exerciseType: 70, distanceMeters: undefined, startTime: new Date(baseStart().getTime() - 5 * 3600_000).toISOString(), endTime: new Date(baseStart().getTime() - 4 * 3600_000).toISOString() });
    await ingestion.importExercises(s.userId, { exercises: [noMetrics, strength] });
    const rows = await logs(s.userId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.externalId === noMetrics.recordId)).toMatchObject({ distanceMeters: null, avgHeartRateBpm: null, maxHeartRateBpm: null });
    expect(rows.find((r) => r.externalId === strength.recordId)).toMatchObject({ sport: 'forca', distanceMeters: null });
  });

  it('10 sincronizacoes do mesmo registro = 1 atividade; modificado na origem atualiza o MESMO registro; versao antiga e ignorada', async () => {
    const s = await student('idempotente');
    const item = hcItem();
    for (let i = 0; i < 10; i += 1) await ingestion.importExercises(s.userId, { exercises: [item] });
    expect(await logs(s.userId)).toHaveLength(1);
    expect(await prisma.rawExternalActivity.count({ where: { userId: s.userId, provider: 'health_connect' } })).toBe(1);
    expect(await counting(s.userId)).toBe(1);
    const later = new Date(Date.now() + 60_000).toISOString();
    const edited = await ingestion.importExercises(s.userId, { exercises: [{ ...item, distanceMeters: 10500, lastModifiedTime: later }] });
    expect(edited).toMatchObject({ updated: 1 });
    const stale = await ingestion.importExercises(s.userId, { exercises: [{ ...item, distanceMeters: 1, lastModifiedTime: new Date(Date.now() - 3600_000).toISOString() }] });
    expect(stale).toMatchObject({ updated: 0, alreadyImported: 1 });
    const rows = await logs(s.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].distanceMeters).toBe(10500);
  });

  it('envios SIMULTANEOS do mesmo registro (duplo toque): um unico registro', async () => {
    const s = await student('concorrente');
    const item = hcItem();
    const results = await Promise.all(Array.from({ length: 6 }, () => ingestion.importExercises(s.userId, { exercises: [item] })));
    expect(results.reduce((sum, r) => sum + r.created, 0)).toBe(1);
    expect(await logs(s.userId)).toHaveLength(1);
  });

  it('Polar direto + MESMA atividade pelo Health Connect (Polar Flow): duas observacoes preservadas, evento fisico unico, UMA conta (D1 opcao B: ambigua ate confirmar)', async () => {
    const s = await student('polar-hc');
    const p = await polar(s.userId, baseStart(), 55, 10.0);
    await ingestion.importExercises(s.userId, { exercises: [hcItem({ startTime: new Date(baseStart().getTime() + 120_000).toISOString(), endTime: new Date(baseStart().getTime() + 120_000 + 58 * 60000).toISOString() })] });
    const [h] = await logs(s.userId);
    const [pAfter, hAfter] = [await prisma.activityLog.findUniqueOrThrow({ where: { id: p.id } }), h];
    expect(await prisma.activityLog.count({ where: { userId: s.userId } })).toBe(2); // ambas preservadas
    expect(await counting(s.userId)).toBe(1); // nunca 2 execucoes contadas
    expect([pAfter.physicalIdentityStatus, hAfter.physicalIdentityStatus]).toEqual(expect.arrayContaining(['ambiguous']));
    const pending = await confirmation.pendingForStudent(s.userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].observations.map((o) => o.sourceLabel)).toEqual(expect.arrayContaining(['Polar', 'Polar Flow']));
    const km1 = await km(s.userId);
    // confirmacao existente (sem UI nova): "mesma atividade" consolida e o volume segue contando uma vez
    await confirmation.resolveAsStudent(s.userId, { activityLogIds: [p.id, h.id], decision: 'same' });
    expect(await counting(s.userId)).toBe(1);
    const [pFinal, hFinal] = [await prisma.activityLog.findUniqueOrThrow({ where: { id: p.id } }), await prisma.activityLog.findUniqueOrThrow({ where: { id: h.id } })];
    expect(pFinal.physicalEventId).toBe(hFinal.physicalEventId);
    expect(await km(s.userId)).toBeLessThanOrEqual(Math.max(km1, 11));
  });

  it('duas atividades DISTINTAS (horarios diferentes) do Health Connect: ambas contam, sem pendencia', async () => {
    const s = await student('distintas');
    const morning = hcItem();
    const evening = hcItem({ startTime: new Date(baseStart().getTime() + 9 * 3600_000).toISOString(), endTime: new Date(baseStart().getTime() + 9 * 3600_000 + 40 * 60000).toISOString(), distanceMeters: 6000 });
    await ingestion.importExercises(s.userId, { exercises: [morning, evening] });
    expect(await logs(s.userId)).toHaveLength(2);
    expect((await confirmation.pendingForStudent(s.userId))).toHaveLength(0);
    expect((await logs(s.userId)).map((l) => l.physicalIdentityStatus)).toEqual(['unique', 'unique']);
    expect(await counting(s.userId)).toBe(2);
  });

  it('chegada fora de ordem (a mais nova primeiro, depois a antiga) e o mesmo resultado', async () => {
    const s = await student('ordem');
    const a = hcItem();
    const b = hcItem({ startTime: new Date(baseStart().getTime() + 9 * 3600_000).toISOString(), endTime: new Date(baseStart().getTime() + 9 * 3600_000 + 40 * 60000).toISOString() });
    await ingestion.importExercises(s.userId, { exercises: [b] });
    await ingestion.importExercises(s.userId, { exercises: [a] });
    expect(await logs(s.userId)).toHaveLength(2);
    expect((await logs(s.userId)).map((l) => l.physicalIdentityStatus)).toEqual(['unique', 'unique']);
    expect(await counting(s.userId)).toBe(2);
  });

  it('mudanca de app de origem do mesmo registro (Polar Flow -> outro): atualiza, reavalia identidade e nao duplica', async () => {
    const s = await student('origem');
    const item = hcItem();
    await ingestion.importExercises(s.userId, { exercises: [item] });
    const changed = await ingestion.importExercises(s.userId, { exercises: [{ ...item, dataOrigin: 'com.sec.android.app.shealth' }] });
    expect(changed).toMatchObject({ updated: 1 });
    const rows = await logs(s.userId);
    expect(rows).toHaveLength(1);
    expect((rows[0].providerMetrics as any).source.packageName).toBe('com.sec.android.app.shealth');
  });

  it('sessoes prescritas e feedback do aluno ficam INTACTOS; vinculos manuais preservados na reimportacao', async () => {
    const s = await student('intactos');
    await prisma.workoutCompletion.create({ data: { userId: s.userId, sessionId: s.sessionIds[0], status: 'done', durationMin: 41, distanceKm: 5.1, avgPaceSecondsKm: 482, perceivedEffort: 6, painFlag: 'none' } });
    const sessions0 = await sessionsSnapshot(s.userId);
    const completions0 = await completions(s.userId);
    const item = hcItem();
    await ingestion.importExercises(s.userId, { exercises: [item] });
    const [log] = await logs(s.userId);
    // vinculo manual do aluno a uma sessao: a reimportacao/edicao nao pode desfaze-lo
    await link.linkManually({ trainingSessionId: s.sessionIds[1], activityLogId: log.id, origin: 'student' });
    const activeLinks = () => prisma.sessionExecutionLink.findMany({ where: { activityLogId: log.id, status: 'active' } });
    expect((await activeLinks()).map((l) => [l.trainingSessionId, l.origin])).toEqual([[s.sessionIds[1], 'student']]);
    await ingestion.importExercises(s.userId, { exercises: [item, { ...item, distanceMeters: 10400, lastModifiedTime: new Date(Date.now() + 60_000).toISOString() }] });
    expect((await activeLinks()).map((l) => [l.trainingSessionId, l.origin])).toEqual([[s.sessionIds[1], 'student']]);
    expect(await sessionsSnapshot(s.userId)).toBe(sessions0);
    expect(await completions(s.userId)).toBe(completions0);
  });

  it('isolamento entre alunos: o mesmo id de registro em dois alunos gera dois registros independentes', async () => {
    const a = await student('iso-a');
    const b = await student('iso-b');
    const item = hcItem();
    await ingestion.importExercises(a.userId, { exercises: [item] });
    await ingestion.importExercises(b.userId, { exercises: [item] });
    expect(await logs(a.userId)).toHaveLength(1);
    expect(await logs(b.userId)).toHaveLength(1);
  });
});
