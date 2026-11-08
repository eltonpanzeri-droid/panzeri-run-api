// 08/11/2026 — histórico de telas do Panzeri Run (parte pura, sem React).
// Antes não existia: o aplicativo guardava só a tela atual (`activeTab`), então o botão voltar do Android
// fechava o aplicativo, o voltar do navegador (PWA) saía do site, e muitas telas não tinham botão "Voltar".
// Regras (testadas em apps/api/test/tab-history.spec.ts):
// - ir para uma tela nova empilha a tela de onde saiu;
// - ir para a tela que está no topo da pilha DESFAZ o passo (evita vai-e-volta infinito entre duas telas);
// - ir para a tela raiz (início) zera a pilha;
// - a pilha tem limite para não crescer sem fim.
export const TAB_HISTORY_LIMIT = 30;

export type TabHistoryState<T extends string> = { current: T; stack: T[] };

export function tabHistoryInitial<T extends string>(initial: T): TabHistoryState<T> {
  return { current: initial, stack: [] };
}

export function tabHistoryGo<T extends string>(state: TabHistoryState<T>, next: T, root: T): TabHistoryState<T> {
  if (next === state.current) return state;
  if (next === root) return { current: root, stack: [] };
  const top = state.stack[state.stack.length - 1];
  if (top === next) return { current: next, stack: state.stack.slice(0, -1) };
  const stack = [...state.stack, state.current];
  return { current: next, stack: stack.length > TAB_HISTORY_LIMIT ? stack.slice(stack.length - TAB_HISTORY_LIMIT) : stack };
}

/** Volta um passo. Devolve null quando não há para onde voltar. */
export function tabHistoryBack<T extends string>(state: TabHistoryState<T>): TabHistoryState<T> | null {
  if (!state.stack.length) return null;
  return { current: state.stack[state.stack.length - 1], stack: state.stack.slice(0, -1) };
}
