import { Logger } from '@nestjs/common';
import { MedalEvaluationService, medalCategoriesFor } from '../src/medals/medal-evaluation.service';
import { correctionHooks, CorrectionContext } from '../src/activity-execution/correction-hooks';
import { processPendingReevaluation, readPending, registerMedalProcessor, waitForPendingContinuations } from '../src/activity-execution/pending-reevaluation';
import { evolutionStub, medalsFake } from './helpers/medals-fake';

// Reavaliacao de medalhas apos correcao, ponta a ponta (gancho -> pendencia duravel -> reavaliacao -> transicoes), com Prisma em memoria. Prova a LOGICA:
// revoga so' quando o criterio deixou de ser atendido, mantem quando ainda e' atendido, reativa quando volta, respeita versao da regra e incerteza, nunca revoga
// por ausencia de dado, so' toca nas categorias afetadas e e' idempotente. Nao prova transacao/migracao reais (exige PostgreSQL de teste).

jest.mock('../src/activity-execution/execution-analysis.service', () => ({ ExecutionAnalysisService: class { analyzeSession = jest.fn(); } }));

const USER = 'u1';
const AT = new Date('2026-10-15T12:00:00Z');
const T10 = { id: 'a-t10', code: 'treinos_concluidos_10', category: 'treinos_concluidos', threshold: 10 };
const CK = { id: 'a-ck', code: 'checkins_1', category: 'checkins', threshold: 1 };
const V30 = { id: 'a-v30', code: 'volume_semanal_corrida_30km', category: 'volume_semanal', threshold: 30 };

const context = (extra: Partial<CorrectionContext> = {}): CorrectionContext => ({
  userId: USER, kind: 'link_correction', origin: 'student', actorId: USER, at: AT, since: new Date('2026-10-15T11:59:00Z'), sessionIds: ['s1'], activityLogIds: ['a1'],
  completionsChanged: true, changes: [], affectedDates: ['2026-10-05'], ...extra,
});

function setup(opts: Parameters<typeof medalsFake>[0], evolution = evolutionStub()) {
  const fake = medalsFake(opts);
  const service = new MedalEvaluationService(fake.prisma as never, evolution as never);
  service.onModuleInit(); // registra o gancho e o processador de medalhas (como o Nest faz ao iniciar)
  const correct = async (ctx: CorrectionContext) => { await correctionHooks.run(ctx); return processPendingReevaluation(fake.prisma as never, USER); };
  return { ...fake, service, evolution, correct };
}

beforeEach(() => { jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined); jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
afterEach(async () => { await waitForPendingContinuations(); correctionHooks.clear(); registerMedalProcessor(null); jest.restoreAllMocks(); });

describe('medalCategoriesFor: so as categorias que a correcao pode afetar', () => {
  it('vinculo/volume sempre; categorias de feedback so quando o feedback mudou; check-ins e reavaliacoes nunca', () => {
    expect(medalCategoriesFor({ kind: 'link_correction', completionsChanged: false }).sort()).toEqual(['aderencia', 'sustentacao_volume', 'volume_mensal', 'volume_semanal']);
    const withCounts = medalCategoriesFor({ kind: 'link_correction', completionsChanged: true });
    expect(withCounts).toEqual(expect.arrayContaining(['treinos_concluidos', 'feedbacks', 'constancia', 'retomada', 'acumulado', 'distancia_unica']));
    expect(withCounts).not.toContain('checkins');
    expect(withCounts).not.toContain('reavaliacoes');
    expect(medalCategoriesFor({ kind: 'session_edit', completionsChanged: false })).toEqual(expect.arrayContaining(['acumulado', 'distancia_unica']));
  });
});

describe('gancho: marca a reavaliacao de forma duravel', () => {
  it('registra categorias, semanas/meses das datas afetadas, causa e a origem da correcao', async () => {
    const { prisma, pending } = setup({ achievements: [T10] });
    await correctionHooks.run(context({ affectedDates: ['2026-10-05', '2026-09-30'], completionsChanged: false }));
    const row = pending.rows.get(USER)!;
    expect(row.medalsPending).toBe(true);
    expect(row.medalScope).toMatchObject({ weeks: ['2026-09-28', '2026-10-05'], months: ['2026-09', '2026-10'], countsChanged: false, absenceOfData: false });
    expect(row.medalScope.categories).toEqual(['aderencia', 'volume_semanal', 'sustentacao_volume', 'volume_mensal']);
    expect(row.medalScope.causes[0]).toMatchObject({ kind: 'link_correction', origin: 'student', actorId: USER });
    expect(prisma.userAchievement.update).not.toHaveBeenCalled(); // marcar nao altera nenhuma medalha
  });
});

describe('revogar so quando o criterio deixou de ser atendido', () => {
  it('total de treinos concluidos caiu abaixo do limiar apos a correcao: revoga (registro e historico preservados) e limpa a pendencia', async () => {
    const { correct, awards, transitions, state, pending } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10', value: 12, evidence: { totalAtUnlock: 12 } }], completedTotal: 9 });
    state.completedTotal = 9;
    const result = await correct(context());
    expect(result.status).toBe('done');
    expect(awards.get('ua-1')).toMatchObject({ status: 'revoked', revokedReason: 'criterio_nao_atendido' });
    expect(awards.size).toBe(1);
    expect(transitions.map((t) => [t.type, t.trigger, t.reason])).toEqual([['revoked', 'link_correction', 'criterio_nao_atendido']]);
    expect(transitions[0].cause).toMatchObject({ countsChanged: true, causes: [expect.objectContaining({ origin: 'student' })] });
    expect(pending.rows.has(USER)).toBe(false);
  });

  it('a correcao NAO significa perder a medalha: total continua >= limiar => nada muda (sem transicao)', async () => {
    const { correct, awards, transitions } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10', value: 12 }], completedTotal: 11 });
    await correct(context());
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(transitions).toHaveLength(0);
  });

  it('categoria nao afetada pela correcao nunca e tocada (check-in permanece mesmo com feedback alterado)', async () => {
    const { correct, awards, transitions } = setup({ achievements: [T10, CK], awards: [{ id: 'ua-1', achievementId: 'a-t10' }, { id: 'ua-2', achievementId: 'a-ck' }], completedTotal: 9 });
    await correct(context());
    expect(awards.get('ua-1')!.status).toBe('revoked');
    expect(awards.get('ua-2')!.status).toBe('active');
    expect(transitions.map((t) => t.userAchievementId)).toEqual(['ua-1']);
  });

  it('correcao que nao mexeu em feedback: categorias de contagem nem sao avaliadas (nao revoga)', async () => {
    const { correct, awards } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10' }], completedTotal: 9 });
    await correct(context({ completionsChanged: false }));
    expect(awards.get('ua-1')!.status).toBe('active');
  });

  it('versao da regra diferente da do catalogo: nunca revoga automaticamente', async () => {
    const { correct, awards, transitions } = setup({ achievements: [{ ...T10, ruleVersion: 2 }], awards: [{ id: 'ua-1', achievementId: 'a-t10', ruleVersionAtUnlock: 1 }], completedTotal: 9 });
    await correct(context());
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(transitions).toHaveLength(0);
  });

  it('exclusao de dados do provedor (ausencia de dado): NAO revoga nem ajusta, mesmo com o total abaixo do limiar', async () => {
    const { correct, awards, transitions } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10' }], completedTotal: 9 });
    await correct(context({ kind: 'provider_data_deleted', origin: 'system', absenceOfData: true, provider: 'polar', sessionIds: [], activityLogIds: [] }));
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(transitions).toHaveLength(0);
  });

  it('volume: nenhuma semana atinge mais o limiar, periodo com observacoes e sem incerteza: revoga; com periodo incerto: nunca', async () => {
    const week = '2026-10-05';
    const evidenceSeries = { weeks: [{ weekStart: week, kmPercorridos: 12 }], months: [], calculatedAt: 'x' };
    const awardRow = { id: 'ua-v', achievementId: 'a-v30', value: 31, periodStart: new Date(`${week}T00:00:00Z`), periodEnd: new Date(`${week}T00:00:00Z`), evidence: { weekStart: week } };

    const evolution = evolutionStub();
    evolution.getRunSeries.mockResolvedValue(evidenceSeries as never);
    const ok = setup({ achievements: [V30], awards: [awardRow] }, evolution);
    await ok.correct(context({ completionsChanged: false }));
    expect(ok.awards.get('ua-v')).toMatchObject({ status: 'revoked' });
    expect(ok.awards.get('ua-v')!.evidence._volumeReconciliation.status).toBe('retracted'); // marcador legado espelhado

    correctionHooks.clear();
    const uncertain = evolutionStub();
    uncertain.getRunSeries.mockResolvedValue(evidenceSeries as never);
    uncertain.getRunMedalUncertainty.mockResolvedValue({ weeks: new Set([week]), months: new Set<string>() } as never);
    const risky = setup({ achievements: [V30], awards: [awardRow] }, uncertain);
    await risky.correct(context({ completionsChanged: false }));
    expect(risky.awards.get('ua-v')!.status).toBe('active');
    expect(risky.transitions).toHaveLength(0);
  });
});

describe('reativacao e idempotencia', () => {
  it('revogada e depois o criterio volta: um gatilho comum REATIVA a mesma linha; historico = revogada, reativada; unlockedAt preservado', async () => {
    const { correct, awards, transitions, state, service } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10', value: 12, unlockedAt: new Date('2026-09-20T00:00:00Z') }], completedTotal: 9 });
    await correct(context());
    expect(awards.get('ua-1')!.status).toBe('revoked');

    state.completedTotal = 10; // o aluno corrigiu de novo (ou registrou outro treino): volta a cumprir
    const unlocked = await service.evaluateForUser(USER, 'workout_completed');
    expect(unlocked).toContain('treinos_concluidos_10');
    expect(awards.size).toBe(1);
    expect(awards.get('ua-1')).toMatchObject({ status: 'active', revokedAt: null, revokedReason: null });
    expect(awards.get('ua-1')!.unlockedAt).toEqual(new Date('2026-09-20T00:00:00Z'));
    expect(transitions.map((t) => t.type)).toEqual(['revoked', 'reactivated']);
    expect(transitions[1]).toMatchObject({ trigger: 'workout_completed', reason: 'criterio_voltou_a_ser_atendido' });
  });

  it('reativacao tambem pelo caminho de correcao (nova correcao devolve o criterio)', async () => {
    const { correct, awards, transitions, state } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10', value: 12 }], completedTotal: 9 });
    await correct(context());
    state.completedTotal = 12;
    await correct(context({ at: new Date('2026-10-16T12:00:00Z') }));
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(transitions.map((t) => t.type)).toEqual(['revoked', 'reactivated']);
    expect(awards.size).toBe(1);
  });

  it('correcoes repetidas sobre os mesmos dados nao duplicam transicoes (idempotente)', async () => {
    const { correct, transitions } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10' }], completedTotal: 9 });
    await correct(context());
    await correct(context({ at: new Date('2026-10-15T12:05:00Z') }));
    await correct(context({ at: new Date('2026-10-15T12:10:00Z') }));
    expect(transitions.map((t) => t.type)).toEqual(['revoked']);
  });

  it('conquista nova por correcao: o criterio passou a ser atendido => concede (com transicao granted)', async () => {
    const { correct, awards, transitions } = setup({ achievements: [T10], awards: [], completedTotal: 10 });
    await correct(context());
    expect([...awards.values()]).toHaveLength(1);
    expect(transitions.map((t) => [t.type, t.trigger])).toEqual([['granted', 'link_correction']]);
  });

  it('gatilho comum nunca revoga: com o total abaixo do limiar a concessao ativa continua como esta', async () => {
    const { awards, transitions, service } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10' }], completedTotal: 9 });
    await service.evaluateForUser(USER, 'workout_completed');
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(transitions).toHaveLength(0);
  });
});

describe('falha e retomada', () => {
  it('conflito na escrita (concessao mudou no meio): a pendencia continua registrada para nova tentativa e nada e apagado', async () => {
    const { correct, prisma, awards, pending } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10', value: 12 }], completedTotal: 9 });
    const realFindUnique = prisma.userAchievement.findUnique;
    prisma.userAchievement.findUnique = jest.fn(async (args: any) => { awards.get('ua-1')!.value = 99; return realFindUnique(args); }); // alguem muda a linha entre planejar e escrever
    const result = await correct(context());
    expect(result.medals).toBe('pending');
    expect(pending.rows.get(USER)).toMatchObject({ medalsPending: true });
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(awards.size).toBe(1);
  });

  it('falha de banco na reavaliacao nao perde a pendencia', async () => {
    const { correct, prisma, pending } = setup({ achievements: [T10], awards: [{ id: 'ua-1', achievementId: 'a-t10' }], completedTotal: 9 });
    prisma.achievement.findMany = jest.fn(async () => { throw new Error('banco fora'); });
    const result = await correct(context());
    expect(result.medals).toBe('pending');
    expect((await readPending(prisma as never, USER))?.lastError).toContain('banco fora');
    expect(pending.rows.has(USER)).toBe(true);
  });
});
