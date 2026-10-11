import { HcRawDistance, HcRawHeartRate, HcRawSession, ImportResponse, MIN_AUTO_SYNC_INTERVAL_MS, ExercisePayload, userIdFromAccessToken, STATUS_LABEL, formatLastSync } from '../../mobile/src/healthConnect/contract';
import { createHealthConnectSync, HealthConnectGateway, SyncStore } from '../../mobile/src/healthConnect/sync';

// O orquestrador do app e' codigo puro com dependencias injetadas: aqui roda com um Health Connect FALSO. Isto NAO substitui a validacao em aparelho
// real (permissoes do Android, Polar Flow, Samsung Health) — ela esta listada como pendente no contrato.

const T0 = new Date('2026-10-10T12:00:00.000Z');
const session = (id: string, over: Partial<HcRawSession> = {}): HcRawSession => ({
  metadata: { id, dataOrigin: 'fi.polar.polarflow', lastModifiedTime: '2026-10-09T10:30:00.000Z', recordingMethod: 1, device: { manufacturer: 'Polar', model: 'V3', type: 1 } },
  exerciseType: 56, startTime: '2026-10-09T09:00:00.000Z', endTime: '2026-10-09T09:55:00.000Z', startZoneOffset: { totalSeconds: -10800 }, ...over,
});
const distance = (m: number, start = '2026-10-09T09:00:00.000Z', end = '2026-10-09T09:55:00.000Z'): HcRawDistance => ({ startTime: start, endTime: end, distance: { inMeters: m } });
const hr = (...bpm: number[]): HcRawHeartRate => ({ startTime: '2026-10-09T09:00:00.000Z', endTime: '2026-10-09T09:55:00.000Z', samples: bpm.map((b, i) => ({ time: `2026-10-09T09:0${i}:00.000Z`, beatsPerMinute: b })) });

function memoryStore(): SyncStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async (k) => { data.delete(k); } };
}

function fakeHc(over: Partial<{ sdk: 'available' | 'update_required' | 'unavailable'; granted: string[]; sessions: HcRawSession[]; distances: HcRawDistance[]; heart: HcRawHeartRate[] }> = {}) {
  const state = { sdk: 'available' as const, granted: ['ExerciseSession', 'Distance', 'HeartRate'], sessions: [] as HcRawSession[], distances: [] as HcRawDistance[], heart: [] as HcRawHeartRate[], ...over } as any;
  const calls = { readSessions: 0, requested: 0, revoked: 0 };
  const gateway: HealthConnectGateway = {
    getSdkStatus: async () => state.sdk,
    initialize: async () => true,
    getGrantedRecordTypes: async () => state.granted,
    requestPermissions: async () => { calls.requested += 1; return state.requestResult ?? state.granted; },
    revokeAllPermissions: async () => { calls.revoked += 1; if (state.revokeFails) throw new Error('x'); },
    readSessions: async () => { calls.readSessions += 1; if (state.readError) throw state.readError; return state.sessions; },
    readDistance: async () => state.distances,
    readHeartRate: async () => state.heart,
  };
  return { state, calls, gateway };
}

function setup(hcOver: Parameters<typeof fakeHc>[0] = {}, opts: { post?: (items: ExercisePayload[]) => Promise<ImportResponse>; userId?: string; now?: () => Date } = {}) {
  const hc = fakeHc(hcOver);
  const store = memoryStore();
  const posted: ExercisePayload[][] = [];
  const post = opts.post ?? (async (items: ExercisePayload[]) => { posted.push(items); return { created: items.length, updated: 0, alreadyImported: 0, rejected: 0 }; });
  const sync = createHealthConnectSync({ hc: hc.gateway, store, userId: opts.userId ?? 'u-1', now: opts.now ?? (() => T0), postExercises: async (items) => { const r = await post(items); if (opts.post) posted.push(items); return r; } });
  return { hc, store, sync, posted };
}
const connected = async (s: ReturnType<typeof setup>) => { expect((await s.sync.connect()).status).toBe('connected'); return s; };

describe('Health Connect (cliente): disponibilidade e permissoes', () => {
  it('indisponivel (sem SDK / precisa atualizar): estado "unavailable", nada e pedido nem lido', async () => {
    for (const sdk of ['unavailable', 'update_required'] as const) {
      const s = setup({ sdk });
      expect((await s.sync.view()).status).toBe('unavailable');
      expect((await s.sync.connect()).status).toBe('unavailable');
      expect((await s.sync.syncNow()).status).toBe('unavailable');
      expect(s.hc.calls.readSessions).toBe(0);
    }
  });

  it('permissao concedida: conecta e a tela mostra "connected"', async () => {
    const s = await connected(setup());
    expect(await s.sync.view()).toMatchObject({ status: 'connected', missingOptional: [] });
  });

  it('permissao NEGADA (sem sessoes de exercicio): nao conecta, estado "insufficient_permissions"', async () => {
    const s = setup({ granted: [] });
    s.hc.state.requestResult = [];
    expect((await s.sync.connect()).status).toBe('insufficient_permissions');
    expect((await s.sync.view()).status).toBe('not_connected');
  });

  it('permissao REVOGADA depois de conectar: sync para sem ler e sem erro; view = insufficient_permissions', async () => {
    const s = await connected(setup({ sessions: [session('a')] }));
    s.hc.state.granted = [];
    expect((await s.sync.view()).status).toBe('insufficient_permissions');
    const result = await s.sync.syncNow();
    expect(result.status).toBe('insufficient_permissions');
    expect(s.hc.calls.readSessions).toBe(0);
    expect(s.posted).toHaveLength(0);
  });

  it('SecurityException durante a leitura (revogada no meio): vira permissoes insuficientes, nao "erro"', async () => {
    const s = await connected(setup({ sessions: [session('a')] }));
    s.hc.state.readError = new Error('java.lang.SecurityException: Caller does not have permission');
    expect((await s.sync.syncNow()).status).toBe('insufficient_permissions');
  });

  it('FC/distancia nao autorizadas: segue sem esses dados e avisa (missingOptional)', async () => {
    const s = await connected(setup({ granted: ['ExerciseSession'], sessions: [session('a')], distances: [distance(10000)], heart: [hr(150)] }));
    s.hc.state.requestResult = ['ExerciseSession'];
    const result = await s.sync.syncNow();
    expect(result).toMatchObject({ status: 'done', sent: 1, missingOptional: ['Distance', 'HeartRate'] });
    expect(s.posted[0][0]).toMatchObject({ distanceMeters: null, avgHeartRateBpm: null });
  });

  it('desconectar para novas leituras e NAO apaga nada; falha ao revogar no Android nao reativa a leitura', async () => {
    const s = await connected(setup({ sessions: [session('a')] }));
    await s.sync.syncNow();
    s.hc.state.revokeFails = true;
    expect(await s.sync.disconnect()).toEqual({ revoked: false });
    expect((await s.sync.syncNow()).status).toBe('not_connected');
    expect((await s.sync.autoSyncOnOpen()).status).toBe('skipped');
    expect(s.posted).toHaveLength(1);
  });
});

describe('Health Connect (cliente): leitura e payload', () => {
  it('corrida com distancia e FC da MESMA origem: soma so dentro da sessao; FC media/maxima das amostras', async () => {
    const s = await connected(setup({ sessions: [session('a')], distances: [distance(6000), distance(4000), distance(50000, '2026-10-09T00:00:00.000Z', '2026-10-09T23:59:00.000Z')], heart: [hr(140, 150, 160)] }));
    const result = await s.sync.syncNow();
    expect(result).toMatchObject({ status: 'done', sent: 1, created: 1 });
    expect(s.posted[0][0]).toMatchObject({ recordId: 'a', dataOrigin: 'fi.polar.polarflow', distanceMeters: 10000, avgHeartRateBpm: 150, maxHeartRateBpm: 160, heartRateSampleCount: 3, startZoneOffsetSeconds: -10800, recordingMethod: 1, device: { manufacturer: 'Polar', model: 'V3', type: 1 } });
  });

  it('sem distancia / sem FC: null (nunca zero inventado)', async () => {
    const s = await connected(setup({ sessions: [session('a')] }));
    await s.sync.syncNow();
    expect(s.posted[0][0]).toMatchObject({ distanceMeters: null, avgHeartRateBpm: null, maxHeartRateBpm: null, heartRateSampleCount: null });
  });

  it('forca/outra modalidade: enviada com o tipo bruto, sem distancia', async () => {
    const s = await connected(setup({ sessions: [session('f', { exerciseType: 70 })] }));
    await s.sync.syncNow();
    expect(s.posted[0][0]).toMatchObject({ exerciseType: 70, distanceMeters: null });
  });

  it('origem/dispositivo ausentes viajam como null (nao presume marca)', async () => {
    const s = await connected(setup({ sessions: [session('a', { metadata: { id: 'a' } })] }));
    await s.sync.syncNow();
    expect(s.posted[0][0]).toMatchObject({ dataOrigin: null, device: null, recordingMethod: null, lastModifiedTime: null });
  });

  it('sessao sem id de registro nao e enviavel', async () => {
    const s = await connected(setup({ sessions: [session('a', { metadata: {} })] }));
    expect(await s.sync.syncNow()).toMatchObject({ status: 'done', sent: 0 });
  });

  it('mais de 50 sessoes: lotes de ate 50', async () => {
    const many = Array.from({ length: 120 }, (_, i) => session(`r${i}`));
    const s = await connected(setup({ sessions: many }));
    await s.sync.syncNow();
    expect(s.posted.map((b) => b.length)).toEqual([50, 50, 20]);
  });
});

describe('Health Connect (cliente): sincronizacao incremental, idempotente e resistente', () => {
  it('segunda sincronizacao envia so o novo/modificado (cursor com sobreposicao); a primeira envia o historico recente', async () => {
    let now = T0;
    const s = await connected(setup({ sessions: [session('a')] }, { now: () => now }));
    await s.sync.syncNow();
    expect(s.posted[0].map((p) => p.recordId)).toEqual(['a']);
    now = new Date(T0.getTime() + 3 * 3600_000);
    s.hc.state.sessions = [session('a'), session('b', { metadata: { id: 'b', lastModifiedTime: '2026-10-10T13:00:00.000Z', dataOrigin: 'com.sec.android.app.shealth' } })];
    await s.sync.syncNow();
    expect(s.posted[1].map((p) => p.recordId)).toEqual(['b']);
  });

  it('registro antigo EDITADO na origem depois e reenviado', async () => {
    let now = T0;
    const s = await connected(setup({ sessions: [session('a')] }, { now: () => now }));
    await s.sync.syncNow();
    now = new Date(T0.getTime() + 3600_000);
    s.hc.state.sessions = [session('a', { metadata: { id: 'a', dataOrigin: 'fi.polar.polarflow', lastModifiedTime: '2026-10-10T12:30:00.000Z' } })];
    await s.sync.syncNow();
    expect(s.posted[1].map((p) => p.recordId)).toEqual(['a']);
  });

  it('registro fora de ordem (modificado ANTES do cursor mas dentro da sobreposicao de 24h) ainda e enviado', async () => {
    let now = T0;
    const s = await connected(setup({ sessions: [] }, { now: () => now }));
    await s.sync.syncNow();
    now = new Date(T0.getTime() + 3600_000);
    s.hc.state.sessions = [session('tardio', { metadata: { id: 'tardio', dataOrigin: 'x.y', lastModifiedTime: '2026-10-10T06:00:00.000Z' } })];
    await s.sync.syncNow();
    expect(s.posted[0]?.map((p) => p.recordId)).toEqual(['tardio']);
  });

  it('sincronizacao interrompida (API falha no 2o lote): erro, marcador NAO avanca, proxima reenvia tudo; sem duplicar (servidor idempotente)', async () => {
    const many = Array.from({ length: 60 }, (_, i) => session(`r${i}`));
    let calls = 0;
    const s = await connected(setup({ sessions: many }, { post: async (items) => { calls += 1; if (calls === 2) throw new Error('rede caiu'); return { created: items.length, updated: 0, alreadyImported: 0, rejected: 0 }; } }));
    const failed = await s.sync.syncNow();
    expect(failed.status).toBe('error');
    expect(failed.lastSyncAt).toBeNull();
    const retry = await s.sync.syncNow();
    expect(retry).toMatchObject({ status: 'done', sent: 60 });
    expect(retry.lastSyncAt).not.toBeNull();
  });

  it('erro da API (500) nao some em silencio: estado "error" e ultima sincronizacao bem-sucedida preservada', async () => {
    let fail = false;
    const s = await connected(setup({ sessions: [session('a')] }, { post: async (items) => { if (fail) throw new Error('health-connect-api-500'); return { created: items.length, updated: 0, alreadyImported: 0, rejected: 0 }; } }));
    const ok = await s.sync.syncNow();
    fail = true;
    s.hc.state.sessions = [session('a'), session('novo', { metadata: { id: 'novo', lastModifiedTime: '2026-10-10T12:00:00.000Z', dataOrigin: 'x.y' } })];
    const bad = await s.sync.syncNow();
    expect(bad.status).toBe('error');
    expect(bad.lastSyncAt).toBe(ok.lastSyncAt);
    expect((await s.sync.view()).lastSyncAt).toBe(ok.lastSyncAt);
  });

  it('chamadas simultaneas (duplo toque / abrir + botao) compartilham UMA execucao', async () => {
    const s = await connected(setup({ sessions: [session('a')] }));
    const results = await Promise.all([s.sync.syncNow(), s.sync.syncNow(), s.sync.autoSyncOnOpen()]);
    expect(s.hc.calls.readSessions).toBe(1);
    expect(s.posted).toHaveLength(1);
    expect(new Set(results.map((r) => r.status))).toEqual(new Set(['done']));
  });

  it('automatica ao abrir: so se conectado e respeitando o intervalo minimo; manual nunca e limitada', async () => {
    let now = T0;
    const s = setup({ sessions: [session('a')] }, { now: () => now });
    expect((await s.sync.autoSyncOnOpen()).status).toBe('skipped'); // nao conectado: nunca pede permissao sozinha
    expect(s.hc.calls.requested).toBe(0);
    await connected(s);
    expect((await s.sync.autoSyncOnOpen()).status).toBe('done');
    now = new Date(T0.getTime() + MIN_AUTO_SYNC_INTERVAL_MS - 1000);
    expect((await s.sync.autoSyncOnOpen()).status).toBe('skipped');
    expect((await s.sync.syncNow()).status).toBe('done');
    now = new Date(now.getTime() + MIN_AUTO_SYNC_INTERVAL_MS + 1000);
    expect((await s.sync.autoSyncOnOpen()).status).toBe('done');
  });

  it('estado local isolado por aluno (troca de conta no mesmo aparelho)', async () => {
    const a = setup({ sessions: [session('a')] }, { userId: 'aluno-a' });
    await connected(a);
    const b = createHealthConnectSync({ hc: a.hc.gateway, store: a.store, userId: 'aluno-b', postExercises: async () => ({ created: 0, updated: 0, alreadyImported: 0, rejected: 0 }) });
    expect((await b.view()).status).toBe('not_connected');
  });
});

describe('Health Connect (cliente): utilitarios', () => {
  it('userIdFromAccessToken le o sub do JWT (so para namespace local)', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'user-123' })).toString('base64url');
    expect(userIdFromAccessToken(`h.${payload}.s`)).toBe('user-123');
    expect(userIdFromAccessToken('lixo')).toBeNull();
    expect(userIdFromAccessToken('a.@@@.c')).toBeNull();
  });
  it('textos de estado exatamente como especificado e data de ultima sincronizacao formatada', () => {
    expect(STATUS_LABEL).toEqual({
      not_connected: 'Não conectado', connected: 'Conectado', syncing: 'Sincronizando...', done: 'Sincronização concluída',
      insufficient_permissions: 'Permissões insuficientes', unavailable: 'Health Connect indisponível', error: 'Erro de sincronização',
    });
    expect(formatLastSync(null)).toBeNull();
    expect(formatLastSync('lixo')).toBeNull();
    expect(formatLastSync('2026-10-10T12:00:00.000Z')).toMatch(/2026/);
  });
});
