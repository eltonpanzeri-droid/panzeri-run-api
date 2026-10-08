import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { ACCOUNT_DELETE_ORDER, ACCOUNT_PRESERVED, AccountDeletionService } from '../src/account-deletion/account-deletion.service';
import { AuthService } from '../src/auth/auth.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { decryptBuffer, parseBackupKey } from '../src/backup/backup-crypto';
import { applyTombstones } from '../src/backup/backup-restore';
import { TombstoneLedger } from '../src/backup/tombstone-ledger';
import { CoachController } from '../src/coach/coach.controller';
import { RolesGuard } from '../src/common/roles.guard';

// Exclusao de conta (05/10/2026): anonimizacao irreversivel do User + exclusao dos dados pessoais/operacionais.
// Banco simulado em memoria com rollback transacional; R2 simulado. Nada de rede/Postgres reais.

type Row = Record<string, any>;
const clone = <T,>(value: T): T => structuredClone(value);

const PII = { name: 'Maria Silva Souza', email: 'maria.silva@exemplo.com', cpf: '123.456.789-09', phone: '31999998888', address: 'Rua das Flores 10' };
const A = 'a-user-1111';
const B = 'b-user-2222';

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    const value = row[key] ?? null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'in' in cond) return (cond.in as unknown[]).includes(value);
    return value === (cond ?? null);
  });
}

function seedDb() {
  const t: Record<string, Row[]> = {};
  const add = (name: string, ...rows: Row[]) => { (t[name] ??= []).push(...rows); };
  add('user',
    { id: A, role: 'student', email: PII.email, name: PII.name, cpf: PII.cpf, phone: PII.phone, address: PII.address, birthDate: new Date('1990-01-01'), sex: 'F', heightCm: 165, weightKg: 60, education: 'x', passwordHash: 'hash-original', studentCode: 42, accountStatus: 'active', subscriptionStatus: 'canceled', subscriptionManualOverride: false, subscriptionProvider: 'asaas', acceptedTermsAt: new Date('2026-01-01'), acceptedPrivacyAt: new Date('2026-01-01'), acceptedTermsVersion: '2026-10-05', acceptedPrivacyVersion: '2026-10-05', acceptedExerciseResponsibilityAt: new Date('2026-01-01'), cancelReason: 'preco', cancelFeedbackText: 'texto livre com meu nome', cancelWouldReturn: 'sim', refreshTokenHash: 'rt', expoPushToken: 'ExponentPushToken[abc]', acquisitionAttribution: { journeyId: 'J1', fbclid: 'x' } },
    { id: B, role: 'student', email: 'outra@exemplo.com', name: 'Outra Pessoa', accountStatus: 'active', subscriptionStatus: 'active' });
  for (const name of ['healthProfile', 'onboardingInterview', 'painReport', 'menstrualCycleLog', 'menstrualProfile', 'workoutCompletion', 'trainingPlan', 'weeklyCheckIn', 'nightlySleepLog', 'userPreferences', 'passwordResetToken', 'loginLinkToken', 'userNotification', 'messageLog', 'studentProfile', 'studentReportEntry', 'coachChatMessage', 'studentProfileEvent', 'studentObservation', 'coachReport', 'shoe', 'polarConnection', 'stravaConnection', 'stravaActivity', 'polarOAuthAttempt', 'wahooConnection', 'wahooOAuthAttempt', 'userAchievement', 'challengeProgress', 'reassessment', 'evolutionReport', 'fitnessTest', 'weeklyAvailability', 'targetRace', 'contextEvent', 'stressCheckin', 'studentDirective', 'trainingExecutionInsight', 'stravaAnalysisCache', 'trainingPlanGenerationLock', 'shoeUsage', 'sessionExecutionLink']) {
    add(name, { id: `${name}-A`, userId: A, secret: `dado-de-saude-${name}` }, { id: `${name}-B`, userId: B });
  }
  add('trainingSession', { id: 'ts-A', userId: A }, { id: 'ts-B', userId: B });
  add('workoutDelivery', { id: 'wd-A', trainingSessionId: 'ts-A' }, { id: 'wd-B', trainingSessionId: 'ts-B' });
  add('activityLog', { id: 'al-A', userId: A }, { id: 'al-B', userId: B });
  add('rawExternalActivity', { id: 'raw-A', userId: A, payload: { gps: 'secreto' } }, { id: 'raw-B', userId: B });
  add('rawActivitySample', { id: 'rs-A', activityLogId: 'al-A' }, { id: 'rs-B', activityLogId: 'al-B' });
  add('activityTimeSeriesPoint', { id: 'pt-A', activityLogId: 'al-A' }, { id: 'pt-B', activityLogId: 'al-B' });
  add('funnelEvent', { id: 'f1', userId: A, journeyId: 'J1' }, { id: 'f2', userId: null, journeyId: 'J1' }, { id: 'f3', userId: null, journeyId: 'OUTRA' });
  add('freeTesterEmail', { id: 'ft-A', email: PII.email }, { id: 'ft-B', email: 'outra@exemplo.com' });
  // B (preservados)
  add('billingEvent', { id: 'be1', userId: A, event: 'payment.confirmed', value: 24.9, externalRef: 'pay_1' });
  add('billingSubscription', { id: 'bs1', userId: A, provider: 'asaas', externalCustomerId: 'cus_1', externalSubscriptionId: 'sub_1', externalChargeId: 'chg_1', checkoutUrl: 'https://pagar/x', overdueInvoiceUrl: 'https://fatura/x', lastNotificationToken: 'tok', nextChargeAt: new Date('2026-11-01'), firstPaidAt: new Date('2026-09-01'), firstPaidPaymentId: 'pay_1', providerStatus: 'canceled' });
  add('couponRedemption', { id: 'cr1', userId: A, couponId: 'c1' });
  add('providerConnectionEvent', { id: 'pce1', userId: A, provider: 'polar', type: 'disconnected' });
  return t;
}

function makeDb(seed = seedDb()) {
  let tables = seed;
  let seq = 0;
  const failOn: { model?: string } = {};
  const rows = (name: string) => (tables[name] ??= []);
  const delegate = (name: string) => ({
    findMany: async ({ where }: { where?: Row } = {}) => rows(name).filter((r) => matches(r, where)).map((r) => ({ ...r })),
    findUnique: async ({ where }: { where: Row }) => { const r = rows(name).find((x) => matches(x, where)); return r ? { ...r } : null; },
    deleteMany: async ({ where }: { where?: Row }) => {
      if (failOn.model === name) throw new Error(`falha simulada em ${name}`);
      const before = rows(name).length; tables[name] = rows(name).filter((r) => !matches(r, where)); return { count: before - tables[name].length };
    },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => { const hit = rows(name).filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(name).find((x) => matches(x, where))!; return Object.assign(r, data); },
    create: async ({ data }: { data: Row }) => { const r = { id: `gen-${++seq}`, ...data }; rows(name).push(r); return r; },
  });
  const prisma: any = new Proxy({
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => { const snapshot = clone(tables); try { return await cb(prisma); } catch (error) { tables = snapshot; throw error; } },
  } as Record<string, unknown>, { get: (target, prop: string) => (prop in target ? target[prop] : delegate(prop)) });
  return { prisma, tables: () => tables, failOn, snapshot: () => clone(tables) };
}

class FakeR2 {
  store = new Map<string, Buffer>();
  putError: Error | null = null;
  async putObjectBuffer(key: string, body: Buffer) { if (this.putError) throw this.putError; this.store.set(key, body); }
  async headObject(key: string) { const b = this.store.get(key); return b ? { size: b.length, etag: createHash('md5').update(b).digest('hex'), metadata: {} } : null; }
}
class TestLedger extends TombstoneLedger {
  r2 = new FakeR2();
  telegram2 = { notifyCoach: jest.fn(async () => undefined) };
  constructor() {
    super({ get: (n: string) => ({ BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32), R2_ACCOUNT_ID: 'c', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'ak', R2_SECRET_ACCESS_KEY: 'sk' } as Record<string, string>)[n] } as never, { notifyCoach: async () => undefined } as never);
    (this as unknown as { telegram: unknown }).telegram = this.telegram2;
  }
  protected createR2() { return this.r2 as never; }
}

const ADMIN = { id: 'admin-1', role: 'admin' };
const CONFIRM = { confirmUserId: A, confirmText: 'EXCLUIR CONTA' };

describe('exclusao de conta — fluxo e ordem', () => {
  const logs: string[] = [];
  beforeEach(() => {
    logs.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  });
  afterEach(() => jest.restoreAllMocks());

  function build() {
    const db = makeDb();
    const ledger = new TestLedger();
    const order: string[] = [];
    const record = ledger.record.bind(ledger);
    jest.spyOn(ledger, 'record').mockImplementation(async (i) => { const k = await record(i); order.push('tombstone'); return k; });
    const tx = db.prisma.$transaction;
    db.prisma.$transaction = async (cb: (t: unknown) => Promise<unknown>) => { order.push('exclusao'); return tx(cb); };
    const polar = { disconnect: jest.fn(async () => { order.push('polar'); return { status: 'disconnected', providerRevocation: 'failed' }; }) };
    const wahoo = { disconnect: jest.fn(async () => { order.push('wahoo'); return { status: 'disconnected', providerRevocation: 'failed' }; }) };
    const service = new AccountDeletionService(db.prisma, ledger, polar as never, wahoo as never);
    return { db, ledger, order, polar, wahoo, service };
  }

  it('o tombstone externo precede a revogacao e qualquer exclusao; depois PII, saude, feedbacks, treino e providers somem', async () => {
    const { db, order, service, ledger } = build();
    const result = await service.deleteAccount(A, CONFIRM, ADMIN);
    expect(result.status).toBe('deleted');
    expect(order).toEqual(['tombstone', 'polar', 'wahoo', 'exclusao']);
    const t = db.tables();
    // dados pessoais, saude, feedbacks, prontuario, treino, providers, tokens: nenhuma linha do usuario A
    for (const model of ACCOUNT_DELETE_ORDER) {
      if (model === 'workoutDelivery' || model === 'rawActivitySample' || model === 'activityTimeSeriesPoint' || model === 'freeTesterEmail') continue;
      expect((t[model] ?? []).filter((r) => r.userId === A)).toEqual([]);
    }
    expect(t.workoutDelivery.map((r) => r.id)).toEqual(['wd-B']);
    expect(t.rawActivitySample.map((r) => r.id)).toEqual(['rs-B']);
    expect(t.activityTimeSeriesPoint.map((r) => r.id)).toEqual(['pt-B']);
    expect(t.funnelEvent.map((r) => r.id)).toEqual(['f3']); // inclui o evento pre-cadastro da mesma jornada
    expect(t.freeTesterEmail.map((r) => r.id)).toEqual(['ft-B']);
    // dados de OUTRO usuario intactos
    for (const model of ['healthProfile', 'painReport', 'workoutCompletion', 'polarConnection', 'stravaConnection', 'wahooConnection', 'wahooOAuthAttempt', 'messageLog']) {
      expect(t[model].filter((r) => r.userId === B)).toHaveLength(1);
    }
    expect(t.user.find((u) => u.id === B)!.name).toBe('Outra Pessoa');
    // tombstone cifrado, sem PII
    const [key] = [...ledger.r2.store.keys()];
    const plain = decryptBuffer(ledger.r2.store.get(key)!, parseBackupKey('ab'.repeat(32))).toString('utf8');
    expect(JSON.parse(plain)).toMatchObject({ v: 1, type: 'account_deleted', userId: A });
    expect(Object.keys(JSON.parse(plain)).sort()).toEqual(['at', 'type', 'userId', 'v']);
  });

  it('User anonimizado: PII e tokens removidos; e-mail tecnico aleatorio e irreversivel; conta marcada como excluida', async () => {
    const { db, service } = build();
    await service.deleteAccount(A, CONFIRM, ADMIN);
    const user = db.tables().user.find((u) => u.id === A)!;
    for (const field of ['cpf', 'phone', 'address', 'birthDate', 'sex', 'heightCm', 'weightKg', 'education', 'studentCode', 'refreshTokenHash', 'expoPushToken', 'acquisitionAttribution', 'cancelReason', 'cancelFeedbackText', 'cancelWouldReturn', 'acceptedTermsAt', 'acceptedPrivacyAt', 'acceptedTermsVersion', 'acceptedPrivacyVersion', 'acceptedExerciseResponsibilityAt']) {
      expect(user[field]).toBeNull();
    }
    expect(user.accountStatus).toBe('deleted');
    expect(user.name).toBe('Conta excluida');
    expect(user.email).toMatch(/^deleted-[0-9a-f]{32}@deleted\.invalid$/);
    expect(user.email).not.toContain('maria');
    expect(user.passwordHash).not.toBe('hash-original');
    expect(JSON.stringify(user)).not.toMatch(/Maria|maria\.silva|123\.456|31999998888|Flores|ExponentPushToken/);
  });

  it('registros financeiros preservados sem identidade direta (B): BillingEvent, assinatura (ids/datas), cupom e auditoria', async () => {
    const { db, service } = build();
    await service.deleteAccount(A, CONFIRM, ADMIN);
    const t = db.tables();
    expect(t.billingEvent).toEqual([expect.objectContaining({ id: 'be1', userId: A, value: 24.9, externalRef: 'pay_1' })]);
    expect(t.billingSubscription[0]).toMatchObject({ externalSubscriptionId: 'sub_1', externalChargeId: 'chg_1', firstPaidPaymentId: 'pay_1', providerStatus: 'canceled' });
    expect(t.billingSubscription[0]).toMatchObject({ externalCustomerId: null, checkoutUrl: null, overdueInvoiceUrl: null, lastNotificationToken: null, nextChargeAt: null });
    expect(t.couponRedemption).toHaveLength(1);
    expect(t.providerConnectionEvent.some((e) => e.type === 'account_deleted')).toBe(true);
    expect(t.providerConnectionEvent.some((e) => e.type === 'disconnected')).toBe(true);
    expect(JSON.stringify(t.providerConnectionEvent)).not.toMatch(/Maria|maria\.silva/);
  });

  it('R2 indisponivel: 503, a conta fica 100% intacta e nenhuma integracao e revogada', async () => {
    const { db, ledger, polar, service } = build();
    ledger.r2.putError = new Error('R2 fora');
    const before = db.snapshot();
    await expect(service.deleteAccount(A, CONFIRM, ADMIN)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.tables()).toEqual(before);
    expect(polar.disconnect).not.toHaveBeenCalled();
  });

  it('falha local apos o tombstone: transacao revertida, tombstone mantido, auditoria e alerta sem PII', async () => {
    const { db, ledger, service } = build();
    db.failOn.model = 'painReport';
    const before = db.snapshot();
    await expect(service.deleteAccount(A, CONFIRM, ADMIN)).rejects.toThrow('nao foi concluida');
    const after = db.tables();
    expect(after.user.find((u) => u.id === A)!.email).toBe(PII.email); // rollback: nada foi anonimizado
    expect(after.healthProfile.filter((r) => r.userId === A)).toHaveLength(before.healthProfile.filter((r) => r.userId === A).length);
    expect(ledger.r2.store.size).toBe(1); // tombstone mantido
    expect(after.providerConnectionEvent.some((e) => e.type === 'account_deletion_failed')).toBe(true);
    const exposed = JSON.stringify({ logs, alerts: ledger.telegram2.notifyCoach.mock.calls });
    expect(exposed).toContain('DEPOIS de gravar o tombstone');
    expect(exposed).not.toMatch(/Maria|maria\.silva|123\.456|31999998888|Flores/);
  });

  it('exige confirmacao explicita, aluno nao-ativo-financeiro, conta de aluno e e idempotente', async () => {
    const { db, ledger, service } = build();
    await expect(service.deleteAccount(A, { confirmUserId: A }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteAccount(A, { confirmUserId: 'outro', confirmText: 'EXCLUIR CONTA' }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(ledger.r2.store.size).toBe(0);
    await expect(service.deleteAccount(B, { confirmUserId: B, confirmText: 'EXCLUIR CONTA' }, ADMIN)).rejects.toBeInstanceOf(ConflictException); // assinatura ativa
    expect(ledger.r2.store.size).toBe(0);
    db.tables().user.find((u) => u.id === A)!.role = 'coach';
    await expect(service.deleteAccount(A, CONFIRM, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    db.tables().user.find((u) => u.id === A)!.role = 'student';
    await service.deleteAccount(A, CONFIRM, ADMIN);
    const emailAfterFirst = db.tables().user.find((u) => u.id === A)!.email;
    expect(await service.deleteAccount(A, CONFIRM, ADMIN)).toEqual({ status: 'already_deleted', deleted: {} });
    expect(db.tables().user.find((u) => u.id === A)!.email).toBe(emailAfterFirst);
  });
});

describe('conta excluida nao autentica e o e-mail pode ser reutilizado', () => {
  async function deletedState() {
    const db = makeDb();
    await new AccountDeletionService(db.prisma).executeAccountDeletion(A);
    return db;
  }

  it('login com o e-mail antigo falha; refresh e access token de conta excluida sao recusados', async () => {
    const db = await deletedState();
    const jwt = { signAsync: jest.fn(async () => 'j'), verifyAsync: jest.fn(async () => ({ sub: A, email: 'x', role: 'student' })) };
    const prisma = { user: { findUnique: async ({ where }: { where: Row }) => db.tables().user.find((u) => (where.email ? u.email === where.email : u.id === where.id)) ?? null, update: async () => ({}) } };
    const service = new AuthService(prisma as never, jwt as never, { get: () => undefined } as never, {} as never);
    await expect(service.login({ email: PII.email, password: 'qualquer' } as never)).rejects.toBeInstanceOf(UnauthorizedException);
    // mesmo conhecendo o e-mail tecnico, a senha invalida e o status 'deleted' impedem o login
    const technical = db.tables().user.find((u) => u.id === A)!.email;
    await expect(service.login({ email: technical, password: 'qualquer' } as never)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh('refresh-antigo')).rejects.toBeInstanceOf(UnauthorizedException);
    const strategy = new JwtStrategy({ get: () => 'segredo' } as never, prisma as never);
    await expect(strategy.validate({ sub: A, email: 'x', role: 'student' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ sub: B, email: 'y', role: 'student' })).resolves.toMatchObject({ sub: B });
    expect(bcrypt.compareSync('qualquer', db.tables().user.find((u) => u.id === A)!.passwordHash.slice(0, 60))).toBe(false);
  });

  it('o e-mail anterior pode ser usado em uma nova conta (nenhum unique impede)', async () => {
    const db = await deletedState();
    const created: Row[] = [];
    const prisma = {
      user: {
        findMany: async () => db.tables().user.map((u) => ({ email: u.email })),
        create: async ({ data }: { data: Row }) => { created.push(data); return { id: 'novo', email: data.email, name: data.name, role: 'student' }; },
        update: async () => ({}),
      },
    };
    const service = new AuthService(prisma as never, { signAsync: async () => 'j' } as never, { get: () => undefined } as never, { sendEvent: jest.fn() } as never);
    await service.register({ email: PII.email, password: 'senha-12345', name: 'Nova', acceptedTerms: true, acceptedExerciseResponsibility: true } as never);
    expect(created[0].email).toBe(PII.email);
    // e cpf/studentCode (unique) ficaram null, nao ocupam o indice
    const user = db.tables().user.find((u) => u.id === A)!;
    expect([user.cpf, user.studentCode]).toEqual([null, null]);
  });
});

describe('restauracao reaplica a exclusao de conta', () => {
  it('backup anterior + tombstone posterior: reaplica; idempotente; tombstone anterior ao snapshot nao e reaplicado; sem novo tombstone', async () => {
    const snapshot = new Date('2026-10-05T07:00:00Z');
    const db = makeDb(); // banco "restaurado": ainda com a conta A completa
    const accounts = new AccountDeletionService(db.prisma); // sem ledger/polar: so' local
    const record = jest.spyOn(TombstoneLedger.prototype, 'record');
    const run = () => applyTombstones({
      snapshotStartedAt: snapshot,
      load: async () => [
        { v: 1, type: 'account_deleted', userId: B, at: '2026-10-04T07:00:00.000Z' }, // anterior ao snapshot: nao reaplica
        { v: 1, type: 'account_deleted', userId: A, at: '2026-10-05T09:00:00.000Z' },
      ],
      deleteProviderData: async () => undefined,
      deleteAccount: (id) => accounts.executeAccountDeletion(id),
    });
    const first = await run();
    expect(first).toEqual({ status: 'applied', applied: 1, skippedBeforeSnapshot: 1, unsupported: 0 });
    const afterFirst = db.snapshot();
    expect(afterFirst.user.find((u: Row) => u.id === A)!.accountStatus).toBe('deleted');
    expect(afterFirst.user.find((u: Row) => u.id === B)!.accountStatus).toBe('active');
    expect(afterFirst.healthProfile.filter((r: Row) => r.userId === A)).toEqual([]);
    expect(await run()).toEqual(first);
    const afterSecond = db.snapshot();
    expect(afterSecond.user.find((u: Row) => u.id === A)!.email).toBe(afterFirst.user.find((u: Row) => u.id === A)!.email);
    expect(afterSecond.healthProfile).toEqual(afterFirst.healthProfile);
    expect(record).not.toHaveBeenCalled();
    record.mockRestore();
  });

  it('usuario que nem existe no snapshot nao falha a reaplicacao', async () => {
    const db = makeDb();
    expect(await new AccountDeletionService(db.prisma).executeAccountDeletion('inexistente')).toEqual({ status: 'user_not_found', deleted: {} });
  });
});

describe('autorizacao e cobertura do mapa A/B', () => {
  it('somente admin executa; coach e aluno recebem 403', () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = (role: string) => ({
      getHandler: () => CoachController.prototype.deleteStudentAccount, getClass: () => CoachController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', email: 'e', role } }) }),
    } as unknown as ExecutionContext);
    expect(guard.canActivate(ctx('admin'))).toBe(true);
    expect(() => guard.canActivate(ctx('coach'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('student'))).toThrow(ForbiddenException);
  });

  it('todo modelo do schema com userId ou relacao a User esta classificado (A ou B): modelo novo sem classificacao quebra este teste', () => {
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8').split(/\r?\n/);
    const owned: string[] = [];
    let model: string | null = null; let has = false;
    for (const line of schema) {
      const m = line.match(/^model (\w+)/);
      if (m) { model = m[1]; has = false; continue; }
      if (line.startsWith('}')) { if (model && model !== 'User' && has) owned.push(model); model = null; continue; }
      if (model && (/^\s+userId\s+String/.test(line) || /@relation\(fields: \[userId\]/.test(line))) has = true;
    }
    const lower = (n: string) => n[0].toLowerCase() + n.slice(1);
    const classified = new Set<string>([...ACCOUNT_DELETE_ORDER, ...ACCOUNT_PRESERVED]);
    expect(owned.filter((n) => !classified.has(lower(n)))).toEqual([]);
    // sem duplicidade entre A e B
    expect(ACCOUNT_DELETE_ORDER.filter((n) => (ACCOUNT_PRESERVED as readonly string[]).includes(n))).toEqual([]);
    expect(owned.length).toBeGreaterThanOrEqual(48);
  });

  it('nenhum codigo desta operacao chama Telegram com dados do usuario nem apaga BillingEvent', () => {
    const code = readFileSync(join(__dirname, '../src/account-deletion/account-deletion.service.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(code).not.toMatch(/billingEvent.*deleteMany|deleteMany.*billingEvent/);
    expect(ACCOUNT_DELETE_ORDER as readonly string[]).not.toContain('billingEvent');
    expect(code).not.toMatch(/alert\([^)]*(user\.name|user\.email|\.cpf)/);
  });
});
