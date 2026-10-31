import { createHash } from 'node:crypto';
import { buildCanonicalWorkout, CanonicalWorkout } from '../src/training-plans/canonical-workout';
import { COROS_COURSE_DESCRIPTION, corosCourseName, translateToCorosCourse } from '../src/coros/coros-workout-spec';
import { CorosOAuth, CorosRevocation, corosIssuer, corosSettings, pkceChallengeOf, pkceVerifierFor, subjectOf } from '../src/coros/coros-oauth';
import { CorosMcpClient, CorosMcpError, readSseOrJson, unwrapToolText } from '../src/coros/coros-mcp-client';
import { firstFitUrl, isFitLimitMessage, parseSportRecords } from '../src/coros/coros-sport-records';
import { CorosWorkoutPublisherService, COROS_WORKOUT_PROVIDER, WATCH_DELIVERY_PURPOSE, parseIdInPlan } from '../src/coros/coros-workout-publisher.service';
import { WorkoutDeliveryService } from '../src/workout-delivery/workout-delivery.service';
import { COROS_CONSENT } from '../src/coros/coros-consent';
import { buildCorosConnector } from '../src/coros/coros.connector';
import { addWorkoutSyncListener, requestZeppWorkoutSync } from '../src/zepp/zepp-workout-trigger';

// COROS (30/10/2026): conector completo contra o formato REAL do COROS MCP (schema lido do servidor em 30/10/2026). A rede e' simulada (fetch e cliente MCP falsos); a validacao com a
// conta real e' separada (a conta de teste estava vazia, entao o leitor da lista de atividades e o id devolvido na criacao foram escritos contra a DESCRICAO das ferramentas).

const KEY = 'a'.repeat(64);
const configWith = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as never;
const BASE_ENV = { COROS_CLIENT_ID: 'client-publico-1', COROS_REDIRECT_URI: 'https://api.exemplo.com/coros/callback', COROS_TOKEN_ENCRYPTION_KEY: KEY, COROS_ENABLED_USER_IDS: '*' };
const STATE = 'A'.repeat(43);

const continuous = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 8, distanceUnit: 'km', paceRange: '5:30/km a 5:45/km' }] };
const interval = {
  type: 'run',
  blocks: [{ repeatCount: 4, steps: [
    { durationType: 'distance', distanceValue: 400, distanceUnit: 'm', paceRange: '4:00/km' },
    { durationType: 'distance', distanceValue: 200, distanceUnit: 'm', pausaType: 'ativa', paceRange: '6:30/km a 7:00/km' },
  ] }],
};
const timeBased = { type: 'run', blocks: [{ durationType: 'time', durationMin: 30, paceRange: '6:00/km a 6:20/km' }] };
const canonical = (structure: unknown) => buildCanonicalWorkout({ id: 's1', modality: 'corrida', structure });
const ctx = { distanceKm: 8 as number | null, scheduledDate: '2026-10-22' };

describe('tradutor COROS (CanonicalWorkout -> course do COROS MCP)', () => {
  it('corrida continua: um trecho de treino (2) por distancia em metros, ritmo ABSOLUTO em s/km (intensityType 2) e nome "Corrida 8 km · 22/10"', () => {
    const result = translateToCorosCourse(canonical(continuous), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.date).toBe('20261022');
    expect(result.course).toEqual({
      courseName: 'Corrida 8 km · 22/10', courseDescription: COROS_COURSE_DESCRIPTION, sportType: 1,
      sections: [{ sectionType: 2, targetType: 1, targetValue: 8000, intensityType: 2, intensityValueStart: 330, intensityValueEnd: 345 }],
    });
  });

  it('por tempo: segundos inteiros (targetType 2)', () => {
    const result = translateToCorosCourse(canonical(timeBased), ctx);
    expect(result.ok && result.course.sections[0]).toMatchObject({ sectionType: 2, targetType: 2, targetValue: 1800, intensityType: 2, intensityValueStart: 360, intensityValueEnd: 380 });
  });

  it('intervalado: grupo { intervalGroup, repeats, sets } sem alvo no grupo, pace unico com os DOIS limites iguais e a banda de +-20 s NUNCA usada; recuperacao ativa = secao 3', () => {
    const result = translateToCorosCourse(canonical(interval), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.course.sections).toEqual([{
      intervalGroup: true, repeats: 4,
      sets: [
        { sectionType: 2, targetType: 1, targetValue: 400, intensityType: 2, intensityValueStart: 240, intensityValueEnd: 240 },
        { sectionType: 3, targetType: 1, targetValue: 200, intensityType: 2, intensityValueStart: 390, intensityValueEnd: 420 },
      ],
    }]);
    const group = result.course.sections[0] as Record<string, unknown>;
    for (const forbidden of ['sectionType', 'targetType', 'targetValue', 'intensityType']) expect(group).not.toHaveProperty(forbidden);
  });

  it('recuperacao parada (sem ritmo) NAO leva intensidade (nunca 0); objetivo aberto vira modo livre (targetType 4) sem targetValue', () => {
    const structure = { type: 'run', blocks: [{ repeatCount: 3, steps: [
      { durationType: 'distance', distanceValue: 300, distanceUnit: 'm', paceRange: '4:30/km' },
      { durationType: 'time', durationMin: 1, pausaType: 'passiva' },
    ] }] };
    const result = translateToCorosCourse(canonical(structure), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recovery = (result.course.sections[0].sets as unknown as Array<Record<string, unknown>>)[1];
    expect(recovery).toMatchObject({ sectionType: 3, targetType: 2, targetValue: 60 });
    for (const key of ['intensityType', 'intensityValueStart', 'intensityValueEnd']) expect(recovery).not.toHaveProperty(key);

    const open = { type: 'corrida', modality: 'corrida', items: [{ kind: 'step', label: null, role: 'main', roleBasis: 'single_part', activity: 'run', activityBasis: 'not_specified', goal: { type: 'open' }, pace: null, intensity: null, recoveryKind: null, notes: null }], complete: true, warnings: [], losses: [], derived: { totalDistanceMeters: 0, totalPrescribedSeconds: 0, stepCount: 1 } } as unknown as CanonicalWorkout;
    const free = translateToCorosCourse({ ...open, modality: 'corrida' }, ctx);
    expect(free.ok && free.course.sections[0]).toEqual({ sectionType: 2, targetType: 4 });
  });

  it('recusas explicitas (nada e inventado): ritmo fora de 120-1499 s/km, repeticoes acima de 20, canonico incompleto, modalidade que nao e corrida, data invalida', () => {
    const fast = translateToCorosCourse(canonical({ type: 'run', blocks: [{ durationType: 'distance', distanceValue: 1, distanceUnit: 'km', paceRange: '1:30/km' }] }), ctx);
    expect(!fast.ok && fast.refusals.map((r) => r.code)).toContain('pace_out_of_range');
    const many = translateToCorosCourse(canonical({ type: 'run', blocks: [{ repeatCount: 21, steps: [{ durationType: 'distance', distanceValue: 100, distanceUnit: 'm', paceRange: '4:00/km' }] }] }), ctx);
    expect(!many.ok && many.refusals.map((r) => r.code)).toContain('repeat_count_invalid');
    const strength = translateToCorosCourse({ ...canonical(continuous), modality: 'forca' }, ctx);
    expect(!strength.ok && strength.refusals.map((r) => r.code)).toContain('modality_not_running');
    const incomplete = translateToCorosCourse({ ...canonical(continuous), complete: false, losses: [{ code: 'x', message: 'perda', path: 'items[0]' }] }, ctx);
    expect(!incomplete.ok && incomplete.refusals.map((r) => r.code)).toContain('canonical_x');
    const badDate = translateToCorosCourse(canonical(continuous), { ...ctx, scheduledDate: '22/10/2026' });
    expect(!badDate.ok && badDate.refusals.map((r) => r.code)).toContain('workout_date_invalid');
  });

  it('o hash identifica o conteudo enviado: mesma prescricao = mesmo hash; mudar ritmo, distancia ou data muda; nome e descricao nao levam dado pessoal', () => {
    const a = translateToCorosCourse(canonical(continuous), ctx);
    const b = translateToCorosCourse(canonical(continuous), ctx);
    const faster = translateToCorosCourse(canonical({ type: 'run', blocks: [{ durationType: 'distance', distanceValue: 8, distanceUnit: 'km', paceRange: '5:20/km a 5:35/km' }] }), ctx);
    const otherDay = translateToCorosCourse(canonical(continuous), { ...ctx, scheduledDate: '2026-10-23' });
    expect(a.ok && b.ok && a.specHash === b.specHash).toBe(true);
    expect(a.ok && faster.ok && a.specHash !== faster.specHash).toBe(true);
    expect(a.ok && otherDay.ok && a.specHash !== otherDay.specHash).toBe(true);
    expect(corosCourseName(null, '2026-10-22')).toBe('Corrida · 22/10');
    expect(COROS_COURSE_DESCRIPTION).not.toMatch(/\{|json|dayNo|sectionType/i);
  });
});

describe('OAuth da COROS (PKCE derivado do state, cliente publico)', () => {
  it('o verifier e DETERMINISTICO por state+chave (sem tabela), o desafio e SHA-256 dele e outra chave nao reconstroi o verifier', () => {
    const key = Buffer.from(KEY, 'hex');
    const verifier = pkceVerifierFor(STATE, key);
    expect(verifier).toBe(pkceVerifierFor(STATE, key));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallengeOf(verifier)).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(pkceVerifierFor(STATE, Buffer.from('b'.repeat(64), 'hex'))).not.toBe(verifier);
    expect(pkceVerifierFor('B'.repeat(43), key)).not.toBe(verifier);
  });

  it('a URL de autorizacao traz S256, resource = URL do MCP, escopos corretos, redirect e client_id; nenhum dado da aluna', () => {
    const url = new URL(new CorosOAuth(configWith(BASE_ENV)).buildAuthorizationUrl({ state: STATE }));
    expect(`${url.origin}${url.pathname}`).toBe('https://mcpus.coros.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'client-publico-1', redirect_uri: BASE_ENV.COROS_REDIRECT_URI, scope: 'openid offline_access mcp.tools',
      code_challenge_method: 'S256', resource: 'https://mcpus.coros.com/mcp', state: STATE,
    });
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallengeOf(pkceVerifierFor(STATE, Buffer.from(KEY, 'hex'))));
  });

  it('configuracao: so cliente publico (sem segredo), redirect https em /coros/callback, chave exclusiva e emissor so de coros.com; sem isso o servico fica indisponivel', () => {
    expect(() => corosSettings(configWith({ ...BASE_ENV, COROS_CLIENT_ID: '' }))).toThrow();
    expect(() => corosSettings(configWith({ ...BASE_ENV, COROS_REDIRECT_URI: 'http://api.exemplo.com/coros/callback' }))).toThrow();
    expect(() => corosSettings(configWith({ ...BASE_ENV, COROS_REDIRECT_URI: 'https://api.exemplo.com/zepp/callback' }))).toThrow();
    expect(() => corosSettings(configWith({ ...BASE_ENV, ZEPP_TOKEN_ENCRYPTION_KEY: KEY }))).toThrow(/exclusiva/);
    expect(() => corosIssuer(configWith({ COROS_ISSUER: 'https://evil.example.com' }))).toThrow();
    expect(corosIssuer(configWith({ COROS_ISSUER: 'https://mcpeu.coros.com' }))).toBe('https://mcpeu.coros.com');
    expect(new CorosOAuth(configWith({ ...BASE_ENV, COROS_ENABLED_USER_IDS: 'a,b' })).isEnabledFor('c')).toBe(false); // fail-closed
    expect(new CorosOAuth(configWith({ COROS_ENABLED_USER_IDS: '*' })).isEnabledFor('c')).toBe(true);
  });

  it('troca do codigo: envia o code_verifier derivado do state, identifica a conta pelo sub do id_token e nao aceita sem state', async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ sub: 'conta-coros-123' })).toString('base64url')}.y`;
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const original = global.fetch;
    global.fetch = (async (url: string, init: { body: string }) => { calls.push({ url, body: new URLSearchParams(init.body) }); return new Response(JSON.stringify({ access_token: 'acc', refresh_token: 'ref', expires_in: 2591999, id_token: idToken }), { status: 200 }); }) as never;
    try {
      const oauth = new CorosOAuth(configWith(BASE_ENV));
      const tokens = await oauth.exchangeCode({ code: 'codigo', state: STATE });
      expect(tokens).toEqual({ accessToken: 'acc', refreshToken: 'ref', expiresInSec: 2591999, externalAccountId: 'conta-coros-123' });
      expect(calls[0].url).toBe('https://mcpus.coros.com/oauth2/token');
      expect(Object.fromEntries(calls[0].body)).toMatchObject({ grant_type: 'authorization_code', client_id: 'client-publico-1', code: 'codigo', code_verifier: pkceVerifierFor(STATE, Buffer.from(KEY, 'hex')) });
      expect(calls[0].body.has('client_secret')).toBe(false);
      await expect(oauth.exchangeCode({ code: 'codigo' })).rejects.toThrow();
      const refreshed = await oauth.refreshTokens({ refreshToken: 'ref' });
      expect(refreshed.refreshToken).toBe('ref');
      expect(Object.fromEntries(calls[1].body)).toMatchObject({ grant_type: 'refresh_token', client_id: 'client-publico-1', refresh_token: 'ref' });
    } finally { global.fetch = original; }
  });

  it('recusa definitiva (4xx) e falha transitoria (5xx) sao tratadas de forma diferente; revogacao nunca lanca', async () => {
    const original = global.fetch;
    try {
      global.fetch = (async () => new Response('{}', { status: 400 })) as never;
      await expect(new CorosOAuth(configWith(BASE_ENV)).refreshTokens({ refreshToken: 'x' })).rejects.toMatchObject({ status: 400 });
      global.fetch = (async () => new Response('{}', { status: 503 })) as never;
      await expect(new CorosOAuth(configWith(BASE_ENV)).refreshTokens({ refreshToken: 'x' })).rejects.toMatchObject({ status: 502 });
      global.fetch = (async () => { throw new Error('rede'); }) as never;
      expect(await new CorosRevocation(configWith(BASE_ENV)).revoke({ accessToken: 'a' })).toBe('failed');
      global.fetch = (async () => new Response('', { status: 200 })) as never;
      expect(await new CorosRevocation(configWith(BASE_ENV)).revoke({ accessToken: 'a' })).toBe('revoked');
    } finally { global.fetch = original; }
    expect(subjectOf(null)).toBe('');
    expect(subjectOf('lixo')).toBe('');
  });
});

describe('cliente do COROS MCP', () => {
  it('desembrulha o texto das ferramentas (string JSON) e le a ultima mensagem de um fluxo SSE', () => {
    expect(unwrapToolText('"No sport records found."')).toBe('No sport records found.');
    expect(unwrapToolText('"linha 1\\nlinha 2"')).toBe('linha 1\nlinha 2');
    expect(unwrapToolText('texto puro')).toBe('texto puro');
    expect(readSseOrJson('text/event-stream', 'event: message\ndata: {"a":1}\n\ndata: {"b":2}\n')).toBe('{"b":2}');
    expect(readSseOrJson('application/json', '{"c":3}')).toBe('{"c":3}');
  });

  const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as never;
  async function withFetch<T>(impl: never, run: () => Promise<T>): Promise<T> { const original = global.fetch; global.fetch = impl; try { return await run(); } finally { global.fetch = original; } }
  const client = new CorosMcpClient(configWith({}));

  it('chamada de ferramenta: Bearer, JSON-RPC 2.0, sem sessao; devolve o texto; isError vira erro de ferramenta', async () => {
    let seen: { url: string; headers: Record<string, string>; body: { method: string; params: { name: string } } } | null = null;
    const ok = (async (url: string, init: { headers: Record<string, string>; body: string }) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '"Created. idInPlan: P-77"' }], isError: false } }), { status: 200 }); }) as never;
    const text = await withFetch(ok, () => client.callTool('tok', 'createScheduledWorkout', { date: '20261022' }));
    expect(text).toBe('Created. idInPlan: P-77');
    expect(seen!.url).toBe('https://mcpus.coros.com/mcp');
    expect(seen!.headers.Authorization).toBe('Bearer tok');
    expect(seen!.body).toMatchObject({ method: 'tools/call', params: { name: 'createScheduledWorkout' } });
    await expect(withFetch(reply({ result: { content: [{ type: 'text', text: '"data invalida"' }], isError: true } }), () => client.callTool('tok', 'x'))).rejects.toMatchObject({ kind: 'tool_error' });
  });

  it('erros HTTP viram tipos distintos (auth, limite, indisponivel, rede) e a mensagem nunca carrega o token', async () => {
    const kinds: Array<[number, string]> = [[401, 'auth'], [403, 'auth'], [429, 'rate_limited'], [503, 'transient'], [418, 'protocol']];
    for (const [status, kind] of kinds) {
      const error = await withFetch((async () => new Response('', { status })) as never, () => client.callTool('segredo-123', 'x')).catch((e) => e);
      expect(error).toBeInstanceOf(CorosMcpError);
      expect(error.kind).toBe(kind);
      expect(String(error.message)).not.toContain('segredo-123');
    }
    const net = await withFetch((async () => { throw new Error('boom segredo-123'); }) as never, () => client.callTool('segredo-123', 'x')).catch((e) => e);
    expect(net.kind).toBe('network');
    expect(String(net.message)).not.toContain('segredo-123');
  });

  it('se o servidor pedir inicializacao, inicializa e repete UMA vez', async () => {
    const methods: string[] = [];
    const impl = (async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      methods.push(body.method);
      if (body.method === 'tools/call' && methods.filter((m) => m === 'tools/call').length === 1) return new Response(JSON.stringify({ error: { code: -32002, message: 'Server not initialized' } }), { status: 200 });
      return new Response(JSON.stringify({ result: { content: [{ type: 'text', text: '"ok"' }] } }), { status: 200 });
    }) as never;
    expect(await withFetch(impl, () => client.callTool('tok', 'queryDevices'))).toBe('ok');
    expect(methods).toEqual(['tools/call', 'initialize', 'tools/call']);
  });
});

describe('lista de atividades (querySportRecords) e link do FIT', () => {
  it('extrai labelId + sportType + timestamps de formatos "chave: valor" e JSON, sem duplicar e sem inventar', () => {
    const text = `Sport records 2026-10-20 to 2026-10-30\n1. 2026-10-29 | Outdoor Run | Park | 35:10 | 6.01 km\n   labelId: 8A1B2C3D, sportType: 100, startTimestamp: 1793300000, endTimestamp: 1793302110\n\n2. 2026-10-27 | Strength\n   labelId: 9F9F, sportType: 402\n\n3. sem identificador, ignorado`;
    expect(parseSportRecords(text)).toEqual([
      { labelId: '8A1B2C3D', sportType: 100, startTimestamp: 1793300000, endTimestamp: 1793302110 },
      { labelId: '9F9F', sportType: 402, startTimestamp: null, endTimestamp: null },
    ]);
    expect(parseSportRecords('{"records":[{"labelId":"ABC123","sportType":101,"startTimestamp":1793300000000}]}')).toEqual([{ labelId: 'ABC123', sportType: 101, startTimestamp: 1793300000, endTimestamp: null }]);
    expect(parseSportRecords('No sport records found from 2026-10-16 to 2026-10-30.')).toEqual([]);
    expect(parseSportRecords('labelId: X1 e nada mais')).toEqual([]); // sem sportType nao ha como baixar o arquivo
  });

  it('o link do FIT so e aceito se for https com nome de host de DNS (nunca http, IP, localhost, rede interna ou credenciais)', () => {
    expect(firstFitUrl('Download: https://files.coros.com/fit/abc.fit?sig=1.')).toBe('https://files.coros.com/fit/abc.fit?sig=1');
    for (const bad of ['http://files.coros.com/a.fit', 'https://127.0.0.1/a.fit', 'https://localhost/a.fit', 'https://10.0.0.5/a.fit', 'https://intranet/a.fit', 'https://servico.internal/a.fit', 'https://user:pass@files.coros.com/a.fit', 'sem link']) {
      expect(firstFitUrl(bad)).toBeNull();
    }
    expect(firstFitUrl('https://127.0.0.1/a.fit e depois https://files.coros.com/b.fit')).toBe('https://files.coros.com/b.fit');
    expect(isFitLimitMessage('FIT file limit reached for today')).toBe(true);
    expect(isFitLimitMessage('activity not found')).toBe(false);
  });
});

describe('consentimento e conector COROS', () => {
  it('so pede o que esta implementado: atividades, sensores e percurso (FIT); sono, HRV e saude diaria NAO sao pedidos', () => {
    const categories = COROS_CONSENT.groups.flatMap((g) => g.categories);
    expect(categories.sort()).toEqual(['activity', 'activity_route', 'activity_sensors', 'profile']);
    expect(JSON.stringify(COROS_CONSENT.groups)).not.toMatch(/sono|HRV|repouso/i);
    const connector = buildCorosConnector(configWith(BASE_ENV));
    for (const category of categories.filter((c) => c !== 'profile')) expect(connector.categories).toContain(category);
    expect(connector.oauth && connector.revocation && connector.consent).toBeTruthy();
    expect(connector.id).toBe('coros');
  });

  it('envio de treinos e IA tem tela propria, nunca marcada na conexao; o texto diz que a COROS nao deixa o Panzeri Run apagar treinos e que recusar a IA nao impede conectar', () => {
    expect(COROS_CONSENT.purposes).not.toContain('watch_delivery');
    expect(COROS_CONSENT.purposes).not.toContain('ai_external');
    const watch = COROS_CONSENT.optionalPurposes.find((p) => p.id === 'watch_delivery')!;
    const ai = COROS_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')!;
    expect(watch.screen!.paragraphs.join(' ')).toContain('não permite que o Panzeri Run apague');
    expect(ai.external).toBe(true);
    expect(ai.screen!.paragraphs.join(' ')).toContain('A recusa desta autorização não impede você de conectar a COROS');
    expect(ai.screen!.checkboxText).toContain('Anthropic');
    expect(JSON.stringify(COROS_CONSENT)).not.toMatch(/garmin/i);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Publicador: banco em memoria, cliente MCP falso, consentimento falso.
type Row = Record<string, any>;
function makePublisher(options: { enabled?: boolean; connected?: boolean; authorized?: boolean; today?: string; call?: (name: string, args: any) => string | Error } = {}) {
  const sessions: Row[] = [];
  const deliveries: Row[] = [];
  const prisma: any = {
    trainingSession: {
      findMany: async ({ where }: any) => sessions
        .filter((s) => s.userId === where.userId && s.scheduledDate >= where.scheduledDate.gte && s.scheduledDate <= where.scheduledDate.lte && s.plan.status === 'active')
        .sort((a, b) => a.scheduledDate - b.scheduledDate || a.id.localeCompare(b.id)),
      findUnique: async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null,
    },
    workoutDelivery: {
      create: async ({ data }: any) => { const row = { id: `d${deliveries.length + 1}`, requestedAt: new Date(2026, 9, 20, 0, 0, deliveries.length), sentAt: null, ...data }; deliveries.push(row); return row; },
      findUnique: async ({ where }: any) => deliveries.find((d) => d.id === where.id) ?? null,
      update: async ({ where, data }: any) => { const row = deliveries.find((d) => d.id === where.id)!; Object.assign(row, data); return row; },
      findMany: async ({ where }: any) => deliveries
        .filter((d) => (!where.provider || d.provider === where.provider)
          && (!where.status || (typeof where.status === 'string' ? d.status === where.status : where.status.in.includes(d.status)))
          && (!where.trainingSession || sessions.find((s) => s.id === d.trainingSessionId)?.userId === where.trainingSession.userId))
        .sort((a, b) => b.requestedAt - a.requestedAt),
    },
  };
  const calls: Array<{ name: string; args: any }> = [];
  let nextId = 1;
  const client = { callTool: jest.fn(async (_token: string, name: string, args: any) => {
    calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    const custom = options.call?.(name, args);
    if (custom instanceof Error) throw custom;
    if (typeof custom === 'string') return custom;
    return name === 'createScheduledWorkout' ? `Workout created for ${args.date}. idInPlan: P-${nextId++}` : 'Workout updated.';
  }) };
  const state = { connected: options.connected ?? true, authorized: options.authorized ?? true, today: options.today ?? '2026-10-20' };
  const consent = { isAllowed: jest.fn(async (_p: string, _u: string, _c: string, purpose?: string) => (purpose === WATCH_DELIVERY_PURPOSE ? state.connected && state.authorized : state.connected)) };
  const connections = { getAccessToken: jest.fn(async () => 'token-secreto') };
  const config = { get: (key: string) => (key === 'COROS_WORKOUT_PUBLISH_ENABLED' ? ((options.enabled ?? true) ? 'true' : 'false') : undefined) };
  const service = new CorosWorkoutPublisherService(prisma, new WorkoutDeliveryService(prisma), connections as never, consent as never, client as never, config as never, { today: () => state.today });
  const addSession = (id: string, date: string, structure: unknown = continuous, extra: Row = {}) => {
    const row = { id, userId: 'u1', scheduledDate: new Date(`${date}T00:00:00Z`), modality: 'corrida', origin: null, title: `Treino ${id}`, distanceKm: null, structure, plan: { status: 'active' }, completion: null, executionLinks: [], ...extra };
    sessions.push(row);
    return row;
  };
  return { service, sessions, deliveries, calls, client, state, consent, connections, addSession };
}

describe('publicador COROS (um treino por data; sem apagar)', () => {
  it('parseIdInPlan le o identificador do texto de resposta', () => {
    expect(parseIdInPlan('Workout created. idInPlan: ABC-123')).toBe('ABC-123');
    expect(parseIdInPlan('{"idInPlan":"X9"}')).toBe('X9');
    expect(parseIdInPlan('criado sem identificador')).toBeNull();
  });

  it('desligado (COROS_WORKOUT_PUBLISH_ENABLED != true): nao faz nada', async () => {
    const t = makePublisher({ enabled: false });
    t.addSession('a', '2026-10-21');
    expect(await t.service.reconcile('u1')).toEqual({ status: 'disabled' });
    expect(t.calls).toHaveLength(0);
  });

  it('sem conexao ou sem a autorizacao de envio: nada e enviado', async () => {
    const off = makePublisher({ connected: false });
    off.addSession('a', '2026-10-21');
    expect(await off.service.reconcile('u1')).toEqual({ status: 'not_connected' });
    const noGrant = makePublisher({ authorized: false });
    noGrant.addSession('a', '2026-10-21');
    expect(await noGrant.service.reconcile('u1')).toEqual({ status: 'not_authorized' });
    expect(off.calls.concat(noGrant.calls)).toHaveLength(0);
  });

  it('cria UM treino por data com o idInPlan devolvido, so corrida estruturada dos proximos 7 dias, e nao reenvia se nada mudou', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    t.addSession('b', '2026-10-23', interval);
    t.addSession('fora', '2026-10-30'); // fora da janela de 7 dias
    t.addSession('forca', '2026-10-22', { type: 'strength' }, { modality: 'forca' });
    t.addSession('feito', '2026-10-24', continuous, { completion: { status: 'done' } });
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', created: 2, updated: 0, workouts: 2 });
    expect(t.calls.map((c) => [c.name, c.args.date])).toEqual([['createScheduledWorkout', '20261021'], ['createScheduledWorkout', '20261023']]);
    expect(t.calls[0].args.course).toMatchObject({ sportType: 1, courseName: 'Corrida · 21/10' });
    expect(t.deliveries.map((d) => [d.provider, d.status, d.externalWorkoutId])).toEqual([[COROS_WORKOUT_PROVIDER, 'sent', 'P-1'], [COROS_WORKOUT_PROVIDER, 'sent', 'P-2']]);
    expect(t.deliveries.some((d) => d.status === 'delivered_to_device')).toBe(false);
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'unchanged', workouts: 2 });
    expect(t.calls).toHaveLength(2);
    const status = await t.service.status('u1');
    expect(status).toMatchObject({ eligible: 2, acceptedByCoros: 2, inSync: true, watchDeliveryAuthorized: true });
    expect(status.skipped.map((s) => s.reason).sort()).toEqual(['modalidade_nao_suportada', 'sessao_ja_realizada']);
  });

  it('treino alterado NO MESMO DIA: atualiza o MESMO treino pelo idInPlan (nunca cria um segundo) e cancela a linha antiga', async () => {
    const t = makePublisher();
    const session = t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    session.structure = { type: 'run', blocks: [{ durationType: 'distance', distanceValue: 8, distanceUnit: 'km', paceRange: '5:20/km a 5:35/km' }] };
    expect(await t.service.reconcile('u1')).toMatchObject({ status: 'published', created: 0, updated: 1 });
    expect(t.calls.map((c) => c.name)).toEqual(['createScheduledWorkout', 'updateScheduledWorkout']);
    expect(t.calls[1].args).toMatchObject({ date: '20261021', idInPlan: 'P-1' });
    expect(t.deliveries.map((d) => d.status)).toEqual(['canceled', 'sent']);
    expect(t.deliveries[1].externalWorkoutId).toBe('P-1');
  });

  it('treino que MUDOU DE DIA: cria na data nova e marca o antigo como "retirada pendente" (a COROS nao deixa o Panzeri Run apagar); o status mostra isso', async () => {
    const t = makePublisher();
    const session = t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    session.scheduledDate = new Date('2026-10-22T00:00:00Z');
    const result = await t.service.reconcile('u1');
    expect(result).toMatchObject({ status: 'published', created: 1, updated: 0, removalPending: 1 });
    expect(t.calls.filter((c) => c.name === 'createScheduledWorkout').map((c) => c.args.date)).toEqual(['20261021', '20261022']);
    expect(t.calls.some((c) => /delete|remove|cancel/i.test(c.name))).toBe(false); // nunca tenta apagar
    expect((await t.service.status('u1')).removalPending).toEqual([{ date: '2026-10-21', reason: 'mudou_de_dia' }]);
  });

  it('treino removido do programa: vira "retirada pendente" sem chamada de exclusao; treino JA REALIZADO nao vira pendencia', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    const done = t.addSession('b', '2026-10-22');
    await t.service.reconcile('u1');
    t.sessions.find((s) => s.id === 'a')!.plan = { status: 'archived' }; // saiu do programa ativo
    (done as Row).completion = { status: 'done' }; // feito
    await t.service.reconcile('u1');
    const status = await t.service.status('u1');
    expect(status.removalPending).toEqual([{ date: '2026-10-21', reason: 'treino_saiu_do_programa' }]);
    expect(t.calls.every((c) => c.name === 'createScheduledWorkout')).toBe(true);
  });

  it('autorizacao retirada com treinos ja enviados: encerra o acompanhamento, marca retirada pendente e NAO chama a COROS', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21');
    await t.service.reconcile('u1');
    t.state.authorized = false;
    expect(await t.service.reconcile('u1')).toEqual({ status: 'not_authorized' });
    expect(t.calls).toHaveLength(1);
    expect(t.deliveries[0]).toMatchObject({ status: 'canceled' });
    expect((await t.service.status('u1')).removalPending).toHaveLength(1);
  });

  it('falha de autenticacao interrompe a rodada e registra a falha; recusa de UM treino (ex.: data) nao impede os demais', async () => {
    const auth = makePublisher({ call: () => new CorosMcpError('auth', 'recusado', 401) });
    auth.addSession('a', '2026-10-21');
    auth.addSession('b', '2026-10-22');
    expect(await auth.service.reconcile('u1')).toMatchObject({ status: 'failed', kind: 'auth', created: 0 });
    expect(auth.calls).toHaveLength(1); // parou no primeiro
    expect(auth.deliveries[0].status).toBe('failed');

    const partial = makePublisher({ call: (_n, args) => (args.date === '20261021' ? new CorosMcpError('tool_error', 'data fora do intervalo') : 'idInPlan: OK-2') });
    partial.addSession('a', '2026-10-21');
    partial.addSession('b', '2026-10-22');
    expect(await partial.service.reconcile('u1')).toMatchObject({ status: 'published', created: 1 });
    expect(partial.deliveries.map((d) => d.status)).toEqual(['failed', 'sent']);
  });

  it('o envio so inclui o necessario: nenhuma informacao pessoal vai no treino (titulo interno, nome, relato)', async () => {
    const t = makePublisher();
    t.addSession('a', '2026-10-21', continuous, { title: 'Treino da Maria com dor no joelho', notes: 'dor no joelho' });
    await t.service.reconcile('u1');
    const sent = JSON.stringify(t.calls[0].args);
    expect(sent).not.toMatch(/Maria|dor|joelho|u1|token/i);
  });
});

describe('gatilhos de envio compartilhados', () => {
  it('requestZeppWorkoutSync avisa tambem os provedores que se registraram (COROS), e um ouvinte com defeito nao afeta os demais', () => {
    const received: Array<[string, string]> = [];
    addWorkoutSyncListener(() => { throw new Error('defeito'); });
    addWorkoutSyncListener((userId, reason) => { received.push([userId, reason]); });
    expect(() => requestZeppWorkoutSync('u1', 'plan_generated')).not.toThrow();
    expect(received).toContainEqual(['u1', 'plan_generated']);
  });
});
