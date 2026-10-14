import { Prisma } from '@prisma/client';
import { applyAwardActions } from '../src/medals/medal-award-persistence';
import type { AwardAction, ExistingAward } from '../src/medals/medal-award-decision';
import type { UnlockCandidate } from '../src/medals/medal-evaluation.service';
import { isAwardRevoked, withVolumeReconciliation } from '../src/medals/volume-reconciliation';
import { medalsFake } from './helpers/medals-fake';

// Persistencia transacional de concessoes: concessao, revogacao, reativacao e ajuste gravam estado + transicao (append-only) na MESMA transacao, sob trava por aluno,
// sem apagar nada, sem duplicar na reativacao, preservando unlockedAt, versao da regra e evidencias, e espelhando o marcador antigo nas categorias de volume.

const USER = 'u1';
const NOW = new Date('2026-10-15T12:00:00Z');
const ctx = { trigger: 'link_correction', cause: { kind: 'link_correction', origin: 'student' }, now: NOW };
const candidate = (code: string, extra: Partial<UnlockCandidate> = {}): UnlockCandidate => ({ code, value: 10, periodStart: null, periodEnd: null, modality: null, evidence: { totalAtUnlock: 10 }, ...extra });
const existingOf = (row: Record<string, any>, category: string): ExistingAward => ({ id: row.id, code: row.code ?? 'X', category, threshold: null, criteria: {}, catalogVersion: 1, awardedVersion: row.ruleVersionAtUnlock ?? 1, value: row.value, periodStart: row.periodStart, periodEnd: row.periodEnd, evidence: row.evidence, status: row.status });

const setup = (extra: Parameters<typeof medalsFake>[0]['awards'] = [], more: Partial<Parameters<typeof medalsFake>[0]> = {}) =>
  medalsFake({ achievements: [{ id: 'a-t10', code: 'treinos_concluidos_10', category: 'treinos_concluidos', threshold: 10 }, { id: 'a-v30', code: 'volume_semanal_corrida_30km', category: 'volume_semanal', threshold: 30 }], awards: extra, ...more });
const catalogRefs = [{ id: 'a-t10', code: 'treinos_concluidos_10', ruleVersion: 1 }, { id: 'a-v30', code: 'volume_semanal_corrida_30km', ruleVersion: 1 }];

describe('concessao (create)', () => {
  it('cria a concessao e a transicao "granted" (versao da regra, causa e estado depois), numa transacao com trava por aluno', async () => {
    const { prisma, awards, transitions } = setup();
    const create: AwardAction = { kind: 'create', code: 'treinos_concluidos_10', reason: 'conquista_comprovada_nao_registrada', candidate: candidate('treinos_concluidos_10') };
    const result = await applyAwardActions(prisma, USER, [create], catalogRefs, ctx);
    expect(result.granted).toEqual(['treinos_concluidos_10']);
    expect([...awards.values()]).toHaveLength(1);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ type: 'granted', trigger: 'link_correction', reason: 'conquista_comprovada_nao_registrada', ruleVersion: 1, userId: USER, at: NOW });
    expect(transitions[0].cause).toMatchObject({ kind: 'link_correction', origin: 'student' });
    expect(transitions[0].after).toMatchObject({ status: 'active', value: 10 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('concessao concorrente (P2002) nao duplica nem falha: a existente permanece e nenhuma transicao extra e gravada', async () => {
    const { prisma, awards, transitions } = setup([{ id: 'ua-old', achievementId: 'a-t10' }]);
    const create: AwardAction = { kind: 'create', code: 'treinos_concluidos_10', reason: 'conquista_comprovada_nao_registrada', candidate: candidate('treinos_concluidos_10') };
    const result = await applyAwardActions(prisma, USER, [create], catalogRefs, ctx);
    expect(result.granted).toEqual([]);
    expect(awards.size).toBe(1);
    expect(transitions).toHaveLength(0);
  });
});

describe('revogacao, reativacao e ajuste', () => {
  it('revogar: estado "revoked" com motivo e data, NADA apagado, transicao com antes/depois; categoria que nao e de volume nao ganha marcador legado', async () => {
    const { prisma, awards, transitions } = setup([{ id: 'ua-1', achievementId: 'a-t10', value: 12, evidence: { totalAtUnlock: 12 } }]);
    const existing = existingOf(awards.get('ua-1')!, 'treinos_concluidos');
    const result = await applyAwardActions(prisma, USER, [{ kind: 'revoke', code: 'treinos_concluidos_10', reason: 'criterio_nao_atendido', existing }], catalogRefs, ctx);
    expect(result.revoked).toEqual(['treinos_concluidos_10']);
    const row = awards.get('ua-1')!;
    expect(row).toMatchObject({ status: 'revoked', revokedAt: NOW, revokedReason: 'criterio_nao_atendido', statusChangedAt: NOW, value: 12 });
    expect(JSON.stringify(row.evidence)).not.toContain('_volumeReconciliation');
    expect(transitions[0]).toMatchObject({ type: 'revoked', reason: 'criterio_nao_atendido', ruleVersion: 1 });
    expect(transitions[0].before).toMatchObject({ status: 'active', value: 12 });
    expect(transitions[0].after).toMatchObject({ status: 'revoked' });
    expect(awards.size).toBe(1); // o registro permanece
  });

  it('revogar categoria de VOLUME espelha o marcador de retracao antigo (compatibilidade), guardando o original', async () => {
    const { prisma, awards } = setup([{ id: 'ua-2', achievementId: 'a-v30', value: 31, periodStart: new Date('2026-09-14T00:00:00Z'), periodEnd: new Date('2026-09-14T00:00:00Z'), evidence: { weekStart: '2026-09-14' } }]);
    const existing = existingOf(awards.get('ua-2')!, 'volume_semanal');
    await applyAwardActions(prisma, USER, [{ kind: 'revoke', code: 'volume_semanal_corrida_30km', reason: 'criterio_nao_atendido', existing }], catalogRefs, ctx);
    const row = awards.get('ua-2')!;
    expect(row.status).toBe('revoked');
    expect(row.evidence._volumeReconciliation).toMatchObject({ status: 'retracted', original: { value: 31, evidence: { weekStart: '2026-09-14' } } });
    expect(isAwardRevoked({ evidence: row.evidence })).toBe(true); // o codigo antigo tambem a enxerga como revogada
  });

  it('reativar: MESMA linha (sem duplicar), unlockedAt preservado, revogacao limpa, evidencia nova, transicao "reactivated"', async () => {
    const { prisma, awards, transitions } = setup([{ id: 'ua-1', achievementId: 'a-t10', status: 'revoked', revokedAt: new Date('2026-10-14T00:00:00Z'), revokedReason: 'criterio_nao_atendido', value: 12, unlockedAt: new Date('2026-09-20T00:00:00Z') }]);
    const existing = existingOf(awards.get('ua-1')!, 'treinos_concluidos');
    const result = await applyAwardActions(prisma, USER, [{ kind: 'reactivate', code: 'treinos_concluidos_10', reason: 'criterio_voltou_a_ser_atendido', existing, candidate: candidate('treinos_concluidos_10', { value: 11, evidence: { totalAtUnlock: 11 } }) }], catalogRefs, ctx);
    expect(result.reactivated).toEqual(['treinos_concluidos_10']);
    expect(awards.size).toBe(1);
    const row = awards.get('ua-1')!;
    expect(row).toMatchObject({ status: 'active', revokedAt: null, revokedReason: null, statusChangedAt: NOW, value: 11 });
    expect(row.unlockedAt).toEqual(new Date('2026-09-20T00:00:00Z'));
    expect(row.ruleVersionAtUnlock).toBe(1);
    expect(transitions[0]).toMatchObject({ type: 'reactivated', reason: 'criterio_voltou_a_ser_atendido' });
    expect(transitions[0].before).toMatchObject({ status: 'revoked', value: 12 });
    expect(transitions[0].after).toMatchObject({ status: 'active', value: 11 });
  });

  it('reativar uma retracao ANTIGA de volume (so o marcador, sem coluna) funciona e passa a espelhar "active"', async () => {
    const original = { value: 31, periodStart: new Date('2026-09-14T00:00:00Z'), periodEnd: new Date('2026-09-14T00:00:00Z'), evidence: { weekStart: '2026-09-14' } as Prisma.JsonValue };
    const legacy = withVolumeReconciliation({ weekStart: '2026-09-14' }, 'retracted', original, '2026-10-13T12:00:00.000Z');
    const { prisma, awards } = setup([{ id: 'ua-3', achievementId: 'a-v30', value: 31, evidence: legacy, status: 'active' }]);
    const existing = existingOf(awards.get('ua-3')!, 'volume_semanal');
    expect(isAwardRevoked(existing)).toBe(true);
    await applyAwardActions(prisma, USER, [{ kind: 'reactivate', code: 'volume_semanal_corrida_30km', reason: 'criterio_voltou_a_ser_atendido', existing, candidate: candidate('volume_semanal_corrida_30km', { value: 32, periodStart: original.periodStart, periodEnd: original.periodEnd, evidence: { weekStart: '2026-09-14' } }) }], catalogRefs, ctx);
    const row = awards.get('ua-3')!;
    expect(row.status).toBe('active');
    expect(row.evidence._volumeReconciliation.status).toBe('active');
    expect(isAwardRevoked(row as never)).toBe(false);
  });

  it('ajustar: continua conquistada (status inalterado), periodo/valor/evidencia atualizados e transicao "adjusted" com antes/depois', async () => {
    const { prisma, awards, transitions } = setup([{ id: 'ua-1', achievementId: 'a-t10', value: 31, periodStart: new Date('2026-09-14T00:00:00Z'), periodEnd: new Date('2026-09-14T00:00:00Z'), evidence: { weekStart: '2026-09-14' } }]);
    const existing = existingOf(awards.get('ua-1')!, 'treinos_concluidos');
    const result = await applyAwardActions(prisma, USER, [{ kind: 'adjust', code: 'treinos_concluidos_10', reason: 'periodo_ou_valor_diferente', existing, candidate: candidate('treinos_concluidos_10', { value: 33, periodStart: new Date('2026-09-28T00:00:00Z'), periodEnd: new Date('2026-09-28T00:00:00Z'), evidence: { weekStart: '2026-09-28' } }) }], catalogRefs, ctx);
    expect(result.adjusted).toEqual(['treinos_concluidos_10']);
    expect(awards.get('ua-1')).toMatchObject({ status: 'active', value: 33, evidence: { weekStart: '2026-09-28' } });
    expect(transitions[0]).toMatchObject({ type: 'adjusted' });
    expect(transitions[0].before).toMatchObject({ value: 31 });
    expect(transitions[0].after).toMatchObject({ value: 33 });
  });

  it('historico completo preservado em sequencia: conceder -> revogar -> reativar (uma linha, tres transicoes em ordem, unlockedAt inalterado)', async () => {
    const { prisma, awards, transitions } = setup();
    await applyAwardActions(prisma, USER, [{ kind: 'create', code: 'treinos_concluidos_10', reason: 'conquista_comprovada_nao_registrada', candidate: candidate('treinos_concluidos_10') }], catalogRefs, { ...ctx, trigger: 'workout_completed', now: new Date('2026-10-15T10:00:00Z') });
    const id = [...awards.keys()][0];
    const unlockedAt = awards.get(id)!.unlockedAt;
    await applyAwardActions(prisma, USER, [{ kind: 'revoke', code: 'treinos_concluidos_10', reason: 'criterio_nao_atendido', existing: existingOf(awards.get(id)!, 'treinos_concluidos') }], catalogRefs, { ...ctx, now: new Date('2026-10-15T11:00:00Z') });
    await applyAwardActions(prisma, USER, [{ kind: 'reactivate', code: 'treinos_concluidos_10', reason: 'criterio_voltou_a_ser_atendido', existing: existingOf(awards.get(id)!, 'treinos_concluidos'), candidate: candidate('treinos_concluidos_10') }], catalogRefs, { ...ctx, now: new Date('2026-10-15T12:00:00Z') });
    expect(awards.size).toBe(1);
    expect(awards.get(id)!.unlockedAt).toEqual(unlockedAt);
    expect(transitions.map((t) => t.type)).toEqual(['granted', 'revoked', 'reactivated']);
    expect(transitions.map((t) => t.userAchievementId)).toEqual([id, id, id]);
    expect(transitions.every((t) => t.ruleVersion === 1)).toBe(true);
  });
});

describe('protecao contra mudanca no meio e contra escrita desnecessaria', () => {
  it('concessao alterada entre o planejamento e a escrita (CAS): nada e aplicado para ela e o conflito e informado', async () => {
    const { prisma, awards, transitions } = setup([{ id: 'ua-1', achievementId: 'a-t10', value: 12 }]);
    const existing = existingOf(awards.get('ua-1')!, 'treinos_concluidos');
    awards.get('ua-1')!.value = 99; // outro processo mexeu depois do planejamento
    const result = await applyAwardActions(prisma, USER, [{ kind: 'revoke', code: 'treinos_concluidos_10', reason: 'criterio_nao_atendido', existing }], catalogRefs, ctx);
    expect(result.conflicts).toEqual(['treinos_concluidos_10']);
    expect(result.revoked).toEqual([]);
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(transitions).toHaveLength(0);
  });

  it('revogar o que ja foi revogado (repeticao) nao grava nada de novo: idempotente', async () => {
    const { prisma, awards, transitions } = setup([{ id: 'ua-1', achievementId: 'a-t10', value: 12 }]);
    const existing = existingOf(awards.get('ua-1')!, 'treinos_concluidos');
    await applyAwardActions(prisma, USER, [{ kind: 'revoke', code: 'treinos_concluidos_10', reason: 'criterio_nao_atendido', existing }], catalogRefs, ctx);
    const again = await applyAwardActions(prisma, USER, [{ kind: 'revoke', code: 'treinos_concluidos_10', reason: 'criterio_nao_atendido', existing }], catalogRefs, ctx);
    expect(again.revoked).toEqual([]);
    expect(again.conflicts).toEqual(['treinos_concluidos_10']);
    expect(transitions).toHaveLength(1);
  });

  it('decisoes "review" nao viram escrita (so aparecem no resultado para log)', async () => {
    const { prisma, awards, transitions } = setup([{ id: 'ua-1', achievementId: 'a-t10' }]);
    const result = await applyAwardActions(prisma, USER, [{ kind: 'review', code: 'treinos_concluidos_10', reason: 'periodo_incerto', wouldRevoke: true }, { kind: 'keep', code: 'treinos_concluidos_10', reason: 'criterio_mantido' }], catalogRefs, ctx);
    expect(result.reviews).toEqual([{ code: 'treinos_concluidos_10', reason: 'periodo_incerto', wouldRevoke: true }]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(awards.get('ua-1')!.status).toBe('active');
    expect(transitions).toHaveLength(0);
  });

  it('nunca chama delete: registro historico nenhum e apagado', async () => {
    const { prisma, awards } = setup([{ id: 'ua-1', achievementId: 'a-t10', value: 12 }]);
    prisma.userAchievement.delete = jest.fn();
    prisma.userAchievement.deleteMany = jest.fn();
    prisma.userAchievementTransition.delete = jest.fn();
    prisma.userAchievementTransition.deleteMany = jest.fn();
    await applyAwardActions(prisma, USER, [{ kind: 'revoke', code: 'treinos_concluidos_10', reason: 'criterio_nao_atendido', existing: existingOf(awards.get('ua-1')!, 'treinos_concluidos') }], catalogRefs, ctx);
    for (const fn of [prisma.userAchievement.delete, prisma.userAchievement.deleteMany, prisma.userAchievementTransition.delete, prisma.userAchievementTransition.deleteMany]) expect(fn).not.toHaveBeenCalled();
  });
});
