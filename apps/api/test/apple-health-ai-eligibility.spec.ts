import { ConfigService } from '@nestjs/config';
import { AiDataEligibility } from '../src/ai-governance/ai-data-eligibility.service';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { APPLE_HEALTH_CONSENT } from '../src/apple-health/apple-health-consent';
import { consentTextHash } from '../src/provider-hub/provider-consent.service';
import { aiActivityWhere, runWithAiScope } from '../src/ai-governance/ai-scope';

// Governanca de IA x consentimento Apple Health (28/10/2026): decisao de produto = usar o maximo de dado AUTORIZADO, SEM autorizacao especifica de IA. Dados SINTETICOS.

type Row = Record<string, any>;
function setup() {
  const connections: Row[] = [];
  const logs: Row[] = [];
  const events: Row[] = [];
  const prisma: any = {
    providerConnection: { findUnique: async ({ where }: Row) => { const w = where.provider_userId; const c = connections.find((x) => x.provider === w.provider && x.userId === w.userId); return c ? { ...c } : null; } },
    activityLog: { findMany: async ({ where }: Row) => [...new Set(logs.filter((l) => l.userId === where.userId).map((l) => l.provider))].map((provider) => ({ provider })) },
    providerConnectionEvent: { findFirst: async ({ where }: Row) => events.filter((e) => e.userId === where.userId && e.provider === where.provider && where.type.in.includes(e.type)).sort((a, b) => b.at - a.at)[0] ?? null },
  };
  const eligibility = new AiDataEligibility(prisma, new ConnectorRegistry(), { get: () => undefined } as unknown as ConfigService);
  const connect = (over: Row = {}) => connections.push({ provider: 'apple_health', userId: 'u1', disconnectedAt: null, grantedCategories: ['activity', 'activity_sensors'], grantedPurposes: [], consentVersion: APPLE_HEALTH_CONSENT.version, consentTextHash: consentTextHash(APPLE_HEALTH_CONSENT), ...over });
  return { eligibility, connections, logs, events, connect };
}
const internal = (category: string) => ({ category, destination: 'internal_ai' as const });
const external = (category: string) => ({ category, destination: 'external_ai' as const });

describe('Apple Health na governanca de IA', () => {
  it('compatibilidade: sem registro de consentimento (so usou o app antigo) segue elegivel como antes', async () => {
    const { eligibility } = setup();
    expect(await eligibility.decide('u1', 'apple_health', external('activity'))).toEqual({ allowed: true, reason: 'legacy_provider_unchanged' });
  });

  it('com consentimento ativo e texto vigente: cada categoria vale enquanto autorizada, para IA interna e externa, SEM finalidade especifica de IA nem trava de ambiente', async () => {
    const { eligibility, connect } = setup();
    connect({ grantedPurposes: ['history', 'tracking'] }); // nenhuma finalidade ai_*: nao e' exigida
    for (const destination of ['internal_ai', 'external_ai'] as const) {
      expect(await eligibility.decide('u1', 'apple_health', { category: 'activity', destination })).toEqual({ allowed: true, reason: 'allowed' });
      expect(await eligibility.decide('u1', 'apple_health', { category: 'activity_sensors', destination })).toEqual({ allowed: true, reason: 'allowed' });
    }
    // categoria nao autorizada (percurso) e categorias que o Apple Health nao tem
    expect(await eligibility.decide('u1', 'apple_health', external('activity_route'))).toEqual({ allowed: false, reason: 'category_not_granted' });
    expect(await eligibility.decide('u1', 'apple_health', external('sleep'))).toEqual({ allowed: false, reason: 'category_not_granted' });
  });

  it('revogado: nada do Apple Health e elegivel (o historico preservado nao volta ao contexto da IA); regravar a autorizacao libera de novo', async () => {
    const { eligibility, connections, connect } = setup();
    connect({ disconnectedAt: new Date(), grantedCategories: [] });
    for (const category of ['activity', 'activity_sensors']) expect(await eligibility.decide('u1', 'apple_health', external(category))).toEqual({ allowed: false, reason: 'not_connected' });
    connections.length = 0;
    connect();
    expect((await eligibility.decide('u1', 'apple_health', external('activity'))).allowed).toBe(true);
  });

  it('grupo de medidas retirado: a categoria de sensores deixa de valer e o treino basico continua; treinos retirados bloqueiam o provedor inteiro; texto desatualizado bloqueia ate reconfirmar', async () => {
    const { eligibility, connections, connect } = setup();
    connect({ grantedCategories: ['activity'] });
    expect((await eligibility.decide('u1', 'apple_health', external('activity'))).allowed).toBe(true);
    expect((await eligibility.decide('u1', 'apple_health', external('activity_sensors'))).allowed).toBe(false);
    connections[0].grantedCategories = [];
    expect((await eligibility.decide('u1', 'apple_health', external('activity'))).allowed).toBe(false);
    connections[0].grantedCategories = ['activity']; connections[0].consentVersion = '0.9';
    expect(await eligibility.decide('u1', 'apple_health', external('activity'))).toEqual({ allowed: false, reason: 'category_not_granted' });
  });

  it('registro perdido mas ultima decisao auditada foi a retirada: continua bloqueado (nunca volta a alimentar a IA sem a aluna saber)', async () => {
    const { eligibility, events } = setup();
    events.push({ userId: 'u1', provider: 'apple_health', type: 'connected', at: 1 }, { userId: 'u1', provider: 'apple_health', type: 'disconnected', at: 2 });
    expect(await eligibility.decide('u1', 'apple_health', external('activity'))).toEqual({ allowed: false, reason: 'not_connected' });
    events.push({ userId: 'u1', provider: 'apple_health', type: 'connected', at: 3 }); // concedeu de novo, registro ainda nao reconstruido: ultima decisao e' conceder
    expect((await eligibility.decide('u1', 'apple_health', external('activity'))).allowed).toBe(true);
  });

  it('escopo de IA: Apple Health revogado entra em "blocked" e as atividades dele saem do filtro das consultas; autorizado ou legado nao bloqueia; outros provedores nao mudam', async () => {
    const { eligibility, logs, connect, connections } = setup();
    logs.push({ userId: 'u1', provider: 'apple_health' }, { userId: 'u1', provider: 'polar' }, { userId: 'u1', provider: 'strava' });
    expect((await eligibility.scopeFor('u1')).blocked).toEqual(['health_connect']); // legado: nada muda (so' o Health Connect, que ja' exigia autorizacao)
    connect();
    expect((await eligibility.scopeFor('u1')).blocked).toEqual(['health_connect']); // autorizado: segue elegivel
    connections[0].disconnectedAt = new Date();
    const scope = await eligibility.scopeFor('u1');
    expect(scope.blocked).toEqual(['apple_health', 'health_connect']);
    await runWithAiScope(scope, async () => { expect(aiActivityWhere()).toEqual({ provider: { notIn: ['apple_health', 'health_connect'] } }); });
  });
});
