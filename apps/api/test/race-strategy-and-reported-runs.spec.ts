import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describeSelfReportedRuns } from '../src/best-marks/best-marks';
import { AiWeeklyDecisionSchema, PrescriptionAgentService, RACE_STRATEGY_INSTRUCTION, SELF_REPORTED_RUNS_INSTRUCTION } from '../src/training-plans/prescription-agent.service';
import { acceptRaceStrategies, MethodologyInput, racesInWeek } from '../src/training-plans/training-methodology';
import { buildRaceSession, racePaceText } from '../src/target-races/target-race-calendar';
import { TargetRaceCalendarService } from '../src/target-races/target-race-calendar.service';

// 09/11/2026 (caso Brenda): (a) relato de distancias da entrevista junto do registrado, (b) pace-alvo no cartao da prova, (c) a IA escreve a estrategia do dia da prova.
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
const weekDates = [{ weekday: 2, date: '2026-11-10' }, { weekday: 6, date: '2026-11-14' }];
const race = { id: 'race-1', name: 'Corrida de aniversario', raceDate: '2026-11-14T00:00:00.000Z', distanceKm: 30.4, paceSecondsPerKm: 385, targetSeconds: 11700, city: 'Contagem', state: 'MG', startTime: '06:00' };

describe('(b) pace-alvo no cartao da prova', () => {
  it('6:25/km = 3h15 para 30,4 km (meta da propria aluna); sem tempo-alvo nao ha pace', () => {
    expect(racePaceText({ distanceKm: 30.4, targetSeconds: 11700 })).toBe('6:25/km');
    expect(racePaceText({ distanceKm: 30.4, targetSeconds: null })).toBeNull();
    expect(racePaceText({ distanceKm: 0, targetSeconds: 100 })).toBeNull();
  });
  it('a sessao da prova leva o pace no formato que o app e o painel ja leem (structure.paceRange) e mantem tempo/distancia', () => {
    const session = buildRaceSession({ id: 'race-1', name: 'Corrida de aniversario', raceDate: new Date('2026-11-14T00:00:00Z'), distanceKm: 30.4, targetSeconds: 11700 });
    expect(session.structure).toMatchObject({ type: 'run', blocks: [], paceRange: '6:25/km', race: { targetRaceId: 'race-1', targetSeconds: 11700 } });
    expect(session.durationMin).toBe(195);
    const noTarget = buildRaceSession({ id: 'r2', name: 'Prova', raceDate: new Date('2026-11-14T00:00:00Z'), distanceKm: 10, targetSeconds: null });
    expect('paceRange' in noTarget.structure).toBe(false);
  });
  it('o painel mostra o pace alvo da prova (estatico)', () => {
    expect(readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8')).toContain('Pace alvo da prova: {String(structure.paceRange)} (meta informada pela aluna)');
  });
});

describe('(c) estrategia do dia da prova escrita pela IA', () => {
  it('provas da semana: so as que caem nas datas da semana e tem id', () => {
    expect(racesInWeek([race, { ...race, id: 'r2', raceDate: '2026-11-21T00:00:00.000Z' }, { ...race, id: undefined }] as never, weekDates)).toEqual([
      { id: 'race-1', name: 'Corrida de aniversario', date: '2026-11-14', weekday: 6, distanceKm: 30.4, targetSeconds: 11700, paceSecondsPerKm: 385, city: 'Contagem', state: 'MG', startTime: '06:00' },
    ]);
    expect(racesInWeek(undefined, weekDates)).toEqual([]);
  });
  it('aceita so estrategias de provas da semana, sem repetir id, sem texto vazio, truncando', () => {
    const accepted = acceptRaceStrategies([
      { raceId: 'race-1', estrategia: '  Largue controlada.   Hidrate-se.  ' },
      { raceId: 'race-1', estrategia: 'duplicada' },
      { raceId: 'outra', estrategia: 'prova que nao e desta semana' },
      { raceId: 'race-1', estrategia: '   ' },
    ], ['race-1']);
    expect(accepted).toEqual([{ raceId: 'race-1', strategy: 'Largue controlada. Hidrate-se.' }]);
    expect(acceptRaceStrategies([{ raceId: 'race-1', estrategia: 'x'.repeat(2000) }], ['race-1'], 100)[0].strategy).toHaveLength(100);
    expect(acceptRaceStrategies(null, ['race-1'])).toEqual([]);
  });
  it('o schema da resposta NAO tem provasAlvo (a Anthropic recusou por gramatica grande, 09/11) e a saida estruturada continua valida', () => {
    expect(Object.keys(AiWeeklyDecisionSchema.shape)).not.toContain('provasAlvo');
    expect(() => zodOutputFormat(AiWeeklyDecisionSchema)).not.toThrow();
    expect(JSON.stringify(zodOutputFormat(AiWeeklyDecisionSchema).schema)).not.toContain('provasAlvo');
  });
  const service = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as { buildUserPrompt: (...a: unknown[]) => string; buildSystemPromptStable: () => string };
  const build = (extra: Partial<MethodologyInput>) => {
    const input = { goal: 'Melhorar o tempo nos 21 km', experience: '', answers: {}, availability: [], history: [], weekDates, ...extra } as MethodologyInput;
    const raw = service.buildUserPrompt(input, [], [], false, false, {}, null);
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, any>;
  };
  it('o prompt do usuario traz as provas DESTA semana com id, pace-alvo, cidade e horario; sem prova na semana vai vazio', () => {
    const json = build({ targetRaces: [race as never] });
    expect(json.provasAlvoNestaSemana).toEqual([{ id: 'race-1', nome: 'Corrida de aniversario', data: '2026-11-14', diaDaSemana: 6, distanciaKm: 30.4, tempoAlvoSegundos: 11700, paceAlvoSegundosPorKm: 385, cidade: 'Contagem', uf: 'MG', horarioDaLargada: '06:00' }]);
    expect(build({ targetRaces: [{ ...race, raceDate: '2026-12-20T00:00:00.000Z' } as never] }).provasAlvoNestaSemana).toEqual([]);
    expect(build({}).provasAlvoNestaSemana).toEqual([]);
  });
  it('o prompt de sistema tem as duas instrucoes novas e nenhuma diz "motor" nem "plano de treino"', () => {
    const system = service.buildSystemPromptStable();
    expect(system).not.toContain(RACE_STRATEGY_INSTRUCTION);
    expect(system).toContain(SELF_REPORTED_RUNS_INSTRUCTION);
    expect(RACE_STRATEGY_INSTRUCTION).toContain('provasAlvo');
    expect(RACE_STRATEGY_INSTRUCTION).toContain('NAO e escrito por voce');
    expect(`${RACE_STRATEGY_INSTRUCTION} ${SELF_REPORTED_RUNS_INSTRUCTION}`).not.toMatch(/motor|plano de treino/i);
  });
  it('a estrategia aceita sai da decisao e e gravada no cartao da prova depois da sincronizacao (estatico)', () => {
    expect(read('src', 'training-plans', 'prescription-agent.service.ts')).toContain('raceStrategies: acceptRaceStrategies(undefined, racesInWeek(input.targetRaces, input.weekDates).map((race) => race.id)),');
    const plans = read('src', 'training-plans', 'training-plans.service.ts');
    expect(plans.indexOf('await this.raceCalendar?.syncUser(userId);')).toBeLessThan(plans.indexOf('applyRaceStrategies(userId, methodology.raceStrategies'));
  });
});

describe('TargetRaceCalendarService.applyRaceStrategies', () => {
  function build(rows: Array<{ id: string }>, fail = false) {
    const prisma: any = {
      trainingSession: {
        findMany: jest.fn(async () => { if (fail) throw new Error('banco fora'); return rows; }),
        update: jest.fn(async () => ({})),
      },
    };
    return { service: new TargetRaceCalendarService(prisma), prisma };
  }
  it('grava o texto em notes so da sessao da prova ativa com o vinculo exato da meta', async () => {
    const { service, prisma } = build([{ id: 's1' }]);
    expect(await service.applyRaceStrategies('u1', [{ raceId: 'race-1', strategy: 'Largue controlada.' }])).toBe(1);
    expect(prisma.trainingSession.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', origin: 'target_race', plan: { status: 'active' }, structure: { path: ['race', 'targetRaceId'], equals: 'race-1' } });
    expect(prisma.trainingSession.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { notes: 'Largue controlada.' } });
  });
  it('sem sessao da prova nao grava nada; erro do banco nao derruba a geracao', async () => {
    const none = build([]);
    expect(await none.service.applyRaceStrategies('u1', [{ raceId: 'race-1', strategy: 'x' }])).toBe(0);
    expect(none.prisma.trainingSession.update).not.toHaveBeenCalled();
    const failing = build([{ id: 's1' }], true);
    await expect(failing.service.applyRaceStrategies('u1', [{ raceId: 'race-1', strategy: 'x' }])).resolves.toBe(0);
    expect(await build([]).service.applyRaceStrategies('u1', [])).toBe(0);
  });
});

describe('(a) relato de distancias da entrevista', () => {
  const answers = { longest_distance: 24, longest_distance_recent_count: 1, longest_distance_recent_time: '2:31:00', second_longest_distance_recent: 21, second_longest_distance_recent_count: 3, third_longest_distance_recent: 18, third_longest_distance_recent_count: 4 };
  const svc = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as { buildUserPrompt: (...a: unknown[]) => string };
  it('a IA recebe o relato separado do registrado, rotulado e com o tempo da maior distancia', () => {
    const input = { goal: 'x', experience: '', answers, availability: [], history: [], selfReportedLongRuns: [
      { position: 1, distanceKm: 24, distanceRaw: null, timesRun: 1, timeSeconds: 9060 },
      { position: 2, distanceKm: 21, distanceRaw: null, timesRun: 3, timeSeconds: null },
    ] } as MethodologyInput;
    const raw = svc.buildUserPrompt(input, [], [], false, false, {}, null);
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    expect(json.relatoDeDistanciasNaEntrevista).toEqual([
      { posicao: 1, distanciaKm: 24, vezesNosUltimos6Meses: 1, tempoDaCorrida: '2:31:00' },
      { posicao: 2, distanciaKm: 21, vezesNosUltimos6Meses: 3, tempoDaCorrida: null },
    ]);
    expect(json.maiorLongaoJaRegistrado).toBeNull(); // o registrado continua separado
  });
  it('sem relato a lista vai vazia', () => {
    const raw = svc.buildUserPrompt({ goal: 'x', experience: '', answers: {}, availability: [], history: [] } as MethodologyInput, [], [], false, false, {}, null);
    expect(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).relatoDeDistanciasNaEntrevista).toEqual([]);
  });
  it('o Prontuario recebe o relato rotulado (sem comprovacao) junto do evento da entrevista inicial', () => {
    expect(describeSelfReportedRuns(answers)).toBe(' Maiores distancias RELATADAS na entrevista (ultimos 6 meses, relato da aluna, sem comprovacao por relogio): 24 km (1 vez, tempo 2:31:00); 21 km (3 vezes); 18 km (4 vezes).');
    expect(describeSelfReportedRuns({})).toBe('');
    expect(read('src', 'me', 'me.service.ts')).toContain("${describeSelfReportedRuns(answers)}");
    expect(read('src', 'training-plans', 'training-plans.service.ts')).toContain('selfReportedLongRuns: selfReportedRuns(answers)');
  });
});
