import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';

// 01/11/2026 — Erro persistente #0012 (caso Duane): o programa foi gerado com a rotina antiga e a rotina nova (gravada 3 minutos depois) nao o alterou; o botao "Gerar treino" devolvia o programa antigo
// ("ja_gerado") sem explicar. Aqui: (1) quando a aluna PODE refazer o programa, (2) o refazer so' acontece nesses casos e com as mesmas travas, (3) os avisos existem no app e no painel. Dados sinteticos.

const root = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');

// Rotina da Duane no dia 01/11/2026: Ter corrida 60, Qua fortalecimento 45, Qui corrida 45, Dom corrida 120.
const duaneRoutine = [
  { weekday: 0, noTraining: false, modalities: ['corrida'], availableMin: 120, modalityDurations: { corrida: 120 } },
  { weekday: 2, noTraining: false, modalities: ['corrida'], availableMin: 60, modalityDurations: { corrida: 60 } },
  { weekday: 3, noTraining: false, modalities: ['fortalecimento_corredores'], availableMin: 45, modalityDurations: { fortalecimento_corredores: 45 } },
  { weekday: 4, noTraining: false, modalities: ['corrida'], availableMin: 45, modalityDurations: { corrida: 45 } },
];
const restDays = [1, 5, 6].map((weekday) => ({ weekday, noTraining: true, modalities: [], availableMin: 0, modalityDurations: null }));

type Opts = {
  routine?: Array<Record<string, unknown>> | null; revision?: number; plan?: { id: string; inputSnapshot: unknown } | null;
  sessions?: Array<{ scheduledDate: Date; completion: { id: string } | null; executionLinks: Array<{ id: string }> }>;
};

function fakePrisma(o: Opts) {
  const rows = o.routine === undefined ? [...duaneRoutine, ...restDays] : o.routine ?? [];
  return {
    weeklyRoutineState: { findUnique: jest.fn(async () => (o.routine === null ? null : { revision: o.revision ?? 6 })) },
    weeklyAvailability: { findMany: jest.fn(async () => rows) },
    trainingPlan: {
      findFirst: jest.fn(async (args: { where: { status?: string } }) => (args.where.status === 'active' ? o.plan ?? null : { id: 'plano-anterior' })),
    },
    trainingSession: { findMany: jest.fn(async () => o.sessions ?? []) },
  };
}

function service(o: Opts) {
  const svc = Object.create(TrainingPlansService.prototype) as any;
  svc.prisma = fakePrisma(o);
  return svc;
}

const monday2 = new Date('2026-11-02T00:00:00.000Z'); // segunda-feira 02/11/2026
const stalePlan = { id: 'p600', inputSnapshot: { routineRevision: 5 } }; // gerado com a revisao 5; a rotina atual e' a 6

beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date('2026-11-01T19:45:00.000Z')); }); // domingo 16:45 em Sao Paulo
afterAll(() => { jest.useRealTimers(); });

describe('routineAlignment: quando a aluna pode refazer o programa sozinha', () => {
  it('rotina mudou depois da geracao, nada executado, semana nao iniciada => PODE refazer (caso Duane)', async () => {
    const svc = service({ plan: stalePlan, sessions: [{ scheduledDate: monday2, completion: null, executionLinks: [] }, { scheduledDate: new Date('2026-11-04T00:00:00Z'), completion: null, executionLinks: [] }] });
    expect(await svc.routineAlignment('duane')).toEqual({ status: 'pode_refazer', stale: true, canRegenerate: true, weekStart: '2026-11-02' });
    // a semana-alvo e' a seguinte (domingo apos o horario de liberacao, sem dia futuro na semana que termina)
    const where = svc.prisma.trainingPlan.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'duane', status: 'active' });
    expect((where.startDate as Date).toISOString().slice(0, 10)).toBe('2026-11-02');
  });

  it('programa gerado com a MESMA revisao da rotina => alinhado: nada a refazer', async () => {
    expect(await service({ plan: { id: 'p', inputSnapshot: { routineRevision: 6 } } }).routineAlignment('u')).toMatchObject({ status: 'alinhado', stale: false, canRegenerate: false });
  });

  it('rotina mudou mas JA HA treino registrado => NAO pode (o programa fica como esta)', async () => {
    const svc = service({ plan: stalePlan, sessions: [{ scheduledDate: monday2, completion: { id: 'c1' }, executionLinks: [] }] });
    expect(await svc.routineAlignment('u')).toMatchObject({ status: 'ha_execucao', stale: true, canRegenerate: false });
  });

  it('rotina mudou mas ha atividade do relogio vinculada a um treino => NAO pode', async () => {
    const svc = service({ plan: stalePlan, sessions: [{ scheduledDate: monday2, completion: null, executionLinks: [{ id: 'link1' }] }] });
    expect(await svc.routineAlignment('u')).toMatchObject({ status: 'ha_execucao', canRegenerate: false });
  });

  it('rotina mudou mas algum dia do programa ja passou (semana iniciada) => NAO pode', async () => {
    const svc = service({ plan: stalePlan, sessions: [{ scheduledDate: new Date('2026-10-30T00:00:00Z'), completion: null, executionLinks: [] }] });
    expect(await svc.routineAlignment('u')).toMatchObject({ status: 'semana_iniciada', stale: true, canRegenerate: false });
  });

  it('sem programa, sem rotina e rotina de pausa (7 dias de descanso) => nunca oferece refazer', async () => {
    expect(await service({ plan: null }).routineAlignment('u')).toMatchObject({ status: 'sem_programa', canRegenerate: false });
    expect(await service({ routine: null, plan: stalePlan }).routineAlignment('u')).toMatchObject({ status: 'sem_rotina', canRegenerate: false });
    const allRest = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, noTraining: true, modalities: [], availableMin: 0, modalityDurations: null }));
    expect(await service({ routine: allRest, plan: stalePlan }).routineAlignment('u')).toMatchObject({ status: 'sem_rotina', canRegenerate: false });
  });

  it('e leitura PURA: nenhuma escrita no banco', async () => {
    const svc = service({ plan: stalePlan });
    await svc.routineAlignment('u');
    for (const model of Object.values(svc.prisma) as Array<Record<string, jest.Mock>>) for (const [name, fn] of Object.entries(model)) if (/create|update|delete|upsert/.test(name)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('generateCurrentWeekOnDemand: o botao da aluna', () => {
  function onDemand(o: Opts) {
    const svc = service(o);
    const prismaAny = svc.prisma;
    prismaAny.user = {
      findUnique: jest.fn(async () => ({ subscriptionStatus: 'active', name: 'Duane', studentCode: 20, generationWeekStart: monday2, generationAttemptsUsed: 1, generationExtraAttempts: 0, lastGenerationAttemptAt: new Date('2026-11-01T19:36:00Z'), generationExhaustedAlertSent: false })),
      update: jest.fn(async () => ({})),
    };
    svc.reassessmentService = { isReassessmentDue: jest.fn(async () => false) };
    svc.weeklyCheckIn = { hasCheckedInForCurrentPlan: jest.fn(async () => false) };
    svc.studentProfile = { recordEvent: jest.fn(async () => ({})) };
    svc.generateWeek = jest.fn(async () => ({}));
    svc.currentWeekGenerationInFlight = new Map();
    return svc;
  }
  const eligible: Opts = { plan: stalePlan, sessions: [{ scheduledDate: monday2, completion: null, executionLinks: [] }] };

  it('SEM o pedido de rotina nova: com programa ja existente continua "ja_gerado" (nada e refeito, nada e consumido)', async () => {
    const svc = onDemand(eligible);
    expect(await svc.generateCurrentWeekOnDemand('u', undefined, false)).toEqual({ generated: false, reason: 'ja_gerado' });
    expect(svc.generateWeek).not.toHaveBeenCalled();
    expect(svc.prisma.user.update).not.toHaveBeenCalled();
  });

  it('COM o pedido, rotina mudou e nada executado: refaz — sem exigir o check-in de novo, contando uma tentativa', async () => {
    const svc = onDemand(eligible);
    // a tentativa anterior foi ha 15 minutos: fora do intervalo de espera entre tentativas (10 minutos)
    svc.prisma.user.findUnique = jest.fn(async () => ({ subscriptionStatus: 'active', name: 'Duane', studentCode: 20, generationWeekStart: monday2, generationAttemptsUsed: 1, generationExtraAttempts: 0, lastGenerationAttemptAt: new Date('2026-11-01T19:30:00Z'), generationExhaustedAlertSent: false }));
    expect(await svc.generateCurrentWeekOnDemand('u', undefined, true)).toEqual({ generated: true, reason: 'ok' });
    expect(svc.generateWeek).toHaveBeenCalledTimes(1);
    expect(svc.weeklyCheckIn.hasCheckedInForCurrentPlan).not.toHaveBeenCalled();
    expect(svc.prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ generationAttemptsUsed: 2 }) }));
  });

  it('COM o pedido, mas ja ha treino registrado: "nao_pode_refazer" e NADA e gerado', async () => {
    const svc = onDemand({ plan: stalePlan, sessions: [{ scheduledDate: monday2, completion: { id: 'c' }, executionLinks: [] }] });
    expect(await svc.generateCurrentWeekOnDemand('u', undefined, true)).toEqual({ generated: false, reason: 'nao_pode_refazer' });
    expect(svc.generateWeek).not.toHaveBeenCalled();
  });

  it('COM o pedido, mas o programa ja bate com a rotina: "ja_gerado" (nao refaz sem necessidade)', async () => {
    const svc = onDemand({ plan: { id: 'p', inputSnapshot: { routineRevision: 6 } }, sessions: [] });
    expect(await svc.generateCurrentWeekOnDemand('u', undefined, true)).toEqual({ generated: false, reason: 'ja_gerado' });
    expect(svc.generateWeek).not.toHaveBeenCalled();
  });

  it('as travas continuam valendo no refazer: intervalo de espera e tentativas esgotadas', async () => {
    const wait = onDemand(eligible);
    wait.prisma.user.findUnique = jest.fn(async () => ({ subscriptionStatus: 'active', name: 'D', studentCode: 1, generationWeekStart: monday2, generationAttemptsUsed: 1, generationExtraAttempts: 0, lastGenerationAttemptAt: new Date('2026-11-01T19:44:00Z'), generationExhaustedAlertSent: false }));
    expect(await wait.generateCurrentWeekOnDemand('u', undefined, true)).toEqual({ generated: false, reason: 'aguardar_intervalo' });
    const exhausted = onDemand(eligible);
    exhausted.alertCoachAttemptsExhausted = jest.fn(async () => undefined);
    exhausted.prisma.user.findUnique = jest.fn(async () => ({ subscriptionStatus: 'active', name: 'D', studentCode: 1, generationWeekStart: monday2, generationAttemptsUsed: 2, generationExtraAttempts: 0, lastGenerationAttemptAt: new Date('2026-11-01T18:00:00Z'), generationExhaustedAlertSent: true }));
    expect(await exhausted.generateCurrentWeekOnDemand('u', undefined, true)).toEqual({ generated: false, reason: 'tentativas_esgotadas' });
    expect(exhausted.generateWeek).not.toHaveBeenCalled();
  });
});

describe('avisos no app e no painel', () => {
  const controller = root('api', 'src', 'training-plans', 'training-plans.controller.ts');
  const app = root('mobile', 'App.tsx');
  const admin = root('admin', 'app', 'page.tsx');

  it('as rotas existem e so repassam o pedido explicito de rotina nova', () => {
    expect(controller).toContain("@Get('routine-alignment')");
    expect(controller).toContain('dto?.useNewRoutine === true');
  });

  it('antes de gerar, o app mostra a rotina (a mesma tabela) e pede confirmacao; mudar a rotina leva a tela de rotina', () => {
    expect(app).toContain('function RoutineTable(');
    expect(app).toContain('<RoutineTable availability={availability} />'); // a tela de rotina e a confirmacao usam a MESMA tabela
    expect(app).toContain('Confira sua rotina antes de gerar');
    expect(app).toContain('Está correta, gerar meu treino');
    expect(app).toContain('setRoutineGate(routine.availability)');
    expect(app).toContain('onChangeRoutine={() => { setRoutineGate(null); onOpenRoutine?.(); }}');
    expect(app).toContain('onOpenRoutine={() => setActiveTab(\'routine\')}');
  });

  it('a confirmacao aparece nas DUAS telas que tem o botao de gerar', () => {
    expect(app.split('<RoutineConfirmModal').length - 1).toBe(2);
  });

  it('depois de salvar a rotina, a aluna ve o aviso fixo de quando ela vale e, se o servidor confirmar, o caminho para refazer', () => {
    expect(app).toContain('A rotina nova vale a partir da próxima geração do seu programa (liberada aos domingos a partir das 12h). Os treinos que você já recebeu não mudam.');
    expect(app).toContain('Ir para Treinos e gerar de novo');
    expect(app).toContain('onGoToWeek={() => setActiveTab(\'week\')}');
  });

  it('o botao "Gerar de novo com a minha rotina nova" so aparece quando o servidor diz que pode e a espera so termina quando o programa MUDA', () => {
    expect(app).toContain('routineAlignment?.canRegenerate && weekOffset === 0');
    expect(app).toContain('Gerar de novo com a minha rotina nova');
    expect(app).toContain('previousPlanId === null || (data as { id?: string }).id !== previousPlanId');
    expect(app).toContain("data.reason === 'nao_pode_refazer'");
  });

  it('o painel do treinador volta a mostrar (so este motivo) que a rotina mudou depois do programa, junto do botao Refazer', () => {
    expect(admin).toContain('A rotina da aluna mudou depois que este programa foi gerado.');
    expect(admin).toContain('/disponibilidade real/i.test(student.needsUpdateReason');
  });
});
