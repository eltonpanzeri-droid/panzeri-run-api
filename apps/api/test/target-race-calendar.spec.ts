import { CalendarRace, CalendarSession, buildRaceSession, planRaceCalendarChanges } from '../src/target-races/target-race-calendar';
import { ULTRA_OBJECTIVE, composeObjective, isUltraObjective, parseUltraKm } from '../src/me/objective';

// Prova alvo no calendario (regras do Elton, 29/10/2026) e objetivo "Correr ultramaratona". Dados SINTETICOS.

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const race = (over: Partial<CalendarRace> = {}): CalendarRace => ({ id: 'r1', name: 'Meia de Teste', raceDate: day('2026-11-15'), distanceKm: 21.1, targetSeconds: null, ...over });
const session = (id: string, date: string, modality: string, over: Partial<CalendarSession> = {}): CalendarSession => ({ id, scheduledDate: day(date), modality, origin: 'agent', hasDependents: false, structure: { type: 'run' }, ...over });
const week = { planStart: day('2026-11-09'), planEnd: day('2026-11-15') };

describe('prova alvo no calendario', () => {
  it('dia sem treino (fora da rotina): a prova e criada vinculada a meta', () => {
    const changes = planRaceCalendarChanges({ ...week, races: [race()], sessions: [session('s1', '2026-11-10', 'corrida')] });
    expect(changes.create).toHaveLength(1);
    expect(changes.create[0]).toMatchObject({ targetRaceId: 'r1', modality: 'corrida', sessionType: 'prova', title: 'Meia de Teste', distanceKm: 21.1, origin: 'target_race', weekday: 0 });
    expect(changes.deleteSessionIds).toEqual([]);
  });

  it('corrida prescrita no mesmo dia: a prova SUBSTITUI a corrida', () => {
    const changes = planRaceCalendarChanges({ ...week, races: [race()], sessions: [session('run', '2026-11-15', 'corrida')] });
    expect(changes.deleteSessionIds).toEqual(['run']);
    expect(changes.create).toHaveLength(1);
  });

  it('varias modalidades no dia: substitui so a corrida; forca e fortalecimento permanecem', () => {
    const changes = planRaceCalendarChanges({ ...week, races: [race()], sessions: [session('run', '2026-11-15', 'corrida'), session('str', '2026-11-15', 'forca'), session('fort', '2026-11-15', 'fortalecimento_corredores'), session('esteira', '2026-11-15', 'esteira')] });
    expect(changes.deleteSessionIds.sort()).toEqual(['esteira', 'run']);
  });

  it('corrida que ja tem execucao, vinculo ou entrega a relogio nunca e apagada (fica registrada como mantida)', () => {
    const changes = planRaceCalendarChanges({ ...week, races: [race()], sessions: [session('done', '2026-11-15', 'corrida', { hasDependents: true })] });
    expect(changes.deleteSessionIds).toEqual([]);
    expect(changes.kept).toEqual(['done']);
  });

  it('sessoes extras do aluno ou do dispositivo (execucao real) nunca sao substituidas', () => {
    const changes = planRaceCalendarChanges({ ...week, races: [race()], sessions: [session('x', '2026-11-15', 'corrida', { origin: 'student_extra' }), session('y', '2026-11-15', 'corrida', { origin: 'device_extra' })] });
    expect(changes.deleteSessionIds).toEqual([]);
  });

  it('regenerar a semana nao duplica: com a sessao da prova ja existente, so atualiza', () => {
    const existing = session('race-s', '2026-11-15', 'corrida', { origin: 'target_race', structure: { type: 'run', race: { targetRaceId: 'r1' } } });
    const changes = planRaceCalendarChanges({ ...week, races: [race({ distanceKm: 21.0975 })], sessions: [existing] });
    expect(changes.create).toEqual([]);
    expect(changes.update).toHaveLength(1);
    expect(changes.update[0]).toMatchObject({ sessionId: 'race-s', data: { distanceKm: 21.0975 } });
    // rodar de novo sobre o mesmo estado e estavel (idempotente)
    expect(planRaceCalendarChanges({ ...week, races: [race()], sessions: [existing] }).create).toEqual([]);
  });

  it('data alterada: a sessao antiga sai e a nova entra na data certa; meta excluida ou concluida: a sessao vinculada sai', () => {
    const old = session('race-s', '2026-11-15', 'corrida', { origin: 'target_race', structure: { race: { targetRaceId: 'r1' } } });
    const moved = planRaceCalendarChanges({ ...week, races: [race({ raceDate: day('2026-11-13') })], sessions: [old] });
    expect(moved.deleteSessionIds).toEqual(['race-s']);
    expect(moved.create[0].scheduledDate).toEqual(day('2026-11-13'));
    const removed = planRaceCalendarChanges({ ...week, races: [], sessions: [old] });
    expect(removed.deleteSessionIds).toEqual(['race-s']);
    expect(removed.create).toEqual([]);
  });

  it('data movida para fora da semana: sai deste programa (a semana certa recebe a prova quando for gerada)', () => {
    const old = session('race-s', '2026-11-15', 'corrida', { origin: 'target_race', structure: { race: { targetRaceId: 'r1' } } });
    const changes = planRaceCalendarChanges({ ...week, races: [race({ raceDate: day('2026-11-22') })], sessions: [old] });
    expect(changes.deleteSessionIds).toEqual(['race-s']);
    expect(changes.create).toEqual([]);
  });

  it('prova de outra semana nao entra; duas provas no mesmo programa entram as duas', () => {
    expect(planRaceCalendarChanges({ ...week, races: [race({ raceDate: day('2026-12-20') })], sessions: [] }).create).toEqual([]);
    const both = planRaceCalendarChanges({ ...week, races: [race(), race({ id: 'r2', name: 'Corrida 5K', raceDate: day('2026-11-11'), distanceKm: 5 })], sessions: [] });
    expect(both.create.map((c) => c.targetRaceId).sort()).toEqual(['r1', 'r2']);
  });

  it('tempo-alvo vira duracao prevista; sem meta de tempo nada e estimado', () => {
    expect(buildRaceSession(race({ targetSeconds: 6300 })).durationMin).toBe(105);
    expect(buildRaceSession(race()).durationMin).toBeNull();
  });
});

describe('objetivo: correr ultramaratona', () => {
  it('aceita 3 digitos e provas acima de 100 km; recusa abaixo da maratona e valores invalidos', () => {
    expect(parseUltraKm(100)).toBe(100);
    expect(parseUltraKm('161,5')).toBe(161.5);
    expect(parseUltraKm(999)).toBe(999);
    for (const bad of [42, 42.195, 10, 1000, 'abc', null, undefined, NaN]) expect(parseUltraKm(bad)).toBeNull();
  });

  it('o objetivo operacional leva a distancia (o prescritor, o painel e a reavaliacao leem esse texto); os demais objetivos passam intactos', () => {
    expect(composeObjective(ULTRA_OBJECTIVE, 100)).toBe('Correr ultramaratona de 100 km');
    expect(composeObjective(ULTRA_OBJECTIVE, '161,5')).toBe('Correr ultramaratona de 161,5 km');
    expect(composeObjective(ULTRA_OBJECTIVE, undefined)).toBe('Correr ultramaratona');
    expect(composeObjective('Completar 42 km', 100)).toBe('Completar 42 km');
    expect(composeObjective('   ', 100)).toBeNull();
    expect(isUltraObjective('Correr ultramaratona de 100 km')).toBe(true);
    expect(isUltraObjective('Completar 42 km')).toBe(false);
  });

  it('trocar de ultramaratona para outro objetivo descarta a distancia', () => {
    expect(composeObjective('Completar 21 km', 100)).toBe('Completar 21 km');
  });
});
