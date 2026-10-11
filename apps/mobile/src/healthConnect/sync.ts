// Orquestrador PURO da sincronizacao Health Connect -> API. Todas as dependencias (Health Connect, API, armazenamento, relogio) sao injetadas: o mesmo
// codigo roda no aparelho e nos testes. Garantias:
//  - INCREMENTAL: relê so' a janela desde a ultima sincronizacao bem-sucedida (com sobreposicao) e envia so' o que e' novo/modificado;
//  - IDEMPOTENTE: o servidor deduplica por (usuario, id do registro); reenviar nunca duplica;
//  - RESISTENTE A INTERRUPCAO: o marcador so' avanca depois que TODOS os lotes foram aceitos; uma falha no meio reprocessa na proxima vez;
//  - SEGURA CONTRA CHAMADAS SIMULTANEAS: uma execucao por aluno por vez (quem chega durante a execucao recebe o mesmo resultado);
//  - FORA DE ORDEM: a leitura nao depende da ordem de chegada e o servidor ignora versao mais antiga do que a gravada.

import {
  BATCH_SIZE, buildExercisePayload, classifyError, HC_PERMISSIONS, HC_REQUIRED_RECORD_TYPES, HcRawDistance, HcRawHeartRate, HcRawSession, HcRecordType,
  HealthConnectStatus, ImportResponse, ExercisePayload, LOOKBACK_DAYS, MIN_AUTO_SYNC_INTERVAL_MS, OVERLAP_MS, SdkStatus,
} from './contract';

export interface HealthConnectGateway {
  getSdkStatus(): Promise<SdkStatus>;
  initialize(): Promise<boolean>;
  getGrantedRecordTypes(): Promise<string[]>;
  requestPermissions(): Promise<string[]>;
  revokeAllPermissions(): Promise<void>;
  readSessions(range: { start: Date; end: Date }): Promise<HcRawSession[]>;
  readDistance(range: { start: Date; end: Date }, dataOrigin: string | null): Promise<HcRawDistance[]>;
  readHeartRate(range: { start: Date; end: Date }, dataOrigin: string | null): Promise<HcRawHeartRate[]>;
}

export interface SyncStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SyncDeps {
  hc: HealthConnectGateway;
  postExercises(items: ExercisePayload[]): Promise<ImportResponse>;
  store: SyncStore;
  userId: string;
  now?: () => Date;
}

export interface SyncResult {
  status: HealthConnectStatus | 'skipped';
  lastSyncAt: string | null;
  sent: number;
  created: number;
  updated: number;
  alreadyImported: number;
  rejected: number;
  // Tipos opcionais nao autorizados (ex.: FC): a sincronizacao segue, mas sem essas metricas.
  missingOptional: HcRecordType[];
  detail?: string;
}

export interface ConnectionView {
  status: HealthConnectStatus;
  lastSyncAt: string | null;
  missingOptional: HcRecordType[];
}

const EMPTY: Omit<SyncResult, 'status' | 'lastSyncAt'> = { sent: 0, created: 0, updated: 0, alreadyImported: 0, rejected: 0, missingOptional: [] };

// Uma execucao por aluno por vez, no processo (compartilhado por todas as instancias do orquestrador).
const inFlight = new Map<string, Promise<SyncResult>>();

export function createHealthConnectSync(deps: SyncDeps) {
  const { hc, store, userId } = deps;
  const now = deps.now ?? (() => new Date());
  const key = (name: string) => `panzeri-run:health-connect:${userId}:${name}`;

  async function isConnected() { return (await store.get(key('connected'))) === '1'; }
  async function lastSyncAt() { return store.get(key('lastSyncAt')); }

  // Somente leitura: o que a tela mostra ao abrir.
  async function view(): Promise<ConnectionView> {
    const last = await lastSyncAt();
    if ((await hc.getSdkStatus()) !== 'available') return { status: 'unavailable', lastSyncAt: last, missingOptional: [] };
    if (!(await isConnected())) return { status: 'not_connected', lastSyncAt: last, missingOptional: [] };
    if (inFlight.has(userId)) return { status: 'syncing', lastSyncAt: last, missingOptional: [] };
    try {
      await hc.initialize();
      const granted = await hc.getGrantedRecordTypes();
      if (!HC_REQUIRED_RECORD_TYPES.every((type) => granted.includes(type))) return { status: 'insufficient_permissions', lastSyncAt: last, missingOptional: [] };
      return { status: 'connected', lastSyncAt: last, missingOptional: (['Distance', 'HeartRate'] as const).filter((type) => !granted.includes(type)) };
    } catch (error) {
      return { status: classifyError(error) === 'permission' ? 'insufficient_permissions' : 'error', lastSyncAt: last, missingOptional: [] };
    }
  }

  // Pede a autorizacao ao Android (somente leitura: sessoes de exercicio, distancia e FC). Conectado so' se a permissao essencial foi concedida.
  async function connect(): Promise<{ status: HealthConnectStatus }> {
    const sdk = await hc.getSdkStatus();
    if (sdk !== 'available') return { status: 'unavailable' };
    try {
      if (!(await hc.initialize())) return { status: 'unavailable' };
      const granted = await hc.requestPermissions();
      if (!HC_REQUIRED_RECORD_TYPES.every((type) => granted.includes(type))) return { status: 'insufficient_permissions' };
      await store.set(key('connected'), '1');
      return { status: 'connected' };
    } catch (error) {
      return { status: classifyError(error) === 'permission' ? 'insufficient_permissions' : 'error' };
    }
  }

  // Interrompe novas leituras. NAO apaga nada ja' importado no servidor. A revogacao no Android segue o gerenciamento de permissoes do sistema (no
  // Android 14+ so' vale quando o app reinicia) — por isso a leitura tambem para pela marca local, independente do Android.
  async function disconnect(): Promise<{ revoked: boolean }> {
    await store.remove(key('connected'));
    await store.remove(key('cursor'));
    try {
      await hc.revokeAllPermissions();
      return { revoked: true };
    } catch {
      return { revoked: false };
    }
  }

  async function run(): Promise<SyncResult> {
    const startedAt = now();
    const last = await lastSyncAt();
    if ((await hc.getSdkStatus()) !== 'available') return { ...EMPTY, status: 'unavailable', lastSyncAt: last };
    if (!(await isConnected())) return { ...EMPTY, status: 'not_connected', lastSyncAt: last };
    try {
      if (!(await hc.initialize())) return { ...EMPTY, status: 'unavailable', lastSyncAt: last };
      const granted = await hc.getGrantedRecordTypes();
      // Permissao revogada: para sem erro e sem ler nada.
      if (!HC_REQUIRED_RECORD_TYPES.every((type) => granted.includes(type))) return { ...EMPTY, status: 'insufficient_permissions', lastSyncAt: last };
      const missingOptional = (['Distance', 'HeartRate'] as const).filter((type) => !granted.includes(type));

      const lookbackStart = new Date(startedAt.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const cursorIso = await store.get(key('cursor'));
      const cursor = cursorIso ? new Date(cursorIso) : null;
      const modifiedSince = cursor && !Number.isNaN(cursor.getTime()) ? new Date(cursor.getTime() - OVERLAP_MS) : null;

      // Le TODAS as sessoes da janela (barato) e envia so' as novas/modificadas: assim uma sessao antiga editada depois na origem tambem e' reenviada.
      const sessions = await hc.readSessions({ start: lookbackStart, end: startedAt });
      const toSend = sessions.filter((session) => {
        if (!modifiedSince) return true;
        const modified = session.metadata?.lastModifiedTime ? new Date(session.metadata.lastModifiedTime) : null;
        return !modified || Number.isNaN(modified.getTime()) || modified.getTime() >= modifiedSince.getTime();
      });

      const payloads: ExercisePayload[] = [];
      for (const session of toSend) {
        const range = { start: new Date(session.startTime), end: new Date(session.endTime) };
        const origin = session.metadata?.dataOrigin ?? null;
        // Distancia e FC so' da MESMA origem da sessao (aggregate misturaria apps diferentes e dobraria os valores).
        const distance = granted.includes('Distance') ? await hc.readDistance(range, origin) : null;
        const heartRate = granted.includes('HeartRate') ? await hc.readHeartRate(range, origin) : null;
        const payload = buildExercisePayload(session, distance, heartRate);
        if (payload) payloads.push(payload);
      }

      const totals = { created: 0, updated: 0, alreadyImported: 0, rejected: 0 };
      for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
        const response = await deps.postExercises(payloads.slice(i, i + BATCH_SIZE));
        totals.created += response.created ?? 0;
        totals.updated += response.updated ?? 0;
        totals.alreadyImported += response.alreadyImported ?? 0;
        totals.rejected += response.rejected ?? 0;
      }

      // So' agora o marcador avanca (todos os lotes foram aceitos). Usa o INICIO desta execucao: o que mudou durante ela e' relido na proxima.
      await store.set(key('cursor'), startedAt.toISOString());
      const finished = now().toISOString();
      await store.set(key('lastSyncAt'), finished);
      return { status: 'done', lastSyncAt: finished, sent: payloads.length, ...totals, missingOptional };
    } catch (error) {
      const kind = classifyError(error);
      return { ...EMPTY, status: kind === 'permission' ? 'insufficient_permissions' : kind === 'unavailable' ? 'unavailable' : 'error', lastSyncAt: last, detail: kind === 'other' ? 'sync_failed' : kind };
    }
  }

  // Sincronizacao manual/automatica com trava: chamadas simultaneas compartilham a mesma execucao.
  function syncNow(): Promise<SyncResult> {
    const running = inFlight.get(userId);
    if (running) return running;
    const promise = run().finally(() => { inFlight.delete(userId); });
    inFlight.set(userId, promise);
    return promise;
  }

  // Ao abrir o app: so' sincroniza se ja' autorizado E se passou o intervalo minimo (evita leituras desnecessarias). Nunca pede permissao sozinho.
  async function autoSyncOnOpen(): Promise<SyncResult> {
    const last = await lastSyncAt();
    if (!(await isConnected())) return { ...EMPTY, status: 'skipped', lastSyncAt: last };
    if (last) {
      const elapsed = now().getTime() - new Date(last).getTime();
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_AUTO_SYNC_INTERVAL_MS) return { ...EMPTY, status: 'skipped', lastSyncAt: last };
    }
    return syncNow();
  }

  return { view, connect, disconnect, syncNow, autoSyncOnOpen };
}

export { HC_PERMISSIONS };
