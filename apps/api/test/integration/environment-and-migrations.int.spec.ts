import { execFile } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { assertSafeTestDatabaseUrl, createTestPrisma, pgBinDir, testDatabaseUrl } from './pg-guard';

const run = promisify(execFile);
const API_ROOT = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(API_ROOT, 'prisma', 'migrations');

// O banco de teste precisa ter TODAS as migrations aplicadas ("prisma migrate deploy" com DATABASE_URL = banco local de teste).

describe('travas do ambiente de integracao (nunca producao)', () => {
  it('recusa host nao-loopback, banco sem sufixo _test e URL invalida/ausente', () => {
    expect(() => assertSafeTestDatabaseUrl(undefined)).toThrow(/nao definida/);
    expect(() => assertSafeTestDatabaseUrl('nao-e-url')).toThrow(/invalida/);
    expect(() => assertSafeTestDatabaseUrl('postgresql://u:p@agenteselton-panzeri-run-db.easypanel.host:5432/panzeri_test')).toThrow(/loopback/);
    expect(() => assertSafeTestDatabaseUrl('postgresql://u:p@72.60.245.112:5432/panzeri_test')).toThrow(/loopback/);
    expect(() => assertSafeTestDatabaseUrl('postgresql://u@127.0.0.1:55432/panzeri')).toThrow(/_test/);
    expect(() => assertSafeTestDatabaseUrl('postgresql://u@127.0.0.1:55432/postgres')).toThrow(/_test/);
  });

  it('aceita so banco local de teste', () => {
    expect(assertSafeTestDatabaseUrl('postgresql://postgres@127.0.0.1:55432/panzeri_test')).toContain('127.0.0.1');
    expect(assertSafeTestDatabaseUrl('postgresql://postgres@localhost:5432/outro_test')).toContain('localhost');
  });
});

describe('PostgreSQL 17 isolado e cadeia de migrations', () => {
  const prisma = createTestPrisma();
  afterAll(async () => { await prisma.$disconnect(); });

  it('o servidor e PostgreSQL 17 e o alvo e o banco local de teste', async () => {
    const [{ version }] = await prisma.$queryRaw<Array<{ version: string }>>`select version() as version`;
    expect(version).toMatch(/^PostgreSQL 17\./);
    expect(testDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl());
  });

  it('TODAS as migrations do repositorio estao aplicadas, concluidas e sem rollback', async () => {
    const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(MIGRATIONS_DIR, d.name, 'migration.sql'))).map((d) => d.name).sort();
    const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`select migration_name, finished_at, rolled_back_at from _prisma_migrations order by migration_name`;
    expect(onDisk.length).toBeGreaterThan(80);
    expect(rows.map((r) => r.migration_name)).toEqual(onDisk);
    expect(rows.every((r) => r.finished_at !== null && r.rolled_back_at === null)).toBe(true);
  });

  // Investigacao (09/10/2026) das migrations antigas modificadas: aplicar a cadeia ATUAL do zero funciona (acima). O que sobra de
  // diferenca entre "migrations" e schema.prisma esta listado AQUI — diferencas conhecidas, nao corrigidas (corrigir exige
  // migration nova e autorizacao). Qualquer divergencia NOVA falha este teste.
  it('divergencias conhecidas entre as migrations e o schema.prisma: so as ja documentadas, nenhuma nova', async () => {
    const { stdout } = await run('npx', ['prisma', 'migrate', 'diff', '--from-url', testDatabaseUrl(), '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { cwd: API_ROOT, shell: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env } });
    const statements = stdout.split('\n').map((l) => l.trim()).filter((l) => /^(CREATE|ALTER|DROP)\b/.test(l) || /^(ADD|ALTER|DROP) /.test(l));
    const KNOWN = [
      /^ALTER TABLE "MenstrualCycleLog" DROP CONSTRAINT "MenstrualCycleLog_profileId_fk";$/, // FK existe nas migrations e nao no schema
      /^ALTER TABLE "BillingEvent" ALTER COLUMN "id" DROP DEFAULT,$/, // valor numerico: migrations = numeric(10,2); schema = Decimal (65,30)
      /^ALTER COLUMN "value" SET DATA TYPE DECIMAL\(65,30\);$/,
      /^ALTER TABLE "MenstrualCycleLog" ALTER COLUMN "updatedAt" DROP DEFAULT;$/,
      /^ALTER TABLE "MenstrualProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;$/,
      /^ALTER TABLE "TrainingSession" ALTER COLUMN "updatedAt" DROP DEFAULT;$/,
      /^ALTER TABLE "UserAchievement" ALTER COLUMN "evidence" DROP DEFAULT;$/,
      /^ALTER TABLE "WorkoutCompletion" ALTER COLUMN "adjustmentReasons" DROP DEFAULT;$/,
      /^ALTER INDEX "ActivityTimeSeriesPoint_activityLogId_offsetSec_normalizat_key" RENAME TO /, // nome truncado (limite de 63 caracteres)
    ];
    const unexpected = statements.filter((s) => !KNOWN.some((re) => re.test(s)));
    expect(unexpected).toEqual([]);
  });

  it('EVIDENCIA do incidente da migration 20260916164659: a versao ORIGINAL (617788a) falha depois da 20260915120000 (coluna ja existe); a versao atual passa', async () => {
    const bin = pgBinDir();
    const base = new URL(testDatabaseUrl());
    const admin = `postgresql://${base.username}@${base.hostname}:${base.port}/postgres`;
    const scratch = 'panzeri_orig0916_scratch_test';
    const psql = (db: string, args: string[]) => run(join(bin, 'psql.exe'), ['-h', base.hostname, '-p', base.port, '-U', base.username, '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { maxBuffer: 8 * 1024 * 1024 });
    void admin;
    await psql('postgres', ['-c', `drop database if exists ${scratch}`]);
    await psql('postgres', ['-c', `create database ${scratch}`]);
    try {
      const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
      const before = dirs.filter((name) => name < '20260916164659_add_data_layer_phase_0');
      for (const name of before) await psql(scratch, ['-f', join(MIGRATIONS_DIR, name, 'migration.sql')]);
      // --single-transaction: a falha desfaz o arquivo inteiro, deixando o banco como estava antes da tentativa.
      await expect(psql(scratch, ['--single-transaction', '-f', join(__dirname, 'fixtures', 'phase0-original-617788a.sql')])).rejects.toThrow(/firstPaidAt.*already exists|already exists/);
      await expect(psql(scratch, ['-f', join(MIGRATIONS_DIR, '20260916164659_add_data_layer_phase_0', 'migration.sql')])).resolves.toBeDefined();
    } finally {
      await psql('postgres', ['-c', `drop database if exists ${scratch}`]);
    }
  });
});
