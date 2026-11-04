import AsyncStorage from '@react-native-async-storage/async-storage';
import { completionDraftKey, packCompletionDraft, unpackCompletionDraft } from './completionDrafts';

// Armazenamento do rascunho do feedback (04/11/2026). A memoria do processo (Map no escopo do modulo) sobrevive a troca de aba mesmo que o AsyncStorage falhe; o AsyncStorage sobrevive a fechar o app.
// Nada aqui lanca erro para a tela: se o armazenamento falhar, o app segue como antes (so' sem a protecao extra).
const memory = new Map<string, string>();

export async function persistCompletionDraft(sessionId: string, draft: unknown): Promise<void> {
  const key = completionDraftKey(sessionId);
  const raw = packCompletionDraft(draft);
  memory.set(key, raw);
  try { await AsyncStorage.setItem(key, raw); } catch { /* sem armazenamento: fica so' na memoria */ }
}

export async function restoreCompletionDrafts<T>(sessionIds: string[]): Promise<Record<string, T>> {
  const restored: Record<string, T> = {};
  for (const sessionId of sessionIds) {
    const key = completionDraftKey(sessionId);
    let raw: string | null | undefined = memory.get(key);
    if (!raw) {
      try { raw = await AsyncStorage.getItem(key); } catch { raw = null; }
    }
    const draft = unpackCompletionDraft<T>(raw);
    if (draft) restored[sessionId] = draft;
  }
  return restored;
}

export async function clearCompletionDraft(sessionId: string): Promise<void> {
  const key = completionDraftKey(sessionId);
  memory.delete(key);
  try { await AsyncStorage.removeItem(key); } catch { /* ignora */ }
}
