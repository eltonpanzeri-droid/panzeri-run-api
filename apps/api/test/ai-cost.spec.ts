import { Logger } from '@nestjs/common';
import { setAiCostSink, type AiCostRecord } from '../src/common/ai-cost-sink';
import { estimateCallCost, logAiUsage } from '../src/common/ai-usage-logger';
import { AI_MODELS } from '../src/common/ai-models.config';
import { runWithAiScope } from '../src/ai-governance/ai-scope';
import { AiCostRecorderService } from '../src/ai-cost/ai-cost-recorder.service';
import { AiCostService, brtDay, brtMonthStart, type CostRow } from '../src/ai-cost/ai-cost.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { LongitudinalDynamicsService } from '../src/training-intelligence/longitudinal-dynamics.service';

// 01/11/2026 — custo real por chamada de IA: gravado (so' numeros) e descrito na tela "Custo por prescricao".
// Valores de referencia: geracao real da Duane (US$ 0,432114) conferida pelo Elton no painel da Anthropic.
const DUANE_USAGE = { input_tokens: 93872, output_tokens: 12254, cache_read_input_tokens: 0, cache_creation_input_tokens: 48732, cache_creation: { ephemeral_5m_input_tokens: 48732, ephemeral_1h_input_tokens: 0 } };

afterEach(() => setAiCostSink(null));

describe('custo real por chamada', () => {
  it('as partes do custo somam exatamente o custo total (caso real da Duane)', () => {
    const cost = estimateCallCost(AI_MODELS.SONNET_5, DUANE_USAGE)!;
    expect(cost.usd).toBeCloseTo(0.432114, 6);
    expect(cost.parts.input + cost.parts.cacheWrite + cost.parts.cacheRead + cost.parts.output).toBeCloseTo(cost.usd, 9);
    expect(cost.parts.output).toBeCloseTo(0.12254, 6);
  });

  it('logAiUsage publica o registro com o aluno do escopo de IA e sem texto', async () => {
    const received: AiCostRecord[] = [];
    setAiCostSink((record) => received.push(record));
    const scope = { userId: 'aluna-1', destination: 'internal_ai' as const, blocked: [], computedAt: 0 };
    await runWithAiScope(scope, async () => {
      logAiUsage(new Logger('teste'), { agent: 'treinador_semana', model: AI_MODELS.SONNET_5, usage: DUANE_USAGE, durationMs: 137937, effort: 'medium', detail: { prompt: { userChars: 10 } } });
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ agent: 'treinador_semana', userId: 'aluna-1', effort: 'medium', inputTokens: 93872, outputTokens: 12254, cacheCreationTokens: 48732 });
    expect(received[0].costUsd).toBeCloseTo(0.432114, 6);
    expect(received[0].detail).toEqual({ prompt: { userChars: 10 } });
  });

  it('fora de escopo grava sem aluno, e destino que lanca erro nunca derruba a chamada', () => {
    const received: AiCostRecord[] = [];
    setAiCostSink((record) => received.push(record));
    logAiUsage(new Logger('teste'), { agent: 'relator', model: AI_MODELS.HAIKU_5_5, usage: { input_tokens: 10, output_tokens: 5 }, durationMs: 5 });
    expect(received[0].userId).toBeNull();
    setAiCostSink(() => { throw new Error('banco fora'); });
    expect(() => logAiUsage(new Logger('teste'), { agent: 'relator', model: AI_MODELS.HAIKU_5_5, usage: { input_tokens: 10, output_tokens: 5 }, durationMs: 5 })).not.toThrow();
  });

  it('modelo sem tarifa nao grava nada (nunca inventa numero)', () => {
    const received: AiCostRecord[] = [];
    setAiCostSink((record) => received.push(record));
    logAiUsage(new Logger('teste'), { agent: 'x', model: 'modelo-desconhecido', usage: { input_tokens: 1, output_tokens: 1 }, durationMs: 1 });
    expect(received).toHaveLength(0);
  });
});

describe('AiCostRecorderService', () => {
  const record: AiCostRecord = { agent: 'treinador_semana', model: 'm', effort: 'medium', userId: 'u1', inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 3, costUsd: 0.5, costWithoutCacheUsd: 0.4, inputUsd: 0.1, cacheWriteUsd: 0.1, cacheReadUsd: 0, outputUsd: 0.3, durationMs: 9, detail: null };

  it('grava a linha com os valores do registro', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AiCostRecorderService({ aiGenerationCost: { create } } as never);
    await service.save(record);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ agent: 'treinador_semana', userId: 'u1', costUsd: 0.5, cacheCreationTokens: 3 }) });
  });

  it('falha do banco vira aviso e nao lanca', async () => {
    const service = new AiCostRecorderService({ aiGenerationCost: { create: jest.fn().mockRejectedValue(new Error('conexao')) } } as never);
    await expect(service.save(record)).resolves.toBeUndefined();
  });

  it('registra o destino ao iniciar e remove ao encerrar', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AiCostRecorderService({ aiGenerationCost: { create } } as never);
    service.onModuleInit();
    logAiUsage(new Logger('teste'), { agent: 'relator', model: AI_MODELS.HAIKU_5_5, usage: { input_tokens: 10, output_tokens: 5 }, durationMs: 5 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(create).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    logAiUsage(new Logger('teste'), { agent: 'relator', model: AI_MODELS.HAIKU_5_5, usage: { input_tokens: 10, output_tokens: 5 }, durationMs: 5 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('AiCostService.buildOverview', () => {
  const math = new MathLayerService();
  const service = new AiCostService({} as never, math, new LongitudinalDynamicsService(math));
  const now = new Date('2026-11-15T15:00:00.000Z');
  const row = (i: number, agent: string, costUsd: number, userId: string | null = 'u1'): CostRow => ({
    id: `r${i}`, createdAt: new Date(Date.UTC(2026, 10, 1 + i, 12)), agent, model: 'm', effort: 'medium', costUsd,
    inputUsd: costUsd * 0.4, cacheWriteUsd: costUsd * 0.1, cacheReadUsd: 0, outputUsd: costUsd * 0.5,
    inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 200, durationMs: 1000,
    detail: i === 3 ? { prompt: { userFields: [{ field: 'historicoSemanal', chars: 9000 }] }, saida: { notVisibleTokensEstimate: 7000 } } : null,
    studentCode: userId ? 1000001 : null, studentName: userId ? 'Aluna' : null, userId,
  });

  it('sem nenhuma gravacao devolve zeros e series vazia, sem quebrar', () => {
    const out = service.buildOverview([], 90, new Date('2026-08-01'), now);
    expect(out.totals).toMatchObject({ calls: 0, totalUsd: 0, monthToDateUsd: 0 });
    expect(out.weeklyPrescription).toMatchObject({ calls: 0, meanUsd: null, medianUsd: null, lastUsd: null });
    expect(out.series.points).toEqual([]);
  });

  it('agrega por agente, soma as partes e calcula media e mediana da prescricao semanal', () => {
    const rows = [row(0, 'treinador_semana', 0.4), row(1, 'treinador_semana', 0.5), row(2, 'treinador_semana', 0.6), row(3, 'treinador_semana', 1.0), row(4, 'prontuario_condensacao', 0.002, null)];
    const out = service.buildOverview(rows, 90, new Date('2026-08-01'), now);
    expect(out.totals.totalUsd).toBeCloseTo(2.502, 6);
    expect(out.weeklyPrescription).toMatchObject({ calls: 4, lastUsd: 1 });
    expect(out.weeklyPrescription.meanUsd).toBeCloseTo(0.625, 6);
    expect(out.weeklyPrescription.medianUsd).toBeCloseTo(0.55, 6);
    const weekly = out.agents.find((a) => a.agent === 'treinador_semana')!;
    expect(weekly.parts.inputUsd + weekly.parts.cacheWriteUsd + weekly.parts.cacheReadUsd + weekly.parts.outputUsd).toBeCloseTo(weekly.totalUsd, 6);
    expect(out.byStudent).toHaveLength(1);
    expect(out.byStudent[0].calls).toBe(4);
  });

  it('a serie usa SO o historico anterior e marca ausencia de faixa quando a base e pequena', () => {
    const rows = [0, 1, 2, 3, 4].map((i) => row(i, 'treinador_semana', 0.4 + i * 0.01));
    const out = service.buildOverview(rows, 90, new Date('2026-08-01'), now);
    expect(out.series.points).toHaveLength(5);
    expect(out.series.points[0]).toMatchObject({ mm7: null, bandLower: null, signal: 'no_reference' });
    expect(out.series.points[4].bandBasis).toBe('limited');
    expect(out.series.points[4].mm7).not.toBeNull();
  });

  it('lista as geracoes mais caras com o maior campo do prompt, sem texto de aluno', () => {
    const rows = [row(0, 'treinador_semana', 0.4), row(3, 'treinador_semana', 1.0)];
    const out = service.buildOverview(rows, 90, new Date('2026-08-01'), now);
    expect(out.mostExpensive[0]).toMatchObject({ costUsd: 1, biggestPromptField: { field: 'historicoSemanal', chars: 9000 }, notVisibleOutputTokensEstimate: 7000 });
  });

  it('o mes corrente usa o horario de Brasilia (virada as 03:00 UTC)', () => {
    expect(brtDay(new Date('2026-11-01T02:59:00.000Z'))).toBe('2026-10-31');
    expect(brtDay(new Date('2026-11-01T03:00:00.000Z'))).toBe('2026-11-01');
    expect(brtMonthStart(new Date('2026-11-15T15:00:00.000Z')).toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });
});
