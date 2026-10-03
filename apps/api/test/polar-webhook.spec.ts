import { createHmac } from 'crypto';
import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import { PolarWebhookService } from '../src/polar/polar-webhook.service';

// Webhook Polar (03/10/2026). Assinatura oficial: HMAC-SHA256 hex do corpo bruto, chave =
// signature_secret_key. Fail-closed: qualquer falha de verificacao vira 401, nunca processa.

const SECRET = 'segredo-de-teste-polar';
const RAW = Buffer.from(JSON.stringify({ event: 'EXERCISE', user_id: 59393531, entity_id: 'ex-1' }));
const VALID_SIGNATURE = createHmac('sha256', SECRET).update(RAW).digest('hex');

function build(opts: {
  subscription?: { signatureSecretEncrypted: string } | null;
  connection?: { userId: string } | null;
  syncImpl?: () => Promise<unknown>;
}) {
  const prisma = {
    polarWebhookSubscription: {
      findFirst: jest.fn(async () => (opts.subscription === undefined ? { signatureSecretEncrypted: 'enc' } : opts.subscription)),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sub-1', ...data })),
    },
    polarConnection: {
      findUnique: jest.fn(async () => (opts.connection === undefined ? { userId: 'aluno-1' } : opts.connection)),
    },
  };
  const polar = {
    decryptSecret: jest.fn(() => SECRET),
    encryptSecret: jest.fn((value: string) => `enc:${value}`),
  };
  const ingestion = { sync: jest.fn(opts.syncImpl ?? (async () => ({ status: 'synced', imported: 1, resumedTransaction: false }))) };
  const service = new PolarWebhookService(prisma as never, polar as never, ingestion as never);
  return { service, prisma, polar, ingestion };
}

describe('PolarWebhookService.verifySignature', () => {
  it('aceita assinatura HMAC-SHA256 hex correta sobre o corpo bruto', async () => {
    const { service } = build({});
    await expect(service.verifySignature(RAW, VALID_SIGNATURE)).resolves.toBeUndefined();
  });

  it('aceita a assinatura em maiusculas (comparacao normalizada pra hex minusculo)', async () => {
    const { service } = build({});
    await expect(service.verifySignature(RAW, VALID_SIGNATURE.toUpperCase())).resolves.toBeUndefined();
  });

  it('rejeita assinatura divergente (corpo alterado) com 401', async () => {
    const { service } = build({});
    const tampered = Buffer.from(RAW.toString().replace('59393531', '11111111'));
    await expect(service.verifySignature(tampered, VALID_SIGNATURE)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita sem cabecalho de assinatura com 401', async () => {
    const { service } = build({});
    await expect(service.verifySignature(RAW, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita sem corpo bruto com 401 (nunca verifica contra JSON reinterpretado)', async () => {
    const { service } = build({});
    await expect(service.verifySignature(undefined, VALID_SIGNATURE)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fail-closed: sem assinatura cadastrada, rejeita com 401 mesmo com cabecalho presente', async () => {
    const { service } = build({ subscription: null });
    await expect(service.verifySignature(RAW, VALID_SIGNATURE)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('PolarWebhookService.handleEvent', () => {
  it('evento EXERCISE de um aluno conectado dispara o sync() existente desse aluno', async () => {
    const { service, ingestion } = build({});
    await service.handleEvent({ event: 'EXERCISE', user_id: 59393531 });
    expect(ingestion.sync).toHaveBeenCalledWith('aluno-1');
  });

  it('ping de criacao e eventos nao tratados nao disparam nenhum sync', async () => {
    const { service, ingestion } = build({});
    await service.handleEvent({ event: 'PING' });
    await service.handleEvent({ event: 'SLEEP', user_id: 59393531 });
    await service.handleEvent(undefined);
    expect(ingestion.sync).not.toHaveBeenCalled();
  });

  it('user_id de Polar sem conexao local nao dispara sync (nunca sincroniza aluno errado)', async () => {
    const { service, ingestion } = build({ connection: null });
    await service.handleEvent({ event: 'EXERCISE', user_id: 999 });
    expect(ingestion.sync).not.toHaveBeenCalled();
  });
});

describe('PolarWebhookService.register (fronteira de ativacao)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('POST /v3/webhooks com url e events EXERCISE, e guarda signature_secret_key CIFRADA', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: 'wh-1', signature_secret_key: 'chave-nova' }),
    }) as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const { service, prisma, polar } = build({});

    await service.register('https://api.exemplo/polar/webhook', 'token-x');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.polaraccesslink.com/v3/webhooks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://api.exemplo/polar/webhook', events: ['EXERCISE'] });
    expect(polar.encryptSecret).toHaveBeenCalledWith('chave-nova');
    expect(prisma.polarWebhookSubscription.create).toHaveBeenCalledWith({
      data: { url: 'https://api.exemplo/polar/webhook', polarWebhookId: 'wh-1', signatureSecretEncrypted: 'enc:chave-nova' },
    });
  });

  it('resposta sem signature_secret_key e erro — nunca grava assinatura vazia', async () => {
    global.fetch = (jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 'wh-2' }) })) as unknown) as typeof fetch;
    const { service, prisma } = build({});
    await expect(service.register('https://api.exemplo/polar/webhook', 'token-x')).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.polarWebhookSubscription.create).not.toHaveBeenCalled();
  });
});
