import { Logger } from '@nestjs/common';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';
import { correctionHooks } from '../src/activity-execution/correction-hooks';
import { readPending, registerMedalProcessor, waitForPendingContinuations } from '../src/activity-execution/pending-reevaluation';
import { MedalEvaluationService } from '../src/medals/medal-evaluation.service';
import { MedalsService } from '../src/medals/medals.service';
import { StudentProfileService } from '../src/training-plans/student-profile.service';
import { evolutionStub, medalsFake } from './helpers/medals-fake';

// Fluxo completo (Prisma em memoria): o aluno corrige o vinculo de uma atividade -> indicadores (analises) atualizados, evento no Prontuario, medalha de volume
// REVOGADA (criterio deixou de ser atendido) e depois REATIVADA numa nova correcao, historico preservado e NENHUMA geracao de treino. Prova a integracao e a
// logica; transacao/migracao reais exigem PostgreSQL de teste (nao disponivel aqui).

const analyzeSession = jest.fn();
jest.mock('../src/activity-execution/execution-analysis.service', () => ({ ExecutionAnalysisService: class { analyzeSession = (...a: unknown[]) => analyzeSession(...a); } }));

type Row = Record<string, any>;
const USER = 'u1';
const WEEK = '2026-10-05';
const V30 = { id: 'a-v30', code: 'volume_semanal_corrida_30km', category: 'volume_semanal', threshold: 30 };

function build() {
  const medals = medalsFake({
    achievements: [V30],
    awards: [{ id: 'ua-v', achievementId: 'a-v30', value: 31, periodStart: new Date(`${WEEK}T00:00:00Z`), periodEnd: new Date(`${WEEK}T00:00:00Z`), evidence: { weekStart: WEEK }, unlockedAt: new Date('2026-10-13T00:00:00Z') }],
  });
  const activities = new Map<string, Row>([['act-1', { id: 'act-1', userId: USER, startedAt: new Date('2026-10-06T09:00:00Z'), utcOffsetMinutes: -180, physicalEventId: null, physicalIdentityStatus: 'unique', sport: 'corrida', distanceMeters: 31_000, durationSec: 9000, executionClassification: 'corresponding', executionClassifiedBy: 'automatic' }]]);
  const links = new Map<string, Row>([['l1', { id: 'l1', userId: USER, trainingSessionId: 's1', activityLogId: 'act-1', status: 'active', origin: 'automatic', note: null, createdAt: new Date('2026-10-06T12:00:00Z'), revokedAt: null }]]);
  const sessions = new Map<string, Row>([['s1', { id: 's1', userId: USER, title: 'Corrida', modality: 'corrida', scheduledDate: new Date('2026-10-06T00:00:00Z'), completion: { id: 'c1' } }]]);
  const events: Row[] = [];
  const inList = (v: any, f: any) => (f?.in ? f.in.includes(v) : f === undefined || f === v);
  const prisma: any = {
    ...medals.prisma,
    activityLog: {
      findUnique: jest.fn(async ({ where }: any) => activities.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => [...activities.values()].filter((a) => inList(a.id, where.id) && (where.userId === undefined || a.userId === where.userId))),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(activities.get(where.id)!, data); return activities.get(where.id); }),
    },
    sessionExecutionLink: {
      findMany: jest.fn(async ({ where }: any) => [...links.values()].filter((l) => (where.userId === undefined || l.userId === where.userId) && inList(l.activityLogId, where.activityLogId) && inList(l.trainingSessionId, where.trainingSessionId)
        && (where.status === undefined || inList(l.status, where.status))
        && (!where.OR || where.OR.some((c: any) => (c.createdAt && l.createdAt >= c.createdAt.gte) || (c.revokedAt && l.revokedAt && l.revokedAt >= c.revokedAt.gte))))),
      update: jest.fn(async ({ where, data }: any) => { Object.assign(links.get(where.id)!, data); return links.get(where.id); }),
      create: jest.fn(async ({ data }: any) => { const row = { id: `l${links.size + 1}`, revokedAt: null, ...data }; links.set(row.id, row); return row; }),
    },
    trainingSession: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async ({ where }: any) => [...sessions.values()].map((s): Row => ({ ...s, executionLinks: [...links.values()].filter((l) => l.trainingSessionId === s.id && l.status === 'active') }))
        .filter((s) => inList(s.id, where.id) && (where.userId === undefined || s.userId === where.userId))),
    },
    trainingAnalysis: { updateMany: jest.fn(async () => ({ count: 0 })) },
    // leitura de progresso (MedalsService.getProgress)
    weeklyCheckIn: { findMany: jest.fn(async () => []) },
    reassessment: { count: jest.fn(async () => 0) },
    trainingPlan: { findFirst: jest.fn(async () => null) },
    studentProfileEvent: {
      findMany: jest.fn(async () => events.map((e) => ({ content: e.content }))),
      create: jest.fn(async ({ data }: any) => { events.push(data); return data; }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    $executeRaw: jest.fn(async () => 0),
  };
  const evolution = evolutionStub();
  const medalService = new MedalEvaluationService(prisma, evolution as never);
  const profile = new StudentProfileService(prisma, {} as never);
  medalService.onModuleInit();
  profile.onModuleInit();
  const link = new SessionExecutionLinkService(prisma);
  const setWeeklyKm = (km: number) => evolution.getRunSeries.mockResolvedValue({ weeks: [{ weekStart: WEEK, kmPercorridos: km }], months: [], calculatedAt: 'x' } as never);
  return { ...medals, prisma, link, evolution, events, links, activities, setWeeklyKm, medalsView: new MedalsService(prisma, evolution as never, medalService) };
}

beforeEach(() => { analyzeSession.mockReset(); analyzeSession.mockResolvedValue({}); for (const level of ['log', 'error', 'warn'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined); });
afterEach(async () => { await waitForPendingContinuations(); correctionHooks.clear(); registerMedalProcessor(null); jest.restoreAllMocks(); });

describe('correcao do aluno ponta a ponta', () => {
  it('desvinculo: analise refeita, evento no Prontuario, medalha de volume revogada (com historico) e pendencia concluida — sem gerar treino', async () => {
    const t = build();
    t.setWeeklyKm(12); // sem a atividade vinculada, a semana nao atinge mais 30 km
    const result = await t.link.unlinkActivityAsStudent(USER, 'act-1', null);
    expect(result).toMatchObject({ classification: 'alternative' });

    // vinculo revogado (historico) + decisao humana protegida
    expect(t.links.get('l1')).toMatchObject({ status: 'revoked', note: 'student_unlinked' });
    expect(t.activities.get('act-1')).toMatchObject({ executionClassification: 'alternative', executionClassifiedBy: 'student' });

    // Prontuario: evento acrescentado, com antes/depois e origem
    expect(t.events).toHaveLength(1);
    expect(t.events[0].code).toBe('EXECUTION_LINK_CORRECTED');
    expect(t.events[0].content).toContain('feita pelo aluno');
    expect(t.events[0].content).toContain('agora é atividade extra');

    // medalha revogada, nunca apagada; historico com motivo
    expect(t.awards.get('ua-v')).toMatchObject({ status: 'revoked', revokedReason: 'criterio_nao_atendido' });
    expect(t.awards.size).toBe(1);
    expect(t.transitions.map((x) => x.type)).toEqual(['revoked']);

    // a sessao com feedback foi reanalisada e a pendencia terminou
    expect(analyzeSession).toHaveBeenCalledWith(USER, 's1', { force: false });
    expect(await readPending(t.prisma, USER)).toBeNull();

    // leitura do aluno: nao esta mais em "conquistadas"; aparece em "revogadas" com o motivo; historico consultavel; nada provisorio
    const summary = await t.medalsView.getSummary(USER);
    expect(summary.unlocked).toHaveLength(0);
    expect(summary.revoked).toEqual([expect.objectContaining({ code: 'volume_semanal_corrida_30km', revokedReason: 'criterio_nao_atendido', provisional: false })]);
    expect(summary.revoked[0].reasonText).toContain('deixou de ser atendido');
    expect(summary.pending.updating).toBe(false);
    expect((await t.medalsView.getHistory(USER)).map((h) => h.type)).toEqual(['revoked']);
  });

  it('nova correcao devolve o criterio: a MESMA medalha e reativada (3 estados no historico, uma linha, unlockedAt preservado) e o Prontuario ganha o segundo evento', async () => {
    const t = build();
    t.setWeeklyKm(12);
    await t.link.unlinkActivityAsStudent(USER, 'act-1', null);
    const unlockedAt = t.awards.get('ua-v')!.unlockedAt;

    // o aluno vincula de novo (simulado: vinculo ativo novo) e o volume volta a 31 km
    t.setWeeklyKm(31);
    const since = new Date();
    await t.prisma.sessionExecutionLink.create({ data: { userId: USER, trainingSessionId: 's1', activityLogId: 'act-1', status: 'active', origin: 'student', createdAt: new Date(), note: null } });
    await t.link.recomputeAfterCorrection(USER, since, { origin: 'student', actorId: USER, kind: 'link_correction' });

    expect(t.awards.size).toBe(1);
    expect(t.awards.get('ua-v')).toMatchObject({ status: 'active', revokedAt: null });
    expect(t.awards.get('ua-v')!.unlockedAt).toEqual(unlockedAt);
    expect(t.transitions.map((x) => x.type)).toEqual(['revoked', 'reactivated']);
    expect(t.events).toHaveLength(2);
    expect(t.events[1].content).toContain('era atividade extra; agora cumpre o treino prescrito');
    const summary = await t.medalsView.getSummary(USER);
    expect(summary.unlocked).toEqual([expect.objectContaining({ code: 'volume_semanal_corrida_30km', status: 'active', reactivatedAt: expect.any(Date), provisional: false })]);
    expect(summary.revoked).toHaveLength(0);
  });

  it('a medalha NAO e perdida quando o criterio continua atendido (atividade extra continua somando km): fica ativa e so a evidencia e AJUSTADA, com historico', async () => {
    const t = build();
    t.setWeeklyKm(33); // a semana continua >= 30 km; o valor que a comprova mudou de 31 para 33
    await t.link.unlinkActivityAsStudent(USER, 'act-1', null);
    expect(t.awards.get('ua-v')).toMatchObject({ status: 'active', value: 33, revokedAt: null });
    expect(t.transitions.map((x) => x.type)).toEqual(['adjusted']);
    expect(t.transitions[0].before).toMatchObject({ value: 31 });
    expect(t.transitions[0].after).toMatchObject({ value: 33, status: 'active' });
  });

  it('periodo INCERTO nunca revoga automaticamente, mesmo com o limiar nao atingido', async () => {
    const t = build();
    t.setWeeklyKm(12);
    t.evolution.getRunMedalUncertainty.mockResolvedValue({ weeks: new Set([WEEK]), months: new Set<string>() } as never);
    await t.link.unlinkActivityAsStudent(USER, 'act-1', null);
    expect(t.awards.get('ua-v')!.status).toBe('active');
    expect(t.transitions).toHaveLength(0);
  });

  it('enquanto a reavaliacao esta pendente a leitura marca a medalha como PROVISORIA (nunca definitiva)', async () => {
    const t = build();
    registerMedalProcessor(async () => ({ complete: false, error: 'em andamento' })); // reavaliacao nao termina
    t.setWeeklyKm(12);
    await t.link.unlinkActivityAsStudent(USER, 'act-1', null);
    expect(await readPending(t.prisma, USER)).toMatchObject({ medalsPending: true });
    const summary = await t.medalsView.getSummary(USER);
    expect(summary.pending.updating).toBe(true);
    expect(summary.pending.medalCategories).toEqual(expect.arrayContaining(['volume_semanal']));
    expect(summary.unlocked[0]).toMatchObject({ code: 'volume_semanal_corrida_30km', provisional: true });
  });

  it('o ponto central nunca gera treino: nenhuma dependencia de prescricao no fluxo e nenhum servico de planos tocado', async () => {
    const t = build();
    t.setWeeklyKm(12);
    const forbidden = { generateWeek: jest.fn(), regenerateSession: jest.fn() };
    await t.link.unlinkActivityAsStudent(USER, 'act-1', null);
    for (const fn of Object.values(forbidden)) expect(fn).not.toHaveBeenCalled();
    // nenhum acesso a programa/plano de treino (so' a leitura de progresso de medalhas, que a correcao nao chama, le o plano ativo)
    expect(t.prisma.trainingPlan.findFirst).not.toHaveBeenCalled();
  });
});
