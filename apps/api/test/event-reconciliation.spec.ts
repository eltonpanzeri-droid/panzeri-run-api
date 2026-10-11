import { PrismaService } from '../src/prisma/prisma.service';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';

// Apple Etapa 3B — reconciliacao por PhysicalEvent <-> TrainingSession. Banco em memoria (Map), mesmo padrao de reconciliation-v1.spec.ts,
// estendido com os campos/consultas de evento fisico. Cobre o nucleo: evento unico, rivais, modalidade canonica, alternativa, canonica movel,
// decisao humana, historico idempotente.
function fixture() {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  const activityLogs = new Map<string, any>();
  const sessions = new Map<string, any>();
  const links = new Map<string, any>();

  const prisma = {
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => activityLogs.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...activityLogs.values()].filter((a) => {
          if (where.userId !== undefined && a.userId !== where.userId) return false;
          if (where.physicalEventId !== undefined && a.physicalEventId !== where.physicalEventId) return false;
          if (where.id?.not !== undefined && a.id === where.id.not) return false;
          if (where.id?.in !== undefined && !where.id.in.includes(a.id)) return false;
          if (typeof where.physicalIdentityStatus === 'string' && a.physicalIdentityStatus !== where.physicalIdentityStatus) return false;
          if (where.startedAt?.gte !== undefined && a.startedAt < where.startedAt.gte) return false;
          if (where.startedAt?.lte !== undefined && a.startedAt > where.startedAt.lte) return false;
          if (where.OR !== undefined && !where.OR.some((c: any) => a.executionClassification === c.executionClassification)) return false;
          return true;
        }),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...activityLogs.get(where.id), ...data };
        activityLogs.set(where.id, updated);
        return updated;
      }),
    },
    trainingSession: {
      findUnique: jest.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...sessions.values()]
          .filter((s) => (where.userId === undefined || s.userId === where.userId)
            && (where.scheduledDate === undefined || s.scheduledDate.getTime() === where.scheduledDate.getTime())
            && (where.origin === undefined || s.origin === where.origin))
          .map((s) => ({ ...s, completion: null, executionLinks: [...links.values()].filter((l) => l.trainingSessionId === s.id && l.status === 'active') })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...sessions.get(where.id), ...data };
        sessions.set(where.id, updated);
        return updated;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('session'), ...data };
        sessions.set(row.id, row);
        return row;
      }),
    },
    sessionExecutionLink: {
      findUnique: jest.fn(async ({ where }: any) => links.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        [...links.values()]
          .filter((l) => {
            const ids = where.activityLogId?.in ?? (where.activityLogId !== undefined ? [where.activityLogId] : null);
            if (ids && !ids.includes(l.activityLogId)) return false;
            if (where.trainingSessionId !== undefined && l.trainingSessionId !== where.trainingSessionId) return false;
            if (where.status?.in !== undefined && !where.status.in.includes(l.status)) return false;
            if (typeof where.status === 'string' && l.status !== where.status) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId('link'), createdAt: new Date(Date.now() + seq), revokedAt: null, supersededByLinkId: null, matchMethod: null, evidence: null, confidence: null, note: null, ...data };
        links.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...links.get(where.id), ...data };
        links.set(where.id, updated);
        return updated;
      }),
      count: jest.fn(async ({ where }: any) => [...links.values()].filter((l) => l.activityLogId === where.activityLogId && l.status === where.status).length),
    },
    trainingPlan: { findFirst: jest.fn(async () => null) },
    workoutCompletion: { findUnique: jest.fn(async () => null), create: jest.fn(), update: jest.fn() },
  };
  const service = new SessionExecutionLinkService(prisma as unknown as PrismaService);

  const addActivity = (overrides: Record<string, unknown> = {}) => {
    const row = {
      id: nextId('act'), userId: 'u1', provider: 'polar', externalId: nextId('ext'), startedAt: new Date('2026-10-06T10:00:00Z'), utcOffsetMinutes: -180,
      sport: 'corrida', distanceMeters: 10000, durationSec: 3000, executionClassification: null, executionClassifiedAt: null, executionClassifiedBy: null,
      physicalEventId: null, physicalIdentityStatus: 'unique', physicalCanonicalActivityLogId: null, ...overrides,
    };
    activityLogs.set(row.id as string, row);
    return row as any;
  };
  const addSession = (overrides: Record<string, unknown> = {}) => {
    const row = { id: nextId('s'), userId: 'u1', planId: 'plan', scheduledDate: new Date('2026-10-06T00:00:00Z'), modality: 'corrida', distanceKm: 10, durationMin: 50, origin: 'ai', structure: {}, ...overrides };
    sessions.set(row.id as string, row);
    return row as any;
  };
  // Evento fisico: observacoes com o mesmo physicalEventId e a canonica indicada.
  const makeEvent = (eventId: string, memberIds: string[], canonicalId: string) => {
    for (const id of memberIds) Object.assign(activityLogs.get(id), { physicalEventId: eventId, physicalIdentityStatus: 'matched', physicalCanonicalActivityLogId: canonicalId });
  };
  const activeLinks = () => [...links.values()].filter((l) => l.status === 'active');
  return { service, prisma, activityLogs, sessions, links, addActivity, addSession, makeEvent, activeLinks };
}

function eventFixture() {
  const f = fixture();
  const polar = f.addActivity({ provider: 'polar', sport: 'corrida' });
  const apple = f.addActivity({ provider: 'apple_health', sport: 'corrida', startedAt: new Date('2026-10-06T10:00:01Z') });
  f.makeEvent('ev-1', [polar.id, apple.id], polar.id);
  return { ...f, polar, apple };
}

describe('3B — reconcileEvent (PhysicalEvent <-> TrainingSession)', () => {
  it('Polar + Apple do mesmo evento + uma sessao prescrita -> 1 vinculo, na canonica; a copia Apple nao carrega nada', async () => {
    const { service, polar, apple, addSession, activeLinks, activityLogs } = eventFixture();
    const session = addSession();
    const result = await service.reconcileEvent(apple.id); // disparado pela observacao NAO canonica: resolve a canonica
    expect(result).toMatchObject({ outcome: 'linked', classification: 'corresponding', canonicalActivityLogId: polar.id, changed: true });
    expect(activeLinks()).toHaveLength(1);
    expect(activeLinks()[0]).toMatchObject({ trainingSessionId: session.id, activityLogId: polar.id, origin: 'automatic' });
    expect(activityLogs.get(polar.id).executionClassification).toBe('corresponding');
    expect(activityLogs.get(apple.id).executionClassification).toBeNull();
  });

  it('observacao duplicada do MESMO evento nao vira rival: classify(Polar) com copia Apple null corresponde (antes ficava ambiguo)', async () => {
    const { service, polar, addSession, activeLinks } = eventFixture();
    addSession();
    expect(await service.classify(polar.id)).toBe('corresponding');
    expect(activeLinks()).toHaveLength(1);
  });

  it('RUNNING (legado bruto) x corrida nao causa divergencia: a sessao corrida corresponde ao Polar RUNNING', async () => {
    const f = fixture();
    const polar = f.addActivity({ provider: 'polar', sport: 'RUNNING' });
    f.addSession({ modality: 'corrida' });
    const result = await f.service.reconcileEvent(polar.id);
    expect(result).toMatchObject({ outcome: 'linked', classification: 'corresponding' });
    expect(f.activityLogs.get(polar.id).sport).toBe('RUNNING'); // valor original preservado
  });

  it('PhysicalEvent sem sessao correspondente permanece atividade adicional (alternative) e a segunda execucao nao muda nada', async () => {
    const { service, polar, apple, activityLogs, activeLinks } = eventFixture();
    const first = await service.reconcileEvent(polar.id);
    expect(first).toMatchObject({ outcome: 'alternative', classification: 'alternative', changed: true });
    expect(activeLinks()).toHaveLength(0);
    expect(activityLogs.get(apple.id).executionClassification).toBeNull();
    const second = await service.reconcileEvent(polar.id);
    expect(second).toMatchObject({ outcome: 'unchanged', changed: false, classification: 'alternative' });
  });

  it('mudanca da canonica: o vinculo automatico acompanha (supersessao), sem duplicar, e e idempotente', async () => {
    const { service, polar, apple, addSession, activeLinks, links, activityLogs, makeEvent } = eventFixture();
    const session = addSession();
    await service.reconcileEvent(polar.id);
    expect(activeLinks()[0].activityLogId).toBe(polar.id);

    makeEvent('ev-1', [polar.id, apple.id], apple.id); // nova evidencia: a canonica passa a ser a observacao Apple
    const moved = await service.reconcileEvent(polar.id);
    expect(moved).toMatchObject({ outcome: 'link_moved', canonicalActivityLogId: apple.id, classification: 'corresponding' });
    expect(activeLinks()).toHaveLength(1);
    expect(activeLinks()[0]).toMatchObject({ activityLogId: apple.id, trainingSessionId: session.id, matchMethod: 'automatic_canonical_follow' });
    const old = [...links.values()].find((l) => l.activityLogId === polar.id);
    expect(old).toMatchObject({ status: 'revoked', supersededByLinkId: activeLinks()[0].id });
    expect(activityLogs.get(polar.id).executionClassification).toBeNull(); // nao-canonica volta a nao carregar classificacao automatica
    expect(activityLogs.get(apple.id).executionClassification).toBe('corresponding');

    expect(await service.reconcileEvent(apple.id)).toMatchObject({ outcome: 'unchanged', changed: false });
    expect(activeLinks()).toHaveLength(1);
  });

  it('decisao humana (coach marcou como extra) nao e sobrescrita: conflito fica auditavel como linha revoked inerte', async () => {
    const { service, polar, apple, addSession, activeLinks, links, activityLogs } = eventFixture();
    const session = addSession();
    Object.assign(activityLogs.get(polar.id), { executionClassification: 'alternative', executionClassifiedBy: 'coach' });
    const result = await service.reconcileEvent(apple.id);
    expect(result).toMatchObject({ outcome: 'human_preserved', conflicts: 1 });
    expect(activityLogs.get(polar.id)).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'coach' });
    expect(activeLinks()).toHaveLength(0);
    const audit = [...links.values()].filter((l) => l.matchMethod === 'automatic_conflict_with_human_decision');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ status: 'revoked', trainingSessionId: session.id, activityLogId: polar.id });
    await service.reconcileEvent(apple.id); // idempotente: nao duplica a auditoria
    expect([...links.values()].filter((l) => l.matchMethod === 'automatic_conflict_with_human_decision')).toHaveLength(1);
  });

  it('decisao humana com vinculo ativo em outra sessao: preservada; vinculo automatico duplicado do evento e retirado', async () => {
    const { service, polar, apple, addSession, activeLinks, links, activityLogs } = eventFixture();
    const mine = addSession({ title: 'confirmada pelo coach' });
    const other = addSession({ title: 'outra do dia' });
    await service.linkManually({ trainingSessionId: mine.id, activityLogId: apple.id, origin: 'coach' }); // humano na observacao Apple
    // vinculo automatico antigo (Polar -> outra sessao), de antes de o evento existir
    links.set('legacy', { id: 'legacy', userId: 'u1', trainingSessionId: other.id, activityLogId: polar.id, status: 'active', origin: 'automatic', note: null, createdAt: new Date(), revokedAt: null, supersededByLinkId: null });
    Object.assign(activityLogs.get(polar.id), { executionClassification: 'corresponding', executionClassifiedBy: 'automatic' });

    const result = await service.reconcileEvent(polar.id);
    expect(result.outcome).toBe('human_preserved');
    expect(activeLinks()).toHaveLength(1);
    expect(activeLinks()[0]).toMatchObject({ trainingSessionId: mine.id, origin: 'coach' });
    expect(links.get('legacy')).toMatchObject({ status: 'revoked' });
    expect(activityLogs.get(polar.id).executionClassification).toBeNull(); // nao conta duas vezes
    expect(activityLogs.get(apple.id)).toMatchObject({ executionClassification: 'corresponding', executionClassifiedBy: 'coach' });
  });

  it('duas atividades fisicas DIFERENTES no mesmo dia e uma sessao: seguem distintas e ficam ambiguas (candidatas), nunca um vinculo forcado', async () => {
    const f = fixture();
    const morning = f.addActivity({ provider: 'polar', startedAt: new Date('2026-10-06T09:00:00Z') });
    const evening = f.addActivity({ provider: 'garmin', startedAt: new Date('2026-10-06T21:00:00Z'), distanceMeters: 8000 });
    f.addSession();
    const a = await f.service.reconcileEvent(morning.id);
    const b = await f.service.reconcileEvent(evening.id);
    expect(a).toMatchObject({ classification: 'ambiguous', outcome: 'candidates' });
    expect(b).toMatchObject({ classification: 'ambiguous', outcome: 'candidates' });
    expect(f.activeLinks()).toHaveLength(0);
  });

  it('vinculo automatico ja ativo e estavel: reconciliar de novo nao reescreve nem cria linhas', async () => {
    const { service, polar, addSession, prisma } = eventFixture();
    addSession();
    await service.reconcileEvent(polar.id);
    const createsBefore = prisma.sessionExecutionLink.create.mock.calls.length;
    const updatesBefore = prisma.sessionExecutionLink.update.mock.calls.length;
    const again = await service.reconcileEvent(polar.id);
    expect(again).toMatchObject({ outcome: 'unchanged', changed: false });
    expect(prisma.sessionExecutionLink.create.mock.calls.length).toBe(createsBefore);
    expect(prisma.sessionExecutionLink.update.mock.calls.length).toBe(updatesBefore);
  });

  it('historico: estado automatico antigo (ambiguo por copia Apple null) e reconciliado; segunda execucao tem o mesmo resultado e 0 mudancas; dryRun nao grava', async () => {
    const { service, polar, apple, addSession, activeLinks, links, activityLogs } = eventFixture();
    const session = addSession();
    // estado legado: Polar classificada 'ambiguous' + candidata automatica (efeito do rival antigo)
    Object.assign(activityLogs.get(polar.id), { executionClassification: 'ambiguous', executionClassifiedBy: 'automatic' });
    links.set('cand', { id: 'cand', userId: 'u1', trainingSessionId: session.id, activityLogId: polar.id, status: 'candidate', origin: 'automatic', note: null, createdAt: new Date(), revokedAt: null, supersededByLinkId: null });

    const dry = await service.reconcileUserHistory('u1', { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, events: 1, changed: 1 });
    expect(activeLinks()).toHaveLength(0);
    expect(activityLogs.get(polar.id).executionClassification).toBe('ambiguous');

    const first = await service.reconcileUserHistory('u1');
    expect(first).toMatchObject({ events: 1, changed: 1, byOutcome: { linked: 1 } });
    expect(activeLinks()).toHaveLength(1);
    expect(activeLinks()[0]).toMatchObject({ activityLogId: polar.id, trainingSessionId: session.id });
    expect(links.get('cand').status).toBe('revoked');
    expect(activityLogs.get(apple.id).executionClassification).toBeNull();

    const second = await service.reconcileUserHistory('u1');
    expect(second).toMatchObject({ events: 1, changed: 0, byOutcome: { unchanged: 1 } });
    expect(second.results.map((r) => [r.canonicalActivityLogId, r.classification])).toEqual(first.results.map((r) => [r.canonicalActivityLogId, r.classification]));
    expect(activeLinks()).toHaveLength(1);
  });

  it('trava por aluno: a reconciliacao que grava roda numa transacao com advisory lock (mesma chave da identidade); a simulacao nao trava', async () => {
    const { prisma, polar, addSession, activeLinks } = eventFixture();
    addSession();
    const executeRaw = jest.fn(async () => 1);
    const txOps: string[] = [];
    const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      txOps.push('begin');
      const result = await fn({ ...prisma, $executeRaw: executeRaw });
      txOps.push('commit');
      return result;
    });
    const locked = new SessionExecutionLinkService({ ...prisma, $transaction: transaction } as unknown as PrismaService);

    await locked.reconcileEvent(polar.id, { dryRun: true });
    expect(transaction).not.toHaveBeenCalled();
    expect(activeLinks()).toHaveLength(0);

    const result = await locked.reconcileEvent(polar.id);
    expect(result).toMatchObject({ outcome: 'linked', changed: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(executeRaw.mock.calls[0])).toContain('physical-identity:');
    expect(JSON.stringify(executeRaw.mock.calls[0])).toContain('u1');
    expect(txOps).toEqual(['begin', 'commit']);
    expect(activeLinks()).toHaveLength(1);
  });

  it('identidade ambigua com uma observacao do par JA classificada: a outra nao e reconciliada automaticamente (evita contar a mesma execucao duas vezes)', async () => {
    const f = fixture();
    const first = f.addActivity({ provider: 'polar', physicalIdentityStatus: 'ambiguous', executionClassification: 'alternative', executionClassifiedBy: 'automatic' });
    const second = f.addActivity({ provider: 'apple_health', physicalIdentityStatus: 'ambiguous', startedAt: new Date('2026-10-06T10:00:05Z') });
    mutualEvidence(f.activityLogs, [first.id, second.id]);
    f.addSession();
    expect(await f.service.reconcileEvent(second.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', changed: false });
    expect(f.activityLogs.get(second.id).executionClassification).toBeNull();
    expect(f.activeLinks()).toHaveLength(0);
  });

  it('atividade alternativa ja materializada (sessao sintetica) nao e reinterpretada; a sintetica acompanha a nova canonica', async () => {
    const { service, polar, apple, addSession, activityLogs, sessions, makeEvent } = eventFixture();
    Object.assign(activityLogs.get(polar.id), { executionClassification: 'alternative', executionClassifiedBy: 'automatic' });
    const synthetic = addSession({ origin: 'device_extra', structure: { type: 'extra', source: 'device', activityLogId: polar.id, provider: 'polar' } });
    addSession(); // sessao prescrita compativel do dia: NAO deve capturar uma atividade ja materializada como extra
    const same = await service.reconcileEvent(polar.id);
    expect(same).toMatchObject({ outcome: 'kept_materialized_alternative', classification: 'alternative', changed: false });
    makeEvent('ev-1', [polar.id, apple.id], apple.id);
    const moved = await service.reconcileEvent(polar.id);
    expect(moved.outcome).toBe('link_moved');
    expect(sessions.get(synthetic.id).structure.activityLogId).toBe(apple.id);
    expect(activityLogs.get(apple.id).executionClassification).toBe('alternative');
    expect(activityLogs.get(polar.id).executionClassification).toBeNull(); // a execucao conta uma vez
  });
});

// ---- Health Connect (observacoes simuladas): vinculos, atividade adicional e transicoes de identidade -----------------------------------
// A reconciliacao so' conhece o EVENTO e sua canonica; o canal de origem (health_connect) nao muda nenhuma regra. Em todos os cenarios as
// sessoes prescritas (TrainingSession) NAO podem ser criadas, alteradas, movidas nem excluidas: so' vinculos/classificacoes de execucao mudam.
function hcEventFixture() {
  const f = fixture();
  const polar = f.addActivity({ provider: 'polar', sport: 'corrida' });
  const hc = f.addActivity({ provider: 'health_connect', sport: 'corrida', startedAt: new Date('2026-10-06T10:00:02Z') });
  f.makeEvent('ev-hc', [polar.id, hc.id], polar.id);
  return { ...f, polar, hc };
}
const markAmbiguous = (activityLogs: Map<string, any>, ids: string[]) => {
  for (const id of ids) Object.assign(activityLogs.get(id), { physicalEventId: null, physicalIdentityStatus: 'ambiguous', physicalCanonicalActivityLogId: null });
  mutualEvidence(activityLogs, ids);
};
const sessionsSnapshot = (sessions: Map<string, any>) => JSON.stringify([...sessions.values()]);

describe('Health Connect — vinculos e transicoes de identidade', () => {
  it('11. corrida correspondente a sessao prescrita: UM vinculo, na canonica; a copia do Health Connect nao carrega vinculo nem classificacao; sessao intacta', async () => {
    const { service, hc, polar, addSession, activeLinks, activityLogs, sessions, prisma } = hcEventFixture();
    const session = addSession();
    const before = sessionsSnapshot(sessions);
    const result = await service.reconcileEvent(hc.id);
    expect(result).toMatchObject({ outcome: 'linked', classification: 'corresponding', canonicalActivityLogId: polar.id });
    expect(activeLinks()).toHaveLength(1);
    expect(activeLinks()[0]).toMatchObject({ trainingSessionId: session.id, activityLogId: polar.id });
    expect(activityLogs.get(hc.id).executionClassification).toBeNull();
    expect(sessionsSnapshot(sessions)).toBe(before);
    expect(prisma.trainingSession.update).not.toHaveBeenCalled();
    expect(prisma.trainingSession.create).not.toHaveBeenCalled();
  });

  it('12/17. corrida adicional sem prescricao correspondente: uma atividade adicional so; nao vira execucao de outra sessao (outro dia) nem cria sessao', async () => {
    const { service, hc, polar, addSession, activeLinks, activityLogs, sessions, prisma } = hcEventFixture();
    addSession({ scheduledDate: new Date('2026-10-08T00:00:00Z') }); // prescrita em OUTRO dia: nao pode capturar esta corrida
    const before = sessionsSnapshot(sessions);
    expect(await service.reconcileEvent(hc.id)).toMatchObject({ outcome: 'alternative', classification: 'alternative', canonicalActivityLogId: polar.id });
    expect(await service.reconcileEvent(polar.id)).toMatchObject({ outcome: 'unchanged', changed: false });
    expect(activeLinks()).toHaveLength(0);
    expect(activityLogs.get(polar.id).executionClassification).toBe('alternative');
    expect(activityLogs.get(hc.id).executionClassification).toBeNull(); // conta uma vez
    expect(sessionsSnapshot(sessions)).toBe(before);
    expect(prisma.trainingSession.create).not.toHaveBeenCalled();
  });

  it('13. chegada tardia da copia do Health Connect depois de a corrida ja estar vinculada: nada muda; se a canonica mudar, o vinculo acompanha sem segunda execucao', async () => {
    const f = fixture();
    const polar = f.addActivity({ provider: 'polar' });
    const session = f.addSession();
    await f.service.reconcileEvent(polar.id); // ainda unique: vincula sozinha
    expect(f.activeLinks()).toHaveLength(1);
    const hc = f.addActivity({ provider: 'health_connect', startedAt: new Date('2026-10-06T10:00:02Z') });
    f.makeEvent('ev-late', [polar.id, hc.id], polar.id); // a identidade avaliou: mesmo evento, canonica Polar
    const createsBefore = f.prisma.sessionExecutionLink.create.mock.calls.length;
    expect(await f.service.reconcileEvent(hc.id)).toMatchObject({ outcome: 'unchanged', changed: false });
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.prisma.sessionExecutionLink.create.mock.calls.length).toBe(createsBefore);
    f.makeEvent('ev-late', [polar.id, hc.id], hc.id); // nova evidencia: a canonica passa a ser a observacao do Health Connect
    const moved = await f.service.reconcileEvent(polar.id);
    expect(moved).toMatchObject({ outcome: 'link_moved', canonicalActivityLogId: hc.id });
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ trainingSessionId: session.id, activityLogId: hc.id });
    expect(f.activityLogs.get(polar.id).executionClassification).toBeNull();
  });

  it('6. matched -> ambiguous: o vinculo automatico existente fica (so na observacao que o carregava), nenhuma observacao ganha um segundo vinculo/classificacao e a sessao fica intacta', async () => {
    const { service, hc, polar, addSession, activeLinks, activityLogs, sessions, prisma } = hcEventFixture();
    const session = addSession();
    await service.reconcileEvent(hc.id);
    expect(activeLinks()).toHaveLength(1);
    const link = { ...activeLinks()[0] };
    const sessionsBefore = sessionsSnapshot(sessions);
    // atualizacao de dados: o evento deixa de ser confirmado
    markAmbiguous(activityLogs, [polar.id, hc.id]);
    const linkWrites = () => prisma.sessionExecutionLink.create.mock.calls.length + prisma.sessionExecutionLink.update.mock.calls.length;
    const writesBefore = linkWrites();
    expect(await service.reconcileEvent(hc.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', changed: false });
    expect(await service.reconcileEvent(polar.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', changed: false });
    expect(linkWrites()).toBe(writesBefore); // nada reescrito, nada novo
    expect(activeLinks()).toHaveLength(1);
    expect(activeLinks()[0]).toMatchObject({ id: link.id, trainingSessionId: session.id, activityLogId: polar.id, status: 'active' });
    expect(activityLogs.get(hc.id).executionClassification).toBeNull(); // a outra observacao NAO vira execucao nem atividade adicional
    expect(sessionsSnapshot(sessions)).toBe(sessionsBefore);
    expect(prisma.trainingSession.update).not.toHaveBeenCalled();
  });

  it('7. ambiguous -> matched: dois vinculos automaticos que viram o mesmo evento colapsam em UM (a execucao conta uma vez); sessoes nao sao tocadas', async () => {
    const f = fixture();
    const polar = f.addActivity({ provider: 'polar' });
    const hc = f.addActivity({ provider: 'health_connect', startedAt: new Date('2026-10-06T10:00:02Z') });
    const s1 = f.addSession({ title: 'Longao' });
    const s2 = f.addSession({ title: 'Outra do dia', modality: 'corrida', distanceKm: 8 });
    // estado legado: cada observacao foi vinculada isoladamente a uma sessao diferente (antes de o evento ser reconhecido)
    f.links.set('l-polar', { id: 'l-polar', userId: 'u1', trainingSessionId: s1.id, activityLogId: polar.id, status: 'active', origin: 'automatic', note: null, createdAt: new Date(1000), revokedAt: null, supersededByLinkId: null });
    f.links.set('l-hc', { id: 'l-hc', userId: 'u1', trainingSessionId: s2.id, activityLogId: hc.id, status: 'active', origin: 'automatic', note: null, createdAt: new Date(2000), revokedAt: null, supersededByLinkId: null });
    Object.assign(f.activityLogs.get(polar.id), { executionClassification: 'corresponding', executionClassifiedBy: 'automatic' });
    Object.assign(f.activityLogs.get(hc.id), { executionClassification: 'corresponding', executionClassifiedBy: 'automatic' });
    const sessionsBefore = sessionsSnapshot(f.sessions);
    f.makeEvent('ev-res', [polar.id, hc.id], polar.id); // a identidade se resolve: mesma execucao fisica
    expect(await f.service.reconcileEvent(hc.id)).toMatchObject({ outcome: 'duplicate_links_collapsed', canonicalActivityLogId: polar.id });
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ id: 'l-polar', trainingSessionId: s1.id });
    expect(f.links.get('l-hc')).toMatchObject({ status: 'revoked', note: 'duplicate_of_same_physical_event' });
    expect(f.activityLogs.get(hc.id).executionClassification).toBeNull();
    expect(sessionsSnapshot(f.sessions)).toBe(sessionsBefore);
    expect(f.prisma.trainingSession.update).not.toHaveBeenCalled();
  });

  it('14. decisao e vinculo manuais sao preservados na chegada tardia da copia do Health Connect (nenhum vinculo automatico e adicionado)', async () => {
    const { service, hc, polar, addSession, activeLinks, links, prisma } = hcEventFixture();
    const session = addSession();
    await service.linkManually({ trainingSessionId: session.id, activityLogId: polar.id, origin: 'student' });
    const before = { ...activeLinks()[0] };
    const createsBefore = prisma.sessionExecutionLink.create.mock.calls.length;
    expect(await service.reconcileEvent(hc.id)).toMatchObject({ outcome: 'human_preserved' });
    expect(activeLinks()).toHaveLength(1);
    expect(activeLinks()[0]).toMatchObject({ id: before.id, origin: 'student', trainingSessionId: session.id, activityLogId: polar.id });
    expect(prisma.sessionExecutionLink.create.mock.calls.length).toBe(createsBefore);
    expect([...links.values()].filter((l) => l.origin === 'automatic' && l.status === 'active')).toHaveLength(0);
  });

  it('14b. decisao humana de "atividade adicional" (coach) tambem prevalece sobre a chegada tardia e a transicao para ambiguo', async () => {
    const { service, hc, polar, addSession, activityLogs, activeLinks, sessions } = hcEventFixture();
    addSession();
    Object.assign(activityLogs.get(polar.id), { executionClassification: 'alternative', executionClassifiedBy: 'coach' });
    const before = sessionsSnapshot(sessions);
    await service.reconcileEvent(hc.id);
    markAmbiguous(activityLogs, [polar.id, hc.id]);
    await service.reconcileEvent(hc.id);
    expect(activityLogs.get(polar.id)).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'coach' });
    expect(activeLinks()).toHaveLength(0);
    expect(sessionsSnapshot(sessions)).toBe(before);
  });

  it('8. duas corridas legitimas no mesmo dia (Polar de manha, Health Connect a noite) e uma sessao: seguem distintas, candidatas, sem vinculo forcado', async () => {
    const f = fixture();
    const morning = f.addActivity({ provider: 'polar', startedAt: new Date('2026-10-06T09:00:00Z') });
    const evening = f.addActivity({ provider: 'health_connect', startedAt: new Date('2026-10-06T21:00:00Z'), distanceMeters: 8000 });
    f.addSession();
    const before = sessionsSnapshot(f.sessions);
    expect(await f.service.reconcileEvent(morning.id)).toMatchObject({ classification: 'ambiguous', outcome: 'candidates' });
    expect(await f.service.reconcileEvent(evening.id)).toMatchObject({ classification: 'ambiguous', outcome: 'candidates' });
    expect(f.activeLinks()).toHaveLength(0);
    expect(sessionsSnapshot(f.sessions)).toBe(before);
  });
});

// ---- D1 (opcao B) — identidade AMBIGUA: uma execucao por par, sem bloquear atividade legitima -----------------------------------------------
// Regra: observacao de identidade ambigua = possivel duplicata (nao comprovada). Se outra observacao do par ja' carrega uma execucao, esta NAO
// e' classificada automaticamente como segunda execucao (fica preservada, sem contar, passivel de resolucao); se nenhuma carrega, UMA e'
// classificada de forma conservadora. Humano (aluno/treinador) prevalece e pode confirmar que sao execucoes distintas.
function mutualEvidence(activityLogs: Map<string, any>, ids: string[]) {
  for (const id of ids) {
    Object.assign(activityLogs.get(id), {
      physicalIdentityEvidence: {
        version: 1,
        comparisons: ids.filter((other) => other !== id).map((other) => ({ activityLogId: other, provider: activityLogs.get(other).provider, verdict: 'ambiguous', reason: 'metric_divergence_at_same_time', criteria: [] })),
      },
    });
  }
}

function ambiguousPair() {
  const f = fixture();
  const polar = f.addActivity({ provider: 'polar', physicalIdentityStatus: 'ambiguous' });
  const hc = f.addActivity({ provider: 'health_connect', physicalIdentityStatus: 'ambiguous', startedAt: new Date('2026-10-06T10:00:02Z') });
  mutualEvidence(f.activityLogs, [polar.id, hc.id]);
  const classified = () => [polar, hc].filter((a) => ['corresponding', 'alternative'].includes(f.activityLogs.get(a.id).executionClassification));
  return { ...f, polar, hc, classified };
}

describe('D1 — identidade ambigua: sem dupla contabilizacao e sem bloquear atividade legitima', () => {
  it('par ambiguo com uma observacao JA classificada: a outra nao e classificada como segunda execucao (classify e reconcileEvent), registros preservados', async () => {
    const f = ambiguousPair();
    Object.assign(f.activityLogs.get(f.hc.id), { executionClassification: 'alternative', executionClassifiedBy: 'automatic' });
    const before = sessionsSnapshot(f.sessions);
    expect(await f.service.classify(f.polar.id)).toBeNull();
    expect(await f.service.reconcileEvent(f.polar.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', changed: false });
    expect(f.activityLogs.get(f.polar.id).executionClassification).toBeNull();
    expect(f.activityLogs.get(f.hc.id).executionClassification).toBe('alternative'); // classificacao existente preservada
    expect(f.classified()).toHaveLength(1);
    expect(f.activityLogs.size).toBe(2); // nada apagado nem unido
    expect(sessionsSnapshot(f.sessions)).toBe(before);
  });

  it('par ambiguo com uma observacao ja VINCULADA a sessao: a outra nao vira "atividade adicional" nem segundo vinculo (a sessao conta uma vez)', async () => {
    const f = ambiguousPair();
    const session = f.addSession();
    await f.service.linkManually({ trainingSessionId: session.id, activityLogId: f.hc.id, origin: 'automatic', matchMethod: 'automatic_single_candidate' });
    const before = sessionsSnapshot(f.sessions);
    expect(await f.service.classify(f.polar.id)).toBeNull();
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ activityLogId: f.hc.id, trainingSessionId: session.id });
    expect(f.activityLogs.get(f.polar.id).executionClassification).toBeNull();
    expect(sessionsSnapshot(f.sessions)).toBe(before);
    expect(f.prisma.trainingSession.update).not.toHaveBeenCalled();
  });

  it('par ambiguo inicialmente SEM classificacao: so a primeira e classificada (conservador, regras atuais); a segunda fica preservada — em qualquer ordem de chegada', async () => {
    for (const order of [['polar', 'hc'], ['hc', 'polar']] as const) {
      const f = ambiguousPair();
      const session = f.addSession();
      const byName = { polar: f.polar, hc: f.hc };
      expect(await f.service.classify(byName[order[0]].id)).toBe('corresponding'); // unica sessao compativel do dia: o par e' tratado como a mesma execucao
      expect(await f.service.classify(byName[order[1]].id)).toBeNull();
      expect(f.classified()).toHaveLength(1);
      expect(f.activeLinks()).toHaveLength(1);
      expect(f.activeLinks()[0]).toMatchObject({ activityLogId: byName[order[0]].id, trainingSessionId: session.id });
      expect(await f.service.classify(byName[order[1]].id)).toBeNull(); // idempotente
      expect(f.classified()).toHaveLength(1);
    }
  });

  it('par ambiguo sem classificacao e sem prescricao: uma unica atividade adicional (nao duas); via reconcileEvent (Apple) o resultado e o mesmo', async () => {
    const f = ambiguousPair();
    expect(await f.service.reconcileEvent(f.polar.id)).toMatchObject({ outcome: 'classified_ambiguous_identity', classification: 'alternative', changed: true });
    expect(await f.service.reconcileEvent(f.hc.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', changed: false });
    expect(f.classified()).toHaveLength(1);
    expect(await f.service.reconcileEvent(f.polar.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', changed: false }); // idempotente
  });

  it('historico: reconciliar o historico de um par ambiguo classifica exatamente UMA observacao e a segunda execucao nao muda nada; dryRun nao grava', async () => {
    const f = ambiguousPair();
    f.addSession();
    const dry = await f.service.reconcileUserHistory('u1', { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(f.classified()).toHaveLength(0);
    const first = await f.service.reconcileUserHistory('u1');
    expect(first.changed).toBe(1);
    expect(f.classified()).toHaveLength(1);
    const second = await f.service.reconcileUserHistory('u1');
    expect(second.changed).toBe(0);
    expect(f.classified()).toHaveLength(1);
  });

  it('decisoes manuais tem prioridade: vinculo do aluno ou "adicional" do treinador numa observacao do par impedem a outra de ser classificada automaticamente', async () => {
    const student = ambiguousPair();
    const session = student.addSession();
    await student.service.linkManually({ trainingSessionId: session.id, activityLogId: student.polar.id, origin: 'student' });
    expect(await student.service.classify(student.hc.id)).toBeNull();
    expect(student.activeLinks()).toHaveLength(1);
    expect(student.activeLinks()[0]).toMatchObject({ origin: 'student', activityLogId: student.polar.id });
    const coach = ambiguousPair();
    await coach.service.markExtra({ activityLogId: coach.polar.id, origin: 'coach' });
    expect(await coach.service.classify(coach.hc.id)).toBeNull();
    expect(coach.activityLogs.get(coach.polar.id)).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'coach' });
  });

  it('so o par ambiguo bloqueia: outra atividade classificada que NAO e do par (ou cujo par ja foi resolvido) nao impede a classificacao', async () => {
    const f = fixture();
    const alone = f.addActivity({ provider: 'polar', physicalIdentityStatus: 'ambiguous' }); // ambigua sem par registrado (legado/sem evidencia)
    f.addActivity({ provider: 'garmin', physicalIdentityStatus: 'unique', executionClassification: 'alternative', executionClassifiedBy: 'automatic', startedAt: new Date('2026-10-06T10:00:30Z') });
    expect(await f.service.classify(alone.id)).toBe('alternative');
    const g = ambiguousPair();
    Object.assign(g.activityLogs.get(g.hc.id), { physicalIdentityStatus: 'unique', executionClassification: 'alternative', executionClassifiedBy: 'automatic' }); // o par foi resolvido: nao e mais ambiguo
    expect(await g.service.classify(g.polar.id)).toBe('alternative'); // vizinha defasada na evidencia nao bloqueia
  });

  it('resolucao MANUAL confirmando duas atividades DISTINTAS: a bloqueada passa a contar por decisao humana, sem reaproveitar a sessao da outra; idempotente', async () => {
    const f = ambiguousPair();
    const session = f.addSession();
    await f.service.linkManually({ trainingSessionId: session.id, activityLogId: f.polar.id, origin: 'automatic', matchMethod: 'automatic_single_candidate' });
    expect(await f.service.classify(f.hc.id)).toBeNull();
    const before = sessionsSnapshot(f.sessions);
    const result = await f.service.confirmDistinctActivity({ userId: 'u1', activityLogId: f.hc.id, origin: 'coach' });
    expect(result).toMatchObject({ classification: 'alternative', changed: true }); // a sessao ja' esta cumprida pela outra: esta e' atividade adicional
    expect(f.activityLogs.get(f.hc.id)).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'coach' });
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ activityLogId: f.polar.id, trainingSessionId: session.id });
    expect(f.classified()).toHaveLength(2); // as duas execucoes contam, por decisao humana
    expect(await f.service.confirmDistinctActivity({ userId: 'u1', activityLogId: f.hc.id, origin: 'coach' })).toMatchObject({ changed: false });
    expect(await f.service.classify(f.hc.id)).toBe('alternative'); // classify nao desfaz a decisao
    expect(await f.service.reconcileEvent(f.hc.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', classification: 'alternative' });
    expect(sessionsSnapshot(f.sessions)).toBe(before);
  });

  it('confirmar distinta com OUTRA sessao compativel livre no dia: vincula a ela por decisao humana (nunca a sessao ja cumprida pela vizinha)', async () => {
    const f = ambiguousPair();
    const first = f.addSession({ title: 'Manha' });
    await f.service.linkManually({ trainingSessionId: first.id, activityLogId: f.polar.id, origin: 'automatic' });
    const second = f.addSession({ title: 'Noite' });
    const result = await f.service.confirmDistinctActivity({ userId: 'u1', activityLogId: f.hc.id, origin: 'coach' });
    expect(result).toMatchObject({ classification: 'corresponding', changed: true });
    expect(f.activeLinks().map((l) => [l.activityLogId, l.trainingSessionId, l.origin]).sort()).toEqual([[f.hc.id, second.id, 'coach'], [f.polar.id, first.id, 'automatic']].sort());
  });

  it('confirmar distinta so vale para observacao de identidade ambigua do proprio aluno', async () => {
    const f = fixture();
    const unique = f.addActivity({ provider: 'polar', physicalIdentityStatus: 'unique' });
    await expect(f.service.confirmDistinctActivity({ userId: 'u1', activityLogId: unique.id, origin: 'coach' })).rejects.toThrow(/ambigua/);
    const g = ambiguousPair();
    await expect(g.service.confirmDistinctActivity({ userId: 'outro', activityLogId: g.hc.id, origin: 'coach' })).rejects.toThrow(/nao encontrada/);
  });

  it('resolucao POSTERIOR confirmando uma unica atividade: a identidade vira matched, o vinculo acompanha a canonica e a copia nunca vira segunda execucao', async () => {
    const f = ambiguousPair();
    const session = f.addSession();
    await f.service.classify(f.polar.id);
    expect(await f.service.classify(f.hc.id)).toBeNull();
    f.makeEvent('ev-resolved', [f.polar.id, f.hc.id], f.polar.id); // o dado se corrige: mesma execucao fisica
    expect(await f.service.reconcileEvent(f.hc.id)).toMatchObject({ outcome: 'unchanged', canonicalActivityLogId: f.polar.id, changed: false });
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activityLogs.get(f.hc.id).executionClassification).toBeNull();
    f.makeEvent('ev-resolved', [f.polar.id, f.hc.id], f.hc.id); // e a canonica passa a ser a outra observacao
    expect(await f.service.reconcileEvent(f.polar.id)).toMatchObject({ outcome: 'link_moved', canonicalActivityLogId: f.hc.id });
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ activityLogId: f.hc.id, trainingSessionId: session.id });
  });
});

// ---- D2 — reconciliar os membros afetados quando a identidade muda ----------------------------------------------------------------------
// reconcileAffectedByIdentity recebe o que a avaliacao de identidade informa ({affectedActivityLogIds}) e reconcilia so' o que mudou, uma vez por
// evento, com os servicos existentes; a observacao que chegou (handled) ja' foi tratada pelo adaptador.
describe('D2 — reconcileAffectedByIdentity apos mudanca de identidade', () => {
  const split = (f: ReturnType<typeof hcEventFixture>) => {
    for (const id of [f.polar.id, f.hc.id]) Object.assign(f.activityLogs.get(id), { physicalEventId: null, physicalIdentityStatus: 'unique', physicalCanonicalActivityLogId: null });
  };
  const writes = (f: ReturnType<typeof hcEventFixture>) =>
    f.prisma.activityLog.update.mock.calls.length + f.prisma.sessionExecutionLink.create.mock.calls.length + f.prisma.sessionExecutionLink.update.mock.calls.length;

  it('matched -> unique (evento desfeito): a observacao que ficara sem classificacao e reconciliada e passa a contar como execucao propria; a outra nao muda; idempotente', async () => {
    const f = hcEventFixture();
    const session = f.addSession();
    await f.service.reconcileEvent(f.hc.id); // evento matched: so' a canonica (Polar) carrega o vinculo
    expect(f.activityLogs.get(f.hc.id).executionClassification).toBeNull();
    const before = sessionsSnapshot(f.sessions);
    split(f); // atualizacao de dados: duas execucoes distintas
    await f.service.classify(f.polar.id); // gatilho normal do adaptador (a observacao que chegou)
    expect(f.activityLogs.get(f.hc.id).executionClassification).toBeNull(); // sem D2 ficaria assim para sempre
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, f.polar.id);
    expect(f.activityLogs.get(f.hc.id)).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'automatic' }); // a sessao ja' estava cumprida pela Polar
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ activityLogId: f.polar.id, trainingSessionId: session.id });
    expect(sessionsSnapshot(f.sessions)).toBe(before);
    const settled = writes(f);
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, f.polar.id); // reconciliacao repetida
    expect(writes(f)).toBe(settled);
  });

  it('matched -> ambiguous: o par fica com uma unica execucao (vinculo existente preservado); a outra nao e classificada', async () => {
    const f = hcEventFixture();
    f.addSession();
    await f.service.reconcileEvent(f.hc.id);
    markAmbiguous(f.activityLogs, [f.polar.id, f.hc.id]);
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, null);
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0].activityLogId).toBe(f.polar.id);
    expect(f.activityLogs.get(f.hc.id).executionClassification).toBeNull();
    expect(f.activityLogs.get(f.polar.id).executionClassification).toBe('corresponding');
  });

  it('ambiguous -> matched: reconcilia o evento UMA vez (mesmo com varios membros afetados) e o vinculo duplicado colapsa', async () => {
    const f = ambiguousPair();
    const s1 = f.addSession({ title: 'Longao' });
    f.addSession({ title: 'Outra', distanceKm: 8 });
    await f.service.linkManually({ trainingSessionId: s1.id, activityLogId: f.polar.id, origin: 'automatic' });
    await f.service.confirmDistinctActivity({ userId: 'u1', activityLogId: f.hc.id, origin: 'coach' }); // execucao distinta confirmada pelo humano (vinculada a outra sessao do dia)
    expect(f.activeLinks()).toHaveLength(2);
    // os dados se corrigem e as duas passam a ser a MESMA execucao
    f.makeEvent('ev-merged', [f.polar.id, f.hc.id], f.polar.id);
    const spy = jest.spyOn(f.service, 'reconcileEvent');
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, null);
    expect(spy).toHaveBeenCalledTimes(1); // um evento = uma reconciliacao
    expect(f.activeLinks().filter((l) => l.origin === 'coach')).toHaveLength(1); // decisao humana prevalece sobre a automatica do mesmo evento
    expect(f.activeLinks()).toHaveLength(1);

  });

  it('mudanca da canonica: o vinculo automatico acompanha sem segunda execucao; a observacao ja tratada pelo adaptador nao e reprocessada', async () => {
    const f = hcEventFixture();
    const session = f.addSession();
    await f.service.reconcileEvent(f.polar.id);
    f.makeEvent('ev-hc', [f.polar.id, f.hc.id], f.hc.id); // nova observacao canonica
    const spy = jest.spyOn(f.service, 'reconcileEvent');
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, f.hc.id);
    expect(spy).not.toHaveBeenCalled(); // ambos pertencem ao evento que o adaptador ja' reconciliou
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, null); // ex.: troca de fonte primaria
    expect(spy).toHaveBeenCalledTimes(1);
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ activityLogId: f.hc.id, trainingSessionId: session.id });
  });

  it('chegada tardia de outra fonte: nenhum vinculo extra e nenhuma segunda execucao; sem mudanca de identidade nada e lido nem escrito', async () => {
    const f = fixture();
    const polar = f.addActivity({ provider: 'polar' });
    f.addSession();
    await f.service.classify(polar.id);
    const hc = f.addActivity({ provider: 'health_connect', startedAt: new Date('2026-10-06T10:00:02Z') });
    f.makeEvent('ev-late', [polar.id, hc.id], polar.id);
    await f.service.classify(hc.id); // adaptador: matched -> reconcileEvent do evento
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [polar.id, hc.id] }, hc.id);
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activityLogs.get(hc.id).executionClassification).toBeNull();
    const reads = f.prisma.activityLog.findMany.mock.calls.length;
    const updates = f.prisma.activityLog.update.mock.calls.length;
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [] }, hc.id); // reavaliacao sem mudanca: nada afetado
    await f.service.reconcileAffectedByIdentity(null, hc.id);
    expect(f.prisma.activityLog.findMany.mock.calls.length).toBe(reads);
    expect(f.prisma.activityLog.update.mock.calls.length).toBe(updates);
  });

  it('vinculos e decisoes manuais sao preservados durante a reconciliacao dos afetados', async () => {
    const f = hcEventFixture();
    const session = f.addSession();
    await f.service.linkManually({ trainingSessionId: session.id, activityLogId: f.polar.id, origin: 'student' });
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, null);
    expect(f.activeLinks()).toHaveLength(1);
    expect(f.activeLinks()[0]).toMatchObject({ origin: 'student', activityLogId: f.polar.id });
    split(f);
    await f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, null);
    expect(f.activeLinks().filter((l) => l.origin === 'student')).toHaveLength(1); // a decisao do aluno segue de pe
    expect(f.activityLogs.get(f.polar.id)).toMatchObject({ executionClassification: 'corresponding', executionClassifiedBy: 'student' });
  });

  it('falha ao reconciliar uma observacao nunca derruba a ingestao nem impede as demais', async () => {
    const f = hcEventFixture();
    f.addSession();
    split(f);
    const spy = jest.spyOn(f.service, 'reconcileEvent').mockRejectedValueOnce(new Error('falha simulada'));
    await expect(f.service.reconcileAffectedByIdentity({ affectedActivityLogIds: [f.polar.id, f.hc.id] }, null)).resolves.toBe(false); // nunca lanca; false = alguma falhou (o chamador nao carimba a decisao)
    expect(spy).toHaveBeenCalledTimes(2);
    expect(f.prisma.trainingSession.update).not.toHaveBeenCalled();
  });
});
