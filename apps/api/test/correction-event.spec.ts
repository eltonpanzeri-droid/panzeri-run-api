import { Logger } from '@nestjs/common';
import { buildCorrectionEvents, CorrectionEventData, netLinkChanges } from '../src/training-plans/correction-event';
import { ProfileEventCode, StudentProfileService } from '../src/training-plans/student-profile.service';
import { correctionHooks, CorrectionContext, LinkChange } from '../src/activity-execution/correction-hooks';

// Evento corretivo do Prontuario (EXECUTION_LINK_CORRECTED): so' quando algo mudou DE FATO, sempre acrescentado, com o que mudou, quando, quem fez e o que passa
// a valer; em massa, evento resumido com rastreabilidade; edicao de treino com feedback tambem; nunca para exclusao de dados do provedor; sem medalhas.

const USER = 'u1';
const SINCE = new Date('2026-10-17T14:00:00Z');
const AT = new Date('2026-10-17T14:32:00Z');
const BEFORE = new Date('2026-10-12T20:00:00Z');
const AFTER = new Date('2026-10-17T14:20:00Z');

const change = (linkId: string, sessionId: string, activityId: string, extra: Partial<LinkChange> = {}): LinkChange => ({ linkId, trainingSessionId: sessionId, activityLogId: activityId, status: 'active', origin: 'automatic', note: null, createdAt: BEFORE, revokedAt: null, ...extra });
const context = (extra: Partial<CorrectionContext> = {}): CorrectionContext => ({ userId: USER, kind: 'link_correction', origin: 'student', actorId: USER, at: AT, since: SINCE, sessionIds: [], activityLogIds: [], completionsChanged: false, changes: [], affectedDates: [], ...extra });
const data = (): CorrectionEventData => ({
  sessions: new Map([
    ['s-sun', { title: 'Corrida', scheduledDate: new Date('2026-10-11T00:00:00Z'), modality: 'corrida' }],
    ['s-wed', { title: 'Musculação', scheduledDate: new Date('2026-10-14T00:00:00Z'), modality: 'forca' }],
  ]),
  activities: new Map([['act-1', { startedAt: new Date('2026-10-11T09:30:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceMeters: 28_000, durationSec: 9060 }]]),
});

describe('netLinkChanges: so' + " o que mudou de fato (estado final x inicial)", () => {
  it('vinculo desfeito: antes = sessao, depois = nenhum', () => {
    const nets = netLinkChanges([change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER })], SINCE);
    expect(nets).toEqual([{ activityLogId: 'act-1', beforeSessionId: 's-sun', afterSessionId: null }]);
  });

  it('atividade extra que foi vinculada: antes = nenhum, depois = sessao', () => {
    expect(netLinkChanges([change('l1', 's-sun', 'act-1', { createdAt: AFTER })], SINCE)).toEqual([{ activityLogId: 'act-1', beforeSessionId: null, afterSessionId: 's-sun' }]);
  });

  it('troca de sessao: antes = uma, depois = outra', () => {
    const nets = netLinkChanges([change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER }), change('l2', 's-wed', 'act-1', { createdAt: AFTER })], SINCE);
    expect(nets).toEqual([{ activityLogId: 'act-1', beforeSessionId: 's-sun', afterSessionId: 's-wed' }]);
  });

  it('desvincular e vincular DE NOVO a mesma sessao termina igual: NADA mudou (sem evento)', () => {
    const nets = netLinkChanges([change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER }), change('l2', 's-sun', 'act-1', { createdAt: new Date('2026-10-17T14:25:00Z') })], SINCE);
    expect(nets).toEqual([]);
  });

  it('vinculo criado e revogado dentro da propria correcao (sem existir antes): nada mudou', () => {
    expect(netLinkChanges([change('l1', 's-sun', 'act-1', { createdAt: AFTER, status: 'revoked', revokedAt: new Date('2026-10-17T14:21:00Z') })], SINCE)).toEqual([]);
  });

  it('vinculo preexistente que nao foi tocado nao e mudanca', () => {
    expect(netLinkChanges([change('l1', 's-sun', 'act-1')], SINCE)).toEqual([]);
  });
});

describe('buildCorrectionEvents', () => {
  it('desvinculo pelo aluno: data/hora (Brasilia), quem, o que constava antes, o que passa a valer e referencias — e o registro antigo e tratado como historico', () => {
    const [event] = buildCorrectionEvents(context({ changes: [change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER })] }), data());
    expect(event.header).toBe('Correção de vínculo registrada em 17/10/2026 11:32, feita pelo aluno.');
    expect(event.body).toContain('a atividade de 11/10/2026, corrida, 28,0 km, 2h31min constava como cumprimento do treino prescrito de 11/10/2026 (Corrida); agora é atividade extra');
    expect(event.body).toContain('Passa a valer o estado "agora"');
    expect(event.body).toContain('permanece como histórico e não deve ser tratado como fato atual');
    expect(event.body).toContain('Ref: atividade=act-1 antes=s-sun');
  });

  it('quem fez: treinador e sistema aparecem como tal', () => {
    const changes = [change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER })];
    expect(buildCorrectionEvents(context({ origin: 'coach', changes }), data())[0].header).toContain('feita pelo treinador');
    expect(buildCorrectionEvents(context({ origin: 'system', changes }), data())[0].header).toContain('feita pelo sistema');
  });

  it('vinculo novo (extra -> treino) e troca de treino tem textos proprios', () => {
    const [linked] = buildCorrectionEvents(context({ changes: [change('l1', 's-wed', 'act-1', { createdAt: AFTER })] }), data());
    expect(linked.body).toContain('era atividade extra; agora cumpre o treino prescrito de 14/10/2026 (Musculação)');
    const [swapped] = buildCorrectionEvents(context({ changes: [change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER }), change('l2', 's-wed', 'act-1', { createdAt: AFTER })] }), data());
    expect(swapped.body).toContain('constava como cumprimento do treino prescrito de 11/10/2026 (Corrida); agora cumpre o treino prescrito de 14/10/2026 (Musculação)');
  });

  it('NADA mudou de fato: nenhum evento (correcao que termina igual, sem since, sem alteracao)', () => {
    expect(buildCorrectionEvents(context({ changes: [change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER }), change('l2', 's-sun', 'act-1', { createdAt: new Date('2026-10-17T14:25:00Z') })] }), data())).toEqual([]);
    expect(buildCorrectionEvents(context({ since: null, changes: [change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER })] }), data())).toEqual([]);
    expect(buildCorrectionEvents(context(), data())).toEqual([]);
  });

  it('operacao em massa: UM evento resumido (contagens, amostra de 5, referencias), nao um por vinculo', () => {
    const changes = Array.from({ length: 12 }, (_, i) => change(`l${i}`, `s-${i}`, `act-${i}`, { status: 'revoked', revokedAt: AFTER }));
    const events = buildCorrectionEvents(context({ kind: 'bulk_reconcile', origin: 'coach', changes }), data());
    expect(events).toHaveLength(1);
    expect(events[0].header).toContain('em lote');
    expect(events[0].body).toContain('12 atividades tiveram o vínculo com treinos prescritos alterado (0 vinculada(s), 12 desvinculada(s), 0 trocada(s))');
    expect(events[0].body.match(/Exemplo:/g)).toHaveLength(5);
    expect(events[0].body).toContain('... e mais 7.');
    expect(events[0].body).toContain('Ref (até 25):');
  });

  it('edicao de treino pelo treinador em sessao COM feedback: antes/depois dos campos que mudaram; sem feedback nem vinculo: nada', () => {
    const edit = { sessionId: 's-sun', fields: { modality: { before: 'corrida', after: 'forca' }, durationMin: { before: 40, after: 50 } }, hasFeedback: true, hasActiveLink: false };
    const [event] = buildCorrectionEvents(context({ kind: 'session_edit', origin: 'coach', since: null, sessionEdit: edit }), data());
    expect(event.header).toBe('Edição de treino registrada em 17/10/2026 11:32, feita pelo treinador.');
    expect(event.body).toContain('feedback do aluno');
    expect(event.body).toContain('modalidade: corrida → forca; duração (min): 40 → 50');
    expect(event.body).toContain('o feedback e a execução registrados continuam como estavam');
    expect(buildCorrectionEvents(context({ kind: 'session_edit', origin: 'coach', since: null, sessionEdit: { ...edit, hasFeedback: false } }), data())).toEqual([]);
    expect(buildCorrectionEvents(context({ kind: 'session_edit', origin: 'coach', since: null, sessionEdit: { ...edit, fields: {} } }), data())).toEqual([]);
  });

  it('medalhas nunca entram no texto do Prontuario', () => {
    const [event] = buildCorrectionEvents(context({ changes: [change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER })] }), data());
    expect(`${event.header}\n${event.body}`).not.toMatch(/medalha|conquista/i);
  });
});

describe('StudentProfileService.recordCorrectionEvents', () => {
  function build(recent: Array<{ content: string }> = []) {
    const created: Array<{ code: string; content: string }> = [];
    const prisma: any = {
      trainingSession: { findMany: jest.fn(async () => [{ id: 's-sun', title: 'Corrida', scheduledDate: new Date('2026-10-11T00:00:00Z'), modality: 'corrida' }]) },
      activityLog: { findMany: jest.fn(async () => [{ id: 'act-1', startedAt: new Date('2026-10-11T09:30:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceMeters: 28_000, durationSec: 9060 }]) },
      studentProfileEvent: {
        findMany: jest.fn(async () => recent),
        create: jest.fn(async ({ data: row }: any) => { created.push({ code: row.code, content: row.content }); return row; }),
      },
    };
    return { service: new StudentProfileService(prisma, {} as never), prisma, created };
  }
  const unlink = context({ changes: [change('l1', 's-sun', 'act-1', { status: 'revoked', revokedAt: AFTER })] });

  it('acrescenta o evento EXECUTION_LINK_CORRECTED (cabecalho + corpo) e nunca altera/apaga eventos anteriores', async () => {
    const { service, prisma, created } = build();
    prisma.studentProfileEvent.update = jest.fn(); prisma.studentProfileEvent.delete = jest.fn(); prisma.studentProfileEvent.deleteMany = jest.fn(); prisma.studentProfileEvent.updateMany = jest.fn();
    expect(await service.recordCorrectionEvents(unlink)).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].code).toBe(ProfileEventCode.EXECUTION_LINK_CORRECTED);
    expect(created[0].content.split('\n')[0]).toContain('Correção de vínculo registrada em 17/10/2026');
    for (const fn of [prisma.studentProfileEvent.update, prisma.studentProfileEvent.delete, prisma.studentProfileEvent.deleteMany, prisma.studentProfileEvent.updateMany]) expect(fn).not.toHaveBeenCalled();
  });

  it('mesmo processamento acionado duas vezes (mesmo corpo na janela de 10 min): nao duplica', async () => {
    const first = build();
    await first.service.recordCorrectionEvents(unlink);
    const again = build([{ content: first.created[0].content }]);
    expect(await again.service.recordCorrectionEvents(unlink)).toBe(0);
    expect(again.created).toHaveLength(0);
  });

  it('sem mudanca efetiva ou exclusao de dados do provedor: nenhum evento (e nenhuma consulta)', async () => {
    const { service, prisma, created } = build();
    expect(await service.recordCorrectionEvents(context())).toBe(0);
    expect(await service.recordCorrectionEvents(context({ kind: 'provider_data_deleted', origin: 'system', absenceOfData: true, changes: unlink.changes }))).toBe(0);
    expect(created).toHaveLength(0);
    expect(prisma.trainingSession.findMany).not.toHaveBeenCalled();
  });

  it('registra o gancho do Prontuario ao iniciar e ele grava o evento quando a correcao acontece', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, created } = build();
    service.onModuleInit();
    expect(correctionHooks.names()).toContain('prontuario');
    await correctionHooks.run(unlink);
    expect(created).toHaveLength(1);
    correctionHooks.clear();
  });
});
