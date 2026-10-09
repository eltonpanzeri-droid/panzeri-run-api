import { AI_CACHE_POLICY, AI_MODELS, AiCacheAgent, cacheControlFor } from '../src/common/ai-models.config';
import { estimateCallCost } from '../src/common/ai-usage-logger';

// Custo estimado por chamada (tarifas oficiais conferidas em 09/10/2026) e politica de cache por agente.
describe('estimateCallCost', () => {
  it('Sonnet 5: entrada, gravacao 5m (1,25x), leitura (0,1x) e saida', () => {
    const cost = estimateCallCost(AI_MODELS.SONNET_5, { input_tokens: 10_000, output_tokens: 5_000, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 20_000, ephemeral_1h_input_tokens: 0 } })!;
    expect(cost.usd).toBeCloseTo((10_000 * 2 + 20_000 * 2.5 + 5_000 * 10) / 1e6, 8); // 0,12
    expect(cost.usdWithoutCache).toBeCloseTo((30_000 * 2 + 5_000 * 10) / 1e6, 8);     // 0,11
    expect(cost.cacheSavingsUsd).toBeLessThan(0); // so gravou: o cache CUSTOU mais que nao ter cache (aparece negativo no log)
    expect(cost.inputTotalTokens).toBe(30_000);
  });

  it('leitura de cache gera economia positiva; gravacao de 1h usa 2x', () => {
    const read = estimateCallCost(AI_MODELS.SONNET_5, { input_tokens: 10_000, output_tokens: 0, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 })!;
    expect(read.cacheSavingsUsd).toBeCloseTo((20_000 * (2 - 0.2)) / 1e6, 8);
    const hour = estimateCallCost(AI_MODELS.SONNET_5, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } })!;
    expect(hour.usd).toBeCloseTo(4, 8);
    expect(hour.cache1hTokens).toBe(1_000_000);
  });

  it('sem o detalhe por TTL, toda gravacao conta como 5 min', () => {
    const cost = estimateCallCost(AI_MODELS.SONNET_5, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })!;
    expect(cost.usd).toBeCloseTo(2.5, 8);
  });

  it('Haiku 5.5: tarifa padrao ate 100 mil tokens de prompt; acima disso, tarifa maior (contando leitura e gravacao)', () => {
    const small = estimateCallCost(AI_MODELS.HAIKU_5_5, { input_tokens: 1_000_000 / 10, output_tokens: 0 })!;
    expect(small.usd).toBeCloseTo(0.01, 8);
    const long = estimateCallCost(AI_MODELS.HAIKU_5_5, { input_tokens: 10_000, output_tokens: 0, cache_read_input_tokens: 95_000 })!;
    expect(long.usd).toBeCloseTo((10_000 * 0.5 + 95_000 * 0.05) / 1e6, 8);
  });

  it('modelo sem tarifa => null (o log mostra n/d, nunca um numero inventado)', () => {
    expect(estimateCallCost('modelo-desconhecido', { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});

describe('politica de cache por agente', () => {
  it('Relator sem cache_control; os demais com TTL de 5 minutos (padrao da API, sem campo ttl)', () => {
    expect(cacheControlFor('relator')).toEqual({});
    for (const agent of Object.keys(AI_CACHE_POLICY).filter((a) => a !== 'relator') as AiCacheAgent[]) expect(cacheControlFor(agent)).toEqual({ cache_control: { type: 'ephemeral' } });
  });
});
