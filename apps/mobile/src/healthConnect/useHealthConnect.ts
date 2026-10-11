// Liga o orquestrador puro ao app: armazenamento local, chamada autenticada a API e sincronizacao automatica ao abrir/voltar para o app.
// Nunca pede permissao sozinho e nao ha sincronizacao em segundo plano: so' com o app aberto.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import { ExercisePayload, ImportResponse, userIdFromAccessToken } from './contract';
import { createNativeHealthConnectGateway } from './gateway';
import { createHealthConnectSync, SyncStore } from './sync';

const store: SyncStore = {
  async get(key) { try { return await AsyncStorage.getItem(key); } catch { return null; } },
  async set(key, value) { try { await AsyncStorage.setItem(key, value); } catch { /* sem armazenamento: proxima sincronizacao relê a janela */ } },
  async remove(key) { try { await AsyncStorage.removeItem(key); } catch { /* idem */ } },
};

export function useHealthConnectSync(accessToken: string | null | undefined, apiUrl: string) {
  return useMemo(() => {
    if (Platform.OS !== 'android' || !accessToken) return null;
    const userId = userIdFromAccessToken(accessToken);
    if (!userId) return null;
    return createHealthConnectSync({
      hc: createNativeHealthConnectGateway(),
      store,
      userId,
      async postExercises(items: ExercisePayload[]) {
        const response = await fetch(`${apiUrl}/health-connect/exercises`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ exercises: items }),
        });
        if (!response.ok) throw new Error(`health-connect-api-${response.status}`);
        return (await response.json()) as ImportResponse;
      },
    });
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
