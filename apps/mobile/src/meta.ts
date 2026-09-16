const META_PIXEL_ID = (process.env.EXPO_PUBLIC_META_PIXEL_ID ?? '').trim();
let initialized = false;

export function initializeMetaPixel() {
  if (initialized || !META_PIXEL_ID || typeof document === 'undefined') return;
  initialized = true;
  const win = window as typeof window & { fbq?: (...args: unknown[]) => void; _fbq?: unknown };
  if (typeof win.fbq !== 'function') {
    const fbq = (...args: unknown[]) => {
      const fn = fbq as typeof fbq & { queue?: unknown[] };
      (fn.queue ??= []).push(args);
    };
    win.fbq = fbq;
    win._fbq = fbq;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }
  try { win.fbq?.('init', META_PIXEL_ID); } catch { /* analytics never blocks the app */ }
}

export function trackMetaEvent(event: 'CompleteRegistration' | 'QuickIntakeCompleted' | 'InitiateCheckout') {
  if (!META_PIXEL_ID || typeof window === 'undefined') return;
  initializeMetaPixel();
  try { (window as typeof window & { fbq?: (...args: unknown[]) => void }).fbq?.('track', event); } catch { /* analytics never blocks the app */ }
}
