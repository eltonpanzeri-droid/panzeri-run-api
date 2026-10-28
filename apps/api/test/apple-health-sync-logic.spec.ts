import {
  HttpError, NativeReadError, bodySize, classifyFailure, emptyCounters, fitRoute, messageFor, packRouteBatches,
  type RouteBatchItem, type RoutePoint,
} from '../../mobile/src/appleHealthSync/appleHealthSyncLogic';

// Logica pura da sincronizacao Apple Saude no app (28/10/2026): lotes de percurso por bytes, classificacao de falhas e mensagens por resultado. O limite de corpo da API (~100 KB) NAO foi aumentado.

const LIMITS = { maxRoutesPerRequest: 3, maxPointsPerRoute: 1200, maxRequestBytes: 60_000 };
const route = (id: string, n: number): RouteBatchItem => ({
  recordId: id,
  points: Array.from({ length: n }, (_, i): RoutePoint => [i * 3, -23.5 + i * 0.000123456789, -46.6 - i * 0.000098765432, 760.123456 + (i % 7)]),
});

describe('lotes de percurso por bytes', () => {
  it('compacta coordenadas (5 casas) e altitude (1 casa) e preserva primeiro e ultimo ponto ao reduzir', () => {
    const fitted = fitRoute(route('a', 5000), LIMITS.maxRequestBytes, LIMITS.maxPointsPerRoute)!;
    expect(fitted.points.length).toBeLessThanOrEqual(LIMITS.maxPointsPerRoute);
    expect(bodySize([fitted])).toBeLessThanOrEqual(LIMITS.maxRequestBytes);
    expect(fitted.points[0][0]).toBe(0);
    expect(fitted.points[fitted.points.length - 1][0]).toBe(4999 * 3);
    expect(String(fitted.points[1][1]).split('.')[1].length).toBeLessThanOrEqual(5);
    expect(fitted.recordId).toBe('a'); // associacao rota/treino preservada
  });

  it('rota que nao cabe nem com o minimo de pontos e recusada (null), nunca enviada truncada sem aviso', () => {
    expect(fitRoute(route('a', 300), 300, 1200)).toBeNull();
  });

  it('cada lote respeita ao mesmo tempo o maximo de rotas e o orcamento de bytes; nada se perde nem se repete', () => {
    const items = Array.from({ length: 8 }, (_, i) => fitRoute(route(`r${i}`, 1200), LIMITS.maxRequestBytes, LIMITS.maxPointsPerRoute)!);
    const batches = packRouteBatches(items, LIMITS);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(LIMITS.maxRoutesPerRequest);
      expect(bodySize(batch)).toBeLessThanOrEqual(LIMITS.maxRequestBytes);
    }
    expect(batches.flat().map((i) => i.recordId)).toEqual(items.map((i) => i.recordId));
    expect(batches.length).toBeGreaterThan(1);
    // abaixo do limite de ~100 KB do corpo da API
    expect(Math.max(...batches.map(bodySize))).toBeLessThan(100_000);
  });

  it('rotas pequenas ficam juntas ate o maximo por requisicao', () => {
    const items = Array.from({ length: 7 }, (_, i) => fitRoute(route(`s${i}`, 50), LIMITS.maxRequestBytes, LIMITS.maxPointsPerRoute)!);
    expect(packRouteBatches(items, LIMITS).map((b) => b.length)).toEqual([3, 3, 1]);
  });
});

describe('classificacao de falhas e mensagens', () => {
  it('distingue leitura nativa, comunicacao, servidor e falta de autorizacao', () => {
    expect(classifyFailure(new NativeReadError('x'))).toBe('native_failure');
    expect(classifyFailure(new TypeError('Network request failed'))).toBe('communication_failure');
    expect(classifyFailure(new HttpError(503))).toBe('server_failure');
    expect(classifyFailure(new HttpError(500))).toBe('server_failure');
    expect(classifyFailure(new HttpError(403))).toBe('not_authorized');
    expect(classifyFailure(new HttpError(413))).toBe('communication_failure');
  });

  it('sucesso completo so quando nada ficou pendente; parcial lista o que falta; ausencia de treinos nao afirma permissao negada', () => {
    const done = emptyCounters(); done.created = 3; done.enriched = 2; done.already = 15; done.routesStored = 4;
    expect(messageFor('completed', done)).toMatchObject({ ok: true });
    expect(messageFor('completed', done).text).toContain('3 treinos novos importados');
    const partial = { ...done, routesFailed: 2, routesTooLarge: 1 };
    const message = messageFor('partial', partial);
    expect(message.ok).toBe(false);
    expect(message.text).toContain('Sincronização parcial');
    expect(message.text).toContain('2 percursos não foram enviados');
    expect(message.text).toContain('1 percurso é grande demais');
    expect(message.text).toContain('não é duplicado');
    const none = messageFor('no_activities', emptyCounters()).text;
    expect(none).toContain('o iPhone não informa qual dos dois');
    expect(none).not.toMatch(/negou|foi negad/i);
    expect(messageFor('server_failure', done).text).toContain('3 treinos novos importados'); // o que foi importado e preservado
    expect(messageFor('communication_failure', emptyCounters()).text).toContain('Falha de comunicação');
    expect(messageFor('native_failure', emptyCounters()).text).toContain('ler o app Saúde');
  });
});
