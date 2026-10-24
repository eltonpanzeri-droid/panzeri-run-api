// Atualizacao automatica do PWA (24/10/2026) — LOGICA PURA (sem React Native, para ser testada).
// O bundle web tem nome com hash (/_expo/static/js/web/index-<hash>.js): se o nome publicado difere do que esta rodando, ha versao nova.

const BUNDLE_PATH = /\/_expo\/static\/js\/web\/(index-[A-Za-z0-9_-]+\.js)(?:[?#]|$)/;

// Nome do bundle principal a partir do src de UM script (null se nao for o bundle principal).
export function bundleNameFromSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  return BUNDLE_PATH.exec(src)?.[1] ?? null;
}

// Nome do bundle principal a partir do HTML publicado (null se nao houver; outros scripts sao ignorados).
export function extractBundleName(html: string): string | null {
  const tag = /<script\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    const name = bundleNameFromSrc(match[1] ?? match[2]);
    if (name) return name;
  }
  return null;
}

export type UpdateAction = 'none' | 'reload' | 'banner';

// Decide o que fazer ao comparar a versao em execucao com a publicada.
//  - sem nome de algum dos lados, ou iguais: nada (nunca age sem certeza);
//  - ja recarregamos para ESTA versao e ainda difere: so avisa (nunca laco de recarga);
//  - aluna digitando: so avisa; senao: recarrega uma vez.
export function decideUpdateAction(input: { running: string | null; published: string | null; isTyping: boolean; reloadedFor: string | null }): UpdateAction {
  const { running, published, isTyping, reloadedFor } = input;
  if (!running || !published || running === published) return 'none';
  if (reloadedFor === published) return 'banner';
  return isTyping ? 'banner' : 'reload';
}
