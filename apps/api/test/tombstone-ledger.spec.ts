import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ProviderDataDeletionService } from '../src/activity-execution/provider-data-deletion.service';
import { TOMBSTONE_MAGIC, decryptBuffer, parseBackupKey } from '../src/backup/backup-crypto';
import { SNAPSHOT_TOMBSTONE_MARGIN_MS, applyTombstones, restoreBackupFile } from '../src/backup/backup-restore';
import { BACKUP_PREFIX, BackupService } from '../src/backup/backup.service';
import {
  TOMBSTONE_PREFIX, TOMBSTONE_RETENTION_DAYS, Tombstone, TombstoneLedger, TombstoneUnavailableError,
  buildTombstone, parseTombstone, tombstoneObjectKey,
} from '../src/backup/tombstone-ledger';

// Tombstones (05/10/2026): ledger externo ao PostgreSQL, gravado e confirmado ANTES da exclusao local.
// Nenhum teste fala com R2 ou Postgres reais.

const ENC_KEY_HEX = 'ab'.repeat(32);
const R2_SECRET = 'r2-segredo-que-nao-pode-vazar';
const R2_ACCESS = 'AKIAFICTICIOACESSO999';
const USER_ID = '3f6c1d2e-8a4b-4f7c-9d11-2b5a6c7d8e9f';
const env: Record<string, string | undefined> = {
  BACKUP_ENCRYPTION_KEY: ENC_KEY_HEX, R2_ACCOUNT_ID: 'conta1', R2_BUCKET: 'bucket1', R2_ACCESS_KEY_ID: R2_ACCESS, R2_SECRET_ACCESS_KEY: R2_SECRET,
};

class FakeR2 {
  store = new Map<string, Buffer>();
  puts: string[] = [];
  deletes: string[] = [];
  putError: Error | null = null;
  headOverride: { size: number; etag: string | null; metadata: Record<string, string> } | null | undefined;
  async putObjectBuffer(key: string, body: Buffer) {
    if (this.putError) throw this.putError;
    this.puts.push(key); this.store.set(key, body);
  }
  async headObject(key: string) {
    if (this.headOverride !== undefined) return this.headOverride;
    const body = this.store.get(key);
    return body ? { size: body.length, etag: createHash('md5').update(body).digest('hex'), metadata: {} } : null;
  }
  async listObjects(prefix: string) {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, lastModified: new Date(), size: this.store.get(key)!.length }));
  }
  async getObjectBuffer(key: string) { return this.store.get(key)!; }
  async deleteObject(key: string) { this.deletes.push(key); this.store.delete(key); }
}

class TestLedger extends TombstoneLedger {
  constructor(public r2: FakeR2, config: Record<string, string | undefined> = env, public telegram2 = { notifyCoach: jest.fn(async () => undefined) }) {
    super({ get: (name: string) => config[name] } as never, telegram2 as never);
  }
  protected createR2() { return this.r2 as never; }
}

describe('formato do tombstone', () => {
  it('contem so v, type, userId, provider e at — nenhum dado pessoal', () => {
    const t = buildTombstone({ type: 'provider_data_deleted', userId: USER_ID, provider: 'polar' }, new Date('2026-10-05T12:00:00Z'));
    expect(t).toEqual({ v: 1, type: 'provider_data_deleted', userId: USER_ID, provider: 'polar', at: '2026-10-05T12:00:00.000Z' });
    expect(Object.keys(t).sort()).toEqual(['at', 'provider', 'type', 'userId', 'v']);
    expect(() => buildTombstone({ type: 'provider_data_deleted', userId: 'maria@exemplo.com', provider: 'polar' })).toThrow(); // e-mail nao entra
    expect(() => buildTombstone({ type: 'provider_data_deleted', userId: 'Maria Silva' })).toThrow();
    expect(() => parseTombstone({ v: 1, type: 'provider_data_deleted', userId: USER_ID, at: 'ontem' })).toThrow();
    expect(() => parseTombstone({ v: 2, type: 'provider_data_deleted', userId: USER_ID, at: new Date().toISOString() })).toThrow();
  });

  it('nome do objeto sem PII: prefixo proprio + data/hora + aleatorio', () => {
    const key = tombstoneObjectKey(new Date('2026-10-05T12:00:00Z'), 'a1b2c3d4');
    expect(key).toBe(`${TOMBSTONE_PREFIX}20261005T120000Z-a1b2c3d4.tomb.enc`);
    expect(key).not.toContain(USER_ID);
  });
});

describe('TombstoneLedger.record', () => {
  const logs: string[] = [];
  beforeEach(() => {
    logs.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  });
  afterEach(() => jest.restoreAllMocks());

  it('grava cifrado (AES-256-GCM), confirma e o conteudo so aparece com a chave', async () => {
    const ledger = new TestLedger(new FakeR2());
    const key = await ledger.record({ type: 'provider_data_deleted', userId: USER_ID, provider: 'polar' });
    const stored = ledger.r2.store.get(key)!;
    expect(stored.subarray(0, TOMBSTONE_MAGIC.length).equals(TOMBSTONE_MAGIC)).toBe(true);
    for (const plain of [USER_ID, 'provider_data_deleted', 'polar', ENC_KEY_HEX]) expect(stored.includes(Buffer.from(plain))).toBe(false);
    const decoded = JSON.parse(decryptBuffer(stored, parseBackupKey(ENC_KEY_HEX)).toString('utf8'));
    expect(decoded).toMatchObject({ v: 1, type: 'provider_data_deleted', userId: USER_ID, provider: 'polar' });
    expect(() => decryptBuffer(stored, parseBackupKey('11'.repeat(32)))).toThrow();
    expect(key.startsWith(TOMBSTONE_PREFIX)).toBe(true);
  });

  it('R2 indisponivel ou nao confirmado => 503 claro + alerta, sem vazar credencial', async () => {
    const down = new TestLedger(new FakeR2());
    down.r2.putError = new Error(`falha de rede em https://conta1.r2.cloudflarestorage.com com ${R2_SECRET} e ${R2_ACCESS} e ${ENC_KEY_HEX}`);
    await expect(down.record({ type: 'provider_data_deleted', userId: USER_ID, provider: 'polar' })).rejects.toBeInstanceOf(TombstoneUnavailableError);
    const unconfirmed = new TestLedger(new FakeR2());
    unconfirmed.r2.headOverride = { size: 1, etag: null, metadata: {} };
    await expect(unconfirmed.record({ type: 'provider_data_deleted', userId: USER_ID })).rejects.toBeInstanceOf(ServiceUnavailableException);
    const notConfigured = new TestLedger(new FakeR2(), { ...env, R2_BUCKET: undefined });
    await expect(notConfigured.record({ type: 'provider_data_deleted', userId: USER_ID })).rejects.toThrow('nada foi apagado');
    const exposed = JSON.stringify({ logs, alerts: [down.telegram2.notifyCoach.mock.calls, unconfirmed.telegram2.notifyCoach.mock.calls, notConfigured.telegram2.notifyCoach.mock.calls] });
    for (const secret of [R2_SECRET, R2_ACCESS, ENC_KEY_HEX, 'https://']) expect(exposed).not.toContain(secret);
    expect(down.telegram2.notifyCoach).toHaveBeenCalledWith(expect.stringContaining('exclusao BLOQUEADA'));
    await expect(down.record({ type: 'provider_data_deleted', userId: USER_ID })).rejects.toThrow('nada foi apagado');
  });

  it('loadAll devolve os tombstones ordenados; objeto corrompido ou chave errada faz o ledger contar como indisponivel', async () => {
    const ledger = new TestLedger(new FakeR2());
    await ledger.record({ type: 'provider_data_deleted', userId: 'u1', provider: 'polar' });
    await ledger.record({ type: 'provider_data_deleted', userId: 'u2', provider: 'strava' });
    expect((await ledger.loadAll()).map((t) => t.userId)).toEqual(['u1', 'u2']);
    const wrongKey = new TestLedger(ledger.r2, { ...env, BACKUP_ENCRYPTION_KEY: '22'.repeat(32) });
    await expect(wrongKey.loadAll()).rejects.toThrow();
    ledger.r2.store.set(`${TOMBSTONE_PREFIX}corrompido.tomb.enc`, Buffer.from('lixo'));
    await expect(ledger.loadAll()).rejects.toThrow();
  });
});

describe('exclusao de dados do provider com tombstone antes', () => {
  function build() {
    const order: string[] = [];
    const ledger = new TestLedger(new FakeR2());
    const record = ledger.record.bind(ledger);
    jest.spyOn(ledger, 'record').mockImplementation(async (input) => { const key = await record(input); order.push('tombstone'); return key; });
    const events: unknown[] = [];
    const prisma = {
      providerConnectionEvent: { create: jest.fn(async ({ data }: { data: unknown }) => { events.push(data); }) },
      $transaction: jest.fn(async () => { order.push('exclusao'); return { activities: 3 }; }),
    };
    const service = new ProviderDataDeletionService(prisma as never, ledger);
    return { service, ledger, prisma, order, events };
  }
  beforeEach(() => { for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());

  it('tombstone confirmado ANTES da exclusao local (ordem)', async () => {
    const { service, order, ledger } = build();
    await service.deleteProviderData(USER_ID, 'polar');
    expect(order).toEqual(['tombstone', 'exclusao']);
    expect(ledger.r2.puts).toHaveLength(1);
  });

  it('tombstone nao confirmado => NADA e apagado (a transacao de exclusao nem comeca)', async () => {
    const { service, prisma, ledger } = build();
    ledger.r2.putError = new Error('R2 fora do ar');
    await expect(service.deleteProviderData(USER_ID, 'polar')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('falha local DEPOIS do tombstone: tombstone preservado, evento auditado, alerta enviado', async () => {
    const { service, prisma, ledger, events } = build();
    prisma.$transaction.mockRejectedValueOnce(new Error('deadlock'));
    await expect(service.deleteProviderData(USER_ID, 'polar')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(ledger.r2.store.size).toBe(1);
    expect(ledger.r2.deletes).toEqual([]);
    expect(events).toEqual([{ userId: USER_ID, provider: 'polar', type: 'data_deletion_failed', details: { tombstoneKept: true } }]);
    expect(ledger.telegram2.notifyCoach).toHaveBeenCalledWith(expect.stringContaining('DEPOIS de gravar o tombstone'));
  });

  it('sem ledger configurado a exclusao e recusada (fail-closed); a reaplicacao da restauracao usa a execucao direta, sem novo tombstone', async () => {
    const prisma = { $transaction: jest.fn(async () => ({ activities: 0 })) };
    const bare = new ProviderDataDeletionService(prisma as never);
    await expect(bare.deleteProviderData(USER_ID, 'polar')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(bare.executeProviderDataDeletion(USER_ID, 'polar')).resolves.toEqual({ activities: 0 });
  });
});

describe('aplicacao pos-restauracao dos tombstones', () => {
  const snapshot = new Date('2026-10-05T07:00:00Z');
  const at = (ms: number) => new Date(snapshot.getTime() + ms).toISOString();
  const tombs: Tombstone[] = [
    { v: 1, type: 'provider_data_deleted', userId: 'antigo', provider: 'polar', at: at(-24 * 3600_000) },
    { v: 1, type: 'provider_data_deleted', userId: 'na-margem', provider: 'polar', at: at(-2 * 60_000) },
    { v: 1, type: 'provider_data_deleted', userId: 'depois', provider: 'strava', at: at(3600_000) },
  ];

  it('reaplica SO os posteriores ao snapshot (com a margem do tempo maximo da exclusao) e e idempotente', async () => {
    const applied: string[] = [];
    const run = () => applyTombstones({ snapshotStartedAt: snapshot, load: async () => tombs, deleteProviderData: async (u, p) => { applied.push(`${u}:${p}`); }, deleteAccount: async () => undefined });
    const first = await run();
    expect(first).toEqual({ status: 'applied', applied: 2, skippedBeforeSnapshot: 1, unsupported: 0 });
    expect(applied).toEqual(['na-margem:polar', 'depois:strava']);
    expect(SNAPSHOT_TOMBSTONE_MARGIN_MS).toBeGreaterThanOrEqual(60_000); // >= teto da transacao de exclusao
    expect(await run()).toEqual(first); // segunda execucao: mesmo resultado
  });

  it('tipo desconhecido (sem executor) mantem a reconciliacao PENDENTE', async () => {
    const result = await applyTombstones({
      snapshotStartedAt: snapshot, deleteProviderData: async () => undefined, deleteAccount: async () => undefined,
      load: async () => [{ v: 1, type: 'tipo_futuro' as never, userId: 'x', at: at(1000) }],
    });
    expect(result.status).toBe('pending');
    expect(result.unsupported).toBe(1);
  });

  it('ledger indisponivel: restauracao NAO e concluida, banco segue fail-closed e o erro e sanitizado', async () => {
    const polar = [{ userId: 'a', disconnectedAt: null as Date | null, accessTokenEncrypted: 'v1:x' as string | null }];
    const prisma = {
      polarConnection: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { polar.forEach((c) => Object.assign(c, data)); return { count: polar.length }; } },
      wahooConnection: { updateMany: async () => ({ count: 0 }) },
      stravaConnection: { deleteMany: async () => ({ count: 0 }) },
      stravaActivity: { deleteMany: async () => ({ count: 0 }) },
      stravaAnalysisCache: { deleteMany: async () => ({ count: 0 }) },
      trainingExecutionInsight: { deleteMany: async () => ({ count: 0 }) },
      providerConnectionEvent: { create: async () => undefined },
    };
    const deleteProviderData = jest.fn();
    const outcome = await restoreBackupFile({
      dumpPath: '/tmp/x.dump', targetDatabaseUrl: 'postgresql://u:senha-do-alvo@h:5432/db', prisma: prisma as never,
      exec: async () => undefined, snapshotStartedAt: snapshot,
      loadTombstones: async () => { throw new Error(`R2 indisponivel em https://x.r2.cloudflarestorage.com (${R2_SECRET})`); },
      deleteProviderData, deleteAccount: jest.fn(),
    });
    expect(outcome.complete).toBe(false);
    expect(outcome.tombstones.status).toBe('pending');
    expect(polar[0].disconnectedAt).not.toBeNull(); // fail-closed ja aplicado
    expect(polar[0].accessTokenEncrypted).toBeNull();
    expect(deleteProviderData).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain('https://');
  });

  it('a CLI avisa que a reconciliacao esta pendente e sai com codigo 2; a data do snapshot vem do metadado do backup, nao de texto livre', () => {
    const cli = readFileSync(join(__dirname, '../src/backup/cli.ts'), 'utf8');
    expect(cli).toContain('RESTAURACAO NAO CONCLUIDA');
    expect(cli).toContain('process.exitCode = 2');
    expect(cli).toContain('head.metadata.created');
    expect(cli).toContain('Data do snapshot desconhecida');
    const service = readFileSync(join(__dirname, '../src/backup/backup.service.ts'), 'utf8');
    expect(service).toContain('created: snapshotStartedAt.toISOString()');
  });
});

describe('prefixos e retencao separados', () => {
  it('dumps e tombstones tem prefixos disjuntos (a regra de 14 dias nao alcanca tombstones)', () => {
    expect(BACKUP_PREFIX).toBe('panzeri-backups/db/');
    expect(TOMBSTONE_PREFIX).toBe('panzeri-backups/tombstones/');
    expect(TOMBSTONE_PREFIX.startsWith(BACKUP_PREFIX)).toBe(false);
    expect(BACKUP_PREFIX.startsWith(TOMBSTONE_PREFIX)).toBe(false);
    expect(TOMBSTONE_RETENTION_DAYS).toBe(365);
  });

  it('a limpeza de 14 dias dos dumps nunca apaga um tombstone, mesmo que a listagem o devolva', async () => {
    const deleted: string[] = [];
    class Svc extends BackupService {
      protected createR2() {
        return {
          putObjectFromFile: async () => undefined, headObject: async () => null, deleteObject: async (k: string) => { deleted.push(k); },
          listObjects: async () => [{ key: `${TOMBSTONE_PREFIX}antigo.tomb.enc`, lastModified: new Date(0), size: 1 }],
        } as never;
      }
      protected async runPgDump() { throw new Error('irrelevante'); }
    }
    // pruneOldBackups e privado: exercita-o via reflexao com um listing contendo so' o tombstone antigo.
    const svc = new Svc({ get: () => undefined } as never, {} as never);
    const prune = (svc as unknown as { pruneOldBackups(c: unknown, k: string, s: unknown[]): Promise<number> }).pruneOldBackups.bind(svc);
    expect(await prune(svc['createR2'](), 'novo', [])).toBe(0);
    expect(deleted).toEqual([]);
  });

  it('o codigo nunca apaga tombstones (a expiracao de 365 dias e uma Lifecycle Rule do R2)', () => {
    const code = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(code('../src/backup/tombstone-ledger.ts')).not.toMatch(/deleteObject/);
    expect(code('../src/backup/cli.ts')).not.toMatch(/deleteObject/);
  });
});
