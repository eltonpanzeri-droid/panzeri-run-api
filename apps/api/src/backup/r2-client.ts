import { createHash, createHmac } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import * as https from 'node:https';
import { pipeline } from 'stream/promises';

// Cliente minimo do Cloudflare R2 (API compativel com S3, assinatura AWS SigV4). Escrito sem dependencia nova
// (so' crypto + https): o backup precisa de apenas PUT, HEAD, GET, DELETE e LIST. A assinatura e' conferida
// por teste contra o vetor oficial de testes do AWS SigV4 (get-vanilla). Credenciais vem so' da configuracao.

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface R2Object { key: string; lastModified: Date; size: number }

export interface TransportRequest {
  method: string;
  host: string;
  path: string; // ja com query string
  headers: Record<string, string>;
  bodyFile?: string; // upload em streaming a partir de arquivo
  downloadTo?: string; // download em streaming para arquivo
}
export interface TransportResponse { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

const sha256Hex = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();
const awsEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const EMPTY_PAYLOAD_SHA256 = sha256Hex('');

export interface SignInput {
  method: string;
  path: string; // sem query
  query?: Record<string, string>;
  headers: Record<string, string>; // inclui host e x-amz-date; todos sao assinados
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  amzDate: string; // 20150830T123600Z
}

// Devolve o valor do cabecalho Authorization (SigV4).
export function signRequest(input: SignInput): string {
  const names = Object.keys(input.headers).map((h) => h.toLowerCase()).sort();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) lower[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  const canonicalQuery = Object.entries(input.query ?? {})
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery,
    names.map((n) => `${n}:${lower[n]}\n`).join(''),
    names.join(';'),
    input.payloadHash,
  ].join('\n');
  const date = input.amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), input.service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

export const defaultTransport: Transport = (request) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: request.host, path: request.path, method: request.method, headers: request.headers },
      (res) => {
        const headers = res.headers as TransportResponse['headers'];
        if (request.downloadTo && res.statusCode === 200) {
          pipeline(res, createWriteStream(request.downloadTo, { flags: 'wx', mode: 0o600 }))
            .then(() => resolve({ status: 200, headers, body: Buffer.alloc(0) }))
            .catch(reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (request.bodyFile) {
      pipeline(createReadStream(request.bodyFile), req).catch(reject);
    } else {
      req.end();
    }
  });

export class R2Client {
  private readonly host: string;

  constructor(private readonly config: R2Config, private readonly transport: Transport = defaultTransport, private readonly now: () => Date = () => new Date()) {
    this.host = `${config.accountId}.r2.cloudflarestorage.com`;
  }

  private objectPath(key?: string) {
    const base = `/${awsEncode(this.config.bucket)}`;
    return key === undefined ? base : `${base}/${key.split('/').map(awsEncode).join('/')}`;
  }

  private async send(method: string, key: string | undefined, opts: { query?: Record<string, string>; extraHeaders?: Record<string, string>; bodyFile?: string; payloadHash?: string; contentLength?: number; downloadTo?: string } = {}) {
    const amzDate = this.now().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const payloadHash = opts.payloadHash ?? EMPTY_PAYLOAD_SHA256;
    const signed: Record<string, string> = { host: this.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(opts.extraHeaders ?? {}) };
    const path = this.objectPath(key);
    const authorization = signRequest({
      method, path, query: opts.query, headers: signed, payloadHash,
      accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey,
      region: 'auto', service: 's3', amzDate,
    });
    const queryString = Object.entries(opts.query ?? {}).map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`).sort().join('&');
    const headers: Record<string, string> = { ...signed, Authorization: authorization };
    if (opts.contentLength !== undefined) headers['content-length'] = String(opts.contentLength);
    return this.transport({ method, host: this.host, path: queryString ? `${path}?${queryString}` : path, headers, bodyFile: opts.bodyFile, downloadTo: opts.downloadTo });
  }

  private static fail(operation: string, status: number): never {
    // So' a operacao e o status HTTP: nunca o corpo da resposta nem cabecalhos.
    throw new Error(`R2: ${operation} falhou (HTTP ${status}).`);
  }

  async putObjectFromFile(key: string, file: string, info: { size: number; sha256: string; md5: string }, metadata: Record<string, string> = {}) {
    const extraHeaders: Record<string, string> = { 'content-type': 'application/octet-stream' };
    for (const [k, v] of Object.entries(metadata)) extraHeaders[`x-amz-meta-${k.toLowerCase()}`] = v;
    const res = await this.send('PUT', key, { bodyFile: file, payloadHash: info.sha256, contentLength: info.size, extraHeaders });
    if (res.status < 200 || res.status >= 300) R2Client.fail('upload', res.status);
  }

  async headObject(key: string): Promise<{ size: number; etag: string | null } | null> {
    const res = await this.send('HEAD', key);
    if (res.status === 404) return null;
    if (res.status !== 200) R2Client.fail('verificacao', res.status);
    const size = Number(res.headers['content-length']);
    const etag = typeof res.headers['etag'] === 'string' ? (res.headers['etag'] as string).replace(/"/g, '') : null;
    return { size: Number.isFinite(size) ? size : -1, etag };
  }

  async getObjectToFile(key: string, dest: string) {
    const res = await this.send('GET', key, { downloadTo: dest });
    if (res.status !== 200) R2Client.fail('download', res.status);
  }

  async deleteObject(key: string) {
    const res = await this.send('DELETE', key);
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) R2Client.fail('exclusao', res.status);
  }

  async listObjects(prefix: string): Promise<R2Object[]> {
    const out: R2Object[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix };
      if (token) query['continuation-token'] = token;
      const res = await this.send('GET', undefined, { query });
      if (res.status !== 200) R2Client.fail('listagem', res.status);
      const xml = res.body.toString('utf8');
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(match[1])?.[1];
        const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(match[1])?.[1];
        const size = /<Size>(\d+)<\/Size>/.exec(match[1])?.[1];
        if (key && lastModified) out.push({ key: key.replace(/&amp;/g, '&'), lastModified: new Date(lastModified), size: Number(size ?? 0) });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
    } while (token);
    return out;
  }
}
