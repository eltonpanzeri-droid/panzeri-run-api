// Convite para baixar o Panzeri Run na loja (08/11/2026, pedido de Elton). Parte pura: detecta o celular, monta os links e decide quando mostrar de novo.
// O aviso so' aparece no navegador/PWA (Platform.OS === 'web'): quem ja instalou pela loja nunca o ve.
export type InvitePlatform = 'ios' | 'android' | 'other';

export const NATIVE_INVITE_DISMISS_KEY = 'panzeri:nativeInviteDismissed:v1';
export const NATIVE_INVITE_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;

export function detectInvitePlatform(userAgent: string): InvitePlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

export function shouldShowNativeInvite(dismissedAtMs: number | null, nowMs: number): boolean {
  if (dismissedAtMs == null || !Number.isFinite(dismissedAtMs)) return true;
  return nowMs - dismissedAtMs >= NATIVE_INVITE_REPEAT_MS;
}

export function nativeInviteStores(apiUrl: string, platform: InvitePlatform): Array<{ key: 'apple' | 'play'; label: string; url: string }> {
  const base = apiUrl.replace(/\/+$/, '');
  const utm = 'utm_source=pwa&utm_medium=aviso&utm_campaign=pwa_para_nativo';
  const apple = { key: 'apple' as const, label: 'Baixar na App Store', url: `${base}/ir/apple?${utm}` };
  const play = { key: 'play' as const, label: 'Baixar no Google Play', url: `${base}/ir/play?${utm}` };
  if (platform === 'ios') return [apple];
  if (platform === 'android') return [play];
  return [apple, play];
}
