// Orquestrador PURO da sincronizacao Health Connect -> API. Todas as dependencias (Health Connect, API, armazenamento, relogio) sao injetadas: o mesmo
// codigo roda no aparelho e nos testes. Garantias:
//  - INCREMENTAL: relê so' a janela desde a ultima sincronizacao bem-sucedida (com sobreposicao) e envia so' o que e' novo/modificado;
//  - IDEMPOTENTE: o servidor deduplica por (usuario, id do registro); reenviar nunca duplica;
//  - RESISTENTE A INTERRUPCAO: o marcador so' avanca depois que TODOS os lotes foram aceitos; uma falha no meio reprocessa na proxima vez;
//  - SEGURA CONTRA CHAMADAS SIMULTANEAS: uma execucao por aluno por vez (quem chega durante a execucao recebe o mesmo resultado);
//  - FORA DE ORDEM: a leitura nao depende da ordem de chegada e o servidor ignora versao mais antiga do que a gravada;
//  - GUIADA PELAS AUTORIZACOES (22/10/2026): com `getAuthorizedCategories`, so' se le e envia o que a aluna autorizou no consentimento do Panzeri Run (sono, passos, calorias, VO2 max...);
//    sem autorizacao de exercicios nao se le nenhuma sessao. Se as autorizacoes nao puderem ser consultadas, NADA e' lido (fail-closed).

import {
  BATCH_SIZE, buildExercisePayload, classifyError, HC_PERMISSIONS, HC_REQUIRED_RECORD_TYPES, HcRawDistance, HcRawHeartRate, HcRawSession, HcRecordType,
  HealthConnectStatus, ImportResponse, ExercisePayload, LOOKBACK_DAYS, MIN_AUTO_SYNC_INTERVAL_MS, OVERLAP_MS, SdkStatus,
} from './contract';
import { recordTypesFor } from './categories';
import { buildRoutePayload, HcLocation, MAX_ROUTES_PER_POST, routeKind, RoutePayload } from './route';
import {
  buildBodyFat, buildBoneMass, buildDailyEnergyRecord, buildDailyRecord, buildHydration, buildLeanMass, buildNutrition, buildOxygen, buildRespiration, buildSleepRecord, buildVo2Max, buildWaterMass,
  buildWeight, chunkBySize, DayAggregate, enumerateLocalDays, localDateOf, EMPTY_EXTRAS, ExerciseExtras, HealthRecordPayload, hrvRecordsByDay, restingHeartRateByDay, sumElevationGain, sumEnergy, summarizeCadence,
  summarizePower, summarizeSpeed,
} from './healthRecords';

export interface HealthConnectGateway {
  getSdkStatus(): Promise<SdkStatus>;
  initialize(): Promise<boolean>;
  getGrantedRecordTypes(): Promise<string[]>;
  // Sem argumentos: conjunto minimo antigo. Com a lista: so' os tipos autorizados pela aluna (+ historico, se ela autorizou).
  requestPermissions(recordTypes?: string[], includeHistory?: boolean): Promise<string[]>;
  revokeAllPermissions(): Promise<void>;
  readSessions(range: { start: Date; end: Date }): Promise<HcRawSession[]>;
  readDistance(range: { start: Date; end: Date }, dataOrigin: string | null): Promise<HcRawDistance[]>;
  readHeartRate(range: { start: Date; end: Date }, dataOrigin: string | null): Promise<HcRawHeartRate[]>;
  // Leitura generica e totais do dia (opcionais: so' o gateway nativo as oferece; os testes antigos nao precisam implementa-las).
  readAny?(recordType: string, range: { start: Date; end: Date }, dataOrigin: string | null): Promise<unknown[]>;
  aggregateDay?(range: { start: Date; end: Date }, grantedTypes: string[]): Promise<DayAggregate>;
  // Percurso GPS de um exercicio e acesso em segundo plano (opcionais: so' o gateway nativo os oferece).
  getExerciseRoute?(session: HcRawSession, interactive: boolean): Promise<HcLocation[] | 'denied'>;
  hasBackgroundAccess?(): Promise<boolean>;
  requestBackgroundAccess?(): Promise<boolean>;
}

export interface SyncStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AuthorizedCategories {
  categories: Set<string>;
  // A aluna autorizou o historico alem dos 30 dias?
  history: boolean;
}

export interface SyncDeps {
  hc: HealthConnectGateway;
  postExercises(items: ExercisePayload[]): Promise<ImportResponse>;
  // Saude (sono, dia, HRV, indicadores): so' existe quando o app consulta as autorizacoes.
  postHealthRecords?(items: HealthRecordPayload[]): Promise<{ stored: number; rejected: number; items?: Array<{ status: string; reason?: string }> }>;
  // Percurso GPS (so' com a categoria autorizada): pontos compactos por exercicio.
  postRoutes?(items: RoutePayload[]): Promise<{ stored: number; rejected: number; items?: Array<{ recordId: string; status: string; reason?: string }> }>;
  // Autorizacoes vigentes da aluna no servidor. Se lancar erro, nada e' lido.
  getAuthorizedCategories?(): Promise<AuthorizedCategories>;
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
  // Registros de saude (sono, dia, HRV, indicadores) enviados/aceitos e categorias que falharam nesta rodada (as demais seguem).
  healthSent: number;
  healthStored: number;
  failedCategories: string[];
  detail?: string;
}

export interface ConnectionView {
  status: HealthConnectStatus;
  lastSyncAt: string | null;
  missingOptional: HcRecordType[];
}

const EMPTY: Omit<SyncResult, 'status' | 'lastSyncAt'> = { sent: 0, created: 0, updated: 0, alreadyImported: 0, rejected: 0, missingOptional: [], healthSent: 0, healthStored: 0, failedCategories: [] };
const HISTORY_LOOKBACK_DAYS = 365;
const ROUTES_DONE_MAX = 300; // lembra os exercicios cujo percurso ja' foi enviado (evita pedir confirmacao de novo)
const INTERACTIVE_ROUTE_PROMPTS_MAX = 5; // numa sincronizacao manual, no maximo 5 janelas de confirmacao do Android
const HEALTH_BATCH = 100;
const HEALTH_BATCH_MAX_BYTES = 60_000; // folga sob o limite de ~100 KB do corpo no servidor
const DAILY_RECOMPUTE_DAYS = 7; // incremental: os ultimos 7 dias do agregado diario sao recalculados (dado que chega atrasado)

// Uma execucao por aluno por vez, no processo (compartilhado por todas as instancias do orquestrador).
const inFlight = new Map<string, Promise<SyncResult>>();

export function createHealthConnectSync(deps: SyncDeps) {
  const { hc, store, userId } = deps;
  const now = deps.now ?? (() => new Date());
  const key = (name: string) => `panzeri-run:health-connect:${userId}:${name}`;

  async function isConnected() { return (await store.get(key('connected'))) === '1'; }
  async function lastSyncAt() { return store.get(key('lastSyncAt')); }

  // Com consulta de autorizacoes, "tem permissao suficiente" = o Android liberou ao menos um dos tipos que a aluna autorizou; no modo antigo, a sessao de exercicio.
  async function permissionState(granted: string[]): Promise<{ ok: boolean; wanted: string[] | null; auth: AuthorizedCategories | null }> {
    if (!deps.getAuthorizedCategories) return { ok: HC_REQUIRED_RECORD_TYPES.every((type) => granted.includes(type)), wanted: null, auth: null };
    const auth = await deps.getAuthorizedCategories();
    const wanted = recordTypesFor(auth.categories);
    return { ok: wanted.some((type) => granted.includes(type)), wanted, auth };
  }

  // Somente leitura: o que a tela mostra ao abrir.
  async function view(): Promise<ConnectionView> {
    const last = await lastSyncAt();
    if ((await hc.getSdkStatus()) !== 'available') return { status: 'unavailable', lastSyncAt: last, missingOptional: [] };
    if (!(await isConnected())) return { status: 'not_connected', lastSyncAt: last, missingOptional: [] };
    if (inFlight.has(userId)) return { status: 'syncing', lastSyncAt: last, missingOptional: [] };
    try {
      await hc.initialize();
      const granted = await hc.getGrantedRecordTypes();
      const state = await permissionState(granted);
      if (state.auth && state.auth.categories.size === 0) return { status: 'needs_consent', lastSyncAt: last, missingOptional: [] };
      if (!state.ok) return { status: 'insufficient_permissions', lastSyncAt: last, missingOptional: [] };
      return { status: 'connected', lastSyncAt: last, missingOptional: state.wanted ? [] : (['Distance', 'HeartRate'] as const).filter((type) => !granted.includes(type)) };
    } catch (error) {
      return { status: classifyError(error) === 'permission' ? 'insufficient_permissions' : 'error', lastSyncAt: last, missingOptional: [] };
    }
  }

  // Pede ao Android os tipos que a aluna AUTORIZOU no consentimento do Panzeri Run (nunca os demais). Sem nenhuma autorizacao: nada e' pedido.
  async function connect(): Promise<{ status: HealthConnectStatus }> {
    const sdk = await hc.getSdkStatus();
    if (sdk !== 'available') return { status: 'unavailable' };
    try {
      if (!(await hc.initialize())) return { status: 'unavailable' };
      let granted: string[];
      let ok: boolean;
      if (deps.getAuthorizedCategories) {
        const auth = await deps.getAuthorizedCategories();
        const wanted = recordTypesFor(auth.categories);
        // Categorias autorizadas sem leitura implementada (percurso GPS, temperatura da pele) nao pedem nada ao Android; sem nenhum tipo para pedir, a aluna ainda tem autorizacoes registradas.
        if (auth.categories.size === 0) return { status: 'needs_consent' };
        granted = wanted.length > 0 ? await hc.requestPermissions(wanted, auth.history) : [];
        ok = wanted.length === 0 || wanted.some((type) => granted.includes(type));
      } else {
        granted = await hc.requestPermissions();
        ok = HC_REQUIRED_RECORD_TYPES.every((type) => granted.includes(type));
      }
      if (!ok) return { status: 'insufficient_permissions' };
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

  // ---- Exercicios -----------------------------------------------------------------------------------------------------------------------------
  async function exercisePayloads(sessions: HcRawSession[], granted: string[], auth: AuthorizedCategories | null): Promise<ExercisePayload[]> {
    const payloads: ExercisePayload[] = [];
    const sensors = auth ? auth.categories.has('activity_sensors') : true;
    for (const session of sessions) {
      const range = { start: new Date(session.startTime), end: new Date(session.endTime) };
      const origin = session.metadata?.dataOrigin ?? null;
      // Tudo so' da MESMA origem da sessao e DENTRO dela (aggregate misturaria apps diferentes e dobraria os valores).
      const distance = granted.includes('Distance') ? await hc.readDistance(range, origin) : null;
      const heartRate = sensors && granted.includes('HeartRate') ? await hc.readHeartRate(range, origin) : null;
      const extras: ExerciseExtras = { ...EMPTY_EXTRAS };
      if (auth && hc.readAny) {
        const read = async (type: string) => (granted.includes(type) ? ((await hc.readAny!(type, range, origin)) as never[]) : []);
        const speed = summarizeSpeed(await read('Speed'), session);
        Object.assign(extras, speed, { activeKilocalories: sumEnergy(await read('ActiveCaloriesBurned'), session), totalKilocalories: sumEnergy(await read('TotalCaloriesBurned'), session) });
        if (sensors) Object.assign(extras, summarizePower(await read('Power'), session), summarizeCadence(await read('StepsCadence'), session), sumElevationGain(await read('ElevationGained'), session));
      }
      const payload = buildExercisePayload(session, distance, heartRate, auth ? extras : undefined);
      if (payload) payloads.push(payload);
    }
    return payloads;
  }

  // ---- Saude (so' as categorias autorizadas; cada uma isolada: a falha de uma nao derruba as outras) ------------------------------------------
  // A janela e' SEMPRE a de retrospecto inteira (barato) e o filtro e' pela data de MODIFICACAO do registro, como nos exercicios: dado que o relogio sincroniza atrasado no Health Connect nao se perde.
  async function collectHealth(auth: AuthorizedCategories, granted: string[], range: { start: Date; end: Date }, modifiedSince: Date | null): Promise<{ records: HealthRecordPayload[]; failed: string[] }> {
    const records: HealthRecordPayload[] = [];
    const failed: string[] = [];
    const fresh = (record: { metadata?: { lastModifiedTime?: string } }) => {
      if (!modifiedSince) return true;
      const modified = record.metadata?.lastModifiedTime ? new Date(record.metadata.lastModifiedTime) : null;
      return !modified || Number.isNaN(modified.getTime()) || modified.getTime() >= modifiedSince.getTime();
    };
    const has = (category: string, type: string) => auth.categories.has(category) && granted.includes(type);
    const readType = async (type: string) => ((await hc.readAny?.(type, range, null)) ?? []) as never[];
    const attempt = async (category: string, run: () => Promise<void>) => { try { await run(); } catch { failed.push(category); } };
    const push = (value: HealthRecordPayload | null) => { if (value) records.push(value); };

    if (has('sleep', 'SleepSession')) await attempt('sleep', async () => { for (const s of await readType('SleepSession')) if (fresh(s)) push(buildSleepRecord(s)); });
    const dailyOn = auth.categories.has('daily_activity') && hc.aggregateDay;
    const restingOn = has('resting_heart_rate', 'RestingHeartRate');
    if (dailyOn || restingOn) {
      await attempt('daily_activity', async () => {
        const resting = restingOn ? restingHeartRateByDay((await readType('RestingHeartRate')) as never) : new Map<string, number>();
        const dailyStart = modifiedSince ? new Date(Math.max(range.start.getTime(), range.end.getTime() - DAILY_RECOMPUTE_DAYS * 86_400_000)) : range.start;
        for (const day of enumerateLocalDays(dailyStart, range.end)) {
          const aggregate = dailyOn ? await hc.aggregateDay!({ start: day.start, end: day.end }, granted) : { steps: null, distanceMeters: null, activeKilocalories: null, totalKilocalories: null };
          push(buildDailyRecord(day.date, day.start.toISOString(), day.offsetSec, aggregate, resting.get(day.date) ?? null, Boolean(dailyOn)));
          if (dailyOn) push(buildDailyEnergyRecord(day.date, day.start.toISOString(), day.offsetSec, aggregate.totalKilocalories));
        }
      });
    }
    if (has('hrv', 'HeartRateVariabilityRmssd')) await attempt('hrv', async () => { const hrv = (await readType('HeartRateVariabilityRmssd')) as Array<{ metadata?: { lastModifiedTime?: string }; time: string; zoneOffset?: { totalSeconds?: number } | null }>;
      // So' os dias com registro novo/modificado sao reenviados, mas a media de cada dia usa TODAS as amostras do dia.
      const freshDates = new Set(hrv.filter(fresh).map((r) => localDateOf(r.time, typeof r.zoneOffset?.totalSeconds === 'number' ? r.zoneOffset.totalSeconds : null)));
      for (const r of hrvRecordsByDay(hrv as never, modifiedSince ? freshDates : undefined)) push(r);
    });
    if (has('vo2_max', 'Vo2Max')) await attempt('vo2_max', async () => { for (const r of await readType('Vo2Max')) if (fresh(r)) push(buildVo2Max(r)); });
    if (auth.categories.has('body_composition')) {
      await attempt('body_composition', async () => {
        const kinds: Array<[string, (r: never) => HealthRecordPayload | null]> = [['Weight', buildWeight], ['BodyFat', buildBodyFat], ['LeanBodyMass', buildLeanMass], ['BoneMass', buildBoneMass], ['BodyWaterMass', buildWaterMass]];
        for (const [type, build] of kinds) if (granted.includes(type)) for (const r of await readType(type)) if (fresh(r as never)) push(build(r as never));
      });
    }
    if (has('pulse_ox', 'OxygenSaturation')) await attempt('pulse_ox', async () => { for (const r of await readType('OxygenSaturation')) if (fresh(r)) push(buildOxygen(r)); });
    if (has('respiratory_rate', 'RespiratoryRate')) await attempt('respiratory_rate', async () => { for (const r of await readType('RespiratoryRate')) if (fresh(r)) push(buildRespiration(r)); });
    if (auth.categories.has('nutrition')) {
      await attempt('nutrition', async () => {
        if (granted.includes('Nutrition')) for (const r of await readType('Nutrition')) if (fresh(r)) push(buildNutrition(r));
        if (granted.includes('Hydration')) for (const r of await readType('Hydration')) if (fresh(r)) push(buildHydration(r));
      });
    }
    return { records, failed };
  }

  async function idList(name: string): Promise<string[]> {
    try { const parsed = JSON.parse((await store.get(key(name))) ?? '[]'); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
  }
  const saveIds = (name: string, ids: Iterable<string>, max: number) => store.set(key(name), JSON.stringify([...ids].slice(-max)));

  // Percurso GPS dos exercicios enviados nesta rodada. Falha aqui NAO derruba o resto: a categoria vai para failedCategories e o marcador fica onde estava.
  // Fila local do percurso: "done" (ja' enviado), "pending" (o Android exigia confirmacao e a leitura nao era interativa: fica esperando o proximo toque em Sincronizar agora) e "denied"
  // (a aluna/o Android negou aquele exercicio: nao se pergunta de novo).
  async function syncRoutes(candidates: HcRawSession[], interactive: boolean): Promise<{ serverRetry: boolean }> {
    if (!hc.getExerciseRoute || !deps.postRoutes) return { serverRetry: false };
    const done = new Set(await idList('routesDone'));
    const denied = new Set(await idList('routesDenied'));
    const pending = new Set(await idList('routesPending'));
    const payloads: RoutePayload[] = [];
    let prompts = 0;
    for (const session of candidates) {
      const id = session.metadata?.id;
      if (!id || done.has(id) || denied.has(id)) continue;
      const needsPrompt = routeKind(session.exerciseRoute?.type) === 'consent';
      if (needsPrompt && (!interactive || prompts >= INTERACTIVE_ROUTE_PROMPTS_MAX)) { pending.add(id); continue; }
      if (needsPrompt) prompts += 1;
      const locations = await hc.getExerciseRoute(session, interactive);
      if (locations === 'denied') { denied.add(id); pending.delete(id); continue; }
      const payload = buildRoutePayload(id, session.startTime, locations);
      if (payload) payloads.push(payload);
    }
    let serverRetry = false;
    for (const batch of chunkBySize(payloads, HEALTH_BATCH_MAX_BYTES, MAX_ROUTES_PER_POST)) {
      const response = await deps.postRoutes(batch);
      if (response.items?.some((item) => item.reason === 'falha_ao_gravar')) serverRetry = true;
      for (const item of response.items ?? []) if (item.status === 'stored') { done.add(item.recordId); pending.delete(item.recordId); }
    }
    await saveIds('routesDone', done, ROUTES_DONE_MAX);
    await saveIds('routesDenied', denied, ROUTES_DONE_MAX);
    await saveIds('routesPending', pending, 100);
    return { serverRetry };
  }

  async function run(interactive = false): Promise<SyncResult> {
    const startedAt = now();
    const last = await lastSyncAt();
    if ((await hc.getSdkStatus()) !== 'available') return { ...EMPTY, status: 'unavailable', lastSyncAt: last };
    if (!(await isConnected())) return { ...EMPTY, status: 'not_connected', lastSyncAt: last };
    try {
      if (!(await hc.initialize())) return { ...EMPTY, status: 'unavailable', lastSyncAt: last };
      const granted = await hc.getGrantedRecordTypes();
      const state = await permissionState(granted);
      const auth = state.auth;
      if (auth && auth.categories.size === 0) return { ...EMPTY, status: 'needs_consent', lastSyncAt: last };
      // Permissao revogada: para sem erro e sem ler nada.
      if (!state.ok) return { ...EMPTY, status: 'insufficient_permissions', lastSyncAt: last };
      const missingOptional = auth ? [] : (['Distance', 'HeartRate'] as const).filter((type) => !granted.includes(type));

      const cursorIso = await store.get(key('cursor'));
      const cursor = cursorIso ? new Date(cursorIso) : null;
      const validCursor = cursor && !Number.isNaN(cursor.getTime()) ? cursor : null;
      const modifiedSince = validCursor ? new Date(validCursor.getTime() - OVERLAP_MS) : null;
      // Primeira sincronizacao: 29 dias (limite do Health Connect sem a permissao de historico) ou ate 1 ano se a aluna autorizou o historico E o Android a liberou.
      const historyDays = auth?.history && granted.includes('ReadHealthDataHistory') ? HISTORY_LOOKBACK_DAYS : LOOKBACK_DAYS;
      const lookbackStart = new Date(startedAt.getTime() - historyDays * 24 * 60 * 60 * 1000);

      let payloads: ExercisePayload[] = [];
      let sessionsSent: HcRawSession[] = [];
      let sessionsInWindow: HcRawSession[] = [];
      const exercisesAllowed = auth ? auth.categories.has('activity') && granted.includes('ExerciseSession') : true;
      if (exercisesAllowed) {
        // Le TODAS as sessoes da janela (barato) e envia so' as novas/modificadas: assim uma sessao antiga editada depois na origem tambem e' reenviada.
        const sessions = await hc.readSessions({ start: lookbackStart, end: startedAt });
        const toSend = sessions.filter((session) => {
          if (!modifiedSince) return true;
          const modified = session.metadata?.lastModifiedTime ? new Date(session.metadata.lastModifiedTime) : null;
          return !modified || Number.isNaN(modified.getTime()) || modified.getTime() >= modifiedSince.getTime();
        });
        payloads = await exercisePayloads(toSend, granted, auth);
        sessionsSent = toSend;
        sessionsInWindow = sessions;
      }

      const totals = { created: 0, updated: 0, alreadyImported: 0, rejected: 0 };
      // Falha TRANSITORIA do servidor (ex.: banco) num registro: o marcador nao avanca, para a proxima rodada reenviar (rejeicao definitiva por validacao nao trava nada).
      let serverRetry = false;
      for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
        const response = await deps.postExercises(payloads.slice(i, i + BATCH_SIZE));
        if (response.items?.some((item) => item.reason === 'falha_ao_gravar')) serverRetry = true;
        totals.created += response.created ?? 0;
        totals.updated += response.updated ?? 0;
        totals.alreadyImported += response.alreadyImported ?? 0;
        totals.rejected += response.rejected ?? 0;
      }

      // Percurso GPS dos exercicios desta rodada (so' com a categoria autorizada).
      let routeFailed = false;
      if (auth && !auth.categories.has('activity_route')) {
        // Percurso nao autorizado (ou retirado): a fila local e' zerada, para reautorizar depois reenviar tudo do zero.
        await Promise.all(['routesDone', 'routesDenied', 'routesPending'].map((name) => store.remove(key(name))));
      } else if (auth?.categories.has('activity_route') && exercisesAllowed) {
        try {
          // Na leitura interativa tambem revisita os exercicios que ficaram esperando a confirmacao do Android.
          const pendingIds = new Set(await idList('routesPending'));
          const candidates = [...new Map([...sessionsSent, ...sessionsInWindow.filter((s) => s.metadata?.id && pendingIds.has(s.metadata.id))].map((s) => [s.metadata?.id ?? '', s])).values()];
          const routes = await syncRoutes(candidates, interactive);
          if (routes.serverRetry) serverRetry = true;
        } catch { routeFailed = true; }
      }

      // Saude: janela incremental (desde a ultima sincronizacao, com sobreposicao) ou a janela inicial.
      let health = { sent: 0, stored: 0 };
      let failedCategories: string[] = [];
      if (auth && deps.postHealthRecords && hc.readAny) {
        const collected = await collectHealth(auth, granted, { start: lookbackStart, end: startedAt }, modifiedSince);
        failedCategories = collected.failed;
        for (const batch of chunkBySize(collected.records, HEALTH_BATCH_MAX_BYTES, HEALTH_BATCH)) {
          const response = await deps.postHealthRecords(batch);
          health = { sent: health.sent + batch.length, stored: health.stored + (response.stored ?? 0) };
          if (response.items?.some((item) => item.reason === 'falha_ao_gravar')) serverRetry = true;
        }
      }

      // So' agora o marcador avanca (todos os lotes foram aceitos). Categorias que FALHARAM na leitura mantem o marcador onde estava: a proxima rodada as relê.
      if (routeFailed) failedCategories = [...failedCategories, 'activity_route'];
      if (serverRetry) failedCategories = [...failedCategories, 'envio_ao_servidor'];
      if (failedCategories.length === 0) await store.set(key('cursor'), startedAt.toISOString());
      const finished = now().toISOString();
      await store.set(key('lastSyncAt'), finished);
      return { status: 'done', lastSyncAt: finished, sent: payloads.length, ...totals, missingOptional, healthSent: health.sent, healthStored: health.stored, failedCategories };
    } catch (error) {
      const kind = classifyError(error);
      return { ...EMPTY, status: kind === 'permission' ? 'insufficient_permissions' : kind === 'unavailable' ? 'unavailable' : 'error', lastSyncAt: last, detail: kind === 'other' ? 'sync_failed' : kind };
    }
  }

  // Sincronizacao manual/automatica com trava: chamadas simultaneas compartilham a mesma execucao.
  // interactive = toque do aluno em "Sincronizar agora": so' nele o Android pode abrir a janela de confirmacao do percurso GPS.
  function syncNow(options: { interactive?: boolean } = {}): Promise<SyncResult> {
    const running = inFlight.get(userId);
    if (running) return running;
    const promise = run(options.interactive === true).finally(() => { inFlight.delete(userId); });
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
