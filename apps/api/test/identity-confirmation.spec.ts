import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PhysicalActivityIdentityService } from '../src/activity-execution/physical-activity-identity.service';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';
import { IdentityConfirmationService } from '../src/activity-execution/identity-confirmation.service';
import { EvolutionMetricService } from '../src/evolution/evolution-metric.service';
import { buildPendingSets, toPendingView } from '../src/activity-execution/physical-identity-pending';
import { applyHumanDecision, decisionForPair, decisionsOfEvidence } from '../src/activity-execution/physical-identity-decisions';

// Confirmacao de atividades fisicas AMBIGUAS (aluno/treinador). Mundo em memoria UNICO: identidade fisica REAL + reconciliacao REAL + servico de
// confirmacao REAL + volume da Evolucao, sobre o mesmo banco simulado (transacao serializada, como a trava por aluno em producao).
// Regra de produto sob teste: o sistema resolve sozinho (matched/unique) e NAO pergunta; so' o que ficou realmente ambiguo vira pendencia, e a
// confirmacao humana nunca altera sessoes prescritas nem dados objetivos do dispositivo.

const NOW = new Date('2026-10-08T12:00:00Z');
const FAKE_TIMER_KEEP = ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask'] as const;

type Row = Record<string, any>;

function matches(row: Row, where: Record<string, any> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Array<Record<string, any>>).some((clause) => matches(row, clause));
    const value = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const e = expected as Record<string, any>;
      if ('in' in e && !e.in.includes(value)) return false;
      if ('not' in e && (e.not === null ? value === null || value === undefined : value === e.not)) return false;
      if ('gte' in e && !(value >= e.gte)) return false;
      if ('lte' in e && !(value <= e.lte)) return false;
      if ('lt' in e && !(value < e.lt)) return false;
      return true;
    }
    if (expected instanceof Date) return value instanceof Date && value.getTime() === expected.getTime();
    return value === expected;
  });
}

function world() {
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;
  const logs = new Map<string, Row>();
  const sessions = new Map<string, Row>();
  const links = new Map<string, Row>();
  const copy = (r: Row | undefined | null) => (r ? { ...r } : null);
  const tables = {
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => copy(logs.get(where.id))),
      findFirst: jest.fn(async ({ where }: any) => copy([...logs.values()].find((r) => matches(r, where)))),
      findMany: jest.fn(async ({ where, take }: any) => [...logs.values()].filter((r) => matches(r, where)).slice(0, take ?? 100000).map((r) => ({ ...r }))),
      update: jest.fn(async ({ where, data }: any) => { const updated = { ...logs.get(where.id), ...data }; logs.set(where.id, updated); return { ...updated }; }),
    },
    trainingSession: {
      findUnique: jest.fn(async ({ where }: any) => copy(sessions.get(where.id))),
      findMany: jest.fn(async ({ where }: any) =>
        [...sessions.values()]
          .filter((s) => matches(s, where))
          .map((s) => ({ ...s, completion: s.completion ?? null, executionLinks: [...links.values()].filter((l) => l.trainingSessionId === s.id && l.status === 'active') })),
      ),
      update: jest.fn(async ({ where, data }: any) => { const updated = { ...sessions.get(where.id), ...data }; sessions.set(where.id, updated); return updated; }),
      create: jest.fn(async ({ data }: any) => { const row = { id: nextId('session'), ...data }; sessions.set(row.id, row); return row; }),
    },
    sessionExecutionLink: {
      findUnique: jest.fn(async ({ where }: any) => copy(links.get(where.id))),
      findMany: jest.fn(async ({ where }: any) =>
        [...links.values()]
          .filter((l) => {
            const idsIn = where.activityLogId?.in ?? (where.activityLogId !== undefined ? [where.activityLogId] : null);
            if (idsIn && !idsIn.includes(l.activityLogId)) return false;
            if (where.trainingSessionId !== undefined && l.trainingSessionId !== where.trainingSessionId) return false;
            if (where.status?.in !== undefined && !where.status.in.includes(l.status)) return false;
            if (typeof where.status === 'string' && l.status !== where.status) return false;
            return true;
          })
          .map((l) => ({ ...l }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
      create: jest.fn(async ({ data }: any) => { const row = { id: nextId('link'), createdAt: new Date(Date.now() + seq), revokedAt: null, supersededByLinkId: null, matchMethod: null, evidence: null, confidence: null, note: null, ...data }; links.set(row.id, row); return { ...row }; }),
      update: jest.fn(async ({ where, data }: any) => { const updated = { ...links.get(where.id), ...data }; links.set(where.id, updated); return { ...updated }; }),
      count: jest.fn(async ({ where }: any) => [...links.values()].filter((l) => l.activityLogId === where.activityLogId && l.status === where.status).length),
    },
    trainingPlan: { findFirst: jest.fn(async () => null) },
    workoutCompletion: { findUnique: jest.fn(async () => null), create: jest.fn(), update: jest.fn() },
    athletePrimarySource: { findFirst: jest.fn(async () => null) },
    workoutDelivery: { findFirst: jest.fn(async () => null) },
  };
  // tx NAO tem $transaction (como o cliente de transacao do Prisma): servicos internos rodam sem nova trava.
  const tx = { ...tables, $executeRaw: jest.fn(async () => 1) };
  let chain: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...tables,
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => {
      const run = chain.then(() => fn(tx));
      chain = run.then(() => undefined, () => undefined);
      return run;
    }),
  };
  const link = new SessionExecutionLinkService(prisma as never);
  const identity = new PhysicalActivityIdentityService(prisma as never);
  const confirmation = new IdentityConfirmationService(prisma as never, identity, link);
  const evolution = new EvolutionMetricService(prisma as never);

  // Atividade que chega (adaptador): grava, avalia a identidade, classifica a que chegou e reconcilia as OUTRAS afetadas.
  async function ingest(row: Row) {
    logs.set(row.id, { ...row });
    const result = await identity.evaluateSafely(row.id);
    await link.classify(row.id);
    await link.reconcileAffectedByIdentity(result, row.id);
  }
  const addSession = (overrides: Row = {}) => {
    const row = { id: nextId('s'), userId: 'u1', planId: 'plan', scheduledDate: new Date('2026-10-06T00:00:00Z'), modality: 'corrida', distanceKm: 10, durationMin: 55, origin: 'agent', structure: {}, plan: { status: 'active' }, title: 'Longao', weekday: 2, ...overrides };
    sessions.set(row.id, row);
    return row;
  };
  const get = (id: string) => logs.get(id)!;
  const counting = () => [...logs.values()].filter((r) => r.executionClassification === 'corresponding' || r.executionClassification === 'alternative');
  const activeLinks = () => [...links.values()].filter((l) => l.status === 'active');
  const writes = () => tables.activityLog.update.mock.calls.length + tables.sessionExecutionLink.create.mock.calls.length + tables.sessionExecutionLink.update.mock.calls.length;
  const km = async (userId = 'u1') => (await evolution.getSeries(userId)).weeks.reduce((sum, w) => sum + (w.kmPercorridos ?? 0), 0);
  return { logs, sessions, links, tables, prisma, link, identity, confirmation, ingest, addSession, get, counting, activeLinks, writes, km };
}

let nextRow = 0;
function polar(id: string, overrides: Row = {}): Row {
  const base = { id, userId: 'u1', provider: 'polar', externalId: `ext-${id}`, rawActivityId: `raw-${id}`, sport: 'corrida', startedAt: new Date('2026-10-06T10:00:00Z'), utcOffsetMinutes: -180, durationSec: 55 * 60, distanceMeters: 10000, providerMetrics: { endedAt: new Date('2026-10-06T10:55:00Z').toISOString() }, physicalEventId: null, physicalIdentityStatus: null, physicalIdentityEvidence: null, physicalCanonicalActivityLogId: null, physicalCanonicalReason: null, executionClassification: null, executionClassifiedAt: null, executionClassifiedBy: null, avgHeartRateBpm: 150, createdAt: new Date(++nextRow) };
  return { ...base, ...overrides };
}
function healthConnect(id: string, pkg: string, name: string, overrides: Row = {}): Row {
  const startedAt = overrides.startedAt ?? new Date('2026-10-06T10:02:00Z');
  const durationSec = overrides.durationSec ?? 58 * 60;
  return polar(id, {
    provider: 'health_connect', startedAt, durationSec, distanceMeters: 10350,
    providerMetrics: { channel: 'health_connect', source: { packageName: pkg, name }, device: null, recordingMethod: 'actively_recorded', endedAt: new Date(new Date(startedAt).getTime() + durationSec * 1000).toISOString() },
    avgHeartRateBpm: null, ...overrides,
  });
}
// O exemplo do pedido: Polar 10,00 km / 07:00 / 55 min x Health Connect 10,35 km / 07:02 / 58 min — realmente ambiguo (divergencia de distancia no mesmo horario).
const AMBIGUOUS_POLAR = () => polar('p');
const AMBIGUOUS_HC = () => healthConnect('h', 'fi.polar.polarflow', 'Polar Flow');
// Mesma execucao com folga de metricas: o sistema resolve sozinho (matched).
const SAME_HC = () => healthConnect('h', 'fi.polar.polarflow', 'Polar Flow', { startedAt: new Date('2026-10-06T10:00:20Z'), durationSec: 55 * 60 + 15, distanceMeters: 10010 });
const OTHER_RUN_HC = () => healthConnect('h', 'com.strava', 'Strava', { startedAt: new Date('2026-10-06T21:00:00Z'), durationSec: 40 * 60, distanceMeters: 8000 });

const sessionsSnapshot = (w: ReturnType<typeof world>) => JSON.stringify([...w.sessions.values()]);

beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: [...FAKE_TIMER_KEEP] }); });
afterEach(() => { jest.useRealTimers(); });

describe('Confirmacao de atividades ambiguas — o sistema decide sozinho e so pergunta o que ficou ambiguo', () => {
  it('1. duas observacoes confirmadas automaticamente como a mesma execucao (matched): nenhum aviso, uma atividade contada', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(SAME_HC());
    expect(w.get('p').physicalIdentityStatus).toBe('matched');
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
  });

  it('2. duas atividades comprovadamente distintas (unique): nenhum aviso, as duas contam', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(OTHER_RUN_HC());
    expect(w.get('h').physicalIdentityStatus).toBe('unique');
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    expect(w.counting()).toHaveLength(2);
    expect(await w.km()).toBe(18);
  });

  it('3. duas observacoes realmente ambiguas: UMA pendencia, com fonte, horario, modalidade, distancia e duracao; sem inventar fabricante/dispositivo', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    expect(w.get('p').physicalIdentityStatus).toBe('ambiguous');
    const pending = await w.confirmation.pendingForStudent('u1', NOW);
    expect(pending).toHaveLength(1);
    expect(pending[0].observations.map((o) => o.activityLogId).sort()).toEqual(['h', 'p']);
    const byId = Object.fromEntries(pending[0].observations.map((o) => [o.activityLogId, o]));
    expect(byId.p).toMatchObject({ sourceLabel: 'Polar', channelLabel: null, modality: 'corrida', modalityLabel: 'Corrida', distanceMeters: 10000, durationSec: 3300, startedAtLocal: '2026-10-06T07:00' });
    expect(byId.h).toMatchObject({ sourceLabel: 'Polar Flow', channelLabel: 'via Health Connect', distanceMeters: 10350, durationSec: 3480 });
    expect(JSON.stringify(pending)).not.toMatch(/manufacturer|fabricante|device|dispositivo/i); // o canal nunca e apresentado como fabricante/dispositivo
    expect(w.counting()).toHaveLength(1); // protecao D1: so uma conta enquanto ha ambiguidade
    expect(await w.km()).toBe(10);
  });

  it('o canal sem app identificavel aparece como "Aplicativo nao identificado" (nunca como Health Connect fabricante) e dado ausente fica null', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(healthConnect('h', 'com.exemplo.app', 'com.exemplo.app', { distanceMeters: null, durationSec: 58 * 60, startedAt: new Date('2026-10-06T10:02:00Z') }));
    // sem distancia: o veredito pode nao ser ambiguo; forca o estado para validar so a apresentacao
    const view = toPendingView({ key: 'k', members: [w.get('p') as never, { ...w.get('h'), physicalIdentityStatus: 'ambiguous' } as never], reasons: [], studentActionable: true, coachOnlyReason: null });
    const hc = view.observations.find((o) => o.activityLogId === 'h')!;
    expect(hc).toMatchObject({ sourceLabel: 'Aplicativo não identificado', channelLabel: 'via Health Connect', distanceMeters: null });
  });

  it('4. aluno confirma "e a mesma atividade": uma unica execucao, canonica pelas regras atuais, registros e dados preservados, decisao rastreavel', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    const result = await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' });
    expect(result).toMatchObject({ status: 'resolved', decision: 'same', activityLogIds: ['h', 'p'], reevaluated: true });
    expect(w.get('p').physicalIdentityStatus).toBe('matched');
    expect(w.get('p').physicalEventId).toBe(w.get('h').physicalEventId);
    expect(w.get('h').physicalCanonicalActivityLogId).toBe('p'); // Polar direto = gravador nativo; copia pelo Health Connect = relay
    expect(w.logs.size).toBe(2); // nada apagado
    expect(w.get('p').distanceMeters).toBe(10000); // metricas da canonica intactas (sem mistura)
    expect(w.get('h').distanceMeters).toBe(10350);
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    const decision = decisionsOfEvidence(w.get('h').physicalIdentityEvidence).find((d) => d.id === result.decisionId)!;
    expect(decision).toMatchObject({ kind: 'same', actorRole: 'student', actorId: 'u1', status: 'active', state: 'applied', observationIds: ['h', 'p'] });
    expect(new Date(decision.decidedAt).getTime()).toBe(NOW.getTime());
    expect(decisionsOfEvidence(w.get('p').physicalIdentityEvidence).map((d) => d.id)).toEqual([result.decisionId]); // copiada nas duas observacoes
  });

  it('5. aluno confirma "sao atividades diferentes": cada execucao conta uma vez, sem reaproveitar a mesma sessao prescrita; sem sessao, atividade adicional', async () => {
    const w = world();
    const session = w.addSession();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    expect(w.counting()).toHaveLength(1);
    const before = sessionsSnapshot(w);
    await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'distinct' });
    expect(w.get('p').physicalIdentityStatus).toBe('unique');
    expect(w.get('h').physicalIdentityStatus).toBe('unique');
    expect(w.counting()).toHaveLength(2);
    expect(w.activeLinks()).toHaveLength(1); // a sessao prescrita conta UMA execucao
    expect(w.activeLinks()[0]).toMatchObject({ trainingSessionId: session.id });
    const other = ['p', 'h'].find((id) => w.get(id).executionClassification === 'alternative');
    expect(other).toBeDefined(); // a outra execucao e atividade adicional (nao ha outra prescricao)
    expect(await w.km()).toBe(20.4);
    expect(sessionsSnapshot(w)).toBe(before);
    expect(w.tables.trainingSession.update).not.toHaveBeenCalled();
    expect(w.tables.trainingSession.create).not.toHaveBeenCalled();
  });

  it('6. "responder depois": nada e gravado, a pendencia continua visivel, a contabilizacao segue conservadora e nada bloqueia', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    const writesBefore = w.writes();
    for (let i = 0; i < 5; i++) expect(await w.confirmation.pendingForStudent('u1', NOW)).toHaveLength(1); // leituras repetidas
    expect(w.writes()).toBe(writesBefore); // ler a pendencia nunca grava
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
    // uma atividade nao relacionada, no dia seguinte, segue sendo classificada normalmente (nada fica bloqueado pela pendencia)
    await w.ingest(polar('next', { startedAt: new Date('2026-10-07T10:00:00Z'), providerMetrics: { endedAt: new Date('2026-10-07T10:55:00Z').toISOString() } }));
    expect(w.get('next').executionClassification).toBe('alternative');
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toHaveLength(1);
  });

  it('7. o treinador resolve antes do aluno: a pendencia some e a resposta posterior do aluno e recusada sem alterar nada', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    await w.confirmation.resolveAsCoach('u1', { id: 'coach-1' }, 'h', 'distinct');
    expect(w.get('h').physicalIdentityStatus).toBe('unique');
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    const writesBefore = w.writes();
    await expect(w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' })).rejects.toBeInstanceOf(ConflictException);
    expect(w.writes()).toBe(writesBefore);
    expect(w.get('h').physicalIdentityStatus).toBe('unique'); // a decisao do treinador nao foi sobrescrita
    const decisions = decisionsOfEvidence(w.get('h').physicalIdentityEvidence);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ actorRole: 'coach', actorId: 'coach-1', kind: 'distinct' });
  });

  it('8. aluno tenta responder uma pendencia ja resolvida: 409, sem segunda decisao e sem mudar nada', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' });
    const writesBefore = w.writes();
    await expect(w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' })).rejects.toBeInstanceOf(ConflictException);
    await expect(w.confirmation.resolveAsStudent('u1', { activityLogIds: ['h', 'p'], decision: 'distinct' })).rejects.toBeInstanceOf(ConflictException);
    expect(w.writes()).toBe(writesBefore);
    expect(decisionsOfEvidence(w.get('p').physicalIdentityEvidence)).toHaveLength(1);
    expect(w.get('p').physicalIdentityStatus).toBe('matched');
  });

  it('9. duas respostas simultaneas: so uma vence (a outra recebe 409) e o estado final e coerente com a vencedora', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    const outcomes = await Promise.allSettled([
      w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' }),
      w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'distinct' }),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled') as Array<PromiseFulfilledResult<{ decision: string }>>;
    const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    const decisions = decisionsOfEvidence(w.get('p').physicalIdentityEvidence);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe(fulfilled[0].value.decision);
    expect(w.get('p').physicalIdentityStatus).toBe(fulfilled[0].value.decision === 'same' ? 'matched' : 'unique');
    expect(w.counting()).toHaveLength(fulfilled[0].value.decision === 'same' ? 1 : 2); // nunca dupla contagem do "mesmo"
  });

  it('10. tres registros da MESMA execucao confirmados automaticamente: nenhum aviso; uma execucao so', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(healthConnect('h1', 'fi.polar.polarflow', 'Polar Flow', { startedAt: new Date('2026-10-06T10:00:10Z'), durationSec: 55 * 60 + 10, distanceMeters: 10005 }));
    await w.ingest(healthConnect('h2', 'com.strava', 'Strava', { startedAt: new Date('2026-10-06T10:00:25Z'), durationSec: 55 * 60 + 20, distanceMeters: 10012 }));
    for (const id of ['p', 'h1', 'h2']) expect(w.get(id).physicalIdentityStatus).toBe('matched');
    expect(new Set(['p', 'h1', 'h2'].map((id) => w.get(id).physicalEventId)).size).toBe(1);
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
  });

  it('11. tres registros ambiguos entre si: UMA pendencia para o conjunto (nao por par), que o aluno NAO resolve (pergunta binaria insegura); o treinador resolve', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(healthConnect('h1', 'com.strava', 'Strava', { startedAt: new Date('2026-10-06T10:02:00Z') }));
    await w.ingest(healthConnect('h2', 'com.garmin.android.apps.connectmobile', 'Garmin Connect', { startedAt: new Date('2026-10-06T10:01:00Z'), durationSec: 56 * 60, distanceMeters: 10700 }));
    for (const id of ['p', 'h1', 'h2']) expect(w.get(id).physicalIdentityStatus).toBe('ambiguous');
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]); // nada a perguntar ao aluno
    const sets = buildPendingSets([...w.logs.values()] as never, NOW);
    expect(sets).toHaveLength(1); // um conjunto, nao tres pares
    expect(sets[0]).toMatchObject({ studentActionable: false, coachOnlyReason: 'more_than_two' });
    await expect(w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h1'], decision: 'same' })).rejects.toBeInstanceOf(ConflictException);
    expect(w.counting()).toHaveLength(1);
    await w.confirmation.resolveAsCoach('u1', { id: 'coach-1' }, 'p', 'same'); // o treinador une o conjunto inteiro
    for (const id of ['p', 'h1', 'h2']) expect(w.get(id).physicalIdentityStatus).toBe('matched');
    expect(new Set(['p', 'h1', 'h2'].map((id) => w.get(id).physicalEventId)).size).toBe(1);
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
  });

  it('12. chegada tardia de outra fonte: o par vira conjunto de tres (uma pendencia, so do treinador); depois de uma decisao humana a chegada nao a desfaz nem repergunta', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toHaveLength(1);
    await w.ingest(healthConnect('h2', 'com.garmin.android.apps.connectmobile', 'Garmin Connect', { startedAt: new Date('2026-10-06T10:01:00Z'), durationSec: 56 * 60, distanceMeters: 10700 }));
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    expect(buildPendingSets([...w.logs.values()] as never, NOW)).toHaveLength(1);
    // outra execucao: decisao do treinador entre p e h; a chegada tardia de uma terceira fonte nao desfaz a decisao
    const v = world();
    await v.ingest(AMBIGUOUS_POLAR());
    await v.ingest(AMBIGUOUS_HC());
    await v.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' });
    await v.ingest(healthConnect('h3', 'com.strava', 'Strava', { startedAt: new Date('2026-10-06T10:00:30Z'), durationSec: 55 * 60 + 20, distanceMeters: 10015 }));
    expect(['p', 'h', 'h3'].every((id) => v.get(id).physicalIdentityStatus === 'matched')).toBe(true);
    expect(decisionsOfEvidence(v.get('p').physicalIdentityEvidence).filter((d) => d.status === 'active')).toHaveLength(1);
    expect(await v.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    expect(v.counting()).toHaveLength(1);
  });

  it('13. a observacao canonica segue as regras de proveniencia; a decisao humana nao a escolhe nem mistura metricas', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_HC()); // a copia chega primeiro
    await w.ingest(AMBIGUOUS_POLAR());
    await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['h', 'p'], decision: 'same' });
    expect(w.get('h').physicalCanonicalActivityLogId).toBe('p'); // gravador nativo vence a copia, independente de quem chegou/decidiu
    expect(w.get('p').avgHeartRateBpm).toBe(150);
    expect(w.get('h').avgHeartRateBpm).toBeNull(); // nada copiado entre observacoes
    expect(w.get('p').distanceMeters).toBe(10000);
  });

  it('14. vinculo manual do aluno e preservado (prioridade humana): nenhuma decisao automatica o substitui', async () => {
    const w = world();
    const session = w.addSession();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    await w.link.linkManually({ trainingSessionId: session.id, activityLogId: 'p', origin: 'student' });
    await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' });
    expect(w.activeLinks()).toHaveLength(1);
    expect(w.activeLinks()[0]).toMatchObject({ origin: 'student', activityLogId: 'p', trainingSessionId: session.id });
    expect(w.get('p')).toMatchObject({ executionClassification: 'corresponding', executionClassifiedBy: 'student' });
  });

  it('15a. o treinador reverte "mesma atividade": volta a ser par ambiguo, uma execucao conta, a decisao fica registrada como revertida (quem/quando)', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    const resolved = await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' });
    jest.setSystemTime(new Date(NOW.getTime() + 3600000));
    const reverted = await w.confirmation.revertAsCoach('u1', { id: 'coach-1' }, 'h');
    expect(reverted).toMatchObject({ status: 'reverted', decisionIds: [resolved.decisionId], reevaluated: true });
    expect(w.get('p').physicalIdentityStatus).toBe('ambiguous');
    expect(w.get('h').physicalIdentityStatus).toBe('ambiguous');
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
    const decision = decisionsOfEvidence(w.get('h').physicalIdentityEvidence)[0];
    expect(decision).toMatchObject({ id: resolved.decisionId, status: 'reverted', actorRole: 'student', revertedBy: { role: 'coach', id: 'coach-1' } });
    expect(new Date(decision.revertedAt!).getTime()).toBe(NOW.getTime() + 3600000);
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toHaveLength(1); // a pendencia reaparece (decisao revertida nao conta)
    await expect(w.confirmation.revertAsCoach('u1', { id: 'coach-1' }, 'h')).rejects.toBeInstanceOf(BadRequestException); // nada ativo para reverter de novo
  });

  it('15b. o treinador reverte "atividades diferentes": a execucao extra volta a ficar preservada sem contar (sem dupla contagem), sessao intacta', async () => {
    const w = world();
    const session = w.addSession();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'distinct' });
    expect(w.counting()).toHaveLength(2);
    const before = sessionsSnapshot(w);
    const reverted = await w.confirmation.revertAsCoach('u1', { id: 'coach-1' }, 'p');
    expect(reverted.cleared).toHaveLength(1);
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
    expect(w.activeLinks()).toHaveLength(1);
    expect(w.activeLinks()[0].trainingSessionId).toBe(session.id);
    expect(w.logs.size).toBe(2); // registros preservados
    expect(sessionsSnapshot(w)).toBe(before);
  });

  it('o treinador resolve o conjunto de DOIS marcando uma como diferente e o aluno nao e reperguntado; revisao posterior possivel', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    const result = await w.confirmation.resolveAsCoach('u1', { id: 'coach-9' }, 'h', 'distinct', 'duas corridas seguidas no mesmo dia');
    expect(result.activityLogIds).toEqual(['h', 'p']);
    expect(decisionsOfEvidence(w.get('p').physicalIdentityEvidence)[0]).toMatchObject({ actorRole: 'coach', actorId: 'coach-9', note: 'duas corridas seguidas no mesmo dia' });
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
  });

  it('nova evidencia INCOMPATIVEL com uma decisao "mesma atividade": a decisao fica SUSPENSA e visivel (nao e aplicada nem apagada em silencio)', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    const resolved = await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' });
    expect(w.get('p').physicalIdentityStatus).toBe('matched');
    // o registro do Health Connect e atualizado na origem para outro dia/horario (evidencia objetiva decisivamente contraria)
    w.logs.set('h', { ...w.get('h'), startedAt: new Date('2026-10-06T21:00:00Z'), providerMetrics: { ...w.get('h').providerMetrics, endedAt: new Date('2026-10-06T21:58:00Z').toISOString() } });
    await w.ingest({ ...w.get('h') });
    expect(w.get('p').physicalIdentityStatus).toBe('unique');
    expect(w.get('h').physicalIdentityStatus).toBe('unique');
    const decision = decisionsOfEvidence(w.get('h').physicalIdentityEvidence).find((d) => d.id === resolved.decisionId)!;
    expect(decision).toMatchObject({ status: 'active', state: 'suspended', stateReason: 'different_time' });
    expect(w.counting()).toHaveLength(2); // as duas execucoes distintas agora contam
  });

  it('16/17. volume, distancia e historico: nunca dupla contagem e nunca perda ao longo de todo o fluxo; registros originais sempre preservados', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    expect(await w.km()).toBe(10); // ambiguo: uma conta
    await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' });
    expect(await w.km()).toBe(10); // mesma atividade: uma conta (valor da canonica)
    await w.confirmation.revertAsCoach('u1', { id: 'coach-1' }, 'p');
    expect(await w.km()).toBe(10);
    await w.confirmation.resolveAsCoach('u1', { id: 'coach-1' }, 'h', 'distinct');
    expect(await w.km()).toBe(20.4); // distintas: as duas contam, cada uma com o seu valor
    expect(w.logs.size).toBe(2);
    expect(w.get('p').distanceMeters).toBe(10000);
    expect(w.get('h').distanceMeters).toBe(10350);
  });

  it('18. nenhuma sessao prescrita (entregue, concluida ou pendente) e criada, alterada, movida ou excluida em nenhuma resposta', async () => {
    for (const decision of ['same', 'distinct'] as const) {
      const w = world();
      w.addSession({ id: 's-entregue' });
      w.addSession({ id: 's-outra', scheduledDate: new Date('2026-10-08T00:00:00Z'), modality: 'forca' });
      await w.ingest(AMBIGUOUS_POLAR());
      await w.ingest(AMBIGUOUS_HC());
      const before = sessionsSnapshot(w);
      await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision });
      await w.confirmation.revertAsCoach('u1', { id: 'coach-1' }, 'h');
      expect(sessionsSnapshot(w)).toBe(before);
      expect(w.tables.trainingSession.update).not.toHaveBeenCalled();
      expect(w.tables.trainingSession.create).not.toHaveBeenCalled();
    }
  });

  it('19. o aluno nao confirma nem le registros de outro usuario (404, nada gravado)', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    expect(await w.confirmation.pendingForStudent('u2', NOW)).toEqual([]);
    const writesBefore = w.writes();
    await expect(w.confirmation.resolveAsStudent('u2', { activityLogIds: ['p', 'h'], decision: 'same' })).rejects.toBeInstanceOf(NotFoundException);
    expect(w.writes()).toBe(writesBefore);
    expect(decisionsOfEvidence(w.get('p').physicalIdentityEvidence)).toHaveLength(0);
    expect(w.get('p').physicalIdentityStatus).toBe('ambiguous');
    // uma observacao do proprio aluno misturada com uma de outro tambem e recusada
    await w.ingest(polar('o', { userId: 'u2', startedAt: new Date('2026-10-06T10:00:00Z') }));
    await expect(w.confirmation.resolveAsStudent('u2', { activityLogIds: ['o', 'h'], decision: 'same' })).rejects.toBeInstanceOf(NotFoundException);
    // o treinador tambem so' age no aluno informado
    await expect(w.confirmation.resolveAsCoach('u2', { id: 'coach-1' }, 'h', 'same')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('entradas invalidas sao recusadas (400) e nada e gravado', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    const writesBefore = w.writes();
    for (const body of [null, {}, { activityLogIds: ['p'], decision: 'same' }, { activityLogIds: ['p', 'p'], decision: 'same' }, { activityLogIds: ['p', 'h'], decision: 'talvez' }, { activityLogIds: 'p,h', decision: 'same' }]) {
      await expect(w.confirmation.resolveAsStudent('u1', body)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(w.writes()).toBe(writesBefore);
  });

  it('20. nenhum bloqueio nem aviso: a pendencia nao tem dependencia de notificacao e nao impede treinos; pendencia antiga (>60 dias) fica so com o treinador', async () => {
    const w = world();
    await w.ingest(AMBIGUOUS_POLAR());
    await w.ingest(AMBIGUOUS_HC());
    expect(Object.keys(w.confirmation)).not.toContain('notifications'); // o servico nao conhece nenhum notificador
    const later = new Date(NOW.getTime() + 70 * 24 * 60 * 60 * 1000);
    expect(await w.confirmation.pendingForStudent('u1', later)).toEqual([]); // historico antigo nao vira pergunta
    expect(buildPendingSets([...w.logs.values()] as never, later)[0]).toMatchObject({ studentActionable: false, coachOnlyReason: 'too_old' });
  });

  it('indicadores de qualidade: automaticas x ambiguas x confirmacoes (aluno/treinador/revertidas) e combinacoes de fontes que mais geram ambiguidade', async () => {
    const w = world();
    await w.ingest(polar('a1', { startedAt: new Date('2026-10-01T10:00:00Z') }));
    await w.ingest(healthConnect('a2', 'fi.polar.polarflow', 'Polar Flow', { startedAt: new Date('2026-10-01T10:00:20Z'), durationSec: 55 * 60 + 15, distanceMeters: 10010 })); // matched
    await w.ingest(polar('u1x', { startedAt: new Date('2026-10-02T10:00:00Z') })); // unique
    await w.ingest(polar('b1', { startedAt: new Date('2026-10-03T10:00:00Z') }));
    await w.ingest(healthConnect('b2', 'fi.polar.polarflow', 'Polar Flow', { startedAt: new Date('2026-10-03T10:02:00Z') })); // ambiguo -> aluno decide
    await w.ingest(polar('c1', { startedAt: new Date('2026-10-04T10:00:00Z') }));
    await w.ingest(healthConnect('c2', 'fi.polar.polarflow', 'Polar Flow', { startedAt: new Date('2026-10-04T10:02:00Z') })); // ambiguo -> treinador decide
    await w.ingest(polar('d1', { startedAt: new Date('2026-10-05T10:00:00Z') }));
    await w.ingest(healthConnect('d2', 'fi.polar.polarflow', 'Polar Flow', { startedAt: new Date('2026-10-05T10:02:00Z') })); // ambiguo aberto
    await w.confirmation.resolveAsStudent('u1', { activityLogIds: ['b1', 'b2'], decision: 'same' });
    await w.confirmation.resolveAsCoach('u1', { id: 'coach-1' }, 'c2', 'distinct');
    await w.confirmation.revertAsCoach('u1', { id: 'coach-1' }, 'b2');
    const quality = await w.confirmation.quality(90, NOW);
    expect(quality.autoResolved.matchedEvents).toBe(1);
    expect(quality.autoResolved.uniqueActivities).toBeGreaterThanOrEqual(1);
    expect(quality.ambiguous).toMatchObject({ openSets: 2, studentActionable: 2, coachOnly: 0 }); // b (revertida, reapareceu) e d
    expect(quality.confirmations).toMatchObject({ answeredByStudents: 1, answeredByStudentsSame: 1, answeredByStudentsDistinct: 0, resolvedByCoaches: 1, reverted: 1, requestedToStudents: 3 });
    expect(quality.topAmbiguousSourceCombinations[0]).toEqual({ combination: 'health_connect:fi.polar.polarflow + polar', sets: 2 });
  });
});

describe('modelo de pendencias (puro)', () => {
  it('um conjunto por execucao ambigua; ambigua sem par registrado (legado) nao gera pergunta', () => {
    const rows = [
      { ...polar('x'), physicalIdentityStatus: 'ambiguous', physicalIdentityEvidence: null },
    ] as never;
    expect(buildPendingSets(rows, NOW)).toEqual([]);
  });
});

// Conjunto MISTO: uma observacao divergente das duas fontes que concordam entre si (a ambiguidade e' entre a observacao e o EVENTO ja' confirmado).
describe('conjunto misto — observacao ambigua frente a um evento ja confirmado', () => {
  const mixed = async (order: 'single-first' | 'event-first' = 'single-first') => {
    const w = world();
    const strava = () => healthConnect('h2', 'com.strava', 'Strava', { startedAt: new Date('2026-10-06T10:01:00Z'), distanceMeters: 10340 });
    if (order === 'single-first') {
      await w.ingest(AMBIGUOUS_POLAR());
      await w.ingest(AMBIGUOUS_HC());
      await w.ingest(strava());
    } else {
      await w.ingest(AMBIGUOUS_HC());
      await w.ingest(strava());
      await w.ingest(AMBIGUOUS_POLAR());
    }
    return w;
  };

  it('a mesma execucao nao conta duas vezes (observacao ambigua + evento): uma conta, em qualquer ordem de chegada; tudo preservado', async () => {
    for (const order of ['single-first', 'event-first'] as const) {
      const w = await mixed(order);
      expect(w.get('h').physicalIdentityStatus).toBe('matched');
      expect(w.get('h2').physicalIdentityStatus).toBe('matched');
      expect(w.get('p').physicalIdentityStatus).toBe('ambiguous');
      expect(w.counting()).toHaveLength(1);
      expect(w.logs.size).toBe(3);
    }
  });

  it('gera UMA pendencia para o conjunto de tres (so do treinador); o aluno nao e perguntado e nao consegue resolver', async () => {
    const w = await mixed();
    expect(await w.confirmation.pendingForStudent('u1', NOW)).toEqual([]);
    const sets = buildPendingSets([...w.logs.values()] as never, NOW);
    expect(sets).toHaveLength(1);
    expect(sets[0].members.map((m) => m.id).sort()).toEqual(['h', 'h2', 'p']);
    expect(sets[0]).toMatchObject({ studentActionable: false, coachOnlyReason: 'more_than_two' });
    await expect(w.confirmation.resolveAsStudent('u1', { activityLogIds: ['p', 'h'], decision: 'same' })).rejects.toBeInstanceOf(ConflictException);
    expect((await w.confirmation.quality(90, NOW)).ambiguous).toMatchObject({ openSets: 1, studentActionable: 0, coachOnly: 1 });
  });

  it('o treinador confirma que a observacao e DIFERENTE do evento: as duas execucoes passam a contar (cada uma uma vez), sem desfazer o evento', async () => {
    const w = await mixed();
    await w.confirmation.resolveAsCoach('u1', { id: 'coach-1' }, 'p', 'distinct');
    expect(w.get('p').physicalIdentityStatus).toBe('unique');
    expect(w.get('h').physicalIdentityStatus).toBe('matched');
    expect(w.get('h').physicalEventId).toBe(w.get('h2').physicalEventId); // as duas fontes que concordam seguem como uma execucao
    expect(w.counting()).toHaveLength(2);
    expect(await w.km()).toBe(20.4);
    expect(buildPendingSets([...w.logs.values()] as never, NOW)).toEqual([]);
  });

  it('o treinador confirma que e a MESMA execucao: um evento so, uma conta, canonica pelas regras de proveniencia; reversao devolve a ambiguidade sem dupla contagem', async () => {
    const w = await mixed();
    await w.confirmation.resolveAsCoach('u1', { id: 'coach-1' }, 'p', 'same');
    for (const id of ['p', 'h', 'h2']) expect(w.get(id).physicalIdentityStatus).toBe('matched');
    expect(new Set(['p', 'h', 'h2'].map((id) => w.get(id).physicalEventId)).size).toBe(1);
    expect(w.get('h').physicalCanonicalActivityLogId).toBe('p'); // Polar direto = gravador nativo
    expect(w.counting()).toHaveLength(1);
    expect(await w.km()).toBe(10);
    await w.confirmation.revertAsCoach('u1', { id: 'coach-1' }, 'p');
    expect(w.get('p').physicalIdentityStatus).toBe('ambiguous');
    expect(w.counting()).toHaveLength(1); // volta a ser preservado, sem dupla contagem
    expect(await w.km()).toBe(10);
  });
});

describe('nucleo das decisoes humanas (puro)', () => {
  const comparison = (verdict: 'same' | 'ambiguous' | 'distinct', reason: string) => ({ verdict, reason, evidence: [] });
  const decision = (overrides: Partial<ReturnType<typeof makeDecision>> = {}) => ({ ...makeDecision(), ...overrides });
  function makeDecision() {
    return { id: 'd1', kind: 'same' as 'same' | 'distinct', pairs: [['a', 'b']] as Array<[string, string]>, observationIds: ['a', 'b'], actorRole: 'student' as const, actorId: 'u1', decidedAt: '2026-10-08T12:00:00.000Z', status: 'active' as 'active' | 'reverted' };
  }

  it('"mesma atividade" se aplica sobre o veredito ambiguo; "diferentes" sempre se aplica; sem decisao nada muda', () => {
    expect(applyHumanDecision(comparison('ambiguous', 'metric_divergence_at_same_time'), decision())).toMatchObject({ comparison: { verdict: 'same', reason: 'human_decision_same' }, state: 'applied' });
    expect(applyHumanDecision(comparison('same', 'strong_multi_evidence'), decision({ kind: 'distinct' }))).toMatchObject({ comparison: { verdict: 'distinct', reason: 'human_decision_distinct' }, state: 'applied' });
    expect(applyHumanDecision(comparison('ambiguous', 'x'), null)).toMatchObject({ decision: null, state: null, comparison: { verdict: 'ambiguous' } });
  });

  it('evidencia objetiva DECISIVAMENTE contraria suspende "mesma atividade" (nao a aplica nem a apaga); motivos nao decisivos nao suspendem', () => {
    for (const reason of ['different_time', 'no_time_overlap', 'incompatible_modality', 'different_athlete']) {
      expect(applyHumanDecision(comparison('distinct', reason), decision())).toMatchObject({ comparison: { verdict: 'distinct', reason }, state: 'suspended', stateReason: reason });
    }
    expect(applyHumanDecision(comparison('distinct', 'same_observer_two_records'), decision())).toMatchObject({ comparison: { verdict: 'same' }, state: 'applied' });
  });

  it('decisao revertida nao cobre mais o par; entre duas ativas vale a mais recente', () => {
    expect(decisionForPair([decision({ status: 'reverted' })], 'a', 'b')).toBeNull();
    const older = decision({ id: 'old', kind: 'distinct' });
    const newer = decision({ id: 'new', kind: 'same', decidedAt: '2026-10-09T12:00:00.000Z' });
    expect(decisionForPair([older, newer], 'b', 'a')?.id).toBe('new');
    expect(decisionForPair([older], 'a', 'c')).toBeNull();
  });

  it('evidencia ausente/legada = nenhuma decisao (tolerante)', () => {
    expect(decisionsOfEvidence(null)).toEqual([]);
    expect(decisionsOfEvidence({ version: 1, comparisons: [] })).toEqual([]);
    expect(decisionsOfEvidence({ humanDecisions: [{ id: 'x' }] })).toEqual([]);
  });
});
