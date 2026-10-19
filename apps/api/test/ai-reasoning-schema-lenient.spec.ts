import { AiReasoningSchema } from '../src/training-plans/prescription-agent.service';
import { normalizeDeclaredReasoning } from '../src/training-plans/prescription-trace';

// 19/10/2026 (caso Eduarda): um valor fora da lista em basis.source/decides rejeitava a resposta inteira da IA e a semana nao era gerada.
describe('AiReasoningSchema tolerante a vocabulario', () => {
  const raw = { intent: 'x', expected: 'y', basis: [{ source: 'campoInventadoPelaIA', note: 'n', decides: 'categoriaNova' }] };

  it('aceita source/decides desconhecidos sem rejeitar a resposta', () => {
    expect(AiReasoningSchema.safeParse(raw).success).toBe(true);
  });

  it('normalizeDeclaredReasoning mapeia o desconhecido para outro e omite decides', () => {
    const n = normalizeDeclaredReasoning(AiReasoningSchema.parse(raw));
    expect(n?.basis[0].source).toBe('outro');
    expect(n?.basis[0].decides).toBeUndefined();
  });

  it('valores validos continuam passando', () => {
    const n = normalizeDeclaredReasoning(AiReasoningSchema.parse({ intent: 'x', expected: 'y', basis: [{ source: 'historicoSemanal', note: 'n', decides: 'volume' }] }));
    expect(n?.basis[0].source).toBe('historicoSemanal');
    expect(n?.basis[0].decides).toBe('volume');
  });
});
