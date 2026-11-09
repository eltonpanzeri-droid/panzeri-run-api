import { canonicalModality, isRunModality } from '../src/activity-execution/canonical-modality';
import { normalizeRoutineDay } from '../src/me/routine.rules';
import { computeRunSlots } from '../src/training-plans/training-methodology';

// Ordem de Elton (09/11/2026): so' existe CORRIDA. Esteira nao e' modalidade; entra como corrida em qualquer porta.
describe('so existe corrida (caso Thais: corrida + esteira no mesmo dia viravam 6 dias)', () => {
  it('esteira e sinonimos viram corrida no vocabulario central', () => {
    for (const raw of ['esteira', 'Esteira', 'treadmill', 'treadmill_running', 'corrida', 'RUNNING']) {
      expect(canonicalModality(raw)).toBe('corrida');
      expect(isRunModality(raw)).toBe(true);
    }
    expect(isRunModality('caminhada')).toBe(false);
  });

  it('a gravacao da rotina nunca guarda corrida+esteira no mesmo dia e converte a duracao', () => {
    const day = normalizeRoutineDay({ weekday: 2, noTraining: false, modalities: ['corrida', 'esteira'], availableMin: 45, modalityDurations: { esteira: 45 } } as never);
    expect(day.modalities).toEqual(['corrida']);
    expect(day.modalityDurations).toEqual({ corrida: 45 });
    const onlyTreadmill = normalizeRoutineDay({ weekday: 4, noTraining: false, modalities: ['esteira'], availableMin: 30, modalityDurations: {} } as never);
    expect(onlyTreadmill.modalities).toEqual(['corrida']);
    const explicit = normalizeRoutineDay({ weekday: 0, noTraining: false, modalities: ['esteira', 'corrida'], availableMin: 90, modalityDurations: { corrida: 90, esteira: 60 } } as never);
    expect(explicit.modalityDurations).toEqual({ corrida: 90 });
  });

  it('linha antiga com corrida+esteira conta UM dia de corrida (ate a migracao dos dados)', () => {
    const slots = computeRunSlots([
      { weekday: 0, modalities: ['corrida', 'esteira'], availableMin: 90 },
      { weekday: 2, modalities: ['esteira', 'corrida'], availableMin: 45, modalityDurations: { corrida: 45 } },
      { weekday: 4, modalities: ['esteira'], availableMin: 45 },
      { weekday: 5, modalities: ['forca'], availableMin: 40 },
    ] as never);
    expect(slots).toEqual([{ weekday: 0, durationMin: 90 }, { weekday: 2, durationMin: 45 }, { weekday: 4, durationMin: 45 }]);
  });
});
