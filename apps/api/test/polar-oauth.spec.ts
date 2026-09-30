import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { PolarService } from '../src/polar/polar.service';

const redirectUri = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/polar/callback';
const settings: Record<string, string> = {
  POLAR_CLIENT_ID: 'client-id',
  POLAR_CLIENT_SECRET: 'client-secret',
  POLAR_REDIRECT_URI: redirectUri,
  POLAR_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
};

function fixture() {
  const attempts = new Map<string, { userId: string; expiresAt: Date; consumedAt: Date | null }>();
  const prisma = {
    user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    polarOAuthAttempt: {
      create: jest.fn(async ({ data }: { data: { stateHash: string; userId: string; expiresAt: Date } }) => {
        attempts.set(data.stateHash, { userId: data.userId, expiresAt: data.expiresAt, consumedAt: null });
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { stateHash: string; consumedAt: null; expiresAt: { gt: Date } }; data: { consumedAt: Date } }) => {
        const attempt = attempts.get(where.stateHash);
        if (!attempt || attempt.consumedAt || attempt.expiresAt <= where.expiresAt.gt) return { count: 0 };
        attempt.consumedAt = data.consumedAt;
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: { where: { stateHash: string } }) => attempts.get(where.stateHash) ?? null),
    },
    polarConnection: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async (_input: unknown) => ({})),
    },
  };
  const config = { get: jest.fn((name: string) => settings[name]) };
  const service = new PolarService(prisma as unknown as PrismaService, config as unknown as ConfigService);
  const exchange = jest.fn(async () => ({
    ok: true,
    json: async () => ({ access_token: 'private-polar-token', token_type: 'bearer', x_user_id: 777 }),
  }));
  global.fetch = exchange as unknown as typeof fetch;
  return { service, prisma, attempts, exchange };
}

const stateFrom = (url: string) => new URL(url).searchParams.get('state')!;

describe('Polar OAuth foundation', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('starts only for the authenticated Panzeri user with an opaque, hashed, expiring state', async () => {
    const { service, attempts } = fixture();
    const { url } = await service.connectUrl('user-a');
    const parsed = new URL(url);
    const state = stateFrom(url);
    expect(parsed.origin + parsed.pathname).toBe('https://flow.polar.com/oauth2/authorization');
    expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toContain('user-a');
    const saved = attempts.get(createHash('sha256').update(state).digest('hex'));
    expect(saved?.userId).toBe('user-a');
    expect(saved?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify([...attempts.keys()])).not.toContain(state);
  });

  it('consumes a valid state once, exchanges the code once and stores encrypted token for its user', async () => {
    const { service, prisma, exchange } = fixture();
    const state = stateFrom((await service.connectUrl('user-a')).url);
    expect(await service.callback({ state, code: 'polar-code' })).toBe('connected');
    expect(exchange).toHaveBeenCalledTimes(1);
    const [tokenUrl, options] = exchange.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe('https://polarremote.com/v2/oauth2/token');
    expect(String(options.body)).toContain('redirect_uri=');
    const operation = prisma.polarConnection.upsert.mock.calls[0][0] as { create: { userId: string; polarUserId: string; accessTokenEncrypted: string } };
    expect(operation.create.userId).toBe('user-a');
    expect(operation.create.polarUserId).toBe('777');
    expect(operation.create.accessTokenEncrypted).toMatch(/^v1:/);
    expect(operation.create.accessTokenEncrypted).not.toContain('private-polar-token');
    await expect(service.callback({ state, code: 'polar-code' })).rejects.toBeInstanceOf(BadRequestException);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid, unknown and expired state before contacting Polar', async () => {
    const { service, attempts, exchange } = fixture();
    await expect(service.callback({ state: 'bad', code: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.callback({ state: 'a'.repeat(43), code: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    const state = stateFrom((await service.connectUrl('user-a')).url);
    attempts.get(createHash('sha256').update(state).digest('hex'))!.expiresAt = new Date(0);
    await expect(service.callback({ state, code: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('consumes cancellation and error states without exchanging or saving tokens', async () => {
    const { service, prisma, exchange } = fixture();
    const cancelled = stateFrom((await service.connectUrl('user-a')).url);
    expect(await service.callback({ state: cancelled, error: 'access_denied' })).toBe('cancelled');
    await expect(service.callback({ state: cancelled, code: 'late-code' })).rejects.toBeInstanceOf(BadRequestException);
    const failed = stateFrom((await service.connectUrl('user-a')).url);
    await expect(service.callback({ state: failed, error: 'server_error' })).rejects.toBeInstanceOf(BadRequestException);
    expect(exchange).not.toHaveBeenCalled();
    expect(prisma.polarConnection.upsert).not.toHaveBeenCalled();
  });

  it('links each callback only to the user stored with its state', async () => {
    const { service, prisma } = fixture();
    await service.connectUrl('user-a');
    const stateB = stateFrom((await service.connectUrl('user-b')).url);
    await service.callback({ state: stateB, code: 'code-b' });
    expect((prisma.polarConnection.upsert.mock.calls[0][0] as { create: { userId: string } }).create.userId).toBe('user-b');
  });
});