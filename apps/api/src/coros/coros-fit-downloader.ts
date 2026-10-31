import { Injectable } from '@nestjs/common';
import { firstFitUrl } from './coros-sport-records';

const TIMEOUT_MS = 60_000;
const MAX_BYTES = 25 * 1024 * 1024;

export type CorosDownloadResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; kind: 'invalid_url' | 'not_found' | 'expired' | 'transient' | 'network' | 'too_large' };

// Download do arquivo FIT por um link que a COROS devolve em TEXTO (queryActivityFitFileDownloadUrls). O link e' temporario e NAO leva o token da aluna (nunca enviamos Authorization a um
// endereco que veio no corpo de uma resposta). So' https com nome de host de DNS; sem credenciais na URL; o arquivo existe apenas em memoria. Nunca lanca; a mensagem nunca carrega a URL.
@Injectable()
export class CorosFitDownloader {
  async download(urlText: string): Promise<CorosDownloadResult> {
    const url = firstFitUrl(urlText);
    if (!url) return { ok: false, kind: 'invalid_url' };
    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers: { Accept: 'application/octet-stream' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return { ok: false, kind: 'network' };
    }
    if (response.status === 404) return { ok: false, kind: 'not_found' };
    if (response.status === 403 || response.status === 410) return { ok: false, kind: 'expired' };
    if (!response.ok) return { ok: false, kind: 'transient' };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, kind: 'too_large' };
    try {
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, kind: 'network' };
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) { await reader.cancel().catch(() => undefined); return { ok: false, kind: 'too_large' }; }
        chunks.push(Buffer.from(value));
      }
      return { ok: true, buffer: Buffer.concat(chunks) };
    } catch {
      return { ok: false, kind: 'network' };
    }
  }
}
