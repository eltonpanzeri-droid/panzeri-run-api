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

// Replica EXECUTAVEL, linha a linha, de PanzeriAppleHealthModule.sampleIndices e da montagem de candidatos do Swift (nao ha Swift neste ambiente: o que e' testado aqui e' o algoritmo, e a
// equivalencia com o codigo nativo e' conferida na compilacao/teste em macOS). Mantem primeiro e ultimo, ordem e no maximo maxPoints.
function nativeSampleIndices(count: number, maxPoints: number): number[] {
  if (count <= 0) return [];
  const limit = Math.max(2, maxPoints);
  if (count <= limit) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: limit }, (_, k) => Math.round((k * (count - 1)) / (limit - 1)));
}
function nativeCandidates(offsets: number[]): number[] {
  // offsets de pontos validos em ordem cronologica; antes do inicio (<0) ignorados; mesmo segundo fica o primeiro, exceto o ultimo ponto valido, que prevalece.
  const kept: Array<{ offset: number; source: number }> = [];
  offsets.forEach((offset, source) => { if (offset < 0) return; const last = kept[kept.length - 1]; if (last && offset <= last.offset) return; kept.push({ offset, source }); });
  const finalSource = offsets.length - 1;
  const finalKept = kept[kept.length - 1];
  if (finalKept && finalKept.source !== finalSource && offsets[finalSource] === finalKept.offset) kept[kept.length - 1] = { offset: offsets[finalSource], source: finalSource };
  return kept.map((c) => c.source);
}

describe('preservacao do primeiro e do ultimo ponto do percurso', () => {
  it('amostragem nativa: sempre inclui primeiro e ultimo, ordem estritamente crescente, nunca passa do maximo — inclusive quando count nao e multiplo do passo', () => {
    for (const [count, max] of [[1201, 1200], [1202, 1200], [2399, 1200], [2401, 1200], [5000, 1200], [10_001, 777], [100, 3], [13, 5], [1200, 1200], [1199, 1200]]) {
      const indices = nativeSampleIndices(count, max);
      expect(indices[0]).toBe(0);
      expect(indices[indices.length - 1]).toBe(count - 1);
      expect(indices.length).toBeLessThanOrEqual(Math.max(2, max));
      for (let i = 1; i < indices.length; i += 1) expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('rotas curtas ou com poucos pontos nao perdem nada; 0, 1 e 2 pontos', () => {
    expect(nativeSampleIndices(0, 1200)).toEqual([]);
    expect(nativeSampleIndices(1, 1200)).toEqual([0]);
    expect(nativeSampleIndices(2, 1200)).toEqual([0, 1]);
    expect(nativeSampleIndices(7, 1200)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(nativeSampleIndices(3, 2)).toEqual([0, 2]); // maximo minimo = 2 (primeiro e ultimo)
    expect(nativeSampleIndices(50, 1)).toEqual([0, 49]); // maxPoints menor que 2 vale 2
  });

  it('o algoritmo antigo (passo fixo) perdia o ultimo ponto; o novo nao', () => {
    const oldAlgorithm = (count: number, max: number) => { const step = Math.max(1, Math.ceil(count / max)); const out: number[] = []; for (let i = 0; i < count; i += step) out.push(i); return out; };
    expect(oldAlgorithm(1202, 1200).includes(1201)).toBe(false); // bug reproduzido
    expect(nativeSampleIndices(1202, 1200).includes(1201)).toBe(true);
  });

  it('candidatos: pontos antes do inicio sao ignorados, repetidos no mesmo segundo ficam com um so, e o ultimo ponto valido sempre prevalece', () => {
    expect(nativeCandidates([-5, -1, 0, 1, 1, 2, 3])).toEqual([2, 3, 5, 6]);
    expect(nativeCandidates([0, 5, 9, 9])).toEqual([0, 1, 3]); // o ultimo (indice 3) substitui o anterior do mesmo segundo
    expect(nativeCandidates([0, 0])).toEqual([1]); // um unico segundo: fica so' o ultimo (menos de 2 candidatos: sem percurso)
    expect(nativeCandidates([])).toEqual([]);
  });

  it('a reducao em JavaScript preserva os extremos que recebeu, em qualquer quantidade de pontos', () => {
    for (const n of [2, 3, 41, 1200, 1201, 2399, 5001]) {
      const fitted = fitRoute(route('x', n), LIMITS.maxRequestBytes, LIMITS.maxPointsPerRoute, 2);
      expect(fitted).not.toBeNull();
      const source = route('x', n).points;
      expect(fitted!.points[0][0]).toBe(source[0][0]);
      expect(fitted!.points[fitted!.points.length - 1][0]).toBe(source[n - 1][0]);
      expect(fitted!.points.length).toBeLessThanOrEqual(LIMITS.maxPointsPerRoute);
      for (let i = 1; i < fitted!.points.length; i += 1) expect(fitted!.points[i][0]).toBeGreaterThan(fitted!.points[i - 1][0]);
    }
  });
});
