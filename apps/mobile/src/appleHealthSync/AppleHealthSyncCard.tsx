import React, { useCallback, useEffect, useState } from 'react';
import { InfoTip } from '../InfoTip';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import {
  isAppleHealthSupported,
  isHealthDataAvailable,
  readCategorySamples,
  readDailyStatistics,
  readWorkoutRoute,
  readWorkoutsInRange,
  requestHealthAuthorizationFor,
  type AppleRunningWorkout,
} from '../../modules/panzeri-apple-health/src';
import {
  HttpError, NativeReadError, classifyFailure, dayKey, dropRevoked, emptyCounters, fitRoute, markCovered, markThrough, messageFor, packRecords, packRouteBatches, parseCoverage, planSyncWindows,
  type RouteBatchItem, type SyncCounters, type SyncOutcome, type SyncWindow,
} from './appleHealthSyncLogic';
import { HEALTH_GROUPS, buildWindowRecords, categoryIdsForGroups, specsForGroups } from './appleHealthRecords';

// Apple Saude (28/10/2026). Duas autorizacoes DIFERENTES, explicadas ao aluno: (1) a folha do iOS, que deixa o app LER o dado no aparelho; (2) o consentimento registrado no Panzeri Run
// (por grupo: treinos, medidas de sensor, percurso GPS), que decide o que o servidor guarda. O servidor so' aceita o que (2) autoriza. Sincronizar nunca duplica (o servidor reconhece cada
// treino) e completa o que faltava; a rota e' enviada de forma independente, so' para treinos que ainda nao tem percurso. So' iOS nativo.

const WORKOUTS_PER_WINDOW = 500;
const WORKOUTS_PER_REQUEST = 50;
// Percursos lidos por sincronizacao: cada um e' uma consulta ao app Saude; o restante fica para a proxima sincronizacao (nada se perde, e o servidor so' pede os que ainda faltam).
const MAX_ROUTES_PER_SYNC = 150;
const PENDING_IDS_PER_REQUEST = 200;
const DEFAULT_ROUTE_LIMITS = { maxRoutesPerRequest: 3, maxPointsPerRoute: 1200, maxRequestBytes: 60_000 };

type ConsentDocument = {
  version: string; textHash: string; title: string; intro: string;
  sections: Array<{ heading: string | null; paragraphs?: string[] }>;
  groups: Array<{ id: string; label: string; description: string; requires?: string[] }>;
  acknowledgementText: string; confirmButtonLabel: string;
};
type Permissions = { connected: boolean; consent: { needsReview: boolean }; groups: Array<{ id: string; granted: boolean }>; legacyImport: boolean; syncKey?: string };
type HealthRecordsResponse = { stored: number; rejected: number };
type ImportResponse = { created: number; enriched?: number; alreadyImported: number; rejected: number };
type PendingResponse = { pending: string[]; limits?: { maxRoutesPerRequest: number; maxPointsPerRoute: number; maxRequestBytes: number } };
type RouteResponse = { stored: number; items: Array<{ recordId: string; status: string; reason?: string }> };

export function AppleHealthSyncCard({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [document, setDocument] = useState<ConsentDocument | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const call = useCallback(async <T,>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new HttpError(response.status);
    return (await response.json()) as T;
  }, [apiUrl, accessToken]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [doc, perms] = await Promise.all([call<ConsentDocument>('GET', '/apple-health/consent'), call<Permissions>('GET', '/apple-health/permissions')]);
      setDocument(doc);
      setPermissions(perms);
      setSelected(new Set(perms.groups.filter((group) => group.granted).map((group) => group.id)));
      setAcknowledged(false);
    } catch {
      setLoadFailed(true);
    }
  }, [call]);

  useEffect(() => {
    if (Platform.OS === 'ios' && isAppleHealthSupported) void load();
  }, [load]);

  if (Platform.OS !== 'ios' || !isAppleHealthSupported) return null;

  const granted = new Set(permissions?.groups.filter((group) => group.granted).map((group) => group.id) ?? []);
  const consentCurrent = Boolean(permissions?.connected && !permissions.consent.needsReview && granted.size > 0);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      // quem depende do grupo retirado sai junto
      for (const group of document?.groups ?? []) if ((group.requires ?? []).includes(id)) next.delete(group.id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  async function saveConsent() {
    if (!document || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const grant = [...selected].filter((id) => !granted.has(id));
      const revoke = [...granted].filter((id) => !selected.has(id));
      if (grant.length > 0 && !acknowledged) {
        setMessage({ ok: false, text: 'Confirme a autorização para salvar.' });
        return;
      }
      if (permissions?.consent.needsReview && grant.length === 0 && revoke.length === 0 && selected.size > 0) {
        if (!acknowledged) { setMessage({ ok: false, text: 'Confirme a autorização para salvar.' }); return; }
        await call('POST', '/apple-health/consent/reconfirm', { acknowledged: true, consentVersion: document.version, consentTextHash: document.textHash });
      } else if (grant.length > 0 || revoke.length > 0) {
        await call('POST', '/apple-health/consent/groups', { grant, revoke, acknowledged: grant.length > 0 ? true : undefined, consentVersion: document.version, consentTextHash: document.textHash });
      }
      await load();
      setMessage({ ok: true, text: 'Suas autorizações foram salvas.' });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof HttpError && error.status === 409 ? 'O texto de autorização mudou. Leia a versão atual e tente de novo.' : 'Não foi possível salvar suas autorizações agora. Tente novamente.' });
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function withdrawAll() {
    if (saving) return;
    setSaving(true);
    try {
      await call('DELETE', '/apple-health/consent');
      await load();
      setMessage({ ok: true, text: 'Autorizações retiradas. Percursos e medidas já guardados foram apagados; os treinos importados continuam. Para excluí-los, fale com o suporte.' });
    } catch {
      setMessage({ ok: false, text: 'Não foi possível retirar as autorizações agora. Tente novamente.' });
    } finally {
      setSaving(false);
    }
  }

  // Uma lista de treinos por vez: o que ja' foi enviado fica enviado (o servidor e' idempotente); falhas viram contadores e o resultado diz exatamente o que ficou pendente.
  async function syncRoutes(workouts: AppleRunningWorkout[], counters: SyncCounters): Promise<SyncOutcome | null> {
    // treino em ambiente fechado (esteira) nao tem percurso GPS: nao e' consultado
    const candidates = workouts.filter((workout) => workout.isIndoor !== true).map((workout) => workout.uuid.toLowerCase());
    let limits = DEFAULT_ROUTE_LIMITS;
    const pending: string[] = [];
    for (let start = 0; start < candidates.length; start += PENDING_IDS_PER_REQUEST) {
      const result = await call<PendingResponse>('POST', '/apple-health/routes/pending', { recordIds: candidates.slice(start, start + PENDING_IDS_PER_REQUEST) });
      pending.push(...result.pending);
      if (result.limits) limits = result.limits;
    }
    const items: RouteBatchItem[] = [];
    const todo = pending.slice(0, MAX_ROUTES_PER_SYNC);
    counters.routesDeferred += pending.length - todo.length;
    for (let index = 0; index < todo.length; index += 1) {
      setProgress(`Lendo percursos (${index + 1} de ${todo.length})…`);
      let points;
      try {
        points = await readWorkoutRoute(todo[index], limits.maxPointsPerRoute);
      } catch {
        counters.routesFailed += 1;
        continue;
      }
      if (points.length < 2) continue; // sem percurso (ou sem permissao: o iOS nao diferencia): nada a enviar, e nada e' afirmado
      const fitted = fitRoute({ recordId: todo[index], points }, limits.maxRequestBytes, limits.maxPointsPerRoute);
      if (fitted) items.push(fitted); else counters.routesTooLarge += 1;
    }
    const batches = packRouteBatches(items, limits);
    for (let index = 0; index < batches.length; index += 1) {
      setProgress(`Enviando percursos (lote ${index + 1} de ${batches.length})…`);
      try {
        const result = await call<RouteResponse>('POST', '/apple-health/routes', { routes: batches[index] });
        counters.routesStored += result.stored;
        counters.routesFailed += result.items.filter((item) => item.status !== 'stored').length;
      } catch (error) {
        const failure = classifyFailure(error);
        counters.routesFailed += batches.slice(index).reduce((sum, batch) => sum + batch.length, 0);
        // falha de comunicacao/servidor: para aqui (o resto fica pendente para a proxima sincronizacao); falta de autorizacao tambem
        return failure;
      }
    }
    return null;
  }

  // Uma janela de datas: treinos de TODOS os tipos (se autorizados) e a saude do dia a dia dos grupos autorizados. Devolve a falha que interrompe a sincronizacao (comunicacao/servidor/autorizacao)
  // ou null. Erros de leitura nativa sobem como NativeReadError. Tudo o que o servidor ja' tem e' reconhecido (idempotente), entao reenviar uma janela nunca duplica.
  async function syncWindow(window: SyncWindow, counters: SyncCounters, workouts: AppleRunningWorkout[], unreadable: Set<string>): Promise<SyncOutcome | null> {
    if (window.groups.includes('workouts')) {
      const list = await readWorkoutsInRange(window.start, window.end, WORKOUTS_PER_WINDOW);
      if (list.length >= WORKOUTS_PER_WINDOW) counters.workoutsMaybeTruncated += 1;
      for (let start = 0; start < list.length; start += WORKOUTS_PER_REQUEST) {
        const chunk = list.slice(start, start + WORKOUTS_PER_REQUEST);
        try {
          const result = await call<ImportResponse>('POST', '/apple-health/workouts', { workouts: chunk });
          counters.created += result.created;
          counters.enriched += result.enriched ?? 0;
          counters.already += result.alreadyImported - (result.enriched ?? 0);
          counters.rejected += result.rejected;
        } catch (error) {
          counters.workoutsNotSent += list.length - start;
          return classifyFailure(error);
        }
      }
      workouts.push(...list);
    }
    const healthGroups = new Set(window.groups.filter((group) => HEALTH_GROUPS.includes(group)));
    if (healthGroups.size === 0) return null;
    const stats = await readDailyStatistics(specsForGroups(healthGroups).map(({ identifier, unit }) => ({ identifier, unit })), window.start, window.end);
    for (const id of stats.failed) unreadable.add(id);
    const categoryIds = categoryIdsForGroups(healthGroups);
    const dayMs = 24 * 3600_000;
    // 1 dia de folga de cada lado: noites de sono que atravessam a fronteira da janela chegam inteiras
    const categories = categoryIds.length > 0 ? await readCategorySamples(categoryIds, new Date(window.start.getTime() - dayMs), new Date(window.end.getTime() + dayMs)) : { rows: [], failed: [] as string[] };
    for (const id of categories.failed) unreadable.add(id);
    const records = buildWindowRecords({ stats: stats.rows, categories: categories.rows, groups: healthGroups, fromDay: dayKey(window.start), toDay: dayKey(window.end) });
    const batches = packRecords(records);
    for (let index = 0; index < batches.length; index += 1) {
      try {
        const result = await call<HealthRecordsResponse>('POST', '/apple-health/health-records', { records: batches[index] });
        counters.healthStored += result.stored;
        counters.healthRejected += result.rejected;
      } catch (error) {
        counters.healthNotSent += batches.slice(index).reduce((sum, batch) => sum + batch.length, 0);
        return classifyFailure(error);
      }
    }
    return null;
  }

  async function sync() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const counters = emptyCounters();
    let outcome: SyncOutcome = 'completed';
    try {
      if (!isHealthDataAvailable()) throw new NativeReadError('Saude indisponivel');
      // So' o que o consentimento do Panzeri Run cobre: nada alem disso e' pedido ao iPhone nem lido.
      const groups = new Set([...granted].filter((id) => id === 'workouts' || HEALTH_GROUPS.includes(id)));
      setProgress('Aguardando a permissão do iPhone…');
      try {
        await requestHealthAuthorizationFor(specsForGroups(groups).map((spec) => spec.identifier), categoryIdsForGroups(groups));
      } catch {
        throw new NativeReadError('autorizacao');
      }
      const storageKey = `apple_health_coverage_v1:${permissions?.syncKey ?? 'default'}`;
      const readCoverage = async () => { try { return parseCoverage(await AsyncStorage.getItem(storageKey)); } catch { return parseCoverage(null); } };
      const saveCoverage = async (value: unknown) => { try { await AsyncStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* sem armazenamento: a proxima sincronizacao apenas relê (idempotente) */ } };
      let coverage = dropRevoked(await readCoverage(), groups);
      const windows = planSyncWindows(new Date(), groups, coverage);
      const workouts: AppleRunningWorkout[] = [];
      const unreadable = new Set<string>();
      let failure: SyncOutcome | null = null;
      let done = 0;
      for (const window of windows) {
        setProgress(`Lendo e enviando o app Saúde (${done + 1} de ${windows.length})…`);
        try {
          failure = await syncWindow(window, counters, workouts, unreadable);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw error instanceof NativeReadError ? error : new NativeReadError('leitura');
        }
        if (failure !== null) break;
        coverage = markCovered(coverage, window);
        await saveCoverage(coverage);
        done += 1;
      }
      counters.windowsPending = windows.length - done;
      counters.healthUnreadable = unreadable.size;
      if (failure === null) {
        await saveCoverage(markThrough(coverage, new Date()));
        if (granted.has('route') && workouts.length > 0) {
          try {
            failure = await syncRoutes(workouts, counters);
          } catch (error) {
            failure = classifyFailure(error);
          }
        }
      }
      const anyDone = counters.created + counters.enriched + counters.already + counters.routesStored + counters.healthStored > 0;
      const anyPending = counters.workoutsNotSent + counters.routesFailed + counters.routesTooLarge + counters.rejected + counters.healthNotSent + counters.healthRejected + counters.windowsPending + counters.routesDeferred + counters.workoutsMaybeTruncated > 0;
      if (failure !== null) outcome = anyDone && failure !== 'not_authorized' ? 'partial' : failure;
      else if (!anyDone && !anyPending && workouts.length === 0) outcome = 'no_activities';
      else outcome = anyPending ? 'partial' : 'completed';
    } catch (error) {
      outcome = classifyFailure(error);
    } finally {
      setProgress(null);
      setBusy(false);
    }
    setMessage(messageFor(outcome, counters));
  }

  const disabled = busy || saving;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Apple Saúde</Text>
      <Text style={styles.hint}>Traz seus treinos e seus dados de saúde do app Saúde (sono, passos, frequência cardíaca, HRV, peso e outros) para o Panzeri Run, dos últimos 3 anos e depois só o que é novo.</Text>
      <InfoTip label="Por que existem duas permissões?">{'A permissão do iPhone deixa o aplicativo ler os dados no aparelho. A permissão do Panzeri Run, logo abaixo, registra o que podemos guardar e usar para acompanhar sua evolução. O iPhone não informa ao aplicativo o que foi negado, então um dado ausente pode não existir ou não ter sido permitido.'}</InfoTip>

      {loadFailed ? (
        <>
          <Text style={styles.problem}>Não foi possível carregar suas autorizações agora.</Text>
          <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button"><Text style={styles.buttonText}>Tentar de novo</Text></Pressable>
        </>
      ) : null}

      {document && permissions ? (
        <View style={styles.consent}>
          <Text style={styles.subtitle}>{document.title}</Text>
          {!consentCurrent || permissions.consent.needsReview ? (
            <>
              <Text style={styles.hint}>{document.intro}</Text>
              {document.sections.map((section, index) => (
                <View key={index} style={styles.section}>
                  {section.heading ? <Text style={styles.sectionTitle}>{section.heading}</Text> : null}
                  {(section.paragraphs ?? []).map((paragraph) => <Text key={paragraph} style={styles.hint}>{paragraph}</Text>)}
                </View>
              ))}
            </>
          ) : null}
          {document.groups.map((group) => {
            const dependsOn = (group.requires ?? []).filter((id) => !selected.has(id));
            const on = selected.has(group.id);
            return (
              <Pressable key={group.id} style={[styles.row, dependsOn.length > 0 && styles.rowDisabled]} disabled={dependsOn.length > 0 || disabled} onPress={() => toggle(group.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: dependsOn.length > 0 }}>
                <Text style={styles.check}>{on ? '☑' : '☐'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{group.label}</Text>
                  <Text style={styles.hint}>{group.description}</Text>
                </View>
              </Pressable>
            );
          })}
          {[...selected].some((id) => !granted.has(id)) || permissions.consent.needsReview ? (
            <Pressable style={styles.row} disabled={disabled} onPress={() => setAcknowledged((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged }}>
              <Text style={styles.check}>{acknowledged ? '☑' : '☐'}</Text>
              <Text style={[styles.hint, { flex: 1 }]}>{document.acknowledgementText}</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.button, disabled && styles.buttonDisabled]} disabled={disabled} onPress={() => void saveConsent()} accessibilityRole="button">
            {saving ? <ActivityIndicator size="small" color="#246F91" /> : null}
            <Text style={styles.buttonText}>{document.confirmButtonLabel}</Text>
          </Pressable>
          {permissions.connected ? (
            <Pressable disabled={disabled} onPress={() => void withdrawAll()} accessibilityRole="button"><Text style={styles.link}>Retirar todas as autorizações</Text></Pressable>
          ) : null}
        </View>
      ) : null}

      <Pressable style={[styles.button, (disabled || !consentCurrent) && styles.buttonDisabled]} disabled={disabled || !consentCurrent} onPress={() => void sync()} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color="#246F91" /> : null}
        <Text style={styles.buttonText}>{busy ? 'Sincronizando…' : 'Continuar e sincronizar'}</Text>
      </Pressable>
      {!consentCurrent && document ? <Text style={styles.hint}>Salve suas autorizações (marque ao menos um grupo) para poder sincronizar.</Text> : null}
      {progress ? <Text style={styles.hint}>{progress}</Text> : null}
      {message ? <Text style={[styles.message, message.ok ? null : styles.problem]}>{message.text}</Text> : null}
      <Text style={styles.hint}>Você pode sincronizar de novo quando quiser: nada já importado é duplicado, o que faltava é completado e só os percursos pendentes são enviados. A primeira sincronização lê o histórico e pode demorar alguns minutos; se for interrompida, a seguinte continua de onde parou. A sincronização acontece só quando você toca no botão.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 14, borderWidth: 1, borderColor: '#246F91', borderRadius: 8, gap: 10 },
  title: { fontSize: 16, fontWeight: '700', color: '#071827' },
  subtitle: { fontSize: 14, fontWeight: '700', color: '#071827' },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#071827' },
  section: { gap: 4 },
  consent: { gap: 10 },
  hint: { fontSize: 12, color: '#4a5560' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  rowDisabled: { opacity: 0.5 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: '#071827' },
  check: { fontSize: 18, color: '#246F91' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#246F91' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 15, color: '#246F91', fontWeight: '700' },
  link: { fontSize: 13, color: '#b91c1c', textDecorationLine: 'underline' },
  message: { fontSize: 13, color: '#14532d' },
  problem: { fontSize: 13, color: '#b91c1c' },
});
