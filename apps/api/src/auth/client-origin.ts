// Origem do cliente no cadastro. Usada para NAO enviar dados a Meta (Conversions API) quando o cadastro vem do aplicativo iPhone: a primeira versao do app
// na App Store nao faz rastreamento publicitario. Site (PWA) e Android nao sao afetados.
//  - cabecalho explicito X-Client-Platform: ios-app (enviado pelo app iOS a partir do build 6);
//  - build 5 (sem cabecalho): o app nativo iOS usa o cliente de rede do sistema (user agent "...CFNetwork/... Darwin/...", sem "Mozilla"), enquanto o
//    Safari/PWA do iPhone se identifica como navegador ("Mozilla/5.0 (iPhone...").
export function isIosAppOrigin(userAgent?: string, platformHeader?: string | string[]): boolean {
  const header = Array.isArray(platformHeader) ? platformHeader[0] : platformHeader;
  if (typeof header === 'string' && header.trim().toLowerCase() === 'ios-app') return true;
  if (typeof userAgent !== 'string') return false;
  return /CFNetwork|Darwin/i.test(userAgent) && !/Mozilla/i.test(userAgent);
}
