import { Platform } from 'react-native';
import type { SnapshotLite } from './insights';

// Mesmo padrao de URL ja' duplicado em HomeScreen/MedalsScreen (nao extraido de App.tsx de
// proposito, ver nota em HomeScreen.tsx).
export const HOME_API_URL = Platform.OS === 'web' ? '/api' : 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';

export async function fetchJsonAuth<T>(path: string, accessToken: string): Promise<T | null> {
  try {
    const res = await fetch(`${HOME_API_URL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchSnapshots(ids: string[], accessToken: string): Promise<Record<string, SnapshotLite | null>> {
  const results = await Promise.all(ids.map((id) => fetchJsonAuth<SnapshotLite>(`/me/observations/${id}`, accessToken)));
  const map: Record<string, SnapshotLite | null> = {};
  ids.forEach((id, i) => { map[id] = results[i]; });
  return map;
}
