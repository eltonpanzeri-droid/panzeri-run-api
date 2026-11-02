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

// 02/11/2026: `reference` anexa a serie de referencias do servidor (faixa habitual) e `modality` filtra pela modalidade — os mesmos filtros do painel do treinador.
export function fetchSnapshot(id: string, accessToken: string, options: { reference?: boolean; modality?: string | null; source?: string | null } = {}): Promise<SnapshotLite | null> {
  const query = [options.reference ? 'reference=1' : '', options.modality ? `modalities=${encodeURIComponent(options.modality)}` : '', options.source ? `source=${encodeURIComponent(options.source)}` : ''].filter(Boolean).join('&');
  return fetchJsonAuth<SnapshotLite>(`/me/observations/${id}${query ? `?${query}` : ''}`, accessToken);
}

export async function fetchSnapshots(ids: string[], accessToken: string, options: { reference?: boolean } = {}): Promise<Record<string, SnapshotLite | null>> {
  const results = await Promise.all(ids.map((id) => fetchSnapshot(id, accessToken, options)));
  const map: Record<string, SnapshotLite | null> = {};
  ids.forEach((id, i) => { map[id] = results[i]; });
  return map;
}
