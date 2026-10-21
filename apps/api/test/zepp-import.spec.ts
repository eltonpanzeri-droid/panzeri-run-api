import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { buildSyntheticFit } from './helpers/synthetic-fit';
import { modalityFromFit, readZeppFit, ZEPP_FIT_PROFILE, ZeppFitError } from '../src/zepp/zepp-fit';
import { applyZeppConsent } from '../src/zepp/zepp-fit-consent';
import { isAllowedCallbackUrl, parseZeppWebhook, toInboundDrafts, ZEPP_WEBHOOK_MAX_BYTES, ZeppWebhookParseError } from '../src/zepp/zepp-webhook';
import { ZeppWebhookController } from '../src/zepp/zepp-webhook.controller';
import { ZeppFitDownloader } from '../src/zepp/zepp-fit-downloader';
import { ZeppActivityIngestionService } from '../src/zepp/zepp-activity-ingestion.service';
import { ZeppActivityEventService } from '../src/zepp/zepp-activity-events.service';

const CALLBACK = 'https://api-open.zepp.com/api/activity/file?id=10010727180&token=550e8400-e29b-41d4-a716-446655440000';
const record = (over: Record<string, unknown> = {}) => ({ userId: '4aacafe82427c251df9c9592d0c06768', summaryId: '10010727180-file', fileType: 'FIT', callbackURL: CALLBACK, activityType: 'OUTDOOR_RUN', deviceName: 'Amazfit GTR 4', startTimeInSeconds: 1617717902, activityId: 10010727180, manual: false, ...over });
// Corpo EXATAMENTE no formato da Zepp: array JSON de STRINGS, cada uma um objeto serializado.
const body = (...events: unknown[]) => JSON.stringify(events.map((event) => JSON.stringify(event)));
const activityBody = (...records: unknown[]) => body({ activityFiles: records });
const HYPOTHETICAL_CADENCE_PROFILE = { runningCadenceMultiplier: 2 }; // hipotetico: so' para testar a conversao; o real so' sera preenchido com um FIT real/Zepp

describe('webhook da Zepp: parser do formato oficial', () => {
  it('le o exemplo da documentacao (array de strings JSON com activityFiles)', () => {
    const content = parseZeppWebhook(activityBody(record()));
    expect(content.activityFiles).toEqual([{ userId: '4aacafe82427c251df9c9592d0c06768', summaryId: '10010727180-file', callbackURL: CALLBACK, activityType: 'OUTDOOR_RUN', deviceName: 'Amazfit GTR 4', startTimeInSeconds: 1617717902, activityId: '10010727180', manual: false }]);
    expect(content.ignored).toBe(0);
  });

  it('callbackURL so vale no host oficial, HTTPS, sem credenciais/porta e no caminho do arquivo (o token do aluno nunca vai para outro destino)', () => {
    expect(isAllowedCallbackUrl(CALLBACK)).toBe(true);
    for (const bad of [
      'http://api-open.zepp.com/api/activity/file?id=1&token=t',
      'https://evil.example.com/api/activity/file?id=1&token=t',
      'https://api-open.zepp.com@evil.example.com/api/activity/file?id=1',
      'https://api-open.zepp.com.evil.example.com/api/activity/file?id=1',
      'https://user:pw@api-open.zepp.com/api/activity/file?id=1',
      'https://api-open.zepp.com:8443/api/activity/file?id=1',
      'https://api-open.zepp.com/other/path?id=1',
      'https://api-open.zepp.com/api/activity/file/../../x',
      'file:///etc/passwd',
      '//api-open.zepp.com/api/activity/file',
      '',
    ]) expect(isAllowedCallbackUrl(bad)).toBe(false);
    expect(isAllowedCallbackUrl(undefined)).toBe(false);
    const content = parseZeppWebhook(activityBody(record({ callbackURL: 'https://evil.example.com/api/activity/file?id=1' }), record({ summaryId: '2-file' })));
    expect(content.activityFiles.map((f) => f.summaryId)).toEqual(['2-file']);
    expect(content.ignored).toBe(1);
  });

  it('descarta item invalido sem derrubar os demais; tipo de arquivo diferente de FIT e id estranho sao ignorados', () => {
    const content = parseZeppWebhook(activityBody(record({ fileType: 'GPX' }), record({ summaryId: 'a b' }), record({ userId: '' }), record({ summaryId: '3-file' })));
    expect(content.activityFiles).toHaveLength(1);
    expect(content.ignored).toBe(3);
  });

  it('corpo fora do formato (nao JSON, nao array, grande demais, vazio) e rejeitado', () => {
    for (const bad of ['', 'nao e json', '{"a":1}', '"texto"']) expect(() => parseZeppWebhook(bad)).toThrow(ZeppWebhookParseError);
    expect(() => parseZeppWebhook(`["${'x'.repeat(ZEPP_WEBHOOK_MAX_BYTES)}"]`)).toThrow(ZeppWebhookParseError);
    expect(parseZeppWebhook('["nao-json", 7, null]').ignored).toBe(3);
  });

  it('authorizationChange (delete) e lido; eventos viram rascunhos idempotentes sem nenhum dado alem do necessario', () => {
    const content = parseZeppWebhook(body({ userId: '1188969166', eventType: 'authorizationChange', changeType: 'delete', eventTime: 1785822275955 }, { activityFiles: [record()] }));
    expect(content.authorizationChanges).toEqual([{ userId: '1188969166', changeType: 'delete', eventTime: 1785822275955 }]);
    const drafts = toInboundDrafts(content);
    expect(drafts.map((d) => [d.eventType, d.category, d.dedupeKey])).toEqual([
      ['activity_file', 'activity', expect.stringMatching(/^activity:10010727180-file:[0-9a-f]{16}$/)],
      ['authorization_change', 'profile', 'auth:1188969166:delete:1785822275955'],
    ]);
    expect(toInboundDrafts(content).map((d) => d.dedupeKey)).toEqual(drafts.map((d) => d.dedupeKey)); // reenvio => mesma chave
  });
});

describe('receptor HTTP do webhook', () => {
  const SECRET = 'a'.repeat(40);
  const make = (secret: string | undefined, known = true) => {
    const events = { record: jest.fn(async () => ({ created: true, id: 'e1' })) };
    const consent = { resolveActiveUserId: jest.fn(async (_p: string, external: string) => (known && external === '4aacafe82427c251df9c9592d0c06768' ? 'u1' : null)) };
    const controller = new ZeppWebhookController({ get: () => secret } as any, events as any, consent as any);
    return { controller, events, consent };
  };
  const req = (text: string) => Readable.from([Buffer.from(text)]) as any;

  it('segredo errado, ausente ou curto => 404 (nao revela a rota) e nada e gravado', async () => {
    for (const [configured, given] of [[SECRET, 'b'.repeat(40)], [undefined, SECRET], ['curto', 'curto'], ['', '']] as const) {
      const { controller, events } = make(configured as string | undefined);
      await expect(controller.receive(given, req(activityBody(record())))).rejects.toThrow(NotFoundException);
      expect(events.record).not.toHaveBeenCalled();
    }
  });

  it('segredo correto: enfileira so eventos de conta ATIVA, ignora conta desconhecida em silencio e aceita 2 segredos (rotacao)', async () => {
    const { controller, events } = make(`${'z'.repeat(40)}, ${SECRET}`);
    await controller.receive(SECRET, req(activityBody(record(), record({ userId: 'desconhecida', summaryId: '9-file' }))));
    expect(events.record).toHaveBeenCalledTimes(1);
    expect((events.record.mock.calls as any[])[0][1]).toMatchObject({ eventType: 'activity_file', dedupeKey: expect.stringMatching(/^activity:10010727180-file:[0-9a-f]{16}$/) });
    expect((events.record.mock.calls as any[])[0][2]).toBe('u1');
  });

  it('corpo invalido => 400; corpo grande demais => 400 sem ler tudo; nada na fila', async () => {
    const { controller, events } = make(SECRET);
    await expect(controller.receive(SECRET, req('lixo'))).rejects.toThrow(BadRequestException);
    await expect(controller.receive(SECRET, Readable.from([Buffer.alloc(ZEPP_WEBHOOK_MAX_BYTES + 10, 120)]) as any)).rejects.toThrow(BadRequestException);
    expect(events.record).not.toHaveBeenCalled();
  });

  it('a rota e publica de proposito (a Zepp nao usa JWT) e e a UNICA do webhook; com limite de taxa', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'zepp', 'zepp-webhook.controller.ts'), 'utf8');
    expect(source).not.toContain('AuthGuard');
    expect(source.match(/@Post\(/g)).toHaveLength(1);
    expect(source).toContain('@Throttle');
    expect(source).toContain('timingSafeEqual');
  });
});

describe('leitor FIT (arquivos sinteticos)', () => {
  it('le sessao e serie, converte velocidade para km/h e extrai o fuso do relogio', async () => {
    const fit = await readZeppFit(buildSyntheticFit({ seconds: 120, speedMs: 3, localOffsetMinutes: -180 }), HYPOTHETICAL_CADENCE_PROFILE);
    expect(fit.startedAt.toISOString()).toBe('2026-10-18T09:00:00.000Z');
    expect(fit.utcOffsetMinutes).toBe(-180);
    expect(fit.modality).toBe('corrida');
    expect(fit.durationSec).toBe(120);
    expect(fit.distanceMeters).toBeCloseTo(360, 0);
    expect(fit.avgHeartRateBpm).toBe(142);
    expect(fit.maxHeartRateBpm).toBe(168);
    expect(fit.powerAvgWatts).toBe(210);
    expect(fit.elevationGainMeters).toBe(25);
    expect(fit.caloriesKcal).toBe(520);
    expect(fit.hasRoute).toBe(true);
    expect(fit.points).toHaveLength(120);
    expect(fit.points[10]).toMatchObject({ offsetSec: 10, speedKmh: 10.8, powerWatts: 210 });
    expect(fit.points[10].latitude).toBeCloseTo(-23.5499, 3);
    expect(fit.points[10].elevationMeters).not.toBeNull();
  });

  it('cadencia NAO e gravada enquanto o fator passos/min nao estiver confirmado; com perfil confirmado converte', async () => {
    expect(ZEPP_FIT_PROFILE.runningCadenceMultiplier).toBeNull(); // hoje nao confirmado
    const unconfirmed = await readZeppFit(buildSyntheticFit({ seconds: 20, cadence: 85 }));
    expect(unconfirmed.cadenceAvg).toBeNull();
    expect(unconfirmed.points.every((p) => p.cadenceSpm === null)).toBe(true);
    expect(unconfirmed.notes.join(' ')).toContain('cadence_unit_unconfirmed');
    const confirmed = await readZeppFit(buildSyntheticFit({ seconds: 20, cadence: 85 }), HYPOTHETICAL_CADENCE_PROFILE);
    expect(confirmed.cadenceAvg).toBe(170);
    expect(confirmed.points[0].cadenceSpm).toBe(170);
  });

  it('fuso ausente fica registrado (nao e assumido); leituras fisicamente impossiveis viram null, nunca zero', async () => {
    const fit = await readZeppFit(buildSyntheticFit({ seconds: 30, localOffsetMinutes: null, heartRate: (s) => (s === 5 ? 251 : 150) }));
    expect(fit.utcOffsetMinutes).toBeNull();
    expect(fit.notes.join(' ')).toContain('utc_offset_unknown');
    expect(fit.points[5].heartRateBpm).toBeNull();
    expect(fit.points[6].heartRateBpm).toBe(150);
    expect(fit.notes.join(' ')).toContain('sensor_out_of_range');
  });

  it('arquivo corrompido, vazio ou multiesporte e recusado com codigo explicito', async () => {
    const good = buildSyntheticFit({ seconds: 20 });
    const corrupted = Buffer.from(good);
    corrupted[40] ^= 0xff;
    await expect(readZeppFit(corrupted)).rejects.toMatchObject({ code: 'invalid_fit' });
    await expect(readZeppFit(Buffer.alloc(0))).rejects.toMatchObject({ code: 'invalid_fit' });
    await expect(readZeppFit(Buffer.from('isto nao e um fit'))).rejects.toBeInstanceOf(ZeppFitError);
    await expect(readZeppFit(buildSyntheticFit({ seconds: 20, sessions: 2 }))).rejects.toMatchObject({ code: 'multiple_sessions' });
  });

  it('modalidade canonica: esteira, caminhada, bike; desconhecido vira "outra" (nunca corrida por palpite)', async () => {
    expect(modalityFromFit('running', 'treadmill')).toBe('esteira');
    expect(modalityFromFit('walking', null)).toBe('caminhada');
    expect(modalityFromFit('cycling', 'road')).toBe('bike');
    expect(modalityFromFit('rowing', null)).toBe('outra');
    expect(modalityFromFit(null, null)).toBe('outra');
    expect((await readZeppFit(buildSyntheticFit({ seconds: 10, sport: 1, subSport: 1 }))).modality).toBe('esteira');
  });
});

describe('filtro por campo conforme o consentimento (antes de gravar)', () => {
  const load = () => readZeppFit(buildSyntheticFit({ seconds: 30 }), HYPOTHETICAL_CADENCE_PROFILE);

  it('so "Atividades": distancia/velocidade/duracao ficam; FC, cadencia, potencia, altitude, ganho e GPS NAO', async () => {
    const { activity, removed } = applyZeppConsent(await load(), ['profile', 'activity']);
    expect(removed).toEqual(['sensors', 'route']);
    expect(activity).toMatchObject({ avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: false });
    expect(activity.distanceMeters).not.toBeNull();
    expect(activity.durationSec).toBe(30);
    for (const point of activity.points) {
      expect(point).toMatchObject({ heartRateBpm: null, cadenceSpm: null, powerWatts: null, elevationMeters: null, latitude: null, longitude: null });
      expect(point.speedKmh).not.toBeNull();
    }
    expect(JSON.stringify(activity)).not.toContain('-23.5'); // nenhuma coordenada sobra em lugar nenhum
  });

  it('com sensores mas sem GPS: FC/cadencia/potencia/altitude ficam, coordenadas nao', async () => {
    const { activity, removed } = applyZeppConsent(await load(), ['profile', 'activity', 'activity_sensors']);
    expect(removed).toEqual(['route']);
    expect(activity.avgHeartRateBpm).toBe(142);
    expect(activity.points[0].heartRateBpm).not.toBeNull();
    expect(activity.points.every((p) => p.latitude === null && p.longitude === null)).toBe(true);
    expect(activity.hasRoute).toBe(false);
  });

  it('com tudo autorizado nada e removido; sem sensores nem GPS e sem distancia a serie some', async () => {
    const all = applyZeppConsent(await load(), ['profile', 'activity', 'activity_sensors', 'activity_route']);
    expect(all.removed).toEqual([]);
    expect(all.activity.hasRoute).toBe(true);
    expect(all.activity.points[0].latitude).not.toBeNull();
  });
});

describe('download do FIT', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('URL fora do host oficial: NADA e enviado (o token do aluno nao sai)', async () => {
    global.fetch = jest.fn() as any;
    const result = await new ZeppFitDownloader().download('token-secreto', 'https://evil.example.com/api/activity/file?id=1&token=t');
    expect(result).toEqual({ ok: false, kind: 'invalid_url', httpStatus: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('envia Bearer + Accept octet-stream, nao segue redirecionamento e devolve o binario em memoria', async () => {
    const fetchMock = jest.fn(async () => new Response(Buffer.from([1, 2, 3, 4]), { status: 200 }));
    global.fetch = fetchMock as any;
    const result = await new ZeppFitDownloader().download('token-secreto', CALLBACK);
    expect(result.ok && [...result.buffer]).toEqual([1, 2, 3, 4]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CALLBACK); // exatamente como recebida
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-secreto', Accept: 'application/octet-stream' });
  });

  it('classifica os codigos documentados: 410/404/401/403/400/5xx e falha de rede', async () => {
    const table: Array<[number, string]> = [[410, 'expired'], [404, 'not_found'], [401, 'auth'], [403, 'forbidden'], [400, 'bad_request'], [503, 'transient'], [500, 'transient']];
    for (const [status, kind] of table) {
      global.fetch = jest.fn(async () => new Response('x', { status })) as any;
      expect(await new ZeppFitDownloader().download('t', CALLBACK)).toMatchObject({ ok: false, kind, httpStatus: status });
    }
    global.fetch = jest.fn(async () => { throw new Error('rede'); }) as any;
    expect(await new ZeppFitDownloader().download('t', CALLBACK)).toMatchObject({ ok: false, kind: 'network' });
  });

  it('arquivo acima do teto e recusado', async () => {
    global.fetch = jest.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(26 * 1024 * 1024) } })) as any;
    expect(await new ZeppFitDownloader().download('t', CALLBACK)).toMatchObject({ ok: false, kind: 'too_large' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
type Calls = Record<string, any[]>;
function makeIngestion(granted: { categories: string[]; purposes?: string[] } | null) {
  const calls: Calls = { raw: [], log: [], deleteMany: [], createMany: [] };
  const tx: any = {
    rawExternalActivity: { upsert: jest.fn(async (args: any) => { calls.raw.push(args); return { id: 'raw1' }; }) },
    activityLog: { upsert: jest.fn(async (args: any) => { calls.log.push(args); return { id: 'log1' }; }) },
    activityTimeSeriesPoint: {
      deleteMany: jest.fn(async (args: any) => { calls.deleteMany.push(args); return { count: 0 }; }),
      createMany: jest.fn(async (args: any) => { calls.createMany.push(args); return { count: args.data.length }; }),
    },
  };
  const consent = { writeWhileAuthorized: jest.fn(async (_p: string, _u: string, write: any) => (granted ? write(tx, { purposes: [], ...granted }) : null)) };
  const link = { classify: jest.fn(async () => 'corresponding'), reconcileAffectedByIdentity: jest.fn(async () => undefined) };
  const notifications = { notifyReconciliation: jest.fn(async () => undefined) };
  const identity = { evaluateSafely: jest.fn(async () => undefined) };
  const service = new ZeppActivityIngestionService({} as any, consent as any, link as any, notifications as any, identity as any);
  return { service, calls, consent, link, notifications, identity };
}
const META = { summaryId: '10010727180-file', activityId: '10010727180', activityType: 'OUTDOOR_RUN', deviceName: 'Amazfit GTR 4', source: 'webhook' as const };

describe('gravacao no pipeline (RawExternalActivity -> ActivityLog -> serie)', () => {
  it('grava resumo + serie, NAO guarda o FIT nem coordenadas no raw e aciona identidade, classificacao e notificacao', async () => {
    const t = makeIngestion({ categories: ['profile', 'activity', 'activity_sensors', 'activity_route'] });
    const fit = await readZeppFit(buildSyntheticFit({ seconds: 60 }), HYPOTHETICAL_CADENCE_PROFILE);
    const result = await t.service.ingest('u1', META, fit);
    expect(result).toMatchObject({ written: true, activityLogId: 'log1', classification: 'corresponding', removed: [] });
    const raw = t.calls.raw[0];
    expect(raw.create).toMatchObject({ provider: 'zepp', externalId: '10010727180-file', payloadSchemaVersion: 'zepp-fit-normalized-1' });
    expect(raw.create.ingestionMeta).toMatchObject({ fitStored: false, source: 'webhook' });
    expect(JSON.stringify(raw.create.payload)).not.toMatch(/-23\.|-46\.|latitude|longitude/); // payload bruto sem percurso
    const log = t.calls.log[0];
    expect(log.create).toMatchObject({ provider: 'zepp', sport: 'corrida', utcOffsetMinutes: -180, avgHeartRateBpm: 142, powerAvgWatts: 210, elevationGainMeters: 25, hasRoute: true });
    expect(t.calls.createMany[0].data).toHaveLength(60);
    expect(t.calls.createMany[0].data[0]).toMatchObject({ provider: 'zepp', activityLogId: 'log1', latitude: expect.any(Number), powerWatts: 210 });
    expect(t.identity.evaluateSafely).toHaveBeenCalledWith('log1');
    expect(t.link.classify).toHaveBeenCalledWith('log1');
    expect(t.notifications.notifyReconciliation).toHaveBeenCalledWith('u1', 'log1', 'corresponding');
  });

  it('o filtro usa as categorias lidas DENTRO da trava: retirada no meio do processamento nao e gravada', async () => {
    const t = makeIngestion({ categories: ['profile', 'activity'] }); // aluno retirou sensores e GPS
    const fit = await readZeppFit(buildSyntheticFit({ seconds: 30 }), HYPOTHETICAL_CADENCE_PROFILE);
    const result = await t.service.ingest('u1', META, fit);
    expect(result).toMatchObject({ written: true, removed: ['sensors', 'route'] });
    expect(t.calls.log[0].create).toMatchObject({ avgHeartRateBpm: null, powerAvgWatts: null, elevationGainMeters: null, cadenceAvg: null, hasRoute: false });
    for (const point of t.calls.createMany[0].data) expect(point).toMatchObject({ heartRateBpm: null, latitude: null, longitude: null, powerWatts: null, elevationMeters: null });
    expect(JSON.stringify(t.calls.raw[0].create.payload)).toContain('"sensorsIncluded":false');
  });

  it('sem conexao ativa ou sem a categoria "activity": nada e gravado e o pipeline nao roda', async () => {
    for (const granted of [null, { categories: ['profile'] }]) {
      const t = makeIngestion(granted);
      const result = await t.service.ingest('u1', META, await readZeppFit(buildSyntheticFit({ seconds: 10 })));
      expect(result).toEqual({ written: false, reason: 'not_authorized' });
      expect(t.calls.raw).toHaveLength(0);
      expect(t.link.classify).not.toHaveBeenCalled();
    }
  });

  it('reprocessar o mesmo summaryId refaz a serie (apaga e regrava) sem duplicar e sem tocar vinculos', async () => {
    const t = makeIngestion({ categories: ['profile', 'activity'] });
    const fit = await readZeppFit(buildSyntheticFit({ seconds: 20 }));
    await t.service.ingest('u1', META, fit);
    await t.service.ingest('u1', META, fit);
    expect(t.calls.raw).toHaveLength(2);
    expect(t.calls.raw[1].where).toEqual(t.calls.raw[0].where); // mesma chave natural (provider, userId, summaryId)
    expect(t.calls.deleteMany).toHaveLength(2);
    expect(JSON.stringify(t.calls.log[1].update)).not.toMatch(/executionClassification|executionLink/);
  });

  it('falha em passo do pipeline (classificar/notificar) nao desfaz a gravacao', async () => {
    const t = makeIngestion({ categories: ['profile', 'activity'] });
    t.link.classify.mockRejectedValueOnce(new Error('falha'));
    t.notifications.notifyReconciliation.mockRejectedValueOnce(new Error('falha'));
    const result = await t.service.ingest('u1', META, await readZeppFit(buildSyntheticFit({ seconds: 10 })));
    expect(result).toMatchObject({ written: true, activityLogId: 'log1', classification: null });
  });
});

describe('processamento dos eventos da fila', () => {
  const view = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'e1', provider: 'zepp', eventType: 'activity_file', userId: 'u1', externalAccountId: 'zx', payload, attempt: 1, ...extra });
  const payload = (over: Record<string, unknown> = {}) => ({ summaryId: '10010727180-file', callbackURL: CALLBACK, activityType: 'OUTDOOR_RUN', deviceName: 'Amazfit', startTimeInSeconds: Math.floor(Date.parse('2026-10-18T09:00:00Z') / 1000), activityId: '10010727180', manual: false, ...over });
  function make(opts: { snapshot?: any; download?: any; ingestWritten?: boolean } = {}) {
    const consent = { snapshot: jest.fn(async () => (opts.snapshot === undefined ? { categories: ['profile', 'activity', 'activity_sensors'], purposes: [], collectFrom: new Date('2026-10-01T00:00:00Z') } : opts.snapshot)) };
    const connections = { getAccessToken: jest.fn(async () => 'token-secreto'), handleRemoteRevocation: jest.fn(async () => 'closed') };
    const downloader = { download: jest.fn(async () => opts.download ?? { ok: true, buffer: buildSyntheticFit({ seconds: 30 }) }) };
    const ingestion = { ingest: jest.fn(async () => (opts.ingestWritten === false ? { written: false, reason: 'not_authorized' } : { written: true, activityLogId: 'log1', classification: null, removed: [] })) };
    return { service: new ZeppActivityEventService(consent as any, connections as any, downloader as any, ingestion as any), consent, connections, downloader, ingestion };
  }

  it('authorizationChange/delete encerra a conexao local e nao chama a Zepp de volta', async () => {
    const t = make();
    expect(await t.service.handle(view({ changeType: 'delete', eventTime: 1 }, { eventType: 'authorization_change' }))).toEqual({ status: 'done' });
    expect(t.connections.handleRemoteRevocation).toHaveBeenCalledWith('zepp', 'zx');
    expect(await t.service.handle(view({ changeType: 'authorize' }, { eventType: 'authorization_change' }))).toMatchObject({ status: 'discard' });
  });

  it('caminho feliz: baixa com o token do aluno, le, grava e conclui', async () => {
    const t = make();
    expect(await t.service.handle(view(payload()))).toEqual({ status: 'done' });
    expect(t.downloader.download).toHaveBeenCalledWith('token-secreto', CALLBACK);
    expect(t.connections.getAccessToken).toHaveBeenCalledWith('zepp', 'u1', 'activity');
    const [, meta, fit] = (t.ingestion.ingest.mock.calls as any[])[0];
    expect(meta).toMatchObject({ summaryId: '10010727180-file', source: 'webhook', activityType: 'OUTDOOR_RUN' });
    expect(fit.points.length).toBe(30);
  });

  it('descarta (nunca vira dado): atividade manual, conexao encerrada, sem categoria, URL invalida e usuario ausente', async () => {
    expect(await make().service.handle(view(payload({ manual: true })))).toMatchObject({ status: 'discard' });
    expect(await make({ snapshot: null }).service.handle(view(payload()))).toMatchObject({ status: 'discard', reason: 'conexao encerrada' });
    expect(await make({ snapshot: { categories: ['profile'], purposes: [], collectFrom: null } }).service.handle(view(payload()))).toMatchObject({ status: 'discard' });
    expect(await make().service.handle(view(payload({ callbackURL: 'https://evil.example.com/api/activity/file?id=1' })))).toMatchObject({ status: 'discard' });
    expect(await make().service.handle(view(payload(), { userId: null }))).toMatchObject({ status: 'discard' });
    const t = make();
    await t.service.handle(view(payload({ manual: true })));
    expect(t.downloader.download).not.toHaveBeenCalled();
  });

  it('atividade anterior ao periodo autorizado (antes da conexao / alem dos 30 dias) e descartada SEM baixar', async () => {
    const t = make({ snapshot: { categories: ['profile', 'activity'], purposes: [], collectFrom: new Date('2026-10-19T00:00:00Z') } });
    expect(await t.service.handle(view(payload()))).toMatchObject({ status: 'discard', reason: 'anterior ao periodo autorizado' });
    expect(t.downloader.download).not.toHaveBeenCalled();
    // sem horario no evento: confere pelo horario do proprio FIT, depois de baixar, antes de gravar
    const semHora = make({ snapshot: { categories: ['profile', 'activity'], purposes: [], collectFrom: new Date('2026-10-19T00:00:00Z') } });
    expect(await semHora.service.handle(view(payload({ startTimeInSeconds: null })))).toMatchObject({ status: 'discard', reason: 'anterior ao periodo autorizado' });
    expect(semHora.ingestion.ingest).not.toHaveBeenCalled();
  });

  it('falhas do download: link expirado/inexistente/recusado descarta; token/rede/5xx tentam de novo', async () => {
    for (const kind of ['expired', 'not_found', 'forbidden', 'bad_request', 'too_large']) {
      expect(await make({ download: { ok: false, kind, httpStatus: 410 } }).service.handle(view(payload()))).toMatchObject({ status: 'discard' });
    }
    for (const kind of ['auth', 'network', 'transient']) {
      expect(await make({ download: { ok: false, kind, httpStatus: 500 } }).service.handle(view(payload()))).toMatchObject({ status: 'retry' });
    }
  });

  it('FIT corrompido ou multiesporte descarta (nao adianta repetir); desconexao durante a gravacao descarta', async () => {
    expect(await make({ download: { ok: true, buffer: Buffer.from('nao e fit') } }).service.handle(view(payload()))).toMatchObject({ status: 'discard' });
    expect(await make({ download: { ok: true, buffer: buildSyntheticFit({ seconds: 10, sessions: 2 }) } }).service.handle(view(payload()))).toMatchObject({ status: 'discard' });
    expect(await make({ ingestWritten: false }).service.handle(view(payload()))).toMatchObject({ status: 'discard' });
  });

  it('sem token valido tenta de novo (nunca descarta por falha transitoria)', async () => {
    const t = make();
    t.connections.getAccessToken.mockRejectedValueOnce(new Error('A integracao nao esta conectada.'));
    expect(await t.service.handle(view(payload()))).toMatchObject({ status: 'retry' });
  });
});

describe('protecoes estruturais da importacao', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', 'src', file), 'utf8');

  it('o FIT original nunca vai para disco nem para o banco; o raw guarda so o resumo', () => {
    for (const file of ['zepp/zepp-fit.ts', 'zepp/zepp-fit-downloader.ts', 'zepp/zepp-activity-events.service.ts', 'zepp/zepp-activity-ingestion.service.ts']) {
      expect(read(file)).not.toMatch(/from 'node:fs'|from 'fs'|writeFile|createWriteStream|rawActivitySample/);
    }
    expect(read('zepp/zepp-activity-ingestion.service.ts')).toContain('fitStored: false');
  });

  it('o token do aluno so e enviado pelo downloader (host validado, sem redirecionamento) e o consentimento e relido dentro da trava de gravacao', () => {
    expect(read('zepp/zepp-fit-downloader.ts')).toContain("redirect: 'error'");
    expect(read('zepp/zepp-fit-downloader.ts')).toContain('isAllowedCallbackUrl');
    expect(read('zepp/zepp-activity-ingestion.service.ts')).toContain('writeWhileAuthorized');
    expect(read('zepp/zepp-activity-ingestion.service.ts')).not.toMatch(/providerConnection/);
  });
});
