// Teclado cobrindo o campo de texto (09/11/2026): quando o teclado abre, a folha do modal precisa caber ACIMA dele. Puro e testavel; o hook useKeyboardHeight informa a altura do teclado.

// Altura maxima da folha com o teclado aberto: janela - teclado - espaco acima da folha - folga. Nunca menor que o minimo (200) para o campo continuar visivel.
export function availableSheetHeight(windowHeight: number, keyboardHeight: number, topOffset: number, margin = 12, minHeight = 200): number {
  return Math.max(minHeight, Math.round(windowHeight - keyboardHeight - topOffset - margin));
}

// Altura da area coberta pelo teclado na web (iPhone/Android pelo navegador): o teclado encolhe o visualViewport, nao a janela.
export function coveredByKeyboard(innerHeight: number, viewportHeight: number, viewportOffsetTop: number, threshold = 80): number {
  const covered = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
  return covered > threshold ? covered : 0;
}
