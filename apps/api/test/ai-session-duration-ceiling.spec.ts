import { AiWeeklyDecisionSchema } from '../src/training-plans/prescription-agent.service';

// 22/11/2026 — caso Andreia: rotina com longao de 270 min (ultramaratona); o teto de 240 recusava a semana inteira.
const duration = (AiWeeklyDecisionSchema as any).shape.sessions.element.shape.durationMin;

describe('teto de duracao de uma sessao no formato da IA', () => {
  it('aceita treino longo de 270 min (permitido pela rotina)', () => {
    expect(duration.safeParse(270).success).toBe(true);
    expect(duration.safeParse(240).success).toBe(true);
  });
  it('continua barrando valores impossiveis', () => {
    expect(duration.safeParse(721).success).toBe(false);
    expect(duration.safeParse(0).success).toBe(false);
  });
});
