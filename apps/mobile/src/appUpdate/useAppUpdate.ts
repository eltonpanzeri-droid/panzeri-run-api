import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { bundleNameFromSrc, decideUpdateAction, extractBundleName } from './bundleName';

// Atualizacao automatica do PWA (24/10/2026). No iPhone, sair e voltar ao app so' RETOMA o JS antigo em memoria; aqui o app confere sozinho se ha versao nova e se atualiza.
// So' age na web (no app nativo nao faz nada). Falha de rede nunca faz nada nem mostra erro.
const MIN_BACKGROUND_MS = 30_000;
const POLL_MS = 15 * 60_000;
const RELOADED_KEY = 'panzeri-update-reloaded-for';

function runningBundleName(): string | null {
  if (typeof document === 'undefined') return null;
  for (const script of Array.from(document.querySelectorAll('script[src]'))) {
    const name = bundleNameFromSrc((script as HTMLScriptElement).src);
    if (name) return name;
  }
  return null;
}

function isTypingNow(): boolean {
  const el = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

function readReloadedFor(): string | null {
  try { return window.sessionStorage.getItem(RELOADED_KEY); } catch { return null; }
}

export function useAppUpdate(): { updateAvailable: boolean; applyUpdate: () => void } {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const checking = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const published = useRef<string | null>(null);

  const applyUpdate = useCallback(() => {
    try { if (published.current) window.sessionStorage.setItem(RELOADED_KEY, published.current); } catch { /* sem sessionStorage: o aviso segue valendo */ }
    window.location.reload();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const response = await fetch('/', { cache: 'no-store' });
        if (!response.ok) return;
        const name = extractBundleName(await response.text());
        published.current = name;
        const action = decideUpdateAction({ running: runningBundleName(), published: name, isTyping: isTypingNow(), reloadedFor: readReloadedFor() });
        if (action === 'reload') applyUpdate();
        else if (action === 'banner') setUpdateAvailable(true);
      } catch {
        /* sem rede ou resposta invalida: nada acontece */
      } finally {
        checking.current = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      if (hiddenAt.current != null && Date.now() - hiddenAt.current >= MIN_BACKGROUND_MS) void check();
      hiddenAt.current = null;
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check(); // pagina restaurada do cache de navegacao (volta de outro app)
    };

    void check();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.clearInterval(timer);
    };
  }, [applyUpdate]);

  return { updateAvailable, applyUpdate };
}
