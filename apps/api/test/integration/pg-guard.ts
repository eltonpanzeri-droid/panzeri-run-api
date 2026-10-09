// Testes de INTEGRACAO com PostgreSQL real (Etapa 1.2a, 09/10/2026). Rodam so' com TEST_DATABASE_URL e NUNCA contra um banco
// que nao seja local e de teste: o guard recusa qualquer URL cujo host nao seja loopback ou cujo banco nao termine em _test.
// Binarios do PostgreSQL 17 (psql/pg_dump/pg_restore) vem de TEST_PG_BIN (pasta bin do PostgreSQL portatil).
import { PrismaClient } from '@prisma/client';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function assertSafeTestDatabaseUrl(raw: string | undefined, label = 'TEST_DATABASE_URL'): string {
  if (!raw) throw new Error(`${label} nao definida: os testes de integracao exigem um PostgreSQL local de teste.`);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${label} invalida.`); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!LOOPBACK.has(url.hostname.toLowerCase())) throw new Error(`${label} recusada: o host precisa ser loopback (127.0.0.1/localhost).`);
  if (!/_test$/.test(database)) throw new Error(`${label} recusada: o nome do banco precisa terminar em "_test".`);
  return raw;
}

export function testDatabaseUrl(): string {
  return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
}

export function pgBinDir(): string {
  const bin = process.env.TEST_PG_BIN;
  if (!bin) throw new Error('TEST_PG_BIN nao definida (pasta bin do PostgreSQL 17 portatil).');
  return bin;
}

// PrismaClient apontado SO' para o banco de teste. DATABASE_URL tambem e' fixada, para qualquer codigo do projeto que a leia.
export function createTestPrisma(url: string = testDatabaseUrl()): PrismaClient {
  process.env.DATABASE_URL = assertSafeTestDatabaseUrl(url);
  return new PrismaClient({ datasources: { db: { url } } });
}

export function withPgOnPath(): void {
  const bin = pgBinDir();
  if (!(process.env.PATH ?? '').includes(bin)) process.env.PATH = `${bin};${process.env.PATH ?? ''}`;
}
