import type { ScrollView } from 'react-native';

// Rolagem programatica da tela principal (09/11/2026): "Completar antes" (feedback pendente) leva a aluna ao cartao do treino. A tela principal registra aqui o seu ScrollView e a posicao atual;
// quem quiser rolar ate' um elemento passa a posicao dele NA JANELA (measureInWindow). Sem estado de React: um unico ScrollView principal por vez.

let scrollView: ScrollView | null = null;
let offsetY = 0;

export function registerAppScroll(ref: ScrollView | null) {
  scrollView = ref;
}

export function reportAppScrollOffset(y: number) {
  offsetY = y;
}

// Para onde rolar (puro, testavel): posicao atual + (topo do elemento - topo da area rolavel) - folga; nunca negativo.
export function targetScrollY(currentOffset: number, scrollTopInWindow: number, elementTopInWindow: number, margin = 12): number {
  return Math.max(0, currentOffset + (elementTopInWindow - scrollTopInWindow) - margin);
}

export function scrollAppToWindowY(elementTopInWindow: number, margin = 12): boolean {
  const view = scrollView as unknown as { measureInWindow?: (cb: (x: number, y: number) => void) => void; scrollTo?: (options: { y: number; animated: boolean }) => void } | null;
  if (!view || typeof view.measureInWindow !== 'function' || typeof view.scrollTo !== 'function') return false;
  const current = offsetY;
  view.measureInWindow((_x, top) => {
    view.scrollTo?.({ y: targetScrollY(current, top, elementTopInWindow, margin), animated: true });
  });
  return true;
}
