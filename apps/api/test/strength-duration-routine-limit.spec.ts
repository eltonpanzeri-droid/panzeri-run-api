import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';

// 22/11/2026 — caso Juliana: rotina de musculacao 75/75/90 min, mas toda semana saia 45 (Math.min com o modelo fixo de 45 no codigo).
// Ordens do treinador: o tempo da rotina e' o LIMITE (a IA pode usar menos por julgamento, nunca mais); nada de trava de 45; sem cadencia.
const service = () => new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as never, { run: (fn: () => Promise<unknown>) => fn() } as never) as any;
const slot = (weekday: number, durationMin: number) => ({ weekday, modality: 'forca' as const, durationMin });
const ai = (weekday: number, durationMin?: number | null) => ({ weekday, modality: 'forca' as const, title: 'x', exerciseIds: ['a', 'b', 'c'], sets: 3, reps: '10', restSeconds: 60, intensity: 'Moderada' as const, notes: '', reasoning: null, ...(durationMin === undefined ? {} : { durationMin }) });

describe('tempo da musculacao: a IA declara, a rotina e o limite', () => {
  it('estimativa da IA abaixo do limite e mantida; igual ao limite tambem', () => {
    const result = service().validateStrengthSessions([ai(0, 60), ai(4, 90)], [slot(0, 75), slot(4, 90)]);
    expect(result.sessions.map((s: any) => s.durationMin)).toEqual([60, 90]);
  });
  it('nunca excede: acima do limite da rotina fica o limite', () => {
    const result = service().validateStrengthSessions([ai(0, 120)], [slot(0, 75)]);
    expect(result.sessions[0].durationMin).toBe(75);
  });
  it('sem estimativa da IA: nenhum valor inventado (o codigo usa o tempo da rotina na montagem)', () => {
    const result = service().validateStrengthSessions([ai(0), ai(2, null)], [slot(0, 75), slot(2, 75)]);
    expect(result.sessions.map((s: any) => s.durationMin ?? null)).toEqual([null, null]);
  });
});

describe('codigo: sem teto de 45 nem cadencia', () => {
  const plans = readFileSync(join(__dirname, '../src/training-plans/training-plans.service.ts'), 'utf8');
  const agent = readFileSync(join(__dirname, '../src/training-plans/prescription-agent.service.ts'), 'utf8');
  it('a duracao da forca vem da decisao da IA ou do tempo da rotina — nao de Math.min com o modelo', () => {
    expect(plans).toContain('strengthDecision ? (strengthDecision.durationMin ?? requestedDuration)');
  });
  it('a cadencia nao e mais escrita pelo codigo', () => {
    expect(plans).not.toContain('Execucao lenta e controlada');
    expect(plans).not.toContain('2s na fase excentrica');
    expect(plans).toMatch(/cadence: null,/);
  });
  it('os dois prompts de forca (semana e dia avulso) trazem o tempo como limite e a proibicao de cadencia', () => {
    expect((agent.match(/STRENGTH_TIME_INSTRUCTION/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((agent.match(/NO_CADENCE_INSTRUCTION/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(agent).toContain('nunca exceda');
  });
});
