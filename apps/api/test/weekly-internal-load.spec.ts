import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { evidenceKindOf, getVariableDefinition } from '../src/training-intelligence/variable-registry';
import { INTERNAL_LOAD_VARIABLE_IDS, WEEKLY_INTERNAL_LOAD_VARIABLE_ID } from '../src/training-intelligence/internal-load';
import { explorerInfoOf } from '../src/training-intelligence/explorer-catalog';

// 02/11/2026 — carga interna percebida SEMANAL (workout.weeklyInternalLoad): soma, por semana (segunda a domingo), das cargas das sessoes elegiveis, para a Evolucao da aluna ter faixa e media
// movel da camada longitudinal. Semana sem sessao elegivel nao gera observacao (nunca zero); GLOBAL + um grupo por modalidade; nao entra no contexto da IA.
const completion = (id: string, date: string, modality: string, rpe: number | null, minutes: number) => ({
  id, sessionId: `s-${id}`, source: 'student', completedAt: new Date(`${date}T15:00:00Z`), status: 'done', durationMin: minutes, perceivedEffort: rpe,
  session: { scheduledDate: new Date(`${date}T00:00:00Z`), modality, title: id, structure: {} },
});

function readerWith(completions: unknown[]) {
  const prisma = {
    workoutCompletion: { findMany: jest.fn().mockResolvedValue(completions) },
    sessionExecutionLink: { findMany: jest.fn().mockResolvedValue([]) },
    activityLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return new ObservationReaderService(prisma as never, {} as never, new MathLayerService());
}

describe('workout.weeklyInternalLoad — registro', () => {
  it('semanal, em UA, calculada pelo sistema, e FORA da lista de variaveis do painel de sessoes e da IA', () => {
    expect(getVariableDefinition(WEEKLY_INTERNAL_LOAD_VARIABLE_ID)).toMatchObject({ source: 'internal_load_weekly', expectedFrequency: 'per_week', scale: { unit: 'UA' }, missingPolicy: 'never_impute' });
    expect(evidenceKindOf(getVariableDefinition(WEEKLY_INTERNAL_LOAD_VARIABLE_ID)!)).toBe('system_calculation');
    expect(INTERNAL_LOAD_VARIABLE_IDS as readonly string[]).not.toContain(WEEKLY_INTERNAL_LOAD_VARIABLE_ID);
    const snapshotSource = readFileSync(join(__dirname, '..', 'src', 'training-intelligence', 'athlete-state-snapshot.service.ts'), 'utf8');
    expect(snapshotSource).not.toContain('weeklyInternalLoad');
    expect(snapshotSource).not.toContain('WEEKLY_INTERNAL_LOAD_VARIABLE_ID');
  });

  it('aparece no Explorar em "Esforco percebido e carga interna"', () => {
    expect(explorerInfoOf(getVariableDefinition(WEEKLY_INTERNAL_LOAD_VARIABLE_ID)!).subgroup).toBe('esforco_carga');
  });
});

describe('workout.weeklyInternalLoad — leitura', () => {
  const reader = readerWith([
    completion('a', '2026-10-06', 'corrida', 6, 40), // 240
    completion('b', '2026-10-08', 'forca', 7, 30), //   210
    completion('c', '2026-10-20', 'corrida', 5, 60), // 300 (semana de 19/10)
    completion('d', '2026-10-21', 'forca', null, 45), // sem PSE: nao entra
  ]);

  it('soma por semana na serie GLOBAL e uma serie por grupo; semana sem sessao elegivel (12/10) nao existe', async () => {
    const obs = await reader.getObservations('s1', WEEKLY_INTERNAL_LOAD_VARIABLE_ID);
    const pick = (scope: string) => obs.filter((o) => o.context.modality === scope).map((o) => [o.timestamp.toISOString(), o.value]);
    expect(pick('global')).toEqual([['2026-10-05T12:00:00.000Z', 450], ['2026-10-19T12:00:00.000Z', 300]]);
    expect(pick('corrida')).toEqual([['2026-10-05T12:00:00.000Z', 240], ['2026-10-19T12:00:00.000Z', 300]]);
    expect(pick('forca')).toEqual([['2026-10-05T12:00:00.000Z', 210]]);
    expect(obs.some((o) => o.timestamp.toISOString().startsWith('2026-10-12'))).toBe(false);
  });

  it('numero de sessoes no contexto (numerator), semana fechada nao e parcial e a fonte e a da carga semanal', async () => {
    const obs = await reader.getObservations('s1', WEEKLY_INTERNAL_LOAD_VARIABLE_ID);
    const week1 = obs.find((o) => o.context.modality === 'global' && o.timestamp.toISOString().startsWith('2026-10-05'))!;
    expect(week1.context).toMatchObject({ numerator: 2, isPartialWeek: false });
    expect(week1.source).toBe('internal_load_weekly');
    // sessao sem PSE (21/10) nao entra nem na contagem da semana de 19/10
    const week3 = obs.find((o) => o.context.modality === 'global' && o.timestamp.toISOString().startsWith('2026-10-19'))!;
    expect(week3.context.numerator).toBe(1);
  });

  it('sem nenhuma sessao elegivel, sem observacoes (nunca uma semana de zero)', async () => {
    expect(await readerWith([completion('x', '2026-10-06', 'corrida', null, 40)]).getObservations('s1', WEEKLY_INTERNAL_LOAD_VARIABLE_ID)).toEqual([]);
  });
});
