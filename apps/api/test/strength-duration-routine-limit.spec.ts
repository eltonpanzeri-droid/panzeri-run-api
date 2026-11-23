import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AiStrengthSessionSchema, AiWeeklyDecisionSchema } from '../src/training-plans/prescription-agent.service';

// 22/11/2026 — caso Juliana: rotina de musculacao 75/75/90 min, mas toda semana saia 45 (Math.min com o modelo fixo de 45 no codigo).
// Ordens do treinador: o tempo da rotina e' o LIMITE; nada de trava de 45; sem cadencia.
// Incidente no mesmo dia: um campo novo (durationMin) no schema estourou "compiled grammar too large" (400) e derrubou a geracao — o schema NAO pode ganhar esse campo.
describe('schema da IA: sem durationMin na forca (gramatica ja no limite)', () => {
  it('AiStrengthSessionSchema nao tem durationMin', () => {
    expect(Object.keys(AiStrengthSessionSchema.shape)).not.toContain('durationMin');
  });
  it('o schema semanal continua serializavel como formato de saida', () => {
    expect(() => zodOutputFormat(AiWeeklyDecisionSchema)).not.toThrow();
  });
});

describe('codigo: sem teto de 45 nem cadencia', () => {
  const plans = readFileSync(join(__dirname, '../src/training-plans/training-plans.service.ts'), 'utf8');
  const agent = readFileSync(join(__dirname, '../src/training-plans/prescription-agent.service.ts'), 'utf8');
  it('a duracao da forca vem da decisao ou do tempo da rotina — nao de Math.min com o modelo', () => {
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

describe('direcao da musculacao (23/11/2026)', () => {
  const agent = readFileSync(join(__dirname, '../src/training-plans/prescription-agent.service.ts'), 'utf8');
  it('esta nos dois prompts de forca (semana e dia avulso) e a pausa de 90s+ cabe no schema', () => {
    expect((agent.match(/STRENGTH_INTENSITY_DIRECTION/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(AiStrengthSessionSchema.shape.restSeconds.safeParse(240).success).toBe(true);
    expect(agent).not.toContain('60 a 90s de descanso para musculacao');
  });
});

describe('dia de forca sem decisao (caso Mariana, 23/11/2026)', () => {
  const plans = readFileSync(join(__dirname, '../src/training-plans/training-plans.service.ts'), 'utf8');
  it('dia de forca anterior ao inicio da geracao e pulado, nao derruba a semana', () => {
    expect(plans).not.toContain('Decisao de forca ausente do agente de IA');
    expect(plans).toContain('Dia de forca sem decisao da IA');
  });
});

describe('hoje: quem decide e a pergunta, nunca o horario (23/11/2026)', () => {
  const plans = readFileSync(join(__dirname, '../src/training-plans/training-plans.service.ts'), 'utf8');
  it('sem corte por hora; SIM cria hoje, NAO (includeToday=false) nao cria', () => {
    expect(plans).not.toContain('TODAY_INCLUSION_CUTOFF_HOUR');
    expect(plans).toContain('const allowToday = includeToday !== false;');
  });
});
