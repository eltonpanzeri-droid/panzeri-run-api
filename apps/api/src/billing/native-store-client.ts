// Cliente nativo (app da Google Play / App Store) pelo User-Agent da camada de rede do React Native: Android = okhttp, iOS = CFNetwork/Darwin.
// PWA e navegador mandam "Mozilla/5.0 ..." e nunca casam. Regra de Elton (09/11/2026): app nativo nao cria cobranca no Asaas.
export function isNativeStoreClient(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return /okhttp|CFNetwork|Darwin\//i.test(userAgent) && !/Mozilla\//i.test(userAgent);
}
