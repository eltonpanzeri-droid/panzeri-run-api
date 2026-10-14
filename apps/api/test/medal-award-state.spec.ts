import { Prisma } from '@prisma/client';
import { MedalsService } from '../src/medals/medals.service';
import { isAwardRevoked, withVolumeReconciliation } from '../src/medals/volume-reconciliation';

// Etapa 1 (15/10/2026): leitura UNICA do estado de uma concessao de medalha. Sem mudanca de comportamento: o unico sinal de "revogada" hoje e' o marcador de
// retracao de volume; a coluna status (etapa futura) entra na MESMA funcao.

const original = { value: 30, periodStart: new Date('2026-09-14T00:00:00Z'), periodEnd: new Date('2026-09-14T00:00:00Z'), evidence: { weekStart: '2026-09-14' } as Prisma.JsonValue };
const retracted = withVolumeReconciliation({ weekStart: '2026-09-14' }, 'retracted', original, '2026-10-13T12:00:00.000Z');
const reactivated = withVolumeReconciliation({ weekStart: '2026-09-14' }, 'active', original, '2026-10-14T12:00:00.000Z');

describe('isAwardRevoked', () => {
  it('marcador de retracao de volume => revogada (comportamento atual preservado)', () => {
    expect(isAwardRevoked({ evidence: retracted as Prisma.JsonValue })).toBe(true);
  });

  it('marcador reativado, evidencia comum ou vazia => conquistada', () => {
    expect(isAwardRevoked({ evidence: reactivated as Prisma.JsonValue })).toBe(false);
    expect(isAwardRevoked({ evidence: { weekStart: '2026-09-14' } })).toBe(false);
    expect(isAwardRevoked({ evidence: null })).toBe(false);
    expect(isAwardRevoked({ evidence: [] })).toBe(false);
  });

  it('status "revoked" (coluna futura) basta, mesmo sem marcador; status "active" nao anula o marcador (durante a transicao qualquer sinal conta)', () => {
    expect(isAwardRevoked({ evidence: {}, status: 'revoked' })).toBe(true);
    expect(isAwardRevoked({ evidence: {}, status: 'active' })).toBe(false);
    expect(isAwardRevoked({ evidence: {}, status: null })).toBe(false);
    expect(isAwardRevoked({ evidence: retracted as Prisma.JsonValue, status: 'active' })).toBe(true);
  });
});

describe('MedalsService.getUnlocked usa a leitura unica', () => {
  const row = (code: string, evidence: Prisma.JsonValue) => ({
    id: `ua-${code}`, userId: 'u1', achievementId: code, unlockedAt: new Date('2026-10-01T00:00:00Z'), value: 1, periodStart: null, periodEnd: null, modality: null, evidence,
    achievement: { code, category: 'treinos_concluidos', name: code, description: '', grau: 'bronze', unit: null },
  });

  it('medalha retraida nao aparece em "conquistadas"; as demais continuam', async () => {
    const prisma = { userAchievement: { findMany: jest.fn(async () => [row('A', {}), row('B', retracted as Prisma.JsonValue), row('C', reactivated as Prisma.JsonValue)]) }, userAchievementTransition: { findMany: jest.fn(async () => []) } };
    const service = new MedalsService(prisma as never, {} as never, {} as never);
    const unlocked = await service.getUnlocked('u1');
    expect(unlocked.map((u) => u.code).sort()).toEqual(['A', 'C']);
  });
});
