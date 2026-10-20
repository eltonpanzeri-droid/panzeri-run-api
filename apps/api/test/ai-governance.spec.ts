import { ConfigService } from '@nestjs/config';
import { AI_PURPOSE_BY_DESTINATION, AiDataEligibility, EXTERNAL_AI_APPROVED_PROVIDERS } from '../src/ai-governance/ai-data-eligibility.service';
import { AiEgressBlockedError, AiEgressGuard, MAX_SCOPE_AGE_MS } from '../src/ai-governance/ai-egress.guard';
import { aiActivityWhere, aiBlockedProviders, currentAiScope, isProviderBlockedForAi, runWithAiScope } from '../src/ai-governance/ai-scope';
import { AiQueueService } from '../src/common/ai-queue.service';
import { ConnectorRegistry, LEGACY_PROVIDER_IDS } from '../src/provider-hub/connector-registry';

// ── Fakes ──
type Row = Record<string, any>;
function makePrisma() {
  const connections: Row[] = [];
  const logs: Row[] = [];
  const events: Row[] = [];
  return {
    connections, logs, events,
    providerConnection: {
      findUnique: async ({ where }: Row) => {
        const w = where.provider_userId;
        const c = connections.find((x) => x.provider === w.provider && x.userId === w.userId);
        return c ? { ...c } : null;
      },
    },
    activityLog: { findMany: async ({ where }: Row) => [...new Set(logs.filter((l) => l.userId === where.userId).map((l) => l.provider))].map((provider) => ({ provider })) },
    providerConnectionEvent: { create: async ({ data }: Row) => { events.push(data); } },
  } as any;
}
const CONSENT = {
  version: '1', dateLabel: 'x', title: 't', intro: 'i', sections: [],
  groups: [{ id: 'activity', label: 'a', description: 'd', required: true, categories: ['activity'] as const }],
  purposes: ['history'], optionalPurposes: [{ id: 'ai_external', label: 'x', description: 'd', external: true, changeableAfterConnect: true }],
  acknowledgementText: 'a', confirmButtonLabel: 'c',
};
function setup(env: Record<string, string> = {}) {
  const prisma = makePrisma();
  const registry = new ConnectorRegistry();
  registry.register({ id: 'novo', displayName: 'Novo', categories: ['activity', 'activity_route'], consent: CONSENT });
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const eligibility = new AiDataEligibility(prisma, registry, config);
  const guard = new AiEgressGuard(prisma, eligibility);
  const connect = (over: Row = {}) => prisma.connections.push({ provider: 'novo', userId: 'u1', disconnectedAt: null, grantedCategories: ['activity'], grantedPurposes: ['history', 'ai_external'], ...over });
  // Simula um provedor REGULARIZADO (constante no codigo + variavel de ambiente): so' testes fazem isto; em producao a lista fica vazia.
  const approved = EXTERNAL_AI_APPROVED_PROVIDERS as string[];
  const unlock = () => { if (!approved.includes('novo')) approved.push('novo'); };
  const lock = () => { const i = approved.indexOf('novo'); if (i >= 0) approved.splice(i, 1); };
  return { prisma, registry, eligibility, guard, connect, unlock, lock };
}

afterEach(() => { const approved = EXTERNAL_AI_APPROVED_PROVIDERS as string[]; const i = approved.indexOf('novo'); if (i >= 0) approved.splice(i, 1); });

describe('trava de envio externo (tripwire)', () => {
  it('a lista de provedores liberados para IA externa esta VAZIA no codigo — liberar e uma decisao revisada, nao um efeito colateral', () => {
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).toEqual([]);
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).not.toContain('zepp');
  });
});

describe('AiDataEligibility.decide', () => {
  const external = { category: 'activity', destination: 'external_ai' as const };

  it('provedores legados: comportamento atual preservado (elegiveis)', async () => {
    const { eligibility } = setup();
    for (const provider of LEGACY_PROVIDER_IDS) expect(await eligibility.decide('u1', provider, external)).toEqual({ allowed: true, reason: 'legacy_provider_unchanged' });
  });

  it('provedor desconhecido (nem legado nem conector): bloqueado, fail-closed', async () => {
    const { eligibility } = setup();
    expect(await eligibility.decide('u1', 'garmin', external)).toEqual({ allowed: false, reason: 'unknown_provider' });
  });

  it('envio externo de provedor da Central: BLOQUEADO pela trava mesmo com conexao, categoria, finalidade E variavel de ambiente', async () => {
    const { eligibility, connect } = setup({ NOVO_EXTERNAL_AI_ENABLED: 'true' });
    connect();
    expect(await eligibility.decide('u1', 'novo', external)).toEqual({ allowed: false, reason: 'provider_locked' });
  });

  it('trava dupla: so a constante no codigo (sem a variavel) tambem NAO libera', async () => {
    const { eligibility, connect, unlock } = setup();
    connect(); unlock();
    expect(await eligibility.decide('u1', 'novo', external)).toEqual({ allowed: false, reason: 'provider_locked' });
  });

  it('com provedor regularizado (codigo + variavel): exige conexao ativa, categoria e finalidade separada, nessa ordem', async () => {
    const { eligibility, connect, unlock, prisma } = setup({ NOVO_EXTERNAL_AI_ENABLED: 'true' });
    unlock();
    expect((await eligibility.decide('u1', 'novo', external)).reason).toBe('not_connected');
    connect({ disconnectedAt: new Date() });
    expect((await eligibility.decide('u1', 'novo', external)).reason).toBe('not_connected');
    prisma.connections.length = 0;
    connect({ grantedCategories: ['profile'] });
    expect((await eligibility.decide('u1', 'novo', external)).reason).toBe('category_not_granted');
    prisma.connections.length = 0;
    connect({ grantedPurposes: ['history'] });
    expect((await eligibility.decide('u1', 'novo', external)).reason).toBe('purpose_not_granted');
    prisma.connections.length = 0;
    connect();
    expect(await eligibility.decide('u1', 'novo', external)).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('revogar a finalidade tem efeito imediato; outro usuario nunca herda; interno e externo sao finalidades distintas', async () => {
    const { eligibility, connect, unlock, prisma } = setup({ NOVO_EXTERNAL_AI_ENABLED: 'true' });
    unlock(); connect();
    expect((await eligibility.decide('u1', 'novo', external)).allowed).toBe(true);
    expect((await eligibility.decide('u2', 'novo', external)).allowed).toBe(false);
    expect((await eligibility.decide('u1', 'novo', { category: 'activity', destination: 'internal_ai' })).reason).toBe('purpose_not_granted');
    expect(AI_PURPOSE_BY_DESTINATION).toEqual({ internal_ai: 'ai_internal', external_ai: 'ai_external' });
    prisma.connections[0].grantedPurposes = ['history']; // revogacao
    expect((await eligibility.decide('u1', 'novo', external)).reason).toBe('purpose_not_granted');
  });
});

describe('AiDataEligibility.scopeFor', () => {
  it('provedor da Central sem autorizacao entra em "blocked"; legados nao; provedor desconhecido com historico no aluno entra (fail-closed)', async () => {
    const { eligibility, prisma } = setup();
    prisma.logs.push({ userId: 'u1', provider: 'polar' }, { userId: 'u1', provider: 'garmin' }, { userId: 'u2', provider: 'outro' });
    const scope = await eligibility.scopeFor('u1');
    expect(scope).toMatchObject({ userId: 'u1', destination: 'external_ai' });
    expect(scope.blocked).toEqual(['garmin', 'novo']);
    expect((await eligibility.scopeFor('u2')).blocked).toEqual(['novo', 'outro']);
  });

  it('sem nenhum provedor da Central e so com legados: nada bloqueado (nenhuma mudanca de comportamento)', async () => {
    const prisma = makePrisma();
    prisma.logs.push({ userId: 'u1', provider: 'polar' }, { userId: 'u1', provider: 'wahoo' }, { userId: 'u1', provider: 'apple_health' }, { userId: 'u1', provider: 'health_connect' });
    const eligibility = new AiDataEligibility(prisma, new ConnectorRegistry(), { get: () => undefined } as unknown as ConfigService);
    expect((await eligibility.scopeFor('u1')).blocked).toEqual([]);
  });
});

describe('escopo de IA (AsyncLocalStorage)', () => {
  const scope = (userId: string, blocked: string[]) => ({ userId, destination: 'external_ai' as const, blocked, computedAt: Date.now() });

  it('fora de escopo nada muda: nenhum bloqueio e filtro vazio', () => {
    expect(currentAiScope()).toBeUndefined();
    expect(aiBlockedProviders()).toEqual([]);
    expect(isProviderBlockedForAi('zepp')).toBe(false);
    expect(aiActivityWhere()).toEqual({});
  });

  it('dentro do escopo vale em chamadas assincronas encadeadas e em Promise.all; execucoes concorrentes nao se misturam', async () => {
    const inner = async () => { await Promise.resolve(); return [aiBlockedProviders(), aiActivityWhere()] as const; };
    const [a, b] = await Promise.all([
      runWithAiScope(scope('u1', ['zepp']), async () => (await Promise.all([inner(), inner()]))[1]),
      runWithAiScope(scope('u2', []), inner),
    ]);
    expect(a).toEqual([['zepp'], { provider: { notIn: ['zepp'] } }]);
    expect(b).toEqual([[], {}]);
    expect(currentAiScope()).toBeUndefined();
  });
});

describe('AiEgressGuard', () => {
  const inScope = <T>(s: Awaited<ReturnType<AiDataEligibility['scopeFor']>>, fn: () => Promise<T>) => runWithAiScope(s, fn);

  it('chamada com dado de dispositivo FORA de escopo falha fechada (sem usuario conhecido nao ha auditoria)', async () => {
    const { guard, prisma } = setup();
    await expect(guard.assertDeviceData('treinador_semana')).rejects.toMatchObject({ name: 'AiEgressBlockedError', reason: 'no_scope', agent: 'treinador_semana' });
    expect(prisma.events).toEqual([]);
  });

  it('escopo valido e inalterado: passa', async () => {
    const { guard, eligibility } = setup();
    const scope = await eligibility.scopeFor('u1');
    await expect(inScope(scope, () => guard.assertDeviceData('treinador_semana'))).resolves.toBeUndefined();
  });

  it('destino errado ou escopo velho: bloqueia e audita sem payload', async () => {
    const { guard, eligibility, prisma } = setup();
    const scope = await eligibility.scopeFor('u1');
    await expect(runWithAiScope({ ...scope, destination: 'internal_ai' }, () => guard.assertDeviceData('a'))).rejects.toMatchObject({ reason: 'wrong_destination' });
    await expect(runWithAiScope({ ...scope, computedAt: Date.now() - MAX_SCOPE_AGE_MS - 1 }, () => guard.assertDeviceData('a'))).rejects.toMatchObject({ reason: 'stale_scope' });
    expect(prisma.events.map((e: Row) => e.type)).toEqual(['ai_egress_blocked', 'ai_egress_blocked']);
    expect(JSON.stringify(prisma.events)).not.toMatch(/gps|payload|token/i);
  });

  it('consentimento revogado DEPOIS de montar o escopo (no meio da geracao): a chamada e abortada e auditada', async () => {
    const { guard, eligibility, connect, unlock, prisma } = setup({ NOVO_EXTERNAL_AI_ENABLED: 'true' });
    unlock(); connect();
    const scope = await eligibility.scopeFor('u1');
    expect(scope.blocked).toEqual([]);
    prisma.connections[0].grantedPurposes = ['history']; // aluno revoga a IA enquanto a geracao roda
    const err = await inScope(scope, () => guard.assertDeviceData('treinador_semana')).catch((e) => e);
    expect(err).toBeInstanceOf(AiEgressBlockedError);
    expect(err).toMatchObject({ reason: 'consent_changed', providers: ['novo'] });
    expect(prisma.events[0]).toMatchObject({ userId: 'u1', provider: 'ai_governance', type: 'ai_egress_blocked', details: { agent: 'treinador_semana', reason: 'consent_changed', providers: ['novo'] } });
  });
});

describe('AiQueueService: unico portao para fornecedores externos de IA', () => {
  it('dado de dispositivo sem escopo: a tarefa NEM COMECA (nada e enviado)', async () => {
    const { guard } = setup();
    const queue = new AiQueueService(guard);
    const task = jest.fn(async () => 'enviado');
    await expect(queue.run(task, { agent: 'x', deviceData: true })).rejects.toBeInstanceOf(AiEgressBlockedError);
    expect(task).not.toHaveBeenCalled();
  });

  it('dado de dispositivo dentro de escopo valido: executa; agente sem dado de dispositivo nao precisa de escopo', async () => {
    const { guard, eligibility } = setup();
    const queue = new AiQueueService(guard);
    const scope = await eligibility.scopeFor('u1');
    expect(await runWithAiScope(scope, () => queue.run(async () => 'ok', { agent: 'x', deviceData: true }))).toBe('ok');
    expect(await queue.run(async () => 'ok2', { agent: 'relator', deviceData: false })).toBe('ok2');
  });
});
