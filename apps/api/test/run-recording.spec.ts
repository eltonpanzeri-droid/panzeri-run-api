import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { consentTextHash } from '../src/provider-hub/provider-consent.service';
import { PANZERI_RUN_PROVIDER_ID, RUN_RECORDING_CATEGORIES, RUN_RECORDING_CONSENT } from '../src/run-recording/run-consent';
import { RunConsentService } from '../src/run-recording/run-consent.service';
import { normalizeRunActivity, RUN_LIMITS } from '../src/run-recording/run-activity';
import { RunActivityService } from '../src/run-recording/run-activity.service';
import { isRunActivityJson, RUN_ACTIVITY_MAX_BYTES } from '../src/run-recording/run-body';
import { DEVICE_CONSENT_PROVIDERS, EXTERNAL_AI_APPROVED_PROVIDERS, externalAiUnlockedFor } from '../src/ai-governance/ai-data-eligibility.service';

// 21/11/2026 — Iniciar treino no Panzeri Run, sub-lote 1.1 (servidor): consentimento proprio (localizacao so' durante o treino, IA incluida) e gravacao do treino do celular com consentimento POR CAMPO. Sem banco real.
const HASH = consentTextHash(RUN_RECORDING_CONSENT);
const ack = { acknowledged: true, version: RUN_RECORDING_CONSENT.version, textHash: HASH };

describe('documento de consentimento da gravacao no Panzeri Run', () => {
  it('declara so as duas categorias (treino e percurso) e nenhum grupo de sensores: o celular nao registra frequencia cardiaca', () => {
    expect([...RUN_RECORDING_CATEGORIES]).toEqual(['activity', 'activity_route']);
    expect(RUN_RECORDING_CONSENT.groups.map((g) => g.id)).toEqual(['activity', 'route']);
    expect(RUN_RECORDING_CONSENT.groups.find((g) => g.id === 'route')?.requires).toEqual(['activity']);
    expect(RUN_RECORDING_CONSENT.groups.every((g) => !g.required)).toBe(true);
    expect(JSON.stringify(RUN_RECORDING_CONSENT)).not.toMatch(/frequência cardíaca/i);
  });
  it('o texto diz o que Elton decidiu: so durante o treino (inclusive com tela bloqueada ou outro aplicativo), nada fora dele, IA com o percurso e desligamento', () => {
    const text = JSON.stringify(RUN_RECORDING_CONSENT);
    expect(text).toContain('A localização só é gravada durante o treino');
    expect(text).toContain('com a tela bloqueada ou com outro aplicativo aberto');
    expect(text).toContain('Fora do treino, o Panzeri Run não coleta a sua localização');
    expect(text).toMatch(/incluindo o percurso GPS, são enviados à Anthropic/);
    expect(text).toContain('desligar o uso dos treinos gravados no Panzeri Run pela inteligência artificial');
    expect(text).not.toMatch(/meteorolog|clima|temperatura/i);
    expect(RUN_RECORDING_CONSENT.optionalPurposes.map((p) => p.id)).toEqual(['ai_external']);
  });
  it('entra na elegibilidade de IA pelo consentimento do aparelho; a segunda trava e a variavel PANZERI_RUN_EXTERNAL_AI_ENABLED', () => {
    expect(DEVICE_CONSENT_PROVIDERS[PANZERI_RUN_PROVIDER_ID]).toBe(RUN_RECORDING_CONSENT);
    expect(EXTERNAL_AI_APPROVED_PROVIDERS).toContain('panzeri_run');
    expect(externalAiUnlockedFor('panzeri_run', { get: () => undefined })).toBe(false);
    expect(externalAiUnlockedFor('panzeri_run', { get: (key: string) => (key === 'PANZERI_RUN_EXTERNAL_AI_ENABLED' ? 'true' : undefined) as never })).toBe(true);
  });
});

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
    activityTimeSeriesPoint: { deleteMany: jest.fn(async () => { scrubs.push('route-points'); return { count: 1 }; }), updateMany: jest.fn(async () => { scrubs.push('hr-points'); return { count: 1 }; }) },
    activityLog: { updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { scrubs.push(Object.keys(data).join('+')); return { count: 1 }; }) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    providerConnection: { findUnique: jest.fn(async () => state.row) },
    providerConnectionEvent: { create: jest.fn(async ({ data }: { data: { type: string } }) => { events.push({ type: data.type }); return {}; }) },
  };
  const providerData = { invalidateAiArtifacts: jest.fn().mockResolvedValue({}), deleteProviderData: jest.fn().mockResolvedValue({ deleted: 1 }) };
  return { service: new RunConsentService(prisma as never, providerData as never), state, scrubs, events, tx, providerData };
}

describe('consentimento da gravacao (servico)', () => {
  it('sem aceite expresso ou com texto desatualizado: recusa conceder; percurso sem treino e grupo desconhecido tambem', async () => {
    const { service } = consentHarness();
    await expect(service.update('u1', { groups: ['activity'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('u1', { groups: ['activity'], acknowledged: true, version: '0.9', textHash: 'x' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update('u1', { groups: ['route'], ...ack })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('u1', { groups: ['sensors'], ...ack })).rejects.toBeInstanceOf(BadRequestException); // nao existe grupo de sensores
    await expect(service.update('u1', { groups: 'activity' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('primeira concessao grava as categorias, liga a IA (ja esta no texto) e registra a versao e o hash do texto visto', async () => {
    const { service, state, events } = consentHarness();
    const result = await service.update('u1', { groups: ['activity', 'route'], ...ack });
    expect(state.row).toMatchObject({ grantedCategories: ['activity', 'activity_route'], grantedPurposes: ['ai_external'], consentVersion: '1.0', consentTextHash: HASH });
    expect(result.ai).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['connected']);
    expect((await service.access('u1')).allowed).toEqual(new Set(['activity', 'activity_route']));
  });

  it('retirar o percurso apaga os pontos com coordenada e o hasRoute, sem pedir novo aceite; o treino fica', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity', 'route'], ...ack });
    await h.service.update('u1', { groups: ['activity'] });
    expect(h.scrubs).toEqual(['route-points', 'hasRoute']);
    expect((await h.service.access('u1')).allowed.has('activity_route')).toBe(false);
    expect((await h.service.access('u1')).allowed.has('activity')).toBe(true);
  });

  it('desligar so a IA mantem os grupos e invalida os artefatos de IA', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity'], ...ack });
    await h.service.update('u1', { groups: ['activity'], ai: false });
    expect((await h.service.access('u1')).ai).toBe(false);
    expect(h.providerData.invalidateAiArtifacts).toHaveBeenCalledWith('u1', 'panzeri_run');
  });

  it('lista vazia retira tudo: apaga o percurso, desconecta e invalida a IA; depois nada e aceito', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity', 'route'], ...ack });
    h.scrubs.length = 0;
    await h.service.update('u1', { groups: [] });
    expect(h.scrubs).toEqual(['route-points', 'hasRoute']);
    expect((await h.service.access('u1')).allowed.size).toBe(0);
    expect((await h.service.state('u1')).connected).toBe(false);
  });

  it('texto novo (versao diferente): o registro antigo deixa de valer ate reconfirmar (fail-closed)', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity'], ...ack });
    h.state.row = { ...h.state.row!, consentVersion: '0.5' };
    expect((await h.service.access('u1')).allowed.size).toBe(0);
    expect((await h.service.state('u1')).consent.needsReview).toBe(true);
  });

  it('excluir os treinos gravados exige estar sem autorizacao ativa e usa o provedor panzeri_run', async () => {
    const h = consentHarness();
    await h.service.update('u1', { groups: ['activity'], ...ack });
    await expect(h.service.deleteReceivedData('u1')).rejects.toBeInstanceOf(ConflictException);
    await h.service.update('u1', { groups: [] });
    await expect(h.service.deleteReceivedData('u1')).resolves.toBeDefined();
    expect(h.providerData.deleteProviderData).toHaveBeenCalledWith('u1', 'panzeri_run');
  });
});

const UUID = '731d8bb5-de0d-4a90-92ba-09c52ce71b9e';
const NOW = new Date('2026-11-21T20:00:00Z');
const workout = (over: Record<string, unknown> = {}) => ({
  clientId: UUID, sessionId: 's1', startedAt: '2026-11-21T17:44:07.263Z', endedAt: '2026-11-21T17:45:47.274Z', utcOffsetMinutes: -180,
  durationSec: 81, elapsedSec: 100, movingSec: 70, distanceMeters: 186.6, interrupted: false,
  points: [{ t: 1, dist: 10, speed: 2.24 }, { t: 15, lat: 37.4222, lon: -122.0840, alt: 12.5, dist: 41.3, speed: 2.24 }],
  ...over,
});

describe('validacao do treino enviado pelo Panzeri Run', () => {
  it('aceita um treino real e IGNORA frequencia cardiaca (o celular nao a registra)', () => {
    const w = normalizeRunActivity(workout({ avgHr: 103, maxHr: 150, points: [{ t: 1, hr: 120, dist: 5 }] }), NOW);
    expect(w).toMatchObject({ clientId: UUID, sessionId: 's1', durationSec: 81, elapsedSec: 100, movingSec: 70, distanceMeters: 186.6 });
    expect(w).not.toHaveProperty('avgHr');
    expect(w.points[0]).not.toHaveProperty('hr');
  });
  it.each([
    ['clientId que nao e uuid', { clientId: 'abc' }],
    ['inicio no futuro distante', { startedAt: '2026-11-22T10:00:00Z' }],
    ['inicio antes de 2020', { startedAt: '2019-01-01T00:00:00Z' }],
    ['fim antes do inicio', { endedAt: '2026-11-21T17:00:00Z' }],
    ['tempo em movimento maior que o cronometro', { movingSec: 200 }],
    ['cronometro maior que o tempo da atividade', { durationSec: 500 }],
    ['distancia absurda', { distanceMeters: 900_000 }],
    ['ponto com latitude impossivel', { points: [{ t: 1, lat: 95, lon: 10 }] }],
    ['coordenada pela metade', { points: [{ t: 1, lat: 10 }] }],
    ['pontos repetidos', { points: [{ t: 1 }, { t: 1 }] }],
    ['pontos fora de ordem', { points: [{ t: 5 }, { t: 2 }] }],
    ['velocidade impossivel', { points: [{ t: 1, speed: 99 }] }],
    ['corpo sem lista de pontos', { points: 'x' }],
  ])('recusa: %s', (_name, over) => {
    expect(() => normalizeRunActivity(workout(over as Record<string, unknown>), NOW)).toThrow(BadRequestException);
  });
  it('recusa corpo que nao e objeto e excesso de pontos; altitude implausivel e descartada sem recusar', () => {
    expect(() => normalizeRunActivity('x', NOW)).toThrow(BadRequestException);
    expect(() => normalizeRunActivity(workout({ points: Array.from({ length: RUN_LIMITS.maxPoints + 1 }, (_, i) => ({ t: i })) }), NOW)).toThrow(BadRequestException);
    expect(normalizeRunActivity(workout({ points: [{ t: 1, lat: 10, lon: 10, alt: 99999 }] }), NOW).points[0].alt).toBeNull();
  });
});

function ingestHarness(allowed: string[], opts: { excluded?: boolean } = {}) {
  const calls = { raw: [] as Array<Record<string, unknown>>, log: [] as Array<Record<string, unknown>>, points: [] as Array<Record<string, unknown>> };
  const tx = {
    rawExternalActivity: { upsert: jest.fn(async (args: { create: Record<string, unknown> }) => { calls.raw.push(args.create); return { id: 'raw1' }; }) },
    activityLog: { upsert: jest.fn(async (args: { create: Record<string, unknown> }) => { calls.log.push(args.create); return { id: 'log1' }; }) },
    activityTimeSeriesPoint: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { calls.points.push(...data); return { count: data.length }; }) },
  };
  const consent = { writeWhileAuthorized: jest.fn(async (_u: string, fn: (t: typeof tx, a: { allowed: Set<string>; ai: boolean }) => unknown) => fn(tx, { allowed: new Set(allowed), ai: true })) };
  const prisma = { activityExclusion: undefined, activityLog: { findFirst: jest.fn(async () => (opts.excluded ? { exclusionMode: 'ignored' } : null)) } };
  const link = { classify: jest.fn().mockResolvedValue('corresponding'), reconcileAffectedByIdentity: jest.fn().mockResolvedValue(undefined) };
  const notify = { notifyReconciliation: jest.fn().mockResolvedValue(undefined) };
  const identity = { evaluateSafely: jest.fn().mockResolvedValue({}) };
  const service = new RunActivityService(prisma as never, consent as never, link as never, notify as never, identity as never);
  return { service, calls, consent, link, notify, identity };
}

describe('gravacao do treino do Panzeri Run com consentimento por campo', () => {
  it('tudo autorizado: grava atividade, percurso e altitude, os tres tempos, fonte panzeri_run, e dispara o pipeline', async () => {
    const h = ingestHarness(['activity', 'activity_route']);
    const result = await h.service.ingest('u1', workout(), NOW);
    expect(result).toMatchObject({ written: true, activityLogId: 'log1', classification: 'corresponding', removed: [] });
    expect(h.calls.log[0]).toMatchObject({ provider: 'panzeri_run', externalId: UUID, sport: 'corrida', durationSec: 81, distanceMeters: 186.6, hasRoute: true, utcOffsetMinutes: -180 });
    expect(h.calls.log[0]).not.toHaveProperty('avgHeartRateBpm');
    expect((h.calls.log[0].providerMetrics as { run: Record<string, unknown> }).run).toMatchObject({ elapsedSec: 100, timerSec: 81, movingSec: 70, prescribedSessionId: 's1' });
    expect(h.calls.points[1]).toMatchObject({ provider: 'panzeri_run', latitude: 37.4222, longitude: -122.084, elevationMeters: 12.5, speedKmh: 8.06, clockDurationSec: 100, timerDurationSec: 81, movingDurationSec: 70 });
    expect(h.calls.points[0]).not.toHaveProperty('clockDurationSec');
    expect(h.identity.evaluateSafely).toHaveBeenCalledWith('log1');
    expect(h.link.classify).toHaveBeenCalledWith('log1');
    expect(h.notify.notifyReconciliation).toHaveBeenCalled();
  });

  it('sem o grupo do percurso: nenhuma coordenada nem altitude e guardada e hasRoute fica falso', async () => {
    const h = ingestHarness(['activity']);
    expect(await h.service.ingest('u1', workout(), NOW)).toMatchObject({ written: true, removed: ['route'] });
    expect(h.calls.log[0].hasRoute).toBe(false);
    for (const p of h.calls.points) { expect(p.latitude).toBeNull(); expect(p.longitude).toBeNull(); expect(p.elevationMeters).toBeNull(); }
    expect(JSON.stringify(h.calls.raw[0])).not.toContain('37.4222');
  });

  it('sem autorizacao (nem o grupo do treino): 403 run_consent_required e nada gravado', async () => {
    const h = ingestHarness([]);
    await expect(h.service.ingest('u1', workout(), NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.calls.raw).toHaveLength(0);
    expect(h.identity.evaluateSafely).not.toHaveBeenCalled();
  });

  it('atividade excluida nao e regravada; treino invalido da 400 antes de gravar; falha do pipeline nao desfaz a gravacao', async () => {
    const excluded = ingestHarness(['activity'], { excluded: true });
    expect(await excluded.service.ingest('u1', workout(), NOW)).toEqual({ written: false, reason: 'excluded' });
    const invalid = ingestHarness(['activity']);
    await expect(invalid.service.ingest('u1', workout({ distanceMeters: -1 }), NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(invalid.consent.writeWhileAuthorized).not.toHaveBeenCalled();
    const flaky = ingestHarness(['activity']);
    flaky.link.classify.mockRejectedValue(new Error('falha'));
    expect(await flaky.service.ingest('u1', workout(), NOW)).toMatchObject({ written: true, classification: null });
  });
});

describe('corpo grande so na rota do treino do Panzeri Run, e ligacoes', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
  it('4 MB apenas em POST /me/run/activities com JSON; ligado no main.ts sem useBodyParser', () => {
    expect(RUN_ACTIVITY_MAX_BYTES).toBe(4 * 1024 * 1024);
    const json = { 'content-type': 'application/json' };
    expect(isRunActivityJson({ method: 'POST', url: '/me/run/activities', headers: json })).toBe(true);
    expect(isRunActivityJson({ method: 'POST', url: '/me/run/activities?x=1', headers: json })).toBe(true);
    expect(isRunActivityJson({ method: 'GET', url: '/me/run/activities', headers: json })).toBe(false);
    expect(isRunActivityJson({ method: 'POST', url: '/me/run/consent', headers: json })).toBe(false);
    expect(isRunActivityJson({ method: 'POST', url: '/wear/activities', headers: json })).toBe(false); // o relogio segue com o proprio parser
    expect(isRunActivityJson({ method: 'POST', url: '/me/run/activities', headers: { 'content-type': 'text/plain' } })).toBe(false);
    const main = read('src', 'main.ts');
    expect(main).toContain('configureRunActivityBodyParser(app)');
    expect(main).toContain('configureWearActivityBodyParser(app)'); // o do relogio continua como estava
    expect(main).not.toContain('useBodyParser');
  });
  it('rotas da aluna exigem login; modulo no AppModule; nenhum arquivo do Wear OS foi alterado para isto', () => {
    const controller = read('src', 'run-recording', 'run-recording.controller.ts');
    expect(controller).toContain("@UseGuards(AuthGuard('jwt'))");
    for (const route of ["@Post('activities')", "@Get('consent')", "@Put('consent')", "@Delete('data')"]) expect(controller).toContain(route);
    expect(read('src', 'app.module.ts')).toContain('RunRecordingModule');
    expect(read('src', 'coach', 'activity-source-label.ts')).toContain("panzeri_run: 'Panzeri Run'");
    expect(read('src', 'wear', 'wear-activity.service.ts')).not.toContain('panzeri_run');
  });
});
