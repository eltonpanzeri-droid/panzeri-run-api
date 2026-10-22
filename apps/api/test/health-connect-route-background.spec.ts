import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { normalizeRoutes, MAX_POINTS_PER_ROUTE } from '../src/health-connect/health-connect-route';
import { HealthConnectRouteService } from '../src/health-connect/health-connect-route.service';
import { buildRoutePayload, MAX_ROUTE_POINTS, routeKind } from '../../mobile/src/healthConnect/route';
import { createHealthConnectSync, HealthConnectGateway, SyncStore } from '../../mobile/src/healthConnect/sync';
import { HcRawSession } from '../../mobile/src/healthConnect/contract';
import { accessTokenExpiresAtMs, jwtPayload, userIdFromAccessToken } from '../../mobile/src/healthConnect/contract';

// Percurso GPS e leitura em segundo plano do Health Connect (22/10/2026). Dados SINTETICOS; o aparelho real (Galaxy Watch) segue pendente de validacao.

const START = '2026-10-21T09:00:00.000Z';
const loc = (secs: number, lat = -23.5, lng = -46.6, alt?: number) => ({ time: new Date(new Date(START).getTime() + secs * 1000).toISOString(), latitude: lat + secs * 0.00001, longitude: lng, altitude: alt === undefined ? null : { inMeters: alt } });

describe('percurso GPS: montagem no app (nada estimado)', () => {
  it('pontos compactos com deslocamento desde o inicio; ordena, descarta repetidos/anteriores ao inicio e coordenadas invalidas', () => {
    const payload = buildRoutePayload('rec-1', START, [loc(30, -23.5, -46.6, 760.04), loc(0), loc(30), loc(-10), { ...loc(60), latitude: Number.NaN }, loc(90)])!;
    expect(payload.recordId).toBe('rec-1');
    expect(payload.points.map((p) => p[0])).toEqual([0, 30, 90]);
    expect(payload.points[1]).toEqual([30, -23.4997, -46.6, 760]);
    expect(payload.points[0][3]).toBeNull(); // sem altitude => nulo, nunca zero
    expect(buildRoutePayload('rec-1', START, [loc(0)])).toBeNull(); // um ponto so nao e percurso
    expect(buildRoutePayload('', START, [loc(0), loc(5)])).toBeNull();
  });

  it('acima do limite, so reduz o NUMERO de pontos (amostragem uniforme), mantendo o primeiro e o ultimo', () => {
    const many = Array.from({ length: 5000 }, (_, i) => loc(i));
    const payload = buildRoutePayload('rec-1', START, many)!;
    expect(payload.points).toHaveLength(MAX_ROUTE_POINTS);
    expect(payload.points[0][0]).toBe(0);
    expect(payload.points[payload.points.length - 1][0]).toBe(4999);
    expect(JSON.stringify(payload).length).toBeLessThan(90_000); // cabe no limite de corpo do servidor
  });
});

describe('percurso GPS: servidor (so com a categoria autorizada AGORA)', () => {
  it('validacao: faixas de latitude/longitude, ordem crescente, minimo de 2 pontos, limites de tamanho', () => {
    expect(normalizeRoutes(null)).toEqual({ ok: false, reason: 'lista_vazia' });
    expect(normalizeRoutes({ routes: Array.from({ length: 6 }, () => ({})) })).toEqual({ ok: false, reason: 'rotas_demais' });
    const ok = normalizeRoutes({ routes: [{ recordId: 'a', points: [[0, -23.5, -46.6, 700], [5, -23.51, -46.6, null], [4, -23.52, -46.6, null], [9, 200, -46.6, null], [10, -23.53, -46.6, 99999]] }] });
    expect(ok.ok && ok.routes[0].points).toEqual([
      { offsetSec: 0, latitude: -23.5, longitude: -46.6, elevationMeters: 700 }, { offsetSec: 5, latitude: -23.51, longitude: -46.6, elevationMeters: null }, { offsetSec: 10, latitude: -23.53, longitude: -46.6, elevationMeters: null },
    ]);
    expect(normalizeRoutes({ routes: [{ recordId: 'a', points: [[0, 1, 1]] }] })).toEqual({ ok: false, reason: 'nenhuma_rota_valida' });
    expect(normalizeRoutes({ routes: [{ recordId: 'a', points: Array.from({ length: MAX_POINTS_PER_ROUTE + 1 }, (_, i) => [i, 1, 1]) }] })).toEqual({ ok: false, reason: 'nenhuma_rota_valida' });
  });

  function setupService(categories: string[]) {
    const tx = {
      activityLog: { findUnique: jest.fn(async ({ where }: any) => (where.provider_userId_externalId.externalId === 'rec-1' ? { id: 'log-1' } : null)), update: jest.fn(async () => ({})) },
      activityTimeSeriesPoint: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 0 })) },
    };
    const consent = {
      allowedCategories: jest.fn(async () => new Set(categories)),
      writeWhileAuthorized: jest.fn(async (_user: string, write: any) => write(tx, new Set(categories))),
    };
    return { tx, service: new HealthConnectRouteService({} as never, consent as never) };
  }
  const body = { routes: [{ recordId: 'rec-1', points: [[0, -23.5, -46.6, null], [5, -23.51, -46.6, null]] }] };

  it('sem o percurso (ou sem os exercicios) autorizado: 403 e NADA e gravado', async () => {
    for (const categories of [[], ['activity'], ['activity_route']]) {
      const { service, tx } = setupService(categories);
      await expect(service.importRoutes('u1', body)).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.activityTimeSeriesPoint.createMany).not.toHaveBeenCalled();
    }
    await expect(setupService(['activity', 'activity_route']).service.importRoutes('u1', { routes: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('achado 2: a altitude do percurso so e gravada com a categoria de sensores autorizada', async () => {
    const withSensors = setupService(['activity', 'activity_route', 'activity_sensors']);
    await withSensors.service.importRoutes('u1', { routes: [{ recordId: 'rec-1', points: [[0, -23.5, -46.6, 700], [5, -23.51, -46.6, 710]] }] });
    expect((withSensors.tx.activityTimeSeriesPoint.createMany.mock.calls[0] as any[])[0].data.map((p: any) => p.elevationMeters)).toEqual([700, 710]);
    const withoutSensors = setupService(['activity', 'activity_route']);
    await withoutSensors.service.importRoutes('u1', { routes: [{ recordId: 'rec-1', points: [[0, -23.5, -46.6, 700], [5, -23.51, -46.6, 710]] }] });
    expect((withoutSensors.tx.activityTimeSeriesPoint.createMany.mock.calls[0] as any[])[0].data.map((p: any) => p.elevationMeters)).toEqual([null, null]);
  });

  it('autorizado: refaz so os pontos de localizacao daquela atividade (idempotente), marca hasRoute; atividade desconhecida e rejeitada', async () => {
    const { service, tx } = setupService(['activity', 'activity_route']);
    const result = await service.importRoutes('u1', { routes: [...body.routes, { recordId: 'nao-existe', points: body.routes[0].points }] });
    expect(result).toMatchObject({ stored: 1, rejected: 1 });
    expect(result.items[1].reason).toBe('atividade_nao_encontrada');
    expect(tx.activityTimeSeriesPoint.deleteMany).toHaveBeenCalledWith({ where: { activityLogId: 'log-1', provider: 'health_connect', latitude: { not: null } } }); // nao apaga FC/potencia etc.
    expect((tx.activityTimeSeriesPoint.createMany.mock.calls[0] as any[])[0].data).toHaveLength(2);
    expect(tx.activityLog.update).toHaveBeenCalledWith({ where: { id: 'log-1' }, data: { hasRoute: true } });
  });

  it('retirar o percurso apaga os pontos de localizacao (e a retirada dos exercicios tambem); a rota exige JWT', () => {
    const consent = readFileSync(join(__dirname, '..', 'src', 'health-connect', 'health-connect-consent.service.ts'), 'utf8');
    expect(consent).toContain("c === 'activity_route' || c === 'activity'");
    expect(consent).toContain('scrubRouteData');
    expect(consent).toMatch(/activityTimeSeriesPoint\.deleteMany\(\{ where: \{ provider: HEALTH_CONNECT_PROVIDER_ID, latitude: \{ not: null \}/);
    const controller = readFileSync(join(__dirname, '..', 'src', 'health-connect', 'health-connect.controller.ts'), 'utf8');
    expect(controller).toMatch(/@UseGuards\(AuthGuard\('jwt'\)\)\s*@HttpCode\(200\)\s*@Post\('routes'\)/);
    expect(controller).toContain('this.routes.importRoutes(user.sub, body)');
  });
});

describe('percurso GPS: sincronizacao no app', () => {
  const session = (id: string, route?: HcRawSession['exerciseRoute']): HcRawSession => ({ metadata: { id, dataOrigin: 'com.sec.android.app.shealth' }, exerciseType: 56, startTime: START, endTime: '2026-10-21T09:55:00.000Z', startZoneOffset: { totalSeconds: -10800 }, exerciseRoute: route ?? null });
  function setup(sessions: HcRawSession[], opts: { routeCategory?: boolean } = {}) {
    const posted: any[] = []; const routeCalls: Array<{ id: string; interactive: boolean }> = [];
    const data = new Map<string, string>();
    const store: SyncStore = { get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async (k) => { data.delete(k); } };
    const hc: HealthConnectGateway = {
      getSdkStatus: async () => 'available', initialize: async () => true, getGrantedRecordTypes: async () => ['ExerciseSession'], requestPermissions: async () => ['ExerciseSession'], revokeAllPermissions: async () => undefined,
      readSessions: async () => sessions, readDistance: async () => [], readHeartRate: async () => [],
      getExerciseRoute: async (s, interactive) => { routeCalls.push({ id: s.metadata!.id!, interactive }); return s.exerciseRoute?.route ?? (interactive ? [loc(0), loc(10)] : []); },
    };
    const sync = createHealthConnectSync({
      hc, store, userId: 'u1', now: () => new Date('2026-10-22T12:00:00.000Z'),
      getAuthorizedCategories: async () => ({ categories: new Set(opts.routeCategory === false ? ['activity'] : ['activity', 'activity_route']), history: false }),
      postExercises: async (items) => ({ created: items.length, updated: 0, alreadyImported: 0, rejected: 0 }),
      postRoutes: async (items) => { posted.push(items); return { stored: items.length, rejected: 0, items: items.map((i) => ({ recordId: i.recordId, status: 'stored' })) }; },
    });
    return { sync, posted, routeCalls, data };
  }

  it('com o grupo autorizado envia o percurso; so a leitura interativa (toque em Sincronizar) pode pedir a confirmacao do Android; depois de enviado nao pede de novo', async () => {
    const withData = session('a', { type: 0, route: [loc(0), loc(10), loc(20)] });
    const needsConsent = session('b', { type: 2 });
    const s = setup([withData, needsConsent]);
    await s.sync.connect();
    await s.sync.syncNow({ interactive: false });
    expect(s.routeCalls).toEqual([{ id: 'a', interactive: false }]); // 'b' exige confirmacao: nem chama o Android sem ser interativa, fica pendente
    expect(s.posted.flat().map((p: any) => p.recordId)).toEqual(['a']); // 'b' exigia confirmacao e a leitura nao era interativa
    s.routeCalls.length = 0; s.posted.length = 0;
    await s.data.set('panzeri-run:health-connect:u1:cursor', '2026-10-01T00:00:00.000Z');
    await s.sync.syncNow({ interactive: true });
    expect(s.routeCalls.map((c) => c.id)).toEqual(['b']); // 'a' ja' foi enviado: nao se repete
    expect(s.routeCalls[0].interactive).toBe(true);
    expect(s.posted.flat().map((p: any) => p.recordId)).toEqual(['b']);
  });

  it('sem o grupo "Percurso GPS" autorizado: o percurso nem e lido', async () => {
    const s = setup([session('a', { type: 0, route: [loc(0), loc(10)] })], { routeCategory: false });
    await s.sync.connect();
    await s.sync.syncNow({ interactive: true });
    expect(s.routeCalls).toEqual([]);
    expect(s.posted).toEqual([]);
  });
});

describe('percurso GPS: tipo real do modulo nativo (texto), negativa e fila de pendentes', () => {
  const session = (id: string, type: string | number, route?: any[]): HcRawSession => ({ metadata: { id }, exerciseType: 56, startTime: START, endTime: '2026-10-21T09:55:00.000Z', exerciseRoute: { type, route } as never });
  function setup(sessions: HcRawSession[], getRoute: (s: HcRawSession, interactive: boolean) => Promise<any>) {
    const posted: string[] = []; const data = new Map<string, string>();
    const store: SyncStore = { get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async (k) => { data.delete(k); } };
    const hc: HealthConnectGateway = { getSdkStatus: async () => 'available', initialize: async () => true, getGrantedRecordTypes: async () => ['ExerciseSession'], requestPermissions: async () => ['ExerciseSession'], revokeAllPermissions: async () => undefined, readSessions: async () => sessions, readDistance: async () => [], readHeartRate: async () => [], getExerciseRoute: getRoute };
    let categories = ['activity', 'activity_route'];
    const sync = createHealthConnectSync({
      hc, store, userId: 'u1', now: () => new Date('2026-10-22T12:00:00.000Z'), getAuthorizedCategories: async () => ({ categories: new Set(categories), history: false }),
      postExercises: async (items) => ({ created: items.length, updated: 0, alreadyImported: 0, rejected: 0 }),
      postRoutes: async (items) => { for (const i of items) posted.push(i.recordId); return { stored: items.length, rejected: 0, items: items.map((i) => ({ recordId: i.recordId, status: 'stored' })) }; },
    });
    return { sync, posted, data, setCategories: (next: string[]) => { categories = next; } };
  }

  it('o tipo vem como TEXTO do modulo nativo ("DATA"/"CONSENT_REQUIRED"): ambos sao reconhecidos (e tambem os numeros)', async () => {
    expect(['DATA', 0].map(routeKind)).toEqual(['data', 'data']);
    expect(['CONSENT_REQUIRED', 2].map(routeKind)).toEqual(['consent', 'consent']);
    expect(['NO_DATA', 1, undefined, 'x'].map(routeKind)).toEqual(['none', 'none', 'none', 'none']);
    const s = setup([session('a', 'DATA', [loc(0), loc(10)])], async (sess) => sess.exerciseRoute!.route as never);
    await s.sync.connect();
    await s.sync.syncNow();
    expect(s.posted).toEqual(['a']);
  });

  it('a aluna NEGA o acesso de um exercicio: nao e erro (o marcador avanca), nao se pergunta de novo e os demais seguem', async () => {
    const asked: string[] = [];
    const s = setup([session('x', 'CONSENT_REQUIRED'), session('y', 'DATA', [loc(0), loc(10)])], async (sess, interactive) => { asked.push(sess.metadata!.id! + (interactive ? '!' : '')); return sess.metadata!.id === 'x' ? 'denied' : (sess.exerciseRoute!.route as never); });
    await s.sync.connect();
    const first = await s.sync.syncNow({ interactive: true });
    expect(first.failedCategories).toEqual([]);
    expect(s.data.has('panzeri-run:health-connect:u1:cursor')).toBe(true);
    expect(s.posted).toEqual(['y']);
    asked.length = 0;
    await s.data.set('panzeri-run:health-connect:u1:cursor', '2026-10-01T00:00:00.000Z');
    await s.sync.syncNow({ interactive: true });
    expect(asked).not.toContain('x!'); // nao pergunta de novo
  });

  it('exercicio que exigia confirmacao numa leitura NAO interativa fica PENDENTE e e revisitado no proximo toque em Sincronizar, mesmo sem ter sido modificado', async () => {
    const s = setup([session('p', 'CONSENT_REQUIRED')], async (_sess, interactive) => (interactive ? [loc(0), loc(10)] : []));
    await s.sync.connect();
    await s.sync.syncNow({ interactive: false }); // abrir o app / segundo plano: nao abre janela
    expect(s.posted).toEqual([]);
    expect(JSON.parse(s.data.get('panzeri-run:health-connect:u1:routesPending') ?? '[]')).toEqual(['p']);
    await s.data.set('panzeri-run:health-connect:u1:cursor', '2026-10-22T11:59:00.000Z'); // sessao antiga, nao entra mais em "novas/modificadas"
    await s.sync.syncNow({ interactive: true });
    expect(s.posted).toEqual(['p']);
  });

  it('retirar o percurso zera a fila local (done/denied/pending): reautorizar depois reenvia do zero', async () => {
    const s = setup([session('a', 'DATA', [loc(0), loc(10)])], async (sess) => sess.exerciseRoute!.route as never);
    await s.sync.connect();
    await s.sync.syncNow();
    expect(JSON.parse(s.data.get('panzeri-run:health-connect:u1:routesDone') ?? '[]')).toEqual(['a']);
    s.setCategories(['activity']); // percurso retirado
    await s.data.set('panzeri-run:health-connect:u1:cursor', '2026-10-01T00:00:00.000Z');
    await s.sync.syncNow();
    expect(s.data.has('panzeri-run:health-connect:u1:routesDone')).toBe(false);
    s.setCategories(['activity', 'activity_route']);
    s.posted.length = 0;
    await s.data.set('panzeri-run:health-connect:u1:cursor', '2026-10-01T00:00:00.000Z');
    await s.sync.syncNow();
    expect(s.posted).toEqual(['a']);
  });
});

describe('segundo plano: salvaguardas do codigo', () => {
  const mobile = (p: string) => readFileSync(join(__dirname, '..', '..', 'mobile', p), 'utf8');
  const task = mobile('src/healthConnect/backgroundTask.ts');

  it('so Android; nao interativo (nunca abre janela); confere o acesso do Android e usa o MESMO sync (autorizacoes do servidor a cada execucao)', () => {
    expect(task).toContain("Platform.OS !== 'android'");
    expect(task).toContain('syncNow({ interactive: false })');
    expect(task).toContain('hasBackgroundAccess');
    expect(task).toContain('buildHealthConnectSync');
    expect(mobile('index.js')).toContain("import './src/healthConnect/backgroundTask'"); // definida no inicio do app (tambem quando o Android acorda sem abrir a tela)
  });

  it('sessao: a tarefa NUNCA renova nem grava a sessao (um refresh token por aluna, troca nao atomica): usa so o access token vigente, e vencido pula; sair da conta/desconectar encerra a tarefa', () => {
    expect(task).not.toContain('/auth/refresh');
    expect(task).not.toContain('AsyncStorage.setItem');
    expect(task).toContain('usableAccessToken');
    expect(task).toContain('RENEW_BEFORE_MS');
    expect(task).toContain("const AUTH_SESSION_KEY = 'panzeri-run-auth-session'");
    const app = mobile('App.tsx');
    expect(app).toContain("const AUTH_SESSION_KEY = 'panzeri-run-auth-session'"); // mesma chave nos dois lugares
    expect(app).toContain('void disableBackgroundSync()'); // logout
    expect(mobile('src/healthConnect/HealthConnectCard.tsx')).toContain('await disableBackgroundSync()'); // desconectar
  });

  it('o card oferece ligar e desligar o segundo plano, pedindo o acesso na janela do Android (nunca liga sozinho)', () => {
    const card = mobile('src/healthConnect/HealthConnectCard.tsx');
    expect(card).toContain('Permitir leitura em segundo plano');
    expect(card).toContain('Desligar leitura em segundo plano');
    expect(card).toContain('requestBackgroundAccess');
    expect(card).toContain('enableBackgroundSync');
    expect(card).toContain('disableBackgroundSync');
  });

  it('o texto das autorizacoes (v1.1) e a Politica descrevem segundo plano e percurso GPS', () => {
    const consent = readFileSync(join(__dirname, '..', 'src', 'health-connect', 'health-connect-consent.ts'), 'utf8');
    expect(consent).toContain("version: '1.1'");
    expect(consent).toContain('em segundo plano');
    const legal = readFileSync(join(__dirname, '..', 'src', 'legal', 'legal-content.ts'), 'utf8');
    expect(legal).toContain('em segundo plano');
    expect(legal).not.toContain('hoje não sincroniza continuamente em segundo plano');
  });

  it('JWT: leitura de exp e sub para decidir a renovacao', () => {
    const token = `h.${Buffer.from(JSON.stringify({ sub: 'user-1', exp: 1_800_000_000 })).toString('base64url')}.s`;
    expect(userIdFromAccessToken(token)).toBe('user-1');
    expect(accessTokenExpiresAtMs(token)).toBe(1_800_000_000_000);
    expect(accessTokenExpiresAtMs('lixo')).toBeNull();
    expect(jwtPayload('a.@@@.c')).toBeNull();
  });
});
