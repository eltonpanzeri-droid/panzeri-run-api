import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { buildStudentIntegrations, describeFailure, IntegrationsRaw, StudentIntegrationsService, STATE_LABEL } from '../src/coach/student-integrations.service';
import { ZEPP_CONSENT } from '../src/zepp/zepp-consent';
import { COROS_CONSENT } from '../src/coros/coros-consent';
import { HEALTH_CONNECT_CONSENT } from '../src/health-connect/health-connect-consent';
import { consentTextHash, purposeTextHash } from '../src/provider-hub/provider-consent.service';

// Painel do treinador: Aluno > Integracoes (21/10/2026). Consulta do estado REAL, sem inventar conexao nem sincronizacao, distinguindo conta conectada de dado recebido, sem expor segredos e
// sem dar ao treinador poder de conceder consentimento. Dados sinteticos.

const NOW = new Date('2026-10-21T20:00:00Z');
const D = (iso: string) => new Date(iso);
const none = { lastAt: null, count: 0 };

const allCategories = ['profile', 'activity', 'activity_sensors', 'activity_route', 'sleep', 'daily_activity', 'resting_heart_rate', 'hrv'];
const watch = ZEPP_CONSENT.optionalPurposes.find((p) => p.id === 'watch_delivery')!;
const atlas = ZEPP_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')!;
const purposeRecords = (extra: Record<string, unknown> = {}) => ({
  watch_delivery: { version: watch.screen!.version, textHash: purposeTextHash(watch), grantedAt: '2026-10-21T12:00:00.000Z' },
  ai_external: { version: atlas.screen!.version, textHash: purposeTextHash(atlas), grantedAt: '2026-10-21T12:05:00.000Z' },
  ...extra,
});

function raw(over: Partial<IntegrationsRaw> = {}): IntegrationsRaw {
  return {
    polar: null, wahoo: null, strava: null, zepp: null,
    activityByProvider: {},
    zepp_activity_sensors: none, zepp_activity_route: none, zepp_sleep: none, zepp_daily: none, zepp_resting_hr: none, zepp_hrv: none,
    zeppLastProcessedEventAt: null, zeppWorkoutLastAcceptedAt: null, inboundFailures: [], zeppWorkoutFailures: [],
    ...over,
  };
}
const zepp = (over: Record<string, unknown> = {}) => ({
  createdAt: D('2026-10-21T10:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: null, accessTokenExpiresAt: D('2026-10-22T10:00:00Z'), hasRefreshToken: true,
  grantedCategories: allCategories, grantedPurposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view', 'watch_delivery', 'ai_external'],
  purposeConsents: purposeRecords(), consentVersion: ZEPP_CONSENT.version, consentTextHash: consentTextHash(ZEPP_CONSENT), ...over,
}) as NonNullable<IntegrationsRaw['zepp']>;
const find = (result: ReturnType<typeof buildStudentIntegrations>, provider: string) => result.integrations.find((i) => i.provider === provider);
const category = (entry: NonNullable<ReturnType<typeof find>>, id: string) => entry.categories.find((c) => c.id === id)!;

describe('Aluno > Integracoes: so mostra o que existe e separa conexao de dado recebido', () => {
  it('aluno sem nenhuma integracao e sem nenhum dado: lista vazia (nada inventado)', () => {
    expect(buildStudentIntegrations('a1', raw(), NOW, false).integrations).toEqual([]);
  });

  it('Zepp conectada com categorias autorizadas: mostra o que foi autorizado e, SEPARADAMENTE, o que de fato chegou e quando', () => {
    const result = buildStudentIntegrations('a1', raw({
      zepp: zepp(),
      activityByProvider: { zepp: { lastAt: D('2026-10-21T18:00:00Z'), count: 3 } },
      zepp_activity_sensors: { lastAt: D('2026-10-21T18:00:00Z'), count: 3 },
      zepp_sleep: { lastAt: D('2026-10-21T09:00:00Z'), count: 2 },
      zeppLastProcessedEventAt: D('2026-10-21T18:01:00Z'),
      zeppWorkoutLastAcceptedAt: D('2026-10-21T00:05:00Z'),
    }), NOW, true);
    const z = find(result, 'zepp')!;
    expect(z).toMatchObject({ name: 'Zepp / Amazfit', state: 'connected', stateLabel: STATE_LABEL.connected, lastSyncAt: '2026-10-21T18:01:00.000Z', lastSyncBasis: 'ultimo_evento_processado' });
    expect(category(z, 'activity')).toMatchObject({ authorized: true, lastAt: '2026-10-21T18:00:00.000Z', count: 3 });
    expect(category(z, 'sleep')).toMatchObject({ authorized: true, lastAt: '2026-10-21T09:00:00.000Z', count: 2 });
    // autorizada mas SEM nenhum dado recebido: aparece como tal (conectar != receber)
    expect(category(z, 'hrv')).toMatchObject({ authorized: true, lastAt: null, count: 0 });
    expect(z.warnings.join(' ')).toContain('Autorizada, mas ainda sem dados recebidos: Variabilidade da frequência cardíaca (HRV)');
    expect(category(z, 'watch_delivery')).toMatchObject({ direction: 'envia', authorized: true, lastAt: '2026-10-21T00:05:00.000Z' });
    expect(category(z, 'watch_delivery').note).toContain('não confirma que o relógio já recebeu');
  });

  it('conta conectada sem NENHUM dado e sem categoria autorizada: avisa em vez de parecer saudavel', () => {
    const result = buildStudentIntegrations('a1', raw({ zepp: zepp({ grantedCategories: ['profile'], grantedPurposes: [], purposeConsents: null }) }), NOW, false);
    const z = find(result, 'zepp')!;
    expect(z.state).toBe('connected');
    expect(z.categories.filter((c) => c.direction === 'recebe').every((c) => c.authorized === false && c.count === 0)).toBe(true);
    expect(z.warnings.join(' ')).toContain('não autorizou nenhuma categoria');
    expect(z.lastSyncAt).toBeNull();
    expect(z.lastSyncBasis).toBeNull(); // nenhuma sincronizacao presumida
  });

  it('sincronizacao concluida registrada pela integracao tem prioridade sobre o ultimo evento processado', () => {
    const z = find(buildStudentIntegrations('a1', raw({ zepp: zepp({ lastSyncCompletedAt: D('2026-10-21T19:00:00Z') }), zeppLastProcessedEventAt: D('2026-10-21T18:01:00Z') }), NOW, false), 'zepp')!;
    expect(z).toMatchObject({ lastSyncAt: '2026-10-21T19:00:00.000Z', lastSyncBasis: 'sincronizacao_concluida' });
  });

  it('desconectada: estado proprio e nada aparece como autorizado', () => {
    const z = find(buildStudentIntegrations('a1', raw({ zepp: zepp({ disconnectedAt: D('2026-10-21T15:00:00Z') }), activityByProvider: { zepp: { lastAt: D('2026-10-21T14:00:00Z'), count: 1 } } }), NOW, false), 'zepp')!;
    expect(z).toMatchObject({ state: 'disconnected', disconnectedAt: '2026-10-21T15:00:00.000Z' });
    expect(z.categories.filter((c) => c.direction === 'recebe').every((c) => c.authorized === false)).toBe(true);
    expect(category(z, 'activity').count).toBe(1); // o que ja chegou continua registrado
    expect(z.atlas.authorized).toBe(false);
  });

  it('texto da conexao mudou depois da autorizacao: a importacao esta suspensa e nada vale como autorizado ate a aluna confirmar', () => {
    const z = find(buildStudentIntegrations('a1', raw({ zepp: zepp({ consentVersion: '1.0', consentTextHash: 'antigo' }) }), NOW, false), 'zepp')!;
    expect(z.state).toBe('connected');
    expect(z.categories.filter((c) => c.direction === 'recebe').every((c) => c.authorized === false)).toBe(true);
    expect(z.warnings.join(' ')).toContain('importação está suspensa');
  });

  it('token expirado SEM como renovar = expirada; expirado com renovacao disponivel e normal (conectada)', () => {
    const expired = find(buildStudentIntegrations('a1', raw({ zepp: zepp({ accessTokenExpiresAt: D('2026-10-20T10:00:00Z'), hasRefreshToken: false }) }), NOW, false), 'zepp')!;
    expect(expired).toMatchObject({ state: 'expired', stateLabel: 'Autorização expirada' });
    const renewable = find(buildStudentIntegrations('a1', raw({ zepp: zepp({ accessTokenExpiresAt: D('2026-10-20T10:00:00Z'), hasRefreshToken: true }) }), NOW, false), 'zepp')!;
    expect(renewable.state).toBe('connected');
  });
});

describe('falhas de sincronizacao: mensagens compreensiveis, sem texto tecnico bruto', () => {
  const fail = (eventType: string, status: string, lastError: string | null, at = '2026-10-21T17:00:00Z') => ({ provider: 'zepp', eventType, status, lastError, updatedAt: D(at) });

  it('evento que esgotou as tentativas = Com erro; tentando de novo nao muda o estado; mensagens traduzidas e agrupadas com a contagem', () => {
    const result = buildStudentIntegrations('a1', raw({
      zepp: zepp(),
      inboundFailures: [
        fail('activity_file', 'dead', 'download falhou (network)'), fail('activity_file', 'dead', 'download falhou (transient 503)', '2026-10-21T18:00:00Z'),
        fail('sleep_summary', 'failed', 'erro interno https://api-open.zepp.com/api/sleep?chave=SEGREDO123'),
      ],
    }), NOW, false);
    const z = find(result, 'zepp')!;
    expect(z.state).toBe('error');
    expect(z.failures).toHaveLength(2);
    expect(z.failures[0]).toMatchObject({ status: 'gave_up', count: 2, message: 'Falha temporária ao baixar o arquivo de uma atividade na plataforma.', at: '2026-10-21T18:00:00.000Z' });
    expect(z.failures.find((f) => f.status === 'retrying')!.message).toBe('Falha ao processar um registro de sono. O sistema registra o evento para análise técnica.');
    const text = JSON.stringify(result);
    expect(text).not.toContain('SEGREDO123'); // o erro bruto nunca e exibido
    expect(text).not.toContain('api-open.zepp.com');
    const onlyRetrying = find(buildStudentIntegrations('a1', raw({ zepp: zepp(), inboundFailures: [fail('sleep_summary', 'failed', 'x')] }), NOW, false), 'zepp')!;
    expect(onlyRetrying.state).toBe('connected');
  });

  it('traducao por causa: renovacao de autorizacao, arquivo expirado, formato ilegivel', () => {
    expect(describeFailure('activity_file', 'token indisponivel: erro')).toContain('A aluna pode precisar reconectar');
    expect(describeFailure('activity_file', 'arquivo indisponivel (expired)')).toContain('expirou na plataforma');
    expect(describeFailure('activity_file', 'FIT nao aproveitavel (corrupt)')).toContain('formato que não pôde ser lido');
  });

  it('falha no envio de treino ao relogio entra na lista, traduzida', () => {
    const z = find(buildStudentIntegrations('a1', raw({ zepp: zepp(), zeppWorkoutFailures: [{ errorMessage: 'server (-99): A Zepp nao processou o envio agora.', failedAt: D('2026-10-21T16:00:00Z'), requestedAt: D('2026-10-21T16:00:00Z') }] }), NOW, false), 'zepp')!;
    expect(z.failures[0].message).toBe('O envio do treino ao relógio falhou: a Zepp não processou o pedido agora.');
    expect(z.state).toBe('error');
  });
});

describe('autorizacao do Atlas: separada da importacao', () => {
  const atlasOf = (zeppRow: NonNullable<IntegrationsRaw['zepp']>, unlocked: boolean) => find(buildStudentIntegrations('a1', raw({ zepp: zeppRow }), NOW, unlocked), 'zepp')!.atlas;

  it('autorizou e o sistema esta ligado / ainda nao esta ligado / nao autorizou / autorizou sobre texto antigo', () => {
    expect(atlasOf(zepp(), true)).toMatchObject({ authorized: true, systemEnabled: true, since: '2026-10-21T12:05:00.000Z', needsNewAuthorization: false });
    const off = atlasOf(zepp(), false);
    expect(off).toMatchObject({ authorized: true, systemEnabled: false });
    expect(off.note).toContain('ainda não está ligado no sistema');
    const none = atlasOf(zepp({ grantedPurposes: ['history'], purposeConsents: null }), true);
    expect(none).toMatchObject({ authorized: false, since: null });
    expect(none.note).toContain('não autorizou o uso dos dados Zepp pelo Atlas');
    const stale = atlasOf(zepp({ purposeConsents: purposeRecords({ ai_external: { version: '0.9', textHash: 'x', grantedAt: '2026-10-01T00:00:00.000Z' } }) }), true);
    expect(stale).toMatchObject({ authorized: false, needsNewAuthorization: true });
  });

  it('autorizar a importacao NAO autoriza o Atlas (categorias concedidas, finalidade ausente)', () => {
    const atlasState = atlasOf(zepp({ grantedPurposes: ['history', 'tracking'], purposeConsents: purposeRecords() }), true);
    expect(atlasState.authorized).toBe(false);
  });
});

describe('outras integracoes (Strava, Polar, Wahoo, Apple, Health Connect)', () => {
  it('Strava: so mostra que esta conectada (os dados do Strava sao so da aluna); nunca categorias, datas de dado nem IA', () => {
    const strava = find(buildStudentIntegrations('a1', raw({ strava: { createdAt: D('2026-09-01T00:00:00Z') } }), NOW, false), 'strava')!;
    expect(strava).toMatchObject({ state: 'connected', categories: [], lastSyncAt: null, connectedSince: '2026-09-01T00:00:00.000Z' });
    expect(strava.atlas).toMatchObject({ applies: false, note: 'Dados do Strava nunca são enviados à IA.' });
    expect(strava.warnings.join(' ')).toContain('só para a aluna');
  });

  it('Polar: conectada com sincronizacao concluida e dados recebidos; conectada sem dado avisa; desconectada tem estado proprio; ausente e sem dado nao aparece', () => {
    const connected = find(buildStudentIntegrations('a1', raw({ polar: { createdAt: D('2026-09-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: D('2026-10-21T19:30:00Z') }, activityByProvider: { polar: { lastAt: D('2026-10-21T18:00:00Z'), count: 12 } } }), NOW, false), 'polar')!;
    expect(connected).toMatchObject({ state: 'connected', lastSyncAt: '2026-10-21T19:30:00.000Z', lastSyncBasis: 'sincronizacao_concluida' });
    expect(category(connected, 'activity')).toMatchObject({ authorized: true, lastAt: '2026-10-21T18:00:00.000Z', count: 12 });
    expect(connected.atlas).toMatchObject({ applies: true, authorized: null }); // legado: sem autorizacao especifica registrada
    const empty = find(buildStudentIntegrations('a1', raw({ polar: { createdAt: D('2026-09-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: null } }), NOW, false), 'polar')!;
    expect(empty.warnings.join(' ')).toContain('nenhuma atividade foi recebida');
    expect(empty.lastSyncAt).toBeNull();
    const gone = find(buildStudentIntegrations('a1', raw({ polar: { createdAt: D('2026-09-01T00:00:00Z'), disconnectedAt: D('2026-10-01T00:00:00Z'), lastSyncCompletedAt: null } }), NOW, false), 'polar')!;
    expect(gone.state).toBe('disconnected');
    expect(find(buildStudentIntegrations('a1', raw(), NOW, false), 'polar')).toBeUndefined();
  });

  it('Wahoo com token vencido e sem renovacao = expirada; Apple Saude e Health Connect so aparecem quando JA chegaram dados, sem inventar conexao', () => {
    const wahoo = find(buildStudentIntegrations('a1', raw({ wahoo: { createdAt: D('2026-09-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: null, accessTokenExpiresAt: D('2026-10-01T00:00:00Z'), hasRefreshToken: false } }), NOW, false), 'wahoo')!;
    expect(wahoo.state).toBe('expired');
    const result = buildStudentIntegrations('a1', raw({ activityByProvider: { apple_health: { lastAt: D('2026-10-20T10:00:00Z'), count: 4 } } }), NOW, false);
    const apple = find(result, 'apple_health')!;
    expect(apple).toMatchObject({ state: 'data_only', connectedSince: null, lastSyncBasis: 'ultimo_dado_recebido' });
    expect(apple.warnings.join(' ')).toContain('Não há registro de conexão no servidor');
    expect(find(result, 'health_connect')).toBeUndefined();
  });
});

describe('seguranca e somente leitura', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'coach', 'student-integrations.service.ts'), 'utf8');

  it('a resposta nunca carrega token, segredo, id de conta do provedor ou campos de credencial', () => {
    const result = buildStudentIntegrations('a1', raw({
      zepp: zepp(), strava: { createdAt: D('2026-09-01T00:00:00Z') },
      polar: { createdAt: D('2026-09-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: D('2026-10-21T19:30:00Z') },
      wahoo: { createdAt: D('2026-09-01T00:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: null, accessTokenExpiresAt: null, hasRefreshToken: true },
    }), NOW, true);
    const text = JSON.stringify(result).toLowerCase();
    for (const forbidden of ['accesstoken', 'refreshtoken', 'secret', 'externalaccountid', 'polaruserid', 'wahoouserid', 'athleteid', 'callbackurl', 'bearer', 'hasrefresh']) expect(text).not.toContain(forbidden);
  });

  it('o servico so le colunas de estado (nenhum token/segredo/id de conta e selecionado para exibicao) e nao escreve nada', () => {
    for (const column of ['accessTokenEncrypted: true', 'accessToken: true', 'refreshToken: true', 'externalAccountId: true', 'polarUserId: true', 'wahooUserId: true', 'athleteId: true', 'payload: true', 'clientSecret']) expect(source).not.toContain(column);
    expect(source).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(source).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it('a rota e so de consulta e fica sob o guarda de treinador/admin da propria controladora (nao ha rota de escrita nem de consentimento)', () => {
    const controller = readFileSync(join(__dirname, '..', 'src', 'coach', 'coach.controller.ts'), 'utf8');
    expect(controller).toMatch(/@UseGuards\(AuthGuard\('jwt'\), RolesGuard\)\s*@Roles\('coach', 'admin'\)\s*@Controller\('coach'\)/);
    expect(controller).toContain("@Get('students/:studentId/integrations')");
    expect(controller).not.toMatch(/@(Post|Patch|Delete|Put)\('students\/:studentId\/integrations/);
  });
});

describe('carregamento (consulta real ao banco, so leitura)', () => {
  function fakePrisma(over: Record<string, unknown> = {}) {
    const agg = (lastAt: Date | null, count: number) => jest.fn(async () => ({ _max: { receivedAt: lastAt }, _count: count }));
    return {
      user: { findUnique: jest.fn(async ({ where }: any) => (where.id === 'a1' ? { id: 'a1' } : null)) },
      polarConnection: { findUnique: jest.fn(async () => null) },
      wahooConnection: { findUnique: jest.fn(async () => null) },
      stravaConnection: { findUnique: jest.fn(async () => null) },
      providerConnection: { findUnique: jest.fn(async ({ where }: any) => (where.provider_userId.provider === 'zepp' ? { ...zepp(), accessTokenExpiresAt: D('2026-10-22T10:00:00Z'), refreshTokenEncrypted: 'cifrado' } : null)) },
      rawExternalActivity: { groupBy: jest.fn(async () => [{ provider: 'zepp', _max: { receivedAt: D('2026-10-21T18:00:00Z') }, _count: { _all: 2 } }]) },
      activityLog: { findFirst: jest.fn(async () => ({ rawActivity: { receivedAt: D('2026-10-21T18:00:00Z') } })), count: jest.fn(async () => 2) },
      wearableSleepSummary: { aggregate: agg(D('2026-10-21T09:00:00Z'), 1) },
      wearableDailySummary: { aggregate: agg(null, 0) },
      wearableHrvSummary: { aggregate: agg(null, 0) }, wearableMetricRecord: { groupBy: jest.fn(async () => []) },
      providerInboundEvent: { findFirst: jest.fn(async () => ({ processedAt: D('2026-10-21T18:01:00Z') })), findMany: jest.fn(async () => []) },
      workoutDelivery: { findFirst: jest.fn(async () => ({ providerMetadata: { windowAcceptedAt: '2026-10-21T00:05:00.000Z' }, sentAt: D('2026-10-20T00:00:00Z') })), findMany: jest.fn(async () => []) },
      ...over,
    };
  }
  const config = (env: Record<string, string> = {}) => ({ get: (k: string) => env[k] }) as never;

  it('aluno inexistente: 404; aluno com Zepp: monta a visao a partir do que existe e a variavel do Atlas e lida do ambiente', async () => {
    const service = new StudentIntegrationsService(fakePrisma() as never, config({ ZEPP_EXTERNAL_AI_ENABLED: 'true' }));
    await expect(service.forStudent('outro')).rejects.toBeInstanceOf(NotFoundException);
    const result = await service.forStudent('a1');
    const z = find(result as never, 'zepp')!;
    expect(z.state).toBe('connected');
    expect(category(z, 'activity')).toMatchObject({ count: 2, lastAt: '2026-10-21T18:00:00.000Z' });
    expect(category(z, 'sleep')).toMatchObject({ count: 1 });
    expect(category(z, 'watch_delivery').lastAt).toBe('2026-10-21T00:05:00.000Z');
    expect(z.atlas.systemEnabled).toBe(true);
    const off = await new StudentIntegrationsService(fakePrisma() as never, config()).forStudent('a1');
    expect(find(off as never, 'zepp')!.atlas.systemEnabled).toBe(false); // sem a variavel, nada e enviado
  });

  it('todas as consultas de conexao usam select (nenhuma devolve o registro inteiro com tokens)', async () => {
    const prisma = fakePrisma();
    await new StudentIntegrationsService(prisma as never, config()).forStudent('a1');
    for (const model of ['polarConnection', 'wahooConnection', 'stravaConnection', 'providerConnection'] as const) {
      const args = ((prisma as any)[model].findUnique as jest.Mock).mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(JSON.stringify(args.select)).not.toMatch(/accessToken(Encrypted)?"|"accessToken"|polarUserId|wahooUserId|externalAccountId|athleteId/);
    }
  });
});

describe('envio de treinos ao relogio: diagnostico em camadas (sem alterar nenhum estado)', () => {
  const watchOf = (zeppRow: NonNullable<IntegrationsRaw['zepp']>, zeppWatch?: IntegrationsRaw['zeppWatch']) => category(find(buildStudentIntegrations('a1', raw({ zepp: zeppRow, zeppWatch }), NOW, false), 'zepp')!, 'watch_delivery');
  const check = (c: ReturnType<typeof watchOf>, label: string) => c.checks!.find((k) => k.label.startsWith(label))!;

  it('conectou mas NUNCA concedeu a finalidade propria: nao autorizada, com a causa exata (a conexao nao autoriza o envio)', () => {
    const c = watchOf(zepp({ grantedPurposes: ['history', 'tracking'], purposeConsents: null }), { publishingEnabled: true, unitProfileConfirmed: true });
    expect(c.authorized).toBe(false);
    expect(check(c, 'Autorização da aluna')).toMatchObject({ ok: false });
    expect(check(c, 'Autorização da aluna').detail).toContain('ainda não concedeu');
    expect(check(c, 'Publicador')).toMatchObject({ ok: true });
    expect(check(c, 'Conexão')).toMatchObject({ ok: true });
    expect(check(c, 'Aplicativo habilitado pela Zepp').ok).toBeNull(); // nao verificavel pelo painel: nunca presumido
  });

  it('autorizou sobre texto antigo: distingue de "nunca autorizou"; autorizou: ok; nunca vira autorizada por outra via', () => {
    const stale = watchOf(zepp({ purposeConsents: purposeRecords({ watch_delivery: { version: '0.1', textHash: 'x', grantedAt: '2026-10-01T00:00:00.000Z' } }) }));
    expect(stale.authorized).toBe(false);
    expect(check(stale, 'Autorização da aluna').detail).toContain('texto antigo');
    const ok = watchOf(zepp());
    expect(ok.authorized).toBe(true);
    expect(check(ok, 'Autorização da aluna')).toMatchObject({ ok: true });
  });

  it('autorizacao individual e configuracao do servidor sao camadas independentes: publicador desligado ou perfil nao confirmado aparecem como bloqueio proprio', () => {
    const c = watchOf(zepp(), { publishingEnabled: false, unitProfileConfirmed: false });
    expect(c.authorized).toBe(true); // a aluna autorizou: isso nao e rebaixado por causa da configuracao
    expect(check(c, 'Publicador')).toMatchObject({ ok: false });
    expect(check(c, 'Perfil de unidades')).toMatchObject({ ok: false });
    expect(watchOf(zepp()).checks!.find((k) => k.label.startsWith('Publicador'))!.ok).toBeNull(); // sem informacao: nao inventa
  });
});

describe('Health Connect no painel: autorizacoes registradas x dados que de fato chegaram (22/10/2026)', () => {
  const NOWH = new Date('2026-10-22T12:00:00Z');
  const hcRow = (over: Record<string, unknown> = {}) => ({ createdAt: new Date('2026-10-22T10:00:00Z'), disconnectedAt: null, grantedCategories: ['activity', 'sleep', 'hrv'], grantedPurposes: ['history', 'tracking'], purposeConsents: {}, consentVersion: HEALTH_CONNECT_CONSENT.version, consentTextHash: consentTextHash(HEALTH_CONNECT_CONSENT), ...over });
  const hcEntry = (rawOver: Partial<IntegrationsRaw>, unlocked = false) => find(buildStudentIntegrations('a1', raw(rawOver), NOWH, false, unlocked), 'health_connect');

  it('sem registro de autorizacao: segue o caso antigo (so aparece se ja chegaram dados, sem inventar conexao)', () => {
    expect(hcEntry({})).toBeUndefined();
    expect(hcEntry({ activityByProvider: { health_connect: { lastAt: D('2026-10-20T10:00:00Z'), count: 2 } } })).toMatchObject({ state: 'data_only' });
  });

  it('com autorizacoes: categorias autorizadas x recebidas separadas; autorizada sem dado avisa; nao autorizada nao conta como recebida', () => {
    const entry = hcEntry({ healthConnect: hcRow() as never, hcReceipts: { sleep: { lastAt: D('2026-10-22T08:00:00Z'), count: 3 } }, activityByProvider: { health_connect: { lastAt: D('2026-10-21T09:00:00Z'), count: 2 } } })!;
    expect(entry).toMatchObject({ state: 'connected', stateLabel: 'Autorizações registradas', lastSyncBasis: 'ultimo_dado_recebido', lastSyncAt: '2026-10-22T08:00:00.000Z' });
    expect(category(entry, 'exercise')).toMatchObject({ authorized: true, count: 2 });
    expect(category(entry, 'sleep')).toMatchObject({ authorized: true, count: 3 });
    expect(category(entry, 'hrv')).toMatchObject({ authorized: true, count: 0 });
    expect(category(entry, 'fitness')).toMatchObject({ authorized: false, count: 0 });
    expect(entry.warnings.join(' ')).toContain('Autorizadas, mas ainda sem dados recebidos: Variabilidade da frequência cardíaca (HRV)');
    expect(entry.warnings.join(' ')).toContain('fica no celular da aluna');
  });

  it('Atlas separado: autorizado + liberado / autorizado sem liberacao no sistema / nunca autorizou; retirou tudo = desconectada', () => {
    const atlas = HEALTH_CONNECT_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')!;
    const granted = hcRow({ grantedPurposes: ['history', 'ai_external'], purposeConsents: { ai_external: { version: atlas.screen!.version, textHash: purposeTextHash(atlas), grantedAt: '2026-10-22T11:00:00.000Z' } } });
    expect(hcEntry({ healthConnect: granted as never }, true)!.atlas).toMatchObject({ authorized: true, systemEnabled: true, since: '2026-10-22T11:00:00.000Z' });
    expect(hcEntry({ healthConnect: granted as never }, false)!.atlas.note).toContain('ainda não está ligado');
    expect(hcEntry({ healthConnect: hcRow() as never })!.atlas).toMatchObject({ authorized: false });
    expect(hcEntry({ healthConnect: hcRow({ disconnectedAt: new Date('2026-10-22T11:30:00Z') }) as never })).toMatchObject({ state: 'disconnected' });
  });

  it('texto das autorizacoes mudou: nada vale como autorizado e o painel avisa', () => {
    const entry = hcEntry({ healthConnect: hcRow({ consentVersion: '0.9' }) as never })!;
    expect(entry.categories.every((c) => c.authorized === false)).toBe(true);
    expect(entry.warnings.join(' ')).toContain('suspenso');
  });
});

// COROS no painel do treinador (30/10/2026)
describe('COROS no painel do treinador', () => {
  const corosWatch = COROS_CONSENT.optionalPurposes.find((p) => p.id === 'watch_delivery')!;
  const corosAtlas = COROS_CONSENT.optionalPurposes.find((p) => p.id === 'ai_external')!;
  const corosRow = (over: Record<string, unknown> = {}) => ({
    createdAt: D('2026-10-30T10:00:00Z'), disconnectedAt: null, lastSyncCompletedAt: D('2026-10-30T14:00:00Z'), accessTokenExpiresAt: D('2026-11-29T10:00:00Z'), hasRefreshToken: true,
    grantedCategories: ['profile', 'activity', 'activity_sensors'], grantedPurposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view', 'watch_delivery'],
    purposeConsents: { watch_delivery: { version: corosWatch.screen!.version, textHash: purposeTextHash(corosWatch), grantedAt: '2026-10-30T10:05:00.000Z' } },
    consentVersion: COROS_CONSENT.version, consentTextHash: consentTextHash(COROS_CONSENT), ...over,
  });
  const corosRaw = (over: Record<string, unknown> = {}, config = { syncEnabled: true, publishingEnabled: true, externalAiUnlocked: false }) => raw({
    coros: { row: corosRow(over.row as Record<string, unknown>), activity: { lastAt: D('2026-10-30T13:00:00Z'), count: 3 }, sensors: { lastAt: D('2026-10-30T13:00:00Z'), count: 3 }, route: none, workoutLastSentAt: D('2026-10-30T11:00:00Z'), workoutFailures: [], removalPending: [], config, ...(over.coros as object) },
  });

  it('mostra a conexao, o que chegou por categoria, o envio de treinos e o Atlas; grupo nao autorizado (percurso) aparece como nao autorizado', () => {
    const entry = find(buildStudentIntegrations('a1', corosRaw(), NOW, false), 'coros')!;
    expect(entry).toMatchObject({ name: 'COROS', state: 'connected' });
    expect(category(entry, 'activity')).toMatchObject({ authorized: true, count: 3, direction: 'recebe' });
    expect(category(entry, 'activity_sensors')).toMatchObject({ authorized: true, count: 3 });
    expect(category(entry, 'activity_route')).toMatchObject({ authorized: false, count: 0 });
    expect(category(entry, 'watch_delivery')).toMatchObject({ authorized: true, direction: 'envia' });
    expect(entry.atlas).toMatchObject({ authorized: false, systemEnabled: false });
    expect(entry.categories.some((c) => /sono|HRV/i.test(c.label))).toBe(false); // so' o que existe
  });

  it('treinos que a COROS nao deixa apagar viram aviso ao treinador; servidor com importacao desligada tambem avisa', () => {
    const entry = find(buildStudentIntegrations('a1', corosRaw({ coros: { removalPending: [{ date: '2026-11-02', reason: 'mudou_de_dia' }] } }, { syncEnabled: false, publishingEnabled: true, externalAiUnlocked: false }), NOW, false), 'coros')!;
    expect(entry.warnings.join(' ')).toContain('02/11');
    expect(entry.warnings.join(' ')).toContain('COROS_SYNC_ENABLED');
  });

  it('sem conexao nem dado: nao aparece (nada e inventado)', () => {
    expect(find(buildStudentIntegrations('a1', raw({ coros: { row: null, activity: none, sensors: none, route: none, workoutLastSentAt: null, workoutFailures: [], removalPending: [], config: { syncEnabled: false, publishingEnabled: false, externalAiUnlocked: false } } }), NOW, false), 'coros')).toBeUndefined();
  });
});
