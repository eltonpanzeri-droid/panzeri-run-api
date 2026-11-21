// Guarda local do treino em andamento e dos treinos ainda nao enviados (21/11/2026). Os pontos de GPS sao gravados em BLOCOS pequenos assim que chegam (nada fica so' na memoria): se o aplicativo for fechado,
// o iOS/Android parar a gravacao ou a bateria acabar, o que ja' foi gravado volta ao reabrir. O armazenamento entra por interface (AsyncStorage no aparelho; um mapa em memoria nos testes). Sem rede aqui.
import { RecordedPoint, RunState } from './engine';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const RUN_STORAGE = { chunkSize: 60, prefix: 'panzeri-run:run:', activeKey: 'panzeri-run:run:active', pendingKey: 'panzeri-run:run:pending' } as const;

const metaKey = (runId: string) => `${RUN_STORAGE.prefix}${runId}:state`;
const countKey = (runId: string) => `${RUN_STORAGE.prefix}${runId}:chunks`;
const chunkKey = (runId: string, index: number) => `${RUN_STORAGE.prefix}${runId}:chunk:${index}`;

const parse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

export class RunStorage {
  constructor(private readonly store: KeyValueStore) {}

  // Estado do treino (contadores, etapa, pausa). Gravado a cada lote de pontos e a cada comando da aluna.
  async saveState(state: RunState): Promise<void> {
    await this.store.setItem(metaKey(state.runId), JSON.stringify(state));
  }
  async loadState(runId: string): Promise<RunState | null> {
    const state = parse<RunState | null>(await this.store.getItem(metaKey(runId)), null);
    // estados gravados antes de stepLog existir continuam validos (lista vazia)
    return state && state.schemaVersion === 1 && state.runId === runId ? { ...state, stepLog: state.stepLog ?? [] } : null;
  }

  // Acrescenta pontos aceitos: preenche o ultimo bloco e abre novos (cada bloco e' reescrito inteiro, mas tem no maximo chunkSize pontos).
  async appendPoints(runId: string, points: RecordedPoint[]): Promise<void> {
    if (points.length === 0) return;
    let count = parse<number>(await this.store.getItem(countKey(runId)), 0);
    let current = count > 0 ? parse<RecordedPoint[]>(await this.store.getItem(chunkKey(runId, count - 1)), []) : [];
    if (count === 0) count = 1;
    for (const point of points) {
      if (current.length >= RUN_STORAGE.chunkSize) {
        await this.store.setItem(chunkKey(runId, count - 1), JSON.stringify(current));
        current = [];
        count += 1;
      }
      current.push(point);
    }
    await this.store.setItem(chunkKey(runId, count - 1), JSON.stringify(current));
    await this.store.setItem(countKey(runId), String(count));
  }
  async loadPoints(runId: string): Promise<RecordedPoint[]> {
    const count = parse<number>(await this.store.getItem(countKey(runId)), 0);
    const all: RecordedPoint[] = [];
    for (let i = 0; i < count; i += 1) all.push(...parse<RecordedPoint[]>(await this.store.getItem(chunkKey(runId, i)), []));
    return all;
  }

  async setActive(runId: string | null): Promise<void> {
    if (runId === null) await this.store.removeItem(RUN_STORAGE.activeKey);
    else await this.store.setItem(RUN_STORAGE.activeKey, runId);
  }
  async getActive(): Promise<string | null> {
    return this.store.getItem(RUN_STORAGE.activeKey);
  }

  // Treinos encerrados que ainda nao chegaram ao servidor (sem internet, erro, ou falta de autorizacao). Reenviados depois (o servidor e' idempotente pelo clientId).
  async listPending(): Promise<string[]> {
    return parse<string[]>(await this.store.getItem(RUN_STORAGE.pendingKey), []);
  }
  async addPending(runId: string): Promise<void> {
    const list = await this.listPending();
    if (!list.includes(runId)) await this.store.setItem(RUN_STORAGE.pendingKey, JSON.stringify([...list, runId]));
  }
  async removePending(runId: string): Promise<void> {
    const list = (await this.listPending()).filter((id) => id !== runId);
    await this.store.setItem(RUN_STORAGE.pendingKey, JSON.stringify(list));
  }

  // Apaga tudo do treino (depois de enviado e confirmado, ou quando a aluna descarta).
  async clear(runId: string): Promise<void> {
    const count = parse<number>(await this.store.getItem(countKey(runId)), 0);
    for (let i = 0; i < count; i += 1) await this.store.removeItem(chunkKey(runId, i));
    await this.store.removeItem(countKey(runId));
    await this.store.removeItem(metaKey(runId));
    await this.removePending(runId);
    if ((await this.getActive()) === runId) await this.setActive(null);
  }
}
