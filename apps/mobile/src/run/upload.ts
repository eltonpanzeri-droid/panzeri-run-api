// Envio do treino gravado ao servidor (POST /me/run/activities), com a fila de pendentes (21/11/2026). O servidor e' idempotente pelo clientId, entao reenviar nunca duplica. O que o servidor guarda depende da
// autorizacao da aluna (grupos "Treinos gravados" e "Percurso GPS"): sem autorizacao ele responde 403 run_consent_required e o treino fica guardado no aparelho ate ela autorizar.
import { RunState } from './engine';
import { buildRunUploadBody } from './payload';
import { RunStorage } from './storage';

export type UploadOutcome = 'sent' | 'consent_required' | 'rejected' | 'failed' | 'missing';

export async function uploadRun(input: { apiUrl: string; accessToken: string; runId: string; storage: RunStorage; fetchImpl?: typeof fetch }): Promise<UploadOutcome> {
  const { storage, runId } = input;
  const state: RunState | null = await storage.loadState(runId);
  if (!state || state.phase !== 'finished') return 'missing';
  const points = await storage.loadPoints(runId);
  // fuso do aparelho no inicio do treino, no sinal do servidor (leste positivo)
  const body = buildRunUploadBody(state, points, -new Date(state.startedAt).getTimezoneOffset());
  try {
    const response = await (input.fetchImpl ?? fetch)(`${input.apiUrl}/me/run/activities`, {
      method: 'POST', headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as { stored?: boolean; reason?: string };
      await storage.removePending(runId); // enviado (ou ja' excluido pela aluna: o servidor nao quer de volta)
      return data.stored === false && data.reason !== 'excluded' ? 'failed' : 'sent';
    }
    const error = (await response.json().catch(() => ({}))) as { code?: string };
    if (response.status === 403 && error.code === 'run_consent_required') return 'consent_required';
    // 400/413: o servidor nunca vai aceitar este corpo; sai da fila para nao tentar para sempre (os dados continuam no aparelho)
    if (response.status === 400 || response.status === 413) { await storage.removePending(runId); return 'rejected'; }
    return 'failed';
  } catch {
    return 'failed'; // sem internet: fica na fila
  }
}

// Reenvia tudo que ficou pendente (chamado ao abrir o Iniciar treino e depois de autorizar).
export async function uploadAllPending(input: { apiUrl: string; accessToken: string; storage: RunStorage; fetchImpl?: typeof fetch }): Promise<Record<string, UploadOutcome>> {
  const results: Record<string, UploadOutcome> = {};
  for (const runId of await input.storage.listPending()) results[runId] = await uploadRun({ ...input, runId });
  return results;
}
