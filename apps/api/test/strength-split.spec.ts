import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { normalizeStrengthSplitAnswer, parseStrengthSplitRecord, STRENGTH_SPLIT_GROUPS, strengthSplitForPrompt, strengthSplitPending } from '../src/common/strength-split';
import { StrengthSplitService } from '../src/me/strength-split.service';
import { gymExerciseLibrary } from '../src/training-plans/gym-exercise-library';
import { STRENGTH_SPLIT_CATALOG_GROUPS } from '../src/common/strength-split';

// 16/11/2026 (ideia de Elton): preferencia de divisao da musculacao por dia. Sem preferencia = IA livre; com preferencia = pedido da aluna entra no contexto da IA.
// Toda troca de rotina (nova revisao) pergunta de novo, para todos os dias de musculacao que ficaram na grade. Fortalecimento para corredores fica de fora.

const TUE_THU_SAT = [2, 4, 6];

describe('opcoes oferecidas', () => {
  it('sao exatamente as sete pedidas por Elton', () => {
    expect([...STRENGTH_SPLIT_GROUPS]).toEqual(['membros_inferiores', 'costas', 'peito', 'ombro', 'biceps', 'triceps', 'abdomen']);
  });
  it('toda opcao aponta para grupos que existem no catalogo de exercicios, e todo grupo do catalogo e coberto por alguma opcao', () => {
    const catalogGroups = new Set(gymExerciseLibrary.map((exercise) => exercise.group as string));
    const covered = new Set(Object.values(STRENGTH_SPLIT_CATALOG_GROUPS).flat());
    for (const group of covered) expect(catalogGroups.has(group)).toBe(true);
    for (const group of catalogGroups) expect(covered.has(group)).toBe(true);
  });
});

describe('validacao da resposta', () => {
  it('sem preferencia: nada guardado alem de "respondeu para esta revisao"', () => {
    const record = normalizeStrengthSplitAnswer({ hasPreference: false, days: { '2': ['peito'] } }, TUE_THU_SAT, 3);
    expect(record).toMatchObject({ answeredRevision: 3, hasPreference: false, days: {} });
  });
  it('com preferencia: varios grupos por dia, duplicados somem, dia sem marcacao vale "sem preferencia"', () => {
    const record = normalizeStrengthSplitAnswer({ hasPreference: true, days: { '2': ['peito', 'triceps', 'peito'], '4': ['membros_inferiores'] } }, TUE_THU_SAT, 3);
    expect(record.hasPreference).toBe(true);
    expect(record.days).toEqual({ '2': ['peito', 'triceps'], '4': ['membros_inferiores'], '6': [] });
  });
  it('disse que tem preferencia mas nao marcou nada em nenhum dia: equivale a sem preferencia', () => {
    const record = normalizeStrengthSplitAnswer({ hasPreference: true, days: { '2': [], '4': [] } }, TUE_THU_SAT, 3);
    expect(record).toMatchObject({ hasPreference: false, days: {} });
  });
  it('dia que nao tem musculacao na rotina e grupo desconhecido sao recusados', () => {
    expect(() => normalizeStrengthSplitAnswer({ hasPreference: true, days: { '1': ['peito'] } }, TUE_THU_SAT, 3)).toThrow(BadRequestException);
    expect(() => normalizeStrengthSplitAnswer({ hasPreference: true, days: { '2': ['pescoco'] } }, TUE_THU_SAT, 3)).toThrow(BadRequestException);
    expect(() => normalizeStrengthSplitAnswer({ hasPreference: true, days: { '2': 'peito' } }, TUE_THU_SAT, 3)).toThrow(BadRequestException);
  });
});

describe('quando perguntar', () => {
  const answered = parseStrengthSplitRecord({ answeredRevision: 3, answeredAt: 'x', hasPreference: false, days: {} });
  it('quem tem musculacao e nunca respondeu: pendente', () => expect(strengthSplitPending(null, 3, TUE_THU_SAT)).toBe(true));
  it('respondeu para esta revisao: nao pergunta de novo', () => expect(strengthSplitPending(answered, 3, TUE_THU_SAT)).toBe(false));
  it('a rotina mudou (nova revisao): pergunta de novo, para todos os dias que ficaram', () => expect(strengthSplitPending(answered, 4, TUE_THU_SAT)).toBe(true));
  it('sem musculacao na rotina (so corrida ou so fortalecimento): nunca pergunta', () => expect(strengthSplitPending(null, 3, [])).toBe(false));
});

describe('o que chega a IA', () => {
  const record = normalizeStrengthSplitAnswer({ hasPreference: true, days: { '2': ['peito', 'triceps'], '4': ['membros_inferiores'] } }, TUE_THU_SAT, 3);
  it('so os dias com escolha, com as opcoes e os grupos do catalogo', () => {
    const out = strengthSplitForPrompt(record, 3, TUE_THU_SAT)!;
    expect(out.map((entry) => entry.weekday)).toEqual([2, 4]);
    expect(out[0].grupos.map((g) => g.opcao)).toEqual(['Peito', 'Tríceps']);
    expect(out[1].grupos[0].gruposDoCatalogo).toContain('quadriceps');
  });
  it('resposta de OUTRA revisao da rotina nunca vale (IA livre)', () => expect(strengthSplitForPrompt(record, 4, TUE_THU_SAT)).toBeNull());
  it('dia que deixou de ser musculacao sai do pedido', () => expect(strengthSplitForPrompt(record, 3, [4, 6])!.map((entry) => entry.weekday)).toEqual([4]));
  it('sem preferencia ou sem resposta: null', () => {
    expect(strengthSplitForPrompt(null, 3, TUE_THU_SAT)).toBeNull();
    expect(strengthSplitForPrompt(normalizeStrengthSplitAnswer({ hasPreference: false }, TUE_THU_SAT, 3), 3, TUE_THU_SAT)).toBeNull();
  });
  it('registro corrompido no banco e ignorado sem erro', () => {
    expect(parseStrengthSplitRecord('lixo')).toBeNull();
    expect(parseStrengthSplitRecord({ answeredRevision: 'x' })).toBeNull();
  });
});

describe('servico (leitura e gravacao)', () => {
  const rows = (days: number[]) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, noTraining: !days.includes(weekday), modalities: days.includes(weekday) ? ['forca'] : [], availableMin: 45, modalityDurations: null }));
  function build(opts: { revision?: number; strengthDays?: number[]; stored?: unknown }) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: '' }]),
      weeklyRoutineState: { findUnique: jest.fn().mockResolvedValue({ revision: opts.revision ?? 3, strengthSplit: opts.stored ?? null }), upsert: jest.fn().mockResolvedValue({}) },
      weeklyAvailability: { findMany: jest.fn().mockResolvedValue(rows(opts.strengthDays ?? TUE_THU_SAT)) },
    };
    const prisma = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { service: new StrengthSplitService(prisma as never), tx };
  }

  it('status: pendente quando nunca respondeu; mostra os dias de musculacao e as sete opcoes', async () => {
    const { service } = build({});
    const status = await service.status('u1');
    expect(status).toMatchObject({ applies: true, pending: true, strengthDays: TUE_THU_SAT, revision: 3, current: null, previous: null });
    expect(status.groups.map((g) => g.id)).toEqual([...STRENGTH_SPLIT_GROUPS]);
  });

  it('status: depois de a rotina mudar, a resposta antiga so pre-preenche (previous) e a pergunta volta', async () => {
    const stored = { answeredRevision: 2, answeredAt: 'x', hasPreference: true, days: { '2': ['peito'] } };
    const status = await build({ revision: 3, stored }).service.status('u1');
    expect(status.pending).toBe(true);
    expect(status.current).toBeNull();
    expect(status.previous).toMatchObject({ hasPreference: true });
  });

  it('status: sem musculacao na rotina nao se aplica', async () => {
    const status = await build({ strengthDays: [] }).service.status('u1');
    expect(status).toMatchObject({ applies: false, pending: false });
  });

  it('gravar: guarda a resposta na revisao atual e NAO mexe na rotina nem na revisao', async () => {
    const { service, tx } = build({});
    const result = await service.save('u1', { expectedRevision: 3, hasPreference: true, days: { '2': ['peito', 'triceps'] } });
    expect(result).toMatchObject({ saved: true, hasPreference: true });
    const call = tx.weeklyRoutineState.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ strengthSplit: expect.objectContaining({ answeredRevision: 3, hasPreference: true }) });
    expect(call.update).not.toHaveProperty('revision');
  });

  it('gravar sobre rotina que mudou nesse meio tempo: 409, nada gravado', async () => {
    const { service, tx } = build({ revision: 4 });
    await expect(service.save('u1', { expectedRevision: 3, hasPreference: false })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.weeklyRoutineState.upsert).not.toHaveBeenCalled();
  });

  it('gravar dia que nao e de musculacao: 400', async () => {
    const { service } = build({});
    await expect(service.save('u1', { expectedRevision: 3, hasPreference: true, days: { '1': ['peito'] } })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ligacoes estaticas', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
  it('rotas, modulo, prompt da semana e prompt de um dia de forca usam a preferencia', () => {
    const controller = read('src', 'me', 'me.controller.ts');
    expect(controller).toContain("@Get('strength-split')");
    expect(controller).toContain("@Put('strength-split')");
    expect(read('src', 'me', 'me.module.ts')).toContain('StrengthSplitService');
    const agent = read('src', 'training-plans', 'prescription-agent.service.ts');
    expect(agent).toContain('preferenciaDeDivisaoDaMusculacaoPorDia: input.strengthSplitPreference');
    expect(agent).toContain('preferenciaDeDivisaoDaAlunaParaEsteDia');
    expect(agent).toContain('SPLIT_PREFERENCE_INSTRUCTION,');
    const plans = read('src', 'training-plans', 'training-plans.service.ts');
    expect((plans.match(/strengthSplitForPrompt\(/g) ?? []).length).toBe(2);
  });
  it('a gravacao da rotina nao apaga a resposta (so a revisao muda, e a resposta antiga deixa de valer sozinha)', () => {
    const routine = read('src', 'me', 'routine.service.ts');
    expect(routine).toContain('update: { revision }');
    // a atualizacao da revisao nunca limpa a resposta; so a resposta enviada junto (storeSplit) a reescreve
    expect(routine).toContain('storeSplit(revision)');
  });
});

describe('resposta enviada junto com a rotina (mesma transacao)', () => {
  const { RoutineService } = jest.requireActual('../src/me/routine.service') as typeof import('../src/me/routine.service');
  const day = (weekday: number, modalities: string[]) => ({ weekday, noTraining: modalities.length === 0, modalities, availableMin: modalities.length ? 45 : 0, modalityDurations: Object.fromEntries(modalities.map((m) => [m, 45])) });
  const week = (strength: number[]) => Array.from({ length: 7 }, (_, weekday) => day(weekday, strength.includes(weekday) ? ['forca'] : weekday === 1 ? ['corrida'] : []));

  function build(existing: ReturnType<typeof week> | null, revision: number) {
    const state = { revision, strengthSplit: null as unknown };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: '' }]),
      weeklyRoutineState: { findUnique: jest.fn(async () => (existing ? state : null)), upsert: jest.fn().mockResolvedValue({}) },
      weeklyAvailability: { findMany: jest.fn(async () => existing ?? []), deleteMany: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
      weeklyRoutineChange: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
      trainingPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'p' }) },
      onboardingInterview: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    const routine = new RoutineService(prisma as never, { isGenerationInProgress: jest.fn().mockResolvedValue(false), generateFirstWeekIfNeeded: jest.fn() } as never, { recordEvent: jest.fn() } as never, { notifyCoach: jest.fn() } as never, { } as never);
    return { routine, tx };
  }
  const splitCalls = (tx: ReturnType<typeof build>['tx']) => tx.weeklyRoutineState.upsert.mock.calls.map((c) => c[0]).filter((c) => c.update.strengthSplit);

  it('rotina mudou: a resposta e gravada na revisao NOVA, junto com a rotina', async () => {
    const { routine, tx } = build(week([2, 4]), 3);
    await routine.replaceWeek('u1', week([2, 4, 6]) as never, { source: 'student', expectedRevision: 3, strengthSplit: { hasPreference: true, days: { '2': ['peito'], '6': ['costas', 'biceps'] } } });
    const [call] = splitCalls(tx);
    expect(call.update.strengthSplit).toMatchObject({ answeredRevision: 4, hasPreference: true, days: { '2': ['peito'], '4': [], '6': ['costas', 'biceps'] } });
  });

  it('rotina igual mas a aluna mudou a preferencia: grava na revisao atual, sem nova revisao', async () => {
    const { routine, tx } = build(week([2, 4]), 3);
    const result = await routine.replaceWeek('u1', week([2, 4]) as never, { source: 'student', expectedRevision: 3, strengthSplit: { hasPreference: true, days: { '4': ['membros_inferiores'] } } });
    expect(result.status).toBe('unchanged');
    expect(splitCalls(tx)[0].update.strengthSplit).toMatchObject({ answeredRevision: 3, hasPreference: true });
  });

  it('dia de musculacao que nao existe na rotina enviada: 400 e nada e gravado como resposta', async () => {
    const { routine, tx } = build(week([2, 4]), 3);
    await expect(routine.replaceWeek('u1', week([2, 4]) as never, { source: 'student', expectedRevision: 3, strengthSplit: { hasPreference: true, days: { '5': ['peito'] } } })).rejects.toBeInstanceOf(BadRequestException);
    expect(splitCalls(tx)).toHaveLength(0);
  });

  it('rotina sem musculacao ou envio sem resposta: nenhuma resposta e gravada', async () => {
    const a = build(week([2]), 3);
    await a.routine.replaceWeek('u1', week([]) as never, { source: 'student', expectedRevision: 3, strengthSplit: { hasPreference: true, days: { '2': ['peito'] } } });
    expect(splitCalls(a.tx)).toHaveLength(0);
    const b = build(week([2]), 3);
    await b.routine.replaceWeek('u1', week([2, 4]) as never, { source: 'student', expectedRevision: 3 });
    expect(splitCalls(b.tx)).toHaveLength(0);
  });
});

describe('telas do app (estatico)', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  it('as sete opcoes pedidas por Elton, na ordem, e a pergunta 1 com "Nao, sem preferencia"', () => {
    const block = app.slice(app.indexOf('const STRENGTH_SPLIT_OPTIONS'), app.indexOf('interface StrengthSplitValue'));
    for (const label of ['Membros inferiores', 'Costas', 'Peito', 'Ombro', 'Bíceps', 'Tríceps', 'Abdômen']) expect(block).toContain(label);
    expect(app).toContain('Você tem preferência de distribuição dos treinos por grupo muscular?');
    expect(app).toContain('Não, sem preferência');
  });
  it('a rotina envia a resposta junto e recusa salvar sem a pergunta 1 respondida quando ha musculacao', () => {
    expect(app).toContain('strengthSplitPayload(split, strengthSplitDays.map');
    expect(app).toContain('...(strengthSplit ? { strengthSplit } : {})');
    expect(app).toContain("strengthSplitDays.length > 0 && split.hasPreference === null");
  });
  it('fortalecimento para corredores nao conta como dia de musculacao', () => {
    expect(app).toContain("normalizeModality(modality) === 'forca'");
  });
  it('antes de gerar a semana, quem ainda nao respondeu para a rotina atual responde (modal nos dois ramos da tela)', () => {
    expect(app).toContain('splitStatus?.applies && splitStatus.pending');
    expect((app.match(/<StrengthSplitGateModal /g) ?? []).length).toBe(2);
  });
  it('o aviso de troca de rotina durante a geracao aparece com a mensagem do servidor', () => {
    expect(app).toContain('Nao consegui salvar a rotina: ${apiMessage}');
  });
});
