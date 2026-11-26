import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';

// 26/11/2026 — ordem de Elton: regenerar um dia de corrida segue a MESMA logica da geracao da semana (mesmo agente, mesmas informacoes) e a duracao e decidida pelo agente.
// Caso Juliana: o sabado de 17 min continuava 17 min depois de "regenerar o dia" porque a duracao antiga era reaproveitada.
const service = () => new PrescriptionAgentService({ get: jest.fn().mockReturnValue('x') } as never, { run: (fn: () => Promise<unknown>) => fn() } as never) as any;
const baseInput = (extra: Record<string, unknown> = {}) => ({ goal: 'g', experience: 'e', answers: {}, availability: [{ weekday: 6, modalities: ['corrida'], availableMin: 120 }], history: [], ...extra });
const evidence = {};

describe('proposeRunSession com a entrada da semana', () => {
  it('usa o agente da semana e devolve a sessao do dia pedido, com a duracao decidida por ele', async () => {
    const svc = service();
    const sat = { weekday: 6, title: 't', durationMin: 95, notes: 'texto novo', parts: [{ kind: 'continua', distanceKm: 15, paceSecondsPerKmMin: 330, paceSecondsPerKmMax: 345 }], declared: null };
    svc.proposeWeeklyDecision = jest.fn(async () => ({ sessions: [{ ...sat, weekday: 2 }, sat], strengthSessions: [] }));
    const result = await svc.proposeRunSession({ durationMin: 17, evidence, studentDirectives: [], activeObservations: [], painTier: 'normal', painReason: null, weeklyInput: baseInput(), weekday: 6 });
    expect(svc.proposeWeeklyDecision).toHaveBeenCalledTimes(1);
    expect(result.decision.weekday).toBe(6);
    expect(result.decision.durationMin).toBe(95);
    expect(result.parts).toHaveLength(1);
  });
  it('sem sessao para o dia, devolve null (o servico avisa o treinador e nao altera o treino)', async () => {
    const svc = service();
    svc.proposeWeeklyDecision = jest.fn(async () => ({ sessions: [], strengthSessions: [] }));
    const result = await svc.proposeRunSession({ durationMin: 17, evidence, studentDirectives: [], activeObservations: [], painTier: 'normal', painReason: null, weeklyInput: baseInput(), weekday: 6 });
    expect(result).toBeNull();
  });
});

describe('prompt do usuario: a marca de "um dia so" aparece apenas ao regenerar um dia', () => {
  const build = (input: unknown) => JSON.parse(service().buildUserPrompt(input, [], [], false, false, evidence, null));
  it('na semana normal a chave nao existe', () => {
    expect(build(baseInput())).not.toHaveProperty('regeneracaoDeUmDiaSomente');
  });
  it('ao regenerar um dia traz o aviso e as outras sessoes da semana, com as provas e o historico da semana', () => {
    const prompt = build(baseInput({
      singleDayRegeneration: { weekday: 6, otherSessionsThisWeek: [{ weekday: 2, modality: 'corrida', durationMin: 40, distanceKm: 6.5, status: 'prescrita' }] },
      targetRaces: [{ name: 'Corrida 100% Voce', raceDate: '2026-11-29T00:00:00.000Z', distanceKm: 5, paceSecondsPerKm: 300, performanceIntent: 1, socialIntent: 10, personalImportance: null, perceivedDifficulty: null, dedicationWillingness: null, achievementSatisfaction: null, confidenceLevel: 10, injuryConcern: 1, adjustmentOpenness: null, anxietyLevel: null, isFirstTimeAtDistance: false }],
      weekDates: [{ weekday: 6, date: '2026-11-28' }],
    }));
    expect(prompt.regeneracaoDeUmDiaSomente.aviso).toContain('weekday 6');
    expect(prompt.regeneracaoDeUmDiaSomente.outrasSessoesDaSemana).toHaveLength(1);
    expect(prompt.metasDeProva[0].oQuantoQuerMelhorarPerformance).toBe(1);
    expect(prompt.dataDeCadaDiaDaSemanaSendoGerada).toEqual([{ weekday: 6, date: '2026-11-28' }]);
  });
});

describe('musculacao e fortalecimento: o dia tambem usa o agente da semana (qualquer modalidade)', () => {
  it('proposeStrengthSession com a entrada de um dia so delega ao agente da semana e devolve a sessao do dia', async () => {
    const svc = service();
    const strength = { weekday: 1, modality: 'forca', title: 't', exerciseIds: ['a', 'b', 'c'], sets: 4, reps: '3', restSeconds: 150, intensity: 'Forte', notes: 'n', declared: null };
    svc.proposeWeeklyDecision = jest.fn(async () => ({ sessions: [], strengthSessions: [{ ...strength, weekday: 3 }, strength] }));
    const input = baseInput({ availability: [{ weekday: 1, modalities: ['forca'], availableMin: 75 }], singleDayRegeneration: { weekday: 1, modality: 'forca', otherSessionsThisWeek: [] } });
    const result = await svc.proposeStrengthSession(input, { weekday: 1, modality: 'forca', durationMin: 75 });
    expect(svc.proposeWeeklyDecision).toHaveBeenCalledTimes(1);
    expect(result.weekday).toBe(1);
    expect(result.sets).toBe(4);
  });
  it('o aviso do prompt menciona a modalidade do dia', () => {
    const prompt = JSON.parse(service().buildUserPrompt(baseInput({ singleDayRegeneration: { weekday: 1, modality: 'forca', otherSessionsThisWeek: [] } }), [], [], false, false, evidence, null));
    expect(prompt.regeneracaoDeUmDiaSomente.aviso).toContain('modalidade forca');
  });
  it('o servico monta o mesmo contexto para qualquer modalidade (antes do ramo forca/corrida)', () => {
    const plans = readFileSync(join(__dirname, '../src/training-plans/training-plans.service.ts'), 'utf8');
    expect(plans).toContain('{ ...weeklyInput, strengthSplitPreference }');
  });
});

describe('servico: a regeneracao do dia usa o contexto da semana e atualiza duracao e texto da corrida', () => {
  const plans = readFileSync(join(__dirname, '../src/training-plans/training-plans.service.ts'), 'utf8');
  it('monta o contexto da semana e envia ao agente', () => {
    expect(plans).toContain('loadDayWeeklyContext(userId, session, answers)');
    expect(plans).toMatch(/weeklyInput,\s+weekday: session\.weekday/);
  });
  it('a duracao vem da decisao do agente e a duracao, o texto e o rotulo do dia sao gravados (nao ficam os da sessao antiga)', () => {
    expect(plans).toContain('runDecision.decision?.durationMin ?? durationMin');
    expect(plans).toContain('...(runUpdate ? { durationMin: runUpdate.durationMin, notes: runUpdate.notes, sessionType: runUpdate.sessionType } : {}),');
  });
});
