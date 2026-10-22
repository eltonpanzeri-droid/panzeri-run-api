// Leitura do Health Connect em SEGUNDO PLANO (22/10/2026). So' Android. Depende de DUAS permissoes da aluna: a autorizacao do Panzeri Run (consentimento por categoria no servidor,
// conferido a CADA execucao: sem autorizacao nada e' lido) e o acesso em segundo plano do proprio Android (janela do sistema, concedida pela aluna). O Android decide quando a tarefa
// roda (no minimo a cada ~15 min, respeitando bateria e rede); se nao houver sessao valida, a execucao termina sem fazer nada.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { accessTokenExpiresAtMs } from './contract';
import { buildHealthConnectSync } from './useHealthConnect';
import { createNativeHealthConnectGateway } from './gateway';

export const HC_BACKGROUND_TASK = 'panzeri-run-health-connect-sync';
const AUTH_SESSION_KEY = 'panzeri-run-auth-session'; // mesma chave do App.tsx
const NATIVE_API_URL = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host'; // nativo usa a URL absoluta (ver API_URL em App.tsx)
const MIN_INTERVAL_MINUTES = 60;
const RENEW_BEFORE_MS = 5 * 60 * 1000;

interface StoredSession { email: string; name: string; accessToken: string; refreshToken: string }

async function readSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredSession>) : null;
    return parsed?.accessToken && parsed.refreshToken ? (parsed as StoredSession) : null;
  } catch { return null; }
}

// A tarefa NUNCA renova a sessao (revisao independente, 22/10/2026): o servidor guarda UM refresh token por aluna e a troca nao e' atomica, entao renovar em segundo plano poderia
// deslogar a aluna, ressuscitar um logout ou sobrescrever outra conta. Ela so' usa o access token vigente (12 h, renovado pelo proprio app ao abrir); vencido, pula e a
// sincronizacao acontece quando a aluna abre o app.
function usableAccessToken(session: StoredSession): string | null {
  const expiresAt = accessTokenExpiresAtMs(session.accessToken);
  return expiresAt !== null && expiresAt - Date.now() > RENEW_BEFORE_MS ? session.accessToken : null;
}

export async function runBackgroundSync(): Promise<'ok' | 'skipped'> {
  if (Platform.OS !== 'android') return 'skipped';
  const session = await readSession();
  if (!session) return 'skipped';
  // So' le em segundo plano se o Android ainda concede esse acesso (a aluna pode ter retirado).
  const gateway = createNativeHealthConnectGateway();
  if (!(await gateway.hasBackgroundAccess?.())) return 'skipped';
  const token = usableAccessToken(session);
  if (!token) return 'skipped';
  const sync = buildHealthConnectSync(token, NATIVE_API_URL);
  if (!sync) return 'skipped';
  // Nao interativo: em segundo plano nunca aparece janela de confirmacao. As autorizacoes sao consultadas no servidor dentro do proprio syncNow (fail-closed).
  await sync.syncNow({ interactive: false });
  return 'ok';
}

if (Platform.OS === 'android') {
  TaskManager.defineTask(HC_BACKGROUND_TASK, async () => {
    try {
      await runBackgroundSync();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function enableBackgroundSync(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await BackgroundTask.registerTaskAsync(HC_BACKGROUND_TASK, { minimumInterval: MIN_INTERVAL_MINUTES });
}

export async function disableBackgroundSync(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try { await BackgroundTask.unregisterTaskAsync(HC_BACKGROUND_TASK); } catch { /* ja' nao estava registrada */ }
}

export async function isBackgroundSyncRegistered(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try { return await TaskManager.isTaskRegisteredAsync(HC_BACKGROUND_TASK); } catch { return false; }
}
