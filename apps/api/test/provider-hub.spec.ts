import { readFileSync } from 'fs';
import { join } from 'path';
import { ConnectorRegistry, LEGACY_PROVIDER_IDS } from '../src/provider-hub/connector-registry';
import { capabilitiesOf, ProviderConnector } from '../src/provider-hub/provider-connector';
import { backoffMs, LOCK_LEASE_MS, MAX_ATTEMPTS, ProviderInboundEventService } from '../src/provider-hub/provider-inbound-event.service';
import { ProviderHubWorkerService } from '../src/provider-hub/provider-hub-worker.service';
import { ProviderConsentService } from '../src/provider-hub/provider-consent.service';
import { ACCOUNT_DELETE_ORDER } from '../src/account-deletion/account-deletion.service';
import { BACKUP_EXCLUDED_TABLE_DATA } from '../src/backup/backup.service';

const TEST_CONSENT = { version: '1', dateLabel: 'x', title: 't', intro: 'i', sections: [], groups: [{ id: 'g', label: 'g', description: 'd', required: true, categories: ['activity'] as const }], purposes: ['history'], acknowledgementText: 'a', confirmButtonLabel: 'c' };

// ── Banco em memoria: reproduz so' o que a fila usa (where com OR/in/lte/lt, updateMany atomico, create com unicidade) ──
type Row = Record<string, any>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as any[]).includes(value);
      if ('lte' in cond) return value != null && value <= cond.lte;
      if ('lt' in cond) return value != null && value < cond.lt;
      return false;
    }
    return value === cond;
  });
}
function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment;
    else row[k] = v;
  }
}
function makePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const table = {
    rows,
    async create({ data }: { data: Row }) {
      if (rows.some((r) => r.provider === data.provider && r.dedupeKey === data.dedupeKey)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      const now = T0; // relogio do teste: a fila nasce elegivel em T0
      const row = { id: `e${++seq}`, status: 'pending', attempts: 0, nextAttemptAt: now, lockedUntil: null, lastError: null, processedAt: null, receivedAt: now, createdAt: now, updatedAt: now, ...data };
      rows.push(row);
      return { id: row.id };
    },
    async findMany({ where, take }: { where: Row; take?: number }) {
      return rows.filter((r) => matches(r, where)).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt).slice(0, take).map((r) => ({ ...r }));
    },
    async findUnique({ where }: { where: Row }) {
      const r = rows.find((x) => x.id === where.id);
      return r ? { ...r } : null;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => { applyData(r, data); r.updatedAt = T0; });
      return { count: hit.length };
    },
    async deleteMany({ where }: { where: Row }) {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { count: hit.length };
    },
  };
  const connections: Row[] = [];
  const providerConnection = {
    async findUnique({ where }: { where: Row }) {
      const w = where.provider_userId ?? where.provider_externalAccountId;
      const c = connections.find((x) => Object.entries(w).every(([k, v]) => x[k] === v));
      return c ? { ...c } : null;
    },
  };
  return { providerInboundEvent: table, providerConnection, connections } as any;
}

const draft = (key: string, extra: Partial<{ eventType: string; payload: Record<string, unknown> }> = {}) => ({ dedupeKey: key, eventType: extra.eventType ?? 'activity', category: 'activity' as const, payload: extra.payload ?? { id: key } });
function setup(connector?: Partial<ProviderConnector>) {
  const prisma = makePrisma();
  const registry = new ConnectorRegistry();
  if (connector) registry.register({ id: 'novo', displayName: 'Novo', ...connector } as ProviderConnector);
  return { prisma, registry, service: new ProviderInboundEventService(prisma, registry) };
}
const T0 = new Date('2026-10-19T12:00:00Z');

describe('ConnectorRegistry (capacidades opcionais)', () => {
  it('aceita conector minimo, sem nenhuma capacidade, e informa quais capacidades ele tem', () => {
    const registry = new ConnectorRegistry();
    const bare: ProviderConnector = { id: 'novo', displayName: 'Novo' };
    registry.register(bare);
    expect(capabilitiesOf(bare)).toEqual([]);
    expect(registry.get('novo')).toBe(bare);
  });

  it('conector so com OAuth e conector so com sync coexistem; withCapability filtra', () => {
    const registry = new ConnectorRegistry();
    const oauthOnly: ProviderConnector = { id: 'a_oauth', displayName: 'A', categories: ['activity'], consent: TEST_CONSENT, oauth: { isEnabledFor: () => true, encryptionKey: () => Buffer.alloc(32), buildAuthorizationUrl: () => 'x', exchangeCode: async () => ({ accessToken: 'a', refreshToken: null, expiresInSec: null, externalAccountId: 'e' }), refreshTokens: async () => ({ accessToken: 'a', refreshToken: null, expiresInSec: null }) } };
    const syncOnly: ProviderConnector = { id: 'b_sync', displayName: 'B', sync: { sync: async () => ({ status: 'ok' }) } };
    registry.register(oauthOnly);
    registry.register(syncOnly);
    expect(registry.withCapability('oauth')).toEqual([oauthOnly]);
    expect(registry.withCapability('sync')).toEqual([syncOnly]);
    expect(registry.withCapability('webhook')).toEqual([]);
  });

  it('recusa os provedores que ja tem fluxo proprio (Polar, Wahoo, Strava, Apple Health, Health Connect)', () => {
    expect([...LEGACY_PROVIDER_IDS].sort()).toEqual(['apple_health', 'health_connect', 'polar', 'strava', 'wahoo']);
    for (const id of LEGACY_PROVIDER_IDS) expect(() => new ConnectorRegistry().register({ id, displayName: id })).toThrow(/fluxo proprio/);
  });

  it('recusa id invalido, id repetido e webhook sem capacidade de processar eventos', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.register({ id: 'Zepp!', displayName: 'x' })).toThrow(/invalido/);
    expect(() => registry.register({ id: '', displayName: 'x' })).toThrow(/invalido/);
    registry.register({ id: 'zepp', displayName: 'Zepp' });
    expect(() => registry.register({ id: 'zepp', displayName: 'Zepp' })).toThrow(/ja' registrado/);
    const webhook = { verify: () => ({ ok: true as const }), extract: () => [] };
    expect(() => registry.register({ id: 'sem_events', displayName: 'x', webhook })).toThrow(/events/);
    expect(() => registry.register({ id: 'com_events', displayName: 'x', webhook, events: { handle: async () => ({ status: 'done' }) } })).not.toThrow();
  });
});

describe('ProviderInboundEventService — entrada idempotente', () => {
  it('o mesmo evento reenviado nao vira dois trabalhos; eventos diferentes ou de outro provedor sim', async () => {
    const { service, prisma } = setup();
    expect((await service.record('novo', draft('k1'))).created).toBe(true);
    expect((await service.record('novo', draft('k1'))).created).toBe(false);
    expect((await service.record('novo', draft('k2'))).created).toBe(true);
    expect((await service.record('outro', draft('k1'))).created).toBe(true);
    expect(prisma.providerInboundEvent.rows).toHaveLength(3);
  });

  it('rejeita evento sem chave/tipo/provedor e chave gigante; erro que nao e de duplicidade propaga', async () => {
    const { service } = setup();
    await expect(service.record('novo', draft(''))).rejects.toThrow(/obrigatorios/);
    await expect(service.record('', draft('k'))).rejects.toThrow(/obrigatorios/);
    await expect(service.record('novo', draft('x'.repeat(201)))).rejects.toThrow(/longa/);
    const broken = { providerInboundEvent: { create: async () => { throw new Error('banco fora do ar'); } } } as any;
    await expect(new ProviderInboundEventService(broken, new ConnectorRegistry()).record('novo', draft('k'))).rejects.toThrow('banco fora do ar');
  });
});

describe('ProviderInboundEventService — processamento', () => {
  it('conclui o evento, entrega os dados ao conector e ZERA o payload guardado', async () => {
    const handle = jest.fn(async () => ({ status: 'done' as const }));
    const { service, prisma } = setup({ events: { handle } });
    await service.record('novo', draft('k1', { payload: { secreto: 'gps' } }), 'user-1');
    const summary = await service.processDue(20, T0);
    expect(summary).toEqual({ claimed: 1, done: 1, discarded: 0, retried: 0, dead: 0 });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ provider: 'novo', userId: 'user-1', attempt: 1, payload: { secreto: 'gps' } }));
    const row = prisma.providerInboundEvent.rows[0];
    expect(row).toMatchObject({ status: 'done', payload: {}, lockedUntil: null });
  });

  it('descarte declarado pelo conector (ex.: conexao revogada) nao tenta de novo e zera o payload', async () => {
    const { service, prisma } = setup({ events: { handle: async () => ({ status: 'discard', reason: 'conexao revogada' }) } });
    await service.record('novo', draft('k1'));
    expect((await service.processDue(20, T0)).discarded).toBe(1);
    expect(prisma.providerInboundEvent.rows[0]).toMatchObject({ status: 'discarded', lastError: 'conexao revogada', payload: {} });
    expect((await service.processDue(20, new Date(T0.getTime() + 86_400_000))).claimed).toBe(0);
  });

  it('excecao e retry viram nova tentativa com espera crescente, sem processar antes da hora', async () => {
    const handle = jest.fn(async () => { throw new Error('download expirou'); });
    const { service, prisma } = setup({ events: { handle } });
    await service.record('novo', draft('k1'));
    expect((await service.processDue(20, T0)).retried).toBe(1);
    const row = prisma.providerInboundEvent.rows[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 1, lastError: 'download expirou', lockedUntil: null });
    expect(row.nextAttemptAt.getTime()).toBe(T0.getTime() + backoffMs(1));
    expect((await service.processDue(20, new Date(T0.getTime() + backoffMs(1) - 1))).claimed).toBe(0);
    expect((await service.processDue(20, new Date(T0.getTime() + backoffMs(1)))).claimed).toBe(1);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(backoffMs(2)).toBe(backoffMs(1) * 2);
    expect(backoffMs(50)).toBeLessThanOrEqual(6 * 3_600_000);
  });

  it('ao esgotar as tentativas o evento vai para "dead" (nunca some em silencio) e deixa de ser tentado', async () => {
    const handle = jest.fn(async () => ({ status: 'retry' as const, reason: 'sempre falha' }));
    const { service, prisma } = setup({ events: { handle } });
    await service.record('novo', draft('k1'));
    let now = T0;
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await service.processDue(20, now);
      now = new Date(now.getTime() + 7 * 3_600_000);
    }
    expect(handle).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(prisma.providerInboundEvent.rows[0]).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS, lastError: 'sempre falha' });
  });

  it('provedor sem conector registrado: o evento fica guardado e e tentado depois (nada e perdido)', async () => {
    const { service, prisma } = setup();
    await service.record('novo', draft('k1'));
    expect((await service.processDue(20, T0)).retried).toBe(1);
    expect(prisma.providerInboundEvent.rows[0]).toMatchObject({ status: 'failed', payload: { id: 'k1' } });
  });

  it('trava expirada (processador que caiu) devolve o evento a fila; trava valida protege', async () => {
    const handle = jest.fn(async () => ({ status: 'done' as const }));
    const { service, prisma } = setup({ events: { handle } });
    await service.record('novo', draft('k1'));
    const row = prisma.providerInboundEvent.rows[0];
    Object.assign(row, { status: 'processing', attempts: 1, lockedUntil: new Date(T0.getTime() + LOCK_LEASE_MS) });
    expect((await service.processDue(20, T0)).claimed).toBe(0);
    expect((await service.processDue(20, new Date(T0.getTime() + LOCK_LEASE_MS + 1))).done).toBe(1);
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2 }));
  });

  it('dois processadores simultaneos nao executam o mesmo evento duas vezes', async () => {
    const handle = jest.fn(async () => ({ status: 'done' as const }));
    const { service } = setup({ events: { handle } });
    for (let i = 0; i < 5; i++) await service.record('novo', draft(`k${i}`));
    await Promise.all([service.processDue(20, T0), service.processDue(20, T0), service.processDue(20, T0)]);
    expect(handle).toHaveBeenCalledTimes(5);
  });

  it('cerca: processador lento cuja trava foi retomada por outro NAO sobrescreve o desfecho', async () => {
    let release!: () => void;
    const slowHandle = jest.fn(() => new Promise<{ status: 'done' }>((resolve) => { release = () => resolve({ status: 'done' }); }));
    const { service, prisma } = setup({ events: { handle: slowHandle } });
    await service.record('novo', draft('k1'));
    const first = service.processDue(20, T0);
    await new Promise((r) => setImmediate(r));
    // outra execucao assume (trava expirou): simulado como nova tentativa em andamento
    Object.assign(prisma.providerInboundEvent.rows[0], { attempts: 2, lastError: 'assumido por outro' });
    release();
    await first;
    expect(prisma.providerInboundEvent.rows[0]).toMatchObject({ status: 'processing', attempts: 2, lastError: 'assumido por outro' });
  });

  it('um evento com erro nao impede os demais do mesmo lote', async () => {
    const handle = jest.fn(async (e: { payload: any }) => { if (e.payload.id === 'k1') throw new Error('x'); return { status: 'done' as const }; });
    const { service } = setup({ events: { handle } });
    await service.record('novo', draft('k1'));
    await service.record('novo', draft('k2'));
    expect(await service.processDue(20, T0)).toMatchObject({ claimed: 2, done: 1, retried: 1 });
  });
});

describe('ProviderInboundEventService — revogacao e retencao', () => {
  it('discardPendingForUser zera e descarta so os eventos pendentes daquele usuario naquele provedor', async () => {
    const { service, prisma } = setup();
    await service.record('novo', draft('a'), 'u1');
    await service.record('novo', draft('b'), 'u1');
    await service.record('novo', draft('c'), 'u2');
    await service.record('outro', draft('d'), 'u1');
    expect(await service.discardPendingForUser('novo', 'u1')).toBe(2);
    const byKey = Object.fromEntries(prisma.providerInboundEvent.rows.map((r: Row) => [r.dedupeKey, r]));
    expect(byKey.a).toMatchObject({ status: 'discarded', payload: {} });
    expect(byKey.c.status).toBe('pending');
    expect(byKey.d.status).toBe('pending');
  });

  it('purgeFinished apaga concluidos antigos e mortos muito antigos; preserva recentes e pendentes', async () => {
    const { service, prisma } = setup();
    const old = new Date(T0.getTime() - 40 * 86_400_000);
    const mid = new Date(T0.getTime() - 10 * 86_400_000);
    const rows = prisma.providerInboundEvent.rows;
    const mk = async (k: string, status: string, updatedAt: Date) => { await service.record('novo', draft(k)); const r = rows[rows.length - 1]; r.status = status; r.updatedAt = updatedAt; };
    await mk('done-old', 'done', mid);
    await mk('done-new', 'done', T0);
    await mk('dead-mid', 'dead', mid);
    await mk('dead-old', 'dead', old);
    await mk('pending-old', 'pending', old);
    expect(await service.purgeFinished(T0)).toBe(2);
    expect(rows.map((r: Row) => r.dedupeKey).sort()).toEqual(['dead-mid', 'done-new', 'pending-old']);
  });
});

describe('rotina de processamento e isolamento dos provedores existentes', () => {
  it('a rotina vem DESLIGADA por padrao e nao toca a fila', async () => {
    const service = { processDue: jest.fn(), purgeFinished: jest.fn() } as any;
    const worker = new ProviderHubWorkerService(service);
    delete process.env.PROVIDER_HUB_WORKER_ENABLED;
    await worker.run(T0);
    expect(service.processDue).not.toHaveBeenCalled();
    process.env.PROVIDER_HUB_WORKER_ENABLED = 'true';
    service.processDue.mockResolvedValue({ claimed: 0 });
    service.purgeFinished.mockResolvedValue(0);
    await worker.run(T0);
    expect(service.processDue).toHaveBeenCalledTimes(1);
    delete process.env.PROVIDER_HUB_WORKER_ENABLED;
  });

  it('Polar, Wahoo, Strava e o pipeline de atividades NAO dependem da Central (nenhum import)', () => {
    for (const dir of ['polar', 'wahoo', 'strava', 'activity-execution', 'apple-health', 'health-connect', 'integrations']) {
      const base = join(__dirname, '..', 'src', dir);
      for (const file of require('fs').readdirSync(base).filter((f: string) => f.endsWith('.ts'))) {
        expect(readFileSync(join(base, file), 'utf8')).not.toMatch(/provider-hub|ProviderInboundEvent/);
      }
    }
  });

  it('exclusao de conta e backup cobrem a nova tabela', () => {
    expect(ACCOUNT_DELETE_ORDER).toContain('providerInboundEvent');
    expect(BACKUP_EXCLUDED_TABLE_DATA).toContain('ProviderInboundEvent');
  });
});

describe('registro exige consentimento coerente', () => {
  const oauth = { isEnabledFor: () => true, encryptionKey: () => Buffer.alloc(32), buildAuthorizationUrl: () => 'x', exchangeCode: async () => ({ accessToken: 'a', refreshToken: null, expiresInSec: null, externalAccountId: 'e' }), refreshTokens: async () => ({ accessToken: 'a', refreshToken: null, expiresInSec: null }) };
  it('OAuth sem documento de consentimento nao registra (nada de consentimento presumido)', () => {
    expect(() => new ConnectorRegistry().register({ id: 'sem_texto', displayName: 'x', categories: ['activity'], oauth })).toThrow(/sem documento de consentimento/);
  });
  it('grupo com categoria que o conector nao declara, grupos repetidos ou dependencia inexistente nao registram', () => {
    const base = { id: 'novo2', displayName: 'x', oauth };
    expect(() => new ConnectorRegistry().register({ ...base, categories: ['sleep'], consent: TEST_CONSENT })).toThrow(/nao declara/);
    expect(() => new ConnectorRegistry().register({ ...base, categories: ['activity'], consent: { ...TEST_CONSENT, groups: [TEST_CONSENT.groups[0], TEST_CONSENT.groups[0]] } })).toThrow(/repetidos/);
    expect(() => new ConnectorRegistry().register({ ...base, categories: ['activity'], consent: { ...TEST_CONSENT, groups: [{ ...TEST_CONSENT.groups[0], requires: ['nao_existe'] }] } })).toThrow(/inexistente/);
  });
});

describe('fila: eventos so chegam ao conector com a categoria AUTORIZADA', () => {
  function setupConsent() {
    const prisma = makePrisma();
    const registry = new ConnectorRegistry();
    const handle = jest.fn(async () => ({ status: 'done' as const }));
    registry.register({ id: 'novo', displayName: 'Novo', categories: ['activity', 'sleep'], consent: { ...TEST_CONSENT, groups: [{ ...TEST_CONSENT.groups[0], categories: ['activity'] }] }, events: { handle } });
    const service = new ProviderInboundEventService(prisma, registry, new ProviderConsentService(prisma));
    const connect = (over: Row = {}) => prisma.connections.push({ provider: 'novo', userId: 'u1', externalAccountId: 'ext-1', disconnectedAt: null, grantedCategories: ['activity'], grantedPurposes: ['history'], ...over });
    return { prisma, service, handle, connect };
  }
  const ev = (category: any, extra: Row = {}) => ({ dedupeKey: 'k' + Math.random(), eventType: 'x', category, externalAccountId: 'ext-1', payload: { gps: 'secreto' }, ...extra });

  it('categoria autorizada: o usuario e resolvido pela conta externa e o conector recebe o evento', async () => {
    const s = setupConsent(); s.connect();
    await s.service.record('novo', ev('activity'));
    expect((await s.service.processDue(20, T0)).done).toBe(1);
    expect(s.handle).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', externalAccountId: 'ext-1' }));
  });

  it('categoria NAO autorizada (ex.: sono quando so atividades foram marcadas): descartada, payload zerado, conector nunca chamado', async () => {
    const s = setupConsent(); s.connect();
    await s.service.record('novo', ev('sleep'));
    expect((await s.service.processDue(20, T0)).discarded).toBe(1);
    expect(s.handle).not.toHaveBeenCalled();
    expect(s.prisma.providerInboundEvent.rows[0]).toMatchObject({ status: 'discarded', lastError: 'categoria nao autorizada pelo aluno', payload: {} });
  });

  it('conta desconectada, desconhecida ou usuario sem conexao: descartado (consentimento revogado vale na hora)', async () => {
    const a = setupConsent(); a.connect({ disconnectedAt: new Date() });
    await a.service.record('novo', ev('activity'));
    expect((await a.service.processDue(20, T0)).discarded).toBe(1);
    const b = setupConsent();
    await b.service.record('novo', ev('activity', { externalAccountId: 'desconhecida' }));
    expect((await b.service.processDue(20, T0)).discarded).toBe(1);
    expect(a.handle).not.toHaveBeenCalled();
    expect(b.handle).not.toHaveBeenCalled();
  });

  it('evento sem categoria e rejeitado na entrada; categoria vazia no banco e descartada no processamento', async () => {
    const s = setupConsent(); s.connect();
    await expect(s.service.record('novo', ev(undefined))).rejects.toThrow(/category/);
    s.prisma.providerInboundEvent.rows.push({ id: 'x', provider: 'novo', dedupeKey: 'z', eventType: 'x', category: null, userId: 'u1', externalAccountId: null, payload: { a: 1 }, status: 'pending', attempts: 0, nextAttemptAt: T0, lockedUntil: null, updatedAt: T0 });
    expect((await s.service.processDue(20, T0)).discarded).toBe(1);
    expect(s.handle).not.toHaveBeenCalled();
  });
});
