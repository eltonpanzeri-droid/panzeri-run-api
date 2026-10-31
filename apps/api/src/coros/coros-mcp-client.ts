import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { corosEndpoints, corosIssuer } from './coros-oauth';

// Cliente do COROS MCP (JSON-RPC 2.0 sobre HTTP, 30/10/2026). Fatos conferidos na sonda real: endpoint SEM sessao (stateless), `Authorization: Bearer`, `Accept: application/json,
// text/event-stream`; o resultado de cada ferramenta vem em result.content[].text e esse texto e' uma STRING JSON (aspas escapadas) em linguagem humana, nao um objeto: quem usa
// a resposta recebe o texto ja' desembrulhado. Erro de ferramenta vem com result.isError = true. Nunca lanca com token, URL ou corpo na mensagem.
export type CorosErrorKind = 'auth' | 'rate_limited' | 'tool_error' | 'protocol' | 'network' | 'transient';

export class CorosMcpError extends Error {
  constructor(readonly kind: CorosErrorKind, message: string, readonly httpStatus: number | null = null) {
    super(message);
    this.name = 'CorosMcpError';
  }
}

const TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = '2025-06-18';

// Desembrulha o texto de uma ferramenta: a COROS devolve uma string JSON ("\"texto...\""); se vier texto puro, usa como esta.
export function unwrapToolText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch { /* texto puro que so' parece JSON */ }
  }
  return raw;
}

export function readSseOrJson(contentType: string, text: string): string {
  if (!contentType.includes('text/event-stream')) return text;
  const events = text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
  return events[events.length - 1] ?? '';
}

@Injectable()
export class CorosMcpClient {
  private nextId = 1;
  constructor(private readonly config: ConfigService) {}

  private url(): string {
    return corosEndpoints(corosIssuer(this.config)).mcp;
  }

  private async rpc(accessToken: string, method: string, params: Record<string, unknown>): Promise<{ result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean; tools?: unknown[] }; error?: { code?: number; message?: string } }> {
    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${accessToken}`, 'MCP-Protocol-Version': PROTOCOL_VERSION },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new CorosMcpError('network', 'Nao foi possivel contatar a COROS.');
    }
    if (response.status === 401 || response.status === 403) throw new CorosMcpError('auth', 'A COROS recusou o acesso (autorizacao invalida ou expirada).', response.status);
    if (response.status === 429) throw new CorosMcpError('rate_limited', 'A COROS pediu para tentar mais tarde.', response.status);
    if (response.status >= 500) throw new CorosMcpError('transient', 'A COROS esta indisponivel no momento.', response.status);
    if (!response.ok) throw new CorosMcpError('protocol', `Resposta inesperada da COROS (${response.status}).`, response.status);
    try {
      const body = readSseOrJson(response.headers.get('content-type') ?? '', await response.text());
      return JSON.parse(body);
    } catch {
      throw new CorosMcpError('protocol', 'Resposta da COROS ilegivel.');
    }
  }

  // Chama uma ferramenta e devolve o texto. Se o servidor pedir inicializacao (nao observado na sonda), inicializa e repete UMA vez.
  async callTool(accessToken: string, name: string, args: Record<string, unknown> = {}): Promise<string> {
    let reply = await this.rpc(accessToken, 'tools/call', { name, arguments: args });
    if (reply.error && /initializ/i.test(reply.error.message ?? '')) {
      await this.rpc(accessToken, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'panzeri-run', version: '1.0.0' } });
      reply = await this.rpc(accessToken, 'tools/call', { name, arguments: args });
    }
    if (reply.error) throw new CorosMcpError('protocol', `A COROS recusou a chamada (${reply.error.code ?? 'erro'}).`);
    const text = (reply.result?.content ?? []).filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => unwrapToolText(item.text as string)).join('\n');
    if (reply.result?.isError) throw new CorosMcpError('tool_error', text.slice(0, 500) || 'A COROS recusou a operacao.');
    return text;
  }
}
