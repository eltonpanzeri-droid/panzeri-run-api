import { Injectable } from '@nestjs/common';
import { isAllowedCallbackUrl } from './zepp-webhook';

const TIMEOUT_MS = 60_000; // a Zepp recomenda no minimo 60 s
const MAX_BYTES = 25 * 1024 * 1024;

export type ZeppDownloadResult =
  | { ok: true; buffer: Buffer }
  // expired = 410 (token de uso unico expirou/ja usado); not_found = 404; auth = 401 (token do aluno); forbidden = 403; bad_request = 400;
  // transient = 5xx/503; network = nao chegou; too_large = acima do teto; invalid_url = callbackURL fora do host oficial (nada foi enviado).
  | { ok: false; kind: 'expired' | 'not_found' | 'auth' | 'forbidden' | 'bad_request' | 'transient' | 'network' | 'too_large' | 'invalid_url'; httpStatus: number | null };

// Download do FIT (documentacao Zepp, "Download FIT File"): GET na callbackURL EXATAMENTE como recebida, com `Authorization: Bearer <token do aluno>` e
// `Accept: application/octet-stream`; resposta e' o binario. O token do aluno so' vai para o host oficial (validado), nunca segue redirecionamento e o
// arquivo existe apenas em memoria (nao e' gravado em disco nem no banco). Nunca lanca; a mensagem nunca carrega token nem URL.
@Injectable()
export class ZeppFitDownloader {
  async download(accessToken: string, callbackUrl: string): Promise<ZeppDownloadResult> {
    if (!isAllowedCallbackUrl(callbackUrl)) return { ok: false, kind: 'invalid_url', httpStatus: null };
    let response: Response;
    try {
      response = await fetch(callbackUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/octet-stream' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, kind: 'network', httpStatus: null };
    }
    const status = response.status;
    if (status === 410) return { ok: false, kind: 'expired', httpStatus: status };
    if (status === 404) return { ok: false, kind: 'not_found', httpStatus: status };
    if (status === 401) return { ok: false, kind: 'auth', httpStatus: status };
    if (status === 403) return { ok: false, kind: 'forbidden', httpStatus: status };
    if (status === 400) return { ok: false, kind: 'bad_request', httpStatus: status };
    if (status !== 200) return { ok: false, kind: 'transient', httpStatus: status };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, kind: 'too_large', httpStatus: status };
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, kind: 'network', httpStatus: status };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) { await reader.cancel().catch(() => undefined); return { ok: false, kind: 'too_large', httpStatus: status }; }
        chunks.push(Buffer.from(value));
      }
      return { ok: true, buffer: Buffer.concat(chunks) };
    } catch {
      return { ok: false, kind: 'network', httpStatus: status };
    }
  }
}
