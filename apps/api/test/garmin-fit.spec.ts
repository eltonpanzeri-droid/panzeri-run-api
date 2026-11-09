import { GarminFitService } from '../src/garmin/garmin-fit.service';
import { GarminActivityEventService } from '../src/garmin/garmin-activity-events.service';
import { GarminActivityIngestionService } from '../src/garmin/garmin-activity-ingestion.service';
import { isGarminCallbackUrl, parseGarminActivityFiles, summarizeFitExtras, toFileDrafts } from '../src/garmin/garmin-fit';
import { parseGarminActivityPush } from '../src/garmin/garmin-activity';

// 09/11/2026 — Garmin: arquivo FIT (Activity Files: aviso + download unico) e percurso/temperatura por autorizacao.
const URL_OK = 'https://apis.garmin.com/wellness-api/rest/activityFile?id=XXX&token=YYY';
const notice = (extra: Record<string, unknown> = {}) => ({ userId: 'garmin-user-1', summaryId: '10010727180-file', fileType: 'FIT', callbackURL: URL_OK, activityType: 'RUNNING', deviceName: 'Garmin Fenix 8', startTimeInSeconds: 1_700_000_000, activityId: 5001904988, manual: false, ...extra });

describe('aviso de arquivo (parser)', () => {
  it('aceita so FIT, com activityId, de atividade medida e com endereco oficial', () => {
    const { notices, ignored } = parseGarminActivityFiles({ activityFiles: [notice(), notice({ summaryId: 'b-file', fileType: 'GPX' }), notice({ summaryId: 'c-file', manual: true }), notice({ summaryId: 'd-file', callbackURL: 'https://evil.example.com/x?token=1' }), notice({ summaryId: 'e-file', activityId: undefined }), null] });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: 'garmin-user-1', activityId: '5001904988', fileType: 'FIT', callbackURL: URL_OK, startedAtSec: 1_700_000_000 });
    expect(ignored).toBe(5);
    expect(parseGarminActivityFiles(null)).toEqual({ notices: [], ignored: 0 });
  });
  it('o endereco precisa ser https no host da Garmin, sem credenciais nem porta (SSRF)', () => {
    expect(isGarminCallbackUrl(URL_OK)).toBe(true);
    for (const bad of ['http://apis.garmin.com/x', 'https://apis.garmin.com.evil.com/x', 'https://user:pw@apis.garmin.com/x', 'https://apis.garmin.com:8443/x', 'ftp://apis.garmin.com/x', 'apis.garmin.com/x', '', null, 7]) expect(isGarminCallbackUrl(bad)).toBe(false);
  });
  it('rascunho: categoria activity, tipo activity_file, chave por summaryId', () => {
    const drafts = toFileDrafts(parseGarminActivityFiles({ activityFiles: [notice()] }).notices);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ category: 'activity', eventType: 'activity_file', dedupeKey: 'file:10010727180-file', externalAccountId: 'garmin-user-1' });
  });
});

describe('resumo do FIT (puro)', () => {
  const START = Date.parse('2026-11-09T10:00:00Z');
  const records = [
    { stance_time: 240, vertical_oscillation: 80, step_length: 1100, vertical_ratio: 7.2 },
    { stance_time: 260, vertical_oscillation: 90, step_length: 1200, vertical_ratio: 7.6 },
    { stance_time: 5000, vertical_oscillation: 9999, step_length: 99999, vertical_ratio: 99 }, // fora dos limites fisicos
    { heart_rate: 150 }, // sem dinamica
  ];
  const laps = [
    { start_time: new Date(START), total_timer_time: 300, total_distance: 1000, avg_heart_rate: 150, max_heart_rate: 165, avg_power: 210, enhanced_avg_speed: 3.3, total_ascent: 4 },
    { start_time: new Date(START + 300_000), total_timer_time: 310, total_distance: 1000, avg_heart_rate: 400 },
  ];
  it('medias da dinamica ignoram valor impossivel; voltas com metricas e deslocamento', () => {
    const out = summarizeFitExtras(records, laps, START);
    expect(out.dynamics).toEqual({ samples: 2, groundContactTimeMsAvg: 250, verticalOscillationMmAvg: 85, strideLengthMmAvg: 1150, verticalRatioPctAvg: 7.4 });
    expect(out.laps).toHaveLength(2);
    expect(out.laps[0]).toEqual({ index: 0, startOffsetSec: 0, durationSec: 300, distanceMeters: 1000, avgHeartRateBpm: 150, maxHeartRateBpm: 165, avgPowerWatts: 210, avgSpeedKmh: 11.88, ascentMeters: 4 });
    expect(out.laps[1]).toMatchObject({ index: 1, startOffsetSec: 300, avgHeartRateBpm: null, avgPowerWatts: null, avgSpeedKmh: null });
  });
  it('sem dinamica no arquivo: dynamics null (nunca zero)', () => {
    expect(summarizeFitExtras([{ heart_rate: 150 }], [], START)).toEqual({ laps: [], dynamics: null });
  });
});

describe('GarminFitService (download unico)', () => {
  const NOTICE = parseGarminActivityFiles({ activityFiles: [notice()] }).notices[0];
  function build(opts: { categories?: string[] | null; log?: boolean; download?: { status: number; body: Buffer | null } | Error; existing?: unknown } = {}) {
    const updates: any[] = [];
    const tx: any = { activityLog: { findUnique: jest.fn(async () => ({ providerMetrics: opts.existing ?? null })), update: jest.fn(async (args: any) => { updates.push(args); return {}; }) } };
    const consent: any = {
      snapshot: jest.fn(async () => (opts.categories === null ? null : { categories: opts.categories ?? ['activity', 'activity_sensors'], purposes: [], collectFrom: null })),
      writeWhileAuthorized: jest.fn(async (_p: string, _u: string, fn: any) => fn(tx, { categories: opts.categories ?? ['activity', 'activity_sensors'], purposes: [] })),
    };
    const prisma: any = { activityLog: { findUnique: jest.fn(async () => (opts.log === false ? null : { id: 'log1' })) } };
    class Test extends GarminFitService {
      public downloads = 0;
      protected async download() { this.downloads += 1; if (opts.download instanceof Error) throw opts.download; return opts.download ?? { status: 200, body: Buffer.from('fit') }; }
    }
    const service = new Test(prisma, consent) as Test;
    return { service, updates, consent, prisma };
  }
  it('sem conexao ou sem as autorizacoes de atividade e sensores: descarta SEM baixar', async () => {
    for (const categories of [null, ['activity'], ['activity_sensors']] as Array<string[] | null>) {
      const { service } = build({ categories });
      expect((await service.handle('u1', NOTICE)).status).toBe('discard');
      expect((service as any).downloads).toBe(0);
    }
  });
  it('atividade ainda nao chegou: tenta de novo SEM gastar o download unico', async () => {
    const { service } = build({ log: false });
    expect(await service.handle('u1', NOTICE)).toMatchObject({ status: 'retry' });
    expect((service as any).downloads).toBe(0);
  });
  it('410 (ja baixado) descarta; 5xx e falha de rede tentam de novo; 4xx descarta', async () => {
    expect(await build({ download: { status: 410, body: null } }).service.handle('u1', NOTICE)).toMatchObject({ status: 'discard' });
    expect(await build({ download: { status: 503, body: null } }).service.handle('u1', NOTICE)).toMatchObject({ status: 'retry' });
    expect(await build({ download: { status: 429, body: null } }).service.handle('u1', NOTICE)).toMatchObject({ status: 'retry' });
    expect(await build({ download: { status: 404, body: null } }).service.handle('u1', NOTICE)).toMatchObject({ status: 'discard' });
    expect(await build({ download: new Error('rede') }).service.handle('u1', NOTICE)).toMatchObject({ status: 'retry' });
  });
  it('arquivo ilegivel (download ja gasto): descarta e nao grava', async () => {
    const { service, updates } = build();
    expect(await service.handle('u1', NOTICE)).toMatchObject({ status: 'discard' });
    expect(updates).toHaveLength(0);
  });
  it('aviso invalido (endereco fora da Garmin) nunca baixa', async () => {
    const { service } = build();
    expect(await service.handle('u1', { ...NOTICE, callbackURL: 'https://evil.example.com/x' })).toMatchObject({ status: 'discard' });
    expect((service as any).downloads).toBe(0);
  });
});

describe('processador de eventos: aviso de arquivo', () => {
  it('encaminha activity_file ao servico do FIT; sem servico ou sem conta, descarta', async () => {
    const fit: any = { handle: jest.fn(async () => ({ status: 'done' })) };
    const service = new GarminActivityEventService({} as any, {} as any, undefined, fit);
    const event = (extra: Record<string, unknown> = {}) => ({ id: 'e', provider: 'garmin', eventType: 'activity_file', userId: 'u1', externalAccountId: 'g', attempt: 1, payload: { activityId: '1' }, ...extra }) as any;
    expect(await service.handle(event())).toEqual({ status: 'done' });
    expect(fit.handle).toHaveBeenCalledWith('u1', { activityId: '1' });
    expect((await service.handle(event({ userId: null }))).status).toBe('discard');
    expect((await new GarminActivityEventService({} as any, {} as any).handle(event())).status).toBe('discard');
  });
});

describe('gravacao: percurso e temperatura so com a autorizacao', () => {
  const START = 1_700_000_000;
  const record = () => parseGarminActivityPush({ activityDetails: [{ userId: 'garmin-user-1', summaryId: '1-detail', activityId: 1, summary: { activityType: 'RUNNING', startTimeInSeconds: START, durationInSeconds: 60, distanceInMeters: 100 }, samples: [{ startTimeInSeconds: START, latitudeInDegree: -19.9, longitudeInDegree: -43.9, airTemperatureCelcius: 24, heartRate: 120, totalDistanceInMeters: 0 }] }] }).records[0];
  function build(categories: string[]) {
    const captured: any = {};
    const tx: any = {
      rawExternalActivity: { upsert: jest.fn(async (a: any) => { captured.raw = a.create; return { id: 'raw1' }; }) },
      activityLog: { upsert: jest.fn(async (a: any) => { captured.log = a.create; return { id: 'log1' }; }), findUnique: jest.fn(async () => null) },
      activityTimeSeriesPoint: { deleteMany: jest.fn(async () => undefined), createMany: jest.fn(async (a: any) => { captured.points = a.data; }) },
    };
    const consent: any = { writeWhileAuthorized: jest.fn(async (_p: string, _u: string, fn: any) => fn(tx, { categories })) };
    const prisma: any = { activityExclusion: { findFirst: jest.fn(async () => null) }, activityLog: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) }, rawExternalActivity: { findFirst: jest.fn(async () => null) } };
    const service = new GarminActivityIngestionService(prisma, consent, { classify: jest.fn(async () => null), reconcileAffectedByIdentity: jest.fn(async () => undefined) } as any, { notifyReconciliation: jest.fn(async () => undefined) } as any, { evaluateSafely: jest.fn(async () => null) } as any);
    return { service, captured };
  }
  it('com percurso e sensores: grava coordenadas e temperatura e marca hasRoute', async () => {
    const { service, captured } = build(['activity', 'activity_sensors', 'activity_route']);
    await service.ingest('u1', record());
    expect(captured.points[0]).toMatchObject({ latitude: -19.9, longitude: -43.9, temperatureCelsius: 24 });
    expect(captured.log.hasRoute).toBe(true);
    expect(JSON.stringify(captured.raw)).not.toMatch(/-19\.9|-43\.9/); // o payload bruto nunca leva coordenadas
  });
  it('sem percurso: nenhuma coordenada, hasRoute false; sem sensores: nenhuma temperatura', async () => {
    const { service, captured } = build(['activity']);
    await service.ingest('u1', record());
    expect(captured.points[0]).toMatchObject({ latitude: null, longitude: null, temperatureCelsius: null });
    expect(captured.log.hasRoute).toBe(false);
  });
});
