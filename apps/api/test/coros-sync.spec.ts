import { Logger } from '@nestjs/common';
import { CorosSyncService, MAX_PER_RUN } from '../src/coros/coros-sync.service';
import { CorosMcpError } from '../src/coros/coros-mcp-client';

// Importacao de atividades da COROS por consulta periodica (30/10/2026): rede, FIT e gravacao simulados. O leitor FIT e' o compartilhado com a Zepp (testado la); aqui se prova a LOGICA de
// janela, idempotencia, limite diario e consentimento.
const readZeppFit = jest.fn();
jest.mock('../src/zepp/zepp-fit', () => ({ readZeppFit: (...args: unknown[]) => readZeppFit(...args), ZeppFitError: class extends Error {} }));

const NOW = new Date('2026-10-30T15:00:00Z');
const FIT = Buffer.from('fit');

function list(ids: string[]) {
  return ids.map((id, i) => `${i + 1}. 2026-10-29 | Outdoor Run\n   labelId: ${id}, sportType: 100, startTimestamp: ${1793300000 + i * 100}`).join('\n\n');
}

function build(options: { enabled?: boolean; categories?: string[]; purposes?: string[]; collectFrom?: Date | null; lastSync?: Date | null; connected?: boolean; known?: string[] } = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  const ingested: string[] = [];
  const marks: Date[] = [];
  const state = { listText: '', urlText: 'https://files.coros.com/a.fit', failOn: new Set<string>(), limitAfter: Infinity, authFail: false };
  const client = { callTool: jest.fn(async (_t: string, name: string, args: any) => {
    calls.push({ name, args });
    if (state.authFail) throw new CorosMcpError('auth', 'recusado', 401);
    if (name === 'querySportRecords') return state.listText;
    if (name === 'queryActivityFitFileDownloadUrls') {
      if (calls.filter((c) => c.name === name).length > state.limitAfter) throw new CorosMcpError('tool_error', 'FIT file limit reached for today');
      return state.urlText;
    }
    throw new Error('ferramenta inesperada ' + name);
  }) };
  const downloader = { download: jest.fn(async () => ({ ok: true as const, buffer: FIT })) };
  const ingestion = { ingest: jest.fn(async (_u: string, meta: { labelId: string }) => { if (state.failOn.has(meta.labelId)) throw new Error('falha de gravacao'); ingested.push(meta.labelId); return { written: true as const, activityLogId: `log-${meta.labelId}`, classification: null, removed: [] }; }) };
  const prisma: any = { activityLog: { findMany: async ({ where }: any) => (options.known ?? []).filter((id) => where.externalId.in.includes(id)).map((externalId) => ({ externalId })) } };
  const consent = { snapshot: async () => (options.connected === false ? null : { categories: options.categories ?? ['profile', 'activity'], purposes: options.purposes ?? [], collectFrom: options.collectFrom === undefined ? new Date('2026-10-28T00:00:00Z') : options.collectFrom }) };
  const connections = {
    getAccessToken: async () => 'token-secreto',
    syncState: async () => ({ connected: options.connected ?? true, lastSyncCompletedAt: options.lastSync ?? null }),
    markSyncCompleted: async (_p: string, _u: string, at: Date) => { marks.push(at); },
    connectedUserIds: async () => ['u1'],
  };
  const config = { get: (key: string) => (key === 'COROS_SYNC_ENABLED' ? ((options.enabled ?? true) ? 'true' : 'false') : undefined) };
  const service = new CorosSyncService(prisma, consent as never, connections as never, client as never, downloader as never, ingestion as never, config as never);
  return { service, calls, ingested, marks, state, client, downloader, ingestion };
}

beforeEach(() => { readZeppFit.mockReset(); readZeppFit.mockResolvedValue({ startedAt: NOW }); for (const level of ['log', 'error', 'warn'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

describe('importacao de atividades da COROS', () => {
  it('desligada, sem conexao ou sem a categoria Atividades: nada e consultado', async () => {
    for (const options of [{ enabled: false }, { connected: false }, { categories: ['profile'] }]) {
      const t = build(options);
      const result = await t.service.run('u1', NOW);
      expect(['disabled', 'not_connected']).toContain(result.status);
      expect(t.calls).toHaveLength(0);
    }
  });

  it('importa as atividades novas pelo FIT, uma vez cada; reexecutar nao baixa nem grava de novo as ja importadas; so avanca a janela quando nada ficou para tras', async () => {
    const t = build({ known: ['B2'] });
    t.state.listText = list(['A1', 'B2', 'C3']);
    const result = await t.service.run('u1', NOW);
    expect(result).toMatchObject({ status: 'ok', imported: 2, pending: 0, failed: 0 });
    expect(t.ingested.sort()).toEqual(['A1', 'C3']); // B2 ja existia
    expect(t.calls.filter((c) => c.name === 'queryActivityFitFileDownloadUrls').map((c) => c.args.labelId).sort()).toEqual(['A1', 'C3']);
    expect(t.calls[0]).toMatchObject({ name: 'querySportRecords', args: { endDate: '20261030', limit: 100 } });
    expect(t.marks).toEqual([NOW]);
  });

  it('janela: nunca antes do periodo autorizado (collectFrom); com o historico de 30 dias autorizado, ate 30 dias; depois do primeiro ciclo, do ultimo ciclo com folga de 2 dias', async () => {
    const plain = build({ collectFrom: new Date('2026-10-28T00:00:00Z') });
    await plain.service.run('u1', NOW);
    expect(plain.calls[0].args.startDate).toBe('20261028');
    const backfill = build({ purposes: ['history_backfill'], collectFrom: new Date('2026-10-28T00:00:00Z') });
    await backfill.service.run('u1', NOW);
    expect(backfill.calls[0].args.startDate).toBe('20260930');
    const later = build({ purposes: ['history_backfill'], lastSync: new Date('2026-10-29T10:00:00Z') });
    await later.service.run('u1', NOW);
    expect(later.calls[0].args.startDate).toBe('20261027');
  });

  it('limite diario de FIT da COROS: para a rodada, nada e marcado como importado alem do gravado e a janela NAO avanca (a proxima rodada retoma)', async () => {
    const t = build();
    t.state.listText = list(['A1', 'B2', 'C3']);
    t.state.limitAfter = 1;
    const result = await t.service.run('u1', NOW);
    expect(result.status).toBe('rate_limited');
    expect(t.ingested).toEqual(['A1']);
    expect(t.marks).toEqual([]);
  });

  it('falha de UMA atividade (gravacao) nao derruba as demais e impede avancar a janela; erro de autenticacao encerra com falha', async () => {
    const t = build();
    t.state.listText = list(['A1', 'B2', 'C3']);
    t.state.failOn.add('B2');
    const result = await t.service.run('u1', NOW);
    expect(result).toMatchObject({ status: 'ok', imported: 2, failed: 1 });
    expect(t.marks).toEqual([]);
    const auth = build();
    auth.state.listText = list(['A1']);
    auth.state.authFail = true;
    expect((await auth.service.run('u1', NOW)).status).toBe('failed');
  });

  it('teto por rodada: no maximo MAX_PER_RUN atividades; o excedente fica pendente e a janela nao avanca', async () => {
    const t = build();
    const ids = Array.from({ length: MAX_PER_RUN + 4 }, (_, i) => `ID${i}`);
    t.state.listText = list(ids);
    const result = await t.service.run('u1', NOW);
    expect(result.imported).toBe(MAX_PER_RUN);
    expect(result.pending).toBe(4);
    expect(t.marks).toEqual([]);
  });

  it('uma rodada por aluna por vez; o link do FIT invalido conta como falha sem gravar nada', async () => {
    const t = build();
    t.state.listText = list(['A1']);
    t.downloader.download.mockResolvedValueOnce({ ok: false as never, kind: 'invalid_url' } as never);
    const [first, second] = await Promise.all([t.service.run('u1', NOW), t.service.run('u1', NOW)]);
    expect([first.status, second.status].sort()).toEqual(['in_progress', 'ok']);
    expect(t.ingested).toEqual([]);
  });

  it('a lista vazia da COROS (conta sem atividades) e normal: nada a importar e a janela avanca', async () => {
    const t = build();
    t.state.listText = 'No sport records found from 2026-10-28 to 2026-10-30.';
    expect(await t.service.run('u1', NOW)).toMatchObject({ status: 'ok', imported: 0, pending: 0 });
    expect(t.marks).toEqual([NOW]);
  });
});
