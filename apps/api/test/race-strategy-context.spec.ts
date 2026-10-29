import { HEALTH_INDICATORS_INSTRUCTION, PrescriptionAgentService, RACE_CALENDAR_INSTRUCTION } from '../src/training-plans/prescription-agent.service';
import type { MethodologyInput } from '../src/training-plans/training-methodology';

// Verifica o que REALMENTE chega ao agente de prescricao (o prompt do usuario montado), nao so' o que o prompt de sistema diz: prova alvo com dias restantes, meta, ultramaratona e indicadores
// de saude autorizados. Dados SINTETICOS.

const service = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as {
  buildUserPrompt: (...a: unknown[]) => string;
  buildSystemPromptStable: () => string;
};
const build = (extra: Partial<MethodologyInput>) => {
  const input = { goal: 'Correr ultramaratona de 100 km', experience: '', answers: {}, availability: [], history: [], ...extra } as MethodologyInput;
  const raw = service.buildUserPrompt(input, [], [], false, false, {}, null);
  return { raw, json: JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, any> };
};

describe('o que o agente recebe sobre a prova e a ultramaratona', () => {
  it('objetivo com a distancia da ultramaratona e prova alvo com data, distancia, meta de ritmo e dias restantes', () => {
    const race = { name: 'Ultra 100K', raceDate: new Date(Date.now() + 70 * 86_400_000).toISOString(), distanceKm: 100, paceSecondsPerKm: 480 };
    const { raw, json } = build({ targetRaces: [{ ...race, performanceIntent: 8 }] as never });
    expect(raw).toContain('Correr ultramaratona de 100 km');
    const meta = json.metasDeProva?.[0] ?? JSON.parse(raw.slice(raw.indexOf('"metasDeProva"'))).metasDeProva?.[0];
    expect(meta).toMatchObject({ nome: 'Ultra 100K', distanciaKm: 100, paceAlvoSegundosPorKm: 480 });
    expect(meta.diasAteAProva).toBe(70);
  });

  it('sem prova cadastrada a lista vai vazia (o agente nao presume prova)', () => {
    const { json } = build({ targetRaces: [] });
    expect(json.metasDeProva ?? []).toEqual([]);
  });

  it('indicadores de saude autorizados e dados de saude chegam dentro do contexto do atleta, sem virar nota de prontidao', () => {
    const athleteStateContext = {
      indicadoresDeSaudeAutorizados: {
        periodo: { de: '2026-10-02', ate: '2026-10-30' }, observacao: 'descritivo',
        indicadores: [{ id: 'vo2_max.vo2MaxMlKgMin', rotulo: 'VO₂ máximo estimado', unidade: 'mL/(kg·min)', categoria: 'vo2_max', fonte: 'apple_health', dias: 3, ultimo: 0, media: 45, minimo: 0, maximo: 48, ultimosValores: [] }],
      },
    };
    const { raw } = build({ athleteStateContext } as never);
    expect(raw).toContain('indicadoresDeSaudeAutorizados');
    expect(raw).toContain('vo2_max.vo2MaxMlKgMin');
    expect(raw).toMatch(/"ultimo":\s*0\b/); // zero informado continua zero
    expect(raw).not.toMatch(/prontidao|readiness/i);
  });

  it('o prompt de sistema da semana carrega as regras de prova, ultramaratona, SDNN x RMSSD e ausencia != zero', () => {
    const system = service.buildSystemPromptStable();
    expect(system).toContain(RACE_CALENDAR_INSTRUCTION);
    expect(system).toContain(HEALTH_INDICATORS_INSTRUCTION);
    expect(RACE_CALENDAR_INSTRUCTION).toMatch(/ultramaratona/i);
    expect(RACE_CALENDAR_INSTRUCTION).toMatch(/capacidade demonstrada|ja demonstrou/i);
    expect(HEALTH_INDICATORS_INSTRUCTION).toMatch(/SDNN/);
    expect(HEALTH_INDICATORS_INSTRUCTION).toMatch(/nunca zero/);
  });
});
