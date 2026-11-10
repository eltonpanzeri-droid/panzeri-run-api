import { runOnlyRoutineDay } from '../src/common/routine-state';
import { computeRunSlots } from '../src/training-plans/training-methodology';
import * as fs from 'fs';
import * as path from 'path';

// 09/11/2026 (caso Fernanda, 2 treinos na terca): rotina antiga com corrida+esteira no mesmo dia vira UMA corrida em qualquer leitura.
describe('rotina: so existe corrida', () => {
  it('corrida+esteira no mesmo dia vira uma corrida so, com a duracao da corrida', () => {
    const day = runOnlyRoutineDay({ weekday: 2, noTraining: false, availableMin: 120, modalities: ['esteira', 'corrida', 'forca'], modalityDurations: { esteira: 90, corrida: 120, forca: 30 } });
    expect(day.modalities).toEqual(['corrida', 'forca']);
    expect(day.modalityDurations).toEqual({ corrida: 120, forca: 30 });
  });
  it('so esteira: vira corrida com a duracao que tinha', () => {
    const day = runOnlyRoutineDay({ modalities: ['treadmill'], modalityDurations: { treadmill: 60 } });
    expect(day.modalities).toEqual(['corrida']);
    expect(day.modalityDurations).toEqual({ corrida: 60 });
  });
  it('um dia gera uma unica vaga de corrida, mesmo vindo de esteira+corrida', () => {
    const day = runOnlyRoutineDay({ weekday: 0, availableMin: 45, modalities: ['corrida', 'esteira'], modalityDurations: { corrida: 45, esteira: 45 } });
    expect(computeRunSlots([day as any])).toEqual([{ weekday: 0, durationMin: 45 }]);
  });
  it('a migracao dos dados antigos existe e cobre rotina, treinos e analises', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261109220000_esteira_vira_corrida/migration.sql'), 'utf8');
    for (const table of ['WeeklyAvailability', 'TrainingSession', 'SessionExecutionAnalysis', 'PrescriptionDecision', 'UserAchievement']) expect(sql).toContain(`"${table}"`);
  });
});
