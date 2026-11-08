import { Body, Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NotFoundException } from '@nestjs/common';
import { activityKeyOf, GARMIN_ACTIVITY_EVENT_TYPES, modalityFromGarmin, parseGarminActivityPush, toActivityDrafts } from '../src/garmin/garmin-activity';
import { GarminActivityIngestionService } from '../src/garmin/garmin-activity-ingestion.service';
import { GarminActivityEventService } from '../src/garmin/garmin-activity-events.service';
import { GarminController } from '../src/garmin/garmin.controller';
import { configureGarminWebhookBodyParser, isGarminWebhookJson } from '../src/garmin/garmin-webhook-body';
import { isRunModality } from '../src/activity-execution/canonical-modality';

// 08/11/2026 — Garmin, lote 2a: atividades por PUSH (Activity API 2.1, Starter). Formatos conferidos em "Activity_API 2.1.pdf" (pasta "Documentação Garmin").
const START = 1_700_000_000;

const summaryItem = (extra: Record<string, unknown> = {}) => ({
  userId: 'garmin-user-1', summaryId: '5001968355', activityId: 5001968355, activityType: 'RUNNING', startTimeInSeconds: START, startTimeOffsetInSeconds: -10800, durationInSeconds: 3600,
  distanceInMeters: 10000, averageHeartRateInBeatsPerMinute: 150, maxHeartRateInBeatsPerMinute: 172, averageRunCadenceInStepsPerMinute: 168, totalElevationGainInMeters: 40, activeKilocalories: 700, deviceName: 'Forerunner 265', ...extra,
});
const detailsItem = (extra: Record<string, unknown> = {}) => ({
  userId: 'garmin-user-1', summaryId: '5001968355-detail', activityId: 5001968355,
  summary: { ...summaryItem(), summaryId: undefined, userId: undefined },
  samples: [
    { startTimeInSeconds: START, latitudeInDegree: -19.9, longitudeInDegree: -43.9, elevationInMeters: 800, airTemperatureCelcius: 24, heartRate: 120, speedMetersPerSecond: 2.5, stepsPerMinute: 160, powerInWatts: 200, totalDistanceInMeters: 0 },
    { startTimeInSeconds: START + 1, latitudeInDegree: -19.9001, longitudeInDegree: -43.9001, elevationInMeters: 801, heartRate: 122, speedMetersPerSecond: 2.6, stepsPerMinute: 162, powerInWatts: 210, totalDistanceInMeters: 2.6 },
  ],
  laps: [{ startTimeInSeconds: START }],
  ...extra,
});

describe('leitura do push de atividades', () => {
  it('resumo: converte os campos e nao traz amostras', () => {
    const { records } = parseGarminActivityPush({ activities: [summaryItem()] });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'summary', userId: 'garmin-user-1', activityId: '5001968355', activityType: 'RUNNING', startedAtSec: START, startOffsetSec: -10800, durationSec: 3600, distanceMeters: 10000, avgHeartRateBpm: 150, maxHeartRateBpm: 172, avgRunCadenceSpm: 168, elevationGainMeters: 40, caloriesKcal: 700, deviceName: 'Forerunner 265', samples: null });
  });
  it('detalhes: amostras em offsets reais, velocidade em km/h, potencia media — e NENHUMA coordenada', () => {
    const { records } = parseGarminActivityPush({ activityDetails: [detailsItem()] });
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('details');
    expect(records[0].samples).toEqual([
      { offsetSec: 0, heartRateBpm: 120, speedKmh: 9, distanceMeters: 0, cadenceSpm: 160, powerWatts: 200, elevationMeters: 800 },
      { offsetSec: 1, heartRateBpm: 122, speedKmh: 2.6 * 3.6, distanceMeters: 2.6, cadenceSpm: 162, powerWatts: 210, elevationMeters: 801 },
    ]);
    expect(records[0].powerAvgWatts).toBe(205);
    // Regra da Politica 5D: GPS nunca e' guardado. Nada que lembre coordenada, temperatura ou volta sobrevive ao filtro.
    const everything = JSON.stringify(records) + JSON.stringify(toActivityDrafts(records));
    expect(everything).not.toMatch(/latitude|longitude|lat"|lon"|-19\.9|-43\.9|airTemperature|laps/i);
  });
  it('atividade manual e atividade-mae (multiesporte) sao ignoradas', () => {
    const result = parseGarminActivityPush({ activities: [summaryItem({ manual: true }), summaryItem({ summaryId: 'p', isParent: true }), summaryItem({ summaryId: 'ok2', activityId: 9 })], activityDetails: [detailsItem({ manual: true })] });
    expect(result.records.map((r) => r.summaryId)).toEqual(['ok2']);
    expect(result.ignored).toBe(3);
  });
  it('rejeita lixo sem quebrar: sem userId, duracao invalida, id com caracteres estranhos, corpo nao objeto', () => {
    expect(parseGarminActivityPush(null).records).toEqual([]);
    expect(parseGarminActivityPush('x').records).toEqual([]);
    const bad = parseGarminActivityPush({ activities: [summaryItem({ userId: undefined }), summaryItem({ durationInSeconds: 0 }), summaryItem({ summaryId: 'a b!' }), null, 7, summaryItem({ startTimeInSeconds: -5 })] });
    expect(bad.records).toEqual([]);
    expect(bad.ignored).toBe(6);
  });
  it('valores absurdos viram nulos (FC fora de 30–250, velocidade negativa)', () => {
    const { records } = parseGarminActivityPush({ activityDetails: [detailsItem({ samples: [{ startTimeInSeconds: START, heartRate: 400, speedMetersPerSecond: -3 }, { startTimeInSeconds: START - 100, heartRate: 150 }] })] });
    expect(records[0].samples).toEqual([{ offsetSec: 0, heartRateBpm: null, speedKmh: null, distanceMeters: null, cadenceSpm: null, powerWatts: null, elevationMeters: null }]);
  });
  it('a chave da atividade e o activityId (igual no resumo e nos detalhes)', () => {
    const s = parseGarminActivityPush({ activities: [summaryItem()] }).records[0];
    const d = parseGarminActivityPush({ activityDetails: [detailsItem()] }).records[0];
    expect(activityKeyOf(s)).toBe('5001968355');
    expect(activityKeyOf(d)).toBe('5001968355');
    expect(activityKeyOf({ activityId: '', summaryId: '777-detail' })).toBe('777');
  });
});

describe('modalidade (esteira = corrida)', () => {
  it('todo tipo de corrida da Garmin vira "corrida", inclusive esteira e virtual', () => {
    for (const type of ['RUNNING', 'INDOOR_RUNNING', 'TREADMILL_RUNNING', 'TRAIL_RUNNING', 'TRACK_RUNNING', 'STREET_RUNNING', 'ULTRA_RUN', 'VIRTUAL_RUN', 'OBSTACLE_RUN']) {
      expect(modalityFromGarmin(type)).toBe('corrida');
      expect(isRunModality(modalityFromGarmin(type))).toBe(true);
    }
  });
  it('as demais modalidades e o desconhecido (nunca vira corrida por palpite)', () => {
    expect(modalityFromGarmin('WALKING')).toBe('caminhada');
    expect(modalityFromGarmin('ROAD_BIKING')).toBe('bike');
    expect(modalityFromGarmin('LAP_SWIMMING')).toBe('natacao');
    expect(modalityFromGarmin('STRENGTH_TRAINING')).toBe('forca');
    expect(modalityFromGarmin('YOGA')).toBe('outra');
    expect(modalityFromGarmin(null)).toBe('outra');
  });
});

describe('rascunhos para a fila', () => {
  it('categoria activity, conta Garmin, tipo de evento valido e chave idempotente', () => {
    const { records } = parseGarminActivityPush({ activities: [summaryItem()], activityDetails: [detailsItem()] });
    const drafts = toActivityDrafts(records);
    expect(drafts.map((d) => d.eventType)).toEqual(['activity_summary', 'activity_details']);
    expect(drafts.every((d) => d.category === 'activity' && d.externalAccountId === 'garmin-user-1')).toBe(true);
    expect(drafts.every((d) => (GARMIN_ACTIVITY_EVENT_TYPES as readonly string[]).includes(d.eventType))).toBe(true);
    const again = toActivityDrafts(parseGarminActivityPush({ activities: [summaryItem()] }).records);
    expect(again[0].dedupeKey).toBe(drafts[0].dedupeKey); // reenvio igual = mesma chave
    const updated = toActivityDrafts(parseGarminActivityPush({ activities: [summaryItem({ distanceInMeters: 10500 })] }).records);
    expect(updated[0].dedupeKey).not.toBe(drafts[0].dedupeKey); // atualizacao real = chave nova
    expect(drafts[0].dedupeKey.length).toBeLessThanOrEqual(200);
  });
});

describe('gravacao no pipeline (GarminActivityIngestionService)', () => {
  function build(categories: string[], opts: { excluded?: boolean; authorized?: boolean } = {}) {
    const captured: { points?: any[]; log?: any; raw?: any; deletedSeries?: number } = {};
    const tx: any = {
      rawExternalActivity: { upsert: jest.fn(async (args: any) => { captured.raw = args.create; return { id: 'raw1' }; }) },
      activityLog: { upsert: jest.fn(async (args: any) => { captured.log = args.create; return { id: 'log1' }; }) },
      activityTimeSeriesPoint: { deleteMany: jest.fn(async () => { captured.deletedSeries = (captured.deletedSeries ?? 0) + 1; }), createMany: jest.fn(async (args: any) => { captured.points = args.data; }) },
    };
    const consent: any = { writeWhileAuthorized: jest.fn(async (_p: string, _u: string, fn: any) => (opts.authorized === false ? null : fn(tx, { categories }))) };
    const prisma: any = { activityExclusion: { findFirst: jest.fn(async () => (opts.excluded ? { id: 'x' } : null)) }, activityLog: { findFirst: jest.fn(async () => (opts.excluded ? { id: 'x', excludedAt: new Date() } : null)), findUnique: jest.fn(async () => null) }, rawExternalActivity: { findFirst: jest.fn(async () => null) } };
    const link: any = { classify: jest.fn(async () => 'matched'), reconcileAffectedByIdentity: jest.fn(async () => undefined) };
    const notify: any = { notifyReconciliation: jest.fn(async () => undefined) };
    const identity: any = { evaluateSafely: jest.fn(async () => null) };
    return { service: new GarminActivityIngestionService(prisma, consent, link, notify, identity), captured, link, notify, consent };
  }
  const details = () => parseGarminActivityPush({ activityDetails: [detailsItem()] }).records[0];
  const summary = () => parseGarminActivityPush({ activities: [summaryItem()] }).records[0];

  it('com atividade + sensores: grava resumo e serie completa, sem coordenadas, e roda o pipeline', async () => {
    const { service, captured, link, notify } = build(['activity', 'activity_sensors']);
    const result = await service.ingest('u1', details());
    expect(result).toMatchObject({ written: true, activityLogId: 'log1', classification: 'matched', removed: [] });
    expect(captured.log).toMatchObject({ provider: 'garmin', externalId: '5001968355', sport: 'corrida', durationSec: 3600, distanceMeters: 10000, avgHeartRateBpm: 150, maxHeartRateBpm: 172, hasRoute: false, utcOffsetMinutes: -180, caloriesKcal: 700, powerAvgWatts: 205 });
    expect(captured.points).toHaveLength(2);
    expect(captured.points![0]).toMatchObject({ heartRateBpm: 120, speedKmh: 9, cadenceSpm: 160, powerWatts: 200, elevationMeters: 800, latitude: null, longitude: null });
    expect(JSON.stringify(captured.raw)).not.toMatch(/latitude|longitude/);
    expect(link.classify).toHaveBeenCalledWith('log1');
    expect(notify.notifyReconciliation).toHaveBeenCalled();
  });
  it('sem a categoria de sensores: FC, cadencia, potencia e elevacao NAO sao guardadas (nem no resumo)', async () => {
    const { service, captured } = build(['activity']);
    const result = await service.ingest('u1', details());
    expect(result).toMatchObject({ written: true, removed: ['sensors'] });
    expect(captured.log).toMatchObject({ avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null });
    expect(captured.points![0]).toMatchObject({ heartRateBpm: null, cadenceSpm: null, powerWatts: null, elevationMeters: null, speedKmh: 9 });
  });
  it('sem a categoria de atividade, nada e guardado', async () => {
    const { service, captured } = build(['activity_sensors']);
    expect(await service.ingest('u1', details())).toEqual({ written: false, reason: 'not_authorized' });
    expect(captured.log).toBeUndefined();
  });
  it('o resumo (sem amostras) NAO apaga a serie que os detalhes ja gravaram', async () => {
    const { service, captured } = build(['activity', 'activity_sensors']);
    await service.ingest('u1', summary());
    expect(captured.deletedSeries).toBeUndefined();
    expect(captured.points).toBeUndefined();
    expect(captured.log).toMatchObject({ externalId: '5001968355' });
  });
  it('os detalhes refazem a serie (idempotente)', async () => {
    const { service, captured } = build(['activity', 'activity_sensors']);
    await service.ingest('u1', details());
    expect(captured.deletedSeries).toBe(1);
  });
  it('conexao encerrada no meio do processamento: nao grava', async () => {
    const { service } = build(['activity'], { authorized: false });
    expect(await service.ingest('u1', details())).toEqual({ written: false, reason: 'not_authorized' });
  });
});

describe('processador de eventos (GarminActivityEventService)', () => {
  function build(snapshot: any, ingestResult: any = { written: true }) {
    const consent: any = { snapshot: jest.fn(async () => snapshot) };
    const ingestion: any = { ingest: jest.fn(async () => ingestResult) };
    return { service: new GarminActivityEventService(consent, ingestion), ingestion };
  }
  const event = (extra: Record<string, unknown> = {}) => ({ id: 'e1', provider: 'garmin', eventType: 'activity_summary', userId: 'u1', externalAccountId: 'garmin-user-1', attempt: 1, payload: parseGarminActivityPush({ activities: [summaryItem()] }).records[0], ...extra }) as any;

  it('grava quando ha conexao e categoria autorizada', async () => {
    const { service, ingestion } = build({ categories: ['activity'], collectFrom: null });
    expect(await service.handle(event())).toEqual({ status: 'done' });
    expect(ingestion.ingest).toHaveBeenCalledWith('u1', expect.objectContaining({ summaryId: '5001968355' }));
  });
  it('descarta: tipo desconhecido, sem conta, payload invalido, conexao encerrada, categoria nao autorizada', async () => {
    const { service, ingestion } = build({ categories: ['activity'], collectFrom: null });
    expect((await service.handle(event({ eventType: 'outra' }))).status).toBe('discard');
    expect((await service.handle(event({ userId: null }))).status).toBe('discard');
    expect((await service.handle(event({ payload: { x: 1 } }))).status).toBe('discard');
    expect((await build(null).service.handle(event())).status).toBe('discard');
    expect((await build({ categories: ['sleep'], collectFrom: null }).service.handle(event())).status).toBe('discard');
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });
  it('descarta atividade anterior ao periodo autorizado e atividade no futuro', async () => {
    const before = build({ categories: ['activity'], collectFrom: new Date((START + 10) * 1000) });
    expect((await before.service.handle(event())).status).toBe('discard');
    const future = event({ payload: { ...parseGarminActivityPush({ activities: [summaryItem()] }).records[0], startedAtSec: Math.floor(Date.now() / 1000) + 5 * 86400 } });
    expect((await build({ categories: ['activity'], collectFrom: null }).service.handle(future)).status).toBe('discard');
  });
  it('atividade excluida pela aluna/treinador nao volta', async () => {
    const { service } = build({ categories: ['activity'], collectFrom: null }, { written: false, reason: 'excluded' });
    expect(await service.handle(event())).toMatchObject({ status: 'discard' });
  });
});

describe('endereco do push de atividades', () => {
  const KEY = 'k'.repeat(40);
  function build() {
    const events: any = { record: jest.fn(async () => ({ created: true, id: 'x' })) };
    const consent: any = { resolveActiveUserId: jest.fn(async (_p: string, id: string) => (id === 'garmin-user-1' ? 'u1' : null)) };
    const ctrl = new GarminController({} as any, { get: (n: string) => (n === 'GARMIN_WEBHOOK_KEY' ? KEY : undefined) } as any, consent, events);
    return { ctrl, events, consent };
  }
  it('chave errada ou ausente = 404 e nada na fila', async () => {
    const { ctrl, events } = build();
    await expect(ctrl.activities('errada', { activities: [summaryItem()] })).rejects.toBeInstanceOf(NotFoundException);
    expect(events.record).not.toHaveBeenCalled();
  });
  it('enfileira so atividades de contas com conexao ativa, ja filtradas (sem GPS)', async () => {
    const { ctrl, events } = build();
    const result = await ctrl.activities(KEY, { activities: [summaryItem(), summaryItem({ userId: 'desconhecida', summaryId: 'z' })], activityDetails: [detailsItem()] });
    expect(result).toEqual({ ok: true, queued: 2, ignored: 0 });
    expect(events.record).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events.record.mock.calls)).not.toMatch(/latitude|longitude/);
    expect(events.record.mock.calls[0][0]).toBe('garmin');
    expect(events.record.mock.calls[0][2]).toBe('u1');
  });
  it('reenvio (duplicado) nao conta como novo; corpo vazio nao quebra', async () => {
    const { ctrl, events } = build();
    events.record.mockResolvedValue({ created: false, id: null });
    expect(await ctrl.activities(KEY, { activities: [summaryItem()] })).toEqual({ ok: true, queued: 0, ignored: 0 });
    expect(await ctrl.activities(KEY, {} as any)).toEqual({ ok: true, queued: 0, ignored: 0 });
  });
});

describe('limite do corpo: avisos grandes da Garmin passam SO nas rotas /garmin/webhook/', () => {
  @Controller()
  class EchoController {
    @Post('garmin/webhook/:key/activities') garmin(@Body() body: { blob?: string }) { return { size: (body?.blob ?? '').length }; }
    @Post('outra/rota') other(@Body() body: { blob?: string }) { return { size: (body?.blob ?? '').length }; }
  }
  @Module({ controllers: [EchoController] })
  class EchoModule {}

  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(EchoModule, { rawBody: true, logger: false });
    configureGarminWebhookBodyParser(app);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await app.close(); });

  const post = (path: string, blobChars: number) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blob: 'x'.repeat(blobChars) }) });

  it('um aviso de 600 KB na rota da Garmin e aceito (antes: 413)', async () => {
    const response = await post('/garmin/webhook/chave/activities', 600_000);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { size: number }).size).toBe(600_000);
  });
  it('as outras rotas continuam com o limite padrao (413 acima de 100 KB)', async () => {
    expect((await post('/outra/rota', 600_000)).status).toBe(413);
    const small = await post('/outra/rota', 1_000);
    expect(small.status).toBe(201);
    expect(((await small.json()) as { size: number }).size).toBe(1_000); // o JSON das demais rotas continua sendo LIDO (o defeito corrigido deixava o corpo vazio)
  });
  it('o reconhecimento da rota exige o prefixo e JSON', () => {
    expect(isGarminWebhookJson({ url: '/garmin/webhook/k/activities', headers: { 'content-type': 'application/json' } })).toBe(true);
    expect(isGarminWebhookJson({ url: '/garmin/connect', headers: { 'content-type': 'application/json' } })).toBe(false);
    expect(isGarminWebhookJson({ url: '/garmin/webhook/k/activities', headers: { 'content-type': 'text/plain' } })).toBe(false);
  });
});
