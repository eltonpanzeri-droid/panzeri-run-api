import { aiBlockedProviders, runWithAiScope } from '../src/ai-governance/ai-scope';
import { TrainingPlansService } from '../src/training-plans/training-plans.service';

// Abertura do escopo de IA no Prescritor e escolha do recorde na visao para IA (Central Universal, Lote 1). Os metodos sao privados: acessados pelo prototipo.
type Row = Record<string, any>;
const scope = (blocked: string[], userId = 'u1') => ({ userId, destination: 'external_ai' as const, blocked, computedAt: Date.now() });
const proto = TrainingPlansService.prototype as unknown as Row;
const link = (provider: string, over: Row = {}) => ({ activityLog: { provider, startedAt: new Date('2026-10-12T10:00:00Z'), distanceMeters: 10000, durationSec: 3000, avgHeartRateBpm: 150, maxHeartRateBpm: 170, ...over } });
const completion = (over: Row = {}) => ({ status: 'done', distanceKm: 10, durationMin: 50, avgHeartRate: 150, maxHeartRate: 170, avgPaceSecondsKm: 300, ...over });

describe('TrainingPlansService + escopo de IA', () => {
  it('withAiScope abre o escopo do aluno com os provedores bloqueados calculados na hora; sem elegibilidade injetada (testes) so executa', async () => {
    const scopeFor = jest.fn(async (userId: string) => scope(['zepp'], userId));
    expect(await proto.withAiScope.call({ aiEligibility: { scopeFor } }, 'u1', async () => aiBlockedProviders())).toEqual(['zepp']);
    expect(scopeFor).toHaveBeenCalledWith('u1', 'external_ai');
    expect(await proto.withAiScope.call({ aiEligibility: undefined }, 'u1', async () => aiBlockedProviders())).toEqual([]);
  });

  it('firstWithDistanceForAi: sem bloqueio devolve o recorde bruto; com bloqueio descarta o que era copia do relogio e escolhe o proximo com distancia', async () => {
    const copy = { origin: 'agent', completion: completion({ distanceKm: 21 }), executionLinks: [link('zepp', { distanceMeters: 21000, durationSec: 6000 })] };
    const real = { origin: 'agent', completion: completion({ distanceKm: 15, durationMin: 80, avgHeartRate: 140, maxHeartRate: 160, avgPaceSecondsKm: 320 }), executionLinks: [] };
    expect(proto.firstWithDistanceForAi.call({}, copy, [copy, real])).toBe(copy);
    const pick = await runWithAiScope(scope(['zepp']), async () => proto.firstWithDistanceForAi.call({}, copy, [copy, real]));
    expect(pick).toBe(real);
    expect(await runWithAiScope(scope(['zepp']), async () => proto.firstWithDistanceForAi.call({}, copy, [copy]))).toBeNull();
  });
});
