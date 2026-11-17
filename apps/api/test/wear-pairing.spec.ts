import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WearService } from '../src/wear/wear.service';
import { WearDeviceGuard } from '../src/wear/wear-device.guard';
import { generatePairingCode, hashSecret, normalizePairingCode, PAIRING_ALPHABET, PAIRING_CODE_LENGTH, secretsMatch } from '../src/wear/wear-pairing';
import { wearSessionsOf, type WearSessionRow } from '../src/wear/wear-week';

// 17/11/2026 — Wear OS, fase 1: pareamento por codigo + treinos da semana SOMENTE leitura. Sem banco real: tabela simulada em memoria.

describe('codigo de pareamento', () => {
  it('tem 8 simbolos sem 0/O/1/I/L e normaliza digitacao (minuscula, hifen, espaco)', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      for (const char of code) expect(PAIRING_ALPHABET).toContain(char);
    }
    expect(PAIRING_ALPHABET).not.toMatch(/[01OIL]/);
    expect(normalizePairingCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizePairingCode('ABCD')).toBeNull();
    expect(normalizePairingCode('ABCD-EFG0')).toBeNull(); // 0 nao existe no alfabeto
    expect(normalizePairingCode(1234)).toBeNull();
  });
  it('segredos so existem como hash e a comparacao funciona', () => {
    expect(hashSecret('x')).toMatch(/^[0-9a-f]{64}$/);
    expect(secretsMatch('abc', hashSecret('abc'))).toBe(true);
    expect(secretsMatch('abd', hashSecret('abc'))).toBe(false);
    expect(secretsMatch('abc', null)).toBe(false);
  });
});

type Row = { id: string; userId: string | null; deviceName: string | null; platform: string; pairingCodeHash: string | null; pollSecretHash: string | null; pairingExpiresAt: Date | null; confirmedAt: Date | null; tokenHash: string | null; tokenIssuedAt: Date | null; lastSeenAt: Date | null; revokedAt: Date | null };

function build() {
  const rows: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([key, cond]) => {
    const value = (row as Record<string, unknown>)[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; lt?: Date };
      if ('not' in c) return value !== c.not;
      if (c.lt) return value instanceof Date && value.getTime() < c.lt.getTime();
    }
    return value === cond;
  });
  const wearDevice = {
    create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
      if (data.pairingCodeHash && rows.some((r) => r.pairingCodeHash === data.pairingCodeHash)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' });
      const row: Row = { id: `d${++seq}`, userId: null, deviceName: null, platform: 'wear_os', pairingCodeHash: null, pollSecretHash: null, pairingExpiresAt: null, confirmedAt: null, tokenHash: null, tokenIssuedAt: null, lastSeenAt: null, revokedAt: null, ...data };
      rows.push(row);
      return row;
    }),
    deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => { const before = rows.length; for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i], where)) rows.splice(i, 1); return { count: before - rows.length }; }),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)).length),
    findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => match(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where))),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { const row = rows.find((r) => r.id === where.id)!; Object.assign(row, data); return row; }),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => { const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
  };
  const prisma = { wearDevice, user: { findUnique: jest.fn() }, trainingSession: { findMany: jest.fn() } };
  return { service: new WearService(prisma as never), rows, prisma };
}

const NOW = new Date('2026-11-17T15:00:00Z');
const codeOf = (display: string) => display.replace('-', '');

describe('fluxo de pareamento', () => {
  it('relogio pede codigo; aluna confirma; relogio recebe a credencial UMA vez; a credencial autentica', async () => {
    const { service, rows } = build();
    const start = await service.startPairing('  Galaxy   Watch 6 ', NOW);
    expect(start.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(rows[0].deviceName).toBe('Galaxy Watch 6');
    // nada em claro no banco
    expect(JSON.stringify(rows)).not.toContain(codeOf(start.code));
    expect(JSON.stringify(rows)).not.toContain(start.pollSecret);

    expect(await service.pollPairing(start.pairingId, start.pollSecret, NOW)).toEqual({ status: 'pending' });
    const confirmed = await service.confirmPairing('aluna-1', start.code.toLowerCase(), NOW);
    expect(confirmed).toEqual({ deviceId: start.pairingId, deviceName: 'Galaxy Watch 6' });
    expect(rows[0].pairingCodeHash).toBeNull(); // codigo usado nao existe mais

    const paired = await service.pollPairing(start.pairingId, start.pollSecret, NOW);
    expect(paired.status).toBe('paired');
    const token = (paired as { token: string }).token;
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(await service.pollPairing(start.pairingId, start.pollSecret, NOW)).toEqual({ status: 'already_issued' });
    expect(await service.authenticate(token, NOW)).toEqual({ deviceId: start.pairingId, userId: 'aluna-1' });
  });

  it('codigo errado, vencido, ja usado ou mal formado: a mesma resposta 404 (nao ajuda a adivinhar)', async () => {
    const { service } = build();
    const start = await service.startPairing('Relogio', NOW);
    await expect(service.confirmPairing('a', 'ZZZZ-ZZZZ', NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.confirmPairing('a', 'abc', NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.confirmPairing('a', start.code, new Date(NOW.getTime() + 11 * 60_000))).rejects.toBeInstanceOf(NotFoundException); // vencido
    await service.confirmPairing('a', start.code, NOW);
    await expect(service.confirmPairing('b', start.code, NOW)).rejects.toBeInstanceOf(NotFoundException); // ja usado: outra aluna nao pega
  });

  it('segredo de consulta errado: 401 e nunca entrega a credencial; vencido sem confirmar: expired', async () => {
    const { service } = build();
    const start = await service.startPairing('Relogio', NOW);
    await expect(service.pollPairing(start.pairingId, 'errado', NOW)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.pollPairing('inexistente', start.pollSecret, NOW)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.pollPairing(undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await service.pollPairing(start.pairingId, start.pollSecret, new Date(NOW.getTime() + 11 * 60_000))).toEqual({ status: 'expired' });
  });

  it('duas consultas simultaneas depois da confirmacao: so uma recebe a credencial', async () => {
    const { service } = build();
    const start = await service.startPairing('Relogio', NOW);
    await service.confirmPairing('a', start.code, NOW);
    const results = await Promise.all([service.pollPairing(start.pairingId, start.pollSecret, NOW), service.pollPairing(start.pairingId, start.pollSecret, NOW)]);
    expect(results.filter((r) => r.status === 'paired')).toHaveLength(1);
  });

  it('limite de relogios por aluna (5)', async () => {
    const { service } = build();
    for (let i = 0; i < 5; i += 1) { const s = await service.startPairing(`R${i}`, NOW); await service.confirmPairing('a', s.code, NOW); }
    const sixth = await service.startPairing('R6', NOW);
    await expect(service.confirmPairing('a', sixth.code, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.confirmPairing('b', sixth.code, NOW)).resolves.toBeDefined(); // outra aluna nao e' afetada
  });

  it('retirar o relogio invalida a credencial na hora e so a dona consegue retirar', async () => {
    const { service } = build();
    const start = await service.startPairing('Relogio', NOW);
    await service.confirmPairing('a', start.code, NOW);
    const token = ((await service.pollPairing(start.pairingId, start.pollSecret, NOW)) as { token: string }).token;
    await expect(service.revoke('outra', start.pairingId)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.authenticate(token, NOW)).toBeDefined();
    expect(await service.revoke('a', start.pairingId)).toEqual({ revoked: true });
    await expect(service.authenticate(token, NOW)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await service.devices('a')).toEqual([]);
  });

  it('lista da aluna mostra so os dela, sem nenhum segredo', async () => {
    const { service } = build();
    const s1 = await service.startPairing('Galaxy Watch', NOW); await service.confirmPairing('a', s1.code, NOW);
    const s2 = await service.startPairing('Pixel Watch', NOW); await service.confirmPairing('b', s2.code, NOW);
    const list = await service.devices('a');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Galaxy Watch', platform: 'wear_os' });
    expect(JSON.stringify(list)).not.toMatch(/hash|token|secret/i);
  });

  it('credencial desconhecida: 401', async () => {
    const { service } = build();
    await expect(service.authenticate('qualquer', NOW)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('guarda da credencial do relogio', () => {
  const run = (header: unknown, authenticate = jest.fn().mockResolvedValue({ deviceId: 'd', userId: 'u' })) => {
    const guard = new WearDeviceGuard({ authenticate } as never);
    const request: Record<string, unknown> = { headers: { authorization: header } };
    return { promise: guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never), request, authenticate };
  };
  it('aceita "Bearer <credencial>" e preenche aparelho e aluna', async () => {
    const { promise, request, authenticate } = run('Bearer abc123');
    await expect(promise).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('abc123');
    expect(request.wearDevice).toEqual({ deviceId: 'd', userId: 'u' });
  });
  it('sem cabecalho ou com formato errado: 401 sem consultar nada', async () => {
    for (const header of [undefined, '', 'abc', 'Basic abc', 'Bearer ']) {
      const { promise, authenticate } = run(header);
      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authenticate).not.toHaveBeenCalled();
    }
  });
});

describe('treinos da semana para o relogio', () => {
  const row = (over: Partial<WearSessionRow>): WearSessionRow => ({ id: 's1', scheduledDate: new Date('2026-11-18T00:00:00Z'), weekday: 3, modality: 'corrida', title: 'Corrida', durationMin: 40, distanceKm: 6, structure: {}, origin: 'agent', completionStatus: null, ...over });
  const run = { type: 'run', blocks: [{ label: 'Principal', durationType: 'distance', distanceValue: 6, distanceUnit: 'km', paceRange: '6:10/km a 6:50/km' }] };

  it('corrida estruturada vira passos com meta e faixa de pace; esteira conta como corrida', () => {
    const [a] = wearSessionsOf([row({ structure: run })]);
    expect(a).toMatchObject({ kind: 'corrida', done: false, date: '2026-11-18', distanceKm: 6 });
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]).toMatchObject({ kind: 'step', goal: { type: 'distance', meters: 6000 }, pace: { fastSecPerKm: 370, slowSecPerKm: 410 } });
    const [b] = wearSessionsOf([row({ modality: 'esteira', structure: run })]);
    expect(b.kind).toBe('corrida');
  });
  it('forca e fortalecimento vao so com titulo e duracao; feito marca done; extras ficam de fora; ordem por data', () => {
    const out = wearSessionsOf([
      row({ id: 'z', scheduledDate: new Date('2026-11-20T00:00:00Z'), modality: 'forca', title: 'Musculacao', structure: { type: 'strength' } }),
      row({ id: 'e', origin: 'device_extra' }),
      row({ id: 'x', origin: 'student_extra' }),
      row({ id: 'a', scheduledDate: new Date('2026-11-17T00:00:00Z'), completionStatus: 'completed', structure: run }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['a', 'z']);
    expect(out[0].done).toBe(true);
    expect(out[1]).toMatchObject({ kind: 'forca', steps: [] });
  });
  it('nunca leva texto livre, notas, recomendacoes nem dado de saude (so o prescrito)', () => {
    const [s] = wearSessionsOf([row({ structure: { ...run, notes: 'segredo da aluna' } })]);
    expect(Object.keys(s).sort()).toEqual(['date', 'distanceKm', 'done', 'durationMin', 'id', 'kind', 'steps', 'title', 'weekday']);
    expect(JSON.stringify(s)).not.toContain('segredo');
  });
});

describe('semana: acesso e escopo', () => {
  it('sem acesso pago: 403; com acesso: so as sessoes da propria aluna, programa ativo, janela de datas', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ subscriptionStatus: 'canceled' });
    await expect(service.week('u1')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.user.findUnique.mockResolvedValue({ subscriptionStatus: 'active' });
    prisma.trainingSession.findMany.mockResolvedValue([]);
    await service.week('u1');
    const where = prisma.trainingSession.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', plan: { status: 'active' } });
    expect(where.scheduledDate.lte.getTime() - where.scheduledDate.gte.getTime()).toBe(15 * 86_400_000);
  });
});

describe('ligacoes (estatico)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
  it('rotas, modulo, migracao aditiva e limites de uso', () => {
    const controller = read('src', 'wear', 'wear.controller.ts');
    for (const route of ["@Post('pairing/start')", "@Post('pairing/poll')", "@Get('week')", "@Post('pairing/confirm')", "@Get('devices')", "@Delete('devices/:deviceId')"]) expect(controller).toContain(route);
    expect((controller.match(/@Throttle\(/g) ?? []).length).toBe(4);
    expect(controller).toContain("@UseGuards(AuthGuard('jwt'))");
    expect(controller).toContain('@UseGuards(WearDeviceGuard)');
    expect(read('src', 'app.module.ts')).toContain('WearModule');
    const sql = read('prisma', 'migrations', '20261117120000_wear_device', 'migration.sql');
    expect(sql).toContain('CREATE TABLE "WearDevice"');
    expect(sql).not.toMatch(/DROP|ALTER TABLE "(?!WearDevice)/);
  });
  it('a rota do relogio nunca devolve credencial, hash ou segredo alem da emissao unica', () => {
    const service = read('src', 'wear', 'wear.service.ts');
    expect(service).toContain("select: { id: true, deviceName: true, platform: true, confirmedAt: true, lastSeenAt: true }");
  });
});

describe('cartao no app (estatico)', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  const card = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'wearOs', 'WearOsPairingCard.tsx'), 'utf8');
  it('aparece na tela Samsung / Galaxy Watch, acima do Health Connect, e usa as tres rotas da aluna', () => {
    expect(app).toContain('samsung: () => (<><WearOsNotice onOpenProblemReport={onOpenProblemReport} /><WearOsConsentCard accessToken={accessToken} apiUrl={API_URL} /><WearOsPairingCard accessToken={accessToken} apiUrl={API_URL} /><HealthConnectCard');
    for (const route of ['/me/wear/devices', '/me/wear/pairing/confirm']) expect(card).toContain(route);
    expect(card).toContain("method: 'DELETE'");
  });
  it('diz que nao ha senha no relogio e que e possivel retirar', () => {
    expect(card).toContain('Você não digita senha no relógio e pode retirar o relógio quando quiser');
    expect(card).toContain('Retirar');
  });
});

describe('app do relogio (apps/wearos), fases 2 e 3 (estatico)', () => {
  const wear = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'wearos', ...parts), 'utf8');
  it('permissoes da fase 3: so as da gravacao do treino, nunca localizacao em segundo plano', () => {
    const manifest = wear('app', 'src', 'main', 'AndroidManifest.xml');
    const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1].replace('android.permission.', '')).sort();
    expect(permissions).toEqual(['ACCESS_FINE_LOCATION', 'ACTIVITY_RECOGNITION', 'BODY_SENSORS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_HEALTH', 'FOREGROUND_SERVICE_LOCATION', 'INTERNET', 'POST_NOTIFICATIONS', 'WAKE_LOCK']);
    expect(manifest).not.toContain('ACCESS_BACKGROUND_LOCATION');
    expect(manifest).not.toMatch(/ACCESS_COARSE_LOCATION|android.permission.health./);
    // o servico de gravacao e' o unico que usa sensores e GPS, em primeiro plano
    expect(manifest).toContain('android:foregroundServiceType="health|location"');
  });
  it('as permissoes so sao pedidas ao tocar em Iniciar corrida, nunca ao abrir o app', () => {
    const ui = wear('app', 'src', 'main', 'java', 'com', 'panzerirun', 'wear', 'ui', 'PanzeriWearApp.kt');
    expect(ui).toContain('launcher.launch(WorkoutController.requiredPermissions())');
    expect(ui.split("launcher.launch(").length - 1).toBe(1);
    const activity = wear('app', 'src', 'main', 'java', 'com', 'panzerirun', 'wear', 'MainActivity.kt');
    expect(activity).not.toMatch(/requestPermissions|RequestMultiplePermissions/);
  });
  it('HTTP sem criptografia so existe na variante debug; a release nao o declara', () => {
    expect(wear('app', 'src', 'debug', 'AndroidManifest.xml')).toContain('usesCleartextTraffic="true"');
    expect(wear('app', 'src', 'main', 'AndroidManifest.xml')).not.toContain('usesCleartextTraffic');
  });
  it('chama so as tres rotas do relogio e usa o mesmo identificador do app do celular', () => {
    const api = wear('app', 'src', 'main', 'java', 'com', 'panzerirun', 'wear', 'data', 'Api.kt');
    for (const route of ['/wear/pairing/start', '/wear/pairing/poll', '/wear/week']) expect(api).toContain(route);
    expect(api).not.toMatch(/"\/me\//);
    expect(wear('app', 'build.gradle.kts')).toContain('applicationId = "com.panzerirun.app"');
  });
  it('a credencial nunca vai para arquivo comum', () => {
    const store = wear('app', 'src', 'main', 'java', 'com', 'panzerirun', 'wear', 'data', 'Store.kt');
    expect(store).toContain('EncryptedSharedPreferences');
    expect(store).not.toMatch(/plain\.edit\(\)\.putString\("token"/);
  });
});
