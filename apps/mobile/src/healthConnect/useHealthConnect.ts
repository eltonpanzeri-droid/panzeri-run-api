// Liga o orquestrador puro ao app: armazenamento local, chamadas autenticadas a API e sincronizacao automatica ao abrir/voltar para o app.
// Nunca pede permissao sozinho e nao ha sincronizacao em segundo plano: so' com o app aberto.
// 22/10/2026: a leitura e' GUIADA pelas autorizacoes da aluna gravadas no servidor (GET /health-connect/permissions). Se nao for possivel consulta-las, nada e' lido.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import { ExercisePayload, ImportResponse, userIdFromAccessToken } from './contract';
import { createNativeHealthConnectGateway } from './gateway';
import type { HealthRecordPayload } from './healthRecords';
import type { RoutePayload } from './route';
import { AuthorizedCategories, createHealthConnectSync, SyncStore } from './sync';

const store: SyncStore = {
  async get(key) { try { return await AsyncStorage.getItem(key); } catch { return null; } },
  async set(key, value) { try { await AsyncStorage.setItem(key, value); } catch { /* sem armazenamento: proxima sincronizacao relê a janela */ } },
  async remove(key) { try { await AsyncStorage.removeItem(key); } catch { /* idem */ } },
};

interface ConsentDocument { groups: Array<{ id: string; categories: string[] }> }
interface PermissionsState { connected: boolean; groups: Array<{ id: string; granted: boolean }>; purposes: Array<{ id: string; granted: boolean }> }

// Categorias que a aluna autorizou AGORA (grupo concedido -> categorias do grupo, conforme o documento vigente) e se autorizou o historico anterior. Erro de rede => lanca (nada e' lido).
export async function fetchAuthorizedCategories(apiUrl: string, accessToken: string): Promise<AuthorizedCategories> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [docResponse, permResponse] = await Promise.all([fetch(`${apiUrl}/health-connect/consent`, { headers }), fetch(`${apiUrl}/health-connect/permissions`, { headers })]);
  if (!docResponse.ok || !permResponse.ok) throw new Error('health-connect-consent-unavailable');
  const doc = (await docResponse.json()) as ConsentDocument;
  const perms = (await permResponse.json()) as PermissionsState;
  if (!perms.connected) return { categories: new Set(), history: false };
  const granted = new Set(perms.groups.filter((g) => g.granted).map((g) => g.id));
  const categories = new Set<string>();
  for (const group of doc.groups) if (granted.has(group.id)) for (const category of group.categories) categories.add(category);
  return { categories, history: perms.purposes.some((p) => p.id === 'history_backfill' && p.granted) };
}

// Monta o orquestrador de um aluno (usado pela tela, pela sincronizacao ao abrir e pela tarefa em SEGUNDO PLANO).
export function buildHealthConnectSync(accessToken: string, apiUrl: string) {
    const userId = userIdFromAccessToken(accessToken);
    if (!userId) return null;
    return createHealthConnectSync({
      hc: createNativeHealthConnectGateway(),
      store,
      userId,
      getAuthorizedCategories: () => fetchAuthorizedCategories(apiUrl, accessToken),
      async postExercises(items: ExercisePayload[]) {
        const response = await fetch(`${apiUrl}/health-connect/exercises`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ exercises: items }),
        });
        if (!response.ok) throw new Error(`health-connect-api-${response.status}`);
        return (await response.json()) as ImportResponse;
      },
      async postHealthRecords(items: HealthRecordPayload[]) {
        const response = await fetch(`${apiUrl}/health-connect/health-records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ records: items }),
        });
        if (!response.ok) throw new Error(`health-connect-api-${response.status}`);
        return (await response.json()) as { stored: number; rejected: number; items?: Array<{ status: string; reason?: string }> };
      },
      async postRoutes(items: RoutePayload[]) {
        const response = await fetch(`${apiUrl}/health-connect/routes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ routes: items }),
        });
        if (!response.ok) throw new Error(`health-connect-api-${response.status}`);
        return (await response.json()) as { stored: number; rejected: number; items?: Array<{ recordId: string; status: string; reason?: string }> };
      },
    });
}

export function useHealthConnectSync(accessToken: string | null | undefined, apiUrl: string) {
  return useMemo(() => {
    if (Platform.OS !== 'android' || !accessToken) return null;
    return buildHealthConnectSync(accessToken, apiUrl);
  }, [accessToken, apiUrl]);
}

// Sincroniza ao abrir o app e ao voltar para ele, respeitando o intervalo minimo. Falhas sao silenciosas (a tela de integracao mostra o estado).
export function useHealthConnectAutoSync(accessToken: string | null | undefined, apiUrl: string) {
  const sync = useHealthConnectSync(accessToken, apiUrl);
  useEffect(() => {
    if (!sync) return;
    void sync.autoSyncOnOpen().catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync.autoSyncOnOpen().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [sync]);
}
