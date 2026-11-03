import type { AcuteChronic } from '../src/training-intelligence/acute-chronic';
import { buildDomainOverview, buildOverviewRow, INDICATOR_SPECS, withoutIntegrationIndicators } from '../src/training-intelligence/domain-overview';

const win = (value: number | null, complete = true) => ({ value, n: complete ? 7 : 3, size: 7, windowStart: null, windowEnd: null, complete });

function ac(acute: number | null, chronic: number | null, opts: { range?: AcuteChronic['acuteVsHabitualRange']; acuteComplete?: boolean; chronicComplete?: boolean } = {}): AcuteChronic {
  const sufficient = acute != null && chronic != null && opts.chronicComplete !== false && opts.acuteComplete !== false;
  const difference = sufficient ? (acute as number) - (chronic as number) : null;
  return {
    version: 1,
    unit: 'registros',
    windowKind: 'observation_count',
    acute: win(acute, opts.acuteComplete !== false),
    chronic: win(chronic, opts.chronicComplete !== false),
    difference,
    relativeDifferencePct: difference != null && chronic ? (100 * difference) / Math.abs(chronic as number) : null,
    direction: difference == null ? 'insufficient' : difference > 0 ? 'acute_above' : difference < 0 ? 'acute_below' : 'equal',
    acuteVsHabitualRange: opts.range ?? 'within',
    reading: null,
    note: '',
  } as unknown as AcuteChronic;
}

describe('domain-overview (visão global por domínio, 03/11/2026)', () => {
  it('sono em horas: abaixo de 7 é desfavorável MESMO sendo o padrão; aproximar-se de 7–9 é melhora, afastar-se é piora', () => {
    const habitual = buildOverviewRow('workout.sleepDurationHoursEstimate', ac(6, 6))!.row;
    expect(habitual.nivel).toBe('desfavoravel');
    expect(habitual.tendencia).toBe('estavel');
    expect(buildOverviewRow('workout.sleepDurationHoursEstimate', ac(6.8, 6.2))!.row.tendencia).toBe('melhorando');
    expect(buildOverviewRow('workout.sleepDurationHoursEstimate', ac(5.5, 6.5))!.row.tendencia).toBe('piorando');
    expect(buildOverviewRow('workout.sleepDurationHoursEstimate', ac(8, 8))!.row.nivel).toBe('favoravel');
  });

  it('acima de 9 horas é indefinido (nível e tendência), nunca melhora nem piora', () => {
    const row = buildOverviewRow('workout.sleepDurationHoursEstimate', ac(9.5, 8))!.row;
    expect(row.nivel).toBe('indefinido');
    expect(row.tendencia).toBe('indefinido');
  });

  it('escala 1–5 "quanto menor melhor" (cansaço): nível pela extremidade e tendência invertida', () => {
    const subindo = buildOverviewRow('workout.prePhysicalFatigue', ac(4.2, 3))!.row;
    expect(subindo.nivel).toBe('desfavoravel');
    expect(subindo.tendencia).toBe('piorando');
    const caindo = buildOverviewRow('workout.prePhysicalFatigue', ac(1.8, 3))!.row;
    expect(caindo.nivel).toBe('favoravel');
    expect(caindo.tendencia).toBe('melhorando');
    expect(buildOverviewRow('workout.prePhysicalFatigue', ac(3, 3))!.row.nivel).toBe('intermediario');
  });

  it('medida sem faixa absoluta (VFC, FC de repouso): só tendência pela direção, sem nível', () => {
    const vfc = buildOverviewRow('wearable.hrvLastNightAvg', ac(40, 50))!.row;
    expect(vfc.nivel).toBeUndefined();
    expect(vfc.tendencia).toBe('piorando');
    expect(buildOverviewRow('wearable.restingHeartRateBpm', ac(52, 55))!.row.tendencia).toBe('melhorando');
  });

  it('carga, FC média e desacoplamento: subir é mais desgaste (piorando); cadência subir é melhora', () => {
    expect(buildOverviewRow('workout.sessionInternalLoad', ac(500, 400))!.row.tendencia).toBe('piorando');
    expect(buildOverviewRow('activity.avgHeartRateBpm', ac(150, 155))!.row.tendencia).toBe('melhorando');
    expect(buildOverviewRow('activity.hrDecoupling.d60', ac(6, 4))!.row.tendencia).toBe('piorando');
    expect(buildOverviewRow('activity.cadenceAvg', ac(172, 168))!.row.tendencia).toBe('melhorando');
  });

  it('volume e movimento diário só têm sentido (subindo/caindo), nunca melhor/pior; elevação é contexto', () => {
    expect(buildOverviewRow('training.volumeCompletedTotalKm', ac(40, 30))!.row.tendencia).toBe('subindo');
    expect(buildOverviewRow('wearable.dailySteps', ac(7000, 9000))!.row.tendencia).toBe('caindo');
    expect(buildOverviewRow('activity.elevationGainMeters', ac(300, 200))!.row.tendencia).toBe('subindo');
  });

  it('ausência nunca vira zero nem "normal": sem janelas completas não há linha; só aguda completa dá nível sem tendência', () => {
    expect(buildOverviewRow('workout.preSleepQuality', ac(null, null, { acuteComplete: false, chronicComplete: false }))).toBeNull();
    const parcial = buildOverviewRow('workout.preSleepQuality', ac(4.5, 4, { chronicComplete: false }))!.row;
    expect(parcial.tendencia).toBe('sem_comparacao');
    expect(parcial.nivel).toBe('favoravel');
    expect(buildOverviewRow('indicador.desconhecido', ac(1, 2))).toBeNull();
  });

  it('agrupa por domínio, conta separado e não cria nota, peso nem score', () => {
    const overview = buildDomainOverview([
      { variableId: 'workout.preSleepQuality', acuteChronic: ac(2, 3.5) },
      { variableId: 'workout.sleepDifficulty', acuteChronic: ac(4, 3) },
      { variableId: 'workout.sleepInterruption', acuteChronic: ac(2, 2) },
      { variableId: 'workout.preMotivation', acuteChronic: ac(4.5, 4) },
    ])!;
    const sono = overview.dominios.find((d) => d.dominio === 'sono')!;
    expect(sono.contagem).toMatchObject({ piorando: 2, melhorando: 0, estaveis: 1 });
    expect(overview.dominios.find((d) => d.dominio === 'estado_psicologico')!.contagem.melhorando).toBe(1);
    expect(JSON.stringify(overview)).not.toMatch(/score|nota geral|prontidao total|pontuacao/i);
    expect(sono.fotografia).toContain('2 piorando');
  });

  it('teto de tamanho: tira relógio/atividade e recalcula; domínio que só tinha dado de integração some', () => {
    const overview = buildDomainOverview([
      { variableId: 'workout.preSleepQuality', acuteChronic: ac(2, 3.5) },
      { variableId: 'wearable.sleepDeepMin', acuteChronic: ac(40, 60) },
      { variableId: 'wearable.hrvLastNightAvg', acuteChronic: ac(40, 50) },
    ])!;
    const limited = withoutIntegrationIndicators(overview)!;
    expect(limited.dominios.map((d) => d.dominio)).toEqual(['sono']);
    expect(limited.dominios[0].indicadores.map((r) => r.id)).toEqual(['workout.preSleepQuality']);
    expect(limited.dominios[0].contagem.piorando).toBe(1);
    expect(withoutIntegrationIndicators({ ...overview, dominios: overview.dominios.filter((d) => d.dominio === 'recuperacao_medida') })).toBeNull();
  });

  it('todo indicador cadastrado pertence a um domínio conhecido', () => {
    for (const [id, spec] of Object.entries(INDICATOR_SPECS)) {
      expect(spec.domain).toBeTruthy();
      expect(id).toMatch(/^(workout|checkin|training|activity|execution|wearable)\./);
    }
  });
});
