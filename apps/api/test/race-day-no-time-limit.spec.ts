import { readFileSync } from 'fs';
import { join } from 'path';
import { injectTargetRaceDays } from '../src/training-plans/training-plans.service';
import { computeRunSlots, raceCoveredWeekdays } from '../src/training-plans/training-methodology';
import { RACE_CALENDAR_INSTRUCTION } from '../src/training-plans/prescription-agent.service';

// 19/11/2026 (Elton): o dia da prova NAO tem limite de tempo; o tempo e o ritmo vem da propria prova (pace alvo do aluno). Antes o dia injetado trazia 180 min fixos (uma ultra de 56 km passa disso).
describe('dia da prova sem limite de tempo', () => {
  const weekStart = new Date('2026-11-16T00:00:00.000Z'); // segunda
  const routine = [{ weekday: 2, modalities: ['corrida'], availableMin: 50 }, { weekday: 4, modalities: ['corrida'], availableMin: 60 }];
  const sunday = new Date('2026-11-22T00:00:00.000Z');

  it('o dia injetado nao carrega mais 180 min: vem sem tempo e marcado como dia de prova', () => {
    const result = injectTargetRaceDays(routine, [{ raceDate: sunday }], weekStart) as Array<Record<string, unknown>>;
    const race = result.find((day) => day.weekday === 0)!;
    expect(race.availableMin).toBeNull();
    expect(race.raceDay).toBe(true);
    expect(JSON.stringify(result)).not.toContain('180');
    // a rotina original continua igual
    expect(result.filter((day) => day.weekday !== 0)).toEqual(routine);
  });

  it('a IA nao recebe o dia da prova como dia de corrida com tempo; os dias da rotina continuam iguais', () => {
    const injected = injectTargetRaceDays(routine, [{ raceDate: sunday }], weekStart) as never;
    const slots = computeRunSlots(injected);
    expect(slots).toEqual([{ weekday: 2, durationMin: 50 }, { weekday: 4, durationMin: 60 }]);
    // sem dia de prova na semana nada muda
    expect(computeRunSlots(routine as never)).toEqual(slots);
  });

  it('o dia da prova continua "coberto por prescricao de prova alvo" (nao gera aviso de falta de cobertura)', () => {
    const weekDates = [{ weekday: 0, date: '2026-11-22' }, { weekday: 2, date: '2026-11-17' }];
    expect(raceCoveredWeekdays([{ raceDate: '2026-11-22' }], weekDates)).toEqual([0]);
  });

  it('o prompt da prova diz que o dia da prova nao tem limite de tempo e guia pelo pace alvo', () => {
    expect(RACE_CALENDAR_INSTRUCTION).toContain('O DIA DA PROVA NAO TEM LIMITE DE TEMPO');
    expect(RACE_CALENDAR_INSTRUCTION).toContain('paceAlvoSegundosPorKm');
    expect(RACE_CALENDAR_INSTRUCTION).not.toContain("'");
  });

  it('o marcador raceDay chega a metodologia (a IA e o conferidor usam a mesma lista de dias)', () => {
    const service = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'training-plans.service.ts'), 'utf8');
    expect(service).toContain('raceDay: (day as { raceDay?: boolean }).raceDay === true');
  });
});
