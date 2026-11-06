import { readFileSync } from 'fs';
import { join } from 'path';
import { CURRENT_STUDENT_STATUSES, statusAfterManualChange } from '../src/coach/subscription-groups.util';
import { CoachService } from '../src/coach/coach.service';

// 05/11/2026 — regras de Elton: (1) prospecto NAO e' aluno; (2) quem perde a cortesia vira EX-ALUNO, nunca prospecto; (3) "aluna" = aluna atual (confirmado, cortesia, atrasado).
const src = (file: string) => readFileSync(join(__dirname, '..', 'src', file), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

describe('quem perde a cortesia vira ex-aluno', () => {
  it('cortesia -> pendente vira cancelado (ex-aluno); o resto passa como pedido', () => {
    expect(statusAfterManualChange('manual_active', 'pending')).toBe('canceled');
    expect(statusAfterManualChange('manual_active', 'canceled')).toBe('canceled');
    expect(statusAfterManualChange('manual_active', 'active')).toBe('active');
    expect(statusAfterManualChange('active', 'pending')).toBe('pending'); // so' a cortesia tem essa regra
    expect(statusAfterManualChange('pending', 'pending')).toBe('pending');
    expect(statusAfterManualChange(undefined, 'pending')).toBe('pending');
  });

  it('updateStudent grava canceled (e registra a transicao) quando o treinador tira a cortesia escolhendo pendente', async () => {
    const update = jest.fn().mockResolvedValue({ id: 's1', name: 'A', email: 'a@x.com', accountStatus: 'active', subscriptionStatus: 'canceled', subscriptionUpdatedAt: new Date(), updatedAt: new Date() });
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }), findUnique: jest.fn().mockResolvedValue({ subscriptionStatus: 'manual_active' }), update },
    };
    const billing = { recordStatusTransition: jest.fn().mockResolvedValue(undefined), assignStudentCodeIfNeeded: jest.fn() };
    const service = new CoachService(prisma as never, {} as never, {} as never, {} as never, {} as never, billing as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    (service as unknown as { assertStudent: () => Promise<void> }).assertStudent = async () => undefined;
    await service.updateStudent('s1', { subscriptionStatus: 'pending' } as never);
    expect(update.mock.calls[0][0].data.subscriptionStatus).toBe('canceled');
    expect(billing.recordStatusTransition).toHaveBeenCalledWith('s1', 'manual_active', 'canceled', 'coach:manual');
  });
});

describe('prospecto nao e aluno', () => {
  it('aluna atual = confirmado + cortesia + atrasado (nunca pendente nem cancelado)', () => {
    expect([...CURRENT_STUDENT_STATUSES].sort()).toEqual(['active', 'grace', 'manual_active', 'overdue']);
  });
  it('Equipamentos conta so alunas atuais (nao 88: sem prospectos nem ex-alunas)', () => {
    expect(src('equipment/equipment-intelligence.service.ts')).toContain('subscriptionStatus: { in: [...CURRENT_STUDENT_STATUSES] }');
  });
  it('Observatorio e "Como as alunas acessam" nao incluem prospectos', () => {
    expect(src('observatory/observatory.service.ts')).toContain("subscriptionStatus: { not: 'pending' }");
    expect(src('equipment/student-access.service.ts')).toContain("subscriptionStatus: { not: 'pending' }");
  });
  it('o grafico Evolucao de alunos do painel nao tem a barra Pendente (prospecto)', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8');
    expect(page).not.toContain("{ key: 'Pendente', label: 'Pendente', kind: 'bar'");
  });
});
