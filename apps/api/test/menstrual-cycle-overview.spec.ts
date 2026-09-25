import { MenstrualCycleService } from '../src/menstrual-cycle/menstrual-cycle.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';

// 25/09/2026 — Evolução do acompanhamento menstrual. Valida que getCycleOverview() reaproveita
// MathLayerService/LongitudinalDynamicsService (mesma matemática da Training Intelligence) pra
// derivar duração/variabilidade real do histórico da aluna — nunca assume 28 dias fixos, nunca
// afirma previsão como fato, e nunca perde histórico ao corrigir um registro.

function cycleLog(overrides: Partial<{ id: string; cycleStartDate: Date; cycleEndDate: Date | null; crampsLevel: number | null; energyLevel: number | null; moodLevel: number | null; flowIntensity: string | null }>) {
  return {
    id: 'log-1',
    cycleStartDate: new Date('2026-08-01T12:00:00Z'),
    cycleEndDate: null,
    crampsLevel: null,
    energyLevel: null,
    moodLevel: null,
    flowIntensity: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 'aluna-1',
    ...overrides,
  };
}

function buildService(logs: ReturnType<typeof cycleLog>[], profile: Record<string, unknown> | null = null) {
  const prisma = {
    menstrualCycleLog: { findMany: jest.fn().mockResolvedValue(logs), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    menstrualProfile: { findUnique: jest.fn().mockResolvedValue(profile), upsert: jest.fn() },
    menstrualDailyLog: { upsert: jest.fn(), findMany: jest.fn() },
  };
  const mathLayer = new MathLayerService();
  const service = new MenstrualCycleService(prisma as never, mathLayer, new LongitudinalDynamicsService(mathLayer));
  return { service, prisma };
}

describe('MenstrualCycleService.getCycleOverview', () => {
  it('sem nenhum ciclo registrado: maturity "none", nada inventado', async () => {
    const { service } = buildService([]);
    const overview = await service.getCycleOverview('aluna-1');
    expect(overview.maturity).toBe('none');
    expect(overview.cycles).toHaveLength(0);
    expect(overview.currentDayOfCycle).toBeNull();
    expect(overview.predictedNextPeriod).toBeNull();
    expect(overview.cycleLengthStats).toBeNull();
  });

  it('um unico ciclo: nao ha intervalo pra medir duracao do ciclo — maturity "low", sem previsao', async () => {
    const logs = [cycleLog({ id: 'a', cycleStartDate: new Date('2026-08-01T12:00:00Z') })];
    const { service } = buildService(logs);
    const overview = await service.getCycleOverview('aluna-1');
    expect(overview.maturity).toBe('low');
    expect(overview.cycles).toHaveLength(1);
    expect(overview.cycles[0].cycleDurationDays).toBeNull(); // ainda nao ha proximo ciclo
    expect(overview.predictedNextPeriod).toBeNull();
    expect(overview.reliabilityCaveats).toContain('Estimativa ainda limitada pelo histórico disponível.');
  });

  it('ciclo IRREGULAR (27/31/29/35/28 dias): janela prevista reflete a variabilidade real, nunca 28 dias fixos', async () => {
    // Inicios sucessivos que produzem os intervalos 27, 31, 29, 35, 28 — exatamente o exemplo do pedido.
    const starts = ['2026-01-01', '2026-01-28', '2026-02-28', '2026-03-29', '2026-05-03', '2026-05-31'];
    const logs = starts.map((d, i) => cycleLog({ id: `c${i}`, cycleStartDate: new Date(d + 'T12:00:00Z') }));
    const { service } = buildService(logs);
    const overview = await service.getCycleOverview('aluna-1');

    expect(overview.cycles).toHaveLength(6);
    // Duracao de cada ciclo (exceto o ultimo) precisa bater com o intervalo real observado.
    expect(overview.cycles[0].cycleDurationDays).toBe(27);
    expect(overview.cycles[1].cycleDurationDays).toBe(31);
    expect(overview.cycles[2].cycleDurationDays).toBe(29);
    expect(overview.cycles[3].cycleDurationDays).toBe(35);
    expect(overview.cycles[4].cycleDurationDays).toBe(28);
    expect(overview.cycles[5].cycleDurationDays).toBeNull(); // ultimo, ainda sem proximo

    expect(overview.maturity).toBe('established'); // 5 intervalos observados
    expect(overview.cycleLengthStats?.n).toBe(5);
    // Mediana real de [27,31,29,35,28] = 29 — nunca 28 fixo.
    expect(overview.cycleLengthStats?.median).toBe(29);
    expect(overview.predictedNextPeriod).not.toBeNull();
    expect(overview.predictedNextPeriod!.basedOnCycles).toBe(5);
  });

  it('variabilidade alta entre ciclos (MAD/mediana > 20%) gera aviso explicito de janela mais ampla', async () => {
    // Intervalos 15/25/35/45/55 — mediana 35, MAD 10 -> razao 0.286, acima do limiar.
    const starts = ['2026-01-01', '2026-01-16', '2026-02-10', '2026-03-17', '2026-05-01', '2026-06-25'];
    const logs = starts.map((d, i) => cycleLog({ id: `c${i}`, cycleStartDate: new Date(d + 'T12:00:00Z') }));
    const { service } = buildService(logs);
    const overview = await service.getCycleOverview('aluna-1');
    expect(overview.reliabilityCaveats.some((c) => c.includes('maior variação'))).toBe(true);
  });

  it('duracao do sangramento so e calculada quando o FIM foi informado — nunca inventa fim', async () => {
    const logs = [
      cycleLog({ id: 'a', cycleStartDate: new Date('2026-08-01T12:00:00Z'), cycleEndDate: new Date('2026-08-05T12:00:00Z') }), // 5 dias
      cycleLog({ id: 'b', cycleStartDate: new Date('2026-08-29T12:00:00Z'), cycleEndDate: null }), // em curso, sem fim
    ];
    const { service } = buildService(logs);
    const overview = await service.getCycleOverview('aluna-1');
    expect(overview.cycles[0].periodDurationDays).toBe(5);
    expect(overview.cycles[1].periodDurationDays).toBeNull();
    expect(overview.periodLengthStats?.n).toBe(1); // so o ciclo com fim informado entra na estatistica
  });

  it('correcao retroativa (correctCycle) atualiza a fonte canonica, historico dos outros ciclos preservado', async () => {
    const { service, prisma } = buildService([]);
    (prisma.menstrualCycleLog.findFirst as jest.Mock).mockResolvedValue(cycleLog({ id: 'x', cycleStartDate: new Date('2026-08-01T12:00:00Z') }));
    await service.correctCycle('aluna-1', 'x', { startDate: '2026-08-02' });
    expect(prisma.menstrualCycleLog.update).toHaveBeenCalledWith({ where: { id: 'x' }, data: { cycleStartDate: new Date('2026-08-02T12:00:00Z') } });
  });

  it('correctCycle com endDate=null remove o fim explicitamente (distinto de nao mandar o campo)', async () => {
    const { service, prisma } = buildService([]);
    (prisma.menstrualCycleLog.findFirst as jest.Mock).mockResolvedValue(cycleLog({ id: 'x' }));
    await service.correctCycle('aluna-1', 'x', { endDate: null });
    expect(prisma.menstrualCycleLog.update).toHaveBeenCalledWith({ where: { id: 'x' }, data: { cycleEndDate: null } });
  });

  it('anticoncepcional hormonal e perimenopausa geram avisos explicitos de confiabilidade, nunca silenciosos', async () => {
    const logs = [cycleLog({ id: 'a' }), cycleLog({ id: 'b', cycleStartDate: new Date('2026-08-29T12:00:00Z') })];
    const { service } = buildService(logs, { usesHormonalContraceptive: true, menopauseStatus: 'perimenopause', cycleRegularity: null, periodLengthDays: null });
    const overview = await service.getCycleOverview('aluna-1');
    expect(overview.reliabilityCaveats.some((c) => c.includes('anticoncepcional'))).toBe(true);
    expect(overview.reliabilityCaveats.some((c) => c.includes('Perimenopausa'))).toBe(true);
  });
});
