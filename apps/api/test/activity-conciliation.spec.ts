import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { SessionExecutionLinkService } from '../src/activity-execution/session-execution-link.service';
import { assessCompatibility } from '../src/activity-execution/activity-compatibility';
import { scheduleWeeklyReportRefresh, weeklyReportRefresh } from '../src/activity-execution/correction-hooks';
import { ExecutionAnalysisService } from '../src/activity-execution/execution-analysis.service';
import { WorkoutCompletionsService } from '../src/workout-completions/workout-completions.service';
import { buildWeeklyRealizedTotals, promptTotalsOf } from '../src/activity-execution/weekly-realized-totals';

// Conciliacao de atividades (30/10/2026): vinculo manual livre (qualquer semana e modalidade, com aviso), classificacao, feedback preservado, partes da mesma sessao,
// pergunta antes do segundo feedback, bloqueio do feedback com pergunta pendente e relatorio semanal que acompanha os vinculos. Prisma em memoria.

type Row = Record<string, any>;
const USER = 'u1';
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function build() {
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const activities = new Map<string, Row>(); const sessions = new Map<string, Row>(); const links = new Map<string, Row>();
  const completions = new Map<string, Row>(); const versions: Row[] = []; const plans = new Map<string, Row>(); const reports = new Map<string, Row>();

  const m = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      if ('gte' in v || 'lte' in v || 'lt' in v) {
        const t = row[k] instanceof Date ? row[k].getTime() : row[k];
        return (v.gte === undefined || t >= v.gte.getTime()) && (v.lte === undefined || t <= v.lte.getTime()) && (v.lt === undefined || t < v.lt.getTime());
      }
      return true;
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
  const activeLinks = (sid: string) => [...links.values()].filter((l) => l.trainingSessionId === sid && l.status === 'active');
  const withRelations = (s: Row): Row => ({ ...s, completion: [...completions.values()].find((c) => c.sessionId === s.id) ?? null, executionLinks: activeLinks(s.id) });
  const sorted = (rows: Row[], orderBy?: Row) => {
    if (!orderBy) return rows;
    const [[field, dir]] = Object.entries(orderBy);
    return [...rows].sort((a, b) => ((a[field] as any) - (b[field] as any)) * (dir === 'desc' ? -1 : 1));
  };

  const prisma: any = {
    activityLog: {
      findUnique: async ({ where }: any) => activities.get(where.id) ?? null,
      findMany: async ({ where }: any) => [...activities.values()].filter((a) => m(a, where)),
      update: async ({ where, data }: any) => { Object.assign(activities.get(where.id)!, data); return activities.get(where.id); },
    },
    trainingSession: {
      findUnique: async ({ where }: any) => { const s = sessions.get(where.id); return s ? withRelations(s) : null; },
      findMany: async ({ where }: any) => [...sessions.values()].filter((s) => m(s, where)).map(withRelations),
      create: async ({ data }: any) => { const row = { id: id('s'), ...data }; sessions.set(row.id, row); return withRelations(row); },
      delete: async ({ where }: any) => { sessions.delete(where.id); },
    },
    sessionExecutionLink: {
      findMany: async ({ where }: any) => [...links.values()].filter((l) => m(l, where)),
      count: async ({ where }: any) => [...links.values()].filter((l) => m(l, where)).length,
      create: async ({ data }: any) => { const row = { id: id('l'), revokedAt: null, createdAt: new Date(), ...data }; links.set(row.id, row); return row; },
      update: async ({ where, data }: any) => { Object.assign(links.get(where.id)!, data); return links.get(where.id); },
    },
    workoutCompletion: {
      findUnique: async ({ where }: any) => [...completions.values()].find((c) => c.sessionId === where.sessionId) ?? null,
      create: async ({ data }: any) => { const row = { id: id('c'), ...data }; completions.set(row.id, row); return row; },
      update: async ({ where, data }: any) => { Object.assign(completions.get(where.id)!, data); return completions.get(where.id); },
      delete: async ({ where }: any) => { completions.delete(where.id); },
    },
    workoutFeedbackVersion: { create: async ({ data }: any) => { versions.push({ id: id('v'), ...data }); } },
    sessionExecutionAnalysis: { deleteMany: async () => ({ count: 0 }) },
    trainingAnalysis: { deleteMany: async () => ({ count: 0 }) },
    trainingPlan: { findFirst: async ({ where, orderBy }: any) => sorted([...plans.values()].filter((p) => m(p, where)), orderBy)[0] ?? null },
    weeklyExecutionReport: {
      findMany: async ({ where }: any) => [...reports.values()].filter((r) => m(r, where)),
      update: async ({ where, data }: any) => { Object.assign(reports.get(where.id)!, data); return reports.get(where.id); },
      create: async ({ data }: any) => { const row = { id: id('r'), status: 'active', createdAt: new Date(), ...data }; reports.set(row.id, row); return row; },
    },
    $transaction: async (fn: any) => fn(prisma),
    $executeRaw: async () => 0,
  };

  const addActivity = (over: Row = {}) => { const row = { id: id('act'), userId: USER, provider: 'apple_health', startedAt: new Date('2026-10-26T11:00:00Z'), utcOffsetMinutes: -180, durationSec: 1742, distanceMeters: 1740, sport: 'caminhada', executionClassification: 'alternative', physicalIdentityStatus: 'unique', physicalEventId: null, ...over }; activities.set(row.id, row); return row; };
  const addSession = (over: Row = {}) => { const row = { id: id('s'), userId: USER, title: 'Corrida', modality: 'corrida', scheduledDate: day('2026-10-26'), durationMin: 30, distanceKm: 3, origin: null, structure: null, ...over }; sessions.set(row.id, row); return row; };
  const addCompletion = (sessionId: string, over: Row = {}) => { const row = { id: id('c'), sessionId, userId: USER, status: 'done', perceivedEffort: 6, ...over }; completions.set(row.id, row); return row; };
  const addLink = (sessionId: string, activityLogId: string, over: Row = {}) => { const row = { id: id('l'), userId: USER, trainingSessionId: sessionId, activityLogId, status: 'active', origin: 'automatic', revokedAt: null, createdAt: new Date(), ...over }; links.set(row.id, row); return row; };
  const service = new SessionExecutionLinkService(prisma);
  jest.spyOn(service, 'recomputeAfterCorrection').mockResolvedValue({ sessionIds: [], recomputedSessionIds: [], failedSessionIds: [], deferredSessionIds: [] });
  return { prisma, service, activities, sessions, links, completions, versions, plans, reports, addActivity, addSession, addCompletion, addLink };
}

beforeEach(() => { for (const level of ['log', 'error', 'warn'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

const activeOf = (t: ReturnType<typeof build>, sessionId: string) => [...t.links.values()].filter((l) => l.trainingSessionId === sessionId && l.status === 'active');

describe('compatibilidade: aviso, nunca veto', () => {
  it('2. corrida prescrita x caminhada importada: parece incompativel (motivo em texto), mas dados parecidos nao geram aviso de tamanho', () => {
    const a = assessCompatibility({ modality: 'corrida', distanceKm: 1.74, durationMin: 29 }, { sport: 'caminhada', distanceMeters: 1740, durationSec: 1742 });
    expect(a).toMatchObject({ level: 'attention', needsConfirmation: true });
    expect(a.reasons).toHaveLength(1);
    expect(a.reasons[0]).toContain('caminhada');
    const same = assessCompatibility({ modality: 'corrida', distanceKm: 3, durationMin: 30 }, { sport: 'corrida', distanceMeters: 2900, durationSec: 1700 });
    expect(same).toMatchObject({ level: 'compatible', needsConfirmation: false, reasons: [] });
  });

  it('30 km prescritos e 5 km feitos (mesma modalidade): o aviso de distancia existe no vinculo MANUAL, sem vetar; dado ausente nunca e divergencia', () => {
    const far = assessCompatibility({ modality: 'corrida', distanceKm: 30, durationMin: 180 }, { sport: 'corrida', distanceMeters: 5000, durationSec: 1800 });
    expect(far.needsConfirmation).toBe(true);
    expect(far.reasons.join(' ')).toContain('distância');
    expect(assessCompatibility({ modality: 'corrida', distanceKm: null, durationMin: null }, { sport: 'corrida', distanceMeters: null, durationSec: null }).needsConfirmation).toBe(false);
  });
});

describe('vinculo manual do aluno', () => {
  it('2/3. caminhada vincula a corrida (de outra semana) so depois de confirmar o aviso; sem confirmar, 400 com motivos e nada muda', async () => {
    const t = build();
    const run = t.addSession({ scheduledDate: day('2026-10-26') });
    const walk = t.addActivity({ startedAt: new Date('2026-10-20T20:00:00Z') }); // 20/10: 6+ dias antes, outra semana
    await expect(t.service.linkActivityToSessionAsStudent(USER, walk.id, run.id)).rejects.toMatchObject({ response: { code: 'needs_confirmation', reasons: expect.any(Array) } });
    expect(t.links.size).toBe(0);
    const ok = await t.service.linkActivityToSessionAsStudent(USER, walk.id, run.id, { confirmIncompatible: true });
    expect(ok).toMatchObject({ trainingSessionId: run.id, role: 'primary' });
    expect(t.activities.get(walk.id)!.executionClassification).toBe('corresponding');
    expect(activeOf(t, run.id)).toHaveLength(1);
  });

  it('toda atividade tem a opcao de vincular: a lista traz treinos de qualquer semana e modalidade, compativeis primeiro, cada um com o aviso', async () => {
    const t = build();
    const walk = t.addActivity();
    t.addSession({ id: 'forca', title: 'Musculação', modality: 'forca', scheduledDate: day('2026-10-26') });
    t.addSession({ id: 'corrida-longe', title: 'Corrida', modality: 'corrida', scheduledDate: day('2026-10-02') }); // ~24 dias antes
    t.addSession({ id: 'caminhada', title: 'Caminhada', modality: 'caminhada', scheduledDate: day('2026-10-27') });
    const list = await t.service.linkableSessionsAsStudent(USER, walk.id);
    expect(list.map((s) => s.id).sort()).toEqual(['caminhada', 'corrida-longe', 'forca']);
    expect(list[0].id).toBe('caminhada'); // compativel vem primeiro
    expect(list.every((s) => typeof s.compatibility.needsConfirmation === 'boolean')).toBe(true);
    expect(list.find((s) => s.id === 'forca')!.compatibility.needsConfirmation).toBe(true);
  });

  it('1/10/11. treino com feedback manual: vincular mantem o feedback; repetir o vinculo nao duplica; desvincular preserva feedback e historico', async () => {
    const t = build();
    const run = t.addSession(); const completion = t.addCompletion(run.id, { perceivedEffort: 7, painFlag: 'leve' });
    const act = t.addActivity({ sport: 'corrida' });
    await t.service.linkActivityToSessionAsStudent(USER, act.id, run.id);
    await t.service.linkActivityToSessionAsStudent(USER, act.id, run.id); // nova sincronizacao / toque duplo
    expect(activeOf(t, run.id)).toHaveLength(1);
    expect(t.completions.get(completion.id)).toMatchObject({ perceivedEffort: 7, painFlag: 'leve', sessionId: run.id });
    const result = await t.service.unlinkActivityAsStudent(USER, act.id, null);
    expect(result.classification).toBe('alternative');
    expect(activeOf(t, run.id)).toHaveLength(0);
    expect([...t.links.values()].some((l) => l.status === 'revoked')).toBe(true); // historico preservado
    expect(t.completions.get(completion.id)).toMatchObject({ perceivedEffort: 7 });
  });

  it('4/12. treino ja cumprido por outra atividade: a escolha do aluno prevalece, a outra vira extra e o vinculo automatico errado fica no historico', async () => {
    const t = build();
    const run = t.addSession();
    const wrong = t.addActivity({ sport: 'corrida' }); const right = t.addActivity({ sport: 'corrida', startedAt: new Date('2026-10-26T20:00:00Z') });
    const auto = t.addLink(run.id, wrong.id);
    const result = await t.service.linkActivityToSessionAsStudent(USER, right.id, run.id);
    expect(result.replacedActivityLogIds).toEqual([wrong.id]);
    expect(activeOf(t, run.id).map((l) => l.activityLogId)).toEqual([right.id]);
    expect(t.links.get(auto.id)!.status).toBe('revoked');
    expect(activeOf(t, run.id)[0].origin).toBe('student');
    expect(t.activities.get(wrong.id)!.executionClassification).toBe('alternative');
  });

  it('6. duas atividades no mesmo dia vinculam a dois treinos diferentes sem se misturar', async () => {
    const t = build();
    const run = t.addSession(); const strength = t.addSession({ id: 'f', title: 'Musculação', modality: 'forca' });
    const a = t.addActivity({ sport: 'corrida' }); const b = t.addActivity({ sport: 'forca', durationSec: 1800, distanceMeters: 0 });
    await t.service.linkActivityToSessionAsStudent(USER, a.id, run.id);
    await t.service.linkActivityToSessionAsStudent(USER, b.id, strength.id, { confirmIncompatible: true });
    expect(activeOf(t, run.id).map((l) => l.activityLogId)).toEqual([a.id]);
    expect(activeOf(t, strength.id).map((l) => l.activityLogId)).toEqual([b.id]);
  });

  it('13. sessao composta: a segunda atividade entra como PARTE e a primeira continua vinculada (nao vira extra)', async () => {
    const t = build();
    const run = t.addSession();
    const a = t.addActivity({ sport: 'corrida' }); const b = t.addActivity({ sport: 'corrida', startedAt: new Date('2026-10-26T12:00:00Z') });
    await t.service.linkActivityToSessionAsStudent(USER, a.id, run.id);
    const part = await t.service.linkActivityToSessionAsStudent(USER, b.id, run.id, { role: 'part' });
    expect(part.role).toBe('part');
    expect(activeOf(t, run.id).map((l) => [l.activityLogId, l.role ?? null])).toEqual([[a.id, null], [b.id, 'part']]);
    expect(t.activities.get(a.id)!.executionClassification).toBe('corresponding');
  });

  it('5. duas fontes da mesma execucao: o vinculo aponta para a observacao canonica do evento, uma vez so', async () => {
    const t = build();
    const run = t.addSession();
    const canonical = t.addActivity({ id: 'apple', sport: 'corrida', physicalIdentityStatus: 'matched', physicalEventId: 'ev1', physicalCanonicalActivityLogId: 'apple' });
    const other = t.addActivity({ id: 'garmin', provider: 'garmin', sport: 'corrida', physicalIdentityStatus: 'matched', physicalEventId: 'ev1', physicalCanonicalActivityLogId: 'apple' });
    await t.service.linkActivityToSessionAsStudent(USER, other.id, run.id);
    expect(activeOf(t, run.id).map((l) => l.activityLogId)).toEqual([canonical.id]);
  });

  it('16. registro historico (vinculo antigo sem papel e atividade alternativa antiga) segue funcionando como principal', async () => {
    const t = build();
    const run = t.addSession(); const old = t.addActivity({ sport: 'corrida' }); const next = t.addActivity({ sport: 'corrida', startedAt: new Date('2026-10-26T20:00:00Z') });
    t.addLink(run.id, old.id); // sem campo role (linha anterior a esta mudanca)
    const result = await t.service.linkActivityToSessionAsStudent(USER, next.id, run.id);
    expect(result.role).toBe('primary');
    expect(activeOf(t, run.id).map((l) => l.activityLogId)).toEqual([next.id]);
  });
});

describe('classificacao do aluno', () => {
  it('7/8. treino extra e rotina cotidiana: viram atividade extra (contam como exercicio), cotidiana leva o rotulo; ambas desfazem o vinculo sem apagar feedback', async () => {
    const t = build();
    const run = t.addSession(); const completion = t.addCompletion(run.id);
    const act = t.addActivity({ sport: 'caminhada', executionClassification: 'corresponding' });
    t.addLink(run.id, act.id);
    const daily = await t.service.classifyActivityAsStudent(USER, act.id, 'daily');
    expect(daily).toMatchObject({ classification: 'alternative', label: 'daily' });
    expect(t.activities.get(act.id)).toMatchObject({ executionClassification: 'alternative', studentLabel: 'daily', executionClassifiedBy: 'student' });
    expect(activeOf(t, run.id)).toHaveLength(0);
    expect(t.completions.has(completion.id)).toBe(true);
    await t.service.classifyActivityAsStudent(USER, act.id, 'extra');
    expect(t.activities.get(act.id)!.studentLabel).toBeNull();
  });

  it('atividade de outro aluno: 404 (nada vaza)', async () => {
    const t = build();
    const act = t.addActivity({ userId: 'outro' });
    await expect(t.service.classifyActivityAsStudent(USER, act.id, 'extra')).rejects.toMatchObject({ status: 404 });
    await expect(t.service.linkActivityToSessionAsStudent(USER, act.id, 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('feedback unico e preservado', () => {
  async function bothHaveFeedback() {
    const t = build();
    const run = t.addSession(); const own = t.addCompletion(run.id, { perceivedEffort: 7, painFlag: 'none' });
    const act = t.addActivity({ sport: 'corrida', executionClassification: 'alternative' });
    const extra = t.addSession({ id: 'extra', origin: 'device_extra', modality: 'corrida', title: 'corrida (extra)', structure: { type: 'extra', activityLogId: act.id } });
    const synthetic = t.addCompletion(extra.id, { perceivedEffort: 4, painFlag: 'leve', source: 'device_extra' });
    return { t, run, own, act, extra, synthetic };
  }

  it('9. feedback divergente nos dois registros: sem escolha, 400 com os dois resumos; nada e apagado', async () => {
    const { t, run, act, own, synthetic } = await bothHaveFeedback();
    await expect(t.service.linkActivityToSessionAsStudent(USER, act.id, run.id)).rejects.toMatchObject({ response: { code: 'feedback_choice_required', session: { perceivedEffort: 7 }, activity: { perceivedEffort: 4 } } });
    expect(t.completions.has(own.id) && t.completions.has(synthetic.id)).toBe(true);
    expect(t.versions).toHaveLength(0);
  });

  it('9. escolhe manter o do treino: o da atividade fica guardado como versao e o calendario perde so a sessao sintetica', async () => {
    const { t, run, act, own, synthetic, extra } = await bothHaveFeedback();
    const result = await t.service.linkActivityToSessionAsStudent(USER, act.id, run.id, { keepFeedback: 'session' });
    expect(result.keptFeedback).toBe('session');
    expect(t.completions.get(own.id)).toMatchObject({ perceivedEffort: 7, sessionId: run.id });
    expect(t.completions.has(synthetic.id)).toBe(false);
    expect(t.versions).toEqual([expect.objectContaining({ sessionId: run.id, reason: 'merged_from_extra_session', payload: expect.objectContaining({ perceivedEffort: 4 }) })]);
    expect(t.sessions.has(extra.id)).toBe(false);
  });

  it('9. escolhe manter o da atividade: ele passa a ser o do treino e o original fica guardado', async () => {
    const { t, run, act, own, synthetic } = await bothHaveFeedback();
    const result = await t.service.linkActivityToSessionAsStudent(USER, act.id, run.id, { keepFeedback: 'activity' });
    expect(result.keptFeedback).toBe('activity');
    expect(t.completions.get(synthetic.id)).toMatchObject({ perceivedEffort: 4, sessionId: run.id });
    expect(t.completions.has(own.id)).toBe(false);
    expect(t.versions).toEqual([expect.objectContaining({ reason: 'replaced_by_student_choice', payload: expect.objectContaining({ perceivedEffort: 7 }) })]);
  });

  it('so o treino extra tem feedback: ele passa para o treino prescrito sem pedir nada', async () => {
    const t = build();
    const run = t.addSession(); const act = t.addActivity({ sport: 'corrida' });
    const extra = t.addSession({ id: 'extra', origin: 'device_extra', modality: 'corrida', structure: { type: 'extra', activityLogId: act.id } });
    const synthetic = t.addCompletion(extra.id, { perceivedEffort: 5 });
    const result = await t.service.linkActivityToSessionAsStudent(USER, act.id, run.id);
    expect(result.feedbackMovedFromExtraSession).toBe(true);
    expect(t.completions.get(synthetic.id)!.sessionId).toBe(run.id);
  });
});

describe('"Registrar feedback" numa atividade', () => {
  it('com treino prescrito plausivel no mesmo dia: pergunta antes e NAO cria segundo feedback; com force, cria', async () => {
    const t = build();
    t.addSession({ id: 'corrida', modality: 'corrida' });
    const act = t.addActivity({ sport: 'corrida' });
    t.addCompletion('corrida');
    const asked = await t.service.materializeExtraActivityAsStudent(USER, act.id);
    expect(asked).toMatchObject({ needsLinkQuestion: true, candidates: [{ id: 'corrida', hasFeedback: true }] });
    expect([...t.sessions.values()].filter((s) => s.origin === 'device_extra')).toHaveLength(0);
    const forced = await t.service.materializeExtraActivityAsStudent(USER, act.id, { force: true });
    expect(forced).toBeNull(); // sem programa nenhum no teste: nao materializa, mas tambem nao perguntou de novo
  });

  it('caminhada sem treino compativel: nao pergunta nada e vira extra direto, no programa da SEMANA da atividade', async () => {
    const t = build();
    t.plans.set('p-old', { id: 'p-old', userId: USER, status: 'archived', startDate: day('2026-10-19'), createdAt: new Date('2026-10-19T08:00:00Z') });
    t.plans.set('p-now', { id: 'p-now', userId: USER, status: 'active', startDate: day('2026-10-26'), createdAt: new Date('2026-10-26T08:00:00Z') });
    t.addSession({ modality: 'corrida', scheduledDate: day('2026-10-20') });
    const walk = t.addActivity({ sport: 'caminhada', startedAt: new Date('2026-10-20T20:00:00Z') });
    const result = await t.service.materializeExtraActivityAsStudent(USER, walk.id);
    expect(result).not.toHaveProperty('needsLinkQuestion');
    const created = [...t.sessions.values()].find((s) => s.origin === 'device_extra')!;
    expect(created.planId).toBe('p-old'); // antes ia para o programa ativo (26/10) com data de 20/10
    expect(created.scheduledDate.toISOString().slice(0, 10)).toBe('2026-10-20');
  });
});

describe('bloqueio do feedback com pergunta pendente', () => {
  function completionsService(link: SessionExecutionLinkService, session: Row | null) {
    const prisma: any = { trainingSession: { findFirst: async () => session } };
    return new WorkoutCompletionsService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, link);
  }

  it('treino prescrito com atividade candidata sem resposta: 409 com code e as atividades; depois de responder, libera', async () => {
    const t = build();
    const run = t.addSession(); const act = t.addActivity({ sport: 'corrida', executionClassification: 'ambiguous' });
    const candidate = t.addLink(run.id, act.id, { status: 'candidate' });
    const service = completionsService(t.service, run);
    await expect(service.upsert(USER, { sessionId: run.id, status: 'done', perceivedEffort: 5 } as never)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.upsert(USER, { sessionId: run.id, status: 'done', perceivedEffort: 5 } as never)).rejects.toMatchObject({ response: { code: 'activity_question_pending', activityLogIds: [act.id], linkIds: [candidate.id] } });
    candidate.status = 'revoked'; // o aluno respondeu
    expect(await t.service.pendingQuestionsForSession(USER, run.id)).toEqual([]);
  });

  it('treino extra (feedback da atividade) nunca e bloqueado, e o treino sem pergunta pendente nao e afetado', async () => {
    const t = build();
    const extra = t.addSession({ origin: 'device_extra' });
    const pendingFn = jest.spyOn(t.service, 'pendingQuestionsForSession');
    const service = completionsService(t.service, extra);
    await service.upsert(USER, { sessionId: extra.id, status: 'done' } as never).catch(() => undefined); // falha adiante (sem esforco), nunca por pergunta pendente
    expect(pendingFn).not.toHaveBeenCalled();
  });
});

describe('14. relatorio semanal acompanha os vinculos', () => {
  function reportFixture(changed: boolean) {
    const t = build();
    const service = new ExecutionAnalysisService(t.prisma);
    t.reports.set('r1', { id: 'r1', userId: USER, status: 'active', weekStartDate: day('2026-10-19'), analyzedPlanId: 'p1', deliveredWithPlanId: 'p2', indicators: { overview: { performed: 1 }, sources: { sessionIds: ['s1'] } }, sources: { sessionIds: ['s1'] }, createdAt: new Date() });
    const draft = { weekStartDate: day('2026-10-19'), analyzedPlanId: 'p1', indicators: { overview: { performed: changed ? 8 : 1 }, sources: { sessionIds: ['s1'] } }, textLines: ['x'], aiIndicators: {}, promptIndicators: {}, aiTotals: null, promptProviders: [] };
    jest.spyOn(service, 'prepareWeeklyReport').mockResolvedValue(draft as never);
    return { t, service };
  }

  it('indicadores mudaram: versao nova (ativa) e a anterior fica preservada como superseded', async () => {
    const { t, service } = reportFixture(true);
    await service.refreshWeeklyReports(USER, ['2026-10-22']);
    const rows = [...t.reports.values()];
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'superseded']);
    expect(rows.find((r) => r.status === 'active')).toMatchObject({ deliveredWithPlanId: 'p2' });
    expect(rows.find((r) => r.id === 'r1')).toMatchObject({ status: 'superseded', indicators: { overview: { performed: 1 } } }); // a versao anterior continua intacta
  });

  it('nada mudou (idempotente) ou semana sem relatorio: nada e gravado', async () => {
    const { t, service } = reportFixture(false);
    await service.refreshWeeklyReports(USER, ['2026-10-22']);
    await service.refreshWeeklyReports(USER, ['2026-11-12']);
    expect([...t.reports.values()]).toHaveLength(1);
  });
});

describe('coerencia das mensagens de erro', () => {
  it('vincular a treino extra e recusado (so treino prescrito)', async () => {
    const t = build();
    const extra = t.addSession({ origin: 'student_extra' }); const act = t.addActivity({ sport: 'corrida' });
    await expect(t.service.linkActivityToSessionAsStudent(USER, act.id, extra.id)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('15. totais da semana: partes da mesma sessao, caminhada cotidiana e duplicata nao inflam nada', () => {
  it('duas partes de uma corrida somam uma vez; a caminhada entra como extra (carga) sem aumentar adesao nem km de corrida; evento duplicado conta uma vez', () => {
    const at = (iso: string) => new Date(`${iso}Z`);
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: '2026-10-26',
      sessions: [{ sessionId: 's1', scheduledDate: '2026-10-26', modality: 'corrida', origin: null, status: 'performed', plannedDistanceKm: 5, linkedActivityLogIds: ['p1', 'p2'], linkOrigins: { p1: 'student', p2: 'student' } }],
      activities: [
        { activityLogId: 'p1', startedAt: at('2026-10-26T10:00:00'), sport: 'corrida', distanceKm: 3, durationMin: 20, classification: 'corresponding', provider: 'apple_health' },
        { activityLogId: 'p2', startedAt: at('2026-10-26T10:30:00'), sport: 'corrida', distanceKm: 2, durationMin: 14, classification: 'corresponding', provider: 'apple_health' },
        { activityLogId: 'w1', physicalEventId: 'ev-w1', memberIds: ['w1', 'w1-dup'], startedAt: at('2026-10-27T20:00:00'), sport: 'caminhada', distanceKm: 2, durationMin: 31, classification: 'alternative', provider: 'apple_health' },
        { activityLogId: 'w1-dup', physicalEventId: 'ev-w1', memberIds: ['w1', 'w1-dup'], startedAt: at('2026-10-27T20:00:00'), sport: 'caminhada', distanceKm: 2, durationMin: 31, classification: 'alternative', provider: 'garmin' },
      ],
    });
    expect(totals.prescription).toMatchObject({ prescribedSessions: 1, performedSessions: 1, executedRunKm: 5 });
    expect(totals.extras.events.map((e) => e.modality)).toEqual(['caminhada']); // a duplicata nao vira segundo extra
    expect(totals.extras.byModality.caminhada).toMatchObject({ events: 1, minutes: 31 });
    expect(totals.total.run.km).toBe(5); // caminhada nao entra no km de corrida
    expect(totals.total.byModality.caminhada.minutes).toBe(31); // mas entra no total/carga como exercicio extra
  });
});

describe('15. a IA recebe a percepcao do aluno sobre a caminhada', () => {
  it('rotina cotidiana marcada pelo aluno aparece no bloco de extras que vai a IA (continua extra e contando na carga)', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: '2026-10-26', sessions: [],
      activities: [{ activityLogId: 'w1', startedAt: new Date('2026-10-27T20:00:00Z'), sport: 'caminhada', distanceKm: 2, durationMin: 31, classification: 'alternative', provider: 'apple_health', studentLabel: 'daily' }],
    });
    expect(totals.extras.events[0]).toMatchObject({ modality: 'caminhada', routine: true });
    const ai = promptTotalsOf(totals) as { extras: { detalhe: Array<Record<string, unknown>> } };
    expect(ai.extras.detalhe[0]).toMatchObject({ modalidade: 'caminhada', rotinaCotidianaMarcadaPeloAluno: true });
    expect(totals.total.byModality.caminhada.minutes).toBe(31);
  });
});

describe('atividades em lote: relatorio atualizado uma vez', () => {
  it('varias atividades da mesma semana chegando juntas disparam UMA atualizacao, com todas as datas', async () => {
    jest.useFakeTimers();
    const refresher = jest.fn(async () => undefined);
    weeklyReportRefresh.set(refresher);
    try {
      scheduleWeeklyReportRefresh(USER, '2026-10-20');
      scheduleWeeklyReportRefresh(USER, '2026-10-21');
      scheduleWeeklyReportRefresh(USER, '2026-10-22');
      expect(refresher).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(21_000);
      expect(refresher).toHaveBeenCalledTimes(1);
      expect(refresher).toHaveBeenCalledWith(USER, ['2026-10-20', '2026-10-21', '2026-10-22']);
    } finally { weeklyReportRefresh.set(null); jest.useRealTimers(); }
  });
});
