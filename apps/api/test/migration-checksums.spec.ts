// eslint-disable-next-line @typescript-eslint/no-var-requires
const { compare, sha256 } = require('../scripts/verify-migration-checksums.cjs') as {
  compare: (rows: Array<Record<string, unknown>>, repo: Map<string, { current: string; currentVariants: string[]; history: Array<{ commit: string; date: string; subject: string; checksum: string; variants?: string[] }> }>) => Array<{ migration: string; status: string; appliedVersion?: { commit: string }; flags: string[] }>;
  sha256: (buffer: Buffer) => string;
};

// Verificador OFFLINE de checksums de migrations (correcao pos-revisao do Astra, 10/10/2026): classificacao pura, sem banco e sem git.

const sql = (text: string) => Buffer.from(text, 'utf8');
const lf = sha256(sql('CREATE TABLE a (id int);\nCREATE INDEX i ON a(id);\n'));
const crlf = sha256(sql('CREATE TABLE a (id int);\r\nCREATE INDEX i ON a(id);\r\n'));
const original = sha256(sql('ALTER TABLE "User" ADD COLUMN "firstPaidAt" TIMESTAMP(3);\n'));

const repo = new Map([
  ['20260101000000_a', { current: lf, currentVariants: [lf, crlf], history: [{ commit: 'c2', date: '2026-01-02', subject: 'corrige', checksum: lf }, { commit: 'c1', date: '2026-01-01', subject: 'original', checksum: original }] }],
  ['20260201000000_b', { current: lf, currentVariants: [lf, crlf], history: [] }],
  ['20260301000000_ainda_nao_aplicada', { current: lf, currentVariants: [lf, crlf], history: [] }],
]);
const done = { finished_at: '2026-01-02T00:00:00Z', rolled_back_at: null };
const byName = (results: ReturnType<typeof compare>, name: string) => results.find((r) => r.migration === name)!;

describe('verificador de checksums de migrations', () => {
  it('igual ao arquivo atual; igual ate o fim de linha (CRLF x LF); versao antiga aplicada identificada pelo commit', () => {
    const results = compare([
      { migration_name: '20260101000000_a', checksum: lf, ...done },
      { migration_name: '20260201000000_b', checksum: crlf, ...done },
    ], repo);
    expect(byName(results, '20260101000000_a').status).toBe('IGUAL');
    expect(byName(results, '20260201000000_b').status).toBe('IGUAL_FIM_DE_LINHA_DIFERENTE');

    const old = compare([{ migration_name: '20260101000000_a', checksum: original, ...done }], repo);
    expect(byName(old, '20260101000000_a')).toMatchObject({ status: 'VERSAO_ANTIGA_APLICADA', appliedVersion: { commit: 'c1' } });
  });

  it('checksum desconhecido, migration so de producao, migration nao aplicada e migrations nao concluidas/revertidas', () => {
    const results = compare([
      { migration_name: '20260101000000_a', checksum: 'x'.repeat(64), ...done },
      { migration_name: '20990101000000_so_producao', checksum: lf, ...done },
      { migration_name: '20260201000000_b', checksum: lf, finished_at: null, rolled_back_at: null },
    ], repo);
    expect(byName(results, '20260101000000_a').status).toBe('CHECKSUM_DESCONHECIDO');
    expect(byName(results, '20990101000000_so_producao').status).toBe('NAO_EXISTE_NO_REPOSITORIO');
    expect(byName(results, '20260301000000_ainda_nao_aplicada').status).toBe('NAO_APLICADA_NO_BANCO');
    expect(byName(results, '20260201000000_b')).toMatchObject({ status: 'IGUAL_MAS_COM_PROBLEMA', flags: ['NAO_CONCLUIDA'] });
    const reverted = compare([{ migration_name: '20260201000000_b', checksum: lf, finished_at: '2026-01-02T00:00:00Z', rolled_back_at: '2026-01-03T00:00:00Z' }], repo);
    expect(byName(reverted, '20260201000000_b').flags).toEqual(['REVERTIDA']);
  });

  it('o checksum calculado e o sha256 dos bytes do arquivo (formato gravado pelo Prisma)', () => {
    expect(sha256(sql('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
