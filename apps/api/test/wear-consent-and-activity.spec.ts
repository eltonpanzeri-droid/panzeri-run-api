import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConnectorRegistry } from '../src/provider-hub/connector-registry';
import { consentTextHash } from '../src/provider-hub/provider-consent.service';
import { WEAR_OS_CATEGORIES, WEAR_OS_CONSENT, WEAR_OS_PROVIDER_ID } from '../src/wear/wear-consent';
import { WearConsentService } from '../src/wear/wear-consent.service';
import { normalizeWearActivity, WEAR_LIMITS } from '../src/wear/wear-activity';
import { WearActivityService } from '../src/wear/wear-activity.service';
import { isWearActivityJson, WEAR_ACTIVITY_MAX_BYTES } from '../src/wear/wear-body';
import { WEAR_OS_CONNECTOR } from '../src/wear/wear.module';
import { EXTERNAL_AI_APPROVED_PROVIDERS, externalAiUnlockedFor } from '../src/ai-governance/ai-data-eligibility.service';

// 17/11/2026 — Wear OS, fase 3 parte 2: consentimento proprio (com IA e GPS so' durante o treino), gravacao do treino do relogio com consentimento POR CAMPO e uso pela IA. Sem banco real.

const HASH = consentTextHash(WEAR_OS_CONSENT);
const ack = { acknowledged: true, version: WEAR_OS_CONSENT.version, textHash: HASH };

describe('documento de consentimento do relogio', () => {
  it('registra no registro de conectores sem erro e declara so as tres categorias do relogio', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.register(WEAR_OS_CONNECTOR)).not.toThrow();
    expect(registry.get(WEAR_OS_PROVIDER_ID)?.consent?.version).toBe('1.0');
    expect([...WEAR_OS_CATEGORIES]).toEqual(['activity', 'activity_sensors', 'activity_route']);
  });
  it('grupos: corridas, frequencia cardiaca e percurso (os dois ultimos dependem de corridas); nada de saude do dia a dia', () => {
    const groups = WEAR_OS_CONSENT.groups;
    expect(groups.map((g) => g.id)).toEqual(['activity', 'sensors', 'route']);
    expect(groups.find((g) => g.id === 'route')?.requires).toEqual(['activity']);
    expect(groups.every((g) => !g.required)).toBe(true);
    // nenhum grupo de saude do dia a dia: so' as tres categorias do treino gravado no relogio
    expect(groups.flatMap((g) => g.categories as readonly string[])).toEqual(['activity', 'activity_sensors', 'activity_route']);
  });
  it('o texto diz as tres coisas que Elton decidiu: GPS so durante o treino, IA com o percurso, e o desligamento da IA', () => {
    const text = JSON.stringify(WEAR_OS_CONSENT);
    expect(text).toContain('só funcionam durante o treino');
    expect(text).toContain('não usa localização em segundo plano');
    expect(text).toMatch(/incluindo o percurso GPS quando você o autorizar, são enviados à Anthropic/);
    expect(text).toContain('desligar o uso dos dados do relógio pela inteligência artificial');
    expect(text).not.toContain('não é enviado à inteligência artificial');
    // decisao de Elton (17/11/2026): nenhum dado da aluna vai a servico de clima; o texto nao promete temperatura
    expect(text).not.toMatch(/meteorolog|clima|temperatura/i);
    expect(WEAR_OS_CONSENT.optionalPurposes.map((p) => p.id)).toEqual(['ai_external']);
    expect(WEAR_OS_CONSENT.optionalPurposes[0].screen).toBeUndefined(); // a IA ja esta no texto da conexao
  });
  it('a IA do relogio esta liberada na lista de provedores aprovados; a segunda trava continua sendo a variavel de ambiente', () => {
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).toContain('wear_os');
    expect(externalAiUnlockedFor('wear_os', { get: () => undefined })).toBe(false);
    expect(externalAiUnlockedFor('wear_os', { get: (key: string) => (key === 'WEAR_OS_EXTERNAL_AI_ENABLED' ? 'true' : undefined) as never })).toBe(true);
  });
});

// ---- consentimento (servico) com a tabela simulada em memoria
function consentHarness() {
  const state: { row: Record<string, unknown> | null } = { row: null };
  const scrubs: string[] = [];
  const events: Array<{ type: string }> = [];
  const tx = {
    $queryRaw: jest.fn(async () => (state.row ? [state.row] : [])),
    providerConnection: {
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => { state.row = state.row ? { ...state.row, ...update } : { disconnectedAt: null, ...create }; return state.row; }),
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { if (state.row) state.row = { ...state.row, ...data }; return { count: state.row ? 1 : 0 }; }),
    },
    activityTimeSeriesPoint: {
      deleteMany: jest.fn(async () => { scrubs.push('route-points'); return { count: 1 }; }),
      updateMany: jest.fn(async () => { scrubs.push('hr-points'); return { count: 1 }; }),
    },
    activityLog: { updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { scrubs.push(Object.keys(data).join('+')); return { count: 1 }; }) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    providerConnection: { findUnique: jest.fn(async () => state.row) },
    providerConnectionEvent: { create: jest.fn(async ({ data }: { data: { type: string } }) => { events.push({ type: data.type }); return {}; }) },
  };
  const providerData = { invalidateAiArtifacts: jest.fn().mockResolvedValue({}), deleteProviderData: jest.fn().mockResolvedValue({ deleted: 1 }) };
  return { service: new WearConsentService(prisma as never, providerData as never), state, scrubs, events, tx, prisma, providerData };
}

describe('consentimento do relogio (servico)', () => {
  it('sem aceite expresso ou com texto desatualizado: recusa conceder; so retirar nao exige aceite', async () => {
    const { service } = consentHarness();
    await expect(service.update('u1', { groups: ['activity'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('u1', { groups: ['activity'], acknowledged: true, version: '0.9', textHash: 'x' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update('u1', { groups: ['route'], ...ack })).rejects.toBeInstanceOf(BadRequestException); // percurso sem corridas
    await expect(service.update('u1', { groups: ['pescoco'], ...ack })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('u1', { groups: 'activity' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('primeira concessao: grava as categorias, liga a IA (ja esta no texto) e registra a versao e o hash do texto visto', async () => {
    const { service, state, events } = consentHarness();
    const result = await service.update('u1', { groups: ['activity', 'sensors', 'route'], ...ack });
    expect(state.row).toMatchObject({ grantedCategories: ['activity', 'activity_sensors', 'activity_route'], grantedPurposes: ['ai_external'], consentVersion: '1.0', consentTextHash: HASH });
    expect(result.ai).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['connected']);
    expect((await service.access('u1')).allowed).toEqual(new Set(['activity', 'activity_sensors', 'activity_route']));
    expect((await service.access('u1')).ai).toBe(true);
  });

  it('retirar o percurso apaga os pontos com coordenada e o hasRoute, sem pedir novo aceite; os demais grupos ficam', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity', 'sensors', 'route'], ...ack });
    await h.service.update('u1', { groups: ['activity', 'sensors'] });
    expect(h.scrubs).toEqual(['route-points', 'hasRoute']);
    expect(h.state.row).toMatchObject({ grantedCategories: ['activity', 'activity_sensors'] });
    expect((await h.service.access('u1')).allowed.has('activity_route')).toBe(false);
  });

  it('retirar a frequencia cardiaca apaga a media, a maxima e a serie', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity', 'sensors'], ...ack });
    await h.service.update('u1', { groups: ['activity'] });
    expect(h.scrubs).toEqual(['avgHeartRateBpm+maxHeartRateBpm', 'hr-points']);
  });

  it('desligar so a IA mantem os grupos e invalida os artefatos de IA; ligar de novo nao pede aceite', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity'], ...ack });
    await h.service.update('u1', { groups: ['activity'], ai: false });
    expect((await h.service.access('u1')).ai).toBe(false);
    expect((await h.service.access('u1')).allowed.has('activity')).toBe(true);
    expect(h.providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'wear_os');
  });

  it('lista vazia retira tudo: apaga percurso e sensores, desconecta e invalida a IA; depois nada e aceito', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity', 'sensors', 'route'], ...ack });
    h.scrubs.length = 0;
    await h.service.update('u1', { groups: [] });
    expect(h.scrubs).toEqual(['route-points', 'hasRoute', 'avgHeartRateBpm+maxHeartRateBpm', 'hr-points']);
    expect((await h.service.access('u1')).allowed.size).toBe(0);
    expect(h.providerData.invalidateAiArtifacts).toHaveBeenCalled();
    expect((await h.service.state('u1')).connected).toBe(false);
  });

  it('texto novo (versao diferente): o registro antigo deixa de valer ate reconfirmar (fail-closed)', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity'], ...ack });
    h.state.row = { ...h.state.row!, consentVersion: '0.5' };
    expect((await h.service.access('u1')).allowed.size).toBe(0);
    expect((await h.service.state('u1')).consent.needsReview).toBe(true);
  });

  it('excluir os treinos recebidos exige estar sem autorizacao ativa', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity'], ...ack });
    await expect(h.service.deleteReceivedData('u1')).rejects.toBeInstanceOf(ConflictException);
    await h.service.update('u1', { groups: [] });
    await expect(h.service.deleteReceivedData('u1')).resolves.toBeDefined();
    expect(h.providerData.deleteProviderData).toHaveBeenCalledWith('u1', 'wear_os');
  });
});

// ---- validacao do treino enviado pelo relogio
const UUID = '731d8bb5-de0d-4a90-92ba-09c52ce71b9e';
const NOW = new Date('2026-11-17T20:00:00Z');
const workout = (over: Record<string, unknown> = {}) => ({
  clientId: UUID, sessionId: 's1', startedAt: '2026-11-17T17:44:07.263Z', endedAt: '2026-11-17T17:45:47.274Z', utcOffsetMinutes: -180,
  durationSec: 81, elapsedSec: 100, movingSec: 70, distanceMeters: 186.6, avgHr: 103, maxHr: 150, interrupted: false,
  points: [{ t: 1, hr: 60, dist: 10, speed: 2.24 }, { t: 15, lat: 37.4222, lon: -122.0840, alt: 12.5, hr: 130, dist: 41.3, speed: 2.24 }],
  ...over,
});

describe('validacao do treino do relogio', () => {
  it('aceita um treino real e devolve tipos certos', () => {
    const w = normalizeWearActivity(workout(), NOW);
    expect(w).toMatchObject({ clientId: UUID, sessionId: 's1', durationSec: 81, elapsedSec: 100, movingSec: 70, distanceMeters: 186.6, avgHr: 103 });
    expect(w.points[1]).toMatchObject({ lat: 37.4222, lon: -122.084, alt: 12.5, hr: 130 });
    expect(w.startedAt.toISOString()).toBe('2026-11-17T17:44:07.263Z');
  });
  it.each([
    ['clientId que nao e uuid', { clientId: 'abc' }],
    ['inicio no futuro distante', { startedAt: '2026-11-18T10:00:00Z' }],
    ['inicio antes de 2020', { startedAt: '2019-01-01T00:00:00Z' }],
    ['fim antes do inicio', { endedAt: '2026-11-17T17:00:00Z' }],
    ['tempo em movimento maior que o cronometro', { movingSec: 200 }],
    ['cronometro maior que o tempo da atividade', { durationSec: 500 }],
    ['distancia absurda', { distanceMeters: 900_000 }],
    ['frequencia impossivel na media', { avgHr: 400 }],
    ['ponto com latitude impossivel', { points: [{ t: 1, lat: 95, lon: 10 }] }],
    ['coordenada pela metade', { points: [{ t: 1, lat: 10 }] }],
    ['pontos repetidos', { points: [{ t: 1, hr: 100 }, { t: 1, hr: 101 }] }],
    ['pontos fora de ordem', { points: [{ t: 5, hr: 100 }, { t: 2, hr: 101 }] }],
    ['velocidade impossivel', { points: [{ t: 1, speed: 99 }] }],
    ['corpo sem lista de pontos', { points: 'x' }],
  ])('recusa: %s', (_name, over) => {
    expect(() => normalizeWearActivity(workout(over as Record<string, unknown>), NOW)).toThrow(BadRequestException);
  });
  it('recusa corpo que nao e objeto e excesso de pontos', () => {
    expect(() => normalizeWearActivity('x', NOW)).toThrow(BadRequestException);
    expect(() => normalizeWearActivity(workout({ points: Array.from({ length: WEAR_LIMITS.maxPoints + 1 }, (_, i) => ({ t: i })) }), NOW)).toThrow(BadRequestException);
  });
  it('altitude implausivel e descartada sem recusar o treino', () => {
    expect(normalizeWearActivity(workout({ points: [{ t: 1, lat: 10, lon: 10, alt: 99999 }] }), NOW).points[0].alt).toBeNull();
  });
});

// ---- gravacao com consentimento por campo
function ingestHarness(allowed: string[], opts: { excluded?: boolean } = {}) {
  const calls = { raw: [] as Array<Record<string, unknown>>, log: [] as Array<Record<string, unknown>>, points: [] as Array<Record<string, unknown>>, deleted: 0 };
  const tx = {
    rawExternalActivity: { upsert: jest.fn(async (args: { create: Record<string, unknown> }) => { calls.raw.push(args.create); return { id: 'raw1' }; }) },
    activityLog: { upsert: jest.fn(async (args: { create: Record<string, unknown> }) => { calls.log.push(args.create); return { id: 'log1' }; }) },
    activityTimeSeriesPoint: {
      deleteMany: jest.fn(async () => { calls.deleted += 1; return { count: 0 }; }),
      createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { calls.points.push(...data); return { count: data.length }; }),
    },
  };
  const consent = { writeWhileAuthorized: jest.fn(async (_u: string, fn: (t: typeof tx, a: { allowed: Set<string>; ai: boolean }) => unknown) => fn(tx, { allowed: new Set(allowed), ai: true })) };
  const prisma = { activityExclusion: undefined, activityLog: { findFirst: jest.fn(async () => (opts.excluded ? { exclusionMode: 'ignored' } : null)) } };
  const link = { classify: jest.fn().mockResolvedValue('corresponding'), reconcileAffectedByIdentity: jest.fn().mockResolvedValue(undefined) };
  const notify = { notifyReconciliation: jest.fn().mockResolvedValue(undefined) };
  const identity = { evaluateSafely: jest.fn().mockResolvedValue({}) };
  const registry = { scheduleRefresh: jest.fn() };
  const service = new WearActivityService(prisma as never, consent as never, link as never, notify as never, identity as never, registry as never);
  return { service, calls, consent, link, notify, identity };
}

describe('gravacao do treino do relogio com consentimento por campo', () => {
  it('tudo autorizado: grava atividade, frequencia, percurso e altitude, os tres tempos e dispara o pipeline', async () => {
    const h = ingestHarness(['activity', 'activity_sensors', 'activity_route']);
    const result = await h.service.ingest('u1', 'dev1', workout(), NOW);
    expect(result).toMatchObject({ written: true, activityLogId: 'log1', classification: 'corresponding', removed: [] });
    expect(h.calls.log[0]).toMatchObject({ provider: 'wear_os', externalId: UUID, sport: 'corrida', durationSec: 81, distanceMeters: 186.6, avgHeartRateBpm: 103, maxHeartRateBpm: 150, hasRoute: true, utcOffsetMinutes: -180 });
    expect((h.calls.log[0].providerMetrics as { wear: Record<string, unknown> }).wear).toMatchObject({ elapsedSec: 100, timerSec: 81, movingSec: 70, prescribedSessionId: 's1' });
    expect(h.calls.points).toHaveLength(2);
    expect(h.calls.points[1]).toMatchObject({ latitude: 37.4222, longitude: -122.084, elevationMeters: 12.5, heartRateBpm: 130, speedKmh: 8.06, clockDurationSec: 100, timerDurationSec: 81, movingDurationSec: 70 });
    expect(h.calls.points[0]).not.toHaveProperty('clockDurationSec'); // so o ultimo ponto leva os tempos acumulados
    expect(h.identity.evaluateSafely).toHaveBeenCalledWith('log1');
    expect(h.link.classify).toHaveBeenCalledWith('log1');
    expect(h.notify.notifyReconciliation).toHaveBeenCalled();
  });

  it('sem o grupo do percurso: nenhuma coordenada nem altitude e guardada e hasRoute fica falso', async () => {
    const h = ingestHarness(['activity', 'activity_sensors']);
    const result = await h.service.ingest('u1', 'dev1', workout(), NOW);
    expect(result).toMatchObject({ written: true, removed: ['route'] });
    expect(h.calls.log[0].hasRoute).toBe(false);
    for (const p of h.calls.points) { expect(p.latitude).toBeNull(); expect(p.longitude).toBeNull(); expect(p.elevationMeters).toBeNull(); }
    expect(JSON.stringify(h.calls.raw[0])).not.toContain('37.4222');
  });

  it('sem o grupo de frequencia cardiaca: nenhuma frequencia guardada, nem na media', async () => {
    const h = ingestHarness(['activity', 'activity_route']);
    await h.service.ingest('u1', 'dev1', workout(), NOW);
    expect(h.calls.log[0].avgHeartRateBpm).toBeNull();
    expect(h.calls.log[0].maxHeartRateBpm).toBeNull();
    for (const p of h.calls.points) expect(p.heartRateBpm).toBeNull();
  });

  it('sem o grupo de corridas (ou sem autorizacao nenhuma): 403 wear_consent_required e nada gravado', async () => {
    const h = ingestHarness([]);
    await expect(h.service.ingest('u1', 'dev1', workout(), NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.calls.raw).toHaveLength(0);
    expect(h.identity.evaluateSafely).not.toHaveBeenCalled();
  });

  it('atividade ja excluida pela aluna ou treinador nao e regravada', async () => {
    const h = ingestHarness(['activity'], { excluded: true });
    expect(await h.service.ingest('u1', 'dev1', workout(), NOW)).toEqual({ written: false, reason: 'excluded' });
    expect(h.calls.raw).toHaveLength(0);
  });

  it('treino invalido: 400 antes de qualquer gravacao', async () => {
    const h = ingestHarness(['activity']);
    await expect(h.service.ingest('u1', 'dev1', workout({ distanceMeters: -1 }), NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.consent.writeWhileAuthorized).not.toHaveBeenCalled();
  });

  it('uma falha do pipeline posterior (classificar) nunca desfaz a gravacao', async () => {
    const h = ingestHarness(['activity']);
    h.link.classify.mockRejectedValue(new Error('falha'));
    const result = await h.service.ingest('u1', 'dev1', workout(), NOW);
    expect(result).toMatchObject({ written: true, classification: null });
  });
});

describe('corpo grande so na rota do treino', () => {
  it('3 MB apenas em POST /wear/activities com JSON', () => {
    expect(WEAR_ACTIVITY_MAX_BYTES).toBe(3 * 1024 * 1024);
    const json = { 'content-type': 'application/json' };
    expect(isWearActivityJson({ method: 'POST', url: '/wear/activities', headers: json })).toBe(true);
    expect(isWearActivityJson({ method: 'POST', url: '/wear/activities?x=1', headers: json })).toBe(true);
    expect(isWearActivityJson({ method: 'GET', url: '/wear/activities', headers: json })).toBe(false);
    expect(isWearActivityJson({ method: 'POST', url: '/wear/pairing/start', headers: json })).toBe(false);
    expect(isWearActivityJson({ method: 'POST', url: '/auth/login', headers: json })).toBe(false);
    expect(isWearActivityJson({ method: 'POST', url: '/wear/activities', headers: { 'content-type': 'text/plain' } })).toBe(false);
  });
  it('esta ligado no main.ts antes do parser padrao e nao usa useBodyParser', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main).toContain('configureWearActivityBodyParser(app)');
    expect(main).not.toContain('useBodyParser');
    expect(readFileSync(join(__dirname, '..', 'src', 'wear', 'wear-body.ts'), 'utf8')).toContain('function wearActivityJsonParser');
  });
});

describe('ligacoes (estatico)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
  it('rotas do relogio e da aluna, modulo registra o conector e importa o pipeline de atividades', () => {
    const controller = read('src', 'wear', 'wear.controller.ts');
    for (const route of ["@Post('activities')", "@Get('consent')", "@Put('consent')", "@Delete('data')"]) expect(controller).toContain(route);
    const module = read('src', 'wear', 'wear.module.ts');
    expect(module).toContain('this.registry.register(WEAR_OS_CONNECTOR)');
    expect(module).toContain('ActivityExecutionModule');
    expect(read('src', 'coach', 'activity-source-label.ts')).toContain("wear_os: 'Relogio Wear OS'");
  });
  it('a ingestao so aceita a credencial do relogio (guarda) e a de exclusao exige JWT da aluna', () => {
    const controller = read('src', 'wear', 'wear.controller.ts');
    expect(controller).toMatch(/@UseGuards\(WearDeviceGuard\)\s+@Post\('activities'\)/);
    expect(controller).toContain("@UseGuards(AuthGuard('jwt'))");
  });
});

describe('app: cartao de autorizacao e envio automatico do relogio (estatico)', () => {
  const mobile = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'mobile', ...parts), 'utf8');
  const wear = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'wearos', ...parts), 'utf8');
  it('o cartao mostra o texto do servidor, nada vem marcado e exige a confirmacao ao conceder', () => {
    const card = mobile('src', 'wearOs', 'WearOsConsentCard.tsx');
    expect(card).toContain('/me/wear/consent');
    expect(card).toContain('setSelected(data.groups.filter((g) => g.granted).map((g) => g.id))'); // so vem marcado o que ja estava autorizado
    expect(card).toContain('Marque a confirmação ao final do texto para autorizar.');
    expect(card).toContain('version: view.document.version, textHash: view.document.textHash');
    expect(card).toContain('Retirar todas as autorizações');
    expect(mobile('App.tsx')).toContain('<WearOsConsentCard accessToken={accessToken} apiUrl={API_URL} /><WearOsPairingCard');
  });
  it('o relogio envia os treinos guardados e trata cada resposta: apaga o enviado, guarda sem autorizacao, descarta o recusado', () => {
    const vm = wear('app', 'src', 'main', 'java', 'com', 'panzerirun', 'wear', 'AppViewModel.kt');
    expect(vm).toContain('UploadResult.Stored, UploadResult.Excluded -> { workouts.deletePending(id)');
    expect(vm).toContain('UploadResult.NeedsConsent -> { _state.update { it.copy(needsConsent = true) }; break }');
    expect(vm).toContain('UploadResult.Invalid -> workouts.rejectPending(id)');
    expect(vm).toContain('WorkoutController.state.value is RecordingState.Recording'); // nunca envia durante a corrida
    const api = wear('app', 'src', 'main', 'java', 'com', 'panzerirun', 'wear', 'data', 'Api.kt');
    expect(api).toContain('"/wear/activities"');
    expect(api).toContain('wear_consent_required');
  });
});

describe("liberado para todas as alunas, com aviso de funcionalidade nova (17/11/2026)", () => {
  const mobile = (...parts: string[]) => readFileSync(join(__dirname, "..", "..", "mobile", ...parts), "utf8");
  it("nenhum cartao diz \"em teste\" e o aviso manda relatar erros e sugestoes em Relatar problema", () => {
    const notice = mobile("src", "wearOs", "WearOsNotice.tsx");
    expect(notice).toContain("Funcionalidade nova");
    expect(notice).toContain("é uma novidade, e estamos trabalhando para melhorá-lo");
    expect(notice).toContain("erro ou tiver alguma sugestão, envie em “Relatar problema”");
    for (const file of ["WearOsPairingCard.tsx", "WearOsConsentCard.tsx", "WearOsNotice.tsx"]) {
      // so' o que a aluna le (linhas de codigo), sem os comentarios de historico
      const source = mobile("src", "wearOs", file).split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
      expect(source).not.toMatch(/em teste/i);
    }
  });
  it("o botao leva a tela Relatar problema e nao ha trava por aluna (sem lista de ids nem variavel de liberacao)", () => {
    const app = mobile("App.tsx");
    expect(app).toContain("onOpenProblemReport={() => setActiveTab('problemReport')}");
    expect(app).toContain("<WearOsNotice onOpenProblemReport={onOpenProblemReport} />");
    const api = readFileSync(join(__dirname, "..", "src", "wear", "wear.module.ts"), "utf8") + readFileSync(join(__dirname, "..", "src", "wear", "wear.service.ts"), "utf8");
    expect(api).not.toMatch(/ENABLED_USER_IDS|isEnabledFor/);
  });
});
