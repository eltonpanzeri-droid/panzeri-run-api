import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { tabHistoryBack, tabHistoryGo, tabHistoryInitial, type TabHistoryState } from './tabHistory';

// 08/11/2026 — navegação com histórico: botão voltar do Android, botão voltar do navegador (PWA) e `goBack` para o botão da tela.
// iPhone (aplicativo nativo) não tem botão voltar do sistema: lá vale o botão "Voltar" na tela.
type Options<T extends string> = {
  root: T;
  /** Telas em que o voltar do sistema não pode tirar a pessoa (ex.: etapas obrigatórias do cadastro). */
  locked: readonly T[];
  /** Chamado primeiro no voltar do sistema; devolva true se tratou (ex.: fechou o menu). */
  beforeBack?: () => boolean;
  enabled: boolean;
};

export function useTabHistory<T extends string>(initial: T, options: Options<T>) {
  const { root, locked, enabled } = options;
  const stateRef = useRef<TabHistoryState<T>>(tabHistoryInitial(initial));
  const [tab, setTabState] = useState<T>(initial);
  const [depth, setDepth] = useState(0);
  const beforeBackRef = useRef(options.beforeBack);
  beforeBackRef.current = options.beforeBack;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // Entradas que colocamos no histórico do navegador e ainda não foram consumidas (só PWA/web).
  const webDepthRef = useRef(0);
  const isWeb = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.history;

  const apply = useCallback((next: TabHistoryState<T>) => {
    stateRef.current = next;
    setTabState(next.current);
    setDepth(next.stack.length);
  }, []);

  const setTab = useCallback((next: T) => {
    const before = stateRef.current;
    const after = tabHistoryGo(before, next, root);
    if (after === before) return;
    apply(after);
    // Cada passo para a frente vira uma entrada no histórico do navegador, para o voltar dele funcionar.
    if (isWeb && after.stack.length > before.stack.length) {
      webDepthRef.current += 1;
      try { window.history.pushState({ pzDepth: webDepthRef.current }, ''); } catch { /* sem histórico: só o botão da tela */ }
    }
  }, [apply, isWeb, root]);

  /** Botão "Voltar" da tela. Sem histórico, vai para o início. */
  const goBack = useCallback(() => {
    if (lockedRef.current.includes(stateRef.current.current)) return;
    const back = tabHistoryBack(stateRef.current);
    apply(back ?? tabHistoryInitial(root));
  }, [apply, root]);

  // Android: botão voltar do sistema.
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (beforeBackRef.current?.()) return true;
      const current = stateRef.current;
      if (lockedRef.current.includes(current.current)) return true;
      const back = tabHistoryBack(current);
      if (back) { apply(back); return true; }
      if (current.current !== root) { apply(tabHistoryInitial(root)); return true; }
      return false; // já está no início: o Android fecha o aplicativo
    });
    return () => subscription.remove();
  }, [apply, enabled, root]);

  // PWA / navegador: botão voltar do navegador.
  useEffect(() => {
    if (!enabled || !isWeb) return undefined;
    const onPopState = (event: PopStateEvent) => {
      const target = Number((event.state as { pzDepth?: number } | null)?.pzDepth ?? 0);
      if (target >= webDepthRef.current) return; // "avançar" do navegador: ignora
      webDepthRef.current = target;
      if (beforeBackRef.current?.()) { try { window.history.pushState({ pzDepth: ++webDepthRef.current }, ''); } catch { /* ignora */ } return; }
      const current = stateRef.current;
      if (lockedRef.current.includes(current.current)) { try { window.history.pushState({ pzDepth: ++webDepthRef.current }, ''); } catch { /* ignora */ } return; }
      const back = tabHistoryBack(current);
      if (back) { apply(back); return; }
      // Sobrou entrada do navegador sem tela correspondente (ex.: foi ao início pelo menu): pula para a anterior.
      if (webDepthRef.current > 0) window.history.back();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [apply, enabled, isWeb]);

  return { tab, setTab, goBack, canGoBack: depth > 0 };
}
