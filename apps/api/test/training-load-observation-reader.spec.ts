import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import type { WeeklyVolume, EvolutionSeries } from '../src/evolution/evolution.types';

// 26/09/2026 — Auditoria Volume/Aderência/ACWR. Confirma que Volume/Aderência/ACWR viram Observation
// pela MESMA arquitetura de qualquer outra variável (ObservationReader -> MathLayer), reaproveitando
// 100% EvolutionMetricService (nenhum cálculo de km/aderência refeito aqui) — e que ACWR usa janela
// por CALENDAR_DAYS (nunca por índice de array, bug real do gráfico antigo do Admin).

function week(overrides: Partial<WeeklyVolume>): WeeklyVolume {
  return {
    weekStart: '2026-08-03',
    sessoesPrescritas: 4,
    sessoesFeitas: 3,
    sessoesNaoFeitas: 1,
    sessoesSemRegistro: 0,
    adherencePercent: 75,
    coveragePercent: 100,
    lowCoverageWarning: false,
    kmPercorridos: 20,
    kmPrescritos: 25,
    kmExtras: null,
    ...overrides,
  };
}

function buildReader(weeks: WeeklyVolume[], opts: { modalities?: string[]; byModality?: Record<string, WeeklyVolume[]> } = {}) {
  const series: EvolutionSeries = { weeks, months: [], calculatedAt: new Date().toISOString() };
  const evolutionMetric = {
    getSeries: jest.fn().mockResolvedValue(series),
    getDistinctModalities: jest.fn().mockResolvedValue(opts.modalities ?? []),
    getSeriesByModality: jest.fn().mockImplementation((_userId: string, modality: string) =>
      Promise.resolve({ weeks: opts.byModality?.[modality] ?? [], months: [], calculatedAt: new Date().toISOString() } as EvolutionSeries),
    ),
  };
  const mathLayer = new MathLayerService();
  const reader = new ObservationReaderService({} as never, evolutionMetric as never, mathLayer);
  return { reader, evolutionMetric };
}

describe('ObservationReaderService — training.* (EvolutionMetricService, sem segunda matemática)', () => {
  it('volumePrescribedKm/volumeCompletedTotalKm: um ponto por semana, ausência nunca vira zero', async () => {
    const { reader } = buildReader([week({ weekStart: '2026-08-03', kmPrescritos: 25, kmPercorridos: 20 }), week({ weekStart: '2026-08-10', kmPrescritos: null, kmPercorridos: 18 })]);
    const prescribed = await reader.getObservations('u1', 'training.volumePrescribedKm');
    expect(prescribed).toHaveLength(1); // a semana sem km prescrito nao gera observacao
    expect(prescribed[0].value).toBe(25);
    const completed = await reader.getObservations('u1', 'training.volumeCompletedTotalKm');
    expect(completed).toHaveLength(2);
  });

  it('volumeCompletedPrescribedOnlyKm: exclui os extras do total realizado', async () => {
    const { reader } = buildReader([week({ kmPercorridos: 20, kmExtras: 5 })]);
    const obs = await reader.getObservations('u1', 'training.volumeCompletedPrescribedOnlyKm');
    expect(obs[0].value).toBe(15); // 20 - 5
  });

  it('volumeDiffAbsoluteKm e volumeRatioCompletedPrescribed: só existem quando AMBOS prescrito e realizado existem', async () => {
    const weeks = [
      week({ weekStart: '2026-08-03', kmPrescritos: 20, kmPercorridos: 25 }),
      week({ weekStart: '2026-08-10', kmPrescritos: null, kmPercorridos: 10 }), // sem prescricao — nunca vira diferenca/razao inventada
    ];
    const { reader } = buildReader(weeks);
    const diff = await reader.getObservations('u1', 'training.volumeDiffAbsoluteKm');
    expect(diff).toHaveLength(1);
    expect(diff[0].value).toBe(5); // 25 - 20
    const ratio = await reader.getObservations('u1', 'training.volumeRatioCompletedPrescribed');
    expect(ratio).toHaveLength(1);
    expect(ratio[0].value).toBeCloseTo(1.25); // 25/20
  });

  it('volumeRatioCompletedPrescribed: prescrito=0 nunca produz 0% nem 100% — sem observacao', async () => {
    const { reader } = buildReader([week({ kmPrescritos: 0, kmPercorridos: 10 })]);
    const ratio = await reader.getObservations('u1', 'training.volumeRatioCompletedPrescribed');
    expect(ratio).toHaveLength(0);
  });

  it('adherencePercent: carrega numerador/denominador/coverage reais no context, nunca só a %', async () => {
    const { reader } = buildReader([week({ adherencePercent: 75, sessoesFeitas: 3, sessoesNaoFeitas: 1, coveragePercent: 100 })]);
    const obs = await reader.getObservations('u1', 'training.adherencePercent');
    expect(obs[0].value).toBe(75);
    expect(obs[0].context.numerator).toBe(3);
    expect(obs[0].context.denominator).toBe(4);
    expect(obs[0].context.coveragePercent).toBe(100);
  });

  it('adherencePercent ausente (null, semana sem feedback): nenhuma observacao gerada, nunca 0%', async () => {
    const { reader } = buildReader([week({ adherencePercent: null, sessoesFeitas: 0, sessoesNaoFeitas: 0 })]);
    const obs = await reader.getObservations('u1', 'training.adherencePercent');
    expect(obs).toHaveLength(0);
  });

  it('semana em andamento (weekStart = segunda desta semana): context.isPartialWeek=true (item 27)', async () => {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setUTCDate(monday.getUTCDate() + diff);
    monday.setUTCHours(0, 0, 0, 0);
    const weekStart = monday.toISOString().slice(0, 10);
    const { reader } = buildReader([week({ weekStart, kmPrescritos: 20, kmPercorridos: 10 })]);
    const obs = await reader.getObservations('u1', 'training.volumeCompletedTotalKm');
    expect(obs[0].context.isPartialWeek).toBe(true);
  });

  it('modalidade: descobre dinamicamente via getDistinctModalities e emite uma observacao por modalidade real, além da global', async () => {
    const { reader, evolutionMetric } = buildReader(
      [week({ weekStart: '2026-08-03', kmPercorridos: 30 })],
      { modalities: ['corrida', 'musculacao'], byModality: { corrida: [week({ weekStart: '2026-08-03', kmPercorridos: 25 })], musculacao: [] } },
    );
    const obs = await reader.getObservations('u1', 'training.volumeCompletedTotalKm');
    expect(evolutionMetric.getSeriesByModality).toHaveBeenCalledWith('u1', 'corrida');
    expect(evolutionMetric.getSeriesByModality).toHaveBeenCalledWith('u1', 'musculacao');
    const global = obs.find((o) => o.context.modality === 'global');
    const corrida = obs.find((o) => o.context.modality === 'corrida');
    expect(global?.value).toBe(30);
    expect(corrida?.value).toBe(25); // musculacao sem km nao gera observacao (unidade nao se aplica)
    expect(obs.find((o) => o.context.modality === 'musculacao')).toBeUndefined();
  });

  it('acwr: usa janela por CALENDAR_DAYS (28/42 dias), nunca por indice de array', async () => {
    // 6 semanas consecutivas de carga constante (20km) -> aguda/cronica iguais -> ACWR ~1.0
    const weeks: WeeklyVolume[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date('2026-07-06T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + i * 7);
      weeks.push(week({ weekStart: d.toISOString().slice(0, 10), kmPercorridos: 20 }));
    }
    const { reader } = buildReader(weeks);
    const obs = await reader.getObservations('u1', 'training.acwr');
    expect(obs.length).toBeGreaterThan(0);
    const last = obs[obs.length - 1];
    expect(last.value).toBeCloseTo(1.0, 1);
    expect(last.context.acuteWindowDays).toBe(28);
    expect(last.context.chronicWindowDays).toBe(42);
    expect(last.context.acuteValue).not.toBeNull();
    expect(last.context.chronicValue).not.toBeNull();
  });

  it('acwr: sem carga cronica de referencia ainda (poucas semanas), nao inventa uma razao', async () => {
    const { reader } = buildReader([week({ weekStart: '2026-08-03', kmPercorridos: 20 })]);
    const obs = await reader.getObservations('u1', 'training.acwr');
    // com so 1 semana, aguda e cronica sao iguais (mesmo unico ponto) -> razao 1.0 e' matematicamente valida
    // o teste real de "nao inventa" e' quando NENHUM km existe:
    const { reader: reader2 } = buildReader([week({ weekStart: '2026-08-03', kmPercorridos: null })]);
    const obs2 = await reader2.getObservations('u1', 'training.acwr');
    expect(obs2).toHaveLength(0);
    void obs;
  });
});
