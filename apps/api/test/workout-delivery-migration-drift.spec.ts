import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Guarda contra drift Prisma x banco para WorkoutDelivery: toda coluna escalar do model precisa ser criada por alguma migration (CREATE TABLE ou
// ALTER TABLE ... ADD COLUMN). Caso real (07/10/2026): deliveredAt e canceledAt foram acrescentadas EDITANDO uma migration ja' aplicada, entao nunca
// chegaram ao banco de producao e o endpoint de elegibilidade do Apple Watch devolveu HTTP 500.
const PRISMA_DIR = join(__dirname, '..', 'prisma');
const SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'BigInt', 'Decimal', 'Bytes']);

function modelScalarFields(model: string): string[] {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8').replace(/\r\n/g, '\n');
  const start = schema.indexOf(`\nmodel ${model} {`);
  if (start < 0) return [];
  const end = schema.indexOf('\n}', start);
  const body = schema.slice(start, end);
  const fields: string[] = [];
  for (const raw of body.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
    const match = line.match(/^(\w+)\s+(\w+)(\?)?(\[\])?/);
    if (!match || !SCALARS.has(match[2]) || match[4]) continue; // relacoes e listas nao sao colunas
    fields.push(match[1]);
  }
  return fields;
}

function migratedColumns(table: string): Set<string> {
  const dirs = readdirSync(join(PRISMA_DIR, 'migrations')).filter((d) => statSync(join(PRISMA_DIR, 'migrations', d)).isDirectory()).sort();
  const columns = new Set<string>();
  const createRe = new RegExp(String.raw`CREATE TABLE "${table}" \(([\s\S]*?)\n\);`);
  const addRe = new RegExp(String.raw`ALTER TABLE "${table}"\s+ADD COLUMN(?: IF NOT EXISTS)? "(\w+)"`, 'g');
  for (const dir of dirs) {
    const sql = readFileSync(join(PRISMA_DIR, 'migrations', dir, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n');
    const create = sql.match(createRe);
    if (create) {
      for (const line of create[1].split('\n')) {
        const column = line.match(/^\s+"(\w+)"\s/);
        if (column) columns.add(column[1]);
      }
    }
    for (const add of sql.matchAll(addRe)) columns.add(add[1]);
  }
  return columns;
}

describe('WorkoutDelivery — o model Prisma e as migrations descrevem as mesmas colunas', () => {
  it('toda coluna do model e criada por alguma migration (incluindo deliveredAt e canceledAt)', () => {
    const fields = modelScalarFields('WorkoutDelivery');
    expect(fields.length).toBeGreaterThan(10); // o parser leu o model de verdade (nao e' uma comparacao vazia)
    const created = migratedColumns('WorkoutDelivery');
    expect(created.has('id')).toBe(true);
    expect(fields.filter((field) => !created.has(field))).toEqual([]);
  });

  it('o model tem as 15 colunas esperadas e a migration corretiva so adiciona deliveredAt e canceledAt', () => {
    expect([...modelScalarFields('WorkoutDelivery')].sort()).toEqual([
      'canceledAt', 'canonicalWorkout', 'createdAt', 'deliveredAt', 'errorMessage', 'externalWorkoutId', 'failedAt', 'id', 'provider', 'providerMetadata',
      'requestedAt', 'sentAt', 'status', 'trainingSessionId', 'updatedAt',
    ]);
    const fix = readFileSync(join(PRISMA_DIR, 'migrations', '20261007200000_workout_delivery_add_missing_columns', 'migration.sql'), 'utf8');
    const statements = fix.split('\n').filter((line) => !line.trim().startsWith('--') && line.trim());
    expect(statements).toEqual([
      'ALTER TABLE "WorkoutDelivery" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);',
      'ALTER TABLE "WorkoutDelivery" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);',
    ]); // aditiva: sem DROP/DELETE/TRUNCATE/CREATE TABLE
  });

  it('a migration original foi restaurada ao conteudo ja aplicado em producao (sem deliveredAt/canceledAt): a historia nao e mais reescrita', () => {
    const original = readFileSync(join(PRISMA_DIR, 'migrations', '20261002120000_add_workout_delivery', 'migration.sql'), 'utf8');
    expect(original).not.toContain('"deliveredAt"');
    expect(original).not.toContain('"canceledAt"');
  });

  it('o guarda detecta o drift: sem a migration corretiva, deliveredAt e canceledAt ficariam ausentes', () => {
    const original = readFileSync(join(PRISMA_DIR, 'migrations', '20261002120000_add_workout_delivery', 'migration.sql'), 'utf8');
    const columnsOfOriginal = [...original.matchAll(/^\s+"(\w+)"\s/gm)].map((m) => m[1]);
    const missingWithoutFix = modelScalarFields('WorkoutDelivery').filter((field) => !columnsOfOriginal.includes(field));
    expect(missingWithoutFix.sort()).toEqual(['canceledAt', 'deliveredAt']);
  });
});
