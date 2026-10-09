import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { BACKUP_EXCLUDED_TABLE_DATA, BackupService } from '../../src/backup/backup.service';
import { pgEnvFromUrl } from '../../src/backup/backup-sanitize';
import { restoreBackupFile } from '../../src/backup/backup-restore';
import { AccountDeletionService } from '../../src/account-deletion/account-deletion.service';
import { ProviderDataDeletionService } from '../../src/activity-execution/provider-data-deletion.service';
import { createTestPrisma, testDatabaseUrl, withPgOnPath } from './pg-guard';
import { cleanupStudents, seedStudent, SyntheticStudent } from './synthetic';

// Prova de BACKUP + RESTAURACAO em ambiente isolado (Etapa 1.2a, 09/10/2026): pg_dump real (com as mesmas exclusoes de producao),
// pg_restore real + etapa pos-restauracao fail-closed + reaplicacao de tombstones, tudo em PostgreSQL 17 local, dados sinteticos.

class TestableBackup extends BackupService {
  dump(env: Record<string, string>, path: string) { return this.runPgDump(env, path); }
}

describe('backup -> restauracao em ambiente isolado (PostgreSQL 17 local, dados sinteticos)', () => {
  const sourceUrl = testDatabaseUrl();
  const restoreUrl = sourceUrl.replace(/\/[^/]+$/, '/panzeri_restore_test');
  const source = createTestPrisma(sourceUrl);
  let restore: PrismaClient;
  let workDir: string;
  let alice: SyntheticStudent;
  let bruno: SyntheticStudent;

  beforeAll(async () => {
    withPgOnPath();
    restore = new PrismaClient({ datasources: { db: { url: restoreUrl } } });
    workDir = mkdtempSync(join(tmpdir(), 'panzeri-backup-it-'));
    alice = await seedStudent(source, 'alice');
    bruno = await seedStudent(source, 'bruno');
    alicePackageId = await seedTrace(alice);
    brunoPackageId = await seedTrace(bruno);
    // Integracoes de ALICE: Polar ativa (token cifrado sintetico), Strava e Wahoo conectadas.
    await source.polarConnection.create({ data: { userId: alice.userId, polarUserId: `p-${alice.userId.slice(0, 8)}`, accessTokenEncrypted: 'v1:sintetico', registeredAt: new Date() } });
    await source.stravaConnection.create({ data: { userId: alice.userId, athleteId: 'ath-1', accessToken: 'tok', refreshToken: 'ref', expiresAt: new Date(Date.now() + 3_600_000) } });
    await source.wahooConnection.create({ data: { userId: alice.userId, wahooUserId: `w-${alice.userId.slice(0, 8)}`, accessTokenEncrypted: 'v1:sintetico', refreshTokenEncrypted: 'v1:sintetico', accessTokenExpiresAt: new Date(Date.now() + 3_600_000), grantedScopes: 'user_read workouts_read offline_data' } });
  });

  // Rastreabilidade (Etapa 1.2a): pacote + decisao de cada aluno, com a entrada completa enviada a IA.
  async function seedTrace(student: SyntheticStudent) {
    const pkg = await source.prescriptionEvidencePackage.create({
      data: { userId: student.userId, planId: student.planId, kind: 'weekly', schemaVersion: 1, methodologyVersion: 'teste', modelIds: ['claude-sonnet-5'], agentInputHash: 'h'.repeat(64), evidence: [{ ref: 'report:x', delivery: 'delivered', storage: 'complete' }], contextGaps: [], agentInput: { calls: [{ purpose: 'semana', userPrompt: '{"k":"v"}' }] },
        sourceProviders: ['polar'], agentInputRedactions: [{ provider: 'wahoo', reason: 'provider_data_deleted', removedVariableIds: ['activity.cadenceAvg'] }] },
    });
    await source.prescriptionDecision.create({ data: { packageId: pkg.id, userId: student.userId, planId: student.planId, sessionId: student.sessionIds[0], kind: 'session', summary: 'ter | corrida', traceStatus: 'absent', sessionSnapshot: { weekday: 2, structure: { type: 'run' } }, sessionSnapshotSha256: 's'.repeat(64) } });
    return pkg.id;
  }
  let alicePackageId: string;
  let brunoPackageId: string;

  afterAll(async () => {
    await cleanupStudents(source, [alice.userId, bruno.userId]);
    await source.$disconnect();
    await restore.$disconnect();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('gera o backup (pg_dump real), restaura em OUTRO banco local e aplica fail-closed + tombstones posteriores ao snapshot', async () => {
    const dumpPath = join(workDir, 'backup.dump');
    const snapshotStartedAt = new Date();
    await new TestableBackup({ get: () => undefined } as never, {} as never).dump(pgEnvFromUrl(sourceUrl), dumpPath);
    expect(statSync(dumpPath).size).toBeGreaterThan(10_000);

    // Depois do snapshot: Bruno pede exclusao de conta (tombstone) — a restauracao precisa reaplicar.
    const tombstoneAt = new Date(snapshotStartedAt.getTime() + 60_000).toISOString();
    const accounts = new AccountDeletionService(restore as never);
    const providerData = new ProviderDataDeletionService(restore as never);

    const outcome = await restoreBackupFile({
      dumpPath,
      targetDatabaseUrl: restoreUrl,
      prisma: restore as never,
      snapshotStartedAt,
      loadTombstones: async () => [{ v: 1, type: 'account_deleted', userId: bruno.userId, at: tombstoneAt }],
      deleteProviderData: (userId, provider) => providerData.executeProviderDataDeletion(userId, provider),
      deleteAccount: (userId) => accounts.executeAccountDeletion(userId),
    });

    // Resultado geral
    expect(outcome.complete).toBe(true);
    expect(outcome.tombstones).toMatchObject({ status: 'applied', applied: 1 });

    // 1. Estrutura: as mesmas migrations (tabela _prisma_migrations viaja no dump)
    const [src] = await source.$queryRaw<Array<{ n: bigint }>>`select count(*) as n from _prisma_migrations`;
    const [dst] = await restore.$queryRaw<Array<{ n: bigint }>>`select count(*) as n from _prisma_migrations`;
    expect(Number(dst.n)).toBe(Number(src.n));

    // 2. Dados da ALICE restaurados integralmente (plano, sessoes, feedback, relato interpretado)
    const alicePlan = await restore.trainingPlan.findUnique({ where: { id: alice.planId }, include: { sessions: { include: { completion: true } } } });
    expect(alicePlan?.name).toBe('Programa alice');
    expect(alicePlan?.sessions).toHaveLength(2);
    expect(alicePlan?.sessions.find((s) => s.id === alice.sessionIds[0])?.completion).toMatchObject({ status: 'done', distanceKm: 5.1, perceivedEffort: 6 });
    const report = await restore.studentReportEntry.findUnique({ where: { id: alice.reportEntryIds[0] } });
    expect(report).toMatchObject({ temporality: 'PERSISTENTE_ATE_CONTRARIO', facts: 'A esteira do aluno vai so ate 12 km/h' });
    expect(report?.originalText).toContain('esteira vai so ate 12 km/h');

    // 2b. RASTREABILIDADE entra no backup (nao esta na lista de exclusoes) e volta integra, inclusive a entrada completa da IA
    expect(BACKUP_EXCLUDED_TABLE_DATA.filter((table) => /Prescription/.test(table))).toEqual([]);
    const restoredPackage = await restore.prescriptionEvidencePackage.findUnique({ where: { id: alicePackageId }, include: { decisions: true } });
    expect(restoredPackage).toMatchObject({ userId: alice.userId, kind: 'weekly', agentInputHash: 'h'.repeat(64) });
    expect(restoredPackage?.agentInput).toEqual({ calls: [{ purpose: 'semana', userPrompt: '{"k":"v"}' }] });
    expect(restoredPackage?.decisions).toHaveLength(1);
    // correcoes pos-revisao: proveniencia, marcadores de redacao e VERSAO da sessao tambem viajam no backup
    expect(restoredPackage?.sourceProviders).toEqual(['polar']);
    expect(restoredPackage?.agentInputRedactions).toEqual([{ provider: 'wahoo', reason: 'provider_data_deleted', removedVariableIds: ['activity.cadenceAvg'] }]);
    expect(restoredPackage?.decisions[0]).toMatchObject({ sessionSnapshot: { weekday: 2, structure: { type: 'run' } }, sessionSnapshotSha256: 's'.repeat(64) });
    // ...e a trilha de BRUNO some junto com a conta (tombstone posterior ao snapshot reaplicado)
    expect(await restore.prescriptionEvidencePackage.count({ where: { id: brunoPackageId } })).toBe(0);
    expect(await restore.prescriptionDecision.count({ where: { userId: bruno.userId } })).toBe(0);

    // 3. FAIL-CLOSED: Polar volta DESCONECTADA e sem token; Strava e Wahoo (fora do dump) nao voltam com credenciais
    const polar = await restore.polarConnection.findUnique({ where: { userId: alice.userId } });
    expect(polar).toMatchObject({ accessTokenEncrypted: null, registeredAt: null });
    expect(polar?.disconnectedAt).toBeInstanceOf(Date);
    expect(await restore.stravaConnection.count({ where: { userId: alice.userId } })).toBe(0);
    expect(await restore.wahooConnection.count({ where: { userId: alice.userId } })).toBe(0);
    expect(await restore.providerConnectionEvent.count({ where: { provider: 'all', type: 'post_restore_safeguard' } })).toBeGreaterThan(0);

    // 4. TOMBSTONE posterior ao snapshot reaplicado: Bruno anonimizado e sem plano/sessoes/relatos; o resto intacto
    const brunoUser = await restore.user.findUnique({ where: { id: bruno.userId } });
    expect(brunoUser?.accountStatus).toBe('deleted');
    expect(brunoUser?.email).toMatch(/@deleted\.invalid$/);
    expect(await restore.trainingPlan.count({ where: { userId: bruno.userId } })).toBe(0);
    expect(await restore.trainingSession.count({ where: { userId: bruno.userId } })).toBe(0);
    expect(await restore.studentReportEntry.count({ where: { userId: bruno.userId } })).toBe(0);
    expect(await restore.user.findUnique({ where: { id: alice.userId } })).toMatchObject({ accountStatus: 'active' });

    // 5. O banco de ORIGEM nao foi tocado pela restauracao
    expect(await source.trainingPlan.count({ where: { userId: bruno.userId } })).toBe(1);
    expect(await source.polarConnection.findUnique({ where: { userId: alice.userId } })).toMatchObject({ accessTokenEncrypted: 'v1:sintetico', disconnectedAt: null });
  });
});
