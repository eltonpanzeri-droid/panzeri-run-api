import { Prisma } from '@prisma/client';
import { planVolumeReconciliation, withVolumeReconciliation, isRetractedVolumeEvidence } from '../src/medals/volume-reconciliation';

const original = {
  id: 'award-1', code: 'volume_semanal_corrida_50km', category: 'volume_semanal', threshold: 50,
  criteria: {} as Prisma.JsonValue, catalogVersion: 1, awardedVersion: 1, value: 100,
  periodStart: new Date('2026-09-07T00:00:00Z'), periodEnd: new Date('2026-09-07T00:00:00Z'),
  evidence: { weekStart: '2026-09-07' } as Prisma.JsonValue,
};
const catalog = [{ code: original.code, category: original.category, active: true, ruleVersion: 1 }];
const noUncertainty = { weeks: new Set<string>(), months: new Set<string>() };

describe('Reconciliação histórica de volume', () => {
  it('mantém a medalha legítima, corrigindo valor e período sem apagar a concessão original', () => {
    const candidate = {
      code: original.code, value: 52, periodStart: new Date('2026-09-14T00:00:00Z'),
      periodEnd: new Date('2026-09-14T00:00:00Z'), modality: 'corrida', evidence: { weekStart: '2026-09-14' },
    };
    const actions = planVolumeReconciliation([original], [candidate], { weeks: [], months: [], calculatedAt: '' }, noUncertainty, catalog);
    expect(actions).toMatchObject([{ kind: 'update', code: original.code }]);
    const preserved = withVolumeReconciliation(candidate.evidence, 'active', original, '2026-10-13T00:00:00Z');
    expect(preserved).toMatchObject({ _volumeReconciliation: { original: { value: 100, evidence: { weekStart: '2026-09-07' } } } });
  });

  it('é idempotente diante de ruído de ponto flutuante no banco', () => {
    const series = { weeks: [], months: [], calculatedAt: '' } as never;
    const candidate = { code: original.code, value: 50.18000000000001,
      periodStart: original.periodStart, periodEnd: original.periodEnd, modality: 'corrida', evidence: original.evidence as Record<string, unknown> };
    const award = { ...original, value: 50.18 };
    expect(planVolumeReconciliation([award], [candidate], series, noUncertainty, catalog)[0].kind).toBe('keep');
  });

  it('não retrata uma semana ambígua nem uma semana sem observações', () => {
    const series = { weeks: [{ weekStart: '2026-09-07', kmPercorridos: 20 }], months: [], calculatedAt: '' } as never;
    expect(planVolumeReconciliation([original], [], series, { weeks: new Set(['2026-09-07']), months: new Set() }, catalog)[0].kind).toBe('review');
    expect(planVolumeReconciliation([original], [], { weeks: [], months: [], calculatedAt: '' }, noUncertainty, catalog)[0].kind).toBe('review');
  });

  it('retrata com evidência preservada somente quando há dados do período sem limiar nem ambiguidade', () => {
    const series = { weeks: [{ weekStart: '2026-09-07', kmPercorridos: 20 }], months: [], calculatedAt: '' } as never;
    const legacy = { corrida: { weeks: [{ weekStart: '2026-09-07', kmPercorridos: 50 }], months: [], calculatedAt: '' },
      esteira: { weeks: [{ weekStart: '2026-09-07', kmPercorridos: 50 }], months: [], calculatedAt: '' } } as never;
    expect(planVolumeReconciliation([original], [], series, noUncertainty, catalog)[0].kind).toBe('review');
    expect(planVolumeReconciliation([original], [], series, noUncertainty, catalog, legacy)[0].kind).toBe('retract');
    const evidence = withVolumeReconciliation(original.evidence, 'retracted', original, '2026-10-13T00:00:00Z');
    expect(isRetractedVolumeEvidence(evidence as Prisma.JsonValue)).toBe(true);
  });
});
