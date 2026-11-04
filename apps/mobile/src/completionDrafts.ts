// Rascunho do feedback do treino (04/11/2026). Bug real relatado por uma aluna: ao tocar em "Relatar dor em detalhes" dentro do feedback, o app trocava de aba, o formulario era desmontado e, ao terminar o
// relato de dor, nao havia como voltar: o feedback inteiro (longo) se perdia. Aqui fica a parte PURA (sem React Native) do rascunho: chave, empacotamento e validade. O armazenamento real
// (AsyncStorage + memoria do processo) esta em completionDraftsStorage.ts. O rascunho so' existe enquanto o feedback nao foi enviado; ao enviar, e' apagado.

export const COMPLETION_DRAFT_MAX_AGE_MS = 14 * 24 * 3600_000;

export const completionDraftKey = (sessionId: string) => `panzeri:completionDraft:v1:${sessionId}`;

export function packCompletionDraft<T>(draft: T, now: number = Date.now()): string {
  return JSON.stringify({ savedAt: now, draft });
}

/** Devolve o rascunho guardado, ou null se nao existir, estiver corrompido, for de data futura invalida ou tiver mais de 14 dias. */
export function unpackCompletionDraft<T>(raw: string | null | undefined, now: number = Date.now()): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown; draft?: unknown };
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number' || !parsed.draft || typeof parsed.draft !== 'object' || Array.isArray(parsed.draft)) return null;
    const age = now - parsed.savedAt;
    if (age < 0 || age > COMPLETION_DRAFT_MAX_AGE_MS) return null;
    return parsed.draft as T;
  } catch {
    return null;
  }
}
