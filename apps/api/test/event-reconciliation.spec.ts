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

  it('identidade ambigua nao e reconciliada automaticamente (evita contar a mesma execucao duas vezes)', async () => {
    const f = fixture();
    const a = f.addActivity({ physicalIdentityStatus: 'ambiguous' });
    f.addSession();
    expect(await f.service.reconcileEvent(a.id)).toMatchObject({ outcome: 'skipped_identity_ambiguous', changed: false });
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
