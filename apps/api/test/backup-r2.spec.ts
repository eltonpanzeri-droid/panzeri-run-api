import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BackupService, BACKUP_PREFIX, BACKUP_RETENTION_DAYS } from '../src/backup/backup.service';
import { BACKUP_MAGIC, decryptFile, encryptFile, parseBackupKey } from '../src/backup/backup-crypto';
import { pgEnvFromUrl, redactSecrets } from '../src/backup/backup-sanitize';
import { postRestoreSafeguard, restoreBackupFile } from '../src/backup/backup-restore';
import { R2Client, R2Config, Transport, TransportRequest, signRequest, EMPTY_PAYLOAD_SHA256 } from '../src/backup/r2-client';
import { CoachController } from '../src/coach/coach.controller';
import { RolesGuard } from '../src/common/roles.guard';

// Bloco pre-Garmin 4 (05/10/2026): backup criptografado no R2, sem vazar credenciais, retencao de 14 dias,
// endpoint admin-only e restauracao fail-closed. Nenhum teste fala com rede, R2 ou Postgres reais.

const DB_PASSWORD = 'senha-super-secreta-do-banco';
const DB_URL = `postgresql://app_user:${DB_PASSWORD}@db.interno:5432/panzeri?sslmode=disable`;
const ENC_KEY_HEX = 'cd'.repeat(32);
const R2_SECRET = 'r2-segredo-que-nao-pode-vazar';
const R2_ACCESS = 'AKIAFICTICIOACESSO123';
const PLAINTEXT_MARKER = 'DADO-SENSIVEL-EM-CLARO-12345';

// Codigo sem comentarios (os testes estaticos olham so' o que executa).
const codeOf = (rel: string) => readFileSync(join(__dirname, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .map((line) => line.replace(/^\s*\/\/.*$/, ''))
  .join('\n');

const env: Record<string, string> = {
  DATABASE_URL: DB_URL, BACKUP_ENCRYPTION_KEY: ENC_KEY_HEX,
  R2_ACCOUNT_ID: 'conta123', R2_BUCKET: 'panzeri-backups', R2_ACCESS_KEY_ID: R2_ACCESS, R2_SECRET_ACCESS_KEY: R2_SECRET,
};

describe('SigV4 (R2) e cliente', () => {
  it('assinatura confere com o vetor oficial de testes do AWS SigV4 (get-vanilla)', () => {
    const authorization = signRequest({
      method: 'GET', path: '/', headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: EMPTY_PAYLOAD_SHA256, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1', service: 'service', amzDate: '20150830T123600Z',
    });
    expect(authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  function fakeTransport(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
    const calls: TransportRequest[] = [];
    const transport: Transport = async (request) => {
      calls.push(request);
      const next = responses.shift() ?? { status: 500 };
      return { status: next.status, headers: next.headers ?? {}, body: Buffer.from(next.body ?? '') };
    };
    return { calls, transport };
  }
  const cfg: R2Config = { accountId: 'conta123', bucket: 'panzeri-backups', accessKeyId: R2_ACCESS, secretAccessKey: R2_SECRET };

  it('list pagina, extrai chaves e datas; delete e head usam os verbos certos e o host da conta', async () => {
    const page1 = '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok1</NextContinuationToken><Contents><Key>panzeri-backups/db/a.dump.enc</Key><LastModified>2026-09-01T00:00:00.000Z</LastModified><Size>10</Size></Contents></ListBucketResult>';
    const page2 = '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>panzeri-backups/db/b.dump.enc</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified><Size>20</Size></Contents></ListBucketResult>';
    const { calls, transport } = fakeTransport([{ status: 200, body: page1 }, { status: 200, body: page2 }, { status: 204 }, { status: 200, headers: { 'content-length': '20', etag: '"abc"' } }]);
    const client = new R2Client(cfg, transport, () => new Date('2026-10-05T12:00:00Z'));
    const objects = await client.listObjects(BACKUP_PREFIX);
    expect(objects.map((o) => o.key)).toEqual(['panzeri-backups/db/a.dump.enc', 'panzeri-backups/db/b.dump.enc']);
    expect(calls[1].path).toContain('continuation-token=tok1');
    await client.deleteObject('panzeri-backups/db/a.dump.enc');
    expect(calls[2].method).toBe('DELETE');
    expect(calls[2].host).toBe('conta123.r2.cloudflarestorage.com');
    expect(await client.headObject('x')).toEqual({ size: 20, etag: 'abc', metadata: {} });
    for (const call of calls) {
      expect(call.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAFICTICIOACESSO123\/20261005\/auto\/s3\/aws4_request/);
      expect(JSON.stringify(call)).not.toContain(R2_SECRET);
    }
  });

  it('erro de R2 nao ecoa corpo nem cabecalhos da resposta', async () => {
    const { transport } = fakeTransport([{ status: 403, body: `<Error>segredo ${R2_SECRET}</Error>` }]);
    await expect(new R2Client(cfg, transport).deleteObject('k')).rejects.toThrow('R2: exclusao falhou (HTTP 403).');
  });
});

describe('criptografia do backup (AES-256-GCM)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const key = parseBackupKey(ENC_KEY_HEX);

  it('arquivo cifrado nao contem o conteudo em claro, tem o cabecalho do formato e decifra de volta identico', async () => {
    const plain = join(dir, 'p1'); const enc = join(dir, 'e1'); const back = join(dir, 'b1');
    writeFileSync(plain, `inicio ${PLAINTEXT_MARKER} fim ${'x'.repeat(100_000)}`);
    const info = await encryptFile(plain, enc, key);
    const encrypted = readFileSync(enc);
    expect(encrypted.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)).toBe(true);
    expect(encrypted.includes(Buffer.from(PLAINTEXT_MARKER))).toBe(false);
    expect(encrypted.includes(Buffer.from(ENC_KEY_HEX))).toBe(false);
    expect(info.size).toBe(encrypted.length);
    await decryptFile(enc, back, key);
    expect(readFileSync(back).equals(readFileSync(plain))).toBe(true);
  });

  it('chave errada ou arquivo adulterado falham e nao deixam saida; chave invalida e recusada', async () => {
    const plain = join(dir, 'p2'); const enc = join(dir, 'e2');
    writeFileSync(plain, 'conteudo');
    await encryptFile(plain, enc, key);
    await expect(decryptFile(enc, join(dir, 'b2'), parseBackupKey('11'.repeat(32)))).rejects.toThrow('chave incorreta ou backup corrompido');
    expect(existsSync(join(dir, 'b2'))).toBe(false);
    const tampered = readFileSync(enc); tampered[tampered.length - 20] ^= 0xff;
    writeFileSync(join(dir, 'e2t'), tampered);
    await expect(decryptFile(join(dir, 'e2t'), join(dir, 'b3'), key)).rejects.toThrow();
    expect(() => parseBackupKey('curta')).toThrow('BACKUP_ENCRYPTION_KEY');
    expect(() => parseBackupKey(undefined)).toThrow();
  });
});

describe('protecao da DATABASE_URL', () => {
  it('pgEnvFromUrl decompoe a URL em variaveis PG* (nada de URL em argumento)', () => {
    expect(pgEnvFromUrl(DB_URL)).toEqual({ PGHOST: 'db.interno', PGPORT: '5432', PGUSER: 'app_user', PGPASSWORD: DB_PASSWORD, PGDATABASE: 'panzeri', PGSSLMODE: 'disable' });
    expect(() => pgEnvFromUrl('nao-e-url')).toThrow('DATABASE_URL invalida');
    try { pgEnvFromUrl('nao-e-url-com-senha-xyz'); } catch (e) { expect((e as Error).message).not.toContain('senha-xyz'); }
  });

  it('redactSecrets remove segredos conhecidos e qualquer URL, mesmo em erro inesperado', () => {
    const msg = `Command failed: pg_dump "${DB_URL}" erro em https://x.y/z?token=abc senha ${DB_PASSWORD} chave ${ENC_KEY_HEX}`;
    const out = redactSecrets(new Error(msg), [DB_PASSWORD, ENC_KEY_HEX]);
    for (const leaked of [DB_URL, DB_PASSWORD, ENC_KEY_HEX, 'postgresql://', 'https://x.y']) expect(out).not.toContain(leaked);
  });
});

class TestBackupService extends BackupService {
  uploads: Array<{ key: string; bytes: Buffer; info: unknown; metadata: Record<string, string> }> = [];
  deleted: string[] = [];
  listing: Array<{ key: string; lastModified: Date; size: number }> = [];
  dumpPaths: string[] = [];
  dumpEnvs: Array<Record<string, string>> = [];
  pgDumpError: Error | null = null;
  headOverride: { size: number; etag: string | null } | null | undefined;
  protected createR2() {
    const self = this;
    return {
      async putObjectFromFile(key: string, file: string, info: { size: number }, metadata: Record<string, string>) { self.uploads.push({ key, bytes: readFileSync(file), info, metadata }); },
      async headObject() { return self.headOverride !== undefined ? self.headOverride : { size: (self.uploads[0].info as { size: number }).size, etag: (self.uploads[0].info as { md5: string }).md5 }; },
      async listObjects() { return self.listing; },
      async deleteObject(key: string) { self.deleted.push(key); },
    } as never;
  }
  protected async runPgDump(pgEnv: Record<string, string>, dumpPath: string) {
    this.dumpPaths.push(dumpPath); this.dumpEnvs.push(pgEnv);
    if (this.pgDumpError) throw this.pgDumpError;
    writeFileSync(dumpPath, `PGDMP ${PLAINTEXT_MARKER}`);
  }
}

function buildService(overrides: Record<string, string | undefined> = {}) {
  const telegram = { notifyCoach: jest.fn(async () => undefined) };
  const merged = { ...env, ...overrides };
  const service = new TestBackupService({ get: (name: string) => merged[name] } as never, telegram as never);
  return { service, telegram };
}

describe('BackupService (R2, criptografado)', () => {
  const logs: string[] = [];
  beforeEach(() => {
    logs.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  });
  afterEach(() => jest.restoreAllMocks());

  it('arquivo enviado ao R2 esta criptografado, dump em claro e removido e chave/URL nao aparecem em nome, metadados nem logs', async () => {
    const { service } = buildService();
    const result = await service.runBackup();
    expect(result.ok).toBe(true);
    const upload = service.uploads[0];
    expect(upload.bytes.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)).toBe(true);
    expect(upload.bytes.includes(Buffer.from(PLAINTEXT_MARKER))).toBe(false);
    expect(upload.key).toMatch(/^panzeri-backups\/db\/\d{8}T\d{6}Z-[0-9a-f]{8}\.dump\.enc$/);
    const exposed = JSON.stringify({ key: upload.key, metadata: upload.metadata, result, logs });
    for (const secret of [ENC_KEY_HEX, DB_URL, DB_PASSWORD, R2_SECRET, R2_ACCESS, 'app_user', 'db.interno']) expect(exposed).not.toContain(secret);
    expect(service.dumpPaths.every((p) => !existsSync(p))).toBe(true); // dump em claro e arquivo cifrado removidos
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('panzeri-backup-') && service.dumpPaths[0].includes(n))).toEqual([]);
  });

  it('o backup restaurado decifra para o dump original (round-trip do artefato enviado)', async () => {
    const { service } = buildService();
    await service.runBackup();
    const dir = mkdtempSync(join(tmpdir(), 'bk-rt-'));
    writeFileSync(join(dir, 'enc'), service.uploads[0].bytes);
    await decryptFile(join(dir, 'enc'), join(dir, 'out'), parseBackupKey(ENC_KEY_HEX));
    expect(readFileSync(join(dir, 'out'), 'utf8')).toBe(`PGDMP ${PLAINTEXT_MARKER}`);
    rmSync(dir, { recursive: true, force: true });
  });

  it('pg_dump nao usa shell nem URL: so variaveis PG* e execFile (sem interpolacao da DATABASE_URL)', () => {
    const source = readFileSync(join(__dirname, '../src/backup/backup.service.ts'), 'utf8');
    expect(source).toContain("execFileAsync('pg_dump', ['--format=custom', '--file', dumpPath,");
    expect(source).not.toMatch(/\bexec\(|promisify\(exec\)|execAsync/);
    expect(source).not.toMatch(/pg_dump\s+"\$\{/);
    const { service } = buildService();
    return service.runBackup().then(() => {
      expect(service.dumpEnvs[0]).toMatchObject({ PGHOST: 'db.interno', PGDATABASE: 'panzeri' });
    });
  });

  it('erro do pg_dump com a URL dentro nao vaza para resultado, log nem Telegram', async () => {
    const { service, telegram } = buildService();
    service.pgDumpError = new Error(`Command failed: pg_dump "${DB_URL}"\npg_dump: error: connection to server at "db.interno" failed: password authentication failed for user "app_user" (${DB_PASSWORD})`);
    const result = await service.runBackup();
    expect(result.ok).toBe(false);
    await service.runScheduledBackup();
    const exposed = JSON.stringify({ result, logs, telegram: telegram.notifyCoach.mock.calls });
    for (const secret of [DB_URL, DB_PASSWORD, 'postgresql://']) expect(exposed).not.toContain(secret);
    expect(telegram.notifyCoach).toHaveBeenCalled();
  });

  it('configuracao incompleta falha de forma explicita citando so os NOMES das variaveis', async () => {
    const { service } = buildService({ R2_BUCKET: undefined, BACKUP_ENCRYPTION_KEY: undefined });
    const result = await service.runBackup();
    expect(result).toEqual({ ok: false, error: 'Backup nao configurado. Variaveis ausentes: BACKUP_ENCRYPTION_KEY, R2_BUCKET.' });
    expect(service.dumpPaths).toHaveLength(0);
  });

  it('upload nao confirmado (tamanho divergente) apaga o objeto e falha', async () => {
    const { service } = buildService();
    service.headOverride = { size: 1, etag: null };
    const result = await service.runBackup();
    expect(result.ok).toBe(false);
    expect(service.deleted).toContain(service.uploads[0].key);
  });

  it('retencao de 14 dias: apaga so objetos antigos do prefixo; preserva recentes, o recem-enviado e objetos de fora do prefixo', async () => {
    const { service } = buildService();
    const day = 24 * 60 * 60 * 1000;
    service.listing = [
      { key: `${BACKUP_PREFIX}velho.dump.enc`, lastModified: new Date(Date.now() - (BACKUP_RETENTION_DAYS + 1) * day), size: 1 },
      { key: `${BACKUP_PREFIX}recente.dump.enc`, lastModified: new Date(Date.now() - 13 * day), size: 1 },
      { key: 'outra-pasta/velho.bin', lastModified: new Date(Date.now() - 90 * day), size: 1 },
    ];
    const result = await service.runBackup();
    expect(BACKUP_RETENTION_DAYS).toBe(14);
    expect(result.prunedObjects).toBe(1);
    expect(service.deleted).toEqual([`${BACKUP_PREFIX}velho.dump.enc`]);
  });

  it('backup nao e mais enviado pelo Resend: servico sem EmailService, sem anexo, modulo sem MessagingModule', () => {
    const service = codeOf('../src/backup/backup.service.ts');
    const module = codeOf('../src/backup/backup.module.ts');
    expect(service).not.toMatch(/EmailService|resend|attachments|BACKUP_EMAIL_TO/i);
    expect(module).not.toContain('MessagingModule');
    expect(BackupService.length).toBe(2); // (config, telegram)
  });
});

describe('POST /coach/backup/run e admin-only', () => {
  const guard = new RolesGuard(new Reflector());
  const ctx = (role: string) => ({
    getHandler: () => CoachController.prototype.runDatabaseBackup, getClass: () => CoachController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', email: 'e', role } }) }),
  } as unknown as ExecutionContext);
  it('admin pode; coach e aluno recebem 403', () => {
    expect(guard.canActivate(ctx('admin'))).toBe(true);
    expect(() => guard.canActivate(ctx('coach'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('student'))).toThrow(ForbiddenException);
  });
});

describe('restauracao fail-closed', () => {
  function fakePrisma(polar: Array<Record<string, unknown>>, strava: Array<Record<string, unknown>>, wahoo: Array<Record<string, unknown>> = []) {
    const events: unknown[] = [];
    return {
      polar, strava, wahoo, events,
      wahooConnection: { updateMany: async ({ data }: { where: { disconnectedAt: null }; data: Record<string, unknown> }) => { const hit = wahoo.filter((c) => c.disconnectedAt == null); hit.forEach((c) => Object.assign(c, data)); return { count: hit.length }; } },
      polarConnection: { updateMany: async ({ where, data }: { where: { disconnectedAt: null }; data: Record<string, unknown> }) => { const hit = polar.filter((c) => c.disconnectedAt == null); hit.forEach((c) => Object.assign(c, data)); return { count: hit.length }; } },
      stravaConnection: { deleteMany: async () => { const count = strava.length; strava.length = 0; return { count }; } },
      stravaActivity: { deleteMany: async () => ({ count: 0 }) },
      stravaAnalysisCache: { deleteMany: async () => ({ count: 0 }) },
      trainingExecutionInsight: { deleteMany: async () => ({ count: 0 }) },
      providerConnectionEvent: { create: async ({ data }: { data: unknown }) => { events.push(data); return data; } },
    };
  }

  it('Polar restaurada como conectada volta DESCONECTADA, sem token e sem estado de transaction; Strava restaurado perde os tokens', async () => {
    const prisma = fakePrisma(
      [{ userId: 'a', disconnectedAt: null, accessTokenEncrypted: 'v1:x', openTransactionId: 't', registeredAt: new Date() }, { userId: 'b', disconnectedAt: new Date('2026-01-01'), accessTokenEncrypted: null }],
      [{ userId: 'a', accessToken: 'tok', refreshToken: 'ref' }],
    );
    const result = await postRestoreSafeguard(prisma as never, new Date('2026-10-05T12:00:00Z'));
    expect(result).toEqual({ polarDisconnected: 1, stravaConnectionsRemoved: 1, wahooDisconnected: 0 });
    expect(prisma.polar[0]).toMatchObject({ disconnectedAt: new Date('2026-10-05T12:00:00Z'), accessTokenEncrypted: null, openTransactionId: null, registeredAt: null });
    expect(prisma.strava).toHaveLength(0); // sem linha = sem sync (strava.service.ts so' sincroniza com StravaConnection)
    expect(prisma.events).toHaveLength(1);
    expect(JSON.stringify(prisma.events)).not.toMatch(/token|v1:x/i);
    // idempotente
    expect(await postRestoreSafeguard(prisma as never)).toEqual({ polarDisconnected: 0, stravaConnectionsRemoved: 0, wahooDisconnected: 0 });
  });

  it('Wahoo restaurada como conectada volta DESCONECTADA e sem nenhum token (refresh token rotativo do backup e invalido); idempotente', async () => {
    const prisma = fakePrisma([], [], [
      { userId: 'a', disconnectedAt: null, accessTokenEncrypted: 'v1:a', refreshTokenEncrypted: 'v1:r', accessTokenExpiresAt: new Date(), refreshLockUntil: new Date() },
      { userId: 'b', disconnectedAt: new Date('2026-01-01'), accessTokenEncrypted: null, refreshTokenEncrypted: null },
    ]);
    const result = await postRestoreSafeguard(prisma as never, new Date('2026-10-08T12:00:00Z'));
    expect(result).toEqual({ polarDisconnected: 0, stravaConnectionsRemoved: 0, wahooDisconnected: 1 });
    expect(prisma.wahoo[0]).toMatchObject({ disconnectedAt: new Date('2026-10-08T12:00:00Z'), accessTokenEncrypted: null, refreshTokenEncrypted: null, accessTokenExpiresAt: null, refreshLockUntil: null });
    expect(JSON.stringify(prisma.events)).not.toMatch(/token|v1:/i);
    expect((await postRestoreSafeguard(prisma as never)).wahooDisconnected).toBe(0);
  });

  it('Polar restaurada nao sincroniza: o sync recusa conexao desconectada (mesma regra do Bloco 1)', async () => {
    const { PolarActivityIngestionService } = await import('../src/polar/polar-activity-ingestion.service');
    const prismaStore = fakePrisma([{ userId: 'a', disconnectedAt: null, accessTokenEncrypted: 'v1:x', registeredAt: new Date() }], []);
    await postRestoreSafeguard(prismaStore as never);
    const prisma = { polarConnection: { findUnique: async () => ({ ...prismaStore.polar[0] }) } };
    const ingestion = new PolarActivityIngestionService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    await expect(ingestion.sync('a')).rejects.toThrow('Conta Polar desconectada');
  });

  it('restore = pg_restore + etapa pos-restauracao SEMPRE; sem URL em argumento; a etapa roda mesmo se o pg_restore falhar', async () => {
    const prisma = fakePrisma([{ userId: 'a', disconnectedAt: null, accessTokenEncrypted: 'v1:x' }], []);
    const calls: Array<{ file: string; args: string[]; env: Record<string, string> }> = [];
    const ok = await restoreBackupFile({
      dumpPath: '/tmp/x.dump', targetDatabaseUrl: DB_URL, prisma: prisma as never,
      snapshotStartedAt: new Date(), loadTombstones: async () => [], deleteProviderData: async () => undefined, deleteAccount: async () => undefined,
      exec: async (file, args, options) => { calls.push({ file, args, env: options.env }); },
    });
    expect(calls[0].file).toBe('pg_restore');
    expect(calls[0].args).toContain('--dbname=panzeri');
    expect(JSON.stringify(calls[0].args)).not.toContain(DB_PASSWORD);
    expect(calls[0].env.PGPASSWORD).toBe(DB_PASSWORD);
    expect(ok.safeguard.polarDisconnected).toBe(1);
    expect(ok.complete).toBe(true);

    const prisma2 = fakePrisma([{ userId: 'a', disconnectedAt: null, accessTokenEncrypted: 'v1:x' }], [{ userId: 'a' }]);
    await expect(restoreBackupFile({
      dumpPath: '/tmp/x.dump', targetDatabaseUrl: DB_URL, prisma: prisma2 as never,
      snapshotStartedAt: new Date(), loadTombstones: async () => [], deleteProviderData: async () => undefined, deleteAccount: async () => undefined,
      exec: async () => { throw new Error(`falhou em ${DB_URL} com ${DB_PASSWORD}`); },
    })).rejects.toThrow('a etapa pos-restauracao foi executada');
    expect(prisma2.polar[0].disconnectedAt).not.toBeNull();
    expect(prisma2.strava).toHaveLength(0);
  });

  it('nao existe caminho para restaurar sem a etapa pos-restauracao: a CLI so expoe restore (com safeguard) e post-restore, exige --yes e recusa o banco de producao', () => {
    const cli = codeOf('../src/backup/cli.ts');
    expect(cli).toContain('restoreBackupFile(');
    expect(cli).not.toMatch(/pg_restore/); // pg_restore so' existe dentro de restoreBackupFile
    expect(cli).toContain("flag('yes')");
    expect(cli).toContain('TARGET_DATABASE_URL e igual a DATABASE_URL');
    const restore = readFileSync(join(__dirname, '../src/backup/backup-restore.ts'), 'utf8');
    expect(restore.indexOf('pg_restore')).toBeLessThan(restore.indexOf('postRestoreSafeguard(opts.prisma)'));
  });
});
