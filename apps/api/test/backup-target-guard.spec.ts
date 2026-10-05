import { readFileSync } from 'fs';
import { join } from 'path';
import { sameDatabaseTarget } from '../src/backup/backup-sanitize';

// Trava do restore (05/10/2026): TARGET_DATABASE_URL nao pode apontar para o mesmo banco de DATABASE_URL, mesmo com
// strings diferentes. Compara hostname + porta efetiva + database. URLs fictícias: nenhum banco real e' tocado.

const PROD = 'postgresql://user1:senha@db.interno:5432/producao';

describe('sameDatabaseTarget — mesmo banco e bloqueado', () => {
  it('1. URLs literalmente iguais', () => {
    expect(sameDatabaseTarget(PROD, PROD)).toBe(true);
  });

  it('2. mesmo host/porta/database com credenciais diferentes', () => {
    expect(sameDatabaseTarget(PROD, 'postgresql://user2:outrasenha@db.interno:5432/producao')).toBe(true);
    expect(sameDatabaseTarget(PROD, 'postgresql://db.interno:5432/producao')).toBe(true); // sem credenciais
  });

  it('3. porta 5432 explicita de um lado e padrao implicito do outro', () => {
    expect(sameDatabaseTarget(PROD, 'postgresql://user2:x@db.interno/producao')).toBe(true);
    expect(sameDatabaseTarget('postgresql://a:b@db.interno/producao', PROD)).toBe(true);
    // exemplo do pedido: credenciais e porta diferem na forma, query presente
    expect(sameDatabaseTarget('postgresql://user1:senha@host:5432/producao', 'postgresql://user2:outrasenha@host/producao?sslmode=disable')).toBe(true);
  });

  it('4. mesmo banco com query parameters diferentes (valor, presenca e ordem)', () => {
    expect(sameDatabaseTarget(PROD, `${PROD}?sslmode=disable`)).toBe(true);
    expect(sameDatabaseTarget(`${PROD}?sslmode=require&connect_timeout=5`, `${PROD}?connect_timeout=9&sslmode=disable`)).toBe(true);
  });

  it('variacoes de representacao do host: caixa, ponto final, esquema postgres://, loopback', () => {
    expect(sameDatabaseTarget(PROD, 'postgres://u:p@DB.Interno:5432/producao')).toBe(true);
    expect(sameDatabaseTarget(PROD, 'postgresql://u:p@db.interno.:5432/producao')).toBe(true);
    expect(sameDatabaseTarget('postgresql://u:p@localhost:5432/x', 'postgresql://u:p@127.0.0.1/x')).toBe(true);
    expect(sameDatabaseTarget('postgresql://u:p@localhost/x', 'postgresql://u:p@[::1]:5432/x')).toBe(true);
  });

  it('fail-closed: URL ilegivel ou parametros que redefinem host/porta/banco na query contam como mesmo banco', () => {
    expect(sameDatabaseTarget(PROD, 'isto-nao-e-url')).toBe(true);
    expect(sameDatabaseTarget('mysql://u:p@db.interno:5432/producao', PROD)).toBe(true);
    expect(sameDatabaseTarget(PROD, 'postgresql://u:p@outro-host/outro?host=db.interno')).toBe(true);
    expect(sameDatabaseTarget(PROD, 'postgresql://u:p@outro-host/outro?dbname=producao')).toBe(true);
    expect(sameDatabaseTarget(PROD, 'postgresql://u:p@outro-host:5433/outro?port=5432')).toBe(true);
  });
});

describe('sameDatabaseTarget — bancos realmente diferentes sao permitidos', () => {
  it('5. database diferente', () => {
    expect(sameDatabaseTarget(PROD, 'postgresql://user1:senha@db.interno:5432/panzeri_run_restore_test_20261005')).toBe(false);
  });

  it('6. host diferente', () => {
    expect(sameDatabaseTarget(PROD, 'postgresql://user1:senha@pg-restore-test:5432/producao')).toBe(false);
  });

  it('7. porta realmente diferente', () => {
    expect(sameDatabaseTarget(PROD, 'postgresql://user1:senha@db.interno:5433/producao')).toBe(false);
    expect(sameDatabaseTarget('postgresql://u:p@db.interno/producao', 'postgresql://u:p@db.interno:6543/producao')).toBe(false);
  });
});

describe('a trava esta ligada na CLI e as demais protecoes continuam', () => {
  const cli = readFileSync(join(__dirname, '../src/backup/cli.ts'), 'utf8');

  it('a CLI usa a comparacao semantica (nao mais igualdade de strings) e mantem mensagem, --yes e TARGET obrigatoria', () => {
    expect(cli).toContain('sameDatabaseTarget(target, process.env.DATABASE_URL)');
    expect(cli).not.toMatch(/target === process\.env\.DATABASE_URL/);
    expect(cli).toContain('TARGET_DATABASE_URL e igual a DATABASE_URL');
    expect(cli).toContain("flag('yes')");
    expect(cli).toContain("env('TARGET_DATABASE_URL')");
  });

  it('a trava roda antes de qualquer cliente de banco ser criado e a DATABASE_URL nunca e usada para conectar', () => {
    const guard = cli.indexOf('sameDatabaseTarget(target');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(cli.indexOf('new PrismaClient('));
    const code = cli.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const uses = code.match(/process\.env\.DATABASE_URL/g) ?? [];
    expect(uses).toHaveLength(3); // guarda (2x) + redacao de erros (1x); nenhuma e' conexao
    expect(code).not.toMatch(/datasources:\s*\{\s*db:\s*\{\s*url:\s*process\.env\.DATABASE_URL/);
  });
});
