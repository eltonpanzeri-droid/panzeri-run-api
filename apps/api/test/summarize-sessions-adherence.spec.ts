import { summarizeSessions } from '../src/coach/coach.service';

// 27/09/2026 — Auditoria Volume/Aderência/ACWR. Bug real: summarizeSessions() (histórico de planos
// do Admin) retornava adherencePercent:0 quando nenhuma sessão elegível tinha feedback ainda (feito
// ou perdido) — exatamente o "sem dado virando 0%" que a Camada Matemática Longitudinal existe pra
// evitar. EvolutionMetricService já fazia isso certo (null); esta função não fazia.

function session(overrides: Partial<{ scheduledDate: Date; distanceKm: number | null; completion: { status: string; distanceKm: number | null } | null }>) {
  return {
    scheduledDate: new Date('2026-01-01T00:00:00Z'),
    durationMin: 30,
    distanceKm: 5,
    completion: null,
    ...overrides,
  };
}

describe('summarizeSessions — adherencePercent nunca vira 0% por ausência de dado', () => {
  it('sem nenhuma sessão elegível ainda (todas futuras): adherencePercent null, nunca 0', () => {
    const future = new Date(Date.now() + 30 * 86400000);
    const summary = summarizeSessions([session({ scheduledDate: future })]);
    expect(summary.eligibleSessions).toBe(0);
    expect(summary.adherencePercent).toBeNull();
  });

  it('sessões elegíveis existem, mas nenhuma tem feedback (todas sem registro): adherencePercent null, nunca 0', () => {
    const past = new Date(Date.now() - 86400000);
    const summary = summarizeSessions([session({ scheduledDate: past }), session({ scheduledDate: past })]);
    expect(summary.eligibleSessions).toBe(2);
    expect(summary.unregisteredSessions).toBe(2);
    expect(summary.adherencePercent).toBeNull();
  });

  it('com pelo menos um feito ou perdido: calcula normalmente (feito ÷ (feito+perdido), sem registro fora do denominador)', () => {
    const past = new Date(Date.now() - 86400000);
    const summary = summarizeSessions([
      session({ scheduledDate: past, completion: { status: 'done', distanceKm: 5 } }),
      session({ scheduledDate: past, completion: { status: 'missed', distanceKm: null } }),
      session({ scheduledDate: past, completion: null }), // sem registro — nunca entra no denominador
    ]);
    expect(summary.adherencePercent).toBe(50); // 1 feito / (1 feito + 1 perdido) = 50%, o sem-registro não conta
  });
});
